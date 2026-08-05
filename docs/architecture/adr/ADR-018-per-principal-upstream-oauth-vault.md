# ADR-018: Per-principal upstream OAuth token vault + generic token-injection middleware

**Status:** Proposed
**Date:** 2026-08-05
**Deciders:** @viantonugroho11, security lead, platform lead

## Context

Mavio's authentication story today covers **inbound identity** (who calls Mavio) but not **outbound delegation** (which token Mavio uses when it calls a backend on behalf of that identity).

What we ship in v1.0:

- **OIDC** — user logs into Mavio (Google/Okta/Keycloak/…) and gets a `mavio_sid` session cookie. `Principal.id` set. Token stays inside Mavio.
- **API keys** — per-principal Mavio-issued tokens for machine callers.
- **`secret://ENV`** — upstream credentials resolved from `process.env` at dispatch time. **Global.** Every user hitting the same upstream server uses the same credential.
- **Trusted-proxy / mTLS** — verified inbound identity, but again nothing carried outbound.

This breaks the moment a real deployment needs any of:

1. **Slack / Notion / GitHub / Google MCP servers.** Each user must act as themselves in Slack — bot token is the wrong identity. Today the workaround is one mirror per user (`slack-alice`, `slack-bob`, …) — does not scale past a small team and leaks tokens into `mavio.config.yaml`.
2. **Keycloak SSO with downstream audience-restricted access tokens.** Enterprise users log in through Keycloak; Mavio needs to exchange the user's Keycloak session for a token audienced at each backend (`aud: figma-mcp`, `aud: analytics-db`, …) using RFC 8693 token exchange.
3. **KrakenD (or any API gateway) sitting between Mavio and services.** KrakenD expects a JWT signed for its audience per user. Mavio must attach `Authorization: Bearer <user-token>` — bot token would be denied by gateway policy.
4. **Per-user rate limiting and audit on the backend side.** Backends charge / rate-limit / attribute usage by token subject. A shared token blinds all of that.

There is no clean single-file fix. Cross-cutting: DB schema, OAuth flows, middleware, refresh scheduler, RBAC, secret storage, plugin surface. Needs an ADR.

## Decision

Ship a **per-principal upstream credential vault** with a **generic token-injection middleware**, driven by declarative **upstream credential providers** configured at the server level. Slack / Notion / GitHub are just instances; Keycloak (as an IdP that mints downstream tokens) and KrakenD (as a gateway that consumes user JWTs) are first-class use cases.

Concretely:

1. **Postgres table `principal_upstream_credentials`** stores tokens keyed by `(principal_id, provider_id)`. Access + refresh + expiry + granted scopes + issuer metadata. Access tokens encrypted at rest.
2. **`UpstreamCredentialProvider` interface** in `@mavio/sdk`. Implementations know how to (a) start an OAuth authorization flow, (b) exchange callback code → tokens, (c) refresh, (d) revoke, (e) declare which server descriptors they apply to.
3. **`UpstreamTokenMiddleware`** hooked into `RouterService.callTool` — before `dispatchByKind`. Looks up credential for `(principal.id, descriptor.metadata.upstreamOAuthProvider)`, refreshes if near expiry, injects into the transport (env var for stdio, header for http/sse/ws/graphql).
4. **Built-in providers**: `oauth2-authcode-pkce` (generic), `oauth2-token-exchange` (RFC 8693 — Keycloak use case), `slack-user`, `google-workspace`. Custom providers ship via the existing plugin system (`@mavio-plugin/*`).
5. **Web-console consent flow**. When a logged-in user first invokes a tool that needs `provider=slack`, the console redirects them through the provider's OAuth authorize URL and returns to the invocation. Idempotent per (principal, provider, scopes).
6. **CLI + admin API surfaces** for token status / revoke / re-consent. Never for reading raw tokens.

Reuses the plugin SDK ([[phase3-status]] / ADR-008) for extensibility. Reuses OIDC controller pattern ([[phase2-status]]) for consent flows. Consistent with [[secret-rotation-lifecycle]] (ADR-013): tokens are just short-lived rotating secrets.

## Options Considered

### Option A: Per-user server mirrors (status quo workaround)

Register `slack-alice`, `slack-bob`, … each with its own `SLACK_BOT_TOKEN=xoxp-…` in `mavio.config.yaml` or env. RBAC restricts each user to their own mirror.

| Dimension | Assessment |
|---|---|
| Complexity | Low (nothing to build) |
| Cost | Low up front, quadratic in ops |
| Scalability | Bad — one server per user × per backend |
| Team familiarity | High |
| Reversibility | High — it's config-only |

**Pros:** Zero code changes. Works today. Easy to reason about per-user isolation.
**Cons:** Tokens sit in plaintext env / config. No refresh handling. RBAC assignments explode combinatorially. Onboarding a new user = manual admin work. Doesn't cover Keycloak/KrakenD token-exchange cases at all.

### Option B: Central vault + token-injection middleware (this ADR)

Postgres-backed vault, declarative provider registry, middleware injects at dispatch. Consent flow through web console. Refresh scheduler runs in background.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — bounded by existing plugin/middleware surface |
| Cost | ~2–3 weeks engineering + security review |
| Scalability | Good — O(users × providers), one row per pair |
| Team familiarity | Medium — token-exchange + refresh scheduling is new muscle |
| Reversibility | Medium — schema migration to remove, but no data-flow breakage |

**Pros:** One code path for Slack/Notion/GitHub/Google/Keycloak/KrakenD. Refresh handled once. Tokens encrypted, never in config. Enterprise-ready audit (which token was minted for whom, when).
**Cons:** New surface to secure (encryption keys, refresh loop, revocation). Adds latency (one Redis lookup + potential refresh) before every tool call. Needs UX for consent flow.

### Option C: Delegate everything to a sidecar (Envoy ext_authz / oauth2-proxy)

Front Mavio with an auth proxy that already knows how to mint downstream tokens (Envoy ext_authz + a custom auth server, or oauth2-proxy + upstream token endpoints). Mavio receives the ready-made `Authorization` on each request and forwards blindly.

| Dimension | Assessment |
|---|---|
| Complexity | High operationally, low code-side |
| Cost | Ops-heavy |
| Scalability | Good |
| Team familiarity | Low — auth proxies are their own skill tree |
| Reversibility | Low — inverts the trust boundary |

**Pros:** Zero token storage in Mavio. Battle-tested projects. Composable with existing SSO stack.
**Cons:** Fixes only the *inbound-to-Mavio* half — the proxy still needs somewhere to store per-user upstream refresh tokens. Deferring the problem, not solving it. Mavio still can't do "call Slack as Alice, then GitHub as Alice in the same request" without proxy config sprawl. Multi-provider fan-out is hard to express in one proxy pipeline.

### Option D: Terraform-style declarative credential mapping in mavio.config.yaml

Extend YAML with `upstreamCredentials: [{ principal, provider, secretRef }]` and resolve at dispatch.

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Low |
| Scalability | Bad — YAML doesn't refresh, doesn't consent |
| Team familiarity | High |
| Reversibility | High |

**Pros:** Consistent with [[yaml-config-source-of-truth]] (ADR-007).
**Cons:** Still no OAuth flow — you need an out-of-band way to mint the tokens. Still can't refresh. Config file becomes a token dump. Rejected.

## Trade-off Analysis

Option B wins on the correctness axis: it's the only design that actually models "Mavio calls upstream **as the user**" as a first-class concept. The others either:

- reduce to "shared credential + RBAC gate" (A, D) — masks the identity problem, breaks per-user audit downstream, and doesn't work at all when the backend enforces per-user quotas.
- push the state to a sidecar (C) — moves the storage problem outside our repo without eliminating it, and forfeits multi-provider fan-out in a single tool call.

Cost of B is bounded because the plugin/middleware surface already exists (from Phase 3a). Refresh scheduler is a well-known pattern (existing BullMQ worker slot in [[phase3-status]] can host it). Consent flow reuses the OIDC login controller pattern already shipped in Phase 2.

Key risk: **encryption key management**. Adopt a `MAVIO_VAULT_KEY` env (32-byte base64) with a rotation ADR (see follow-up). Tokens encrypted with AES-256-GCM before Postgres write. Key never in DB.

Second risk: **refresh thundering herd** when many tokens expire at similar times. Mitigation: jitter refresh windows, refresh on-demand at first use inside expiry-minus-jitter window rather than a global cron sweep.

## Consequences

**Easier:**

- Slack / Notion / GitHub / Google MCP servers deployable as **one** mirror serving all users — RBAC gates on the mirror, identity comes from the token.
- Keycloak SSO: user logs in once via existing OIDC path; downstream audiences minted via RFC 8693 token-exchange automatically on first use.
- KrakenD gateway: attach user JWT on every dispatched call; gateway policies audit and rate-limit per user without gateway-side coupling.
- Audit story on downstream side becomes real — each backend sees a distinct sub-token per user.
- Marketplace plugins can ship providers for niche SaaS (`@mavio-plugin/upstream-jira`, etc.) without core-repo changes.

**Harder:**

- Token vault becomes a top-priority security asset. Compromise = fan-out to N backends per user. Threat model doc needed.
- Latency: +1 Redis lookup before every dispatch. Cache hit path must be sub-millisecond.
- UX: users hit a consent redirect the first time they touch a new provider. Console must handle that mid-invocation gracefully.
- Refresh failures need surface — user must see "your Slack token expired, reconnect" without silent 401s from upstream.

**Revisit when:**

- If key management pain becomes real, move to an external KMS (Vault / AWS KMS) — see follow-up ADR.
- If per-request latency budget tightens, cache decrypted access tokens in Redis with short TTL keyed by `(principal, provider)`.
- If token-exchange usage dominates (Keycloak-heavy shop), consider caching exchanged tokens by (subject, audience) with STS-style short-lived scoping.

## Action Items

- [ ] Land migration adding `principal_upstream_credentials` table (encrypted access/refresh, expires_at, scopes, provider_id, updated_at).
- [ ] Add `UpstreamCredentialProvider` interface to `@mavio/sdk`.
- [ ] New pkg `@mavio/upstream-auth` with:
  - [ ] `Vault` (encrypt/decrypt/get/put/revoke).
  - [ ] `RefreshScheduler` (jittered on-demand refresh).
  - [ ] Built-in providers: `oauth2-authcode-pkce`, `oauth2-token-exchange`, `slack-user`, `google-workspace`.
- [ ] Wire `UpstreamTokenMiddleware` into `RouterService.callTool` before `dispatchByKind`.
- [ ] Add `upstreamOAuthProvider` to `ServerDescriptor.metadata` (string — provider id).
- [ ] Consent flow: `GET /auth/upstream/:providerId/login?return_to=…` → `GET /auth/upstream/:providerId/callback` → store in vault → redirect.
- [ ] Admin API: `GET /api/rbac/principals/:id/upstream-tokens` (metadata only), `DELETE /api/rbac/principals/:id/upstream-tokens/:providerId` (revoke).
- [ ] CLI: `mavio upstream list|revoke|reconsent`.
- [ ] Web console: "Connect Slack" / "Reconnect" chip on each server card requiring OAuth.
- [ ] Metrics: `mavio_upstream_token_refresh_total{provider,outcome}`, `mavio_upstream_token_denied_total{provider,reason}`.
- [ ] Audit: `upstream.token.issue`, `upstream.token.refresh`, `upstream.token.revoke`, `upstream.token.expired`.
- [ ] Docs: `docs/UPSTREAM_AUTH.md` walk-through covering Slack user-token, Keycloak token-exchange, KrakenD JWT-forward.
- [ ] Security review before merge: threat model, encryption, refresh loop, revocation propagation.
- [ ] Follow-up ADR-019: encryption key rotation for the vault (rewrap on rotation, downtime-free).
