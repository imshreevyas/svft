import type { ScanConfig } from './config.js';
import type { DiscoveryProvenance, DiscoveryResult } from './discovery.js';

export interface SecurityTarget {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly source: DiscoveryProvenance['source'];
  readonly parameterNames: readonly string[];
  readonly provenance: readonly DiscoveryProvenance[];
}

export interface ScanResult {
  readonly scanId: string;
  readonly target: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly duration: number;
  readonly configuration: ScanConfig;
  readonly discovery: DiscoveryResult;
  readonly targetInventory: readonly SecurityTarget[];
}
