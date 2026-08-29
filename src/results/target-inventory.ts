import type {
  DiscoveredEndpoint,
  DiscoveredForm,
  DiscoveredUrl,
  DiscoveryProvenance,
  DiscoveryResult,
  SecurityTarget,
} from '../types/index.js';

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

function parameterNamesFromUrl(url: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of new URL(url).searchParams.keys()) {
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function parameterNamesFromForm(form: DiscoveredForm): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const field of form.fields) {
    if (
      field.name === null ||
      field.name.length === 0 ||
      seen.has(field.name)
    ) {
      continue;
    }
    seen.add(field.name);
    names.push(field.name);
  }
  return names;
}

function primaryProvenance(
  item: Pick<
    DiscoveredUrl | DiscoveredEndpoint,
    'source' | 'discoveredFrom' | 'depth'
  >,
): DiscoveryProvenance {
  return {
    source: item.source ?? 'url',
    discoveredFrom: item.discoveredFrom,
    depth: item.depth,
  };
}

function provenanceKey(value: DiscoveryProvenance): string {
  return `${value.source}|${value.discoveredFrom ?? ''}|${String(value.depth)}`;
}

function mergeUnique<T>(
  existing: readonly T[],
  additional: readonly T[],
  key: (value: T) => string,
): T[] {
  const merged = [...existing];
  const seen = new Set(existing.map(key));
  for (const value of additional) {
    const valueKey = key(value);
    if (seen.has(valueKey)) continue;
    seen.add(valueKey);
    merged.push(value);
  }
  return merged;
}

export function createSecurityTargetInventory(
  discovery: DiscoveryResult,
): SecurityTarget[] {
  const targets: SecurityTarget[] = [];
  const byIdentity = new Map<string, number>();

  const add = (target: SecurityTarget): void => {
    const normalizedUrl = normalizeUrl(target.url);
    const identity = `${target.method}:${normalizedUrl}`;
    const existingIndex = byIdentity.get(identity);
    if (existingIndex === undefined) {
      byIdentity.set(identity, targets.length);
      targets.push({ ...target, url: normalizedUrl });
      return;
    }

    const existing = targets[existingIndex];
    if (existing === undefined) return;
    targets[existingIndex] = {
      ...existing,
      parameterNames: mergeUnique(
        existing.parameterNames,
        target.parameterNames,
        (name) => name,
      ),
      provenance: mergeUnique(
        existing.provenance,
        target.provenance,
        provenanceKey,
      ),
    };
  };

  for (const discoveredUrl of discovery.discoveredUrls) {
    add({
      url: discoveredUrl.url,
      method: 'GET',
      source: discoveredUrl.source ?? 'url',
      parameterNames: parameterNamesFromUrl(discoveredUrl.url),
      provenance: mergeUnique(
        [],
        [primaryProvenance(discoveredUrl), ...(discoveredUrl.provenance ?? [])],
        provenanceKey,
      ),
    });
  }

  for (const form of discovery.forms ?? []) {
    const matchingEndpoint = discovery.endpoints?.find(
      (endpoint) =>
        endpoint.method === form.method &&
        normalizeUrl(endpoint.url) === normalizeUrl(form.action),
    );
    const endpointProvenance =
      matchingEndpoint === undefined
        ? (form.provenance ?? [
            { source: 'form', discoveredFrom: null, depth: 0 },
          ])
        : [
            primaryProvenance(matchingEndpoint),
            ...(matchingEndpoint.provenance ?? []),
          ];
    add({
      url: form.action,
      method: form.method,
      source: 'form',
      parameterNames: mergeUnique(
        parameterNamesFromUrl(form.action),
        parameterNamesFromForm(form),
        (name) => name,
      ),
      provenance: mergeUnique(
        [],
        [...endpointProvenance, ...(form.provenance ?? [])],
        provenanceKey,
      ),
    });
  }

  for (const endpoint of discovery.endpoints ?? []) {
    add({
      url: endpoint.url,
      method: endpoint.method,
      source: endpoint.source,
      parameterNames: mergeUnique(
        parameterNamesFromUrl(endpoint.url),
        endpoint.parameters.map((parameter) => parameter.name),
        (name) => name,
      ),
      provenance: mergeUnique(
        [],
        [primaryProvenance(endpoint), ...(endpoint.provenance ?? [])],
        provenanceKey,
      ),
    });
  }

  return targets;
}
