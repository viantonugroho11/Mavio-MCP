import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { MavioError } from "@mavio/core";
import { MavioConfigSchema, type MavioConfig } from "./schema.js";

export { MavioConfigSchema } from "./schema.js";
export type { MavioConfig, ServerConfigEntry } from "./schema.js";

const ENV_REF = /\$\{([A-Z0-9_]+)\}/g;

function interpolateEnv(input: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof input === "string") {
    return input.replace(ENV_REF, (_, key: string) => {
      const value = env[key];
      if (value === undefined) {
        throw new MavioError(
          `env var ${key} referenced in config but not set`,
          "CONFIG_MISSING_ENV",
        );
      }
      return value;
    });
  }
  if (Array.isArray(input)) return input.map((v) => interpolateEnv(v, env));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = interpolateEnv(v, env);
    return out;
  }
  return input;
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MavioConfig> {
  const abs = resolve(path);
  const raw = await readFile(abs, "utf8");
  const parsed = parse(raw);
  const interpolated = interpolateEnv(parsed, env);
  const result = MavioConfigSchema.safeParse(interpolated);
  if (!result.success) {
    throw new MavioError(
      `invalid config at ${abs}: ${result.error.message}`,
      "CONFIG_INVALID",
      result.error,
    );
  }
  return result.data;
}

export async function saveConfig(
  path: string,
  config: MavioConfig,
): Promise<void> {
  const abs = resolve(path);
  await writeFile(abs, stringify(config), "utf8");
}

export function validateConfig(input: unknown): MavioConfig {
  return MavioConfigSchema.parse(input);
}
