# Mavio-MCP

> All-in-one developer toolkit for the **Model Context Protocol (MCP)** ecosystem — registry, router, playground, inspector, importers, and enterprise auth.
>
> Mavio-MCP is **not** an AI platform, agent framework, LLM orchestrator, or workflow engine. **Only MCP.**

Repository name: `Mavio-MCP` (product name: **Mavio-MCP**).

---

## What it does

- **Importers** — turn OpenAPI specs, SQL schemas, GraphQL schemas, and existing MCP servers into first-class MCP servers.
- **Registry** — catalog local + remote MCP servers with health, versioning, tags, and search.
- **Router** — expose all servers behind a single authenticated MCP endpoint with namespaced tools.
- **Playground** — schema-driven tool testing, history, and replay (human-in-the-loop; no LLM).
- **Inspector** — read-only view of capabilities, tools, resources, prompts, and schemas.
- **Auth** — OAuth2, OIDC, JWT, API keys, sessions.
- **RBAC** — four scopes: workspace · project · server · tool.
- **Plugins** — sandboxed extensions for importers, transports, auth providers, UI, and middleware.
- **Config-as-truth** — `mavio.config.yaml` is authoritative; the web console writes back to it.

## Status

**MVP scaffold landed (v0.1.0-mvp).** Runs: monorepo, Postgres/Redis via Docker Compose, unified NestJS server (router + admin API), OpenAPI importer, `mavio` CLI. Web console defers to Phase 1.5.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js · React · TypeScript · Tailwind · shadcn/ui |
| Backend | NestJS · TypeScript |
| Database | PostgreSQL (SQLite dev fallback) |
| Cache / Coordination | Redis |
| Monorepo | pnpm workspaces · Turborepo |
| Infra | Docker · Docker Compose · Helm (Phase 3) |
| Observability | Prometheus · OpenTelemetry |

## Repository layout (planned)

```
apps/
  web/       # Next.js console
  api/       # NestJS admin/management API
  router/    # NestJS MCP data-plane router
  worker/    # Background jobs (imports, health)
  cli/       # `mavio` CLI (oclif)
packages/
  core/  config/  registry/  router/  playground/  inspector/
  transport/  auth/  rbac/  plugin/  package-manager/  audit/
  sdk/  ui-kit/  import-openapi/  import-sql/  import-graphql/  import-mcp/
tooling/     # eslint · tsconfig · vitest · docker
docs/        # architecture + ADRs
```

## Documentation

- [Architecture Design Document](docs/architecture/mavio-mcp-architecture.md) — full v1.0 draft (20 sections, Mermaid diagrams).
- [Architecture Decision Records](docs/architecture/adr/README.md) — 14 ADRs (10 accepted, 4 proposed).
- [Review Notes](docs/architecture/review-notes.md) — gap analysis + non-functional targets.
- [Architecture Overview (visual)](https://claude.ai/code/artifact/eadf4ccf-2f95-449a-801d-50f41fc4657d) — one-page summary.

## Roadmap

| Phase | Theme | Highlights |
|---|---|---|
| **1 · MVP** | Get to first tool call | Monorepo, Registry, Router, API keys, OpenAPI importer, minimal Inspector + Playground, CLI |
| **2 · Enterprise** | Auth, RBAC, SQL | OIDC/OAuth2, RBAC 4-scope, SSE streaming, SQL importer, full Inspector + Playground, audit logs |
| **3 · Ecosystem** | Plugins ship | Plugin manager + SDK v1, GraphQL + MCP-mirror importers, rate limits, broker auth, Prometheus + OTLP, Helm |
| **4 · Scale (1.0)** | GA | WebSocket transport, etcd/Consul registry, OPA/Cedar adapter, SAML + mTLS, multi-region router, plugin marketplace |

## Getting started

Requires Node 20.11+, pnpm 9, Docker.

```bash
# 1. install deps + build
pnpm install
pnpm build

# 2. spin up Postgres + Redis
docker compose up -d

# 3. env
cp .env.example .env
export $(grep -v "^#" .env | xargs)

# 4. apply DB migrations
pnpm --filter @mavio/registry migrate

# 5. seed a config (uses the Petstore OpenAPI example)
cp mavio.config.example.yaml mavio.config.yaml

# 6. start the server (router on POST /mcp, admin on /api/*)
pnpm --filter @mavio/server start

# 7. from another shell — inspect / import / test
node apps/cli/dist/index.js servers list
node apps/cli/dist/index.js import openapi \
  --id petstore \
  --url https://petstore3.swagger.io/api/v3/openapi.json

# 8. call the router as an MCP client
curl -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Set `MAVIO_ADMIN_API_KEY` to require a bearer token on `/api/*` (dev default: open).

## Contributing

- All architectural decisions go through the [ADR process](docs/architecture/adr/ADR-000-template.md).
- Code layout follows clean architecture: domain in `packages/core`, adapters at the edge.
- Contributor DCO required (no CLA).
- License: **Apache 2.0** (see [ADR-014](docs/architecture/adr/ADR-014-open-source-license.md)).

## License

Apache 2.0 (planned — see ADR-014). `LICENSE` file to land with Phase 1.
