import type { ScanConfig } from './config.js';
import type { DiscoveryResult } from './discovery.js';

export interface ScanResult {
  readonly scanId: string;
  readonly target: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly duration: number;
  readonly configuration: ScanConfig;
  readonly discovery: DiscoveryResult;
}
