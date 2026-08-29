const SITEMAP_DIRECTIVE = /^\s*sitemap\s*:\s*(\S.*?)\s*$/imu;
const SITEMAP_DIRECTIVES = /^\s*sitemap\s*:\s*(\S.*?)\s*$/gimu;
const URL_LOC = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/giu;

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&apos;/giu, "'");
}

export function extractSitemapReferences(robots: string): string[] {
  const references: string[] = [];
  for (const match of robots.matchAll(SITEMAP_DIRECTIVES)) {
    const value = match[1]?.trim();
    if (value !== undefined && value.length > 0) references.push(value);
  }
  return references;
}

export function extractSitemapLocations(xml: string): string[] {
  const locations: string[] = [];
  for (const match of xml.matchAll(URL_LOC)) {
    const value = match[1]?.trim();
    if (value !== undefined && value.length > 0)
      locations.push(decodeXml(value));
  }
  return locations;
}

export function hasSitemapDirective(robots: string): boolean {
  return SITEMAP_DIRECTIVE.test(robots);
}
