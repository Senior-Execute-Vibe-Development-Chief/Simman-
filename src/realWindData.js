// ── Real Wind Data Loader ──
// Loads NCEP/NCAR Reanalysis climatological wind data from data/global_wind.json
// and provides bilinear sampling functions for use in Earth (Sim) mode.
//
// To generate the data file, run: python3 tools/convert_wind_data.py

let windData = null;
let loadPromise = null;
let loadFailed = false;

export function isRealWindAvailable() {
  return windData !== null;
}

export function isRealWindLoading() {
  return loadPromise !== null && windData === null && !loadFailed;
}

export async function loadRealWindData() {
  if (windData) return true;
  if (loadFailed) return false;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Vite handles JSON imports at build time
      const mod = await import("../data/global_wind.json");
      const d = mod.default || mod;
      // Validate: must have lat/lon arrays and at least month "0"
      if (!d.lat || !d.lon || !d["0"]) {
        console.warn("Real wind data file exists but is empty/invalid (run: python3 tools/convert_wind_data.py)");
        loadFailed = true;
        return false;
      }
      windData = d;
      console.log(`Real wind data loaded: ${windData.lat.length} lat × ${windData.lon.length} lon, 12 months`);
      return true;
    } catch (e) {
      console.warn("Real wind data not available (run: python3 tools/convert_wind_data.py)");
      loadFailed = false; // Allow retry
      return false;
    }
  })();
  return loadPromise;
}

// Try loading eagerly (non-blocking)
loadRealWindData();

/**
 * Sample real wind data at a given pixel position, returning U/V in m/s.
 * @param {number} x - pixel x (0 to W-1)
 * @param {number} y - pixel y (0 to H-1)
 * @param {number} W - map width
 * @param {number} H - map height
 * @param {number} month - 0-11 (default: annual mean via averaging)
 * @returns {{u: number, v: number}} wind components in m/s
 */
export function sampleRealWind(x, y, W, H, month) {
  if (!windData) return { u: 0, v: 0 };

  const lats = windData.lat;
  const lons = windData.lon;
  const nLat = lats.length;
  const nLon = lons.length;

  // Convert pixel to lat/lon
  // Map: y=0 → 90°N, y=H-1 → 90°S (equirectangular)
  const lat = 90 - (y / (H - 1)) * 180;
  // Map: x=0 → 0°E, x=W-1 → 360°E
  const lon = (x / W) * 360;

  // Find bounding lat indices (lats may be descending: 90 to -90)
  let latIdx0 = 0;
  if (lats[0] > lats[nLat - 1]) {
    // Descending (90 → -90)
    for (let i = 0; i < nLat - 1; i++) {
      if (lats[i] >= lat && lats[i + 1] < lat) { latIdx0 = i; break; }
    }
  } else {
    // Ascending (-90 → 90)
    for (let i = 0; i < nLat - 1; i++) {
      if (lats[i] <= lat && lats[i + 1] > lat) { latIdx0 = i; break; }
    }
  }
  const latIdx1 = Math.min(nLat - 1, latIdx0 + 1);
  const latRange = lats[latIdx1] - lats[latIdx0];
  const latFrac = latRange !== 0 ? (lat - lats[latIdx0]) / latRange : 0;

  // Find bounding lon indices (lons ascending: 0 → 358.x)
  let lonIdx0 = 0;
  for (let i = 0; i < nLon - 1; i++) {
    if (lons[i] <= lon && lons[i + 1] > lon) { lonIdx0 = i; break; }
    if (i === nLon - 2) lonIdx0 = i; // wrap case
  }
  const lonIdx1 = (lonIdx0 + 1) % nLon;
  const lonRange = lonIdx1 > lonIdx0
    ? lons[lonIdx1] - lons[lonIdx0]
    : (360 - lons[lonIdx0] + lons[lonIdx1]);
  const lonFrac = lonRange !== 0 ? ((lon - lons[lonIdx0] + 360) % 360) / lonRange : 0;

  // Get month data (or compute annual mean)
  let u00, u10, u01, u11, v00, v10, v01, v11;

  if (month !== undefined && windData[String(month)]) {
    const md = windData[String(month)];
    u00 = md.u[latIdx0][lonIdx0]; u10 = md.u[latIdx0][lonIdx1];
    u01 = md.u[latIdx1][lonIdx0]; u11 = md.u[latIdx1][lonIdx1];
    v00 = md.v[latIdx0][lonIdx0]; v10 = md.v[latIdx0][lonIdx1];
    v01 = md.v[latIdx1][lonIdx0]; v11 = md.v[latIdx1][lonIdx1];
  } else {
    // Annual mean: average all 12 months
    u00 = u10 = u01 = u11 = v00 = v10 = v01 = v11 = 0;
    for (let m = 0; m < 12; m++) {
      const md = windData[String(m)];
      if (!md) continue;
      u00 += md.u[latIdx0][lonIdx0]; u10 += md.u[latIdx0][lonIdx1];
      u01 += md.u[latIdx1][lonIdx0]; u11 += md.u[latIdx1][lonIdx1];
      v00 += md.v[latIdx0][lonIdx0]; v10 += md.v[latIdx0][lonIdx1];
      v01 += md.v[latIdx1][lonIdx0]; v11 += md.v[latIdx1][lonIdx1];
    }
    const inv12 = 1 / 12;
    u00 *= inv12; u10 *= inv12; u01 *= inv12; u11 *= inv12;
    v00 *= inv12; v10 *= inv12; v01 *= inv12; v11 *= inv12;
  }

  // Bilinear interpolation
  const lf = Math.max(0, Math.min(1, latFrac));
  const xf = Math.max(0, Math.min(1, lonFrac));
  const u = (u00 * (1 - xf) + u10 * xf) * (1 - lf) + (u01 * (1 - xf) + u11 * xf) * lf;
  const v = (v00 * (1 - xf) + v10 * xf) * (1 - lf) + (v01 * (1 - xf) + v11 * xf) * lf;

  return { u, v };
}

/**
 * Fill full-resolution wind arrays from real data.
 * Converts from m/s to the internal wind scale used by the solver.
 * @param {number} W - map width
 * @param {number} H - map height
 * @param {Float32Array} windX - output array (W*H)
 * @param {Float32Array} windY - output array (W*H)
 * @param {number} [month] - specific month (0-11), omit for annual mean
 * @param {number} [scale=0.008] - conversion from m/s to internal units
 */
export function fillRealWind(W, H, windX, windY, month, scale = 0.008) {
  if (!windData) return false;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const { u, v } = sampleRealWind(x, y, W, H, month);
      const i = y * W + x;
      windX[i] = u * scale;
      windY[i] = v * scale;
    }
  }
  return true;
}
