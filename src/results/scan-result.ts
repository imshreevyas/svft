import type {
  DiscoveryResult,
  ScanContext,
  ScanResult,
} from '../types/index.js';

export function createScanResult(
  context: ScanContext,
  discovery: DiscoveryResult,
  completedAt: Date = new Date(),
): ScanResult {
  return {
    scanId: context.id,
    target: context.target.normalizedUrl,
    startedAt: context.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    duration: Math.max(0, completedAt.getTime() - context.startedAt.getTime()),
    configuration: {
      ...context.config,
      headers: { ...context.config.headers },
    },
    discovery,
  };
}
