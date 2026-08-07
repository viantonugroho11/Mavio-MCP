import type { Principal } from "@mavio/core";

export { Actions } from "./actions.js";
export type { Action } from "./actions.js";
import type { Action } from "./actions.js";

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
