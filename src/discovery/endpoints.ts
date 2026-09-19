import type {
  DiscoveredEndpoint,
  DiscoveredForm,
  DiscoveredParameter,
  DiscoveredUrl,
} from '../types/index.js';
import {
  createDiscoveryProvenance,
  mergeDiscoveryProvenance,
} from './provenance.js';

function queryParameters(url: string): DiscoveredParameter[] {
  const parameters: DiscoveredParameter[] = [];
  const seen = new Set<string>();
  for (const [name] of new URL(url).searchParams) {
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    parameters.push({ name, source: 'query' });
  }
  return parameters;
}

function formParameters(form: DiscoveredForm): DiscoveredParameter[] {
  const parameters: DiscoveredParameter[] = [];
  const seen = new Set<string>();
  for (const field of form.fields) {
    if (
      field.name === null ||
      field.name.length === 0 ||
      seen.has(field.name)
    ) {
      continue;
    }
    // Unnamed submit buttons are deliberately not parameters. Named controls,
    // including submit buttons, are useful form parameters.
    seen.add(field.name);
    parameters.push({ name: field.name, source: 'form' });
  }
  return parameters;
}

function mergeParameters(
  existing: readonly DiscoveredParameter[],
  additional: readonly DiscoveredParameter[],
): DiscoveredParameter[] {
  const merged = [...existing];
  const seen = new Set(
    existing.map((parameter) => `${parameter.source}:${parameter.name}`),
  );
  for (const parameter of additional) {
    const key = `${parameter.source}:${parameter.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(parameter);
  }
  return merged;
}

function endpointIdentity(method: 'GET' | 'POST', url: string): string {
  const parsed = new URL(url);
  const names = [
    ...new Set(
      [...parsed.searchParams.keys()].filter((name) => name.length > 0),
    ),
  ].sort();
  return `${method}:${parsed.origin}${parsed.pathname}?${names.join('&')}`;
}

export function createEndpointInventory(
  discoveredUrls: readonly DiscoveredUrl[],
  forms: readonly DiscoveredForm[],
  formProvenance: readonly {
    readonly depth: number;
    readonly discoveredFrom: string | null;
  }[] = [],
  evidence: readonly {
    readonly method: 'GET' | 'POST';
    readonly url: string;
    readonly requestFingerprint?: string;
    readonly responseFingerprint?: string;
  }[] = [],
): DiscoveredEndpoint[] {
  const endpoints: DiscoveredEndpoint[] = [];
  const byKey = new Map<string, number>();
  const evidenceByKey = new Map(
    evidence.map((item) => [`${item.method}:${item.url}`, item] as const),
  );

  const add = (endpoint: DiscoveredEndpoint): void => {
    const key = endpointIdentity(endpoint.method, endpoint.url);
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, endpoints.length);
      endpoints.push(endpoint);
      return;
    }
    const existing = endpoints[index];
    if (existing === undefined) return;
    endpoints[index] = {
      ...existing,
      parameters: mergeParameters(existing.parameters, endpoint.parameters),
      provenance: mergeDiscoveryProvenance(
        existing.provenance,
        endpoint.provenance,
      ),
    };
  };

  for (const discoveredUrl of discoveredUrls) {
    const item = evidenceByKey.get(`GET:${discoveredUrl.url}`);
    add({
      url: discoveredUrl.url,
      method: 'GET',
      parameters: queryParameters(discoveredUrl.url),
      depth: discoveredUrl.depth,
      discoveredFrom: discoveredUrl.discoveredFrom,
      source: discoveredUrl.source ?? 'url',
      provenance: mergeDiscoveryProvenance(
        discoveredUrl.provenance,
        createDiscoveryProvenance(
          discoveredUrl.source ?? 'url',
          discoveredUrl.discoveredFrom,
          discoveredUrl.depth,
        ),
      ),
      ...(item?.requestFingerprint === undefined
        ? {}
        : { requestFingerprint: item.requestFingerprint }),
      ...(item?.responseFingerprint === undefined
        ? {}
        : { responseFingerprint: item.responseFingerprint }),
    });
  }

  forms.forEach((form, index) => {
    const provenance = formProvenance[index] ?? {
      depth: 0,
      discoveredFrom: null,
    };
    const resolvedProvenance = mergeDiscoveryProvenance(
      form.provenance,
      createDiscoveryProvenance(
        'form',
        provenance.discoveredFrom,
        provenance.depth,
      ),
    );
    const primary = resolvedProvenance[0];
    const item = evidenceByKey.get(`${form.method}:${form.action}`);
    add({
      url: form.action,
      method: form.method,
      parameters: mergeParameters(
        queryParameters(form.action),
        formParameters(form),
      ),
      depth: primary?.depth ?? provenance.depth,
      discoveredFrom: primary?.discoveredFrom ?? provenance.discoveredFrom,
      source: 'form',
      provenance: resolvedProvenance,
      ...(item?.requestFingerprint === undefined
        ? {}
        : { requestFingerprint: item.requestFingerprint }),
      ...(item?.responseFingerprint === undefined
        ? {}
        : { responseFingerprint: item.responseFingerprint }),
    });
  });

  return endpoints;
}
