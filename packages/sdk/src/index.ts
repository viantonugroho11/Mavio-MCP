import type {
  MCPFrame,
  Principal,
  ServerCapabilities,
  ServerDescriptor,
  ToolDefinition,
  TransportDescriptor,
} from "@mavio/core";

export const MAVIO_API_VERSION = "1.0.0";

export type PluginPermission =
  | "read:config"
  | "write:config"
  | "read:registry"
  | "write:registry"
  | "network"
  | "read:secrets";

export interface PluginContributes {
  importers?: string[];
  transports?: string[];
  middleware?: string[];
  auth?: string[];
  ui?: string[];
  permissions?: PluginPermission[];
}

export interface PluginManifest {
  name: string;
  version: string;
  mavioApi: string;
  description?: string;
  contributes?: PluginContributes;
  activate: (ctx: PluginContext) => void | Promise<void>;
  deactivate?: (ctx: PluginContext) => void | Promise<void>;
}

export interface ImporterBlueprint {
  serverName: string;
  serverVersion: string;
  sourceType: string;
  transport: TransportDescriptor;
  capabilities: ServerCapabilities;
}

export interface Importer<TInput = unknown> {
  readonly name: string;
  run(input: TInput): Promise<ImporterBlueprint>;
}

export interface TransportAdapter {
  readonly kind: TransportDescriptor["type"];
  open(descriptor: TransportDescriptor): Promise<TransportSession>;
}

export interface TransportSession {
  send(frame: MCPFrame): Promise<MCPFrame | AsyncIterable<MCPFrame>>;
  close(): Promise<void>;
}

export interface MiddlewareContext {
  principal: Principal;
  server: ServerDescriptor;
  tool?: ToolDefinition;
  frame: MCPFrame;
}

export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<MCPFrame>,
) => Promise<MCPFrame>;

export interface AuthProvider {
  readonly name: string;
  resolve(headers: Record<string, string | string[] | undefined>): Promise<Principal | null>;
}

export interface ImporterRegistry {
  register(importer: Importer): void;
  list(): Importer[];
}

export interface TransportRegistry {
  register(adapter: TransportAdapter): void;
  list(): TransportAdapter[];
}

export interface MiddlewareRegistry {
  register(mw: Middleware): void;
  list(): Middleware[];
}

export interface AuthRegistry {
  register(provider: AuthProvider): void;
  list(): AuthProvider[];
}

export interface PluginLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly mavioApi: string;
  readonly log: PluginLogger;
  readonly importers: ImporterRegistry;
  readonly transports: TransportRegistry;
  readonly middleware: MiddlewareRegistry;
  readonly auth: AuthRegistry;
  readonly config: Readonly<Record<string, unknown>>;
}

export type {
  MCPFrame,
  Principal,
  ServerCapabilities,
  ServerDescriptor,
  ToolDefinition,
  TransportDescriptor,
};
