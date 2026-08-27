// THROWAWAY probe (claim verification 2026-08-27): measure the SPREAD of the
// quantities that set economic reach — knowledge.organization, techEff.reachLevel,
// and reachBudget itself — across settled settlements, at checkpoints.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { reachBudget } from "../src/sim/peopleSim/territory.js";
import { rNormPop } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 12000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const q = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]; };
const st = (a) => {
  if (!a.length) return "n=0";
  const n = a.length, mean = a.reduce((x, y) => x + y, 0) / n;
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - mean) ** 2, 0) / n);
  return `n=${n} min=${Math.min(...a).toFixed(5)} p10=${q(a,0.1).toFixed(5)} p50=${q(a,0.5).toFixed(5)} p90=${q(a,0.9).toFixed(5)} max=${Math.max(...a).toFixed(5)} mean=${mean.toFixed(5)} sd=${sd.toFixed(6)} range=${(Math.max(...a)-Math.min(...a)).toFixed(6)} cv=${(sd/Math.max(1e-12,mean)).toFixed(4)}`;
};
const CK = +(process.env.CK || 2000);
for (let step = 0; step <= STEPS; step++) {
  if (step > 0) stepPeopleSim(world);
  if (step % CK === 0) {
    const ss = world.settlements.filter((s) => s.mode === "settled");
    const org = ss.map((s) => (s.knowledge && s.knowledge.organization) || 0);
    const rl = ss.map((s) => (s._techEff ? s._techEff.reachLevel : ((s.knowledge && s.knowledge.organization) || 0)));
    const rb = ss.map((s) => reachBudget(s));
    const rbn = rb.map((v) => v * rNormPop(world));
    console.log(`--- step ${step} (tw=${world.tw})`);
    console.log(`  organization  ${st(org)}`);
    console.log(`  reachLevel    ${st(rl)}`);
    console.log(`  reachBudget   ${st(rb)}`);
    console.log(`  budget×rNorm  ${st(rbn)}`);
  }
}
