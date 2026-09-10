"use client";

import { useState } from "react";
import Link, { useKgVersion } from "@/components/version-link";
import { RELEASES, releasePath, stripReleasePath } from "@/lib/versions";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/explore", label: "Explore" },
  { href: "/sparql", label: "SPARQL" },
  { href: "/ontology", label: "Ontology" },
];

export function Navigation() {
  const currentPath = stripReleasePath(usePathname());
  const pathname = currentPath === "/" ? "/explore" : currentPath;
  const version = useKgVersion();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full bg-background border-b-0">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-libre text-base sm:text-lg">
          <img src="/brand/ripe-kg.svg" alt="" width={32} height={32} className="size-7 shrink-0 sm:size-8" />
          <span>
            <span className="text-stone-900">RIPE</span>{" "}
            <span className="text-amber-700">Knowledge Graph</span>
          </span>
        </Link>

        <label className="text-sm text-stone-600 flex items-center gap-2">
          <span className="hidden sm:inline">Version</span>
          <select aria-label="Knowledge graph version" value={version} className="bg-transparent border border-stone-300 rounded px-2 py-1"
            onChange={(event) => {
              const selected = event.target.value as keyof typeof RELEASES;
              // A full navigation also clears pending workbench results and client caches.
              window.location.assign(releasePath(selected, pathname === "/" ? "/explore" : pathname));
            }}>
            {Object.keys(RELEASES).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "font-source text-sm font-medium transition-colors relative pb-1",
                  isActive
                    ? "text-stone-900 border-b-2 border-amber-600"
                    : "text-stone-600 hover:text-stone-900"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Hamburger button */}
        <button
          type="button"
          className="md:hidden p-2"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-label="Toggle navigation menu"
        >
          <svg className="h-6 w-6 text-stone-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-stone-200 bg-background px-4 py-4 space-y-3">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "block font-source text-sm font-medium transition-colors py-1",
                  isActive
                    ? "text-stone-900 border-l-2 border-amber-600 pl-3"
                    : "text-stone-600 hover:text-stone-900 pl-3"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
