import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  fetchPublicationByDoi,
  fetchAuthorsForDoi,
  fetchAssessmentsForDoi,
} from "@/lib/sparql-server";
import { OutcomeDot, outcomeLabel, overallColor, BackArrow, ExternalLink, InfoTooltip, ChevronRight, formatDate, cleanDisplayText } from "@/components/shared";
import { RQ_META, RQ_ORDER, type AssessmentForPublication, type AssessmentOutcome } from "@/lib/sparql-types";
import { ExpandableAuthorList } from "@/components/expandable-author-list";

const RQ_HEADERS: { label: string; question: string }[] = [
  { label: "Q1.1", question: RQ_META["retraction-question"].question },
  { label: "Q1.2", question: RQ_META["post-publication-question"].question },
  { label: "Q1.3", question: RQ_META["research-team-question"].question },
  { label: "Q2.2", question: RQ_META["registration-question"].question },
];

function overallBreakdown(assessments: AssessmentForPublication[]) {
  return assessments.reduce(
    (acc, assessment) => {
      if (assessment.overallHuman === "serious-concerns") acc.serious += 1;
      else if (assessment.overallHuman === "some-concerns") acc.some += 1;
      else if (assessment.overallHuman === "no-concerns") acc.no += 1;
      else acc.na += 1;
      return acc;
    },
    { serious: 0, some: 0, no: 0, na: 0 }
  );
}

function orderedQuestionOutcomes(outcomes: AssessmentOutcome[]): string[] {
  return RQ_ORDER.filter((rq) => rq !== "overall-question").map((rq) => {
    const outcome = outcomes.find((item) => item.rq === rq);
    return outcome?.human || outcome?.ai || "N/A";
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doi: string }>;
}): Promise<Metadata> {
  const { doi: rawDoi } = await params;
  const doi = decodeURIComponent(rawDoi);
  const pub = await fetchPublicationByDoi(doi);
  const title = pub ? cleanDisplayText(pub.title) : "Publication";
  return {
    title,
    description: pub ? `Integrity assessment for ${title}` : undefined,
  };
}

export default async function PublicationPage({
  params,
}: {
  params: Promise<{ doi: string }>;
}) {
  const { doi: rawDoi } = await params;
  const doi = decodeURIComponent(rawDoi);

  const [pub, authors, assessments] = await Promise.all([
    fetchPublicationByDoi(doi),
    fetchAuthorsForDoi(doi),
    fetchAssessmentsForDoi(doi),
  ]);

  if (!pub) notFound();
  const totals = overallBreakdown(assessments);

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
          {cleanDisplayText(pub.title)}
        </h1>

        <ExpandableAuthorList authors={authors} />

        <div className="border-t border-stone-200 mt-6 mb-6" />
      </div>

      <div className="flex flex-col lg:flex-row gap-10 animate-page-enter-delay-1">
        <div className="flex-1 min-w-0">
          <div className="mb-6">
            <p className="font-libre text-lg text-stone-900">
              <span className="tabular-nums">{assessments.length}</span> Assessments
            </p>
            <p className="text-base text-stone-900 mt-1">
              <span className="font-semibold tabular-nums text-red-700">{totals.serious}</span> Serious
              {" "}&middot;{" "}
              <span className="font-semibold tabular-nums text-amber-700">{totals.some}</span> Some
              {" "}&middot;{" "}
              <span className="font-semibold tabular-nums text-emerald-700">{totals.no}</span> No
              {" "}&middot;{" "}
              <span className="font-semibold tabular-nums">{totals.na}</span> N/A
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b-2 border-stone-300 text-sm font-semibold text-stone-700">
                  <th className="text-left px-3 py-2">Reviewer</th>
                  <th className="text-left px-3 py-2 w-[110px]">Date</th>
                  {RQ_HEADERS.map((h) => (
                    <th key={h.label} className="text-center px-3 py-2 w-[72px]">
                      {h.label}
                      <InfoTooltip text={h.question} />
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 w-[130px]">Overall</th>
                  <th className="w-[40px]"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((assessment) => {
                  const reviewerName = assessment.reviewerName?.trim();
                  const outcomeValues = orderedQuestionOutcomes(assessment.outcomes);

                  return (
                    <tr key={assessment.assessmentId} className="group border-b transition-colors hover:bg-muted/50">
                      <td className="px-3 py-3.5">
                        {reviewerName ? (
                          <Link
                            href={`/reviewers/${encodeURIComponent(reviewerName)}`}
                            className="hover-link text-base font-medium text-stone-900 inline-flex items-center gap-1"
                          >
                            {reviewerName}
                            <ChevronRight className="size-3 flex-shrink-0" />
                          </Link>
                        ) : (
                          <span className="text-base font-medium text-stone-900">Reviewer</span>
                        )}
                        <p className="text-sm text-stone-600">{assessment.reviewerRole || "Reviewer"}</p>
                      </td>

                      <td className="px-3 py-3.5 whitespace-nowrap text-base text-stone-700 tabular-nums">
                        {assessment.assessedAt ? formatDate(assessment.assessedAt) : "\u2014"}
                      </td>

                      {outcomeValues.map((outcome, idx) => (
                        <td key={RQ_HEADERS[idx]?.label ?? idx} className="px-3 py-3.5 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <OutcomeDot outcome={outcome} />
                            <span className="text-base text-stone-700">
                              {outcomeLabel(outcome)}
                            </span>
                          </div>
                        </td>
                      ))}

                      <td className="px-3 py-3.5 text-right">
                        {assessment.overallHuman ? (
                          <span className={`text-base font-semibold ${overallColor(assessment.overallHuman)}`}>
                            {outcomeLabel(assessment.overallHuman)}
                          </span>
                        ) : (
                          <span className="text-base text-stone-500">N/A</span>
                        )}
                      </td>

                      <td className="px-3 py-3.5 text-right">
                        <Link
                          href={`/assessments/${encodeURIComponent(assessment.assessmentId)}`}
                          className="hover-link text-sm font-medium text-amber-800 inline-flex items-center gap-1"
                        >
                          View
                          <ChevronRight />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="w-full lg:w-72 lg:flex-shrink-0">
          <div className="lg:sticky lg:top-20">
            <div className="relative">
              <div className="line-draw-vertical absolute left-0 top-0 h-full" />
              <div className="pl-6 space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-700">
                  Publication Details
                </h3>

                {pub.doi && (
                  <DetailField label="DOI">
                    <ExternalLink
                      href={`https://doi.org/${pub.doi}`}
                      className="hover-link text-amber-800 font-mono text-base inline-flex items-center gap-1"
                    >
                      {pub.doi}
                    </ExternalLink>
                  </DetailField>
                )}

                {pub.journal && <DetailField label="Journal">{pub.journal}</DetailField>}
                {pub.publisher && <DetailField label="Publisher">{pub.publisher}</DetailField>}
                {pub.pubDate && <DetailField label="Published">{formatDate(pub.pubDate)}</DetailField>}

                {pub.startingPage && (
                  <DetailField label="Pages">
                    {`pp. ${pub.startingPage}${pub.endingPage ? `\u2013${pub.endingPage}` : ""}`}
                  </DetailField>
                )}

                {(pub.issn || pub.eissn) && (
                  <DetailField label="ISSN / eISSN">
                    <span className="font-mono">{[pub.issn, pub.eissn].filter(Boolean).join(" / ")}</span>
                  </DetailField>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-stone-600">{label}</div>
      <div className="text-base text-stone-900 mt-0.5">{children}</div>
    </div>
  );
}
