#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${SPARQL_ENDPOINT:-http://localhost:7200/repositories/ripe}"

PREFIXES='
PREFIX ripe:    <https://w3id.org/ripe/ripe-o#>
PREFIX tido:    <https://w3id.org/tido#>
PREFIX prov:    <http://www.w3.org/ns/prov#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX owl:     <http://www.w3.org/2002/07/owl#>
PREFIX rdfs:    <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prism:   <http://prismstandard.org/namespaces/basic/3.0/>
'

query() {
  printf '\n## %s\n' "$1"
  curl --fail --show-error --silent --max-time 120 \
    -X POST "$ENDPOINT" \
    -H 'Content-Type: application/sparql-query' \
    -H 'Accept: text/csv' \
    --data "$PREFIXES
$2"
}

printf '\n## External-reviewer assessment traces\n'
jq -r '
  ["assessmentTraces", "distinctPublications"],
  [
    ([.assessments[] | select(.reviewer_rv_id >= "RV001" and .reviewer_rv_id <= "RV012")] | length),
    ([.assessments[] | select(.reviewer_rv_id >= "RV001" and .reviewer_rv_id <= "RV012") | .work_uri] | unique | length)
  ]
  | @csv
' assessments/assessments_yarrrml.json

query "Assessments in RIPE-KG" '
SELECT (COUNT(DISTINCT ?assessment) AS ?assessments) WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment .
}
'

query "Assessed publications in RIPE-KG" '
SELECT (COUNT(DISTINCT ?work) AS ?assessedPublications) WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
}
'

query "Author entities in RIPE-KG" '
SELECT (COUNT(DISTINCT ?author) AS ?authors) WHERE {
  ?author a ripe:Author .
}
'

query "Research integrity hypotheses in RIPE-KG" '
SELECT (COUNT(DISTINCT ?hypothesis) AS ?hypotheses) WHERE {
  ?hypothesis a ripe:IntegrityAssessmentHypothesis .
}
'

printf '\n## GROBID publication-author mentions\n'
jq -r '
  ["publicationAuthorMentions"],
  [([.assessments[].results.checks.grobid_primary_metadata.payload.main_authors[]] | length)]
  | @csv
' assessments/assessments_enriched.json

query "Distinct RIPE authors of assessed publications" '
SELECT (COUNT(DISTINCT ?author) AS ?authors) WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work dcterms:creator ?author .
}
'

query "Assessed-publication authors linked to SemOpenAlex" '
SELECT (COUNT(DISTINCT ?author) AS ?authors) WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work dcterms:creator ?author .
  ?author owl:sameAs ?sameAs .
  FILTER(STRSTARTS(STR(?sameAs), "https://semopenalex.org/author/"))
}
'

query "Automated and human-reviewed question pairs" '
SELECT (COUNT(DISTINCT ?humanHypothesis) AS ?questionPairs) WHERE {
  ?question rdfs:label ?questionText .
  VALUES ?questionText {
    "1.1. Does the study have an associated retraction?"
    "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
    "1.3. Do other studies by the research team highlight causes for concern?"
    "2.2. Are there concerns relating to the timing or absence of study registration?"
  }
  ?automatedHypothesis tido:answers ?question ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis tido:answers ?question ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
}
'

query "Automated and human-reviewed agreements" '
SELECT (COUNT(DISTINCT ?humanHypothesis) AS ?agreements) WHERE {
  ?question rdfs:label ?questionText .
  VALUES ?questionText {
    "1.1. Does the study have an associated retraction?"
    "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
    "1.3. Do other studies by the research team highlight causes for concern?"
    "2.2. Are there concerns relating to the timing or absence of study registration?"
  }
  ?automatedHypothesis tido:answers ?question ;
                       ripe:resultOutcome ?outcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis tido:answers ?question ;
                   ripe:resultOutcome ?outcome ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
}
'

query "Automated and human-reviewed disagreements" '
SELECT (COUNT(DISTINCT ?humanHypothesis) AS ?disagreements) WHERE {
  ?question rdfs:label ?questionText .
  VALUES ?questionText {
    "1.1. Does the study have an associated retraction?"
    "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
    "1.3. Do other studies by the research team highlight causes for concern?"
    "2.2. Are there concerns relating to the timing or absence of study registration?"
  }
  ?automatedHypothesis tido:answers ?question ;
                       ripe:resultOutcome ?automatedOutcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis tido:answers ?question ;
                   ripe:resultOutcome ?humanOutcome ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
  FILTER(?automatedOutcome != ?humanOutcome)
}
'

query "Automated and human-reviewed disagreements by question" '
SELECT ?questionText
       (COUNT(DISTINCT ?humanHypothesis) AS ?questionPairs)
       (COUNT(DISTINCT ?disagreement) AS ?disagreements)
WHERE {
  ?question rdfs:label ?questionText .
  VALUES ?questionText {
    "1.1. Does the study have an associated retraction?"
    "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
    "1.3. Do other studies by the research team highlight causes for concern?"
    "2.2. Are there concerns relating to the timing or absence of study registration?"
  }
  ?automatedHypothesis tido:answers ?question ;
                       ripe:resultOutcome ?automatedOutcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis tido:answers ?question ;
                   ripe:resultOutcome ?humanOutcome ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
  OPTIONAL {
    ?humanHypothesis ripe:resultOutcome ?differentHumanOutcome .
    FILTER(?automatedOutcome != ?differentHumanOutcome)
    BIND(?humanHypothesis AS ?disagreement)
  }
}
GROUP BY ?questionText
ORDER BY ?questionText
'

query "Works reviewed more than once" '
SELECT (COUNT(*) AS ?worksReviewedMoreThanOnce) WHERE {
  SELECT ?work WHERE {
    ?assessment a ripe:ResearchIntegrityAssessment ;
                ripe:assesses ?work .
  }
  GROUP BY ?work
  HAVING(COUNT(DISTINCT ?assessment) > 1)
}
'

query "Repeated works with the same overall human outcome" '
SELECT (COUNT(*) AS ?works) WHERE {
  SELECT ?work WHERE {
    ?assessment a ripe:ResearchIntegrityAssessment ;
                ripe:assesses ?work .
    ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
    ?hypothesis tido:answers ?overallQuestion ;
                ripe:resultOutcome ?overallOutcome ;
                prov:wasMemberOf ?assessment ;
                prov:wasAttributedTo ?humanReviewer .
    ?humanReviewer a ripe:HumanReviewer .
  }
  GROUP BY ?work
  HAVING(COUNT(DISTINCT ?assessment) > 1 && COUNT(DISTINCT ?overallOutcome) = 1)
}
'

query "Repeated works with different overall human outcomes" '
SELECT (COUNT(*) AS ?works) WHERE {
  SELECT ?work WHERE {
    ?assessment a ripe:ResearchIntegrityAssessment ;
                ripe:assesses ?work .
    ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
    ?hypothesis tido:answers ?overallQuestion ;
                ripe:resultOutcome ?overallOutcome ;
                prov:wasMemberOf ?assessment ;
                prov:wasAttributedTo ?humanReviewer .
    ?humanReviewer a ripe:HumanReviewer .
  }
  GROUP BY ?work
  HAVING(COUNT(DISTINCT ?assessment) > 1 && COUNT(DISTINCT ?overallOutcome) > 1)
}
'

query "Repeated works: individual-question agreement" '
SELECT ?questionText (COUNT(*) AS ?cases) WHERE {
  SELECT ?work ?question ?questionText WHERE {
    ?assessment a ripe:ResearchIntegrityAssessment ;
                ripe:assesses ?work .
    ?question rdfs:label ?questionText .
    VALUES ?questionText {
      "1.1. Does the study have an associated retraction?"
      "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
      "1.3. Do other studies by the research team highlight causes for concern?"
      "2.2. Are there concerns relating to the timing or absence of study registration?"
    }
    ?hypothesis tido:answers ?question ;
                ripe:resultOutcome ?humanOutcome ;
                prov:wasMemberOf ?assessment ;
                prov:wasAttributedTo ?humanReviewer .
    ?humanReviewer a ripe:HumanReviewer .
  }
  GROUP BY ?work ?question ?questionText
  HAVING(COUNT(DISTINCT ?assessment) > 1 && COUNT(DISTINCT ?humanOutcome) = 1)
}
GROUP BY ?questionText
ORDER BY ?questionText
'

query "Repeated works: individual-question cases" '
SELECT ?questionText (COUNT(*) AS ?cases) WHERE {
  SELECT ?work ?question ?questionText WHERE {
    ?assessment a ripe:ResearchIntegrityAssessment ;
                ripe:assesses ?work .
    ?question rdfs:label ?questionText .
    VALUES ?questionText {
      "1.1. Does the study have an associated retraction?"
      "1.2. Does the study have an associated expression of concern or other relevant post-publication notice?"
      "1.3. Do other studies by the research team highlight causes for concern?"
      "2.2. Are there concerns relating to the timing or absence of study registration?"
    }
    ?hypothesis tido:answers ?question ;
                ripe:resultOutcome ?humanOutcome ;
                prov:wasMemberOf ?assessment ;
                prov:wasAttributedTo ?humanReviewer .
    ?humanReviewer a ripe:HumanReviewer .
  }
  GROUP BY ?work ?question ?questionText
  HAVING(COUNT(DISTINCT ?assessment) > 1)
}
GROUP BY ?questionText
ORDER BY ?questionText
'

query "Repeated example DOI 10.1111/bjdp.12503" '
SELECT ?doi
       (COUNT(DISTINCT ?assessment) AS ?humanReviewedAssessments)
       (COUNT(DISTINCT ?overallOutcome) AS ?overallOutcomeCategories)
       (GROUP_CONCAT(DISTINCT ?overallOutcome; separator=", ") AS ?outcomes)
WHERE {
  ?work prism:doi "10.1111/bjdp.12503" .
  BIND("10.1111/bjdp.12503" AS ?doi)
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?hypothesis tido:answers ?overallQuestion ;
              ripe:resultOutcome ?overallOutcome ;
              prov:wasMemberOf ?assessment ;
              prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
}
GROUP BY ?doi
'

query "Table 2 sample rows" '
SELECT DISTINCT ?assessment ?questionText ?automatedOutcome ?humanOutcome ?humanRationale WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment .
  ?question a ripe:IntegrityAssessmentQuestion ;
            rdfs:label ?questionText .
  ?automatedHypothesis tido:answers ?question ;
                       ripe:resultOutcome ?automatedOutcome ;
                       prov:wasMemberOf ?assessment ;
                       prov:wasAttributedTo ?automatedAgent .
  ?automatedAgent a ripe:AutomatedAgent .
  ?humanHypothesis tido:answers ?question ;
                   ripe:resultOutcome ?humanOutcome ;
                   ripe:rationale ?humanRationale ;
                   prov:wasMemberOf ?assessment ;
                   prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
  FILTER(?automatedOutcome != ?humanOutcome && STR(?humanRationale) != "")
}
ORDER BY ?assessment ?questionText
LIMIT 3
'

query "Table 3 SemOpenAlex Endocrinology rows" '
SELECT DISTINCT ?work ?doi ?title ?overallOutcome WHERE {
  ?assessment a ripe:ResearchIntegrityAssessment ;
              ripe:assesses ?work .
  ?work owl:sameAs ?soaWork .
  OPTIONAL { ?work prism:doi ?doi }
  OPTIONAL { ?work dcterms:title ?title }
  SERVICE <https://semopenalex.org/sparql> {
    ?soaWork <https://semopenalex.org/ontology/hasConcept> <https://semopenalex.org/concept/C134018914> .
  }
  ?overallQuestion a ripe:OverallIntegrityAssessmentQuestion .
  ?overallHypothesis tido:answers ?overallQuestion ;
                     ripe:resultOutcome ?overallOutcome ;
                     prov:wasMemberOf ?assessment ;
                     prov:wasAttributedTo ?humanReviewer .
  ?humanReviewer a ripe:HumanReviewer .
}
ORDER BY ?doi ?overallOutcome
LIMIT 3
'
