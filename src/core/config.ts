import type { ScanConfig, ScanConfigOverrides } from '../types/config.js';

export const DEFAULT_SCAN_CONFIG: Readonly<ScanConfig> = Object.freeze({
  timeout: 10_000,
  retries: 2,
  retryDelay: 500,
  followRedirects: true,
  maxRedirects: 5,
  concurrency: 5,
  crawlDepth: 0,
  requestDelay: 0,
  verifyTLS: true,
  userAgent: 'SVFT/0.1.0',
  headers: Object.freeze({}),
});

export class InvalidScanConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidScanConfigError';
  }
}

function requireInteger(name: string, value: number, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    const condition =
      minimum === 0 ? 'a non-negative integer' : 'a positive integer';
    throw new InvalidScanConfigError(`${name} must be ${condition}.`);
  }
}

function requireBoolean(name: string, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new InvalidScanConfigError(`${name} must be a boolean.`);
  }
}

function requireUserAgent(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidScanConfigError('userAgent must be a non-empty string.');
  }
}

function requireHeaders(
  value: unknown,
): asserts value is Record<string, string> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.values(value).some((headerValue) => typeof headerValue !== 'string')
  ) {
    throw new InvalidScanConfigError(
      'headers must be a string-to-string record.',
    );
  }
}

export function createScanConfig(
  overrides: ScanConfigOverrides = {},
): ScanConfig {
  const headers: unknown = Object.hasOwn(overrides, 'headers')
    ? overrides.headers
    : DEFAULT_SCAN_CONFIG.headers;

  requireHeaders(headers);

  const config: ScanConfig = {
    ...DEFAULT_SCAN_CONFIG,
    ...overrides,
    headers: {
      ...DEFAULT_SCAN_CONFIG.headers,
      ...headers,
    },
  };

  requireInteger('timeout', config.timeout, 1);
  requireInteger('retries', config.retries, 0);
  requireInteger('retryDelay', config.retryDelay, 0);
  requireInteger('maxRedirects', config.maxRedirects, 0);
  requireInteger('concurrency', config.concurrency, 1);
  requireInteger('crawlDepth', config.crawlDepth, 0);
  requireInteger('requestDelay', config.requestDelay, 0);
  requireBoolean('followRedirects', config.followRedirects);
  requireBoolean('verifyTLS', config.verifyTLS);
  requireUserAgent(config.userAgent);

  return config;
}
