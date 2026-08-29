import { describe, expect, it } from 'vitest';

import { createScanConfig, createTarget } from '../../src/core/index.js';
import { createScanResult } from '../../src/results/index.js';
import type { DiscoveryResult, ScanContext } from '../../src/types/index.js';

describe('ScanResult', () => {
  it('contains scan identity, target, configuration, timing, and discovery', () => {
    const target = createTarget('https://example.com/path#fragment');
    const configuration = createScanConfig({ crawlDepth: 2 });
    const context: ScanContext = {
      id: 'scan-id',
      target,
      config: configuration,
      startedAt: new Date('2026-08-27T00:00:00.000Z'),
    };
    const discovery: DiscoveryResult = {
      seed: {
        url: target.normalizedUrl,
        depth: 0,
        discoveredFrom: null,
      },
      discoveredUrls: [
        {
          url: target.normalizedUrl,
          depth: 0,
          discoveredFrom: null,
          source: 'url',
        },
      ],
      requestedCount: 1,
      failedUrls: [],
    };

    const result = createScanResult(
      context,
      discovery,
      new Date('2026-08-27T00:00:01.250Z'),
    );

    expect(result).toEqual({
      scanId: 'scan-id',
      target: 'https://example.com/path',
      startedAt: '2026-08-27T00:00:00.000Z',
      completedAt: '2026-08-27T00:00:01.250Z',
      duration: 1250,
      configuration,
      discovery,
      targetInventory: [
        {
          url: 'https://example.com/path',
          method: 'GET',
          source: 'url',
          parameterNames: [],
          provenance: [
            {
              source: 'url',
              discoveredFrom: null,
              depth: 0,
            },
          ],
        },
      ],
    });
  });
});
