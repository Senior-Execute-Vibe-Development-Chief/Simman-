#!/usr/bin/env python3
"""
Rasterize Bird 2003 PB2002 plate polygons + typed boundaries to a compact
JS module the sim upsamples at worldgen.

Source (ODC-By 1.0, Peter Bird 2003):
  http://peterbird.name/oldFTP/PB2002/
  GeoJSON mirror: https://github.com/fraxen/tectonicplates

Observed plate geometry — the same class of Earth-preset fact as NCEP
climate. Not a fitted "Andes = volcanoes" outcome: subduction segments
are whatever Bird labelled, and the existing boundDist BFS then does
the rest.

Usage:
  python3 tools/convert_earth_plates.py
  python3 tools/convert_earth_plates.py /tmp/PB2002_plates.json /tmp/PB2002_boundaries.json /tmp/PB2002_orogens.json
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.request

import numpy as np
from shapely.affinity import translate
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely import contains_xy

PW, PH = 720, 360  # 0.5°

PLATES_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_plates.json"
BOUNDS_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json"
OROGENS_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_orogens.json"

# Stable ids matching src/sim/earthPlates.js public constants.
MAJOR = [
    ("PA", 1), ("NA", 2), ("EU", 3), ("AF", 4), ("SA", 5), ("AN", 6),
    ("AU", 7), ("IN", 8), ("NZ", 9), ("CO", 10), ("CA", 11), ("AR", 12),
    ("PS", 13), ("JF", 14), ("SC", 15), ("SU", 16), ("SO", 17),
]

COLLISION_NAMES = {"IN-EU", "AR-EU", "AF-EU", "AT-EU", "AS-EU", "IN-SU", "AU-EU"}
RIDGE_NAMES = {"AF-SO", "AF-AR", "SO-AR"}
COLLISION_OROGENS = {"Alps", "Persia-Tibet-Burma"}

BK_NONE, BK_RIDGE, BK_TRANSFORM, BK_SUBDUCTION, BK_COLLISION = 0, 1, 2, 3, 4

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "sim", "earthPlateRaster.js")
WORLD = box(-180, -90, 180, 90)


def load_json(path_or_none, url):
    if path_or_none and os.path.exists(path_or_none):
        with open(path_or_none) as f:
            return json.load(f)
    print(f"  fetch {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def unwrap_ring(ring):
    out = [[float(ring[0][0]), float(ring[0][1])]]
    for pt in ring[1:]:
        lon, lat = float(pt[0]), float(pt[1])
        prev = out[-1][0]
        d = lon - prev
        if d > 180:
            lon -= 360
        elif d < -180:
            lon += 360
        out.append([lon, lat])
    return out


def stereo(lon, lat, south=False):
    if south:
        phi = math.radians(90.0 + lat)
        a = -math.radians(lon)
    else:
        phi = math.radians(90.0 - lat)
        a = math.radians(lon)
    # opposite pole → infinity; clamp to a large disk
    if phi >= math.pi - 1e-6:
        r = 1e6
    else:
        r = math.tan(phi / 2.0)
    return r * math.cos(a), r * math.sin(a)


def ring_kind_and_poly(ring):
    """Return ('stereo', south, poly) or ('lonlat', False, poly)."""
    u = unwrap_ring(ring)
    span = max(p[0] for p in u) - min(p[0] for p in u)
    lats = [p[1] for p in u]
    pole_n = max(lats) > 89.5 or (span > 350 and (sum(lats) / len(lats)) > 0)
    pole_s = min(lats) < -89.5 or (span > 350 and (sum(lats) / len(lats)) < 0)
    if pole_n or pole_s:
        pts = []
        for lon, lat in ring:
            x, y = stereo(float(lon), float(lat), south=pole_s)
            if abs(x) < 1e6 and abs(y) < 1e6:
                pts.append((x, y))
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        return "stereo", pole_s, poly
    poly = Polygon(u)
    if not poly.is_valid:
        poly = poly.buffer(0)
    if span > 180:
        parts = []
        for s in (0, 360, -360):
            c = translate(poly, xoff=s).intersection(WORLD)
            if not c.is_empty:
                parts.append(c)
        if parts:
            poly = unary_union(parts)
    return "lonlat", False, poly


def feature_geoms(feat):
    g = feat["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    recs = []
    for poly in polys:
        recs.append(ring_kind_and_poly(poly[0]))
    return recs


def rasterize_plates(plates, code_to_id):
    lons = (np.arange(PW) + 0.5) / PW * 360.0 - 180.0
    lats = 90.0 - (np.arange(PH) + 0.5) / PH * 180.0
    lon_g = np.broadcast_to(lons, (PH, PW))
    lat_g = np.broadcast_to(lats[:, None], (PH, PW))
    grid = np.zeros((PH, PW), dtype=np.uint8)

    for f in plates["features"]:
        cid = code_to_id[f["properties"]["Code"]]
        mask = np.zeros((PH, PW), dtype=bool)
        for kind, south, geom in feature_geoms(f):
            if geom.is_empty:
                continue
            if kind == "stereo":
                # vectorized stereo
                lon = lon_g
                lat = lat_g
                if south:
                    phi = np.radians(90.0 + lat)
                    a = -np.radians(lon)
                else:
                    phi = np.radians(90.0 - lat)
                    a = np.radians(lon)
                r = np.tan(np.clip(phi, 0, math.pi - 1e-3) / 2.0)
                xs = r * np.cos(a)
                ys = r * np.sin(a)
                mask |= contains_xy(geom, xs, ys)
            else:
                mask |= contains_xy(geom, lon_g, lat_g)
        grid[mask] = cid
    return grid


def paint_line(grid, coords, value, width=1):
    pts = unwrap_ring(coords)
    xs = [(p[0] + 180.0) / 360.0 * PW for p in pts]
    ys = [(90.0 - p[1]) / 180.0 * PH for p in pts]
    for i in range(len(xs) - 1):
        x0, y0 = xs[i], ys[i]
        x1, y1 = xs[i + 1], ys[i + 1]
        nstep = max(1, int(math.hypot(x1 - x0, y1 - y0) * 2))
        for s in range(nstep + 1):
            t = s / nstep
            xf = x0 + t * (x1 - x0)
            yf = y0 + t * (y1 - y0)
            for dy in range(-width, width + 1):
                for dx in range(-width, width + 1):
                    yy = int(round(yf)) + dy
                    xx = int(round(xf)) + dx
                    if yy < 0 or yy >= PH:
                        continue
                    if value > grid[yy, xx % PW]:
                        grid[yy, xx % PW] = value


def fill_orogen(grid, ring, value):
    """Lon/lat fill for compact collision orogens (Alps, Persia-Tibet-Burma)."""
    kind, south, geom = ring_kind_and_poly(ring)
    lons = (np.arange(PW) + 0.5) / PW * 360.0 - 180.0
    lats = 90.0 - (np.arange(PH) + 0.5) / PH * 180.0
    lon_g = np.broadcast_to(lons, (PH, PW))
    lat_g = np.broadcast_to(lats[:, None], (PH, PW))
    mask = contains_xy(geom, lon_g, lat_g)
    grid[mask & (grid < value)] = value


def rle_bytes(arr):
    flat = arr.reshape(-1)
    out = bytearray()
    i, n = 0, flat.size
    while i < n:
        v = int(flat[i])
        j = i + 1
        while j < n and int(flat[j]) == v and (j - i) < 255:
            j += 1
        out.append(v & 255)
        out.append(j - i)
        i = j
    return bytes(out)


def b64(data):
    import base64
    return base64.b64encode(data).decode("ascii")


def build_code_map(plates):
    codes = list(MAJOR)
    seen = {c for c, _ in MAJOR}
    nxt = 18
    for f in plates["features"]:
        c = f["properties"]["Code"]
        if c in seen:
            continue
        codes.append((c, nxt))
        seen.add(c)
        nxt += 1
    return {c: i for c, i in codes}, codes


def sample(grid, lon, lat):
    x = int((lon + 180.0) / 360.0 * PW) % PW
    y = int((90.0 - lat) / 180.0 * PH)
    y = max(0, min(PH - 1, y))
    return int(grid[y, x])


def main():
    plates_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/PB2002_plates.json"
    bounds_path = sys.argv[2] if len(sys.argv) > 2 else "/tmp/PB2002_boundaries.json"
    orogens_path = sys.argv[3] if len(sys.argv) > 3 else "/tmp/PB2002_orogens.json"
    if not os.path.exists(plates_path):
        plates_path = None
    if not os.path.exists(bounds_path):
        bounds_path = None
    if not os.path.exists(orogens_path):
        orogens_path = None

    plates = load_json(plates_path, PLATES_URL)
    bounds = load_json(bounds_path, BOUNDS_URL)
    orogens = load_json(orogens_path, OROGENS_URL)

    code_to_id, codes = build_code_map(plates)
    print("  rasterizing plates…")
    plate = rasterize_plates(plates, code_to_id)
    kind = np.zeros((PH, PW), dtype=np.uint8)

    for f in orogens["features"]:
        name = f["properties"].get("Name") or ""
        if name not in COLLISION_OROGENS:
            continue
        geom = f["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in polys:
            fill_orogen(kind, poly[0], BK_COLLISION)

    for f in bounds["features"]:
        props = f["properties"]
        name = props.get("Name") or ""
        typ = (props.get("Type") or "").lower()
        if typ == "subduction":
            k = BK_SUBDUCTION
        elif name in COLLISION_NAMES:
            k = BK_COLLISION
        elif name in RIDGE_NAMES:
            k = BK_RIDGE
        else:
            k = BK_TRANSFORM
        paint_line(kind, f["geometry"]["coordinates"], k, width=1)

    id_to_code = {i: c for c, i in codes}
    checks = [
        ("Kansas", -98, 39, "NA"),
        ("Congo", 20, 0, "AF"),
        ("Nile", 31, 30, "AF"),
        ("Andes", -72, -18, None),
        ("Himalaya", 84, 28, None),
        ("Hawaii", -155.3, 19.4, "PA"),
        ("London", 0, 51, "EU"),
        ("Sydney", 151, -33, "AU"),
        ("Arabia", 48, 22, "AR"),
        ("India", 78, 22, "IN"),
        ("Tokyo", 139.7, 35.7, None),
        ("McMurdo", 166, -77, "AN"),
        ("Alert", -62, 82, "NA"),
        ("Paris", 2.3, 48.8, "EU"),
    ]
    print("  samples:")
    fails = 0
    for label, lon, lat, expect in checks:
        pid = sample(plate, lon, lat)
        code = id_to_code.get(pid, "?")
        flag = ""
        if expect and code != expect:
            flag = "  ** MISMATCH **"
            fails += 1
        print(f"    {label:16} {code:4} (id={pid}){flag}")

    zero = int((plate == 0).sum())
    print(f"  unpainted pixels: {zero} / {PW * PH} ({100 * zero / (PW * PH):.2f}%)")
    print(f"  kind nonzero: {int((kind > 0).sum())}")
    print(f"    ridge={int((kind == BK_RIDGE).sum())} transform={int((kind == BK_TRANSFORM).sum())} "
          f"subduction={int((kind == BK_SUBDUCTION).sum())} collision={int((kind == BK_COLLISION).sum())}")
    print(f"  Kansas boundKind={sample(kind, -98, 39)} (want 0)")
    print(f"  Andes boundKind={sample(kind, -72, -18)}")
    print(f"  Himalaya boundKind={sample(kind, 84, 28)}")

    if fails:
        raise SystemExit(f"{fails} sample mismatches")

    plate_b = rle_bytes(plate)
    kind_b = rle_bytes(kind)
    print(f"  RLE plate {len(plate_b)} B  kind {len(kind_b)} B")

    max_id = max(i for _, i in codes)
    code_list = [""] * (max_id + 1)
    for c, i in codes:
        code_list[i] = c

    body = f"""// Auto-generated by tools/convert_earth_plates.py — do not edit.
// Bird 2003 PB2002 plate polygons + typed boundaries (ODC-By 1.0).
// Grid is {PW}×{PH} (0.5°). Upsampled nearest-neighbour in earthPlates.js.
export const PW = {PW};
export const PH = {PH};
export const CODES = {json.dumps(code_list)};
export const PLATE_RLE = "{b64(plate_b)}";
export const KIND_RLE = "{b64(kind_b)}";
"""
    out = os.path.normpath(OUT)
    with open(out, "w") as f:
        f.write(body)
    print(f"  wrote {out} ({os.path.getsize(out):,} bytes)")


if __name__ == "__main__":
    main()
