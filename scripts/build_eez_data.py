"""Build the marine-area files used for the area filter.

Source: Marine Regions "The intersect of the Exclusive Economic Zones and IHO
areas" v5 (2024), built from Maritime Boundaries / EEZ v12 and IHO Sea Areas v3.
Flanders Marine Institute (VLIZ), CC-BY 4.0. https://www.marineregions.org/
This is the same EEZ x IHO combination OBIS uses for its areas.

Joint regimes and overlapping claims are left out entirely: they are not
listed, not tagged and not counted for any country.

Each source unit is one EEZ's part of one IHO sea (e.g. "Portuguese part of the
North Atlantic Ocean (Azores)") or one sea's high seas. The filter offers
OBIS-style areas built from those units:

  Canada                        a country's home EEZ (if it lies in one basin)
  Canada: North Atlantic        ... split by ocean basin when it spans several
  United Kingdom: Cayman Islands  a territory's EEZ (also split by basin if needed)
  United Kingdom: all           home EEZ plus every territory
  ABNJ, ABNJ: North Atlantic    areas beyond national jurisdiction
  Switzerland                   countries with no marine area; programmes only
                                count if their metadata names the country

Basins group the IHO seas using the Marine Regions gazetteer "part of"
relations (e.g. Gulf of St. Lawrence -> North Atlantic Ocean), so a country's
basin area includes its coastal seas.

Outputs (committed so the nightly loader and the API need no download):
  data/eez_iho.geojson  simplified unit polygons (loader only; never sent to browsers)
  data/regions.json     units, areas and country names for the loader and the API

Usage:
  python scripts/build_eez_data.py                  # download everything (~290 MB)
  python scripts/build_eez_data.py --skip-geometry  # rebuild regions.json only (small download)
  python scripts/build_eez_data.py --source eez_iho.geojson
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import shapely
from shapely.geometry import Polygon, mapping, shape

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

WFS_BASE = (
    "https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0"
    "&request=GetFeature&typeName=MarineRegions:eez_iho&outputFormat=application/json"
)
ATTRIBUTES = [
    "mrgid", "marregion", "iho_mrgid", "iho_sea", "eez_mrgid", "eez", "area_km2",
    *(f"{k}{i}" for i in (1, 2, 3) for k in ("territory", "iso_ter", "sovereign", "iso_sov")),
]
GAZETTEER_PARENTS = (
    "https://www.marineregions.org/rest/getGazetteerRelationsByMRGID.json/{mrgid}/"
    "?direction=upper&type=partof"
)
SOURCE_CITATION = (
    "Flanders Marine Institute (2024). The intersect of the Exclusive Economic Zones "
    "and IHO sea areas, version 5 (based on EEZ v12 and IHO Sea Areas v3). "
    "Marine Regions, https://www.marineregions.org/. CC-BY 4.0."
)

ABNJ = "ABNJ"

# Marine Regions uses some formal or older names; show the common short form.
DISPLAY_NAMES = {
    "Federal Republic of Somalia": "Somalia",
    "Republic of Mauritius": "Mauritius",
    "Swaziland": "Eswatini",
    "Macedonia": "North Macedonia",
    "Ivory Coast": "Côte d'Ivoire",
    "East Timor": "Timor-Leste",
    "Comores": "Comoros",
    "Cape Verde": "Cabo Verde",
}

# Ocean basins, as in the OBIS area list. Seas named here are basins of their
# own; otherwise a sea's basin is the top-level IHO ocean it is part of.
NAMED_BASINS = {"Mediterranean Sea", "Baltic Sea", "Black Sea", "North Sea", "Red Sea"}
OCEAN_LABELS = {
    "North Atlantic Ocean": "North Atlantic",
    "South Atlantic Ocean": "South Atlantic",
    "North Pacific Ocean": "North Pacific",
    "South Pacific Ocean": "South Pacific",
    "Arctic Ocean": "Arctic Ocean",
    "Indian Ocean": "Indian Ocean",
    "Southern Ocean": "Southern Ocean",
}
HEMISPHERE_OCEANS = {
    "Pacific Ocean": ("North Pacific", "South Pacific"),
    "Atlantic Ocean": ("North Atlantic", "South Atlantic"),
}
ARCHIPELAGIC = "South China and Eastern Archipelagic Seas"
# Seas the gazetteer does not place in an ocean, plus gulfs that belong with
# their sea rather than the gazetteer's ocean.
BASIN_OVERRIDES = {
    "Sea of Azov": "Black Sea",
    "Sea of Marmara": "Mediterranean Sea",
    "Gulf of Aqaba": "Red Sea",
    "Gulf of Suez": "Red Sea",
    "Skagerrak": "North Sea",
    **{
        sea: ARCHIPELAGIC
        for sea in (
            "Bali Sea", "Banda Sea", "Celebes Sea", "Ceram Sea", "Flores Sea", "Gulf of Boni",
            "Gulf of Thailand", "Gulf of Tomini", "Halmahera Sea", "Java Sea", "Makassar Strait",
            "Malacca Strait", "Molukka Sea", "Savu Sea", "Singapore Strait", "South China Sea",
            "Sulu Sea",
        )
    },
}

# A basin gets its own entry only if this much of the EEZ lies in it; smaller
# slivers stay in the country's unsplit / "all" entries.
MIN_BASIN_PART_KM2 = 1000
MIN_BASIN_PART_SHARE = 0.01

# Joint regimes and overlapping claims (by Marine Regions unit name) are excluded.
EXCLUDED_PREFIXES = ("Joint regime", "Overlapping claim")

# Countries with no EEZ x IHO unit: landlocked countries, Caspian-only coasts
# (the Caspian is not an IHO sea) and Antarctica. Countries whose waters are
# only in excluded units are added to these automatically. Listed so a programme's
# declared schema:country can name them; spatial tagging never assigns them.
DECLARED_ONLY_COUNTRIES = [
    ('AFG', 'Afghanistan'), ('AND', 'Andorra'), ('ATA', 'Antarctica'), ('ARM', 'Armenia'),
    ('AUT', 'Austria'), ('AZE', 'Azerbaijan'), ('BLR', 'Belarus'), ('BTN', 'Bhutan'),
    ('BOL', 'Bolivia'), ('BWA', 'Botswana'), ('BFA', 'Burkina Faso'), ('BDI', 'Burundi'),
    ('CAF', 'Central African Republic'), ('TCD', 'Chad'), ('CZE', 'Czechia'), ('SWZ', 'Eswatini'),
    ('ETH', 'Ethiopia'), ('HUN', 'Hungary'), ('KAZ', 'Kazakhstan'), ('KGZ', 'Kyrgyzstan'),
    ('LAO', 'Laos'), ('LSO', 'Lesotho'), ('LIE', 'Liechtenstein'), ('LUX', 'Luxembourg'),
    ('MWI', 'Malawi'), ('MLI', 'Mali'), ('MDA', 'Moldova'), ('MNG', 'Mongolia'), ('NPL', 'Nepal'),
    ('NER', 'Niger'), ('MKD', 'North Macedonia'), ('PRY', 'Paraguay'), ('RWA', 'Rwanda'),
    ('SMR', 'San Marino'), ('SRB', 'Serbia'), ('SVK', 'Slovakia'), ('SSD', 'South Sudan'),
    ('CHE', 'Switzerland'), ('TJK', 'Tajikistan'), ('TKM', 'Turkmenistan'), ('UGA', 'Uganda'),
    ('UZB', 'Uzbekistan'), ('VAT', 'Vatican City'), ('ZMB', 'Zambia'), ('ZWE', 'Zimbabwe'),
]

# Island holes smaller than this (deg², ~1 km²) are rocks and reefs; dropping
# them shrinks the file without changing any grid-cell tags.
MIN_HOLE_AREA = 1e-4


# --------------------------------------------------------------------------- download


def _fetch_json(url: str, timeout: int) -> object:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body) if body.strip() else []


def _load_features(source: str | None, skip_geometry: bool) -> list[dict]:
    if source:
        with open(source, encoding="utf-8") as f:
            return json.load(f)["features"]
    url = WFS_BASE + ("&propertyName=" + ",".join(ATTRIBUTES) if skip_geometry else "")
    logging.info("Downloading %s%s", url, "" if skip_geometry else " (~290 MB, several minutes)")
    return _fetch_json(url, timeout=1800)["features"]  # type: ignore[index]


def _sea_basins(seas: dict[str, str]) -> dict[str, str]:
    """Map IHO sea MRGID -> basin label using the gazetteer 'part of' relations."""
    parents_cache: dict[int, list[tuple[int, str]]] = {}

    def parents(mrgid: int) -> list[tuple[int, str]]:
        if mrgid not in parents_cache:
            rows = _fetch_json(GAZETTEER_PARENTS.format(mrgid=mrgid), timeout=60)
            parents_cache[mrgid] = [
                (r["MRGID"], r["preferredGazetteerName"])
                for r in rows  # type: ignore[union-attr]
                if r.get("placeType") == "IHO Sea Area"
            ]
        return parents_cache[mrgid]

    basins: dict[str, str] = {}
    for mrgid, name in seas.items():
        if name in BASIN_OVERRIDES:
            basins[mrgid] = BASIN_OVERRIDES[name]
            continue
        chain, current = [name], int(mrgid)
        for _ in range(6):
            ps = parents(current)
            if not ps:
                break
            current = ps[0][0]
            chain.append(ps[0][1])
        named = next((n for n in chain if n in NAMED_BASINS), None)
        ocean = next((OCEAN_LABELS[n] for n in chain if n in OCEAN_LABELS), None)
        basin = named or ocean
        if basin is None:
            raise SystemExit(f"No basin for IHO sea {name!r} ({mrgid}); add it to BASIN_OVERRIDES")
        basins[mrgid] = basin
    return basins


# --------------------------------------------------------------------------- areas


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _canonical_sovereign_isos(props: list[dict]) -> dict[str, str]:
    """Map sovereign name -> most common ISO code (guards against odd per-unit codes)."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for p in props:
        for i in (1, 2, 3):
            name, iso = p.get(f"sovereign{i}"), p.get(f"iso_sov{i}")
            if name and iso:
                counts[name][iso] += 1
    return {name: c.most_common(1)[0][0] for name, c in counts.items()}


def _split_by_basin(units: list[dict]) -> dict[str, list[dict]] | None:
    """Group one EEZ's units by basin, or None if only one basin is significant.

    An EEZ that only straddles the equator is not split: its North and South
    Pacific (or Atlantic) parts merge into one "Pacific Ocean" / "Atlantic
    Ocean" part, as OBIS keeps e.g. Brazil and Kiribati whole.
    """
    total = sum(u["area_km2"] for u in units) or 1
    min_area = max(MIN_BASIN_PART_KM2, MIN_BASIN_PART_SHARE * total)

    def significant(labels: dict[str, str]) -> dict[str, list[dict]]:
        groups: dict[str, list[dict]] = defaultdict(list)
        for u in units:
            groups[labels.get(u["basin"], u["basin"])].append(u)
        return {b: us for b, us in groups.items() if sum(u["area_km2"] for u in us) >= min_area}

    parts = significant({})
    merge = {
        hemi: ocean
        for ocean, (north, south) in HEMISPHERE_OCEANS.items()
        if north in parts and south in parts
        for hemi in (north, south)
    }
    if merge:
        parts = significant(merge)
    return parts if len(parts) > 1 else None


def build_areas(units: list[dict], countries: dict[str, dict]) -> list[dict]:
    """OBIS-style filter areas, each a set of unit MRGIDs (see module docstring)."""
    areas: list[dict] = []

    def add(name: str, kind: str, members: list[dict], declared_iso: str | None = None, sovereign: str | None = None):
        areas.append(
            {
                "id": _slug(name),
                "name": name,
                "kind": kind,
                "sovereign": sovereign,
                "units": sorted(u["mrgid"] for u in members),
                "declared_iso": declared_iso,
            }
        )

    # Per sovereign: home EEZ and territories, each split by basin when needed.
    by_sovereign: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    high_seas: list[dict] = []
    for u in units:
        if u["sovereigns"] == [ABNJ]:
            high_seas.append(u)
        else:
            by_sovereign[u["sovereigns"][0]][u["territory"]].append(u)

    for iso, territories in by_sovereign.items():
        country = countries[iso]
        name = country["name"]
        entries_before = len(areas)
        for territory, members in sorted(territories.items(), key=lambda t: (not t[0] == "", t[0])):
            label = name if territory == "" else f"{name}: {territory}"
            parts = _split_by_basin(members)
            if parts:
                for basin, part in sorted(parts.items()):
                    add(f"{label}: {basin}", "basin", part, sovereign=iso)
            else:
                add(label, "home" if territory == "" else "territory", members, sovereign=iso)
        all_units = [u for members in territories.values() for u in members]
        if len(areas) - entries_before > 1:
            add(f"{name}: all", "all", all_units, declared_iso=iso, sovereign=iso)
        elif len(areas) - entries_before == 1:
            areas[-1]["declared_iso"] = iso  # one entry stands for the whole country

    add(ABNJ, "abnj", high_seas)
    by_basin: dict[str, list[dict]] = defaultdict(list)
    for u in high_seas:
        by_basin[u["basin"]].append(u)
    for basin, members in sorted(by_basin.items()):
        add(f"{ABNJ}: {basin}", "abnj", members)

    for c in countries.values():
        if c.get("declared_only"):
            add(c["name"], "declared", [], declared_iso=c["iso"], sovereign=c["iso"])

    ids = Counter(a["id"] for a in areas)
    duplicates = [i for i, n in ids.items() if n > 1]
    if duplicates:
        raise SystemExit(f"Duplicate area ids: {duplicates}")
    return sorted(areas, key=lambda a: (a["name"] != ABNJ, not a["name"].startswith(ABNJ), a["name"].lower()))


# --------------------------------------------------------------------------- geometry


def _drop_small_holes(geom):
    """Remove interior rings (islets) smaller than MIN_HOLE_AREA."""
    if isinstance(geom, Polygon):
        return Polygon(geom.exterior, [r for r in geom.interiors if Polygon(r).area >= MIN_HOLE_AREA])
    if hasattr(geom, "geoms"):
        flat: list[Polygon] = []
        for part in (_drop_small_holes(g) for g in geom.geoms):
            if isinstance(part, Polygon):
                flat.append(part)
            elif isinstance(part, shapely.MultiPolygon):
                flat.extend(part.geoms)
        return shapely.MultiPolygon(flat) if len(flat) != 1 else flat[0]
    return geom


def _simplify(geom, tolerance: float, precision: float):
    geom = geom if geom.is_valid else shapely.make_valid(geom)
    geom = _drop_small_holes(geom)
    geom = shapely.simplify(geom, tolerance, preserve_topology=True)
    geom = shapely.set_precision(geom, precision)
    return geom if geom.is_valid else shapely.make_valid(geom)


# --------------------------------------------------------------------------- build


def build(source: str | None, skip_geometry: bool, tolerance: float, precision: float, out_dir: Path) -> None:
    features = [f for f in _load_features(source, skip_geometry) if skip_geometry or f.get("geometry")]
    all_props = [f["properties"] for f in features]
    canonical = _canonical_sovereign_isos(all_props)
    excluded = [p for p in all_props if (p.get("marregion") or "").startswith(EXCLUDED_PREFIXES)]
    features = [f for f in features if not (f["properties"].get("marregion") or "").startswith(EXCLUDED_PREFIXES)]
    props = [f["properties"] for f in features]
    logging.info("Loaded %d units (%d joint regime / overlapping claim units excluded)", len(props), len(excluded))

    seas = {str(p["iho_mrgid"]): p.get("iho_sea") or str(p["iho_mrgid"]) for p in props}
    logging.info("Looking up ocean basins for %d IHO seas in the Marine Regions gazetteer", len(seas))
    basins = _sea_basins(seas)

    countries: dict[str, dict] = {}
    units: list[dict] = []
    for p in props:
        name = p.get("marregion") or ""
        sovereigns: list[str] = []
        for i in (1, 2, 3):
            sov_name = p.get(f"sovereign{i}")
            if not sov_name:
                continue
            iso = canonical[sov_name]
            if iso not in sovereigns:
                sovereigns.append(iso)
            entry = countries.setdefault(
                iso,
                {"iso": iso, "name": DISPLAY_NAMES.get(sov_name, sov_name), "marine_regions_name": sov_name, "territories": []},
            )
            territory = p.get(f"territory{i}")
            is_home = territory == sov_name or p.get(f"iso_ter{i}") == p.get(f"iso_sov{i}")
            if territory and not is_home and territory not in entry["territories"]:
                entry["territories"].append(territory)
        territory = p.get("territory1") or ""
        if sovereigns and (territory == p.get("sovereign1") or p.get("iso_ter1") == p.get("iso_sov1")):
            territory = ""  # home EEZ
        iho = str(p["iho_mrgid"])
        units.append(
            {
                "mrgid": str(p["mrgid"]),
                "name": name,
                "iho_mrgid": iho,
                "iho_sea": seas[iho],
                "basin": basins[iho],
                "eez_mrgid": str(p["eez_mrgid"]) if p.get("eez_mrgid") is not None else None,
                "sovereigns": sovereigns or [ABNJ],
                "territory": territory if sovereigns else "",
                "area_km2": int(p.get("area_km2") or 0),
            }
        )

    # Countries whose waters are only in excluded units (e.g. Ukraine, Taiwan,
    # Western Sahara in EEZ v12) are added like landlocked ones: listed, but
    # only counting programmes that name them in their metadata.
    from_excluded = {
        canonical[p[f"sovereign{i}"]]: DISPLAY_NAMES.get(p[f"sovereign{i}"], p[f"sovereign{i}"])
        for p in excluded
        for i in (1, 2, 3)
        if p.get(f"sovereign{i}")
    }
    for iso, name in [*DECLARED_ONLY_COUNTRIES, *sorted(from_excluded.items())]:
        if iso not in countries:
            logging.info("Declared-only country: %s (%s)", name, iso)
        countries.setdefault(
            iso, {"iso": iso, "name": name, "marine_regions_name": name, "territories": [], "declared_only": True}
        )
    for c in countries.values():
        c["territories"].sort()

    areas = build_areas(units, countries)
    out_dir.mkdir(parents=True, exist_ok=True)
    built = date.today().isoformat()

    if not skip_geometry:
        logging.info("Simplifying (tolerance %s deg, precision %s deg)", tolerance, precision)
        out_features = []
        for f in features:
            geom = _simplify(shape(f["geometry"]), tolerance, precision)
            f["geometry"] = None  # free the full-resolution source as we go
            out_features.append({"type": "Feature", "properties": {"mrgid": str(f["properties"]["mrgid"])}, "geometry": mapping(geom)})
        geo_path = out_dir / "eez_iho.geojson"
        with open(geo_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "type": "FeatureCollection",
                    "source": SOURCE_CITATION,
                    "simplify_tolerance_deg": tolerance,
                    "precision_deg": precision,
                    "built": built,
                    "features": out_features,
                },
                f,
                separators=(",", ":"),
                ensure_ascii=False,
            )
        logging.info("Wrote %s (%.2f MB)", geo_path, geo_path.stat().st_size / 1e6)

    regions_path = out_dir / "regions.json"
    with open(regions_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "source": SOURCE_CITATION,
                "built": built,
                "countries": sorted(countries.values(), key=lambda c: c["name"]),
                "areas": areas,
                "units": sorted(units, key=lambda u: u["name"]),
            },
            f,
            indent=1,
            ensure_ascii=False,
        )
    logging.info("Wrote %s (%d areas, %d units, %d countries)", regions_path, len(areas), len(units), len(countries))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", help="Local GeoJSON of MarineRegions:eez_iho (default: download from WFS)")
    parser.add_argument("--skip-geometry", action="store_true", help="Only rebuild regions.json (attribute download)")
    parser.add_argument("--tolerance", type=float, default=0.03, help="Simplification tolerance in degrees")
    parser.add_argument("--precision", type=float, default=1e-3, help="Coordinate rounding in degrees")
    parser.add_argument("--out-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()
    build(args.source, args.skip_geometry, args.tolerance, args.precision, args.out_dir)
