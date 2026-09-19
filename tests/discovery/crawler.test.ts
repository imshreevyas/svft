import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { createScanConfig, createTarget } from '../../src/core/index.js';
import { discoverUrls } from '../../src/discovery/index.js';
import { createSecurityTargetInventory } from '../../src/results/index.js';
import type {
  DiscoveryEvent,
  DiscoveryEventHandler,
  ScanConfigOverrides,
} from '../../src/types/index.js';
import { startHttpServer, type LocalTestServer } from '../helpers/server.js';

const openServers: LocalTestServer[] = [];

async function track(
  serverPromise: Promise<LocalTestServer>,
): Promise<LocalTestServer> {
  const server = await serverPromise;
  openServers.push(server);
  return server;
}

function html(
  response: Parameters<Parameters<typeof startHttpServer>[0]>[1],
  body: string,
): void {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(body);
}

function isApplicationPath(path: string): boolean {
  return path !== '/robots.txt' && path !== '/sitemap.xml';
}

async function discover(
  url: string,
  overrides: ScanConfigOverrides = {},
  onEvent?: DiscoveryEventHandler,
) {
  return discoverUrls(
    createTarget(url),
    createScanConfig({
      crawlDepth: 1,
      retries: 0,
      retryDelay: 0,
      ...overrides,
    }),
    onEvent === undefined ? {} : { onEvent },
  );
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe('URL discovery crawler', () => {
  it('emits request, response, and completion progress with useful fields', async () => {
    const events: DiscoveryEvent[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        html(
          response,
          request.url === '/' ? '<a href="/child">Child</a>' : '<html></html>',
        );
      }),
    );

    await discover(server.origin, {}, (event) => events.push(event));

    expect(events.find((event) => event.type === 'request-started')).toEqual({
      type: 'request-started',
      url: `${server.origin}/`,
      depth: 0,
      requestedCount: 1,
      discoveredCount: 1,
    });
    expect(
      events.find((event) => event.type === 'response-received'),
    ).toMatchObject({
      type: 'response-received',
      url: `${server.origin}/`,
      depth: 0,
      statusCode: 200,
      linksDiscovered: 1,
      requestedCount: 1,
      discoveredCount: 2,
    });
    const responseEvent = events.find(
      (event) => event.type === 'response-received',
    );
    expect(responseEvent?.type === 'response-received').toBe(true);
    if (responseEvent?.type !== 'response-received') {
      throw new Error('Expected a response-received event.');
    }
    expect(responseEvent.duration).toBeGreaterThanOrEqual(0);
    expect(events.at(-1)).toEqual({
      type: 'discovery-completed',
      requestedCount: 2,
      discoveredCount: 2,
      failedCount: 0,
    });
  });

  it('records the seed at depth 0 with null provenance', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        html(response, '<html></html>');
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 0 });

    expect(result.seed).toEqual({
      url: `${server.origin}/`,
      depth: 0,
      discoveredFrom: null,
      source: 'url',
      provenance: [],
    });
    expect(result.discoveredUrls[0]).toEqual(result.seed);
  });

  it('requests only the seed at depth 0', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        if (isApplicationPath(request.url ?? ''))
          requests.push(request.url ?? '');
        html(response, '<a href="/child">Child</a>');
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 0 });

    expect(requests).toEqual(['/']);
    expect(result.discoveredUrls).toHaveLength(1);
    expect(result.requestedCount).toBe(1);
  });

  it('discovers same-origin sitemap URLs through robots without external requests', async () => {
    const requests: string[] = [];
    const external = await track(
      startHttpServer(() => {
        throw new Error('external sitemap must not be requested');
      }),
    );
    const server = await track(
      startHttpServer((request, response) => {
        requests.push(request.url ?? '');
        if (request.url === '/robots.txt') {
          response.end(
            `Sitemap: /maps/index.xml\nSitemap: ${external.origin}/external.xml`,
          );
        } else if (request.url === '/maps/index.xml') {
          response.setHeader('content-type', 'application/xml');
          response.end(
            '<sitemapindex><sitemap><loc>/maps/pages.xml</loc></sitemap><sitemap><loc>/maps/index.xml</loc></sitemap></sitemapindex>',
          );
        } else if (request.url === '/maps/pages.xml') {
          response.setHeader('content-type', 'application/xml');
          response.end(
            '<urlset><url><loc>/from-sitemap?x=1#frag</loc></url><url><loc>/</loc></url></urlset>',
          );
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(requests).toContain('/robots.txt');
    expect(requests).toContain('/maps/index.xml');
    expect(requests).toContain('/maps/pages.xml');
    expect(requests).toContain('/from-sitemap?x=1');
    expect(result.discoveredUrls).toContainEqual({
      url: `${server.origin}/from-sitemap?x=1`,
      depth: 1,
      discoveredFrom: `${server.origin}/maps/pages.xml`,
      source: 'sitemap',
      provenance: [
        {
          source: 'sitemap',
          discoveredFrom: `${server.origin}/maps/pages.xml`,
          depth: 1,
        },
      ],
    });
    expect(
      result.endpoints?.find((endpoint) =>
        endpoint.url.endsWith('/from-sitemap?x=1'),
      )?.source,
    ).toBe('sitemap');
  });

  it('uses the same-origin sitemap fallback when robots has no directive', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/robots.txt') {
          response.end('User-agent: *\nDisallow: /private');
        } else if (request.url === '/sitemap.xml') {
          response.setHeader('content-type', 'application/xml');
          response.end('<urlset><url><loc>/fallback-page</loc></url></urlset>');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(result.discoveredUrls).toContainEqual({
      url: `${server.origin}/fallback-page`,
      depth: 1,
      discoveredFrom: `${server.origin}/sitemap.xml`,
      source: 'sitemap',
      provenance: [
        {
          source: 'sitemap',
          discoveredFrom: `${server.origin}/sitemap.xml`,
          depth: 1,
        },
      ],
    });
  });

  it('discovers forms passively without additional requests', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        if (isApplicationPath(request.url ?? ''))
          requests.push(request.url ?? '');
        html(
          response,
          '<form action="submit#fragment" method="post"><input name="email" required value="secret"></form>',
        );
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 0 });

    expect(requests).toEqual(['/']);
    expect(result.forms).toEqual([
      {
        action: `${server.origin}/submit`,
        method: 'POST',
        fields: [
          { name: 'email', type: 'input', attributes: { required: true } },
        ],
        provenance: [
          {
            source: 'form',
            discoveredFrom: `${server.origin}/`,
            depth: 0,
          },
        ],
      },
    ]);
    expect(result.endpoints).toHaveLength(2);
    expect(result.endpoints?.[0]).toMatchObject({
      url: `${server.origin}/`,
      method: 'GET',
      parameters: [],
      depth: 0,
      discoveredFrom: null,
      source: 'url',
    });
    expect(result.endpoints?.[0]?.requestFingerprint).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(result.endpoints?.[0]?.responseFingerprint).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(result.endpoints?.[1]).toEqual({
      url: `${server.origin}/submit`,
      method: 'POST',
      parameters: [{ name: 'email', source: 'form' }],
      depth: 0,
      discoveredFrom: `${server.origin}/`,
      source: 'form',
      provenance: [
        {
          source: 'form',
          discoveredFrom: `${server.origin}/`,
          depth: 0,
        },
      ],
    });
  });

  it('deduplicates identical forms globally while retaining provenance', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/') {
          html(
            response,
            '<a href="/child">Child</a><form action="/submit"><input name="q"></form><form action="/submit"><input name="q"></form>',
          );
          return;
        }
        html(response, '<form action="/submit"><input name="q"></form>');
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(result.forms).toHaveLength(1);
    expect(result.forms?.[0]?.action).toBe(`${server.origin}/submit`);
    expect(result.forms?.[0]?.provenance).toEqual([
      { source: 'form', discoveredFrom: `${server.origin}/`, depth: 0 },
      { source: 'form', discoveredFrom: `${server.origin}/child`, depth: 1 },
    ]);
    expect(
      result.endpoints?.filter((endpoint) => endpoint.url.endsWith('/submit')),
    ).toHaveLength(1);
  });

  it('deduplicates forms across repeated fetches of the same final page', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/') {
          html(response, '<a href="/one">One</a><a href="/two">Two</a>');
        } else if (request.url === '/one' || request.url === '/two') {
          response.writeHead(302, { location: '/shared' });
          response.end();
        } else {
          html(
            response,
            '<form action="/submit" method="post"><input name="q"></form>',
          );
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(result.forms).toHaveLength(1);
    expect(result.forms?.[0]).toEqual({
      action: `${server.origin}/submit`,
      method: 'POST',
      fields: [{ name: 'q', type: 'input', attributes: {} }],
      provenance: [
        {
          source: 'form',
          discoveredFrom: `${server.origin}/shared`,
          depth: 1,
        },
      ],
    });
  });

  it('uses one deterministic provenance model across URLs, forms, and endpoints', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/') {
          html(
            response,
            '<a href="/shared?value=first">Shared</a><a href="/page-a">A</a><a href="/page-b">B</a><form action="/submit"><input name="q"></form>',
          );
        } else if (request.url === '/page-a') {
          html(
            response,
            '<a href="/shared?value=first">Shared</a><form action="/submit"><input name="q"></form>',
          );
        } else if (request.url === '/page-b') {
          html(response, '<a href="/shared?value=first">Shared</a>');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 2 });
    const sharedUrl = result.discoveredUrls.find((item) =>
      item.url.endsWith('/shared?value=first'),
    );
    const sharedEndpoint = result.endpoints?.find((item) =>
      item.url.endsWith('/shared?value=first'),
    );
    const form = result.forms?.find((item) => item.action.endsWith('/submit'));
    const formEndpoint = result.endpoints?.find((item) =>
      item.url.endsWith('/submit'),
    );
    const urlProvenance = [
      { source: 'url', discoveredFrom: `${server.origin}/`, depth: 1 },
      { source: 'url', discoveredFrom: `${server.origin}/page-a`, depth: 2 },
      { source: 'url', discoveredFrom: `${server.origin}/page-b`, depth: 2 },
    ];
    const formProvenance = [
      { source: 'form', discoveredFrom: `${server.origin}/`, depth: 0 },
      {
        source: 'form',
        discoveredFrom: `${server.origin}/page-a`,
        depth: 1,
      },
    ];

    expect(sharedUrl).toMatchObject({
      url: `${server.origin}/shared?value=first`,
      depth: 1,
      discoveredFrom: `${server.origin}/`,
      source: 'url',
      provenance: urlProvenance,
    });
    expect(sharedEndpoint).toMatchObject({
      depth: 1,
      discoveredFrom: `${server.origin}/`,
      source: 'url',
      provenance: urlProvenance,
    });
    expect(form?.provenance).toEqual(formProvenance);
    expect(formEndpoint).toMatchObject({
      depth: 0,
      discoveredFrom: `${server.origin}/`,
      source: 'form',
      provenance: formProvenance,
    });

    const allProvenance = [
      ...(sharedUrl?.provenance ?? []),
      ...(sharedEndpoint?.provenance ?? []),
      ...(form?.provenance ?? []),
      ...(formEndpoint?.provenance ?? []),
    ];
    expect(
      allProvenance.every((item) => URL.canParse(item.discoveredFrom)),
    ).toBe(true);
    expect(sharedUrl?.provenance).toHaveLength(3);
    expect(form?.provenance).toHaveLength(2);
  });

  it('discovers and requests direct links at depth 1', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);
        html(
          response,
          path === '/'
            ? '<a href="/one">One</a><a href="two">Two</a>'
            : '<html></html>',
        );
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(requests).toEqual(['/', '/one', '/two']);
    expect(result.discoveredUrls.map((item) => item.depth)).toEqual([0, 1, 1]);
    expect(result.requestedCount).toBe(3);
  });

  it('discovers second-level links at depth 2', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);

        if (path === '/') {
          html(response, '<a href="/level-one">One</a>');
        } else if (path === '/level-one') {
          html(response, '<a href="/level-two">Two</a>');
        } else {
          html(response, '<a href="/too-deep">Too deep</a>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 2 });

    expect(requests).toEqual(['/', '/level-one', '/level-two']);
    expect(result.discoveredUrls.at(-1)).toMatchObject({
      url: `${server.origin}/level-two`,
      depth: 2,
    });
  });

  it('requests normalized duplicate URLs only once', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);
        html(
          response,
          path === '/'
            ? '<a href="/same">A</a><a href="/same#one">B</a><a href="./same">C</a>'
            : '<html></html>',
        );
      }),
    );

    const result = await discover(server.origin);

    expect(requests).toEqual(['/', '/same']);
    expect(result.discoveredUrls).toHaveLength(2);
  });

  it('fetches unique same-origin scripts and discovers normalized endpoints', async () => {
    const requests: string[] = [];
    let externalRequests = 0;
    const external = await track(
      startHttpServer((_request, response) => {
        externalRequests += 1;
        response.end('const endpoint = "/external";');
      }),
    );
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        requests.push(path);
        if (path === '/') {
          html(
            response,
            `<script src="assets/app.js"></script><script src="/root.js"></script><script src="assets/app.js#duplicate"></script><script src="?bundle=1"></script><script src="${external.origin}/outside.js"></script>`,
          );
        } else if (path === '/assets/app.js') {
          response.setHeader('content-type', 'application/javascript');
          response.end(
            `const values = ['/api/root', '../api/relative', 'api/local', '${server.origin}/absolute', '${external.origin}/blocked'];`,
          );
        } else if (path === '/root.js') {
          response.setHeader('content-type', 'text/javascript');
          response.end('const endpoint = "/api/from-root";');
        } else if (path === '/?bundle=1') {
          response.setHeader('content-type', 'text/plain');
          response.end('const endpoint = "/api/from-query";');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(requests.filter((path) => path === '/assets/app.js')).toHaveLength(
      1,
    );
    expect(requests).toContain('/root.js');
    expect(requests).toContain('/?bundle=1');
    expect(externalRequests).toBe(0);
    expect(
      result.discoveredUrls.slice(1).map((item) => ({
        url: item.url,
        depth: item.depth,
        discoveredFrom: item.discoveredFrom,
        source: item.source,
      })),
    ).toEqual([
      {
        url: `${server.origin}/api/root`,
        depth: 1,
        discoveredFrom: `${server.origin}/assets/app.js`,
        source: 'javascript',
      },
      {
        url: `${server.origin}/api/relative`,
        depth: 1,
        discoveredFrom: `${server.origin}/assets/app.js`,
        source: 'javascript',
      },
      {
        url: `${server.origin}/assets/api/local`,
        depth: 1,
        discoveredFrom: `${server.origin}/assets/app.js`,
        source: 'javascript',
      },
      {
        url: `${server.origin}/absolute`,
        depth: 1,
        discoveredFrom: `${server.origin}/assets/app.js`,
        source: 'javascript',
      },
      {
        url: `${server.origin}/api/from-root`,
        depth: 1,
        discoveredFrom: `${server.origin}/root.js`,
        source: 'javascript',
      },
      {
        url: `${server.origin}/api/from-query`,
        depth: 1,
        discoveredFrom: `${server.origin}/?bundle=1`,
        source: 'javascript',
      },
    ]);
    expect(
      result.endpoints?.slice(1).map((endpoint) => endpoint.source),
    ).toEqual(Array(6).fill('javascript'));
    for (const item of result.discoveredUrls.slice(1)) {
      expect(item.provenance).toEqual([
        {
          source: item.source,
          discoveredFrom: item.discoveredFrom,
          depth: item.depth,
        },
      ]);
    }
  });

  it('merges JavaScript provenance without repeating a canonical request', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        requests.push(path);
        if (path === '/') {
          html(
            response,
            '<a href="/existing">Existing</a><a href="/page">Page</a>',
          );
        } else if (path === '/page') {
          html(response, '<script src="/page.js"></script>');
        } else if (path === '/page.js') {
          response.setHeader('content-type', 'application/javascript');
          response.end('const one = "/existing"; const two = "/existing#x";');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 2 });

    expect(requests.filter((path) => path === '/existing')).toHaveLength(1);
    expect(
      result.discoveredUrls.find((item) => item.url.endsWith('/existing')),
    ).toMatchObject({
      source: 'url',
      provenance: [
        {
          source: 'url',
          discoveredFrom: `${server.origin}/`,
          depth: 1,
        },
        {
          source: 'javascript',
          discoveredFrom: `${server.origin}/page.js`,
          depth: 2,
        },
      ],
    });
  });

  it('ignores declared non-JavaScript and malformed script text safely', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        requests.push(path);
        if (path === '/') {
          html(
            response,
            '<script src="/not-js.js"></script><script src="/malformed.js"></script>',
          );
        } else if (path === '/not-js.js') {
          html(response, '<div>"/must-not-be-discovered"</div>');
        } else if (path === '/malformed.js') {
          response.setHeader('content-type', 'application/javascript');
          response.end('const broken = "');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 1 });

    expect(requests).toContain('/not-js.js');
    expect(requests).toContain('/malformed.js');
    expect(result.discoveredUrls).toHaveLength(1);
  });

  it('keeps distinct query values as distinct targets', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        if (isApplicationPath(request.url ?? ''))
          requests.push(request.url ?? '');
        html(
          response,
          request.url === '/'
            ? '<a href="/search?q=cat">Cat</a><a href="/search?q=dog">Dog</a>'
            : '<html></html>',
        );
      }),
    );

    await discover(server.origin);

    expect(requests).toEqual(['/', '/search?q=cat', '/search?q=dog']);
  });

  it('extracts links only from declared HTML responses', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);

        if (path === '/') {
          html(response, '<a href="/html">HTML</a><a href="/plain">Plain</a>');
        } else if (path === '/html') {
          html(response, '<a href="/from-html">Allowed</a>');
        } else if (path === '/plain') {
          response.setHeader('content-type', 'text/plain');
          response.end('<html><a href="/from-plain">Blocked</a></html>');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    await discover(server.origin, { crawlDepth: 2 });

    expect(requests).toContain('/from-html');
    expect(requests).not.toContain('/from-plain');
  });

  it('uses a conservative HTML document fallback when Content-Type is missing', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);

        if (path === '/') {
          response.end('<!doctype html><a href="/fallback">Fallback</a>');
        } else {
          response.end('plain text <a href="/ignored">Ignored</a>');
        }
      }),
    );

    await discover(server.origin, { crawlDepth: 2 });

    expect(requests).toEqual(['/', '/fallback']);
  });

  it('uses the redirect final URL as the relative-link base and provenance', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);

        if (path === '/start') {
          response.writeHead(302, { location: '/folder/index' });
          response.end();
        } else if (path === '/folder/index') {
          html(response, '<a href="child">Child</a>');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(`${server.origin}/start`);

    expect(requests).toEqual(['/start', '/folder/index', '/folder/child']);
    expect(result.discoveredUrls[1]).toEqual({
      url: `${server.origin}/folder/child`,
      depth: 1,
      discoveredFrom: `${server.origin}/folder/index`,
      source: 'url',
      provenance: [
        {
          source: 'url',
          discoveredFrom: `${server.origin}/folder/index`,
          depth: 1,
        },
      ],
    });
  });

  it('keeps redirect aliases out of canonical records while preserving safe identity data', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/start?seed=7') {
          const host = request.headers.host;
          if (host === undefined) {
            response.destroy(new Error('Missing Host header.'));
            return;
          }
          response.writeHead(302, {
            location: `http://user:secret@${host}/middle?item=42`,
          });
          response.end();
        } else if (request.url === '/middle?item=42') {
          response.writeHead(301, { location: '/final?item=42' });
          response.end();
        } else if (request.url === '/final?item=42') {
          html(response, '<a href="child?item=42">Child</a>');
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(
      `http://input:password@${new URL(server.origin).host}/start?seed=7`,
    );
    const inventory = createSecurityTargetInventory(result);
    const serialized = JSON.stringify({ result, inventory });

    expect(result.discoveredUrls.map((item) => item.url)).toEqual([
      `${server.origin}/start?seed=7`,
      `${server.origin}/child?item=42`,
    ]);
    expect(result.endpoints?.map((item) => item.url)).toEqual([
      `${server.origin}/start?seed=7`,
      `${server.origin}/child?item=42`,
    ]);
    expect(inventory.map((item) => item.url)).toEqual([
      `${server.origin}/start?seed=7`,
      `${server.origin}/child?item=42`,
    ]);
    expect(result.discoveredUrls[1]?.provenance).toEqual([
      {
        source: 'url',
        discoveredFrom: `${server.origin}/final?item=42`,
        depth: 1,
      },
    ]);
    expect(result.endpoints?.[0]?.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('password');
  });

  it('accepts same-origin links and rejects cross-origin links', async () => {
    let externalRequests = 0;
    const external = await track(
      startHttpServer((_request, response) => {
        externalRequests += 1;
        response.end();
      }),
    );
    const server = await track(
      startHttpServer((request, response) => {
        html(
          response,
          request.url === '/'
            ? `<a href="/inside">Inside</a><a href="${external.origin}/outside">Outside</a>`
            : '<html></html>',
        );
      }),
    );

    const result = await discover(server.origin);

    expect(result.discoveredUrls.map((item) => item.url)).toEqual([
      `${server.origin}/`,
      `${server.origin}/inside`,
    ]);
    expect(externalRequests).toBe(0);
  });

  it('does not follow a redirect outside the seed origin', async () => {
    let externalRequests = 0;
    const external = await track(
      startHttpServer((_request, response) => {
        externalRequests += 1;
        response.end();
      }),
    );
    const server = await track(
      startHttpServer((_request, response) => {
        response.writeHead(302, { location: `${external.origin}/outside` });
        response.end();
      }),
    );

    const result = await discover(server.origin);

    expect(result.requestedCount).toBe(1);
    expect(externalRequests).toBe(0);
  });

  it('does not follow a redirect to a URL that was already requested', async () => {
    let destinationRequests = 0;
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/') {
          html(
            response,
            '<a href="/destination">Destination</a><a href="/redirect">Redirect</a>',
          );
          return;
        }

        if (request.url === '/redirect') {
          response.writeHead(302, { location: '/destination' });
          response.end();
          return;
        }

        if (isApplicationPath(request.url ?? '')) destinationRequests += 1;
        html(response, '<html></html>');
      }),
    );

    await discover(server.origin);

    expect(destinationRequests).toBe(1);
  });

  it('skips unsupported links and static resources before enqueueing', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        if (isApplicationPath(request.url ?? ''))
          requests.push(request.url ?? '');
        html(
          response,
          request.url === '/'
            ? '<a href="mailto:a@example.com">Mail</a><a href="javascript:void(0)">JS</a><a href="/image.PNG">Image</a><a href="/page">Page</a>'
            : '<html></html>',
        );
      }),
    );

    await discover(server.origin);

    expect(requests).toEqual(['/', '/page']);
  });

  it('respects requestDelay between discovery requests', async () => {
    const requestTimes: number[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        if (isApplicationPath(request.url ?? ''))
          requestTimes.push(performance.now());
        html(
          response,
          request.url === '/' ? '<a href="/next">Next</a>' : '<html></html>',
        );
      }),
    );

    await discover(server.origin, { requestDelay: 40 });

    expect(requestTimes).toHaveLength(2);
    const [firstRequest, secondRequest] = requestTimes;
    if (firstRequest === undefined || secondRequest === undefined) {
      throw new Error('Expected two request timestamps.');
    }
    expect(secondRequest - firstRequest).toBeGreaterThanOrEqual(30);
  });

  it('records a failed child and continues the FIFO queue', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        if (isApplicationPath(path)) requests.push(path);

        if (path === '/') {
          html(
            response,
            '<a href="/failure">Failure</a><a href="/success">Success</a>',
          );
        } else if (path === '/failure') {
          request.socket.destroy();
        } else {
          html(response, '<html></html>');
        }
      }),
    );

    const result = await discover(server.origin);

    expect(requests).toEqual(['/', '/failure', '/success']);
    expect(result.failedUrls).toHaveLength(1);
    expect(result.failedUrls[0]?.target.url).toBe(`${server.origin}/failure`);
    expect(result.requestedCount).toBe(3);
  });
});
