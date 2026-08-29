# SVFT — Codex Agent Instructions

## Project

SVFT (Security Vulnerability Finding Tool) is a TypeScript/Node.js security scanning tool.

Read `docs/PROJECT_CONTEXT.md` before every task. Inspect the existing implementation before modifying it.

## Core Rules

* Preserve the existing architecture and working behavior.
* Make the smallest change that completes the task.
* Reuse existing types, functions, services, and patterns.
* Do not refactor unrelated code.
* Do not duplicate existing validation, HTTP, discovery, or result logic.
* Do not introduce dependencies unless required.
* Prefer Node.js built-ins and existing dependencies.
* Keep TypeScript strict, ESM, NodeNext, and existing lint/format conventions.
* Keep modules small and understandable without AI assistance.
* Update documentation/change log only when the task changes behavior or architecture.

## Architecture

Current flow:

`CLI -> Target -> ScanConfig -> ScanContext -> HTTP Engine -> Discovery -> ScanResult -> JSON`

Rules:

* `Target` owns URL validation/normalization.
* `ScanConfig` owns scan configuration/defaults/validation.
* `ScanContext` combines target + configuration for one scan.
* `HTTP Engine` is the only network layer.
* `Discovery` consumes the HTTP Engine; never implement another HTTP client.
* `ScanResult` is the canonical scan result.
* Result writers handle persistence; discovery/HTTP must not write files.
* CLI handles argument parsing and presentation, not business logic.
* `target check` must remain network-free.

## Security

* Default behavior must be safe.
* Never submit forms unless a task explicitly authorizes active testing.
* Never generate credentials or destructive payloads unless explicitly required.
* Never persist secrets, passwords, tokens, or submitted form values.
* Keep passive discovery separate from active vulnerability testing.
* Preserve target scope; never silently scan external origins.
* Do not weaken TLS verification by default.
* Do not expose stack traces or sensitive data in normal CLI output.

## Discovery

Discovery must:

* Reuse the centralized HTTP Engine.
* Normalize URLs through existing logic.
* Respect configured scope and crawl depth.
* Deduplicate normalized URLs.
* Preserve provenance when practical (`url`, `depth`, `discoveredFrom`).
* Avoid unbounded crawling.
* Keep discovery deterministic unless concurrency is explicitly implemented.
* Treat discovered metadata as data; do not automatically execute discovered requests.

Current URL discovery uses GET requests. The HTTP Engine may support additional methods structurally.

## Testing

* Preserve all existing tests.
* Add focused deterministic tests for new behavior.
* Prefer local test servers/fixtures over external websites.
* Do not make tests depend on internet availability.
* Clean up servers, timers, sockets, temporary files, and other resources.
* Test security boundaries and negative cases.
* Do not remove or weaken tests to make implementation pass.

## CLI

* Keep output concise and readable.
* Interactive progress must not pretend the crawler knows a final percentage when the total is unknown.
* Do not print full response bodies by default.
* Do not print secrets or stack traces.
* Keep `target check` lightweight and network-free.

## Results

* JSON is the canonical current result format.
* Preserve useful provenance and evidence.
* Do not silently discard meaningful response/discovery information.
* Treat persisted configuration/headers as potentially sensitive.
* Do not add new report formats unless explicitly requested.

## Implementation Workflow

1. Read `docs/PROJECT_CONTEXT.md`.
2. Inspect relevant existing code/tests.
3. Identify the smallest implementation boundary.
4. Implement only the requested capability.
5. Add/update focused tests.
6. Update affected documentation/change log.
7. Run the required verification commands.
8. Report files changed, tests, verification, and important limitations.

## Do Not

Do not automatically implement future roadmap items.

Do not add:

* Crawlee
* Playwright
* Wappalyzer
* browser automation
* databases
* plugin systems
* authentication systems
* vulnerability rules
* payload engines
* reporting formats

unless the current task explicitly requires them.

## Prompt Efficiency

Future task prompts may assume these instructions.

Do not repeat this architecture/security/project context unless the task changes it.

Prefer compact task prompts containing only:

* TASK
* REQUIREMENTS
* SECURITY (only when task-specific)
* TEST
* DO NOT
* RUN AFTER COMPLETION

Use compact flows such as:

`HTML -> extraction -> normalization -> DiscoveryResult -> JSON`

Do not add unnecessary explanations, examples, separators, or repeated instructions.
