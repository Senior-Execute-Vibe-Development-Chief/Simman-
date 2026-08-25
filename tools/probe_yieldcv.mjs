// THE YIELD-VARIANCE MAP — famine proclivity from real factors (2026-08-24)
//
// The harvest-years wave's measurement step (owner: "should we have an actual
// year-to-year production swing across the globe, based on real factors? So it
// is actually wrapped into real output?"). Before any mechanism, this builds
// the CANDIDATE variance map from fields the sim already carries and validates
// it against real-world interannual yield variability — the same discipline as
// the Köppen calibration of biomeClass.js (real data as the referee, so the
// constants are CALIBRATED against the world, never fitted to sim outcomes).
//
// The map: cv(tile) — the coefficient of variation of annual harvest —
// grounded in three real factors:
//
//   RAIN MARGIN   — rain-fed yield CV rises steeply as mean moisture nears the
//                   crop minimum (England wheat ~10-15%; interior Spain/Greece
//                   20-30%; Sahel millet 30-45%; Kazakh steppe 30-40%). Read
//                   off `moist` with the SAME semi-arid ramp the irrigation
//                   stack uses (IRRIG_ARID0, /0.20) — one aridity language.
//   SEASONALITY   — one-rainy-season regimes bet the year on one season
//                   (mediterranean summer-dry, monsoon concentration): read
//                   off dryFrac/summerDry (on the sim grid since CANOPY_CLASS).
//   FLOOD REGIME  — river-fed floodplains decouple from local rain (damping
//                   the rain term) but carry their own flood variance: the
//                   pre-dam Nile's bad-flood years ran yield CV ~15-25% — the
//                   literal seven lean years. Read off the river/coast access
//                   the capacity pass already uses.
//
//   cvRain  = CV_BASE + CV_MARGIN·rainMargin + CV_SEASON·seasonal·(1-rainMargin·0.5)
//   cv      = cvRain·(1-water) + CV_FLOOD·water          (river-fed → flood regime)
//
// Literature anchor bands (approximate, pre-modern/pre-irrigation-tech, from
// FAO yield-variability studies + historical famine literature — engineering
// anchors, not gospel):
//   England/N.France 0.08-0.16 · Mediterranean 0.18-0.30 · Sahel 0.30-0.48
//   Nile valley 0.14-0.26 (flood) · Mesopotamia 0.15-0.30 · Ganges 0.14-0.26
//   N.China plain 0.18-0.32 · Pontic/Kazakh steppe 0.25-0.42 · Java/wet
//   tropics 0.06-0.15 · S.India (monsoon interior) 0.20-0.35
//
// REGIME NOTE: harness worlds run SOLVER climate (pipeline realWind=false);
// the app runs real NCEP winds. The FORMULA is regime-independent; regional
// readings may shift between regimes (the recorded split) — the calibration
// verdict names its regime.
//
//   node tools/probe_yieldcv.mjs [W=480] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th, N = world.N;
const { elev, moist, riverMag, coast } = world;
const dryF = world._dryFrac, sumF = world._summerDry;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;

// ── the candidate map's constants (calibration targets, real-data-anchored) ──
const CV_BASE   = 0.10;   // reliably-wet temperate floor (England-class)
const CV_MARGIN = 0.35;   // added at the full semi-arid margin (Sahel-class ceiling ≈ 0.45)
const CV_SEASON = 0.10;   // added at full one-season concentration (mediterranean/monsoon sharpening)
const CV_FLOOD  = 0.20;   // the flood-regime CV a fully river-fed valley converges to (pre-dam Nile-class)
const ARID0 = T.IRRIG_ARID0 ?? 0.52, ARAMP = 0.20;   // the irrigation stack's own aridity language

const rmEff = (T.ACCESS_BAND && world._rmBand) ? world._rmBand : riverMag;
const coastEff = (T.ACCESS_BAND && world._coastBand) ? world._coastBand : coast;
let rmMax = 0; for (let i = 0; i < N; i++) if (elev[i] > 0 && rmEff && rmEff[i] > rmMax) rmMax = rmEff[i];

function cvAt(i) {
  const m = moist[i];
  const rainMargin = Math.max(0, Math.min(1, (ARID0 + 0.10 - m) / (ARAMP + 0.10)));   // widened ramp: variance rises BEFORE full aridity
  // TRUE single-season shape, not the dry-month count (iteration 2): a desert's
  // twelve dry months are aridity (the margin term), not seasonality — peak
  // seasonality is the HALF-dry year (mediterranean/monsoon: one wet season).
  const df = dryF ? dryF[i] : 0;
  const seasonal = Math.max(4 * df * (1 - df) - 0.5, 0) * 2;   // 0 at df 0 or 1, 1 at df 0.5, engages past 0.15
  // FLOODPLAIN-GRADE water only (iteration 2): the trade-premium band read
  // pegged 1.00 planet-wide (England read flood-fed). Regime-switching needs a
  // Nile/Indus-class channel: the top of the river-magnitude range, no coast.
  const water = rmEff && rmMax > 0 ? Math.max(0, Math.min(1, (rmEff[i] / rmMax - 0.15) / 0.35)) : 0;
  const cvRain = CV_BASE + CV_MARGIN * rainMargin + CV_SEASON * seasonal * (1 - rainMargin * 0.5);
  return cvRain * (1 - water) + CV_FLOOD * water;
}

// ── validation boxes: real regions with literature CV bands ──
const R = [
  { k: "England/N.Fr", lon: [-5, 5],    lat: [46, 55], lo: 0.08, hi: 0.16 },
  { k: "Med. Spain",   lon: [-6, 2],    lat: [37, 42], lo: 0.18, hi: 0.30 },
  { k: "Greece/Aegean",lon: [20, 27],   lat: [36, 41], lo: 0.18, hi: 0.30 },
  { k: "Sahel",        lon: [-15, 30],  lat: [11, 17], lo: 0.30, hi: 0.48 },
  { k: "Nile valley",  lon: [30, 33],   lat: [22, 31], lo: 0.14, hi: 0.26 },
  { k: "Mesopotamia",  lon: [44, 48],   lat: [30, 34], lo: 0.15, hi: 0.30 },
  { k: "Ganges",       lon: [77, 88],   lat: [22, 28], lo: 0.14, hi: 0.26 },
  { k: "N.China plain",lon: [110, 118], lat: [33, 39], lo: 0.18, hi: 0.32 },
  { k: "Pontic steppe",lon: [30, 50],   lat: [46, 52], lo: 0.25, hi: 0.42 },
  { k: "Kazakh steppe",lon: [55, 75],   lat: [48, 54], lo: 0.25, hi: 0.42 },
  { k: "Java/wet trop",lon: [105, 115], lat: [-9, -5], lo: 0.06, hi: 0.15 },
  { k: "S.India int.", lon: [74, 80],   lat: [12, 18], lo: 0.20, hi: 0.35 },
];
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

console.log(`\n=== THE YIELD-VARIANCE MAP  ${W}x${H} (tw=${TW})  seed ${SEED}  (SOLVER-climate regime) ===`);
console.log(`  cv = (${CV_BASE} + ${CV_MARGIN}·rainMargin + ${CV_SEASON}·seasonal·damp)·(1−water) + ${CV_FLOOD}·water\n`);
console.log(`  region          sim CV p10/p50/p90     real band     verdict`);
let hit = 0, n = 0;
for (const r of R) {
  const vals = [], diag = { rm: [], se: [], wa: [] };
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (elev[i] <= 0) continue;
    // CROPLAND ONLY: the CV that matters is over land someone farms — the raw
    // box median in Egypt was empty desert at full rain-margin (first run's
    // Nile HIGH 0.50). fert > 0.15 is the plantability species of floor.
    if (!(world.fert && world.fert[i] > 0.15)) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    vals.push(cvAt(i));
    const m = moist[i];
    diag.rm.push(Math.max(0, Math.min(1, (ARID0 + 0.10 - m) / (ARAMP + 0.10))));
    const _df = dryF ? dryF[i] : 0;
    diag.se.push(Math.max(4 * _df * (1 - _df) - 0.5, 0) * 2);
    diag.wa.push(rmEff && rmMax > 0 ? Math.max(0, Math.min(1, (rmEff[i] / rmMax - 0.15) / 0.35)) : 0);
  }
  if (!vals.length) { console.log(`  ${r.k.padEnd(14)} (no land tiles)`); continue; }
  n++;
  const p50 = q(vals, .5);
  const ok = p50 >= r.lo && p50 <= r.hi;
  if (ok) hit++;
  console.log(`  ${r.k.padEnd(14)} ${q(vals, .1).toFixed(2)}/${p50.toFixed(2)}/${q(vals, .9).toFixed(2)}          ${r.lo.toFixed(2)}-${r.hi.toFixed(2)}     ${(ok ? "ok  " : p50 < r.lo ? "LOW " : "HIGH")}  [margin ${q(diag.rm, .5).toFixed(2)} season ${q(diag.se, .5).toFixed(2)} water ${q(diag.wa, .5).toFixed(2)}]`);
}
console.log(`\n  agreement: ${hit}/${n} region medians inside their literature band`);

// world distribution + the LEAN_YEAR bridge preview
const all = [];
for (let i = 0; i < N; i++) if (elev[i] > 0) all.push(cvAt(i));
console.log(`  world land CV p10/p50/p90: ${q(all, .1).toFixed(2)}/${q(all, .5).toFixed(2)}/${q(all, .9).toFixed(2)}`);
console.log(`\n  LEAN_YEAR bridge preview (margin = 1/p10-year ≈ 1/(1−1.28·cv), the deep year 1/(1−2.33·cv)):`);
for (const [lab, cv] of [["England", 0.12], ["Nile", 0.20], ["Mesopotamia", 0.24], ["Sahel", 0.40]]) {
  const p10 = Math.max(0.2, 1 - 1.28 * cv), deep = Math.max(0.2, 1 - 2.33 * cv);
  console.log(`    cv ${cv.toFixed(2)} (${lab}): lean-year margin ${(1 / p10).toFixed(2)}×, deep-year ${(1 / deep).toFixed(2)}×  (flat law shipped 2.86× everywhere)`);
}
console.log(`\n  READ: calibrate the four constants against the table (real data as referee),`);
console.log(`  never against sim outcomes. When the map reads true, the mechanism lap wires`);
console.log(`  it: an annual regional index with this cv multiplies landFood; famine derives`);
console.log(`  from the tail; FAMINE_CHANCE/SEVERITY/RADIUS retire; LEAN_YEAR grounds per-basin.`);
