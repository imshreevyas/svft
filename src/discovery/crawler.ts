import { setTimeout as delay } from 'node:timers/promises';

import { createHttpClient, HttpError, type HttpClient } from '../http/index.js';
import type {
  DiscoveredUrl,
  DiscoveryEvent,
  DiscoveryEventHandler,
  DiscoveryFailure,
  DiscoveryResult,
  DiscoveryUrlSkippedEvent,
  ScanConfig,
  Target,
} from '../types/index.js';
import {
  extractAnchorHrefs,
  isDocumentUrl,
  isSameOrigin,
  normalizeDiscoveredUrl,
} from './links.js';

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
  const knownUrls = new Set([seed.url]);
  const requestedUrls = new Set<string>();
  const seedOrigin = target.url.origin;
  let queueIndex = 0;
  let requestedCount = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;

    if (current === undefined || requestedUrls.has(current.url)) {
      continue;
    }

    if (requestedCount > 0 && config.requestDelay > 0) {
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

      const discoveredBeforeResponse = discoveredUrls.length;
      const pendingEvents: DiscoveryEvent[] = [];

      if (
        current.depth < config.crawlDepth &&
        isHtmlResponse(response.headers, response.body)
      ) {
        const baseUrl = new URL(response.finalUrl);
        const nextDepth = current.depth + 1;

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
          };
          knownUrls.add(item.url);
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
  };
}
