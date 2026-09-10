#!/usr/bin/env python3
"""Exercise a running release-aware UI/API."""

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

from rdflib import RDF, Graph, Namespace
from rdflib.compare import isomorphic

ROOT = Path(__file__).resolve().parents[2]
RELEASES = json.loads((ROOT / "ui/src/lib/releases.json").read_text())
RIPE = Namespace("https://w3id.org/ripe/ripe-o#")
KG = "https://w3id.org/ripe/ripe-kg/"
FORMATS = {
    "text/turtle": ("ttl", "turtle"),
    "application/ld+json": ("jsonld", "json-ld"),
    "application/rdf+xml": ("rdf", "xml"),
    "application/n-triples": ("nt", "nt"),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:13000")
    parser.add_argument("--client-ip", help="Trusted client header for an isolated test origin")
    args = parser.parse_args()
    opener = urllib.request.build_opener(NoRedirect)
    timings = []
    checks = 0

    def get(
        path,
        status=200,
        accept="text/html",
        data=None,
        extra=None,
        method=None,
    ):
        nonlocal checks
        headers = {"Accept": accept, **({"CF-Connecting-IP": args.client_ip} if args.client_ip else {}), **(extra or {})}
        if data is not None:
            headers.setdefault("Content-Type", "application/sparql-query")
            data = data.encode()
        request = urllib.request.Request(
            args.base + path, data=data, headers=headers, method=method
        )
        start = time.perf_counter()
        try:
            response = opener.open(request, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            assert response.status == status, (
                path,
                response.status,
                status,
                body[:250],
            )
            timings.append((path, round(1000 * (time.perf_counter() - start), 1)))
            checks += 1
            return response.headers, body

    graphs = {
        v: Graph().parse(ROOT / f"ui/public/data/{v}/ripe-data.ttl") for v in RELEASES
    }
    assessments = {
        v: set(g.subjects(RDF.type, RIPE.ResearchIntegrityAssessment))
        for v, g in graphs.items()
    }
    added = sorted(assessments["1.1.0"] - assessments["1.0.0"])[0]
    shared = sorted(assessments["1.0.0"] & assessments["1.1.0"])[0]
    shared_id = str(shared).rsplit("/", 1)[-1]
    count_query = "PREFIX ripe: <https://w3id.org/ripe/ripe-o#> SELECT (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a a ripe:ResearchIntegrityAssessment }"

    for version, release in RELEASES.items():
        prefix = f"/{version}"
        headers, _ = get(prefix)
        assert headers["X-RIPE-KG-Version"] == version
        assert "Accept" in headers.get("Vary", "")
        for mime, (ext, format_name) in FORMATS.items():
            headers, _ = get(prefix, 303, accept=mime)
            assert headers["Location"] == f"/data/{version}/ripe-data.{ext}"
            headers, body = get(headers["Location"], accept=mime)
            assert headers["X-RIPE-KG-Version"] == version
            assert headers["Content-Type"].split(";")[0] == mime
            assert isomorphic(
                graphs[version], Graph().parse(data=body, format=format_name)
            )
            if ext == "ttl":
                assert hashlib.sha256(body).hexdigest() == release["data_sha256"]
        get(prefix, 406, accept="image/png")
        headers, body = get(prefix + "/api/health", accept="application/json")
        assert json.loads(body)["ok"] is True
        assert headers["X-RIPE-KG-Version"] == version
        for endpoint in [prefix + "/api/sparql", "/api/sparql?version=" + version]:
            headers, body = get(endpoint, data=count_query, accept="application/json")
            assert json.loads(body)["results"]["bindings"][0]["n"]["value"] == str(
                release["assessments"]
            )
            assert json.loads(body)["metadata"] == {
                "rowLimit": 100000,
                "limitReached": False,
            }
            assert headers["X-RIPE-Result-Limit"] == "100000"
            assert headers["X-RIPE-Result-Limit-Reached"] == "false"
            assert (
                "x-ripe-result-limit-reached"
                in headers["Access-Control-Expose-Headers"].lower()
            )
            assert headers["X-RIPE-KG-Version"] == version
        _, body = get(
            prefix + "/api/sparql?query=" + urllib.parse.quote("ASK {}"),
            accept="application/json",
        )
        assert json.loads(body)["boolean"] is True
        assert "metadata" not in json.loads(body)
        # Exercise the backend cap, not just the UI's interpretation of a mock.
        values = " ".join(map(str, range(317)))
        pattern = f"WHERE {{ VALUES ?x {{ {values} }} VALUES ?y {{ {values} }} }}"
        _, body = get(prefix + "/api/sparql", data="SELECT (COUNT(*) AS ?n) " + pattern)
        assert json.loads(body)["results"]["bindings"][0]["n"]["value"] == "100489"
        headers, body = get(prefix + "/api/sparql", data="SELECT ?x ?y " + pattern)
        capped = json.loads(body)
        assert len(capped["results"]["bindings"]) == 100000
        assert capped["metadata"] == {"rowLimit": 100000, "limitReached": True}
        assert headers["X-RIPE-Result-Limit-Reached"] == "true"
        del capped, body
        headers, body = get(
            prefix + "/api/sparql?query=" + urllib.parse.quote("ASK {}"), method="HEAD"
        )
        assert not body and headers["X-RIPE-KG-Version"] == version
        _, body = get(
            prefix + "/api/sparql",
            data="query=ASK+%7B%7D",
            accept="application/json",
            extra={"Content-Type": "Application/X-Www-Form-Urlencoded ; charset=UTF-8"},
        )
        assert json.loads(body)["boolean"] is True
        headers, _ = get(prefix + "/api/sparql", 204, method="OPTIONS")
        assert headers["Access-Control-Allow-Origin"] == "*"
        headers, body = get(prefix + "/explore")
        html = body.decode()
        assert f">{release['assessments']}</span>" in html
        displayed = {
            label: value
            for value, label in re.findall(
                r"<dd[^>]*>([^<]+)</dd><dt[^>]*>([^<]+)</dt>", html
            )
        }
        graph = graphs[version]
        coverage = {
            "Publications": len(
                {
                    work
                    for assessment in assessments[version]
                    for work in graph.objects(assessment, RIPE.assesses)
                }
            ),
            "Authors": len(set(graph.subjects(RDF.type, RIPE.Author))),
            "Evidence items": len(
                {
                    subject
                    for kind in (
                        "PeerComment",
                        "RegistryEvidence",
                        "StudyDesignEvidence",
                        "RetractionNotice",
                        "ExpressionOfConcern",
                        "CorrectionNotice",
                    )
                    for subject in graph.subjects(RDF.type, RIPE[kind])
                }
            ),
        }
        assert displayed == {
            label: f"{count:,}" for label, count in coverage.items()
        }, (version, displayed, coverage)
        assert f'href="{prefix}/sparql"' in html
        assert "digest" not in html
        for page in [
            "/sparql",
            "/ontology",
            "/assessments/" + str(shared).split("/")[-1],
        ]:
            headers, body = get(prefix + page)
            assert headers["X-RIPE-KG-Version"] == version
            for href in re.findall(r'href="([^"]+)"', body.decode()):
                assert not re.match(
                    r"^/(explore|sparql|assessments|authors|reviewers|publications|ripe-kg)(/|$)",
                    href,
                ), (page, href)
        for resource in [shared, added]:
            suffix = str(resource).removeprefix(KG)
            status = 404 if resource == added and version == "1.0.0" else 200
            path = prefix + "/ripe-kg/" + suffix
            headers, body = get(path, status)
            assert headers["X-RIPE-KG-Version"] == version
            assert f'href="{prefix}"' in body.decode()
            for mime, (_, format_name) in FORMATS.items():
                headers, body = get(path, status, accept=mime)
                if status == 200:
                    result = Graph().parse(data=body, format=format_name)
                    assert (
                        resource,
                        RDF.type,
                        RIPE.ResearchIntegrityAssessment,
                    ) in result
                    assert all(
                        str(s).find("/releases/") == -1 for s in result.subjects()
                    )
        for mime in ["text/html", *FORMATS]:
            headers, _ = get(f"/ripe-kg/{version}", 307, accept=mime)
            assert (
                urljoin(args.base, headers["Location"])
                == args.base.rstrip("/") + prefix
            )
            assert headers["X-RIPE-KG-Version"] == version
        headers, _ = get(f"/ripe-kg/{version}/api/sparql", 307, data=count_query)
        assert (
            urljoin(args.base, headers["Location"])
            == args.base.rstrip("/") + prefix + "/api/sparql"
        )
        headers, _ = get(
            f"/ripe-kg/{version}/research-integrity-assessment/{shared_id}", 307
        )
        assert (
            urljoin(args.base, headers["Location"])
            == args.base.rstrip("/")
            + prefix
            + "/ripe-kg/research-integrity-assessment/"
            + shared_id
        )
        for suffix in ["", "/explore", "/sparql", "/api/health"]:
            headers, _ = get(f"/releases/{version}{suffix}", 307)
            destination = prefix + ("" if suffix == "/explore" else suffix)
            assert urljoin(args.base, headers["Location"]) == args.base.rstrip("/") + destination
        headers, _ = get(f"/releases/{version}/api/sparql", 307, data=count_query)
        assert urljoin(args.base, headers["Location"]) == args.base.rstrip("/") + prefix + "/api/sparql"
        print(
            f"PASS {version}: downloads, API methods, counts, HTML links, shared/new resources in four RDF formats"
        )

    # Regressions from the end-to-end review: missing publications and redirects.
    _, body = get("/1.0.0/publications/10.1002%2Fgin2.70056", 404)
    assert b"This version does not contain this publication." in body
    _, body = get("/1.1.0/publications/10.1002%2Fgin2.70056")
    assert b"Planetary Health" in body
    get("/1.1.0/publications/%25", 404)
    for path in ["/", "/ripe-kg", "/?version=1.0.0"]:
        headers, _ = get(path, 307 if "?" in path else 303, accept="text/turtle")
        assert headers["Access-Control-Allow-Origin"] == "*"
    for version, graph in graphs.items():
        # Check every identifier the former encodeURIComponent implementation lost.
        resources = sorted({str(s) for s in graph.subjects() if str(s).startswith(KG) and "%28" in str(s)})
        for resource in resources:
            path = f"/{version}/ripe-kg/" + resource.removeprefix(KG)
            get(path)
            for mime, (_, format_name) in FORMATS.items():
                _, body = get(path, accept=mime)
                result = Graph().parse(data=body, format=format_name)
                assert any(str(s) == resource or str(o) == resource for s, _, o in result)
        print(f"PASS {version}: {len(resources)} parenthesized identifiers in HTML and all RDF formats")
    _, body = get("/1.1.0/ripe-kg/automated-agent/inspect-ai/1.0.0")
    assert b"Showing the first 500 statements" in body

    # The proxy must replace, not trust, caller-provided routing headers.
    headers, body = get(
        "/1.0.0/api/sparql",
        data=count_query,
        extra={"X-RIPE-KG-Version": "1.1.0"},
    )
    assert json.loads(body)["results"]["bindings"][0]["n"]["value"] == "140"
    headers, _ = get("/9.9.9/api/sparql", 404, data="ASK {}")
    assert headers["Access-Control-Allow-Origin"] == "*"
    get("/ripe-kg/9.9.9", 404)
    for path in ["", "/sparql", "/api/health", "/api/sparql", "/ripe-kg/work/example"]:
        get("/not-a-version" + path, 404)
    get("/ripe-kg/1.0.0/api/sparql?version=1.1.0", 400, data="ASK {}")
    headers, _ = get("/api/sparql?version=9.9.9", 400, data="ASK {}")
    assert headers["Access-Control-Allow-Origin"] == "*"
    get("/api/sparql?version=1.0.0&version=1.1.0", 400, data="ASK {}")
    get("/1.0.0/api/sparql?version=1.1.0", 400, data="ASK {}")
    get(
        "/1.0.0/api/sparql",
        400,
        data="INSERT DATA { <urn:a> <urn:b> <urn:c> }",
    )
    get(
        "/1.0.0/api/sparql",
        400,
        data="SELECT * { SERVICE # comment\n <http://127.0.0.1/> { ?s ?p ?o } }",
    )
    headers, body = get("/api/sparql", data=count_query)
    assert headers["X-RIPE-KG-Version"] == "1.1.0"
    assert json.loads(body)["results"]["bindings"][0]["n"]["value"] == "185"
    headers, _ = get("/", 303)
    assert urljoin(args.base, headers["Location"]) == args.base.rstrip("/") + "/1.1.0"
    assert headers["X-RIPE-KG-Version"] == "1.1.0"
    for path in ["/explore", "/sparql"]:
        headers, body = get(path)
        assert headers["X-RIPE-KG-Version"] == "1.1.0"
        assert 'href="/1.1.0"' in body.decode()

    print(f"PASS {checks} HTTP checks; slowest responses (including RDF transfer):")
    for path, ms in sorted(timings, key=lambda entry: -entry[1])[:8]:
        print(f"  {ms:7.1f} ms {path}")


if __name__ == "__main__":
    main()
