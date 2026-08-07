<div align="center">

# Mavio-MCP

**The all-in-one developer toolkit for the Model Context Protocol.**
Import anything — OpenAPI, SQL, GraphQL, existing MCP servers — and republish it as one authenticated MCP endpoint.

[![Version](https://img.shields.io/badge/version-1.2.0-brightgreen)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-orange)](package.json)
[![MCP](https://img.shields.io/badge/protocol-MCP%202024--11--05-8A2BE2)](https://modelcontextprotocol.io)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED)](deploy/docker/Dockerfile)
[![Helm](https://img.shields.io/badge/helm-chart-0F1689)](deploy/helm/mavio-mcp)

[Docs website](https://mavio-docs.vercel.app) · [Quick start](#-get-started-in-60-seconds) · [Feature matrix](#-feature-matrix) · [Architecture](docs/architecture/mavio-mcp-architecture.md) · [Changelog](CHANGELOG.md)

</div>

> Mavio-MCP takes anything that talks HTTP, SQL, GraphQL, or MCP-native and republishes it as a single, authenticated MCP endpoint. Point one MCP client at Mavio and it sees every backend as a namespaced set of tools.
>
> Mavio-MCP is **not** an AI platform, agent framework, LLM orchestrator, or workflow engine. **Only MCP.**

```
   OpenAPI  ─┐
   SQL      ─┤                    ┌─▶ Any MCP client
   GraphQL  ─┼─▶ Mavio-MCP  ──────┤   (Claude, IDE, custom, …)
   MCP      ─┘   (router+registry)└─▶ POST /mcp  ·  GET /mcp/sse  ·  WS /mcp/ws
```

---

## Table of contents

- [Get started in 60 seconds](#-get-started-in-60-seconds)
- [Key features](#-key-features)
- [Why Mavio-MCP](#-why-mavio-mcp)
- [Feature matrix](#-feature-matrix)
- [Import catalog — turn anything into MCP](#-import-catalog--turn-anything-into-mcp)
- [Connect a client](#-connect-a-client)
- [First tool call](#-first-tool-call)
- [Default ports & services](#-default-ports--services)
- [Documentation](#-documentation)
- [Architecture](#-architecture)
- [Roadmap](#-roadmap)
- [Community & support](#-community--support)
- [Contributing](#-contributing)
- [License](#-license)

---

## ⚡ Get started in 60 seconds

Prereqs: **Node 20.11+**, **pnpm 9**, **Docker**.

```bash
git clone https://github.com/viantonugroho11/Mavio-MCP.git
cd Mavio-MCP
pnpm install && pnpm build

docker compose up -d                                    # Postgres + Redis
cp .env.example .env && export $(grep -v "^#" .env | xargs)
pnpm --filter @mavio/registry migrate

cp mavio.config.example.yaml mavio.config.yaml
pnpm --filter @mavio/server start &                     # router on :4000

# Import Petstore as an MCP server, then list its tools
node apps/cli/dist/index.js import openapi \
  --id petstore --url https://petstore3.swagger.io/api/v3/openapi.json

curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

Optional web console:

```bash
pnpm --filter @mavio/web dev                            # http://localhost:3000
```

Full setup variants (Docker/Helm/K8s/local): **[docs/INSTALL.md](docs/INSTALL.md)**.

---

## ✨ Key features

- **Import, don't rewrite.** OpenAPI (v3), Postgres SQL, GraphQL, and existing MCP servers become MCP tools automatically — no hand-written schemas.
- **One endpoint, three transports.** Downstream over HTTP-JSON, SSE, or WebSocket. Six upstream transports (stdio · http · sse · ws · sql · graphql).
- **Enterprise auth from day one.** API keys, OIDC/OAuth2, session cookies, trusted-proxy (SAML), native mTLS — resolved in a defined order.
- **Fine-grained RBAC.** 4-scope engine (workspace · project · server · tool) built in, plus optional OPA and Cedar policy engines.
- **Per-principal upstream OAuth vault.** Call Slack as Alice and Notion as Alice from one Mavio session; tokens envelope-encrypted (AES-256-GCM) with rotatable KEK. See [docs/UPSTREAM_AUTH.md](docs/UPSTREAM_AUTH.md).
- **Playground + Inspector.** Schema-driven invoke, run history, replay, JSON/NDJSON export; schema tree, tool search, snapshot diff.
- **Production ops.** Prometheus `/metrics`, OpenTelemetry OTLP traces, circuit breaker, per-server rate limits, Helm chart, K8s manifests, multi-region cache.
- **Extensible.** Plugin manager + SDK v1 for importers, transports, middleware, auth providers; signed marketplace (SHA-256 + Ed25519).

---

## 🤔 Why Mavio-MCP

| The problem | Mavio-MCP |
|---|---|
| You have REST APIs, but AI clients speak MCP | Import the OpenAPI spec — every operation becomes an MCP tool |
| Your data lives in Postgres, not an API | Import the schema read-only — every table becomes a `select_*` tool |
| Each MCP client must be wired to each backend | Point every client at one Mavio endpoint; it namespaces all backends |
| MCP servers exist but have no auth, RBAC, or audit | Front them with Mavio — OIDC, 4-scope RBAC, audit log, rate limits |
| Different users need different upstream credentials | Per-principal upstream OAuth vault injects the right token per call |
| You need to run this in production, not a laptop demo | Helm chart, metrics, traces, circuit breaker, multi-region, HA topology |

---

## 📊 Feature matrix

| Category | Feature | Status |
|---|---|---|
| **Importers** | OpenAPI · SQL (Postgres) · GraphQL · MCP-mirror | ✅ v1.0 |
| **Transports (downstream)** | HTTP-JSON · SSE (endpoint fanout) · WebSocket | ✅ v1.0 |
| **Transports (upstream)** | stdio · HTTP · SSE · WebSocket · GraphQL · SQL | ✅ v1.0 |
| **Registry** | Postgres source of truth · etcd/Consul discovery sync · capability snapshots · diff | ✅ v1.0 |
| **Router** | Namespaced tools (`serverId.toolName`) · capability cache · circuit breaker · region filter | ✅ v1.0 |
| **Auth** | API keys · OIDC/OAuth2 · session cookies · trusted-proxy (SAML) · native mTLS | ✅ v1.0 |
| **RBAC** | 4-scope (workspace·project·server·tool) builtin engine · OPA · Cedar sidecar | ✅ v1.0 |
| **Upstream OAuth** | Per-principal credential vault · Slack · OAuth2 PKCE · RFC 8693 token-exchange · KEK rotation | ✅ v1.1–1.2 |
| **Playground** | Schema-driven invoke · run history · replay · JSON/NDJSON export | ✅ v1.0 |
| **Inspector** | Schema tree · tool search · snapshot diff | ✅ v1.0 |
| **Observability** | Prometheus (`/metrics`) · OpenTelemetry OTLP · circuit breaker gauge | ✅ v1.0 |
| **Ops** | Helm chart · K8s manifests · Dockerfile · ServiceMonitor | ✅ v1.0 |
| **Extensibility** | Plugin manager · SDK v1 · signed marketplace (sha256 + Ed25519) | ✅ v1.0 |
| **Audit** | `audit_logs` table · `/api/audit` query · login/logout/rbac.deny/tool.invoke hooks | ✅ v1.0 |

Full detail: **[docs/FEATURES.md](docs/FEATURES.md)**.

---

## 📦 Import catalog — turn anything into MCP

| Source | Package | CLI | What you get |
|---|---|---|---|
| **OpenAPI v3** | `@mavio/import-openapi` | `mavio import openapi` | Each operation → one MCP tool, `$ref` resolved, params mapped to `inputSchema` |
| **SQL (Postgres)** | `@mavio/import-sql` | `mavio import sql` | Each table → `select_*` tool, read-only by default, optional allowlist |
| **GraphQL** | `@mavio/import-graphql` | `mavio import graphql` | Introspection → tools with `inputFields`, enums, deprecation; auto leaf-select |
| **Existing MCP** | `@mavio/import-mcp` | `mavio import mcp` | Mirror any stdio/http/sse MCP server as a Mavio-managed server |

```bash
# REST API
mavio import openapi --id petstore --url https://petstore3.swagger.io/api/v3/openapi.json

# Database (read-only)
mavio import sql --id analytics --dsn postgres://reader:pw@warehouse:5432/analytics --tables events,users

# GraphQL endpoint
mavio import graphql --id shopify --endpoint https://shop.example/graphql --auth secret://SHOP_TOKEN

# Mirror another MCP server
mavio import mcp --id filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp"
```

---

## 🔌 Connect a client

Any MCP client points at a single Mavio endpoint. Example for a Claude Desktop `mcpServers` entry using the SSE transport:

```json
{
  "mcpServers": {
    "mavio": {
      "url": "http://localhost:4000/mcp/sse"
    }
  }
}
```

Raw protocol access:

| Transport | Endpoint | Use when |
|---|---|---|
| HTTP-JSON | `POST /mcp` | Simplest; one request/response per frame |
| SSE | `GET /mcp/sse` | Classic MCP HTTP+SSE clients (endpoint fanout via `?sid=`) |
| WebSocket | `WS /mcp/ws` | Full-duplex streaming, 15s ping keep-alive |

Client setup, scenarios & FAQ: **[docs/USAGE.md](docs/USAGE.md)**.

---

## 🛠 First tool call

```bash
# 1. See what's registered
node apps/cli/dist/index.js servers list

# 2. Invoke a tool through the router (namespaced serverId.toolName)
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"petstore.getPetById","arguments":{"petId":1}}}' | jq

# 3. Or SSE
curl -N -H 'accept: text/event-stream' http://localhost:4000/mcp/sse

# 4. Or WebSocket
websocat ws://localhost:4000/mcp/ws
```

Full CLI reference: **[docs/CLI.md](docs/CLI.md)** · HTTP API: **[docs/API.md](docs/API.md)**.

---

## 🚪 Default ports & services

| Service | URL / Port | Notes |
|---|---|---|
| Router + admin API | `http://localhost:4000` | `/mcp`, `/mcp/sse`, `/mcp/ws`, `/api/*`, `/metrics`, `/healthz`, `/readyz` |
| Web console | `http://localhost:3000` | Inspector + Playground (optional) |
| PostgreSQL | `localhost:5432` | Source of truth (via docker compose) |
| Redis | `localhost:6379` | Cache · invalidation bus · rate limits |

---

## 📚 Documentation

Full docs website: **[mavio-docs.vercel.app](https://mavio-docs.vercel.app)** (source in [`apps/docs`](apps/docs)).

| Doc | What's in it |
|---|---|
| [FEATURES.md](docs/FEATURES.md) | Every feature grouped by category with env flags |
| [INSTALL.md](docs/INSTALL.md) | Local, Docker, Docker Compose, Helm, K8s |
| [USAGE.md](docs/USAGE.md) | Walk-throughs: import → route → invoke → observe |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | `mavio.config.yaml` + every env var |
| [API.md](docs/API.md) | HTTP endpoints, admin API, MCP endpoint |
| [CLI.md](docs/CLI.md) | `mavio` command reference |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Helm values, K8s manifests, sizing, HA |
| [UPSTREAM_AUTH.md](docs/UPSTREAM_AUTH.md) | Per-principal upstream OAuth vault |
| [ARCHITECTURE](docs/architecture/mavio-mcp-architecture.md) | Full architecture doc + Mermaid diagrams |
| [ADRs](docs/architecture/adr/README.md) | Architecture Decision Records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev workflow, tests, commit style |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities, threat model |

---

## 🏛 Architecture

```
                     ┌─────────────────┐
     MCP clients ───▶│  Reverse proxy  │──▶ Mavio-MCP pods (N ≥ 2)
                     │  (Envoy / NGINX │        │
                     │   / Pomerium)   │        ├─▶ PostgreSQL (source of truth)
                     └─────────────────┘        └─▶ Redis (cache · bus · limits)
                            │
                            └─▶ terminates TLS + SAML/OIDC/mTLS,
                                forwards X-Auth-Subject / -Type / -Workspace
```

Clean architecture: domain lives in `packages/core`, adapters at the edge. Monorepo layout:

- `apps/` — `server` (router + admin API), `web` (console), `cli` (`mavio`), `docs` (docs website).
- `packages/` — `core`, `registry`, `router` (in server), `transport`, `rbac` / `rbac-opa`, `import-*`, `upstream-auth`, `observability`, `plugin`, `sdk`, `marketplace`, `cache`, `config`, `registry-external`.

Full diagrams: **[docs/architecture/mavio-mcp-architecture.md](docs/architecture/mavio-mcp-architecture.md)**.

---

## 🗺 Roadmap

| Phase | Theme | Status |
|---|---|---|
| **1 · MVP** | Monorepo, Registry, Router, API keys, OpenAPI importer, Inspector, Playground, CLI | ✅ shipped |
| **2 · Enterprise** | OIDC, RBAC 4-scope, SSE fanout, SQL importer, full Inspector + Playground, audit logs | ✅ shipped |
| **3 · Ecosystem** | Plugin manager + SDK, GraphQL + MCP-mirror importers, rate limits, Prometheus + OTLP, Helm | ✅ shipped |
| **4 · Scale (1.0)** | WebSocket, etcd/Consul registry, OPA/Cedar, SAML + mTLS, multi-region, marketplace | ✅ v1.0 GA |
| **5 · Post-GA** | Per-principal upstream OAuth vault (✅ 1.1–1.2) · Vault Transit KEK (✅ 1.2) · plugin VM sandbox · UI extension surface · marketplace publisher tooling | 🔜 in progress |

---

## 💬 Community & support

- **Issues & bugs** — [GitHub Issues](https://github.com/viantonugroho11/Mavio-MCP/issues)
- **Security** — see [SECURITY.md](SECURITY.md) for private disclosure
- **Discussions & questions** — [GitHub Discussions](https://github.com/viantonugroho11/Mavio-MCP/discussions)
- **Changelog** — [CHANGELOG.md](CHANGELOG.md)

---

## 🤝 Contributing

- ADR-first for anything architectural — see [docs/architecture/adr/ADR-000-template.md](docs/architecture/adr/ADR-000-template.md).
- Clean architecture: domain in `packages/core`, adapters at the edge.
- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`.
- Tests: `pnpm test` runs Vitest across every package that has one.
- DCO required (no CLA). Full guide: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## 📄 License

Apache 2.0 — see [LICENSE](LICENSE).
