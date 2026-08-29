import { describe, expect, it } from 'vitest';

import {
  createEndpointInventory,
  extractAnchorHrefs,
  extractForms,
  isDocumentUrl,
  isSameOrigin,
  normalizeDiscoveredUrl,
} from '../../src/discovery/index.js';
import type { DiscoveredForm, DiscoveredUrl } from '../../src/types/index.js';

describe('discovery link helpers', () => {
  it('builds deduplicated endpoints and ordered query/form parameters', () => {
    const urls: DiscoveredUrl[] = [
      {
        url: 'https://example.com/search?a=1&a=2&b=3',
        depth: 1,
        discoveredFrom: 'https://example.com/',
      },
    ];
    const forms: DiscoveredForm[] = [
      {
        action: 'https://example.com/search?a=1&a=2&b=3',
        method: 'GET',
        fields: [
          { name: 'a', type: 'input', attributes: {} },
          { name: 'term', type: 'input', attributes: {} },
          { name: null, type: 'button', attributes: { type: 'submit' } },
          { name: 'term', type: 'input', attributes: {} },
        ],
      },
    ];

    expect(
      createEndpointInventory(urls, forms, [
        { depth: 2, discoveredFrom: 'https://example.com/form' },
      ]),
    ).toEqual([
      {
        url: 'https://example.com/search?a=1&a=2&b=3',
        method: 'GET',
        parameters: [
          { name: 'a', source: 'query' },
          { name: 'b', source: 'query' },
          { name: 'a', source: 'form' },
          { name: 'term', source: 'form' },
        ],
        depth: 1,
        discoveredFrom: 'https://example.com/',
        source: 'url',
      },
    ]);
  });

  it('decodes query parameter names while preserving endpoint query values', () => {
    const endpoints = createEndpointInventory(
      [
        {
          url: 'https://example.com/search?user%20name=alice&tag=one&tag=two',
          depth: 0,
          discoveredFrom: null,
        },
      ],
      [],
    );

    expect(endpoints[0]).toMatchObject({
      url: 'https://example.com/search?user%20name=alice&tag=one&tag=two',
      parameters: [
        { name: 'user name', source: 'query' },
        { name: 'tag', source: 'query' },
      ],
    });
  });

  it('deduplicates endpoint identity by method, path, and query shape', () => {
    const endpoints = createEndpointInventory(
      [
        { url: 'https://example.com/category', depth: 0, discoveredFrom: null },
        {
          url: 'https://example.com/category/subcategory',
          depth: 0,
          discoveredFrom: null,
        },
        {
          url: 'https://example.com/category?id=1',
          depth: 1,
          discoveredFrom: 'https://example.com/',
        },
        {
          url: 'https://example.com/category?id=2',
          depth: 1,
          discoveredFrom: 'https://example.com/',
        },
        {
          url: 'https://example.com/category?sort=1',
          depth: 1,
          discoveredFrom: 'https://example.com/',
        },
      ],
      [],
    );

    expect(endpoints.map((endpoint) => endpoint.url)).toEqual([
      'https://example.com/category',
      'https://example.com/category/subcategory',
      'https://example.com/category?id=1',
      'https://example.com/category?sort=1',
    ]);
    expect(endpoints[2]?.parameters).toEqual([{ name: 'id', source: 'query' }]);
  });

  it('extracts passive forms in document order without field values', () => {
    const forms = extractForms(
      '<form action="/submit#frag" method="post"><input name="user" required value="secret"><select name="roles" multiple></select><textarea name="note">secret</textarea><button name="go" type="submit">Go</button></form><form><input></form>',
      new URL('https://example.com/path/page'),
      'https://example.com',
    );

    expect(forms).toEqual([
      {
        action: 'https://example.com/submit',
        method: 'POST',
        fields: [
          { name: 'user', type: 'input', attributes: { required: true } },
          { name: 'roles', type: 'select', attributes: { multiple: true } },
          { name: 'note', type: 'textarea', attributes: {} },
          {
            name: 'go',
            type: 'button',
            attributes: { type: 'submit' },
          },
        ],
      },
      {
        action: 'https://example.com/path/page',
        method: 'GET',
        fields: [{ name: null, type: 'input', attributes: {} }],
      },
    ]);
  });

  it('ignores unsupported and external form actions', () => {
    const base = new URL('https://example.com/');
    expect(
      extractForms(
        '<form action="javascript:alert(1)"></form>',
        base,
        base.origin,
      ),
    ).toEqual([]);
    expect(
      extractForms(
        '<form action="https://other.example/form"></form>',
        base,
        base.origin,
      ),
    ).toEqual([]);
  });

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
