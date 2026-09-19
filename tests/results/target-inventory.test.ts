import { describe, expect, it, vi } from 'vitest';

import { createEndpointInventory } from '../../src/discovery/endpoints.js';
import { createSecurityTargetInventory } from '../../src/results/index.js';
import type {
  DiscoveredForm,
  DiscoveredUrl,
  DiscoveryResult,
} from '../../src/types/index.js';

function discovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    seed: {
      url: 'https://example.com/',
      depth: 0,
      discoveredFrom: null,
      source: 'url',
    },
    discoveredUrls: [],
    requestedCount: 0,
    failedUrls: [],
    ...overrides,
  };
}

describe('security target inventory', () => {
  it('preserves concrete targets when endpoint shapes aggregate query values', () => {
    const discoveredUrls: DiscoveredUrl[] = [
      {
        url: 'https://example.com/api/search?q=cat',
        depth: 1,
        discoveredFrom: 'https://example.com/first',
        source: 'url',
      },
      {
        url: 'https://example.com/api/search?q=dog',
        depth: 2,
        discoveredFrom: 'https://example.com/app.js',
        source: 'javascript',
      },
      {
        url: 'https://example.com/api/search?q=cat',
        depth: 3,
        discoveredFrom: 'https://example.com/repeated',
        source: 'url',
      },
    ];
    const forms: DiscoveredForm[] = [
      {
        action: 'https://example.com/api/search?q=cat',
        method: 'POST',
        fields: [{ name: 'page', type: 'input', attributes: {} }],
        provenance: [
          {
            source: 'form',
            discoveredFrom: 'https://example.com/form',
            depth: 1,
          },
        ],
      },
    ];
    const endpoints = createEndpointInventory(discoveredUrls, forms);

    expect(
      endpoints.filter((endpoint) => endpoint.method === 'GET'),
    ).toHaveLength(1);

    const result = createSecurityTargetInventory(
      discovery({ discoveredUrls, forms, endpoints }),
    );

    expect(result.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET https://example.com/api/search?q=cat',
      'GET https://example.com/api/search?q=dog',
      'POST https://example.com/api/search?q=cat',
    ]);
    expect(result[0]?.parameterNames).toEqual(['q']);
    expect(result[1]?.parameterNames).toEqual(['q']);
    expect(result[2]?.parameterNames).toEqual(['q', 'page']);
    expect(result[0]?.provenance).toEqual([
      {
        source: 'url',
        discoveredFrom: 'https://example.com/first',
        depth: 1,
      },
      {
        source: 'url',
        discoveredFrom: 'https://example.com/repeated',
        depth: 3,
      },
    ]);
    expect(result[1]?.provenance).toEqual([
      {
        source: 'javascript',
        discoveredFrom: 'https://example.com/app.js',
        depth: 2,
      },
    ]);
    expect(result[2]?.provenance).toEqual(forms[0]?.provenance);
  });

  it('creates ordered URL and sitemap targets with concrete query values', () => {
    const result = createSecurityTargetInventory(
      discovery({
        discoveredUrls: [
          {
            url: 'https://EXAMPLE.com/search?q=cat#result',
            depth: 1,
            discoveredFrom: 'https://example.com/',
            source: 'url',
          },
          {
            url: 'https://example.com/from-sitemap?page=2',
            depth: 1,
            discoveredFrom: 'https://example.com/sitemap.xml',
            source: 'sitemap',
          },
          {
            url: 'https://example.com/search?q=dog',
            depth: 1,
            discoveredFrom: 'https://example.com/',
            source: 'url',
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        url: 'https://example.com/search?q=cat',
        method: 'GET',
        source: 'url',
        parameterNames: ['q'],
        provenance: [
          {
            source: 'url',
            discoveredFrom: 'https://example.com/',
            depth: 1,
          },
        ],
      },
      {
        url: 'https://example.com/from-sitemap?page=2',
        method: 'GET',
        source: 'sitemap',
        parameterNames: ['page'],
        provenance: [
          {
            source: 'sitemap',
            discoveredFrom: 'https://example.com/sitemap.xml',
            depth: 1,
          },
        ],
      },
      {
        url: 'https://example.com/search?q=dog',
        method: 'GET',
        source: 'url',
        parameterNames: ['q'],
        provenance: [
          {
            source: 'url',
            discoveredFrom: 'https://example.com/',
            depth: 1,
          },
        ],
      },
    ]);
  });

  it('keeps GET and POST and different paths as separate form targets', () => {
    const result = createSecurityTargetInventory(
      discovery({
        forms: [
          {
            action: 'https://example.com/submit?flow=login',
            method: 'GET',
            fields: [{ name: 'username', type: 'input', attributes: {} }],
          },
          {
            action: 'https://example.com/submit?flow=login',
            method: 'POST',
            fields: [{ name: 'password', type: 'input', attributes: {} }],
          },
          {
            action: 'https://example.com/other',
            method: 'POST',
            fields: [],
          },
        ],
      }),
    );

    expect(result.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET https://example.com/submit?flow=login',
      'POST https://example.com/submit?flow=login',
      'POST https://example.com/other',
    ]);
    expect(result[0]?.parameterNames).toEqual(['flow', 'username']);
    expect(result[1]?.parameterNames).toEqual(['flow', 'password']);
    expect(result[0]?.provenance).toEqual([]);
    expect(result[1]?.provenance).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('login-password');
  });

  it('retains exact existing form provenance without inventing provenance', () => {
    const forms: DiscoveredForm[] = [
      {
        action: 'https://example.com/submit',
        method: 'POST',
        fields: [],
      },
    ];
    const endpoints = createEndpointInventory([], forms, [
      {
        depth: 2,
        discoveredFrom: 'https://example.com/form-page',
      },
    ]);

    expect(
      createSecurityTargetInventory(discovery({ forms, endpoints }))[0]
        ?.provenance,
    ).toEqual([
      {
        source: 'form',
        discoveredFrom: 'https://example.com/form-page',
        depth: 2,
      },
    ]);
    expect(
      createSecurityTargetInventory(discovery({ forms }))[0]?.provenance,
    ).toEqual([]);
  });

  it('deduplicates exact method and URL while merging names and provenance', () => {
    const result = createSecurityTargetInventory(
      discovery({
        discoveredUrls: [
          {
            url: 'https://EXAMPLE.com/search?q=cat#first',
            depth: 1,
            discoveredFrom: 'https://example.com/first',
            source: 'url',
          },
        ],
        forms: [
          {
            action: 'https://example.com/search?q=cat',
            method: 'GET',
            fields: [
              { name: 'term', type: 'input', attributes: {} },
              { name: 'q', type: 'input', attributes: {} },
            ],
            provenance: [
              {
                source: 'form',
                discoveredFrom: 'https://example.com/second',
                depth: 2,
              },
            ],
          },
        ],
      }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.parameterNames).toEqual(['q', 'term']);
    expect(result[0]?.provenance).toEqual([
      {
        source: 'url',
        discoveredFrom: 'https://example.com/first',
        depth: 1,
      },
      {
        source: 'form',
        discoveredFrom: 'https://example.com/second',
        depth: 2,
      },
    ]);
  });

  it('preserves JavaScript source and script-file provenance', () => {
    const result = createSecurityTargetInventory(
      discovery({
        discoveredUrls: [
          {
            url: 'https://example.com/api/users?active=true',
            depth: 1,
            discoveredFrom: 'https://example.com/assets/app.js',
            source: 'javascript',
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        url: 'https://example.com/api/users?active=true',
        method: 'GET',
        source: 'javascript',
        parameterNames: ['active'],
        provenance: [
          {
            source: 'javascript',
            discoveredFrom: 'https://example.com/assets/app.js',
            depth: 1,
          },
        ],
      },
    ]);
  });

  it('is a deterministic pure derivation that makes zero network requests', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const input = discovery({
      discoveredUrls: [
        {
          url: 'https://example.com/b',
          depth: 1,
          discoveredFrom: 'https://example.com/',
          source: 'robots',
        },
        {
          url: 'https://example.com/a',
          depth: 1,
          discoveredFrom: 'https://example.com/',
          source: 'url',
        },
      ],
    });

    expect(createSecurityTargetInventory(input)).toEqual(
      createSecurityTargetInventory(input),
    );
    expect(
      createSecurityTargetInventory(input).map((target) => target.url),
    ).toEqual(['https://example.com/b', 'https://example.com/a']);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
