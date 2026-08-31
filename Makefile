GRAPHDB_ARTIFACT_ROOT ?= .
RIPE_ONTOLOGY = $(GRAPHDB_ARTIFACT_ROOT)/knowledge/ripe.ttl
RIPE_DATA = $(GRAPHDB_ARTIFACT_ROOT)/knowledge/ripe-data.ttl
RIPE_RML = $(GRAPHDB_ARTIFACT_ROOT)/mappings/ripe.rml.ttl
UI_DIR := ui

RELEASE_VERSION ?= 1.1.0
RELEASE_OUTPUT ?= .build/$(RELEASE_VERSION)
RELEASE_POLICY ?= private/release-policy.json
REVIEWER_INDEX ?= private/reviewer-index.json

GRAPHDB_BASE ?= http://localhost:7200
GRAPHDB_REPOSITORY ?= ripe
SPARQL_ENDPOINT := $(GRAPHDB_BASE)/repositories/$(GRAPHDB_REPOSITORY)
GRAPHDB_FILES := $(RIPE_ONTOLOGY) $(RIPE_DATA)

CURL := curl --fail --show-error --silent --connect-timeout 5 --max-time 30
LOAD_CURL := curl --fail --show-error --silent --connect-timeout 5 --max-time 300

.PHONY: all reproduce release release-local parse-check graphdb-up graphdb-down graphdb-wait graphdb-recreate graphdb-check-queryable graphdb-load-files graphdb-verify paper-stats ui-build prepare-downloads load-release

all: reproduce

reproduce: parse-check

release:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL is required" >&2; exit 1)
	@uv run python scripts/release/build.py \
		--version "$(RELEASE_VERSION)" \
		--output "$(RELEASE_OUTPUT)" \
		--policy "$(RELEASE_POLICY)" \
		--reviewer-index "$(REVIEWER_INDEX)" \
		--update-reviewer-index

release-local: release
	@$(MAKE) graphdb-up
	@$(MAKE) graphdb-verify GRAPHDB_ARTIFACT_ROOT="$(RELEASE_OUTPUT)"

parse-check: $(RIPE_ONTOLOGY) $(RIPE_DATA) $(RIPE_RML)
	uv run python -c 'import sys; from rdflib import Graph; [(print(path + ":", len(Graph().parse(path, format="turtle")), "triples")) for path in sys.argv[1:]]' "$(RIPE_ONTOLOGY)" "$(RIPE_RML)" "$(RIPE_DATA)"

graphdb-up:
	docker compose up -d graphdb

graphdb-down:
	docker compose down

graphdb-wait:
	@echo "Waiting for GraphDB at $(GRAPHDB_BASE)"
	@for i in $$(seq 1 60); do \
		status=$$(curl --silent --connect-timeout 5 --max-time 30 -o /dev/null -w "%{http_code}" "$(GRAPHDB_BASE)/rest/repositories" || true); \
		if [ "$$status" = "200" ]; then \
			echo "GraphDB is ready"; \
			exit 0; \
		fi; \
		sleep 2; \
	done; \
	echo "GraphDB did not become ready at $(GRAPHDB_BASE)" >&2; \
	docker logs --tail=120 ripe_kg_graphdb >&2 || true; \
	exit 1

graphdb-recreate: graphdb-wait
	@case "$(GRAPHDB_REPOSITORY)" in ripe-[0-9]*-[0-9]*-[0-9]*) echo "Refusing to recreate an immutable release repository" >&2; exit 1;; esac
	@config=$$(mktemp); trap 'rm -f "$$config"' EXIT; \
	python3 scripts/release/graphdb_config.py "$(GRAPHDB_REPOSITORY)" > "$$config" || exit 1; \
	status=$$(curl --silent --connect-timeout 5 --max-time 30 -o /dev/null -w "%{http_code}" "$(GRAPHDB_BASE)/rest/repositories/$(GRAPHDB_REPOSITORY)" || true); \
	if [ "$$status" = "200" ]; then \
		$(CURL) -X DELETE "$(GRAPHDB_BASE)/rest/repositories/$(GRAPHDB_REPOSITORY)" >/dev/null; \
		echo "Deleted GraphDB repository $(GRAPHDB_REPOSITORY)"; \
	fi; \
	$(CURL) -X POST "$(GRAPHDB_BASE)/rest/repositories" -F "config=@$$config" >/dev/null
	@echo "Created GraphDB repository $(GRAPHDB_REPOSITORY)"
	@$(MAKE) graphdb-check-queryable

graphdb-check-queryable:
	@for i in $$(seq 1 60); do \
		status=$$(curl --silent --connect-timeout 5 --max-time 30 -o /dev/null -w "%{http_code}" -X POST "$(SPARQL_ENDPOINT)" \
			-H "Content-Type: application/sparql-query" \
			-H "Accept: application/sparql-results+json" \
			--data 'ASK { }' || true); \
		if [ "$$status" = "200" ]; then \
			echo "GraphDB repository $(GRAPHDB_REPOSITORY) is ready"; \
			exit 0; \
		fi; \
		sleep 2; \
	done; \
	echo "GraphDB repository $(GRAPHDB_REPOSITORY) did not become queryable" >&2; \
	docker logs --tail=120 ripe_kg_graphdb >&2 || true; \
	exit 1

graphdb-load-files: $(GRAPHDB_FILES)
	@for file in $(GRAPHDB_FILES); do \
		if [ ! -s "$$file" ]; then \
			echo "Missing RDF file: $$file" >&2; \
			exit 1; \
		fi; \
		echo "Loading $$file into $(GRAPHDB_REPOSITORY)"; \
		$(LOAD_CURL) -X POST "$(SPARQL_ENDPOINT)/statements" \
			-H "Content-Type: text/turtle" \
			--data-binary "@$$file" >/dev/null; \
	done

graphdb-verify: graphdb-recreate graphdb-load-files
	@$(CURL) "$(GRAPHDB_BASE)/rest/repositories/$(GRAPHDB_REPOSITORY)" \
		| uv run python -c 'import json, sys; params=json.load(sys.stdin)["params"]; expected={"ruleset":"owl2-rl","disableSameAs":"true","queryTimeout":"30","throwQueryEvaluationExceptionOnTimeout":"true","queryLimitResults":"100000"}; actual={key: params[key]["value"] for key in expected}; print("GraphDB config:", actual); missing={key: (actual[key], value) for key, value in expected.items() if actual[key] != value}; assert not missing, f"Unexpected GraphDB config: {missing}"'
	@expected=$$(uv run python -c 'from rdflib import Graph, RDF, URIRef; g=Graph().parse("$(RIPE_DATA)", format="turtle"); print(len(set(g.subjects(RDF.type, URIRef("https://w3id.org/ripe/ripe-o#ResearchIntegrityAssessment")))))'); \
		$(CURL) -X POST "$(SPARQL_ENDPOINT)" \
		-H "Content-Type: application/sparql-query" \
		-H "Accept: application/sparql-results+json" \
		--data 'PREFIX ripe: <https://w3id.org/ripe/ripe-o#> PREFIX tido: <https://w3id.org/tido#> SELECT ?assessments ?tidoCases WHERE { { SELECT (COUNT(DISTINCT ?assessment) AS ?assessments) WHERE { ?assessment a ripe:ResearchIntegrityAssessment . } } { SELECT (COUNT(DISTINCT ?case) AS ?tidoCases) WHERE { ?case a ripe:ResearchIntegrityAssessment, tido:Case . } } }' \
		| EXPECTED_ASSESSMENTS="$$expected" uv run python -c 'import json, os, sys; b=json.load(sys.stdin)["results"]["bindings"][0]; expected=os.environ["EXPECTED_ASSESSMENTS"]; assessments=b["assessments"]["value"]; cases=b["tidoCases"]["value"]; print(f"ResearchIntegrityAssessment: {assessments}; inferred tido:Case: {cases}"); assert assessments == expected and cases == expected, f"expected {expected}, got assessments={assessments}, tidoCases={cases}"'
	@echo "GraphDB verification passed"

paper-stats:
	GRAPHDB_ARTIFACT_ROOT="$(GRAPHDB_ARTIFACT_ROOT)" SPARQL_ENDPOINT="$(SPARQL_ENDPOINT)" scripts/reproduce-paper-stats.sh

load-release: prepare-downloads
	python3 scripts/release/load-graphdb.py --version "$(RELEASE_VERSION)" --base "$(GRAPHDB_BASE)"

prepare-downloads:
	uv run python scripts/release/prepare-downloads.py

ui-build: prepare-downloads
	cd $(UI_DIR) && bun install --frozen-lockfile && bun run check && bun run build
	@mkdir -p $(UI_DIR)/.next/standalone/public $(UI_DIR)/.next/standalone/.next/static
	@cp -a $(UI_DIR)/public/. $(UI_DIR)/.next/standalone/public/
	@cp -a $(UI_DIR)/.next/static/. $(UI_DIR)/.next/standalone/.next/static/
