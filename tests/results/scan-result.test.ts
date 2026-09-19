import { describe, expect, it } from 'vitest';

import { createScanConfig, createTarget } from '../../src/core/index.js';
import { createScanResult } from '../../src/results/index.js';
import type { DiscoveryResult, ScanContext } from '../../src/types/index.js';

describe('ScanResult', () => {
  it('contains scan identity, target, configuration, timing, and discovery', () => {
    const target = createTarget('https://example.com/path#fragment');
    const configuration = createScanConfig({
      crawlDepth: 2,
      headers: {
        Authorization: 'Bearer persisted-secret',
        Cookie: 'session=persisted-secret',
      },
    });
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
      configuration: {
        ...configuration,
        headers: {},
      },
      discovery,
      targetInventory: [
        {
          url: 'https://example.com/path',
          method: 'GET',
          source: 'url',
          parameterNames: [],
          provenance: [],
        },
      ],
    });
  });

  it('redacts sensitive URLs in persisted data without changing the input inventory', () => {
    const target = createTarget(
      'https://example.com/path?token=target-secret&filter=recent',
    );
    const discovery: DiscoveryResult = {
      seed: {
        url: target.normalizedUrl,
        depth: 0,
        discoveredFrom: null,
      },
      discoveredUrls: [
        {
          url: 'https://example.com/next?signature=child-secret&page=2',
          depth: 1,
          discoveredFrom: target.normalizedUrl,
          source: 'url',
        },
      ],
      forms: [
        {
          action: 'https://example.com/submit?password=form-secret&mode=edit',
          method: 'POST',
          fields: [],
        },
      ],
      requestedCount: 2,
      failedUrls: [],
    };
    const context: ScanContext = {
      id: 'scan-id',
      target,
      config: createScanConfig(),
      startedAt: new Date('2026-08-27T00:00:00.000Z'),
    };

    const result = createScanResult(context, discovery);
    const serialized = JSON.stringify(result);

    expect(discovery.discoveredUrls[0]?.url).toContain('child-secret');
    expect(result.target).toContain('token=REDACTED');
    expect(result.discovery.discoveredUrls[0]?.url).toBe(
      'https://example.com/next?signature=REDACTED&page=2',
    );
    expect(result.discovery.forms?.[0]?.action).toBe(
      'https://example.com/submit?password=REDACTED&mode=edit',
    );
    expect(result.targetInventory).toEqual([
      expect.objectContaining({
        url: 'https://example.com/next?signature=REDACTED&page=2',
      }),
      expect.objectContaining({
        url: 'https://example.com/submit?password=REDACTED&mode=edit',
      }),
    ]);
    for (const secret of ['target-secret', 'child-secret', 'form-secret']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('filter=recent');
    expect(serialized).toContain('page=2');
    expect(serialized).toContain('mode=edit');
  });
});
