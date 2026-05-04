"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMutation } from "@tanstack/react-query";
import { COMPETENCY_QUESTIONS, DEFAULT_QUERY, executeSparqlQuery, type SparqlResults, type SparqlBinding } from "@/lib/sparql";
import { RIPE_KG_BASE, RIPE_ONTOLOGY_BASE, isLocalHref, localHrefForIri } from "@/lib/iri";
import { cleanDisplayText } from "@/components/shared";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export default function SparqlPage() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [resultsView, setResultsView] = useState<"table" | "json">("table");

  const {
    mutate: runQuery,
    data: results,
    isPending,
    error,
  } = useMutation({
    mutationFn: (sparqlQuery: string) => executeSparqlQuery(sparqlQuery),
  });

  const handleRunQuery = () => runQuery(query);

  const handleSelectQuery = (name: string, q: string) => {
    setQuery(q);
    setActiveQuery(name);
  };

  const handleCopyResults = () => {
    if (results) navigator.clipboard.writeText(JSON.stringify(results, null, 2));
  };

  const handleDownloadCsv = () => {
    if (!results?.results?.bindings?.length) return;
    const headers = results.head.vars;
    const rows = results.results.bindings.map((binding) =>
      headers.map((h) => `"${(binding[h]?.value || "").replace(/"/g, '""')}"`).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sparql-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-[calc(100vh-57px)] flex overflow-hidden">
      <aside className="w-[260px] shrink-0 border-r border-stone-200 bg-stone-50/50 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200">
          <h2 className="font-source text-sm font-semibold text-stone-700 uppercase tracking-wider">
            Competency questions
          </h2>
          <p className="font-source text-sm text-stone-500 mt-0.5">Click to load into editor</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Competency question queries">
          {COMPETENCY_QUESTIONS.map((q) => {
            const label = `${q.id}: ${q.title}`;
            return (
              <button
                type="button"
                key={q.id}
                onClick={() => handleSelectQuery(label, q.query)}
                className={`w-full text-left px-5 py-1.5 font-source text-sm leading-snug transition-colors ${
                  activeQuery === label
                    ? "text-amber-900 bg-amber-50 font-medium border-l-2 border-amber-600"
                    : "text-stone-700 hover:bg-stone-100 hover:text-stone-900 border-l-2 border-transparent"
                }`}
              >
                <span className="font-semibold">{q.id}</span>: {q.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 bg-white">
          <div>
            <h1 className="font-libre text-xl text-stone-900">SPARQL</h1>
          </div>
          <button
            type="button"
            onClick={handleRunQuery}
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-stone-900 rounded-lg hover:bg-stone-800 disabled:opacity-50 transition-colors"
          >
            <svg className="size-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            {isPending ? "Running\u2026" : "Run Query"}
          </button>
        </div>

        {/* Editor + Results panels */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 overflow-hidden">
          {/* Editor panel */}
          <div className="flex flex-col border-r border-stone-200 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <span className="font-source text-sm font-semibold text-stone-700 uppercase tracking-wider">
                Query
              </span>
              {activeQuery && (
                <span className="font-source text-sm text-stone-500 truncate ml-3">
                  {activeQuery}
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              <MonacoEditor
                height="100%"
                language="sparql"
                value={query}
                onChange={(value) => {
                  setQuery(value || "");
                  setActiveQuery(null);
                }}
                theme="vs"
                options={{
                  minimap: { enabled: false },
                  fontFamily: "'JetBrains Mono', var(--font-jetbrains-mono), monospace",
                  fontSize: 14,
                  fontLigatures: true,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  padding: { top: 12, bottom: 12 },
                  renderLineHighlight: "line",
                  lineHeight: 22,
                  cursorBlinking: "smooth",
                }}
              />
            </div>
          </div>

          {/* Results panel */}
          <div className="flex flex-col overflow-hidden">
            <div className="px-5 py-2.5 border-b border-stone-200 bg-stone-50 flex items-center justify-between">
              <div className="flex items-baseline gap-2">
                <span className="font-source text-sm font-semibold text-stone-700 uppercase tracking-wider">
                  Results
                </span>
                {results?.results?.bindings && (
                  <span className="font-source text-sm text-stone-500 tabular-nums">
                    {results.results.bindings.length} rows
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* View tabs */}
                <div className="flex items-center bg-stone-200/80 rounded p-0.5">
                  <button
                    type="button"
                    onClick={() => setResultsView("table")}
                    className={`font-source text-sm px-2.5 py-1 rounded transition-colors ${
                      resultsView === "table"
                        ? "font-semibold text-stone-900 bg-white shadow-sm"
                        : "text-stone-600 hover:text-stone-800"
                    }`}
                  >
                    Table
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultsView("json")}
                    className={`font-source text-sm px-2.5 py-1 rounded transition-colors ${
                      resultsView === "json"
                        ? "font-semibold text-stone-900 bg-white shadow-sm"
                        : "text-stone-600 hover:text-stone-800"
                    }`}
                  >
                    JSON
                  </button>
                </div>

                {/* Copy */}
                <button
                  type="button"
                  onClick={handleCopyResults}
                  className="p-1.5 text-stone-500 hover:text-stone-700 transition-colors"
                  title="Copy results"
                  aria-label="Copy results"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" strokeWidth={2} />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth={2} />
                  </svg>
                </button>

                {/* Download CSV */}
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="p-1.5 text-stone-500 hover:text-stone-700 transition-colors"
                  title="Download CSV"
                  aria-label="Download CSV"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Results content */}
            <div className="flex-1 overflow-auto min-h-0">
              {error ? (
                <div className="p-5">
                  <p className="font-source text-sm font-semibold text-red-800 uppercase tracking-wider mb-2">Error</p>
                  <pre className="font-mono text-sm text-red-700 whitespace-pre-wrap">{(error as Error).message}</pre>
                </div>
              ) : results ? (
                resultsView === "table" ? (
                  <ResultsTable results={results} />
                ) : (
                  <pre className="p-5 text-sm text-stone-800 font-mono leading-relaxed">
                    {JSON.stringify(results, null, 2)}
                  </pre>
                )
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="font-source text-base text-stone-500">Run a query to see results</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ResultsTable({ results }: { results: SparqlResults }) {
  const headers = results.head.vars;
  const bindings = results.results.bindings;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="border-b-2 border-stone-300 bg-stone-50">
            {headers.map((h) => (
              <th key={h} className="text-sm font-semibold text-stone-700 text-left px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <ResultsBody bindings={bindings} headers={headers} />
      </table>
    </div>
  );
}

function shortenUri(uri: string): string {
  const prefixes: [string, string][] = [
    [RIPE_ONTOLOGY_BASE, "ripe:"],
    [RIPE_KG_BASE, "ripekg:"],
    ["https://w3id.org/tido#", "tido:"],
    ["http://www.w3.org/ns/prov#", "prov:"],
    ["http://purl.org/dc/terms/", "dcterms:"],
    ["http://prismstandard.org/namespaces/basic/3.0/", "prism:"],
    ["http://xmlns.com/foaf/0.1/", "foaf:"],
    ["http://purl.org/spar/cito/", "cito:"],
    ["http://dbpedia.org/ontology/", "dbo:"],
    ["http://purl.org/spar/fabio/", "fabio:"],
    ["http://www.w3.org/2001/XMLSchema#", "xsd:"],
  ];
  for (const [ns, pfx] of prefixes) {
    if (uri.startsWith(ns)) return pfx + uri.slice(ns.length);
  }
  const last = uri.split(/[#/]/).pop();
  return last || uri;
}

const INITIAL_ROWS = 200;
const LOAD_MORE_ROWS = 200;

function ResultsBody({ bindings, headers }: { bindings: SparqlBinding[]; headers: string[] }) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_ROWS);
  const visible = bindings.slice(0, visibleCount);
  const hasMore = visibleCount < bindings.length;

  return (
    <tbody>
      {visible.map((binding, idx) => (
        <tr key={idx} className="border-b transition-colors hover:bg-muted/50">
          {headers.map((h) => (
            <td key={h} className="px-3 py-2 text-sm max-w-[400px]">
              {binding[h]?.value ? (
                binding[h].type === "uri" ? (
                  <UriResultLink uri={binding[h].value} />
                ) : (
                  <span className="text-stone-800 truncate block" title={cleanDisplayText(binding[h].value)}>
                    {cleanDisplayText(binding[h].value)}
                  </span>
                )
              ) : (
                <span className="text-stone-500 italic">N/A</span>
              )}
            </td>
          ))}
        </tr>
      ))}
      {hasMore && (
        <tr>
          <td colSpan={headers.length} className="px-3 py-3 text-center">
            <button
              type="button"
              onClick={() => setVisibleCount((c) => c + LOAD_MORE_ROWS)}
              className="font-source text-sm font-medium text-amber-800 hover:text-amber-900"
            >
              Show {Math.min(LOAD_MORE_ROWS, bindings.length - visibleCount)} more rows ({bindings.length - visibleCount} remaining)
            </button>
          </td>
        </tr>
      )}
    </tbody>
  );
}

function UriResultLink({ uri }: { uri: string }) {
  const href = localHrefForIri(uri);
  const local = isLocalHref(href);
  return (
    <a
      href={href}
      target={local ? undefined : "_blank"}
      rel={local ? undefined : "noopener noreferrer"}
      className="hover-link text-amber-800 font-medium truncate block"
      title={uri}
    >
      {shortenUri(uri)}
    </a>
  );
}
