# ADR-013: Secret rotation & revocation lifecycle

**Status:** Proposed
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
The base architecture defines a `SecretProvider` interface but doesn't specify rotation, revocation propagation, or caching semantics. This is a common source of production incidents.

## Decision (proposed)
Every secret has:
1. **Versioned reference:** `secret://acme/orders-token@v3` optional; unversioned refs resolve to `@latest`.
2. **TTL-bounded cache:** `SecretProvider` caches for at most 60s.
3. **Push invalidation:** providers that support push (Vault, AWS SM) publish to Redis channel `mavio:secrets:invalidate`; router and workers drop the cached value.
4. **Explicit rotation API:** `POST /admin/secrets/:ref/rotate` — creates new version, updates references, keeps old version accessible for grace window (default 10 minutes) to bleed off in-flight requests.
5. **Revocation:** immediate cache purge + connection reset for affected server sessions.

## Options Considered

### Option A: TTL cache + push invalidation (proposed)
**Pros:** Correctness bounded by TTL even without push; near-instant propagation when push available.
**Cons:** Two paths to maintain.

### Option B: TTL only
**Pros:** Simple.
**Cons:** Revocation lag equals TTL — unacceptable for compromised keys.

### Option C: No cache
**Pros:** Always correct.
**Cons:** Latency and provider quota costs prohibitive.

## Trade-off Analysis
The push-plus-TTL model is standard; the grace window on rotation preserves in-flight tool calls.

## Consequences
- API-key providers get an internal push implementation for free (write triggers Redis publish).
- Documented SLA: "revocation propagates within 60s (fallback) or under 1s (push-enabled providers)."
- Revisit if a provider integration cannot support push and users demand tighter SLAs.

## Action Items
- [ ] Redis pub/sub channel spec.
- [ ] Grace-window handling in Router (double-key acceptance).
- [ ] Audit event on every rotate/revoke.
