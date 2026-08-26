import { afterEach, describe, expect, it } from 'vitest';

import { createScanConfig } from '../../src/core/index.js';
import {
  createHttpClient,
  HttpError,
  type HttpRequest,
} from '../../src/http/index.js';
import type { ScanConfigOverrides } from '../../src/types/index.js';
import {
  startHttpServer,
  startHttpsServer,
  type LocalTestServer,
} from '../helpers/server.js';

const openServers: LocalTestServer[] = [];

async function track(
  serverPromise: Promise<LocalTestServer>,
): Promise<LocalTestServer> {
  const server = await serverPromise;
  openServers.push(server);
  return server;
}

async function get(
  url: string,
  configOverrides: ScanConfigOverrides = {},
  requestOverrides: Partial<HttpRequest> = {},
) {
  const client = createHttpClient(
    createScanConfig({ retries: 0, ...configOverrides }),
  );

  return client.request({
    method: 'GET',
    url: new URL(url),
    headers: {},
    ...requestOverrides,
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe('HTTP client', () => {
  it('performs a successful HTTP request', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.end('ok');
      }),
    );

    const response = await get(server.origin);

    expect(response.requestedUrl).toBe(`${server.origin}/`);
    expect(response.finalUrl).toBe(`${server.origin}/`);
  });

  it('performs a successful HTTPS request when verification is explicitly disabled', async () => {
    const server = await track(
      startHttpsServer((_request, response) => {
        response.end('secure');
      }),
    );

    const response = await get(server.origin, { verifyTLS: false });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('secure');
  });

  it('preserves the response status code and message', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.statusCode = 201;
        response.statusMessage = 'Created for test';
        response.end();
      }),
    );

    const response = await get(server.origin);

    expect(response.statusCode).toBe(201);
    expect(response.statusMessage).toBe('Created for test');
  });

  it('normalizes response headers and preserves duplicate values', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.setHeader('X-Test', 'value');
        response.setHeader('Set-Cookie', ['first=1', 'second=2']);
        response.end();
      }),
    );

    const response = await get(server.origin);

    expect(response.headers['x-test']).toEqual(['value']);
    expect(response.headers['set-cookie']).toEqual(['first=1', 'second=2']);
  });

  it('collects the response body as text', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.end('SVFT response body');
      }),
    );

    const response = await get(server.origin);

    expect(response.body).toBe('SVFT response body');
  });

  it('measures total response time with a monotonic timer', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        setTimeout(() => response.end('delayed'), 25);
      }),
    );

    const response = await get(server.origin);

    expect(response.responseTime).toBeGreaterThanOrEqual(15);
    expect(response.responseTime).toBeLessThan(1_000);
  });

  it('applies the configured user agent', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        response.end(request.headers['user-agent']);
      }),
    );

    const response = await get(server.origin, { userAgent: 'SVFT-Test/1.0' });

    expect(response.body).toBe('SVFT-Test/1.0');
  });

  it('applies config headers with deterministic request-header precedence', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            config: request.headers['x-config'],
            precedence: request.headers['x-precedence'],
            userAgent: request.headers['user-agent'],
          }),
        );
      }),
    );

    const response = await get(
      server.origin,
      {
        userAgent: 'Config-Agent/1.0',
        headers: {
          'X-Config': 'configured',
          'X-Precedence': 'config',
          'User-Agent': 'ignored-config-header-agent',
        },
      },
      {
        headers: {
          'X-Precedence': 'request',
          'User-Agent': 'Request-Agent/1.0',
        },
      },
    );

    expect(JSON.parse(response.body)).toEqual({
      config: 'configured',
      precedence: 'request',
      userAgent: 'Request-Agent/1.0',
    });
  });

  it('returns an identifiable timeout error', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.writeHead(200);
        response.write('partial body');
      }),
    );

    await expect(get(server.origin, { timeout: 25 })).rejects.toMatchObject({
      code: 'TIMEOUT',
      url: `${server.origin}/`,
    });
  });

  it('returns an identifiable connection failure', async () => {
    const server = await startHttpServer((_request, response) => {
      response.end();
    });
    const unavailableOrigin = server.origin;
    await server.close();

    await expect(get(unavailableOrigin)).rejects.toMatchObject({
      code: 'CONNECTION_FAILURE',
    });
  });

  it('follows a redirect when enabled', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/start') {
          response.writeHead(302, { location: '/final' });
          response.end();
          return;
        }

        response.end('redirected');
      }),
    );

    const response = await get(`${server.origin}/start`);

    expect(response.finalUrl).toBe(`${server.origin}/final`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('redirected');
  });

  it('returns the original redirect response when following is disabled', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.writeHead(302, { location: '/final' });
        response.end('not followed');
      }),
    );

    const response = await get(`${server.origin}/start`, {
      followRedirects: false,
    });

    expect(response.statusCode).toBe(302);
    expect(response.finalUrl).toBe(`${server.origin}/start`);
    expect(response.redirectChain).toEqual([]);
    expect(response.body).toBe('not followed');
  });

  it('records every followed redirect in order', async () => {
    const server = await track(
      startHttpServer((request, response) => {
        if (request.url === '/one') {
          response.writeHead(301, { location: '/two' });
          response.end();
          return;
        }

        if (request.url === '/two') {
          response.writeHead(308, { location: '/three' });
          response.end();
          return;
        }

        response.end('done');
      }),
    );

    const response = await get(`${server.origin}/one`);

    expect(response.redirectChain).toEqual([
      {
        fromUrl: `${server.origin}/one`,
        toUrl: `${server.origin}/two`,
        statusCode: 301,
      },
      {
        fromUrl: `${server.origin}/two`,
        toUrl: `${server.origin}/three`,
        statusCode: 308,
      },
    ]);
  });

  it('stops when the maximum redirect count is exceeded', async () => {
    const server = await track(
      startHttpServer((_request, response) => {
        response.writeHead(302, { location: '/loop' });
        response.end();
      }),
    );

    await expect(
      get(`${server.origin}/loop`, { maxRedirects: 1 }),
    ).rejects.toMatchObject({
      code: 'REDIRECT_LIMIT_EXCEEDED',
    });
  });

  it('enforces TLS verification by default without changing global TLS settings', async () => {
    const server = await track(
      startHttpsServer((_request, response) => {
        response.end('secure');
      }),
    );

    await expect(get(server.origin)).rejects.toMatchObject({
      code: 'TLS_FAILURE',
    });
  });

  it('retries a GET after a transient transport failure', async () => {
    let attempts = 0;
    const server = await track(
      startHttpServer((request, response) => {
        attempts += 1;

        if (attempts === 1) {
          request.socket.destroy();
          return;
        }

        response.end('recovered');
      }),
    );

    const response = await get(server.origin, {
      retries: 1,
      retryDelay: 0,
    });

    expect(response.body).toBe('recovered');
    expect(attempts).toBe(2);
  });

  it('does not retry a normal 4xx response', async () => {
    let attempts = 0;
    const server = await track(
      startHttpServer((_request, response) => {
        attempts += 1;
        response.statusCode = 404;
        response.end('not found');
      }),
    );

    const response = await get(server.origin, { retries: 3 });

    expect(response.statusCode).toBe(404);
    expect(attempts).toBe(1);
  });

  it('rejects unsupported protocols before transport', async () => {
    await expect(get('ftp://example.com/file')).rejects.toMatchObject({
      code: 'UNSUPPORTED_PROTOCOL',
      url: 'ftp://example.com/file',
    });
  });

  it('rejects invalid request methods before transport', async () => {
    await expect(
      get(
        'http://127.0.0.1/',
        {},
        { method: 'TRACE' as HttpRequest['method'] },
      ),
    ).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('propagates an abort as a structured error without retrying', async () => {
    let attempts = 0;
    const server = await track(
      startHttpServer(() => {
        attempts += 1;
      }),
    );
    const controller = new AbortController();
    const abortTimer = setTimeout(() => {
      controller.abort('test abort');
    }, 20);

    try {
      await expect(
        get(
          server.origin,
          { retries: 2, timeout: 500 },
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({
        code: 'ABORTED',
      });
      expect(attempts).toBe(1);
    } finally {
      clearTimeout(abortTimer);
    }
  });

  it('uses the public HttpError model for request failures', async () => {
    try {
      await get('mailto:test@example.com');
      throw new Error('Expected an unsupported protocol error.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).cause).toBeUndefined();
    }
  });
});
