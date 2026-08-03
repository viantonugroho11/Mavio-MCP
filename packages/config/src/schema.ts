import { z } from "zod";

const StdioTransport = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

const HttpTransport = z.object({
  type: z.literal("http"),
  baseUrl: z.string().url(),
  headers: z.record(z.string()).optional(),
  auth: z
    .union([
      z.object({ type: z.literal("bearer"), secretRef: z.string() }),
      z.object({ type: z.literal("none") }),
    ])
    .optional(),
});

const Transport = z.discriminatedUnion("type", [StdioTransport, HttpTransport]);

const OpenApiSource = z.object({
  type: z.literal("openapi"),
  url: z.string().url().optional(),
  path: z.string().optional(),
});

const McpSource = z.object({
  type: z.literal("mcp"),
});

const Source = z.discriminatedUnion("type", [OpenApiSource, McpSource]);

const ServerConfig = z.object({
  id: z.string().min(1),
  workspace: z.string().min(1),
  project: z.string().min(1),
  name: z.string().optional(),
  source: Source.optional(),
  transport: Transport,
  tags: z.array(z.string()).optional(),
});

const ApiKeyProvider = z.object({
  type: z.literal("apiKey"),
  id: z.string(),
});

const AuthProvider = z.discriminatedUnion("type", [ApiKeyProvider]);

export const MavioConfigSchema = z.object({
  version: z.literal(1),
  mavio: z.object({
    publicUrl: z.string().url().optional(),
    dataDir: z.string().default("./.mavio"),
  }),
  database: z.object({ url: z.string() }),
  cache: z.object({ url: z.string() }),
  auth: z.object({
    providers: z.array(AuthProvider).default([{ type: "apiKey", id: "default" }]),
  }),
  workspaces: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        projects: z
          .array(z.object({ id: z.string().min(1), name: z.string() }))
          .default([]),
      }),
    )
    .default([]),
  servers: z.array(ServerConfig).default([]),
  router: z
    .object({
      endpoint: z.string().default("/mcp"),
      rateLimit: z
        .object({ rpm: z.number(), burst: z.number() })
        .optional(),
    })
    .default({ endpoint: "/mcp" }),
});

export type MavioConfig = z.infer<typeof MavioConfigSchema>;
export type ServerConfigEntry = z.infer<typeof ServerConfig>;
