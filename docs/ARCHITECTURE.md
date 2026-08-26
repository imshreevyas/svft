# Architecture

## Principles

SVFT is one strict-TypeScript ESM package with a CLI entry point. It favors small functions, plain immutable models, direct dependencies, and explicit data flow. It has no database, UI, Docker layer, monorepo, browser automation, or plugin system.

All network traffic goes through the centralized HTTP Engine. Discovery owns URL selection and scheduling; HTTP owns transport behavior. Result persistence is separate from both. None of these layers owns vulnerability logic.

## Current flow

```text
CLI -> Target -> ScanConfig -> ScanContext
                                  |
                                  v
                         Discovery Engine ----> Progress events ----> CLI
                         /              \
                 HTTP Engine <------ FIFO Queue
                                  |
                                  v
                          DiscoveryResult
                                  |
                                  v
                            ScanResult
                                  |
                                  v
                         JSON ResultWriter
```

`Target` identifies the normalized seed. `ScanConfig` controls transport and discovery limits. `ScanContext` identifies an execution. The Discovery Engine schedules URLs and consumes responses from the HTTP Engine.

## Source ownership

- `src/cli/`: commands, option mapping, compact progress presentation, output capability detection, and exit codes.
- `src/core/`: target normalization and configuration creation/validation.
- `src/scanner/`: assembly of Target and ScanConfig into ScanContext.
- `src/http/`: requests, response normalization, retries, redirects, TLS, headers, timing, and categorized failures.
- `src/discovery/`: HTML anchor extraction, URL resolution/filtering/deduplication, FIFO traversal, and discovery results.
- `src/results/`: canonical ScanResult construction and exclusive UTF-8 JSON persistence.
- `src/rules/`: reserved for future VAPT rules; currently empty.
- `src/types/`: shared domain types.

The dependency direction is important: discovery may call HTTP, but HTTP does not import discovery. The CLI does not implement URL or transport policy itself.

## HTTP Engine

`createHttpClient(config)` uses Node.js `node:http` and `node:https`; no networking dependency is installed. It supports typed requests and responses, lowercase multi-value response headers, response bodies, monotonic timing, and redirect history.

Header precedence is configuration headers, configured User-Agent, then per-request headers. TLS verification is request-local and enabled by default. Redirect following covers 301, 302, 303, 307, and 308 with a configured hop limit. Discovery supplies a redirect predicate so a cross-origin redirect response is returned without sending a request to the foreign origin.

Retries apply only to safe methods for timeouts and recognized transient transport failures. HTTP statuses, TLS errors, permanent DNS errors, aborts, invalid requests, unsupported protocols, and redirect-limit failures are not automatically retried.

## Discovery Engine

`discoverUrls(target, config)` is a single-worker coordinator. It deliberately does not use configured concurrency yet, ensuring deterministic FIFO behavior.

The seed is depth `0`. Links extracted from it are depth `1`; links extracted from those pages are depth `2`, and so on. A page may be requested at the maximum depth, but links from it are not expanded. With the default `crawlDepth: 0`, exactly the seed discovery request is made.

For each eligible HTML response, discovery:

1. Extracts `<a href>` values in source order.
2. Resolves them against `response.finalUrl`, so redirects establish the correct base.
3. Normalizes them through the shared target parser and removes fragments.
4. Requires exact origin equality (scheme, host, effective port).
5. Skips common static file extensions.
6. Deduplicates with insertion-ordered sets.
7. Appends accepted URLs to the FIFO queue.

Declared `text/html` and `application/xhtml+xml` responses are parsed. A response with another declared media type is not parsed. If `Content-Type` is absent, only a body beginning like an HTML document is accepted as a conservative fallback.

`requestDelay` is applied between discovery requests. Redirect hops and transport retries remain internal to one HTTP client request. Child-page HTTP failures are recorded and traversal continues; a seed failure is returned to the CLI as an HTTP error.

Discovery accepts an optional synchronous event handler. It reports logical request starts, responses, discovered/skipped URLs, child request failures, and completion totals. Events expose discovery-level data only. The CLI ignores per-link discovered/skipped events so ordinary output stays concise, and it never displays internal retry or redirect-hop activity.

Discovery currently issues GET requests only. The HTTP Engine can represent multiple methods structurally, but form handling and POST endpoint discovery are separate future stages.

## Progress presentation

Progress presentation belongs exclusively to the CLI. The presenter consumes existing DiscoveryEvent counts and derives pending queue size as discovered minus requested; it does not create another crawler state model. The HTTP Engine and Discovery Engine contain no spinner, terminal, TTY, or control-sequence logic.

For an interactive TTY, the presenter refreshes one carriage-return/clear-line status containing a spinner, requested count, queued count, failed count, and elapsed time. For non-TTY or redirected output, it emits one concise newline-based status and no control characters. Completion stops the timer, clears the interactive line, and prints a stable summary. Fatal errors stop and clear the presenter before the existing concise error boundary runs.

No percentage is shown because discovery cannot know its final URL count in advance. Detailed URLs remain in the canonical JSON result rather than normal terminal output.

## Models

`DiscoveredUrl` contains the normalized URL, its depth, and the final URL of the page that discovered it (`null` for the seed). `DiscoveryResult` contains the seed, ordered discovered URLs, coordinator request count, and failed child URLs with structured HTTP errors.

`ScanResult` is the canonical serializable scan record. It contains the ScanContext ID, normalized target, ISO start/completion times, duration in milliseconds, resolved configuration, and DiscoveryResult. It deliberately has no findings field because vulnerability testing does not exist.

## Result persistence

The CLI creates ScanResult only after discovery completes, then passes it to ResultWriter. The writer creates `svft-results/` below the current working directory and writes indented UTF-8 JSON to `scan-<scanId>.json` using exclusive creation. Existing files are never overwritten.

Discovery and HTTP do not import the writer and perform no filesystem operations. A fatal target, configuration, or seed request failure occurs before result creation and therefore writes no misleading successful file. Child URL failures remain data inside a completed DiscoveryResult.

## Command boundaries

`svft scan <url>` validates the target and configuration, creates ScanContext, displays compact dynamic counters, runs GET-only discovery, constructs ScanResult, writes JSON, and prints a stable summary plus relative result path. It does not print discovered URLs or evaluate vulnerabilities.

`svft target check <url>` stops after structural target validation and performs zero network requests.

## Testing

Transport, discovery, and CLI integration tests use ephemeral loopback servers. Discovery coverage includes depth boundaries, URL forms, normalization, query preservation, fragments, origin/port rules, static filtering, HTML detection, redirects, deduplication, FIFO continuation, delay, and failures. HTTPS tests use repository fixtures and never alter global TLS settings.

## Deferred work

Vulnerability rules, payloads, form submission, JavaScript execution, browser automation, technology detection, authentication, API discovery, HTML/SARIF reports, databases, and plugins remain out of scope. JSON is the only canonical result format.
