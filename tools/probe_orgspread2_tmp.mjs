import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { reachBudget } from "../src/sim/peopleSim/territory.js";

const STEPS = +(process.argv[2] || 24000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]; };
const CK = +(process.env.CK || 6000);
for (let step = 0; step <= STEPS; step++) {
  if (step > 0) stepPeopleSim(world);
  if (step % CK === 0 && step > 0) {
    const ss = world.settlements.filter((s) => s.mode === "settled");
    if (!ss.length) continue;
    const rb = ss.map((s) => reachBudget(s));
    const rl = ss.map((s) => (s._techEff ? s._techEff.reachLevel : 0));
    const uniq = new Map(); for (const v of rb) uniq.set(v.toFixed(6), (uniq.get(v.toFixed(6)) || 0) + 1);
    const modeN = Math.max(...uniq.values());
    const iqrRB = q(rb, 0.75) - q(rb, 0.25);
    const iqrRL = q(rl, 0.75) - q(rl, 0.25);
    // "pack": settlements whose country has >= 2 members — spread WITHIN each country
    const byC = new Map();
    for (const s of ss) { if (s.countryId >= 0) { let a = byC.get(s.countryId); if (!a) byC.set(s.countryId, a = []); a.push(s); } }
    const inRealmRanges = [];
    for (const [, arr] of byC) if (arr.length >= 2) { const v = arr.map(reachBudget); inRealmRanges.push(Math.max(...v) - Math.min(...v)); }
    console.log(`step ${step} tw=${world.tw} n=${ss.length}`);
    console.log(`  reachLevel  p25=${q(rl,0.25).toFixed(5)} p50=${q(rl,0.5).toFixed(5)} p75=${q(rl,0.75).toFixed(5)} IQR=${iqrRL.toFixed(6)}`);
    console.log(`  reachBudget p25=${q(rb,0.25).toFixed(5)} p50=${q(rb,0.5).toFixed(5)} p75=${q(rb,0.75).toFixed(5)} IQR=${iqrRB.toFixed(6)}  distinct=${uniq.size} modeShare=${(modeN/ss.length*100).toFixed(0)}%`);
    if (inRealmRanges.length) console.log(`  within-realm reachBudget range: median=${q(inRealmRanges,0.5).toFixed(6)} max=${Math.max(...inRealmRanges).toFixed(6)} (realms>=2 members: ${inRealmRanges.length})`);
  }
}
