# ADR-004: pnpm workspaces + Turborepo

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, DX Lead

## Context
Hermes has 3 apps and 15+ packages that must build, test, and version together. We need fast installs, strict dep isolation (packages shouldn't accidentally import unlisted deps), and a cacheable task graph.

## Decision
Use **pnpm workspaces** for dependency management and **Turborepo** for task orchestration.

## Options Considered

### Option A: pnpm + Turborepo
**Pros:** Fast, strict, low ceremony; hoisting off by default; Turbo caches build/test outputs; local + remote cache (Vercel or self-hosted).
**Cons:** Newer than Nx.

### Option B: Nx
**Pros:** Powerful graph tools and generators.
**Cons:** Heavier ceremony for our scale; generator lock-in.

### Option C: Rush
**Pros:** Enterprise features.
**Cons:** Steeper learning curve; smaller community.

### Option D: Polyrepo
**Pros:** Independent release cadence.
**Cons:** Cross-package changes become PR chains; harder to enforce interface stability.

## Trade-off Analysis
Turborepo's simplicity fits an OSS project where contributors should get productive fast. Nx becomes attractive later if we adopt heavy code generation.

## Consequences
- `packages/*` published to npm on release; apps stay internal (Docker images).
- Turbo remote cache required for scalable CI once contributor count grows.
- Revisit if generator/scaffolding needs outgrow simple templates.

## Action Items
- [ ] `pnpm-workspace.yaml` + `turbo.json` scaffold.
- [ ] Publish flow (Changesets) wired in Phase 1.
