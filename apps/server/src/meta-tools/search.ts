import type { ToolEffect } from "../tool-effect.js";

export interface SearchableTool {
  /** Fully-qualified name, `serverId.toolName`. */
  name: string;
  server: string;
  description: string;
  effect: ToolEffect;
}

export interface SearchHit extends SearchableTool {
  score: number;
}

export interface SearchOptions {
  limit?: number;
  server?: string;
}

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "from", "with", "by",
  "at", "as", "is", "are", "be", "it", "its", "this", "that", "my", "me", "i", "some",
  "all", "any", "into", "via", "please", "want", "need", "can", "how", "do",
]);

const PHRASES: Array<[RegExp, string]> = [
  [/\bpull[\s_-]*requests?\b/g, "pr"],
  [/\bmerge[\s_-]*requests?\b/g, "mr"],
];

// Unstemmed; stemmed once at module load so both sides of a match agree.
const RAW_SYNONYMS: Record<string, string[]> = {
  ticket: ["issue"],
  bug: ["issue"],
  open: ["create"],
  new: ["create"],
  add: ["create"],
  make: ["create"],
  remove: ["delete"],
  fetch: ["get"],
  read: ["get"],
  show: ["get"],
  find: ["search"],
  lookup: ["search"],
  query: ["search"],
  mail: ["email"],
  email: ["mail"],
  repo: ["repository"],
  repository: ["repo"],
  doc: ["document"],
  document: ["doc"],
  edit: ["update"],
  modify: ["update"],
  change: ["update"],
};

const FIELD_WEIGHT = { name: 3, server: 2, description: 1 } as const;
const MATCH_EXACT = 1.0;
const MATCH_SYNONYM = 0.8;
const MATCH_PREFIX = 0.7;
const TYPO_DISCOUNT = 0.8;
const EXACT_NAME_BONUS = 1000;

export function stem(word: string): string {
  let w = word;
  if (w.length > 4) {
    if (w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.endsWith("es")) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  } else if (w.length >= 3 && w.endsWith("s") && !w.endsWith("ss")) {
    w = w.slice(0, -1);
  }
  return w;
}

export function tokenize(text: string): string[] {
  let t = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  for (const [re, short] of PHRASES) t = t.replace(re, short);
  return t
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .map(stem);
}

const SYNONYMS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const [k, vs] of Object.entries(RAW_SYNONYMS)) {
    const key = stem(k);
    const set = m.get(key) ?? new Set<string>();
    for (const v of vs) set.add(stem(v));
    m.set(key, set);
  }
  return m;
})();

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
export function osaDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array<number>(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = v;
    }
  }
  return d[n]![m]!;
}

interface IndexedTool {
  tool: SearchableTool;
  bareName: string;
  fields: { name: Set<string>; server: Set<string>; description: Set<string> };
}

export class ToolSearchIndex {
  private readonly tools: IndexedTool[];
  private readonly docFreq = new Map<string, number>();

  constructor(tools: SearchableTool[]) {
    this.tools = tools.map((tool) => {
      const dot = tool.name.indexOf(".");
      const bareName = dot >= 0 ? tool.name.slice(dot + 1) : tool.name;
      return {
        tool,
        bareName,
        fields: {
          name: new Set(tokenize(bareName)),
          server: new Set(tokenize(tool.server)),
          description: new Set(tokenize(tool.description)),
        },
      };
    });
    for (const t of this.tools) {
      const words = new Set([...t.fields.name, ...t.fields.server, ...t.fields.description]);
      for (const w of words) this.docFreq.set(w, (this.docFreq.get(w) ?? 0) + 1);
    }
  }

  get size(): number {
    return this.tools.length;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? DEFAULT_SEARCH_LIMIT)), MAX_SEARCH_LIMIT);
    const queryWords = [...new Set(tokenize(query))];
    const normalizedQuery = query.trim().toLowerCase();
    if (queryWords.length === 0 && !normalizedQuery) return [];

    const expanded = queryWords.map((q) => this.expand(q));
    const hits: SearchHit[] = [];
    for (const t of this.tools) {
      if (options.server && t.tool.server !== options.server) continue;
      let total = 0;
      let matched = 0;
      for (const candidates of expanded) {
        let best = 0;
        for (const { word, discount } of candidates) {
          const s = this.scoreWord(word, t) * discount;
          if (s > best) best = s;
        }
        if (best > 0) {
          total += best;
          matched++;
        }
      }
      const exact =
        normalizedQuery === t.tool.name.toLowerCase() || normalizedQuery === t.bareName.toLowerCase();
      if (total === 0 && !exact) continue;
      const coverage = queryWords.length > 0 ? matched / queryWords.length : 1;
      const score = total * coverage + (exact ? EXACT_NAME_BONUS : 0);
      hits.push({ ...t.tool, score: Math.round(score * 100) / 100 });
    }
    hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return hits.slice(0, limit);
  }

  /** A query word plus, if no tool knows it, its nearest known spellings. */
  private expand(q: string): Array<{ word: string; discount: number }> {
    if (this.isKnown(q)) return [{ word: q, discount: 1 }];
    const maxEdits = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
    if (maxEdits === 0) return [{ word: q, discount: 1 }];
    const corrections: Array<{ word: string; df: number }> = [];
    for (const [w, df] of this.docFreq) {
      if (Math.abs(w.length - q.length) > maxEdits) continue;
      if (osaDistance(q, w) <= maxEdits) corrections.push({ word: w, df });
    }
    for (const [syn] of SYNONYMS) {
      if (this.docFreq.has(syn)) continue;
      if (Math.abs(syn.length - q.length) <= maxEdits && osaDistance(q, syn) <= maxEdits) {
        corrections.push({ word: syn, df: 0 });
      }
    }
    corrections.sort((a, b) => b.df - a.df || a.word.localeCompare(b.word));
    const top = corrections.slice(0, 2).map((c) => ({ word: c.word, discount: TYPO_DISCOUNT }));
    return top.length > 0 ? top : [{ word: q, discount: 1 }];
  }

  private isKnown(q: string): boolean {
    if (this.docFreq.has(q) || SYNONYMS.has(q)) return true;
    if (q.length >= 3) {
      for (const w of this.docFreq.keys()) if (w.startsWith(q)) return true;
    }
    return false;
  }

  private idf(word: string): number {
    const df = this.docFreq.get(word) ?? 0;
    return Math.log(1 + this.tools.length / Math.max(1, df));
  }

  private scoreWord(q: string, t: IndexedTool): number {
    const synonyms = SYNONYMS.get(q);
    let best = 0;
    for (const field of ["name", "server", "description"] as const) {
      const weight = FIELD_WEIGHT[field];
      for (const w of t.fields[field]) {
        let strength = 0;
        if (w === q) strength = MATCH_EXACT;
        else if (synonyms?.has(w)) strength = MATCH_SYNONYM;
        else if (q.length >= 3 && w.startsWith(q)) strength = MATCH_PREFIX;
        if (strength === 0) continue;
        const s = weight * strength * this.idf(w);
        if (s > best) best = s;
      }
    }
    return best;
  }
}
