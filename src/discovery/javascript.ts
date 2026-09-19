const SCRIPT_SRC_PATTERN =
  /<script\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/giu;
const STRING_LITERAL_PATTERN = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/gu;
const ABSOLUTE_HTTP_PATTERN = /^https?:\/\/[^\s]+$/iu;
const ROOT_RELATIVE_PATTERN = /^\/(?!\/)[^\s]+$/u;
const PATH_RELATIVE_PATTERN = /^\.{1,2}\/[^\s]+$/u;
const API_LIKE_PATTERN = /^(?:api|rest|graphql|v\d+)(?:\/|\?|#|$)/iu;
const INVALID_CODE_CHARACTER_PATTERN = /[<>`{};\\]/u;
const INVALID_DOT_SEGMENT_PATTERN = /(?:^|\/)\.{3,}(?:\/|$)/u;
const TRAILING_SYNTAX_PATTERN = /[,;\]}]$/u;
const QUERY_ONLY_PATTERN = /^\?[^\s]+$/u;
const JAVASCRIPT_MEDIA_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'text/ecmascript',
  'text/javascript',
  'text/plain',
]);

function decodeStaticString(value: string): string | null {
  if (value.includes('${')) return null;

  const decoded = value
    .replace(/\\u002f/giu, '/')
    .replace(/\\x2f/giu, '/')
    .replace(/\\\//gu, '/')
    .replace(/\\(["'`\\])/gu, '$1');

  let hasControlCharacter = false;
  for (let index = 0; index < decoded.length; index += 1) {
    const codeUnit = decoded.charCodeAt(index);
    if (codeUnit <= 32 || codeUnit === 127) {
      hasControlCharacter = true;
      break;
    }
  }
  return decoded.length > 0 && !hasControlCharacter ? decoded : null;
}

function isConservativeReference(value: string): boolean {
  if (
    !hasValidPercentEncoding(value) ||
    INVALID_CODE_CHARACTER_PATTERN.test(decodeForValidation(value)) ||
    INVALID_DOT_SEGMENT_PATTERN.test(value) ||
    TRAILING_SYNTAX_PATTERN.test(value) ||
    hasUnmatchedDelimiters(value)
  ) {
    return false;
  }

  if (!(
    ABSOLUTE_HTTP_PATTERN.test(value) ||
    ROOT_RELATIVE_PATTERN.test(value) ||
    PATH_RELATIVE_PATTERN.test(value) ||
    QUERY_ONLY_PATTERN.test(value) ||
    API_LIKE_PATTERN.test(value)
  )) {
    return false;
  }

  try {
    const parsed = new URL(value, 'https://svft.invalid/');
    if (isStructurallyInternalPath(parsed.pathname)) return false;
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function isStructurallyInternalPath(pathname: string): boolean {
  const segments = pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
  const first = segments[0];

  if (first === undefined) return false;
  if (
    first.startsWith('@') ||
    (first.startsWith('_') && (first.length <= 6 || first.includes('-')))
  ) {
    return true;
  }

  // Very deep, directory-shaped references are generally package/runtime
  // internals rather than application endpoints. Keep ordinary nested routes.
  return segments.length >= 5 && pathname.endsWith('/');
}

function hasUnmatchedDelimiters(value: string): boolean {
  const pairs: Readonly<Record<string, string>> = { '(': ')', '[': ']' };
  const stack: string[] = [];
  for (const character of value) {
    if (character in pairs) {
      stack.push(pairs[character] ?? '');
    } else if (character === ')' || character === ']') {
      if (stack.pop() !== character) return true;
    }
  }
  return stack.length > 0;
}

function hasValidPercentEncoding(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;
    const encoded = value.slice(index + 1, index + 3);
    if (!/^[\da-f]{2}$/iu.test(encoded)) return false;
    index += 2;
  }
  return true;
}

function decodeForValidation(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractScriptSources(html: string): string[] {
  const sources: string[] = [];
  for (const match of html.matchAll(SCRIPT_SRC_PATTERN)) {
    const source = match[1] ?? match[2] ?? match[3];
    if (source !== undefined && source.trim().length > 0) sources.push(source);
  }
  return sources;
}

export function extractJavaScriptReferences(source: string): string[] {
  const references: string[] = [];
  for (const match of source.matchAll(STRING_LITERAL_PATTERN)) {
    const value = decodeStaticString(match[2] ?? '');
    if (value !== null && isConservativeReference(value)) {
      references.push(value);
    }
  }
  return references;
}

export function isJavaScriptTextResponse(
  headers: Readonly<Record<string, readonly string[]>>,
): boolean {
  const contentType = headers['content-type']?.[0];
  if (contentType === undefined) return true;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType !== undefined && JAVASCRIPT_MEDIA_TYPES.has(mediaType);
}
