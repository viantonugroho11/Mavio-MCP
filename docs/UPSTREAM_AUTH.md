# Upstream OAuth — per-principal credential vault

Mavio ships a per-principal upstream credential vault so a single MCP endpoint can call Slack as Alice, Notion as Alice, and Keycloak-fronted analytics-db as Alice — all from the same authenticated Mavio session. See **[ADR-018](architecture/adr/ADR-018-per-principal-upstream-oauth-vault.md)** for the design and **[ADR-019](architecture/adr/ADR-019-vault-key-rotation.md)** for key rotation.

## Concepts

- **Provider** — knows how to obtain and refresh an upstream token for one SaaS or IdP. Built-in: `slack`, generic `oauth2-authcode-pkce`, RFC 8693 `token-exchange` (Keycloak, KrakenD).
- **Vault** — Postgres table `principal_upstream_credentials`, envelope-encrypted (AES-256-GCM per-row DEK, KEK selected from ordered keyring).
- **Consent flow** — `GET /auth/upstream/:providerId/login` (requires Mavio session) → provider IdP → `GET /auth/upstream/:providerId/callback` → credential stored → 302 to `return_to`.
- **Middleware** — `RouterService.callTool` runs `UpstreamTokenService.resolveForDispatch` before dispatch. Missing credential → JSON-RPC `-32020` with `data.consentUrl` so the web console can redirect the user mid-invocation. Non-interactive providers (token-exchange) mint automatically.

## Setup — env vars

Always required:

```
MAVIO_VAULT_KEYRING="v1:<base64-32B>"        # first entry is primary
MAVIO_PUBLIC_BASE_URL=https://mcp.example.com # emitted in consentUrl
```

Generate a key:

```bash
openssl rand -base64 32
```

Slack (per-user xoxp tokens):

```
MAVIO_SLACK_CLIENT_ID=...
MAVIO_SLACK_CLIENT_SECRET=...
MAVIO_SLACK_USER_SCOPES=chat:write,channels:read,users:read
```

Slack app config: redirect URL = `https://mcp.example.com/auth/upstream/slack/callback`.

Keycloak / KrakenD token-exchange:

```
MAVIO_TOKENX_ID=keycloak-analytics
MAVIO_TOKENX_ENDPOINT=https://keycloak/realms/mavio/protocol/openid-connect/token
MAVIO_TOKENX_CLIENT_ID=mavio-server
MAVIO_TOKENX_CLIENT_SECRET=...
MAVIO_TOKENX_AUDIENCE=analytics-db
MAVIO_TOKENX_RESOURCE=https://analytics.example    # optional, RFC 8707
MAVIO_TOKENX_SUBJECT_PROVIDER_ID=mavio-session     # default; matches login capture
```

Keycloak client config: enable "Token Exchange", allow client to exchange from your Mavio-session client id, grant audience on the target client.

## Tag a server to require upstream OAuth

Set `metadata.upstreamOAuthProvider` on the `ServerDescriptor`:

```json
POST /api/servers
{
  "id": "slack",
  "name": "Slack (per-user)",
  "sourceType": "native",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-slack"]
  },
  "metadata": { "upstreamOAuthProvider": "slack" }
}
```

For token-exchange:

```json
"metadata": { "upstreamOAuthProvider": "keycloak-analytics" }
```

## User flow (Slack, per-user)

1. Alice logs into Mavio via existing OIDC (Google/Keycloak/…) — Mavio session cookie set, IdP tokens persisted to vault under `mavio-session`.
2. Alice invokes `slack.post_message` through the router.
3. Router sees `metadata.upstreamOAuthProvider = "slack"`, checks vault — nothing.
4. Router returns JSON-RPC `-32020` with `data = { providerId: "slack", consentUrl: "https://mcp.example.com/auth/upstream/slack/login?return_to=..." }`.
5. Web console redirects Alice's browser to `consentUrl`. Slack shows the authorize screen.
6. Slack redirects to `/auth/upstream/slack/callback?code=...&state=...`. Server exchanges the code, encrypts + stores `xoxp-alice-token`, 302s back to `return_to`.
7. Console retries the invoke. Router finds a valid credential, injects `SLACK_BOT_TOKEN=xoxp-alice-token` into the child process env, and Slack API responds as Alice.
8. Token refresh — Slack's rotating-tokens feature refreshes automatically when within 60s of expiry. If rotation is disabled on the Slack app, refresh fails with reconsent-required (user gets another `-32020`).

## User flow (Keycloak, no interactive consent)

1. Alice logs into Mavio via Keycloak OIDC (existing flow, unchanged).
2. Mavio persists the Keycloak `access_token` into the vault under `mavio-session` at callback time.
3. Alice invokes `analytics.query_events` — server tagged with `upstreamOAuthProvider = "keycloak-analytics"`.
4. Middleware looks up credential for `(alice, "keycloak-analytics")` — not there yet.
5. Provider is `TokenExchangeProvider`. `provider.mint()` runs: reads the `mavio-session` subject token, POSTs an RFC 8693 token-exchange to Keycloak with `audience=analytics-db`.
6. Keycloak returns a downstream token audienced at `analytics-db`. Stored + injected as `Authorization: Bearer <jwt>` on the outbound HTTP dispatch.
7. Backend (or the KrakenD gateway sitting in front of it) validates `aud`, sees Alice's `sub`, applies per-user policy and rate limits.

Zero extra clicks — the user was already authenticated to Keycloak at Mavio login.

## Admin operations

Metadata-only listing (never returns raw tokens):

```bash
mavio upstream list --principal alice-id --key $KEY
# OK  slack               scopes=chat:write,channels:read  expires=2026-08-06...  key_id=v1  subject=U123
# OK  keycloak-analytics  scopes=read:events               expires=2026-08-05...  key_id=v1  subject=alice
```

Revoke:

```bash
mavio upstream revoke --principal alice-id --provider slack --key $KEY
```

Force reconsent (deletes stored token + returns fresh consent URL):

```bash
mavio upstream reconsent --principal alice-id --provider slack --key $KEY
# open in browser: https://mcp.example.com/auth/upstream/slack/login?return_to=/
```

Or via HTTP:

```bash
curl -s -H "authorization: Bearer $KEY" \
  https://mcp.example.com/api/rbac/principals/alice-id/upstream-tokens

curl -X DELETE -H "authorization: Bearer $KEY" \
  https://mcp.example.com/api/rbac/principals/alice-id/upstream-tokens/slack

curl -X POST -H "authorization: Bearer $KEY" \
  https://mcp.example.com/api/rbac/principals/alice-id/upstream-tokens/slack/reconsent
```

All three endpoints require `workspace:admin`.

## Key rotation (ADR-019)

Rotate the KEK without downtime:

1. Generate a new 32-byte key: `openssl rand -base64 32`.
2. Prepend to `MAVIO_VAULT_KEYRING`: `v2:<new>,v1:<old>`.
3. Restart / hot-reload — `v2` becomes primary. Existing rows encrypted under `v1` decrypt normally; any row touched (read, refresh, put) is lazily re-wrapped under `v2` on next write.
4. Monitor `mavio_vault_rows_by_key{key_id="v1"}` — retire `v1` once it hits zero.
5. `POST /api/admin/vault/retire` (planned) — safe removal, gated on empty metric.

Lazy rewrap means no bulk migration and no downtime. A background sweep is optional if compliance requires a hard deadline for full rewrap.

## Metrics

```
mavio_upstream_token_refresh_total{provider,outcome}   # minted|refreshed|failed
mavio_upstream_token_denied_total{provider,reason}     # no_principal|unknown_provider|no_credential|mint_failed|refresh_failed
mavio_vault_decrypt_fail_total{reason}
```

## Audit events

```
upstream.token.issue     # login endpoint or mint success
upstream.token.revoke    # DELETE /api/rbac/.../upstream-tokens/:providerId
upstream.token.expired   # (planned) refresh cycle emits when reconsent triggered
```

## Threat model summary

| Concern | Mitigation |
|---|---|
| Vault DB dump leaks tokens | AES-256-GCM at rest; KEK never in DB (env or KMS). |
| KEK leak | Rotate via keyring prepend + hot reload; retire old key after lazy rewrap. |
| Cross-principal token access | Row-level `principal_id` binding; admin API returns metadata-only. |
| Impersonation via trusted-proxy header | `MAVIO_TRUSTED_PROXY_ENABLED` only enabled behind a validating proxy — see [SECURITY.md](../SECURITY.md). |
| Refresh silent-failure | Failed refresh → revoke local + `consent_required` returned to caller. No stale token ever dispatched. |

## What's not shipped yet

- `AwsKmsKekProvider`, `GcpKmsKekProvider`, `VaultTransitKekProvider` — Phase 5.2 (plugin ADR).
- Hot-reload channel for keyring — currently requires process restart to add a key.
- `POST /api/admin/vault/rotate|retire` endpoints — planned; use env change + rolling restart today.
- Background sweep for compliance-driven full rewrap deadlines.
- Redis-backed PKCE state store — current in-memory store only supports single-node deployments for the consent flow (multi-node deployments must set `MAVIO_PUBLIC_BASE_URL` to route consent through a sticky node).
