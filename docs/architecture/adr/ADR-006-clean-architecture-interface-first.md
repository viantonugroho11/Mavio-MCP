# ADR-006: Clean architecture with interface-first packages

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture

## Context
Hermes must support a plugin ecosystem where third parties add importers, transports, auth providers, and registry backends without forking core. Domain logic must be testable without HTTP or DB.

## Decision
Adopt **clean architecture**: domain types and interfaces live in `@hermes/core`; every capability is a package that depends on interfaces from core; adapters (HTTP, DB, MCP transports) implement interfaces; `apps/*` are thin composition roots that wire adapters to services.

## Options Considered

### Option A: Clean architecture / hexagonal
**Pros:** Testable in isolation; plugins have a stable surface; adapters swap without touching business rules.
**Cons:** More upfront design; boilerplate discipline required.

### Option B: Feature-sliced monolith
**Pros:** Faster start.
**Cons:** Plugin story becomes retrofit; test surface entangled with framework.

### Option C: Anemic services in NestJS modules
**Pros:** Familiar to Nest devs.
**Cons:** Framework leaks into domain, undermining plugin isolation.

## Trade-off Analysis
The plugin ecosystem is a first-class product requirement; that alone forces the interface-first stance. The extra ceremony pays for itself the first time a third party adds a transport without a core PR.

## Consequences
- Lint rule enforces no NestJS/Prisma imports from `packages/core`.
- Every service ships with an in-memory implementation for tests.
- Contract tests validate that plugin implementations satisfy interfaces.
- Revisit only if we abandon the plugin ecosystem (we won't).

## Action Items
- [ ] ESLint rule set for cross-package import restrictions.
- [ ] Contract-test scaffolding shipped in `@hermes/sdk`.
