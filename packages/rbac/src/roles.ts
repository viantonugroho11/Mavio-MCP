import { Actions, type Role } from "./index.js";

export const BUILTIN_ROLES: Role[] = [
  {
    name: "owner",
    permissions: [{ action: "*", scope: {}, effect: "allow" }],
  },
  {
    name: "admin",
    permissions: [
      { action: Actions.WorkspaceAdmin, scope: {}, effect: "allow" },
      { action: Actions.ProjectRead, scope: {}, effect: "allow" },
      { action: Actions.ProjectWrite, scope: {}, effect: "allow" },
      { action: Actions.ServerRead, scope: {}, effect: "allow" },
      { action: Actions.ServerWrite, scope: {}, effect: "allow" },
      { action: Actions.ServerInvoke, scope: {}, effect: "allow" },
      { action: Actions.ServerAdmin, scope: {}, effect: "allow" },
      { action: Actions.ToolInvoke, scope: {}, effect: "allow" },
      { action: Actions.ConfigWrite, scope: {}, effect: "allow" },
      { action: Actions.AuditRead, scope: {}, effect: "allow" },
    ],
  },
  {
    name: "developer",
    permissions: [
      { action: Actions.ProjectRead, scope: {}, effect: "allow" },
      { action: Actions.ServerRead, scope: {}, effect: "allow" },
      { action: Actions.ServerWrite, scope: {}, effect: "allow" },
      { action: Actions.ServerInvoke, scope: {}, effect: "allow" },
      { action: Actions.ToolInvoke, scope: {}, effect: "allow" },
    ],
  },
  {
    name: "operator",
    permissions: [
      { action: Actions.ProjectRead, scope: {}, effect: "allow" },
      { action: Actions.ServerRead, scope: {}, effect: "allow" },
      { action: Actions.ServerAdmin, scope: {}, effect: "allow" },
    ],
  },
  {
    name: "viewer",
    permissions: [
      { action: Actions.ProjectRead, scope: {}, effect: "allow" },
      { action: Actions.ServerRead, scope: {}, effect: "allow" },
    ],
  },
  {
    name: "tool.invoker",
    permissions: [{ action: Actions.ToolInvoke, scope: {}, effect: "allow" }],
  },
];

export function getBuiltinRole(name: string): Role | null {
  return BUILTIN_ROLES.find((r) => r.name === name) ?? null;
}
