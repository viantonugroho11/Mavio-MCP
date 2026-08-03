# Changelog

All notable changes to Mavio-MCP land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added — SQL importer
- **`@mavio/import-sql`** — Postgres introspection via `information_schema`. Emits `select_<table>` (limit/offset/PK-equality filters) and `count_<table>` tools with `x-mavio-sql` dispatch metadata.
- New `TransportDescriptor` kind `sql` with `dsn`, `allowedTables`, `readOnly` (default true).
- `SqlDispatcher` — per-server pooled `pg.Pool`, `BEGIN READ ONLY` when read-only, identifier allowlist + strict quoting, hard row cap (500).
- `POST /api/imports/sql`, `mavio import sql --dsn --tables --read-only`.
- Web import form: SQL tab with DSN + allowlist + read-only toggle.

### Added — GraphQL importer
- **`@mavio/import-graphql`** — introspection over HTTP; emits `query_<field>` and `mutation_<field>` tools with argument JSON Schema and `x-mavio-graphql` dispatch metadata.
- New `TransportDescriptor` kind `graphql` with endpoint + optional bearer secretRef.
- `GraphqlDispatcher` — builds variable-typed GraphQL operation from tool call, forwards headers.
- `POST /api/imports/graphql`, `mavio import graphql --endpoint`.
- Web import form: GraphQL tab.

### Added — Inspector snapshot diff
- `Registry.listSnapshots(serverId)` + `getSnapshot(id)`.
- `diffCapabilities(a, b)` — added / removed / changed / unchanged by tool name + SHA-256 schema hash.
- `GET /api/servers/:id/snapshots`, `GET /api/servers/:id/snapshots/diff?a=&b=`.
- Web `/servers/:id/history` — pick two snapshots, three-column diff view.

### Added — Playground history
- Table `playground_runs` (principal, server, tool, args, response, latency, status, timestamp).
- `PlaygroundRepository` in `@mavio/registry`.
- `POST /api/playground/invoke` (records run), `GET /api/playground/runs`, `GET /api/playground/runs/:id`.
- Web `/playground/history` — list + detail with args + response viewer. Playground page now records every invocation.

### Added — Health probes
- `HealthProber` background loop (30s interval) — HEAD for HTTP, `__typename` query for GraphQL, `SELECT 1` for SQL. Updates `servers.status`.
- Publishes `mavio:invalidate` event so router replicas refresh their cached server list.
- Web server list: colored status dot per row.

### Added — RBAC
- **`@mavio/rbac`** — `PolicyEngine` interface, `BuiltinRbacEngine`, four-scope resource model (workspace · project · server · tool), 6 built-in roles (owner, admin, developer, operator, viewer, tool.invoker), explicit deny > allow precedence, role inheritance.
- Postgres tables: `principals`, `roles`, `role_assignments` with indexes; `roles` seeded from builtin definitions on boot.
- `ApiKeyGuard` recognises DB-issued keys (`mk_*`) via SHA-256 lookup; `MAVIO_ADMIN_API_KEY` env still works as root.
- `RbacGuard` + `@RequirePermission(action, resourceFn?)` decorator on all `/api/*` handlers.
- Router now enforces `tool:invoke` against the resolved principal on every `tools/call` (dev mode still open).
- Admin API: `POST/GET /api/rbac/principals`, `POST /api/rbac/principals/:id/keys` (returns the plaintext key once), `POST/DELETE /api/rbac/assignments`, `GET /api/rbac/roles`.
- CLI: `mavio rbac principals:create`, `keys:issue`, `assign`, `roles:list`.

## [0.1.0-mvp] — 2026-08-03

First runnable scaffold. Not production-ready. API surface may break before `0.1.0`.

### Added — Architecture & docs
- Full v1.0 architecture design document (`docs/architecture/mavio-mcp-architecture.md`) — 20 sections with Mermaid diagrams.
- 14 Architecture Decision Records (`docs/architecture/adr/`) — 10 Accepted, 4 Proposed (multi-tenancy, migrations, secret rotation, license).
- Review notes + non-functional targets (`docs/architecture/review-notes.md`).

### Added — Monorepo & tooling
- pnpm workspaces + Turborepo pipeline (`build`, `dev`, `lint`, `typecheck`, `test`, `clean`).
- Base `tsconfig` — ES2022, NodeNext, strict, `noUncheckedIndexedAccess`.
- Docker Compose — Postgres 16 + Redis 7 with healthchecks.
- GitHub Actions CI — typecheck + build + test against Postgres/Redis service containers.
- `.env.example` + `mavio.config.example.yaml`.

### Added — Core packages
- **`@mavio/core`** — `ServerDescriptor`, `TransportDescriptor`, `MCPFrame`, `Principal`, typed errors.
- **`@mavio/config`** — YAML loader with Zod schema validation + `${ENV_VAR}` interpolation + `saveConfig`.
- **`@mavio/transport`** — `Transport` interface, `TransportManager`, `StdioTransport` (line-delimited JSON), `HttpTransport` (undici).
- **`@mavio/registry`** — Postgres-backed via Kysely; `register`/`unregister`/`get`/`list`/`updateStatus`/`snapshotCapabilities`/`latestCapabilities`. Ships standalone migration script.
- **`@mavio/import-openapi`** — Loads OpenAPI 3 (JSON or YAML, URL or path) → `ToolDefinition[]` with `x-mavio-http` extension for router dispatch.
- **`@mavio/cache`** — ioredis-based `CapabilityCache` (TTL), `InvalidationBus` (pub/sub with origin-skip), `RateLimiter` (fixed-window).

### Added — Server (unified NestJS app)
- `POST /mcp` — MCP router. Handles `initialize`, `tools/list`, `tools/call` with namespaced tools (`serverId.tool`).
- OpenAPI-generated tools dispatched via direct HTTP; other transports go through `TransportManager`.
- `/api/servers` — admin CRUD.
- `/api/servers/:id/capabilities` — Inspector data source.
- `/api/imports/openapi` — trigger OpenAPI import.
- `ApiKeyGuard` — bearer-token check via `MAVIO_ADMIN_API_KEY`; dev mode open when unset.
- `CacheModule` — Redis pub/sub-driven capability cache invalidation across replicas.
- `RateLimitInterceptor` on `POST /mcp` — activates when `router.rateLimit.rpm > 0`; sets `x-ratelimit-*` headers.
- Config-driven boot — `servers[]` from `mavio.config.yaml` seeded into registry on startup.

### Added — CLI (`mavio`)
- `mavio init` — scaffold `mavio.config.yaml`.
- `mavio serve` — launch the server with a chosen config/port.
- `mavio import openapi --id --url|--path` — trigger OpenAPI import via admin API.
- `mavio servers list` — enumerate registered servers.

### Added — Web console (Next.js 15, App Router, Tailwind)
- `/` — servers list.
- `/servers/:id` — Inspector: tool list + JSON schema per tool from latest capability snapshot.
- `/playground` — pick server + tool, JSON args, invoke `/mcp`, latency-timed result.
- `/imports` — OpenAPI import form → auto-redirect to new server inspector.
- Typography + palette matched to the architecture overview artifact.

### Known gaps (intentional for MVP)
- RBAC scope check is stubbed to `*` — full 4-scope engine lands in Phase 2 (see [ADR-009](docs/architecture/adr/ADR-009-rbac-builtin-opa-cedar-adapter.md)).
- No SQL / GraphQL / MCP-mirror importers yet.
- No health probes, no circuit breakers.
- No secret provider — bearer secrets read directly from env vars.
- No test suite — Phase 2.

## [0.0.0] — 2026-08-03
- Initial repo.
