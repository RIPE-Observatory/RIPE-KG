import { executeSparqlQuery } from "./sparql";
import {
  PREFIXES,
  val,
  intVal,
  esc,
  type SparqlBinding,
  type PublicationSearchResult,
  type AuthorSearchResult,
} from "./sparql-types";
import { RIPE_KG_BASE, SEMOPENALEX_AUTHOR_BASE } from "./iri";

export * from "./sparql-types";

async function query(sparql: string): Promise<SparqlBinding[]> {
  const result = await executeSparqlQuery(sparql);
  return result.results.bindings;
}

export async function searchPublications(
  term: string,
  limit = 20
): Promise<PublicationSearchResult[]> {
  const escaped = esc(term);
  const sparql = `${PREFIXES}
    SELECT ?doi (SAMPLE(?title) AS ?title) (SAMPLE(?journal) AS ?journal)
           (COUNT(DISTINCT ?assessment) AS ?assessmentCount)
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi ?doi .
      FILTER(STRLEN(?doi) > 0)
      OPTIONAL {
        ?pd a ripe:PublicationDetails ;
            ripe:concerns ?work .
        OPTIONAL { ?pd dcterms:title ?title }
        OPTIONAL { ?pd prism:publicationName ?journal }
      }
      FILTER(
        CONTAINS(LCASE(COALESCE(?title, "")), LCASE("${escaped}"))
        || CONTAINS(LCASE(?doi), LCASE("${escaped}"))
      )
    }
    GROUP BY ?doi
    ORDER BY DESC(?assessmentCount)
    LIMIT ${limit}`;

  const rows = await query(sparql);
  return rows.map((r) => ({
    title: val(r, "title"),
    doi: val(r, "doi"),
    journal: val(r, "journal"),
    assessmentCount: intVal(r, "assessmentCount"),
  }));
}

export async function searchAuthors(
  term: string,
  limit = 20
): Promise<AuthorSearchResult[]> {
  const escaped = esc(term);
  const sparql = `${PREFIXES}
    SELECT ?name ?authorId (SAMPLE(?sameAsValue) AS ?sameAs)
           (COUNT(DISTINCT ?assessment) AS ?assessmentCount)
           (COUNT(DISTINCT ?doi) AS ?pubCount)
    WHERE {
      ?work a ripe:Work ;
            dcterms:creator ?author .
      FILTER(STRSTARTS(STR(?author), "${RIPE_KG_BASE}author/"))
      ?author foaf:name ?name .
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi ?doi .
      BIND(REPLACE(STR(?author), ".*/", "") AS ?authorId)
      OPTIONAL {
        ?author owl:sameAs ?sameAsValue .
        FILTER(STRSTARTS(STR(?sameAsValue), "${SEMOPENALEX_AUTHOR_BASE}"))
      }
      FILTER(CONTAINS(LCASE(?name), LCASE("${escaped}")))
    }
    GROUP BY ?name ?authorId
    ORDER BY DESC(?assessmentCount)
    LIMIT ${limit}`;

  const rows = await query(sparql);
  return rows.map((r) => ({
    name: val(r, "name"),
    authorId: val(r, "authorId"),
    sameAs: val(r, "sameAs"),
    assessmentCount: intVal(r, "assessmentCount"),
    pubCount: intVal(r, "pubCount"),
  }));
}
