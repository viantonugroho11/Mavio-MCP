import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { SlackUserProvider } from "./slack-user.js";

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
  return new SlackUserProvider({
    clientId: "cid",
    clientSecret: "csec",
    userScopes: ["chat:write", "channels:read"],
    botScopes: ["users:read"],
  });
}

describe("SlackUserProvider.authorize", () => {
  it("builds authorize URL with user_scope + bot scope + PKCE", async () => {
    const p = newProvider();
    const { url } = await p.authorize({
      principalId: "alice",
      state: "st1",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(parsed.searchParams.get("user_scope")).toBe("chat:write,channels:read");
    expect(parsed.searchParams.get("scope")).toBe("users:read");
    expect(parsed.searchParams.get("client_id")).toBe("cid");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://mavio.local/auth/upstream/slack/callback",
    );
  });
});

describe("SlackUserProvider.exchange", () => {
  it("parses user token from authed_user", async () => {
    const p = newProvider();
    await p.authorize({
      principalId: "alice",
      state: "st2",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    agent
      .get("https://slack.com")
      .intercept({ path: "/api/oauth.v2.access", method: "POST" })
      .reply(200, {
        ok: true,
        access_token: "xoxb-bot-token",
        authed_user: {
          id: "U123",
          access_token: "xoxp-alice-token",
          scope: "chat:write channels:read",
          token_type: "user",
        },
        team: { id: "T1" },
      });
    const cred = await p.exchange({
      principalId: "alice",
      code: "code1",
      state: "st2",
      callbackBaseUrl: "https://mavio.local",
    });
    expect(cred.accessToken).toBe("xoxp-alice-token");
    expect(cred.subject).toBe("U123");
    expect(cred.issuer).toBe("https://slack.com");
    expect(cred.scopes).toEqual(["chat:write", "channels:read"]);
  });

  it("falls back to top-level access_token when authed_user missing (bot-only app)", async () => {
    const p = newProvider();
    await p.authorize({
      principalId: "alice",
      state: "st3",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    agent
      .get("https://slack.com")
      .intercept({ path: "/api/oauth.v2.access", method: "POST" })
      .reply(200, {
        ok: true,
        access_token: "xoxb-only",
        scope: "users:read",
        token_type: "bot",
      });
    const cred = await p.exchange({
      principalId: "alice",
      code: "code1",
      state: "st3",
      callbackBaseUrl: "https://mavio.local",
    });
    expect(cred.accessToken).toBe("xoxb-only");
    expect(cred.tokenType).toBe("bot");
  });

  it("throws when Slack returns ok:false", async () => {
    const p = newProvider();
    await p.authorize({
      principalId: "alice",
      state: "st4",
      returnTo: "/",
      callbackBaseUrl: "https://mavio.local",
    });
    agent
      .get("https://slack.com")
      .intercept({ path: "/api/oauth.v2.access", method: "POST" })
      .reply(200, { ok: false, error: "invalid_code" });
    await expect(
      p.exchange({
        principalId: "alice",
        code: "bad",
        state: "st4",
        callbackBaseUrl: "https://mavio.local",
      }),
    ).rejects.toThrow(/invalid_code/);
  });
});

describe("SlackUserProvider.refresh", () => {
  it("refuses when rotation not enabled", async () => {
    const p = newProvider();
    await expect(p.refresh({ accessToken: "xoxp" })).rejects.toThrow(
      /token rotation not enabled/,
    );
  });
});

describe("SlackUserProvider.inject", () => {
  it("emits SLACK_BOT_TOKEN env and Authorization header", () => {
    const p = newProvider();
    const out = p.inject({ accessToken: "xoxp-x" });
    expect(out.env?.SLACK_BOT_TOKEN).toBe("xoxp-x");
    expect(out.headers?.authorization).toBe("Bearer xoxp-x");
  });
});
