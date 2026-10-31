"use client";
import { useState } from "react";
import { API_URL } from "@/lib/api";

export function LocalLoginForm({ returnTo }: { returnTo: string }): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`${API_URL}/auth/local/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, returnTo }),
      });
      const json = (await res.json()) as { ok?: boolean; returnTo?: string; message?: string };
      if (!res.ok) {
        setError(json.message ?? "Invalid credentials");
        return;
      }
      window.location.href = json.returnTo ?? "/";
    } catch {
      setError("Network error, try again");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 mt-2">
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-muted px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      )}
      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1">
          Username
        </label>
        <input
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full border border-rule bg-ground px-3 py-2 text-sm rounded focus-visible:ring-2 ring-accent/20 transition-colors hover:border-ink/30"
        />
      </div>
      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-rule bg-ground px-3 py-2 text-sm rounded focus-visible:ring-2 ring-accent/20 transition-colors hover:border-ink/30"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
