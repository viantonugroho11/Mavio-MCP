import type { Principal } from "@mavio/core";

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

export interface ResourceRef {
  workspace?: string;
  project?: string;
  server?: string;
  tool?: string;
}

export type Effect = "allow" | "deny";

export interface Permission {
  action: Action | "*";
  scope: ResourceRef;
  effect: Effect;
}

export interface Role {
  name: string;
  inherits?: string[];
  permissions: Permission[];
}

export interface RoleAssignment {
  principalId: string;
  roleName: string;
  scope: ResourceRef;
}

export interface Decision {
  allowed: boolean;
  reason: string;
  matched?: Permission;
}

export interface PolicyEngine {
  can(principal: Principal, action: Action, resource: ResourceRef): Promise<Decision>;
}

export interface RoleProvider {
  listRoles(): Promise<Role[]>;
  getRole(name: string): Promise<Role | null>;
  assignmentsFor(principalId: string): Promise<RoleAssignment[]>;
}

export { BUILTIN_ROLES, getBuiltinRole } from "./roles.js";
export { BuiltinRbacEngine } from "./engine.js";
