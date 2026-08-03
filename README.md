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

Pre-implementation. Architecture design v1.0 (draft) is complete; MVP scaffold pending.

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

> MVP scaffold not yet published. This section will land with Phase 1.

Planned quick start:

```bash
# install
pnpm install

# spin up Postgres + Redis
docker compose up -d

# initialize a project
pnpm mavio init

# import an OpenAPI spec into an MCP server
pnpm mavio import openapi https://api.example.com/openapi.json

# run the router + web console
pnpm dev
```

## Contributing

- All architectural decisions go through the [ADR process](docs/architecture/adr/ADR-000-template.md).
- Code layout follows clean architecture: domain in `packages/core`, adapters at the edge.
- Contributor DCO required (no CLA).
- License: **Apache 2.0** (see [ADR-014](docs/architecture/adr/ADR-014-open-source-license.md)).

## License

Apache 2.0 (planned — see ADR-014). `LICENSE` file to land with Phase 1.
