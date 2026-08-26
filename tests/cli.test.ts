import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeCli } from '../src/cli/program.js';
import { startHttpServer, type LocalTestServer } from './helpers/server.js';

const openServers: LocalTestServer[] = [];
let workingDirectory: string;

async function runCli(
  argv: readonly string[],
  output: Parameters<typeof executeCli>[1],
): Promise<number> {
  return executeCli(argv, output, { workingDirectory });
}

function captureOutput(): {
  readonly output: {
    stdout: (message: string) => void;
    stderr: (message: string) => void;
  };
  readonly stdout: string[];
  readonly stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    output: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    stdout,
    stderr,
  };
}

async function track(
  serverPromise: Promise<LocalTestServer>,
): Promise<LocalTestServer> {
  const server = await serverPromise;
  openServers.push(server);
  return server;
}

beforeEach(async () => {
  workingDirectory = await mkdtemp(join(tmpdir(), 'svft-cli-'));
});

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  await rm(workingDirectory, { recursive: true, force: true });
});

describe('target check command', () => {
  it('prints a normalized valid target without making a request', async () => {
    let requests = 0;
    const server = await track(
      startHttpServer((_request, response) => {
        requests += 1;
        response.end();
      }),
    );
    const capture = captureOutput();

    const exitCode = await runCli(
      ['target', 'check', `${server.origin}/path#fragment`],
      capture.output,
    );

    expect(exitCode).toBe(0);
    expect(capture.stdout.join('')).toBe(
      `Valid target: ${server.origin}/path\n`,
    );
    expect(capture.stderr).toHaveLength(0);
    expect(requests).toBe(0);
    expect(await readdir(workingDirectory)).toEqual([]);
  });

  it('reports an invalid target without scanning it', async () => {
    const capture = captureOutput();

    const exitCode = await runCli(
      ['target', 'check', 'not-a-url'],
      capture.output,
    );

    expect(exitCode).toBe(1);
    expect(capture.stdout).toHaveLength(0);
    expect(capture.stderr.join('')).toContain('Error: Invalid target URL.');
  });
});

describe('scan command discovery integration', () => {
  it('requests the seed and prints a concise discovery summary', async () => {
    let requests = 0;
    const server = await track(
      startHttpServer((_request, response) => {
        requests += 1;
        response.statusCode = 200;
        response.end('hello');
      }),
    );
    const capture = captureOutput();

    const exitCode = await runCli(['scan', server.origin], capture.output);

    const result = capture.stdout.join('');
    expect(exitCode).toBe(0);
    expect(requests).toBe(1);
    expect(result).toContain('SVFT — Security Vulnerability Finding Tool');
    expect(result).toContain('Version 0.1.0');
    expect(result).toContain(`Target: ${server.origin}/`);
    expect(result).toContain('Depth: 0');
    expect(result).toContain('Scanning · 1 requested · 0 queued · 0 failed');
    expect(result).toContain('✓ Scan complete');
    expect(result).toContain('URLs discovered: 1');
    expect(result).toContain('URLs requested: 1');
    expect(result).toContain('Failed: 0');
    expect(result).not.toContain('Discovered URLs:');
    expect(result).toMatch(/Result:\nsvft-results\/scan-[0-9a-f-]{36}\.json/);
    const resultDirectory = join(workingDirectory, 'svft-results');
    const [resultFile] = await readdir(resultDirectory);
    expect(resultFile).toMatch(/^scan-[0-9a-f-]{36}\.json$/);
    if (resultFile === undefined) {
      throw new Error('Expected a JSON result file.');
    }
    const persisted = JSON.parse(
      await readFile(join(resultDirectory, resultFile), 'utf8'),
    ) as { target?: unknown; configuration?: unknown; discovery?: unknown };
    expect(persisted.target).toBe(`${server.origin}/`);
    expect(persisted.configuration).toBeDefined();
    expect(persisted.discovery).toBeDefined();
    expect(capture.stderr).toHaveLength(0);
  });

  it('applies CLI configuration overrides to the request', async () => {
    let receivedUserAgent: string | undefined;
    const server = await track(
      startHttpServer((request, response) => {
        receivedUserAgent = request.headers['user-agent'];
        response.end('configured');
      }),
    );
    const capture = captureOutput();

    const exitCode = await runCli(
      [
        'scan',
        server.origin,
        '--timeout',
        '2500',
        '--retries',
        '0',
        '--retry-delay',
        '0',
        '--no-follow-redirects',
        '--max-redirects',
        '8',
        '--concurrency',
        '3',
        '--depth',
        '2',
        '--request-delay',
        '100',
        '--no-verify-tls',
        '--user-agent',
        'SVFT-Test/1.0',
      ],
      capture.output,
    );

    expect(exitCode).toBe(0);
    expect(receivedUserAgent).toBe('SVFT-Test/1.0');
    expect(capture.stderr).toHaveLength(0);
  });

  it('returns exit code 1 without requesting when configuration is invalid', async () => {
    let requests = 0;
    const server = await track(
      startHttpServer((_request, response) => {
        requests += 1;
        response.end();
      }),
    );
    const capture = captureOutput();

    const exitCode = await runCli(
      ['scan', server.origin, '--timeout', '0'],
      capture.output,
    );

    expect(exitCode).toBe(1);
    expect(requests).toBe(0);
    expect(capture.stdout).toHaveLength(0);
    expect(capture.stderr.join('')).toBe(
      'Error: timeout must be a positive integer.\n',
    );
  });

  it('prints a structured HTTP connection failure', async () => {
    const server = await startHttpServer((_request, response) => {
      response.end();
    });
    const unavailableOrigin = server.origin;
    await server.close();
    const capture = captureOutput();

    const exitCode = await runCli(
      ['scan', unavailableOrigin, '--retries', '0'],
      capture.output,
    );

    expect(exitCode).toBe(1);
    expect(capture.stdout.join('')).toContain('Scanning · 1 requested');
    expect(capture.stderr.join('')).toContain(
      'HTTP error [CONNECTION_FAILURE]',
    );
    expect(await readdir(workingDirectory)).toEqual([]);
  });

  it('applies timeout configuration to the initial request', async () => {
    const server = await track(startHttpServer(() => undefined));
    const capture = captureOutput();

    const exitCode = await runCli(
      ['scan', server.origin, '--timeout', '25', '--retries', '0'],
      capture.output,
    );

    expect(exitCode).toBe(1);
    expect(capture.stdout.join('')).toContain('Scanning · 1 requested');
    expect(capture.stderr.join('')).toContain('HTTP error [TIMEOUT]');
    expect(await readdir(workingDirectory)).toEqual([]);
  });

  it('reports followed and disabled redirect behavior', async () => {
    const requestedPaths: string[] = [];
    const server = await track(
      startHttpServer((request, response) => {
        requestedPaths.push(request.url ?? '');
        if (request.url === '/start') {
          response.writeHead(302, { location: '/final' });
          response.end();
          return;
        }

        response.end('final');
      }),
    );
    const followed = captureOutput();
    const disabled = captureOutput();

    const followedCode = await runCli(
      ['scan', `${server.origin}/start`],
      followed.output,
    );
    const followedPaths = requestedPaths.splice(0);
    const disabledCode = await runCli(
      ['scan', `${server.origin}/start`, '--no-follow-redirects'],
      disabled.output,
    );

    expect(followedCode).toBe(0);
    expect(followedPaths).toEqual(['/start', '/final']);
    expect(followed.stdout.join('')).toContain('URLs requested: 1');
    expect(disabledCode).toBe(0);
    expect(requestedPaths).toEqual(['/start']);
    expect(disabled.stdout.join('')).toContain('URLs requested: 1');
  });
});
