// Does the "white man's grave" settler barrier emerge? For every settlement founded from afar
// (an incomer parent), measure how much of its deep ancestral stock is the LOCAL substrate vs
// the founders'. The barrier predicts: on a tropical-disease frontier the LOCAL stock should
// survive (high local share — bootload), while a temperate frontier is taken by the founders
// (low local share — replacement). Split the founded settlements by the tile's malaria signal.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { malariaSignal } from "../src/sim/peopleSim/habitability.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const byId = world._byId;
// For each frontier settlement founded from afar, classify by the DISEASE-BURDEN GAP between the
// land it sits on and the FOUNDERS' home. A big gap (a low-immunity outsider into a deadly land)
// is the white-man's-grave case; ~no gap is an adapted neighbour expanding in.
const buckets = { grave: [], nogap: [] };
for (const s of world.settlements) {
  if (s.mode !== "settled" || !s.ancMix || !world.ancestry) continue;
  if (!(s.parentSettlementId >= 0)) continue;
  const par = byId ? byId.get(s.parentSettlementId) : null;
  if (!par) continue;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const pti = (par.pos.y | 0) * world.tw + (par.pos.x | 0);
  const localId = world.ancestry[ti];
  if (!(localId >= 0)) continue;
  const arr = world.tArrival ? world.tArrival[ti] : 0.5;
  if (arr < 0.5) continue;                                          // FRONTIER only — where replacement is actually in play
  const localShare = (s.ancMix.find(([id]) => id === localId) || [0, 0])[1];
  const gap = Math.max(0, malariaSignal(world.temp[ti], world.moist[ti]) - malariaSignal(world.temp[pti], world.moist[pti]));
  (gap > 0.25 ? buckets.grave : buckets.nogap).push(localShare);
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log(`seed ${SEED} · frontier settlements founded from afar: ${buckets.grave.length + buckets.nogap.length}`);
console.log(`  WHITE-MAN'S-GRAVE (low-immunity founder → deadly land, gap>0.25): ${buckets.grave.length} places · mean LOCAL share ${(100 * mean(buckets.grave)).toFixed(0)}%  (high = locals KEPT the land → bootload)`);
console.log(`  NO BARRIER (adapted founder, gap≈0): ${buckets.nogap.length} places · mean LOCAL share ${(100 * mean(buckets.nogap)).toFixed(0)}%  (low = founders TOOK the land → replacement)`);
