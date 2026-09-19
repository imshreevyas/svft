import assert from 'node:assert/strict';

const root = await import('svft-discovery');
const discovery = await import('svft-discovery/discovery');

assert.deepEqual(Object.keys(root), ['discover']);
assert.deepEqual(Object.keys(discovery), ['discover']);
assert.strictEqual(root.discover, discovery.discover);
