// Cause IV instrument: do REALM-REALM borders lie on geography? For every
// adjacent pair of tiles with different realm owners, classify the border
// edge: RIVER (either side carries a major channel), RIDGE (relief high on
// either side), or PLAIN — and compare against the base rate over ALL land
// adjacencies. Real maps are strongly enriched; a cost-bisector map is not.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_borderfeat.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
const STEPS = +(process.argv[2] || 24000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
const co = world._countryOwner, elev = world.elev, rm = world.riverMag, rel = world.relief, tw = world.tw, th = world.th;
const RIV = 2, RID = 0.25;   // major-channel bar; the measured Himalaya-front relief class
let bT = 0, bR = 0, bG = 0, aT = 0, aR = 0, aG = 0;
for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
  const i = y * tw + x;
  if (!(elev[i] > 0)) continue;
  for (const j of [y * tw + ((x + 1) % tw), y < th - 1 ? i + tw : -1]) {
    if (j < 0 || !(elev[j] > 0)) continue;
    const river = (rm && (rm[i] >= RIV || rm[j] >= RIV)) ? 1 : 0;
    const ridge = (rel && (rel[i] >= RID || rel[j] >= RID)) ? 1 : 0;
    aT++; aR += river; aG += ridge;
    if (co[i] >= 0 && co[j] >= 0 && co[i] !== co[j]) { bT++; bR += river; bG += ridge; }
  }
}
const f = (n, d) => (100 * n / Math.max(1, d)).toFixed(1);
console.log(`[borderfeat] step ${STEPS} borderEdges=${bT}`);
console.log(`  river: ${f(bR, bT)}% of borders vs ${f(aR, aT)}% of all land edges → enrichment ${(bR / Math.max(1, bT) / (aR / aT)).toFixed(2)}x`);
console.log(`  ridge: ${f(bG, bT)}% of borders vs ${f(aG, aT)}% of all land edges → enrichment ${(bG / Math.max(1, bT) / (aG / aT)).toFixed(2)}x`);
