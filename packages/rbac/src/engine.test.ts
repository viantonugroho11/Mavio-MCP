import { describe, expect, it } from "vitest";
import type { Principal } from "@mavio/core";
import { BuiltinRbacEngine } from "./engine.js";
import type { Role, RoleAssignment, RoleProvider } from "./index.js";
import { Actions } from "./index.js";

function makeProvider(roles: Role[], assignments: RoleAssignment[]): RoleProvider {
  return {
    listRoles: async () => roles,
    getRole: async (name) => roles.find((r) => r.name === name) ?? null,
    assignmentsFor: async () => assignments,
  };
}

const principal: Principal = { id: "u1", type: "user", workspaceId: "ws1", scopes: [] };

describe("BuiltinRbacEngine", () => {
  it("allows when a matching allow permission exists in scope", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [{ name: "r", permissions: [{ action: Actions.ToolInvoke, scope: {}, effect: "allow" }] }],
        [{ principalId: "u1", roleName: "r", scope: { workspace: "ws1" } }],
      ),
    );
    const d = await engine.can(principal, Actions.ToolInvoke, { workspace: "ws1", server: "s", tool: "t" });
    expect(d.allowed).toBe(true);
  });

  it("denies when no matching permission", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [{ name: "r", permissions: [{ action: Actions.ServerRead, scope: {}, effect: "allow" }] }],
        [{ principalId: "u1", roleName: "r", scope: {} }],
      ),
    );
    const d = await engine.can(principal, Actions.ToolInvoke, {});
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("no matching permission");
  });

  it("explicit deny beats allow", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [
          {
            name: "r",
            permissions: [
              { action: Actions.ToolInvoke, scope: {}, effect: "allow" },
              { action: Actions.ToolInvoke, scope: { server: "secret" }, effect: "deny" },
            ],
          },
        ],
        [{ principalId: "u1", roleName: "r", scope: {} }],
      ),
    );
    const d = await engine.can(principal, Actions.ToolInvoke, { server: "secret", tool: "t" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("explicit deny");
  });

  it("assignment scope filters resource", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [{ name: "r", permissions: [{ action: Actions.ToolInvoke, scope: {}, effect: "allow" }] }],
        [{ principalId: "u1", roleName: "r", scope: { workspace: "wsA" } }],
      ),
    );
    const inScope = await engine.can(principal, Actions.ToolInvoke, { workspace: "wsA" });
    const outOfScope = await engine.can(principal, Actions.ToolInvoke, { workspace: "wsB" });
    expect(inScope.allowed).toBe(true);
    expect(outOfScope.allowed).toBe(false);
  });

  it("wildcard action '*' matches any action", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [{ name: "owner", permissions: [{ action: "*", scope: {}, effect: "allow" }] }],
        [{ principalId: "u1", roleName: "owner", scope: {} }],
      ),
    );
    const d = await engine.can(principal, Actions.AuditRead, {});
    expect(d.allowed).toBe(true);
  });

  it("family wildcard 'server:*' matches server:read", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [{ name: "r", permissions: [{ action: "server:*" as never, scope: {}, effect: "allow" }] }],
        [{ principalId: "u1", roleName: "r", scope: {} }],
      ),
    );
    const d = await engine.can(principal, Actions.ServerRead, {});
    expect(d.allowed).toBe(true);
  });

  it("role inheritance collects parent permissions with cycle guard", async () => {
    const engine = new BuiltinRbacEngine(
      makeProvider(
        [
          { name: "child", inherits: ["parent"], permissions: [] },
          { name: "parent", inherits: ["child"], permissions: [{ action: Actions.ToolInvoke, scope: {}, effect: "allow" }] },
        ],
        [{ principalId: "u1", roleName: "child", scope: {} }],
      ),
    );
    const d = await engine.can(principal, Actions.ToolInvoke, {});
    expect(d.allowed).toBe(true);
  });
});
