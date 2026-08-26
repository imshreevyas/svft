import { describe, expect, it } from 'vitest';

import {
  createScanConfig,
  DEFAULT_SCAN_CONFIG,
  InvalidScanConfigError,
} from '../../src/core/index.js';
import type { ScanConfigOverrides } from '../../src/types/index.js';

describe('createScanConfig', () => {
  it('creates the complete default configuration', () => {
    expect(createScanConfig()).toEqual({
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
      headers: {},
    });
  });

  it('overrides timeout while preserving unrelated defaults', () => {
    const config = createScanConfig({ timeout: 15_000 });

    expect(config.timeout).toBe(15_000);
    expect(config.retries).toBe(DEFAULT_SCAN_CONFIG.retries);
  });

  it('overrides retries', () => {
    expect(createScanConfig({ retries: 3 }).retries).toBe(3);
  });

  it('overrides retry delay', () => {
    expect(createScanConfig({ retryDelay: 1_000 }).retryDelay).toBe(1_000);
  });

  it('configures redirect behavior', () => {
    const config = createScanConfig({
      followRedirects: false,
      maxRedirects: 0,
    });

    expect(config.followRedirects).toBe(false);
    expect(config.maxRedirects).toBe(0);
    expect(() => createScanConfig({ maxRedirects: -1 })).toThrow(
      'maxRedirects must be a non-negative integer.',
    );
  });

  it('overrides concurrency', () => {
    expect(createScanConfig({ concurrency: 10 }).concurrency).toBe(10);
  });

  it('overrides crawl depth', () => {
    expect(createScanConfig({ crawlDepth: 2 }).crawlDepth).toBe(2);
  });

  it('overrides request delay', () => {
    expect(createScanConfig({ requestDelay: 250 }).requestDelay).toBe(250);
  });

  it('configures TLS verification', () => {
    expect(createScanConfig({ verifyTLS: false }).verifyTLS).toBe(false);
  });

  it('overrides the user agent', () => {
    expect(createScanConfig({ userAgent: 'SVFT-Test/1.0' }).userAgent).toBe(
      'SVFT-Test/1.0',
    );
  });

  it('rejects an invalid timeout', () => {
    expect(() => createScanConfig({ timeout: 0 })).toThrow(
      'timeout must be a positive integer.',
    );
  });

  it('rejects invalid retries', () => {
    expect(() => createScanConfig({ retries: -1 })).toThrow(
      'retries must be a non-negative integer.',
    );
  });

  it('rejects an invalid retry delay', () => {
    expect(() => createScanConfig({ retryDelay: -1 })).toThrow(
      'retryDelay must be a non-negative integer.',
    );
  });

  it('rejects invalid concurrency', () => {
    expect(() => createScanConfig({ concurrency: 0 })).toThrow(
      'concurrency must be a positive integer.',
    );
  });

  it('rejects an invalid crawl depth', () => {
    expect(() => createScanConfig({ crawlDepth: -1 })).toThrow(
      'crawlDepth must be a non-negative integer.',
    );
  });

  it('rejects an invalid request delay', () => {
    expect(() => createScanConfig({ requestDelay: -1 })).toThrow(
      'requestDelay must be a non-negative integer.',
    );
  });

  it('rejects an empty user agent', () => {
    expect(() => createScanConfig({ userAgent: '   ' })).toThrow(
      'userAgent must be a non-empty string.',
    );
  });

  it('copies valid headers without changing the defaults', () => {
    const headers = { Authorization: 'Bearer test-token' };
    const config = createScanConfig({ headers });

    headers.Authorization = 'changed';
    expect(config.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(DEFAULT_SCAN_CONFIG.headers).toEqual({});
  });

  it('rejects header values that are not strings at runtime', () => {
    const invalidOverrides = {
      headers: { 'X-Test': 123 },
    } as unknown as ScanConfigOverrides;

    expect(() => createScanConfig(invalidOverrides)).toThrow(
      InvalidScanConfigError,
    );
    expect(() => createScanConfig(invalidOverrides)).toThrow(
      'headers must be a string-to-string record.',
    );
  });
});
