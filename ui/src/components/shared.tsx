import type { ReactNode } from "react";

export function InfoTooltip({ text }: { text: string }) {
  return (
    <span
      aria-label={text}
      title={text}
      className="normal-case ml-1 inline-flex size-4 cursor-help items-center justify-center rounded-full border border-stone-300 text-[10px] font-bold leading-none text-stone-700"
    >
      i
    </span>
  );
}

export function OutcomeDot({ outcome }: { outcome: string }) {
  const colorMap: Record<string, string> = {
    no: "bg-emerald-500",
    yes: "bg-red-500",
    unclear: "bg-amber-500",
    na: "bg-stone-300",
    "no-concerns": "bg-emerald-500",
    "some-concerns": "bg-amber-500",
    "serious-concerns": "bg-red-500",
  };
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 rounded-full flex-shrink-0 ${colorMap[outcome] || "bg-stone-300"}`}
    />
  );
}

export function outcomeLabel(outcome: string): string {
  const labels: Record<string, string> = {
    no: "No",
    yes: "Yes",
    unclear: "Unclear",
    na: "N/A",
    "no-concerns": "No concerns",
    "some-concerns": "Some concerns",
    "serious-concerns": "Serious concerns",
  };
  return labels[outcome] || outcome;
}

export function overallColor(outcome: string): string {
  if (outcome === "no-concerns") return "text-emerald-700";
  if (outcome === "some-concerns") return "text-amber-700";
  if (outcome === "serious-concerns") return "text-red-700";
  return "text-stone-700";
}

export function BackArrow() {
  return (
    <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export function ExtLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-2.5 inline-block flex-shrink-0"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  );
}

export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className ?? ""} max-w-full min-w-0`}
    >
      <span className="min-w-0 break-all">{children}</span>
      <ExtLinkIcon />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

export function ChevronRight({ className = "size-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function formatDate(raw: string): string {
  const value = raw.trim();
  if (/^\d{4}$/u.test(value)) return value;
  if (/^\d{2}-\d{4}$/u.test(value)) return value;
  if (/^\d{2}-\d{2}-\d{4}$/u.test(value)) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.split(" ")[0];
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function cleanDisplayText(value: string): string {
  return value
    .replace(/<[^>]*>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
