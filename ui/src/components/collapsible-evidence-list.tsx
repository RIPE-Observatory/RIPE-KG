"use client";

import { useState } from "react";
import type {
  EvidenceItem,
  NoticeEvidence,
  PeerCommentEvidence,
  RegistryEvidence,
  StudyDesignEvidence,
} from "@/lib/sparql-types";
import { ExternalLink, InfoTooltip, cleanDisplayText, formatDate } from "@/components/shared";

function EvidenceBlock({ item }: { item: EvidenceItem }) {
  switch (item.type) {
    case "notice":
      return <NoticeBlock item={item} />;
    case "peerComment":
      return <PeerCommentBlock item={item} />;
    case "registry":
      return <RegistryBlock item={item} />;
    case "studyDesign":
      return <StudyDesignBlock item={item} />;
  }
}

function noticeAccent(noticeType: string): string {
  const lower = noticeType.toLowerCase();
  if (lower.includes("retract")) return "border-l-red-500";
  if (lower.includes("expression") || lower.includes("eoc"))
    return "border-l-amber-500";
  if (lower.includes("correct")) return "border-l-blue-500";
  return "border-l-stone-300";
}

function noticeTypeLabel(noticeType: string): { text: string; color: string } {
  const lower = noticeType.toLowerCase();
  if (lower.includes("retract"))
    return { text: "Retraction Notice", color: "text-red-700" };
  if (lower.includes("expression") || lower.includes("eoc"))
    return { text: "Expression of Concern", color: "text-amber-700" };
  if (lower.includes("correct"))
    return { text: "Correction", color: "text-blue-700" };
  return { text: noticeType, color: "text-stone-700" };
}

function NoticeBlock({ item }: { item: NoticeEvidence }) {
  const typeInfo = item.noticeType
    ? noticeTypeLabel(item.noticeType)
    : null;

  return (
    <div
      className={`border-l-2 ${item.noticeType ? noticeAccent(item.noticeType) : "border-l-stone-300"} pl-4 py-3`}
    >
      {typeInfo && (
        <p
          className={`text-sm font-semibold uppercase tracking-wider ${typeInfo.color} mb-1.5`}
        >
          {typeInfo.text}
          <InfoTooltip text="Source: Retraction Watch database" />
        </p>
      )}

      {item.title && (
        <p className="text-base font-medium text-stone-900 text-pretty mb-1.5">
          {cleanDisplayText(item.title)}
        </p>
      )}

      {item.doi && (
        <ExternalLink
          href={`https://doi.org/${item.doi}`}
          className="hover-link text-base text-amber-800 font-mono inline-flex items-center gap-1 mb-1.5"
        >
          {item.doi}
        </ExternalLink>
      )}

      <div className="space-y-1 mt-2">
        {(item.journal || item.publisher || item.date) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-base">
            {item.journal && (
              <span>
                <span className="font-medium text-stone-600">Journal:</span>{" "}
                <span className="text-stone-900">{item.journal}</span>
              </span>
            )}
            {item.publisher && (
              <span>
                <span className="font-medium text-stone-600">Publisher:</span>{" "}
                <span className="text-stone-900">{item.publisher}</span>
              </span>
            )}
            {item.date && (
              <span>
                <span className="font-medium text-stone-600">Date:</span>{" "}
                <span className="text-stone-900">{formatDate(item.date)}</span>
              </span>
            )}
          </div>
        )}

        {item.retractionWatchRecordId && (
          <p className="text-base">
            <span className="font-medium text-stone-600">
              RetractionWatch ID:
              <InfoTooltip text="Record identifier in the Retraction Watch database" />
            </span>{" "}
            <span className="text-stone-900 font-mono">
              {item.retractionWatchRecordId}
            </span>
          </p>
        )}

        {item.rationale && (
          <p className="text-base">
            <span className="font-medium text-stone-600">Rationale:</span>{" "}
            <span className="text-stone-900">{item.rationale}</span>
          </p>
        )}

        {item.aboutAuthorNames.length > 0 && (
          <p className="text-base">
            <span className="font-medium text-stone-600">
              {item.aboutAuthorNames.length === 1 ? "About Author:" : "About Authors:"}
            </span>{" "}
            <span className="text-stone-900">{item.aboutAuthorNames.join(", ")}</span>
          </p>
        )}

        {(item.retractsTitle || item.retractsDoi) && (
          <div className="text-base mt-1">
            <span className="text-red-700 font-medium">Retracts:</span>{" "}
            {item.retractsTitle && (
              <span className="text-stone-900 italic">
                {item.retractsTitle}
              </span>
            )}
            {item.retractsDoi && (
              <ExternalLink
                href={`https://doi.org/${item.retractsDoi}`}
                className="hover-link text-red-700 font-mono inline-flex items-center gap-1 ml-1"
              >
                {item.retractsDoi}
              </ExternalLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PeerCommentBlock({ item }: { item: PeerCommentEvidence }) {
  return (
    <div className="border-l-2 border-l-amber-400 pl-4 py-3">
      <p className="text-sm font-semibold uppercase tracking-wider text-amber-700 mb-1.5">
        PubPeer Comment
        <InfoTooltip text="Source: PubPeer.com — a platform for post-publication peer review" />
      </p>

      <div className="space-y-1">
        {(item.author || item.date) && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-base">
            {item.author && (
              <span>
                <span className="font-medium text-stone-600">Commenter:</span>{" "}
                <span className="text-stone-900">{item.author}</span>
              </span>
            )}
            {item.date && (
              <span>
                <span className="font-medium text-stone-600">Date:</span>{" "}
                <span className="text-stone-900">{formatDate(item.date)}</span>
              </span>
            )}
          </div>
        )}

        {item.text && (
          <p className="text-base text-stone-900 whitespace-pre-line">
            {item.text}
          </p>
        )}

        {item.threadUrl && (
          <p className="text-base">
            <span className="font-medium text-stone-600">Thread:</span>{" "}
            <ExternalLink
              href={item.threadUrl}
              className="hover-link text-amber-800 font-mono inline-flex items-center gap-1"
            >
              {item.threadUrl}
            </ExternalLink>
          </p>
        )}
      </div>
    </div>
  );
}

function RegistryBlock({ item }: { item: RegistryEvidence }) {
  const hasData = item.registrationId || item.registryName;

  return (
    <div className="border-l-2 border-l-blue-400 pl-4 py-3">
      <p className="text-sm font-semibold uppercase tracking-wider text-blue-700 mb-1.5">
        Clinical Trial Registration
        <InfoTooltip text="Source: Clinical trial registry (e.g. ClinicalTrials.gov, ISRCTN)" />
      </p>

      <div className="space-y-1">
        {hasData ? (
          <>
            {item.registrationId && (
              <p className="text-base">
                <span className="font-medium text-stone-600">Registration ID:</span>{" "}
                <span className="text-stone-900 font-mono">
                  {item.registrationId}
                </span>
              </p>
            )}

            {item.registryName && (
              <p className="text-base">
                <span className="font-medium text-stone-600">Registry:</span>{" "}
                <span className="text-stone-900">{item.registryName}</span>
              </p>
            )}

            {item.registrationLink && (
              <p className="text-base">
                <span className="font-medium text-stone-600">Registry Link:</span>{" "}
                <ExternalLink
                  href={item.registrationLink}
                  className="hover-link text-amber-800 font-mono inline-flex items-center gap-1"
                >
                  {item.registrationLink}
                </ExternalLink>
              </p>
            )}

            {item.registrationDate && (
              <p className="text-base">
                <span className="font-medium text-stone-600">Registration Date:</span>{" "}
                <span className="text-stone-900">{formatDate(item.registrationDate)}</span>
              </p>
            )}

            <p className="text-base">
              <span className="font-medium text-stone-600">
                Prospective:
                <InfoTooltip text="Whether the trial was registered before participant recruitment began" />
              </span>{" "}
              <span
                className={`font-semibold ${item.isProspective ? "text-emerald-700" : "text-red-700"}`}
              >
                {item.isProspective ? "Yes" : "No"}
              </span>
            </p>
          </>
        ) : (
          <p className="text-base text-stone-600 italic">
            No trial registration found
          </p>
        )}

        {item.assessmentRationale && (
          <p className="text-base">
            <span className="font-medium text-stone-600">
              Assessment Rationale:
              <InfoTooltip text="How INSPECT-AI determined the prospective registration status by comparing dates" />
            </span>{" "}
            <span className="text-stone-900">{item.assessmentRationale}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function StudyDesignBlock({ item }: { item: StudyDesignEvidence }) {
  return (
    <div className="border-l-2 border-l-stone-300 pl-4 py-3">
      <p className="text-sm font-semibold uppercase tracking-wider text-stone-700 mb-1.5">
        Study Design Evidence
        <InfoTooltip text="Dates and timelines extracted by INSPECT-AI from the publication text" />
      </p>

      <div className="space-y-1">
        <p className="text-base">
          <span className="font-medium text-stone-600">Recruitment Start:</span>{" "}
          <span className="text-stone-900">{item.recruitmentStartDate || "N/A"}</span>
        </p>
        <p className="text-base">
          <span className="font-medium text-stone-600">
            Recruitment Start Rationale:
            <InfoTooltip text="INSPECT-AI's reasoning for how it identified the recruitment start date" />
          </span>{" "}
          <span className="text-stone-900">{item.recruitmentStartExtractionRationale || "N/A"}</span>
        </p>
        <p className="text-base">
          <span className="font-medium text-stone-600">Recruitment End:</span>{" "}
          <span className="text-stone-900">{item.recruitmentEndDate || "N/A"}</span>
        </p>
        <p className="text-base">
          <span className="font-medium text-stone-600">
            Recruitment End Rationale:
            <InfoTooltip text="INSPECT-AI's reasoning for how it identified the recruitment end date" />
          </span>{" "}
          <span className="text-stone-900">{item.recruitmentEndExtractionRationale || "N/A"}</span>
        </p>
        <p className="text-base">
          <span className="font-medium text-stone-600">Study End:</span>{" "}
          <span className="text-stone-900">{item.studyEndDate || "N/A"}</span>
        </p>
        <p className="text-base">
          <span className="font-medium text-stone-600">
            Study End Rationale:
            <InfoTooltip text="INSPECT-AI's reasoning for how it identified the study end date" />
          </span>{" "}
          <span className="text-stone-900">{item.studyEndExtractionRationale || "N/A"}</span>
        </p>
      </div>
    </div>
  );
}

export function CollapsibleEvidenceList({
  items,
  initialCount = 3,
}: {
  items: EvidenceItem[];
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, initialCount);

  return (
    <>
      <div className="space-y-4">
        {visible.map((item, idx) => (
          <div
            key={idx}
            className={idx >= initialCount && expanded ? "animate-page-enter" : ""}
            style={
              idx >= initialCount && expanded
                ? { animationDelay: `${Math.min((idx - initialCount) * 30, 300)}ms` }
                : undefined
            }
          >
            <EvidenceBlock item={item} />
          </div>
        ))}
      </div>
      {items.length > initialCount && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer evidence items" : `Show all ${items.length} evidence items`}
          className="mt-4 text-sm text-amber-800 font-medium hover:text-amber-900 transition-colors"
        >
          {expanded
            ? "Show fewer"
            : `Show all ${items.length} items (+${items.length - initialCount} more)`}
        </button>
      )}
    </>
  );
}
