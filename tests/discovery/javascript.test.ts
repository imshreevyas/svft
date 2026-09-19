import { describe, expect, it } from 'vitest';

import {
  extractJavaScriptReferences,
  extractScriptSources,
  isJavaScriptTextResponse,
} from '../../src/discovery/index.js';

describe('passive JavaScript extraction', () => {
  it('extracts script sources in source order', () => {
    expect(
      extractScriptSources(
        '<script src="one.js"></script><SCRIPT defer SRC=\'/two.js\'></SCRIPT><script data-src="ignored.js"></script><script src=?bundle=1></script>',
      ),
    ).toEqual(['one.js', '/two.js', '?bundle=1']);
  });

  it('extracts conservative static URL and path references in order', () => {
    const source =
      String.raw`
      const absolute = "https://example.com/api/users";
      const root = '/api/orders?state=open';
      const relative = "../v1/items";
      const api = 'api/session';
      const versioned = ` +
      '`v2/profile`' +
      String.raw`;
      const escaped = "\/api\/escaped";
      const ignored = "ordinary words";
      const dynamic = ` +
      '`/api/${tenant}`' +
      `;
    `;

    expect(extractJavaScriptReferences(source)).toEqual([
      'https://example.com/api/users',
      '/api/orders?state=open',
      '../v1/items',
      'api/session',
      'v2/profile',
      '/api/escaped',
    ]);
  });

  it('rejects encoded markup and code-like path fragments while preserving routes', () => {
    expect(
      extractJavaScriptReferences(
        String.raw`const values = ["/%3E%60,w=%60viewBox=", "/api/Feedbacks", "/rest/products", "/login", "/20", "/admin/users/list", "/search?q=cat", "https://example.com/absolute"];`,
      ),
    ).toEqual([
      '/api/Feedbacks',
      '/rest/products',
      '/login',
      '/20',
      '/admin/users/list',
      '/search?q=cat',
      'https://example.com/absolute',
    ]);
  });

  it('rejects malformed paths and template/code expressions', () => {
    expect(
      extractJavaScriptReferences(
        String.raw`const values = ["//external.example/path", "/api/\${id}", "/api/{id}", "/api/.../items", "/api/%ZZ", "/api/(incomplete", "/g,", "not a path", "http://"];`,
      ),
    ).toEqual([]);
  });

  it('preserves punctuation that belongs to a complete URL and rejects syntax punctuation', () => {
    expect(
      extractJavaScriptReferences(
        String.raw`const values = ["/search?q=a,b", "/products/v1.2", "?tab=2", "/g,"];`,
      ),
    ).toEqual(['/search?q=a,b', '/products/v1.2', '?tab=2']);
  });

  it('rejects framework and runtime internals without filtering application routes', () => {
    expect(
      extractJavaScriptReferences(
        String.raw`const values = ["/ROOT/node_modules/next/dist/compiled/process/", "/_not-found", "/_head", "/_tree", "/_index", "/@", "/_health", "/api/Feedbacks", "/rest/products", "/login", "/dashboard", "/products/123", "/20", "/admin/products/list", "/search?q=cat", "https://example.com/absolute"];`,
      ),
    ).toEqual([
      '/_health',
      '/api/Feedbacks',
      '/rest/products',
      '/login',
      '/dashboard',
      '/products/123',
      '/20',
      '/admin/products/list',
      '/search?q=cat',
      'https://example.com/absolute',
    ]);
  });

  it('accepts JavaScript text responses and rejects declared non-JavaScript', () => {
    expect(isJavaScriptTextResponse({})).toBe(true);
    expect(
      isJavaScriptTextResponse({
        'content-type': ['application/javascript; charset=utf-8'],
      }),
    ).toBe(true);
    expect(isJavaScriptTextResponse({ 'content-type': ['text/html'] })).toBe(
      false,
    );
    expect(
      isJavaScriptTextResponse({ 'content-type': ['application/json'] }),
    ).toBe(false);
  });
});
