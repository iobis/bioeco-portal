"""Country / sea tagging for programmes and their geohash grid cells.

Uses data/eez_iho.geojson and data/regions.json (built by build_eez_data.py
from the Marine Regions EEZ x IHO intersect, the same areas OBIS uses). Each
grid cell is tagged with every unit it intersects: sovereign countries, IHO sea,
EEZ and the unit itself. A programme's tags are the union of its cells' tags;
its countries also include any declared in its metadata (schema:country).
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
    # Disputed territories (overlapping claims in Marine Regions) are deliberately
    # not mapped to any one claimant; such names are reported as unrecognised.
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


TAG_FIELDS = ("country_isos", "eez_mrgids", "iho_mrgids", "marregion_mrgids")


class EezIndex:
    """Spatial index over EEZ x IHO units for tagging grid cells."""

    def __init__(self, features: list[dict], regions: dict):
        units = {u["mrgid"]: u for u in regions.get("units", [])}
        features = [f for f in features if str(f["properties"]["mrgid"]) in units]
        self._geoms = np.array([shape(f["geometry"]) for f in features], dtype=object)
        shapely.prepare(self._geoms)
        self._tree = shapely.STRtree(self._geoms)
        # Per unit: the values it contributes to each tag field. Units missing
        # from regions.json (joint regimes, overlapping claims) are skipped.
        self._unit_tags: list[dict[str, tuple[str, ...]]] = []
        for f in features:
            u = units[str(f["properties"]["mrgid"])]
            self._unit_tags.append(
                {
                    "country_isos": tuple(u.get("sovereigns") or ()),
                    "eez_mrgids": (u["eez_mrgid"],) if u.get("eez_mrgid") else (),
                    "iho_mrgids": (u["iho_mrgid"],) if u.get("iho_mrgid") else (),
                    "marregion_mrgids": (u["mrgid"],),
                }
            )
        self._name_to_iso = self._build_name_lookup(regions)

    @staticmethod
    def _build_name_lookup(regions: dict) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for c in regions.get("countries", []):
            iso = c["iso"]
            for name in [iso, c.get("name"), c.get("marine_regions_name"), *c.get("territories", [])]:
                if name:
                    lookup.setdefault(normalize_country_name(name), iso)
        lookup.update(NAME_ALIASES)
        lookup.pop("", None)
        return lookup

    @classmethod
    def load(cls, data_dir: Path) -> "EezIndex | None":
        geo_path = data_dir / "eez_iho.geojson"
        regions_path = data_dir / "regions.json"
        if not geo_path.exists() or not regions_path.exists():
            logging.warning(
                "Marine region data not found in %s; country/sea tags will be empty. "
                "Run scripts/build_eez_data.py to create it.",
                data_dir,
            )
            return None
        with open(geo_path, encoding="utf-8") as f:
            features = [ft for ft in json.load(f)["features"] if ft.get("geometry")]
        with open(regions_path, encoding="utf-8") as f:
            regions = json.load(f)
        logging.info("Loaded %d EEZ x IHO units for country/sea tagging", len(features))
        return cls(features, regions)

    def resolve_country(self, value: str) -> str | None:
        """Map a declared country name (or ISO3 code) to a sovereign ISO3 code."""
        if not value or not str(value).strip():
            return None
        return self._name_to_iso.get(normalize_country_name(value))

    def tag_cells(self, cells: list[str]) -> dict[str, dict[str, list[str]]]:
        """Return {cell: {tag field: sorted values}} for each geohash cell (see TAG_FIELDS)."""
        if not cells:
            return {}
        bounds = np.array([geohash_bbox(c) for c in cells])
        boxes = shapely.box(bounds[:, 0], bounds[:, 1], bounds[:, 2], bounds[:, 3])
        # Bounding-box candidates from the tree, then an exact test against the
        # (prepared) unit polygons.
        cell_idx, unit_idx = self._tree.query(boxes)
        if len(cell_idx):
            hits = shapely.intersects(self._geoms[unit_idx], boxes[cell_idx])
            cell_idx, unit_idx = cell_idx[hits], unit_idx[hits]

        tags: list[dict[str, set[str]]] = [{k: set() for k in TAG_FIELDS} for _ in cells]
        for ci, ui in zip(cell_idx.tolist(), unit_idx.tolist()):
            for field, values in self._unit_tags[ui].items():
                tags[ci][field].update(values)
        return {
            cell: {field: sorted(values) for field, values in tags[i].items()}
            for i, cell in enumerate(cells)
        }
