import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchReviewerProfile,
  fetchReviewerAssessments,
} from "@/lib/sparql-server";
import { BackArrow, overallColor, outcomeLabel, OutcomeDot, ChevronRight, formatDate, cleanDisplayText } from "@/components/shared";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const reviewerId = decodeURIComponent(id);
  return { title: reviewerId };
}

export default async function ReviewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reviewerId = decodeURIComponent(id);

  const [profile, assessments] = await Promise.all([
    fetchReviewerProfile(reviewerId),
    fetchReviewerAssessments(reviewerId),
  ]);

  if (!profile) notFound();

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
          {profile.id}
        </h1>
        {profile.role && (
          <p className="text-base text-stone-900">{profile.role}</p>
        )}

        <div className="border-t border-stone-200 mt-6 mb-6" />
      </div>

      <h2 className="font-libre text-lg text-stone-900 mb-4 animate-page-enter-delay-1">
        <span className="tabular-nums">{assessments.length}</span>
        {assessments.length === 1
          ? " Assessment Completed"
          : " Assessments Completed"}
      </h2>

      <div className="overflow-x-auto animate-page-enter-delay-2">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b-2 border-stone-300 text-sm font-semibold text-stone-700">
              <th className="text-left px-3 py-2">Publication</th>
              <th className="text-left px-3 py-2 w-[110px]">Date</th>
              <th className="text-left px-3 py-2 whitespace-nowrap">Overall Assessment</th>
              <th className="w-[80px]"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((a) => (
              <tr key={a.assessmentId} className="group border-b transition-colors hover:bg-muted/50">
                <td className="px-3 py-3.5">
                  <p className="text-base font-medium text-stone-900 line-clamp-2 text-pretty">
                    {cleanDisplayText(a.pubTitle)}
                  </p>
                  {a.pubDoi && (
                    <p className="text-base text-stone-600 font-mono mt-0.5">{a.pubDoi}</p>
                  )}
                </td>

                <td className="px-3 py-3.5 whitespace-nowrap text-base text-stone-700 tabular-nums">
                  {a.assessedAt ? formatDate(a.assessedAt) : "—"}
                </td>

                <td className="px-3 py-3.5 whitespace-nowrap">
                  {a.overallOutcome ? (
                    <span className="inline-flex items-center gap-1.5">
                      <OutcomeDot outcome={a.overallOutcome} />
                      <span className={`text-base font-semibold ${overallColor(a.overallOutcome)}`}>
                        {outcomeLabel(a.overallOutcome)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-base text-stone-500">N/A</span>
                  )}
                </td>

                <td className="px-3 py-3.5 text-right">
                  <Link
                    href={`/assessments/${encodeURIComponent(a.assessmentId)}`}
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
