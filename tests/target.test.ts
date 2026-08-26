import { describe, expect, it } from 'vitest';

import { createTarget, InvalidTargetError } from '../src/core/index.js';

describe('createTarget', () => {
  it('accepts a valid HTTP URL', () => {
    const target = createTarget('https://example.com/path');

    expect(target.url).toBeInstanceOf(URL);
    expect(target.normalizedUrl).toBe('https://example.com/path');
  });

  it('rejects an invalid URL', () => {
    expect(() => createTarget('example.com')).toThrow(InvalidTargetError);
    expect(() => createTarget('example.com')).toThrow(
      'Include the http:// or https:// protocol',
    );
  });

  it('normalizes casing, default ports, and fragments', () => {
    const target = createTarget(' HTTPS://EXAMPLE.COM:443/a/../docs#section ');

    expect(target.normalizedUrl).toBe('https://example.com/docs');
  });
});
