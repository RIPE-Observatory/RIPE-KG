export interface OntologyClass {
  id: string;
  label: string;
  comment: string;
  subClassOf: string[];
  color: string;
  category: "assessment" | "activity" | "agent" | "entity" | "external";
}

export interface OntologyObjectProperty {
  id: string;
  label: string;
  comment: string;
  domain: string;
  range: string;
  source?: string;
  subPropertyOf?: string;
}

export interface OntologyDatatypeProperty {
  id: string;
  label: string;
  comment: string;
  domain: string;
  range: string;
  prefix: string;
}

export interface OntologyInstance {
  id: string;
  label: string;
  comment?: string;
  types: string[];
}
