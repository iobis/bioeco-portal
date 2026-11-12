"""Country / EEZ tagging for programmes and their geohash grid cells.

Uses data/eez_land.geojson and data/countries.json (built by build_eez_data.py
from Marine Regions). Each grid cell is tagged with every EEZ/land unit it
intersects; a programme's countries are the union of its cells' countries plus
any countries declared in its metadata (schema:country).
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

from geohash_grid import geohash_bbox

HIGH_SEAS_ISO = "ABNJ"

# Extra spellings seen in metadata, keyed by normalized name -> ISO3.
# Marine Regions names, display names, territory names and ISO3 codes are
# matched automatically; only add names that differ from those here.
NAME_ALIASES = {
    "united states of america": "USA",
    "us": "USA",
    "usa": "USA",
    "u s a": "USA",
    "uk": "GBR",
    "great britain": "GBR",
    "united kingdom of great britain and northern ireland": "GBR",
    "england": "GBR",
    "scotland": "GBR",
    "wales": "GBR",
    "northern ireland": "GBR",
    "russian federation": "RUS",
    "republic of korea": "KOR",
    "korea": "KOR",
    "korea republic of": "KOR",
    "democratic peoples republic of korea": "PRK",
    "turkiye": "TUR",
    "viet nam": "VNM",
    "iran islamic republic of": "IRN",
    "islamic republic of iran": "IRN",
    "tanzania united republic of": "TZA",
    "united republic of tanzania": "TZA",
    "venezuela bolivarian republic of": "VEN",
    "bolivia plurinational state of": "BOL",
    "syrian arab republic": "SYR",
    "lao peoples democratic republic": "LAO",
    "brunei darussalam": "BRN",
    "micronesia federated states of": "FSM",
    "federated states of micronesia": "FSM",
    "moldova republic of": "MDA",
    "republic of moldova": "MDA",
    "congo": "COG",
    "congo democratic republic of the": "COD",
    "dr congo": "COD",
    "drc": "COD",
    "cote divoire": "CIV",
    "cabo verde": "CPV",
    "timor leste": "TLS",
    "eswatini": "SWZ",
    "north macedonia": "MKD",
    "czechia": "CZE",
    "holland": "NLD",
    "the netherlands": "NLD",
    "palestine state of": "PSE",
    "state of palestine": "PSE",
    "taiwan province of china": "TWN",
    "holy see": "VAT",
    "somalia": "SOM",
    "mauritius": "MUS",
    "luxembourg": "LUX",
    "comoros": "COM",
    # Overlapping-claim units, so not listed as territories by Marine Regions.
    "gibraltar": "GBR",
    "falkland islands": "GBR",
    "south georgia and the south sandwich islands": "GBR",
    "chagos archipelago": "GBR",
    "british indian ocean territory": "GBR",
    "mayotte": "FRA",
    "western sahara": "ESH",
    "high seas": HIGH_SEAS_ISO,
    "abnj": HIGH_SEAS_ISO,
    "areas beyond national jurisdiction": HIGH_SEAS_ISO,
}


def normalize_country_name(value: str) -> str:
    """Lowercase, strip accents and punctuation, collapse whitespace."""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    if text.startswith("the "):
        text = text[4:]
    return text


class EezIndex:
    """Spatial index over EEZ/land units for tagging grid cells with countries."""

    def __init__(self, features: list[dict], countries: dict):
        self._geoms = np.array([shape(f["geometry"]) for f in features], dtype=object)
        shapely.prepare(self._geoms)
        self._tree = shapely.STRtree(self._geoms)
        self._sovereigns = [tuple(f["properties"].get("sovereigns") or ()) for f in features]
        self._mrgids = [
            str(f["properties"]["mrgid"]) if f["properties"].get("mrgid") is not None else None
            for f in features
        ]
        self._name_to_iso = self._build_name_lookup(countries)

    @staticmethod
    def _build_name_lookup(countries: dict) -> dict[str, str]:
        lookup: dict[str, str] = {}
        high_seas = countries.get("high_seas") or {}
        if high_seas.get("iso"):
            lookup[normalize_country_name(high_seas["iso"])] = high_seas["iso"]
            lookup[normalize_country_name(high_seas.get("name") or "")] = high_seas["iso"]
        for c in countries.get("countries", []):
            iso = c["iso"]
            for name in [iso, c.get("name"), c.get("marine_regions_name"), *c.get("territories", [])]:
                if name:
                    lookup.setdefault(normalize_country_name(name), iso)
        lookup.update(NAME_ALIASES)
        lookup.pop("", None)
        return lookup

    @classmethod
    def load(cls, data_dir: Path) -> "EezIndex | None":
        eez_path = data_dir / "eez_land.geojson"
        countries_path = data_dir / "countries.json"
        if not eez_path.exists() or not countries_path.exists():
            logging.warning(
                "EEZ data not found in %s; country tags will be empty. "
                "Run scripts/build_eez_data.py to create it.",
                data_dir,
            )
            return None
        with open(eez_path, encoding="utf-8") as f:
            features = [ft for ft in json.load(f)["features"] if ft.get("geometry")]
        with open(countries_path, encoding="utf-8") as f:
            countries = json.load(f)
        logging.info("Loaded %d EEZ/land units for country tagging", len(features))
        return cls(features, countries)

    def resolve_country(self, value: str) -> str | None:
        """Map a declared country name (or ISO3 code) to a sovereign ISO3 code."""
        if not value or not str(value).strip():
            return None
        return self._name_to_iso.get(normalize_country_name(value))

    def tag_cells(self, cells: list[str]) -> dict[str, tuple[list[str], list[str]]]:
        """Return {cell: (sovereign ISO3 codes, EEZ MRGIDs)} for each geohash cell."""
        if not cells:
            return {}
        bounds = np.array([geohash_bbox(c) for c in cells])
        boxes = shapely.box(bounds[:, 0], bounds[:, 1], bounds[:, 2], bounds[:, 3])
        # Bounding-box candidates from the tree, then an exact test against the
        # (prepared) EEZ polygons.
        cell_idx, eez_idx = self._tree.query(boxes)
        if len(cell_idx):
            hits = shapely.intersects(self._geoms[eez_idx], boxes[cell_idx])
            cell_idx, eez_idx = cell_idx[hits], eez_idx[hits]

        isos: list[set[str]] = [set() for _ in cells]
        mrgids: list[set[str]] = [set() for _ in cells]
        for ci, ei in zip(cell_idx.tolist(), eez_idx.tolist()):
            isos[ci].update(self._sovereigns[ei])
            if self._mrgids[ei]:
                mrgids[ci].add(self._mrgids[ei])
        return {cell: (sorted(isos[i]), sorted(mrgids[i])) for i, cell in enumerate(cells)}
