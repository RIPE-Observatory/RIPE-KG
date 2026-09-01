#!/usr/bin/env python3
"""Build static RDF distributions from checksum-pinned releases, never from GraphDB."""

import hashlib
import json
import subprocess
from pathlib import Path

from rdflib import Graph
from rdflib.compare import isomorphic

ROOT = Path(__file__).resolve().parents[2]
RELEASES = json.loads((ROOT / "ui/src/lib/releases.json").read_text())


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    for version, release in RELEASES.items():
        commit, expected = release["source_commit"], release["data_sha256"]
        source = (
            subprocess.check_output(
                ["git", "show", f"{commit}:knowledge/ripe-data.ttl"], cwd=ROOT
            )
            if commit
            else (ROOT / "knowledge/ripe-data.ttl").read_bytes()
        )
        if digest(source) != expected:
            raise SystemExit(f"Refusing changed release data for {version}")
        output = ROOT / "ui/public/data" / version
        output.mkdir(parents=True, exist_ok=True)
        manifest_path = output / "checksums.json"
        if manifest_path.exists():
            saved = json.loads(manifest_path.read_text())
            if (
                saved.get("source_sha256") == expected
                and saved.get("files", {}).get("ripe-data.ttl") == expected
                and all(
                    (output / name).is_file()
                    and digest((output / name).read_bytes()) == checksum
                    for name, checksum in saved.get("files", {}).items()
                )
                and len(saved.get("files", {})) == 4
            ):
                print(f"{version}: verified existing static distributions")
                continue
        graph = Graph().parse(data=source, format="turtle")
        files = {"ripe-data.ttl": source}
        for extension, format_name in [
            ("nt", "nt"),
            ("jsonld", "json-ld"),
            ("rdf", "xml"),
        ]:
            serialized = graph.serialize(format=format_name, encoding="utf-8")
            if extension == "nt":
                serialized = b"\n".join(sorted(serialized.splitlines())) + b"\n"
            if not isomorphic(
                graph, Graph().parse(data=serialized, format=format_name)
            ):
                raise SystemExit(f"Serialization changed RDF: {version} {extension}")
            files[f"ripe-data.{extension}"] = serialized
        for name, data in files.items():
            (output / name).write_bytes(data)
        manifest_path.write_text(
            json.dumps(
                {
                    "version": version,
                    "source_sha256": expected,
                    "files": {name: digest(data) for name, data in files.items()},
                },
                indent=2,
            )
            + "\n"
        )
        print(
            f"{version}: prepared and round-trip verified four formats ({len(graph)} triples)"
        )


if __name__ == "__main__":
    main()
