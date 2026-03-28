#!/usr/bin/env python3
"""
Download NCEP/NCAR Reanalysis long-term mean 10m wind data and convert to JSON.

Usage:
  pip3 install xarray netcdf4
  python3 tools/convert_wind_data.py

Downloads from NOAA PSL, extracts monthly U/V grids, outputs data/global_wind.json.
"""
import os
import json
import subprocess
import sys

def download(url, path):
    print(f"Downloading {os.path.basename(path)}...")
    subprocess.check_call(["curl", "-sL", "-o", path, url])
    size = os.path.getsize(path)
    print(f"  → {size:,} bytes")
    if size < 1000:
        print(f"  ERROR: File too small, download may have failed")
        sys.exit(1)

def main():
    import xarray as xr
    import numpy as np

    os.makedirs("data", exist_ok=True)

    u_url = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/uwnd.10m.mon.ltm.1991-2020.nc"
    v_url = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface_gauss/vwnd.10m.mon.ltm.1991-2020.nc"

    u_path = "/tmp/uwnd_ltm.nc"
    v_path = "/tmp/vwnd_ltm.nc"

    download(u_url, u_path)
    download(v_url, v_path)

    print("Reading NetCDF files...")
    ds_u = xr.open_dataset(u_path)
    ds_v = xr.open_dataset(v_path)

    print(f"U-wind dims: {dict(ds_u.dims)}")
    print(f"V-wind dims: {dict(ds_v.dims)}")

    # Extract coordinate arrays
    lats = ds_u["lat"].values.tolist()
    lons = ds_u["lon"].values.tolist()

    # Build output: 12 months of U/V grids
    out = {
        "lat": [round(x, 2) for x in lats],
        "lon": [round(x, 2) for x in lons],
    }

    # Find the variable name (could be 'uwnd' or 'u10' etc)
    u_var = [v for v in ds_u.data_vars if "wnd" in v or "u10" in v.lower()][0]
    v_var = [v for v in ds_v.data_vars if "wnd" in v or "v10" in v.lower()][0]
    print(f"Using variables: {u_var}, {v_var}")

    for month in range(12):
        u_data = ds_u[u_var].isel(time=month).values  # lat × lon
        v_data = ds_v[v_var].isel(time=month).values

        # Replace NaN with 0
        u_data = np.nan_to_num(u_data, nan=0.0)
        v_data = np.nan_to_num(v_data, nan=0.0)

        out[str(month)] = {
            "u": [[round(float(x), 2) for x in row] for row in u_data],
            "v": [[round(float(x), 2) for x in row] for row in v_data],
        }
        print(f"  Month {month}: u range [{u_data.min():.1f}, {u_data.max():.1f}], v range [{v_data.min():.1f}, {v_data.max():.1f}]")

    # Write compact JSON
    out_path = "data/global_wind.json"
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    size = os.path.getsize(out_path)
    print(f"\nWrote {out_path}: {size:,} bytes ({size/1024:.0f} KB)")

    # Clean up NetCDF files
    os.remove(u_path)
    os.remove(v_path)
    print("Cleaned up .nc files")

if __name__ == "__main__":
    main()
