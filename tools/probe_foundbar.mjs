// THE FOUNDING-BAR MAP — what margin does the per-basin lean law actually
// charge, region by region? (2026-08-25, the owner's play report: "not even a
// single CITY spawns in the egypt middle east area" while India/Caspian/
// Pontic "look GREAT".)
//
// leanAt reads cv at the SITE TILE. The probe's own recorded lesson (it.5)
// was that the fert mask is max-pooled — a tile beside the Nile carries the
// valley's fert while its point-sampled climate is desert (cv ~0.45+) — and
// at cv ≥ 0.343 the margin clamps at 5×. If seats land on such ghosts, the
// law prices the RIBBON's cities at the DESERT's margin. This measures, over
// each region's cropland: the distribution of founding margins as leanAt
// reads them (point), and as a fert-weighted 3×3 basin read would (the same
// convention as the channel term and the probe verdicts).
//
//   node tools/probe_foundbar.mjs [W=960] [seed=8817] [--real]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { ensureYieldCv } from "../src/sim/peopleSim/harvest.js";

const args = process.argv.slice(2).filter(a => a !== "--real");
const REAL = process.argv.includes("--real");
const W = +(args[0] || 960), H = W >> 1, SEED = +(args[1] || 8817);
let world;
if (REAL) {
  const rc = await import("../src/realClimateData.js");
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
  rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
  world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
} else world = buildSim({ W, H, seed: SEED });

const TW = world.tw, TH = world.th;
const cv = ensureYieldCv(world);
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const marginOf = (c) => 1 / Math.max(0.2, 1 - 2.33 * c);
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

// fert-weighted 3×3 basin cv (the candidate fix's read)
function basinCv(tx, ty) {
  let sw = 0, s = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= TH) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const i = yy * TW + (((tx + dx) % TW) + TW) % TW;
      if (world.elev[i] <= 0) continue;
      const f = world.fert ? world.fert[i] : 0;
      if (!(f > 0)) continue;
      sw += f; s += f * cv[i];
    }
  }
  const i0 = ty * TW + tx;
  return sw > 0 ? s / sw : cv[i0];
}

const R = [
  { k: "Nile valley",  lon: [30, 33],   lat: [22, 31] },
  { k: "Mesopotamia",  lon: [38, 48],   lat: [29, 37] },
  { k: "Levant",       lon: [34, 38],   lat: [31, 37] },
  { k: "India/Ganges", lon: [72, 88],   lat: [20, 30] },
  { k: "Pontic",       lon: [30, 48],   lat: [45, 49] },
  { k: "Caspian W",    lon: [40, 52],   lat: [38, 44] },
  { k: "England",      lon: [-5, 5],    lat: [46, 55] },
];
console.log(`\n=== FOUNDING-BAR MAP  ${W} (tw=${TW})  ${REAL ? "OBSERVED" : "SOLVER"} ===`);
console.log(`  region        crop   POINT margin p10/p50/p90  @5×clamp%   BASIN(f3×3) p10/p50/p90  @5×%   topfert-decile point/basin`);
for (const r of R) {
  const mp = [], mb = [], top = [];
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (world.elev[i] <= 0 || !(world.fert && world.fert[i] > 0.15)) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    mp.push(marginOf(cv[i]));
    mb.push(marginOf(basinCv(tx, ty)));
    top.push([world.fert[i], marginOf(cv[i]), marginOf(basinCv(tx, ty))]);
  }
  if (!mp.length) { console.log(`  ${r.k.padEnd(12)} (no cropland)`); continue; }
  const clampP = Math.round(100 * mp.filter(v => v >= 4.99).length / mp.length);
  const clampB = Math.round(100 * mb.filter(v => v >= 4.99).length / mb.length);
  // seats land on the densest/most fertile tiles: the top fert decile's margin
  top.sort((a, b) => b[0] - a[0]);
  const td = top.slice(0, Math.max(1, top.length / 10 | 0));
  const tdp = q(td.map(t => t[1]), .5), tdb = q(td.map(t => t[2]), .5);
  console.log(`  ${r.k.padEnd(12)} ${String(mp.length).padStart(5)}  ${q(mp, .1).toFixed(2)}/${q(mp, .5).toFixed(2)}/${q(mp, .9).toFixed(2)}        ${String(clampP).padStart(3)}%      ${q(mb, .1).toFixed(2)}/${q(mb, .5).toFixed(2)}/${q(mb, .9).toFixed(2)}      ${String(clampB).padStart(3)}%       ${tdp.toFixed(2)} / ${tdb.toFixed(2)}`);
}
console.log(`\n  READ: a founding lane can only mint where the margin is payable (~≤3×). If the`);
console.log(`  top-fert (seat-class) tiles read 5× at the POINT but ~2× at the BASIN, the law`);
console.log(`  is pricing the ribbon's cities at the desert's margin — the ghost-tile bug.`);
