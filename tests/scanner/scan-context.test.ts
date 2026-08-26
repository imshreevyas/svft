import { describe, expect, it } from 'vitest';

import { createScanConfig, createTarget } from '../../src/core/index.js';
import { createScanContext } from '../../src/scanner/index.js';

describe('createScanContext', () => {
  it('combines a target and resolved configuration for one scan', () => {
    const target = createTarget('https://example.com');
    const config = createScanConfig({ timeout: 15_000 });

    const context = createScanContext(target, config);

    expect(context.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(context.target).toBe(target);
    expect(context.config).toBe(config);
    expect(context.startedAt).toBeInstanceOf(Date);
  });
});
