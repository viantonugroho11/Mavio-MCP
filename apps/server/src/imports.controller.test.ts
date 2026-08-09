import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { ServerDescriptor, Principal } from "@mavio/core";
import { ImportsController } from "./imports.controller.js";

interface Store {
  approved: Set<string>;
  rejected: Map<string, string>;
  submitted: Map<string, { submittedBy?: string; approvalStatus: string }>;
}

function makeController(store: Store): ImportsController {
  const stored = new Map<string, ServerDescriptor>();
  const registry = {
    register: vi.fn(async (input: { id: string; submittedBy?: string; metadata?: Record<string, unknown> }): Promise<ServerDescriptor> => {
      store.submitted.set(input.id, { submittedBy: input.submittedBy, approvalStatus: "pending" });
      const desc = {
        id: input.id,
        workspaceId: "w",
        projectId: "p",
        name: input.id,
        sourceType: "mcp",
        transport: { type: "stdio", command: "x" },
        approvalStatus: "pending",
        metadata: input.metadata ?? {},
      } as ServerDescriptor;
      stored.set(input.id, desc);
      return desc;
    }),
    get: vi.fn(async (id: string) => {
      const s = stored.get(id);
      if (!s) {
        // Pre-seed for approve/reject tests that don't submit first.
        return {
          id,
          workspaceId: "w",
          projectId: "p",
          name: id,
          sourceType: "mcp",
          transport: { type: "stdio", command: "echo" },
          approvalStatus: "pending",
          metadata: { importSpec: { kind: "mcp", body: { id, transport: { type: "stdio", command: "echo" } } } },
        } as ServerDescriptor;
      }
      return s;
    }),
    updateSpec: vi.fn(async () => undefined),
    approve: vi.fn(async (id: string, approver: string) => {
      store.approved.add(id);
      const s = store.submitted.get(id);
      if (s) s.approvalStatus = "approved";
      return { id, approvedBy: approver, approvalStatus: "approved" } as ServerDescriptor;
    }),
    reject: vi.fn(async (id: string, approver: string, reason: string) => {
      store.rejected.set(id, reason);
      const s = store.submitted.get(id);
      if (s) s.approvalStatus = "rejected";
      return { id, approvedBy: approver, approvalStatus: "rejected", rejectionReason: reason } as ServerDescriptor;
    }),
    snapshotCapabilities: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
  };
  const transports = {} as never;
  const metrics = { importerRuns: { inc: vi.fn() } } as never;
  const router = { invalidate: vi.fn(async () => undefined) } as never;
  const audit = { logFromRequest: vi.fn() } as never;
  return new ImportsController(registry as never, transports, metrics, router, audit);
}

function req(principalId?: string): Request {
  const p: Principal | undefined = principalId
    ? { id: principalId, type: "user", workspaceId: "w", scopes: [] }
    : undefined;
  return { principal: p, headers: {} } as unknown as Request;
}

describe("ImportsController approval flow", () => {
  it("approve runs deferred blueprint + marks server approved", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    // Stub the blueprint runner so we don't actually spawn upstream.
    // deno-lint-ignore no-explicit-any
    (ctl as unknown as { runBlueprint: (...args: unknown[]) => Promise<unknown> }).runBlueprint =
      vi.fn(async () => ({
        serverName: "srv1",
        serverVersion: "1.0.0",
        transport: { type: "stdio", command: "echo" },
        capabilities: { tools: [] },
        toolCount: 3,
      }));
    const out = await ctl.approve("srv1", req("admin1"));
    expect(out.ok).toBe(true);
    expect(out.toolCount).toBe(3);
    expect(out.serverName).toBe("srv1");
    expect(store.approved.has("srv1")).toBe(true);
  });

  it("approve throws when server has no importSpec (e.g. registered via /api/servers)", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    // Override registry.get so metadata has NO importSpec
    // deno-lint-ignore no-explicit-any
    (ctl as unknown as { registry: { get: unknown } }).registry.get = vi.fn(async (id: string) => ({
      id,
      workspaceId: "w",
      projectId: "p",
      name: id,
      sourceType: "mcp",
      transport: { type: "stdio", command: "x" },
      approvalStatus: "pending",
      metadata: {},
    })) as unknown as never;
    await expect(ctl.approve("srv-no-spec", req("admin1"))).rejects.toThrow(/no importSpec/);
    expect(store.approved.has("srv-no-spec")).toBe(false);
  });

  it("reject stores reason", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    await ctl.reject("srv2", { reason: "unsafe transport" }, req("admin1"));
    expect(store.rejected.get("srv2")).toBe("unsafe transport");
  });

  it("reject with no reason stores empty string", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    await ctl.reject("srv3", {}, req("admin1"));
    expect(store.rejected.get("srv3")).toBe("");
  });
});
