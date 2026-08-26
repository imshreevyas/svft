export interface ScanConfig {
  readonly timeout: number;
  readonly retries: number;
  readonly retryDelay: number;
  readonly followRedirects: boolean;
  readonly maxRedirects: number;
  readonly concurrency: number;
  readonly crawlDepth: number;
  readonly requestDelay: number;
  readonly verifyTLS: boolean;
  readonly userAgent: string;
  readonly headers: Record<string, string>;
}

export type ScanConfigOverrides = Partial<ScanConfig>;
