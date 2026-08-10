import type { Redis } from "ioredis";

export interface NotificationEnvelope {
  /** JSON-RPC method, e.g. "notifications/tools/list_changed". */
  method: string;
  /** JSON-RPC params — free-form per notification kind. */
  params?: unknown;
  /** Node id that produced the event (for dedupe on multi-region). */
  origin?: string;
  /** Publish timestamp (ms epoch). */
  ts?: number;
}

export interface NotificationRecord {
  /** Redis stream id, format `<ms>-<seq>`. Client resumes with this. */
  id: string;
  envelope: NotificationEnvelope;
}

/**
 * Redis-Streams-backed notification bus (ADR-022 M3 egress).
 *
 * One global stream carries every MCP notification the router wants to
 * broadcast. Consumers (SSE/WS handlers) call `readFrom(lastId)` in a loop
 * with `BLOCK`, translating each record to an SSE frame with `id:` = stream
 * id so the browser's automatic reconnect sends `Last-Event-ID` back.
 *
 * Bounded via MAXLEN ~ N so the stream cannot grow unbounded when no
 * consumer is subscribed — old notifications drop off after the window.
 * Callers that reconnect after the window has rolled see `$` (tail).
 */
const STREAM_KEY = "mavio:notify:stream";
const DEFAULT_MAXLEN = 10_000;
const DEFAULT_BLOCK_MS = 15_000;

export class NotificationBus {
  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
    private readonly origin: string,
    private readonly maxLen: number = DEFAULT_MAXLEN,
  ) {}

  async publish(envelope: Omit<NotificationEnvelope, "origin" | "ts">): Promise<string> {
    const payload: NotificationEnvelope = {
      ...envelope,
      origin: this.origin,
      ts: Date.now(),
    };
    const id = await this.publisher.xadd(
      STREAM_KEY,
      "MAXLEN",
      "~",
      String(this.maxLen),
      "*",
      "e",
      JSON.stringify(payload),
    );
    return id ?? "";
  }

  /**
   * Return the newest stream id so a fresh subscriber can start at the tail
   * without replaying history. Empty string when the stream has no entries.
   */
  async tailId(): Promise<string> {
    const rows = (await this.publisher.xrevrange(STREAM_KEY, "+", "-", "COUNT", 1)) as Array<
      [string, string[]]
    >;
    return rows[0]?.[0] ?? "0-0";
  }

  /**
   * Block-read up to `count` records strictly after `lastId`.
   * Returns [] when BLOCK expires with no new data — call again.
   */
  async readFrom(
    lastId: string,
    count = 100,
    blockMs = DEFAULT_BLOCK_MS,
  ): Promise<NotificationRecord[]> {
    const raw = (await this.subscriber.xread(
      "COUNT",
      count,
      "BLOCK",
      blockMs,
      "STREAMS",
      STREAM_KEY,
      lastId,
    )) as Array<[string, Array<[string, string[]]>]> | null;
    if (!raw || raw.length === 0) return [];
    const records: NotificationRecord[] = [];
    for (const [, entries] of raw) {
      for (const [id, fields] of entries) {
        const idx = fields.indexOf("e");
        if (idx < 0 || idx + 1 >= fields.length) continue;
        try {
          const envelope = JSON.parse(fields[idx + 1]!) as NotificationEnvelope;
          records.push({ id, envelope });
        } catch {
          // skip malformed
        }
      }
    }
    return records;
  }
}
