import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { satisfies } from "semver";
import { MavioError } from "@mavio/core";
import {
  MAVIO_API_VERSION,
  type PluginContext,
  type PluginLogger,
  type PluginManifest,
} from "@mavio/sdk";
import {
  InMemoryAuthRegistry,
  InMemoryImporterRegistry,
  InMemoryMiddlewareRegistry,
  InMemoryTransportRegistry,
} from "./registries.js";

export interface DiscoveredPlugin {
  name: string;
  version: string;
  packageDir: string;
  entry: string;
  manifest?: PluginManifest;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  packageDir: string;
  enabled: boolean;
  activatedAt?: Date;
}

export interface PluginState {
  name: string;
  enabled: boolean;
}

export interface PluginStateStore {
  load(): Promise<PluginState[]>;
  set(name: string, enabled: boolean): Promise<void>;
}

export class InMemoryStateStore implements PluginStateStore {
  private readonly map = new Map<string, boolean>();
  async load(): Promise<PluginState[]> {
    return Array.from(this.map, ([name, enabled]) => ({ name, enabled }));
  }
  async set(name: string, enabled: boolean): Promise<void> {
    this.map.set(name, enabled);
  }
}

export interface PluginManagerOptions {
  cwd?: string;
  scope?: string;
  logger?: PluginLogger;
  store?: PluginStateStore;
  config?: Record<string, unknown>;
  registries?: {
    importers: InMemoryImporterRegistry;
    transports: InMemoryTransportRegistry;
    middleware: InMemoryMiddlewareRegistry;
    auth: InMemoryAuthRegistry;
  };
}

const defaultLogger: PluginLogger = {
  info: (msg, meta) => console.log(`[plugin] ${msg}`, meta ?? ""),
  warn: (msg, meta) => console.warn(`[plugin] ${msg}`, meta ?? ""),
  error: (msg, meta) => console.error(`[plugin] ${msg}`, meta ?? ""),
};

export class PluginManager {
  readonly importers: InMemoryImporterRegistry;
  readonly transports: InMemoryTransportRegistry;
  readonly middleware: InMemoryMiddlewareRegistry;
  readonly auth: InMemoryAuthRegistry;
  private readonly loaded = new Map<string, LoadedPlugin>();
  private readonly logger: PluginLogger;
  private readonly store: PluginStateStore;
  private readonly cwd: string;
  private readonly scope: string;
  private readonly config: Record<string, unknown>;

  constructor(opts: PluginManagerOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.scope = opts.scope ?? "@mavio-plugin";
    this.logger = opts.logger ?? defaultLogger;
    this.store = opts.store ?? new InMemoryStateStore();
    this.config = opts.config ?? {};
    this.importers = opts.registries?.importers ?? new InMemoryImporterRegistry();
    this.transports = opts.registries?.transports ?? new InMemoryTransportRegistry();
    this.middleware = opts.registries?.middleware ?? new InMemoryMiddlewareRegistry();
    this.auth = opts.registries?.auth ?? new InMemoryAuthRegistry();
  }

  async discover(): Promise<DiscoveredPlugin[]> {
    const require = createRequire(join(this.cwd, "package.json"));
    const roots = new Set<string>();
    try {
      const resolved = require.resolve("@mavio/core/package.json");
      roots.add(resolve(dirname(resolved), "..", ".."));
    } catch {}
    roots.add(resolve(this.cwd, "node_modules"));
    const found: DiscoveredPlugin[] = [];
    for (const root of roots) {
      found.push(...(await this.scanRoot(root)));
    }
    const dedup = new Map<string, DiscoveredPlugin>();
    for (const p of found) if (!dedup.has(p.name)) dedup.set(p.name, p);
    return Array.from(dedup.values());
  }

  private async scanRoot(root: string): Promise<DiscoveredPlugin[]> {
    const scopeDir = join(root, this.scope);
    let entries: string[] = [];
    try {
      entries = await readdir(scopeDir);
    } catch {
      return [];
    }
    const out: DiscoveredPlugin[] = [];
    for (const entry of entries) {
      const pkgDir = join(scopeDir, entry);
      const pkg = await readPkg(pkgDir);
      if (!pkg) continue;
      const mainRel = typeof pkg.main === "string" ? pkg.main : "index.js";
      out.push({
        name: pkg.name ?? `${this.scope}/${entry}`,
        version: pkg.version ?? "0.0.0",
        packageDir: pkgDir,
        entry: join(pkgDir, mainRel),
      });
    }
    return out;
  }

  async loadAll(): Promise<LoadedPlugin[]> {
    const states = new Map((await this.store.load()).map((s) => [s.name, s.enabled] as const));
    const discovered = await this.discover();
    for (const d of discovered) {
      try {
        await this.loadOne(d, states.get(d.name) ?? true);
      } catch (err) {
        this.logger.error(`load failed: ${d.name}`, { err: String(err) });
      }
    }
    return Array.from(this.loaded.values());
  }

  private async loadOne(d: DiscoveredPlugin, enabled: boolean): Promise<void> {
    const mod = (await import(pathToFileURL(d.entry).href)) as {
      mavioPlugin?: PluginManifest;
      default?: PluginManifest;
    };
    const manifest = mod.mavioPlugin ?? mod.default;
    if (!manifest || typeof manifest.activate !== "function") {
      throw new MavioError(`plugin ${d.name} exports no mavioPlugin manifest`, "PLUGIN_INVALID");
    }
    if (!satisfies(MAVIO_API_VERSION, manifest.mavioApi)) {
      throw new MavioError(
        `plugin ${manifest.name} requires mavioApi ${manifest.mavioApi}; host is ${MAVIO_API_VERSION}`,
        "PLUGIN_INCOMPATIBLE",
      );
    }
    this.loaded.set(manifest.name, { manifest, packageDir: d.packageDir, enabled: false });
    if (enabled) await this.enable(manifest.name);
  }

  list(): LoadedPlugin[] {
    return Array.from(this.loaded.values());
  }

  get(name: string): LoadedPlugin | undefined {
    return this.loaded.get(name);
  }

  async enable(name: string): Promise<LoadedPlugin> {
    const p = this.loaded.get(name);
    if (!p) throw new MavioError(`plugin ${name} not loaded`, "PLUGIN_NOT_FOUND");
    if (p.enabled) return p;
    await p.manifest.activate(this.buildContext(p.manifest));
    p.enabled = true;
    p.activatedAt = new Date();
    await this.store.set(name, true);
    this.logger.info(`activated ${name}@${p.manifest.version}`);
    return p;
  }

  async disable(name: string): Promise<LoadedPlugin> {
    const p = this.loaded.get(name);
    if (!p) throw new MavioError(`plugin ${name} not loaded`, "PLUGIN_NOT_FOUND");
    if (!p.enabled) return p;
    if (p.manifest.deactivate) {
      await p.manifest.deactivate(this.buildContext(p.manifest));
    }
    p.enabled = false;
    await this.store.set(name, false);
    this.logger.info(`deactivated ${name}`);
    return p;
  }

  private buildContext(manifest: PluginManifest): PluginContext {
    return {
      manifest,
      mavioApi: MAVIO_API_VERSION,
      log: this.logger,
      importers: this.importers,
      transports: this.transports,
      middleware: this.middleware,
      auth: this.auth,
      config: this.config,
    };
  }
}

async function readPkg(dir: string): Promise<{ name?: string; version?: string; main?: string } | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
