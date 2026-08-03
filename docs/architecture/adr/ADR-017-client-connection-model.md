# ADR-017: Client connection model — Router is the only public surface

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
A recurring question: when a Claude Code / Cursor / agent client wants to reach a backend MCP server that Mavio manages, does the client talk **through** Mavio or **directly** to that backend?

The answer defines the security model, the audit story, and what Mavio actually *is* in the deployment.

## Decision
**All external clients connect to the Router endpoint (`POST /mcp`). Nothing else is exposed.** Backend MCP servers — stdio processes, remote HTTP MCPs, generated OpenAPI/SQL/GraphQL adapters — are never advertised to end clients. Direct connection is unsupported and, where the deployment topology allows, network-blocked.

Concretely:
1. **Client config:** every client points at one URL and holds one credential. Example (Claude Code / Cursor):
   ```jsonc
   {
     "mcpServers": {
       "mavio": {
         "url": "https://mavio.example.com/mcp",
         "headers": { "Authorization": "Bearer mk_…" }
       }
     }
   }
   ```
   The client sees a single MCP server whose tools list is the **union** of every backend the caller is authorized to see, namespaced (`serverId.toolName`).
2. **Router does per-call**, in this order:
   - **Auth** — resolve principal (env admin key, DB `mk_*` key, dev fallback, or in Phase 2 JWT/session).
   - **Rate limit** — token bucket per principal (fixed-window today, sliding-window later).
   - **RBAC** — `tool:invoke` on the scoped resource `{ workspace, project, server, tool }`. Deny by default.
   - **Dispatch** — pick the correct adapter (OpenAPI HTTP, SQL, GraphQL, or native MCP passthrough via stdio/HTTP).
   - **Audit** — one `mcp.tool.call` event ([ADR-016](ADR-016-audit-trail.md)).
3. **Broker vs pass-through auth to backends** is configurable per server:
   - **Broker (default):** router replaces the caller's credentials with a server-specific secret from `secret://…`. Callers never see the downstream secret.
   - **Pass-through:** router forwards the caller's bearer to the backend as-is. Reserved for cases where the backend itself does the RBAC (e.g., a customer's own API where the caller has native creds).
4. **Local stdio backends** are spawned by the router process itself. No network to reach at all — they inherit `stdio` and cannot be talked to directly.
5. **Remote HTTP/GraphQL backends** should live in a private network or be reachable only from the router's egress IP. Enforcement is deployment-layer (VPC peering, security groups, mTLS between router and backend); Mavio documents the requirement but does not itself firewall.

**When a client legitimately needs to reach a backend directly** (rare — e.g., debugging a stdio server in isolation), the developer runs that backend locally in dev mode outside Mavio. That is not a Mavio flow.

## Options Considered

### Option A: Router-only surface (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low for clients (one URL, one key) |
| Cost | Router is a hot path — mitigated by cache + stateless replicas |
| Scalability | Horizontal via Router replicas |
| Team familiarity | Standard gateway pattern |
| Reversibility | Low — the pattern *is* the product |

**Pros:** One place for auth / RBAC / audit / rate limit; consistent client config; downstream secrets stay server-side; no backend-endpoint sprawl in client configs.
**Cons:** Router is a single blast radius (mitigated by circuit breakers + horizontal scaling); pass-through mode must be conscious opt-in.

### Option B: Advertise backends directly, Mavio as a directory only
**Pros:** Router isn't on the hot path.
**Cons:** Each client gets N URLs and N credentials; auth/RBAC/audit smear across N backends; direct connectivity to internal networks required; downstream secrets leak to clients. This is the problem Mavio exists to solve.

### Option C: Hybrid — router optional, direct as advanced
**Pros:** Flexibility.
**Cons:** Two threat models to maintain; audit gaps whenever clients bypass; guidance becomes fuzzy.

## Trade-off Analysis
The whole point of a gateway is that it *is* the surface. Any leak of a direct path defeats the auth, audit, and RBAC investments. The rare "I need to hit the backend directly" case is a development-time concern, not a production topology.

## Consequences
- Deployment guide must say "block direct backend access at network layer." A CLI `mavio doctor` (Phase 2) can probe from a public network and flag leaks.
- Every backend registration ships with a per-server broker secret by default — documented in the import flows.
- Client onboarding is trivial: give a URL + key; the toolset materializes.
- Router latency budget matters: target p99 ≤ 50ms proxy hop (see [review notes](../review-notes.md)).

## Action Items
- [x] `POST /mcp` single endpoint with namespaced tools (delivered).
- [x] Broker vs pass-through toggle per backend (implicit today — secretRef vs no auth).
- [ ] `mavio doctor` command that probes for direct backend reachability from an untrusted network (Phase 2).
- [ ] Deployment docs section: network isolation topology, mTLS suggestion, VPC guidance (Phase 2).
- [ ] Per-server explicit `authMode: broker | passthrough` field in config schema (Phase 2, replaces the current implicit behavior).
