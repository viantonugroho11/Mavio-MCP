import { createHash, randomBytes } from "node:crypto";
import type { Kysely } from "kysely";
import type { Permission, Role, RoleAssignment, RoleProvider } from "@mavio/rbac";
import { BUILTIN_ROLES } from "@mavio/rbac";
import { NotFoundError } from "@mavio/core";
import type { Database } from "./schema.js";

export interface Principal {
  id: string;
  type: "user" | "service";
  displayName: string;
  workspaceId: string;
}

export interface IssuedApiKey {
  principal: Principal;
  apiKey: string; // returned once, plaintext
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export class RbacRepository implements RoleProvider {
  constructor(private readonly db: Kysely<Database>) {}

  async syncBuiltinRoles(): Promise<void> {
    for (const role of BUILTIN_ROLES) {
      await this.db
        .insertInto("roles")
        .values({
          name: role.name,
          inherits: role.inherits ?? [],
          permissions: JSON.stringify(role.permissions),
          builtin: true,
        })
        .onConflict((oc) =>
          oc.column("name").doUpdateSet({
            inherits: role.inherits ?? [],
            permissions: JSON.stringify(role.permissions),
            builtin: true,
          }),
        )
        .execute();
    }
  }

  async listRoles(): Promise<Role[]> {
    const rows = await this.db.selectFrom("roles").selectAll().execute();
    return rows.map((r) => ({
      name: r.name,
      inherits: r.inherits,
      permissions: r.permissions as Permission[],
    }));
  }

  async getRole(name: string): Promise<Role | null> {
    const row = await this.db.selectFrom("roles").selectAll().where("name", "=", name).executeTakeFirst();
    if (!row) return null;
    return {
      name: row.name,
      inherits: row.inherits,
      permissions: row.permissions as Permission[],
    };
  }

  async createPrincipal(input: {
    id: string;
    type: "user" | "service";
    displayName: string;
    workspaceId: string;
  }): Promise<Principal> {
    const row = await this.db
      .insertInto("principals")
      .values({
        id: input.id,
        type: input.type,
        display_name: input.displayName,
        workspace_id: input.workspaceId,
        api_key_hash: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toPrincipal(row);
  }

  async listPrincipals(): Promise<Principal[]> {
    const rows = await this.db.selectFrom("principals").selectAll().execute();
    return rows.map((r) => this.toPrincipal(r));
  }

  async findByApiKey(key: string): Promise<Principal | null> {
    const hash = hashApiKey(key);
    const row = await this.db
      .selectFrom("principals")
      .selectAll()
      .where("api_key_hash", "=", hash)
      .executeTakeFirst();
    return row ? this.toPrincipal(row) : null;
  }

  async issueApiKey(principalId: string): Promise<IssuedApiKey> {
    const key = `mk_${randomBytes(24).toString("base64url")}`;
    const hash = hashApiKey(key);
    const row = await this.db
      .updateTable("principals")
      .set({ api_key_hash: hash })
      .where("id", "=", principalId)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`principal ${principalId}`);
    return { principal: this.toPrincipal(row), apiKey: key };
  }

  async assign(assignment: RoleAssignment): Promise<void> {
    await this.db
      .insertInto("role_assignments")
      .values({
        principal_id: assignment.principalId,
        role_name: assignment.roleName,
        workspace_id: assignment.scope.workspace ?? null,
        project_id: assignment.scope.project ?? null,
        server_id: assignment.scope.server ?? null,
        tool_name: assignment.scope.tool ?? null,
      })
      .execute();
  }

  async unassign(id: string): Promise<void> {
    await this.db.deleteFrom("role_assignments").where("id", "=", id).execute();
  }

  async assignmentsFor(principalId: string): Promise<RoleAssignment[]> {
    const rows = await this.db
      .selectFrom("role_assignments")
      .selectAll()
      .where("principal_id", "=", principalId)
      .execute();
    return rows.map((r) => ({
      principalId: r.principal_id,
      roleName: r.role_name,
      scope: {
        workspace: r.workspace_id ?? undefined,
        project: r.project_id ?? undefined,
        server: r.server_id ?? undefined,
        tool: r.tool_name ?? undefined,
      },
    }));
  }

  private toPrincipal(row: {
    id: string;
    type: string;
    display_name: string;
    workspace_id: string;
  }): Principal {
    return {
      id: row.id,
      type: row.type as "user" | "service",
      displayName: row.display_name,
      workspaceId: row.workspace_id,
    };
  }
}
