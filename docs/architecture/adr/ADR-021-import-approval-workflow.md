# ADR-021: Import approval workflow

**Status:** Accepted
**Date:** 2026-08-09
**Deciders:** Platform team

## Context
Prior behavior: any principal with `server:write` could import an MCP source
(OpenAPI, SQL, GraphQL, or MCP mirror) and the router immediately routed traffic
to it. This is unsafe for multi-tenant workspaces where non-admin users need to
propose sources without granting them the ability to expose arbitrary upstreams
(stdio commands, DSNs, HTTP endpoints) to every caller. There was no moderation
state, no `submitted_by` / `approved_by` record, and no gate at the router
before dispatch.

## Decision
Introduce a two-step flow: **submit → admin approve/reject**. All four import
endpoints require `server:import.submit` and always land the server row with
`approval_status='pending'`. The router filters non-approved servers from
`tools/list` and returns `-32002` on `tools/call` against a non-approved id.
Admin approves via `POST /api/imports/:id/approve` (requires `server:approve`),
or rejects with a reason. Direct `POST /api/servers` (admin infra path) uses
`autoApprove: true` and bypasses moderation.

## Options Considered

### Option A: `enabled` boolean toggle (like `plugins.enabled`)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Auditability | Weak — no submitter, approver, reason |
| Reversibility | Trivial |

**Cons:** cannot distinguish "never reviewed" from "actively disabled by admin";
no attribution.

### Option B: `approval_status` enum + attribution columns (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium (one migration, one router gate, one controller) |
| Auditability | Strong — `submitted_by`, `approved_by`, `approved_at`, `rejection_reason` |
| Reversibility | Easy (drop columns, restore old permission on imports) |

### Option C: Separate `import_submissions` table with promotion to `servers` on approve
| Dimension | Assessment |
|---|---|
| Complexity | High — dual write path, orphaned rows, capability snapshot re-keying |
| Auditability | Same as B |

**Cons:** router and every consumer would need to join two tables or query both;
capability snapshots point at `servers.id` and would need re-keying at approval.

## Trade-off Analysis
Option B wins: single source of truth (`servers`), one migration, gate applied
in exactly one place (router). Auditability matches option C without the dual
table cost. Bypass path (`autoApprove`) keeps the admin infra flow untouched.

## Consequences
- Router `loadServers()` uses `registry.list()` — default filter is
  `approvalStatus='approved'`. Callers that need pending must ask explicitly.
- `Registry.register()` on conflict resets to `pending` — re-submitting an ID
  cannot bypass approval by overwrite.
- Snapshot capabilities happen at submit time so admins can preview tools before
  approving. Live upstream connection at submit is unchanged behavior — same
  risk envelope as before this ADR.
- Audit log gains three actions: `server.import.submit`, `server.approve`,
  `server.reject`.

## Action Items
- [x] Migration: add `approval_status`, `submitted_by`, `approved_by`,
      `approved_at`, `rejection_reason` to `servers`.
- [x] `ServerDescriptor` bawa field approval.
- [x] Actions `ServerImportSubmit` + `ServerApprove`, wired into `admin` and
      `developer` built-in roles.
- [x] Router `-32002` gate on non-approved dispatch.
- [x] Web console: `/imports/pending` admin queue, status badge on `/`.
- [x] Next.js middleware: session-cookie guard on all non-`/login` routes.
- [ ] Follow-up: bulk approve, per-workspace approval delegation, notify submitter on decision.
