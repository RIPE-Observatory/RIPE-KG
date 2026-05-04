RIPE_ONTOLOGY := knowledge/ripe.ttl
RIPE_DATA := knowledge/ripe-data.ttl
RIPE_RML := mappings/ripe.rml.ttl
UI_DIR := ui

GRAPHDB_BASE ?= http://localhost:7200
GRAPHDB_REPOSITORY ?= ripe
SPARQL_ENDPOINT := $(GRAPHDB_BASE)/repositories/$(GRAPHDB_REPOSITORY)
GRAPHDB_FILES := $(RIPE_ONTOLOGY) $(RIPE_DATA)

CURL := curl --fail --show-error --silent --connect-timeout 5 --max-time 30
LOAD_CURL := curl --fail --show-error --silent --connect-timeout 5 --max-time 300

.PHONY: all reproduce parse-check graphdb-up graphdb-down graphdb-wait graphdb-recreate graphdb-check-queryable graphdb-load-files graphdb-verify ui-build

all: reproduce

reproduce: parse-check

parse-check: $(RIPE_ONTOLOGY) $(RIPE_DATA) $(RIPE_RML)
	uv run python -c "from pathlib import Path; from rdflib import Graph; [print(f'{path}: {len(Graph().parse(path, format=\"turtle\"))} triples') for path in [Path('knowledge/ripe.ttl'), Path('mappings/ripe.rml.ttl'), Path('knowledge/ripe-data.ttl')]]"

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
	@status=$$(curl --silent --connect-timeout 5 --max-time 30 -o /dev/null -w "%{http_code}" "$(GRAPHDB_BASE)/rest/repositories/$(GRAPHDB_REPOSITORY)" || true); \
	if [ "$$status" = "200" ]; then \
		$(CURL) -X DELETE "$(GRAPHDB_BASE)/rest/repositories/$(GRAPHDB_REPOSITORY)" >/dev/null; \
		echo "Deleted GraphDB repository $(GRAPHDB_REPOSITORY)"; \
	fi
	@$(CURL) -X POST "$(GRAPHDB_BASE)/rest/repositories" -F "config=@graphdb-config/repository-config.ttl" >/dev/null
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
	@$(CURL) -X POST "$(SPARQL_ENDPOINT)" \
		-H "Content-Type: application/sparql-query" \
		-H "Accept: application/sparql-results+json" \
		--data 'PREFIX ripe: <https://w3id.org/ripe/ripe-o#> PREFIX tido: <https://w3id.org/tido#> SELECT ?assessments ?tidoCases WHERE { { SELECT (COUNT(DISTINCT ?assessment) AS ?assessments) WHERE { ?assessment a ripe:ResearchIntegrityAssessment . } } { SELECT (COUNT(DISTINCT ?case) AS ?tidoCases) WHERE { ?case a ripe:ResearchIntegrityAssessment, tido:Case . } } }' \
		| uv run python -c 'import json, sys; b=json.load(sys.stdin)["results"]["bindings"][0]; print("ResearchIntegrityAssessment: " + b["assessments"]["value"] + "; inferred tido:Case: " + b["tidoCases"]["value"])'
	@echo "GraphDB verification passed"

ui-build:
	cd $(UI_DIR) && bun install --frozen-lockfile && bun run check && bun run build
