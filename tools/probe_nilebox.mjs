// Per-tile dump of the Nile / Mesopotamia CV-probe boxes: where does each
// cropland tile's fert come from, and what does the CV formula see there?
//   node tools/probe_nilebox.mjs [W=480] [seed=8817] [--real]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { demand } from "../src/sim/biomeClass.js";

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
for (const r of [
  { k: "Nile valley", lon: [30, 33], lat: [22, 31] },
  { k: "Mesopotamia", lon: [44, 48], lat: [30, 34] },
]) {
  console.log(`\n${r.k} (${REAL ? "OBSERVED" : "SOLVER"} ${W}) — cropland tiles (fert>0.15):`);
  console.log(`  lon    lat    fert  moist  em    flood chan  coast`);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const i = ty * TW + tx;
    if (world.elev[i] <= 0 || !(world.fert && world.fert[i] > 0.15)) continue;
    const lo = lonOf(tx), la = latOf(ty);
    if (lo < r.lon[0] || lo > r.lon[1] || la < r.lat[0] || la > r.lat[1]) continue;
    let ch = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = ty + dy; if (yy < 0 || yy >= TH) continue;
      for (let dx = -1; dx <= 1; dx++) { const v = world.riverMag ? world.riverMag[yy * TW + (((tx + dx) % TW) + TW) % TW] : 0; if (v > ch) ch = v; } }
    console.log(`  ${lo.toFixed(1).padStart(5)} ${la.toFixed(1).padStart(5)}  ${world.fert[i].toFixed(2)}  ${world.moist[i].toFixed(2)}   ${(world.moist[i] / demand(world.temp[i])).toFixed(2)}  ${world.tFlood ? world.tFlood[i] : 0}     ${ch}     ${world.coast[i]}`);
  }
}
