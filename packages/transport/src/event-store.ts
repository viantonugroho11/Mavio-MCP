/**
 * EventStore — bounded SSE event log for Last-Event-ID replay (ADR-024).
 *
 * ID format: `<streamId>:<seq>` — encodes stream identity and position in one
 * header so a client can resume exactly.
 *
 * The memory implementation is a per-session ring buffer.  The Redis
 * implementation is wired in apps/server via the REDIS_EVENT_STORE symbol and
 * injected into StreamableHttpSessionRegistry.
 */

export interface StoredEvent {
  id: string;       // "<streamId>:<seq>"
  streamId: string;
  seq: number;
  data: string;     // raw SSE chunk text (everything before the trailing \n\n)
  storedAt: number; // epoch ms
}

export interface EventStore {
  /** Append one event; returns its assigned id. */
  append(sessionId: string, streamId: string, data: string): Promise<string>;
  /**
   * Return events after (exclusive) `afterId` for the given session.
   * If `afterId` is undefined, return all retained events.
   * If the position has been trimmed, the returned array carries a sentinel
   * `{ id: "__gap__", streamId: "__gap__", seq: -1, data: "", storedAt: 0 }`
   * as the first element so callers can emit a replay-gap notification.
   */
  readAfter(sessionId: string, afterId: string | undefined): Promise<StoredEvent[]>;
  /** Purge expired / overflow entries.  Called by the registry reaper. */
  trim(sessionId: string): Promise<void>;
  /** Drop all state for a session on DELETE /mcp. */
  deleteSession(sessionId: string): Promise<void>;
}

// ── Sentinel used to signal a replay gap ─────────────────────────────────────
export const GAP_EVENT: StoredEvent = {
  id: "__gap__",
  streamId: "__gap__",
  seq: -1,
  data: "",
  storedAt: 0,
};

export function parseEventId(id: string): { streamId: string; seq: number } | null {
  const sep = id.lastIndexOf(":");
  if (sep === -1) return null;
  const seq = Number(id.slice(sep + 1));
  if (!Number.isFinite(seq) || seq < 0) return null;
  return { streamId: id.slice(0, sep), seq };
}

// ── In-memory implementation ──────────────────────────────────────────────────

export interface MemoryEventStoreOptions {
  /** Max events retained per session.  Default 1 000. */
  maxCount?: number;
  /** Max age in milliseconds.  Default 10 min. */
  maxAgeMs?: number;
  /** Max size of a single event data string in bytes.  Default 256 KiB. */
  maxEventBytes?: number;
}

const STUB_MARKER = "__oversized__";

interface Ring {
  events: StoredEvent[];
  seqCounters: Map<string, number>; // streamId → last seq
  minSeqRetained: Map<string, number>; // streamId → oldest seq in ring
}

export class MemoryEventStore implements EventStore {
  private readonly sessions = new Map<string, Ring>();
  private readonly maxCount: number;
  private readonly maxAgeMs: number;
  private readonly maxEventBytes: number;

  constructor(opts: MemoryEventStoreOptions = {}) {
    this.maxCount = opts.maxCount ?? 1_000;
    this.maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1_000;
    this.maxEventBytes = opts.maxEventBytes ?? 256 * 1_024;
  }

  private getOrCreate(sessionId: string): Ring {
    let ring = this.sessions.get(sessionId);
    if (!ring) {
      ring = { events: [], seqCounters: new Map(), minSeqRetained: new Map() };
      this.sessions.set(sessionId, ring);
    }
    return ring;
  }

  async append(sessionId: string, streamId: string, data: string): Promise<string> {
    const ring = this.getOrCreate(sessionId);
    const seq = (ring.seqCounters.get(streamId) ?? -1) + 1;
    ring.seqCounters.set(streamId, seq);

    const payload =
      Buffer.byteLength(data, "utf8") > this.maxEventBytes
        ? STUB_MARKER
        : data;

    const id = `${streamId}:${seq}`;
    ring.events.push({ id, streamId, seq, data: payload, storedAt: Date.now() });

    // overflow: evict oldest
    while (ring.events.length > this.maxCount) {
      const evicted = ring.events.shift()!;
      const cur = ring.minSeqRetained.get(evicted.streamId);
      if (cur === undefined || evicted.seq >= cur) {
        // next event in ring for this streamId is now the min retained
        const next = ring.events.find((e) => e.streamId === evicted.streamId);
        if (next) {
          ring.minSeqRetained.set(evicted.streamId, next.seq);
        } else {
          ring.minSeqRetained.delete(evicted.streamId);
        }
      }
    }

    return id;
  }

  async readAfter(sessionId: string, afterId: string | undefined): Promise<StoredEvent[]> {
    const ring = this.sessions.get(sessionId);
    if (!ring || ring.events.length === 0) return [];

    if (afterId === undefined) return [...ring.events];

    const parsed = parseEventId(afterId);
    if (!parsed) return [];

    const { streamId, seq } = parsed;
    const minRetained = ring.minSeqRetained.get(streamId);

    // Requested position was trimmed → gap
    if (minRetained !== undefined && seq < minRetained - 1) {
      return [GAP_EVENT, ...ring.events];
    }

    return ring.events.filter(
      (e) => e.streamId === streamId && e.seq > seq,
    );
  }

  async trim(sessionId: string): Promise<void> {
    const ring = this.sessions.get(sessionId);
    if (!ring) return;
    const cutoff = Date.now() - this.maxAgeMs;
    ring.events = ring.events.filter((e) => e.storedAt >= cutoff);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /** Exposed for tests. */
  size(sessionId: string): number {
    return this.sessions.get(sessionId)?.events.length ?? 0;
  }
}
