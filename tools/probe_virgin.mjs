// Does the virgin-soil (Columbian) contact epidemic emerge? Run the sim, then check:
//  (1) endemic disease load DIVERGES — connected landmasses converge high, isolated low (the GAP);
//  (2) "plague.virginSoil" events fire on first sea contact across that gap;
//  (3) the contacted (low-immunity) populations get swept (_contacted + _virginUntil).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
let virginEvents = 0;
const seen = new Set();
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  if (world.events) for (const e of world.events) {
    if (e.type === "plague.virginSoil" && !seen.has(e.id ?? `${e.step}:${e.s}`)) {
      seen.add(e.id ?? `${e.step}:${e.s}`); virginEvents++;
    }
  }
}

const setts = world.settlements.filter(s => s.mode === "settled");
const loads = setts.map(s => s._diseaseLoad || 0).sort((a, b) => a - b);
const q = (f) => loads[Math.min(loads.length - 1, Math.floor(f * loads.length))] || 0;
const contacted = setts.filter(s => s._contacted).length;
const virginActive = setts.filter(s => world.step < (s._virginUntil || 0)).length;

console.log(`seed ${SEED} · ${setts.length} settled places`);
console.log(`disease load  p10=${q(0.1).toFixed(2)}  p50=${q(0.5).toFixed(2)}  p90=${q(0.9).toFixed(2)}  max=${q(0.999).toFixed(2)}`);
console.log(`  gap p90-p10 = ${(q(0.9) - q(0.1)).toFixed(2)}  (>${0.35} = a virgin-soil-capable immunity gap exists)`);
console.log(`virgin-soil epidemic events fired: ${virginEvents}`);
console.log(`settlements ever contacted (swept by a virgin wave): ${contacted}`);
console.log(`settlements with a wave still burning at end: ${virginActive}`);
