export { discoverUrls, type DiscoveryOptions } from './crawler.js';
export {
  extractAnchorHrefs,
  extractForms,
  isDocumentUrl,
  isSameOrigin,
  normalizeDiscoveredUrl,
} from './links.js';
export { createEndpointInventory } from './endpoints.js';
export {
  extractJavaScriptReferences,
  extractScriptSources,
  isJavaScriptTextResponse,
} from './javascript.js';
export {
  extractSitemapLocations,
  extractSitemapReferences,
} from './sitemap.js';
