import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { TokenExchangeProvider, type SubjectTokenResolver } from "./token-exchange.js";

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

function newProvider(
  resolver: SubjectTokenResolver = async () => ({ token: "kc-session-token" }),
) {
  return new TokenExchangeProvider({
    id: "keycloak-analytics",
    tokenEndpoint: "http://keycloak/realms/mavio/protocol/openid-connect/token",
    clientId: "mavio-server",
    clientSecret: "srv-secret",
    audience: "analytics-db",
    resource: "https://analytics.example",
    scopes: ["read:events"],
    injectHeader: "authorization",
    subjectTokenResolver: resolver,
  });
}

describe("TokenExchangeProvider.authorize", () => {
  it("returns null (no browser round-trip)", async () => {
    const p = newProvider();
    expect(
      await p.authorize({
        principalId: "alice",
        state: "s",
        returnTo: "/",
        callbackBaseUrl: "https://mavio.local",
      }),
    ).toBeNull();
  });
});

describe("TokenExchangeProvider.mint", () => {
  it("posts RFC 8693 body + returns downstream credential", async () => {
    const p = newProvider();
    let captured: URLSearchParams | null = null;
    agent
      .get("http://keycloak")
      .intercept({ path: "/realms/mavio/protocol/openid-connect/token", method: "POST" })
      .reply(200, (req) => {
        captured = new URLSearchParams(String(req.body));
        return {
          access_token: "downstream-jwt",
          token_type: "Bearer",
          expires_in: 300,
          scope: "read:events",
          issued_token_type: "urn:ietf:params:oauth:token-type:jwt",
        };
      });
    const cred = await p.mint({ principalId: "alice" });
    expect(cred.accessToken).toBe("downstream-jwt");
    expect(cred.scopes).toEqual(["read:events"]);
    expect(cred.expiresAt).toBeInstanceOf(Date);
    expect(captured!.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(captured!.get("subject_token")).toBe("kc-session-token");
    expect(captured!.get("audience")).toBe("analytics-db");
    expect(captured!.get("resource")).toBe("https://analytics.example");
    expect(captured!.get("scope")).toBe("read:events");
    expect(captured!.get("client_secret")).toBe("srv-secret");
  });

  it("errors when resolver returns null", async () => {
    const p = newProvider(async () => null);
    await expect(p.mint({ principalId: "alice" })).rejects.toThrow(/no subject token/);
  });

  it("passes an explicit subjectToken through (bypasses resolver)", async () => {
    const p = newProvider(async () => {
      throw new Error("resolver should not run");
    });
    let captured: URLSearchParams | null = null;
    agent
      .get("http://keycloak")
      .intercept({ path: "/realms/mavio/protocol/openid-connect/token", method: "POST" })
      .reply(200, (req) => {
        captured = new URLSearchParams(String(req.body));
        return { access_token: "x", token_type: "Bearer" };
      });
    await p.mint({ principalId: "alice", subjectToken: "explicit-token" });
    expect(captured!.get("subject_token")).toBe("explicit-token");
  });

  it("throws on upstream 4xx with detail truncated", async () => {
    const p = newProvider();
    agent
      .get("http://keycloak")
      .intercept({ path: "/realms/mavio/protocol/openid-connect/token", method: "POST" })
      .reply(401, "invalid_client");
    await expect(p.mint({ principalId: "alice" })).rejects.toThrow(/token-exchange 401/);
  });
});

describe("TokenExchangeProvider.refresh", () => {
  it("re-mints when a subject binding is present", async () => {
    const p = newProvider();
    agent
      .get("http://keycloak")
      .intercept({ path: "/realms/mavio/protocol/openid-connect/token", method: "POST" })
      .reply(200, { access_token: "fresh", token_type: "Bearer" });
    const fresh = await p.refresh({ accessToken: "stale", subject: "alice" });
    expect(fresh.accessToken).toBe("fresh");
  });

  it("refuses refresh without subject binding", async () => {
    const p = newProvider();
    await expect(p.refresh({ accessToken: "x" })).rejects.toThrow(/missing principal binding/);
  });
});

describe("TokenExchangeProvider.inject", () => {
  it("emits Authorization header by default", () => {
    const p = newProvider();
    const out = p.inject({ accessToken: "T", tokenType: "Bearer" });
    expect(out.headers?.authorization).toBe("Bearer T");
  });
});
