export const RIPE_ONTOLOGY_BASE = "https://w3id.org/ripe/ripe-o#";
export const RIPE_ONTOLOGY_DOCUMENT = "https://w3id.org/ripe/ripe-o";
export const RIPE_KG_BASE = "https://w3id.org/ripe/ripe-kg/";
export const SEMOPENALEX_AUTHOR_BASE = "https://semopenalex.org/author/";

export const ASSESSMENT_ID_PATTERN = /^RIPEA[A-F0-9]{16}$/u;
export const REVIEWER_ID_PATTERN = /^RV\d{3}$/u;
export const LOCAL_AUTHOR_ID_PATTERN = /^(RIPEAU[A-F0-9]{16}|pubpeer-RIPEA[A-F0-9]{16}-\d+)$/u;

export function ripeKgIri(segment: string, id: string): string {
  return `${RIPE_KG_BASE}${segment}/${encodeURIComponent(id)}`;
}

export function localNameFromIri(iri: string): string {
  return iri.split("/").at(-1) ?? iri;
}

export function localHrefForIri(iri: string): string {
  if (iri.startsWith(RIPE_KG_BASE)) {
    return `/ripe-kg/${iri.slice(RIPE_KG_BASE.length)}`;
  }
  if (iri.startsWith(RIPE_ONTOLOGY_BASE)) {
    return `/ontology#${encodeURIComponent(iri.slice(RIPE_ONTOLOGY_BASE.length))}`;
  }
  if (iri === RIPE_ONTOLOGY_DOCUMENT) {
    return "/ripe-o";
  }
  return iri;
}

export function isLocalHref(href: string): boolean {
  return href.startsWith("/");
}
