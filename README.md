# RIPE-KG

[![DOI](https://zenodo.org/badge/1212635420.svg)](https://doi.org/10.5281/zenodo.20690734)

The **Research Integrity Provenance and Evidence Knowledge Graph** represents
research integrity assessments using [RIPE-O](https://w3id.org/ripe/ripe-o).
It connects assessed publications, integrity questions, evidence, automated
outputs, human-reviewed outcomes, and the agents and activities that produced
them.

[Explore the public graph](https://ripe-kg.inspectai.app) ·
[SPARQL workbench](https://ripe-kg.inspectai.app/sparql) ·
[Archived release](https://doi.org/10.5281/zenodo.20690734)

## Data and releases

| KG release | Assessments | Assessed publications | Reviewers | Ontology |
| --- | ---: | ---: | ---: | --- |
| 1.0.0 | 140 | 95 | 15 | RIPE-O 1.0.0 |
| 1.1.0 | 185 | 119 | 22 | RIPE-O 1.0.0 |

The working-tree dataset is 1.1.0. The application supports both snapshots in
separate, read-only GraphDB repositories. Versioned routes select a snapshot;
unversioned routes use the configured default. The public deployment is updated
separately from this repository.

Reviewers use stable pseudonymous identifiers. Private extraction inputs and
credentials are excluded from the repository.

## Run locally

Requirements: Git with the repository history, Docker Compose, Python 3.11+
with [uv](https://docs.astral.sh/uv/), Node.js 24, and Bun 1.3.9. Building RDF from source also
requires Java 21+. GraphDB 10.8.14 is pinned by image digest in
[`docker-compose.yml`](docker-compose.yml).

From the repository root:

```sh
uv sync --locked
make graphdb-up
make graphdb-wait
make load-release RELEASE_VERSION=1.0.0
make load-release RELEASE_VERSION=1.1.0
make ui-build
```

Use a full Git clone: historical downloads require the commits in the release
catalog. Run each load command once per new database volume; the loader verifies
the snapshot, makes it read-only, and refuses to replace an existing repository.

Start the built interface:

```sh
cd ui
HOSTNAME=127.0.0.1 GRAPHDB_BASE_URL=http://localhost:7200 bun run start
```

Open [localhost:3000](http://localhost:3000). For development, use `bun run dev`
instead of `bun run start`. See [`ui/.env.example`](ui/.env.example) for server
configuration.

## Query a release

Use `/releases/<version>/explore`, `/sparql`, `/api/sparql`, or `/api/health`
under the selected release prefix. For example:

```sh
curl --fail http://localhost:3000/releases/1.1.0/api/sparql \
  -H 'Content-Type: application/sparql-query' \
  --data 'PREFIX ripe: <https://w3id.org/ripe/ripe-o#>
SELECT (COUNT(?assessment) AS ?count)
WHERE { ?assessment a ripe:ResearchIntegrityAssessment }'
```

The API accepts read-only `SELECT` and `ASK` queries and returns JSON with an
`X-RIPE-KG-Version` header. GET with `?query=` and form-encoded POST are also
supported. Query execution is limited to 30 seconds and SELECT results to
100,000 rows. Results at that cap carry a completeness warning in the API and
workbench; CSV export requires a smaller result. Federation is restricted to
the explicit SemOpenAlex service IRI.

Release roots such as `/releases/1.1.0` support content negotiation for HTML,
Turtle, JSON-LD, RDF/XML, and N-Triples. Entity identifiers remain stable across
releases; a versioned description URL selects the snapshot describing an entity.

## Repository layout

| Path | Contents |
| --- | --- |
| [`assessments/`](assessments/) | Public assessment export, OpenAlex cache, enriched data, and mapping inputs |
| [`knowledge/`](knowledge/) | RIPE-O ontology and generated RDF dataset |
| [`mappings/`](mappings/) | YARRRML source and generated RML mapping |
| [`releases/`](releases/) | Release manifests and artifact checksums |
| [`graphdb-config/`](graphdb-config/) | Repository configuration |
| [`scripts/release/`](scripts/release/README.md) | Extraction, enrichment, RDF generation, loading, and validation |
| [`ui/`](ui/) | Next.js application and tests |

## Validate and reproduce

Validate the checked-in RDF and release checksums from the repository root:

```sh
make reproduce
sha256sum -c releases/1.1.0/SHA256SUMS
```

`make reproduce` parses the ontology, mapping, and dataset. Regenerating a release
from PostgreSQL requires authorised access to the source snapshot and private
release inputs; see the [release guide](scripts/release/README.md).

Run the interface checks:

```sh
cd ui
bun run test
bun run check
```

With both repositories loaded and the interface running, run the service checks
from the repository root:

```sh
uv run python scripts/release/verify-service.py --base http://localhost:3000
```

See the [release guide](scripts/release/README.md) for extraction and deployment,
and [deploy/compose.yml](deploy/compose.yml) for the production stack.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and review guidance.
RIPE-KG is licensed under [CC BY 4.0](LICENSE.md). Bundled third-party components
retain their own license notices.

Related projects: [RIPE Observatory](https://w3id.org/ripe) ·
[RIPE-O](https://w3id.org/ripe/ripe-o) ·
[INSPECT-AI](https://w3id.org/ripe/inspect-ai).
