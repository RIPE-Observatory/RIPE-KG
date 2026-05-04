import { Suspense } from "react";
import { fetchSearchStats } from "@/lib/sparql-server";
import { SearchPanel } from "@/components/search-panel";

export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  const statsResult = await fetchSearchStats()
    .then((stats) => ({ stats, error: "" }))
    .catch(() => ({
      stats: { assessments: 0, publications: 0, authors: 0, evidence: 0 },
      error: "The RIPE-KG SPARQL endpoint is unavailable.",
    }));
  const { stats, error } = statsResult;

  return (
    <div className="min-h-screen bg-background">
      <div className="line-draw-horizontal max-w-7xl mx-auto" />

      <div className="max-w-7xl mx-auto px-4 md:px-8 pt-20 pb-32">
        <section
          className="mb-14 border border-amber-600 bg-background p-5 md:p-6 animate-fade-in-delay-1"
          aria-labelledby="disclaimer-heading"
        >
          <h2
            id="disclaimer-heading"
            className="font-source text-sm font-semibold uppercase tracking-wider text-stone-900 mb-3"
          >
            Disclaimer
          </h2>
          <div className="space-y-3 font-source text-sm leading-relaxed text-stone-600 md:text-base">
            <p>
              This knowledge graph resource is the result of an ongoing research
              project. While every effort has been made to ensure the accuracy,
              consistency, and reliability of the information presented, the data
              contained herein has been contributed by individual contributors and
              external sources. The content reflects the views and contributions
              of individual authors and does not necessarily represent the views,
              policies, or positions of the hosting organization or its
              affiliates.
            </p>
            <p>
              The RIPE Observatory does not guarantee the completeness,
              correctness, or timeliness of the information provided and accepts
              no responsibility or liability for any errors, omissions, or
              inaccuracies. Users are advised to independently verify any
              information before relying on it for research, decision-making, or
              other purposes.
            </p>
          </div>
        </section>

        {error && <GraphStatus />}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-8">
          <div className="md:col-span-2">
            <h1 className="font-libre text-3xl md:text-5xl leading-[1.18] text-stone-900 mb-5 text-balance animate-fade-in-delay-2">
              Tracing scientific integrity
              <br />
              <span className="italic text-amber-700">
                through provenance &amp; evidence
              </span>
            </h1>
            <p className="font-source text-lg text-stone-600 max-w-2xl leading-relaxed text-pretty animate-fade-in-delay-3">
              A knowledge graph connecting assessments to publications, authors, and evidence.
            </p>
            <div className="mt-8 animate-fade-in-delay-4">
              <span className="inline-flex items-center gap-2.5">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
                </span>
                <span className="font-source text-base text-stone-600">
                  <span className="font-semibold text-stone-800">
                    {stats.assessments.toLocaleString()}
                  </span>{" "}
                  integrity assessments indexed
                </span>
              </span>
            </div>
          </div>

          <div className="relative animate-fade-in-delay-5">
            <div className="line-draw-vertical absolute left-0 top-0 h-full min-h-48" />
            <div className="pl-8">
              <h2 className="font-source text-sm font-semibold uppercase tracking-wider text-stone-600 mb-4">Coverage</h2>
              <dl className="space-y-4">
                <StatItem label="Publications" value={stats.publications} />
                <StatItem label="Authors" value={stats.authors} />
                <StatItem label="Evidence items" value={stats.evidence} />
              </dl>
            </div>
          </div>
        </div>

        <Suspense>
          <SearchPanel />
        </Suspense>

      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="font-libre text-2xl text-stone-900">
        {value.toLocaleString()}
      </dd>
      <dt className="font-source text-sm text-stone-600">{label}</dt>
    </div>
  );
}

function GraphStatus() {
  return (
    <section
      aria-label="Knowledge graph status"
      className="mb-8 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
    >
      <p className="font-semibold">The RIPE-KG SPARQL endpoint is not available.</p>
      <p className="mt-1">The graph service may still be starting or may need administrator attention.</p>
    </section>
  );
}
