import { promisify } from "node:util";
import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

const scryptAsync = promisify(scrypt);

export interface LocalUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  workspaceId: string;
  enabled: boolean;
  createdAt: Date;
}

export interface CreateLocalUserInput {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
  workspaceId?: string;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  const stored_hash = Buffer.from(hashHex, "hex");
  if (hash.length !== stored_hash.length) return false;
  return timingSafeEqual(hash, stored_hash);
}

export class LocalUserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: CreateLocalUserInput): Promise<LocalUser> {
    const hash = await hashPassword(input.password);
    const row = await this.db
      .insertInto("local_users")
      .values({
        username: input.username,
        email: input.email ?? null,
        display_name: input.displayName ?? input.username,
        password_hash: hash,
        workspace_id: input.workspaceId ?? "default",
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toUser(row);
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    const row = await this.db
      .selectFrom("local_users")
      .selectAll()
      .where("username", "=", username)
      .executeTakeFirst();
    return row ? this.toUser(row) : null;
  }

  async verify(username: string, password: string): Promise<LocalUser | null> {
    const row = await this.db
      .selectFrom("local_users")
      .selectAll()
      .where("username", "=", username)
      .where("enabled", "=", true)
      .executeTakeFirst();
    if (!row) return null;
    const ok = await verifyPassword(password, row.password_hash);
    return ok ? this.toUser(row) : null;
  }

  async list(workspaceId?: string): Promise<LocalUser[]> {
    let q = this.db.selectFrom("local_users").selectAll();
    if (workspaceId) q = q.where("workspace_id", "=", workspaceId);
    const rows = await q.orderBy("created_at", "asc").execute();
    return rows.map((r) => this.toUser(r));
  }

  async count(): Promise<number> {
    const row = await this.db
      .selectFrom("local_users")
      .select(({ fn }) => fn.count<string>("id").as("n"))
      .where("enabled", "=", true)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async setPassword(id: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.db
      .updateTable("local_users")
      .set({ password_hash: hash, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("local_users").where("id", "=", id).execute();
  }

  private toUser(row: {
    id: string;
    username: string;
    email: string | null;
    display_name: string;
    workspace_id: string;
    enabled: boolean;
    created_at: Date;
  }): LocalUser {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      workspaceId: row.workspace_id,
      enabled: row.enabled,
      createdAt: row.created_at,
    };
  }
}
