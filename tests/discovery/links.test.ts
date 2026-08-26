import { describe, expect, it } from 'vitest';

import {
  extractAnchorHrefs,
  isDocumentUrl,
  isSameOrigin,
  normalizeDiscoveredUrl,
} from '../../src/discovery/index.js';

describe('discovery link helpers', () => {
  it('extracts quoted, unquoted, and case-insensitive anchor hrefs in order', () => {
    const html = `
      <a href="/one">One</a>
      <A class="item" HREF='/two'>Two</A>
      <a href=/three>Three</a>
      <link href="/not-an-anchor">
    `;

    expect(extractAnchorHrefs(html)).toEqual(['/one', '/two', '/three']);
  });

  it('resolves relative links against the current page', () => {
    const url = normalizeDiscoveredUrl(
      'details',
      new URL('https://example.com/products/'),
    );

    expect(url?.href).toBe('https://example.com/products/details');
  });

  it('resolves root-relative links', () => {
    const url = normalizeDiscoveredUrl(
      '/login',
      new URL('https://example.com/products/'),
    );

    expect(url?.href).toBe('https://example.com/login');
  });

  it('resolves query-only links while preserving meaningful queries', () => {
    const base = new URL('https://example.com/search?q=cat');

    expect(normalizeDiscoveredUrl('?q=dog', base)?.href).toBe(
      'https://example.com/search?q=dog',
    );
  });

  it('normalizes host casing and removes fragments', () => {
    const url = normalizeDiscoveredUrl(
      'https://EXAMPLE.com/about#team',
      new URL('https://example.com/'),
    );

    expect(url?.href).toBe('https://example.com/about');
  });

  it('rejects unsupported protocols', () => {
    const base = new URL('https://example.com/');

    expect(normalizeDiscoveredUrl('javascript:alert(1)', base)).toBeNull();
    expect(normalizeDiscoveredUrl('mailto:test@example.com', base)).toBeNull();
    expect(normalizeDiscoveredUrl('tel:+10000000000', base)).toBeNull();
    expect(normalizeDiscoveredUrl('data:text/plain,test', base)).toBeNull();
  });

  it('filters common static and binary extensions case-insensitively', () => {
    for (const path of [
      '/image.JPG',
      '/style.css',
      '/app.JS',
      '/document.pdf',
      '/archive.zip',
      '/video.MP4',
    ]) {
      expect(isDocumentUrl(new URL(path, 'https://example.com'))).toBe(false);
    }

    expect(
      isDocumentUrl(new URL('/document.pdf?download=1', 'https://example.com')),
    ).toBe(false);
    expect(isDocumentUrl(new URL('/products', 'https://example.com'))).toBe(
      true,
    );
  });

  it('compares protocol, hostname, and port for same-origin scope', () => {
    const origin = 'https://example.com:8443';

    expect(isSameOrigin(new URL(`${origin}/inside`), origin)).toBe(true);
    expect(isSameOrigin(new URL('http://example.com:8443/'), origin)).toBe(
      false,
    );
    expect(isSameOrigin(new URL('https://example.com/'), origin)).toBe(false);
    expect(
      isSameOrigin(new URL('https://other.example.com:8443/'), origin),
    ).toBe(false);
  });
});
