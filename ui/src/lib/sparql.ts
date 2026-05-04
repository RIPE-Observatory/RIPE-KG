const SPARQL_API = "/api/sparql";

import { type SparqlBinding } from "./sparql-types";
export type { SparqlBinding };

export interface SparqlResults {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

export async function executeSparqlQuery(query: string): Promise<SparqlResults> {
  const response = await fetch(SPARQL_API, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: query,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const detail = errorData.details ? `: ${errorData.details}` : "";
    throw new Error(`${errorData.error || `SPARQL query failed: ${response.status}`}${detail}`);
  }

  return response.json();
}

export interface CompetencyQuestion {
  id: string;
  title: string;
  query: string;
}

export const COMPETENCY_QUESTIONS: CompetencyQuestion[] = [
      {
        id: "CQ1",
        title: "What research work has been assessed?",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX prov:     <http://www.w3.org/ns/prov#>
PREFIX prism:    <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX dcterms:  <http://purl.org/dc/terms/>

SELECT DISTINCT ?work ?doi ?title ?publicationDate ?journal WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?publication a ripe:PublicationDetails ;
               prov:wasMemberOf ?assessment ;
               dcterms:title ?title .
  OPTIONAL { ?work prism:doi ?doi }
  OPTIONAL { ?publication prism:publicationDate ?publicationDate }
  OPTIONAL { ?publication prism:publicationName ?journal }
}
ORDER BY DESC(BOUND(?doi)) ?doi ?title ?work
LIMIT 3`,
      },
      {
        id: "CQ2",
        title: "What assessments, when, and by whom have been performed for this work?",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:   <https://w3id.org/tido#>
PREFIX prov:   <http://www.w3.org/ns/prov#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>

SELECT DISTINCT ?assessment ?started ?ended ?agent WHERE {
  ?work prism:doi "10.1016/j.jad.2017.12.049" .
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?evaluation a tido:Evaluation ;
              tido:contributesTo ?assessment ;
              prov:startedAtTime ?started ;
              prov:endedAtTime ?ended ;
              prov:wasAssociatedWith ?agent .
}
ORDER BY ?started ?assessment ?agent
LIMIT 3`,
      },
      {
        id: "CQ3",
        title: "What published third-party evidence, including retraction notices, expressions of concern, corrections, or peer comments, has been used to assess the work?",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:   <https://w3id.org/tido#>
PREFIX prov:   <http://www.w3.org/ns/prov#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX fabio:  <http://purl.org/spar/fabio/>

SELECT DISTINCT ?evidence ?type ?evidenceDoi ?date ?recordId ?url WHERE {
  ?work prism:doi "10.3109/14767058.2014.954241" .
  ?assessment ripe:assesses ?work .
  ?evaluation a tido:Evaluation ;
              tido:contributesTo ?assessment ;
              prov:used ?evidence .
  VALUES ?type {
    ripe:RetractionNotice
    ripe:ExpressionOfConcern
    ripe:CorrectionNotice
    ripe:PeerComment
  }
  ?evidence a ?type .
  OPTIONAL { ?evidence prism:doi ?evidenceDoi }
  OPTIONAL { ?evidence prism:publicationDate ?date }
  OPTIONAL { ?evidence ripe:retractionWatchRecordId ?recordId }
  OPTIONAL { ?evidence fabio:hasURL ?url }
}
ORDER BY ?type ?evidence
LIMIT 3`,
      },
      {
        id: "CQ4",
        title: "What authors of this assessed work have been associated with retraction notices for other works?",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX prism:    <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX dcterms:  <http://purl.org/dc/terms/>
PREFIX foaf:     <http://xmlns.com/foaf/0.1/>
PREFIX cito:     <http://purl.org/spar/cito/>

SELECT DISTINCT ?authorName (COUNT(DISTINCT ?otherWork) AS ?retractedWorks) WHERE {
  ?work prism:doi "10.1016/j.jad.2017.12.049" ;
        dcterms:creator ?author .
  ?author foaf:name ?authorName .
  ?notice a ripe:RetractionNotice ;
          ripe:concerns ?author ;
          cito:retracts ?otherWork .
  FILTER(?otherWork != ?work)
}
GROUP BY ?authorName
ORDER BY DESC(?retractedWorks) ?authorName
LIMIT 3`,
      },
      {
        id: "CQ5",
        title: "Is the assessed work retrospectively registered and what evidence has been assessed to support this?",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX prov:   <http://www.w3.org/ns/prov#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>

SELECT DISTINCT ?assessment ?trialId ?registryName ?registrationDate ?isProspective ?rationale ?recruitmentStartDate ?studyEndDate WHERE {
  ?work prism:doi "10.1016/j.jacl.2015.12.017" .
  ?assessment ripe:assesses ?work .
  ?registry a ripe:RegistryEvidence ;
            prov:wasMemberOf ?assessment ;
            ripe:registrationId ?trialId ;
            ripe:registryName ?registryName ;
            ripe:registrationDate ?registrationDate ;
            ripe:isProspective ?isProspective ;
            ripe:registrationAssessmentRationale ?rationale .
  ?studyDesign a ripe:StudyDesignEvidence ;
               prov:wasMemberOf ?assessment ;
               ripe:recruitmentStartDate ?recruitmentStartDate .
  OPTIONAL { ?studyDesign ripe:studyEndDate ?studyEndDate }
}
ORDER BY ?assessment
`,
      },
      {
        id: "CQ6",
        title: "What are the automated and human-reviewed outcomes for each integrity question associated with this assessed work?",
        query: `PREFIX ripe:  <https://w3id.org/ripe/ripe-o#>
PREFIX tido:  <https://w3id.org/tido#>
PREFIX prov:  <http://www.w3.org/ns/prov#>
PREFIX prism: <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX rdfs:  <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?assessment ?question ?automatedOutcome ?humanOutcome ?humanRationale WHERE {
  ?work prism:doi "10.1001/jamanetworkopen.2019.14393" .
  ?assessment ripe:assesses ?work .
  ?questionNode a ripe:IntegrityAssessmentQuestion ;
                rdfs:label ?question .
  ?automated a ripe:IntegrityAssessmentHypothesis ;
             tido:answers ?questionNode ;
             ripe:resultOutcome ?automatedOutcome ;
             prov:wasMemberOf ?assessment ;
             prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?reviewed a ripe:IntegrityAssessmentHypothesis ;
            tido:answers ?questionNode ;
            ripe:resultOutcome ?humanOutcome ;
            prov:wasMemberOf ?assessment ;
            prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  OPTIONAL { ?reviewed ripe:rationale ?humanRationale }
}
ORDER BY ?assessment ?question
LIMIT 3`,
      },
      {
        id: "CQ7",
        title: "For which integrity questions did the human reviewer disagree with the automated outcome, and why?",
        query: `PREFIX ripe:   <https://w3id.org/ripe/ripe-o#>
PREFIX tido:   <https://w3id.org/tido#>
PREFIX prov:   <http://www.w3.org/ns/prov#>
PREFIX prism:  <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX rdfs:   <http://www.w3.org/2000/01/rdf-schema#>

SELECT DISTINCT ?assessment ?doi ?question ?automatedOutcome ?humanOutcome ?humanRationale WHERE {
  ?assessment ripe:assesses ?work .
  ?work prism:doi ?doi .
  ?questionNode a ripe:IntegrityAssessmentQuestion ;
                rdfs:label ?question .
  ?automated a ripe:IntegrityAssessmentHypothesis ;
             tido:answers ?questionNode ;
             ripe:resultOutcome ?automatedOutcome ;
             prov:wasMemberOf ?assessment ;
             prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?reviewed a ripe:IntegrityAssessmentHypothesis ;
            tido:answers ?questionNode ;
            ripe:resultOutcome ?humanOutcome ;
            ripe:rationale ?humanRationale ;
            prov:wasMemberOf ?assessment ;
            prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  FILTER(?automatedOutcome != ?humanOutcome)
}
ORDER BY ?doi ?question ?assessment
LIMIT 3`,
      },
      {
        id: "CQ8",
        title: "What is the human-validated overall integrity assessment for this work?",
        query: `PREFIX ripe:      <https://w3id.org/ripe/ripe-o#>
PREFIX tido:      <https://w3id.org/tido#>
PREFIX prov:      <http://www.w3.org/ns/prov#>
PREFIX prism:     <http://prismstandard.org/namespaces/basic/3.0/>

SELECT DISTINCT ?assessment ?overallOutcome ?overallRationale WHERE {
  ?work prism:doi "10.1111/bjdp.12503" .
  ?assessment ripe:assesses ?work .
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?overall a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?overallQuestion ;
           ripe:resultOutcome ?overallOutcome ;
           prov:wasMemberOf ?assessment ;
           prov:wasAttributedTo ?reviewer .
  ?reviewer a ripe:HumanReviewer .
  OPTIONAL { ?overall ripe:rationale ?overallRationale }
}
ORDER BY ?assessment
LIMIT 3`,
      },
      {
        id: "CQ9",
        title: "Which authors are associated with works where integrity assessment identified concerns?",
        query: `PREFIX ripe:      <https://w3id.org/ripe/ripe-o#>
PREFIX tido:      <https://w3id.org/tido#>
PREFIX prov:      <http://www.w3.org/ns/prov#>
PREFIX dcterms:   <http://purl.org/dc/terms/>
PREFIX foaf:      <http://xmlns.com/foaf/0.1/>

SELECT DISTINCT ?authorName (COUNT(DISTINCT ?work) AS ?publicationCount) WHERE {
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?overall a ripe:IntegrityAssessmentHypothesis ;
           tido:answers ?overallQuestion ;
           ripe:resultOutcome ?outcome ;
           prov:wasAttributedTo ?reviewer ;
           prov:wasMemberOf ?assessment .
  VALUES ?outcome { "some-concerns" "serious-concerns" }
  ?reviewer a ripe:HumanReviewer .
  ?assessment ripe:assesses ?work .
  ?work dcterms:creator ?author .
  ?author foaf:name ?authorName .
}
GROUP BY ?authorName
ORDER BY DESC(?publicationCount) ?authorName
LIMIT 3`,
      },
      {
        id: "CQ10",
        title: "Which works were assessed by this reviewer?",
        query: `PREFIX ripe:     <https://w3id.org/ripe/ripe-o#>
PREFIX tido:     <https://w3id.org/tido#>
PREFIX prov:     <http://www.w3.org/ns/prov#>
PREFIX prism:    <http://prismstandard.org/namespaces/basic/3.0/>
PREFIX dcterms:  <http://purl.org/dc/terms/>

SELECT DISTINCT ?assessment ?doi ?title WHERE {
  <https://w3id.org/ripe/ripe-kg/human-reviewer/RV014> a ripe:HumanReviewer .
  ?evaluation a tido:Evaluation ;
              prov:wasAssociatedWith <https://w3id.org/ripe/ripe-kg/human-reviewer/RV014> ;
              tido:contributesTo ?assessment .
  ?assessment ripe:assesses ?work .
  OPTIONAL { ?work prism:doi ?doi }
  OPTIONAL { ?work dcterms:title ?title }
}
ORDER BY ?doi ?assessment
LIMIT 3
`,
      },
];

export const DEFAULT_QUERY = COMPETENCY_QUESTIONS[0]?.query ?? "";
