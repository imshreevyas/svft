import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ScanResult } from '../types/index.js';

const RESULT_DIRECTORY = 'svft-results';

export class ResultWriteError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ResultWriteError';
  }
}

export async function writeScanResult(
  result: ScanResult,
  baseDirectory: string = process.cwd(),
): Promise<string> {
  const fileName = `scan-${result.scanId}.json`;
  const relativePath = `${RESULT_DIRECTORY}/${fileName}`;
  const directory = join(baseDirectory, RESULT_DIRECTORY);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, fileName),
      `${JSON.stringify(result, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
  } catch (cause: unknown) {
    throw new ResultWriteError(
      `Unable to write scan result: ${relativePath}`,
      cause,
    );
  }

  return relativePath;
}
