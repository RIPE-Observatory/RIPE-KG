export const RDF_FORMATS = {
  "text/turtle": "ttl",
  "application/ld+json": "jsonld",
  "application/rdf+xml": "rdf",
  "application/n-triples": "nt",
} as const;

export type RdfFormat = keyof typeof RDF_FORMATS;
export type ResourceFormat = "text/html" | RdfFormat;

// The most specific range determines a representation's quality, including q=0.
// In a tie prefer HTML, so a browser or */* does not unexpectedly download RDF.
export function negotiate(accept: string | null): ResourceFormat | null {
  if (!accept?.trim()) return "text/html";
  const ranges = accept.toLowerCase().split(",").map((part, order) => {
    const [type, ...params] = part.trim().split(/\s*;\s*/);
    const raw = params.find((p) => p.startsWith("q="))?.slice(2);
    const q = raw === undefined ? 1 : Number(raw);
    return { type, order, q: Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0 };
  });
  const candidates: ResourceFormat[] = ["text/html", ...Object.keys(RDF_FORMATS) as RdfFormat[]];
  const scored = candidates.map((type, preference) => {
    const matches = ranges.flatMap((range) => {
      const specificity = range.type === type || (type === "text/html" && range.type === "application/xhtml+xml")
        ? 2 : range.type === type.split("/")[0] + "/*" ? 1 : range.type === "*/*" ? 0 : -1;
      return specificity < 0 ? [] : [{ ...range, specificity }];
    }).sort((a, b) => b.specificity - a.specificity || a.order - b.order);
    return { type, preference, q: matches[0]?.q ?? 0, order: matches[0]?.order ?? Infinity };
  }).filter((item) => item.q > 0).sort((a, b) => b.q - a.q || a.order - b.order || a.preference - b.preference);
  return scored[0]?.type ?? null;
}
