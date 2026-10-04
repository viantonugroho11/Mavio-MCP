# ADR-026: Transport bridge — modernize legacy MCP upstreams

**Status:** Proposed
**Date:** 2026-10-04
**Deciders:** Platform Architecture, DevEx
**Depends on:** ADR-023, Phase 3c (MCP mirror)

## Context
Many existing MCP servers speak only stdio or classic HTTP+SSE. Modern
clients expect Streamable HTTP. Mavio already mirrors upstream MCP servers
(import-mcp) and serves Streamable HTTP downstream, so in principle it bridges
transports. Today that is incidental: there is no explicit contract, the
stdio process lifecycle is unspecified, and nothing documents the
"put Mavio in front" story.

This is an adoption feature: the lowest-friction reason to install Mavio.

## Decision
Formalize **any upstream transport → any downstream transport** bridging.

- Upstream adapters: `stdio` (spawned process), `sse` (classic),
  `streamable-http`, `websocket` (Phase 4a).
- Downstream: every upstream tool is reachable via all enabled client
  transports with no per-upstream config.
- stdio lifecycle: pool per upstream (`mode: shared | per-session`), health
  checks, restart with backoff, stderr captured to logs, hard memory/CPU
  limits when running in a container.
- Session mapping: downstream session ↔ upstream session is 1:1 in
  `per-session` mode and N:1 in `shared` mode. Upstream server→client
  notifications are routed back to the owning downstream session(s).
- CLI one-liner: `mavio bridge -- npx some-mcp-server` starts a local gateway
  exposing it as Streamable HTTP.

## Options Considered
### Option A: Document current behaviour only
Cheap; leaves stdio lifecycle undefined.
### Option B: First-class bridge with lifecycle (chosen)
### Option C: Separate `mavio-bridge` binary
Simpler to adopt, but duplicates the router; can come later as a thin wrapper.

## Trade-off Analysis
`per-session` stdio gives correct isolation for stateful servers, but process
count grows with sessions; `shared` is efficient but leaks state across users.
The default is `shared` for servers flagged stateless and `per-session`
otherwise, with an idle reaper.

## Consequences
- **Security:** spawning arbitrary commands is code execution. Only admin-
  configured commands; never client-supplied; sandbox recommended.
- The marketplace (Phase 4f) can list stdio servers installable "as HTTP".

## Action Items
1. Audit import-mcp upstream adapters; fill the stdio pool + lifecycle gaps.
2. `mavio bridge` CLI command.
3. E2E matrix: {stdio, sse, streamable} upstream × {sse, streamable} downstream.
4. Docs page: "Expose a stdio MCP server over HTTP in 1 minute".
