"""Countries (sovereign states) and their EEZ outlines for the country filter.

Data comes from data/countries.json and data/eez_land.geojson, built from
Marine Regions by scripts/build_eez_data.py.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from elasticsearch import Elasticsearch
from elasticsearch.exceptions import NotFoundError

from config import DATA_DIR, PROJECT_INDEX
from es_client import get_es_client
from query_filters import parse_country_codes

router = APIRouter()


@lru_cache(maxsize=1)
def _countries_file() -> dict:
    path = DATA_DIR / "countries.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="countries.json not found; run scripts/build_eez_data.py")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _eez_features() -> list[dict]:
    path = DATA_DIR / "eez_land.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail="eez_land.geojson not found; run scripts/build_eez_data.py")
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def _programme_counts(es: Elasticsearch) -> dict[str, int]:
    body = {
        "size": 0,
        "aggs": {"countries": {"terms": {"field": "country_isos", "size": 500}}},
    }
    try:
        resp = es.search(index=PROJECT_INDEX, body=body)
    except NotFoundError:
        return {}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {
        str(b["key"]): int(b["doc_count"])
        for b in resp["aggregations"]["countries"]["buckets"]
    }


@router.get("")
def list_countries(es: Elasticsearch = Depends(get_es_client)):
    """Sovereign countries (plus high seas) with the number of programmes tagged with each."""
    data = _countries_file()
    counts = _programme_counts(es)
    high_seas = data.get("high_seas") or {"iso": "ABNJ", "name": "High seas (ABNJ)"}
    items = [
        {
            "iso": c["iso"],
            "name": c["name"],
            "territories": c.get("territories", []),
            "landlocked": bool(c.get("landlocked")),
            "programmes": counts.get(c["iso"], 0),
        }
        for c in data.get("countries", [])
    ]
    items.append(
        {
            "iso": high_seas["iso"],
            "name": high_seas["name"],
            "territories": [],
            "landlocked": False,
            "programmes": counts.get(high_seas["iso"], 0),
        }
    )
    return {"source": data.get("source"), "items": items}


@router.get("/eez")
def get_eez_outlines(
    country: Optional[str] = Query(None, description="Sovereign ISO3 codes (comma-separated; ABNJ = high seas)"),
):
    """Simplified EEZ/land polygons for the selected countries, as GeoJSON.

    Includes overlapping claims and joint regimes that involve a selected country,
    i.e. exactly the areas the country filter matches.
    """
    try:
        codes = set(parse_country_codes(country))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    features = []
    if codes:
        for f in _eez_features():
            sovereigns = f["properties"].get("sovereigns") or []
            if codes.intersection(sovereigns):
                features.append(f)
    return {"type": "FeatureCollection", "features": features}
