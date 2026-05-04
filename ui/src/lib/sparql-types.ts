export interface SparqlBinding {
  [key: string]: {
    type: string;
    value: string;
    datatype?: string;
  };
}

export const PREFIXES = `
PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX tido:    <https://w3id.org/tido#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX foaf:    <http://xmlns.com/foaf/0.1/>
PREFIX cito:    <http://purl.org/spar/cito/>
PREFIX dbo:     <http://dbpedia.org/ontology/>
PREFIX fabio:   <http://purl.org/spar/fabio/>
PREFIX owl:     <http://www.w3.org/2002/07/owl#>
PREFIX schema:  <https://schema.org/>
`;

export function val(b: SparqlBinding, key: string): string {
  return b[key]?.value ?? "";
}

export function intVal(b: SparqlBinding, key: string): number {
  return Number.parseInt(val(b, key), 10) || 0;
}

export function esc(s: string): string {
  return s
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t");
}

export interface PublicationSearchResult {
  title: string;
  doi: string;
  journal: string;
  assessmentCount: number;
}

export interface AuthorSearchResult {
  name: string;
  authorId: string;
  sameAs: string;
  assessmentCount: number;
  pubCount: number;
}

export interface SearchStats {
  assessments: number;
  publications: number;
  authors: number;
  evidence: number;
}

export interface PublicationMeta {
  title: string;
  doi: string;
  journal: string;
  publisher: string;
  pubDate: string;
  startingPage: string;
  endingPage: string;
  issn: string;
  eissn: string;
}

export interface AuthorForPub {
  name: string;
  authorId: string;
  sameAs: string;
}

export interface AssessmentOutcome {
  rq: string;
  ai: string;
  human: string;
}

export interface AssessmentForPublication {
  assessmentId: string;
  reviewerName: string;
  reviewerRole: string;
  assessedAt: string;
  outcomes: AssessmentOutcome[];
  overallHuman: string;
}

export interface ReviewerProfile {
  id: string;
  role: string;
}

export interface ReviewerAssessment {
  assessmentId: string;
  pubTitle: string;
  pubDoi: string;
  assessedAt: string;
  overallOutcome: string;
}

export interface AssessmentHeader {
  assessmentId: string;
  pubTitle: string;
  pubDoi: string;
  reviewerName: string;
  reviewerRole: string;
  assessedAt: string;
  overallOutcome: string;
  peerCommentUrl?: string;
}

export interface HypothesisRow {
  rq: string;
  rqLabel: string;
  aiOutcome: string;
  aiRationale: string;
  humanOutcome: string;
  humanRationale: string;
}

// Evidence discriminated union
export type EvidenceItem =
  | NoticeEvidence
  | PeerCommentEvidence
  | RegistryEvidence
  | StudyDesignEvidence;

export interface NoticeEvidence {
  type: "notice";
  noticeType: string;
  title: string;
  doi: string;
  journal: string;
  publisher: string;
  date: string;
  rationale: string;
  retractionWatchRecordId: string;
  retractsTitle: string;
  retractsDoi: string;
  aboutAuthorNames: string[];
}

export interface PeerCommentEvidence {
  type: "peerComment";
  threadUrl: string;
  author: string;
  date: string;
  text: string;
}

export interface RegistryEvidence {
  type: "registry";
  registrationId: string;
  registryName: string;
  registrationLink: string;
  registrationDate: string;
  isProspective: boolean;
  assessmentRationale: string;
}

export interface StudyDesignEvidence {
  type: "studyDesign";
  recruitmentStartDate: string;
  recruitmentStartExtractionRationale: string;
  recruitmentEndDate: string;
  recruitmentEndExtractionRationale: string;
  studyEndDate: string;
  studyEndExtractionRationale: string;
}

export interface AuthorProfile {
  name: string;
  sameAs: string;
}

export interface OutcomeBreakdown {
  serious: number;
  some: number;
  none: number;
  na: number;
}

export interface AuthorPublicationResult {
  title: string;
  doi: string;
  assessmentCount: number;
  outcomes: OutcomeBreakdown;
}

export interface AuthorStatsResult {
  assessments: number;
  publications: number;
}

export const RQ_META: Record<string, { label: string; question: string }> = {
  "retraction-question": {
    label: "Q1.1",
    question: "Does the study have an associated retraction?",
  },
  "post-publication-question": {
    label: "Q1.2",
    question:
      "Does the study have an associated expression of concern or other relevant post-publication notice?",
  },
  "research-team-question": {
    label: "Q1.3",
    question:
      "Do other studies by the research team highlight causes for concern?",
  },
  "registration-question": {
    label: "Q2.2",
    question: "Are there concerns relating to the timing or absence of study registration?",
  },
  "overall-question": {
    label: "Overall",
    question: "What is the overall integrity assessment of the study?",
  },
};

export const RQ_ORDER = [
  "retraction-question",
  "post-publication-question",
  "research-team-question",
  "registration-question",
  "overall-question",
];

export const RQ_IRIS: Record<(typeof RQ_ORDER)[number], string> = {
  "retraction-question":
    "https://w3id.org/ripe/ripe-kg/integrity-assessment-question/retraction-status/1.0.0",
  "post-publication-question":
    "https://w3id.org/ripe/ripe-kg/integrity-assessment-question/post-publication-notices/1.0.0",
  "research-team-question":
    "https://w3id.org/ripe/ripe-kg/integrity-assessment-question/research-team-related-concerns/1.0.0",
  "registration-question":
    "https://w3id.org/ripe/ripe-kg/integrity-assessment-question/study-registration/1.0.0",
  "overall-question":
    "https://w3id.org/ripe/ripe-kg/overall-integrity-assessment-question/1.0.0",
};
