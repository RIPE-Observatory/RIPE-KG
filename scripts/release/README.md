# RIPE-KG release pipeline

This folder contains the scripts used to build a RIPE-KG release from PostgreSQL.
The pipeline is local: it reads the database, writes a candidate under `.build/`,
and can load that candidate into a local GraphDB. It does not deploy anything.

## Files

- `build.py` — reads PostgreSQL, applies the private release rules, assigns stable
  assessment/reviewer IDs, runs the remaining stages, and validates the result.
- `enrich_openalex.py` — adds OpenAlex records for DOI values, using the local
  cache before making requests.
- `preprocess.py` — converts the public assessment JSON into the flat structures
  consumed by the YARRRML mapping.

The RMLMapper jar is downloaded on first use into `.build/tools/` and verified by
SHA-256. Generated release files are written to `.build/<version>/`.

## Build the current release

Set `DATABASE_URL` to a PostgreSQL database containing the InspectAI jobs:

```sh
DATABASE_URL="postgresql://user:password@localhost/inspect_ai" make release-local
```

`make release-local` performs the full build and then loads and checks the actual
candidate in local GraphDB. Use `make release` when only the files are needed.

The current defaults are:

```text
version: 1.1.0
policy: private/release-policy.json
reviewer index: private/reviewer-index.json
output: .build/1.1.0/
```

Override them when needed:

```sh
DATABASE_URL="postgresql://..." \
RELEASE_VERSION=1.2.0 \
RELEASE_OUTPUT=.build/1.2.0 \
make release-local
```

## What the pipeline does

1. Opens a read-only PostgreSQL transaction and selects completed jobs for the
   InspectAI UI version and date range in the private policy.
2. Keeps assessments with exactly one accepted human-reviewed `OVERALL` answer.
3. Applies the private assessment and reviewer exclusions.
4. Generates stable public assessment IDs and uses the permanent `RV###`
   reviewer index.
5. Removes private fields and keeps only result payloads used by the mapping.
6. Enriches DOI records with OpenAlex, preprocesses the JSON, runs the pinned
   YARRRML parser, and runs the checksum-verified RMLMapper.
7. Checks expected counts, privacy, RDF parsing, assessment/reviewer RDF counts,
   and writes `release-manifest.json` plus `SHA256SUMS` for all staged inputs
   and artifacts.
8. With `make release-local`, loads the candidate into local GraphDB and checks
   repository settings and inference.

A build is assembled in a temporary directory. The final `.build/<version>/`
candidate and reviewer index are updated only after the file and RDF checks pass;
`make release-local` then performs the separate GraphDB check.

## Private inputs

`private/release-policy.json` contains the release cutoff, supported InspectAI job
versions, exclusions, approved new reviewer UUIDs, included `RV###` identifiers,
and expected counts.

`private/reviewer-index.json` is the permanent reviewer registry. Never renumber,
delete, or reuse an existing `RV###` identifier. For a new reviewer, place the
reviewer's database UUID in `allowed_new_reviewer_source_ids`; the build appends
the next available `RV###` identifier after successful validation.

Both files are ignored by Git because they contain private identities or database
UUIDs.

## Adapting the pipeline for InspectAI v2 / RIPE-KG 1.2

The current extractor intentionally accepts InspectAI v1 jobs only. It fails if a
policy enables v2, preventing v2 records from being silently interpreted as v1.

InspectAI v2 database results still use the common top-level fields `checks`,
`inspect_sr`, `meta`, and `sections`, and they retain the checks already used by
RIPE-KG. V2 also adds checks such as baseline extraction/statistics, CONSORT flow,
and registration consistency, and expands INSPECT-SR from five questions to the
full 26-question set.

To support v2:

1. Add a small v2 normalisation branch in `build.py`. It should convert a v2 job
   into the same public assessment structure used by the rest of the pipeline.
2. Decide which new v2 checks/questions RIPE-KG will publish. Update
   `KEEP_CHECKS` and `KEEP_QUESTIONS` in `build.py` accordingly.
3. Extend `preprocess.py` and `mappings/ripe.yarrrml.yml` only for newly published
   fields. Existing mapped checks can continue through the shared path.
4. Change RIPE-O only if the new data requires concepts or relationships that the
   current ontology cannot express.
5. Update the private policy for `2.0.0`, the v2 cutoff, approved reviewer UUIDs,
   included RV IDs, exclusions, and expected counts.
6. Run the same `make release-local` command with `RELEASE_VERSION=1.2.0` and
   verify the generated candidate before deployment.

PostgreSQL extraction, public ID generation, reviewer indexing, OpenAlex,
YARRRML/RMLMapper execution, validation, manifests, and GraphDB verification are
shared and should not be duplicated for v2.
