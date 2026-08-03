# ADR-015: User identity & lifecycle model

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
Mavio-MCP has two consumer classes: **humans** who operate the console (import sources, register servers, test in playground) and **machine clients** (IDEs, agents, CI) that call the MCP router. Both must map to a first-class identity so RBAC ([ADR-009](ADR-009-rbac-builtin-opa-cedar-adapter.md)) can decide anything, and so audit ([ADR-016](ADR-016-audit-trail.md)) can attribute anything.

The v0.1.x MVP ships DB-backed principals + API-key auth. It does not yet ship a user-facing login flow, SSO, or self-service signup — and that is intentional. This ADR records the model and the phased path.

## Decision
A single `principals` table is the identity source of truth. Every action — HTTP admin, MCP call, playground invoke — resolves to exactly one `Principal { id, type: "user" | "service", workspaceId }`.

**Provisioning (MVP, v0.1.x):**
- **Bootstrap:** the operator runs Mavio with `MAVIO_ADMIN_API_KEY=…` in env. That value is a synthetic root principal (id `admin`, scopes `*`). It exists to unlock initial admin API calls and is never persisted to the DB.
- **Human users + service accounts:** created by an existing admin via `POST /api/rbac/principals` → then `POST /api/rbac/principals/:id/keys` returns a plaintext `mk_*` API key **once**. That key is SHA-256 hashed at rest.
- **Assignment:** `POST /api/rbac/assignments` binds a builtin (or later custom) role to a principal at workspace / project / server / tool scope. Deny by default.

**Authentication (MVP):** Bearer token → the guard checks in order:
1. `MAVIO_ADMIN_API_KEY` env match → synthetic root.
2. DB lookup by SHA-256 hash → stored principal.
3. Fall-through: if `MAVIO_ADMIN_API_KEY` unset → dev-mode root; if set → **401**.

**Phase 2 upgrade:**
- **OIDC / OAuth2 provider** attached to the same `principals` table. First successful OIDC login upserts a principal with `type: "user"`, seeds the default role from config (`rbac.defaultRole`), and issues a browser session cookie.
- **JWT for machine clients** — RS256 keys via JWKS; token subject claim maps to a `principals.id`.
- **API keys remain** for CI / non-interactive use.

**Workspace membership** is derived from `principals.workspace_id` (primary tenant) plus any `role_assignments` scoped to other workspaces (federated collaborators). A principal without an assignment in a workspace sees nothing there.

## Options Considered

### Option A: DB principals + API keys now, OIDC layered later (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low today, medium once OIDC lands |
| Cost | Zero external deps |
| Scalability | Fine — indexed lookups |
| Team familiarity | High |
| Reversibility | High — same table underpins OIDC |

**Pros:** Ships in v0.1; enterprise upgrade is additive; audit works from day one.
**Cons:** No self-service signup; humans have to be provisioned by an admin until OIDC lands.

### Option B: OIDC-only from day one
**Pros:** No API-key management for humans.
**Cons:** Blocks MVP on an IdP integration; machine clients still need something (JWT/keys), so it doesn't eliminate secondary flows.

### Option C: External identity provider (Auth0 / Clerk / WorkOS)
**Pros:** Feature-rich.
**Cons:** External dependency + cost for OSS users; ties the project to a vendor.

## Trade-off Analysis
Every action must resolve to an id; the id must live somewhere Mavio owns. That table is the anchor. OIDC and JWT are then just alternative ways to *bind a caller to an existing principals row* — no schema churn later.

## Consequences
- Admin bootstrap is env-var-only in MVP — must be documented prominently in the quick-start (already is).
- API keys are shown once; a lost key must be reissued. Documented behavior.
- Every `POST /api/rbac/*` mutation goes through `RbacGuard` requiring `workspace:admin`. Only admins can create principals or grant roles.
- Phase 2 adds `sessions` and `oidc_identities` tables; `principals` schema unchanged.

## Action Items
- [x] `principals`, `roles`, `role_assignments` tables + guards (delivered in `feat(rbac)`).
- [ ] Web console CRUD for principals + assignments (Phase 2).
- [ ] OIDC provider + session cookies (Phase 2, tracked in [ADR-009](ADR-009-rbac-builtin-opa-cedar-adapter.md) roadmap).
- [ ] JWT verification for machine clients (Phase 2).
