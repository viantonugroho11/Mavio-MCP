# Architecture Review Notes — Hermes MCP v1.0 Draft

**Reviewer:** Principal Architecture
**Date:** 2026-08-03
**Target:** [`hermes-mcp-architecture.md`](hermes-mcp-architecture.md)

## Overall Verdict
**Accept with follow-ups.** The core is coherent, modular, and implementable. Four gaps are worth closing before Phase 1 kickoff; another six are worth acknowledging on the roadmap.

## Strengths
1. **Clean architecture with interface-first packages** (§3, §6) — enables the plugin ecosystem without core edits.
2. **Single MCP endpoint** (§13) — decisive UX win; blast radius mitigated by statelessness + circuit breakers.
3. **Config-as-truth** (§9) — GitOps-friendly, reproducible.
4. **RBAC scoped at workspace/project/server/tool** (§8) — right granularity for MCP.
5. **Plugin sandboxing with capability grants** (§10) — pragmatic phased approach.

## Gaps closed with new ADRs
| Gap | Addressed by |
|---|---|
| Multi-tenancy physical isolation model | [ADR-011](adr/ADR-011-multi-tenancy-isolation.md) |
| Schema migration tool & zero-downtime discipline | [ADR-012](adr/ADR-012-schema-migration-tool.md) |
| Secret rotation & revocation propagation | [ADR-013](adr/ADR-013-secret-rotation-lifecycle.md) |
| License & dual-license posture | [ADR-014](adr/ADR-014-open-source-license.md) |

## Gaps to acknowledge on the roadmap (not blocking Phase 1)
1. **Backup & DR** — RPO/RTO targets, snapshot cadence, restore drills. Owner: SRE. Target: Phase 2.
2. **MCP error taxonomy** — canonical mapping from backend errors → MCP standard codes with retry semantics. Owner: Protocol Lead. Target: Phase 2.
3. **Feature flags / kill switches** — for staged rollout of importers, transports, plugins. Owner: DX. Target: Phase 3.
4. **Telemetry opt-out & privacy** — default posture for anonymous usage stats; documented. Owner: DevRel + Legal. Target: Phase 1 (must decide before public preview).
5. **CLI UX detail** — full command tree, non-interactive flags, autocompletion for bash/zsh/fish. Owner: DX. Target: Phase 1.
6. **Docs site** — Docusaurus or Nextra; versioned docs; API reference from TypeDoc. Owner: DevRel. Target: Phase 1 for MVP docs; Phase 2 for versioning.

## Smaller nits worth fixing in the base doc
- **§13.4 Session Multiplexing** — spell out idle-eviction TTL default (suggest 5 min) and per-server session cap.
- **§16 Security** — add "supply chain: reproducible builds where feasible; SLSA level target."
- **§17 Scalability** — quantify starting targets (e.g., "single router replica handles 500 rps p99 <100ms with 10 backends"). Load-test plan needed.
- **§18 Extensibility** — add explicit **contract test suite** requirement for every extension interface.
- **§10 Plugin Architecture** — UI extensions running in the console need a documented CSP posture (worker vs iframe vs component).

## Non-functional requirements to lock in
| NFR | Target |
|---|---|
| Router p99 latency (proxy hop only) | ≤ 50ms |
| Registry lookup (cached) | ≤ 5ms |
| Auth verification | ≤ 10ms |
| Cold start (API app) | ≤ 3s |
| MTTR for a single-server failure | ≤ 30s (circuit breaker + retry) |
| Config hot-reload propagation | ≤ 2s |

## Decision on next steps
1. Merge base architecture doc as v1.0-draft.
2. Merge ADR-001..010 as **Accepted**.
3. Merge ADR-011..014 as **Proposed** — walk through in the next architecture review.
4. Open Phase 1 tickets from §19; block on ADR-011 + ADR-012 being **Accepted** before writing the first migration.
