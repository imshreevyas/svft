import type { HttpErrorCode } from '../http/errors.js';
import type { ScanConfig } from './config.js';

export interface DiscoveredUrl {
  readonly url: string;
  readonly depth: number;
  readonly discoveredFrom: string | null;
  readonly source?: 'url' | 'sitemap' | 'robots' | 'javascript';
  readonly provenance?: readonly DiscoveryProvenance[];
}

export interface DiscoveryProvenance {
  readonly source: 'url' | 'sitemap' | 'robots' | 'form' | 'javascript';
  readonly discoveredFrom: string;
  readonly depth: number;
}

export interface DiscoveryFailure {
  readonly target: DiscoveredUrl;
  readonly error: {
    readonly code: HttpErrorCode;
    readonly message: string;
    readonly url: string;
  };
}

export interface DiscoveredFormField {
  readonly name: string | null;
  readonly type: 'input' | 'select' | 'textarea' | 'button';
  readonly attributes: Readonly<Record<string, string | true>>;
}

export interface DiscoveredForm {
  readonly action: string;
  readonly method: 'GET' | 'POST';
  readonly fields: readonly DiscoveredFormField[];
  readonly provenance?: readonly DiscoveryProvenance[];
}

export interface DiscoveredParameter {
  readonly name: string;
  readonly source: 'query' | 'form';
}

export interface DiscoveredEndpoint {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly parameters: readonly DiscoveredParameter[];
  readonly depth: number;
  readonly discoveredFrom: string | null;
  readonly source: 'url' | 'sitemap' | 'robots' | 'form' | 'javascript';
  readonly requestFingerprint?: string;
  readonly responseFingerprint?: string;
  readonly provenance?: readonly DiscoveryProvenance[];
}

export interface DiscoveryResult {
  readonly seed: DiscoveredUrl;
  readonly discoveredUrls: readonly DiscoveredUrl[];
  readonly requestedCount: number;
  readonly failedUrls: readonly DiscoveryFailure[];
  readonly forms?: readonly DiscoveredForm[];
  readonly endpoints?: readonly DiscoveredEndpoint[];
}

export type DiscoveryConfiguration = Omit<ScanConfig, 'headers'>;

export interface DiscoveryStatistics {
  readonly requestedCount: number;
  readonly discoveredUrlCount: number;
  readonly formCount: number;
  readonly endpointCount: number;
  readonly failureCount: number;
}

export interface DiscoveryOutputV1 {
  readonly schemaVersion: 'svft.discovery/v1';
  readonly target: string;
  readonly configuration: DiscoveryConfiguration;
  readonly seed: DiscoveredUrl;
  readonly discoveredUrls: readonly DiscoveredUrl[];
  readonly forms: readonly DiscoveredForm[];
  readonly endpoints: readonly DiscoveredEndpoint[];
  readonly failures: readonly DiscoveryFailure[];
  readonly statistics: DiscoveryStatistics;
}

interface DiscoveryProgress {
  readonly requestedCount: number;
  readonly discoveredCount: number;
}

export interface DiscoveryRequestStartedEvent extends DiscoveryProgress {
  readonly type: 'request-started';
  readonly url: string;
  readonly depth: number;
}

export interface DiscoveryResponseReceivedEvent extends DiscoveryProgress {
  readonly type: 'response-received';
  readonly url: string;
  readonly depth: number;
  readonly statusCode: number;
  readonly statusMessage?: string;
  readonly duration: number;
  readonly linksDiscovered: number;
}

export type DiscoverySkipReason =
  | 'invalid-or-unsupported'
  | 'out-of-scope'
  | 'static-resource'
  | 'duplicate'
  | 'limit';

export interface DiscoveryUrlSkippedEvent extends DiscoveryProgress {
  readonly type: 'url-skipped';
  readonly url: string;
  readonly depth: number;
  readonly reason: DiscoverySkipReason;
}

export interface DiscoveryUrlDiscoveredEvent extends DiscoveryProgress {
  readonly type: 'url-discovered';
  readonly url: string;
  readonly depth: number;
  readonly discoveredFrom: string;
}

export interface DiscoveryRequestFailedEvent extends DiscoveryProgress {
  readonly type: 'request-failed';
  readonly url: string;
  readonly depth: number;
  readonly errorCode: HttpErrorCode;
}

export interface DiscoveryCompletedEvent extends DiscoveryProgress {
  readonly type: 'discovery-completed';
  readonly failedCount: number;
}

export type DiscoveryEvent =
  | DiscoveryRequestStartedEvent
  | DiscoveryResponseReceivedEvent
  | DiscoveryUrlSkippedEvent
  | DiscoveryUrlDiscoveredEvent
  | DiscoveryRequestFailedEvent
  | DiscoveryCompletedEvent;

export type DiscoveryEventHandler = (event: DiscoveryEvent) => void;
