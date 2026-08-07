import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import type { Redis } from "@mavio/cache";
import { Actions } from "@mavio/rbac";
import { EnvKekProvider, type PrincipalUpstreamCredentialsRepository } from "@mavio/upstream-auth";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { REDIS } from "./cache.module.js";
import { AuditService } from "./audit.module.js";
import { UPSTREAM_CREDS_REPO } from "./upstream-auth.tokens.js";

export const VAULT_RELOAD_CHANNEL = "mavio:vault:keyring:reload";

interface RotateBody {
  /** New key id, e.g. "v4". Must be unique in the keyring. */
  keyId: string;
  /** Base64 32 bytes of AES-256 material. */
  material: string;
}

interface RetireBody {
  keyId: string;
  /** When true, retire even if rows still reference the key. Dangerous. */
  force?: boolean;
}

interface StatusView {
  primaryKeyId: string;
  keys: Array<{ keyId: string; rowCount: number }>;
  totalRows: number;
}

/**
 * Runtime KEK rotation for the local (EnvKekProvider) keyring. This does NOT
 * apply to remote KMS wrappers (Vault Transit / KMS plugins) — rotate those
 * on their own control plane.
 *
 * All endpoints require workspace:admin.
 *
 *   POST /api/admin/vault/rotate  { keyId, material }
 *     — prepend a new primary. Publishes VAULT_RELOAD_CHANNEL so replicas
 *       re-read MAVIO_VAULT_KEYRING (operator must have already updated env
 *       via config-map + rolling restart, or the reload is a no-op).
 *
 *   POST /api/admin/vault/retire  { keyId, force? }
 *     — remove a decrypt-only key. Refuses when mavio_vault_rows_by_key(keyId)
 *       is non-zero unless force=true.
 *
 *   GET  /api/admin/vault/status
 *     — primary key id + per-key row counts.
 */
@Controller("api/admin/vault")
@UseGuards(ApiKeyGuard, RbacGuard)
export class VaultAdminController {
  constructor(
    @Inject(UPSTREAM_CREDS_REPO)
    private readonly repo: PrincipalUpstreamCredentialsRepository,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  @Get("status")
  @RequirePermission(Actions.WorkspaceAdmin)
  async status(): Promise<StatusView> {
    const kek = readKek();
    const counts = await this.repo.countByKeyId();
    const known = new Set(kek.list().map((e) => e.keyId));
    // Merge keys that appear on rows but were retired (should be zero rows).
    for (const k of Object.keys(counts)) known.add(k);
    const keys = [...known].sort().map((keyId) => ({
      keyId,
      rowCount: counts[keyId] ?? 0,
    }));
    return {
      primaryKeyId: kek.primary.keyId,
      keys,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }

  @Post("rotate")
  @RequirePermission(Actions.WorkspaceAdmin)
  async rotate(@Body() body: RotateBody): Promise<{ primaryKeyId: string }> {
    if (!body.keyId || !body.material) {
      throw new Error("keyId and material required");
    }
    const material = Buffer.from(body.material, "base64");
    if (material.length !== 32) {
      throw new Error(`material must decode to 32 bytes (got ${material.length})`);
    }
    const kek = readKek();
    kek.rotate({ keyId: body.keyId, material });
    await this.redis.publish(
      VAULT_RELOAD_CHANNEL,
      JSON.stringify({ op: "rotate", keyId: body.keyId, at: Date.now() }),
    );
    this.audit.log({
      actorId: null,
      actorType: null,
      action: "vault.key.rotate",
      resource: { keyId: body.keyId },
      outcome: "ok",
      metadata: {},
    });
    return { primaryKeyId: kek.primary.keyId };
  }

  @Post("retire")
  @RequirePermission(Actions.WorkspaceAdmin)
  async retire(@Body() body: RetireBody): Promise<{ retired: string }> {
    if (!body.keyId) throw new Error("keyId required");
    const counts = await this.repo.countByKeyId();
    const remaining = counts[body.keyId] ?? 0;
    if (remaining > 0 && !body.force) {
      throw new Error(
        `${remaining} rows still reference keyId ${body.keyId} — rewrap first or pass force:true`,
      );
    }
    const kek = readKek();
    kek.retire(body.keyId);
    await this.redis.publish(
      VAULT_RELOAD_CHANNEL,
      JSON.stringify({ op: "retire", keyId: body.keyId, at: Date.now() }),
    );
    this.audit.log({
      actorId: null,
      actorType: null,
      action: "vault.key.retire",
      resource: { keyId: body.keyId },
      outcome: "ok",
      metadata: { remainingRows: remaining, forced: !!body.force },
    });
    return { retired: body.keyId };
  }
}

/**
 * Reads the shared EnvKekProvider singleton bound to the current process
 * env. Rotate/retire mutate the singleton so subsequent Vault operations use
 * the updated keyring. Publishing VAULT_RELOAD_CHANNEL notifies replicas —
 * they re-hydrate their own singleton on subscribe.
 */
let sharedKek: EnvKekProvider | null = null;
export function readKek(): EnvKekProvider {
  if (!sharedKek) sharedKek = new EnvKekProvider();
  return sharedKek;
}
export function resetSharedKek(): void {
  sharedKek = null;
}
