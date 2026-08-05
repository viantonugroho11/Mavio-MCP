# Features

Every capability shipped through v1.0.0, grouped by area. Env flags marked `MAVIO_*` are opt-in unless noted; default behavior is a working single-node dev deployment.

## Importers — turn anything into MCP

| Source | Package | Endpoint / CLI |
|---|---|---|
| OpenAPI (v3) | `@mavio/import-openapi` | `POST /api/imports/openapi` · `mavio import openapi` |
| SQL (Postgres) | `@mavio/import-sql` | `POST /api/imports/sql` · `mavio import sql` |
| GraphQL | `@mavio/import-graphql` | `POST /api/imports/graphql` · `mavio import graphql` |
| Existing MCP server | `@mavio/import-mcp` | `POST /api/imports/mcp` · `mavio import mcp` |

- **OpenAPI**: pulls operations, resolves `$ref`, maps parameters to a JSON-Schema `inputSchema`.
- **SQL**: introspects tables/columns/PK/FK; optional allowlist; read-only by default.
- **GraphQL**: introspection with `inputFields`, `enumValues`, deprecation flags; recursive INPUT_OBJECT expansion (cycle-guarded, depth 3); auto scalar+enum leaf selection.
- **MCP-mirror**: opens `stdio`/`http`/`sse` transport, sends `initialize` + `tools/list`, snapshots as a Mavio-managed server.

## Transports

Downstream (Mavio → MCP clients):

| Route | Transport | Notes |
|---|---|---|
| `POST /mcp` | HTTP-JSON | Default; accepts a `?sid=` to fanout onto SSE |
| `GET /mcp/sse` | Server-Sent Events | Emits `event: endpoint` first; per-call fanout via `sid` |
| `WS /mcp/ws` | WebSocket | Full-duplex; 15s ping keep-alive |

Upstream (Mavio → backend MCP servers), from `@mavio/transport`:

- `stdio` — child process
- `http` — HTTP-JSON to a base URL
- `sse` — classic MCP HTTP+SSE (endpoint + response frames)
- `ws` — WebSocket (`WsTransport` / `WsSession`)
- `sql` — direct Postgres dispatch (`SqlDispatcher`)
- `graphql` — direct GraphQL dispatch (`GraphqlDispatcher`)

All transports support a `bearerHeaderFromAuth({ type: "bearer", secretRef: "secret://ENV_NAME" })` pattern — env resolved at dispatch time, secret never persisted.

## Registry

- **Postgres source of truth.** Server descriptors, capability snapshots, RBAC, audit, playground runs, OIDC providers, plugins.
- **Capability snapshots + diff.** `diffCapabilities()` produces added/removed/changed/unchanged per snapshot.
- **External discovery.** `@mavio/registry-external`:
  - `EtcdSource` — etcd v3 gRPC-JSON gateway.
  - `ConsulSource` — Consul KV HTTP API.
  - Server-side `ExternalRegistrySync` polls on `MAVIO_EXTERNAL_REGISTRY_INTERVAL_MS` (default 30s), fingerprint-diffs, upserts into Postgres, publishes invalidation on change.

Env:

```
MAVIO_EXTERNAL_REGISTRY=etcd|consul
MAVIO_EXTERNAL_REGISTRY_ENDPOINT=http://etcd:2379
MAVIO_EXTERNAL_REGISTRY_PREFIX=/mavio/servers/
MAVIO_EXTERNAL_REGISTRY_TOKEN=<optional>
MAVIO_EXTERNAL_REGISTRY_INTERVAL_MS=30000
```

## Router

- **Namespacing.** Every tool is `serverId.toolName`; the router routes by prefix.
- **Capability cache.** Redis-backed; TTL 300s; keys namespaced by `MAVIO_REGION`.
- **Circuit breaker.** Per-`serverId` closed/open/half-open (`failureThreshold=5`, `resetMs=30000`, `halfOpenMaxCalls=1`). Open state returns JSON-RPC `-32010`.
- **Per-server rate limit.** Redis token bucket keyed by `serverId+principal.id`; driven by `descriptor.metadata.rateLimitRpm`. JSON-RPC `-32011` when exceeded.
- **Region routing.** `MAVIO_REGION` filters servers whose `metadata.region` is set to a different region; region-untagged servers stay globally routable.
- **Native MCP dispatch.** `tools/call` correctly threads `params.name` (bug fixed in 3c).

## Auth

Resolvers, in the order they run (`resolvePrincipalFromRequest`):

1. **Trusted-proxy header** (`MAVIO_TRUSTED_PROXY_ENABLED=1`) — `X-Auth-Subject`, `-Type`, `-Workspace`, `-Scopes`. Enterprise pattern: reverse proxy terminates SAML/mTLS/SSO and forwards verified subject.
2. **Native mTLS peer cert** (`MAVIO_MTLS_ENABLED=1`) — reads `req.socket.getPeerCertificate()`, requires `socket.authorized === true`, principal is `cn:<CN>`.
3. **Session cookie** (`mavio_sid`) — web console OIDC/OAuth2.
4. **Bearer token** — API key or `MAVIO_ADMIN_API_KEY`.
5. **Dev fallback** — if no admin key configured, resolves as `service:dev` with `*` scopes.

OIDC providers stored in `oidc_providers`; managed via `PUT /api/auth/providers/:id` and `GET /auth/:providerId/login|callback`.

## RBAC

Actions defined in `@mavio/rbac`:

```
workspace:admin · project:read · project:write · server:read · server:write
server:invoke · server:admin · tool:invoke · plugin:install
config:write · audit:read
```

Scopes: `workspace` · `project` · `server` · `tool`. Precedence: explicit deny > explicit allow > inherited allow. Wildcards on both action and any scope field.

Policy engines (chosen by `MAVIO_RBAC_ENGINE`):

- `builtin` (default) — `BuiltinRbacEngine` from `@mavio/rbac`.
- `opa` — `OpaPolicyEngine` from `@mavio/rbac-opa` (HTTP to OPA data API).
- `cedar` — `CedarSidecarPolicyEngine` (HTTP to Cedar agent; wraps payload as Cedar entity refs).

Remote engines fail closed with a 2s default `AbortController` timeout.

## Playground

- **Invoke.** `POST /api/playground/invoke` records latency + response.
- **History.** `GET /api/playground/runs?server=&limit=`.
- **Replay.** `POST /api/playground/runs/:id/replay` — re-invokes with stored args, records a new run.
- **Export.** `GET /api/playground/runs/export?server=&format=json|ndjson` — attachment download, capped at 1000.

## Inspector

- Schema-tree component (`apps/web`) renders JSON Schema properties: type, required, format, enum, description, nested object/array.
- Tool explorer with search filter + raw JSON toggle.
- Snapshot diff at `/servers/:id/history`.

## Observability

- **Prometheus** at `GET /metrics` (`@mavio/observability`):
  - `mavio_router_requests_total{server,tool,outcome}`
  - `mavio_router_request_duration_seconds` (histogram)
  - `mavio_breaker_state{server}` (0/1/2)
  - `mavio_rate_limit_denied_total{server,scope}`
  - `mavio_upstream_errors_total{server,kind}`
  - `mavio_importer_runs_total{kind,outcome}`
- **OpenTelemetry**: NodeSDK + BatchSpanProcessor + OTLP HTTP exporter, gated on `OTEL_EXPORTER_OTLP_ENDPOINT` (or console via `MAVIO_OTEL_DEBUG=1`). `RouterService.callTool` and OpenAPI/GraphQL dispatchers create spans; W3C traceparent injected into upstream HTTP.
- **Circuit breaker gauge** updated per call.

## Audit

Table `audit_logs`. Hooks:

| Event | Actor | Notes |
|---|---|---|
| `auth.login` | user | `created` flag + email |
| `auth.logout` | user | session id |
| `rbac.deny` | any | `required` action + `reason` |
| `tool.invoke` | any | `outcome`/`durationMs`, always in `finally` |

Query: `GET /api/audit?actor=&action=&outcome=&since=&limit=` — guarded by `audit:read`.

## Extensibility

- **Plugin manager** — discovers `node_modules/@mavio-plugin/*`, semver-gates `manifest.mavioApi` vs host `MAVIO_API_VERSION="1.0.0"`.
- **SDK** — `@mavio/sdk` exports `PluginManifest`, `PluginContext`, `Importer`, `TransportAdapter`, `Middleware`, `AuthProvider`.
- **State store** — DB-backed by default; `InMemoryStateStore` for tests.
- **CLI** — `mavio plugin list|enable|disable`.
- **Marketplace** — `@mavio/marketplace`:
  - `GET /api/marketplace?q=` + `/api/marketplace/get?name=`
  - `MAVIO_MARKETPLACE_URL` + optional `MAVIO_MARKETPLACE_PUBKEY_PEM`
  - SHA-256 checksum enforced; Ed25519 signature verified against PEM key when present.

## Deployment

- **Helm chart** (`deploy/helm/mavio-mcp/`) — Deployment/Service/Ingress/ConfigMap/Secret/ServiceAccount/ServiceMonitor. Prometheus scrape annotations by default; ServiceMonitor opt-in. PodSecurityContext locked (non-root, read-only rootfs, drop-ALL caps).
- **Raw K8s** (`deploy/k8s/`) — Helm-less reference.
- **Docker** (`deploy/docker/Dockerfile`) — multi-stage build (`pnpm -r build` → `pnpm deploy --prod`) → slim server-only runtime image.

## Regions

- `MAVIO_REGION=<name>` — sets cache key prefix and enables region filter on `RouterService.loadServers`.
- Server descriptors carry `metadata.region`. Untagged = globally routable.
- Two regions can share one Redis; keys are namespaced.
