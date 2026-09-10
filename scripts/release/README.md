# Release guide

RIPE-KG releases are built from an INSPECT-AI PostgreSQL snapshot and published
as pseudonymised JSON and RDF. Extraction, enrichment, and mapping run in an
isolated staging directory. Loading and deployment are separate steps.

## Tools

| Script | Purpose |
| --- | --- |
| `build.py` | Extract assessments, apply release policy, assign public IDs, generate RDF, and validate artifacts |
| `enrich_openalex.py` | Enrich DOI records using the OpenAlex cache and API |
| `preprocess.py` | Produce the JSON structures consumed by YARRRML |
| `prepare-downloads.py` | Verify release checksums and produce four RDF download formats |
| `graphdb_config.py` | Render repository configuration from the shared template |
| `load-graphdb.py` | Create, validate, and protect a versioned repository |
| `verify-service.py` | Check a running application against both release snapshots |

The build requires Python 3.11+ with uv, Bun 1.3.9, Java 21+, and read access to
the source database. RMLMapper 8.1.0 is downloaded to `.build/tools/` and verified
by SHA-256. The YARRRML parser version is pinned in `build.py`.

## Private inputs

Extraction requires two files that are intentionally excluded from Git:

- `private/release-policy.json`: source date range, supported INSPECT-AI version,
  exclusions, approved new reviewer UUIDs, included reviewer IDs, and expected
  release counts.
- `private/reviewer-index.json`: the permanent mapping from database reviewer
  UUIDs to public `RV###` identifiers.

Never renumber, delete, or reuse a public reviewer identifier. To include a new
reviewer, add their database UUID to `allowed_new_reviewer_source_ids` in the
policy. The build assigns the next public identifier after validation.

The extractor supports INSPECT-AI v1 records. A policy selecting v2 records is
rejected; supporting another source schema requires explicit extraction and
mapping changes.

## Build from PostgreSQL

Set `DATABASE_URL` in the environment, then run from the repository root:

```sh
make release
```

Defaults:

| Variable | Default |
| --- | --- |
| `RELEASE_VERSION` | `1.1.0` |
| `RELEASE_OUTPUT` | `.build/1.1.0` |
| `RELEASE_POLICY` | `private/release-policy.json` |
| `REVIEWER_INDEX` | `private/reviewer-index.json` |

For a new candidate:

```sh
RELEASE_VERSION=1.2.0 RELEASE_OUTPUT=.build/1.2.0 make release
```

The pipeline:

1. Reads completed jobs in a read-only transaction, constrained by the policy's
   source version and date range.
2. Selects assessments with one accepted human-reviewed `OVERALL` answer,
   applies exclusions, and assigns stable assessment and reviewer identifiers.
3. Removes private fields and retains the assessment content used by the mapping.
4. Enriches DOI records, preprocesses the JSON, and executes YARRRML and RMLMapper.
5. Validates privacy, expected counts, RDF structure, and reviewer coverage, then
   writes the manifest and checksums.

The candidate directory and reviewer index are updated only after file and RDF
validation succeeds. OpenAlex records come from the cache where available;
uncached lookups use the API. Cached missing records are not automatically retried.

`make release-local` also loads the candidate into a scratch GraphDB repository
and checks inference. This recreates the repository selected by
`GRAPHDB_REPOSITORY` (default `ripe`). Use a disposable local repository. The
command refuses to recreate a versioned release repository.

## Serve a release

For local setup and query examples, see the [main README](../../README.md#run-locally).
The [release catalog](../../ui/src/lib/releases.json) pins each snapshot's source
commit, data checksum, counts, and ontology version. Downloads are generated
under `ui/public/data/`; each serialization is checked against the source RDF.

`load-graphdb.py` refuses to replace an existing repository. It checks counts
and inference, enables read-only mode, restarts the repository to activate it,
and verifies that an empty update is rejected. Repository names are
`ripe-1-0-0` and `ripe-1-1-0`.

Application settings are listed in [ui/.env.example](../../ui/.env.example).
`GRAPHDB_BASE_URL` selects the server; the release selects its repository.
`RIPE_KG_VERSION` controls unversioned URLs. Both releases use RIPE-O 1.0.0.

The API allows 30 requests per minute per identity. By default, all callers
share one budget. Set `RIPE_TRUST_CF_CONNECTING_IP=true` only when the origin
is private and reachable exclusively through Cloudflare. Missing or invalid
CF-Connecting-IP then returns 503. Request budgets are local to the UI process.
The production tunnel connects directly to loopback port 3000. The old nginx
virtual host redirects to the public HTTPS hostname; it must never proxy directly
to the application while Cloudflare headers are trusted.

## Deploy

Run from the repository root:

```sh
make prepare-downloads
docker build -f ui/Dockerfile -t ripe-kg-ui:release .
export RIPE_UI_IMAGE="$(docker image inspect ripe-kg-ui:release --format '{{.Id}}')"
docker compose -f deploy/compose.yml up -d --wait graphdb
make load-release RELEASE_VERSION=1.0.0 GRAPHDB_BASE=http://localhost:17200
make load-release RELEASE_VERSION=1.1.0 GRAPHDB_BASE=http://localhost:17200
docker compose -f deploy/compose.yml up -d --wait ui
uv run python scripts/release/verify-service.py --base http://localhost:13000
```

The [Compose file](../../deploy/compose.yml) uses a separate database volume and
loopback ports 17200 and 13000. `RIPE_GRAPHDB_PORT` and `RIPE_UI_PORT` can change
these; update the load and verification commands accordingly. Transfer the
reviewed image to the host before using its image ID, or use a registry digest.

Preserve the existing image, database and ingress configuration for rollback.
Verify the candidate before switching the ingress to its UI port. Check both
release health endpoints through the public hostname after switching. Roll back
by restoring the previous ingress destination; retain the old database volume.
For database backups, stop GraphDB before copying its volume or use its supported
backup mechanism. Do not start an older GraphDB image against an upgraded volume.
Copy each immutable version backup to a separate host, compare SHA-256 hashes
at both destinations, and restore the off-host copy in an isolated container
before accepting the backup. The 2026-09-10 copies are on Neumann under
`/srv/data/ripe-kg-backups/2026-09-10/`. Repeat this when a version is added or
repository configuration changes.

W3ID rules live in [perma-id/w3id.org](https://github.com/perma-id/w3id.org/tree/master/ripe).
Update them only after the destination URLs work; API redirects must preserve POST.

## Paper statistics

Set `GRAPHDB_ARTIFACT_ROOT` and `GRAPHDB_REPOSITORY` to the same snapshot when
running `make paper-stats`. The script compares assessment ID sets and refuses
mixed snapshots. Published 1.0.0 statistics must use the 1.0.0 data.
