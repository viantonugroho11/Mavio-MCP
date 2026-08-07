export const Actions = {
  WorkspaceAdmin: "workspace:admin",
  ProjectRead: "project:read",
  ProjectWrite: "project:write",
  ServerRead: "server:read",
  ServerWrite: "server:write",
  ServerInvoke: "server:invoke",
  ServerAdmin: "server:admin",
  ToolInvoke: "tool:invoke",
  PluginInstall: "plugin:install",
  ConfigWrite: "config:write",
  AuditRead: "audit:read",
} as const;

export type Action = (typeof Actions)[keyof typeof Actions];
