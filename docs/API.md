# HTTP API reference

All admin endpoints (`/api/*`) require RBAC. Send `Authorization: Bearer <api-key>` or a `mavio_sid` cookie from an OIDC login. `/mcp` and `/mcp/sse` accept unauthenticated MCP frames only in dev-open mode.

Error shape (non-MCP endpoints):

```json
{ "statusCode": 403, "error": "authz denied: missing tool:invoke on server=petstore" }
```

Error shape (MCP endpoints — JSON-RPC 2.0):

```json
{ "jsonrpc": "2.0", "id": 2, "error": { "code": -32001, "message": "server not found: petstore" } }
```

JSON-RPC error codes used by Mavio:

| Code | Meaning |
|---|---|
| `-32001` | Server / tool not found |
| `-32003` | RBAC denied |
| `-32010` | Circuit breaker open |
| `-32011` | Rate limit exceeded |
| `-32000` | Unexpected upstream error |

---

## MCP data plane

### `POST /mcp`

Any MCP JSON-RPC frame.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

Optional query `?sid=<uuid>` fans the response onto an existing SSE session; HTTP responds `202` with an empty body.

### `GET /mcp/sse`

Server-Sent Events. First frame is always:

```
event: endpoint
data: /mcp?sid=<uuid>
```

Followed by:

- `event: message` — JSON-RPC responses fanned in from `POST /mcp?sid=<uuid>`
- `event: notification` — `notifications/tools/list_changed`
- `: keep-alive` — 15s ping comment

### `WS /mcp/ws`

Full-duplex. Client sends JSON-RPC frames; server writes correlated responses. 15s WS ping.

---

## Servers

| Method | Path | Guard | Body |
|---|---|---|---|
| GET | `/api/servers` | `server:read` | — |
| GET | `/api/servers/:id` | `server:read` | — |
| GET | `/api/servers/:id/capabilities` | `server:read` | — |
| POST | `/api/servers` | `server:write` | `ServerDescriptor` |
| DELETE | `/api/servers/:id` | `server:write` | — |
| GET | `/api/servers/:id/snapshots` | `server:read` | — |

---

## Imports

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/api/imports/openapi` | `server:write` | `{ id, url?, path?, baseUrl?, workspaceId, projectId, upstreamOAuthProvider? }` |
| POST | `/api/imports/sql` | `server:write` | `{ id, dsn, tables?, readOnly?, workspaceId, projectId, upstreamOAuthProvider? }` |
| POST | `/api/imports/graphql` | `server:write` | `{ id, endpoint, headers?, auth?, selectionDepth?, upstreamOAuthProvider? }` |
| POST | `/api/imports/mcp` | `server:write` | `{ id, transport: stdio\|http\|sse, name?, upstreamOAuthProvider? }` |

`upstreamOAuthProvider` (optional) is stored as `metadata.upstreamOAuthProvider` on the
resulting server descriptor. When set, the router resolves a per-principal upstream credential
(e.g. RFC 8693 token-exchange to a KrakenD/Keycloak-fronted backend) before every dispatch —
see [UPSTREAM_AUTH.md](UPSTREAM_AUTH.md). The web console exposes it on every import tab.

---

## Router (data-plane admin)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/router/capabilities` | Cached list of `serverId.toolName` |
| POST | `/api/router/invalidate` | Bust capability cache (`server:admin`) |

---

## Playground

| Method | Path | Guard | Notes |
|---|---|---|---|
| POST | `/api/playground/invoke` | `tool:invoke` | Body: `{ server, tool, args }` → `{ runId, latencyMs, response }` |
| GET | `/api/playground/runs` | `tool:invoke` | Query: `server?, limit?` |
| GET | `/api/playground/runs/:id` | `tool:invoke` | — |
| POST | `/api/playground/runs/:id/replay` | `tool:invoke` | Re-invokes with stored args |
| GET | `/api/playground/runs/export` | `tool:invoke` | Query: `server?, format=json|ndjson, limit? (≤1000)` |

---

## RBAC

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/api/rbac/principals` | `workspace:admin` | — |
| POST | `/api/rbac/principals` | `workspace:admin` | `{ type, name, workspaceId }` |
| POST | `/api/rbac/principals/:id/keys` | `workspace:admin` | Returns `{ apiKey }` once. Store it. |
| GET | `/api/rbac/roles` | `workspace:admin` | Builtin + custom roles |
| GET | `/api/rbac/assignments` | `workspace:admin` | — |
| POST | `/api/rbac/assignments` | `workspace:admin` | `{ principalId, roleName, scope }` |
| DELETE | `/api/rbac/assignments/:id` | `workspace:admin` | — |

---

## Auth / OIDC

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/providers` | Public list — id + displayName for login UI |
| GET | `/auth/:providerId/login` | Redirects to IdP (PKCE, state, nonce, `?return_to=`) |
| GET | `/auth/:providerId/callback` | IdP redirects here; sets session cookie |
| POST | `/auth/logout` | Clears session |
| GET | `/auth/me` | Current principal |
| GET | `/api/auth/providers` | Admin: list all providers |
| GET | `/api/auth/providers/:id` | Admin: read one |
| PUT | `/api/auth/providers/:id` | Admin: upsert |
| DELETE | `/api/auth/providers/:id` | Admin: remove |

---

## Plugins

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/api/plugins` | `plugin:install` | Loaded + persisted state |
| POST | `/api/plugins/:name/enable` | `plugin:install` | — |
| POST | `/api/plugins/:name/disable` | `plugin:install` | — |

## Marketplace

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/api/marketplace?q=` | `plugin:install` | `{ enabled, results }` |
| GET | `/api/marketplace/get?name=` | `plugin:install` | Full entry incl. sha256 + signature |

Disabled if `MAVIO_MARKETPLACE_URL` unset; returns `{ enabled: false, results: [] }`.

---

## Audit

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/api/audit?actor=&action=&outcome=&since=&limit=` | `audit:read` | Cap 500 |

---

## Observability

| Method | Path | Purpose |
|---|---|---|
| GET | `/metrics` | Prometheus text exposition. `Cache-Control: no-store`. Unauthenticated (scrape network isolation is your problem). |
| GET | `/healthz` | Liveness — always 200 while process is up |
| GET | `/readyz` | Readiness — 200 when DB + Redis reachable |
