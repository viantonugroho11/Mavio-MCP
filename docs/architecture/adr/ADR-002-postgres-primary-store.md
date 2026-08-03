# ADR-002: PostgreSQL as primary datastore

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture

## Context
Mavio stores workspaces, projects, servers, users/roles, capability snapshots, audit logs, and plugin metadata. Access patterns are relational with occasional JSON payloads (capability snapshots) and full-text search (server discovery). We need strong consistency for RBAC and auditability.

## Decision
Use **PostgreSQL 15+** as the primary datastore for all persistent state. Ship **SQLite** as a dev-only fallback for local zero-dependency runs.

## Options Considered

### Option A: PostgreSQL
**Pros:** JSONB for capability snapshots; GIN indexes for tags; tsvector search; strong transactional guarantees; ubiquitous ops experience; logical replication.
**Cons:** Operational overhead vs SQLite for tiny dev setups.

### Option B: MySQL
**Pros:** Similar maturity.
**Cons:** Weaker JSON ergonomics; weaker full-text search vs tsvector.

### Option C: MongoDB
**Pros:** Flexible documents.
**Cons:** Weaker relational modeling for RBAC; ops surprises for teams expecting SQL.

### Option D: SQLite everywhere
**Pros:** Zero ops.
**Cons:** Doesn't scale horizontally; no concurrent writers at meaningful throughput.

## Trade-off Analysis
The mix of relational RBAC + semi-structured capability snapshots + FTS is exactly PostgreSQL's sweet spot. SQLite is retained only as a dev accelerator; production deployments must use Postgres.

## Consequences
- One SQL dialect to target; migrations authored for Postgres, verified for SQLite.
- Migration tool must support both (see ADR-012).
- Full-text search built-in — no separate Elasticsearch needed.
- Revisit if analytical workloads exceed OLTP tolerances (add a read replica or a warehouse sink).

## Action Items
- [ ] Choose migration tool (ADR-012).
- [ ] Document Postgres tuning defaults (connection pool, WAL, autovacuum).
- [ ] CI matrix: Postgres 15 + SQLite (dev config).
