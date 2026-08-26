import { Command, CommanderError, InvalidArgumentError } from 'commander';

import {
  InvalidScanConfigError,
  createScanConfig,
  createTarget,
  InvalidTargetError,
} from '../core/index.js';
import { discoverUrls } from '../discovery/index.js';
import { HttpError } from '../http/index.js';
import {
  createScanResult,
  ResultWriteError,
  writeScanResult,
} from '../results/index.js';
import { createScanContext } from '../scanner/index.js';
import type { ScanConfigOverrides, ScanContext } from '../types/index.js';
import { createProgressPresenter } from './progress.js';

export const VERSION = '0.1.0';

export interface CliOutput {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
  readonly isTTY?: boolean;
}

export interface CliRuntime {
  readonly workingDirectory?: string;
}

interface ScanCommandOptions {
  readonly timeout?: number;
  readonly retries?: number;
  readonly retryDelay?: number;
  readonly followRedirects?: boolean;
  readonly maxRedirects?: number;
  readonly concurrency?: number;
  readonly depth?: number;
  readonly requestDelay?: number;
  readonly verifyTls?: boolean;
  readonly userAgent?: string;
}

function parseInteger(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new InvalidArgumentError('Must be an integer.');
  }

  return Number(value);
}

function configOverridesFrom(
  options: ScanCommandOptions,
  command: Command,
): ScanConfigOverrides {
  return {
    ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    ...(options.retries === undefined ? {} : { retries: options.retries }),
    ...(options.retryDelay === undefined
      ? {}
      : { retryDelay: options.retryDelay }),
    ...(options.followRedirects === undefined
      ? {}
      : { followRedirects: options.followRedirects }),
    ...(options.maxRedirects === undefined
      ? {}
      : { maxRedirects: options.maxRedirects }),
    ...(options.concurrency === undefined
      ? {}
      : { concurrency: options.concurrency }),
    ...(options.depth === undefined ? {} : { crawlDepth: options.depth }),
    ...(options.requestDelay === undefined
      ? {}
      : { requestDelay: options.requestDelay }),
    ...(command.getOptionValueSource('verifyTls') === 'cli'
      ? { verifyTLS: options.verifyTls }
      : {}),
    ...(options.userAgent === undefined
      ? {}
      : { userAgent: options.userAgent }),
  };
}

function formatScanStart(context: ScanContext): string {
  return (
    `SVFT — Security Vulnerability Finding Tool\nVersion ${VERSION}\n\n` +
    `Target: ${context.target.normalizedUrl}\n` +
    `Depth: ${String(context.config.crawlDepth)}\n\n`
  );
}

export function createProgram(
  output: CliOutput,
  runtime: CliRuntime = {},
): Command {
  const program = new Command();

  program
    .name('svft')
    .description('A simple, CLI-first web VAPT scanner')
    .version(VERSION)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: output.stdout,
      writeErr: output.stderr,
    });

  program
    .command('scan')
    .description('Discover same-origin URLs from a target')
    .argument('<url>', 'HTTP or HTTPS target URL')
    .option('--timeout <ms>', 'request timeout in milliseconds', parseInteger)
    .option('--retries <count>', 'number of retry attempts', parseInteger)
    .option(
      '--retry-delay <ms>',
      'delay between retries in milliseconds',
      parseInteger,
    )
    .option('--follow-redirects', 'follow HTTP redirects')
    .option('--no-follow-redirects', 'do not follow HTTP redirects')
    .option(
      '--max-redirects <count>',
      'maximum number of redirects',
      parseInteger,
    )
    .option(
      '--concurrency <count>',
      'configured request concurrency',
      parseInteger,
    )
    .option('--depth <count>', 'maximum link discovery depth', parseInteger)
    .option(
      '--request-delay <ms>',
      'delay between discovery requests in milliseconds',
      parseInteger,
    )
    .option('--no-verify-tls', 'disable TLS certificate verification')
    .option('--user-agent <value>', 'user agent for requests')
    .action(
      async (
        inputUrl: string,
        options: ScanCommandOptions,
        command: Command,
      ) => {
        const target = createTarget(inputUrl);
        const config = createScanConfig(configOverridesFrom(options, command));
        const context = createScanContext(target, config);
        output.stdout(formatScanStart(context));
        const progress = createProgressPresenter({
          write: output.stdout,
          isTTY: output.isTTY === true,
        });
        progress.start();

        try {
          const discovery = await discoverUrls(context.target, context.config, {
            onEvent: progress.handle,
          });
          const scanResult = createScanResult(context, discovery);
          const resultPath = await writeScanResult(
            scanResult,
            runtime.workingDirectory,
          );
          progress.complete({
            target: scanResult.target,
            depth: scanResult.configuration.crawlDepth,
            discoveredCount: discovery.discoveredUrls.length,
            requestedCount: discovery.requestedCount,
            failedCount: discovery.failedUrls.length,
            duration: scanResult.duration,
            resultPath,
          });
        } catch (error: unknown) {
          progress.fail();
          throw error;
        }
      },
    );

  const target = program
    .command('target')
    .description('Inspect and validate targets');

  target
    .command('check')
    .description('Validate and normalize a target URL')
    .argument('<url>', 'HTTP or HTTPS target URL')
    .action((inputUrl: string) => {
      const checkedTarget = createTarget(inputUrl);
      output.stdout(`Valid target: ${checkedTarget.normalizedUrl}\n`);
    });

  return program;
}

export async function executeCli(
  argv: readonly string[],
  output: CliOutput,
  runtime: CliRuntime = {},
): Promise<number> {
  const program = createProgram(output, runtime);

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return 0;
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    if (
      error instanceof InvalidTargetError ||
      error instanceof InvalidScanConfigError
    ) {
      output.stderr(`Error: ${error.message}\n`);
      return 1;
    }

    if (error instanceof HttpError) {
      output.stderr(`HTTP error [${error.code}]: ${error.message}\n`);
      return 1;
    }

    if (error instanceof ResultWriteError) {
      output.stderr(`Result error: ${error.message}\n`);
      return 1;
    }

    throw error;
  }
}
