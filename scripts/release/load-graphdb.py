#!/usr/bin/env python3
"""Create an immutable version repository; refuse to replace any existing one."""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from graphdb_config import render

ROOT = Path(__file__).resolve().parents[2]
RELEASES = json.loads((ROOT / "ui/src/lib/releases.json").read_text())
ONTOLOGY_SHA256 = "21b1d993ac1d794b51354d3197433b40402f13380686d409d1defb6c5b94a8b4"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", choices=RELEASES, required=True)
    parser.add_argument("--base", default="http://localhost:7200")
    args = parser.parse_args()
    release = RELEASES[args.version]
    repository = "ripe-" + args.version.replace(".", "-")
    base = args.base.rstrip("/")
    endpoint = f"/repositories/{repository}"

    def request(
        path, method="GET", data=None, content_type="application/json", timeout=180
    ):
        req = urllib.request.Request(
            base + path,
            data=data,
            method=method,
            headers={"Content-Type": content_type, "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read()

    files = [
        (
            ROOT / "ui/public/data" / args.version / "ripe-data.ttl",
            release["data_sha256"],
        ),
        (ROOT / "knowledge/ripe.ttl", ONTOLOGY_SHA256),
    ]
    for path, expected in files:
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise SystemExit(f"Checksum mismatch: {path}")
    existing = json.loads(request("/rest/repositories"))
    if any(item["id"] == repository for item in existing):
        raise SystemExit(f"Refusing to replace existing repository {repository}")

    boundary = "ripe_release_configuration"
    payload = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="config"; filename="repository.ttl"\r\n'
        f"Content-Type: text/turtle\r\n\r\n{render(repository)}\r\n--{boundary}--\r\n"
    ).encode()
    request(
        "/rest/repositories",
        "POST",
        payload,
        f"multipart/form-data; boundary={boundary}",
    )
    print(f"Created {repository}", flush=True)
    for path, _ in reversed(files):
        request(endpoint + "/statements", "POST", path.read_bytes(), "text/turtle")
        print(f"Loaded {path.name}", flush=True)

    query = """PREFIX ripe: <https://w3id.org/ripe/ripe-o#>
SELECT (COUNT(DISTINCT ?a) AS ?assessments) (COUNT(DISTINCT ?w) AS ?publications)
WHERE { ?a a ripe:ResearchIntegrityAssessment, <https://w3id.org/tido#Case>; ripe:assesses ?w }"""

    def verify():
        result = json.loads(
            request(endpoint, "POST", query.encode(), "application/sparql-query")
        )
        row = result["results"]["bindings"][0]
        assert int(row["assessments"]["value"]) == release["assessments"], row
        assert int(row["publications"]["value"]) == release["publications"], row

    verify()
    explicit = json.loads(
        request(
            endpoint,
            "POST",
            b"SELECT (COUNT(*) AS ?n) FROM <http://www.ontotext.com/explicit> WHERE { ?s ?p ?o }",
            "application/sparql-query",
        )
    )
    assert (
        int(explicit["results"]["bindings"][0]["n"]["value"])
        == release["data_triples"] + 179
    ), explicit
    config = json.loads(request(f"/rest/repositories/{repository}"))
    config["params"]["readOnly"]["value"] = "true"
    request(f"/rest/repositories/{repository}", "PUT", json.dumps(config).encode())
    # Saving the setting does not change the running repository's write mode.
    request(f"/rest/repositories/{repository}/restart", "POST", b"")
    for attempt in range(15):
        try:
            verify()
            break
        except (urllib.error.URLError, AssertionError):
            if attempt == 14:
                raise
            time.sleep(1)
    config = json.loads(request(f"/rest/repositories/{repository}"))["params"]
    for key, expected in {
        "readOnly": "true",
        "ruleset": "owl2-rl",
        "disableSameAs": "true",
        "queryTimeout": "30",
        "throwQueryEvaluationExceptionOnTimeout": "true",
        "queryLimitResults": "100000",
        "imports": "",
    }.items():
        assert config[key]["value"] == expected, (key, config[key])
    # An empty update cannot change data, but must still be rejected as read-only.
    try:
        request(endpoint + "/statements", "POST", b"INSERT DATA {}", "application/sparql-update")
    except urllib.error.HTTPError as error:
        if error.code != 500 or b"Repository in read-only mode" not in error.read():
            raise
    else:
        raise RuntimeError(f"Repository {repository} still accepts writes")
    print(
        f"Verified {args.version}: {release['assessments']} assessments, {release['publications']} publications, inference, read-only configuration"
    )


if __name__ == "__main__":
    main()
