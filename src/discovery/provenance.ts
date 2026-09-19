import type { DiscoveryProvenance } from '../types/index.js';

export function mergeDiscoveryProvenance(
  ...groups: readonly (readonly DiscoveryProvenance[] | undefined)[]
): DiscoveryProvenance[] {
  const merged: DiscoveryProvenance[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const value of group ?? []) {
      const key = `${value.source}|${value.discoveredFrom}|${String(value.depth)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }
  }

  return merged;
}

export function createDiscoveryProvenance(
  source: DiscoveryProvenance['source'],
  discoveredFrom: string | null,
  depth: number,
): DiscoveryProvenance[] {
  return discoveredFrom === null ? [] : [{ source, discoveredFrom, depth }];
}
