import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import type { Principal } from "@mavio/core";
import { OpaPolicyEngine, CedarSidecarPolicyEngine, RemoteHttpPolicyEngine } from "./index.js";

const principal: Principal = { id: "u", type: "user", workspaceId: "w", scopes: [] };

let previous: Dispatcher;
let agent: MockAgent;

beforeEach(() => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(previous);
});

describe("OpaPolicyEngine", () => {
  it("allows on {result: {allow: true, reason}}", async () => {
    agent
      .get("http://opa:8181")
      .intercept({ path: "/v1/data/mavio/authz/allow", method: "POST" })
      .reply(200, { result: { allow: true, reason: "role admin" } });
    const eng = new OpaPolicyEngine({ url: "http://opa:8181/v1/data/mavio/authz/allow" });
    const d = await eng.can(principal, "tool:invoke", {});
    expect(d).toEqual({ allowed: true, reason: "role admin" });
  });

  it("denies on flat {allow: false}", async () => {
    agent
      .get("http://opa:8181")
      .intercept({ path: "/v1/data/mavio/authz/allow", method: "POST" })
      .reply(200, { allow: false });
    const eng = new OpaPolicyEngine({ url: "http://opa:8181/v1/data/mavio/authz/allow" });
    const d = await eng.can(principal, "tool:invoke", {});
    expect(d.allowed).toBe(false);
  });

  it("denies on 5xx", async () => {
    agent
      .get("http://opa:8181")
      .intercept({ path: "/v1/data/mavio/authz/allow", method: "POST" })
      .reply(500, "boom");
    const eng = new OpaPolicyEngine({ url: "http://opa:8181/v1/data/mavio/authz/allow" });
    const d = await eng.can(principal, "tool:invoke", {});
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/policy service 500/);
  });

  it("denies on unrecognized shape", async () => {
    agent
      .get("http://opa:8181")
      .intercept({ path: "/v1/data/mavio/authz/allow", method: "POST" })
      .reply(200, { foo: "bar" });
    const eng = new OpaPolicyEngine({ url: "http://opa:8181/v1/data/mavio/authz/allow" });
    const d = await eng.can(principal, "tool:invoke", {});
    expect(d.allowed).toBe(false);
  });
});

describe("CedarSidecarPolicyEngine", () => {
  it("wraps principal/action/resource in Cedar entity refs", async () => {
    let captured: unknown = null;
    agent
      .get("http://cedar:8080")
      .intercept({ path: "/is_authorized", method: "POST" })
      .reply(200, (req) => {
        captured = JSON.parse(String(req.body));
        return { decision: true };
      });
    const eng = new CedarSidecarPolicyEngine({ url: "http://cedar:8080/is_authorized" });
    const d = await eng.can(principal, "tool:invoke", { server: "s1" });
    expect(d.allowed).toBe(true);
    expect(captured).toEqual({
      principal: 'Mavio::User::"u"',
      action: 'Mavio::Action::"tool:invoke"',
      resource: { server: "s1" },
      context: { workspaceId: "w", scopes: [] },
    });
  });
});

describe("RemoteHttpPolicyEngine timeout", () => {
  it("returns deny reason on abort", async () => {
    agent
      .get("http://slow:9000")
      .intercept({ path: "/policy", method: "POST" })
      .reply(200, { allow: true })
      .delay(200);
    const eng = new RemoteHttpPolicyEngine({ url: "http://slow:9000/policy", timeoutMs: 20 });
    const d = await eng.can(principal, "tool:invoke", {});
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/policy service error/);
  });
});
