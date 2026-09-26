"""Aggregate statistics endpoints."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError

from config import PROJECT_INDEX
from es_client import get_es_client

router = APIRouter()

_LEVEL_RE = re.compile(r"Level\s+(\d+)", re.IGNORECASE)

READINESS_DIMS = (
    ("data", "readiness_data"),
    ("requirements", "readiness_requirements"),
    ("coordination", "readiness_coordination"),
)


def _level_from_label(label: str) -> int | None:
    m = _LEVEL_RE.search(label or "")
    if not m:
        return None
    level = int(m.group(1))
    return level if 1 <= level <= 9 else None


def _counts_by_level(buckets: list[dict[str, Any]]) -> dict[str, int]:
    out = {str(i): 0 for i in range(1, 10)}
    for b in buckets:
        level = _level_from_label(str(b.get("key") or ""))
        if level is None:
            continue
        out[str(level)] = int(b.get("doc_count") or 0)
    return out


@router.get("/readiness-by-eov")
def readiness_by_eov(es: Elasticsearch = Depends(get_es_client)):
    """Per top-level EOV: programme counts at each readiness level (data / requirements / coordination).

    Readiness level buckets only include programmes with at least one readiness field.
    `programmes` is that filtered count; `programmes_in_eov` is all programmes tagged
    with the EOV (used to scale bars relative to the EOV).
    """
    aggs: dict[str, Any] = {}
    for dim, field in READINESS_DIMS:
        aggs[dim] = {"terms": {"field": field, "size": 20}}

    body = {
        "size": 0,
        "query": {
            "bool": {
                "should": [{"exists": {"field": field}} for _, field in READINESS_DIMS],
                "minimum_should_match": 1,
            }
        },
        "aggs": {
            "programmes_total": {
                "global": {},
                "aggs": {
                    "count": {"cardinality": {"field": "id"}},
                    "by_eov": {"terms": {"field": "eov_keywords", "size": 50}},
                },
            },
            "programmes_with_readiness": {"cardinality": {"field": "id"}},
            "by_eov": {
                "terms": {"field": "eov_keywords", "size": 50},
                "aggs": aggs,
            },
        },
    }
    try:
        resp = es.search(index=PROJECT_INDEX, body=body)
    except NotFoundError:
        return {"programmes_total": 0, "programmes_with_readiness": 0, "eovs": []}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    programmes_in_eov = {
        str(b["key"]): int(b.get("doc_count") or 0)
        for b in resp["aggregations"]["programmes_total"]["by_eov"]["buckets"]
    }

    eovs = []
    seen: set[str] = set()
    for bucket in resp["aggregations"]["by_eov"]["buckets"]:
        code = str(bucket["key"])
        seen.add(code)
        eovs.append(
            {
                "code": code,
                "programmes": int(bucket["doc_count"]),
                "programmes_in_eov": programmes_in_eov.get(code, int(bucket["doc_count"])),
                "data": _counts_by_level(bucket["data"]["buckets"]),
                "requirements": _counts_by_level(bucket["requirements"]["buckets"]),
                "coordination": _counts_by_level(bucket["coordination"]["buckets"]),
            }
        )

    # EOVs present in the catalogue but with no readiness metadata yet
    for code, total in programmes_in_eov.items():
        if code in seen:
            continue
        eovs.append(
            {
                "code": code,
                "programmes": 0,
                "programmes_in_eov": total,
                "data": _counts_by_level([]),
                "requirements": _counts_by_level([]),
                "coordination": _counts_by_level([]),
            }
        )

    return {
        "programmes_total": int(
            resp["aggregations"]["programmes_total"]["count"]["value"] or 0
        ),
        "programmes_with_readiness": int(
            resp["aggregations"]["programmes_with_readiness"]["value"] or 0
        ),
        "eovs": eovs,
    }
