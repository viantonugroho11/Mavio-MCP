# ADR-007: YAML config as single source of truth

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, DX Lead

## Context
Config lives in many places in similar tools (UI-only, DB-only, env, YAML). This makes reproducing environments hard, blocks GitOps, and turns UI edits into invisible state.

## Decision
`mavio.config.yaml` is the **authoritative source of truth**. The web console writes changes back to it via a serialized API. Runtime watches the file and hot-reloads. Secrets are references (`secret://...`) resolved by a `SecretProvider`.

## Options Considered

### Option A: YAML file authoritative
**Pros:** GitOps-friendly; reproducible envs; portable across dev/staging/prod; diffable in PRs.
**Cons:** Concurrent-writer conflicts (mitigated by API-serialized writes + optimistic locking with content hash).

### Option B: DB-first with export
**Pros:** Familiar UX.
**Cons:** Env parity requires export/import discipline; drift is invisible.

### Option C: Env variables only
**Pros:** Twelve-factor.
**Cons:** Deep nested config (servers, roles) is miserable in env vars.

## Trade-off Analysis
Multi-writer risk is real but bounded — the API is the only writer, guarded by an optimistic hash check. Human YAML edits and API edits are reconciled at load with a clear precedence.

## Consequences
- Config-mutating actions require RBAC scope `config:write`.
- Every save writes an audit record with the diff.
- Runtime must handle hot-reload safely (drain per-server sessions on descriptor change).
- Revisit if config exceeds a few thousand lines (introduce include/import directives).

## Action Items
- [ ] Optimistic-lock implementation with content hash.
- [ ] Hot-reload safety spec per module.
- [ ] `mavio config validate|diff|apply` CLI commands.
