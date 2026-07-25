// TERRAIN_FADE era-signature probe: the five late-era fades (fertilizer,
// engineering, pumps, medicine, land transport) sleep until a realm's capital
// crosses the industrial gate (s._indGate = org·metallurgy past 0.78 — hard
// ZERO before that), so the validated 21k batteries barely feel them. This
// probe runs LONG enough for industrialization and measures the signature the
// lever claims: once fades wake, population should spread INTO the ground
// terrain used to forbid — poor soils, rugged relief, the wet-tropic disease
// belt, the waterless interior — in the FADE arm and not in the control.
//
//   node tools/probe_terrainfade.mjs [fade|both] [seed] [steps] [W] [H]
//   fade = a TERRAIN_FADE value for a single arm (parallelize two processes),
//          or "both" (default) to run control then fade sequentially and
//          print per-checkpoint deltas.
//
// Pop-weighted tile classes (measurement bins, not mechanics): rugged
// relief>0.5 · poor soil fert<0.35 · disease belt tropicBurden>0.3 ·
// interior coast=0 & riverMag<2. All shares are of the same run's own
// field population, so the comparison is shape vs shape.
//
// Reference (Earth 320×160 seed 8817, 48k steps, 2026-07 defaults):
// arms byte-identical through 18k (gate hard zero), takeoff 18–21k
// (org/met→1.00, ~99% of fade-arm pop on faded land from 24k). Mature
// signature (39k–48k mean, fade vs control): poor soil 12.2% vs 4.6%
// (2.6×, diverging), interior 30.5% vs 19.1% (rising vs flat), mean fert
// under people 0.794 vs 0.820, relief 0.072 vs 0.088; wet-tropic share
// FELL 6.7% vs 10.3% (medicine outweighed by the temperate-interior
// fades — the Earth signature is the plains filling, not a tropics
// boom). Macro totals swing seed-like post-divergence (trajectory
// chaos) — judge the shares, not the totals. docs/land-works.md add. 6.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";

const ARG = process.argv[2] || "both";
const SEED = parseInt(process.argv[3] || "8817", 10);
const STEPS = parseInt(process.argv[4] || "36000", 10);
const W = parseInt(process.argv[5] || "320", 10), H = parseInt(process.argv[6] || String(W >> 1), 10);
const CHECK = 3000;

function sample(world) {
  const N = world.N, pop = world.popField, fert = world.fert, relief = world.relief;
  const coast = world.coast, rm = world.riverMag, tb = world._tropicBurden, tf = world._tfFade;
  let tot = 0, rug = 0, poor = 0, trop = 0, inter = 0, faded = 0, fadeW = 0, fertW = 0, relW = 0;
  if (pop) for (let i = 0; i < N; i++) {
    const p = pop[i]; if (!(p > 0)) continue;
    tot += p;
    if (relief && relief[i] > 0.5) rug += p;
    if (fert[i] < 0.35) poor += p;
    if (tb && tb[i] > 0.3) trop += p;
    if ((!coast || coast[i] <= 0) && (!rm || rm[i] < 2)) inter += p;
    if (tf && tf[i] > 0) { faded += p; fadeW += p * tf[i]; }
    fertW += p * fert[i];
    if (relief) relW += p * relief[i];
  }
  let maxGate = 0, nInd = 0, maxOrg = 0, maxMetal = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const g = s._indGate || 0;
    if (g > maxGate) maxGate = g;
    if (g > 0.05) nInd++;
    const k = s.knowledge;
    if (k) { if (k.organization > maxOrg) maxOrg = k.organization; if (k.metallurgy > maxMetal) maxMetal = k.metallurgy; }
  }
  const st = peopleSimStats(world);
  return {
    step: world.step, pop: st.totalPeople, setts: st.settlements, countries: st.countries,
    maxOrg, maxMetal, maxGate, nInd,
    fadeShare: tot ? faded / tot : 0, fadeMean: tot ? fadeW / tot : 0,
    rugged: tot ? rug / tot : 0, poorSoil: tot ? poor / tot : 0,
    tropic: tot ? trop / tot : 0, interior: tot ? inter / tot : 0,
    meanFert: tot ? fertW / tot : 0, meanRelief: tot ? relW / tot : 0,
  };
}

const pct = (x) => (100 * x).toFixed(1).padStart(5);
function row(s) {
  return `${String(s.step).padStart(6)}  org ${s.maxOrg.toFixed(2)} met ${s.maxMetal.toFixed(2)} gate ${s.maxGate.toFixed(2)}×${String(s.nInd).padStart(3)}` +
    `  fade ${pct(s.fadeShare)}%@${s.fadeMean.toFixed(2)}` +
    `  rug ${pct(s.rugged)}  poor ${pct(s.poorSoil)}  trop ${pct(s.tropic)}  intr ${pct(s.interior)}` +
    `  fert ${s.meanFert.toFixed(3)} rel ${s.meanRelief.toFixed(3)}` +
    `  pop ${String(s.pop).padStart(7)} setts ${String(s.setts).padStart(3)} realms ${String(s.countries).padStart(3)}`;
}

function runArm(fade) {
  applyTuning({ TERRAIN_FADE: fade });
  console.log(`[terrainfade] arm TERRAIN_FADE=${fade} · seed ${SEED} · ${W}x${H} · ${STEPS} steps`);
  const world = buildSim({ W, H, seed: SEED });
  const rows = [];
  for (let t = 0; t < STEPS; t += CHECK) {
    stepPeopleSim(world, Math.min(CHECK, STEPS - t));
    const s = sample(world);
    rows.push(s);
    console.log(row(s));
  }
  return rows;
}

if (ARG === "both") {
  const a = runArm(0), b = runArm(1);
  console.log(`\n[terrainfade] Δ (fade − control), pop-weighted shares in points:`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = (k) => (100 * (b[i][k] - a[i][k])).toFixed(2).padStart(6);
    console.log(`${String(b[i].step).padStart(6)}  fade ${pct(b[i].fadeShare)}%` +
      `  Δrug ${d("rugged")}  Δpoor ${d("poorSoil")}  Δtrop ${d("tropic")}  Δintr ${d("interior")}` +
      `  Δpop ${String(b[i].pop - a[i].pop).padStart(7)}`);
  }
} else {
  runArm(parseFloat(ARG));
}
