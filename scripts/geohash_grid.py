"""Geohash grid helpers (pure shapely + numpy, no compiled geohash packages).

Replaces polygon_geohasher / python-geohash, which need a C or Rust toolchain
to install on some platforms (e.g. Windows with recent Python).
"""
from __future__ import annotations

import numpy as np
import shapely

_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
_BASE32_INDEX = {c: i for i, c in enumerate(_BASE32)}

# Rows of cells tested per batch, to bound memory for near-global polygons.
_ROW_BATCH = 64


def _grid_dims(precision: int) -> tuple[int, int]:
    """Number of longitude and latitude bits for a geohash precision."""
    bits = 5 * precision
    return (bits + 1) // 2, bits // 2


def geohash_bbox(cell: str) -> tuple[float, float, float, float]:
    """Return (min_lon, min_lat, max_lon, max_lat) for a geohash cell."""
    lon = [-180.0, 180.0]
    lat = [-90.0, 90.0]
    even = True
    for ch in cell:
        bits = _BASE32_INDEX[ch]
        for shift in range(4, -1, -1):
            rng = lon if even else lat
            mid = (rng[0] + rng[1]) / 2
            if (bits >> shift) & 1:
                rng[0] = mid
            else:
                rng[1] = mid
            even = not even
    return lon[0], lat[0], lon[1], lat[1]


def geohash_center(cell: str) -> tuple[float, float]:
    """Return the (lat, lon) centre of a geohash cell."""
    min_lon, min_lat, max_lon, max_lat = geohash_bbox(cell)
    return (min_lat + max_lat) / 2, (min_lon + max_lon) / 2


def _encode_indices(ix: np.ndarray, iy: np.ndarray, precision: int) -> list[str]:
    """Encode integer grid column/row indices as geohash strings."""
    lon_bits, lat_bits = _grid_dims(precision)
    code = np.zeros(ix.shape, dtype=np.int64)
    lon_shift, lat_shift = lon_bits, lat_bits
    for bit in range(5 * precision):
        code <<= 1
        if bit % 2 == 0:  # geohash interleaves bits starting with longitude
            lon_shift -= 1
            code |= (ix >> lon_shift) & 1
        else:
            lat_shift -= 1
            code |= (iy >> lat_shift) & 1
    chars = np.empty((len(code), precision), dtype="<U1")
    for pos in range(precision):
        shift = 5 * (precision - 1 - pos)
        chars[:, pos] = np.array(list(_BASE32))[(code >> shift) & 31]
    return ["".join(row) for row in chars]


def polygon_to_geohashes(geom, precision: int) -> set[str]:
    """All geohash cells at ``precision`` that intersect ``geom``.

    Same result as polygon_geohasher.polygon_to_geohashes(geom, precision, inner=False).
    """
    if geom is None or geom.is_empty:
        return set()
    lon_bits, lat_bits = _grid_dims(precision)
    n_lon, n_lat = 1 << lon_bits, 1 << lat_bits
    cell_w, cell_h = 360.0 / n_lon, 180.0 / n_lat

    # Pad the index range by one cell so cells that only touch the geometry's
    # bounds (edges exactly on a grid line) are tested too, as polygon_geohasher does.
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    ix0 = max(int(np.floor((min_lon + 180.0) / cell_w)) - 1, 0)
    ix1 = min(int(np.floor((max_lon + 180.0) / cell_w)) + 1, n_lon - 1)
    iy0 = max(int(np.floor((min_lat + 90.0) / cell_h)) - 1, 0)
    iy1 = min(int(np.floor((max_lat + 90.0) / cell_h)) + 1, n_lat - 1)
    if ix1 < ix0 or iy1 < iy0:
        return set()

    shapely.prepare(geom)
    cols = np.arange(ix0, ix1 + 1, dtype=np.int64)
    found: set[str] = set()
    for row_start in range(iy0, iy1 + 1, _ROW_BATCH):
        rows = np.arange(row_start, min(row_start + _ROW_BATCH, iy1 + 1), dtype=np.int64)
        ix, iy = np.meshgrid(cols, rows)
        ix, iy = ix.ravel(), iy.ravel()
        boxes = shapely.box(
            ix * cell_w - 180.0,
            iy * cell_h - 90.0,
            (ix + 1) * cell_w - 180.0,
            (iy + 1) * cell_h - 90.0,
        )
        hit = shapely.intersects(geom, boxes)
        if hit.any():
            found.update(_encode_indices(ix[hit], iy[hit], precision))
    return found
