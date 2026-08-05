# ADR-019: Vault key-encryption-key rotation (envelope encryption, downtime-free)

**Status:** Proposed
**Date:** 2026-08-05
**Deciders:** @viantonugroho11, security lead, platform lead
**Relates to:** [[ADR-018]] (per-principal upstream OAuth vault) — this ADR is a prerequisite.

## Context

[[ADR-018]] introduces `principal_upstream_credentials`, a Postgres table holding AES-256-GCM ciphertexts of user-scoped upstream tokens (Slack `xoxp-…`, Keycloak refresh tokens, KrakenD-audienced JWTs, …). Encryption key sits in env (`MAVIO_VAULT_KEY`). That gets us encrypted-at-rest with a single key.

Single-key model breaks the moment any of these happen:

1. **Key leak / suspected leak.** Someone `env | grep VAULT` in a shell history, or an ex-employee still on a bastion box. Every ciphertext must be re-encryptable under a new key **without service downtime and without invalidating live user sessions**.
2. **Compliance rotation.** SOC 2 / ISO 27001 / PCI expect key rotation on a defined schedule (typically 90 days). Rewriting every row on schedule is fine; taking downtime to do it is not.
3. **KMS adoption.** Some deployments want the DEK protected by an external KMS (AWS KMS, GCP KMS, HashiCorp Vault Transit, Azure Key Vault). Others stay env-only. The design must not paint us into a corner where switching is a multi-day migration.
4. **Multiple keys coexisting.** During rotation, old rows are still v1 while new writes are v2 — decrypt path must accept both. Same during a KMS cutover.

[[ADR-013]] covers **upstream secret rotation** — rotating the SaaS-side token (bot token, API key). That's different: it changes the plaintext. This ADR covers **key rotation** — rotating the AES key that *encrypts* those tokens. Complementary, not overlapping.

No decision here means: the moment `MAVIO_VAULT_KEY` needs to change, the operator has to stop the world, decrypt-and-re-encrypt every row offline, restart. Not acceptable for a v1.x product claiming enterprise-ready.

## Decision

Adopt **envelope encryption with keyring versioning**:

1. **Envelope model.** Each ciphertext row references a **Data Encryption Key (DEK)** version. The DEK is wrapped by a **Key Encryption Key (KEK)**. Rotation means adding a new (DEK, KEK) pair and lazily rewrapping — never a synchronous bulk rewrite.
2. **Keyring, not a single key.** `MAVIO_VAULT_KEYRING` is an ordered list of keys `id:material` (base64). The first entry is **primary** (used for new writes); the rest are decrypt-only (used to unwrap legacy rows). Rotation = prepend new key + hot reload.
3. **Row schema records the key id.** `principal_upstream_credentials.key_id` (text) marks which KEK wrapped the DEK for that row. Decrypt path selects by `key_id`.
4. **Lazy rewrap on next touch.** Every read/refresh that produces a row-write also re-encrypts under the current primary. No dedicated backfill needed for correctness; a background sweep is optional for compliance-driven full-rewrap deadlines.
5. **Pluggable KEK source.** Interface `KekProvider` with two ship-day implementations: `EnvKekProvider` (reads `MAVIO_VAULT_KEYRING`) and `NoopKekProvider` (dev only, plaintext — refuses to run when `NODE_ENV=production`). KMS-backed providers (`AwsKmsKekProvider`, `GcpKmsKekProvider`, `VaultTransitKekProvider`) ship in Phase 5.2 as plugins — same interface, different key material source.
6. **Explicit rotation admin API.** `POST /api/admin/vault/rotate` — accepts a new key id + material, prepends to the runtime keyring, publishes `mavio:vault:keyring:reload` on Redis so replicas hot-reload without restart. Old keys removed only via a follow-up `POST /api/admin/vault/retire` after every row is confirmed rewrapped (metric-gated).
7. **Audit every touch.** `vault.key.rotate`, `vault.key.retire`, `vault.key.decrypt_fail` events land in `audit_logs`. Decrypt failures also increment a Prom counter — repeated failures mean a key was lost.

Formally: **DEK per row** (random 32 bytes) + **KEK per keyring entry**. Row layout becomes `(key_id, wrapped_dek, iv, auth_tag, ciphertext)`. Wrapping algorithm: AES-256-GCM (same as data). No AES-KW / RSA-OAEP for MVP — one primitive, easier audit.

## Options Considered

### Option A: Single key, offline rewrap

Rotate `MAVIO_VAULT_KEY` by stopping the server, running a rewrap script, restarting.

| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | Down-time on every rotation |
| Scalability | Bad — O(rows) rewrap is a maintenance window |
| Reversibility | High |

**Pros:** No schema change. No keyring plumbing. One key, one env var.
**Cons:** Downtime. Locks out incident-response rotation (a leak needs *now*, not a maintenance window). Doesn't allow gradual KMS adoption. Rejected.

### Option B: Envelope encryption with keyring versioning (this ADR)

Per-row `key_id`, ordered keyring, lazy rewrap.

| Dimension | Assessment |
|---|---|
| Complexity | Medium — one column + a lookup + a hot-reload wire |
| Cost | ~1 day beyond ADR-018 vault work |
| Scalability | Good — rewrap is amortized over live traffic |
| Reversibility | Medium — schema column stays even if we back out |

**Pros:** Zero downtime rotation. Handles leak-response and scheduled rotation with the same mechanism. Pluggable KEK source keeps KMS adoption as a config change, not a rewrite. Composes with [[ADR-013]] — a KEK-decrypt failure at read time can trigger the same push-invalidate channel already in place.
**Cons:** Adds a column + a runtime map. Ops must understand "retire only after rewrap complete".

### Option C: KMS-only from day one (no local keyring)

Force every deployment to configure AWS KMS / GCP KMS. Data DEK wrapped remotely.

| Dimension | Assessment |
|---|---|
| Complexity | High for smaller deployments |
| Cost | KMS API charges per read (mitigated by DEK caching) |
| Scalability | Good |
| Reversibility | Low |

**Pros:** Best-in-class key security. Audit trail on the KMS side.
**Cons:** Forces cloud lock-in on all users, including self-hosted Kubernetes shops. Bad DX for the dev-machine case. Rejected as a hard requirement; kept as an opt-in `KekProvider`.

### Option D: Application-layer plaintext + Postgres TDE

Store tokens plaintext; rely on Postgres transparent data encryption at the storage layer.

| Dimension | Assessment |
|---|---|
| Complexity | Zero application-side |
| Cost | Zero |
| Scalability | N/A |
| Reversibility | High |

**Pros:** Simplest possible.
**Cons:** Breaks the whole security proposition of ADR-018. Any principal with `SELECT` on the table sees tokens. Postgres backups, pg_dumps, and replicas all leak. Rejected on threat-model grounds.

## Trade-off Analysis

Option B wins because it separates **three concerns that Option A conflates**:

1. What encrypts data → DEK (per row, random).
2. What protects the DEK → KEK (versioned, in keyring or KMS).
3. When rotation happens → decoupled from downtime because old KEKs stay in the keyring until retired.

The added complexity is bounded — one column, one map, one hot-reload channel. Every piece has a fallback path (missing key id → error with clear message; primary unavailable → deny writes, keep serving reads with old KEKs).

Key risk trade: **retire too early**. If an operator retires a KEK before every row referencing it is rewrapped, those rows are dead. Mitigation: `retire` requires a proof-of-empty metric (`mavio_vault_rows_by_key{key_id=X} == 0`) or an explicit `--force` with a big red warning.

Second trade: **DEK caching**. Wrapping every DEK on every read for a KMS-backed KEK is a QPS problem. Cache decrypted DEKs in Redis with `key_id:principal_id:provider_id` scoping, TTL 60s. Consistent with [[ADR-013]]'s cache model.

## Consequences

**Easier:**

- Rotation on suspected leak = single admin API call + hot reload. Minutes, not maintenance windows.
- Compliance rotation is a scheduled job hitting the same admin API.
- KMS adoption becomes a `KekProvider` swap + one env change, not a data migration.
- Threat model for [[ADR-018]] simplifies: DEK exposure is per-row, blast radius bounded even if one wrap key leaks.

**Harder:**

- Ops learning curve — "keyring" is a new concept for the runbook. Documented in [[UPSTREAM_AUTH]] under "Key rotation".
- Startup validation must catch a broken keyring loudly — refuse to boot if primary key is missing or malformed rather than silently downgrading.
- Every schema migration touching the vault must respect `key_id` — cannot drop a row without knowing which keys were retired.

**Revisit when:**

- KMS becomes the default deployment shape → consider deprecating `EnvKekProvider` for production.
- If per-row DEK proves too costly (unlikely at Mavio's expected write volume) → move to per-tenant DEK.
- Post-quantum crypto guidance changes → swap AES-GCM for whatever NIST recommends; envelope model unchanged.

## Action Items

- [ ] Schema addition in the [[ADR-018]] migration: `key_id text NOT NULL`, `wrapped_dek bytea NOT NULL`.
- [ ] `KekProvider` interface + `EnvKekProvider` implementation reading `MAVIO_VAULT_KEYRING` (format: `v1:<b64>,v2:<b64>` — first is primary).
- [ ] `Vault.encrypt(plaintext)` returns `{ keyId, wrappedDek, iv, authTag, ciphertext }`; `Vault.decrypt(row)` reverses.
- [ ] `NoopKekProvider` for dev — refuses `NODE_ENV=production`.
- [ ] Admin endpoints: `POST /api/admin/vault/rotate` (add key), `POST /api/admin/vault/retire` (remove key, gated on empty metric), `GET /api/admin/vault/status` (list active + row counts per key).
- [ ] Redis channel `mavio:vault:keyring:reload` — hot reload across replicas.
- [ ] Metrics: `mavio_vault_rows_by_key{key_id}`, `mavio_vault_decrypt_fail_total{reason}`, `mavio_vault_wrap_ops_total{op}`.
- [ ] Audit events: `vault.key.rotate`, `vault.key.retire`, `vault.key.decrypt_fail`.
- [ ] Startup guard: refuse to boot if `MAVIO_VAULT_KEYRING` unset in production, primary key malformed, or any row references an unknown `key_id`.
- [ ] Documentation: `docs/UPSTREAM_AUTH.md#key-rotation` — full rotation procedure with runbook.
- [ ] Follow-up plugin ADRs (non-blocking): `AwsKmsKekProvider`, `GcpKmsKekProvider`, `VaultTransitKekProvider`.
