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
  const registry = {
    register: vi.fn(async (input: { id: string; submittedBy?: string }): Promise<ServerDescriptor> => {
      store.submitted.set(input.id, { submittedBy: input.submittedBy, approvalStatus: "pending" });
      return {
        id: input.id,
        workspaceId: "w",
        projectId: "p",
        name: input.id,
        sourceType: "mcp",
        transport: { type: "stdio", command: "x" },
        approvalStatus: "pending",
      } as ServerDescriptor;
    }),
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
  it("approve marks server approved and invalidates router", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    const out = await ctl.approve("srv1", req("admin1"));
    expect(out).toEqual({ ok: true });
    expect(store.approved.has("srv1")).toBe(true);
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

  it("approver defaults to 'unknown' when no principal", async () => {
    const store: Store = { approved: new Set(), rejected: new Map(), submitted: new Map() };
    const ctl = makeController(store);
    // Should not throw even without principal
    await expect(ctl.approve("srv4", req())).resolves.toEqual({ ok: true });
  });
});
