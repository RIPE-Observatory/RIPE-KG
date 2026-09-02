import { releasePath, type KgVersion } from "./versions";

import { type SparqlBinding } from "./sparql-types";
export type { SparqlBinding };

export interface SparqlResults {
  head: { vars?: string[] };
  results?: { bindings: SparqlBinding[] };
  boolean?: boolean;
  metadata?: { rowLimit: number; limitReached: boolean };
}

export async function executeSparqlQuery(query: string, version?: KgVersion): Promise<SparqlResults> {
  const response = await fetch(version ? releasePath(version, "/api/sparql") : "/api/sparql", {
    method: "POST",
    headers: {
      "Content-Type": "application/sparql-query",
    },
    body: query,
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const detail = errorData.details ? `: ${errorData.details}` : "";
    throw new Error(`${errorData.error || `SPARQL query failed: ${response.status}`}${detail}`);
  }

  return response.json();
}

export interface QueryGroup {
  label: string;
  queries: { name: string; query: string }[];
}

export const QUERY_GROUPS: QueryGroup[] = [
  {
    label: "Overview",
    queries: [
      {
        name: "Assessed Works",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?assessment ?work ?doi ?title ?publicationDate ?journal
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  OPTIONAL { ?work dcterms:title ?title }
  OPTIONAL {
    ?publication a ripe:PublicationDetails ;
                 prov:wasMemberOf ?assessment .
    OPTIONAL { ?publication dcterms:title ?title }
    OPTIONAL { ?publication prism:publicationDate ?publicationDate }
    OPTIONAL { ?publication prism:publicationName ?journal }
  }
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
      {
        name: "Overall Integrity Assessments",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:  <https://w3id.org/tido#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?assessment ?doi ?reviewer ?humanOutcome ?humanRationale
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?hypothesis a ripe:IntegrityAssessmentHypothesis ;
              tido:answers ?overallQuestion ;
              ripe:resultOutcome ?humanOutcome ;
              prov:wasMemberOf ?assessment ;
              prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  OPTIONAL { ?hypothesis ripe:rationale ?humanRationale }
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
      {
        name: "Evidence Used per Assessment",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:  <https://w3id.org/tido#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?assessment ?doi
       (COUNT(DISTINCT ?notice) AS ?notices)
       (COUNT(DISTINCT ?comment) AS ?peerComments)
       (COUNT(DISTINCT ?registry) AS ?registryEvidence)
       (COUNT(DISTINCT ?studyDesign) AS ?studyDesignEvidence)
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?evaluation a tido:Evaluation ;
              tido:contributesTo ?assessment .
  OPTIONAL {
    ?evaluation prov:used ?notice .
    VALUES ?noticeType { ripe:RetractionNotice ripe:ExpressionOfConcern ripe:CorrectionNotice }
    ?notice a ?noticeType .
  }
  OPTIONAL { ?evaluation prov:used ?comment . ?comment a ripe:PeerComment }
  OPTIONAL { ?evaluation prov:used ?registry . ?registry a ripe:RegistryEvidence }
  OPTIONAL { ?evaluation prov:used ?studyDesign . ?studyDesign a ripe:StudyDesignEvidence }
}
GROUP BY ?assessment ?doi
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
    ],
  },
  {
    label: "Automated vs Human",
    queries: [
      {
        name: "Outcome Disagreements",
        query: `PREFIX ripe:  <https://w3id.org/ripe/ripe-o#>
PREFIX tido: <https://w3id.org/tido#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?assessment ?questionLabel ?automatedOutcome ?humanOutcome ?humanRationale
WHERE {
  ?question a ripe:IntegrityAssessmentQuestion ;
            rdfs:label ?questionLabel .
  ?automatedHypothesis a ripe:IntegrityAssessmentHypothesis ;
                       tido:answers ?question ;
                       ripe:resultOutcome ?automatedOutcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis a ripe:IntegrityAssessmentHypothesis ;
                   tido:answers ?question ;
                   ripe:resultOutcome ?humanOutcome ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  OPTIONAL { ?humanHypothesis ripe:rationale ?humanRationale }
  FILTER(?automatedOutcome != ?humanOutcome)
}
ORDER BY ?assessment ?questionLabel
LIMIT 10`,
      },
      {
        name: "Agreement by Question",
        query: `PREFIX ripe:  <https://w3id.org/ripe/ripe-o#>
PREFIX tido: <https://w3id.org/tido#>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?questionLabel
       (COUNT(*) AS ?comparisons)
       (SUM(IF(?automatedOutcome = ?humanOutcome, 1, 0)) AS ?agreements)
       (SUM(IF(?automatedOutcome != ?humanOutcome, 1, 0)) AS ?disagreements)
WHERE {
  ?question a ripe:IntegrityAssessmentQuestion ;
            rdfs:label ?questionLabel .
  ?automatedHypothesis a ripe:IntegrityAssessmentHypothesis ;
                       tido:answers ?question ;
                       ripe:resultOutcome ?automatedOutcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis a ripe:IntegrityAssessmentHypothesis ;
                   tido:answers ?question ;
                   ripe:resultOutcome ?humanOutcome ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
}
GROUP BY ?questionLabel
ORDER BY ?questionLabel`,
      },
    ],
  },
  {
    label: "Evidence",
    queries: [
      {
        name: "Third-Party Evidence",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:  <https://w3id.org/tido#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX fabio: <http://purl.org/spar/fabio/>

SELECT DISTINCT ?assessment ?doi ?evidence ?evidenceType ?evidenceDoi ?url
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?evaluation a tido:Evaluation ;
              tido:contributesTo ?assessment ;
              prov:used ?evidence .
  VALUES ?evidenceType { ripe:RetractionNotice ripe:ExpressionOfConcern ripe:CorrectionNotice ripe:PeerComment }
  ?evidence a ?evidenceType .
  OPTIONAL { ?evidence prism:doi ?evidenceDoi }
  OPTIONAL { ?evidence fabio:hasURL ?url }
}
ORDER BY ?doi ?assessment ?evidenceType
LIMIT 10`,
      },
      {
        name: "Registration Timing Evidence",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?assessment ?doi ?registryName ?registrationId ?registrationDate ?isProspective ?recruitmentStartDate
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?registry a ripe:RegistryEvidence ;
            prov:wasMemberOf ?assessment ;
            ripe:concerns ?work .
  OPTIONAL { ?registry ripe:registryName ?registryName }
  OPTIONAL { ?registry ripe:registrationId ?registrationId }
  OPTIONAL { ?registry ripe:registrationDate ?registrationDate }
  OPTIONAL { ?registry ripe:isProspective ?isProspective }
  OPTIONAL {
    ?studyDesign a ripe:StudyDesignEvidence ;
                 prov:wasMemberOf ?assessment ;
                 ripe:concerns ?work .
    OPTIONAL { ?studyDesign ripe:recruitmentStartDate ?recruitmentStartDate }
  }
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
      {
        name: "Peer Comments",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:  <https://w3id.org/tido#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX fabio: <http://purl.org/spar/fabio/>

SELECT ?assessment ?doi ?comment ?url
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?evaluation a tido:Evaluation ;
              tido:contributesTo ?assessment ;
              prov:used ?comment .
  ?comment a ripe:PeerComment .
  OPTIONAL { ?comment fabio:hasURL ?url }
}
ORDER BY ?doi ?assessment ?comment
LIMIT 10`,
      },
    ],
  },
  {
    label: "Authors",
    queries: [
      {
        name: "Authors with Concerns",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX tido:    <https://w3id.org/tido#>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX foaf:    <http://xmlns.com/foaf/0.1/>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>

SELECT DISTINCT ?author ?authorName ?doi ?outcome
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi ;
        dcterms:creator ?author .
  ?author foaf:name ?authorName .
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?hypothesis a ripe:IntegrityAssessmentHypothesis ;
              tido:answers ?overallQuestion ;
              ripe:resultOutcome ?outcome ;
              prov:wasMemberOf ?assessment ;
              prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  VALUES ?outcome { "some-concerns" "serious-concerns" }
}
ORDER BY ?authorName ?doi
LIMIT 10`,
      },
      {
        name: "Author Retraction Associations",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX foaf:    <http://xmlns.com/foaf/0.1/>
PREFIX cito:    <http://purl.org/spar/cito/>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?doi ?authorName (COUNT(DISTINCT ?otherWork) AS ?retractedWorks)
WHERE {
  ?work prism:doi ?doi ;
        dcterms:creator ?author .
  ?author foaf:name ?authorName .
  ?notice a ripe:RetractionNotice ;
          ripe:concerns ?author ;
          cito:retracts ?otherWork .
  FILTER(?otherWork != ?work)
}
GROUP BY ?doi ?authorName
ORDER BY DESC(?retractedWorks) ?authorName
LIMIT 10`,
      },
      {
        name: "Co-Author Pairs",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX foaf:    <http://xmlns.com/foaf/0.1/>

SELECT ?authorNameA ?authorNameB (COUNT(DISTINCT ?work) AS ?sharedWorks)
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work dcterms:creator ?authorA, ?authorB .
  ?authorA foaf:name ?authorNameA .
  ?authorB foaf:name ?authorNameB .
  FILTER(STR(?authorA) < STR(?authorB))
}
GROUP BY ?authorNameA ?authorNameB
ORDER BY DESC(?sharedWorks) ?authorNameA ?authorNameB
LIMIT 10`,
      },
    ],
  },
  {
    label: "Reviewers",
    queries: [
      {
        name: "Reviewer Workload",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX tido:    <https://w3id.org/tido#>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX dbo:     <http://dbpedia.org/ontology/>

SELECT ?reviewer ?reviewerId ?role (COUNT(DISTINCT ?assessment) AS ?assessments)
WHERE {
  ?reviewer a ripe:HumanReviewer .
  OPTIONAL { ?reviewer dcterms:identifier ?reviewerId }
  OPTIONAL { ?reviewer dbo:occupation ?role }
  ?evaluation a tido:Evaluation ;
              prov:wasAssociatedWith ?reviewer ;
              tido:contributesTo ?assessment .
  ?assessment a ripe:ResearchIntegrityAssessment .
}
GROUP BY ?reviewer ?reviewerId ?role
ORDER BY DESC(?assessments) ?reviewerId
LIMIT 10`,
      },
      {
        name: "Works Reviewed by Reviewer",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX tido:    <https://w3id.org/tido#>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>

SELECT ?assessment ?doi ?title
WHERE {
  VALUES ?reviewerId { "RV001" }
  ?reviewer a ripe:HumanReviewer ;
            dcterms:identifier ?reviewerId .
  ?evaluation a tido:Evaluation ;
              prov:wasAssociatedWith ?reviewer ;
              tido:contributesTo ?assessment .
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi .
  OPTIONAL { ?work dcterms:title ?title }
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
    ],
  },
  {
    label: "SemOpenAlex",
    queries: [
      {
        name: "Linked Works",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX owl:    <http://www.w3.org/2002/07/owl#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX dcterms:<http://purl.org/dc/terms/>

SELECT ?assessment ?doi ?title ?semOpenAlexWork
WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi ;
        owl:sameAs ?semOpenAlexWork .
  FILTER(STRSTARTS(STR(?semOpenAlexWork), "https://semopenalex.org/"))
  OPTIONAL { ?work dcterms:title ?title }
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
      {
        name: "Federated Work Concepts",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX owl:    <http://www.w3.org/2002/07/owl#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX soa:    <https://semopenalex.org/ontology/>
PREFIX skos:   <http://www.w3.org/2004/02/skos/core#>

SELECT DISTINCT ?assessment ?doi ?semOpenAlexWork ?concept ?conceptLabel
WHERE {
  SERVICE <https://semopenalex.org/sparql> {
    BIND(<https://semopenalex.org/concept/C168563851> AS ?concept)
    ?semOpenAlexWork soa:hasConcept ?concept .
    ?concept skos:prefLabel ?conceptLabel .
  }

  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work prism:doi ?doi ;
        owl:sameAs ?semOpenAlexWork .
  FILTER(STRSTARTS(STR(?semOpenAlexWork), "https://semopenalex.org/"))
}
ORDER BY ?doi ?assessment
LIMIT 10`,
      },
    ],
  },
];
