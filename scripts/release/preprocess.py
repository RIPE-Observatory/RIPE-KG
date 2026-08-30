#!/usr/bin/env python3
"""Prepare extracted RIPE assessments for the YARRRML mapping.

Reads assessments/assessments_enriched.json and writes
assessments/assessments_yarrrml.json. The script creates local RIPE author
identifiers, attaches SemOpenAlex author links where OpenAlex authorship matching
is safe, normalizes timestamps, and adds the helper fields consumed by
mappings/ripe.yarrrml.yml.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from hashlib import sha256
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote


INPUT = Path("assessments/assessments_enriched.json")
OUTPUT = Path("assessments/assessments_yarrrml.json")
RIPE_KG = "https://w3id.org/ripe/ripe-kg/"

QUESTION_DATA_SUFFIX = {
    "Q1.1": "q11",
    "Q1.2": "q12",
    "Q1.3": "q13",
    "Q2.2": "q22",
    "OVERALL": "overall",
}

QUESTION_IRI_SUFFIX = {
    "Q1.1": "1-1",
    "Q1.2": "1-2",
    "Q1.3": "1-3",
    "Q2.2": "2-2",
    "OVERALL": "overall",
}

OPENALEX_TO_SEMOPENALEX = {
    "A": "author",
    "W": "work",
    "I": "institution",
    "S": "source",
}

NON_REFERENCE_TITLE_PATTERNS = (
    "office 365",
    "microsoft 365",
    "activate office",
    "university username",
    "make changes to your device",
)
EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")


def normalize(text: str | None) -> str:
    """Normalize text for deterministic name and affiliation comparison."""
    if not text:
        return ""
    try:
        text = text.encode("latin-1").decode("utf-8")
    except (UnicodeDecodeError, UnicodeEncodeError):
        pass
    text = text.replace("\u0131", "i").replace("\u00df", "ss")
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = re.sub(r"[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]", "-", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return text.lower().strip()


def normalize_doi(value: str | None) -> str | None:
    doi = normalize(value)
    if not doi or doi == "unavailable":
        return None
    doi = doi.removeprefix("https://doi.org/").removeprefix("http://doi.org/")
    return doi or None


def generated_local_id(prefix: str, seed: str) -> str:
    return prefix + sha256(seed.encode("utf-8")).hexdigest()[:16].upper()


def generated_work_id(seed: str) -> str:
    return generated_local_id("RIPEW", seed)


def publisher_id(label: str | None) -> str | None:
    normalized = normalize(label)
    return generated_local_id("RIPEP", normalized) if normalized else None


def classify_notice_type(retraction_nature: str | None) -> str | None:
    value = normalize(retraction_nature)
    if "expression of concern" in value:
        return "expression-of-concern"
    if any(term in value for term in ("correction", "erratum", "corrigendum")):
        return "correction-notice"
    return None


def organization_id(label: str | None) -> str | None:
    normalized = normalize_affiliation(label)
    return generated_local_id("RIPEO", normalized) if normalized else None


def work_uri_parts_from_metadata(metadata: dict[str, Any], fallback_id: str | None) -> tuple[str, str, str | None]:
    doi = normalize_doi(metadata.get("doi_value") or metadata.get("doi"))
    if doi:
        return RIPE_KG + "work/" + quote(doi, safe=""), "doi", doi

    title = normalize(metadata.get("main_title") or metadata.get("title"))
    if title:
        work_id = generated_work_id(f"title:{title}")
        return RIPE_KG + "work/" + work_id, "title-hash", work_id

    if not fallback_id:
        raise ValueError("Cannot mint a generated work IRI without DOI, title, or fallback ID")
    work_id = generated_work_id(f"fallback:{fallback_id}")
    return RIPE_KG + "work/" + work_id, "fallback-hash", work_id


def work_uri_from_metadata(metadata: dict[str, Any], fallback_id: str | None) -> str:
    return work_uri_parts_from_metadata(metadata, fallback_id)[0]


def work_uri_from_doi_or_title(doi: str | None, title: str | None, fallback_id: str | None) -> str:
    return work_uri_from_metadata({"doi": doi, "title": title}, fallback_id)


def remove_email_addresses(text: str) -> str:
    text = EMAIL_PATTERN.sub("", text)
    text = re.sub(r"\b(Electronic address|E-mail|Email)\s*:?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.;:])", r"\1", text)
    text = re.sub(r"([,;:])\s*([,;:.])", r"\2", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip(" ,;:")


def dehyphenate(text: str) -> str:
    return re.sub(r"[-\s.]", "", text)


def name_tokens(text: str | None) -> list[str]:
    return re.findall(r"[a-z0-9]+", normalize(text))


def given_tokens(author: dict[str, Any]) -> list[str]:
    parts = [author.get("forename") or "", author.get("middle_name") or ""]
    return name_tokens(" ".join(part for part in parts if part))


def token_compatible(left: str, right: str) -> bool:
    left = normalize(left).replace(".", "")
    right = normalize(right).replace(".", "")
    if not left or not right:
        return False
    if left == right or dehyphenate(left) == dehyphenate(right):
        return True
    if len(left) == 1 and right.startswith(left):
        return True
    if len(right) == 1 and left.startswith(right):
        return True
    return False


def extract_forename(display_name: str, surname: str) -> str:
    display = normalize(display_name)
    surname_norm = normalize(surname)
    if not display or not surname_norm:
        return ""
    if display.endswith(surname_norm):
        return re.sub(r"^[,;:\s]+|[,;:\s]+$", "", display[: -len(surname_norm)].strip())
    if display.startswith(surname_norm):
        return re.sub(r"^[,;:\s]+|[,;:\s]+$", "", display[len(surname_norm) :].strip())
    return re.sub(r"^[,;:\s]+|[,;:\s]+$", "", display)


def given_name_compatible(grobid_author: dict[str, Any], openalex_forename: str) -> bool:
    """Compare GROBID and OpenAlex given names conservatively."""
    grobid_forename = grobid_author.get("forename") or ""
    if token_compatible(grobid_forename, openalex_forename):
        return True

    grobid_tokens = given_tokens(grobid_author)
    openalex_tokens = name_tokens(openalex_forename)
    if not grobid_tokens or not openalex_tokens:
        return False

    if sorted(grobid_tokens) == sorted(openalex_tokens):
        return True

    shared = min(len(grobid_tokens), len(openalex_tokens))
    if all(token_compatible(grobid_tokens[i], openalex_tokens[i]) for i in range(shared)):
        extras = grobid_tokens[shared:] + openalex_tokens[shared:]
        return all(len(token) == 1 for token in extras)

    return False


def first_initial_compatible(grobid_author: dict[str, Any], openalex_forename: str) -> bool:
    grobid_tokens = given_tokens(grobid_author)
    openalex_tokens = name_tokens(openalex_forename)
    return bool(grobid_tokens and openalex_tokens and grobid_tokens[0][0] == openalex_tokens[0][0])


def normalize_affiliation(text: str | None) -> str:
    if not text:
        return ""
    text = normalize(text).replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def grobid_affiliations(author: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for affiliation in author.get("affiliations") or []:
        if isinstance(affiliation, str):
            values.append(affiliation)
        elif isinstance(affiliation, dict) and affiliation.get("name"):
            values.append(affiliation["name"])
    return [value for value in values if value]


def openalex_affiliations(authorship: dict[str, Any]) -> list[str]:
    values: list[str] = []
    values.extend(value for value in authorship.get("raw_affiliation_strings") or [] if value)
    for affiliation in authorship.get("affiliations") or []:
        if isinstance(affiliation, dict) and affiliation.get("raw_affiliation_string"):
            values.append(affiliation["raw_affiliation_string"])
    for institution in authorship.get("institutions") or []:
        if isinstance(institution, dict) and institution.get("display_name"):
            values.append(institution["display_name"])
    return values


def affiliation_overlap(grobid_author: dict[str, Any], authorship: dict[str, Any]) -> bool:
    left_values = [normalize_affiliation(value) for value in grobid_affiliations(grobid_author)]
    right_values = [normalize_affiliation(value) for value in openalex_affiliations(authorship)]
    for left in left_values:
        if len(left) < 10:
            continue
        for right in right_values:
            if len(right) < 10:
                continue
            shorter, longer = sorted((left, right), key=len)
            if shorter in longer:
                return True
    return False


def openalex_to_semopenalex(uri: str | None) -> str | None:
    if not uri:
        return None
    short_id = uri.rstrip("/").split("/")[-1]
    entity_type = OPENALEX_TO_SEMOPENALEX.get(short_id[:1])
    if entity_type:
        return f"https://semopenalex.org/{entity_type}/{short_id}"
    return None


def compact_openalex(work: dict[str, Any] | None) -> dict[str, str] | None:
    if not isinstance(work, dict):
        return None
    soa_work_uri = work.get("soa_work_uri") or openalex_to_semopenalex(work.get("work_id"))
    if not soa_work_uri:
        return None
    return {"soa_work_uri": soa_work_uri}


def nullify_empty(obj: dict[str, Any], keys: list[str]) -> None:
    for key in keys:
        if isinstance(obj.get(key), str):
            value = obj[key].strip()
            if value == "" or value.lower() in {"unavailable", "n/a", "none", "null"}:
                obj[key] = None


def is_reference_for_mapping(reference: dict[str, Any]) -> bool:
    if reference.get("doi") or reference.get("openalex"):
        return True
    title = normalize(reference.get("title"))
    return bool(title) and not any(pattern in title for pattern in NON_REFERENCE_TITLE_PATTERNS)


def normalize_datetime(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip().replace(" ", "T")
    if candidate.endswith("+00"):
        candidate = candidate[:-3] + "+00:00"
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_affiliation_label(label: str, author: dict[str, Any], assessment_author_names: set[str]) -> str | None:
    if not label:
        return None
    value = remove_email_addresses(label.strip())
    value = re.sub(r"^\s*Corresponding\s+[Aa]uthor\.\s*", "", value).strip()
    if not value:
        return None
    normalized = normalize(value)
    canonical = f"{author.get('forename') or ''} {author.get('surname') or ''}".strip()
    blocked = {
        normalize(canonical),
        normalize(author.get("forename") or ""),
        normalize(author.get("surname") or ""),
    }
    blocked.update(assessment_author_names)
    if normalized in blocked:
        return None
    if value.startswith(("'", '"')) and value.endswith(("'", '"')):
        return None
    return value


def match_authors(grobid_authors: list[dict[str, Any]], authorships: list[dict[str, Any]]) -> dict[int, tuple[str, str]]:
    """Return GROBID-index to (match rule, SemOpenAlex author URI)."""
    matches: dict[int, tuple[str, str]] = {}

    for index, grobid_author in enumerate(grobid_authors):
        surname = normalize(grobid_author.get("surname"))
        if not surname or index >= len(authorships):
            continue
        authorship = authorships[index]
        display_name = authorship.get("display_name") or ""
        if surname not in normalize(display_name):
            continue
        forename = extract_forename(display_name, grobid_author.get("surname") or "")
        if given_name_compatible(grobid_author, forename):
            soa_uri = openalex_to_semopenalex(authorship.get("author_id"))
            if soa_uri:
                matches[index] = ("slot_name", soa_uri)

    for index, grobid_author in enumerate(grobid_authors):
        if index in matches:
            continue
        surname = normalize(grobid_author.get("surname"))
        if not surname or index >= len(authorships):
            continue
        authorship = authorships[index]
        display_name = authorship.get("display_name") or ""
        if surname not in normalize(display_name):
            continue
        forename = extract_forename(display_name, grobid_author.get("surname") or "")
        if first_initial_compatible(grobid_author, forename) and affiliation_overlap(grobid_author, authorship):
            soa_uri = openalex_to_semopenalex(authorship.get("author_id"))
            if soa_uri:
                matches[index] = ("slot_affiliation", soa_uri)

    return matches


class AuthorRegistry:
    """Assign deterministic RIPE author identifiers for graph construction."""

    def __init__(self) -> None:
        self.key_to_id: dict[tuple[str, str], str] = {}
        self.entries: dict[str, dict[str, Any]] = {}

    def register(
        self,
        author: dict[str, Any],
        soa_author_uri: str | None,
        local_identity_key: str,
    ) -> str:
        forename = author.get("forename") or ""
        surname = author.get("surname") or ""
        key = ("soa", soa_author_uri) if soa_author_uri else ("local", local_identity_key)

        author_id = self.key_to_id.get(key)
        if not author_id:
            author_id = generated_local_id("RIPEAU", f"{key[0]}:{key[1]}")
            self.key_to_id[key] = author_id
            self.entries[author_id] = {
                "canonical_name": f"{forename} {surname}".strip(),
                "forename": forename,
                "surname": surname,
                "soa_author_uri": soa_author_uri,
                "occurrences": 0,
            }
        self.entries[author_id]["occurrences"] += 1
        return author_id


def assessed_work_key(metadata: dict[str, Any], assessment_id: str | None) -> str:
    doi = normalize_doi(metadata.get("doi_value"))
    if doi:
        return f"doi:{doi}"
    title = normalize(metadata.get("main_title"))
    if title:
        return f"title:{title}"
    return f"assessment:{assessment_id or ''}"


def add_inspect_helpers(assessment: dict[str, Any]) -> None:
    inspect_sr = (assessment.get("results") or {}).get("inspect_sr") or {}
    rows = inspect_sr.get("data") or []
    assessment_id = assessment.get("id")
    reviewer_id = assessment.get("reviewer_rv_id")

    automated_by_question: dict[str, str] = {}
    reviewed_by_question: dict[str, str] = {}
    automated_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    reviewed_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)

    def hypothesis_uri(agent: str, question_id: str) -> str | None:
        suffix = QUESTION_IRI_SUFFIX.get(question_id)
        if not assessment_id or not suffix:
            return None
        return f"{RIPE_KG}integrity-assessment-hypothesis/{assessment_id}-{agent}-{suffix}"

    for row in rows:
        if not isinstance(row, dict):
            continue
        row["assessment_id"] = assessment_id
        row["reviewer_rv_id"] = reviewer_id
        nullify_empty(row, ["comment", "automated_judgement", "reviewed_judgement"])
        question_id = row.get("question_id")
        if row.get("automated_judgement"):
            automated_rows[question_id].append(row)
            uri = hypothesis_uri("inspectai", question_id)
            if uri:
                automated_by_question[question_id] = uri
        if row.get("reviewed_judgement"):
            reviewed_rows[question_id].append(row)
            uri = hypothesis_uri("human", question_id)
            if uri:
                reviewed_by_question[question_id] = uri

    for row in rows:
        if not isinstance(row, dict):
            continue
        question_id = row.get("question_id")
        if row.get("reviewed_judgement"):
            row["automated_hypothesis_uri"] = automated_by_question.get(question_id)
        if question_id == "OVERALL":
            row["q11_automated_hypothesis_uri"] = automated_by_question.get("Q1.1")
            row["q12_automated_hypothesis_uri"] = automated_by_question.get("Q1.2")
            row["q13_automated_hypothesis_uri"] = automated_by_question.get("Q1.3")
            row["q22_automated_hypothesis_uri"] = automated_by_question.get("Q2.2")
            row["q11_reviewed_hypothesis_uri"] = reviewed_by_question.get("Q1.1")
            row["q12_reviewed_hypothesis_uri"] = reviewed_by_question.get("Q1.2")
            row["q13_reviewed_hypothesis_uri"] = reviewed_by_question.get("Q1.3")
            row["q22_reviewed_hypothesis_uri"] = reviewed_by_question.get("Q2.2")
            row["overall_automated_hypothesis_uri"] = automated_by_question.get("OVERALL")

    for question_id, suffix in QUESTION_DATA_SUFFIX.items():
        inspect_sr[f"{suffix}_automated_answered"] = automated_rows.get(question_id, [])
        inspect_sr[f"{suffix}_reviewed_answered"] = reviewed_rows.get(question_id, [])
        assessment[f"{suffix}_automated_hypothesis_uri"] = automated_by_question.get(question_id)
        assessment[f"{suffix}_reviewed_hypothesis_uri"] = reviewed_by_question.get(question_id)
    inspect_sr["data_automated_answered"] = [row for rows_for_q in automated_rows.values() for row in rows_for_q]
    inspect_sr["data_reviewed_answered"] = [row for rows_for_q in reviewed_rows.values() for row in rows_for_q]


def add_reference_helpers(assessment: dict[str, Any]) -> None:
    assessment_id = assessment.get("id")
    work_uri = assessment.get("work_uri")
    payload = (((assessment.get("results") or {}).get("checks") or {}).get("grobid_reference_metadata") or {}).get("payload", {})
    refs = payload.get("references_full") or []
    references_for_mapping = []
    for index, reference in enumerate(refs):
        if not isinstance(reference, dict):
            continue
        reference["assessment_id"] = assessment_id
        reference["source_work_uri"] = work_uri
        reference["reference_index"] = index
        reference["work_doi"] = normalize_doi(reference.get("doi"))
        reference["reference_work_uri"] = work_uri_from_doi_or_title(
            reference["work_doi"],
            reference.get("title"),
            f"{assessment_id}-reference-{index}",
        )
        reference["openalex"] = compact_openalex(reference.get("openalex"))
        nullify_empty(reference, ["doi", "title"])
        if is_reference_for_mapping(reference):
            references_for_mapping.append(reference)
    payload["references_for_mapping"] = references_for_mapping


def add_notice_helpers(assessment: dict[str, Any]) -> None:
    assessment_id = assessment.get("id")
    checks = ((assessment.get("results") or {}).get("checks") or {})

    def prepare_notice(record: dict[str, Any], question_prefix: str) -> None:
        record["assessment_id"] = assessment_id
        record["work_uri"] = assessment.get("work_uri")
        record["retraction_doi"] = normalize_doi(record.get("retraction_doi"))
        record["original_work_doi"] = normalize_doi(record.get("original_paper_doi"))
        record["original_paper_doi"] = record["original_work_doi"]
        record["original_work_uri"] = work_uri_from_doi_or_title(
            record["original_work_doi"],
            None,
            f"{assessment_id}-notice-{record.get('record_id') or 'unknown'}-original",
        )
        record[f"{question_prefix}_automated_hypothesis_uri"] = assessment.get(f"{question_prefix}_automated_hypothesis_uri")
        record[f"{question_prefix}_reviewed_hypothesis_uri"] = assessment.get(f"{question_prefix}_reviewed_hypothesis_uri")
        record["publisher_id"] = publisher_id(record.get("publisher"))
        record["openalex_notice"] = compact_openalex(record.get("openalex_notice"))
        record["openalex_original"] = compact_openalex(record.get("openalex_original"))
        record["ripe_notice_type"] = classify_notice_type(record.get("retraction_nature"))
        nullify_empty(record, [
            "record_id", "retraction_doi", "original_paper_doi", "title", "reason",
            "journal", "publisher", "retraction_date", "original_paper_date",
            "retraction_nature", "ripe_notice_type",
        ])

    retraction_payload = (checks.get("retraction_detection") or {}).get("payload") or {}
    for record in ((retraction_payload.get("main_article_result") or {}).get("retractions") or []):
        if isinstance(record, dict):
            prepare_notice(record, "q11")
    for result in retraction_payload.get("reference_results") or []:
        if not isinstance(result, dict):
            continue
        result["assessment_id"] = assessment_id
        for record in result.get("retractions") or []:
            if isinstance(record, dict):
                prepare_notice(record, "q11")

    eoc_payload = (checks.get("eoc_correction_detection") or {}).get("payload") or {}
    for record in ((eoc_payload.get("main_article_result") or {}).get("notices") or []):
        if isinstance(record, dict):
            prepare_notice(record, "q12")


def add_pubpeer_helpers(assessment: dict[str, Any]) -> None:
    assessment_id = assessment.get("id")
    work_uri = assessment.get("work_uri")
    result = (((assessment.get("results") or {}).get("checks") or {}).get("pubpeer_signal_analysis") or {}).get("payload", {}).get("main_paper_result") or {}
    scraped = result.get("scraped_comments") or {}
    if not isinstance(scraped, dict):
        return
    feedbacks = ((result.get("api_result") or {}).get("feedbacks") or [])
    feedback = feedbacks[0] if feedbacks and isinstance(feedbacks[0], dict) else {}
    thread_url = scraped.get("pubpeer_url") or feedback.get("url")
    last_commented_at = scraped.get("last_commented_at") or feedback.get("last_commented_at")
    scraped["assessment_id"] = assessment_id
    scraped["work_uri"] = work_uri
    scraped["pubpeer_url"] = thread_url
    scraped["last_commented_at"] = last_commented_at
    nullify_empty(scraped, ["summary", "pubpeer_url", "last_commented_at"])
    for comment in scraped.get("comments") or []:
        if not isinstance(comment, dict):
            continue
        comment["assessment_id"] = assessment_id
        comment["work_uri"] = work_uri
        comment["pubpeer_url"] = thread_url
        comment["last_commented_at"] = last_commented_at
        comment["q12_automated_hypothesis_uri"] = assessment.get("q12_automated_hypothesis_uri")
        comment["q12_reviewed_hypothesis_uri"] = assessment.get("q12_reviewed_hypothesis_uri")
        nullify_empty(comment, ["id", "date", "author", "comment", "pubpeer_url", "last_commented_at"])


def prepare_registry_evidence(assessment: dict[str, Any]) -> None:
    checks = ((assessment.get("results") or {}).get("checks") or {})
    for check_name in ["trial_llm_extraction"]:
        payload = (checks.get(check_name) or {}).get("payload") or {}
        nullify_empty(payload, ["trial_id", "registry_type"])
    timeline = (checks.get("timeline_consistency") or {}).get("payload") or {}
    for key in ["recruitment_start", "recruitment_finish", "study_end_date"]:
        value = timeline.get(key) or {}
        if isinstance(value, dict):
            nullify_empty(value, ["normalized_date", "interpretation_comment"])


def prepare_authors(assessment: dict[str, Any], registry: AuthorRegistry, stats: dict[str, int]) -> None:
    assessment_id = assessment.get("id")
    work_uri = assessment.get("work_uri")
    gm = (((assessment.get("results") or {}).get("checks") or {}).get("grobid_primary_metadata") or {}).get("payload") or {}
    authors = gm.get("main_authors") or []
    openalex = gm.get("openalex") if isinstance(gm.get("openalex"), dict) else {}
    authorships = openalex.get("authorships") or []
    matches = match_authors(authors, authorships) if authorships else {}
    gm["openalex"] = compact_openalex(openalex)
    work_key = assessed_work_key(gm, assessment_id)

    assessment_author_names = {
        normalize(f"{author.get('forename') or ''} {author.get('surname') or ''}".strip())
        for author in authors
        if author.get("forename") or author.get("surname")
    }

    gm["ripe_authors"] = []
    gm["ripe_author_affiliations"] = []
    index_to_author_id: dict[int, str] = {}
    seen_assessment_authors: set[str] = set()

    for index, author in enumerate(authors):
        match = matches.get(index)
        match_rule = match[0] if match else None
        soa_author_uri = match[1] if match else None
        if match_rule:
            stats[match_rule] += 1
        elif authorships:
            stats["unmatched_author_link"] += 1
        else:
            stats["no_openalex_authorship"] += 1

        local_identity_key = "|".join([
            work_key,
            str(index),
            normalize(author.get("surname")),
            dehyphenate(normalize(author.get("forename"))),
        ])
        author_id = registry.register(author, soa_author_uri, local_identity_key)
        index_to_author_id[index] = author_id
        stats["author_occurrences"] += 1

        if author_id not in seen_assessment_authors:
            entry = registry.entries[author_id]
            gm["ripe_authors"].append({
                "assessment_id": assessment_id,
                "work_uri": work_uri,
                "author_index": index,
                "ripe_author_id": author_id,
                "canonical_name": entry["canonical_name"],
                "forename": entry["forename"] or None,
                "surname": entry["surname"] or None,
                "soa_author_uri": entry.get("soa_author_uri"),
            })
            seen_assessment_authors.add(author_id)

        seen_affiliations: set[str] = set()
        for affiliation in grobid_affiliations(author):
            label = clean_affiliation_label(affiliation, author, assessment_author_names)
            if not label:
                continue
            normalized_label = normalize_affiliation(label)
            if normalized_label in seen_affiliations:
                continue
            gm["ripe_author_affiliations"].append({
                "assessment_id": assessment_id,
                "work_uri": work_uri,
                "author_index": index,
                "ripe_author_id": author_id,
                "organization_label": label,
                "organization_id": organization_id(label),
            })
            seen_affiliations.add(normalized_label)

    q13_payload = (((assessment.get("results") or {}).get("checks") or {}).get("author_retraction_history") or {}).get("payload") or {}
    for index, author_result in enumerate(q13_payload.get("author_results") or []):
        if not isinstance(author_result, dict):
            continue
        author_result["author_result_index"] = index
        author_id = index_to_author_id.get(index)
        for record in author_result.get("retractions") or []:
            if not isinstance(record, dict):
                continue
            record["assessment_id"] = assessment_id
            record["work_uri"] = work_uri
            record["retraction_doi"] = normalize_doi(record.get("retraction_doi"))
            record["original_work_doi"] = normalize_doi(record.get("original_paper_doi"))
            record["original_paper_doi"] = record["original_work_doi"]
            record["original_work_uri"] = work_uri_from_doi_or_title(
                record["original_work_doi"],
                None,
                f"{assessment_id}-author-notice-{record.get('record_id') or 'unknown'}-original",
            )
            if author_id:
                record["ripe_author_id"] = author_id
                stats["q13_author_links"] += 1
            record["q13_automated_hypothesis_uri"] = assessment.get("q13_automated_hypothesis_uri")
            record["q13_reviewed_hypothesis_uri"] = assessment.get("q13_reviewed_hypothesis_uri")
            record["publisher_id"] = publisher_id(record.get("publisher"))
            record["openalex_notice"] = compact_openalex(record.get("openalex_notice"))
            record["openalex_original"] = compact_openalex(record.get("openalex_original"))
            nullify_empty(record, [
                "record_id", "retraction_doi", "original_paper_doi", "title", "reason",
                "journal", "publisher", "retraction_date", "original_paper_date",
                "retraction_nature",
            ])


def prepare_assessment(assessment: dict[str, Any], registry: AuthorRegistry, stats: dict[str, int]) -> None:
    assessment["created_at_xsd"] = normalize_datetime(assessment.get("created_at"))
    assessment["updated_at_xsd"] = normalize_datetime(assessment.get("updated_at"))
    reviewer = assessment.get("reviewer") or {}
    reviewer["rv_id"] = assessment.get("reviewer_rv_id") or reviewer.get("rv_id")
    assessment["reviewer"] = {
        "rv_id": reviewer.get("rv_id"),
        "role": reviewer.get("role"),
    }

    gm = (((assessment.get("results") or {}).get("checks") or {}).get("grobid_primary_metadata") or {}).get("payload") or {}
    nullify_empty(gm, [
        "doi_value", "main_title", "issn", "eissn", "volume", "issue", "page_from",
        "page_to", "publisher", "journal", "journal_abbrev", "publication_date",
    ])
    work_uri, work_identifier_kind, work_identifier_value = work_uri_parts_from_metadata(gm, assessment.get("id"))
    assessment["work_uri"] = work_uri
    assessment["work_identifier_kind"] = work_identifier_kind
    assessment["work_identifier_value"] = work_identifier_value
    gm["work_uri"] = work_uri
    gm["work_identifier_kind"] = work_identifier_kind
    gm["work_identifier_value"] = work_identifier_value
    gm["work_doi"] = normalize_doi(gm.get("doi_value"))
    gm["publisher_id"] = publisher_id(gm.get("publisher"))

    add_inspect_helpers(assessment)
    prepare_authors(assessment, registry, stats)
    prepare_registry_evidence(assessment)
    add_reference_helpers(assessment)
    add_notice_helpers(assessment)
    add_pubpeer_helpers(assessment)


def privacy_issues(data: dict[str, Any]) -> list[str]:
    serialized = json.dumps(data, ensure_ascii=False)
    issues = []
    if re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", serialized):
        issues.append("email-like string found")
    forbidden_keys = {
        "given_name", "family_name", "email", "username", "clerk_user_id",
        "affiliation_institution", "affiliation_department", "reviewer_id",
    }
    found_keys: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in forbidden_keys:
                    found_keys.add(key)
                walk(child)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    for assessment in data.get("assessments", []):
        walk({"reviewer": assessment.get("reviewer"), "reviewer_rv_id": assessment.get("reviewer_rv_id")})
    for reviewer in (data.get("reviewers") or {}).values():
        walk(reviewer)
    if found_keys:
        issues.append(f"forbidden reviewer keys found: {', '.join(sorted(found_keys))}")
    return issues


def main() -> int:
    with INPUT.open(encoding="utf-8") as handle:
        source = json.load(handle)

    assessments = source.get("assessments") or []
    registry = AuthorRegistry()
    stats: dict[str, int] = defaultdict(int)

    for assessment in assessments:
        prepare_assessment(assessment, registry, stats)

    reviewers = source.get("reviewers") or {}
    reviewers = {
        reviewer_id: {
            "rv_id": info.get("rv_id") or reviewer_id,
            "role": info.get("role"),
        }
        for reviewer_id, info in sorted(reviewers.items())
    }

    output = {
        "metadata": {
            "source": str(INPUT),
            "assessment_count": len(assessments),
            "reviewer_count": len(reviewers),
            "author_occurrences": stats["author_occurrences"],
            "distinct_authors": len(registry.entries),
            "authors_with_semopenalex": sum(1 for entry in registry.entries.values() if entry.get("soa_author_uri")),
            "openalex_author_match_rules": {
                "slot_name": stats["slot_name"],
                "slot_affiliation": stats["slot_affiliation"],
                "unmatched_author_link": stats["unmatched_author_link"],
                "no_openalex_authorship": stats["no_openalex_authorship"],
            },
        },
        "reviewers": reviewers,
        "assessments": assessments,
    }

    issues = privacy_issues(output)
    if issues:
        for issue in issues:
            print(f"Privacy check failed: {issue}", file=sys.stderr)
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2)

    print(f"Assessments: {len(assessments)}")
    print(f"Reviewers: {len(reviewers)}")
    print(f"Author occurrences: {stats['author_occurrences']}")
    print(f"Distinct RIPE authors: {len(registry.entries)}")
    print("OpenAlex author matches:")
    print(f"  slot_name: {stats['slot_name']}")
    print(f"  slot_affiliation: {stats['slot_affiliation']}")
    print(f"  unmatched_author_link: {stats['unmatched_author_link']}")
    print(f"  no_openalex_authorship: {stats['no_openalex_authorship']}")
    print(f"Q1.3 retraction-author links: {stats['q13_author_links']}")
    print(f"Written: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
