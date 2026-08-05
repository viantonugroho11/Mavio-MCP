# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Active — security fixes and critical bugs |
| < 1.0 | ❌ Pre-GA — upgrade to 1.0.x |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Report privately via one of:

- GitHub Security Advisories: https://github.com/viantonugroho11/Mavio-MCP/security/advisories/new
- Email: security@mavio.local (replace with real inbox before publishing)

Include:

1. Affected version(s) and commit hash.
2. Repro steps (minimal PoC preferred).
3. Impact assessment — data exposure, privilege escalation, DoS, etc.
4. Any mitigations already in place.

Expect an acknowledgement within **72 hours** and a coordinated disclosure timeline within **7 days**.

## Threat model — quick reference

Mavio-MCP sits between untrusted MCP clients and (usually) trusted upstream backends. The trust boundaries are:

| Boundary | Enforcement |
|---|---|
| MCP client → router | API key / OIDC session / trusted-proxy header / mTLS cert |
| Router → RBAC | PolicyEngine (builtin / OPA / Cedar) — fail-closed |
| Router → upstream backend | Per-server rate limit + circuit breaker + secret-ref env resolution |
| Server → external registry | Read-only KV; source of truth stays Postgres |
| Server → marketplace | SHA-256 + optional Ed25519 signature verified before install |

Assumptions:

- Postgres and Redis are on a trusted network. Do **not** expose them to the internet.
- The reverse proxy in front of the server (in production) is trusted. Setting `MAVIO_TRUSTED_PROXY_ENABLED=1` without a validating proxy is a **critical misconfiguration** — anyone could set `X-Auth-Subject` and impersonate a user.
- Plugins run in the host process. Signed marketplace + semver gating narrows the surface but is not full isolation. Isolated-VM sandbox is the Phase 5 hardening step.

## Known deferrals (tracked)

- **Plugin sandboxing**: Phase 5 — isolated-vm workers.
- **npm supply-chain**: current dependabot advisory list on `main`. Merge queue must clear high/critical before release.

## Hardening checklist for production

- [ ] `MAVIO_ADMIN_API_KEY` set — never run open in prod.
- [ ] Reverse proxy validates TLS + SSO; `MAVIO_TRUSTED_PROXY_ENABLED=1` only enabled behind that proxy.
- [ ] `MAVIO_RBAC_ENGINE` explicitly set (even to `builtin`) — no silent fallback.
- [ ] Postgres connection uses TLS; Redis over TLS if leaving the cluster.
- [ ] Rotate `MAVIO_ADMIN_API_KEY` on a schedule; issue per-service API keys via `POST /api/rbac/principals/:id/keys` rather than sharing the admin key.
- [ ] Enable Prometheus + Otel; alert on `mavio_upstream_errors_total` and `mavio_rate_limit_denied_total` deltas.
- [ ] Marketplace disabled or `MAVIO_MARKETPLACE_PUBKEY_PEM` set — do not accept unsigned plugins.
- [ ] `pnpm audit --prod` clean at release time.

## Cryptography

- Ed25519 signatures on marketplace entries verified with native `crypto.verify("ed25519", …)` — no third-party crypto library.
- API key hashing: `sha256` (see `hashApiKey` in `@mavio/registry`). Rotation invalidates old keys immediately.
- OIDC: PKCE (S256) + `state` + `nonce`.
