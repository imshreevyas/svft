import { setTimeout as delay } from 'node:timers/promises';

import { createHttpClient, HttpError, type HttpClient } from '../http/index.js';
import type {
  DiscoveredUrl,
  DiscoveryEvent,
  DiscoveryEventHandler,
  DiscoveryFailure,
  DiscoveredForm,
  DiscoveryProvenance,
  DiscoveryResult,
  DiscoveryUrlSkippedEvent,
  ScanConfig,
  Target,
} from '../types/index.js';
import {
  extractAnchorHrefs,
  extractForms,
  isDocumentUrl,
  isSameOrigin,
  normalizeDiscoveredUrl,
} from './links.js';
import { createEndpointInventory } from './endpoints.js';
import {
  extractSitemapLocations,
  extractSitemapReferences,
} from './sitemap.js';

const MAX_SITEMAP_DOCUMENTS = 32;
const MAX_SITEMAP_URLS = 1_000;

function formIdentity(form: DiscoveredForm): string {
  const fields = form.fields.map((field) => ({
    name: field.name,
    type: field.type,
    attributes: Object.fromEntries(
      Object.entries(field.attributes).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  }));
  return JSON.stringify({ action: form.action, method: form.method, fields });
}

function mergeProvenance(
  existing: readonly DiscoveryProvenance[] | undefined,
  item: DiscoveryProvenance,
): readonly DiscoveryProvenance[] {
  const values = [...(existing ?? []), item];
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.source}|${value.discoveredFrom ?? ''}|${String(value.depth)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DiscoveryOptions {
  readonly client?: HttpClient;
  readonly onEvent?: DiscoveryEventHandler;
}

function report(
  handler: DiscoveryEventHandler | undefined,
  event: DiscoveryEvent,
): void {
  handler?.(event);
}

function isHtmlResponse(
  headers: Readonly<Record<string, readonly string[]>>,
  body: string,
): boolean {
  const contentType = headers['content-type']?.[0];

  if (contentType !== undefined) {
    const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    return mediaType === 'text/html' || mediaType === 'application/xhtml+xml';
  }

  return /^\s*(?:<!doctype\s+html\b|<html\b)/iu.test(body);
}

function createSeed(target: Target): DiscoveredUrl {
  return {
    url: target.normalizedUrl,
    depth: 0,
    discoveredFrom: null,
    source: 'url',
  };
}

export async function discoverUrls(
  target: Target,
  config: ScanConfig,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const client = options.client ?? createHttpClient(config);
  const seed = createSeed(target);
  const queue: DiscoveredUrl[] = [seed];
  const discoveredUrls: DiscoveredUrl[] = [seed];
  const failedUrls: DiscoveryFailure[] = [];
  const forms: DiscoveredForm[] = [];
  const formsByIdentity = new Map<string, number>();
  const processedFormPages = new Set<string>();
  const formProvenance: { depth: number; discoveredFrom: string }[] = [];
  const requestEvidence: {
    method: 'GET' | 'POST';
    url: string;
    requestFingerprint?: string;
    responseFingerprint?: string;
  }[] = [];
  const sitemapUrls: string[] = [];
  const seenSitemaps = new Set<string>();
  let sitemapUrlCount = 0;
  const knownUrls = new Set([seed.url]);
  const discoveredUrlIndex = new Map([[seed.url, 0]]);
  const requestedUrls = new Set<string>();
  const seedOrigin = target.url.origin;
  let queueIndex = 0;
  let requestedCount = 0;
  let passiveRequestCount = 0;

  // Robots and sitemap retrieval are passive metadata requests and never enter
  // the application URL queue or endpoint inventory.
  try {
    if (passiveRequestCount > 0 && config.requestDelay > 0) {
      await delay(config.requestDelay);
    }
    const robots = await client.request({
      method: 'GET',
      url: new URL('/robots.txt', target.url),
      headers: {},
      canFollowRedirect: (url) => url.origin === seedOrigin,
    });
    passiveRequestCount += 1;
    const references = extractSitemapReferences(robots.body);
    const candidates = references.length > 0 ? references : ['/sitemap.xml'];
    for (const reference of candidates) {
      const sitemap = normalizeDiscoveredUrl(
        reference,
        new URL(robots.finalUrl),
      );
      if (sitemapUrls.length >= MAX_SITEMAP_DOCUMENTS) break;
      if (
        sitemap !== null &&
        isSameOrigin(sitemap, seedOrigin) &&
        !seenSitemaps.has(sitemap.href)
      ) {
        seenSitemaps.add(sitemap.href);
        sitemapUrls.push(sitemap.href);
      }
    }
    if (sitemapUrls.length === 0 && references.length > 0) {
      const fallback = normalizeDiscoveredUrl(
        '/sitemap.xml',
        new URL(robots.finalUrl),
      );
      if (fallback !== null && isSameOrigin(fallback, seedOrigin)) {
        seenSitemaps.add(fallback.href);
        sitemapUrls.push(fallback.href);
      }
    }
  } catch {
    // Robots is optional; normal URL discovery continues on failure.
  }

  let sitemapIndex = 0;
  let sitemapDocuments = 0;
  while (
    sitemapIndex < sitemapUrls.length &&
    sitemapDocuments < MAX_SITEMAP_DOCUMENTS
  ) {
    const sitemapUrl = sitemapUrls[sitemapIndex];
    sitemapIndex += 1;
    sitemapDocuments += 1;
    if (sitemapUrl === undefined) continue;
    try {
      if (passiveRequestCount > 0 && config.requestDelay > 0) {
        await delay(config.requestDelay);
      }
      const response = await client.request({
        method: 'GET',
        url: new URL(sitemapUrl),
        headers: {},
        canFollowRedirect: (url) => url.origin === seedOrigin,
      });
      passiveRequestCount += 1;
      const body = response.body;
      const isIndex =
        /<sitemapindex\b/iu.test(body) && /<\/sitemapindex\s*>/iu.test(body);
      const isUrlSet = /<urlset\b/iu.test(body) && /<\/urlset\s*>/iu.test(body);
      if (!isIndex && !isUrlSet) continue;
      for (const location of extractSitemapLocations(body)) {
        const normalized = normalizeDiscoveredUrl(
          location,
          new URL(response.finalUrl),
        );
        if (normalized === null || !isSameOrigin(normalized, seedOrigin)) {
          continue;
        }
        if (isIndex) {
          if (
            sitemapUrls.length < MAX_SITEMAP_DOCUMENTS &&
            !seenSitemaps.has(normalized.href)
          ) {
            seenSitemaps.add(normalized.href);
            sitemapUrls.push(normalized.href);
          }
          continue;
        }
        if (config.crawlDepth < 1 || sitemapUrlCount >= MAX_SITEMAP_URLS)
          continue;
        if (knownUrls.has(normalized.href)) {
          const existingIndex = discoveredUrlIndex.get(normalized.href);
          const existing =
            existingIndex === undefined
              ? undefined
              : discoveredUrls[existingIndex];
          if (existingIndex !== undefined && existing !== undefined) {
            const provenance: DiscoveryProvenance = {
              source: 'sitemap',
              discoveredFrom: response.finalUrl,
              depth: 1,
            };
            discoveredUrls[existingIndex] = {
              ...existing,
              provenance: mergeProvenance(
                existing.provenance ?? [
                  {
                    source: existing.source ?? 'url',
                    discoveredFrom: existing.discoveredFrom,
                    depth: existing.depth,
                  },
                ],
                provenance,
              ),
            };
          }
          continue;
        }
        const item: DiscoveredUrl = {
          url: normalized.href,
          depth: 1,
          discoveredFrom: response.finalUrl,
          source: 'sitemap',
        };
        knownUrls.add(item.url);
        discoveredUrlIndex.set(item.url, discoveredUrls.length);
        sitemapUrlCount += 1;
        discoveredUrls.push(item);
        queue.push(item);
      }
    } catch {
      // An unavailable or malformed sitemap must not abort URL discovery.
    }
  }

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;

    if (current === undefined || requestedUrls.has(current.url)) {
      continue;
    }

    if (
      (requestedCount > 0 || passiveRequestCount > 0) &&
      config.requestDelay > 0
    ) {
      await delay(config.requestDelay);
    }

    requestedUrls.add(current.url);
    requestedCount += 1;
    report(options.onEvent, {
      type: 'request-started',
      url: current.url,
      depth: current.depth,
      requestedCount,
      discoveredCount: discoveredUrls.length,
    });

    try {
      const response = await client.request({
        method: 'GET',
        url: new URL(current.url),
        headers: {},
        canFollowRedirect: (redirectUrl) => {
          const normalizedRedirect = normalizeDiscoveredUrl(
            redirectUrl.href,
            redirectUrl,
          );

          if (
            normalizedRedirect === null ||
            !isSameOrigin(normalizedRedirect, seedOrigin) ||
            requestedUrls.has(normalizedRedirect.href)
          ) {
            return false;
          }

          requestedUrls.add(normalizedRedirect.href);
          return true;
        },
      });

      for (const redirect of response.redirectChain) {
        requestedUrls.add(redirect.fromUrl);
        requestedUrls.add(redirect.toUrl);
        knownUrls.add(redirect.toUrl);
      }
      requestedUrls.add(response.finalUrl);
      knownUrls.add(response.finalUrl);
      requestEvidence.push({
        method: 'GET',
        url: current.url,
        ...(response.requestFingerprint === undefined
          ? {}
          : { requestFingerprint: response.requestFingerprint }),
        ...(response.responseFingerprint === undefined
          ? {}
          : { responseFingerprint: response.responseFingerprint }),
      });

      const discoveredBeforeResponse = discoveredUrls.length;
      const pendingEvents: DiscoveryEvent[] = [];

      if (isHtmlResponse(response.headers, response.body)) {
        const baseUrl = new URL(response.finalUrl);
        const responseForms = processedFormPages.has(response.finalUrl)
          ? []
          : extractForms(response.body, baseUrl, seedOrigin);
        processedFormPages.add(response.finalUrl);
        const uniqueForms: DiscoveredForm[] = [];
        const pageFormKeys = new Set<string>();
        for (const form of responseForms) {
          const key = formIdentity(form);
          if (pageFormKeys.has(key)) continue;
          pageFormKeys.add(key);
          uniqueForms.push(form);
        }
        for (const form of uniqueForms) {
          const provenance: DiscoveryProvenance = {
            source: 'form',
            depth: current.depth,
            discoveredFrom: response.finalUrl,
          };
          const index = formsByIdentity.get(formIdentity(form));
          if (index === undefined) {
            formsByIdentity.set(formIdentity(form), forms.length);
            forms.push({ ...form });
            formProvenance.push({
              depth: current.depth,
              discoveredFrom: response.finalUrl,
            });
          } else {
            const existing = forms[index];
            if (existing !== undefined) {
              forms[index] = {
                ...existing,
                provenance: mergeProvenance(
                  existing.provenance ?? [
                    {
                      source: 'form',
                      depth: formProvenance[index]?.depth ?? provenance.depth,
                      discoveredFrom:
                        formProvenance[index]?.discoveredFrom ??
                        provenance.discoveredFrom,
                    },
                  ],
                  provenance,
                ),
              };
            }
          }
        }
        const nextDepth = current.depth + 1;

        if (current.depth < config.crawlDepth) {
          for (const href of extractAnchorHrefs(response.body)) {
            const discoveredUrl = normalizeDiscoveredUrl(href, baseUrl);

            if (discoveredUrl === null) {
              pendingEvents.push({
                type: 'url-skipped',
                url: href,
                depth: nextDepth,
                reason: 'invalid-or-unsupported',
                requestedCount,
                discoveredCount: discoveredUrls.length,
              });
              continue;
            }

            let skipReason: DiscoveryUrlSkippedEvent['reason'] | undefined;

            if (!isSameOrigin(discoveredUrl, seedOrigin)) {
              skipReason = 'out-of-scope';
            } else if (!isDocumentUrl(discoveredUrl)) {
              skipReason = 'static-resource';
            } else if (knownUrls.has(discoveredUrl.href)) {
              const existingIndex = discoveredUrlIndex.get(discoveredUrl.href);
              const existing =
                existingIndex === undefined
                  ? undefined
                  : discoveredUrls[existingIndex];
              if (existingIndex !== undefined && existing !== undefined) {
                discoveredUrls[existingIndex] = {
                  ...existing,
                  provenance: mergeProvenance(
                    existing.provenance ?? [
                      {
                        source: existing.source ?? 'url',
                        discoveredFrom: existing.discoveredFrom,
                        depth: existing.depth,
                      },
                    ],
                    {
                      source: 'url',
                      discoveredFrom: response.finalUrl,
                      depth: nextDepth,
                    },
                  ),
                };
              }
              skipReason = 'duplicate';
            }

            if (skipReason !== undefined) {
              pendingEvents.push({
                type: 'url-skipped',
                url: discoveredUrl.href,
                depth: nextDepth,
                reason: skipReason,
                requestedCount,
                discoveredCount: discoveredUrls.length,
              });
              continue;
            }

            const item: DiscoveredUrl = {
              url: discoveredUrl.href,
              depth: nextDepth,
              discoveredFrom: response.finalUrl,
              source: 'url',
            };
            knownUrls.add(item.url);
            discoveredUrlIndex.set(item.url, discoveredUrls.length);
            discoveredUrls.push(item);
            queue.push(item);
            pendingEvents.push({
              type: 'url-discovered',
              url: item.url,
              depth: item.depth,
              discoveredFrom: response.finalUrl,
              requestedCount,
              discoveredCount: discoveredUrls.length,
            });
          }
        }
      }

      report(options.onEvent, {
        type: 'response-received',
        url: current.url,
        depth: current.depth,
        statusCode: response.statusCode,
        ...(response.statusMessage === undefined
          ? {}
          : { statusMessage: response.statusMessage }),
        duration: response.responseTime,
        linksDiscovered: discoveredUrls.length - discoveredBeforeResponse,
        requestedCount,
        discoveredCount: discoveredUrls.length,
      });

      for (const event of pendingEvents) {
        report(options.onEvent, event);
      }
    } catch (error: unknown) {
      if (!(error instanceof HttpError) || current.depth === 0) {
        throw error;
      }

      failedUrls.push({
        target: current,
        error: {
          code: error.code,
          message: error.message,
          url: error.url,
        },
      });
      report(options.onEvent, {
        type: 'request-failed',
        url: current.url,
        depth: current.depth,
        errorCode: error.code,
        requestedCount,
        discoveredCount: discoveredUrls.length,
      });
    }
  }

  report(options.onEvent, {
    type: 'discovery-completed',
    requestedCount,
    discoveredCount: discoveredUrls.length,
    failedCount: failedUrls.length,
  });

  return {
    seed,
    discoveredUrls,
    requestedCount,
    failedUrls,
    forms,
    endpoints: createEndpointInventory(
      discoveredUrls,
      forms,
      formProvenance,
      requestEvidence,
    ),
  };
}
