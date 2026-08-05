# Contributing to Mavio-MCP

Welcome. Two rules:

1. **Architectural change → ADR first.** Template at `docs/architecture/adr/ADR-000-template.md`.
2. **Behavioral change → test first.** New public surface without a test won't merge.

## Dev setup

```bash
git clone https://github.com/viantonugroho11/Mavio-MCP.git
cd Mavio-MCP
pnpm install
pnpm build
docker compose up -d
cp .env.example .env && export $(grep -v "^#" .env | xargs)
pnpm --filter @mavio/registry migrate
```

Run tests:

```bash
pnpm test                                    # turbo across every pkg
pnpm --filter @mavio/server test             # single pkg
```

Type-check without emitting:

```bash
pnpm typecheck
```

## Repo layout

```
apps/
  cli/                 mavio CLI (commander)
  server/              NestJS server (router + admin API)
  web/                 Next.js console
packages/
  core/                Types + errors (framework-free)
  config/              YAML loader
  registry/            Postgres domain repos (servers/RBAC/audit/playground/oidc/plugins)
  registry-external/   etcd + Consul discovery sources
  rbac/                4-scope engine + roles
  rbac-opa/            OPA + Cedar sidecar policy engines
  transport/           Upstream transports (stdio/http/sse/ws)
  cache/               Redis wrappers (CapabilityCache, InvalidationBus, RateLimiter, CircuitBreaker)
  observability/       Prom metrics + OTel bootstrap
  plugin/              PluginManager
  sdk/                 Public plugin interface
  marketplace/         Signed plugin marketplace client
  import-openapi/      OpenAPI importer
  import-sql/          SQL importer
  import-graphql/      GraphQL importer
  import-mcp/          MCP-mirror importer
deploy/
  docker/              Multi-stage Dockerfile
  helm/mavio-mcp/      Helm chart
  k8s/                 Raw K8s manifests
docs/
  architecture/        Architecture doc + ADRs
```

Clean architecture: domain in `packages/core`, adapters at the edge. Don't leak `express`, `nestjs`, or `undici` types into `core`.

## Commit style — Conventional Commits

```
feat(scope):   new user-visible capability
fix(scope):    bug fix
docs(scope):   docs only
chore(scope):  build / deps / tooling
refactor(scope):   no behavior change
test(scope):   tests only
```

Scopes: package name without the `@mavio/` prefix (`core`, `server`, `rbac-opa`, `marketplace`, …). Multiple scopes: `feat(cache,server): …`.

Body should answer *why*, not *what* — the diff shows what. Include:

- What broke (or was missing) before this change.
- Failure mode if not fixed.
- Any deferred follow-ups.

Trailer:

```
Co-Authored-By: Someone Else <email@example.com>
```

Sign-off (DCO): all commits require `Signed-off-by: Your Name <email>`. Configure once:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git config format.signoff true
```

## Pull requests

- One logical change per PR. If your PR has "and also" in the description, split it.
- Tests must pass locally: `pnpm test && pnpm build && pnpm typecheck`.
- Reference the ADR (if architectural) or issue number in the body.
- Draft PRs welcome for design discussion; mark ready when green.

## Adding a new importer

1. `packages/import-<kind>/` — new workspace.
2. Export a factory returning `Promise<ServerDescriptor & { capabilities }>`.
3. Add `POST /api/imports/<kind>` in `apps/server/src/imports.controller.ts` with the `server:write` guard.
4. Add `mavio import <kind>` in `apps/cli/src/commands/import.ts`.
5. Unit tests: golden-file over sample specs; integration test round-trips through `RouterService`.

## Adding a new transport

1. `packages/transport/src/<kind>.ts` — implement `Transport` + `Session`.
2. Register in `TransportManager` constructor.
3. Extend `TransportDescriptor` union in `packages/core/src/index.ts`.
4. Add tests using undici `MockAgent` (HTTP) or child_process mocks (stdio).

## Adding a new RBAC engine

1. `packages/rbac-<engine>/` — implement `PolicyEngine` from `@mavio/rbac`.
2. Fail closed on error/timeout — use `RemoteHttpPolicyEngine` as a base if HTTP.
3. Wire into `apps/server/src/rbac.module.ts` factory behind `MAVIO_RBAC_ENGINE=<engine>`.

## Release

1. `pnpm build && pnpm test` clean.
2. Update `CHANGELOG.md` under `[Unreleased]`.
3. Bump `package.json` version.
4. Commit `release: vX.Y.Z — <theme>`.
5. `git tag -a vX.Y.Z -m "..."`.
6. `git push origin main && git push origin vX.Y.Z`.
7. CI publishes the image + drafts a GitHub release from the tag.

## Reporting security issues

Do **not** open a public issue for security reports. Follow [SECURITY.md](SECURITY.md).

## License

By contributing you agree your code is licensed under Apache 2.0 (see [LICENSE](LICENSE)).
