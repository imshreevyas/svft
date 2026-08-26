import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

import { createScanConfig, createTarget } from '../../src/core/index.js';
import { discoverUrls } from '../../src/discovery/index.js';
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
    });
    expect(result.discoveredUrls[0]).toEqual(result.seed);
  });

  it('requests only the seed at depth 0', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        requests.push(request.url ?? '');
        html(response, '<a href="/child">Child</a>');
      }),
    );

    const result = await discover(server.origin, { crawlDepth: 0 });

    expect(requests).toEqual(['/']);
    expect(result.discoveredUrls).toHaveLength(1);
    expect(result.requestedCount).toBe(1);
  });

  it('discovers and requests direct links at depth 1', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        const path = request.url ?? '';
        requests.push(path);
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
        requests.push(path);

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
        requests.push(path);
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

  it('keeps distinct query values as distinct targets', async () => {
    const requests: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
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
        requests.push(path);

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
        requests.push(path);

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
        requests.push(path);

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
    });
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

        destinationRequests += 1;
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
        requests.push(path);

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
