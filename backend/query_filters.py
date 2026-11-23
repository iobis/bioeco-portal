"""Shared Elasticsearch filter helpers for programme queries."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional, Sequence

ProgrammeStatus = Literal["active", "inactive", "all"]

_DEFAULT_TEXT_SEARCH_FIELDS = ("name^3", "description")
_GRID_TEXT_SEARCH_FIELDS = ("project",)
_PHRASE_PREFIX_MAX_EXPANSIONS = 50


def _unboost_field(field: str) -> str:
    return field.split("^", 1)[0]


def text_search_query(
    q: Optional[str],
    *,
    fields: Sequence[str] = _DEFAULT_TEXT_SEARCH_FIELDS,
) -> Optional[dict]:
    """Full-text query: fuzzy word match plus prefix on the last token.

    Returns None when ``q`` is empty. Default fields target the project index
    (boosted name + description); pass ``fields=("project",)`` for the grid index.
    """
    if not q or not q.strip():
        return None
    query = q.strip()
    field_list = list(fields)
    should: list[dict] = [
        {
            "multi_match": {
                "query": query,
                "fields": field_list,
                "type": "best_fields",
                "fuzziness": "AUTO",
            }
        }
    ]
    seen: set[str] = set()
    for field in field_list:
        base = _unboost_field(field)
        if base in seen:
            continue
        seen.add(base)
        should.append(
            {
                "match_phrase_prefix": {
                    base: {
                        "query": query,
                        "max_expansions": _PHRASE_PREFIX_MAX_EXPANSIONS,
                    }
                }
            }
        )
    return {"bool": {"should": should, "minimum_should_match": 1}}


def grid_text_search_query(q: Optional[str]) -> Optional[dict]:
    """Full-text query for the grid index ``project`` (programme name) field."""
    return text_search_query(q, fields=_GRID_TEXT_SEARCH_FIELDS)


def normalize_status(status: Optional[str]) -> ProgrammeStatus:
    if not status:
        return "all"
    value = status.strip().lower()
    if value in ("active", "inactive", "all"):
        return value  # type: ignore[return-value]
    raise ValueError("status must be one of: active, inactive, all")


def parse_readiness_levels(raw: Optional[str]) -> list[int]:
    """Parse comma-separated readiness level numbers (1–9)."""
    if not raw or not raw.strip():
        return []
    levels: list[int] = []
    seen: set[int] = set()
    for part in raw.split(","):
        token = part.strip()
        if not token:
            continue
        # Accept "5", "L5", or "Level 5 - …"
        digits = "".join(ch for ch in token if ch.isdigit())
        if not digits:
            raise ValueError(f"invalid readiness level: {part!r}")
        level = int(digits)
        if level < 1 or level > 9:
            raise ValueError("readiness levels must be between 1 and 9")
        if level not in seen:
            seen.add(level)
            levels.append(level)
    return levels


def _normalize_level_list(levels: Optional[list[int] | str]) -> list[int]:
    if isinstance(levels, str) or levels is None:
        return parse_readiness_levels(levels)
    parsed: list[int] = []
    seen: set[int] = set()
    for level in levels:
        n = int(level)
        if n < 1 or n > 9:
            raise ValueError("readiness levels must be between 1 and 9")
        if n not in seen:
            seen.add(n)
            parsed.append(n)
    return parsed


def readiness_field_filters(field: str, levels: Optional[list[int] | str] = None) -> list[dict]:
    """Match documents where ``field`` is at one of the selected levels (OR within field)."""
    parsed = _normalize_level_list(levels)
    if not parsed:
        return []
    should = [{"prefix": {field: f"Level {level}"}} for level in parsed]
    return [{"bool": {"should": should, "minimum_should_match": 1}}]


def readiness_filters(
    *,
    data: Optional[list[int] | str] = None,
    requirements: Optional[list[int] | str] = None,
    coordination: Optional[list[int] | str] = None,
) -> list[dict]:
    """AND across readiness dimensions; OR among selected levels within each dimension."""
    filters: list[dict] = []
    filters.extend(readiness_field_filters("readiness_data", data))
    filters.extend(readiness_field_filters("readiness_requirements", requirements))
    filters.extend(readiness_field_filters("readiness_coordination", coordination))
    return filters


def parse_country_codes(raw: Optional[str]) -> list[str]:
    """Parse comma-separated sovereign ISO3 codes (or ``ABNJ`` for high seas)."""
    if not raw or not raw.strip():
        return []
    codes: list[str] = []
    for part in raw.split(","):
        code = part.strip().upper()
        if not code:
            continue
        if not (code.isalpha() and 3 <= len(code) <= 4):
            raise ValueError(f"invalid country code: {part!r}")
        if code not in codes:
            codes.append(code)
    return codes


_AREA_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def parse_area_ids(raw: Optional[str]) -> list[str]:
    """Parse comma-separated area ids (slugs from data/regions.json, e.g. ``canada-north-atlantic``)."""
    if not raw or not raw.strip():
        return []
    ids: list[str] = []
    for part in raw.split(","):
        token = part.strip().lower()
        if not token:
            continue
        if not _AREA_ID_RE.match(token):
            raise ValueError(f"invalid area id: {part!r}")
        if token not in ids:
            ids.append(token)
    return ids


@dataclass(frozen=True)
class RegionSelection:
    """Selected filter areas (OR between them)."""

    areas: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return bool(self.areas)


def parse_region_selection(area: Optional[str]) -> RegionSelection:
    """Parse and validate the ``area`` query param (ValueError on unknown ids)."""
    from regions import resolve_areas

    ids = tuple(parse_area_ids(area))
    resolve_areas(ids)  # validate
    return RegionSelection(ids)


def region_filters(region: Optional[RegionSelection]) -> list[dict]:
    """Match documents inside any of the selected areas.

    Works on both indices: grid cells carry the EEZ x IHO units they intersect,
    programme docs the union over their cells. Areas that stand for a whole
    country (``Portugal: all``, or ``Italy`` when it has a single entry) also
    match programmes that declare the country in ``schema:country``; grid
    docs have no declared countries, so the map only shows spatial data.
    """
    if not region:
        return []
    from regions import resolve_areas

    units, declared = resolve_areas(region.areas)
    should: list[dict] = []
    if units:
        should.append({"terms": {"marregion_mrgids": units}})
    if declared:
        should.append({"terms": {"country_isos_declared": declared}})
    if not should:
        return [{"bool": {"must_not": [{"match_all": {}}]}}]
    return [{"bool": {"should": should, "minimum_should_match": 1}}]


def status_filters(status: Optional[str], *, as_of_year: Optional[int] = None) -> list[dict]:
    """Return ES filter clauses for programme activity relative to a calendar year.

    - active: started on/before the year (or no start) and not ended before it (or no end)
    - inactive: ended before the year, or not yet started
    - all: no extra filters
    """
    normalized = normalize_status(status)
    if normalized == "all":
        return []

    year = as_of_year if as_of_year is not None else datetime.now().year

    started = {
        "bool": {
            "should": [
                {"bool": {"must_not": {"exists": {"field": "start_year"}}}},
                {"range": {"start_year": {"lte": year}}},
            ],
            "minimum_should_match": 1,
        }
    }
    not_ended = {
        "bool": {
            "should": [
                {"bool": {"must_not": {"exists": {"field": "end_year"}}}},
                {"range": {"end_year": {"gte": year}}},
            ],
            "minimum_should_match": 1,
        }
    }

    if normalized == "active":
        return [{"bool": {"filter": [started, not_ended]}}]

    # inactive: ended before year, or starts after year
    return [
        {
            "bool": {
                "should": [
                    {"range": {"end_year": {"lt": year}}},
                    {"range": {"start_year": {"gt": year}}},
                ],
                "minimum_should_match": 1,
            }
        }
    ]
