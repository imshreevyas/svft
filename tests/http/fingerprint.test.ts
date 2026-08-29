import { describe, expect, it } from 'vitest';

import {
  fingerprintRequest,
  fingerprintResponse,
} from '../../src/fingerprints.js';
import type { HttpRequest, HttpResponse } from '../../src/http/index.js';

const request = (headers: Readonly<Record<string, string>>): HttpRequest => ({
  method: 'GET',
  url: new URL('https://example.com/path#fragment'),
  headers,
});

const response = (
  headers: Readonly<Record<string, readonly string[]>>,
  body = 'body',
): HttpResponse => ({
  requestedUrl: 'https://example.com/',
  finalUrl: 'https://example.com/',
  statusCode: 200,
  statusMessage: 'OK',
  headers,
  body,
  responseTime: 1,
  redirectChain: [],
});

describe('fingerprints', () => {
  it('hashes identical requests equally and meaningful differences differently', () => {
    expect(
      fingerprintRequest(request({ Accept: 'text/html', 'X-Test': '1' })),
    ).toBe(fingerprintRequest(request({ 'x-test': '1', accept: 'text/html' })));
    expect(
      fingerprintRequest(request({ Accept: 'application/json' })),
    ).not.toBe(fingerprintRequest(request({ Accept: 'text/html' })));
  });

  it('hashes identical responses equally and normalizes header ordering', () => {
    expect(
      fingerprintResponse(
        response({ 'X-Test': ['one'], Accept: ['text/html', 'gzip'] }),
      ),
    ).toBe(
      fingerprintResponse(
        response({ accept: ['gzip', 'text/html'], 'x-test': ['one'] }),
      ),
    );
    expect(
      fingerprintResponse(response({ accept: ['text/html'] }, 'changed')),
    ).not.toBe(
      fingerprintResponse(response({ accept: ['text/html'] }, 'body')),
    );
  });
});
