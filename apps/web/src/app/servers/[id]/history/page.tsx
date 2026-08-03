"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { diffSnapshots, listSnapshots, type CapabilityDiff, type Snapshot } from "@/lib/api";

export default function SnapshotHistory({ params }: { params: Promise<{ id: string }> }): JSX.Element {
  const { id } = use(params);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [diff, setDiff] = useState<CapabilityDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSnapshots(id).then(setSnaps).catch((e) => setError(String(e)));
  }, [id]);

  useEffect(() => {
    if (snaps.length >= 2) {
      setA(snaps[0]?.id ?? "");
      setB(snaps[1]?.id ?? "");
    }
  }, [snaps]);

  const compare = async (): Promise<void> => {
    if (!a || !b) return;
    setError(null);
    try {
      setDiff(await diffSnapshots(id, a, b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <Link
        href={`/servers/${encodeURIComponent(id)}`}
        className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink"
      >
        ← Server
      </Link>
      <h1 className="font-display text-4xl italic mt-4">Capability history · {id}</h1>

      {error && <div className="mt-4 border border-rule bg-panel px-4 py-3 text-sm font-mono text-muted">{error}</div>}

      <div className="grid grid-cols-2 gap-4 mt-6">
        <SnapshotSelect label="A (before)" value={a} setValue={setA} snaps={snaps} />
        <SnapshotSelect label="B (after)" value={b} setValue={setB} snaps={snaps} />
      </div>

      <button
        onClick={compare}
        disabled={!a || !b}
        className="mt-4 bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40"
      >
        Diff
      </button>

      {diff && (
        <div className="mt-8 grid grid-cols-3 gap-4">
          <DiffColumn title="Added" tone="emerald" items={diff.added} />
          <DiffColumn title="Changed" tone="amber" items={diff.changed} />
          <DiffColumn title="Removed" tone="rose" items={diff.removed} />
        </div>
      )}

      {diff && (
        <p className="mt-4 text-sm text-muted font-mono">unchanged: {diff.unchanged}</p>
      )}
    </section>
  );
}

function SnapshotSelect({
  label,
  value,
  setValue,
  snaps,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  snaps: Snapshot[];
}): JSX.Element {
  return (
    <label className="block">
      <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
      >
        <option value="">— choose —</option>
        {snaps.map((s) => (
          <option key={s.id} value={s.id}>
            {new Date(s.takenAt).toISOString()} · {s.version}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffColumn({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "emerald" | "amber" | "rose";
  items: Array<{ name: string }>;
}): JSX.Element {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <div>
      <h3 className={`font-mono text-xs uppercase tracking-widest ${color} mb-2`}>
        {title} ({items.length})
      </h3>
      <ul className="border border-rule bg-panel divide-y divide-rule">
        {items.length === 0 && <li className="px-3 py-2 text-xs text-muted font-mono">none</li>}
        {items.map((i) => (
          <li key={i.name} className="px-3 py-2 text-xs font-mono">
            {i.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
