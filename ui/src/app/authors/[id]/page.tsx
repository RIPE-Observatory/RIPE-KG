import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchAuthorById,
  fetchAuthorPublications,
  fetchAuthorStats,
} from "@/lib/sparql-server";
import { BackArrow, ExternalLink, ChevronRight, cleanDisplayText } from "@/components/shared";
import { SEMOPENALEX_AUTHOR_BASE, localNameFromIri } from "@/lib/iri";
import type { AuthorPublicationResult } from "@/lib/sparql-types";

function authorTotals(publications: AuthorPublicationResult[]) {
  return publications.reduce(
    (acc, pub) => ({
      serious: acc.serious + pub.outcomes.serious,
      some: acc.some + pub.outcomes.some,
      none: acc.none + pub.outcomes.none,
      na: acc.na + pub.outcomes.na,
      pubsWithSerious: acc.pubsWithSerious + (pub.outcomes.serious > 0 ? 1 : 0),
    }),
    { serious: 0, some: 0, none: 0, na: 0, pubsWithSerious: 0 }
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const authorId = decodeURIComponent(id);
  const profile = await fetchAuthorById(authorId);
  return {
    title: profile ? profile.name : "Author",
  };
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const authorId = decodeURIComponent(id);

  const [profile, publications, stats] = await Promise.all([
    fetchAuthorById(authorId),
    fetchAuthorPublications(authorId),
    fetchAuthorStats(authorId),
  ]);

  if (!profile) notFound();
  const totals = authorTotals(publications);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="animate-page-enter">
        <Link
          href="/explore"
          className="hover-link text-sm text-stone-600 inline-flex items-center gap-1.5 mb-6"
        >
          <BackArrow />
          Back to explore
        </Link>

        <h1 className="font-libre text-2xl text-stone-900 leading-tight text-balance mb-2">
          {profile.name}
        </h1>

        <div className="space-y-1">
          <p className="text-base font-mono text-stone-600">{authorId}</p>
          {profile.sameAs && (
            <ExternalLink
              href={profile.sameAs}
              className="hover-link text-base font-mono text-amber-800 inline-flex items-center gap-1"
            >
              {profile.sameAs.startsWith(SEMOPENALEX_AUTHOR_BASE) ? "SemOpenAlex" : "External identifier"}: {localNameFromIri(profile.sameAs)}
            </ExternalLink>
          )}
        </div>

        <div className="border-t border-stone-200 mt-6 mb-6" />
      </div>

      <div className="animate-page-enter-delay-1 mb-8 flex flex-wrap items-start gap-y-4 divide-x divide-stone-200">
        <div className="pr-10">
          <p className="font-libre text-lg text-stone-900">
            <span className="tabular-nums">{publications.length}</span> Publications
          </p>
          <p className="text-base text-stone-900 mt-1">
            <span className="font-semibold tabular-nums text-red-700">{totals.pubsWithSerious}</span> with at least 1 overall serious concern assessment
          </p>
        </div>
        <div className="pl-10">
          <p className="font-libre text-lg text-stone-900">
            <span className="tabular-nums">{stats.assessments}</span> Assessments
          </p>
          <p className="text-base text-stone-900 mt-1">
            <span className="font-semibold tabular-nums text-red-700">{totals.serious}</span> Serious
            {" "}&middot;{" "}
            <span className="font-semibold tabular-nums text-amber-700">{totals.some}</span> Some
            {" "}&middot;{" "}
            <span className="font-semibold tabular-nums text-emerald-700">{totals.none}</span> No
            {" "}&middot;{" "}
            <span className="font-semibold tabular-nums">{totals.na}</span> N/A
          </p>
        </div>
      </div>

      <div className="overflow-x-auto animate-page-enter-delay-2">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-stone-200 text-sm font-semibold text-stone-700">
              <th className="text-left px-3 py-2" rowSpan={2}>Publication</th>
              <th className="text-center px-3 py-2" rowSpan={2}>Total</th>
              <th className="text-center px-3 py-2 border-b border-stone-200" colSpan={4}>Overall Assessment</th>
              <th className="w-[80px]" rowSpan={2}><span className="sr-only">Actions</span></th>
            </tr>
            <tr className="border-b-2 border-stone-300 text-sm font-semibold">
              <th className="text-center px-3 py-2 text-red-700">Serious</th>
              <th className="text-center px-3 py-2 text-amber-700">Some</th>
              <th className="text-center px-3 py-2 text-emerald-700">No</th>
              <th className="text-center px-3 py-2 text-stone-700 whitespace-nowrap">N/A</th>
            </tr>
          </thead>
          <tbody>
            {publications.map((pub) => (
              <tr key={pub.doi} className="group border-b transition-colors hover:bg-muted/50">
                <td className="px-3 py-3.5">
                  <p className="text-base font-medium text-stone-900 line-clamp-2 text-pretty">
                    {cleanDisplayText(pub.title)}
                  </p>
                  <p className="text-base text-stone-600 font-mono mt-0.5">{pub.doi}</p>
                </td>

                <td className="px-3 py-3.5 text-center tabular-nums text-base font-semibold text-stone-900">
                  {pub.assessmentCount}
                </td>
                <td className="px-3 py-3.5 text-center tabular-nums text-base font-semibold text-red-700">
                  {pub.outcomes.serious || "\u2014"}
                </td>
                <td className="px-3 py-3.5 text-center tabular-nums text-base font-semibold text-amber-700">
                  {pub.outcomes.some || "\u2014"}
                </td>
                <td className="px-3 py-3.5 text-center tabular-nums text-base font-semibold text-emerald-700">
                  {pub.outcomes.none || "\u2014"}
                </td>
                <td className="px-3 py-3.5 text-center tabular-nums text-base font-semibold text-stone-900">
                  {pub.outcomes.na || "\u2014"}
                </td>

                <td className="px-3 py-3.5 text-right">
                  <Link
                    href={`/publications/${encodeURIComponent(pub.doi)}`}
                    className="hover-link text-sm font-medium text-amber-800 inline-flex items-center gap-1"
                  >
                    View
                    <ChevronRight />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
