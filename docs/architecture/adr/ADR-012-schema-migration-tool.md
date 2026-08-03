# ADR-012: Schema migration & evolution strategy

**Status:** Proposed
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Backend Lead

## Context
The base architecture doesn't name a migration tool or a zero-downtime discipline. We need both to ship confidently.

## Decision (proposed)
Use **Kysely** as the query builder + **Kysely migrations** for schema changes. Enforce a **expand-migrate-contract** discipline for zero-downtime deploys.

## Options Considered

### Option A: Kysely + Kysely migrations
**Pros:** Fully typed SQL; no runtime ORM overhead; works on Postgres and SQLite; migrations are TypeScript with programmatic control.
**Cons:** Less magic than Prisma; team writes SQL-adjacent code.

### Option B: Prisma
**Pros:** Great DX; migrations UX polished.
**Cons:** Runtime overhead; schema-first is awkward for capability-snapshot JSONB usage; introspection quirks with RLS.

### Option C: TypeORM
**Pros:** Familiar.
**Cons:** Migration ergonomics weaker; runtime metadata overhead.

### Option D: Raw `node-postgres` + `pg-migrate`
**Pros:** Minimal.
**Cons:** No type safety; more foot-guns.

## Trade-off Analysis
Kysely wins on type safety without runtime cost. RLS support is straightforward because we're writing SQL, not fighting an ORM.

## Consequences
- All schema changes ship as reversible migrations.
- CI runs migrations up + down + up on every PR against a scratch DB.
- Every breaking DB change follows expand → migrate data → deploy app → contract.
- Revisit if the team majority prefers Prisma DX and can accept the runtime cost.

## Action Items
- [ ] Migration authoring guide with expand-contract examples.
- [ ] CI check: forbid `DROP COLUMN` in the same PR as the app change that stops using it.
- [ ] Backfill runner using worker queue for long-running migrations.
