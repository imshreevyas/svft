import { randomUUID } from 'node:crypto';

import type { ScanConfig, ScanContext, Target } from '../types/index.js';

export function createScanContext(
  target: Target,
  config: ScanConfig,
): ScanContext {
  return {
    id: randomUUID(),
    target,
    config,
    startedAt: new Date(),
  };
}
