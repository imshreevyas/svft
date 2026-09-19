import { createScanConfig } from '../core/index.js';
import { createTarget } from '../core/index.js';
import { HttpError, type HttpClient } from '../http/index.js';
import {
  sanitizeDiscoveryEvent,
  sanitizeDiscoveryResult,
  sanitizePublicErrorMessage,
  sanitizePublicUrl,
} from '../output-sanitization.js';
import type {
  DiscoveryResult,
  DiscoveryEventHandler,
  DiscoveryOutputV1,
  ScanConfigOverrides,
} from '../types/index.js';
import { discoverUrls } from './crawler.js';

export interface DiscoverOptions {
  readonly config?: ScanConfigOverrides;
  readonly client?: HttpClient;
  readonly signal?: AbortSignal;
  readonly onEvent?: DiscoveryEventHandler;
}

export async function discover(
  target: string | URL,
  options: DiscoverOptions = {},
): Promise<DiscoveryOutputV1> {
  const normalizedTarget = createTarget(
    typeof target === 'string' ? target : target.href,
  );
  const configuration = createScanConfig(options.config);
  let result: DiscoveryResult;

  try {
    result = await discoverUrls(normalizedTarget, configuration, {
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onEvent === undefined
        ? {}
        : {
            onEvent: (event) =>
              options.onEvent?.(sanitizeDiscoveryEvent(event)),
          }),
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      throw new HttpError(
        error.code,
        sanitizePublicErrorMessage(error.message, error.url),
        sanitizePublicUrl(error.url),
      );
    }
    throw error;
  }

  const sanitizedResult = sanitizeDiscoveryResult(result);
  const { headers, ...sanitizedConfiguration } = configuration;
  void headers;
  const forms = sanitizedResult.forms ?? [];
  const endpoints = sanitizedResult.endpoints ?? [];
  const failures = sanitizedResult.failedUrls;

  return {
    schemaVersion: 'svft.discovery/v1',
    target: sanitizePublicUrl(normalizedTarget.normalizedUrl),
    configuration: sanitizedConfiguration,
    seed: sanitizedResult.seed,
    discoveredUrls: sanitizedResult.discoveredUrls,
    forms,
    endpoints,
    failures,
    statistics: {
      requestedCount: sanitizedResult.requestedCount,
      discoveredUrlCount: sanitizedResult.discoveredUrls.length,
      formCount: forms.length,
      endpointCount: endpoints.length,
      failureCount: failures.length,
    },
  };
}
