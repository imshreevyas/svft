import { createScanConfig } from '../core/index.js';
import { createTarget } from '../core/index.js';
import type { HttpClient } from '../http/index.js';
import type {
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
  const result = await discoverUrls(normalizedTarget, configuration, {
    ...(options.client === undefined ? {} : { client: options.client }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
  });
  const { headers, ...sanitizedConfiguration } = configuration;
  void headers;
  const forms = result.forms ?? [];
  const endpoints = result.endpoints ?? [];
  const failures = result.failedUrls;

  return {
    schemaVersion: 'svft.discovery/v1',
    target: normalizedTarget.normalizedUrl,
    configuration: sanitizedConfiguration,
    seed: result.seed,
    discoveredUrls: result.discoveredUrls,
    forms,
    endpoints,
    failures,
    statistics: {
      requestedCount: result.requestedCount,
      discoveredUrlCount: result.discoveredUrls.length,
      formCount: forms.length,
      endpointCount: endpoints.length,
      failureCount: failures.length,
    },
  };
}
