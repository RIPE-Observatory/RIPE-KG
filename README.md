# RIPE-KG - Research Integrity Provenance and Evidence Knowledge Graph
[![DOI](https://zenodo.org/badge/1212635420.svg)](https://doi.org/10.5281/zenodo.20690734)

RIPE-KG is a knowledge graph of research integrity assessment traces represented using the Research Integrity Provenance and Evidence Ontology (RIPE-O). It connects works being assessed, integrity questions, evidence, automated outputs, human-reviewed outcomes, reviewers, agents, and provenance activities in RDF.

A user can query which work was assessed, what evidence was considered, how a result was produced, where automated and human-reviewed outcomes differ, and which activity or agent is associated with a trace.

The live exploration interface is available at:

[https://ripe-kg.inspectai.app](https://ripe-kg.inspectai.app)

## Repository Contents

This repository contains the public RIPE-KG snapshot and the files needed to reproduce, load, and inspect it.

```text
assessments/                  Public pseudonymised assessment data and mapping inputs
graphdb-config/               GraphDB repository configuration
knowledge/                    RIPE-O ontology and generated RIPE-KG RDF data
mappings/                     YARRRML mapping and generated RML mapping
ui/                           Next.js UI and SPARQL interface
Makefile                      Reproduction, GraphDB, and UI commands
pyproject.toml                Python project metadata managed with uv
docker-compose.yml            Local GraphDB service
```

## Main Files

| File | Description |
| --- | --- |
| `assessments/assessments.json` | Public pseudonymised assessment export |
| `assessments/assessments_enriched.json` | Assessment data enriched with OpenAlex metadata |
| `assessments/assessments_yarrrml.json` | Mapping-ready JSON generated from the assessment export |
| `knowledge/ripe.ttl` | RIPE-O ontology used by the graph |
| `knowledge/ripe-data.ttl` | Generated RIPE-KG RDF data |
| `mappings/ripe.yarrrml.yml` | YARRRML mapping specification |
| `mappings/ripe.rml.ttl` | Generated RML mapping |
| `graphdb-config/repository-config.ttl` | GraphDB repository configuration |

## Requirements

| Tool | Purpose |
| --- | --- |
| `uv` | Python dependency management and RDF validation |
| `bun` | UI dependency management, checks, and build |
| Docker | Local GraphDB 10.8.5 service |

## Reproduce the RDF Snapshot

To parse the ontology, RML mapping, and generated data:

```sh
make reproduce
```

This checks:

* `knowledge/ripe.ttl`
* `mappings/ripe.rml.ttl`
* `knowledge/ripe-data.ttl`

## Load the Knowledge Graph

Start GraphDB:

```sh
make graphdb-up
```

Create the `ripe` repository, load RIPE-O and RIPE-KG, and verify the repository configuration and inference:

```sh
make graphdb-verify
```

The local SPARQL endpoint is:

```text
http://localhost:7200/repositories/ripe
```

The GraphDB repository uses the `owl2-rl` ruleset with inconsistency checks. `owl:sameAs` links are asserted in RIPE-KG, but sameAs expansion is disabled so queries are not rewritten through external SemOpenAlex identifiers.

## Query the Graph

The live SPARQL interface is available at:

[https://ripe-kg.inspectai.app/sparql](https://ripe-kg.inspectai.app/sparql)

The SPARQL API endpoint is:

```text
https://ripe-kg.inspectai.app/api/sparql
```

## Run the UI Locally

Load GraphDB first, then build and run the interface:

```sh
make ui-build
cd ui
SPARQL_ENDPOINT=http://localhost:7200/repositories/ripe bun run dev
```

The UI includes publication and author search, assessment pages, the ontology explorer, and the SPARQL workbench used to run the competency questions.

## Data Scope

The published assessment data is pseudonymised. Human reviewers are represented by stable reviewer identifiers, and no direct reviewer-identifying fields are included in the public JSON or generated RDF.

## Related Resources

* [RIPE Observatory](https://w3id.org/ripe)
* [RIPE-O](https://w3id.org/ripe/ripe-o)
* [INSPECT-AI](https://w3id.org/ripe/inspect-ai)

## License

This work is licensed under the Creative Commons Attribution 4.0 International License. See [LICENSE.md](LICENSE.md) for details.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes to the data, mappings, RDF output, or interface.
