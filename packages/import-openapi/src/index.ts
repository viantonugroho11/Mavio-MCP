import { readFile } from "node:fs/promises";
import { request } from "undici";
import { parse as parseYaml } from "yaml";
import type { ToolDefinition } from "@mavio/core";
import { MavioError } from "@mavio/core";

export interface OpenApiBlueprint {
  serverName: string;
  serverVersion: string;
  baseUrl: string;
  tools: ToolDefinition[];
}

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  servers?: Array<{ url: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: unknown }> };
}

interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: Record<string, unknown>;
  description?: string;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export async function loadOpenApi(source: { url?: string; path?: string }): Promise<OpenApiDoc> {
  let raw: string;
  if (source.url) {
    const res = await request(source.url);
    if (res.statusCode >= 400) {
      throw new MavioError(`fetch openapi ${res.statusCode}`, "IMPORT_FETCH_FAILED");
    }
    raw = await res.body.text();
  } else if (source.path) {
    raw = await readFile(source.path, "utf8");
  } else {
    throw new MavioError("openapi source requires url or path", "IMPORT_INVALID_SOURCE");
  }
  const trimmed = raw.trimStart();
  return trimmed.startsWith("{") ? (JSON.parse(raw) as OpenApiDoc) : (parseYaml(raw) as OpenApiDoc);
}

export function buildBlueprint(doc: OpenApiDoc, fallbackBaseUrl?: string): OpenApiBlueprint {
  const baseUrl = doc.servers?.[0]?.url ?? fallbackBaseUrl;
  if (!baseUrl) {
    throw new MavioError("openapi has no servers[] and no fallback baseUrl", "IMPORT_NO_BASE_URL");
  }
  const tools: ToolDefinition[] = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      tools.push(operationToTool(path, method.toUpperCase(), op));
    }
  }
  return {
    serverName: doc.info?.title ?? "openapi-server",
    serverVersion: doc.info?.version ?? "0.0.0",
    baseUrl,
    tools,
  };
}

function operationToTool(path: string, method: string, op: OpenApiOperation): ToolDefinition {
  const name = op.operationId ?? `${method.toLowerCase()}${sanitizePath(path)}`;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of op.parameters ?? []) {
    properties[p.name] = { ...(p.schema ?? { type: "string" }), description: p.description };
    if (p.required) required.push(p.name);
  }
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema) {
    properties["body"] = bodySchema;
    required.push("body");
  }
  return {
    name,
    description: op.summary ?? op.description ?? `${method} ${path}`,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
      "x-mavio-http": { method, path },
    },
  };
}

function sanitizePath(path: string): string {
  return path
    .split(/[/{}]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}
