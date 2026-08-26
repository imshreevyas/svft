import { createTarget, InvalidTargetError } from '../core/index.js';

const ANCHOR_HREF_PATTERN =
  /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/giu;
const STATIC_RESOURCE_PATTERN =
  /\.(?:jpe?g|png|gif|svg|webp|css|js|pdf|zip|exe|mp3|mp4)$/iu;

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
