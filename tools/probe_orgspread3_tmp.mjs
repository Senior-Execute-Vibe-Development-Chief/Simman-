import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techEff } from "../src/sim/peopleSim/settlement.js";
import { reachBudget } from "../src/sim/peopleSim/territory.js";
const STEPS = +(process.argv[2] || 30000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
// probe_consol's own quantile convention (floor, not round)
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const CK = +(process.env.CK || 10000);
for (let step = 0; step <= STEPS; step++) {
  if (step > 0) stepPeopleSim(world);
  if (step % CK === 0 && step > 0) {
    const caps = [];
    if (world.countries) for (const c of world.countries.values()) if (c.capital) caps.push(techEff(c.capital).reachLevel || 0);
    const ss = world.settlements.filter((s) => s.mode === "settled");
    const rl = ss.map((s) => (s._techEff ? s._techEff.reachLevel : 0));
    const rb = ss.map((s) => reachBudget(s));
    console.log(`step ${step} states=${caps.length} settled=${ss.length}`);
    if (caps.length) console.log(`  CAPITAL reachLevel p50=${q(caps,.5).toFixed(3)} p67=${q(caps,.67).toFixed(3)} p90=${q(caps,.9).toFixed(3)} (p90-p50 spread ${(q(caps,.9)-q(caps,.5)).toFixed(3)}) | min=${Math.min(...caps).toFixed(3)} max=${Math.max(...caps).toFixed(3)} FULL range=${(Math.max(...caps)-Math.min(...caps)).toFixed(3)}`);
    console.log(`  ALL reachLevel p10=${q(rl,.1).toFixed(3)} p50=${q(rl,.5).toFixed(3)} p90=${q(rl,.9).toFixed(3)} min=${Math.min(...rl).toFixed(3)} max=${Math.max(...rl).toFixed(3)}`);
    console.log(`  ALL reachBudget min=${Math.min(...rb).toFixed(3)} p10=${q(rb,.1).toFixed(3)} p50=${q(rb,.5).toFixed(3)} p90=${q(rb,.9).toFixed(3)} max=${Math.max(...rb).toFixed(3)} (max/min=${(Math.max(...rb)/Math.min(...rb)).toFixed(3)})`);
  }
}
