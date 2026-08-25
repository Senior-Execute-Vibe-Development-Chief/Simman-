// Quick read: does world.tFlood (the pipeline's arid-river floodplain mask) cover
// the Nile/Mesopotamia CROPLAND the yield-CV map's 3×3 channel read keeps missing?
//   node tools/probe_floodmask.mjs [W=480] [seed=8817] [--real]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";

const args = process.argv.slice(2).filter(a => a !== "--real");
const REAL = process.argv.includes("--real");
const W = +(args[0] || 480), H = W >> 1, SEED = +(args[1] || 8817);
let world;
if (REAL) {
  const rc = await import("../src/realClimateData.js");
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
  rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
  world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
} else world = buildSim({ W, H, seed: SEED });

const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const R = [
  { k: "Nile valley", lon: [30, 33], lat: [22, 31] },
  { k: "Mesopotamia", lon: [44, 48], lat: [30, 34] },
  { k: "Ganges",      lon: [77, 88], lat: [22, 28] },
  { k: "Indus",       lon: [67, 74], lat: [24, 32] },
];
console.log(`tFlood over cropland (fert>0.15), ${W} ${REAL ? "OBSERVED" : "SOLVER"}:`);
for (const r of R) {
  let crop = 0, flood = 0, chan3 = 0;
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (world.elev[i] <= 0 || !(world.fert && world.fert[i] > 0.15)) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    crop++;
    if (world.tFlood && world.tFlood[i]) flood++;
    let ch = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = ty + dy; if (yy < 0 || yy >= TH) continue;
      for (let dx = -1; dx <= 1; dx++) { const v = world.riverMag ? world.riverMag[yy * TW + (((tx + dx) % TW) + TW) % TW] : 0; if (v > ch) ch = v; } }
    if (ch >= 3) chan3++;
  }
  console.log(`  ${r.k.padEnd(12)} cropland ${String(crop).padStart(4)}   tFlood ${String(flood).padStart(4)} (${crop ? Math.round(100 * flood / crop) : 0}%)   chan3x3>=3 ${String(chan3).padStart(4)} (${crop ? Math.round(100 * chan3 / crop) : 0}%)`);
}

// river-mag census over a wider Fertile Crescent window (all land, not just cropland)
{
  const r = { lon: [38, 49], lat: [29, 38] };
  const cnt = [0, 0, 0, 0, 0, 0];
  let floodAll = 0;
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (world.elev[i] <= 0) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    cnt[Math.min(5, world.riverMag ? world.riverMag[i] : 0)]++;
    if (world.tFlood && world.tFlood[i]) floodAll++;
  }
  console.log(`  Fertile Crescent window 38-49E/29-38N riverMag census 0..5+: ${cnt.join("/")}   tFlood tiles ${floodAll}`);
}
