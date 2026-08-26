import type { ScanConfig } from './config.js';
import type { Target } from './target.js';

export interface ScanContext {
  readonly id: string;
  readonly target: Target;
  readonly config: ScanConfig;
  readonly startedAt: Date;
}
