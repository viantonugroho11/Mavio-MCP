# ADR-009: RBAC built-in, OPA/Cedar as adapter

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
Most users need RBAC to work out of the box. Enterprises with existing policy stacks (OPA, AWS Cedar) want to bring their own engine. We can't force either group to compromise.

## Decision
Ship a **first-party RBAC engine** covering the four scopes (workspace, project, server, tool) with built-in roles. Expose a `PolicyEngine` interface so OPA and Cedar can plug in as alternate engines.

## Options Considered

### Option A: Built-in RBAC + PolicyEngine adapter
**Pros:** Great default UX; enterprise escape hatch.
**Cons:** Two code paths to test.

### Option B: OPA-only
**Pros:** One engine.
**Cons:** Steep learning curve for small teams; Rego is not casual reading.

### Option C: Cedar-only
**Pros:** Simpler than Rego.
**Cons:** Smaller ecosystem; forces users to learn a policy language for basic RBAC.

## Trade-off Analysis
The built-in engine covers 90% of users at zero learning cost; the adapter serves the 10% with sophisticated needs.

## Consequences
- Policy evaluation must be sub-millisecond in router hot path — decisions cached per (principal, action, resource).
- Adapter must return decisions in the same shape as built-in.
- Revisit if policy expressiveness demands (ABAC beyond RBAC) become common.

## Action Items
- [ ] `PolicyEngine` interface finalized in Phase 2.
- [ ] Decision cache with invalidation on role/permission change.
- [ ] Reference OPA adapter as a plugin in Phase 4.
