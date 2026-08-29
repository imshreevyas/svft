import { createTarget, InvalidTargetError } from '../core/index.js';
import type { DiscoveredForm, DiscoveredFormField } from '../types/index.js';

const ANCHOR_HREF_PATTERN =
  /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
const STATIC_RESOURCE_PATTERN =
  /\.(?:jpe?g|png|gif|svg|webp|css|js|pdf|zip|exe|mp3|mp4)$/iu;
const FORM_PATTERN = /<form\b([^>]*)>([\s\S]*?)<\/form\s*>/giu;
const FIELD_PATTERN = /<(input|select|textarea|button)\b([^>]*)>/giu;
const ATTRIBUTE_PATTERN =
  /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/giu;

type ParsedAttributes = Readonly<Record<string, string | true>>;

function parseAttributes(source: string): ParsedAttributes {
  const attributes: Record<string, string | true> = {};
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1]?.toLowerCase();
    if (name === undefined || name === 'value') continue;
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? true;
  }
  return attributes;
}

export function extractForms(
  html: string,
  baseUrl: URL,
  origin?: string,
): DiscoveredForm[] {
  const forms: DiscoveredForm[] = [];
  for (const match of html.matchAll(FORM_PATTERN)) {
    const formAttributes = parseAttributes(match[1] ?? '');
    const action = normalizeDiscoveredUrl(
      typeof formAttributes.action === 'string' ? formAttributes.action : '',
      baseUrl,
    );
    if (
      action === null ||
      (origin !== undefined && !isSameOrigin(action, origin))
    )
      continue;
    const methodValue =
      typeof formAttributes.method === 'string'
        ? formAttributes.method.trim().toUpperCase()
        : 'GET';
    if (methodValue !== 'GET' && methodValue !== 'POST') continue;
    const fields: DiscoveredFormField[] = [];
    for (const fieldMatch of (match[2] ?? '').matchAll(FIELD_PATTERN)) {
      const type = fieldMatch[1]?.toLowerCase() as
        DiscoveredFormField['type'] | undefined;
      if (type === undefined) continue;
      const parsed = parseAttributes(fieldMatch[2] ?? '');
      const name = typeof parsed.name === 'string' ? parsed.name : null;
      const attributes: Record<string, string | true> = { ...parsed };
      delete attributes.name;
      fields.push({
        name,
        type,
        attributes,
      });
    }
    forms.push({ action: action.href, method: methodValue, fields });
  }
  return forms;
}

export function extractAnchorHrefs(html: string): string[] {
  const hrefs: string[] = [];

  for (const match of html.matchAll(ANCHOR_HREF_PATTERN)) {
    const href = match[1] ?? match[2] ?? match[3];

    if (href !== undefined) {
      hrefs.push(href);
    }
  }

  return hrefs;
}

export function normalizeDiscoveredUrl(href: string, baseUrl: URL): URL | null {
  let resolvedUrl: URL;

  try {
    resolvedUrl = new URL(href.trim(), baseUrl);
  } catch {
    return null;
  }

  try {
    return createTarget(resolvedUrl.href).url;
  } catch (error: unknown) {
    if (error instanceof InvalidTargetError) {
      return null;
    }

    throw error;
  }
}

export function isSameOrigin(url: URL, origin: string): boolean {
  return url.origin === origin;
}

export function isDocumentUrl(url: URL): boolean {
  return !STATIC_RESOURCE_PATTERN.test(url.pathname);
}
