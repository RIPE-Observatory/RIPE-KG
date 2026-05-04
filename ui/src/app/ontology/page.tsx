"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import data from "@/lib/ontology-data.json";
import type {
  OntologyClass,
  OntologyDatatypeProperty,
  OntologyInstance,
  OntologyObjectProperty,
} from "@/lib/ontology-data";
import { isLocalHref, localHrefForIri } from "@/lib/iri";

type SelectionKind = "class" | "objectProperty" | "datatypeProperty" | "instance";

type Selection = {
  id: string;
  kind: SelectionKind;
};

type SelectedTerm = ReturnType<typeof selectedTerm>;
type TermAccent = OntologyClass["category"] | "datatypeProperty" | "instance" | "objectProperty";
const CLASSES = data.classes as OntologyClass[];
const EXTERNAL_CLASSES = (data.externalClasses as OntologyClass[]).filter((cls) => !cls.id.includes(" | "));
const OBJECT_PROPERTIES = data.objectProperties as OntologyObjectProperty[];
const DATATYPE_PROPERTIES = data.datatypeProperties as OntologyDatatypeProperty[];
const INSTANCES = data.instances as OntologyInstance[];
const ALL_CLASSES = [...CLASSES, ...EXTERNAL_CLASSES];
const INITIAL_SELECTION: Selection = { id: "ResearchIntegrityAssessment", kind: "class" };

const TERM_DOTS: Record<TermAccent, string> = {
  activity: "bg-[#dbeafe] ring-1 ring-[#2563eb]",
  agent: "bg-[#dbeafe] ring-1 ring-[#2563eb]",
  assessment: "bg-[#dbeafe] ring-1 ring-[#2563eb]",
  datatypeProperty: "bg-[#bbf7d0] ring-1 ring-[#15803d]",
  entity: "bg-[#dbeafe] ring-1 ring-[#2563eb]",
  external: "bg-[#e7e5e4] ring-1 ring-[#78716c]",
  instance: "bg-[#fde68a] ring-1 ring-[#d97706]",
  objectProperty: "bg-[#fed7aa] ring-1 ring-[#c2410c]",
};

const LEGEND_ITEMS = [
  ["bg-[#dbeafe] ring-1 ring-[#2563eb]", "class"],
  ["bg-[#e7e5e4] ring-1 ring-[#78716c]", "imported class"],
  ["bg-[#fed7aa] ring-1 ring-[#c2410c]", "object property"],
  ["bg-[#bbf7d0] ring-1 ring-[#15803d]", "datatype property"],
  ["bg-[#fde68a] ring-1 ring-[#d97706]", "datatype or literal"],
  ["bg-transparent ring-2 ring-[#dc2626]", "selected/search result"],
] as const;

const PAGE_GRID_CLASSES = [
  "grid min-h-0 flex-1 overflow-hidden",
  "grid-cols-[260px_minmax(640px,1fr)_400px]",
  "max-xl:grid-cols-[240px_minmax(0,1fr)_360px]",
  "max-lg:grid-cols-[220px_minmax(0,1fr)]",
  "max-lg:[&>aside:last-child]:hidden",
].join(" ");

export default function OntologyPage() {
  const [selection, select] = useReducer(selectReducer, INITIAL_SELECTION);
  const lookup = useMemo(() => buildLookup(), []);
  const selected = selectedTerm(selection);
  const selectWithHash = useCallback((next: Selection) => {
    select(next);
    const hash = `#${encodeURIComponent(next.id)}`;
    window.history.replaceState(null, "", hash);
  }, []);

  useEffect(() => {
    function selectFromHash() {
      const localName = decodeURIComponent(window.location.hash.slice(1));
      if (!localName) return;
      const next = lookup.byIri.get(fullIri(localName));
      if (next) select(next);
    }

    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, [lookup.byIri]);

  return (
    <main className="flex h-[calc(100vh-57px)] flex-col overflow-hidden bg-[#f7f4ec]">
      <header className="shrink-0 border-b border-stone-300 bg-[#fffdf8] px-5 py-3">
        <h1 className="font-libre text-xl text-stone-950">RIPE Ontology Explorer</h1>
        <p className="font-source text-sm text-stone-600">
          {CLASSES.length} RIPE classes, {EXTERNAL_CLASSES.length} imported classes,{" "}
          {OBJECT_PROPERTIES.length} object properties, {DATATYPE_PROPERTIES.length} datatype properties, and{" "}
          {INSTANCES.length} named individuals
        </p>
      </header>

      <div className={PAGE_GRID_CLASSES}>
        <OntologyIndex onSelect={selectWithHash} selection={selection} />
        <RelationshipPanel onSelect={selectWithHash} selected={selected} />
        <DetailsPanel onSelect={selectWithHash} selected={selected} selection={selection} />
      </div>
    </main>
  );
}

function RelationshipPanel({
  onSelect,
  selected,
}: {
  onSelect: (selection: Selection) => void;
  selected: SelectedTerm;
}) {
  return (
    <section className="relative min-h-0 overflow-hidden bg-[#f1eee6]">
      <OntologyCanvas onSelect={onSelect} selected={selected} />
    </section>
  );
}

function OntologyCanvas({
  onSelect,
  selected,
}: {
  onSelect: (selection: Selection) => void;
  selected: SelectedTerm;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const lookup = useMemo(() => buildLookup(), []);
  const selectedSelection = selectionFromSelected(selected);
  const selectedIri = selectedSelection ? fullIri(selectedSelection.id) : undefined;

  useEffect(() => {
    if (!selectedIri) return;
    frameRef.current?.contentWindow?.postMessage({ source: "ripe-ontology", type: "focus", iri: selectedIri }, "*");
  }, [selectedIri]);

  useEffect(() => {
    function receiveWebVowlSelection(event: MessageEvent) {
      const message = event.data as { source?: string; type?: string; iri?: string };
      if (message.source !== "ripe-webvowl" || message.type !== "selection" || !message.iri) return;
      const next = lookup.byIri.get(message.iri);
      if (next) onSelect(next);
    }

    window.addEventListener("message", receiveWebVowlSelection);
    return () => window.removeEventListener("message", receiveWebVowlSelection);
  }, [lookup.byIri, onSelect]);

  return (
    <div className="relative h-full min-h-0 bg-[#f1eee6]">
      <iframe
        className="h-full w-full border-0"
        ref={frameRef}
        src="/webvowl/index.html"
        title="RIPE-O WebVOWL graph"
      />
    </div>
  );
}

function OntologyIndex({ onSelect, selection }: { onSelect: (selection: Selection) => void; selection: Selection }) {
  const ripeClasses = CLASSES.toSorted(byLabel);
  const objectProperties = OBJECT_PROPERTIES.toSorted(byLabel);
  const datatypeProperties = DATATYPE_PROPERTIES.toSorted(byLabel);
  const instances = INSTANCES.toSorted(byLabel);

  return (
    <aside className="min-h-0 overflow-y-auto border-r border-stone-300 bg-[#fffdf8]">
      <Legend />

      <div className="space-y-5 p-3">
        <IndexSection title="RIPE classes">
          {ripeClasses.map((cls) => (
            <IndexButton
              key={cls.id}
              active={selection.kind === "class" && selection.id === cls.id}
              dot={TERM_DOTS[cls.category]}
              label={cls.label}
              meta={qname(cls.id)}
              onClick={() => onSelect({ id: cls.id, kind: "class" })}
            />
          ))}
        </IndexSection>

        <IndexSection title="Object properties">
          {objectProperties.map((property) => (
            <IndexButton
              key={property.id}
              active={selection.kind === "objectProperty" && selection.id === property.id}
              dot={TERM_DOTS.objectProperty}
              label={property.label}
              meta={`${qname(property.domain)} -> ${qname(property.range)}`}
              onClick={() => onSelect({ id: property.id, kind: "objectProperty" })}
            />
          ))}
        </IndexSection>

        <IndexSection title="Datatype properties">
          {datatypeProperties.map((property) => {
            const id = datatypeId(property);
            return (
              <IndexButton
                key={id}
                active={selection.kind === "datatypeProperty" && selection.id === id}
                dot={TERM_DOTS.datatypeProperty}
                label={property.label}
                meta={`${qname(property.domain)} -> ${property.range}`}
                onClick={() => onSelect({ id, kind: "datatypeProperty" })}
              />
            );
          })}
        </IndexSection>

        <IndexSection title="Instances">
          {instances.map((instance) => (
            <IndexButton
              key={instance.id}
              active={selection.kind === "instance" && selection.id === instance.id}
              dot={TERM_DOTS.instance}
              label={instance.label}
              meta={qname(instance.id)}
              onClick={() => onSelect({ id: instance.id, kind: "instance" })}
            />
          ))}
        </IndexSection>

      </div>
    </aside>
  );
}

function Legend() {
  return (
    <div className="sticky top-0 z-20 border-b border-stone-200 bg-[#fffdf8] p-4">
      <h2 className="font-source text-xs font-semibold uppercase tracking-wider text-stone-500">Legend</h2>
      <div className="mt-3 grid grid-cols-1 gap-2 font-source text-xs text-stone-700">
        {LEGEND_ITEMS.map(([color, label]) => (
          <LegendItem key={label} color={color} label={label} />
        ))}
      </div>
    </div>
  );
}

function IndexSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h2 className="mb-2 px-2 font-source text-xs font-semibold uppercase tracking-wider text-stone-500">
        {title}
      </h2>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function IndexButton({
  active,
  dot,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  dot: string;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-start gap-2 px-2 py-2 text-left font-source text-sm transition ${
        active ? "bg-amber-100 text-stone-950 ring-1 ring-amber-500" : "text-stone-700 hover:bg-stone-100"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${active ? "font-semibold" : "font-medium"}`}>{label}</span>
        <span className="block truncate font-mono text-xs text-stone-500">{meta}</span>
      </span>
    </button>
  );
}

function DetailsPanel({
  onSelect,
  selected,
  selection,
}: {
  onSelect: (selection: Selection) => void;
  selected: SelectedTerm;
  selection: Selection;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-l border-stone-300 bg-[#fffdf8] p-5">
      {selection.kind === "class" && selected.classTerm ? (
        <ClassDetails cls={selected.classTerm} onSelect={onSelect} />
      ) : null}
      {selection.kind === "objectProperty" && selected.objectProperty ? (
        <ObjectPropertyDetails onSelect={onSelect} property={selected.objectProperty} />
      ) : null}
      {selection.kind === "datatypeProperty" && selected.datatypeProperty ? (
        <DatatypePropertyDetails onSelect={onSelect} property={selected.datatypeProperty} />
      ) : null}
      {selection.kind === "instance" && selected.instance ? (
        <InstanceDetails instance={selected.instance} onSelect={onSelect} />
      ) : null}
    </aside>
  );
}

function ClassDetails({ cls, onSelect }: { cls: OntologyClass; onSelect: (selection: Selection) => void }) {
  const objectOut = OBJECT_PROPERTIES.filter((property) => splitUnion(property.domain).includes(cls.id));
  const objectIn = OBJECT_PROPERTIES.filter((property) => splitUnion(property.range).includes(cls.id));
  const datatypeProperties = DATATYPE_PROPERTIES.filter((property) => splitUnion(property.domain).includes(cls.id));
  const instances = INSTANCES.filter((instance) => instance.types.includes(cls.id));

  return (
    <div className="space-y-6">
      <TermHeading category={cls.category} label={cls.label} qname={qname(cls.id)} />
      <PlainSection title="IRI">
        <ExternalIri href={fullIri(cls.id)} label={fullIri(cls.id)} />
      </PlainSection>

      {cls.comment ? (
        <PlainSection title="Description">
          <p>{cls.comment}</p>
        </PlainSection>
      ) : null}

      {cls.subClassOf.length > 0 ? (
        <PlainSection title="Subclass of">
          {cls.subClassOf.map((parent) => (
            <TermButton key={parent} onSelect={onSelect} selection={{ id: parent, kind: "class" }}>
              {qname(parent)}
            </TermButton>
          ))}
        </PlainSection>
      ) : null}

      {objectOut.length > 0 ? (
        <RelationList direction="out" properties={objectOut} onSelect={onSelect} title="Outgoing object properties" />
      ) : null}
      {objectIn.length > 0 ? (
        <RelationList direction="in" properties={objectIn} onSelect={onSelect} title="Incoming object properties" />
      ) : null}
      {datatypeProperties.length > 0 ? (
        <DatatypePropertyList onSelect={onSelect} properties={datatypeProperties} />
      ) : null}
      {instances.length > 0 ? <InstanceList instances={instances} onSelect={onSelect} /> : null}
    </div>
  );
}

function RelationList({
  direction,
  onSelect,
  properties,
  title,
}: {
  direction: "in" | "out";
  onSelect: (selection: Selection) => void;
  properties: OntologyObjectProperty[];
  title: string;
}) {
  return (
    <PlainSection title={title}>
      {properties.map((property) => (
        <button
          key={`${direction}:${property.id}`}
          className="block w-full border border-stone-200 bg-white px-3 py-2 text-left font-source text-sm transition hover:border-amber-500"
          onClick={() => onSelect({ id: property.id, kind: "objectProperty" })}
          type="button"
        >
          <span className="font-semibold text-stone-900">{property.label}</span>
          <span className="block font-mono text-xs text-stone-500">
            {direction === "in" ? `${qname(property.domain)} -> this class` : `this class -> ${qname(property.range)}`}
          </span>
        </button>
      ))}
    </PlainSection>
  );
}

function DatatypePropertyList({
  onSelect,
  properties,
}: {
  onSelect: (selection: Selection) => void;
  properties: OntologyDatatypeProperty[];
}) {
  return (
    <PlainSection title="Datatype properties">
      {properties.map((property) => {
        const id = datatypeId(property);
        return (
          <TermButton key={id} onSelect={onSelect} selection={{ id, kind: "datatypeProperty" }}>
            {qname(id)} <span className="text-stone-500">&rarr; {property.range}</span>
          </TermButton>
        );
      })}
    </PlainSection>
  );
}

function InstanceList({ instances, onSelect }: { instances: OntologyInstance[]; onSelect: (selection: Selection) => void }) {
  return (
    <PlainSection title="Instances">
      {instances.map((instance) => (
        <TermButton key={instance.id} onSelect={onSelect} selection={{ id: instance.id, kind: "instance" }}>
          {instance.label}
        </TermButton>
      ))}
    </PlainSection>
  );
}

function ObjectPropertyDetails({
  onSelect,
  property,
}: {
  onSelect: (selection: Selection) => void;
  property: OntologyObjectProperty;
}) {
  return (
    <div className="space-y-6">
      <TermHeading category="objectProperty" label={property.label} qname={qname(property.id)} />
      <PlainSection title="IRI">
        <ExternalIri href={fullIri(property.id)} label={fullIri(property.id)} />
      </PlainSection>
      {property.comment ? (
        <PlainSection title="Description">
          <p>{property.comment}</p>
        </PlainSection>
      ) : null}
      <ClassLinkList ids={splitUnion(property.domain)} onSelect={onSelect} title="Domain" />
      <ClassLinkList ids={splitUnion(property.range)} onSelect={onSelect} title="Range" />
    </div>
  );
}

function DatatypePropertyDetails({
  onSelect,
  property,
}: {
  onSelect: (selection: Selection) => void;
  property: OntologyDatatypeProperty;
}) {
  const id = datatypeId(property);

  return (
    <div className="space-y-6">
      <TermHeading category="datatypeProperty" label={property.label} qname={qname(id)} />
      <PlainSection title="IRI">
        <ExternalIri href={fullIri(id)} label={fullIri(id)} />
      </PlainSection>
      {property.comment ? (
        <PlainSection title="Description">
          <p>{property.comment}</p>
        </PlainSection>
      ) : null}
      <ClassLinkList ids={[property.domain]} onSelect={onSelect} title="Domain" />
      <PlainSection title="Range">
        <p className="font-mono text-sm">{property.range}</p>
      </PlainSection>
    </div>
  );
}

function InstanceDetails({ instance, onSelect }: { instance: OntologyInstance; onSelect: (selection: Selection) => void }) {
  return (
    <div className="space-y-6">
      <TermHeading category="instance" label={instance.label} qname={qname(instance.id)} />
      <PlainSection title="IRI">
        <ExternalIri href={fullIri(instance.id)} label={fullIri(instance.id)} />
      </PlainSection>
      {instance.comment ? (
        <PlainSection title="Description">
          <p>{instance.comment}</p>
        </PlainSection>
      ) : null}
      <ClassLinkList ids={instance.types} onSelect={onSelect} title="rdf:type" />
    </div>
  );
}

function ClassLinkList({
  ids,
  onSelect,
  title,
}: {
  ids: string[];
  onSelect: (selection: Selection) => void;
  title: string;
}) {
  return (
    <PlainSection title={title}>
      {ids.map((id) => (
        <TermButton key={id} onSelect={onSelect} selection={{ id, kind: "class" }}>
          {qname(id)}
        </TermButton>
      ))}
    </PlainSection>
  );
}

function TermHeading({
  category,
  label,
  qname: termQname,
}: {
  category: TermAccent;
  label: string;
  qname: string;
}) {
  return (
    <div>
      <div className={`mb-3 h-1.5 w-16 ${TERM_DOTS[category]}`} />
      <h2 className="break-all font-libre text-2xl leading-tight text-stone-950">{label}</h2>
      <p className="mt-1 break-words font-mono text-sm text-stone-500">{termQname}</p>
    </div>
  );
}

function PlainSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section>
      <h3 className="mb-2 font-source text-xs font-semibold uppercase tracking-wider text-stone-500">{title}</h3>
      <div className="space-y-2 font-source text-sm leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

function TermButton({
  children,
  onSelect,
  selection,
}: {
  children: ReactNode;
  onSelect: (selection: Selection) => void;
  selection: Selection;
}) {
  return (
    <button
      className="mr-2 mt-1 inline-flex border border-stone-300 bg-white px-2 py-1 font-source text-sm text-stone-800 transition hover:border-amber-600 hover:text-amber-900"
      onClick={() => onSelect(selection)}
      type="button"
    >
      {children}
    </button>
  );
}

function ExternalIri({ href, label }: { href: string; label: string }) {
  const localHref = localHrefForIri(href);
  const isLocal = isLocalHref(localHref);
  return (
    <a
      className="break-all font-mono text-xs text-amber-800 underline decoration-amber-400 underline-offset-4"
      href={localHref}
      rel={isLocal ? undefined : "noreferrer"}
      target={isLocal ? undefined : "_blank"}
    >
      {label}
    </a>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function selectReducer(current: Selection, next: Selection) {
  return sameSelection(current, next) ? current : next;
}

function sameSelection(left: Selection, right: Selection) {
  return left.id === right.id && left.kind === right.kind;
}

function buildLookup() {
  const byIri = new Map<string, Selection>();

  for (const cls of ALL_CLASSES) byIri.set(fullIri(cls.id), { id: cls.id, kind: "class" });
  for (const property of OBJECT_PROPERTIES) byIri.set(fullIri(property.id), { id: property.id, kind: "objectProperty" });
  for (const property of DATATYPE_PROPERTIES) {
    const id = datatypeId(property);
    byIri.set(fullIri(id), { id, kind: "datatypeProperty" });
  }
  for (const instance of INSTANCES) byIri.set(fullIri(instance.id), { id: instance.id, kind: "instance" });

  return { byIri };
}

function selectedTerm(selection: Selection) {
  return {
    classTerm: selection.kind === "class" ? ALL_CLASSES.find((cls) => cls.id === selection.id) : undefined,
    datatypeProperty:
      selection.kind === "datatypeProperty" ? DATATYPE_PROPERTIES.find((property) => datatypeId(property) === selection.id) : undefined,
    instance: selection.kind === "instance" ? INSTANCES.find((instance) => instance.id === selection.id) : undefined,
    objectProperty:
      selection.kind === "objectProperty" ? OBJECT_PROPERTIES.find((property) => property.id === selection.id) : undefined,
  };
}

function selectionFromSelected(selected: SelectedTerm): Selection | undefined {
  if (selected.classTerm) return { id: selected.classTerm.id, kind: "class" };
  if (selected.objectProperty) return { id: selected.objectProperty.id, kind: "objectProperty" };
  if (selected.datatypeProperty) return { id: datatypeId(selected.datatypeProperty), kind: "datatypeProperty" };
  if (selected.instance) return { id: selected.instance.id, kind: "instance" };
  return undefined;
}

function byLabel<T extends { label: string }>(left: T, right: T) {
  return left.label.localeCompare(right.label);
}

function splitUnion(value: string) {
  return value.split("|").map((item) => item.trim()).filter(Boolean);
}

function datatypeId(property: OntologyDatatypeProperty) {
  return property.prefix === "ripe" ? property.id : `${property.prefix}:${property.id}`;
}

function qname(id: string): string {
  if (id.includes(" | ")) return splitUnion(id).map(qname).join(" | ");
  if (id.includes(":")) return id;
  return `ripe:${id}`;
}

function fullIri(id: string) {
  if (id.startsWith("ripe:")) return `https://w3id.org/ripe/ripe-o#${id.slice(5)}`;
  if (!id.includes(":")) return `https://w3id.org/ripe/ripe-o#${id}`;

  const [prefix, local] = id.split(":", 2);
  const base: Record<string, string> = {
    cito: "http://purl.org/spar/cito/",
    dcterms: "http://purl.org/dc/terms/",
    fabio: "http://purl.org/spar/fabio/",
    foaf: "http://xmlns.com/foaf/0.1/",
    org: "http://www.w3.org/ns/org#",
    owl: "http://www.w3.org/2002/07/owl#",
    prov: "http://www.w3.org/ns/prov#",
    sd: "https://w3id.org/okn/o/sd#",
    tido: "https://w3id.org/tido#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };

  return base[prefix] ? `${base[prefix]}${local}` : id;
}
