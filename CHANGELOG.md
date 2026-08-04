# Changelog

All notable changes to Mavio-MCP land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added — GraphQL importer polish (Phase 3 sub-step 3b)
- Introspection query pulls `inputFields`, `enumValues`, deprecation flags; `TypeRef` fragment expands `ofType` up to 5 levels.
- JSON schema mapping fixed: `LIST` → `{ type: array, items: <inner> }`; `Int` → `integer`; `INPUT_OBJECT` expanded recursively (cycle-guarded, depth 3); `ENUM` → `{ type: string, enum: [...] }`.
- Meta shape carries per-arg `gqlType` (from schema, not from arg value at dispatch) — Int/Float/Boolean args no longer stringified when building GraphQL variables.
- Auto scalar+enum leaf selection for object return types, configurable depth (default 2, max 4), cycle-guarded. Skips fields requiring args to avoid invalid queries.
- `dispatchGraphql` filters out undefined args before building variable definitions.
- `importGraphql({ selectionDepth })` opt-in.
- `router.service.ts` meta shape updated to match.

### Added — Plugin Manager + `@mavio/sdk` v1 (Phase 3 sub-step 3a)
- **`@mavio/sdk`** new pkg: `PluginManifest`, `PluginContext`, `Importer` / `TransportAdapter` / `Middleware` / `AuthProvider` interfaces, `MAVIO_API_VERSION="1.0.0"` constant. Public surface for plugin authors.
- **`@mavio/plugin`** new pkg: `PluginManager` with local `node_modules/@mavio-plugin/*` discovery, semver gate on `manifest.mavioApi` vs host `MAVIO_API_VERSION`, `loadAll` / `enable` / `disable` / `list`. In-memory registries for importers/transports/middleware/auth. `PluginStateStore` interface + `InMemoryStateStore` default.
- **DB**: `plugins` table (name PK, version, enabled, package_dir, timestamps) + `PluginRepository` (`list`, `upsert`, `setEnabled`). Wired into migrate.ts.
- **Server**: `PluginModule` (Global) bootstraps manager, discovers on startup, persists via DB-backed `PluginStateStore`. `PluginsController` — `GET /api/plugins`, `POST /api/plugins/:name/enable|disable`, guarded by `plugin:install` RBAC action.
- **CLI**: `mavio plugin list|enable|disable` hits admin API.
- Pre-existing build blockers fixed in passing: `MavioError.cause override`, `@mavio/cache` ioredis named import, `@mavio/server` missing `kysely`/`@types/pg` deps, `RouterService` method cast.
- **Deferred (TODO)**: VM2/worker sandbox isolation, remote install + Sigstore verify, UI extension surface, middleware hook wiring in `RouterService`.

### Added — Inspector schema explorer (Phase 2)
- `SchemaTree` component (apps/web/src/components/schema-tree.tsx) — renders JSON Schema properties as a tree with type, required marker, format, enum, description, and nested object/array.
- `ToolExplorer` (client component) — search filter by tool name/description + raw JSON toggle. Auto-expands schemas when filtered ≤ 5.
- `/servers/:id` page now embeds `ToolExplorer`; snapshot diff remains at `/servers/:id/history` — Phase 2 "full Inspector" complete.

### Added — SSE transport (Phase 2)
- **Upstream**: `sse` `TransportDescriptor` kind in `@mavio/core`. `SseTransport` in `@mavio/transport` — classic MCP HTTP+SSE client: GET `text/event-stream`, awaits `event: endpoint`, POSTs frames to endpoint, correlates responses by frame.id. `TransportManager` registers it.
- **Downstream**: `GET /mcp/sse` (SseController) — emits `event: endpoint` = `/mcp`, then pushes `notifications/tools/list_changed` frames whenever `InvalidationBus` fires. Keep-alive every 15s. Unsubscribe on client disconnect.
- Per-call streaming responses (correlated by frame.id on same SSE stream) TODO — needs response fanout in `RouterService`.

### Added — OIDC default role auto-assign (Phase 2 sub-step 2c)
- `RbacRepository.ensurePrincipal({...})` — insert-if-new via `ON CONFLICT DO NOTHING`, returns `{ created, principal }`.
- `LoginController.callback` uses `ensurePrincipal`; when `created && MAVIO_OIDC_DEFAULT_ROLE` set, assigns that role at workspace scope. First-login users no longer land role-less. Assign failure is warned, not fatal.

### Added — Web login UI + auth-aware nav (Phase 2)
- `/login` page (apps/web/src/app/login/page.tsx) — server-fetches enabled providers and renders one link per provider (`${API_URL}${loginUrl}?return_to=…`).
- `Nav` converted to client component — calls `GET /auth/me` on mount, shows displayName + Sign out button when session present, Sign in link otherwise.
- `lib/api.ts` adds `listAuthProviders`, `fetchMe`, `logout` (all use `credentials: "include"` for session cookie).

### Added — OIDC login + Redis session (Phase 2 sub-step 2b)
- Dependency: `openid-client@^5.7`, `cookie@^0.6`, `@types/cookie`.
- `SessionStore` (apps/server/src/session.store.ts) — Redis-backed sessions (`mavio:sess:<sid>`) + short-lived OIDC state store (`mavio:oidc:state:<state>`, TTL 10 min). `MAVIO_SESSION_TTL_SECONDS` env, default 86400 (1 day).
- `OidcClientCache` — lazy `Issuer.discover` per provider, client cached 1h in memory; client secret resolved from env `client_secret_ref` at each call (rotation-safe, no plaintext at rest).
- `LoginController`:
  - `GET /auth/:providerId/login?return_to=/some/path` — PKCE (S256) + `state` + `nonce`, redirect to authorize endpoint. `return_to` restricted to same-origin paths.
  - `GET /auth/:providerId/callback` — verifies state+nonce, exchanges code, idempotent-upsert principal `oidc:<providerId>:<sub>`, creates session, sets `mavio_sid` cookie (HttpOnly, SameSite=Lax, Secure in prod), redirects to `return_to`.
  - `POST /auth/logout` — clears session + cookie.
  - `GET /auth/me` — returns current session principal + claims.
- `resolvePrincipalFromRequest` now checks `mavio_sid` cookie (via injected `SessionStore`) BEFORE Bearer token. Applies to admin API (`ApiKeyGuard`). MCP endpoint `POST /mcp` deliberately does NOT accept session cookie — Bearer API key only.
- `SessionModule` wires `SessionStore`, `OidcClientCache`, TTL from env.

### Added — OIDC provider registry (Phase 2 sub-step 2a)
- New table `oidc_providers` (id, display_name, issuer_url, client_id, client_secret_ref, redirect_uri, scopes, enabled).
- `OidcProviderRepository` in `@mavio/registry` — list/get/upsert/delete.
- `AuthModule` + `AuthController` in server:
  - `GET /auth/providers` — public list of enabled providers (id, displayName, loginUrl only).
  - `GET|PUT|DELETE /api/auth/providers[/:id]` — admin CRUD (WorkspaceAdmin scope).
- Client secret stored as env-var reference (`client_secret_ref`), not plaintext.
- Login/callback + Redis session + `openid-client` integration land in sub-step 2b.

### Changed — RBAC wiring cleanup (Phase 2 start)
- Extracted shared `resolvePrincipalFromRequest` (apps/server/src/principal-resolver.ts); `ApiKeyGuard` and `RouterController` now use it — removed duplicated Bearer / admin-key / dev-mode logic.
- `RbacRepository.listAssignments(principalId?)` returns assignments with row `id`.
- `GET /api/rbac/assignments?principalId=...` (WorkspaceAdmin scope).
- Note: the 4-scope engine (workspace/project/server/tool), builtin roles, DB-backed assignments, and `RbacGuard` were already implemented earlier in this Unreleased cycle — earlier "stubbed to `*`" note superseded. `*` remains only as the admin/dev backdoor via `MAVIO_ADMIN_API_KEY` (or unset in dev mode).

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
- No SQL / GraphQL / MCP-mirror importers yet.
- No health probes, no circuit breakers.
- No secret provider — bearer secrets read directly from env vars.
- No test suite — Phase 2.

## [0.0.0] — 2026-08-03
- Initial repo.
