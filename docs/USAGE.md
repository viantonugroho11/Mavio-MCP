# Usage

End-to-end walk-throughs. All commands assume the server is running on `http://localhost:4000`. Substitute `MAVIO_ADMIN_API_KEY` where you see `$KEY`.

## Scenario 1 — Import an OpenAPI service and call a tool

```bash
# 1. Import
curl -X POST http://localhost:4000/api/imports/openapi \
  -H "content-type: application/json" \
  -H "authorization: Bearer $KEY" \
  -d '{
    "id": "petstore",
    "name": "Petstore",
    "url": "https://petstore3.swagger.io/api/v3/openapi.json",
    "workspaceId": "default",
    "projectId": "sandbox"
  }'

# 2. Verify it registered
curl -s http://localhost:4000/api/servers -H "authorization: Bearer $KEY" | jq

# 3. List tools via MCP
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[0:3]'

# 4. Call a tool
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"petstore.getPetById","arguments":{"petId":1}}
  }' | jq
```

CLI shortcut:

```bash
mavio import openapi --id petstore \
  --url https://petstore3.swagger.io/api/v3/openapi.json \
  --api http://localhost:4000 --key $KEY
```

## Scenario 2 — Import a Postgres database (read-only)

```bash
mavio import sql \
  --id analytics \
  --dsn "postgres://reader:pw@warehouse:5432/analytics" \
  --tables events,users \
  --read-only \
  --api http://localhost:4000 --key $KEY
```

Every table becomes one MCP tool: `analytics.select_events`, `analytics.select_users`. Args map to `WHERE` clauses.

## Scenario 3 — Mirror an existing MCP server

Stdio child process:

```bash
mavio import mcp --id filesystem --stdio "npx -y @modelcontextprotocol/server-filesystem /tmp" \
  --api http://localhost:4000 --key $KEY
```

HTTP:

```bash
mavio import mcp --id search --http https://example.internal/mcp \
  --auth secret://SEARCH_TOKEN --api http://localhost:4000 --key $KEY
```

The `secret://SEARCH_TOKEN` reference resolves from env at dispatch — never stored.

## Scenario 4 — SSE and WebSocket downstream

Classic MCP HTTP+SSE client:

```bash
# Terminal 1: subscribe
curl -N -H 'accept: text/event-stream' http://localhost:4000/mcp/sse

# You'll see: event: endpoint\ndata: /mcp?sid=<uuid>

# Terminal 2: POST correlated frames back
curl -X POST "http://localhost:4000/mcp?sid=<uuid>" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

WebSocket (single duplex socket):

```bash
websocat ws://localhost:4000/mcp/ws
# then paste JSON-RPC frames one per line
```

## Scenario 5 — Playground: invoke, replay, export

```bash
# invoke via playground API (records a run)
RUN=$(curl -s -X POST http://localhost:4000/api/playground/invoke \
  -H "content-type: application/json" -H "authorization: Bearer $KEY" \
  -d '{"server":"petstore","tool":"getPetById","args":{"petId":1}}' | jq -r .runId)

# replay the exact same call
curl -s -X POST http://localhost:4000/api/playground/runs/$RUN/replay \
  -H "authorization: Bearer $KEY" | jq

# export history as NDJSON
curl -s "http://localhost:4000/api/playground/runs/export?server=petstore&format=ndjson&limit=100" \
  -H "authorization: Bearer $KEY" -o petstore-runs.ndjson
```

## Scenario 6 — RBAC: create a scoped service principal

```bash
# 1. Create principal
PRIN=$(curl -s -X POST http://localhost:4000/api/rbac/principals \
  -H "content-type: application/json" -H "authorization: Bearer $KEY" \
  -d '{"type":"service","name":"ci-runner","workspaceId":"default"}' | jq -r .id)

# 2. Issue an API key for it
KEY_OUT=$(curl -s -X POST http://localhost:4000/api/rbac/principals/$PRIN/keys \
  -H "authorization: Bearer $KEY" | jq -r .apiKey)
echo "give this to CI: $KEY_OUT"

# 3. Grant tool:invoke on one specific server
curl -X POST http://localhost:4000/api/rbac/assignments \
  -H "content-type: application/json" -H "authorization: Bearer $KEY" \
  -d "{
    \"principalId\":\"$PRIN\",
    \"roleName\":\"invoker\",
    \"scope\":{\"workspace\":\"default\",\"server\":\"petstore\"}
  }"
```

CI now calls `/mcp` with `Authorization: Bearer $KEY_OUT` and can only invoke tools on `petstore`.

## Scenario 7 — Enterprise auth via reverse proxy

Front the server with a proxy (Envoy / oauth2-proxy / Pomerium) that terminates SSO or mTLS and forwards verified identity headers:

```
X-Auth-Subject: alice@example.com
X-Auth-Type: user
X-Auth-Workspace: acme
X-Auth-Scopes: server:read, tool:invoke
```

Enable on the server:

```
MAVIO_TRUSTED_PROXY_ENABLED=1
```

Or, for direct mTLS (when Node terminates TLS itself with `requestCert: true`):

```
MAVIO_MTLS_ENABLED=1
MAVIO_MTLS_WORKSPACE=svc
```

Principal derived from `subject.CN` on the peer cert.

## Scenario 8 — Delegate policy to OPA

```
MAVIO_RBAC_ENGINE=opa
MAVIO_RBAC_ENGINE_URL=http://opa:8181/v1/data/mavio/authz/allow
MAVIO_RBAC_ENGINE_TOKEN=<optional>
```

Server posts `{input:{principal, action, resource}}`; OPA returns `{result:{allow:true|false, reason}}`. Non-2xx or timeout → deny (fail-closed).

Minimal Rego:

```rego
package mavio.authz
default allow := false
allow if {
  input.principal.type == "user"
  input.action == "server:read"
}
```

## Scenario 9 — Multi-region

Region A:

```
MAVIO_REGION=eu-west
REDIS_URL=redis://shared:6379    # same Redis is fine
```

Region B:

```
MAVIO_REGION=us-east
REDIS_URL=redis://shared:6379
```

Tag a server so it only routes locally:

```json
{ "metadata": { "region": "eu-west" } }
```

Servers with no `metadata.region` remain globally routable.

## Scenario 10 — Prometheus + OTLP

```
# Prometheus scrape
curl -s http://localhost:4000/metrics | grep mavio_

# OTLP export (any collector that speaks OTLP HTTP)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=mavio-mcp

# quick debug — write spans to stdout
MAVIO_OTEL_DEBUG=1
```

## Scenario 11 — Marketplace (search + inspect)

```
MAVIO_MARKETPLACE_URL=https://plugins.mavio.dev/index.json
MAVIO_MARKETPLACE_PUBKEY_PEM=<PEM-encoded Ed25519 public key>
```

Then:

```bash
curl -s "http://localhost:4000/api/marketplace?q=slack" \
  -H "authorization: Bearer $KEY" | jq
```

## Scenario 12 — Audit query

```bash
curl -s "http://localhost:4000/api/audit?action=tool.invoke&outcome=error&limit=20" \
  -H "authorization: Bearer $KEY" | jq
```

---

Continue with **[CONFIGURATION.md](CONFIGURATION.md)** for every knob, or **[API.md](API.md)** for the full HTTP contract.
