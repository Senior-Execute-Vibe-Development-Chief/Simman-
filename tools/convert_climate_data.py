#!/usr/bin/env python3
"""
Convert NCEP/NCAR Reanalysis long-term monthly climatology to JSON.

Usage:
  pip3 install h5py numpy
  python3 tools/convert_climate_data.py

Reads (download both from NOAA PSL,
https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/):
  data/prate.sfc.mon.ltm.1991-2020.nc  -> data/global_precip.json   (mm/day)
  data/air.2m.mon.ltm.1991-2020.nc     -> data/global_airtemp.json  (degrees C)

Monthly temperature AND precipitation together are exactly what Koppen
classification is defined from, so these two files also serve as derived biome
ground truth — see tools/probe_climate_truth.mjs.

IMPORTANT — this is VALIDATION data, not simulation input. Nothing in src/ reads
it. The moisture field is the moisture solver's output and stays that way; this
file exists so tools/ can score that output against observation. Feeding it into
worldgen would turn Earth mode from a simulation into a lookup table and would
not transfer to any generated world.

Grid is Gaussian (94 lat x 192 lon), latitudes running N->S, longitudes 0..360.
Values are converted from kg/m^2/s to mm/day (x 86400).
"""
import json
import os
import sys

PRECIP_SRC = "data/prate.sfc.mon.ltm.1991-2020.nc"
PRECIP_OUT = "data/global_precip.json"
TEMP_SRC = "data/air.2m.mon.ltm.1991-2020.nc"
TEMP_OUT = "data/global_airtemp.json"


def convert(src, out, var, transform, units, desc):
    import h5py
    import numpy as np

    if not os.path.exists(src):
        print(f"  skip {src} (not present)")
        return
    with h5py.File(src, "r") as f:
        lat = f["lat"][:].astype(float)
        lon = f["lon"][:].astype(float)
        raw = f[var][:].astype(float)
        miss = f[var].attrs.get("missing_value", [-9.96921e36])[0]
    raw = np.where(raw <= float(miss) * 0.5, np.nan, raw)
    vals = transform(raw)

    ann = np.nanmean(vals, axis=0)
    print(f"  {desc}: {len(lat)}x{len(lon)}x{vals.shape[0]}mo  "
          f"annual min {np.nanmin(ann):.1f} max {np.nanmax(ann):.1f} ({units})")

    data = {
        "source": "NCEP/NCAR Reanalysis 1, long-term monthly mean 1991-2020 (NOAA PSL, public domain)",
        "note": "VALIDATION ONLY - not read by src/. See tools/convert_climate_data.py.",
        "units": units,
        "lat": [round(v, 4) for v in lat.tolist()],
        "lon": [round(v, 4) for v in lon.tolist()],
        "months": [[[round(float(v), 3) if v == v else None for v in row] for row in vals[m]]
                   for m in range(vals.shape[0])],
    }
    with open(out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"    wrote {out}  ({os.path.getsize(out):,} bytes)")


def main():
    try:
        import h5py  # noqa: F401
        import numpy  # noqa: F401
    except ImportError:
        print("Needs h5py and numpy:  pip3 install h5py numpy")
        sys.exit(1)
    # precipitation rate kg/m^2/s -> mm/day ; air temperature degK -> degC
    convert(PRECIP_SRC, PRECIP_OUT, "prate", lambda a: a * 86400.0, "mm/day", "precip")
    convert(TEMP_SRC, TEMP_OUT, "air", lambda a: a - 273.15, "degC", "air temp")


if __name__ == "__main__":
    main()
