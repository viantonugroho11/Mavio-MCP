# ADR-008: Sandbox plugins in worker_threads → isolated-vm

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security

## Context
Third-party plugins can add importers, transports, auth, UI extensions, and middleware. They must not exfiltrate secrets, escape into the host process, or grant themselves capabilities they weren't granted.

## Decision
Ship plugin sandboxing in two waves:
1. **Phase 3 (v0.4):** Node `worker_threads` + capability grants declared in plugin manifest + install-time consent + Sigstore signature verification.
2. **Phase 4+ (v1.0):** Migrate to `isolated-vm` for stronger isolation where the plugin API surface allows.

## Options Considered

### Option A: Full trust
**Pros:** Simplest.
**Cons:** Any malicious plugin compromises the process. Unacceptable.

### Option B: worker_threads + capability model
**Pros:** Native, well-supported; message-passing boundary; capabilities gate network/fs/secret access.
**Cons:** Same V8 isolate as host — memory isolation weaker than isolated-vm.

### Option C: isolated-vm from day one
**Pros:** Real V8 isolate boundary.
**Cons:** Ergonomic cost for plugin authors (no direct Node module access); slower iteration on plugin API surface.

### Option D: OS-level sandbox (containers, Firecracker)
**Pros:** Strongest isolation.
**Cons:** Massive ops overhead for OSS deployments; overkill for the threat model.

## Trade-off Analysis
Start with the pragmatic option that gets a plugin ecosystem shipping, plus signature verification and capability grants to raise the bar meaningfully. Migrate to isolated-vm once the plugin API is stable and we know which surfaces need harder isolation.

## Consequences
- Plugin API must be message-passable (no shared mutable state across the boundary).
- UI extensions run in the browser sandbox with CSP; server-side UI code (e.g., SSR) still worker-isolated.
- Revisit at v1.0: measure real-world exploits and pick isolated-vm scope.

## Action Items
- [ ] Manifest schema with `contributes` and `permissions` fields.
- [ ] Install-time consent flow.
- [ ] Sigstore verification in `@hermes/package-manager`.
