import type {
  DiscoveryResult,
  ScanContext,
  ScanResult,
} from '../types/index.js';
import { createSecurityTargetInventory } from './target-inventory.js';

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
    targetInventory: createSecurityTargetInventory(discovery),
  };
}
