import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { negotiate } from "../src/lib/content-negotiation";
import { isKgVersion, legacyReleasePath, versionedHref, stripReleasePath } from "../src/lib/versions";
import { MAX_RESULT_ROWS, validateQuery } from "../src/lib/query-policy";
import { QUERY_GROUPS } from "../src/lib/sparql";

test("API completeness boundary matches the GraphDB repository limit", () => {
  const config = readFileSync(new URL("../../graphdb-config/repository-config.ttl", import.meta.url), "utf8");
  assert.equal(Number(config.match(/graphdb:query-limit-results "(\d+)"/)?.[1]), MAX_RESULT_ROWS);
});

test("content negotiation observes quality, specificity and exclusions", () => {
  for (const value of [null, "", "*/*", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"]) {
    assert.equal(negotiate(value), "text/html");
  }
  assert.equal(negotiate("text/turtle"), "text/turtle");
  assert.equal(negotiate("text/html;q=0.5, application/ld+json;q=0.9"), "application/ld+json");
  assert.equal(negotiate("text/html;q=0,*/*;q=1"), "text/turtle");
  assert.equal(negotiate("text/*;q=1,text/html;q=0,text/turtle;q=0"), null);
  assert.equal(negotiate("image/png"), null);
  assert.equal(negotiate("text/turtle;q=0"), null);
  assert.equal(negotiate("text/turtle;q=2"), null);
});

test("version links preserve entity IDs, query strings and fragments", () => {
  assert.equal(versionedHref("/ripe-kg/author/RIPEAU1234?x=1#part", "1.0.0"), "/releases/1.0.0/ripe-kg/author/RIPEAU1234?x=1#part");
  assert.equal(versionedHref("/publications/10.123%2Ftest", "1.0.0"), "/releases/1.0.0/publications/10.123%2Ftest");
  assert.equal(versionedHref("/", "1.1.0"), "/releases/1.1.0/explore");
  for (const path of ["https://example.org/", "//example.org/", "/ripe-o/1.0.0", "/webvowl/index.html", "/releases/1.0.0/explore"]) {
    assert.equal(versionedHref(path, "1.1.0"), path);
  }
  assert.equal(stripReleasePath("/releases/1.0.0/explore"), "/explore");
  for (const value of ["1.2.0", "1.1", "__proto__", "constructor", "../ripe"]) assert.equal(isKgVersion(value), false);
});

test("all bundled sample queries parse as read-only SPARQL", () => {
  for (const group of QUERY_GROUPS) {
    for (const sample of group.queries) assert.equal(validateQuery(sample.query), null, sample.name);
  }
});

test("legacy release destinations retain snapshot and resource paths", () => {
  assert.equal(legacyReleasePath("/ripe-kg/1.0.0"), "/releases/1.0.0");
  assert.equal(legacyReleasePath("/ripe-kg/1.1.0/"), "/releases/1.1.0");
  assert.equal(legacyReleasePath("/ripe-kg/1.0.0/api/sparql"), "/releases/1.0.0/api/sparql");
  assert.equal(legacyReleasePath("/ripe-kg/1.1.0/explore"), "/releases/1.1.0/explore");
  assert.equal(legacyReleasePath("/ripe-kg/1.0.0/work/10.123%2Fexample"), "/releases/1.0.0/ripe-kg/work/10.123%2Fexample");
  assert.equal(legacyReleasePath("/ripe-kg/9.9.9"), "/releases/9.9.9");
  assert.equal(legacyReleasePath("/ripe-kg/work/10.123/example"), null);
  assert.equal(legacyReleasePath("/releases/1.0.0"), null);
});

test("ASK and keyword text are valid; updates and malformed queries are rejected", () => {
  assert.equal(validateQuery("ASK {}"), null);
  assert.equal(validateQuery('SELECT ?x { BIND("DELETE LOAD SERVICE" AS ?x) }'), null);
  for (const query of ["INSERT DATA { <urn:a> <urn:b> <urn:c> }", "DROP ALL", "SELECT ?x {", "CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }", ""]) assert.ok(validateQuery(query));
});

test("SERVICE cannot escape the allowlist through comments, prefixes or nesting", () => {
  assert.equal(validateQuery("SELECT * { SERVICE # comment\n <https://semopenalex.org/sparql> { ?s ?p ?o } }"), null);
  assert.ok(validateQuery("PREFIX soa: <https://semopenalex.org/> SELECT * { SERVICE soa:sparql { ?s ?p ?o } }"));
  for (const query of [
    "SELECT * { SERVICE # comment\n <http://127.0.0.1:7200/repositories/ripe-1-1-0> { ?s ?p ?o } }",
    "PREFIX ex: <http://127.0.0.1/> SELECT * { SERVICE ex:sparql { ?s ?p ?o } }",
    "SELECT * { SERVICE ?endpoint { ?s ?p ?o } }",
    "SELECT * { { SELECT * { SERVICE SILENT <http://localhost/> { ?s ?p ?o } } } }",
  ]) assert.ok(validateQuery(query), query);
});
