# Contributing to svft-discovery

Thanks for helping improve standalone, safe web discovery.

## Scope

Contributions must preserve the repository boundary: bounded, passive, same-origin discovery and its CLI/library support. Do not add authentication, technology detection, CVE matching, vulnerability rules, payloads, active form submission, browsers, dashboards, databases, plugins, or report formats without an explicitly accepted scope change.

Preserve the public `discover()` API and `svft.discovery/v1` contract. Changes to URL normalization, provenance, endpoint identity, sanitization, HTTP semantics, resource limits, or CLI behavior need focused tests and documentation.

## Development

Use Node.js 22+ and pnpm 10+:

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Use deterministic loopback fixtures for network tests. Do not make tests depend on the public internet. Keep changes small, avoid new dependencies unless necessary, and never add test credentials, tokens, or target data.

## Pull requests

Describe the behavior change, its security/scope impact, and the checks you ran. Update `README.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, and `changes.log` when a change affects public behavior, architecture, or project boundaries.
