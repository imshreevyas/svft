# SVFT

<pre>
+------------------------------------------------------------------+
|    <strong><em>_____ _    __ ______ ______</em><strong>                                   |
|   <strong><em>/ ___/| |  / // ____//_  __/</em></strong>                                   |
|   <strong><em>\__ \ | | / // /_     / /</em></strong>                                      |
|  <strong><em>___/ / | |/ // __/    / /</em></strong>                                       |
| <strong><em>/____/  |___//_/      /_/</em></strong>                                        |
|                                                                  |
|  Security Vulnerability Finding Tool                             |
|  simple | maintainable | CLI-first                               |
+------------------------------------------------------------------+
</pre>

SVFT is an open-source, CLI-first web VAPT scanner written in TypeScript. Its current capability is safe, bounded URL discovery with live terminal progress and canonical JSON results. It does not run vulnerability checks.

> Only scan systems you own or are explicitly authorized to test.

## Current Capability

| Capability                   | Status          | Notes                                                |
| ---------------------------- | --------------- | ---------------------------------------------------- |
| HTTP(S) target validation    | Ready           | Explicit protocol required                           |
| Dynamic scan configuration   | Ready           | Validated defaults and CLI overrides                 |
| Centralized HTTP Engine      | Ready           | Timeout, retry, redirects, TLS, headers              |
| URL discovery                | Ready           | HTML anchors/forms, same origin, FIFO, bounded depth |
| Static asset filtering       | Ready           | Common non-document extensions skipped               |
| Compact scan status          | Ready           | Dynamic counters without URL or transport spam       |
| Canonical JSON results       | Ready           | Automatically written after successful scans         |
| Browser/JavaScript discovery | Not implemented | No browser automation                                |
| VAPT rules                   | Not implemented | No payloads or vulnerability tests                   |

## Requirements

- Node.js 22+
- pnpm 10+

## Install from source

```console
$ git clone https://github.com/imshreevyas/svft.git
$ cd svft
$ pnpm install
$ pnpm build
$ pnpm link --global
$ svft --version
0.1.0
```

`pnpm` is needed for installing, developing, and building the source. After `pnpm link --global`, the compiled `svft` command works from any directory; rebuild after source changes. You can also use `node dist/cli/index.js` without linking.

## CLI

Target validation sends no network traffic:

```console
$ svft target check https://example.com/docs#intro
Valid target: https://example.com/docs
```

The default discovery depth is `0`, so only the seed is requested. A depth-1 scan looks like:

```console
$ svft scan https://example.com --depth 1
SVFT — Security Vulnerability Finding Tool
Version 0.1.0

Target: https://example.com/
Depth: 1

⠋ Scanning · 12 requested · 4 queued · 0 failed · 3s

✓ Scan complete

Target: https://example.com/
Depth: 1

URLs discovered: 12
URLs requested: 12
Failed: 0
Duration: 4.2s

Result:
svft-results/scan-<scan-id>.json
```

Interactive terminals update one spinner line in place. Redirected/non-TTY output receives a concise newline-safe status without terminal control characters. SVFT does not display a percentage because the final URL count is unknown while discovery is growing.

Discover direct links with depth `1`, or links from those pages with depth `2`:

```console
$ svft scan https://example.com --depth 1
$ svft scan https://example.com --depth 2 --request-delay 250
$ svft scan https://example.com --timeout 15000 --retries 3
$ svft scan https://example.com --no-follow-redirects
```

## Scan options

| Flag                      |      Default | Validation/behavior                          |
| ------------------------- | -----------: | -------------------------------------------- |
| `--timeout <ms>`          |      `10000` | Positive integer                             |
| `--retries <count>`       |          `2` | Non-negative integer                         |
| `--retry-delay <ms>`      |        `500` | Non-negative integer                         |
| `--follow-redirects`      |       `true` | Enable redirects                             |
| `--no-follow-redirects`   |            - | Disable redirects                            |
| `--max-redirects <count>` |          `5` | Non-negative integer                         |
| `--concurrency <count>`   |          `5` | Validated; discovery is currently sequential |
| `--depth <count>`         |          `0` | Maximum discovery depth                      |
| `--request-delay <ms>`    |          `0` | Delay between discovery requests             |
| `--no-verify-tls`         |            - | Disable certificate verification             |
| `--user-agent <value>`    | `SVFT/0.1.0` | Non-empty string                             |

Custom headers exist in the internal configuration model but are not exposed as a CLI option.

## Discovery behavior

- Extracts HTML `<a href>` links and passive `<form>` metadata without submitting forms.
- Includes a deduplicated endpoint inventory with query/form parameter names and provenance; values are never stored.
- Adds deterministic request/response fingerprints for fetched endpoint evidence and removes same-page duplicate forms.
- Passively reads same-origin robots.txt Sitemap directives and bounded sitemap XML URLs/indexes; sitemap files are never treated as endpoints.
- Discovered URLs retain `url` or `sitemap` source provenance; sitemap processing is capped at 32 documents and 1,000 URL entries per scan.
- Endpoint identity uses method, path, and query-name shape; duplicate forms are collapsed canonically while cross-page provenance is retained.
- Derives a passive security target inventory in ScanResult from existing discovery data. Target identity is exact method plus normalized URL; duplicate targets merge parameter names and provenance in first-seen order.
- Scan flow: Target -> ScanConfig -> ScanContext -> HTTP Engine -> URL/Form discovery -> Endpoint/Parameter inventory -> fingerprints -> DiscoveryResult -> Security Target Inventory -> ScanResult -> JSON.
- Resolves absolute, root-relative, relative, and query-only URLs against the final response URL.
- Removes fragments, normalizes with the shared target parser, and preserves meaningful queries.
- Stays on the seed origin (scheme, host, and effective port must match).
- Skips unsupported protocols and common static assets.
- Deduplicates URLs while preserving deterministic FIFO discovery order.
- Parses declared HTML; when `Content-Type` is absent, accepts only a conservative HTML-shaped body.
- Uses the centralized HTTP Engine for all requests and redirects.
- Emits small progress events; the CLI derives requested, queued, and failed counters without printing every URL.
- Sends GET requests only; form GET/POST methods are recorded passively and never submitted.

## Inspecting Results

Every successfully completed scan creates one UTF-8, indented JSON file:

```text
svft-results/
└── scan-<scan-id>.json
```

The canonical result contains the scan ID, normalized target, start/completion timestamps, duration, resolved configuration, complete discovery result, and passive security target inventory. Inventory URLs preserve concrete GET query values while parameter names remain separate metadata. Files are created exclusively and never overwritten. Failed seed scans do not create successful result files.

## Architecture

```text
CLI -> Target -> ScanConfig -> ScanContext
                                  |
                                  v
                         Discovery Engine
                         /              \
                 HTTP Engine <------ URL Queue
                                  |
                                  v
                           DiscoveryResult
                                  |
                                  v
                    Security Target Inventory
                                  |
                                  v
                         ScanResult -> JSON
```

SVFT remains one package with no database, UI, Docker, monorepo, or plugin system. See [Architecture](docs/ARCHITECTURE.md) and [Project Context](docs/PROJECT_CONTEXT.md).

## Development

```console
$ pnpm dev -- scan http://localhost:3000 --depth 1
$ pnpm format
$ pnpm format:check
$ pnpm typecheck
$ pnpm lint
$ pnpm test
$ pnpm build
```

Tests use deterministic local HTTP/HTTPS servers and do not require internet access.

## Roadmap

| Stage | Scope                                | Status   |
| ----: | ------------------------------------ | -------- |
|     1 | CLI foundation and target validation | Complete |
|   2.1 | Dynamic scan configuration           | Complete |
|   2.2 | Centralized HTTP Engine              | Complete |
|     3 | Bounded same-origin URL discovery    | Complete |
|   3.1 | Live progress and canonical JSON     | Complete |
|     4 | Focused VAPT rules with evidence     | Planned  |
|     5 | Additional report formats            | Planned  |

Future roadmap items are not included until explicitly implemented.

## Project records

- [PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — detailed current state and decisions
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — component boundaries and data flow
- [changes.log](changes.log) — timestamped implementation history

## License

[MIT](LICENSE)
