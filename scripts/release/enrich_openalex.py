#!/usr/bin/env python3
"""Enrich extracted RIPE assessments with OpenAlex work records.

Reads:  assessments/assessments.json
Writes: assessments/assessments_enriched.json

The script fetches only DOI-level OpenAlex work records needed by the RIPE KG:
main assessed works, GROBID references, and Retraction Watch/EOC notice or
original-paper DOIs already present in the extracted assessments.
"""

from __future__ import annotations

import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


INPUT_FILE = Path("assessments/assessments.json")
OUTPUT_FILE = Path("assessments/assessments_enriched.json")
CACHE_FILE = Path("assessments/.openalex-cache.json")
ENV_FILE = Path(".env")

OPENALEX_DOI_API = "https://api.openalex.org/works/doi:{doi}"
DEFAULT_MAX_WORKERS = 32
DEFAULT_REQUESTS_PER_SECOND = 50.0
MAX_RETRIES = 5
REQUEST_TIMEOUT_SECONDS = 30
EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


class OpenAlexRequestFailed(RuntimeError):
    """Raised when a DOI lookup fails for a retriable OpenAlex/network reason."""


def load_env(path: Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def sanitize_cache_value(value: object) -> object:
    """Remove email addresses from cached third-party metadata before publication."""
    if isinstance(value, str):
        return EMAIL_PATTERN.sub("[redacted]", value)
    if isinstance(value, list):
        return [sanitize_cache_value(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_cache_value(item) for key, item in value.items()}
    return value


def write_cache(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    sanitized = sanitize_cache_value(data)
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(sanitized, f, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
    tmp.replace(path)


def normalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = value.strip().lower()
    if not doi or doi == "unavailable":
        return None
    doi = doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
    return doi or None


def clean_text(value: object) -> str:
    """Return a stripped string for public OpenAlex text fields."""
    if not isinstance(value, str):
        return ""
    value = EMAIL_PATTERN.sub("", value)
    value = re.sub(r"\b(Electronic address|E-mail|Email)\s*:?", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+([,.;:])", r"\1", value)
    value = re.sub(r"([,;:])\s*([,;:.])", r"\2", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip(" ,;:")


def oa_url_to_soa(oa_url: str | None) -> str | None:
    if not oa_url:
        return None
    short_id = oa_url.rsplit("/", 1)[-1]
    if short_id.startswith("W"):
        return f"https://semopenalex.org/work/{short_id}"
    if short_id.startswith("A"):
        return f"https://semopenalex.org/author/{short_id}"
    if short_id.startswith("I"):
        return f"https://semopenalex.org/institution/{short_id}"
    if short_id.startswith("S"):
        return f"https://semopenalex.org/source/{short_id}"
    return None


def extract_authorships(work: dict) -> list[dict]:
    authorships: list[dict] = []
    for authorship in work.get("authorships", []) or []:
        author = authorship.get("author") or {}
        raw_affiliation_strings = [
            cleaned
            for value in authorship.get("raw_affiliation_strings", []) or []
            if (cleaned := clean_text(value))
        ]
        affiliations = []
        for affiliation in authorship.get("affiliations", []) or []:
            raw_value = clean_text(affiliation.get("raw_affiliation_string", ""))
            if raw_value:
                affiliations.append({"raw_affiliation_string": raw_value})
        institutions = []
        for institution in authorship.get("institutions", []) or []:
            display_name = institution.get("display_name")
            if display_name:
                institutions.append({"display_name": display_name})
        authorships.append({
            "author_id": author.get("id", ""),
            "display_name": author.get("display_name", ""),
            "raw_affiliation_strings": raw_affiliation_strings,
            "affiliations": affiliations,
            "institutions": institutions,
        })
    return authorships


def extract_work(work: dict | None) -> dict | None:
    if not work:
        return None
    return {
        "work_id": work.get("id", ""),
        "soa_work_uri": oa_url_to_soa(work.get("id", "")),
        "is_retracted": work.get("is_retracted", False),
        "type": work.get("type", ""),
        "authorships": extract_authorships(work),
    }


class RateLimiter:
    def __init__(self, requests_per_second: float):
        self.interval = 1.0 / requests_per_second
        self.lock = threading.Lock()
        self.next_request = 0.0

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            if now < self.next_request:
                time.sleep(self.next_request - now)
                now = time.monotonic()
            self.next_request = now + self.interval


def request_openalex_doi(doi: str, email: str, limiter: RateLimiter) -> dict | None:
    encoded_doi = urllib.parse.quote(doi, safe="")
    url = OPENALEX_DOI_API.format(doi=encoded_doi)
    headers = {"Accept": "application/json", "User-Agent": "RIPE-KG release pipeline"}
    if email:
        url += "?" + urllib.parse.urlencode({"mailto": email})
        headers["User-Agent"] = f"RIPE-KG (mailto:{email})"

    for attempt in range(1, MAX_RETRIES + 1):
        limiter.wait()
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if error.code == 429 or 500 <= error.code < 600:
                if attempt == MAX_RETRIES:
                    raise OpenAlexRequestFailed(
                        f"OpenAlex returned HTTP {error.code} after {MAX_RETRIES} attempts"
                    ) from error
                retry_after = error.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    delay = float(retry_after)
                else:
                    delay = min(60.0, (2 ** (attempt - 1)) + random.random())
                time.sleep(delay)
                continue
            raise
        except (TimeoutError, urllib.error.URLError) as error:
            if attempt == MAX_RETRIES:
                raise OpenAlexRequestFailed(
                    f"OpenAlex request failed after {MAX_RETRIES} attempts"
                ) from error
            delay = min(60.0, (2 ** (attempt - 1)) + random.random())
            time.sleep(delay)
    raise OpenAlexRequestFailed(f"OpenAlex request failed after {MAX_RETRIES} attempts")


def collect_dois(data: dict) -> set[str]:
    dois: set[str] = set()
    for assessment in data.get("assessments", []):
        checks = assessment.get("results", {}).get("checks", {})

        grobid = checks.get("grobid_primary_metadata", {}).get("payload", {})
        main_doi = normalize_doi(grobid.get("doi_value"))
        if main_doi:
            dois.add(main_doi)

        refs = checks.get("grobid_reference_metadata", {}).get("payload", {})
        for reference in refs.get("references_full", []) or []:
            ref_doi = normalize_doi(reference.get("doi"))
            if ref_doi:
                dois.add(ref_doi)

        retraction = checks.get("retraction_detection", {}).get("payload", {})
        for result in retraction.get("reference_results", []) or []:
            for record in result.get("retractions", []) or []:
                for key in ("retraction_doi", "original_paper_doi"):
                    doi = normalize_doi(record.get(key))
                    if doi:
                        dois.add(doi)
        for record in retraction.get("main_article_result", {}).get("retractions", []) or []:
            for key in ("retraction_doi", "original_paper_doi"):
                doi = normalize_doi(record.get(key))
                if doi:
                    dois.add(doi)

        eoc = checks.get("eoc_correction_detection", {}).get("payload", {})
        for record in eoc.get("main_article_result", {}).get("notices", []) or []:
            for key in ("retraction_doi", "original_paper_doi"):
                doi = normalize_doi(record.get(key))
                if doi:
                    dois.add(doi)

        author_history = checks.get("author_retraction_history", {}).get("payload", {})
        for author_result in author_history.get("author_results", []) or []:
            for record in author_result.get("retractions", []) or []:
                for key in ("retraction_doi", "original_paper_doi"):
                    doi = normalize_doi(record.get(key))
                    if doi:
                        dois.add(doi)

    return dois


def fetch_missing(dois: set[str], cache: dict, email: str) -> dict:
    workers = int(os.environ.get("OPENALEX_WORKERS", DEFAULT_MAX_WORKERS))
    rps = float(os.environ.get("OPENALEX_RPS", DEFAULT_REQUESTS_PER_SECOND))
    if not email:
        workers = min(workers, 4)
        rps = min(rps, 5.0)
        print("  EMAIL is unset; using conservative anonymous OpenAlex limits", flush=True)
    limiter = RateLimiter(rps)
    missing = sorted(doi for doi in dois if doi not in cache)

    if not missing:
        print("  OpenAlex cache complete; no requests needed", flush=True)
        return cache

    print(f"  Fetching {len(missing)} DOI records with {workers} workers at <= {rps:g} req/s", flush=True)
    completed = 0
    not_found = 0
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(request_openalex_doi, doi, email, limiter): doi
            for doi in missing
        }
        for future in as_completed(futures):
            doi = futures[future]
            try:
                result = future.result()
            except Exception as error:
                print(f"  OpenAlex error for {doi}: {error}", flush=True)
                failed.append(doi)
                completed += 1
                continue
            cache[doi] = result
            if result is None:
                not_found += 1
            completed += 1
            if completed % 500 == 0 or completed == len(missing):
                write_cache(CACHE_FILE, cache)
                print(f"  [{completed}/{len(missing)}] fetched ({not_found} not found)", flush=True)
    write_cache(CACHE_FILE, cache)
    if failed:
        raise SystemExit(
            f"OpenAlex enrichment failed for {len(failed)} DOI records; rerun after the API or network recovers"
        )
    return cache


def add_work_to_record(record: dict, cache: dict, doi_key: str, output_key: str) -> None:
    doi = normalize_doi(record.get(doi_key))
    if not doi:
        return
    work = extract_work(cache.get(doi))
    if work:
        record[output_key] = work


def attach_enrichment(data: dict, cache: dict) -> None:
    for assessment in data.get("assessments", []):
        checks = assessment.get("results", {}).get("checks", {})

        grobid = checks.get("grobid_primary_metadata", {}).get("payload", {})
        main_doi = normalize_doi(grobid.get("doi_value"))
        if main_doi:
            work = extract_work(cache.get(main_doi))
            if work:
                grobid["openalex"] = work

        refs = checks.get("grobid_reference_metadata", {}).get("payload", {})
        for reference in refs.get("references_full", []) or []:
            add_work_to_record(reference, cache, "doi", "openalex")

        retraction = checks.get("retraction_detection", {}).get("payload", {})
        for result in retraction.get("reference_results", []) or []:
            for record in result.get("retractions", []) or []:
                add_work_to_record(record, cache, "retraction_doi", "openalex_notice")
                add_work_to_record(record, cache, "original_paper_doi", "openalex_original")
        for record in retraction.get("main_article_result", {}).get("retractions", []) or []:
            add_work_to_record(record, cache, "retraction_doi", "openalex_notice")
            add_work_to_record(record, cache, "original_paper_doi", "openalex_original")

        eoc = checks.get("eoc_correction_detection", {}).get("payload", {})
        for record in eoc.get("main_article_result", {}).get("notices", []) or []:
            add_work_to_record(record, cache, "retraction_doi", "openalex_notice")
            add_work_to_record(record, cache, "original_paper_doi", "openalex_original")

        author_history = checks.get("author_retraction_history", {}).get("payload", {})
        for author_result in author_history.get("author_results", []) or []:
            for record in author_result.get("retractions", []) or []:
                add_work_to_record(record, cache, "retraction_doi", "openalex_notice")
                add_work_to_record(record, cache, "original_paper_doi", "openalex_original")


def main() -> int:
    env = load_env()

    data = load_json(INPUT_FILE)
    try:
        cache = load_json(CACHE_FILE) if CACHE_FILE.exists() else {}
    except json.JSONDecodeError:
        cache = {}
    dois = collect_dois(data)
    cache_misses = sum(1 for doi in dois if doi not in cache)

    print(f"Loaded {len(data.get('assessments', []))} assessments", flush=True)
    print(f"Collected {len(dois)} unique DOI records for OpenAlex enrichment", flush=True)
    print(f"  cache hits: {sum(1 for doi in dois if doi in cache)}", flush=True)
    print(f"  cache misses: {cache_misses}", flush=True)

    email = env.get("EMAIL") or os.environ.get("EMAIL") or ""

    cache = fetch_missing(dois, cache, email)
    missing_after_fetch = sorted(doi for doi in dois if doi not in cache)
    if missing_after_fetch:
        raise SystemExit(
            "OpenAlex enrichment did not resolve all DOI requests: "
            + ", ".join(missing_after_fetch)
        )
    write_cache(CACHE_FILE, cache)
    attach_enrichment(data, cache)
    write_json(OUTPUT_FILE, data)

    main_enriched = sum(
        1 for assessment in data.get("assessments", [])
        if assessment.get("results", {}).get("checks", {}).get("grobid_primary_metadata", {})
        .get("payload", {}).get("openalex")
    )
    ref_enriched = sum(
        1 for assessment in data.get("assessments", [])
        for reference in assessment.get("results", {}).get("checks", {})
        .get("grobid_reference_metadata", {}).get("payload", {})
        .get("references_full", []) or []
        if reference.get("openalex")
    )
    notice_enriched = sum(
        1 for assessment in data.get("assessments", [])
        for check_name in ("retraction_detection", "eoc_correction_detection", "author_retraction_history")
        for record in collect_notice_records(assessment, check_name)
        if record.get("openalex_notice") or record.get("openalex_original")
    )

    print(f"Wrote {OUTPUT_FILE}", flush=True)
    print(f"  main works enriched: {main_enriched}/{len(data.get('assessments', []))}", flush=True)
    print(f"  references enriched: {ref_enriched}", flush=True)
    print(f"  notice records enriched: {notice_enriched}", flush=True)
    return 0


def collect_notice_records(assessment: dict, check_name: str) -> list[dict]:
    checks = assessment.get("results", {}).get("checks", {})
    payload = checks.get(check_name, {}).get("payload", {})
    records: list[dict] = []
    if check_name == "retraction_detection":
        for result in payload.get("reference_results", []) or []:
            records.extend(result.get("retractions", []) or [])
        records.extend(payload.get("main_article_result", {}).get("retractions", []) or [])
    elif check_name == "eoc_correction_detection":
        records.extend(payload.get("main_article_result", {}).get("notices", []) or [])
    elif check_name == "author_retraction_history":
        for author_result in payload.get("author_results", []) or []:
            records.extend(author_result.get("retractions", []) or [])
    return records


if __name__ == "__main__":
    raise SystemExit(main())
