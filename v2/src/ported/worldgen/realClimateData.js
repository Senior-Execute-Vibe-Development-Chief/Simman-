/* V2 M1 PORT
 * source: src/realClimateData.js; deviations: dataset import paths point at v2/data/reality; data injection remains caller-owned; adds sampleMonthlyClimate (M1 review) so the substrate can carry the observed MONTHLY fields instead of re-synthesizing seasonality from annual means.
 * source commit: 97f51dd7c3a3142bfbb366f2e08491f582367e30
 */
// ── Real Climate Data Loader ──
// Loads NCEP/NCAR Reanalysis 1991-2020 monthly climatology (precipitation +
// 2 m air temperature) from data/global_precip.json and data/global_airtemp.json
// and converts it into the three fields the sim reasons about: `temperature`,
// `moisture` and `dryFrac`. The companion to realWindData.js — the Earth (Sim)
// checkbox that swaps the solver's wind for the real one swaps these too, so the
// whole climate comes from observation rather than from the solver.
//
// To (re)generate the data files, run: python3 tools/convert_climate_data.py
//
// This is NOT part of the emergent generator and must never leak into it. The
// generator's job is to PREDICT a climate from local rules on any map; this mode's
// job is to hand it Earth's measured one, so a player can see the civilisation
// simulation run on a world whose weather is real. Everything downstream — rivers,
// fertility, settlement, empires — still emerges; only the climate is given.

import { dexp } from "../../sim/dmath.ts";

let precip = null, airtemp = null, derived = null;
let loadPromise = null, loadFailed = false;

export function isRealClimateAvailable() {
  return precip !== null && airtemp !== null;
}

export function isRealClimateLoading() {
  return loadPromise !== null && !isRealClimateAvailable() && !loadFailed;
}

export async function loadRealClimateData() {
  if (isRealClimateAvailable()) return true;
  if (loadFailed) return false;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const [p, t] = await Promise.all([
        import("../../../data/reality/global_precip.json"),
        import("../../../data/reality/global_airtemp.json"),
      ]);
      const pd = p.default || p, td = t.default || t;
      if (!pd.lat || !pd.lon || !pd.months || !td.months || pd.months.length !== 12 || td.months.length !== 12) {
        console.warn("Real climate data exists but is empty/invalid (run: python3 tools/convert_climate_data.py)");
        loadFailed = true;
        return false;
      }
      precip = pd; airtemp = td; derived = null;
      console.log(`Real climate data loaded: ${pd.lat.length} lat × ${pd.lon.length} lon, 12 months (precip + 2m air temp)`);
      return true;
    } catch {
      // Node has no bundler to resolve the JSON imports, so this branch is the norm for
      // the tools/ probes — which supply the data through provideRealClimateData instead.
      // Only complain if nothing has arrived by either route.
      if (!isRealClimateAvailable())
        console.warn("Real climate data not available (run: python3 tools/convert_climate_data.py)");
      loadPromise = null;   // allow a real retry rather than caching the settled false
      return false;
    }
  })();
  return loadPromise;
}

// Try loading eagerly (non-blocking)
loadRealClimateData();

/**
 * Hand the module its data directly, bypassing the bundler-specific JSON import.
 * This exists so the Node probes in tools/ can exercise THIS code — the same
 * deriveGrids and fillRealClimate the app runs — instead of a reimplementation that
 * can silently drift away from it. (A reimplemented classifier in the audit scripts
 * is precisely what let a render bug survive a whole session of "validation".)
 * @param {object} precipJson  parsed data/global_precip.json
 * @param {object} airtempJson parsed data/global_airtemp.json
 */
export function provideRealClimateData(precipJson, airtempJson) {
  precip = precipJson; airtemp = airtempJson; derived = null;
  loadFailed = false;
}

// ── Unit conversion ────────────────────────────────────────────────────────────
// The observation is in millimetres and degrees C; the sim's fields are 0-1 indices.
// Getting from one to the other is a UNIT conversion and has to be derived, not dialled
// in — the same discipline as realWindData's m/s → internal wind scale.
//
// TEMPERATURE is trivial: the internal field is linear in degC, and every probe in
// tools/ already reads it back as (t - 0.6) * 100, so t = 0.6 + degC/100.
//
// MOISTURE is the hard one, and the first attempt got it wrong in a way worth
// recording. `moisture` looks like an aridity index, so it is tempting to build it as
// one — Koppen's own MAP/(10*Pth) ratio, mapped onto the classifier's scale. That is
// wrong twice over. The classifier ALREADY divides by a demand term (0.5 + 0.5*t), so
// a pre-normalised field gets its temperature correction applied twice; and `moisture`
// is not a classification axis at all. It feeds fertility, rivers, resources, migration
// and population, all of which read it as "how much water this ground gets". An aridity
// index hands them a frozen Siberia as wet as the Amazon. (Measured: it dropped the
// field's rank correlation against observed annual precipitation to 0.397 — WORSE than
// the solver it replaced, while being built from the very data it was scored against.)
//
// So the field must stay precipitation-like and monotonic in annual rainfall, and the
// only real question is units. Answer it by QUANTILE MAPPING onto the solver's own land
// distribution: the wettest 10% of land gets the moisture value the sim already assigns
// to its wettest 10% of land, and so on down. This is the standard CDF-matching used to
// put observations on a model's scale, and it has no free parameters at all. It splits
// the responsibility exactly where it belongs — the observation supplies the spatial
// PATTERN, which is the thing it knows and the solver does not (anomaly skill 0.32);
// the sim supplies the UNITS, so every threshold calibrated against the solver's
// distribution downstream keeps meaning what it meant.
//
// The honest limit of this: it corrects the pattern, not the amplitude. Whatever
// global wet/dry bias the solver's distribution carries is inherited wholesale, because
// preserving that distribution is the point. A different choice would fix the shares at
// the cost of breaking every downstream threshold at once.

// Metres per unit of internal elevation, anchored on the Tibetan plateau: a large,
// flat, unambiguous ~4500 m feature that the 20 km heightmap resolves honestly, and
// which sits at elevation 0.477. Cross-checks: the Alps come out ~2300 m and the north
// European plain ~270 m, both right for terrain smoothed to 20 km.
const ELEV_M = 9400;
// Environmental lapse rate, K/km. Textbook constant, not a tuning knob.
const LAPSE_K_PER_KM = 6.5;

// ── Sub-grid orographic redistribution of the coarse rain (W14, P18) ──
// The observation is ~1.9° per cell; a range narrower than that — the Kopet
// Dag, the Sulaiman, the Makran, the Alborz foot — is averaged with the basin
// at its foot, and its wet slope comes back as desert. Within the observation's
// own footprint the rain is placed on the slope it fell on: each land pixel is
// weighted by exp(g·Δz) for its elevation anomaly against the footprint's land
// mean, and the weights are normalised to a land mean of one over the same
// footprint, so the footprint's rain is conserved to first order and none is
// invented. The gain g is the relative windward precipitation gradient — Barry
// (2008, *Mountain Weather and Climate*, ch. 4): 50–100 mm per 100 m on
// 1,000–2,000 mm regimes, i.e. 0.25–1 per km; PRISM's slope-regression fits the
// same order (Daly, Neilson & Phillips 1994, J. Appl. Meteorol. 33:140–158).
// The footprint is aspect-blind (a lee slope is lifted like a windward one), so
// the low-middle of that range. The anomaly is clamped at the vapour scale
// height (Smith & Barstad 2004, J. Atmos. Sci. 61:1377–1391, H_w 2–3 km; Roe
// 2005, Annu. Rev. Earth Planet. Sci. 33:645–671): above it the column has no
// more water to wring out. The rain shadow BETWEEN table cells stays in the
// table; only the placement inside one is corrected.
const OROGRAPHIC_GAIN_PER_KM = 0.5;
const VAPOUR_SCALE_HEIGHT_KM = 2.5;
const TABLE_CELL_DEG = 1.9;

/**
 * The half-width, in map cells, of the footprint the coarse rain is
 * redistributed within: the widest odd box that fits INSIDE one table cell,
 * so nothing is moved across the table's own resolution. Zero where the map
 * cell is no finer than about half the table's (the reference grid, and the
 * 0.75° cross-grid proxy), where the correction is inert by construction;
 * four at the v2 target grid (1800 wide, 0.2°: a 9-cell, 1.8° box) and two
 * at the app's Half grid (960 wide: a 5-cell, 1.875° box).
 */
export function orographicFootprintRadius(W) {
  return Math.max(0, Math.floor((W * TABLE_CELL_DEG / 360 - 1) / 2));
}

/** Separable box sum over a (2·rad + 1)² window: columns wrap, rows clamp at the poles — the lapse smoothing's own convention. */
function boxSum(W, H, src, rad, out) {
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let d = -rad; d <= rad; d++) acc += src[y * W + ((d % W) + W) % W];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc;
      acc += src[y * W + ((x + rad + 1) % W)] - src[y * W + ((x - rad) % W + W) % W];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let d = -rad; d <= rad; d++) acc += tmp[Math.min(H - 1, Math.max(0, d)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc;
      acc += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.min(H - 1, Math.max(0, y - rad)) * W + x];
    }
  }
  return out;
}

/**
 * The share of its footprint's rain each land pixel receives (W14, P18): a
 * land-mean-of-one weight exp(g·Δz) over the footprint of half-width `rad`,
 * one everywhere at rad 0 and on the sea. Exported so the property can be
 * checked on a synthetic field; the loader calls it once per fill.
 */
export function orographicShare(W, H, elevation, rad, share = new Float32Array(W * H)) {
  const N = W * H;
  share.fill(1);
  if (rad <= 0) return share;
  const land = new Float32Array(N), landElev = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0) { land[i] = 1; landElev[i] = elevation[i]; }
  }
  const landCount = boxSum(W, H, land, rad, new Float32Array(N));
  const elevSum = boxSum(W, H, landElev, rad, new Float32Array(N));
  const weight = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!land[i] || landCount[i] <= 0) continue;
    const dzKm = Math.max(-VAPOUR_SCALE_HEIGHT_KM, Math.min(VAPOUR_SCALE_HEIGHT_KM,
      (elevation[i] - elevSum[i] / landCount[i]) * ELEV_M / 1000));
    weight[i] = dexp(OROGRAPHIC_GAIN_PER_KM * dzKm);
  }
  const weightSum = boxSum(W, H, weight, rad, new Float32Array(N));
  for (let i = 0; i < N; i++) {
    if (land[i] && weightSum[i] > 0) share[i] = weight[i] * landCount[i] / weightSum[i];
  }
  return share;
}

// Precompute the derived fields on the observation's own 94x192 Gaussian grid — the
// per-pixel pass then only has to interpolate three smooth scalars instead of
// re-reducing 24 monthly values per pixel.
function deriveGrids() {
  if (derived) return derived;
  const LAT = precip.lat, LON = precip.lon, NLAT = LAT.length, NLON = LON.length;
  const P = new Float32Array(NLAT * NLON), T = new Float32Array(NLAT * NLON),
        D = new Float32Array(NLAT * NLON), S = new Float32Array(NLAT * NLON),
        // A = seasonal temperature AMPLITUDE (half the warm-cool swing, degC) and
        // WF = fraction of the year's rain falling in its WARM half — the two
        // quantities the growing-season crop model needs (docs/design-growing-season.md),
        // computed for free in this loop that already reads all twelve months.
        A = new Float32Array(NLAT * NLON), WF = new Float32Array(NLAT * NLON);
  for (let j = 0; j < NLAT; j++) {
    const north = LAT[j] >= 0;
    for (let i = 0; i < NLON; i++) {
      let map = 0, mat = 0, dryMonths = 0;
      const tMon = new Float32Array(12), pMon = new Float32Array(12);
      for (let m = 0; m < 12; m++) {
        const pm = precip.months[m][j][i] * 30.4;   // mm/day → mm/month
        const tm = airtemp.months[m][j][i];         // degC
        tMon[m] = tm; pMon[m] = pm;
        map += pm; mat += tm;
        // Gaussen's aridity criterion: a month is arid when its rainfall in mm falls
        // below twice its mean temperature in degC. Published, physical, parameter-free
        // — and it measures the DURATION of drought, which is what separates rainforest
        // from savanna at the same annual total (see the dryFrac note in worldgen).
        if (pm < 2 * tm) dryMonths++;
      }
      // Phase of the drought: local-winter rainfall against local-summer rainfall.
      // Positive = summer-dry, the Mediterranean signature (Koppen's Cs).
      let sP = 0, wP = 0;
      for (let k = 0; k < 6; k++) {
        sP += precip.months[(north ? 3 + k : 9 + k) % 12][j][i];
        wP += precip.months[(north ? 9 + k : 3 + k) % 12][j][i];
      }
      P[j * NLON + i] = map;          // mm/yr
      T[j * NLON + i] = mat / 12;     // degC
      D[j * NLON + i] = dryMonths / 12;
      S[j * NLON + i] = (wP - sP) / Math.max(1e-6, wP + sP);
      // Warm half = the six warmest months; cool half = the six coolest. The
      // amplitude is half the difference of the two halves' mean temperature;
      // the warm-rain fraction is the six warm months' share of annual rain.
      const ord = Array.from({ length: 12 }, (_, k) => k).sort((x, y) => tMon[y] - tMon[x]);
      let warmT = 0, coolT = 0, warmP = 0, allP = 0;
      for (let k = 0; k < 12; k++) { allP += pMon[k]; if (k < 6) { warmT += tMon[ord[k]]; warmP += pMon[ord[k]]; } else coolT += tMon[ord[k]]; }
      A[j * NLON + i] = Math.max(0, (warmT - coolT) / 12);           // degC (each sum is over 6, so /6 each → /12 for the half-difference)
      WF[j * NLON + i] = allP > 1e-6 ? Math.max(0, Math.min(1, warmP / allP)) : 0.5;
    }
  }
  derived = { P, T, D, S, A, WF, LAT, LON, NLAT, NLON };
  return derived;
}

/**
 * Sample the observed MONTHLY climatology onto a W×H map grid (M1 review
 * addition). Returns, per cell × month: 2 m air temperature in °C and the
 * month's precipitation as a RATIO of the cell's own annual monthly mean
 * (so multiplying the sim's annual moisture by it preserves the annual
 * total while carrying the observed seasonal pattern — the monsoon
 * included). Bilinear on the Gaussian grid, same dateline offset as
 * fillRealClimate. Anomalies, not absolutes: the sim's own annual fields
 * (with their lapse/orography detail) stay authoritative.
 * @returns {{tempC: Float32Array, precipRatio: Float32Array}|null}
 */
export function sampleMonthlyClimate(W, H) {
  if (!isRealClimateAvailable()) return null;
  const LAT = precip.lat, NLAT = LAT.length, NLON = precip.lon.length;
  const jIdx = new Int32Array(H), jFrac = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    let j = 0;
    while (j < NLAT - 2 && LAT[j + 1] > lat) j++;
    jIdx[y] = j;
    const span = LAT[j] - LAT[j + 1];
    jFrac[y] = span !== 0 ? Math.max(0, Math.min(1, (LAT[j] - lat) / span)) : 0;
  }
  const iIdx = new Int32Array(W), iFrac = new Float32Array(W);
  const dLon = 360 / NLON;
  for (let x = 0; x < W; x++) {
    const lon = (((x + 0.5) / W * 360 + 180) % 360 + 360) % 360;
    const f = lon / dLon, i0 = Math.floor(f);
    iIdx[x] = i0 % NLON;
    iFrac[x] = f - i0;
  }
  const sampMonth = (months, m, y, x) => {
    const j = jIdx[y], jf = jFrac[y], i0 = iIdx[x], i1 = (i0 + 1) % NLON, xf = iFrac[x];
    const row0 = months[m][j], row1 = months[m][j + 1];
    const a = row0[i0] * (1 - xf) + row0[i1] * xf;
    const b = row1[i0] * (1 - xf) + row1[i1] * xf;
    return a * (1 - jf) + b * jf;
  };
  const tempC = new Float32Array(W * H * 12);
  const precipRatio = new Float32Array(W * H * 12);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = y * W + x;
      let pAnnual = 0;
      for (let m = 0; m < 12; m++) pAnnual += sampMonth(precip.months, m, y, x);
      pAnnual /= 12;
      for (let m = 0; m < 12; m++) {
        tempC[cell * 12 + m] = sampMonth(airtemp.months, m, y, x);
        precipRatio[cell * 12 + m] = pAnnual > 1e-6
          ? sampMonth(precip.months, m, y, x) / pAnnual
          : 1;
      }
    }
  }
  return { tempC, precipRatio };
}

/**
 * Overwrite the climate fields with observation.
 * Temperature is filled everywhere (2 m air temperature is meaningful over water too);
 * moisture only on land, where it means "how much water this ground gets".
 * @param {number} W map width
 * @param {number} H map height
 * @param {Float32Array} elevation  read-only; land mask + the lapse correction
 * @param {Float32Array} moisture   out
 * @param {Float32Array} temperature out
 * @param {Float32Array} [dryFrac]  out, fraction of the year that is arid
 * @param {Float32Array} [summerDry] out, phase of the drought (>0 = summer-dry)
 * @param {{ orographicRain?: boolean }} [options] `orographicRain` (default true) applies the W14 sub-grid orographic share to the sampled rain before the ranking
 * @returns {boolean} false if the data is not loaded
 */
export function fillRealClimate(W, H, elevation, moisture, temperature, dryFrac, summerDry, tAmp, warmRainFrac, { orographicRain = true } = {}) {
  if (!isRealClimateAvailable()) return false;
  // W14 (P18): the coarse rain placed on the slope it fell on, inside the
  // table's own footprint, before the ranking. Off (`rawRain`) for probes
  // that compare against the table as sampled.
  const share = orographicRain ? orographicShare(W, H, elevation, orographicFootprintRadius(W)) : null;
  const { P, T, D, S, A, WF, LAT, NLAT, NLON } = deriveGrids();

  // Latitude index + fraction per map ROW (the Gaussian grid is not evenly spaced, so
  // this is a scan rather than arithmetic — but it is H scans, not W*H).
  const jIdx = new Int32Array(H), jFrac = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    let j = 0;
    while (j < NLAT - 2 && LAT[j + 1] > lat) j++;   // LAT descends 88.5 → -88.5
    jIdx[y] = j;
    const span = LAT[j] - LAT[j + 1];
    jFrac[y] = span !== 0 ? Math.max(0, Math.min(1, (LAT[j] - lat) / span)) : 0;
  }
  // Longitude index + fraction per map COLUMN. The Earth heightmap starts at the
  // International Date Line while the NCEP grid starts at Greenwich — the same 180°
  // offset realWindData applies.
  const iIdx = new Int32Array(W), iFrac = new Float32Array(W);
  const dLon = 360 / NLON;
  for (let x = 0; x < W; x++) {
    const lon = (((x + 0.5) / W * 360 + 180) % 360 + 360) % 360;
    const f = lon / dLon, i0 = Math.floor(f);
    iIdx[x] = i0 % NLON;
    iFrac[x] = f - i0;
  }
  const samp = (g, y, x) => {
    const j = jIdx[y], jf = jFrac[y], i0 = iIdx[x], i1 = (i0 + 1) % NLON, xf = iFrac[x];
    const a = g[j * NLON + i0] * (1 - xf) + g[j * NLON + i1] * xf;
    const b = g[(j + 1) * NLON + i0] * (1 - xf) + g[(j + 1) * NLON + i1] * xf;
    return a * (1 - jf) + b * jf;
  };

  // ── Sub-grid orography ──
  // The observation is ~210 km per cell; the heightmap is ~20 km. A narrow range (the
  // Andes, the Alps, the Southern Alps of New Zealand) is averaged away in the
  // reanalysis, so its crest would come back as warm as the lowland around it. Recover
  // it honestly: smooth the sim's OWN elevation to the observation's footprint, and
  // apply the textbook lapse rate to whatever height the coarse grid could not see.
  // Nothing is invented — where the observation already resolves the terrain (the
  // Tibetan plateau, the Greenland dome) the residual is ~0 and this does nothing.
  const rad = Math.max(1, Math.round(W * 1.9 / 360 / 2));
  const tmp = new Float32Array(W * H), smooth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {                       // horizontal box pass (wraps)
    let acc = 0;
    for (let d = -rad; d <= rad; d++) acc += Math.max(0, elevation[y * W + ((d % W) + W) % W]);
    const inv = 1 / (2 * rad + 1);
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc * inv;
      acc += Math.max(0, elevation[y * W + ((x + rad + 1) % W)]) - Math.max(0, elevation[y * W + ((x - rad) % W + W) % W]);
    }
  }
  for (let x = 0; x < W; x++) {                       // vertical box pass (clamps at poles)
    let acc = 0;
    for (let d = -rad; d <= rad; d++) acc += tmp[Math.min(H - 1, Math.max(0, d)) * W + x];
    const inv = 1 / (2 * rad + 1);
    for (let y = 0; y < H; y++) {
      smooth[y * W + x] = acc * inv;
      acc += tmp[Math.min(H - 1, y + rad + 1) * W + x] - tmp[Math.min(H - 1, Math.max(0, y - rad)) * W + x];
    }
  }

  // ── Pass 1: temperature and dry-season length, plus the observed rainfall each land
  // pixel will be ranked by. `moisture` still holds the SOLVER's field here — it is the
  // calibration target for the quantile map below, so it must not be touched yet.
  const obsP = new Float32Array(W * H);
  let nLand = 0, pMax = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, e = elevation[i];
      let degC = samp(T, y, x);
      if (e > 0) degC -= LAPSE_K_PER_KM * (e - smooth[i]) * ELEV_M / 1000;
      temperature[i] = Math.max(0, Math.min(1, 0.6 + degC / 100));
      if (dryFrac) dryFrac[i] = Math.max(0, Math.min(1, samp(D, y, x)));
      if (summerDry) summerDry[i] = Math.max(-1, Math.min(1, samp(S, y, x)));
      // Growing-season fields: amplitude in SIM temperature units (degC/100, the
      // sim's t = 0.6 + degC/100 scale), warm-rain fraction 0..1. Elevation does
      // not materially change the seasonal SWING, so no lapse term here.
      if (tAmp) tAmp[i] = Math.max(0, samp(A, y, x) / 100);
      if (warmRainFrac) warmRainFrac[i] = Math.max(0, Math.min(1, samp(WF, y, x)));
      if (e > 0) {
        const mm = Math.max(0, samp(P, y, x)) * (share ? share[i] : 1);
        obsP[i] = mm; nLand++;
        if (mm > pMax) pMax = mm;
      }
    }
  }
  if (!nLand) return true;

  // ── Pass 2: quantile-map observed rainfall onto the solver's own moisture
  // distribution over the same land. Histogram both, then read each pixel's rank in the
  // rainfall CDF and return the solver-moisture value at that same rank.
  const NB = 2048;
  const hObs = new Float64Array(NB), hSim = new Float64Array(NB);
  const pScale = pMax > 0 ? (NB - 1) / pMax : 0;
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    hObs[Math.min(NB - 1, Math.floor(obsP[i] * pScale))]++;
    hSim[Math.min(NB - 1, Math.max(0, Math.floor(Math.min(1, moisture[i]) * (NB - 1))))]++;
  }
  for (let b = 1; b < NB; b++) { hObs[b] += hObs[b - 1]; hSim[b] += hSim[b - 1]; }   // → CDFs

  // Invert the solver CDF onto a uniform probability grid once, so the per-pixel step is
  // a lookup rather than a search.
  const NQ = 4096, Q = new Float32Array(NQ + 1);
  for (let q = 0, b = 0; q <= NQ; q++) {
    const target = q / NQ * nLand;
    while (b < NB - 1 && hSim[b] < target) b++;
    const lo = b > 0 ? hSim[b - 1] : 0, hi = hSim[b];
    Q[q] = (b + (hi > lo ? (target - lo) / (hi - lo) : 0)) / NB;
  }
  for (let i = 0; i < W * H; i++) {
    if (elevation[i] <= 0) continue;
    // Rank of this pixel's rainfall, interpolated inside its histogram bin so that ties
    // in a coarse bin still spread smoothly instead of collapsing to one value.
    const f = obsP[i] * pScale, b = Math.min(NB - 1, Math.floor(f));
    const lo = b > 0 ? hObs[b - 1] : 0, hi = hObs[b];
    const rank = Math.max(0, Math.min(1, (lo + (f - b) * (hi - lo)) / nLand));
    const g = rank * NQ, qi = Math.min(NQ - 1, Math.floor(g));
    moisture[i] = Math.max(0.02, Math.min(1, Q[qi] + (Q[qi + 1] - Q[qi]) * (g - qi)));
  }
  return true;
}
