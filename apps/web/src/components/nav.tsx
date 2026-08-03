"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchMe, logout, type Me } from "@/lib/api";

export function Nav(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoaded(true));
  }, []);

  async function handleLogout(): Promise<void> {
    await logout();
    setMe(null);
    window.location.href = "/login";
  }

  return (
    <header className="border-b border-rule">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-baseline gap-8">
        <Link href="/" className="font-display text-2xl italic tracking-tight">
          Mavio<span className="text-bronze">·</span>MCP
        </Link>
        <nav className="flex gap-6 text-sm text-muted">
          <Link href="/" className="hover:text-ink">Servers</Link>
          <Link href="/playground" className="hover:text-ink">Playground</Link>
          <Link href="/imports" className="hover:text-ink">Imports</Link>
        </nav>
        <div className="ml-auto flex items-center gap-4">
          {loaded && me ? (
            <>
              <span className="text-xs text-muted">
                {me.displayName ?? me.email ?? me.principal.id}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-muted hover:text-ink underline"
              >
                Sign out
              </button>
            </>
          ) : loaded ? (
            <Link href="/login" className="text-xs text-muted hover:text-ink underline">
              Sign in
            </Link>
          ) : null}
          <span className="font-mono text-[10px] uppercase tracking-widest text-bronze">
            v0.1.0-mvp
          </span>
        </div>
      </div>
    </header>
  );
}
