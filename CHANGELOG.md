# Changelog

All notable changes to Mavio-MCP land here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added — Per-principal upstream OAuth vault + injection (Phase 5 sub-steps 5.1a–5.1f, ADR-018 + ADR-019)
- New pkg `@mavio/upstream-auth` — envelope-encrypted Postgres vault keyed by `(principal_id, provider_id)`. AES-256-GCM per row, DEK wrapped by KEK selected from an ordered keyring (`MAVIO_VAULT_KEYRING="v3:<b64>,v2:<b64>,...`). Vault supports lazy rewrap under the current primary key on next touch.
- Three built-in `UpstreamCredentialProvider` implementations:
  - `Oauth2PkceProvider` — generic RFC 7636 auth-code + PKCE flow with in-memory state store (PkceStateStore pluggable for multi-node).
  - `SlackUserProvider` — Slack OAuth v2 `user_scope` flow (`xoxp-…` user tokens). Parses `authed_user.access_token` from response; falls back to top-level bot-only shape. Injects `SLACK_BOT_TOKEN=<xoxp>` on stdio env — the community `@modelcontextprotocol/server-slack` reads that variable and Slack Web API accepts user tokens where bot tokens work.
  - `TokenExchangeProvider` — RFC 8693 token-exchange for Keycloak SSO + KrakenD-style audience-restricted downstream tokens. No browser round-trip; `mint()` produces a downstream token from the caller's existing Mavio session's subject token.
- `UpstreamTokenService` in `apps/server/src/upstream-auth.module.ts` — hooked into `RouterService.callTool` **before** the circuit breaker. Looks up the credential for `(principal.id, descriptor.metadata.upstreamOAuthProvider)`, refreshes when within 60s of expiry (or re-mints for token-exchange providers), and injects env/header into a cloned `ServerDescriptor` (never mutates the cached one).
- Missing credential → JSON-RPC error `-32020` `upstream consent required` with `data.providerId` + `data.consentUrl` so the web console can redirect the user through the provider's OAuth flow. Non-interactive providers (`TokenExchangeProvider`) mint automatically without ever surfacing `-32020`.
- Migration adds `principal_upstream_credentials` table with envelope columns (`key_id, wrapped_dek, iv, auth_tag, ciphertext`), scopes, expiry, issuer + subject metadata, unique on `(principal_id, provider_id)`. Includes indexes on `expires_at` and `key_id` for the ADR-019 retire gate.
- Vitest coverage across the new work: 13 vault + keyring tests, 9 PKCE tests, 6 Slack tests, 8 token-exchange tests, 5 `applyInjection` tests — 41 new tests total, all green.
- Two ADRs landed: `ADR-018` (Proposed) — per-principal upstream OAuth vault + injection middleware. `ADR-019` (Proposed) — envelope-encryption keyring with downtime-free rotation, KMS-optional. Both under `docs/architecture/adr/`.

## [1.0.0] — 2026-08-05

Phase 4 (Scale & Polish) complete. This is the v1.0 GA — end of the architecture-doc scope. Rolls up: WebSocket transport (client + `/mcp/ws` gateway), external registry sources (etcd + Consul with Postgres mirror sync), OPA + Cedar policy engines, SAML + mTLS via trusted-proxy header resolver + native mTLS peer-cert resolver, region-namespaced capability cache + router region filter, and a signed plugin marketplace client + admin API.

All Phase 4 sub-steps are env-gated so existing deployments upgrade with zero behavior change — features light up only when their env flag / URL is set.

Test totals across new suites: 5 (external registry) + 6 (rbac-opa) + 9 (federated-auth) + 4 (cache regional) + 9 (marketplace) — 33 new tests, all green alongside the existing 5 audit tests.

### Added — Public plugin marketplace (Phase 4 sub-step 4f)
- New pkg `@mavio/marketplace` with `MarketplaceClient`:
  - `fetchIndex(force?)` — GETs configured index URL (60s in-memory cache) returning `{version, generatedAt, plugins:[{name, version, tarballUrl, sha256, signature?, ...}]}`.
  - `search(q)` — substring match on name / description / keywords.
  - `get(name)` / `download(entry)` — pulls tarball via `undici`, hashes bytes with SHA-256, throws `MARKETPLACE_INTEGRITY` on mismatch. Optional Ed25519 signature verified via `crypto.verify("ed25519", ...)` against a configured PEM public key.
- `MarketplaceController` on `@mavio/server`: `GET /api/marketplace?q=` + `GET /api/marketplace/get?name=` guarded by `plugin:install`. Enabled via `MAVIO_MARKETPLACE_URL` + optional `MAVIO_MARKETPLACE_PUBKEY_PEM`. Returns `{enabled:false, results:[]}` when disabled — so the web console can render a placeholder without erroring.
- Vitest coverage: 9 tests (index caching, search-by-name/desc/keyword, 5xx failure, download sha match/mismatch, Ed25519 verify success/failure, missing-key rejection).

### Added — Multi-region router + regional caches (Phase 4 sub-step 4e)
- `CapabilityCache` constructor now accepts `{ region }`. Keys become `mavio:cap:<region>:<serverId>` + `mavio:servers:<region>:list`. Legacy `new CapabilityCache(redis, ttlNumber)` still works (region defaults to `"default"`).
- `cache.module` reads `MAVIO_REGION` env, exposes it via new `REGION` DI token, wires into `CapabilityCache`.
- `RouterService.loadServers` now filters through `filterByRegion` — a server with `metadata.region` different from `MAVIO_REGION` is dropped. Region-untagged servers remain globally routable so mixed deployments keep working.
- Two regions can safely share the same Redis; keys never collide.
- Vitest coverage: 4 tests (default prefix, region-scoped keys, cross-region isolation, legacy numeric ttl arg).

### Added — SAML + mTLS auth providers (Phase 4 sub-step 4d)
- `federated-auth.ts`: two resolvers layered ahead of the existing session/bearer chain in `resolvePrincipalFromRequest`:
  - `trustedHeaderPrincipal(req)` — reads `X-Auth-Subject / -Type / -Workspace / -Scopes` when `MAVIO_TRUSTED_PROXY_ENABLED=1`. Enterprise deployments front the server with a reverse proxy (Envoy, oauth2-proxy, Pomerium) that terminates SAML SSO / mTLS and forwards a verified subject; this is the industry-standard zero-trust pattern.
  - `mtlsPrincipal(req)` — reads `req.socket.getPeerCertificate()` when `MAVIO_MTLS_ENABLED=1`. Requires the Node HTTPS server to be started with `requestCert: true`. Only accepts sockets where `socket.authorized === true`; produces `id: "cn:<CN>"`, `type: service`.
- Vitest coverage: 9 tests (flag off/on, defaults, unknown type coercion, unauthorized peer rejection, CN missing).

### Added — OPA/Cedar RBAC adapter (Phase 4 sub-step 4c)
- New pkg `@mavio/rbac-opa`. Three engines share one HTTP path:
  - `RemoteHttpPolicyEngine` — generic base. Sends `{input:{principal, action, resource}}` and parses `{result:{allow,reason}}` / `{allow,reason}` / bare boolean shapes. Fail-closed on error/timeout/unknown shape.
  - `OpaPolicyEngine` — thin subclass targeting an OPA server, typically `http://opa:8181/v1/data/mavio/authz/allow`.
  - `CedarSidecarPolicyEngine` — wraps payload in Cedar entity refs (`Mavio::User::"..."`, `Mavio::Action::"..."`).
- `rbac.module` factory reads `MAVIO_RBAC_ENGINE=builtin|opa|cedar` (+ `_URL`, `_TOKEN`). Falls back to builtin engine when kind is unknown or URL missing; logs the choice at boot.
- 2s default request timeout via `AbortController`, so a stalled policy service can't wedge the request path.
- Vitest coverage: 6 tests (OPA allow, flat deny, 5xx fail-closed, unknown shape fail-closed, Cedar payload envelope, timeout fail-closed).

### Added — External registry sources (Phase 4 sub-step 4b)
- New pkg `@mavio/registry-external` with `ExternalRegistrySource` interface + `createRegistrySource({kind})` factory.
- `EtcdSource` — talks to etcd v3 gRPC-JSON gateway (`POST /v3/kv/range`) with base64 prefix + range_end. Optional bearer token.
- `ConsulSource` — talks to Consul HTTP KV (`GET /v1/kv/<prefix>?recurse`) with optional ACL token + datacenter. Returns `[]` on 404.
- Both are stateless HTTP over `undici` — no additional client deps.
- `ExternalRegistrySync` module on `@mavio/server` polls the configured source on an interval (default 30s), fingerprint-diffs each `ServerDescriptor`, upserts into Postgres `Registry` and publishes `{kind:"servers"}` on `InvalidationBus` when anything changes. Env-gated:
  - `MAVIO_EXTERNAL_REGISTRY=etcd|consul`
  - `MAVIO_EXTERNAL_REGISTRY_ENDPOINT` (required)
  - `MAVIO_EXTERNAL_REGISTRY_PREFIX` / `_TOKEN` / `_DC` / `_INTERVAL_MS` (optional)
- Postgres remains source of truth for RBAC/snapshots/audit; external KV feeds service discovery only.
- Vitest coverage: 5 tests using `undici.MockAgent` (etcd range decode, 5xx error, malformed skip; Consul 404 → `[]`, recursive KV decode with null values filtered).

### Added — WebSocket transport (Phase 4 sub-step 4a)
- `WsTransportDescriptor` in `@mavio/core` (`type:"ws"`, url, headers, auth, optional subprotocol). Added `"ws"` to the `TransportKind` union already reserved.
- `@mavio/transport` new `WsTransport`/`WsSession` upstream client (uses `ws` pkg). Frames correlated by `id`; notifications fire-and-forget. Reuses `bearerHeaderFromAuth` for auth headers. Registered in `TransportManager`.
- Downstream `ws.gateway.ts` on `@mavio/server`: attaches `WebSocketServer({ noServer:true })` to Nest's HTTP server on `/mcp/ws`. Per-socket principal via `resolvePrincipalFromRequest` (upgrade headers). Each incoming JSON-RPC frame dispatched through `RouterService.handle`; response written back on same socket. 15s ping keep-alive.
- `main.ts` grabs `RouterService` + `RBAC_REPO` from Nest and calls `attachWsGateway` after `app.listen`.

## [0.2.0] — 2026-08-04

Phase 2 (Enterprise) + Phase 3 (Extensibility & Ops) complete. Rolls up: OIDC + Redis session, web login UI, RBAC 4-scope engine, SSE transport (with per-call fanout), Inspector schema explorer, playground replay/export, audit logs, test suite (29 tests) — plus Phase 3 Plugin Manager/SDK, GraphQL polish, MCP-mirror importer, circuit breaker + per-server rate limit, Prometheus metrics, OpenTelemetry tracing, Helm chart + K8s manifests + Dockerfile.

### Added — Test suite (Phase 2)
- Vitest added to root + `@mavio/core`, `@mavio/rbac`, `@mavio/registry`, `@mavio/server`.
- Coverage: `CircuitBreaker` state machine (5 tests), `bearerHeaderFromAuth` + `resolveSecretRef` (7), `BuiltinRbacEngine` allow/deny/scope/wildcard/inheritance (7), `diffCapabilities` added/removed/changed/unchanged (5), `clientIp` header/ip/socket fallbacks (5). 29 tests, `pnpm test` runs all via turbo.

### Added — Audit logs (Phase 2)
- `audit_logs` table (`id uuid`, `at`, `actor_id`, `actor_type`, `action`, `resource jsonb`, `outcome`, `metadata jsonb`, `ip`) + indexes on `at`, `actor_id`, `action`. Migration in `packages/registry/src/migrate.ts`.
- `AuditRepository` (`@mavio/registry`): `record()` + `list({ actorId, action, outcome, since, limit })` — hard cap 500.
- `AuditModule` (Global) + `AuditService` — fire-and-forget writes (`.log()`), `clientIp()` helper extracting `x-forwarded-for` / `req.ip`.
- Hooks wired: `LoginController.callback` (`auth.login`, includes `created` flag + email), `LoginController.logout` (`auth.logout`), `RbacGuard` (`rbac.deny` with `required` action + `reason`), `RouterService.callTool` (`tool.invoke` in finally, `outcome`/`durationMs`).
- `GET /api/audit?actor=&action=&outcome=&since=&limit=` guarded by new `Actions.AuditRead` (added to `admin` builtin role).

### Added — Playground replay + export (Phase 2)
- `POST /api/playground/runs/:id/replay` — fetches original run, re-invokes tool with stored args, records new run, returns `{ runId, latencyMs, response, replayedFrom }`. Guarded by `tool:invoke`.
- `GET /api/playground/runs/export?server=&format=json|ndjson&limit=` — attachment download; NDJSON streams line-per-run, JSON returns pretty-printed array. Limit capped at 1000.

### Added — SSE per-call response fanout (Phase 2)
- `SseSessionRegistry` — per-connection `sid → Response` map; `send(sid, frame)` writes `event: message` SSE frame.
- `GET /mcp/sse` now allocates a `sid` and emits `event: endpoint\ndata: /mcp?sid=<sid>` so classic MCP clients POST correlated frames back to the same stream.
- `POST /mcp?sid=<sid>` — when sid matches a live SSE session, response frame is delivered over SSE and HTTP responds `202`; otherwise HTTP-JSON behavior unchanged.

### Added — Deployment story (Phase 3 sub-step 3g)
- `deploy/helm/mavio-mcp/` full Helm chart: Deployment / Service / Ingress / ConfigMap / Secret / ServiceAccount / ServiceMonitor. Prometheus scrape annotations by default; ServiceMonitor opt-in. Locked-down PodSecurityContext (non-root, read-only rootfs, drop-ALL caps).
- `deploy/k8s/` raw manifest reference for Helm-less installs (+ README).
- `deploy/docker/Dockerfile` multi-stage build (`pnpm -r build` → `pnpm deploy --prod`) producing a slim server-only runtime image.

### Added — OpenTelemetry tracing (Phase 3 sub-step 3f)
- `@mavio/observability` bootstrap: NodeSDK + BatchSpanProcessor + OTLP HTTP exporter, gated on `OTEL_EXPORTER_OTLP_ENDPOINT` (or console exporter via `MAVIO_OTEL_DEBUG=1`). No-op when neither set.
- `withSpan()` helper (auto OK/ERROR status + exception record) + `injectTraceHeaders()` for outbound W3C traceparent propagation.
- `main.ts` bootstraps SDK before Nest; graceful `SIGTERM`/`SIGINT` shutdown flushes spans.
- `RouterService.callTool` wraps dispatch in a `SERVER`-kind span with `mavio.server.id / tool.name / transport.kind / principal.id` attributes.
- OpenAPI + GraphQL dispatchers inject traceparent on upstream HTTP calls.

### Added — Prometheus metrics (Phase 3 sub-step 3e)
- `@mavio/observability` new pkg: `MavioMetrics` (prom-client Registry + `collectDefaultMetrics`).
- Series: `mavio_router_requests_total{server,tool,outcome}`, `mavio_router_request_duration_seconds` (histogram), `mavio_breaker_state{server}` (0/1/2), `mavio_rate_limit_denied_total{server,scope}`, `mavio_upstream_errors_total{server,kind}`, `mavio_importer_runs_total{kind,outcome}`.
- `GET /metrics` controller (Prom text exposition; `Cache-Control: no-store`).
- `RouterService.callTool` labels every call by outcome (`ok|error|circuit_open`) and updates breaker gauge from `snapshot()` in `finally`.
- `ImportsController.trackImport(kind, fn)` wraps each importer path.

### Added — MCP-mirror importer + resilience layer (Phase 3 sub-steps 3c + 3d)
- **MCP-mirror importer** (`@mavio/import-mcp`): open transport (stdio/http/sse), send `initialize` + `tools/list`, snapshot tools and register as Mavio server. `POST /api/imports/mcp` guarded by `server:write`. CLI `mavio import mcp --id X --stdio|--http|--sse ... [--auth secret://ENV]`.
- **Native MCP dispatch fix**: `dispatchNativeMcp` was omitting `params.name` — real MCP backends 400'd on `tools/call`. RouterService now threads `toolName` through `dispatchByKind`.
- **Circuit breaker** (`@mavio/core CircuitBreaker`): per-server closed/open/half_open state machine. RouterService wraps every `dispatchByKind` call keyed by serverId. Open state returns JSON-RPC error `-32010` with retry-at instead of hammering the backend. Config: `router.circuitBreaker.{failureThreshold=5, resetMs=30000, halfOpenMaxCalls=1}`.
- **Per-server rate limit**: Redis-backed `RateLimiter` on router-level; keyed by `serverId+principal.id`, driven by `descriptor.metadata.rateLimitRpm` (60s bucket, RPM). JSON-RPC error `-32011` when exceeded. Router-global HTTP interceptor unchanged.
- **Centralized broker auth** (`bearerHeaderFromAuth` in `@mavio/core`): dedups `secret://X → env X` logic previously triplicated across http/sse/graphql. Same wire behavior, one source.

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
