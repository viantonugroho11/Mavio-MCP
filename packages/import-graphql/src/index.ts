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
      fields {
        name
        description
        args { name type { kind name ofType { kind name ofType { kind name } } } }
        type { kind name ofType { kind name } }
      }
    }
  }
}`.trim();

interface GraphQLType {
  kind: string;
  name?: string | null;
  ofType?: GraphQLType | null;
}

interface GraphQLArg {
  name: string;
  type: GraphQLType;
}

interface GraphQLField {
  name: string;
  description?: string | null;
  args: GraphQLArg[];
  type: GraphQLType;
}

interface IntrospectionResult {
  data?: {
    __schema: {
      queryType?: { name: string } | null;
      mutationType?: { name: string } | null;
      types: Array<{ name: string; kind: string; fields?: GraphQLField[] | null }>;
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

export async function importGraphql(input: {
  endpoint: string;
  headers?: Record<string, string>;
}): Promise<GraphqlBlueprint> {
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
    throw new MavioError(`graphql errors: ${body.errors.map((e) => e.message).join(", ")}`, "IMPORT_GRAPHQL_ERROR");
  }
  const schema = body.data?.__schema;
  if (!schema) throw new MavioError("no schema in introspection", "IMPORT_GRAPHQL_EMPTY");

  const queryTypeName = schema.queryType?.name;
  const mutationTypeName = schema.mutationType?.name;

  const tools: ToolDefinition[] = [];
  for (const t of schema.types) {
    if (!t.fields) continue;
    if (t.name === queryTypeName) {
      for (const f of t.fields) tools.push(fieldToTool(f, "query"));
    } else if (t.name === mutationTypeName) {
      for (const f of t.fields) tools.push(fieldToTool(f, "mutation"));
    }
  }

  return {
    serverName: `graphql:${new URL(input.endpoint).hostname}`,
    serverVersion: new Date().toISOString(),
    endpoint: input.endpoint,
    tools,
  };
}

function fieldToTool(field: GraphQLField, operation: "query" | "mutation"): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const arg of field.args) {
    const isRequired = arg.type.kind === "NON_NULL";
    properties[arg.name] = {
      type: mapType(arg.type),
      description: `${describeType(arg.type)}`,
    };
    if (isRequired) required.push(arg.name);
  }
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
        argNames: field.args.map((a) => a.name),
        returnType: describeType(field.type),
      },
    },
  };
}

function mapType(t: GraphQLType): string {
  const inner = unwrap(t);
  if (inner.kind === "SCALAR") {
    switch (inner.name) {
      case "Int":
      case "Float":
        return "number";
      case "Boolean":
        return "boolean";
      case "ID":
      case "String":
      default:
        return "string";
    }
  }
  if (inner.kind === "LIST") return "array";
  return "object";
}

function unwrap(t: GraphQLType): GraphQLType {
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
  argNames: string[];
  returnType: string;
}

export async function dispatchGraphql(
  endpoint: string,
  meta: GraphqlDispatchMeta,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const varDefs = meta.argNames.map((n) => `$${n}: ${jsonToGqlLiteralType(args[n])}`).join(", ");
  const varPass = meta.argNames.map((n) => `${n}: $${n}`).join(", ");
  const varDefsPart = varDefs ? `(${varDefs})` : "";
  const argsPart = varPass ? `(${varPass})` : "";
  const returnScalar = meta.returnType.replace(/[!\[\]]/g, "");
  const isScalar = ["String", "Int", "Float", "Boolean", "ID"].includes(returnScalar);
  const query = `${meta.operation} MavioCall${varDefsPart} { result: ${meta.field}${argsPart}${isScalar ? "" : " { __typename }"} }`;
  const variables: Record<string, unknown> = {};
  for (const n of meta.argNames) if (args[n] !== undefined) variables[n] = args[n];
  const res = await request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.body.json();
  return body;
}

function jsonToGqlLiteralType(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? "Int" : "Float";
  if (typeof v === "boolean") return "Boolean";
  return "String";
}
