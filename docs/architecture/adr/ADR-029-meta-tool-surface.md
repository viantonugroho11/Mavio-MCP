# ADR-029: Meta-tool surface — search, schema, execute instead of a flat tool list

**Status:** Proposed
**Date:** 2026-11-16
**Deciders:** Platform Architecture, DevEx, Security
**Depends on:** ADR-017 · **Relates:** ADR-018, ADR-020, ADR-025

## Context
`RouterService.listAllTools()` flattens every tool of every registered upstream
into one `tools/list` response, namespaced `serverId.toolName`. That cost grows
linearly with the catalog: ten upstreams of 20–30 tools each put several hundred
schemas into the agent's context before it does any work, and MCP clients
select tools worse as the list gets longer.

Three related gaps surface along the same path:

- **Unbounded results.** `callTool` returns the upstream payload as is. One
  unpaginated list call can exhaust the caller's context window.
- **No side-effect signal.** Nothing tells the client or the policy engine
  whether a tool reads, writes, or destroys. RBAC/OPA decisions and Inspector
  confirmations have nothing to key on.
- **Discovery is name-only.** An agent has to know `serverId.toolName` in
  advance; there is no way to find "the tool that opens a pull request".

The workbench project (amarthaid/workbench, v0.28) solves this by advertising
9 fixed meta-tools in front of 200+ plugin tools. Its docs describe the
contract and the failure modes it ran into; this ADR adapts that pattern to
Mavio's gateway model (remote upstreams, per-principal RBAC, sessions).

## Decision
Add a **meta-tool mode** to the Router. When it is on, `tools/list` returns a
fixed set of meta-tools, and upstream tools are reached by name through them.
The flat list stays available, so existing clients keep working.

### Mode selection
- Config `router.toolSurface: "flat" | "meta" | "auto"`, default `"flat"`.
- Per-principal override via the RBAC principal record, so a key can be moved
  to `meta` without a global switch.
- `"auto"` switches to `meta` when the principal's visible catalog exceeds
  `router.metaThreshold` tools (default 64).
- The chosen mode is fixed for a session at `initialize` (ADR-025 record gets
  `toolSurface`), so the tool list cannot change shape mid-session.

### Meta-tools

| Tool | Arguments | Returns |
|------|-----------|---------|
| `mavio_list_servers` | — | `{ servers: [{ id, name, health, connected }] }` — `connected` is per principal (ADR-018 vault) |
| `mavio_search_tools` | `query: string`, `limit?: 1–50 (10)`, `server?: string` | `{ tools: [{ name, description, server, score, effect }] }`, best first |
| `mavio_get_tool_schema` | `tool: string` | `{ schema, effect, annotations: { readOnlyHint, destructiveHint } }` or `{ error: "TOOL_NOT_FOUND" }` |
| `mavio_execute_tools` | `executions: [{ tool, args?, ref_id? }]` (1–16), `compose?: boolean`, `return?: any` | `{ results: [...] }` index-aligned, or `{ result }` in compose mode |

`mavio_` prefix keeps meta-tools out of the `serverId.` namespace. Visibility
in all four is filtered by the caller's RBAC scopes; a tool the principal cannot
call is never returned by search or schema.

### Execution semantics
- **Batch** (default): up to 8 concurrent through a bounded pool, results kept
  in input order, one failure does not abort the others.
- **Compose** (`compose: true`): at most 8 steps run in order; each needs a
  `ref_id`. A step's args may reference an earlier result as
  `{{step:<ref_id>.<path>}}` — whole-value refs keep their type, embedded refs
  interpolate as string/JSON, a malformed ref fails as `BAD_REF` before the
  step runs. Only own properties resolve. The first failing step ends the run.
  Only the resolved `return` template (or the last result) is sent back, so
  intermediate payloads never enter the agent's context.
- Every step goes through the existing `callTool` path unchanged: RBAC check,
  session `preCall` limits and loop guard (ADR-025), audit, trace (ADR-020),
  metrics. Meta-tools are a front end, not a second dispatcher.
- **Errors inside results are JSON-RPC success.** Shapes:
  `{ error: "TOOL_NOT_FOUND" }`, `{ error: "FORBIDDEN" }`,
  `{ error: "NOT_CONNECTED", server, message }`, `{ error: "SESSION_LIMIT", code: -32029 }`,
  `{ error: "<message>" }`. Only an unknown meta-tool or invalid meta-tool
  arguments return `-32602`. This is documented in the tool description because
  clients that only read the JSON-RPC error field will otherwise miss failures.

### Search ranking
In-process, no index, no new dependency:
- Tokenize query and each tool's name, server id, and description
  (snake/camel/punctuation split, stop words dropped, light stemming,
  `pull request`→`pr`, `merge request`→`mr`).
- Per word: exact 1.0, synonym 0.8, prefix (3+ letters) 0.7. Unknown words are
  corrected first by optimal-string-alignment distance (1 edit at 4+ letters,
  2 at 8+), scored at a discount; real words are never corrected.
- Weight name > server id > description, rare words above common ones, full
  coverage above partial, exact name first. Scores order one result list only.
- Corpus built from the capability cache; rebuilt on
  `notifications/tools/list_changed` and capability-cache invalidation.

### Side-effect labels
- `effect: "read" | "write" | "destructive"` per tool. Precedence, first match
  wins: admin override (`metadata.toolEffects[toolName]` on the server
  descriptor) > the upstream's MCP annotations (`readOnlyHint`/`destructiveHint`)
  > importer metadata (`x-mavio-http` GET/HEAD/OPTIONS, any `x-mavio-sql`,
  `x-mavio-graphql` query → `read`) > default **`destructive`**.
- Exposed in both surfaces (flat `tools/list` gets `annotations` too).
- Available to the policy engine (OPA/Cedar input field `tool.effect`) and to
  the Inspector for confirmation prompts.

### Result size cap
Applies to both surfaces, in `callTool` after dispatch:
- Result serialized to one text block, capped at `router.maxResultChars`
  (default 60,000).
- Past the cap the text is cut and a notice appended:
  `…[result truncated: N chars total, showing first M. Narrow the request (limit/fields/pagination).]`
- The cut is deliberately mid-structure, so a client cannot parse a partial
  result as complete. Images and other non-text content blocks pass through
  untouched and do not count toward the cap.
- Audit and trace record the full size and a `truncated` flag.

## Options Considered
### Option A: Keep the flat list, add pagination to `tools/list`
MCP supports `cursor`, but clients page through everything anyway; context
cost is unchanged. Does nothing for discovery or result size.
### Option B: Meta-tool mode alongside flat (chosen)
Fixed context cost, discovery by intent, batch/compose cuts round trips and
payload. Opt-in, so no client breaks.
### Option C: Meta-tool only
Simplest server, but breaks every existing client and tool-specific prompt
that names `serverId.toolName` in `tools/list`. Rejected.
### Option D: Embedding-based search
Better recall for vague queries, but adds a model dependency, an index to keep
in sync, and latency on every search. Word-level ranking is enough for tool
catalogs measured in hundreds; revisit if recall becomes a measured problem.

## Trade-off Analysis
Meta mode adds one or two round trips (search, schema) before the first call
of a new tool; batch and compose recover that for multi-step work. Agents
learn the four meta-tools instead of each upstream's schema, which moves
correctness onto search quality — ranking needs tests against real agent
phrasing, not only exact names. Compose concentrates more work in one request,
so session limits (ADR-025) must count each step, not the outer call.

Defaulting unlabelled tools to `destructive` is conservative and will make
policies stricter than today for upstreams that send no annotations; admins
need the per-server override from day one.

## Consequences
- `RouterService.handle` branches on the session's `toolSurface`; `callTool`
  stays the single execution path.
- New module `apps/server/src/meta-tools/` (search index, compose resolver,
  meta-tool handlers). No change to `@mavio/transport`.
- Policy input gains `tool.effect`; existing policies are unaffected until
  they reference it.
- Trace Inspector shows compose runs as one parent span with per-step children.
- Prometheus: `mavio_meta_search_total`, `mavio_meta_execute_steps_total`
  (labels: `mode`, no tool or session labels — cardinality rule from ADR-025);
  `mavio_result_truncated_total{server}`.
- Docs: client guide for meta mode, including the "errors are success" rule.

## Action Items
1. Result size cap in `callTool` (independent, ships first, both surfaces).
   **Done** — `apps/server/src/result-cap.ts`, config `router.maxResultChars`,
   metric `mavio_result_truncated_total{server}`, audit `resultChars`/`truncated`.
2. `effect` resolution + annotations on flat `tools/list` + admin override.
   **Done** — `apps/server/src/tool-effect.ts`; `ToolDefinition.annotations` in
   `@mavio/core`; `import-mcp` keeps upstream annotations (takes effect on
   re-import); override via `POST /servers` with `metadata.toolEffects`;
   audit records `effect` on every `tool.invoke`.
3. Search index over the capability cache + ranking tests from real queries.
4. `mavio_list_servers`, `mavio_search_tools`, `mavio_get_tool_schema`.
5. `mavio_execute_tools` batch mode on top of `callTool`.
6. Compose mode: `{{step:…}}` resolver, `BAD_REF`, `return` template, per-step
   session accounting.
7. `router.toolSurface` config + per-principal override + session pinning.
8. Policy input `tool.effect`, Inspector compose view, metrics, client docs.
