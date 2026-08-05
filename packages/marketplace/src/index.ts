import { request } from "undici";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { MavioError } from "@mavio/core";

export interface MarketplaceEntry {
  name: string;
  version: string;
  description?: string;
  homepage?: string;
  keywords?: string[];
  tarballUrl: string;
  /** Hex-encoded SHA-256 of the tarball bytes. */
  sha256: string;
  /** Ed25519 signature of the raw hex sha256 string, hex-encoded. Optional. */
  signature?: string;
  /** SPDX license identifier. */
  license?: string;
  /** Author display name. */
  author?: string;
  publishedAt?: string;
}

export interface MarketplaceIndex {
  version: 1;
  generatedAt: string;
  plugins: MarketplaceEntry[];
}

export interface MarketplaceClientOptions {
  /** Marketplace index URL, e.g. https://plugins.mavio.dev/index.json */
  indexUrl: string;
  /** Optional PEM-encoded Ed25519 public key used to verify entry signatures. */
  publicKeyPem?: string;
  /** Fetch timeout (ms). Default 5000. */
  timeoutMs?: number;
}

export class MarketplaceClient {
  private cachedIndex: MarketplaceIndex | null = null;
  private cachedAt = 0;

  constructor(private readonly opts: MarketplaceClientOptions) {}

  async fetchIndex(force = false): Promise<MarketplaceIndex> {
    if (!force && this.cachedIndex && Date.now() - this.cachedAt < 60_000) {
      return this.cachedIndex;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 5000);
    try {
      const res = await request(this.opts.indexUrl, {
        method: "GET",
        signal: controller.signal,
      });
      if (res.statusCode >= 400) {
        throw new MavioError(`marketplace index ${res.statusCode}`, "MARKETPLACE_ERROR");
      }
      const idx = (await res.body.json()) as MarketplaceIndex;
      this.cachedIndex = idx;
      this.cachedAt = Date.now();
      return idx;
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string): Promise<MarketplaceEntry[]> {
    const idx = await this.fetchIndex();
    if (!query) return idx.plugins;
    const q = query.toLowerCase();
    return idx.plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    );
  }

  async get(name: string): Promise<MarketplaceEntry | null> {
    const idx = await this.fetchIndex();
    return idx.plugins.find((p) => p.name === name) ?? null;
  }

  /**
   * Downloads the tarball, verifies SHA-256 (and optional Ed25519 signature),
   * and returns the raw bytes. Caller is responsible for extracting / npm-installing.
   */
  async download(entry: MarketplaceEntry): Promise<Buffer> {
    const res = await request(entry.tarballUrl, { method: "GET" });
    if (res.statusCode >= 400) {
      throw new MavioError(`tarball ${res.statusCode}`, "MARKETPLACE_ERROR");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of res.body) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    verifyChecksum(entry, body);
    if (entry.signature) verifySignature(entry, this.opts.publicKeyPem);
    return body;
  }
}

export function verifyChecksum(entry: MarketplaceEntry, body: Buffer): void {
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== entry.sha256.toLowerCase()) {
    throw new MavioError(
      `sha256 mismatch: expected ${entry.sha256}, got ${actual}`,
      "MARKETPLACE_INTEGRITY",
    );
  }
}

export function verifySignature(entry: MarketplaceEntry, publicKeyPem: string | undefined): void {
  if (!publicKeyPem) {
    throw new MavioError("signature present but no public key configured", "MARKETPLACE_INTEGRITY");
  }
  if (!entry.signature) return;
  const key = createPublicKey({ key: publicKeyPem, format: "pem" });
  const ok = cryptoVerify(
    null,
    Buffer.from(entry.sha256, "utf8"),
    key,
    Buffer.from(entry.signature, "hex"),
  );
  if (!ok) {
    throw new MavioError(`ed25519 signature invalid for ${entry.name}`, "MARKETPLACE_INTEGRITY");
  }
}
