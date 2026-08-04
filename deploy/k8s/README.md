# Mavio-MCP — Kubernetes reference manifests

Raw `kubectl apply -f .` manifests for teams that don't run Helm. For
templated + configurable installs use `deploy/helm/mavio-mcp` instead.

Apply order:

```bash
kubectl create namespace mavio
kubectl -n mavio create secret generic mavio-secrets \
  --from-literal=MAVIO_DB_URL=postgres://... \
  --from-literal=MAVIO_REDIS_URL=redis://... \
  --from-literal=MAVIO_ADMIN_API_KEY=change-me
kubectl -n mavio apply -f configmap.yaml
kubectl -n mavio apply -f deployment.yaml
kubectl -n mavio apply -f service.yaml
# optional
kubectl -n mavio apply -f servicemonitor.yaml
```

Ships **without** an Ingress; expose via your cluster's own controller.
