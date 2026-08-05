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

/**
 * Upstream credential provider — knows how to obtain and refresh a
 * per-principal token for a specific SaaS or IdP (Slack, Notion, Keycloak, ...).
 * See ADR-018.
 */
export interface UpstreamCredential {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scopes?: string[];
  expiresAt?: Date;
  issuer?: string;
  subject?: string;
}

export interface DispatchInjection {
  /** Env vars to overlay onto stdio transports. */
  env?: Record<string, string>;
  /** Headers to overlay onto http/sse/ws/graphql transports. */
  headers?: Record<string, string>;
}

export interface UpstreamProviderAuthorizeContext {
  principalId: string;
  state: string;
  returnTo: string;
  /** Absolute base URL of the Mavio server, e.g. https://mcp.example.com. */
  callbackBaseUrl: string;
}

export interface UpstreamProviderExchangeContext {
  principalId: string;
  code: string;
  state: string;
  callbackBaseUrl: string;
}

export interface UpstreamCredentialProvider {
  readonly id: string;
  /**
   * Build the URL the user's browser must be sent to in order to grant
   * consent. `authorize()` returns null when the provider mints tokens
   * without a browser round-trip (e.g. RFC 8693 token-exchange from an
   * existing session — `mint()` is used instead).
   */
  authorize(ctx: UpstreamProviderAuthorizeContext): Promise<{ url: string } | null>;
  exchange?(ctx: UpstreamProviderExchangeContext): Promise<UpstreamCredential>;
  /**
   * Non-interactive mint path — used by token-exchange providers that can
   * produce a downstream token from an existing subject token attached to
   * the caller's Mavio session.
   */
  mint?(input: { principalId: string; subjectToken?: string }): Promise<UpstreamCredential>;
  refresh(token: UpstreamCredential): Promise<UpstreamCredential>;
  revoke?(token: UpstreamCredential): Promise<void>;
  /** How the resolved token attaches to an outbound dispatch. */
  inject(token: UpstreamCredential): DispatchInjection;
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
