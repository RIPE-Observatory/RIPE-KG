"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  searchPublications,
  searchAuthors,
  type PublicationSearchResult,
  type AuthorSearchResult,
} from "@/lib/sparql-kg";
import { queryKeys } from "@/lib/query-keys";
import { cleanDisplayText } from "@/components/shared";

type SearchMode = "publications" | "authors";

export function SearchPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialQuery = searchParams.get("q") ?? "";
  const modeParam = searchParams.get("mode");
  const initialMode: SearchMode =
    modeParam === "authors" ? "authors" : "publications";

  const [searchInput, setSearchInput] = useState(initialQuery);
  const debouncedTerm = useDebounce(searchInput, 300);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialMode);
  const [searchFocused, setSearchFocused] = useState(false);

  const updateUrl = useCallback(
    (q: string, mode: SearchMode) => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (mode !== "publications") params.set("mode", mode);
      const qs = params.toString();
      router.replace(qs ? `/explore?${qs}` : "/explore", { scroll: false });
    },
    [router]
  );

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    updateUrl(value, searchMode);
  };

  const handleModeChange = (mode: SearchMode) => {
    setSearchMode(mode);
    updateUrl(searchInput, mode);
  };

  const pubQuery = useQuery({
    queryKey: queryKeys.publications.search(debouncedTerm),
    queryFn: () => searchPublications(debouncedTerm),
    enabled: debouncedTerm.length >= 2 && searchMode === "publications",
  });

  const authorQuery = useQuery({
    queryKey: queryKeys.authors.search(debouncedTerm),
    queryFn: () => searchAuthors(debouncedTerm),
    enabled: debouncedTerm.length >= 2 && searchMode === "authors",
  });

  const isSearching = debouncedTerm.length >= 2;
  const isLoading =
    (searchMode === "publications" && pubQuery.isFetching) ||
    (searchMode === "authors" && authorQuery.isFetching);
  const publications = pubQuery.data ?? [];
  const authors = authorQuery.data ?? [];

  const resultCount =
    searchMode === "publications" ? publications.length : authors.length;
  const activeError =
    searchMode === "publications" ? pubQuery.error : authorQuery.error;

  return (
    <div className="animate-fade-in-delay-4">
      <div role="search" aria-label="Search publications and authors">
        <div
          className={`flex items-center bg-background transition-shadow duration-200 ${
            searchFocused
              ? "ring-2 ring-stone-800 ring-offset-2 shadow-lg"
              : "ring-2 ring-stone-400 hover:ring-stone-500"
          }`}
        >
          <div className="pl-4 pr-3">
            <svg aria-hidden="true" className="w-5 h-5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <input
            type="text"
            name="search"
            autoComplete="off"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              searchMode === "publications"
                ? "Search by title, DOI, or keyword\u2026"
                : "Search by author name\u2026"
            }
            aria-label={
              searchMode === "publications"
                ? "Search publications by title, DOI, or keyword"
                : "Search by author name"
            }
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="font-source flex-1 h-12 pr-4 text-base bg-transparent focus:outline-none placeholder:text-stone-500"
          />

          {isLoading && (
            <div className="pr-4" role="status" aria-label="Loading results">
              <div className="h-4 w-4 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin" />
              <span className="sr-only">Loading…</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-6 mt-4">
        <div role="tablist" aria-label="Search category" className="flex items-center gap-6">
          {(["publications", "authors"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              role="tab"
              aria-selected={searchMode === m}
              className={`font-source text-sm pb-1 transition-colors ${
                searchMode === m
                  ? "text-stone-900 font-medium border-b-2 border-amber-600"
                  : "text-stone-500 hover:text-stone-600"
              }`}
            >
              {m === "publications" ? "Publications" : "Authors"}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {!isSearching && (
          <div className="flex items-center gap-3">
            <span className="font-source text-sm font-medium text-stone-600">Try:</span>
            {(searchMode === "publications"
              ? ["vitamin", "selenium", "probiotic"]
              : ["Asemi", "Cooper", "MacLennan"]
            ).map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => handleSearchChange(term)}
                className="hover-link font-source text-sm text-amber-800"
              >
                {term}
              </button>
            ))}
          </div>
        )}

        {isSearching && (
          <button
            type="button"
            onClick={() => handleSearchChange("")}
            className="font-source text-sm font-medium text-stone-600 hover:text-stone-900"
          >
            Clear
          </button>
        )}
      </div>

      <div aria-live="polite" aria-atomic="false">
        {isSearching && !isLoading && (
          <p className="sr-only">
            {resultCount} {searchMode === "publications" ? "publication" : "author"}
            {resultCount !== 1 ? "s" : ""} found
          </p>
        )}
        {isSearching && activeError && !isLoading && (
          <div className="mt-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p className="font-semibold">Search failed.</p>
            <p className="mt-1">{activeError instanceof Error ? activeError.message : "The SPARQL endpoint is unavailable."}</p>
          </div>
        )}
        {isSearching && !activeError && (
          <div className="mt-5 border-t border-stone-200 max-h-[400px] overflow-y-auto">
            {searchMode === "publications" && (
              <>
                {publications.length === 0 && !pubQuery.isFetching && (
                  <p className="font-source text-stone-600 py-8 text-center text-base">
                    No publications found for &ldquo;{debouncedTerm}&rdquo;
                  </p>
                )}
                {publications.map((pub, i) => (
                  <PubResult key={pub.doi} pub={pub} last={i === publications.length - 1} />
                ))}
              </>
            )}
            {searchMode === "authors" && (
              <>
                {authors.length === 0 && !authorQuery.isFetching && (
                  <p className="font-source text-stone-600 py-8 text-center text-base">
                    No authors found for &ldquo;{debouncedTerm}&rdquo;
                  </p>
                )}
                {authors.map((author, i) => (
                  <AuthorResult key={author.authorId} author={author} last={i === authors.length - 1} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PubResult({ pub, last }: { pub: PublicationSearchResult; last: boolean }) {
  return (
    <Link
      href={`/publications/${encodeURIComponent(pub.doi)}`}
      className={`hover-row group flex items-center gap-5 py-4 px-2 ${
        last ? "" : "border-b border-stone-100"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-stone-900 leading-snug line-clamp-2 text-pretty group-hover:text-amber-800 transition-colors">
          {cleanDisplayText(pub.title)}
        </p>
        <p className="text-sm text-stone-600 mt-1">
          {pub.doi}
          {pub.journal && <> &middot; {pub.journal}</>}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-base font-semibold tabular-nums text-stone-900">
          {pub.assessmentCount}
        </div>
        <div className="text-sm text-stone-600">
          {pub.assessmentCount === 1 ? "assessment" : "assessments"}
        </div>
      </div>
    </Link>
  );
}

function AuthorResult({ author, last }: { author: AuthorSearchResult; last: boolean }) {
  return (
    <Link
      href={`/authors/${encodeURIComponent(author.authorId)}`}
      className={`hover-row group flex items-center gap-5 py-4 px-2 ${
        last ? "" : "border-b border-stone-100"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-stone-900 group-hover:text-amber-800 transition-colors">
          {author.name}
        </p>
        <p className="text-sm text-stone-600 mt-1">
          <span className="font-semibold text-stone-700 tabular-nums">{author.pubCount}</span> {author.pubCount === 1 ? "publication" : "publications"}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="text-base font-semibold tabular-nums text-stone-900">
          {author.assessmentCount}
        </div>
        <div className="text-sm text-stone-600">
          {author.assessmentCount === 1 ? "assessment" : "assessments"}
        </div>
      </div>
    </Link>
  );
}
