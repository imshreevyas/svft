import type {
  DiscoveredEndpoint,
  DiscoveredForm,
  DiscoveredUrl,
  DiscoveryEvent,
  DiscoveryFailure,
  DiscoveryProvenance,
  DiscoveryResult,
  SecurityTarget,
} from './types/index.js';

export const REDACTED_QUERY_VALUE = 'REDACTED';

const SENSITIVE_QUERY_PARAMETER_NAMES = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'key',
  'secret',
  'password',
  'passwd',
  'pwd',
  'code',
  'signature',
  'sig',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'clientsecret',
  'privatekey',
  'session',
  'sessionid',
  'csrf',
  'csrftoken',
  'nonce',
]);

function decodedQueryName(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/gu, ' '))
      .toLowerCase()
      .replace(/[._-]/gu, '');
  } catch {
    return value.toLowerCase().replace(/[._-]/gu, '');
  }
}

function sanitizeQuery(search: string): string {
  if (search.length <= 1) return search;

  const values = search
    .slice(1)
    .split('&')
    .map((part) => {
      const separator = part.indexOf('=');
      const name = separator === -1 ? part : part.slice(0, separator);

      if (!SENSITIVE_QUERY_PARAMETER_NAMES.has(decodedQueryName(name))) {
        return part;
      }

      return `${name}=${REDACTED_QUERY_VALUE}`;
    });

  return `?${values.join('&')}`;
}

export function sanitizePublicUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = sanitizeQuery(url.search);
    return url.href;
  } catch {
    return '[REDACTED_URL]';
  }
}

export function sanitizePublicErrorMessage(
  message: string,
  url: string,
): string {
  return message
    .replaceAll(url, sanitizePublicUrl(url))
    .replace(/https?:\/\/[^\s"'<>]+/giu, (value) => {
      const match = /[.,;:]+$/u.exec(value);
      const suffix = match?.[0] ?? '';
      const candidate =
        suffix.length === 0 ? value : value.slice(0, -suffix.length);
      return `${sanitizePublicUrl(candidate)}${suffix}`;
    });
}

function sanitizeProvenance(
  provenance: readonly DiscoveryProvenance[],
): readonly DiscoveryProvenance[] {
  return provenance.map((item) => ({
    ...item,
    discoveredFrom: sanitizePublicUrl(item.discoveredFrom),
  }));
}

function sanitizeDiscoveredUrl(item: DiscoveredUrl): DiscoveredUrl {
  const { provenance, ...withoutProvenance } = item;
  return {
    ...withoutProvenance,
    url: sanitizePublicUrl(item.url),
    ...(item.discoveredFrom === null
      ? {}
      : { discoveredFrom: sanitizePublicUrl(item.discoveredFrom) }),
    ...(provenance === undefined
      ? {}
      : { provenance: sanitizeProvenance(provenance) }),
  };
}

function sanitizeForm(item: DiscoveredForm): DiscoveredForm {
  const { provenance, ...withoutProvenance } = item;
  return {
    ...withoutProvenance,
    action: sanitizePublicUrl(item.action),
    ...(provenance === undefined
      ? {}
      : { provenance: sanitizeProvenance(provenance) }),
  };
}

function sanitizeEndpoint(item: DiscoveredEndpoint): DiscoveredEndpoint {
  const { provenance, ...withoutProvenance } = item;
  return {
    ...withoutProvenance,
    url: sanitizePublicUrl(item.url),
    ...(item.discoveredFrom === null
      ? {}
      : { discoveredFrom: sanitizePublicUrl(item.discoveredFrom) }),
    ...(provenance === undefined
      ? {}
      : { provenance: sanitizeProvenance(provenance) }),
  };
}

function sanitizeFailure(item: DiscoveryFailure): DiscoveryFailure {
  return {
    target: sanitizeDiscoveredUrl(item.target),
    error: {
      ...item.error,
      message: sanitizePublicErrorMessage(item.error.message, item.error.url),
      url: sanitizePublicUrl(item.error.url),
    },
  };
}

export function sanitizeDiscoveryResult(
  result: DiscoveryResult,
): DiscoveryResult {
  return {
    ...result,
    seed: sanitizeDiscoveredUrl(result.seed),
    discoveredUrls: result.discoveredUrls.map(sanitizeDiscoveredUrl),
    failedUrls: result.failedUrls.map(sanitizeFailure),
    ...(result.forms === undefined
      ? {}
      : { forms: result.forms.map(sanitizeForm) }),
    ...(result.endpoints === undefined
      ? {}
      : { endpoints: result.endpoints.map(sanitizeEndpoint) }),
  };
}

export function sanitizeSecurityTargets(
  targets: readonly SecurityTarget[],
): SecurityTarget[] {
  return targets.map((target) => ({
    ...target,
    url: sanitizePublicUrl(target.url),
    provenance: target.provenance.map((item) => ({
      ...item,
      discoveredFrom: sanitizePublicUrl(item.discoveredFrom),
    })),
  }));
}

export function sanitizeDiscoveryEvent(event: DiscoveryEvent): DiscoveryEvent {
  if (event.type === 'url-discovered') {
    return {
      ...event,
      url: sanitizePublicUrl(event.url),
      discoveredFrom: sanitizePublicUrl(event.discoveredFrom),
    };
  }

  if (event.type === 'discovery-completed') return event;

  return {
    ...event,
    url: sanitizePublicUrl(event.url),
  };
}
