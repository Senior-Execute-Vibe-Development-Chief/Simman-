// THE YIELD-VARIANCE MAP vs literature bands — the harvest-years referee
//
// Scores src/sim/peopleSim/harvest.js (the REAL formula the mechanism runs —
// a probe-local copy is how a render bug once survived a whole session of
// "validation") against real-world interannual yield-CV bands over 12 regions,
// the Köppen-calibration discipline: real data as referee, constants CALIBRATED
// against the world, never fitted to sim outcomes.
//
//   node tools/probe_yieldcv.mjs [W=480] [seed=8817] [--real]
//
// --real builds the world in the OBSERVED-climate regime (real NCEP
// precipitation/temperature through realClimateData's quantile map — the mode
// the app actually plays). That is the CALIBRATION arm: the formula's inputs
// are near-true there, so a miss is the formula's fault. The default solver arm
// is the GATE-REGIME read: same formula, the solver's own input errors — every
// miss must decompose into a named, measured solver debt (see harvest.js's
// REGIME NOTE), or it is the formula's fault after all.
//
// CALIBRATION HISTORY (all recorded, don't relive):
//   it.1 the trade-premium water band pegged 1.00 planet-wide (England read
//        "flood-fed") — killed for the absolute riverMag convention;
//   it.2 the dry-month count read deserts as "seasonal" — replaced by the
//        single-season SHAPE 4·df·(1−df) (peak at the half-dry year);
//   it.3 global-max water normalization was scale-fragile (the Nile read 0.00
//        at tw=480) — absolute channel bars; and the channel feeds the fields
//        BESIDE it — 3×3 neighbourhood read;
//   it.4 (the moisture-calibration lap, 2026-08-25) the rain margin moved from
//        raw moist (which ranked Britain beside Mesopotamia — the recorded
//        index debt) to em = moist/demand(temp), biomeClass's Holdridge
//        language; the WINTER-RISK axis was added on the cool-half mean
//        temperature (the continental steppe bands are winterkill, not
//        aridity); the monsoon-concentration signal joined via warmRainFrac
//        (amplitude-gated); solver tAmp gained its documented continentality
//        refinement (westerly fetch + aridity, worldgen fallback) — probe:
//        probe_moistcal.mjs.
//   it.5 the water term gained the pipeline's tFlood mask (the Tigris-
//        Euphrates never exceeds mag 2 in-grid — probe_floodmask — so mag
//        bars alone cannot see Mesopotamia's flood regime); the verdict
//        median went FERT-WEIGHTED (the max-pooled fert mask hangs the
//        valley's fert on desert edge tiles whose own point-sampled climate
//        is desert — the unweighted median landed on those ghosts); the
//        Sahel and Pontic boxes were redrawn to the belts their bands
//        actually describe (millet belt 13-17.5°N; steppe proper ≤49°N).
//
// Literature anchor bands (approximate, pre-modern/pre-irrigation-tech, from
// FAO yield-variability studies + historical famine literature — engineering
// anchors, not gospel):
//   England/N.France 0.08-0.16 · Mediterranean 0.18-0.30 · Sahel 0.30-0.48
//   Nile valley 0.14-0.26 (flood) · Mesopotamia 0.15-0.30 · Ganges 0.14-0.26
//   N.China plain 0.18-0.32 · Pontic/Kazakh steppe 0.25-0.42 · Java/wet
//   tropics 0.06-0.15 · S.India (monsoon interior) 0.20-0.35
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { demand } from "../src/sim/biomeClass.js";
import { yieldCvAt, ensureYieldCv, CV_BASE, CV_MARGIN, CV_SEASON, CV_WINTER, CV_FLOOD, CV_EM0, CV_EM_RAMP } from "../src/sim/peopleSim/harvest.js";

const args = process.argv.slice(2).filter(a => a !== "--real");
const REAL = process.argv.includes("--real");
const W = +(args[0] || 480), H = W >> 1;
const SEED = +(args[1] || 8817);

let world;
if (REAL) {
  const rc = await import("../src/realClimateData.js");
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
  rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
  const fns = { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate };
  world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: fns });
} else {
  world = buildSim({ W, H, seed: SEED });
}
const TW = world.tw, TH = world.th, N = world.N;
const { elev, moist, temp, riverMag } = world;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;

const cvMap = ensureYieldCv(world);

// ── validation boxes: real regions with literature CV bands ──
const R = [
  { k: "England/N.Fr", lon: [-5, 5],    lat: [46, 55], lo: 0.08, hi: 0.16 },
  { k: "Med. Spain",   lon: [-6, 2],    lat: [37, 42], lo: 0.18, hi: 0.30 },
  { k: "Greece/Aegean",lon: [20, 27],   lat: [36, 41], lo: 0.18, hi: 0.30 },
  // Sahel box: the millet belt proper (~13-17.5°N, 200-600 mm). The first box
  // reached 11°N into the Sudanian savanna, whose real CV sits honestly below
  // the Sahel band — the same box-composition trap as the Pontic (see below).
  { k: "Sahel",        lon: [-15, 30],  lat: [13, 17.5], lo: 0.30, hi: 0.48 },
  { k: "Nile valley",  lon: [30, 33],   lat: [22, 31], lo: 0.14, hi: 0.26 },
  { k: "Mesopotamia",  lon: [44, 48],   lat: [30, 34], lo: 0.15, hi: 0.30 },
  { k: "Ganges",       lon: [77, 88],   lat: [22, 28], lo: 0.14, hi: 0.26 },
  { k: "N.China plain",lon: [110, 118], lat: [33, 39], lo: 0.18, hi: 0.32 },
  // Pontic box: steppe PROPER (south of the ~49°N forest-steppe line — Novorossiya/
  // Don dryland wheat, the band's own literature). The first box reached 52°N and
  // its median tile was Kyiv-latitude forest-steppe, whose real CV is honestly
  // BELOW the steppe band — the recorded box-composition trap, not a formula miss.
  { k: "Pontic steppe",lon: [30, 48],   lat: [45, 49], lo: 0.25, hi: 0.42 },
  { k: "Kazakh steppe",lon: [55, 75],   lat: [48, 54], lo: 0.25, hi: 0.42 },
  { k: "Java/wet trop",lon: [105, 115], lat: [-9, -5], lo: 0.06, hi: 0.15 },
  { k: "S.India int.", lon: [74, 80],   lat: [12, 18], lo: 0.20, hi: 0.35 },
];
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
// FERT-WEIGHTED median: the verdict statistic. The tile mask (fert > 0.15) rides
// the MAX-POOLED crop field, so a desert tile whose pixel block touches a valley
// ribbon wears the ribbon's fert while its own point-sampled moist/tFlood stay
// desert — half the Nile box's "cropland" is such ghosts, and an unweighted
// median lands on them. The mechanism multiplies landFood, which lives where
// fert is — the fert-weighted median is the CV of the land that carries food.
const wq = (pairs, f) => {
  if (!pairs.length) return 0;
  const s = [...pairs].sort((x, y) => x[0] - y[0]);
  const tot = s.reduce((a, p) => a + p[1], 0);
  let acc = 0;
  for (const p of s) { acc += p[1]; if (acc >= f * tot) return p[0]; }
  return s[s.length - 1][0];
};

console.log(`\n=== THE YIELD-VARIANCE MAP  ${W}x${H} (tw=${TW})  seed ${SEED}  (${REAL ? "OBSERVED" : "SOLVER"}-climate regime) ===`);
console.log(`  cv = (${CV_BASE} + ${CV_MARGIN}·margin(em ${CV_EM0}/${CV_EM_RAMP}) + ${CV_SEASON}·seasonal·damp)·(1−water) + ${CV_FLOOD}·water + ${CV_WINTER}·winter\n`);
console.log(`  region          sim CV p10/P50w/p90    real band     verdict   (P50w = fert-weighted median, the verdict statistic)`);
let hit = 0, n = 0;
for (const r of R) {
  const vals = [], pairs = [], diag = { rm: [], se: [], wi: [], wa: [] };
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (elev[i] <= 0) continue;
    // CROPLAND ONLY: the CV that matters is over land someone farms — the raw
    // box median in Egypt was empty desert at full rain-margin (first run's
    // Nile HIGH 0.50). fert > 0.15 is the plantability species of floor.
    if (!(world.fert && world.fert[i] > 0.15)) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    vals.push(cvMap[i]);
    pairs.push([cvMap[i], world.fert[i]]);
    // diagnostics mirror harvest.js's axes (fert-weighted like the verdict)
    const em = moist[i] / demand(temp[i]);
    diag.rm.push([Math.max(0, Math.min(1, (CV_EM0 - em) / CV_EM_RAMP)), world.fert[i]]);
    const df = world._dryFrac ? world._dryFrac[i] : 0;
    const gaussen = Math.max(4 * df * (1 - df) - 0.5, 0) * 2;
    const ampC = world._tAmp ? world._tAmp[i] * 100 : 0;
    const wf = world._warmRainFrac ? world._warmRainFrac[i] : 0.5;
    const monsoon = ampC >= 4 ? Math.max(0, (Math.abs(wf - 0.5) * 2 - 0.3) / 0.7) : 0;
    diag.se.push([Math.max(gaussen, monsoon), world.fert[i]]);
    const coolT = (temp[i] - 0.6) * 100 - ampC;
    diag.wi.push([ampC > 0 ? Math.max(0, Math.min(1, (6 - coolT) / 13)) : 0, world.fert[i]]);
    { let ch = 0; const ty0 = (i / TW) | 0, tx0 = i - ty0 * TW;
      for (let dy = -1; dy <= 1; dy++) { const yy = ty0 + dy; if (yy < 0 || yy >= TH) continue;
        for (let dx = -1; dx <= 1; dx++) { const v = riverMag ? riverMag[yy * TW + (((tx0 + dx) % TW) + TW) % TW] : 0; if (v > ch) ch = v; } }
      const flood = world.tFlood ? world.tFlood[i] : 0;
      const rm2 = Math.max(0, Math.min(1, (CV_EM0 - em) / CV_EM_RAMP));
      const acc = Math.max(Math.max(0, Math.min(1, (ch - 1) / 2)), (world.coast && world.coast[i] ? 0.5 : 0));
      diag.wa.push([flood ? 1 : Math.max(Math.max(0, Math.min(1, (ch - 2) / 3)), rm2 * acc), world.fert[i]]); }
  }
  if (!vals.length) { console.log(`  ${r.k.padEnd(14)} (no land tiles)`); continue; }
  n++;
  const p50 = wq(pairs, .5);
  const ok = p50 >= r.lo && p50 <= r.hi;
  if (ok) hit++;
  console.log(`  ${r.k.padEnd(14)} ${q(vals, .1).toFixed(2)}/${p50.toFixed(2)}/${q(vals, .9).toFixed(2)}          ${r.lo.toFixed(2)}-${r.hi.toFixed(2)}     ${(ok ? "ok  " : p50 < r.lo ? "LOW " : "HIGH")}  [margin ${wq(diag.rm, .5).toFixed(2)} season ${wq(diag.se, .5).toFixed(2)} winter ${wq(diag.wi, .5).toFixed(2)} water ${wq(diag.wa, .5).toFixed(2)}]`);
}
console.log(`\n  agreement: ${hit}/${n} region medians inside their literature band`);

// world distribution + the LEAN_YEAR bridge preview
const all = [];
for (let i = 0; i < N; i++) if (elev[i] > 0) all.push(cvMap[i]);
console.log(`  world land CV p10/p50/p90: ${q(all, .1).toFixed(2)}/${q(all, .5).toFixed(2)}/${q(all, .9).toFixed(2)}`);
console.log(`\n  LEAN_YEAR bridge preview (margin = 1/p10-year ≈ 1/(1−1.28·cv), the deep year 1/(1−2.33·cv)):`);
for (const [lab, cv] of [["England", 0.12], ["Nile", 0.20], ["Mesopotamia", 0.24], ["Sahel", 0.40]]) {
  const p10 = Math.max(0.2, 1 - 1.28 * cv), deep = Math.max(0.2, 1 - 2.33 * cv);
  console.log(`    cv ${cv.toFixed(2)} (${lab}): lean-year margin ${(1 / p10).toFixed(2)}×, deep-year ${(1 / deep).toFixed(2)}×  (flat law shipped 2.86× everywhere)`);
}
console.log(`\n  READ: the --real arm is the calibration referee (near-true inputs — a miss`);
console.log(`  is the formula's). The solver arm is the gate-regime read — every miss must`);
console.log(`  decompose into a named, measured solver-input debt (harvest.js REGIME NOTE).`);
