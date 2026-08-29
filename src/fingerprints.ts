import { createHash } from 'node:crypto';

import type { HttpRequest } from './http/request.js';
import type { HttpResponse } from './http/response.js';

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

function normalizedHeaders(
  headers: Readonly<Record<string, string | readonly string[]>>,
): Record<string, readonly string[]> {
  const normalized: Record<string, readonly string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      /(?:authorization|cookie|token|password|secret|api[-_]?key)/iu.test(
        normalizedName,
      )
    ) {
      continue;
    }
    const values = typeof value === 'string' ? [value] : [...value];
    normalized[normalizedName] = values.sort();
  }
  return normalized;
}

export function fingerprintRequest(request: HttpRequest): string {
  const url = new URL(request.url.href);
  url.hash = '';
  return digest({
    method: request.method.toUpperCase(),
    url: url.href,
    headers: normalizedHeaders(request.headers),
  });
}

export function fingerprintResponse(response: HttpResponse): string {
  return digest({
    status: response.statusCode,
    headers: normalizedHeaders(response.headers),
    body: response.body,
  });
}

export const createRequestFingerprint = fingerprintRequest;
export const createResponseFingerprint = fingerprintResponse;
