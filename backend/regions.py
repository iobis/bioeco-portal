"""Filter areas (OBIS-style countries, territories, basins, ABNJ, shared waters) from data/regions.json.

Built from Marine Regions by scripts/build_eez_data.py. Only names and ids are
served; boundary geometry is used at ingest time and never sent to the browser.
"""
from __future__ import annotations

import json
from functools import lru_cache

from config import DATA_DIR

REGIONS_FILE = "regions.json"


@lru_cache(maxsize=1)
def load_regions() -> dict:
    """The parsed regions file, or an empty structure if it has not been built."""
    path = DATA_DIR / REGIONS_FILE
    if not path.exists():
        return {"countries": [], "areas": [], "units": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def areas_by_id() -> dict[str, dict]:
    return {a["id"]: a for a in load_regions().get("areas", [])}


def resolve_areas(ids: tuple[str, ...]) -> tuple[list[str], list[str]]:
    """Unit MRGIDs and declared-country ISO codes covered by the selected areas.

    Raises ValueError for unknown area ids.
    """
    known = areas_by_id()
    units: set[str] = set()
    declared: set[str] = set()
    for area_id in ids:
        area = known.get(area_id)
        if area is None:
            raise ValueError(f"unknown area: {area_id!r}")
        units.update(area.get("units") or ())
        if area.get("declared_iso"):
            declared.add(area["declared_iso"])
    return sorted(units), sorted(declared)
