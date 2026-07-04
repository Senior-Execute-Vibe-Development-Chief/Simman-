// G-equivalence probe (W6-G item 5). world._dt = 1/G runs the SAME emergent
// history over G× more ticks in finer increments — so at a matched HISTORY-TIME
// (h = step/G) the AGGREGATE state (population, development, wealth, polity count)
// should TRACK between G=1 and G=4, even though the per-tick RNG stream differs
// (G=4 draws G× more per history-unit, so equivalence is statistical, not bitwise).
// FINDING (measured, seeds 8817/31337/4242): the DEVELOPMENT signal (leadOrg —
// smooth, self-averaging) is G-invariant (≤~4%, mostly ≤1%), because the growth/
// decay mechanics are exact-exponential (Math.exp(rate·dt)). The MAGNITUDES
// (pop/wealth/polity count) are NOT: they wander 20–40% with the SIGN flipping by
// seed (8817 +, 31337/4242 −), i.e. changing G perturbs the RNG stream and the
// chaotic system amplifies it like a seed change — NOT a fixable unscaled rate.
// So "the SAME emergent history unfolds at higher G" is true of the SHAPE, not the
// exact magnitudes. This probe therefore GATES on development and reports the
// magnitudes as informational. Exit non-zero if development diverges (⇒ hunt an
// unscaled per-tick site: a rate without ×_dt, or a per-tick event not compounded).
//   node tools/probe_gequiv.mjs [Hmax] [seed] [W] [H] [Ghi]   (exit 0 = dev tracks)
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const HMAX = parseInt(process.argv[2] || "4000", 10);   // history-time span
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "256", 10);
const H = parseInt(process.argv[5] || "128", 10);
const GHI = parseInt(process.argv[6] || "4", 10);
const CPS = [Math.round(HMAX * 0.125), Math.round(HMAX * 0.25), Math.round(HMAX * 0.5), Math.round(HMAX * 0.75), HMAX];

function sample(w) {
  const st = peopleSimStats(w);
  return {
    pop: st.totalPeople || 0,
    wealth: st.totalWealth || 0,
    setts: st.settlements || 0,
    countries: st.countries || 0,
    leadOrg: w._leadOrg || 0,
  };
}

function runAt(G) {
  T.SIM_GRANULARITY = G;
  const w = buildSim({ W, H, seed: SEED });
  const out = [];
  for (const h of CPS) {
    const target = h * G;               // history-time h ⇒ step = h*G
    stepPeopleSim(w, target - w.step);
    out.push({ h, ...sample(w) });
  }
  return out;
}

const a = runAt(1);
const b = runAt(GHI);
const pct = (x, y) => { const d = Math.max(Math.abs(x), Math.abs(y), 1e-9); return (100 * (y - x) / d); };

console.log(`\nG-equivalence  seed=${SEED}  ${W}x${H}  G=1 vs G=${GHI}   (Δ% = (G${GHI}-G1)/max, + means G${GHI} higher)`);
console.log(`  h      pop(G1→G${GHI})            Δ%      leadOrg           Δ%     countries    Δ%     wealth          Δ%`);
let worst = 0;
for (let i = 0; i < CPS.length; i++) {
  const x = a[i], y = b[i];
  const dPop = pct(x.pop, y.pop), dOrg = pct(x.leadOrg, y.leadOrg), dCty = pct(x.countries, y.countries), dW = pct(x.wealth, y.wealth);
  worst = Math.max(worst, Math.abs(dPop), Math.abs(dOrg), Math.abs(dW));
  console.log(
    `  ${String(x.h).padStart(5)}  ${x.pop.toFixed(0).padStart(9)}→${y.pop.toFixed(0).padStart(9)}  ${dPop.toFixed(1).padStart(6)}   ` +
    `${x.leadOrg.toFixed(3)}→${y.leadOrg.toFixed(3)}  ${dOrg.toFixed(1).padStart(5)}   ` +
    `${String(x.countries).padStart(3)}→${String(y.countries).padStart(3)}  ${dCty.toFixed(1).padStart(6)}   ` +
    `${x.wealth.toFixed(0).padStart(8)}→${y.wealth.toFixed(0).padStart(8)}  ${dW.toFixed(1).padStart(6)}`
  );
}
// Split the verdict: leadOrg (development) is the SMOOTH, self-averaging signal
// that SHOULD be G-invariant — the growth/decay mechanics are exact-exponential
// (Math.exp(rate·dt)), so the history SHAPE tracks. pop/wealth/countries are
// chaos-sensitive: changing G changes the RNG stream (G× more draws/history-unit),
// so their magnitudes wander by seed like a seed change would (measured: 8817 pop
// +22%, 31337/4242 −35% — direction flips ⇒ chaos, not a systematic unscaled rate).
// Gate ONLY on development; report magnitudes as informational.
let worstOrg = 0, worstMag = 0;
for (let i = 0; i < CPS.length; i++) {
  worstOrg = Math.max(worstOrg, Math.abs(pct(a[i].leadOrg, b[i].leadOrg)));
  worstMag = Math.max(worstMag, Math.abs(pct(a[i].pop, b[i].pop)), Math.abs(pct(a[i].wealth, b[i].wealth)));
}
const ORG_TOL = 8;   // loose: development must track across G within this band
console.log(`\ndevelopment (leadOrg) worst |Δ%|: ${worstOrg.toFixed(1)}%   [G-INVARIANT — gated ≤ ${ORG_TOL}%]`);
console.log(`magnitude (pop/wealth) worst |Δ%|: ${worstMag.toFixed(1)}%   [chaos-sensitive — informational, NOT gated]`);
console.log(worstOrg <= ORG_TOL ? `\nG-equivalence OK: development tracks across G=1↔${GHI}` : `\n*** development DIVERGES across G — investigate an unscaled rate ***`);
process.exit(worstOrg <= ORG_TOL ? 0 : 1);
