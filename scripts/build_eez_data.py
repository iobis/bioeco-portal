"""Build the simplified EEZ / country files used for country filtering.

Source: Marine Regions "Union of the ESRI Country shapefile and the Exclusive
Economic Zones" (built on EEZ v12), Flanders Marine Institute (VLIZ), CC-BY 4.0.
https://www.marineregions.org/

Outputs (committed to the repo so the nightly loader and the API need no download):
  data/eez_land.geojson  simplified polygons, one feature per EEZ/land unit plus
                         one "high seas" (ABNJ) feature
  data/countries.json    sovereign countries with display names and territories

Usage:
  python scripts/build_eez_data.py                      # download from the WFS
  python scripts/build_eez_data.py --source eez.geojson # use a local download
"""
from __future__ import annotations

import argparse
import json
import logging
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

WFS_URL = (
    "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0"
    "&request=GetFeature&typeName=MarineRegions:eez_land&outputFormat=application/json"
)
SOURCE_CITATION = (
    "Flanders Marine Institute (VLIZ). Union of the ESRI Country shapefile and the "
    "Exclusive Economic Zones (based on EEZ version 12). Marine Regions, "
    "https://www.marineregions.org/. CC-BY 4.0."
)

HIGH_SEAS_ISO = "ABNJ"
HIGH_SEAS_NAME = "High seas (ABNJ)"
ANTARCTICA_ISO = "ATA"

# Marine Regions uses some formal or older names; show the common short form.
DISPLAY_NAMES = {
    "Federal Republic of Somalia": "Somalia",
    "Republic of Mauritius": "Mauritius",
    "Grand Duchy of Luxembourg": "Luxembourg",
    "Swaziland": "Eswatini",
    "Macedonia": "North Macedonia",
    "Ivory Coast": "Côte d'Ivoire",
    "East Timor": "Timor-Leste",
    "Comores": "Comoros",
    "Cape Verde": "Cabo Verde",
    "Czech Republic": "Czechia",
}

# Holes smaller than this (deg²) in the EEZ union are data slivers, not high seas.
MIN_HIGH_SEAS_PART_AREA = 0.05


def _load_source(source: str | None) -> dict:
    if source:
        with open(source, encoding="utf-8") as f:
            return json.load(f)
    logging.info("Downloading %s", WFS_URL)
    with urllib.request.urlopen(WFS_URL, timeout=600) as resp:
        return json.load(resp)


def _canonical_sovereign_isos(features: list[dict]) -> dict[str, str]:
    """Map sovereign name -> most common ISO code (fixes e.g. UK features coded GIB)."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for f in features:
        p = f["properties"]
        for i in (1, 2, 3):
            name, iso = p.get(f"sovereign{i}"), p.get(f"iso_sov{i}")
            if name and iso:
                counts[name][iso] += 1
    return {name: c.most_common(1)[0][0] for name, c in counts.items()}


def _sovereigns(props: dict, canonical: dict[str, str]) -> list[str]:
    isos: list[str] = []
    for i in (1, 2, 3):
        name = props.get(f"sovereign{i}")
        iso = canonical.get(name) if name else props.get(f"iso_sov{i}")
        if iso and iso not in isos:
            isos.append(iso)
    if not isos and (props.get("union") or "").lower() == "antarctica":
        isos.append(ANTARCTICA_ISO)
    return isos


def _round_geom(geom, tolerance: float):
    simplified = shapely.simplify(geom, tolerance, preserve_topology=True)
    simplified = shapely.set_precision(simplified, 1e-4)
    return shapely.make_valid(simplified) if not simplified.is_valid else simplified


def build(source: str | None, tolerance: float, out_dir: Path) -> None:
    fc = _load_source(source)
    features = fc["features"]
    logging.info("Loaded %d features", len(features))
    canonical = _canonical_sovereign_isos(features)

    out_features = []
    countries: dict[str, dict] = {}
    full_geoms = []
    for f in features:
        if not f.get("geometry"):
            continue
        props = f["properties"]
        geom = shape(f["geometry"])
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        full_geoms.append(geom)
        sovereigns = _sovereigns(props, canonical)
        if not sovereigns:
            logging.warning("Skipping feature without sovereign: %s", props.get("union"))
            continue

        name = props.get("union") or props.get("territory1") or ""
        out_features.append(
            {
                "type": "Feature",
                "properties": {
                    "mrgid": props.get("mrgid_eez"),
                    "name": name,
                    "pol_type": props.get("pol_type"),
                    "sovereigns": sovereigns,
                },
                "geometry": mapping(_round_geom(geom, tolerance)),
            }
        )

        for i in (1, 2, 3):
            sov_name = props.get(f"sovereign{i}")
            if not sov_name:
                continue
            iso = canonical[sov_name]
            entry = countries.setdefault(
                iso,
                {
                    "iso": iso,
                    "name": DISPLAY_NAMES.get(sov_name, sov_name),
                    "marine_regions_name": sov_name,
                    "territories": [],
                    "landlocked": True,
                },
            )
            if props.get("pol_type") != "Landlocked country":
                entry["landlocked"] = False
            territory = props.get(f"territory{i}")
            if (
                territory
                and territory != sov_name
                and props.get("pol_type") == "Union EEZ and country"
                and territory not in entry["territories"]
            ):
                entry["territories"].append(territory)

    countries.setdefault(
        ANTARCTICA_ISO,
        {
            "iso": ANTARCTICA_ISO,
            "name": "Antarctica",
            "marine_regions_name": "Antarctica",
            "territories": [],
            "landlocked": False,
        },
    )

    logging.info("Computing high seas (ABNJ) as the complement of all EEZ/land units")
    union = unary_union(full_geoms)
    high_seas = box(-180, -90, 180, 90).difference(union)
    parts = [p for p in getattr(high_seas, "geoms", [high_seas]) if p.area >= MIN_HIGH_SEAS_PART_AREA]
    high_seas = shapely.MultiPolygon(parts) if len(parts) > 1 else parts[0]
    out_features.append(
        {
            "type": "Feature",
            "properties": {
                "mrgid": None,
                "name": HIGH_SEAS_NAME,
                "pol_type": "High seas",
                "sovereigns": [HIGH_SEAS_ISO],
            },
            "geometry": mapping(_round_geom(high_seas, tolerance)),
        }
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    eez_path = out_dir / "eez_land.geojson"
    with open(eez_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "type": "FeatureCollection",
                "source": SOURCE_CITATION,
                "simplify_tolerance_deg": tolerance,
                "built": date.today().isoformat(),
                "features": out_features,
            },
            f,
            separators=(",", ":"),
            ensure_ascii=False,
        )

    country_list = sorted(countries.values(), key=lambda c: c["name"])
    for c in country_list:
        c["territories"].sort()
    countries_path = out_dir / "countries.json"
    with open(countries_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": SOURCE_CITATION,
                "built": date.today().isoformat(),
                "high_seas": {"iso": HIGH_SEAS_ISO, "name": HIGH_SEAS_NAME},
                "countries": country_list,
            },
            f,
            indent=1,
            ensure_ascii=False,
        )
    logging.info(
        "Wrote %s (%d features, %.2f MB) and %s (%d countries)",
        eez_path,
        len(out_features),
        eez_path.stat().st_size / 1e6,
        countries_path,
        len(country_list),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="Local GeoJSON of MarineRegions:eez_land (default: download from WFS)")
    parser.add_argument("--tolerance", type=float, default=0.01, help="Simplification tolerance in degrees")
    parser.add_argument("--out-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    build(args.source, args.tolerance, args.out_dir)
