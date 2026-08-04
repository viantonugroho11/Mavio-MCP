import { request } from "undici";
import type { ToolDefinition } from "@mavio/core";
import { MavioError } from "@mavio/core";

const INTROSPECTION = `
query MavioIntrospect {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name
      kind
      description
      enumValues(includeDeprecated: false) { name description }
      inputFields {
        name
        description
        type { ...TypeRef }
      }
      fields(includeDeprecated: false) {
        name
        description
        args { name description type { ...TypeRef } }
        type { ...TypeRef }
      }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
}`.trim();

interface GraphQLType {
  kind: string;
  name?: string | null;
  ofType?: GraphQLType | null;
}

interface GraphQLArg {
  name: string;
  description?: string | null;
  type: GraphQLType;
}

interface GraphQLField {
  name: string;
  description?: string | null;
  args: GraphQLArg[];
  type: GraphQLType;
}

interface GraphQLTypeDef {
  name: string;
  kind: string;
  description?: string | null;
  enumValues?: Array<{ name: string; description?: string | null }> | null;
  inputFields?: GraphQLArg[] | null;
  fields?: GraphQLField[] | null;
}

interface IntrospectionResult {
  data?: {
    __schema: {
      queryType?: { name: string } | null;
      mutationType?: { name: string } | null;
      types: GraphQLTypeDef[];
    };
  };
  errors?: Array<{ message: string }>;
}

export interface GraphqlBlueprint {
  serverName: string;
  serverVersion: string;
  endpoint: string;
  tools: ToolDefinition[];
}

export interface GraphqlImportOptions {
  endpoint: string;
  headers?: Record<string, string>;
  selectionDepth?: number;
}

export async function importGraphql(input: GraphqlImportOptions): Promise<GraphqlBlueprint> {
  const res = await request(input.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(input.headers ?? {}) },
    body: JSON.stringify({ query: INTROSPECTION, operationName: "MavioIntrospect" }),
  });
  if (res.statusCode >= 400) {
    throw new MavioError(`graphql introspection ${res.statusCode}`, "IMPORT_GRAPHQL_FETCH");
  }
  const body = (await res.body.json()) as IntrospectionResult;
  if (body.errors?.length) {
    throw new MavioError(
      `graphql errors: ${body.errors.map((e) => e.message).join(", ")}`,
      "IMPORT_GRAPHQL_ERROR",
    );
  }
  const schema = body.data?.__schema;
  if (!schema) throw new MavioError("no schema in introspection", "IMPORT_GRAPHQL_EMPTY");

  const typeIndex = new Map<string, GraphQLTypeDef>();
  for (const t of schema.types) if (t.name) typeIndex.set(t.name, t);

  const depth = Math.max(1, Math.min(input.selectionDepth ?? 2, 4));
  const queryTypeName = schema.queryType?.name;
  const mutationTypeName = schema.mutationType?.name;

  const tools: ToolDefinition[] = [];
  for (const t of schema.types) {
    if (!t.fields) continue;
    if (t.name === queryTypeName) {
      for (const f of t.fields) tools.push(fieldToTool(f, "query", typeIndex, depth));
    } else if (t.name === mutationTypeName) {
      for (const f of t.fields) tools.push(fieldToTool(f, "mutation", typeIndex, depth));
    }
  }

  return {
    serverName: `graphql:${new URL(input.endpoint).hostname}`,
    serverVersion: new Date().toISOString(),
    endpoint: input.endpoint,
    tools,
  };
}

function fieldToTool(
  field: GraphQLField,
  operation: "query" | "mutation",
  typeIndex: Map<string, GraphQLTypeDef>,
  depth: number,
): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const metaArgs: Array<{ name: string; gqlType: string }> = [];
  for (const arg of field.args) {
    properties[arg.name] = argSchema(arg, typeIndex);
    if (arg.type.kind === "NON_NULL") required.push(arg.name);
    metaArgs.push({ name: arg.name, gqlType: describeType(arg.type) });
  }
  const returnType = describeType(field.type);
  const selection = buildSelection(field.type, typeIndex, depth);
  return {
    name: `${operation}_${field.name}`,
    description: field.description ?? `${operation} ${field.name}`,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
      "x-mavio-graphql": {
        operation,
        field: field.name,
        args: metaArgs,
        returnType,
        selection,
      },
    },
  };
}

function argSchema(arg: GraphQLArg, typeIndex: Map<string, GraphQLTypeDef>): Record<string, unknown> {
  const schema = typeToJsonSchema(arg.type, typeIndex, new Set(), 3);
  if (arg.description) schema.description = arg.description;
  return schema;
}

function typeToJsonSchema(
  t: GraphQLType,
  typeIndex: Map<string, GraphQLTypeDef>,
  visited: Set<string>,
  depth: number,
): Record<string, unknown> {
  if (t.kind === "NON_NULL" && t.ofType) return typeToJsonSchema(t.ofType, typeIndex, visited, depth);
  if (t.kind === "LIST" && t.ofType) {
    return { type: "array", items: typeToJsonSchema(t.ofType, typeIndex, visited, depth) };
  }
  if (t.kind === "SCALAR") {
    switch (t.name) {
      case "Int":
        return { type: "integer" };
      case "Float":
        return { type: "number" };
      case "Boolean":
        return { type: "boolean" };
      case "ID":
      case "String":
        return { type: "string" };
      default:
        return { type: "string", "x-graphql-scalar": t.name };
    }
  }
  if (t.kind === "ENUM" && t.name) {
    const def = typeIndex.get(t.name);
    const values = def?.enumValues?.map((v) => v.name) ?? [];
    return values.length ? { type: "string", enum: values } : { type: "string" };
  }
  if (t.kind === "INPUT_OBJECT" && t.name) {
    if (visited.has(t.name) || depth <= 0) return { type: "object" };
    const def = typeIndex.get(t.name);
    if (!def?.inputFields?.length) return { type: "object" };
    const nextVisited = new Set(visited).add(t.name);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const f of def.inputFields) {
      properties[f.name] = typeToJsonSchema(f.type, typeIndex, nextVisited, depth - 1);
      if (f.type.kind === "NON_NULL") required.push(f.name);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  return { type: "object" };
}

function buildSelection(
  t: GraphQLType,
  typeIndex: Map<string, GraphQLTypeDef>,
  depth: number,
): string {
  const inner = unwrapAll(t);
  if (!inner.name) return "";
  if (inner.kind === "SCALAR" || inner.kind === "ENUM") return "";
  const def = typeIndex.get(inner.name);
  if (!def?.fields?.length) return "__typename";
  return selectionForObject(def, typeIndex, depth, new Set([inner.name]));
}

function selectionForObject(
  def: GraphQLTypeDef,
  typeIndex: Map<string, GraphQLTypeDef>,
  depth: number,
  visited: Set<string>,
): string {
  const parts: string[] = ["__typename"];
  for (const f of def.fields ?? []) {
    if (f.args.some((a) => a.type.kind === "NON_NULL")) continue;
    const inner = unwrapAll(f.type);
    if (inner.kind === "SCALAR" || inner.kind === "ENUM") {
      parts.push(f.name);
      continue;
    }
    if (depth <= 1 || !inner.name || visited.has(inner.name)) continue;
    const child = typeIndex.get(inner.name);
    if (!child?.fields?.length) continue;
    const nextVisited = new Set(visited).add(inner.name);
    const sub = selectionForObject(child, typeIndex, depth - 1, nextVisited);
    parts.push(`${f.name} { ${sub} }`);
  }
  return parts.join(" ");
}

function unwrapAll(t: GraphQLType): GraphQLType {
  let cur = t;
  while ((cur.kind === "NON_NULL" || cur.kind === "LIST") && cur.ofType) cur = cur.ofType;
  return cur;
}

function describeType(t: GraphQLType): string {
  if (t.kind === "NON_NULL" && t.ofType) return `${describeType(t.ofType)}!`;
  if (t.kind === "LIST" && t.ofType) return `[${describeType(t.ofType)}]`;
  return t.name ?? t.kind;
}

export interface GraphqlDispatchMeta {
  operation: "query" | "mutation";
  field: string;
  args: Array<{ name: string; gqlType: string }>;
  returnType: string;
  selection?: string;
}

export async function dispatchGraphql(
  endpoint: string,
  meta: GraphqlDispatchMeta,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const provided = meta.args.filter((a) => args[a.name] !== undefined);
  const varDefs = provided.map((a) => `$${a.name}: ${a.gqlType}`).join(", ");
  const varPass = provided.map((a) => `${a.name}: $${a.name}`).join(", ");
  const varDefsPart = varDefs ? `(${varDefs})` : "";
  const argsPart = varPass ? `(${varPass})` : "";
  const sel = meta.selection && meta.selection.length ? ` { ${meta.selection} }` : "";
  const query = `${meta.operation} MavioCall${varDefsPart} { result: ${meta.field}${argsPart}${sel} }`;
  const variables: Record<string, unknown> = {};
  for (const a of provided) variables[a.name] = args[a.name];
  const res = await request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return res.body.json();
}
