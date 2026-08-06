// WHY DOES MARKET INTEGRATION READ NEGATIVE? — reproduces stylized.mjs's
// component/price-dispersion sampling (same harness, seed, windows) and prints
// the per-window series with the suspected drivers alongside: city births in
// the window, trade-component count, and the deflation-pegged tail (components
// whose sim price sits at/near the P_MIN clamp — coin-poor frontier economies)
// with the PEOPLE living under them. The Δ-correlation the gate scores is
// printed at the end from exactly this series, so the windows driving it can
// be read off directly.
//
//   node tools/probe_market.mjs [seed] [steps] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const SEED = +(process.argv[2] || 8817);
const STEPS = +(process.argv[3] || 21000);
const W = +(process.argv[4] || 480), H = W >> 1;

const world = buildSim({ W, H, seed: SEED });
const SAMPLE_N = 30;
const win = Math.max(1, Math.round(STEPS / SAMPLE_N));
const rows = [];
let evSeen = 0;
console.log("  step | comps | pDisp  | births | lowP comps (people) | settled | ref?");
for (let t = 0; t < STEPS; t += win) {
  stepPeopleSim(world, Math.min(win, STEPS - t));
  // city births logged in this window (the event ledger is append-only)
  const ev = world.events || [];
  let births = 0;
  for (; evSeen < ev.length; evSeen++) if (ev[evSeen].type === "settlement.founded") births++;
  const roots = new Set();
  if (world._networkComponents) for (const r of world._networkComponents.values()) roots.add(r);
  let pDisp = -1, lowN = 0, lowPeople = 0, settled = 0;
  for (const s of world.settlements) if (s.mode === "settled") settled++;
  if (world._inflRef !== undefined && world._inflP && world._inflP.size >= 2 && world._networkComponents) {
    const w = new Map();
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
      w.set(root, (w.get(root) || 0) + Math.max(1, s.people || 0));
    }
    let Wt = 0, mean = 0;
    for (const [root, p] of world._inflP) { const n = w.get(root) || 1; Wt += n; mean += p * n; }
    if (Wt > 0) {
      mean /= Wt;
      let mad = 0;
      for (const [root, p] of world._inflP) {
        mad += Math.abs(p - mean) * (w.get(root) || 1);
        if (p <= 0.45) { lowN++; lowPeople += w.get(root) || 0; }
      }
      pDisp = mad / Wt;
    }
  }
  rows.push({ step: world.step, comps: roots.size, pDisp, births });
  console.log(`${String(world.step).padStart(6)} | ${String(roots.size).padStart(5)} | ${pDisp < 0 ? "  n/a " : pDisp.toFixed(4)} | ${String(births).padStart(6)} | ${String(lowN).padStart(4)} (${String(Math.round(lowPeople)).padStart(6)}) | ${String(settled).padStart(7)} | ${world._inflRef !== undefined ? "y" : "-"}`);
}
const post = rows.filter(r => r.pDisp >= 0);
const dC = [], dP = [];
for (let i = 1; i < post.length; i++) { dC.push(post[i].comps - post[i - 1].comps); dP.push(post[i].pDisp - post[i - 1].pDisp); }
const mx = dC.reduce((a, b) => a + b, 0) / (dC.length || 1), my = dP.reduce((a, b) => a + b, 0) / (dP.length || 1);
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < dC.length; i++) { const a = dC[i] - mx, b = dP[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
console.log(`\n  gate correlation r(dComps, dDisp) = ${r.toFixed(3)}  (bar: > -0.2)`);
console.log(`  windows, sorted by |contribution| (dC·dP):`);
const contrib = [];
for (let i = 0; i < dC.length; i++) contrib.push({ step: post[i + 1].step, dC: dC[i], dP: dP[i], c: (dC[i] - mx) * (dP[i] - my) });
contrib.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
for (const c of contrib.slice(0, 8)) console.log(`    step ${String(c.step).padStart(6)}  dComps ${String(c.dC).padStart(4)}  dDisp ${c.dP >= 0 ? "+" : ""}${c.dP.toFixed(4)}`);
