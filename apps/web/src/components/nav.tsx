"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchMe, logout, type Me } from "@/lib/api";

const NAV_LINKS = [
  { href: "/", label: "Servers", match: (p: string) => p === "/" || p.startsWith("/servers") },
  { href: "/playground", label: "Playground", match: (p: string) => p.startsWith("/playground") },
  { href: "/imports", label: "Imports", match: (p: string) => p.startsWith("/imports") },
];

export function Nav(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname();

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
    <header className="sticky top-0 z-30 bg-ground/90 backdrop-blur-sm border-b border-rule">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1.5 shrink-0">
          <span className="font-display text-xl italic tracking-tight text-ink">
            Mavio<span className="text-bronze">·</span>MCP
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={href}
                href={href}
                className={`
                  px-3 py-1.5 rounded text-sm font-medium transition-colors
                  ${active
                    ? "bg-accent-muted text-accent"
                    : "text-muted hover:text-ink hover:bg-panel"
                  }
                `}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          {loaded && me ? (
            <>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-accent-muted flex items-center justify-center text-[10px] font-semibold text-accent uppercase">
                  {(me.displayName ?? me.email ?? "?")[0]}
                </div>
                <span className="text-sm text-muted hidden sm:block">
                  {me.displayName ?? me.email ?? me.principal.id}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs px-2.5 py-1 rounded border border-rule text-muted hover:text-ink hover:border-ink/30 transition-colors"
              >
                Sign out
              </button>
            </>
          ) : loaded ? (
            <Link
              href="/login"
              className="text-xs px-3 py-1.5 rounded bg-accent text-white font-medium hover:bg-accent-hover transition-colors"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
