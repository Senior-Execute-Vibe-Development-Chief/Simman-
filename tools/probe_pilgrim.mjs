// Pilgrimage-economy probe: measures holy-see wealth concentration — the
// watch-list pathology (one see holding ~50% of world wealth in some seeds).
//   node tools/probe_pilgrim.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { IN_PILGRIM } from "../src/sim/peopleSim/money.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "4242", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const world = buildSim({ W, H, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const setts = world.settlements.filter((s) => s.mode === "settled");
const totalW = setts.reduce((a, s) => a + Math.max(0, s.wealth || 0), 0);
const top = [...setts].sort((a, b) => (b.wealth || 0) - (a.wealth || 0)).slice(0, 5);
console.log(`pilgrim probe ${W}x${H} seed=${SEED} @${STEPS}: world wealth ${Math.round(totalW)}`);
for (const s of top) {
  const pilgrim = (s._mInRate && s._mInRate[IN_PILGRIM]) || 0;
  console.log(`  ${(s.name || "?").padEnd(16)} $${String(Math.round(s.wealth)).padStart(8)}  (${(100 * (s.wealth || 0) / totalW).toFixed(1).padStart(5)}% of world)  pilgrim income ${pilgrim.toFixed(2)}/tick`);
}
const sees = new Set();
if (world.faiths) for (const f of world.faiths.values()) if ((f.originSettlementId ?? -1) >= 0) sees.add(f.originSettlementId);
const seeW = setts.filter((s) => sees.has(s.id)).reduce((a, s) => a + Math.max(0, s.wealth || 0), 0);
console.log(`holy sees: ${sees.size} · combined ${(100 * seeW / totalW).toFixed(1)}% of world wealth`);
