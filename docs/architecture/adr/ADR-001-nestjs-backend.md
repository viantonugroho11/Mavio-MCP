# ADR-001: NestJS for backend services

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Backend Lead

## Context
Mavio-MCP ships three backend apps (`api`, `router`, `worker`) and many packages. We need a framework that enforces modularity, supports first-class DI (for interface-first clean architecture), integrates well with TypeScript, and has mature testing/interceptor primitives for cross-cutting concerns like auth, RBAC, audit, and rate limiting.

## Decision
Use **NestJS** as the framework for all backend apps.

## Options Considered

### Option A: NestJS
| Dimension | Assessment |
|---|---|
| Complexity | Medium (opinionated) |
| Cost | Low |
| Scalability | Strong (stateless-friendly) |
| Team familiarity | High in TS ecosystems |
| Reversibility | Medium — module boundaries port cleanly |

**Pros:** Built-in DI matches clean architecture; interceptors/guards/pipes fit auth/RBAC/validation; mature ecosystem; first-class testing.
**Cons:** Larger runtime footprint than Fastify-alone; opinionated module structure.

### Option B: Fastify + hand-rolled DI (tsyringe / inversify)
**Pros:** Lower overhead, more freedom.
**Cons:** Reinvents interceptor/guard machinery; slower to reach the same guarantees.

### Option C: tRPC-only
**Pros:** End-to-end types.
**Cons:** Router must speak MCP (a protocol, not tRPC); poor fit for streaming and non-TS clients.

### Option D: Hono / Express
**Pros:** Minimal.
**Cons:** No DI story out of the box; every cross-cutting concern becomes bespoke.

## Trade-off Analysis
The router is a data-plane hot path where Fastify's raw speed is tempting, but NestJS can host Fastify as its HTTP adapter — recovering most of the throughput while keeping the DI model uniform across all backend apps. Uniformity beats micro-optimization at this stage.

## Consequences
- Uniform testing, DI, and middleware model across apps.
- Onboarding easier for TS engineers.
- Must enforce: no NestJS types leak into `packages/*` domain code.
- Revisit if router p99 latency becomes framework-bound (switch NestJS to Fastify adapter or extract router to a thinner runtime).

## Action Items
- [ ] Base NestJS adapter selection: default Express, benchmark Fastify for router at Phase 3.
- [ ] Lint rule: `packages/*` cannot import `@nestjs/*`.
