# svft-discovery

`svft-discovery` is a standalone, TypeScript-based library and CLI for safe, bounded, same-origin web discovery. It collects URLs and passive endpoint metadata for authorized targets; it is not a vulnerability scanner.

> Scan only systems you own or are explicitly authorized to test.

## Capabilities

- Validates and normalizes HTTP(S) targets without network access.
- Crawls same-origin document URLs with deterministic FIFO ordering and bounded depth.
- Reads links, passive HTML forms, same-origin JavaScript text, `robots.txt`, and bounded sitemap documents.
- Preserves URL, depth, source, and ordered provenance metadata.
- Produces endpoint and parameter inventories without storing form values or response bodies in the public discovery output.
- Uses one centralized HTTP(S) client with timeouts, safe retries, redirect limits, request-local TLS verification, and response-size limits.
- Writes canonical, indented JSON scan records from the CLI.

It does not submit forms, execute JavaScript, use a browser, test payloads, authenticate, fingerprint technologies, or report vulnerabilities.

## Requirements and installation

- Node.js 22+
- pnpm 10+

Install from a checkout:

```sh
git clone <repository-url> svft-discovery
cd svft-discovery
pnpm install
pnpm build
pnpm link --global
svft --version
```

The package name is `svft-discovery`; the preserved CLI command is `svft`. The package is not currently published to a registry. You may also run `node dist/cli/index.js` directly after building.

## CLI usage

Target checking is local validation only and makes no network requests:

```sh
svft target check https://example.com/docs#intro
# Valid target: https://example.com/docs
```

Run bounded discovery:

```sh
svft scan https://example.com --depth 1
svft scan https://example.com --depth 2 --request-delay 250
svft scan https://example.com --timeout 15000 --retries 3
svft scan https://example.com --no-follow-redirects
```

The default depth is `0`, which requests only the seed URL. The CLI shows compact requested, queued, failed, and elapsed counters, then writes a JSON record to `svft-results/scan-<scanId>.json`. It does not print response bodies, headers, detailed URL lists, retry details, or a misleading completion percentage.

| Flag                                           |      Default | Meaning                                        |
| ---------------------------------------------- | -----------: | ---------------------------------------------- |
| `--timeout <ms>`                               |      `10000` | Positive request timeout                       |
| `--retries <count>`                            |          `2` | Non-negative safe retry count                  |
| `--retry-delay <ms>`                           |        `500` | Non-negative delay between retries             |
| `--follow-redirects` / `--no-follow-redirects` |      enabled | Redirect policy                                |
| `--max-redirects <count>`                      |          `5` | Non-negative redirect limit                    |
| `--concurrency <count>`                        |          `5` | Validated; discovery is currently sequential   |
| `--depth <count>`                              |          `0` | Maximum discovery depth                        |
| `--request-delay <ms>`                         |          `0` | Delay between discovery requests               |
| `--no-verify-tls`                              |          off | Disable certificate verification for this scan |
| `--user-agent <value>`                         | `SVFT/0.1.0` | Request User-Agent                             |

## Library usage

The package root and `svft-discovery/discovery` subpath expose the same deliberately narrow public API:

```ts
import { discover } from 'svft-discovery';

const result = await discover('https://example.com', {
  config: { crawlDepth: 1 },
});

console.log(result.schemaVersion); // svft.discovery/v1
console.log(result.discoveredUrls);
```

```ts
discover(
  target: string | URL,
  options?: {
    config?: ScanConfigOverrides;
    client?: HttpClient;
    signal?: AbortSignal;
    onEvent?: DiscoveryEventHandler;
  },
): Promise<DiscoveryOutputV1>
```

`discover()` owns target normalization and configuration resolution. `client` supports deterministic integration tests, `signal` cancels work, and `onEvent` receives synchronous progress events. Neither extraction helpers nor crawler internals are public exports.

## Output and `svft.discovery/v1`

`discover()` returns `DiscoveryOutputV1` with this stable shape:

```ts
{
  schemaVersion: 'svft.discovery/v1';
  target: string;
  configuration: DiscoveryConfiguration;
  seed: DiscoveredUrl;
  discoveredUrls: DiscoveredUrl[];
  forms: DiscoveredForm[];
  endpoints: DiscoveredEndpoint[];
  failures: DiscoveryFailure[];
  statistics: DiscoveryStatistics;
}
```

`discoveredUrls` preserve normalized concrete URLs, depth, parent URL, source, and ordered provenance. `forms` contain normalized same-origin GET/POST actions and field names/types/boolean metadata, never values. `endpoints` combine URL and form metadata; identity is method + normalized path + query-name shape, while the first-seen concrete query values are retained. `failures` are safe plain code/message/URL records. `statistics` reports requested, discovered, form, endpoint, and failure counts.

The configuration in this public output excludes request headers. The output also excludes response bodies, form values, errors' causes/stacks, redirect/transport internals, and live `URL`/`Target` objects. Within v1, required fields, URL normalization, provenance meanings, endpoint identity, and these sanitization rules are stable. Compatible additions may be optional; incompatible changes require a new schema version.

The CLI's scan record is a downstream `ScanResult` JSON document. It adds scan identity/timing, resolved configuration with empty persisted headers, the discovery result, and a derived passive target inventory.

## Security guarantees and boundaries

- Discovery uses GET requests only. Forms are metadata and are never submitted.
- URLs stay within the seed's exact origin; cross-origin links and redirects are not followed.
- TLS verification is enabled by default and is request-local.
- Crawling is sequential, depth-bounded, deduplicated, and capped for sitemap and discovered-URL processing.
- JavaScript is treated as text only; it is never executed.
- Credentials in target URLs are stripped before discovery/results, and sensitive headers are excluded from persisted output and fingerprints.

Discovery still sends network requests to authorized same-origin targets. A completed run means discovery completed within its configured boundary; it does not mean the target is secure.

## Development and testing

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

For local CLI development:

```sh
pnpm dev -- scan http://localhost:3000 --depth 1
```

Tests use deterministic loopback HTTP/HTTPS servers and do not require internet access.

See [Architecture](docs/ARCHITECTURE.md), [Project Context](docs/PROJECT_CONTEXT.md), [Contributing](CONTRIBUTING.md), and [changes.log](changes.log) for project details.

## Roadmap

The project is intentionally limited to standalone discovery. Near-term work should improve only discovery usability, documentation, test coverage, and stable package maintenance. Authentication, technology detection, CVE matching, vulnerability rules, payload testing, dashboards, browsers, databases, plugins, and alternative report formats are outside this repository's scope.

## License

[MIT](LICENSE)
