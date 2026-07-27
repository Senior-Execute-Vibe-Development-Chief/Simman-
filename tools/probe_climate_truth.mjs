// Score the climate model against OBSERVATION, land pixel by land pixel.
//
//   node tools/probe_climate_truth.mjs [W]
//
// Uses data/global_airtemp.json + data/global_precip.json (NCEP/NCAR 1991-2020
// monthly climatology, built by tools/convert_climate_data.py). Validation only —
// nothing in src/ reads them; the climate fields stay the solver's output.
//
// Three scores, in rising order of what actually matters:
//   1. TEMPERATURE — mean absolute error in degrees C. Directly comparable.
//   2. MOISTURE — Spearman rank correlation. The model's `moisture` is a 0-1 index
//      rather than millimetres, so only the ORDERING of wet and dry places is
//      meaningful, and the ordering is what the biome map reads.
//   3. BIOME — Koppen is defined entirely from monthly temperature and precipitation,
//      so the two observation files ALSO give derived biome truth. This scores the
//      finished map against it and prints a confusion matrix, which says not just how
//      often the model is wrong but WHAT it confuses for what.
import { readFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";

const W = +(process.argv[2] || 1920), H = W >> 1;
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
const PR = load("global_precip.json"), TA = load("global_airtemp.json");

const LAT = PR.lat, NLAT = LAT.length, NLON = PR.lon.length;
function cell(g, m, la, lo) {                       // nearest-neighbour; obs grid is 1.9deg
  lo = ((lo % 360) + 360) % 360;
  let j = 0; while (j < NLAT - 1 && Math.abs(LAT[j + 1] - la) < Math.abs(LAT[j] - la)) j++;
  const i = Math.round(lo / (360 / NLON)) % NLON;
  return g.months[m][j][i];
}
function obs(la, lo) {
  const p = [], t = [];
  for (let m = 0; m < 12; m++) {
    const pv = cell(PR, m, la, lo), tv = cell(TA, m, la, lo);
    if (pv == null || tv == null) return null;
    p.push(pv * 30.4); t.push(tv);                  // mm/month, degC
  }
  return { p, t };
}

// ── Koppen main class, then collapsed to the coarse land-cover classes the model
// emits. The collapse is documented rather than clever: Af/Am are rainforest, Aw/As
// savanna, BW desert, BS steppe (grassland), C temperate forest, D boreal, ET tundra,
// EF ice. Mediterranean Cs is really shrubland and lands in FOREST here — a known
// blur, called out so nobody reads more precision into the number than it carries.
function koppen(p, t) {
  const MAP = p.reduce((a, b) => a + b, 0);
  const MAT = t.reduce((a, b) => a + b, 0) / 12;
  const tmax = Math.max(...t), tmin = Math.min(...t);
  // summer half = warmer six months (Apr-Sep in the N, Oct-Mar in the S)
  const north = t.slice(3, 9).reduce((a, b) => a + b, 0) > t.concat(t).slice(9, 15).reduce((a, b) => a + b, 0);
  const sHalf = north ? p.slice(3, 9) : p.concat(p).slice(9, 15);
  const sP = sHalf.reduce((a, b) => a + b, 0);
  const frac = MAP > 0 ? sP / MAP : 0;
  const Pth = frac >= 0.7 ? 2 * MAT + 28 : frac <= 0.3 ? 2 * MAT : 2 * MAT + 14;
  if (MAP < 10 * Pth) return MAP < 5 * Pth ? "BW" : "BS";
  if (tmax <= 10) return tmax <= 0 ? "EF" : "ET";
  if (tmin >= 18) {
    const pdry = Math.min(...p);
    if (pdry >= 60) return "Af";
    return pdry >= 100 - MAP / 25 ? "Am" : "Aw";
  }
  return tmin >= 0 ? "C" : "D";
}
const KCLS = { BW: "DRY", BS: "GRASS", Aw: "GRASS", Af: "FOREST", Am: "FOREST",
               C: "FOREST", D: "BOREAL", ET: "TUNDRA", EF: "ICE" };

function bio(e, m, t, dry) {
  if (e <= 0) return -1;
  const d = .5 + t * .5;
  let em = Math.min(1, m / d);
  const warmth = Math.max(0, Math.min(1, (t - 0.79) / 0.035));
  if (dry > 0 && warmth > 0) {
    const seas = em * (1 - 0.68 * warmth * Math.max(0, Math.min(1, (dry - 0.28) / 0.10)));
    em = Math.max(seas, Math.min(em, 0.17));
  }
  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em > .58 ? 9 : em > .40 ? 8 : em > .14 ? 12 : 13;
  if (t < .85) return em > .54 ? 17 : em > .36 ? 15 : em > .16 ? 11 : em > .09 ? 14 : 13;
  return em > .56 ? 10 : em > .38 ? 15 : em > .16 ? 11 : em > .09 ? 12 : 13;
}
const MCLS = b => b === 5 ? "ICE" : [13, 18, 14].includes(b) ? "DRY"
  : [12, 11].includes(b) ? "GRASS" : [8, 9, 10, 15, 17].includes(b) ? "FOREST"
  : b === 4 ? "TUNDRA" : "BOREAL";

// With --real, generate in the observed-climate mode the Earth (Sim) checkbox turns on,
// by handing worldgen the SAME src/realClimateData.js the app injects. Two caveats to
// read the resulting numbers with:
//   * Temperature and moisture are then scored against the data they were built from,
//     so those two are a ROUND-TRIP check (is the unit conversion and resampling
//     faithful?), not a measure of skill. Only the solver run is a real score.
//   * BIOME is still meaningful either way: the truth is Koppen applied to the raw
//     observation, while the model class comes from the sim's own classifier applied to
//     the converted fields. It measures how well the conversion plus that classifier
//     reproduce Koppen — which is the honest ceiling of the observed mode.
// Real WIND is not injected here (its loader has no Node entry point); under --real the
// wind is solved. That does not touch the scored fields, which are overwritten wholesale.
const REAL = process.argv.includes("--real");
let fns = null;
if (REAL) {
  const rc = await import("../src/realClimateData.js");
  rc.provideRealClimateData(PR, TA);
  fns = { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate };
}
console.error(`[gen] ${W}x${H}${REAL ? " (observed climate)" : ""} ...`);
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, REAL, {}, fns);
const STEP = Math.max(1, Math.round(W / 360));
const pts = [];
for (let y = 0; y < H; y += STEP) {
  const la = 90 - (y + 0.5) / H * 180;
  if (Math.abs(la) > 82) continue;
  for (let x = 0; x < W; x += STEP) {
    const i = y * W + x; if (w.elevation[i] <= 0) continue;
    const lo = (x + 0.5) / W * 360 - 180;
    const o = obs(la, lo); if (!o) continue;
    pts.push({ la, lo, o,
      mT: (w.temperature[i] - 0.6) * 100,
      oT: o.t.reduce((a, b) => a + b, 0) / 12,
      mM: w.moisture[i],
      oP: o.p.reduce((a, b) => a + b, 0),
      mC: MCLS(bio(w.elevation[i], w.moisture[i], w.temperature[i], w.dryFrac ? w.dryFrac[i] : 0)),
      oC: KCLS[koppen(o.p, o.t)] });
  }
}
console.log(`\n${pts.length.toLocaleString()} land points vs NCEP observation  (${W}x${H})\n`);

// 1. temperature
let sae = 0, sb = 0;
for (const p of pts) { sae += Math.abs(p.mT - p.oT); sb += p.mT - p.oT; }
console.log(`TEMPERATURE   mean |error| ${(sae / pts.length).toFixed(2)}°C   bias ${(sb / pts.length >= 0 ? '+' : '')}${(sb / pts.length).toFixed(2)}°C   (all land)`);
// The global figure is dominated by Antarctica, where the model deliberately
// over-cools AND the reanalysis is least trustworthy. Report the rest separately so
// one hard, biome-irrelevant region does not hide the temperate/boreal picture.
{
  const nz = pts.filter(p => Math.abs(p.la) <= 60);
  let a = 0, b = 0; for (const p of nz) { a += Math.abs(p.mT - p.oT); b += p.mT - p.oT; }
  console.log(`              mean |error| ${(a / nz.length).toFixed(2)}°C   bias ${(b / nz.length >= 0 ? '+' : '')}${(b / nz.length).toFixed(2)}°C   (|lat| <= 60)`);
}

// 2. moisture ordering
function spearman(a, b) {
  const rank = v => { const s = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length);
    for (let k = 0; k < s.length;) { let e = k; while (e < s.length && s[e][0] === s[k][0]) e++;
      const avg = (k + e - 1) / 2; for (let z = k; z < e; z++) r[s[z][1]] = avg; k = e; } return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  const ma = ra.reduce((x, y) => x + y, 0) / n, mb = rb.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db);
}
console.log(`MOISTURE      Spearman rank correlation ${spearman(pts.map(p => p.mM), pts.map(p => p.oP)).toFixed(3)}`);

// 3. biome vs derived Koppen
const CLS = ["FOREST", "GRASS", "DRY", "BOREAL", "TUNDRA", "ICE"];
const conf = {}; CLS.forEach(a => { conf[a] = {}; CLS.forEach(b => conf[a][b] = 0); });
let hit = 0;
for (const p of pts) { if (!conf[p.oC] || !conf[p.oC][p.mC] === undefined) continue;
  conf[p.oC][p.mC]++; if (p.oC === p.mC) hit++; }
console.log(`BIOME         agreement with Koppen-derived truth: ${(100 * hit / pts.length).toFixed(1)}%\n`);
console.log("CONFUSION MATRIX  (rows = observed Koppen, cols = model)  % of all land");
console.log("  observed \\ model   " + CLS.map(c => c.slice(0, 6).padStart(7)).join(""));
for (const a of CLS) {
  const row = CLS.map(b => (100 * conf[a][b] / pts.length).toFixed(1).padStart(7)).join("");
  const tot = CLS.reduce((s, b) => s + conf[a][b], 0);
  console.log(`  ${a.padEnd(18)}${row}   | ${(100 * tot / pts.length).toFixed(1)}% of land`);
}
console.log("  " + " ".repeat(18) + CLS.map(b => {
  const tot = CLS.reduce((s, a) => s + conf[a][b], 0);
  return (100 * tot / pts.length).toFixed(1).padStart(7); }).join("") + "   | model totals");

// biggest single confusions
const pairs = [];
for (const a of CLS) for (const b of CLS) if (a !== b && conf[a][b]) pairs.push([a, b, conf[a][b]]);
pairs.sort((x, y) => y[2] - x[2]);
console.log("\nBIGGEST CONFUSIONS");
for (const [a, b, n] of pairs.slice(0, 6))
  console.log(`  observed ${a.padEnd(7)} -> model ${b.padEnd(7)} ${(100 * n / pts.length).toFixed(1)}% of land`);

// ── 4. SKILL vs a world made of stripes ────────────────────────────────────
// An absolute score is uninterpretable on its own: 60% biome agreement reads like a
// passing grade until you learn what a model with NO geography scores. So build the
// null model — every land point predicts the OBSERVED zonal mean over land in its
// own 2 degree band — and score it identically. It is deliberately a hard baseline: it
// is handed the real answer for each latitude and is blind only to longitude, and
// for biome it feeds real mm and degC through the SAME koppen() used to make the
// truth, so its classifier error is zero where the model's is not. Beating it means
// the continents, mountains and monsoons are earning their keep.
{
  const bands = new Map();
  for (const p of pts) {
    const b = Math.round(p.la / 2) * 2;
    if (!bands.has(b)) bands.set(b, { p: new Array(12).fill(0), t: new Array(12).fill(0), n: 0 });
    const z = bands.get(b);
    for (let m = 0; m < 12; m++) { z.p[m] += p.o.p[m]; z.t[m] += p.o.t[m]; }
    z.n++;
  }
  for (const z of bands.values()) for (let m = 0; m < 12; m++) { z.p[m] /= z.n; z.t[m] /= z.n; }
  let sae = 0, s60 = 0, n60 = 0, nhit = 0; const zp = [];
  for (const p of pts) {
    const z = bands.get(Math.round(p.la / 2) * 2);
    const zT = z.t.reduce((a, b) => a + b, 0) / 12;
    sae += Math.abs(zT - p.oT);
    if (Math.abs(p.la) <= 60) { s60 += Math.abs(zT - p.oT); n60++; }
    zp.push(z.p.reduce((a, b) => a + b, 0));
    if (KCLS[koppen(z.p, z.t)] === p.oC) nhit++;
  }
  console.log("\nNULL MODEL — observed zonal mean (a world of stripes; no geography)");
  console.log(`  TEMPERATURE  |error| ${(sae / pts.length).toFixed(2)}°C all land, ${(s60 / n60).toFixed(2)}°C at |lat|<=60`);
  console.log(`  MOISTURE     Spearman ${spearman(zp, pts.map(p => p.oP)).toFixed(3)}`);
  console.log(`  BIOME        agreement ${(100 * nhit / pts.length).toFixed(1)}%`);

  // Strip each field of its OWN zonal mean and correlate the remainder. Latitude is
  // free; this is the part geography has to earn, and the only honest measure of
  // whether the solver puts wet and warm in the right LONGITUDES.
  const mz = new Map();
  for (const p of pts) {
    const b = Math.round(p.la / 2) * 2;
    if (!mz.has(b)) mz.set(b, { mM: 0, oP: 0, mT: 0, oT: 0, n: 0 });
    const z = mz.get(b); z.mM += p.mM; z.oP += p.oP; z.mT += p.mT; z.oT += p.oT; z.n++;
  }
  for (const z of mz.values()) { z.mM /= z.n; z.oP /= z.n; z.mT /= z.n; z.oT /= z.n; }
  const aTm = [], aTo = [], aM = [], aO = [];
  for (const p of pts) {
    const z = mz.get(Math.round(p.la / 2) * 2);
    aTm.push(p.mT - z.mT); aTo.push(p.oT - z.oT);
    aM.push(p.mM - z.mM);  aO.push(p.oP - z.oP);
  }
  console.log("\nANOMALY SKILL — zonal mean removed from BOTH sides (pure longitudinal structure)");
  console.log(`  temperature  Spearman ${spearman(aTm, aTo).toFixed(3)}`);
  console.log(`  moisture     Spearman ${spearman(aM, aO).toFixed(3)}`);
}

// temperature error by latitude band
console.log("\nTEMPERATURE ERROR BY LATITUDE");
for (let b = 70; b >= -60; b -= 20) {
  const sel = pts.filter(p => p.la >= b - 20 && p.la < b);
  if (sel.length < 30) continue;
  const e = sel.reduce((s, p) => s + (p.mT - p.oT), 0) / sel.length;
  const ae = sel.reduce((s, p) => s + Math.abs(p.mT - p.oT), 0) / sel.length;
  console.log(`  ${String(b - 20).padStart(4)}..${String(b).padStart(3)}   bias ${(e >= 0 ? '+' : '') + e.toFixed(1).padStart(5)}°C   |err| ${ae.toFixed(1)}°C   (n=${sel.length})`);
}
