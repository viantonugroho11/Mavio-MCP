import type { Principal } from "@mavio/core";
import type {
  Action,
  Decision,
  Permission,
  PolicyEngine,
  ResourceRef,
  Role,
  RoleAssignment,
  RoleProvider,
} from "./index.js";

/**
 * Precedence: explicit deny > explicit allow > (default) deny.
 * Scope matching: assignment scope must be an ancestor of the resource;
 * permission's own scope filter is intersected with the assignment scope.
 */
export class BuiltinRbacEngine implements PolicyEngine {
  constructor(private readonly roles: RoleProvider) {}

  async can(
    principal: Principal,
    action: Action,
    resource: ResourceRef,
  ): Promise<Decision> {
    const assignments = await this.roles.assignmentsFor(principal.id);
    const effective = await this.expand(assignments);

    let allow: Permission | null = null;
    let deny: Permission | null = null;

    for (const { permission, assignmentScope } of effective) {
      if (!scopeContains(assignmentScope, resource)) continue;
      if (!actionMatches(permission.action, action)) continue;
      if (!scopeContains(permission.scope, resource)) continue;
      if (permission.effect === "deny") {
        deny = permission;
        break;
      }
      allow ??= permission;
    }

    if (deny) return { allowed: false, reason: "explicit deny", matched: deny };
    if (allow) return { allowed: true, reason: "allow", matched: allow };
    return { allowed: false, reason: "no matching permission" };
  }

  private async expand(
    assignments: RoleAssignment[],
  ): Promise<Array<{ permission: Permission; assignmentScope: ResourceRef }>> {
    const out: Array<{ permission: Permission; assignmentScope: ResourceRef }> = [];
    const seenRoles = new Set<string>();

    for (const assignment of assignments) {
      const role = await this.roles.getRole(assignment.roleName);
      if (!role) continue;
      await this.collectRolePermissions(role, assignment.scope, seenRoles, out);
    }
    return out;
  }

  private async collectRolePermissions(
    role: Role,
    assignmentScope: ResourceRef,
    seen: Set<string>,
    out: Array<{ permission: Permission; assignmentScope: ResourceRef }>,
  ): Promise<void> {
    if (seen.has(role.name)) return;
    seen.add(role.name);
    for (const p of role.permissions) out.push({ permission: p, assignmentScope });
    for (const parentName of role.inherits ?? []) {
      const parent = await this.roles.getRole(parentName);
      if (parent) await this.collectRolePermissions(parent, assignmentScope, seen, out);
    }
  }
}

function actionMatches(pattern: Action | "*", action: Action): boolean {
  if (pattern === "*") return true;
  if (pattern === action) return true;
  const [pFamily] = pattern.split(":");
  const [aFamily] = action.split(":");
  return pattern.endsWith(":*") && pFamily === aFamily;
}

/**
 * Container scope contains target when every dimension of container is either
 * unset (wildcard) or equal to target's same dimension.
 */
function scopeContains(container: ResourceRef, target: ResourceRef): boolean {
  if (container.workspace && container.workspace !== target.workspace) return false;
  if (container.project && container.project !== target.project) return false;
  if (container.server && container.server !== target.server) return false;
  if (container.tool && container.tool !== target.tool) return false;
  return true;
}
