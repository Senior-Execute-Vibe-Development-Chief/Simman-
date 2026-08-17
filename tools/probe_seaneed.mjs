// SEA_DEMAND attribution: does the sea's demand signal EXIST? probe_colonial
// measured navMax 0.60 at 45k — the galleys gate five millennia late, the
// ocean gate (0.88) unreachable — barely better than the pre-wave 0.57@50k.
// needSea = 1 + II·max(0, dear−1) reads the port's own market prices; if
// waterside prices are never dear the term is structurally inert (≈1) and
// SEA_DEMAND changed nothing. Compare against needMetal from the SAME price
// array at the same checkpoints: if forges routinely see needMetal ≫ 1 while
// ports see needSea ≈ 1, the demand asymmetry is confirmed and the gap is in
// WHAT the sea trade prices, not in the learning law.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_seaneed.mjs [steps] [W] [seed] [ivl]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { G_STAPLE, G_MATERIALS, G_METAL } from "../src/sim/peopleSim/goods.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const IVL = +(process.argv[5] || 5000);
const world = buildSim({ W, H, seed: SEED });

const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, (p * s.length) | 0)]; };

function report(step) {
  const needSea = [], needMet = [], navs = [];
  let ports = 0, portsPriced = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const gp = s._gPrice;
    const nm = gp ? 1 + T.INDUCED_INNOV * Math.max(0, (gp[G_METAL] || 0) - 1) : 1;
    needMet.push(nm);
    const wa = s.waterAccess || 0;
    if (wa > 0) {
      ports++;
      if (gp) {
        portsPriced++;
        const dear = Math.max(gp[G_STAPLE] || 0, gp[G_MATERIALS] || 0, gp[G_METAL] || 0);
        needSea.push(1 + T.INDUCED_INNOV * Math.max(0, dear - 1));
      } else needSea.push(1);
      navs.push((s.knowledge && s.knowledge.navigation) || 0);
    }
  }
  console.log(`t=${step} ports=${ports}(priced ${portsPriced}) ` +
    `needSea p50=${q(needSea, 0.5).toFixed(2)} p90=${q(needSea, 0.9).toFixed(2)} max=${q(needSea, 1).toFixed(2)} | ` +
    `needMetal p50=${q(needMet, 0.5).toFixed(2)} p90=${q(needMet, 0.9).toFixed(2)} max=${q(needMet, 1).toFixed(2)} | ` +
    `nav p90=${q(navs, 0.9).toFixed(2)} max=${q(navs, 1).toFixed(2)}`);
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % IVL === 0) report(s);
}
