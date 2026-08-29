import {
  request as httpRequest,
  validateHeaderName,
  validateHeaderValue,
  type ClientRequest,
  type IncomingMessage,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import type { ScanConfig } from '../types/config.js';
import { HttpError } from './errors.js';
import type { HttpMethod, HttpRequest } from './request.js';
import type {
  HttpRedirect,
  HttpResponse,
  HttpResponseHeaders,
} from './response.js';
import { fingerprintRequest, fingerprintResponse } from '../fingerprints.js';

const SUPPORTED_METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
]);
const RETRYABLE_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS']);
const RETRYABLE_TRANSPORT_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
]);
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

interface SingleResponse {
  readonly statusCode: number;
  readonly statusMessage: string | undefined;
  readonly headers: HttpResponseHeaders;
  readonly body: string;
  readonly requestFingerprint?: string;
}

export interface HttpClient {
  readonly request: (request: HttpRequest) => Promise<HttpResponse>;
}

class RequestTimeoutMarker extends Error {
  public constructor(public readonly timeout: number) {
    super(`Request timed out after ${String(timeout)}ms.`);
    this.name = 'RequestTimeoutMarker';
  }
}

function normalizeRequestHeaders(
  config: ScanConfig,
  requestHeaders: Readonly<Record<string, string>>,
  url: URL,
): Record<string, string> {
  const headers: Record<string, string> = {};

  const applyHeaders = (values: Readonly<Record<string, string>>): void => {
    for (const [name, value] of Object.entries(values)) {
      try {
        validateHeaderName(name);
        validateHeaderValue(name, value);
      } catch (cause: unknown) {
        throw new HttpError(
          'INVALID_REQUEST',
          `Invalid HTTP header ${JSON.stringify(name)}.`,
          url.href,
          cause,
        );
      }

      headers[name.toLowerCase()] = value;
    }
  };

  applyHeaders(config.headers);
  headers['user-agent'] = config.userAgent;
  applyHeaders(requestHeaders);

  return headers;
}

function normalizeResponseHeaders(
  rawHeaders: readonly string[],
): HttpResponseHeaders {
  const headers: Record<string, string[]> = {};

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];

    if (name === undefined || value === undefined) {
      continue;
    }

    const normalizedName = name.toLowerCase();
    const values = headers[normalizedName] ?? [];
    values.push(value);
    headers[normalizedName] = values;
  }

  return headers;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function mapRequestError(
  error: unknown,
  url: URL,
  signal: AbortSignal | undefined,
): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof RequestTimeoutMarker) {
    return new HttpError(
      'TIMEOUT',
      `HTTP request timed out after ${String(error.timeout)}ms: ${url.href}`,
      url.href,
      error,
    );
  }

  const code = errorCode(error);

  if (signal?.aborted === true || code === 'ABORT_ERR') {
    return new HttpError(
      'ABORTED',
      `HTTP request was aborted: ${url.href}`,
      url.href,
      error,
    );
  }

  if (
    (code !== undefined && TLS_ERROR_CODES.has(code)) ||
    code?.includes('TLS') === true ||
    code?.includes('SSL') === true ||
    code?.includes('CERT') === true
  ) {
    return new HttpError(
      'TLS_FAILURE',
      `TLS verification failed for ${url.href} (${code}).`,
      url.href,
      error,
    );
  }

  return new HttpError(
    'CONNECTION_FAILURE',
    `HTTP connection failed for ${url.href}${code === undefined ? '' : ` (${code})`}.`,
    url.href,
    error,
  );
}

function validateRequest(request: HttpRequest): void {
  const url =
    request.url instanceof URL ? request.url.href : String(request.url);

  if (!(request.url instanceof URL)) {
    throw new HttpError(
      'INVALID_REQUEST',
      'HTTP request URL must be a URL object.',
      url,
    );
  }

  if (!SUPPORTED_METHODS.has(request.method)) {
    throw new HttpError(
      'INVALID_REQUEST',
      `Unsupported HTTP method: ${request.method}.`,
      request.url.href,
    );
  }

  if (request.url.protocol !== 'http:' && request.url.protocol !== 'https:') {
    throw new HttpError(
      'UNSUPPORTED_PROTOCOL',
      `Unsupported HTTP protocol: ${request.url.protocol}`,
      request.url.href,
    );
  }

  if (request.signal?.aborted === true) {
    throw new HttpError(
      'ABORTED',
      `HTTP request was aborted: ${request.url.href}`,
      request.url.href,
      request.signal.reason,
    );
  }
}

function collectResponse(
  response: IncomingMessage,
  url: URL,
  resolve: (value: SingleResponse) => void,
  reject: (reason: HttpError) => void,
): void {
  const chunks: Buffer[] = [];

  response.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.once('end', () => {
    if (response.statusCode === undefined) {
      reject(
        new HttpError(
          'CONNECTION_FAILURE',
          `HTTP response did not include a status code: ${url.href}`,
          url.href,
        ),
      );
      return;
    }

    resolve({
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      headers: normalizeResponseHeaders(response.rawHeaders),
      body: Buffer.concat(chunks).toString('utf8'),
    });
  });
  response.once('aborted', () => {
    reject(
      new HttpError(
        'ABORTED',
        `HTTP response was aborted: ${url.href}`,
        url.href,
      ),
    );
  });
  response.once('error', (cause: Error) => {
    reject(mapRequestError(cause, url, undefined));
  });
}

function performSingleRequest(
  config: ScanConfig,
  request: HttpRequest,
  url: URL,
  method: HttpMethod,
): Promise<SingleResponse> {
  return new Promise((resolve, reject) => {
    const timeoutState: {
      value?: ReturnType<typeof setTimeout>;
      timedOut: boolean;
    } = { timedOut: false };
    const clearRequestTimeout = (): void => {
      if (timeoutState.value !== undefined) {
        clearTimeout(timeoutState.value);
      }
    };
    const resolveRequest = (value: SingleResponse): void => {
      clearRequestTimeout();
      resolve(value);
    };
    const rejectRequest = (reason: HttpError): void => {
      clearRequestTimeout();
      reject(
        timeoutState.timedOut && reason.code !== 'TIMEOUT'
          ? new HttpError(
              'TIMEOUT',
              `HTTP request timed out after ${String(config.timeout)}ms: ${url.href}`,
              url.href,
              reason,
            )
          : reason,
      );
    };
    const headers = normalizeRequestHeaders(config, request.headers, url);
    const options = {
      method,
      headers,
      rejectUnauthorized: config.verifyTLS,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const onResponse = (response: IncomingMessage): void => {
      collectResponse(
        response,
        url,
        (value) => {
          resolveRequest({
            ...value,
            requestFingerprint: fingerprintRequest({ method, url, headers }),
          });
        },
        rejectRequest,
      );
    };
    let nodeRequest: ClientRequest;

    try {
      nodeRequest =
        url.protocol === 'https:'
          ? httpsRequest(url, options, onResponse)
          : httpRequest(url, options, onResponse);
    } catch (cause: unknown) {
      rejectRequest(
        new HttpError(
          'INVALID_REQUEST',
          `Unable to create HTTP request: ${url.href}`,
          url.href,
          cause,
        ),
      );
      return;
    }

    timeoutState.value = setTimeout(() => {
      timeoutState.timedOut = true;
      nodeRequest.destroy(new RequestTimeoutMarker(config.timeout));
    }, config.timeout);

    nodeRequest.once('error', (cause: Error) => {
      rejectRequest(mapRequestError(cause, url, request.signal));
    });
    nodeRequest.end();
  });
}

function shouldRetry(method: HttpMethod, error: HttpError): boolean {
  if (!RETRYABLE_METHODS.has(method)) {
    return false;
  }

  if (error.code === 'TIMEOUT') {
    return true;
  }

  return (
    error.code === 'CONNECTION_FAILURE' &&
    RETRYABLE_TRANSPORT_CODES.has(errorCode(error.cause) ?? '')
  );
}

async function waitBeforeRetry(
  retryDelay: number,
  request: HttpRequest,
  url: URL,
): Promise<void> {
  if (retryDelay === 0) {
    return;
  }

  try {
    await delay(retryDelay, undefined, {
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  } catch (cause: unknown) {
    throw mapRequestError(cause, url, request.signal);
  }
}

async function requestWithRetries(
  config: ScanConfig,
  request: HttpRequest,
  url: URL,
  method: HttpMethod,
): Promise<SingleResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await performSingleRequest(config, request, url, method);
    } catch (cause: unknown) {
      const error = mapRequestError(cause, url, request.signal);

      if (attempt >= config.retries || !shouldRetry(method, error)) {
        throw error;
      }

      await waitBeforeRetry(config.retryDelay, request, url);
    }
  }
}

function redirectedMethod(method: HttpMethod, statusCode: number): HttpMethod {
  if (
    statusCode === 303 ||
    ((statusCode === 301 || statusCode === 302) && method === 'POST')
  ) {
    return 'GET';
  }

  return method;
}

function redirectUrl(location: string, currentUrl: URL): URL {
  let nextUrl: URL;

  try {
    nextUrl = new URL(location, currentUrl);
  } catch (cause: unknown) {
    throw new HttpError(
      'INVALID_REQUEST',
      `Invalid redirect location from ${currentUrl.href}: ${location}`,
      currentUrl.href,
      cause,
    );
  }

  if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
    throw new HttpError(
      'UNSUPPORTED_PROTOCOL',
      `Unsupported HTTP protocol: ${nextUrl.protocol}`,
      nextUrl.href,
    );
  }

  return nextUrl;
}

export function createHttpClient(config: ScanConfig): HttpClient {
  return {
    request: async (request): Promise<HttpResponse> => {
      validateRequest(request);

      const requestedUrl = request.url.href;
      const startedAt = performance.now();
      const redirectChain: HttpRedirect[] = [];
      let currentUrl = new URL(request.url);
      let method = request.method;

      for (;;) {
        const response = await requestWithRetries(
          config,
          request,
          currentUrl,
          method,
        );
        const location = response.headers.location?.[0];
        const isRedirect = REDIRECT_STATUS_CODES.has(response.statusCode);

        if (!config.followRedirects || !isRedirect || location === undefined) {
          const finalResponse = {
            requestedUrl,
            finalUrl: currentUrl.href,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            body: response.body,
            responseTime: performance.now() - startedAt,
            redirectChain,
          };
          return {
            ...finalResponse,
            ...(response.requestFingerprint === undefined
              ? {}
              : { requestFingerprint: response.requestFingerprint }),
            responseFingerprint: fingerprintResponse(finalResponse),
          };
        }

        if (redirectChain.length >= config.maxRedirects) {
          throw new HttpError(
            'REDIRECT_LIMIT_EXCEEDED',
            `HTTP redirect limit of ${String(config.maxRedirects)} exceeded: ${requestedUrl}`,
            currentUrl.href,
          );
        }

        const nextUrl = redirectUrl(location, currentUrl);

        if (request.canFollowRedirect?.(nextUrl) === false) {
          const finalResponse = {
            requestedUrl,
            finalUrl: currentUrl.href,
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            headers: response.headers,
            body: response.body,
            responseTime: performance.now() - startedAt,
            redirectChain,
          };
          return {
            ...finalResponse,
            ...(response.requestFingerprint === undefined
              ? {}
              : { requestFingerprint: response.requestFingerprint }),
            responseFingerprint: fingerprintResponse(finalResponse),
          };
        }

        redirectChain.push({
          fromUrl: currentUrl.href,
          toUrl: nextUrl.href,
          statusCode: response.statusCode,
        });
        currentUrl = nextUrl;
        method = redirectedMethod(method, response.statusCode);
      }
    },
  };
}
