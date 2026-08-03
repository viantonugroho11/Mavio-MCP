import pg from "pg";
import type { ToolDefinition } from "@mavio/core";
import { MavioError } from "@mavio/core";

const { Pool } = pg;

export interface SqlBlueprint {
  serverName: string;
  serverVersion: string;
  dialect: "postgres";
  dsn: string;
  allowedTables: string[];
  tools: ToolDefinition[];
}

interface Column {
  name: string;
  dataType: string;
  isPk: boolean;
}

const PG_TO_JSON: Record<string, string> = {
  integer: "integer",
  smallint: "integer",
  bigint: "integer",
  numeric: "number",
  real: "number",
  "double precision": "number",
  boolean: "boolean",
  text: "string",
  "character varying": "string",
  varchar: "string",
  uuid: "string",
  timestamp: "string",
  "timestamp with time zone": "string",
  "timestamp without time zone": "string",
  date: "string",
  jsonb: "object",
  json: "object",
};

const SAFE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function safeIdent(name: string): string {
  if (!SAFE_IDENT.test(name)) {
    throw new MavioError(`unsafe identifier: ${name}`, "IMPORT_SQL_UNSAFE_IDENT");
  }
  return `"${name}"`;
}

export async function importPostgres(input: {
  dsn: string;
  allowedTables?: string[];
  schema?: string;
}): Promise<SqlBlueprint> {
  const schema = input.schema ?? "public";
  const pool = new Pool({ connectionString: input.dsn, max: 2 });
  try {
    const { rows: tableRows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    );
    const allTables = tableRows.map((r) => r.table_name);
    const allowed = input.allowedTables ?? allTables;
    const filtered = allTables.filter((t) => allowed.includes(t));

    const tools: ToolDefinition[] = [];

    for (const table of filtered) {
      const { rows: colRows } = await pool.query<{
        column_name: string;
        data_type: string;
        is_pk: boolean;
      }>(
        `SELECT c.column_name,
                c.data_type,
                EXISTS (
                  SELECT 1 FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu
                    ON kcu.constraint_name = tc.constraint_name
                   AND kcu.table_schema = tc.table_schema
                  WHERE tc.constraint_type = 'PRIMARY KEY'
                    AND tc.table_schema = $1
                    AND tc.table_name = $2
                    AND kcu.column_name = c.column_name
                ) AS is_pk
         FROM information_schema.columns c
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table],
      );
      const columns: Column[] = colRows.map((r) => ({
        name: r.column_name,
        dataType: r.data_type,
        isPk: r.is_pk,
      }));
      if (columns.length === 0) continue;
      tools.push(buildSelectTool(schema, table, columns));
      tools.push(buildCountTool(schema, table));
    }

    return {
      serverName: `sql:${schema}`,
      serverVersion: new Date().toISOString(),
      dialect: "postgres",
      dsn: input.dsn,
      allowedTables: filtered,
      tools,
    };
  } finally {
    await pool.end();
  }
}

function buildSelectTool(schema: string, table: string, columns: Column[]): ToolDefinition {
  const properties: Record<string, unknown> = {
    limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "row limit (max 500)" },
    offset: { type: "integer", minimum: 0, default: 0 },
  };
  const filterableColumns: string[] = [];
  for (const c of columns) {
    if (c.isPk) {
      const jsonType = PG_TO_JSON[c.dataType] ?? "string";
      properties[`filter_${c.name}`] = { type: jsonType, description: `filter by ${c.name} (equality)` };
      filterableColumns.push(c.name);
    }
  }
  return {
    name: `select_${table}`,
    description: `Read rows from ${schema}.${table}`,
    inputSchema: {
      type: "object",
      properties,
      required: [],
      additionalProperties: false,
      "x-mavio-sql": {
        kind: "select",
        schema,
        table,
        columns: columns.map((c) => c.name),
        filterable: filterableColumns,
      },
    },
  };
}

function buildCountTool(schema: string, table: string): ToolDefinition {
  return {
    name: `count_${table}`,
    description: `Count rows in ${schema}.${table}`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      "x-mavio-sql": { kind: "count", schema, table },
    },
  };
}

export interface SqlDispatchMeta {
  kind: "select" | "count";
  schema: string;
  table: string;
  columns?: string[];
  filterable?: string[];
}

export async function dispatchSql(
  pool: pg.Pool,
  meta: SqlDispatchMeta,
  args: Record<string, unknown>,
  opts: { readOnly?: boolean; allowedTables?: string[] } = {},
): Promise<unknown> {
  if (opts.allowedTables && !opts.allowedTables.includes(meta.table)) {
    throw new MavioError(`table ${meta.table} not in allowlist`, "SQL_TABLE_DENIED");
  }
  const table = `${safeIdent(meta.schema)}.${safeIdent(meta.table)}`;

  const client = await pool.connect();
  try {
    if (opts.readOnly ?? true) {
      await client.query("BEGIN READ ONLY");
    } else {
      await client.query("BEGIN");
    }
    if (meta.kind === "count") {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM ${table}`);
      await client.query("COMMIT");
      return { count: rows[0]?.c ?? 0 };
    }
    const columnList = (meta.columns ?? []).map(safeIdent).join(", ") || "*";
    const filters: string[] = [];
    const params: unknown[] = [];
    for (const col of meta.filterable ?? []) {
      const val = args[`filter_${col}`];
      if (val !== undefined) {
        params.push(val);
        filters.push(`${safeIdent(col)} = $${params.length}`);
      }
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const limit = Math.min(500, Math.max(1, Number(args.limit ?? 50)));
    const offset = Math.max(0, Number(args.offset ?? 0));
    const { rows } = await client.query(
      `SELECT ${columnList} FROM ${table} ${where} LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    await client.query("COMMIT");
    return { rows, count: rows.length, limit, offset };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
