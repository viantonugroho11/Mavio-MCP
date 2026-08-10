# ADR-023: Streamable HTTP Transport (MCP 2025-03 Mode B)

**Status:** Accepted (2026-08-10)

## Context

MCP spec 2025-03 introduces "Streamable HTTP" transport where session state
is carried in the `Mcp-Session-Id` HTTP header and the server MAY reply to
POSTs either as `application/json` or as `text/event-stream` bodies.
Client-initiated notifications flow through a separate `GET /mcp` SSE
stream keyed by the same session id.

Mavio already exposes classic MCP HTTP+SSE (`GET /mcp/sse` +
`POST /mcp?sid=<uuid>`). Modern MCP clients (Claude Desktop 2025-Q2+,
new SDKs) expect Streamable HTTP.

## Decision

Add a parallel `POST /mcp` + `GET /mcp` + `DELETE /mcp` Streamable HTTP
endpoint. Session state lives in a new `StreamableHttpSessionRegistry`.
Classic SSE endpoints and their registry remain unchanged.

- POST without `Mcp-Session-Id` + `frame.method === "initialize"` → create
  session, return `Mcp-Session-Id` header + JSON body.
- POST with `Mcp-Session-Id`, `Accept: text/event-stream` → reply SSE body.
- POST with `Mcp-Session-Id`, other Accept → reply JSON body.
- GET with `Mcp-Session-Id` → attach SSE push stream for notifications.
- DELETE with `Mcp-Session-Id` → terminate session.

Session TTL 24 h; buffer up to 100 notifications when no GET stream open.

## Consequences

- Two active MCP HTTP transports until deprecation timeline (out of scope).
- No changes to `RouterService`, so both transports share dispatch logic.
- Server-initiated MCP requests (server → client `request`, not
  `notification`) still not implemented.
