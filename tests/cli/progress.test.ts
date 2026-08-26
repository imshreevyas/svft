import { describe, expect, it } from 'vitest';

import { createProgressPresenter } from '../../src/cli/progress.js';
import type { DiscoveryEvent } from '../../src/types/index.js';

const requestEvent: DiscoveryEvent = {
  type: 'request-started',
  url: 'https://example.com/page',
  depth: 1,
  requestedCount: 3,
  discoveredCount: 7,
};

const failedEvent: DiscoveryEvent = {
  type: 'request-failed',
  url: 'https://example.com/failure',
  depth: 1,
  errorCode: 'TIMEOUT',
  requestedCount: 3,
  discoveredCount: 7,
};

describe('compact progress presenter', () => {
  it('updates an interactive terminal with requested and queued counts', () => {
    const writes: string[] = [];
    const presenter = createProgressPresenter({
      write: (message) => writes.push(message),
      isTTY: true,
      now: () => 10_000,
      refreshInterval: 0,
    });

    presenter.start();
    expect(() => {
      presenter.handle(requestEvent);
    }).not.toThrow();

    const output = writes.join('');
    expect(output).toContain('\r\u001B[2K');
    expect(output).toContain('3 requested');
    expect(output).toContain('4 queued');
    expect(output).toContain('0 failed');
  });

  it('uses newline fallback without terminal control sequences outside a TTY', () => {
    const writes: string[] = [];
    const presenter = createProgressPresenter({
      write: (message) => writes.push(message),
      isTTY: false,
      now: () => 0,
    });

    presenter.start();
    presenter.handle(requestEvent);

    const output = writes.join('');
    expect(output).toContain('3 requested');
    expect(output).not.toContain('\r');
    expect(output).not.toContain('\u001B');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('shows failed counts from existing discovery events', () => {
    const writes: string[] = [];
    const presenter = createProgressPresenter({
      write: (message) => writes.push(message),
      isTTY: true,
      now: () => 0,
      refreshInterval: 0,
    });

    presenter.start();
    presenter.handle(failedEvent);

    expect(writes.join('')).toContain('1 failed');
  });

  it('prints a stable completion summary without a discovered URL list', () => {
    const writes: string[] = [];
    const presenter = createProgressPresenter({
      write: (message) => writes.push(message),
      isTTY: false,
      now: () => 0,
    });

    presenter.start();
    presenter.handle({
      type: 'discovery-completed',
      requestedCount: 7,
      discoveredCount: 7,
      failedCount: 1,
    });
    presenter.complete({
      target: 'https://example.com/',
      depth: 2,
      discoveredCount: 7,
      requestedCount: 7,
      failedCount: 1,
      duration: 1500,
      resultPath: 'svft-results/scan-id.json',
    });

    const output = writes.join('');
    expect(output).toContain('\u2713 Scan complete');
    expect(output).toContain('URLs discovered: 7');
    expect(output).toContain('URLs requested: 7');
    expect(output).toContain('Failed: 1');
    expect(output).toContain('Duration: 1.5s');
    expect(output).toContain('svft-results/scan-id.json');
    expect(output).not.toContain('Discovered URLs:');
  });

  it('stops cleanly after a fatal failure', () => {
    const writes: string[] = [];
    const presenter = createProgressPresenter({
      write: (message) => writes.push(message),
      isTTY: true,
      now: () => 0,
      refreshInterval: 0,
    });

    presenter.start();
    presenter.fail();
    const writesAfterFailure = writes.length;
    presenter.handle(requestEvent);

    expect(writes).toHaveLength(writesAfterFailure);
    expect(writes.at(-1)).toBe('\r\u001B[2K');
    expect(writes.join('')).not.toContain('Scan complete');
  });
});
