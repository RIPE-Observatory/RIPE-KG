/**
 * RIPE-O ontology metadata for the UI.
 *
 * Pure data lives in ontology-data.json; this module re-exports it with
 * TypeScript types and convenience helpers.
 */

import data from "./ontology-data.json";

export interface OntologyClass {
  id: string;
  label: string;
  comment: string;
  subClassOf: string[];
  color: string;
  category:
    | "assessment"
    | "activity"
    | "agent"
    | "entity"
    | "external";
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
  prefix: string; // ripe, foaf, schema, prism, dcterms, soa, dbo, dbp, prov
}

export interface OntologyInstance {
  id: string;
  label: string;
  comment?: string;
  types: string[];
}

export interface OntologyEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  type: "subClassOf" | "objectProperty" | "instanceOf";
}

export const ONTOLOGY_CLASSES = data.classes as OntologyClass[];
export const ONTOLOGY_INSTANCES = data.instances as OntologyInstance[];
export const ONTOLOGY_OBJECT_PROPERTIES = data.objectProperties as OntologyObjectProperty[];
export const ONTOLOGY_DATATYPE_PROPERTIES = data.datatypeProperties as OntologyDatatypeProperty[];
export const ONTOLOGY_EXTERNAL_CLASSES = data.externalClasses as OntologyClass[];
export const ONTOLOGY_EDGES = data.edges as OntologyEdge[];
export const ONTOLOGY_META = data.meta;

export function getClassById(id: string): OntologyClass | undefined {
  return ONTOLOGY_CLASSES.find((c) => c.id === id);
}

export function getInstanceById(id: string): OntologyInstance | undefined {
  return ONTOLOGY_INSTANCES.find((i) => i.id === id);
}

export function getClassesByCategory(
  category: OntologyClass["category"]
): OntologyClass[] {
  return ONTOLOGY_CLASSES.filter((c) => c.category === category);
}

export function getPropertiesForClass(classId: string): OntologyDatatypeProperty[] {
  return ONTOLOGY_DATATYPE_PROPERTIES.filter((p) => p.domain === classId);
}

export function getDirectSubclasses(parentId: string): OntologyClass[] {
  return ONTOLOGY_CLASSES.filter((c) => c.subClassOf.includes(parentId));
}

export function getOutgoingEdges(nodeId: string): OntologyEdge[] {
  return ONTOLOGY_EDGES.filter((e) => e.source === nodeId);
}

export function getIncomingEdges(nodeId: string): OntologyEdge[] {
  return ONTOLOGY_EDGES.filter((e) => e.target === nodeId);
}
