# Deployment

Reference for shipping Mavio-MCP to a real environment. Assumes you've followed **[INSTALL.md](INSTALL.md)** locally at least once.

## Recommended production topology

```
                     ┌─────────────────┐
     MCP clients ───▶│  Reverse proxy  │──▶ Mavio-MCP pods (N ≥ 2)
                     │  (Envoy / NGINX │        │
                     │   / Pomerium)   │        ├─▶ PostgreSQL (managed)
                     └─────────────────┘        └─▶ Redis (managed)
                            │
                            └─▶ terminates TLS + SAML/OIDC/mTLS,
                                forwards X-Auth-Subject / -Type / -Workspace
```

- Multiple replicas of the server behind a load balancer. Stateless; sessions live in Postgres.
- Postgres = source of truth. Managed (RDS / Cloud SQL) recommended.
- Redis = cache + invalidation bus + rate limits + BullMQ. Managed (ElastiCache / MemoryStore).
- Reverse proxy handles TLS + SSO. Backend trusts `X-Auth-*` (see **CONFIGURATION.md**).

## Helm

Chart: `deploy/helm/mavio-mcp/`.

### Install

```bash
helm upgrade --install mavio deploy/helm/mavio-mcp \
  --namespace mavio --create-namespace \
  --values my-values.yaml
```

### Key `values.yaml`

```yaml
image:
  repository: ghcr.io/your-org/mavio-mcp
  tag: "1.0.0"
  pullPolicy: IfNotPresent

replicaCount: 3

env:
  MAVIO_ADMIN_API_KEY: <inject-via-secret>
  MAVIO_REGION: eu-west
  MAVIO_TRUSTED_PROXY_ENABLED: "1"
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.observability:4318

postgres:
  url: postgres://mavio:pw@pg.svc:5432/mavio    # or set via secretRef

redis:
  url: redis://redis.svc:6379

ingress:
  enabled: true
  host: mcp.example.com
  tls:
    enabled: true
    secretName: mavio-tls

serviceMonitor:
  enabled: true                                 # if using Prometheus Operator
  namespace: monitoring
  interval: 30s

resources:
  requests: { cpu: 200m, memory: 256Mi }
  limits:   { cpu: 1,    memory: 512Mi }

podSecurityContext:
  runAsNonRoot: true
  runAsUser: 10001
  fsGroup: 10001

securityContext:
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 8
  targetCPUUtilizationPercentage: 70
```

### Rollback

```bash
helm history mavio -n mavio
helm rollback mavio <revision> -n mavio
```

## Raw K8s

For non-Helm shops, `deploy/k8s/*.yaml` mirrors the chart output. Apply and edit.

## Docker

```bash
docker build -f deploy/docker/Dockerfile -t mavio-mcp:1.0.0 .
docker run --rm -p 4000:4000 \
  -e MAVIO_ADMIN_API_KEY=... \
  -e POSTGRES_URL=... -e REDIS_URL=... \
  -v $(pwd)/mavio.config.yaml:/app/mavio.config.yaml:ro \
  mavio-mcp:1.0.0
```

Multi-stage build produces a slim runtime image (no dev deps, no test artifacts).

## Sizing rough starting point

| Load | Replicas | CPU / pod | Memory / pod | Postgres | Redis |
|---|---|---|---|---|---|
| Dev | 1 | 200m | 256Mi | Local | Local |
| Small team (< 100 rpm) | 2 | 500m | 512Mi | db.t4g.small | cache.t4g.small |
| Team (< 1k rpm) | 3–5 | 1 | 1Gi | db.m5.large | cache.m5.large |
| Enterprise (> 5k rpm) | 8+, HPA | 1–2 | 2Gi | db.m5.2xlarge, RO replica for reads | Redis cluster |

Real numbers depend heavily on tool response sizes and upstream latency. Watch `mavio_router_request_duration_seconds` p95/p99.

## HA & multi-region

- Run ≥ 2 replicas per region behind the load balancer. Sessions are Postgres-backed so any pod can serve any request.
- For multi-region, set `MAVIO_REGION` per deployment and tag servers with `metadata.region`. Route DNS/GSLB to the nearest region. Regions can share a Redis for cross-region cache visibility, or each region can run its own.
- Postgres — use a primary + read replica in the primary region; async replica in secondary regions. Cross-region writes still hit the primary.

## Backups

- **Postgres**: managed automated backups + logical dumps (`pg_dump mavio | gzip > mavio-$(date +%F).sql.gz`) on the schedule your compliance needs.
- **Redis**: ephemeral. `capability_snapshots` and `playground_runs` in Postgres cover audit; Redis rebuilds on demand.
- **Config**: `mavio.config.yaml` in version control. Server descriptors auto-rebuild from importers on-demand.

## Zero-downtime deploy

- Rolling update with `maxSurge: 1, maxUnavailable: 0`.
- Server drains active WS/SSE on `SIGTERM`; existing HTTP requests finish. Otel spans flushed via `shutdownTracing()` in `main.ts`.
- Circuit breaker keeps in-flight traffic from cascading upstream failures during the rollout.

## Observability

- **Metrics**: scrape `/metrics`. ServiceMonitor bundled.
- **Traces**: OTLP HTTP to collector; span attributes include `mavio.server.id / tool.name / transport.kind / principal.id`.
- **Logs**: structured JSON to stdout (default Nest logger); ship via the platform's log stack.

## Runbooks

- **RB-001 Redis outage** — router keeps working with degraded cache (Postgres fallback); log warnings; auto-recover on Redis reachable.
- **RB-002 Postgres outage** — server returns 503 on `/readyz`; the load balancer removes it. No writes are lost because none are accepted.
- **RB-003 Certificate rotation (mTLS)** — rolling restart with new secret mounted; existing WS/SSE sessions terminate cleanly on `SIGTERM`.

See `docs/architecture/runbooks/` for full runbook content (add as incidents happen).
