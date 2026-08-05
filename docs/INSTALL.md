# Install

Four supported paths, ordered by effort.

## 1. Local dev (fastest)

Requirements: **Node 20.11+**, **pnpm 9**, **Docker**.

```bash
git clone https://github.com/viantonugroho11/Mavio-MCP.git
cd Mavio-MCP
pnpm install
pnpm build

docker compose up -d                                # Postgres + Redis
cp .env.example .env
export $(grep -v "^#" .env | xargs)

pnpm --filter @mavio/registry migrate               # apply schema
cp mavio.config.example.yaml mavio.config.yaml

pnpm --filter @mavio/server start                   # http://localhost:4000
```

Optional web console:

```bash
pnpm --filter @mavio/web dev                        # http://localhost:3000
```

**Smoke test:**

```bash
curl -s -X POST http://localhost:4000/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | jq
```

Expected: `{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05", ...}}`.

## 2. Docker image (single container)

Build the runtime image:

```bash
docker build -f deploy/docker/Dockerfile -t mavio-mcp:1.0.0 .
```

Run it, pointing at your Postgres + Redis:

```bash
docker run --rm -p 4000:4000 \
  -e MAVIO_HTTP_PORT=4000 \
  -e MAVIO_CONFIG_PATH=/app/mavio.config.yaml \
  -e MAVIO_ADMIN_API_KEY=change-me \
  -v $(pwd)/mavio.config.yaml:/app/mavio.config.yaml:ro \
  mavio-mcp:1.0.0
```

## 3. Docker Compose (full stack)

`docker-compose.yaml` in-repo already provisions Postgres + Redis for dev. Add the server:

```yaml
services:
  server:
    build:
      context: .
      dockerfile: deploy/docker/Dockerfile
    depends_on: [postgres, redis]
    ports: ["4000:4000"]
    environment:
      MAVIO_CONFIG_PATH: /app/mavio.config.yaml
      MAVIO_ADMIN_API_KEY: ${MAVIO_ADMIN_API_KEY}
      POSTGRES_URL: postgres://mavio:mavio@postgres:5432/mavio
      REDIS_URL: redis://redis:6379
    volumes:
      - ./mavio.config.yaml:/app/mavio.config.yaml:ro
```

Then:

```bash
docker compose up -d --build
```

## 4. Kubernetes — Helm chart

Chart at `deploy/helm/mavio-mcp/`.

```bash
helm dependency update deploy/helm/mavio-mcp
helm upgrade --install mavio deploy/helm/mavio-mcp \
  --namespace mavio --create-namespace \
  --set image.tag=1.0.0 \
  --set env.MAVIO_ADMIN_API_KEY=<yours> \
  --set postgres.url=postgres://... \
  --set redis.url=redis://... \
  --set serviceMonitor.enabled=true      # if you run Prometheus Operator
```

Chart includes: Deployment · Service · Ingress · ConfigMap · Secret · ServiceAccount · ServiceMonitor.

Pod security defaults: `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `capabilities.drop: [ALL]`.

## 5. Raw K8s manifests

If you don't want Helm: `deploy/k8s/*.yaml` is the Helm-less reference. Apply in order:

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.yaml
kubectl apply -f deploy/k8s/deployment.yaml
kubectl apply -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/ingress.yaml           # optional
```

## Prerequisites cheat-sheet

| Runtime | Version | Why |
|---|---|---|
| Node.js | ≥ 20.11 | ES2022 + native `crypto.verify("ed25519", …)` |
| pnpm | 9.x | Workspace protocol |
| PostgreSQL | ≥ 14 | JSONB + `updated_at now()` triggers |
| Redis | ≥ 7 | Streams for InvalidationBus |
| Docker | ≥ 24 | Compose v2 |
| Kubernetes | ≥ 1.27 | ServiceMonitor CRD if using ServiceMonitor |

## Post-install

- **Set the admin API key.** `MAVIO_ADMIN_API_KEY` protects `/api/*`. If unset, the server runs in **dev-open mode** — do NOT expose to the internet.
- **Configure OIDC** (optional): `PUT /api/auth/providers/:id` with issuer + client id/secret. Then hit `GET /auth/:providerId/login`.
- **Enable metrics.** Prometheus scrape defaults are enabled by chart annotations; ServiceMonitor is opt-in.

Continue with **[USAGE.md](USAGE.md)** for the first import.
