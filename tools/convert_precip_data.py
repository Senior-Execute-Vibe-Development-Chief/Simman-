#!/usr/bin/env python3
"""
Convert NCEP/NCAR Reanalysis long-term mean monthly precipitation to JSON.

Usage:
  pip3 install h5py numpy
  python3 tools/convert_precip_data.py

Reads data/prate.sfc.mon.ltm.1991-2020.nc (download from NOAA PSL:
https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/)
and writes data/global_precip.json.

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

SRC = "data/prate.sfc.mon.ltm.1991-2020.nc"
OUT = "data/global_precip.json"


def main():
    try:
        import h5py
        import numpy as np
    except ImportError:
        print("Needs h5py and numpy:  pip3 install h5py numpy")
        sys.exit(1)

    if not os.path.exists(SRC):
        print(f"Missing {SRC}")
        print("Download prate.sfc.mon.ltm.1991-2020.nc from NOAA PSL:")
        print("  https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/")
        sys.exit(1)

    with h5py.File(SRC, "r") as f:
        lat = f["lat"][:].astype(float)          # 88.5 .. -88.5  (N -> S)
        lon = f["lon"][:].astype(float)          # 0 .. 358.125
        prate = f["prate"][:].astype(float)      # (12, 94, 192) kg/m^2/s
        miss = float(f["prate"].attrs.get("missing_value", [-9.96921e36])[0])

    prate = np.where(prate <= miss * 0.5, np.nan, prate)
    mmday = prate * 86400.0                      # kg/m^2/s -> mm/day

    print(f"grid {len(lat)} lat x {len(lon)} lon x {mmday.shape[0]} months")
    ann = np.nanmean(mmday, axis=0) * 365.0
    print(f"annual mm/yr: min {np.nanmin(ann):.0f}  max {np.nanmax(ann):.0f}  mean {np.nanmean(ann):.0f}")

    data = {
        "source": "NCEP/NCAR Reanalysis 1, long-term monthly mean 1991-2020 (NOAA PSL, public domain)",
        "note": "VALIDATION ONLY — not read by src/. See tools/convert_precip_data.py.",
        "units": "mm/day",
        "lat": [round(v, 4) for v in lat.tolist()],
        "lon": [round(v, 4) for v in lon.tolist()],
        # months[m][j][i] — rounded to 3dp; at mm/day that is well inside the
        # reanalysis's own error, and it keeps the file about a megabyte.
        "months": [[[round(float(v), 3) if v == v else None for v in row] for row in mmday[m]]
                   for m in range(mmday.shape[0])],
    }
    with open(OUT, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print(f"wrote {OUT}  ({os.path.getsize(OUT):,} bytes)")


if __name__ == "__main__":
    main()
