import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ResultWriteError, writeScanResult } from '../../src/results/index.js';
import type { ScanResult } from '../../src/types/index.js';

let temporaryDirectory: string;

const result: ScanResult = {
  scanId: 'fixed-id',
  target: 'https://example.com/',
  startedAt: '2026-08-27T00:00:00.000Z',
  completedAt: '2026-08-27T00:00:01.000Z',
  duration: 1000,
  configuration: {
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
  },
  discovery: {
    seed: {
      url: 'https://example.com/',
      depth: 0,
      discoveredFrom: null,
    },
    discoveredUrls: [],
    requestedCount: 1,
    failedUrls: [],
  },
  targetInventory: [],
};

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'svft-results-'));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('JSON result writer', () => {
  it('creates the result directory and writes readable canonical JSON', async () => {
    const relativePath = await writeScanResult(result, temporaryDirectory);

    expect(relativePath).toBe('svft-results/scan-fixed-id.json');
    const contents = await readFile(
      join(temporaryDirectory, 'svft-results', 'scan-fixed-id.json'),
      'utf8',
    );
    expect(contents.startsWith('{\n  "scanId": "fixed-id"')).toBe(true);
    expect(JSON.parse(contents)).toEqual(result);
  });

  it('does not overwrite an existing result', async () => {
    await writeScanResult(result, temporaryDirectory);

    await expect(
      writeScanResult(result, temporaryDirectory),
    ).rejects.toBeInstanceOf(ResultWriteError);
  });
});
