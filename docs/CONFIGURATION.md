# Configuration

Two sources of truth:

1. **`mavio.config.yaml`** — Postgres/Redis URLs, router tuning. Loaded once at boot via `@mavio/config`.
2. **Environment variables** — everything security-sensitive and every feature flag.

## mavio.config.yaml

Minimum:

```yaml
db:
  url: postgres://mavio:mavio@localhost:5432/mavio

cache:
  url: redis://localhost:6379

router:
  circuitBreaker:
    failureThreshold: 5
    resetMs: 30000
    halfOpenMaxCalls: 1
```

Optional keys:

```yaml
router:
  # Passed through to CapabilityCache; overrides default 300s TTL.
  capabilityTtlSeconds: 300

logging:
  level: info                 # error | warn | info | debug
```

## Environment variables

### Core

| Var | Default | Purpose |
|---|---|---|
| `MAVIO_HTTP_PORT` | `4000` | HTTP listen port (router + admin API). |
| `MAVIO_CONFIG_PATH` | `./mavio.config.yaml` | Path to config YAML. |
| `MAVIO_ADMIN_API_KEY` | *unset* | Bearer token that unlocks `/api/*`. Unset = dev-open mode. **Set in production.** |
| `MAVIO_REGION` | *unset* | Region name; scopes Redis cache keys and filters router server list. |

### Registry — external discovery

| Var | Default | Purpose |
|---|---|---|
| `MAVIO_EXTERNAL_REGISTRY` | *unset* | `etcd` or `consul` to enable. |
| `MAVIO_EXTERNAL_REGISTRY_ENDPOINT` | — | Required when enabled. |
| `MAVIO_EXTERNAL_REGISTRY_PREFIX` | `/mavio/servers/` (etcd), `mavio/servers` (consul) | KV prefix. |
| `MAVIO_EXTERNAL_REGISTRY_TOKEN` | *unset* | etcd bearer or Consul ACL token. |
| `MAVIO_EXTERNAL_REGISTRY_DC` | *unset* | Consul datacenter. |
| `MAVIO_EXTERNAL_REGISTRY_INTERVAL_MS` | `30000` | Poll interval. |

### RBAC engine

| Var | Default | Purpose |
|---|---|---|
| `MAVIO_RBAC_ENGINE` | `builtin` | `builtin` · `opa` · `cedar`. |
| `MAVIO_RBAC_ENGINE_URL` | — | Required for `opa` / `cedar`. |
| `MAVIO_RBAC_ENGINE_TOKEN` | *unset* | Optional bearer. |

### Federated identity

| Var | Default | Purpose |
|---|---|---|
| `MAVIO_TRUSTED_PROXY_ENABLED` | `0` | `1` enables `X-Auth-*` header trust. **Only set behind a validating proxy.** |
| `MAVIO_MTLS_ENABLED` | `0` | `1` reads `req.socket.getPeerCertificate()`. Needs HTTPS server with `requestCert: true`. |
| `MAVIO_MTLS_WORKSPACE` | `default` | Workspace stamped on mTLS-derived principals. |

### Observability

| Var | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *unset* | Enables OTLP HTTP exporter. |
| `OTEL_SERVICE_NAME` | `mavio-mcp-server` | Passed through to Otel resource. |
| `MAVIO_OTEL_DEBUG` | `0` | `1` also emits spans to stdout. |

### Marketplace

| Var | Default | Purpose |
|---|---|---|
| `MAVIO_MARKETPLACE_URL` | *unset* | Enables `/api/marketplace`. |
| `MAVIO_MARKETPLACE_PUBKEY_PEM` | *unset* | Ed25519 PEM public key for signature verification. |

### Secret references

Any `secretRef: "secret://ENV_NAME"` in `mavio.config.yaml` or import calls resolves to `process.env.ENV_NAME` at dispatch. Rotate a secret by updating the env; no restart required for new incoming calls.

## Server descriptor metadata

`ServerDescriptor.metadata` accepts:

| Field | Type | Purpose |
|---|---|---|
| `region` | string | Restricts router to serve this only when `MAVIO_REGION` matches. |
| `rateLimitRpm` | number | Per-server RPM budget applied per `(server, principal)`. |
| Any user field | any | Round-tripped as-is; use freely for your ops tooling. |

## Precedence

1. Env var
2. `mavio.config.yaml`
3. Compile-time default

Env always wins.
