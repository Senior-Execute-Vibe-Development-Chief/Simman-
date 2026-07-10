// Credit probe (Phase 5, T.CREDIT_RATE): does bank credit emerge with the banking
// INSTITUTION, concentrate in trade hubs, lever the money supply, and contract in
// busts — without wrecking prices or the food economy?
//   node tools/probe_credit.mjs [seed] [steps] [W] [H]
// A/B: SIM_TUNE="CREDIT_RATE=0" vs default.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techEff, monetization } from "../src/sim/peopleSim/settlement.js";
import { localP } from "../src/sim/peopleSim/inflation.js";

const seed = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "42000", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const CHECK = 3000;

const world = buildSim({ W, H, seed });
let peakCredit = 0, maxDrawdown = 0, lastCredit = 0;

const pct = (arr, p) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };

function report(step) {
  let banks = 0, credit = 0, wealth = 0, pop = 0, alive = 0;
  let top = null;
  const ps = [], mzs = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    alive++; pop += s.people || 0;
    wealth += Math.max(0, s.wealth || 0);
    const c = s._credit || 0; credit += c;
    if (techEff(s).credit) banks++;
    if (!top || c > (top._credit || 0)) top = s;
    ps.push(localP(world, s)); mzs.push(monetization(s));
  }
  peakCredit = Math.max(peakCredit, credit);
  if (credit < lastCredit) maxDrawdown = Math.max(maxDrawdown, lastCredit - credit);
  lastCredit = credit;
  const share = credit / Math.max(1, wealth);
  console.log(`t=${step}: alive=${alive} pop=${(pop / 1000).toFixed(0)}k | banks=${banks} credit=${credit.toFixed(0)} (${(100 * share).toFixed(1)}% of money) | P p50=${pct(ps, 0.5).toFixed(2)} p90=${pct(ps, 0.9).toFixed(2)} | mz p10/50/90=${pct(mzs, 0.1).toFixed(2)}/${pct(mzs, 0.5).toFixed(2)}/${pct(mzs, 0.9).toFixed(2)}`);
  if (top && (top._credit || 0) > 0) console.log(`    top hub: ${top.name} credit=${(top._credit || 0).toFixed(0)} / wealth=${(top.wealth || 0).toFixed(0)} partners=${top._tradeReach ? top._tradeReach.size : 0} org=${((top.knowledge || {}).organization || 0).toFixed(2)}`);
}

for (let s = 0; s < STEPS; s += CHECK) {
  stepPeopleSim(world, Math.min(CHECK, STEPS - s));
  report(Math.min(s + CHECK, STEPS));
}
console.log(`peak credit=${peakCredit.toFixed(0)}, max checkpoint drawdown=${maxDrawdown.toFixed(0)} (busts contract the supply)`);
