import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { discover } from '../../src/discovery/index.js';
import { HttpError } from '../../src/http/index.js';
import type { HttpClient, HttpResponse } from '../../src/http/index.js';

function response(
  requestUrl: string,
  body: string,
  fingerprints = false,
): HttpResponse {
  return {
    requestedUrl: requestUrl,
    finalUrl: requestUrl,
    statusCode: 200,
    statusMessage: 'OK',
    headers: { 'content-type': ['text/html'] },
    body,
    responseTime: 1,
    redirectChain: [],
    ...(fingerprints
      ? {
          requestFingerprint: 'request-fingerprint',
          responseFingerprint: 'response-fingerprint',
        }
      : {}),
  };
}

function clientFor(
  handler: (url: string) => HttpResponse,
  signals: (AbortSignal | undefined)[],
): HttpClient {
  return {
    request: (request) => {
      signals.push(request.signal);
      return Promise.resolve(handler(request.url.href));
    },
  };
}

describe('public discovery API', () => {
  it('publishes the svft-discovery package identity and preserved CLI boundary', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      name?: unknown;
      bin?: unknown;
      exports?: unknown;
    };

    expect(packageJson.name).toBe('svft-discovery');
    expect(packageJson.bin).toEqual({ svft: './dist/cli/index.js' });
    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
      './discovery': {
        types: './dist/discovery/index.d.ts',
        import: './dist/discovery/index.js',
      },
    });
  });

  it('normalizes string and URL targets, configuration, output, and statistics', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const events: string[] = [];
    const client = clientFor(
      (url) => {
        if (url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')) {
          return response(url, '');
        }
        if (url.endsWith('/next?item=42')) return response(url, '<html></html>');
        return response(
          url,
          '<html><a href="/next?item=42">Next</a><form action="/submit" method="post"><input name="query" type="text"></form></html>',
          true,
        );
      },
      signals,
    );
    const signal = new AbortController().signal;

    const output = await discover(
      new URL('https://user:secret@example.com/path#fragment'),
      {
        config: {
          crawlDepth: 1,
          headers: { Authorization: 'Bearer secret' },
        },
        client,
        signal,
        onEvent: (event) => events.push(event.type),
      },
    );

    expect(output.schemaVersion).toBe('svft.discovery/v1');
    expect(output.target).toBe('https://example.com/path');
    expect(output.configuration).toMatchObject({ crawlDepth: 1 });
    expect(output.configuration).not.toHaveProperty('headers');
    expect(output.seed.url).toBe('https://example.com/path');
    expect(output.discoveredUrls.map((item) => item.url)).toContain(
      'https://example.com/next?item=42',
    );
    expect(output.forms[0]?.action).toBe('https://example.com/submit');
    expect(output.endpoints[0]?.requestFingerprint).toBe(
      'request-fingerprint',
    );
    expect(output.endpoints[0]?.responseFingerprint).toBe(
      'response-fingerprint',
    );
    expect(output.statistics).toEqual({
      requestedCount: 2,
      discoveredUrlCount: 2,
      formCount: 1,
      endpointCount: 3,
      failureCount: 0,
    });
    expect(output.failures).toEqual([]);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((value) => value === signal)).toBe(true);
    expect(events).toContain('discovery-completed');
  });

  it('does not expose response bodies, form values, or error causes', async () => {
    const client: HttpClient = {
      request: (request) => {
        if (
          request.url.pathname === '/robots.txt' ||
          request.url.pathname === '/sitemap.xml'
        ) {
          return Promise.resolve(response(request.url.href, ''));
        }
        if (request.url.pathname === '/') {
          return Promise.resolve(
            response(
              request.url.href,
              '<html>response-body-secret<a href="/failed?token=42">Fail</a><form action="/submit"><input name="query" value="form-value-secret"></form></html>',
            ),
          );
        }
        return Promise.reject(
          new HttpError(
            'CONNECTION_FAILURE',
            'child request failed',
            request.url.href,
            new Error('cause-secret'),
          ),
        );
      },
    };

    const output = await discover('https://example.com', {
      config: { crawlDepth: 1 },
      client,
    });
    const serialized = JSON.stringify(output);

    expect(output.discoveredUrls[1]?.url).toBe(
      'https://example.com/failed?token=42',
    );
    expect(output.failures[0]?.error).toEqual({
      code: 'CONNECTION_FAILURE',
      message: 'child request failed',
      url: 'https://example.com/failed?token=42',
    });
    expect(serialized).not.toContain('response-body-secret');
    expect(serialized).not.toContain('form-value-secret');
    expect(serialized).not.toContain('cause-secret');
    expect(serialized).not.toContain('stack');
  });

  it('returns empty form and failure arrays when no optional records exist', async () => {
    const output = await discover('https://example.com', {
      client: clientFor(
        (url) =>
          url.endsWith('/robots.txt') || url.endsWith('/sitemap.xml')
            ? response(url, '')
            : response(url, '<html></html>'),
        [],
      ),
    });

    expect(output.forms).toEqual([]);
    expect(output.failures).toEqual([]);
    expect(output.endpoints).toEqual([
      expect.objectContaining({ url: 'https://example.com/' }),
    ]);
  });

  it('keeps the stable module export surface narrow', async () => {
    const publicModule = await import('../../src/discovery/index.js');

    expect(Object.keys(publicModule)).toEqual(['discover']);
  });
});
