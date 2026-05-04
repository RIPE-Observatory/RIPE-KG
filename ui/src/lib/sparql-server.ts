import "server-only";

import {
  PREFIXES,
  val,
  intVal,
  esc,
  RQ_ORDER,
  RQ_IRIS,
  type SparqlBinding,
  type SearchStats,
  type PublicationMeta,
  type AuthorForPub,
  type AssessmentOutcome,
  type AssessmentForPublication,
  type AssessmentHeader,
  type HypothesisRow,
  type EvidenceItem,
  type NoticeEvidence,
  type PeerCommentEvidence,
  type AuthorProfile,
  type AuthorPublicationResult,
  type AuthorStatsResult,
  type ReviewerProfile,
  type ReviewerAssessment,
} from "./sparql-types";
import {
  SEMOPENALEX_AUTHOR_BASE,
  ripeKgIri,
} from "./iri";

const GRAPHDB_URL =
  process.env.SPARQL_ENDPOINT ||
  "http://localhost:7200/repositories/ripe";

const QUESTION_VALUE_ROWS = RQ_ORDER.map(
  (rq) => `(<${RQ_IRIS[rq]}> "${rq}")`
).join("\n        ");

const QUESTION_VALUES = `VALUES (?rq ?rqLocal) {
        ${QUESTION_VALUE_ROWS}
      }`;

const OVERALL_QUESTION_IRI = RQ_IRIS["overall-question"];

export class SparqlQueryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint = GRAPHDB_URL
  ) {
    super(message);
    this.name = "SparqlQueryError";
  }
}

export function isSparqlQueryError(error: unknown): error is SparqlQueryError {
  return error instanceof SparqlQueryError;
}

function resourceIri(kind: "assessment" | "author", id: string): string {
  return ripeKgIri(kind === "assessment" ? "research-integrity-assessment" : "author", id);
}

function authorBinding(authorId: string): string {
  return `BIND(<${resourceIri("author", authorId)}> AS ?author)`;
}

function startsWithFilter(variable: string, iriBase: string): string {
  return `FILTER(STRSTARTS(STR(${variable}), "${iriBase}"))`;
}

function semOpenAlexAuthorFilter(variable: string): string {
  return startsWithFilter(variable, SEMOPENALEX_AUTHOR_BASE);
}

async function serverQuery(sparql: string): Promise<SparqlBinding[]> {
  let res: Response;
  try {
    res = await fetch(GRAPHDB_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        Accept: "application/sparql-results+json",
      },
      body: sparql,
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    throw new SparqlQueryError(`Could not reach GraphDB at ${GRAPHDB_URL}: ${message}`);
  }

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    const suffix = details.trim() ? `: ${details.trim()}` : "";
    throw new SparqlQueryError(
      `SPARQL endpoint ${GRAPHDB_URL} returned ${res.status}${suffix}`,
      res.status
    );
  }

  const json = await res.json();
  return json.results?.bindings ?? [];
}

export async function fetchSearchStats(): Promise<SearchStats> {
  const assessmentSparql = `${PREFIXES}
    SELECT (COUNT(DISTINCT ?assessment) AS ?assessmentCount)
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment .
    }`;

  const publicationSparql = `${PREFIXES}
    SELECT (COUNT(DISTINCT ?work) AS ?publicationCount)
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ;
                  ripe:assesses ?work .
    }`;

  const authorSparql = `${PREFIXES}
    SELECT (COUNT(DISTINCT ?author) AS ?authorCount)
    WHERE {
      ?author a ripe:Author .
    }`;

  const evidenceSparql = `${PREFIXES}
    SELECT (COUNT(DISTINCT ?ev) AS ?evCount)
    WHERE {
      VALUES ?evidenceClass {
        ripe:PeerComment
        ripe:RegistryEvidence
        ripe:StudyDesignEvidence
        ripe:RetractionNotice
        ripe:ExpressionOfConcern
        ripe:CorrectionNotice
      }
      ?ev a ?evidenceClass .
    }`;

  const [assessmentRows, publicationRows, authorRows, evidenceRows] = await Promise.all([
    serverQuery(assessmentSparql),
    serverQuery(publicationSparql),
    serverQuery(authorSparql),
    serverQuery(evidenceSparql),
  ]);
  const assessment = assessmentRows[0] || {};
  const publication = publicationRows[0] || {};
  const author = authorRows[0] || {};
  const evidence = evidenceRows[0] || {};
  return {
    assessments: intVal(assessment, "assessmentCount"),
    publications: intVal(publication, "publicationCount"),
    authors: intVal(author, "authorCount"),
    evidence: intVal(evidence, "evCount"),
  };
}

export async function fetchPublicationByDoi(
  doi: string
): Promise<PublicationMeta | null> {
  const escaped = esc(doi);
  const sparql = `${PREFIXES}
    SELECT (SAMPLE(?titleValue) AS ?title)
           (SAMPLE(?journalValue) AS ?journal)
           (SAMPLE(?publisherValue) AS ?publisher)
           (SAMPLE(?pubDateValue) AS ?pubDate)
           (SAMPLE(?startingPageValue) AS ?startingPage)
           (SAMPLE(?endingPageValue) AS ?endingPage)
           (SAMPLE(?issnValue) AS ?issn)
           (SAMPLE(?eissnValue) AS ?eissn)
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ;
                  ripe:assesses ?work .
      ?work prism:doi "${escaped}" .
      OPTIONAL {
        ?pd a ripe:PublicationDetails ;
            prov:wasMemberOf ?assessment ;
            ripe:concerns ?work .
        OPTIONAL { ?pd dcterms:title ?titleValue }
        OPTIONAL { ?pd prism:publicationName ?journalValue }
        OPTIONAL {
          ?pd dcterms:publisher ?publisherResource .
          OPTIONAL { ?publisherResource foaf:name ?publisherValue }
        }
        OPTIONAL { ?pd prism:publicationDate ?pubDateValue }
        OPTIONAL { ?pd prism:startingPage ?startingPageValue }
        OPTIONAL { ?pd prism:endingPage ?endingPageValue }
        OPTIONAL { ?pd prism:issn ?issnValue }
        OPTIONAL { ?pd prism:eIssn ?eissnValue }
      }
    }`;

  const rows = await serverQuery(sparql);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    title: val(r, "title"),
    doi,
    journal: val(r, "journal"),
    publisher: val(r, "publisher"),
    pubDate: val(r, "pubDate"),
    startingPage: val(r, "startingPage"),
    endingPage: val(r, "endingPage"),
    issn: val(r, "issn"),
    eissn: val(r, "eissn"),
  };
}

export async function fetchAuthorsForDoi(
  doi: string
): Promise<AuthorForPub[]> {
  const escaped = esc(doi);
  const sparql = `${PREFIXES}
    SELECT DISTINCT ?name ?authorId ?sameAs
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ;
                  ripe:assesses ?work .
      ?work prism:doi "${escaped}" .
      ?work dcterms:creator ?author .
      ?author foaf:name ?name .
      BIND(REPLACE(STR(?author), ".*/", "") AS ?authorId)
      OPTIONAL {
        ?author owl:sameAs ?sameAs .
        ${semOpenAlexAuthorFilter("?sameAs")}
      }
    }
    ORDER BY ?name`;

  const rows = await serverQuery(sparql);
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const id = val(r, "authorId");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((r) => ({
      name: val(r, "name"),
      authorId: val(r, "authorId"),
      sameAs: val(r, "sameAs"),
    }));
}

export async function fetchAssessmentsForDoi(doi: string): Promise<AssessmentForPublication[]> {
  const escaped = esc(doi);
  const assessmentsSparql = `${PREFIXES}
    SELECT ?assessmentId (SAMPLE(?rn) AS ?reviewerName) (SAMPLE(?rr) AS ?reviewerRole)
           (SAMPLE(?ts) AS ?assessedAt)
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi "${escaped}" .
      BIND(REPLACE(STR(?assessment), ".*research-integrity-assessment/", "") AS ?assessmentId)
      ?eval a tido:Evaluation ;
            tido:contributesTo ?assessment ;
            prov:wasAssociatedWith ?reviewer .
      ?reviewer a ripe:HumanReviewer .
      OPTIONAL { ?reviewer dcterms:identifier ?rn }
      OPTIONAL { ?reviewer dbo:occupation ?rr }
      OPTIONAL { ?eval prov:startedAtTime ?ts }
    }
    GROUP BY ?assessmentId
    ORDER BY ?assessmentId`;

  const hypoSparql = `${PREFIXES}
    SELECT ?assessmentId ?rqLocal ?agent ?outcome
    WHERE {
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi "${escaped}" .
      BIND(REPLACE(STR(?assessment), ".*research-integrity-assessment/", "") AS ?assessmentId)
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           ripe:resultOutcome ?outcome ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?agentUri .
      ${QUESTION_VALUES}
      BIND(IF(EXISTS { ?agentUri a ripe:AutomatedAgent }, "Automated", "Human") AS ?agent)
    }
    ORDER BY ?assessmentId ?rqLocal ?agent`;

  const [assessmentRows, hypoRows] = await Promise.all([
    serverQuery(assessmentsSparql),
    serverQuery(hypoSparql),
  ]);

  const assessmentHypothesisMap = new Map<string, Map<string, { ai: string; human: string }>>();
  for (const r of hypoRows) {
    const cid = val(r, "assessmentId");
    const rq = val(r, "rqLocal");
    const agent = val(r, "agent");
    const outcome = val(r, "outcome");
    if (!assessmentHypothesisMap.has(cid)) assessmentHypothesisMap.set(cid, new Map());
    const rqMap = assessmentHypothesisMap.get(cid)!;
    if (!rqMap.has(rq)) rqMap.set(rq, { ai: "", human: "" });
    const entry = rqMap.get(rq)!;
    if (agent === "Automated") entry.ai = outcome;
    else entry.human = outcome;
  }

  return assessmentRows.map((r) => {
    const cid = val(r, "assessmentId");
    const rqMap = assessmentHypothesisMap.get(cid) || new Map();
    const outcomes: AssessmentOutcome[] = [];
    const checkRqs = RQ_ORDER.filter((rq) => rq !== "overall-question");
    for (const rq of checkRqs) {
      const entry = rqMap.get(rq);
      if (entry) outcomes.push({ rq, ai: entry.ai, human: entry.human });
    }
    const overall = rqMap.get("overall-question");
    return {
      assessmentId: cid,
      reviewerName: val(r, "reviewerName"),
      reviewerRole: val(r, "reviewerRole"),
      assessedAt: val(r, "assessedAt"),
      outcomes,
      overallHuman: overall?.human ?? "",
    };
  });
}

export async function fetchReviewerProfile(
  id: string
): Promise<ReviewerProfile | null> {
  const escaped = esc(id);
  const sparql = `${PREFIXES}
    SELECT ?role WHERE {
      ?reviewer a ripe:HumanReviewer ;
                dcterms:identifier "${escaped}" .
      OPTIONAL { ?reviewer dbo:occupation ?role }
    } LIMIT 1`;
  const rows = await serverQuery(sparql);
  if (rows.length === 0) return null;
  return {
    id: escaped,
    role: val(rows[0], "role"),
  };
}

export async function fetchReviewerAssessments(
  id: string
): Promise<ReviewerAssessment[]> {
  const escaped = esc(id);
  const sparql = `${PREFIXES}
    SELECT ?assessmentId ?pubTitle ?pubDoi ?assessedAt ?overallOutcome
    WHERE {
      ?reviewer a ripe:HumanReviewer ;
                dcterms:identifier "${escaped}" .
      ?eval prov:wasAssociatedWith ?reviewer ;
            tido:contributesTo ?assessment .
      ?assessment a ripe:ResearchIntegrityAssessment ;
                  ripe:assesses ?work .
      BIND(REPLACE(STR(?assessment), ".*research-integrity-assessment/", "") AS ?assessmentId)
      OPTIONAL {
        ?pd a ripe:PublicationDetails ;
            prov:wasMemberOf ?assessment ;
            ripe:concerns ?work .
        ?pd dcterms:title ?pubTitle .
      }
      OPTIONAL { ?work prism:doi ?pubDoi }
      OPTIONAL { ?eval prov:startedAtTime ?assessedAt }
      OPTIONAL {
        ?overallHyp a ripe:IntegrityAssessmentHypothesis ;
             tido:answers ?overallRq ;
             prov:wasMemberOf ?assessment ;
             prov:wasAttributedTo ?reviewer ;
             ripe:resultOutcome ?overallOutcome .
        FILTER(?overallRq = <${OVERALL_QUESTION_IRI}>)
      }
    }
    ORDER BY DESC(?assessedAt)`;
  const rows = await serverQuery(sparql);
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const cid = val(r, "assessmentId");
      if (seen.has(cid)) return false;
      seen.add(cid);
      return true;
    })
    .map((r) => ({
      assessmentId: val(r, "assessmentId"),
      pubTitle: val(r, "pubTitle"),
      pubDoi: val(r, "pubDoi"),
      assessedAt: val(r, "assessedAt"),
      overallOutcome: val(r, "overallOutcome"),
    }));
}

export async function fetchAssessmentHeader(
  uuid: string
): Promise<AssessmentHeader | null> {
  const iri = resourceIri("assessment", uuid);
  const sparql = `${PREFIXES}
    SELECT ?assessmentId ?pubTitle ?pubDoi
           ?reviewerName ?reviewerRole ?peerCommentUrl
           ?assessedAt ?overallOutcome
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      BIND(REPLACE(STR(?assessment), ".*research-integrity-assessment/", "") AS ?assessmentId)
      ?assessment ripe:assesses ?work .
      OPTIONAL {
        ?pd a ripe:PublicationDetails ;
            prov:wasMemberOf ?assessment ;
            ripe:concerns ?work .
        ?pd dcterms:title ?pubTitle .
      }
      OPTIONAL { ?work prism:doi ?pubDoi }
      ?reval a tido:Evaluation ;
             tido:contributesTo ?assessment ;
             prov:wasAssociatedWith ?reviewer .
      ?reviewer a ripe:HumanReviewer .
      OPTIONAL { ?reval prov:startedAtTime ?assessedAt }
      OPTIONAL { ?reviewer dcterms:identifier ?reviewerName }
      OPTIONAL { ?reviewer dbo:occupation ?reviewerRole }
      OPTIONAL {
        ?peerComment a ripe:PeerComment ;
                     prov:wasMemberOf ?assessment ;
                     ripe:concerns ?work ;
                     fabio:hasURL ?peerCommentUrl .
      }
      OPTIONAL {
        ?overallHyp a ripe:IntegrityAssessmentHypothesis ;
             tido:answers ?overallRq ;
             prov:wasMemberOf ?assessment ;
             prov:wasAttributedTo ?reviewer ;
             ripe:resultOutcome ?overallOutcome .
        FILTER(?overallRq = <${OVERALL_QUESTION_IRI}>)
      }
    }
    LIMIT 1`;

  const rows = await serverQuery(sparql);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    assessmentId: val(r, "assessmentId"),
    pubTitle: val(r, "pubTitle"),
    pubDoi: val(r, "pubDoi"),
    reviewerName: val(r, "reviewerName"),
    reviewerRole: val(r, "reviewerRole"),
    peerCommentUrl: val(r, "peerCommentUrl"),
    assessedAt: val(r, "assessedAt"),
    overallOutcome: val(r, "overallOutcome"),
  };
}

export async function fetchAssessmentHypotheses(
  uuid: string
): Promise<HypothesisRow[]> {
  const iri = resourceIri("assessment", uuid);
  const sparql = `${PREFIXES}
    SELECT ?rqLocal ?rqLabel ?agent ?outcome ?rationale
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           ripe:resultOutcome ?outcome ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?agentUri .
      ${QUESTION_VALUES}
      BIND(IF(EXISTS { ?agentUri a ripe:AutomatedAgent }, "Automated", "Human") AS ?agent)
      OPTIONAL { ?rq rdfs:label ?rqLabel }
      OPTIONAL { ?hyp ripe:rationale ?rationale }
    }
    ORDER BY ?rqLocal ?agent`;

  const rows = await serverQuery(sparql);

  const rqMap = new Map<
    string,
    {
      rqLabel: string;
      aiOutcome: string;
      aiRationale: string;
      humanOutcome: string;
      humanRationale: string;
    }
  >();

  for (const r of rows) {
    const rq = val(r, "rqLocal");
    const agent = val(r, "agent");
    if (!rqMap.has(rq)) {
      rqMap.set(rq, {
        rqLabel: val(r, "rqLabel"),
        aiOutcome: "",
        aiRationale: "",
        humanOutcome: "",
        humanRationale: "",
      });
    }
    const entry = rqMap.get(rq)!;
    if (agent === "Automated") {
      entry.aiOutcome = val(r, "outcome");
      entry.aiRationale = val(r, "rationale");
    } else {
      entry.humanOutcome = val(r, "outcome");
      entry.humanRationale = val(r, "rationale");
    }
  }

  return RQ_ORDER.filter((rq) => rqMap.has(rq)).map((rq) => {
    const entry = rqMap.get(rq)!;
    return {
      rq,
      rqLabel: entry.rqLabel,
      aiOutcome: entry.aiOutcome,
      aiRationale: entry.aiRationale,
      humanOutcome: entry.humanOutcome,
      humanRationale: entry.humanRationale,
    };
  });
}

export async function fetchAssessmentEvidenceByRq(
  uuid: string
): Promise<Record<string, EvidenceItem[]>> {
  const iri = resourceIri("assessment", uuid);

  const noticesSparql = `${PREFIXES}
    SELECT ?rqLocal ?noticeType ?evidTitle ?evidDoi ?evidJournal ?evidPublisher
           ?evidDate ?rationale ?rwRecordId ?retractsTitle ?retractsDoi ?aboutAuthorName
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?automatedAgent .
      ?automatedAgent a ripe:AutomatedAgent .
      ${QUESTION_VALUES}
      ?evid tido:supports ?hyp .
      VALUES ?noticeClass { ripe:RetractionNotice ripe:ExpressionOfConcern ripe:CorrectionNotice }
      ?evid a ?noticeClass .
      BIND(REPLACE(STR(?noticeClass), ".*#", "") AS ?noticeType)
      OPTIONAL { ?evid dcterms:title ?evidTitle }
      OPTIONAL { ?evid prism:doi ?evidDoi }
      OPTIONAL { ?evid prism:publicationName ?evidJournal }
      OPTIONAL {
        ?evid dcterms:publisher ?evidPublisherResource .
        OPTIONAL { ?evidPublisherResource foaf:name ?evidPublisher }
      }
      OPTIONAL { ?evid prism:publicationDate ?evidDate }
      OPTIONAL { ?evid ripe:rationale ?rationale }
      OPTIONAL { ?evid ripe:retractionWatchRecordId ?rwRecordId }
      OPTIONAL {
        ?evid cito:retracts ?retractedPub .
        OPTIONAL { ?retractedPub dcterms:title ?retractsTitle }
        OPTIONAL { ?retractedPub prism:doi ?retractsDoi }
      }
      OPTIONAL {
        ?evid ripe:concerns ?aboutAuthor .
        ?aboutAuthor foaf:name ?aboutAuthorName .
      }
    }`;

  const peerSparql = `${PREFIXES}
    SELECT ?rqLocal ?evid ?threadUrl ?commentAuthor ?commentDate ?commentText
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?automatedAgent .
      ?automatedAgent a ripe:AutomatedAgent .
      ${QUESTION_VALUES}
      ?evid tido:supports ?hyp .
      ?evid a ripe:PeerComment .
      OPTIONAL { ?evid fabio:hasURL ?threadUrl }
      OPTIONAL {
        ?evid dcterms:creator ?commentAuthorNode .
        ?commentAuthorNode foaf:name ?commentAuthor .
      }
      OPTIONAL { ?evid dcterms:date ?commentDate }
      OPTIONAL { ?evid schema:text ?commentText }
    }`;

  const registrySparql = `${PREFIXES}
    SELECT ?rqLocal ?registrationId ?registryName ?registrationLink
           ?registrationDate ?isProspective
           ?assessmentRationale
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?automatedAgent .
      ?automatedAgent a ripe:AutomatedAgent .
      ${QUESTION_VALUES}
      ?evid tido:supports ?hyp .
      ?evid a ripe:RegistryEvidence .
      OPTIONAL { ?evid ripe:registrationId ?registrationId }
      OPTIONAL { ?evid ripe:registryName ?registryName }
      OPTIONAL { ?evid ripe:registrationLink ?registrationLink }
      OPTIONAL { ?evid ripe:registrationDate ?registrationDate }
      OPTIONAL { ?evid ripe:isProspective ?isProspective }
      OPTIONAL { ?evid ripe:registrationAssessmentRationale ?assessmentRationale }
    }`;

  const studySparql = `${PREFIXES}
    SELECT ?rqLocal ?recruitmentStartDate ?recruitmentStartExtractionRationale
           ?recruitmentEndDate ?recruitmentEndExtractionRationale
           ?studyEndDate ?studyEndExtractionRationale
    WHERE {
      BIND(<${iri}> AS ?assessment)
      ?assessment a ripe:ResearchIntegrityAssessment .
      ?hyp a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?rq ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?automatedAgent .
      ?automatedAgent a ripe:AutomatedAgent .
      ${QUESTION_VALUES}
      ?evid tido:supports ?hyp .
      ?evid a ripe:StudyDesignEvidence .
      OPTIONAL { ?evid ripe:recruitmentStartDate ?recruitmentStartDate }
      OPTIONAL { ?evid ripe:recruitmentStartDateExtractionRationale ?recruitmentStartExtractionRationale }
      OPTIONAL { ?evid ripe:recruitmentEndDate ?recruitmentEndDate }
      OPTIONAL { ?evid ripe:recruitmentEndDateExtractionRationale ?recruitmentEndExtractionRationale }
      OPTIONAL { ?evid ripe:studyEndDate ?studyEndDate }
      OPTIONAL { ?evid ripe:studyEndDateExtractionRationale ?studyEndExtractionRationale }
    }`;

  const [noticeRows, peerRows, registryRows, studyRows] = await Promise.all([
    serverQuery(noticesSparql),
    serverQuery(peerSparql),
    serverQuery(registrySparql),
    serverQuery(studySparql),
  ]);

  const result: Record<string, EvidenceItem[]> = {};
  const push = (rq: string, item: EvidenceItem) => {
    if (!result[rq]) result[rq] = [];
    result[rq].push(item);
  };

  const noticeMap = new Map<string, { rq: string; item: NoticeEvidence }>();
  for (const r of noticeRows) {
    const rq = val(r, "rqLocal");
    const rid = val(r, "rwRecordId");
    const key = `${rq}:${rid || val(r, "evidDoi") || val(r, "evidTitle")}`;
    const authorName = val(r, "aboutAuthorName");

    const existing = noticeMap.get(key);
    if (existing) {
      if (authorName && !existing.item.aboutAuthorNames.includes(authorName)) {
        existing.item.aboutAuthorNames.push(authorName);
      }
    } else {
      noticeMap.set(key, {
        rq,
        item: {
          type: "notice",
          noticeType: val(r, "noticeType"),
          title: val(r, "evidTitle"),
          doi: val(r, "evidDoi"),
          journal: val(r, "evidJournal"),
          publisher: val(r, "evidPublisher"),
          date: val(r, "evidDate"),
          rationale: val(r, "rationale"),
          retractionWatchRecordId: rid,
          retractsTitle: val(r, "retractsTitle"),
          retractsDoi: val(r, "retractsDoi"),
          aboutAuthorNames: authorName ? [authorName] : [],
        },
      });
    }
  }
  for (const { rq, item } of noticeMap.values()) {
    push(rq, item);
  }

  const peerMap = new Map<string, { rq: string; item: PeerCommentEvidence }>();
  for (const r of peerRows) {
    const rq = val(r, "rqLocal");
    const evid = val(r, "evid");
    const key = `${rq}:${evid}`;
    if (peerMap.has(key)) continue;
    peerMap.set(key, {
      rq,
      item: {
        type: "peerComment",
        threadUrl: val(r, "threadUrl"),
        author: val(r, "commentAuthor"),
        date: val(r, "commentDate"),
        text: val(r, "commentText"),
      },
    });
  }
  for (const { rq, item } of peerMap.values()) {
    push(rq, item);
  }

  for (const r of registryRows) {
    push(val(r, "rqLocal"), {
      type: "registry",
      registrationId: val(r, "registrationId"),
      registryName: val(r, "registryName"),
      registrationLink: val(r, "registrationLink"),
      registrationDate: val(r, "registrationDate"),
      isProspective: val(r, "isProspective") === "true",
      assessmentRationale: val(r, "assessmentRationale"),
    });
  }

  for (const r of studyRows) {
    push(val(r, "rqLocal"), {
      type: "studyDesign",
      recruitmentStartDate: val(r, "recruitmentStartDate"),
      recruitmentStartExtractionRationale: val(r, "recruitmentStartExtractionRationale"),
      recruitmentEndDate: val(r, "recruitmentEndDate"),
      recruitmentEndExtractionRationale: val(r, "recruitmentEndExtractionRationale"),
      studyEndDate: val(r, "studyEndDate"),
      studyEndExtractionRationale: val(r, "studyEndExtractionRationale"),
    });
  }

  return result;
}

export async function fetchAuthorById(
  authorId: string
): Promise<AuthorProfile | null> {
  const sparql = `${PREFIXES}
    SELECT ?name ?sameAs
    WHERE {
      ${authorBinding(authorId)}
      ?author foaf:name ?name .
      OPTIONAL {
        ?author owl:sameAs ?sameAs .
        ${semOpenAlexAuthorFilter("?sameAs")}
      }
    }
    LIMIT 1`;

  const rows = await serverQuery(sparql);
  if (rows.length === 0) return null;
  return { name: val(rows[0], "name"), sameAs: val(rows[0], "sameAs") };
}

export async function fetchAuthorPublications(
  authorId: string
): Promise<AuthorPublicationResult[]> {
  const sparql = `${PREFIXES}
    SELECT DISTINCT ?doi ?assessment ?title ?ov
    WHERE {
      ${authorBinding(authorId)}
      ?work a ripe:Work ;
            dcterms:creator ?author .
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi ?doi .
      OPTIONAL {
        ?pd a ripe:PublicationDetails ;
            prov:wasMemberOf ?assessment ;
            ripe:concerns ?work .
        ?pd dcterms:title ?title .
      }
      OPTIONAL {
        ?ovHyp a ripe:IntegrityAssessmentHypothesis ;
               tido:answers ?ovRq ;
               ripe:resultOutcome ?ov ;
               prov:wasMemberOf ?assessment ;
               prov:wasAttributedTo ?ovAgent .
        ?ovAgent a ripe:HumanReviewer .
        FILTER(?ovRq = <${OVERALL_QUESTION_IRI}>)
      }
    }
    ORDER BY ?doi ?assessment`;

  const rows = await serverQuery(sparql);
  const pubs = new Map<
    string,
    {
      title: string;
      assessments: Set<string>;
      serious: Set<string>;
      some: Set<string>;
      none: Set<string>;
    }
  >();

  for (const r of rows) {
    const doi = val(r, "doi");
    const assessment = val(r, "assessment");
    if (!pubs.has(doi)) {
      pubs.set(doi, {
        title: val(r, "title"),
        assessments: new Set(),
        serious: new Set(),
        some: new Set(),
        none: new Set(),
      });
    }
    const pub = pubs.get(doi)!;
    pub.assessments.add(assessment);
    const outcome = val(r, "ov");
    if (outcome === "serious-concerns") pub.serious.add(assessment);
    if (outcome === "some-concerns") pub.some.add(assessment);
    if (outcome === "no-concerns") pub.none.add(assessment);
  }

  return Array.from(pubs.entries()).map(([doi, pub]) => {
    const total = pub.assessments.size;
    const serious = pub.serious.size;
    const some = pub.some.size;
    const none = pub.none.size;
    const na = total - serious - some - none;
    return {
      title: pub.title,
      doi,
      assessmentCount: total,
      outcomes: { serious, some, none, na: Math.max(0, na) },
    };
  }).sort((a, b) => b.assessmentCount - a.assessmentCount || a.doi.localeCompare(b.doi));
}

export async function fetchAuthorStats(
  authorId: string
): Promise<AuthorStatsResult> {
  const sparql = `${PREFIXES}
    SELECT (COUNT(DISTINCT ?assessment) AS ?assessments)
           (COUNT(DISTINCT ?doi) AS ?publications)
    WHERE {
      ${authorBinding(authorId)}
      ?work a ripe:Work ;
            dcterms:creator ?author .
      ?assessment a ripe:ResearchIntegrityAssessment ; ripe:assesses ?work .
      ?work prism:doi ?doi .
    }`;

  const rows = await serverQuery(sparql);
  const r = rows[0] || {};
  return {
    assessments: intVal(r, "assessments"),
    publications: intVal(r, "publications"),
  };
}
