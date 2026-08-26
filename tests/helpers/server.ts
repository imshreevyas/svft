import { readFile } from 'node:fs/promises';
import {
  createServer as createHttpServer,
  type RequestListener,
  type Server as HttpServer,
} from 'node:http';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from 'node:https';

type LocalServerInstance = HttpServer | HttpsServer;

export interface LocalTestServer {
  readonly origin: string;
  readonly close: () => Promise<void>;
}

async function listen(
  server: LocalServerInstance,
  protocol: 'http' | 'https',
): Promise<LocalTestServer> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Local test server did not bind to a TCP port.');
  }

  return {
    origin: `${protocol}://127.0.0.1:${String(address.port)}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
  };
}

export async function startHttpServer(
  listener: RequestListener,
): Promise<LocalTestServer> {
  return listen(createHttpServer(listener), 'http');
}

export async function startHttpsServer(
  listener: RequestListener,
): Promise<LocalTestServer> {
  const [cert, key] = await Promise.all([
    readFile(new URL('../fixtures/localhost-cert.pem', import.meta.url)),
    readFile(new URL('../fixtures/localhost-key.pem', import.meta.url)),
  ]);

  return listen(createHttpsServer({ cert, key }, listener), 'https');
}
