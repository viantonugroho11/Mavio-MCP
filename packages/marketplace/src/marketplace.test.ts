import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  MarketplaceClient,
  verifyChecksum,
  verifySignature,
  type MarketplaceEntry,
  type MarketplaceIndex,
} from "./index.js";

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

const tarball = Buffer.from("fake tarball bytes");
const sha = createHash("sha256").update(tarball).digest("hex");

const entry: MarketplaceEntry = {
  name: "@mavio-plugin/example",
  version: "1.2.3",
  description: "Example plugin",
  keywords: ["example", "demo"],
  tarballUrl: "http://cdn.mavio/example-1.2.3.tgz",
  sha256: sha,
};

const index: MarketplaceIndex = {
  version: 1,
  generatedAt: "2026-08-05T00:00:00Z",
  plugins: [
    entry,
    { ...entry, name: "@mavio-plugin/other", description: "ETL tool", keywords: ["etl"] },
  ],
};

describe("MarketplaceClient", () => {
  it("fetches and caches index", async () => {
    let hits = 0;
    agent
      .get("http://mkt")
      .intercept({ path: "/index.json", method: "GET" })
      .reply(200, () => {
        hits++;
        return index;
      })
      .persist();
    const c = new MarketplaceClient({ indexUrl: "http://mkt/index.json" });
    await c.fetchIndex();
    await c.fetchIndex();
    expect(hits).toBe(1);
  });

  it("searches by name, description, keywords", async () => {
    agent.get("http://mkt").intercept({ path: "/index.json", method: "GET" }).reply(200, index);
    const c = new MarketplaceClient({ indexUrl: "http://mkt/index.json" });
    expect((await c.search("example")).map((p) => p.name)).toEqual(["@mavio-plugin/example"]);
    expect((await c.search("etl")).map((p) => p.name)).toEqual(["@mavio-plugin/other"]);
  });

  it("throws on index 5xx", async () => {
    agent.get("http://mkt").intercept({ path: "/index.json", method: "GET" }).reply(500, "");
    const c = new MarketplaceClient({ indexUrl: "http://mkt/index.json" });
    await expect(c.fetchIndex()).rejects.toThrow(/marketplace index 500/);
  });

  it("download verifies sha256", async () => {
    agent.get("http://mkt").intercept({ path: "/index.json", method: "GET" }).reply(200, index);
    agent
      .get("http://cdn.mavio")
      .intercept({ path: "/example-1.2.3.tgz", method: "GET" })
      .reply(200, tarball);
    const c = new MarketplaceClient({ indexUrl: "http://mkt/index.json" });
    const bytes = await c.download(entry);
    expect(bytes.equals(tarball)).toBe(true);
  });

  it("download rejects on sha mismatch", async () => {
    const bad: MarketplaceEntry = { ...entry, sha256: "deadbeef".padEnd(64, "0") };
    agent
      .get("http://cdn.mavio")
      .intercept({ path: "/example-1.2.3.tgz", method: "GET" })
      .reply(200, tarball);
    const c = new MarketplaceClient({ indexUrl: "http://mkt/index.json" });
    await expect(c.download(bad)).rejects.toThrow(/sha256 mismatch/);
  });
});

describe("verifyChecksum", () => {
  it("passes on correct sha", () => {
    expect(() => verifyChecksum(entry, tarball)).not.toThrow();
  });
});

describe("verifySignature", () => {
  it("verifies a valid Ed25519 signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signature = cryptoSign(null, Buffer.from(sha, "utf8"), privateKey).toString("hex");
    const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(() => verifySignature({ ...entry, signature }, pem)).not.toThrow();
  });

  it("rejects a bad signature", () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(() =>
      verifySignature({ ...entry, signature: "00".repeat(64) }, pem),
    ).toThrow(/signature invalid/);
  });

  it("errors when signature present but no key", () => {
    expect(() => verifySignature({ ...entry, signature: "aa" }, undefined)).toThrow(
      /no public key/,
    );
  });
});
