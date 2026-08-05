# CLI reference — `mavio`

`mavio` wraps the admin HTTP API. Build once with `pnpm build`, then invoke `node apps/cli/dist/index.js …` or add an alias:

```bash
alias mavio="node $(pwd)/apps/cli/dist/index.js"
```

Every subcommand accepts:

```
--api <url>   Mavio admin API base URL (default: http://localhost:4000)
--key <key>   Admin API key (or env MAVIO_ADMIN_API_KEY)
```

## Commands

### `mavio init`

Scaffold a `mavio.config.yaml` in the current directory.

### `mavio serve`

Start the server directly from the CLI (equivalent to `pnpm --filter @mavio/server start`).

```
-c, --config <path>   Path to mavio.config.yaml   (default: ./mavio.config.yaml)
-p, --port <port>     HTTP port                   (default: 4000)
```

### `mavio servers`

```bash
mavio servers list
mavio servers get <id>
mavio servers rm  <id>
```

### `mavio import openapi`

```
--id <serverId>          Required
--url  <url>             OpenAPI document URL
--path <file>            OpenAPI document local path
--base-url <url>         Override baseUrl if spec has no servers[]
--workspace <ws>         (default: default)
--project <proj>         (default: sandbox)
```

Example:

```bash
mavio import openapi --id petstore \
  --url https://petstore3.swagger.io/api/v3/openapi.json
```

### `mavio import sql`

```
--id <serverId>
--dsn <postgres://…>
--tables <a,b,c>         Comma-separated allowlist (default: all)
--read-only              Read-only mode (default: true)
--workspace <ws>
--project <proj>
```

### `mavio import graphql`

```
--id <serverId>
--endpoint <url>
--auth <secret://ENV>    Bearer secret ref
--selection-depth <n>    Depth for leaf-select (default: 2, max: 4)
```

### `mavio import mcp`

Mirror an existing MCP server.

```
--id <serverId>
--stdio <cmd>            Space-separated argv
--http  <url>            HTTP transport base URL
--sse   <url>            SSE transport URL
--name  <name>           Display name
--auth  <secret://ENV>   Bearer for http/sse
```

Exactly one of `--stdio`, `--http`, `--sse`.

### `mavio plugin`

```bash
mavio plugin list
mavio plugin enable  <name>
mavio plugin disable <name>
```

### `mavio rbac`

Principals + keys + assignments.

```bash
mavio rbac principals:create \
  --type service --name ci-runner --workspace default

mavio rbac keys:issue --principal <id>

mavio rbac assign \
  --principal <id> --role invoker \
  --workspace default --server petstore
```

Flags:

```
--type <user|service>
--name <displayName>
--workspace <ws>
--project <proj>
--server <serverId>
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | HTTP error from admin API (message printed to stderr) |
| 2 | Argument validation error |

## Environment

- `MAVIO_ADMIN_API_KEY` — used when `--key` omitted.
- `MAVIO_API_URL` — used when `--api` omitted (planned, currently the flag default is hard-coded).
