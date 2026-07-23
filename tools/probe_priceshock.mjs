// Price-shock propagation demo (goods-vector): sack the world's biggest
// LUXURY exporter mid-run and watch the shock travel — its own prices, its
// direct partners' prices, and second-ring settlements', before vs after.
// Luxury supply takes the sack penalty SQUARED (settlement.js computeLuxury),
// so the supply crater is sharp and the wave legible. Demonstrates that
// shocks propagate through the price system with distance decay — nothing
// scripted, just the sack penalty flowing through supply → price → trade.
//
//   SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1,GOODS_PRICES=1,GOODS_TRADE=1,GOODS_CHAIN=1" \
//     node tools/probe_priceshock.mjs [warmup] [after] [seed] [W] [H]
//   defaults: 12000 warmup, 3000 after, seed 8817, 480x240

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { GOODS, G_LUXURY } from "../src/sim/peopleSim/goods.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const WARM = parseInt(process.argv[2] || "12000", 10);
const AFTER = parseInt(process.argv[3] || "3000", 10);
const SEED = parseInt(process.argv[4] || "8817", 10);
const W = parseInt(process.argv[5] || "480", 10);
const H = parseInt(process.argv[6] || "240", 10);

if (!T.GOODS_PRICES) { console.error("Run with SIM_TUNE enabling GOODS_PRICES (+GOODS_TRADE for propagation)."); process.exit(1); }

const world = buildSim({ W, H, seed: SEED });
console.log(`price-shock demo ${W}x${H} seed=${SEED}: warmup ${WARM}, shock, +${AFTER}`);
for (let i = 1; i <= WARM; i++) stepPeopleSim(world, 1);

// The biggest luxury producer with partners.
const setts = world.settlements.filter((s) => s.mode === "settled" && s._gPrice);
const victim = [...setts].sort((a, b) => (b._luxSupply || 0) - (a._luxSupply || 0))[0];
if (!victim) { console.error("no luxury producer found"); process.exit(1); }
const ring1 = new Set(victim._tradeReach ? [...victim._tradeReach.keys()] : []);
const ring2 = new Set();
for (const pid of ring1) {
  const p = setts.find((s) => s.id === pid);
  if (p && p._tradeReach) for (const q of p._tradeReach.keys()) if (q !== victim.id && !ring1.has(q)) ring2.add(q);
}
const byId = new Map(setts.map((s) => [s.id, s]));
const meanLux = (ids) => {
  let sum = 0, n = 0;
  for (const id of ids) { const s = byId.get(id); if (s && s.mode === "settled" && s._gPrice) { sum += s._gPrice[G_LUXURY]; n++; } }
  return n ? sum / n : NaN;
};
const p0v = victim._gPrice[G_LUXURY], p0r1 = meanLux(ring1), p0r2 = meanLux(ring2);
console.log(`victim: ${victim.name} (${Math.round(victim.people)} ppl, luxSupply ${(victim._luxSupply || 0).toFixed(1)}, ${ring1.size} partners, ${ring2.size} second-ring)`);
console.log(`before:  victim ${GOODS[G_LUXURY]} ${p0v.toFixed(2)}   ring1 ${p0r1.toFixed(2)}   ring2 ${p0r2.toFixed(2)}`);

victim._sackedAt = world.step;   // the shock: a sack craters skilled output (luxury takes it squared)
const CHECK = [250, 500, 1000, 2000, AFTER];
let done = 0;
for (let i = 1; i <= AFTER; i++) {
  stepPeopleSim(world, 1);
  if (i === CHECK[done]) {
    console.log(`+${String(i).padStart(5)}:  victim ${victim._gPrice[G_LUXURY].toFixed(2)}   ring1 ${meanLux(ring1).toFixed(2)}   ring2 ${meanLux(ring2).toFixed(2)}`);
    done++;
  }
}
const dV = victim._gPrice[G_LUXURY] - p0v, d1 = meanLux(ring1) - p0r1, d2 = meanLux(ring2) - p0r2;
console.log(`\nshock Δ after ${AFTER}: victim ${dV >= 0 ? "+" : ""}${dV.toFixed(2)}   ring1 ${d1 >= 0 ? "+" : ""}${d1.toFixed(2)}   ring2 ${d2 >= 0 ? "+" : ""}${d2.toFixed(2)}`);
console.log(`(expected shape: victim spikes hardest, ring1 less, ring2 least — distance decay through trade)`);
