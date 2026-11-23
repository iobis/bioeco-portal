"""Filter areas (countries, territories, ocean basins, ABNJ) with programme counts.

Areas come from data/regions.json (Marine Regions EEZ x IHO intersect, grouped
OBIS-style by scripts/build_eez_data.py). Boundary lines are deliberately not
served: the map only shows the programme data that falls inside a selection.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError

from config import GRID_INDEX, PROJECT_INDEX
from es_client import get_es_client
from query_filters import RegionSelection, parse_region_selection, region_filters
from regions import load_regions

router = APIRouter()


def _programme_counts(es: Elasticsearch, areas: list[dict]) -> dict[str, int]:
    """Programmes per area, in one request (a filters aggregation over all areas)."""
    filters = {}
    for a in areas:
        clauses = region_filters(RegionSelection((a["id"],)))
        filters[a["id"]] = {"bool": {"filter": clauses}}
    body = {"size": 0, "aggs": {"areas": {"filters": {"filters": filters}}}}
    try:
        resp = es.search(index=PROJECT_INDEX, body=body)
    except NotFoundError:
        return {}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    buckets = resp["aggregations"]["areas"]["buckets"]
    return {area_id: int(b["doc_count"]) for area_id, b in buckets.items()}


@router.get("")
def list_areas(es: Elasticsearch = Depends(get_es_client)):
    """All filter areas with the number of programmes in each.

    ``kind`` is one of: home, basin, territory, all, abnj or declared
    (no marine area; only programmes naming the country in schema:country).
    """
    data = load_regions()
    areas = data.get("areas", [])
    counts = _programme_counts(es, areas) if areas else {}
    items = [
        {"id": a["id"], "name": a["name"], "kind": a["kind"], "programmes": counts.get(a["id"], 0)}
        for a in areas
    ]
    return {"source": data.get("source"), "items": items}


@router.get("/bounds")
def get_selection_bounds(
    area: Optional[str] = Query(None, description="Area ids (comma-separated)"),
    es: Elasticsearch = Depends(get_es_client),
):
    """Extent of the programme data inside the selection, for zooming the map.

    Returns ``{"bbox": [west, south, east, north]}``; ``west > east`` means the
    extent crosses the antimeridian. ``bbox`` is null when there is no data.
    """
    try:
        region = parse_region_selection(area)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not region:
        return {"bbox": None}
    body = {
        "size": 0,
        "query": {"bool": {"filter": region_filters(region)}},
        "aggs": {"extent": {"geo_bounds": {"field": "geometry", "wrap_longitude": True}}},
    }
    try:
        resp = es.search(index=GRID_INDEX, body=body)
    except NotFoundError:
        return {"bbox": None}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    bounds = resp["aggregations"]["extent"].get("bounds")
    if not bounds:
        return {"bbox": None}
    tl, br = bounds["top_left"], bounds["bottom_right"]
    return {"bbox": [tl["lon"], br["lat"], br["lon"], tl["lat"]]}
