import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import {
  fetchAssessmentHeader,
  fetchAssessmentHypotheses,
  fetchAssessmentEvidenceByRq,
} from "@/lib/sparql-server";
import {
  RQ_META,
  type AssessmentHeader,
} from "@/lib/sparql-types";
import { OutcomeDot, outcomeLabel, overallColor, BackArrow, ExternalLink, InfoTooltip, formatDate, cleanDisplayText } from "@/components/shared";
import { CollapsibleEvidenceList } from "@/components/collapsible-evidence-list";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ uuid: string }>;
}): Promise<Metadata> {
  const { uuid } = await params;
  const header = await fetchAssessmentHeader(uuid);
  return {
    title: header ? `Assessment: ${cleanDisplayText(header.pubTitle)}` : "Assessment",
  };
}

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;

  const [header, hypotheses, evidence] = await Promise.all([
    fetchAssessmentHeader(uuid),
    fetchAssessmentHypotheses(uuid),
    fetchAssessmentEvidenceByRq(uuid),
  ]);

  if (!header) notFound();

  const totalEvidence = Object.values(evidence).reduce(
    (sum, items) => sum + items.length,
    0
  );

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="animate-page-enter">
        <AssessmentHeaderBlock header={header} />
      </div>

      <h2 className="font-libre text-lg text-stone-900 mb-4 animate-page-enter-delay-1">
        <span className="tabular-nums">{hypotheses.length}</span> Research
        Questions{" · "}
        <span className="tabular-nums">{totalEvidence}</span> Evidence Items
      </h2>

      <div className="space-y-12 animate-page-enter-delay-2">
        {hypotheses.map((h, i) => {
          const meta = RQ_META[h.rq];
          const rqEvidence = evidence[h.rq] ?? [];
          const isQ12 = h.rq === "post-publication-question";
          const isOverall = h.rq === "overall-question";

          return (
            <section key={h.rq}>
              <h3 className="text-lg font-semibold text-stone-900 mb-6">
                {meta?.label ?? h.rq} — {meta?.question ?? ""}
              </h3>

              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
                    Automated Assessment:
                    <InfoTooltip text="Assessment produced by the automated system" />
                  </span>
                  {h.aiOutcome ? (
                    <span className="flex items-center gap-1.5">
                      <OutcomeDot outcome={h.aiOutcome} />
                      <span className="text-base font-medium text-stone-800">
                        {outcomeLabel(h.aiOutcome)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-base text-stone-500 italic">N/A</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
                    Human Assessment:
                    <InfoTooltip text="Assessment by a domain expert reviewer, informed by AI results" />
                  </span>
                  {h.humanOutcome ? (
                    <span className="flex items-center gap-1.5">
                      <OutcomeDot outcome={h.humanOutcome} />
                      <span className="text-base font-medium text-stone-800">
                        {outcomeLabel(h.humanOutcome)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-base text-stone-500 italic">N/A</span>
                  )}
                </div>

                <p className="text-base text-stone-700 leading-relaxed mt-2">
                  <span className="text-sm font-semibold text-stone-700 uppercase tracking-wider">
                    Rationale:
                  </span>{" "}
                  {h.humanRationale ? (
                    <span className="italic">{h.humanRationale}</span>
                  ) : (
                    <span className="text-base text-stone-600 italic">
                      No rationale provided
                    </span>
                  )}
                </p>
              </div>

              {!isOverall && rqEvidence.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">
                    Supporting Evidence ({rqEvidence.length})
                  </p>

                  {isQ12 && header.peerCommentUrl && (
                    <div className="border-l-2 border-l-stone-300 pl-4 py-3 mb-4">
                      <p className="text-sm font-semibold uppercase tracking-wider text-stone-700 mb-1.5">
                        PubPeer Thread
                        <InfoTooltip text="Source: PubPeer.com — post-publication peer review comments" />
                      </p>
                      <ExternalLink
                        href={header.peerCommentUrl}
                        className="hover-link text-base text-amber-800 font-mono inline-flex items-center gap-1"
                      >
                        {header.peerCommentUrl}
                      </ExternalLink>
                    </div>
                  )}

                  <CollapsibleEvidenceList
                    items={rqEvidence}
                    initialCount={3}
                  />
                </div>
              )}

              {i < hypotheses.length - 1 && (
                <div className="border-t border-stone-200 mt-8" />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function AssessmentHeaderBlock({ header }: { header: AssessmentHeader }) {
  const reviewerName = header.reviewerName?.trim();

  return (
    <>
      {header.pubDoi ? (
        <Link
          href={`/publications/${encodeURIComponent(header.pubDoi)}`}
          className="hover-link text-sm text-stone-600 inline-flex items-center gap-1.5 mb-6"
        >
          <BackArrow />
          Back to publication
        </Link>
      ) : (
        <Link
          href="/explore"
          className="hover-link text-sm text-stone-600 inline-flex items-center gap-1.5 mb-6"
        >
          <BackArrow />
          Back to explore
        </Link>
      )}

      <h1 className="font-libre text-2xl text-stone-900 leading-tight text-balance mb-2">
        {cleanDisplayText(header.pubTitle)}
      </h1>

      <div className="text-base text-stone-900 space-y-1 mt-2">
        <p>
          Assessed by{" "}
          {reviewerName ? (
            <Link
              href={`/reviewers/${encodeURIComponent(reviewerName)}`}
              className="hover-link font-medium text-amber-800"
            >
              {reviewerName}
            </Link>
          ) : (
            <span className="font-medium">Reviewer</span>
          )}
          {header.reviewerRole && <> &middot; {header.reviewerRole}</>}
        </p>
        {header.assessedAt && (
          <p>Assessed on {formatDate(header.assessedAt)}</p>
        )}
        {header.overallOutcome && (
          <p>
            Overall
            <InfoTooltip text="Reviewer's overall integrity assessment, derived from all research questions" />
            {" "}
            <span className={`font-semibold ${overallColor(header.overallOutcome)}`}>
              {outcomeLabel(header.overallOutcome)}
            </span>
          </p>
        )}
      </div>

      {header.pubDoi && (
        <p className="text-base text-stone-900 mt-1">
          DOI{" "}
          <ExternalLink
            href={`https://doi.org/${header.pubDoi}`}
            className="hover-link font-mono text-amber-800 inline-flex items-center gap-1"
          >
            {header.pubDoi}
          </ExternalLink>
        </p>
      )}

      {header.assessmentId && (
        <p className="text-base text-stone-900 mt-1">
          Resource{" "}
          <Link
            href={`/ripe-kg/research-integrity-assessment/${encodeURIComponent(header.assessmentId)}`}
            className="hover-link font-mono text-amber-800"
          >
            ripekg:research-integrity-assessment/{header.assessmentId}
          </Link>
        </p>
      )}

      <div className="border-t border-stone-200 mt-6 mb-6" />
    </>
  );
}
