# Project Context

Last updated: 2026-08-29 01:00:00 +05:30

## Identity and intent

- Name: `svft` (Security Vulnerability Finding Tool)
- Version: `0.1.0`
- License: MIT
- Runtime: Node.js 22+
- Package manager: pnpm 10
- Language: strict TypeScript, ESM
- Interface: Commander-based CLI

SVFT is an open-source, maintainable web VAPT scanner. The project grows in small, testable stages. Its current boundary is configuration-driven, same-origin URL discovery with live progress and canonical JSON persistence; it does not claim to find vulnerabilities yet.

## Current position

Implemented:

- `svft --help` and `svft --version`.
- HTTP(S) target validation and normalization with explicit protocols.
- Fragment removal and native URL normalization.
- `svft target check <url>` with zero network traffic.
- A validated ScanConfig and minimal ScanContext.
- A centralized Node.js HTTP/HTTPS client with timeout, safe retries, bounded redirects, request-local TLS policy, header precedence, response timing, and structured errors.
- `svft scan <url>` seed fetching and bounded same-origin URL discovery.
- HTML anchor extraction and deterministic FIFO traversal.
- Passive HTML form extraction with normalized same-origin actions and field metadata.
- URL resolution, normalization, origin enforcement, static-resource filtering, and deduplication.
- Discovery depth and inter-request delay controls.
- Terminal summaries containing discovery counts and ordered URLs.
- Discovery progress events for logical request starts, responses, link decisions, child failures, and completion.
- Compact dynamic CLI status with requested, queued, failed, and elapsed counters.
- One updating TTY line plus a control-character-free non-TTY fallback.
- A canonical ScanResult containing identity, target, timing, configuration, and discovery data.
- Automatic indented UTF-8 JSON creation at `svft-results/scan-<scanId>.json` without overwriting existing results.
- Deterministic SHA-256 request/response fingerprints and passive duplicate-form handling.
- Passive same-origin robots.txt and bounded sitemap URL discovery.
- Every discovered URL carries a deterministic `source` (`url`, `sitemap`, or `robots`); current application URLs use `url` or `sitemap` and robots directives identify sitemap sources only.
- Production compilation to `dist/cli/index.js` and global local linking.
- Deterministic tests using loopback HTTP/HTTPS servers.

Not implemented:

- Vulnerability rules, payloads, findings, remediation, or severity scoring.
- Form submission, authentication workflows, or API detection.
- JavaScript execution, Playwright, Crawlee, or Wappalyzer.
- Browser automation or technology fingerprinting.
- HTML or SARIF reports and result viewers.
- Database, UI, Docker, monorepo, or plugin architecture.

A successful scan currently means URL discovery completed within the configured boundary. It does not mean the target is secure.

## Repository layout

```text
src/
  cli/          command parsing and terminal output
  core/         target and configuration creation
  discovery/    link extraction and FIFO coordinator
  http/         centralized transport engine
  results/      ScanResult construction and JSON writer
  rules/        reserved; no rules implemented
  scanner/      ScanContext creation
  types/        shared domain models
tests/
  core/         configuration tests
  discovery/    extraction and coordinator tests
  fixtures/     local HTTPS certificate/key
  helpers/      loopback server helper
  http/         HTTP Engine tests
  results/      ScanResult and writer tests
  scanner/      ScanContext tests
docs/
  ARCHITECTURE.md
  PROJECT_CONTEXT.md
changes.log
```

## Domain model

### Target

`Target` stores the original input, parsed native URL, and normalized URL. `createTarget()` trims input, requires HTTP or HTTPS plus a hostname, removes fragments, and uses native URL serialization. It performs no DNS or network operation.

### ScanConfig

| Property          |      Default | Constraint/use                                   |
| ----------------- | -----------: | ------------------------------------------------ |
| `timeout`         |   `10000` ms | Positive integer                                 |
| `retries`         |          `2` | Non-negative integer                             |
| `retryDelay`      |     `500` ms | Non-negative integer                             |
| `followRedirects` |       `true` | Boolean                                          |
| `maxRedirects`    |          `5` | Non-negative integer                             |
| `concurrency`     |          `5` | Positive; reserved while discovery is sequential |
| `crawlDepth`      |          `0` | Non-negative discovery depth                     |
| `requestDelay`    |       `0` ms | Non-negative delay between discovery requests    |
| `verifyTLS`       |       `true` | Boolean, request-local                           |
| `userAgent`       | `SVFT/0.1.0` | Non-empty string                                 |
| `headers`         |         `{}` | String record, internal only                     |

`createScanConfig()` merges partial overrides without mutating defaults, copies headers, and validates the resolved object before any request starts.

### ScanContext

ScanContext contains a UUID, Target, completed ScanConfig, and start time. It stays small and contains no mutable crawl state.

### HTTP models

The request model contains method, URL, request headers, optional abort signal, and an optional redirect-approval predicate. The response model contains requested/final URLs, status, lowercase multi-value headers, text body, monotonic duration, and followed redirect chain. `HttpError` categorizes invalid request, timeout, connection/DNS, TLS, redirect limit, unsupported protocol, and abort failures.

### Discovery models

`DiscoveredUrl` contains:

- `url`: normalized HTTP(S) URL.
- `depth`: seed `0`, direct links `1`, and so on.
- `discoveredFrom`: final URL of the parent response, or `null` for the seed.
- `source`: deterministic discovery source (`url` for HTML/seed URLs, `sitemap` for sitemap entries; `robots` is reserved for direct robots-source metadata).

`DiscoveryResult` contains the seed, ordered `discoveredUrls`, passive ordered `forms`, `requestedCount`, and `failedUrls`. A child failure is recorded while FIFO processing continues. A seed failure remains fatal for the CLI. Forms contain normalized same-origin actions, GET/POST methods, and ordered field metadata without values.

It also contains an endpoint inventory. `DiscoveredEndpoint` unifies URL links and forms with one source value (`url`, `sitemap`, `robots`, or `form`), while ordered `DiscoveredParameter` entries identify query or form names without values. Endpoint identity is method + normalized path + query-name shape, so query values remain in the first-seen URL while equivalent values merge. Equivalent endpoints and parameters are deduplicated while retaining first-seen provenance. Fetched URL endpoints may include canonical request and response fingerprints; fingerprints never persist additional response bodies or form values. The implemented flow is `Target -> ScanConfig -> ScanContext -> HTTP Engine -> URL/Form discovery -> Endpoint/Parameter inventory -> request/response fingerprints -> ScanResult -> JSON`.

### Progress events

Discovery accepts an optional event handler rather than writing to the terminal. The small discriminated event model includes request started, response received, URL skipped, URL discovered, child request failed, and discovery completed. Events include requested/discovered totals and, where applicable, URL, depth, HTTP status, response duration, new-link count, skip reason, or error category.

The CLI feeds these events to a separate compact presenter. It derives queued count from existing discovered/requested counts and never creates an independent crawler counter. Interactive TTY output updates one spinner line; non-TTY output emits one newline-safe status. Neither mode prints individual discovered URLs, retries, or redirect hops. No percentage is shown because the final URL total cannot be known before discovery finishes.

### ScanResult and persistence

ScanResult is JSON-serializable and contains `scanId`, normalized `target`, ISO `startedAt` and `completedAt`, millisecond `duration`, resolved `configuration`, and the existing `discovery` result. Child HTTP failures are stored as plain code/message/URL data so JSON preserves their meaning.

After successful discovery, the CLI builds ScanResult and calls the separate ResultWriter. The writer creates `svft-results/` when needed and uses exclusive file creation for `scan-<scanId>.json`. It returns the forward-slash relative path shown in terminal output. Discovery and HTTP perform no filesystem writes.

## Discovery rules

The Discovery Engine uses the centralized HTTP client and one sequential FIFO worker. Configured concurrency is not used yet.

- The seed is always included at depth `0` and requested once by the coordinator.
- Pages at the maximum depth are requested but not expanded.
- Anchor `href` values, passive HTML forms, endpoint parameters, and same-origin sitemap URLs are extracted; scripts, CSS, and browser state are ignored. Form actions and sitemap references are normalized against final response URLs, unsupported or out-of-scope references are ignored, and no form is submitted.
- Absolute HTTP(S), root-relative, path-relative, and query-only references are supported.
- References resolve against the final response URL after redirects.
- Fragments are removed; meaningful query strings remain.
- `mailto:`, `javascript:`, `data:`, and other unsupported protocols are skipped.
- Scheme, hostname, and effective port must match the seed origin.
- `jpg`, `jpeg`, `png`, `gif`, `svg`, `webp`, `css`, `js`, `pdf`, `zip`, `exe`, `mp3`, and `mp4` paths are skipped case-insensitively.
- Sets preserve first-seen ordering and prevent duplicate queue/request work.
- `text/html` and `application/xhtml+xml` are parsed. A conflicting declared type is never parsed. Missing Content-Type uses a conservative HTML prefix check.
- `requestDelay` is awaited between coordinator requests, not before the first.
- Redirect hops and retries stay inside the HTTP Engine. Cross-origin redirects are not followed.
- Discovery sends GET requests only. Form methods are recorded as metadata; form discovery never submits forms or causes additional requests.
- Discovery requests same-origin `/robots.txt` once, follows only Sitemap directives, and optionally falls back to `/sitemap.xml`. Sitemap files are metadata sources, not endpoints; their `<loc>` URLs enter the bounded queue with sitemap provenance.
- Sitemap processing uses internal bounds of 32 sitemap documents and 1,000 sitemap URL entries per scan; duplicate sitemap documents are never requested twice and index loops are ignored.
- Identical forms are canonicalized by action, method, and ordered field metadata; duplicates merge provenance while first-seen form order is retained.

## CLI behavior

`svft scan <url>` supports:

```text
--timeout <ms>
--retries <count>
--retry-delay <ms>
--follow-redirects / --no-follow-redirects
--max-redirects <count>
--concurrency <count>
--depth <count>
--request-delay <ms>
--no-verify-tls
--user-agent <value>
```

It prints the normalized target and depth followed by a compact scanner status. TTY output refreshes one logical line; redirected or non-TTY output uses a concise newline fallback without control sequences. Completion output contains target, depth, discovered/requested/failed counts, duration, and the relative JSON path. Detailed URLs exist only in JSON. It never prints response bodies, headers, internal retries, redirect hops, or fake completion percentages.

A target/configuration/seed failure exits non-zero before ScanResult persistence. A child URL failure is retained in a completed result and does not fail the whole scan. `target check` neither creates `svft-results/` nor performs network activity.

`svft target check <url>` only validates and normalizes. Expected validation and HTTP failures go to stderr with a non-zero exit code; successful commands write to stdout and return `0`.

## Installation and contributor workflow

```sh
pnpm install
pnpm build
node dist/cli/index.js --help
```

During development:

```sh
pnpm dev -- scan http://localhost:3000 --depth 1
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

To make `svft` available globally from this checkout:

```sh
pnpm build
pnpm link --global
svft --help
```

The global link targets this checkout. Re-run `pnpm build` after source edits. The package is not yet published to a registry.

## Testing position

The suite contains focused deterministic tests for endpoint and parameter extraction in addition to discovery events, JSON persistence, target checking, and fatal scan behavior.

Tests use ephemeral loopback servers and no public internet. HTTPS uses repository-only fixtures and keeps TLS changes request-local. Servers, sockets, and timers are cleaned up.

## Architectural decisions

- Keep one package, strict TypeScript, and ESM.
- Keep target parsing in `createTarget()` and configuration in `createScanConfig()`.
- Route all traffic through `createHttpClient()`.
- Keep transport policy out of CLI, discovery, and future rules.
- Keep discovery sequential until concurrency has a concrete design and deterministic tests.
- Keep discovery limited to URL collection; do not mix in vulnerability behavior.
- Keep progress events in discovery but all terminal presentation in the CLI.
- Never display a percentage unless a future scanner has a genuinely known total.
- Keep ScanResult creation and persistence downstream from DiscoveryResult.
- Keep JSON as the sole canonical format until another format is explicitly scoped.
- Add no large dependency without a demonstrated requirement.
- Update this document and `changes.log` whenever behavior or boundaries change.

## Security boundary and next stage

Users must have authorization for every target they scan. Even bounded discovery sends network requests to same-origin pages.

The next planned stage is focused VAPT rules with reproducible evidence and remediation guidance. It must be scoped separately. Browser automation, technology detection, parameter testing, API discovery, and additional report formats remain later decisions rather than implied work.

## Handoff

A contributor can clone, install, run checks, build, globally link the CLI, validate a target, watch compact discovery counters, and inspect detailed URLs/forms in the generated JSON record. Requests remain GET-only; forms are passive metadata only.
