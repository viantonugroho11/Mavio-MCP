"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importOpenApi } from "@/lib/api";

export default function ImportsPage(): JSX.Element {
  const router = useRouter();
  const [id, setId] = useState("");
  const [url, setUrl] = useState("https://petstore3.swagger.io/api/v3/openapi.json");
  const [baseUrl, setBaseUrl] = useState("");
  const [workspace, setWorkspace] = useState("default");
  const [project, setProject] = useState("sandbox");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setOk(null);
    setPending(true);
    try {
      const res = await importOpenApi({
        id,
        workspaceId: workspace,
        projectId: project,
        url: url || undefined,
        baseUrl: baseUrl || undefined,
      });
      setOk(`Imported — ${res.toolCount} tools`);
      setTimeout(() => router.push(`/servers/${encodeURIComponent(id)}`), 600);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <h1 className="font-display text-4xl italic mb-6">Import OpenAPI</h1>

      <form onSubmit={submit} className="grid grid-cols-2 gap-4 max-w-2xl">
        <Field label="Server ID">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            placeholder="petstore"
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          />
        </Field>
        <Field label="Workspace">
          <input
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          />
        </Field>
        <Field label="Project">
          <input
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          />
        </Field>
        <Field label="OpenAPI URL" span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          />
        </Field>
        <Field label="Base URL (override)" span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="only if spec has no servers[]"
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          />
        </Field>

        <div className="col-span-2 flex items-center gap-4">
          <button
            type="submit"
            disabled={pending}
            className="bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40"
          >
            {pending ? "Importing…" : "Import"}
          </button>
          {ok && <span className="text-sm text-accent font-mono">{ok}</span>}
          {error && <span className="text-sm text-red-700 font-mono">{error}</span>}
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  span,
  children,
}: {
  label: string;
  span?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
