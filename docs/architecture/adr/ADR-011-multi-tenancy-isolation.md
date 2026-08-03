# ADR-011: Multi-tenancy isolation model

**Status:** Proposed
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
Workspaces are the tenant boundary. The original design says "all data is workspace-scoped" but does not commit to a physical isolation model. Options range from row-level (soft) to schema-per-tenant to database-per-tenant (hard). This decision affects cost, blast radius, migration complexity, and enterprise sellability.

## Decision (proposed)
Use **row-level isolation** with a mandatory `workspace_id` on every tenant-scoped table, enforced by:
1. A repository base class that injects the current workspace filter.
2. Postgres **Row-Level Security (RLS)** policies as defense in depth.
3. Reserved capacity for a **future dedicated-schema mode** for enterprise tenants.

## Options Considered

### Option A: Row-level + RLS (proposed)
**Pros:** Lowest ops cost; single schema migration; simple backups; fits OSS deployments.
**Cons:** One noisy tenant can affect shared indexes; harder to give a tenant an isolated backup/restore.

### Option B: Schema-per-tenant
**Pros:** Stronger isolation; per-tenant backup; per-tenant migrations gate.
**Cons:** Migrations must fan out across N schemas; connection pool waste; hard to run for hundreds of tenants.

### Option C: Database-per-tenant
**Pros:** Hardest isolation.
**Cons:** Ops nightmare for OSS users; overkill for typical Hermes deployments.

## Trade-off Analysis
RLS enforced at the DB level catches app-layer bugs (missing filters) — this is the decisive win. Enterprise customers who need harder isolation can be offered dedicated-schema mode later without breaking the app layer.

## Consequences
- All repositories must set `SET LOCAL app.current_workspace = $1` at request start.
- Every migration verified against RLS.
- Query plans reviewed to ensure `workspace_id` is a leading key on hot tables.
- Revisit if a single tenant exceeds 10% of total data volume or QPS.

## Action Items
- [ ] Postgres RLS policy generator.
- [ ] Repository base with workspace scope injection.
- [ ] Load test: N tenants at design load, confirm noisy-neighbor bounds.
