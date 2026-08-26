import type { DiscoveryEvent } from '../types/index.js';

const SPINNER_FRAMES = [
  '\u280B',
  '\u2819',
  '\u2839',
  '\u2838',
  '\u283C',
  '\u2834',
  '\u2826',
  '\u2827',
  '\u2807',
  '\u280F',
];
const CLEAR_LINE = '\r\u001B[2K';
const SEPARATOR = ' \u00B7 ';

export interface ProgressCompletion {
  readonly target: string;
  readonly depth: number;
  readonly discoveredCount: number;
  readonly requestedCount: number;
  readonly failedCount: number;
  readonly duration: number;
  readonly resultPath: string;
}

export interface ProgressPresenterOptions {
  readonly write: (message: string) => void;
  readonly isTTY: boolean;
  readonly now?: () => number;
  readonly refreshInterval?: number;
}

export interface ProgressPresenter {
  readonly start: () => void;
  readonly handle: (event: DiscoveryEvent) => void;
  readonly complete: (completion: ProgressCompletion) => void;
  readonly fail: () => void;
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));

  if (seconds < 60) {
    return `${String(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 60_000) {
    return `${(Math.max(0, milliseconds) / 1000).toFixed(1)}s`;
  }

  return formatElapsed(milliseconds);
}

export function createProgressPresenter(
  options: ProgressPresenterOptions,
): ProgressPresenter {
  const now = options.now ?? Date.now;
  const refreshInterval = options.refreshInterval ?? 80;
  let active = false;
  let fallbackPrinted = false;
  let startedAt = 0;
  let frameIndex = 0;
  let requestedCount = 0;
  let discoveredCount = 0;
  let failedCount = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const queuedCount = (): number =>
    Math.max(0, discoveredCount - requestedCount);

  const status = (): string => {
    const frame =
      SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? '\u280B';
    frameIndex += 1;
    return (
      `${frame} Scanning${SEPARATOR}${String(requestedCount)} requested` +
      `${SEPARATOR}${String(queuedCount())} queued` +
      `${SEPARATOR}${String(failedCount)} failed` +
      `${SEPARATOR}${formatElapsed(now() - startedAt)}`
    );
  };

  const renderInteractive = (): void => {
    if (active) {
      options.write(`${CLEAR_LINE}${status()}`);
    }
  };

  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  return {
    start: () => {
      if (active) {
        return;
      }

      active = true;
      startedAt = now();

      if (options.isTTY) {
        renderInteractive();
        if (refreshInterval > 0) {
          timer = setInterval(renderInteractive, refreshInterval);
        }
      }
    },
    handle: (event) => {
      if (!active) {
        return;
      }

      requestedCount = event.requestedCount;
      discoveredCount = event.discoveredCount;

      if (event.type === 'request-failed') {
        failedCount += 1;
      } else if (event.type === 'discovery-completed') {
        failedCount = event.failedCount;
        stopTimer();
      }

      if (options.isTTY) {
        renderInteractive();
      } else if (!fallbackPrinted) {
        options.write(`${status()}\n`);
        fallbackPrinted = true;
      }
    },
    complete: (completion) => {
      if (!active) {
        return;
      }

      stopTimer();
      active = false;
      if (options.isTTY) {
        options.write(CLEAR_LINE);
      }
      options.write(
        '\u2713 Scan complete\n\n' +
          `Target: ${completion.target}\n` +
          `Depth: ${String(completion.depth)}\n\n` +
          `URLs discovered: ${String(completion.discoveredCount)}\n` +
          `URLs requested: ${String(completion.requestedCount)}\n` +
          `Failed: ${String(completion.failedCount)}\n` +
          `Duration: ${formatDuration(completion.duration)}\n\n` +
          `Result:\n${completion.resultPath}\n`,
      );
    },
    fail: () => {
      if (!active) {
        return;
      }

      stopTimer();
      active = false;
      if (options.isTTY) {
        options.write(CLEAR_LINE);
      }
    },
  };
}
