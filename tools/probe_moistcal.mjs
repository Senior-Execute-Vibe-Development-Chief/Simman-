// THE MOISTURE-INDEX CALIBRATION LAP — measure the recorded debt (2026-08-25)
//
// The debt (recorded since the forest wave, autopsy 2026-08-24 final section):
// "Britain ≈ Mesopotamia on the moisture index" — England's cropland reads
// m≈0.45 beside semi-arid Mesopotamia's ≈0.45, the solver-Sahel's cropland too
// wet, the monsoon Ganges semi-arid. One debt mis-fed the forest signal (fixed
// by CANOPY_CLASS reading the Koppen classifier) and now mis-feeds the
// yield-variance map; the irrigation stack (IRRIG_ARID0 on raw m) reads the
// same raw index.
//
// THE HYPOTHESIS THIS PROBE TESTS: the raw index `m` is a PRECIPITATION-like
// quantity ("how much water this ground gets" — worldgen's own contract), and
// the consumers that broke are the ones reading it as ARIDITY with a single
// global threshold. Aridity is water vs evaporative DEMAND. The codebase
// already owns the corrective layer: biomeClass.js's Holdridge demand(t)
// (calibrated, 79.4% Koppen agreement through it). Effective moisture
//   em = m / demand(t)
// should separate cool-wet Britain (low demand) from hot-dry Mesopotamia
// (high demand) WITHOUT touching the index itself — the same one-language fix
// CANOPY_CLASS applied to forests.
//
// Measured here, per literature region and per climate REGIME (the app runs
// observed NCEP climate through the quantile map; the harness/gates run the
// solver):   raw m · t · demand · em   on CROPLAND (fert>0.15), against the
// REAL numbers: annual precip (mm), Holdridge PET (58.93×bioT mm), and the
// real aridity index AI = MAP/PET.
//
//   node tools/probe_moistcal.mjs [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { demand } from "../src/sim/biomeClass.js";
import * as rc from "../src/realClimateData.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);

const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
const PR = load("global_precip.json"), TA = load("global_airtemp.json");
const LAT = PR.lat, NLAT = LAT.length, NLON = PR.lon.length;
function obsCell(g, m, la, lo) {
  lo = ((lo % 360) + 360) % 360;
  let j = 0; while (j < NLAT - 1 && Math.abs(LAT[j + 1] - la) < Math.abs(LAT[j] - la)) j++;
  const i = Math.round(lo / (360 / NLON)) % NLON;
  return g.months[m][j][i];
}

// Same validation boxes as probe_yieldcv (literature CV bands carried for reference).
const R = [
  { k: "England/N.Fr", lon: [-5, 5],    lat: [46, 55], lo: 0.08, hi: 0.16 },
  { k: "Med. Spain",   lon: [-6, 2],    lat: [37, 42], lo: 0.18, hi: 0.30 },
  { k: "Greece/Aegean",lon: [20, 27],   lat: [36, 41], lo: 0.18, hi: 0.30 },
  { k: "Sahel",        lon: [-15, 30],  lat: [11, 17], lo: 0.30, hi: 0.48 },
  { k: "Nile valley",  lon: [30, 33],   lat: [22, 31], lo: 0.14, hi: 0.26 },
  { k: "Mesopotamia",  lon: [44, 48],   lat: [30, 34], lo: 0.15, hi: 0.30 },
  { k: "Ganges",       lon: [77, 88],   lat: [22, 28], lo: 0.14, hi: 0.26 },
  { k: "N.China plain",lon: [110, 118], lat: [33, 39], lo: 0.18, hi: 0.32 },
  { k: "Pontic steppe",lon: [30, 48],   lat: [45, 49], lo: 0.25, hi: 0.42 },   // steppe proper — see probe_yieldcv's box note
  { k: "Kazakh steppe",lon: [55, 75],   lat: [48, 54], lo: 0.25, hi: 0.42 },
  { k: "Java/wet trop",lon: [105, 115], lat: [-9, -5], lo: 0.06, hi: 0.15 },
  { k: "S.India int.", lon: [74, 80],   lat: [12, 18], lo: 0.20, hi: 0.35 },
];
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

// ── Real truth per region: MAP, Holdridge PET, AI, seasonal amplitude, warm-rain
// fraction over the obs grid ─────────────────────────────────────────────────
function realTruth(r) {
  const maps = [], ais = [], mats = [], amps = [], wfs = [];
  for (let j = 0; j < NLAT; j++) {
    const la = LAT[j];
    if (la < r.lat[0] || la > r.lat[1]) continue;
    for (let ii = 0; ii < NLON; ii++) {
      let lo = ii * (360 / NLON); if (lo > 180) lo -= 360;
      if (lo < r.lon[0] || lo > r.lon[1]) continue;
      let map = 0, bio = 0, mat = 0, ok = true;
      const tMon = [], pMon = [];
      for (let m = 0; m < 12; m++) {
        const pm = PR.months[m][j][ii], tm = TA.months[m][j][ii];
        if (pm == null || tm == null) { ok = false; break; }
        map += pm * 30.4;
        bio += Math.max(0, Math.min(30, tm));
        mat += tm;
        tMon.push(tm); pMon.push(pm * 30.4);
      }
      if (!ok) continue;
      bio /= 12; mat /= 12;
      const pet = 58.93 * bio;   // Holdridge annual PET, mm
      // amplitude + warm-rain fraction, same reduction as realClimateData deriveGrids
      const ord = Array.from({ length: 12 }, (_, k) => k).sort((x, y) => tMon[y] - tMon[x]);
      let warmT = 0, coolT = 0, warmP = 0;
      for (let k = 0; k < 12; k++) { if (k < 6) { warmT += tMon[ord[k]]; warmP += pMon[ord[k]]; } else coolT += tMon[ord[k]]; }
      amps.push(Math.max(0, (warmT - coolT) / 12));
      wfs.push(map > 1e-6 ? warmP / map : 0.5);
      // crude sea filter: hyper-wet cells at |lat|>60 aside, keep all — the obs grid
      // has no land mask; regions here are chosen to be mostly land.
      maps.push(map); ais.push(pet > 0 ? map / pet : 99); mats.push(mat);
    }
  }
  return { map: q(maps, .5), ai: q(ais, .5), mat: q(mats, .5), amp: q(amps, .5), wf: q(wfs, .5) };
}

// ── One sim arm: build, then per-region cropland medians ─────────────────────
function armStats(world, label) {
  const TW = world.tw, TH = world.th;
  const { elev, moist, temp } = world;
  const dryF = world._dryFrac;
  const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
  const out = {};
  const emAll = [], mAll = [];
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (elev[i] <= 0) continue;
    const em = moist[i] / demand(temp[i]);
    emAll.push(em); mAll.push(moist[i]);
  }
  out._land = { em: [q(emAll, .1), q(emAll, .5), q(emAll, .9)], m: [q(mAll, .1), q(mAll, .5), q(mAll, .9)] };
  const ampF = world._tAmp, wfF = world._warmRainFrac;
  for (const r of R) {
    const ms = [], ts = [], ems = [], dfs = [], des = [], amps = [], wfs = [];
    for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
      const i = ty * TW + tx;
      if (elev[i] <= 0) continue;
      if (!(world.fert && world.fert[i] > 0.15)) continue;   // cropland only, as the CV map reads
      const lo = lonOf(tx), la = latOf(ty);
      if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
      ms.push(moist[i]); ts.push((temp[i] - 0.6) * 100);
      des.push(demand(temp[i]));
      ems.push(moist[i] / demand(temp[i]));
      dfs.push(dryF ? dryF[i] : 0);
      amps.push(ampF ? ampF[i] * 100 : -1);   // °C
      wfs.push(wfF ? wfF[i] : -1);
    }
    out[r.k] = { n: ms.length, m: q(ms, .5), t: q(ts, .5), de: q(des, .5), em: q(ems, .5), df: q(dfs, .5), amp: q(amps, .5), wf: q(wfs, .5) };
  }
  return out;
}

console.log(`\n=== MOISTURE-INDEX CALIBRATION  ${W}x${H}  seed ${SEED} ===`);

console.error("[arm 1/2] solver climate ...");
const wSolver = buildSim({ W, H, seed: SEED });
const S = armStats(wSolver, "solver");

console.error("[arm 2/2] observed climate (the app's regime) ...");
rc.provideRealClimateData(PR, TA);
const fns = { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate };
const wReal = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: fns });
const O = armStats(wReal, "observed");

console.log(`\n  land em p10/p50/p90:  solver ${S._land.em.map(v => v.toFixed(2)).join("/")}   observed ${O._land.em.map(v => v.toFixed(2)).join("/")}`);
console.log(`  land m  p10/p50/p90:  solver ${S._land.m.map(v => v.toFixed(2)).join("/")}   observed ${O._land.m.map(v => v.toFixed(2)).join("/")}\n`);
console.log(`  region          REAL mm  AI   amp°C  wf  |  SOLVER  em    dryF  amp   wf  |  OBSERVED em    dryF  amp   wf`);
for (const r of R) {
  const t = realTruth(r), s = S[r.k], o = O[r.k];
  const f = (x, d = 2) => (x == null ? "  -  " : x.toFixed(d).padStart(5));
  console.log(`  ${r.k.padEnd(14)} ${String(Math.round(t.map)).padStart(5)}  ${f(t.ai)} ${f(t.amp, 1)} ${f(t.wf)} |  n=${String(s.n).padStart(4)} ${f(s.em)} ${f(s.df)} ${f(s.amp, 1)} ${f(s.wf)} |  n=${String(o.n).padStart(4)} ${f(o.em)} ${f(o.df)} ${f(o.amp, 1)} ${f(o.wf)}`);
}
console.log(`\n  READ: em = m/demand(t) is the candidate one-language fix (biomeClass's own`);
console.log(`  Holdridge layer). If em ORDERS the regions like real AI does — Britain far`);
console.log(`  above Mesopotamia/Sahel — the index is fine and the aridity CONSUMERS were`);
console.log(`  reading it in the wrong units; calibrate the CV map's ramp on em against AI.`);
console.log(`  Residual mis-orderings are SOLVER pattern debts (named per-region; the app`);
console.log(`  regime = quantile-mapped real precip has real ranks by construction).`);
