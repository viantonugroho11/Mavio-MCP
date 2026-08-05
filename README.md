# Mavio-MCP

> All-in-one developer toolkit for the **Model Context Protocol (MCP)** ecosystem — registry, router, playground, inspector, importers, and enterprise auth.
>
> Mavio-MCP is **not** an AI platform, agent framework, LLM orchestrator, or workflow engine. **Only MCP.**

[![Version](https://img.shields.io/badge/version-1.0.0-brightgreen)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-brightgreen)](package.json)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-orange)](package.json)

---

## Table of contents

- [What it is](#what-it-is)
- [Why](#why)
- [Feature matrix](#feature-matrix)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Install](#install)
- [Usage — first tool call](#usage--first-tool-call)
- [Documentation index](#documentation-index)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What it is

Mavio-MCP takes anything that talks HTTP, SQL, GraphQL, or MCP-native and republishes it as a single, authenticated MCP endpoint. Point one MCP client at Mavio and it sees every backend as a namespaced set of tools.

```
   OpenAPI  ─┐
   SQL      ─┤                    ┌─▶ Any MCP client
   GraphQL  ─┼─▶ Mavio-MCP  ──────┤   (Claude, IDE, custom, …)
   MCP      ─┘   (router+registry)└─▶ POST /mcp  ·  GET /mcp/sse  ·  WS /mcp/ws
```

## Why

- **One endpoint, many backends.** Stop wiring MCP clients per-service; wire them to Mavio.
- **Import, don't rewrite.** OpenAPI/SQL/GraphQL/MCP become MCP tools without hand-writing schemas.
- **Enterprise from day one.** OIDC, RBAC (4 scopes), audit logs, mTLS/SAML via trusted-proxy pattern, OPA/Cedar policy.
- **Ops-friendly.** Prometheus metrics, OpenTelemetry traces, Helm chart, K8s manifests, circuit breaker, per-server rate limits.
- **Extensible.** Plugin SDK for importers, transports, middleware, auth providers. Signed marketplace client.

## Feature matrix

| Category | Feature | Status |
|---|---|---|
| **Importers** | OpenAPI · SQL (Postgres) · GraphQL · MCP-mirror | ✅ v1.0 |
| **Transports (downstream)** | HTTP-JSON · SSE (endpoint fanout) · WebSocket | ✅ v1.0 |
| **Transports (upstream)** | stdio · HTTP · SSE · WebSocket · GraphQL · SQL | ✅ v1.0 |
| **Registry** | Postgres source of truth · etcd/Consul discovery sync · capability snapshots · diff | ✅ v1.0 |
| **Router** | Namespaced tools (`serverId.toolName`) · capability cache · region filter | ✅ v1.0 |
| **Auth** | API keys · OIDC/OAuth2 · session cookies · trusted-proxy (SAML) · native mTLS | ✅ v1.0 |
| **RBAC** | 4-scope (workspace·project·server·tool) builtin engine · OPA · Cedar sidecar | ✅ v1.0 |
| **Playground** | Schema-driven invoke · run history · replay · JSON/NDJSON export | ✅ v1.0 |
| **Inspector** | Schema tree · tool search · snapshot diff | ✅ v1.0 |
| **Observability** | Prometheus (`/metrics`) · OpenTelemetry OTLP · circuit breaker gauge | ✅ v1.0 |
| **Ops** | Helm chart · K8s manifests · Dockerfile · ServiceMonitor | ✅ v1.0 |
| **Extensibility** | Plugin manager · SDK v1 · signed marketplace (sha256 + Ed25519) | ✅ v1.0 |
| **Audit** | `audit_logs` table · `/api/audit` query · login/logout/rbac.deny/tool.invoke hooks | ✅ v1.0 |

Full detail: **[docs/FEATURES.md](docs/FEATURES.md)**.

## Quick start (5 minutes)

Prereqs: Node 20.11+, pnpm 9, Docker.

```bash
git clone https://github.com/viantonugroho11/Mavio-MCP.git
cd Mavio-MCP
pnpm install
pnpm build

docker compose up -d                                     # Postgres + Redis
cp .env.example .env && export $(grep -v "^#" .env | xargs)
pnpm --filter @mavio/registry migrate

cp mavio.config.example.yaml mavio.config.yaml
pnpm --filter @mavio/server start &                      # router on :4000

# Import Petstore as an MCP server
node apps/cli/dist/index.js import openapi \
  --id petstore --url https://petstore3.swagger.io/api/v3/openapi.json

# List tools via MCP
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq
```

Web console (optional):

```bash
pnpm --filter @mavio/web dev   # → http://localhost:3000
```

Full setup variants (Docker/Helm/K8s/local): **[docs/INSTALL.md](docs/INSTALL.md)**.

## Usage — first tool call

```bash
# 1. See what's registered
node apps/cli/dist/index.js servers list

# 2. Invoke a tool through the router
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"petstore.getPetById","arguments":{"petId":1}}}' | jq

# 3. Or use SSE (classic MCP client)
curl -N -H 'accept: text/event-stream' http://localhost:4000/mcp/sse

# 4. Or WebSocket
websocat ws://localhost:4000/mcp/ws
```

Full CLI reference: **[docs/CLI.md](docs/CLI.md)** · HTTP API: **[docs/API.md](docs/API.md)** · scenarios: **[docs/USAGE.md](docs/USAGE.md)**.

## Documentation index

| Doc | What's in it |
|---|---|
| [FEATURES.md](docs/FEATURES.md) | Every feature grouped by category with env flags |
| [INSTALL.md](docs/INSTALL.md) | Local, Docker, Docker Compose, Helm, K8s |
| [USAGE.md](docs/USAGE.md) | Walk-throughs: import → route → invoke → observe |
| [CONFIGURATION.md](docs/CONFIGURATION.md) | `mavio.config.yaml` + every env var |
| [API.md](docs/API.md) | HTTP endpoints, admin API, MCP endpoint |
| [CLI.md](docs/CLI.md) | `mavio` command reference |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Helm values, K8s manifests, sizing, HA |
| [ARCHITECTURE.md](docs/architecture/mavio-mcp-architecture.md) | Full architecture doc + Mermaid diagrams |
| [ADRs](docs/architecture/adr/README.md) | Architecture Decision Records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev workflow, tests, commit style |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [SECURITY.md](SECURITY.md) | Reporting vulnerabilities, threat model |

## Roadmap

| Phase | Theme | Status |
|---|---|---|
| **1 · MVP** | Get to first tool call — monorepo, Registry, Router, API keys, OpenAPI importer, Inspector, Playground, CLI | ✅ shipped |
| **2 · Enterprise** | OIDC, RBAC 4-scope, SSE fanout, SQL importer, full Inspector + Playground, audit logs, tests | ✅ shipped |
| **3 · Ecosystem** | Plugin manager + SDK, GraphQL + MCP-mirror importers, rate limits, broker auth, Prometheus + OTLP, Helm | ✅ shipped |
| **4 · Scale (1.0)** | WebSocket, etcd/Consul registry, OPA/Cedar, SAML + mTLS, multi-region, marketplace | ✅ **v1.0.0 GA** |
| **5 · Post-GA** | Plugin VM sandbox (isolated-vm workers) · UI extension surface · marketplace publisher tooling | 🔜 |

## Contributing

- ADR-first for anything architectural — see [docs/architecture/adr/ADR-000-template.md](docs/architecture/adr/ADR-000-template.md).
- Clean architecture: domain in `packages/core`, adapters at the edge.
- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs(scope): …`.
- Tests: `pnpm test` runs Vitest across every package that has one.
- DCO required (no CLA). Full guide: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## License

Apache 2.0 — see [LICENSE](LICENSE).
