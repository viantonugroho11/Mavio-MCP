import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mavio-MCP Console",
  description: "MCP registry, router, playground, inspector.",
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen flex flex-col">
          <Nav />
          <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
            {children}
          </main>
          <footer className="border-t border-rule px-6 py-4">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <span className="text-xs text-subtle">Mavio·MCP Console</span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-bronze">v0.1.0-mvp</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
