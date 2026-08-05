import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { InMemoryPkceStateStore, Oauth2PkceProvider } from "./pkce.js";

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

function newProvider() {
  return new Oauth2PkceProvider({
    id: "acme",
    authorizationEndpoint: "https://idp.acme/authorize",
    tokenEndpoint: "https://idp.acme/token",
    revocationEndpoint: "https://idp.acme/revoke",
    clientId: "cid",
    clientSecret: "csec",
    scopes: ["read", "write"],
    injectHeader: "authorization",
    injectEnvVar: "ACME_TOKEN",
    refreshEarlySec: 30,
  });
}

describe("Oauth2PkceProvider.authorize", () => {
  it("builds an authorize URL with PKCE + saves state", async () => {
    const p = newProvider();
    const { url } = await p.authorize({
      principalId: "alice",
      state: "st1",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://idp.acme/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("cid");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toBeTruthy();
    expect(parsed.searchParams.get("scope")).toBe("read write");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://mavio.local/auth/upstream/acme/callback",
    );
  });
});

describe("Oauth2PkceProvider.exchange", () => {
  it("posts authcode + PKCE verifier, returns credential", async () => {
    const p = newProvider();
    await p.authorize({
      principalId: "alice",
      state: "st2",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    let captured: URLSearchParams | null = null;
    agent
      .get("https://idp.acme")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, (req) => {
        captured = new URLSearchParams(String(req.body));
        return {
          access_token: "at1",
          refresh_token: "rt1",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "read write",
        };
      });
    const cred = await p.exchange({
      principalId: "alice",
      code: "code1",
      state: "st2",
      callbackBaseUrl: "https://mavio.local",
    });
    expect(cred.accessToken).toBe("at1");
    expect(cred.refreshToken).toBe("rt1");
    expect(cred.scopes).toEqual(["read", "write"]);
    expect(cred.expiresAt).toBeInstanceOf(Date);
    expect(captured!.get("grant_type")).toBe("authorization_code");
    expect(captured!.get("code_verifier")).toBeTruthy();
    expect(captured!.get("client_secret")).toBe("csec");
  });

  it("rejects unknown state", async () => {
    const p = newProvider();
    await expect(
      p.exchange({
        principalId: "alice",
        code: "code1",
        state: "unknown",
        callbackBaseUrl: "https://mavio.local",
      }),
    ).rejects.toThrow(/unknown or expired state/);
  });

  it("throws on token endpoint 4xx", async () => {
    const p = newProvider();
    await p.authorize({
      principalId: "alice",
      state: "st3",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    agent
      .get("https://idp.acme")
      .intercept({ path: "/token", method: "POST" })
      .reply(400, "invalid_grant");
    await expect(
      p.exchange({
        principalId: "alice",
        code: "bad",
        state: "st3",
        callbackBaseUrl: "https://mavio.local",
      }),
    ).rejects.toThrow(/token endpoint 400/);
  });
});

describe("Oauth2PkceProvider.refresh", () => {
  it("posts refresh_token grant + carries prior refresh when absent in response", async () => {
    const p = newProvider();
    agent
      .get("https://idp.acme")
      .intercept({ path: "/token", method: "POST" })
      .reply(200, { access_token: "at2", token_type: "Bearer", expires_in: 60 });
    const next = await p.refresh({
      accessToken: "old",
      refreshToken: "rt1",
      tokenType: "Bearer",
    });
    expect(next.accessToken).toBe("at2");
    expect(next.refreshToken).toBe("rt1"); // carried over
  });

  it("refuses refresh without refresh_token", async () => {
    const p = newProvider();
    await expect(p.refresh({ accessToken: "old" })).rejects.toThrow(/no refresh_token/);
  });
});

describe("Oauth2PkceProvider.inject", () => {
  it("emits both Authorization header and env var when configured", () => {
    const p = newProvider();
    const out = p.inject({ accessToken: "T", tokenType: "Bearer" });
    expect(out.headers?.authorization).toBe("Bearer T");
    expect(out.env?.ACME_TOKEN).toBe("T");
  });
});

describe("Oauth2PkceProvider.expiringSoon", () => {
  it("returns true within refresh window", () => {
    const p = newProvider(); // refreshEarlySec=30
    expect(p.expiringSoon({ accessToken: "T", expiresAt: new Date(Date.now() + 10_000) })).toBe(
      true,
    );
    expect(p.expiringSoon({ accessToken: "T", expiresAt: new Date(Date.now() + 60_000) })).toBe(
      false,
    );
    expect(p.expiringSoon({ accessToken: "T" })).toBe(false);
  });
});

describe("InMemoryPkceStateStore", () => {
  it("consumes state once", async () => {
    const s = new InMemoryPkceStateStore();
    await s.put("k", "v");
    expect(await s.take("k")).toBe("v");
    expect(await s.take("k")).toBeNull();
  });
});
