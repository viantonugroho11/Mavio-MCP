# Architecture Decision Records — Mavio-MCP

Every non-trivial architectural decision lives here as an immutable, numbered record. New decisions get a new ADR; changes supersede rather than edit.

## Index

| ID | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-nestjs-backend.md) | NestJS for backend services | Accepted |
| [ADR-002](ADR-002-postgres-primary-store.md) | PostgreSQL as primary datastore | Accepted |
| [ADR-003](ADR-003-redis-cache-coordination.md) | Redis for cache & coordination | Accepted |
| [ADR-004](ADR-004-pnpm-turborepo-monorepo.md) | pnpm workspaces + Turborepo | Accepted |
| [ADR-005](ADR-005-single-mcp-endpoint-router.md) | Single MCP endpoint via Router | Accepted |
| [ADR-006](ADR-006-clean-architecture-interface-first.md) | Clean architecture with interface-first packages | Accepted |
| [ADR-007](ADR-007-yaml-config-source-of-truth.md) | YAML config as single source of truth | Accepted |
| [ADR-008](ADR-008-plugin-sandbox-workers-then-isolated-vm.md) | Sandbox plugins in worker_threads → isolated-vm | Accepted |
| [ADR-009](ADR-009-rbac-builtin-opa-cedar-adapter.md) | RBAC built-in, OPA/Cedar as adapter | Accepted |
| [ADR-010](ADR-010-prometheus-opentelemetry.md) | Prometheus + OpenTelemetry for observability | Accepted |
| [ADR-011](ADR-011-multi-tenancy-isolation.md) | Multi-tenancy isolation model | Proposed |
| [ADR-012](ADR-012-schema-migration-tool.md) | Schema migration & evolution strategy | Proposed |
| [ADR-013](ADR-013-secret-rotation-lifecycle.md) | Secret rotation & revocation lifecycle | Proposed |
| [ADR-014](ADR-014-open-source-license.md) | Open-source license & dual-license posture | Proposed |
| [ADR-015](ADR-015-user-identity-model.md) | User identity & lifecycle model | Accepted |
| [ADR-016](ADR-016-audit-trail.md) | Audit trail — capture, storage, query | Proposed |
| [ADR-017](ADR-017-client-connection-model.md) | Client connection model — Router-only surface | Accepted |

## Template
New ADRs must follow [`ADR-000-template.md`](ADR-000-template.md).
