#!/usr/bin/env python3
"""Build a RIPE-KG release from PostgreSQL through RDF in an isolated staging tree.

The pipeline reads completed INSPECT-AI jobs in a read-only transaction, applies
private release and reviewer policies, creates the public assessment export,
enriches it from the pinned OpenAlex cache, prepares the YARRRML input, runs the
pinned YARRRML parser and RMLMapper, and validates the resulting artifacts.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID, uuid4

import psycopg
from rdflib import Graph, RDF, URIRef

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY = ROOT / "private" / "release-policy.json"
DEFAULT_REVIEWER_INDEX = ROOT / "private" / "reviewer-index.json"
DEFAULT_OPENALEX_CACHE = ROOT / "assessments" / ".openalex-cache.json"
DEFAULT_OUTPUT_ROOT = ROOT / ".build"
ACTIVE_STAGE: Path | None = None

YARRRML_PARSER = "@rmlio/yarrrml-parser@1.12.2"
RMLMAPPER_VERSION = "8.1.0-r380"
RMLMAPPER_SHA256 = "819371d49ca47d8ffddae0f34e95f38e8eaaf588ee023e3c2c7527a14d302f58"
RMLMAPPER_URL = (
    "https://github.com/RMLio/rmlmapper-java/releases/download/v8.1.0/"
    "rmlmapper-8.1.0-r380-all.jar"
)

KEEP_CHECKS = {
    "retraction_detection",
    "eoc_correction_detection",
    "pubpeer_signal_analysis",
    "author_retraction_history",
    "prospective_registration_analysis",
    "timeline_consistency",
    "grobid_primary_metadata",
    "trial_llm_extraction",
    "registry_crosscheck",
    "grobid_reference_metadata",
}
KEEP_QUESTIONS = {"Q1.1", "Q1.2", "Q1.3", "Q2.2", "OVERALL"}
EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
PRIVATE_KEYS = {
    "email",
    "username",
    "given_name",
    "family_name",
    "reviewer_id",
    "clerk_user_id",
    "affiliation_institution",
    "affiliation_department",
}


class PipelineError(RuntimeError):
    """Raised when the release cannot be built safely."""


@dataclass(frozen=True)
class JobRow:
    source_id: str
    created_at: str
    updated_at: str
    results: dict[str, Any]
    reviewer_source_id: str | None
    given_name: str
    family_name: str
    role: str
    inspectai_ui_version: str = "1.0.0"

    @property
    def reviewer_name(self) -> tuple[str, str]:
        return (self.given_name, self.family_name)


@dataclass
class ReviewerEntry:
    rv_id: str
    given_name: str
    family_name: str
    source_ids: list[str]

    @property
    def name(self) -> tuple[str, str]:
        return (self.given_name, self.family_name)


def load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError as error:
        raise PipelineError(f"Required file does not exist: {path}") from error
    except json.JSONDecodeError as error:
        raise PipelineError(f"Invalid JSON in {path}: {error}") from error
    if not isinstance(value, dict):
        raise PipelineError(f"Expected a JSON object in {path}")
    return value


def parse_policy_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise PipelineError(f"Release policy {field} must be an ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise PipelineError(f"Release policy {field} is invalid: {value!r}") from error
    if parsed.tzinfo is None:
        raise PipelineError(f"Release policy {field} must include a timezone")
    return parsed


def require_uuid(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise PipelineError(f"{field} must contain UUID strings")
    try:
        UUID(value)
    except ValueError as error:
        raise PipelineError(f"{field} contains an invalid UUID: {value!r}") from error
    return value


def validate_policy(policy: dict[str, Any]) -> None:
    if policy.get("schema_version") != 1:
        raise PipelineError("Release policy schema_version must be 1")
    start = parse_policy_timestamp(policy.get("start_date"), "start_date")
    end_value = policy.get("end_date")
    if end_value is not None:
        end = parse_policy_timestamp(end_value, "end_date")
        if end < start:
            raise PipelineError("Release policy end_date precedes start_date")
    job_versions = policy.get("inspectai_ui_versions")
    if not isinstance(job_versions, list) or not job_versions or not all(
        isinstance(value, str) and value for value in job_versions
    ):
        raise PipelineError("inspectai_ui_versions must be a non-empty string array")
    unsupported = [value for value in job_versions if not value.startswith("1.")]
    if unsupported:
        raise PipelineError(
            "This extractor currently supports InspectAI v1 jobs only. Add the v2 "
            f"adapter before enabling: {unsupported}"
        )
    included_rv_ids = policy.get("included_reviewer_rv_ids")
    if not isinstance(included_rv_ids, list) or not included_rv_ids or not all(
        isinstance(value, str) and re.fullmatch(r"RV\d{3}", value)
        for value in included_rv_ids
    ):
        raise PipelineError("included_reviewer_rv_ids must be a non-empty RV### array")
    if len(set(included_rv_ids)) != len(included_rv_ids):
        raise PipelineError("included_reviewer_rv_ids contains duplicates")
    judgements = policy.get("valid_overall_judgements")
    if not isinstance(judgements, list) or not judgements or not all(
        isinstance(value, str) and value for value in judgements
    ):
        raise PipelineError("valid_overall_judgements must be a non-empty string array")
    excluded = policy.get("excluded_assessment_ids")
    if not isinstance(excluded, list) or not all(isinstance(value, str) for value in excluded):
        raise PipelineError("excluded_assessment_ids must be a string array")
    allowed = policy.get("allowed_new_reviewer_source_ids", [])
    if not isinstance(allowed, list):
        raise PipelineError("allowed_new_reviewer_source_ids must be a UUID array")
    allowed_ids = {require_uuid(value, "allowed_new_reviewer_source_ids") for value in allowed}
    if len(allowed_ids) != len(allowed):
        raise PipelineError("allowed_new_reviewer_source_ids contains duplicates")
    disallowed = policy.get("disallowed_reviewers")
    if not isinstance(disallowed, list):
        raise PipelineError("disallowed_reviewers must be an array")
    disallowed_ids: set[str] = set()
    for item in disallowed:
        if not isinstance(item, dict):
            raise PipelineError("Each disallowed reviewer must be an object")
        if not isinstance(item.get("given_name"), str) or not isinstance(
            item.get("family_name"), str
        ):
            raise PipelineError("Disallowed reviewer names must be strings")
        source_ids = item.get("source_ids", [])
        if not isinstance(source_ids, list):
            raise PipelineError("Disallowed reviewer source_ids must be a UUID array")
        for value in source_ids:
            source_id = require_uuid(value, "disallowed reviewer source_ids")
            if source_id in disallowed_ids:
                raise PipelineError(f"Disallowed reviewer UUID is duplicated: {source_id}")
            disallowed_ids.add(source_id)
    if allowed_ids.intersection(disallowed_ids):
        raise PipelineError("A reviewer UUID is both allowed and disallowed")
    expected = policy.get("expected")
    if not isinstance(expected, dict):
        raise PipelineError("Release policy expected must be an object")
    for field in ("assessment_count", "reviewer_count"):
        value = expected.get(field)
        if not isinstance(value, int) or value <= 0:
            raise PipelineError(f"Release policy expected.{field} must be a positive integer")


def write_json(
    path: Path, value: dict[str, Any], *, trailing_newline: bool = False
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        if trailing_newline:
            handle.write("\n")


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    write_json(temporary, value, trailing_newline=True)
    temporary.replace(path)


def copy_file_atomic(source: Path, destination: Path) -> None:
    temporary = destination.with_name(f".{destination.name}.tmp")
    shutil.copy2(source, temporary)
    temporary.replace(destination)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_assessment_id(source_id: str) -> str:
    digest = hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:16].upper()
    return f"RIPEA{digest}"


def source_snapshot_digest(jobs: Iterable[JobRow]) -> str:
    canonical_rows = [
        {
            "source_id": job.source_id,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "reviewer_source_id": job.reviewer_source_id,
            "given_name": job.given_name,
            "family_name": job.family_name,
            "role": job.role,
            "inspectai_ui_version": job.inspectai_ui_version,
            "results": job.results,
        }
        for job in jobs
    ]
    payload = json.dumps(
        canonical_rows,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def clean_public_text(value: str) -> str:
    """Apply the text cleanup used by the published 1.0 export."""
    value = value.strip()
    value = EMAIL_PATTERN.sub("", value)
    value = re.sub(
        r"\b(Electronic address|E-mail|Email)\s*:?",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\s+([,.;:])", r"\1", value)
    value = re.sub(r"([,;:])\s*([,;:.])", r"\2", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip(" ,;:")


def validate_public_json(value: Any, label: str, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in PRIVATE_KEYS or key == "token_usage":
                raise PipelineError(f"Private key {key!r} leaked into {label} at {path}")
            validate_public_json(child, label, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            validate_public_json(child, label, f"{path}[{index}]")
    elif isinstance(value, str) and EMAIL_PATTERN.search(value):
        raise PipelineError(f"Email-like value leaked into {label} at {path}")


def scrub_public_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: scrub_public_json(child)
            for key, child in value.items()
            if key not in PRIVATE_KEYS and key != "token_usage"
        }
    if isinstance(value, list):
        return [scrub_public_json(item) for item in value]
    if isinstance(value, str):
        return clean_public_text(value)
    return value


def filter_results(results: dict[str, Any]) -> dict[str, Any]:
    checks = {
        name: copy.deepcopy(value)
        for name, value in (results.get("checks") or {}).items()
        if name in KEEP_CHECKS
    }
    questions = [
        copy.deepcopy(row)
        for row in (results.get("inspect_sr") or {}).get("data", []) or []
        if isinstance(row, dict) and row.get("question_id") in KEEP_QUESTIONS
    ]
    return {"checks": checks, "inspect_sr": {"data": questions}}


def valid_overall(results: dict[str, Any], accepted: set[str]) -> bool:
    rows = [
        row
        for row in (results.get("inspect_sr") or {}).get("data", []) or []
        if isinstance(row, dict) and row.get("question_id") == "OVERALL"
    ]
    return len(rows) == 1 and rows[0].get("reviewed_judgement") in accepted


def parse_reviewer_entries(data: dict[str, Any]) -> list[ReviewerEntry]:
    raw_entries = data.get("reviewers")
    if not isinstance(raw_entries, list):
        raise PipelineError("reviewer-index.json must contain a reviewers array")
    entries: list[ReviewerEntry] = []
    seen_rv: set[str] = set()
    seen_sources: set[str] = set()
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise PipelineError("Each reviewer-index entry must be an object")
        source_ids = raw.get("source_ids")
        if not isinstance(source_ids, list):
            raise PipelineError("Reviewer source_ids must be a UUID array")
        entry = ReviewerEntry(
            rv_id=str(raw.get("rv_id") or ""),
            given_name=str(raw.get("given_name") or ""),
            family_name=str(raw.get("family_name") or ""),
            source_ids=[require_uuid(value, "Reviewer source_ids") for value in source_ids],
        )
        if not re.fullmatch(r"RV\d{3}", entry.rv_id):
            raise PipelineError(f"Invalid reviewer pseudonym: {entry.rv_id!r}")
        if not entry.given_name or not entry.family_name:
            raise PipelineError(f"Reviewer {entry.rv_id} must have a private name")
        if entry.rv_id in seen_rv:
            raise PipelineError(f"Duplicate reviewer pseudonym: {entry.rv_id}")
        overlap = seen_sources.intersection(entry.source_ids)
        if overlap:
            raise PipelineError(f"Reviewer source IDs are assigned more than once: {sorted(overlap)}")
        seen_rv.add(entry.rv_id)
        seen_sources.update(entry.source_ids)
        entries.append(entry)
    entries.sort(key=lambda item: int(item.rv_id[2:]))
    numbers = [int(entry.rv_id[2:]) for entry in entries]
    if numbers != list(range(1, len(entries) + 1)):
        raise PipelineError("Reviewer pseudonyms must be contiguous from RV001")
    return entries


def serialize_reviewer_entries(entries: Iterable[ReviewerEntry]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "reviewers": [
            {
                "rv_id": entry.rv_id,
                "given_name": entry.given_name,
                "family_name": entry.family_name,
                "source_ids": sorted(set(entry.source_ids)),
            }
            for entry in sorted(entries, key=lambda item: int(item.rv_id[2:]))
        ],
    }


def read_jobs(
    database_url: str,
    start_date: str,
    inspectai_ui_versions: list[str],
    end_date: str | None = None,
) -> list[JobRow]:
    try:
        with psycopg.connect(database_url, autocommit=False) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            connection.execute("SET LOCAL TIME ZONE 'UTC'")
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'jobs'
                          AND column_name = 'inspectai_ui_version'
                    )
                    """
                )
                has_version_column = bool(cursor.fetchone()[0])
                if not has_version_column and inspectai_ui_versions != ["1.0.0"]:
                    raise PipelineError(
                        "This PostgreSQL snapshot predates versioned jobs and can only "
                        "be treated as InspectAI UI 1.0.0"
                    )
                version_select = (
                    "j.inspectai_ui_version::text" if has_version_column else "'1.0.0'"
                )
                version_clause = (
                    "AND j.inspectai_ui_version::text = ANY(%s)"
                    if has_version_column
                    else ""
                )
                end_clause = "AND j.created_at <= %s::timestamptz" if end_date else ""
                query = f"""
                    SELECT
                        j.id::text,
                        j.created_at::text,
                        j.updated_at::text,
                        j.results,
                        j.reviewer_id::text,
                        COALESCE(r.given_name, ''),
                        COALESCE(r.family_name, ''),
                        COALESCE(r.role, ''),
                        {version_select}
                    FROM jobs AS j
                    LEFT JOIN reviewers AS r ON r.id = j.reviewer_id
                    WHERE j.status::text = 'COMPLETED'
                      AND j.created_at >= %s::timestamptz
                      {version_clause}
                      {end_clause}
                    ORDER BY j.created_at, j.id
                """
                parameters: list[Any] = [start_date]
                if has_version_column:
                    parameters.append(inspectai_ui_versions)
                if end_date:
                    parameters.append(end_date)
                cursor.execute(query, parameters)
                rows = cursor.fetchall()
            connection.rollback()
    except psycopg.Error as error:
        raise PipelineError(f"Could not read PostgreSQL release source: {error}") from error

    jobs: list[JobRow] = []
    for row in rows:
        results = row[3] if isinstance(row[3], dict) else json.loads(row[3] or "{}")
        jobs.append(
            JobRow(
                source_id=row[0],
                created_at=row[1],
                updated_at=row[2],
                results=results,
                reviewer_source_id=row[4],
                given_name=row[5],
                family_name=row[6],
                role=row[7],
                inspectai_ui_version=row[8],
            )
        )
    return jobs


def reviewer_resolution(
    jobs: list[JobRow],
    entries: list[ReviewerEntry],
    disallowed_names: set[tuple[str, str]],
    disallowed_source_ids: set[str],
    assignable_job_ids: set[str],
    allowed_new_source_ids: set[str],
) -> tuple[dict[str, ReviewerEntry], list[ReviewerEntry]]:
    by_source: dict[str, ReviewerEntry] = {}
    for entry in entries:
        for source_id in entry.source_ids:
            if source_id in by_source:
                raise PipelineError(f"Reviewer source ID is assigned twice: {source_id}")
            by_source[source_id] = entry

    initially_known = set(by_source)
    unresolved: dict[str, JobRow] = {}
    unexpected: set[str] = set()
    for job in jobs:
        source_id = job.reviewer_source_id
        if (
            not source_id
            or source_id in disallowed_source_ids
            or job.reviewer_name in disallowed_names
        ):
            continue
        entry = by_source.get(source_id)
        if entry is None and job.source_id in assignable_job_ids:
            if source_id in allowed_new_source_ids:
                unresolved.setdefault(source_id, job)
            else:
                unexpected.add(source_id)

    if unexpected:
        raise PipelineError(
            "Eligible assessments use reviewer UUIDs absent from the approved reviewer "
            f"index/policy: {sorted(unexpected)}"
        )
    unused_approvals = allowed_new_source_ids - initially_known - set(unresolved)
    if unused_approvals:
        raise PipelineError(
            f"Approved new reviewer UUIDs have no eligible assessments: {sorted(unused_approvals)}"
        )

    next_number = max((int(entry.rv_id[2:]) for entry in entries), default=0) + 1
    for source_id, job in sorted(
        unresolved.items(), key=lambda item: (item[1].created_at, item[0])
    ):
        entry = ReviewerEntry(
            rv_id=f"RV{next_number:03d}",
            given_name=job.given_name,
            family_name=job.family_name,
            source_ids=[source_id],
        )
        entries.append(entry)
        by_source[source_id] = entry
        next_number += 1
    return by_source, entries


def build_assessment_export(
    jobs: list[JobRow],
    policy: dict[str, Any],
    reviewer_entries: list[ReviewerEntry],
) -> tuple[dict[str, Any], list[ReviewerEntry], dict[str, Any]]:
    accepted = set(policy.get("valid_overall_judgements") or [])
    included_rv_ids = set(policy.get("included_reviewer_rv_ids") or [])
    if not accepted:
        raise PipelineError("release policy has no valid_overall_judgements")
    excluded_ids = set(policy.get("excluded_assessment_ids") or [])
    disallowed_reviewers = [
        item for item in policy.get("disallowed_reviewers", []) if isinstance(item, dict)
    ]
    disallowed_names = {
        (str(item.get("given_name") or ""), str(item.get("family_name") or ""))
        for item in disallowed_reviewers
    }
    disallowed_source_ids = {
        str(source_id)
        for item in disallowed_reviewers
        for source_id in item.get("source_ids", [])
    }
    allowed_new_source_ids = {
        str(source_id) for source_id in policy.get("allowed_new_reviewer_source_ids", [])
    }
    assignable_job_ids = {
        job.source_id
        for job in jobs
        if public_assessment_id(job.source_id) not in excluded_ids
        and valid_overall(job.results, accepted)
    }
    by_source, reviewer_entries = reviewer_resolution(
        jobs,
        reviewer_entries,
        disallowed_names,
        disallowed_source_ids,
        assignable_job_ids,
        allowed_new_source_ids,
    )

    source_candidates: list[tuple[JobRow, ReviewerEntry]] = []
    for job in jobs:
        if (
            not job.reviewer_source_id
            or job.reviewer_source_id in disallowed_source_ids
            or job.reviewer_name in disallowed_names
        ):
            continue
        reviewer = by_source.get(job.reviewer_source_id)
        if reviewer is None or reviewer.rv_id not in included_rv_ids:
            continue
        source_candidates.append((job, reviewer))

    selected = [
        (job, reviewer)
        for job, reviewer in source_candidates
        if public_assessment_id(job.source_id) not in excluded_ids
        and valid_overall(job.results, accepted)
    ]
    assessments = [
        scrub_public_json(
            {
                "id": public_assessment_id(job.source_id),
                "created_at": job.created_at,
                "updated_at": job.updated_at,
                "reviewer_rv_id": reviewer.rv_id,
                "reviewer": {"rv_id": reviewer.rv_id, "role": job.role},
                "results": filter_results(job.results),
            }
        )
        for job, reviewer in selected
    ]
    assessments.sort(key=lambda row: (row["created_at"], row["id"]))

    ids = [row["id"] for row in assessments]
    if len(ids) != len(set(ids)):
        raise PipelineError("Generated duplicate public assessment IDs")

    used_rv_ids = {row["reviewer_rv_id"] for row in assessments}
    role_by_rv: dict[str, str] = {}
    for assessment in assessments:
        role_by_rv.setdefault(assessment["reviewer_rv_id"], assessment["reviewer"]["role"])
    reviewers = {
        entry.rv_id: {"role": role_by_rv.get(entry.rv_id, ""), "rv_id": entry.rv_id}
        for entry in sorted(reviewer_entries, key=lambda item: int(item.rv_id[2:]))
        if entry.rv_id in used_rv_ids
    }

    metadata_policy = policy.get("metadata") or {}
    metadata = {
        "source": metadata_policy.get("source", "public_assessments_export"),
        "status": "COMPLETED",
        "start_date": datetime.fromisoformat(policy["start_date"]).date().isoformat(),
        "reviewer_count": len(reviewers),
        "assessment_count": len(assessments),
        "filtered_to_human_reviewed_overall": True,
        "source_assessment_count_before_overall_filter": len(source_candidates),
        "removed_without_human_reviewed_overall": len(source_candidates) - len(assessments),
        "overall_filter_applied_at": metadata_policy.get("overall_filter_applied_at"),
    }
    if metadata["overall_filter_applied_at"] is None:
        metadata.pop("overall_filter_applied_at")

    stats = {
        "completed_jobs_after_start": len(jobs),
        "source_candidates": len(source_candidates),
        "selected_assessments": len(assessments),
        "selected_reviewers": len(reviewers),
        "excluded_assessment_ids": sorted(excluded_ids),
        "disallowed_reviewer_names": len(disallowed_names),
        "disallowed_reviewer_source_ids": len(disallowed_source_ids),
    }
    return {"metadata": metadata, "reviewers": reviewers, "assessments": assessments}, reviewer_entries, stats


def ensure_tool(command: str) -> None:
    if shutil.which(command) is None:
        raise PipelineError(f"Required command is unavailable: {command}")


def run(command: list[str], cwd: Path, env: dict[str, str] | None = None) -> None:
    rendered = " ".join(command)
    print(f"+ {rendered}", flush=True)
    result = subprocess.run(command, cwd=cwd, env=env)
    if result.returncode:
        raise PipelineError(f"Command failed with exit code {result.returncode}: {rendered}")


def run_rmlmapper(
    command: list[str],
    cwd: Path,
    mapping_path: Path,
    output_path: Path,
    env: dict[str, str] | None = None,
) -> None:
    rendered = " ".join(command)
    for attempt in (1, 2):
        print(f"+ {rendered}", flush=True)
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode == 0:
            return
        mapping_is_valid = False
        try:
            parse_graph(mapping_path)
            mapping_is_valid = True
        except PipelineError:
            pass
        transient = (
            mapping_is_valid
            and "Unable to parse mapping rules as Turtle" in result.stderr
        )
        if transient and attempt == 1:
            output_path.unlink(missing_ok=True)
            print("RMLMapper transient parse race detected; retrying once")
            time.sleep(3)
            continue
        if result.stdout:
            print(result.stdout, file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        raise PipelineError(
            f"Command failed with exit code {result.returncode}: {rendered}"
        )


def ensure_rmlmapper(path: Path) -> None:
    if path.exists() and sha256_file(path) == RMLMAPPER_SHA256:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".download")
    print(f"Downloading RMLMapper {RMLMAPPER_VERSION}", flush=True)
    try:
        urllib.request.urlretrieve(RMLMAPPER_URL, temporary)
    except Exception as error:
        temporary.unlink(missing_ok=True)
        raise PipelineError(f"Could not download RMLMapper: {error}") from error
    actual = sha256_file(temporary)
    if actual != RMLMAPPER_SHA256:
        temporary.unlink(missing_ok=True)
        raise PipelineError(
            f"RMLMapper checksum mismatch: expected {RMLMAPPER_SHA256}, found {actual}"
        )
    temporary.replace(path)


def prepare_stage(stage: Path, openalex_cache: Path) -> None:
    if stage.exists():
        shutil.rmtree(stage)
    for directory in ("assessments", "mappings", "knowledge"):
        (stage / directory).mkdir(parents=True, exist_ok=True)
    shutil.copy2(openalex_cache, stage / "assessments" / ".openalex-cache.json")
    shutil.copy2(ROOT / "mappings" / "ripe.yarrrml.yml", stage / "mappings" / "ripe.yarrrml.yml")
    shutil.copy2(ROOT / "knowledge" / "ripe.ttl", stage / "knowledge" / "ripe.ttl")


def promote_stage(stage: Path, destination: Path) -> None:
    backup = destination.with_name(f".{destination.name}.previous-{uuid4().hex}")
    moved_previous = False
    try:
        if destination.exists():
            destination.replace(backup)
            moved_previous = True
        stage.replace(destination)
    except Exception:
        if moved_previous and backup.exists() and not destination.exists():
            backup.replace(destination)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def wait_for_stable_file(path: Path, attempts: int = 40) -> None:
    """Wait for generators that return before their output stream is fully visible."""
    previous: tuple[int, int] | None = None
    unchanged = 0
    for _ in range(attempts):
        if path.exists():
            stat = path.stat()
            current = (stat.st_size, stat.st_mtime_ns)
            if current == previous and stat.st_size > 0:
                unchanged += 1
                if unchanged >= 8:
                    return
            else:
                unchanged = 0
            previous = current
        time.sleep(0.25)
    raise PipelineError(f"Generated file did not become stable: {path}")


def parse_graph(path: Path) -> Graph:
    try:
        return Graph().parse(path, format="turtle")
    except Exception as error:
        raise PipelineError(f"RDF parse failed for {path}: {error}") from error


def validate_expected(
    export: dict[str, Any], policy: dict[str, Any], stage: Path
) -> dict[str, Any]:
    expected = policy.get("expected") or {}
    actual = {
        "assessment_count": len(export.get("assessments", [])),
        "reviewer_count": len(export.get("reviewers", {})),
        "source_assessment_count_before_overall_filter": export["metadata"].get(
            "source_assessment_count_before_overall_filter"
        ),
        "removed_without_human_reviewed_overall": export["metadata"].get(
            "removed_without_human_reviewed_overall"
        ),
    }
    differences = {
        key: {"expected": value, "actual": actual.get(key)}
        for key, value in expected.items()
        if key in actual and actual.get(key) != value
    }
    if differences:
        raise PipelineError(f"Release count validation failed: {differences}")

    forbidden = set(policy.get("excluded_assessment_ids") or [])
    present = forbidden.intersection(item["id"] for item in export["assessments"])
    if present:
        raise PipelineError(f"Excluded assessment IDs are present: {sorted(present)}")

    serialized = json.dumps(export, ensure_ascii=False)
    for key in PRIVATE_KEYS:
        if f'"{key}"' in serialized:
            raise PipelineError(f"Private key leaked into public export: {key}")

    ontology_graph = parse_graph(stage / "knowledge" / "ripe.ttl")
    mapping_graph = parse_graph(stage / "mappings" / "ripe.rml.ttl")
    data_graph = parse_graph(stage / "knowledge" / "ripe-data.ttl")
    assessment_class = URIRef("https://w3id.org/ripe/ripe-o#ResearchIntegrityAssessment")
    reviewer_class = URIRef("https://w3id.org/ripe/ripe-o#HumanReviewer")
    semantic_counts = {
        "rdf_assessment_count": len(set(data_graph.subjects(RDF.type, assessment_class))),
        "rdf_reviewer_count": len(set(data_graph.subjects(RDF.type, reviewer_class))),
    }
    if semantic_counts["rdf_assessment_count"] != actual["assessment_count"]:
        raise PipelineError(
            "RDF assessment count does not match the public assessment export"
        )
    if semantic_counts["rdf_reviewer_count"] != actual["reviewer_count"]:
        raise PipelineError("RDF reviewer count does not match the public reviewer index")
    graphs = {
        "ontology_triples": len(ontology_graph),
        "mapping_triples": len(mapping_graph),
        "data_triples": len(data_graph),
        **semantic_counts,
    }
    return {**actual, **graphs}


def build_manifest(
    version: str,
    stage: Path,
    stats: dict[str, Any],
    validation: dict[str, Any],
) -> dict[str, Any]:
    artifacts = {}
    for relative in (
        "assessments/.openalex-cache.json",
        "assessments/assessments.json",
        "assessments/assessments_enriched.json",
        "assessments/assessments_yarrrml.json",
        "mappings/ripe.yarrrml.yml",
        "mappings/ripe.rml.ttl",
        "knowledge/ripe-data.ttl",
        "knowledge/ripe.ttl",
    ):
        path = stage / relative
        artifacts[relative] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return {
        "release_version": version,
        "pipeline": {
            "ontology": {"name": "RIPE-O", "version": "1.0.0"},
            "yarrrml_parser": YARRRML_PARSER,
            "rmlmapper": RMLMAPPER_VERSION,
            "rmlmapper_sha256": RMLMAPPER_SHA256,
        },
        "inputs": {
            "openalex_cache": {
                "sha256": sha256_file(stage / "assessments" / ".openalex-cache.json"),
                "entries": len(load_json(stage / "assessments" / ".openalex-cache.json")),
            },
        },
        "selection": stats,
        "validation": validation,
        "artifacts": artifacts,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--version", required=True)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--reviewer-index", type=Path, default=DEFAULT_REVIEWER_INDEX)
    parser.add_argument("--openalex-cache", type=Path, default=DEFAULT_OPENALEX_CACHE)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--update-reviewer-index", action="store_true")
    parser.add_argument(
        "--rmlmapper-jar",
        type=Path,
        default=ROOT / ".build" / "tools" / "rmlmapper.jar",
    )
    return parser.parse_args()


def main() -> int:
    global ACTIVE_STAGE
    args = parse_args()
    if not args.database_url:
        raise PipelineError("--database-url or DATABASE_URL is required")
    policy_path = args.policy.resolve()
    reviewer_index_path = args.reviewer_index.resolve()
    policy = load_json(policy_path)
    validate_policy(policy)
    reviewer_index_data = load_json(reviewer_index_path)
    reviewer_entries = parse_reviewer_entries(reviewer_index_data)
    destination = (args.output or (DEFAULT_OUTPUT_ROOT / args.version)).resolve()
    if destination == ROOT or ROOT not in destination.parents:
        raise PipelineError(
            f"Output must be an isolated directory under {ROOT}: {destination}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = destination.with_name(f".{destination.name}.tmp-{uuid4().hex}")
    ACTIVE_STAGE = stage

    ensure_tool("bunx")
    ensure_tool("java")
    ensure_rmlmapper(args.rmlmapper_jar.resolve())
    prepare_stage(stage, args.openalex_cache.resolve())

    jobs = read_jobs(
        args.database_url,
        policy["start_date"],
        policy["inspectai_ui_versions"],
        policy.get("end_date"),
    )
    export, reviewer_entries, stats = build_assessment_export(jobs, policy, reviewer_entries)
    stats["source_snapshot_sha256"] = source_snapshot_digest(jobs)
    stats["release_policy_sha256"] = sha256_file(policy_path)
    stats["reviewer_index_input_sha256"] = sha256_file(reviewer_index_path)
    validate_public_json(export, "assessments.json")
    write_json(
        stage / "assessments" / "assessments.json", export, trailing_newline=True
    )
    environment = os.environ.copy()
    run(
        [sys.executable, str(ROOT / "scripts" / "release" / "enrich_openalex.py")],
        stage,
        environment,
    )
    validate_public_json(
        load_json(stage / "assessments" / "assessments_enriched.json"),
        "assessments_enriched.json",
    )
    run(
        [sys.executable, str(ROOT / "scripts" / "release" / "preprocess.py")],
        stage,
        environment,
    )
    validate_public_json(
        load_json(stage / "assessments" / "assessments_yarrrml.json"),
        "assessments_yarrrml.json",
    )
    run(
        [
            "bunx",
            "--yes",
            YARRRML_PARSER,
            "-i",
            "mappings/ripe.yarrrml.yml",
            "-o",
            "mappings/ripe.rml.ttl",
        ],
        stage,
        environment,
    )
    mapping_path = stage / "mappings" / "ripe.rml.ttl"
    wait_for_stable_file(mapping_path)
    parse_graph(mapping_path)
    # bunx can return while the parser's detached Node process is still winding
    # down. RMLMapper/RDF4J transiently misreads even a complete Turtle file
    # until that process exits, so require a short isolation barrier here.
    time.sleep(5)
    # yarrrml-parser can leave its output open briefly after the CLI exits.
    # RMLMapper/RDF4J then observes an artificial EOF parse error. Consume an
    # immutable copy while retaining the canonical generated artifact unchanged.
    mapper_input = stage / "mappings" / ".ripe.rmlmapper-input.ttl"
    shutil.copyfile(mapping_path, mapper_input)
    parse_graph(mapper_input)
    rml_output = stage / "knowledge" / "ripe-data.ttl"
    rml_command = [
        "java",
        "-jar",
        str(args.rmlmapper_jar.resolve()),
        "-m",
        str(mapper_input),
        "-o",
        str(rml_output),
        "-s",
        "turtle",
    ]
    run_rmlmapper(rml_command, stage, mapper_input, rml_output, environment)
    mapper_input.unlink()

    validation = validate_expected(export, policy, stage)
    manifest = build_manifest(args.version, stage, stats, validation)
    manifest_path = stage / "release-manifest.json"
    write_json(manifest_path, manifest)
    checksum_paths = [*manifest["artifacts"], "release-manifest.json"]
    checksum_lines = [
        f"{sha256_file(stage / relative)}  {relative}"
        for relative in sorted(checksum_paths)
    ]
    (stage / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n")
    promote_stage(stage, destination)
    ACTIVE_STAGE = None
    generated_cache = destination / "assessments" / ".openalex-cache.json"
    canonical_cache = args.openalex_cache.resolve()
    if sha256_file(generated_cache) != sha256_file(canonical_cache):
        copy_file_atomic(generated_cache, canonical_cache)
    if args.update_reviewer_index:
        write_json_atomic(
            reviewer_index_path, serialize_reviewer_entries(reviewer_entries)
        )

    print(f"Release candidate written to {destination}")
    print(json.dumps(validation, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PipelineError as error:
        if ACTIVE_STAGE is not None and ACTIVE_STAGE.exists():
            shutil.rmtree(ACTIVE_STAGE)
        print(f"Pipeline failed: {error}", file=sys.stderr)
        raise SystemExit(1)
