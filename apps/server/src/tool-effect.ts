import type { ToolAnnotations, ToolDefinition } from "@mavio/core";

export type ToolEffect = "read" | "write" | "destructive";

const EFFECTS: ReadonlySet<string> = new Set(["read", "write", "destructive"]);
const READ_HTTP_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export function isToolEffect(v: unknown): v is ToolEffect {
  return typeof v === "string" && EFFECTS.has(v);
}

function fromAnnotations(a: ToolAnnotations | undefined): ToolEffect | undefined {
  if (!a) return undefined;
  if (a.readOnlyHint === true) return "read";
  if (a.destructiveHint === false) return "write";
  if (a.destructiveHint === true) return "destructive";
  return undefined;
}

function fromImporterMetadata(schema: Record<string, unknown>): ToolEffect | undefined {
  const http = schema["x-mavio-http"] as { method?: string } | undefined;
  if (http?.method) return READ_HTTP_METHODS.has(http.method.toUpperCase()) ? "read" : undefined;
  if (schema["x-mavio-sql"]) return "read";
  const gql = schema["x-mavio-graphql"] as { operation?: string } | undefined;
  if (gql?.operation === "query") return "read";
  return undefined;
}

/**
 * ADR-029: resolve a tool's side-effect label.
 * Precedence: admin override (server metadata.toolEffects) > upstream MCP
 * annotations > importer metadata (HTTP GET/HEAD, SQL, GraphQL query) >
 * "destructive".
 */
export function resolveToolEffect(
  tool: ToolDefinition,
  serverMetadata: Record<string, unknown> | undefined,
): ToolEffect {
  const overrides = serverMetadata?.toolEffects as Record<string, unknown> | undefined;
  const override = overrides?.[tool.name];
  if (isToolEffect(override)) return override;
  return (
    fromAnnotations(tool.annotations) ??
    fromImporterMetadata(tool.inputSchema ?? {}) ??
    "destructive"
  );
}

/** Upstream annotations with readOnlyHint/destructiveHint set to match `effect`. */
export function annotationsForEffect(
  effect: ToolEffect,
  base: ToolAnnotations | undefined,
): ToolAnnotations {
  return {
    ...base,
    readOnlyHint: effect === "read",
    destructiveHint: effect === "destructive",
  };
}
