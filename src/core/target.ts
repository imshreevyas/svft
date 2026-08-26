import type { Target } from '../types/target.js';

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export class InvalidTargetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidTargetError';
  }
}

export function createTarget(inputUrl: string): Target {
  const trimmedUrl = inputUrl.trim();

  if (trimmedUrl.length === 0) {
    throw new InvalidTargetError('A target URL is required.');
  }

  let url: URL;

  try {
    url = new URL(trimmedUrl);
  } catch {
    throw new InvalidTargetError(
      'Invalid target URL. Include the http:// or https:// protocol.',
    );
  }

  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidTargetError('Target URL must use HTTP or HTTPS.');
  }

  if (url.hostname.length === 0) {
    throw new InvalidTargetError('Target URL must include a hostname.');
  }

  url.hash = '';

  return {
    inputUrl,
    url,
    normalizedUrl: url.href,
  };
}
