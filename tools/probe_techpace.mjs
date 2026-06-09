// Tech-pacing probe: does the era ladder track the displayed calendar?
// Reports, for the LEADING civilisation, the step (and ~year) each era is first
// reached, plus the biggest cities at "year 1000 AD" (step 9720). Calibrates
// LEARN_BASE so industrial-scale (multi-million) cities don't appear in antiquity.
//   node tools/probe_techpace.mjs [maxStep=18000] [LEARN_BASE override] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { techState, ERAS } from "../src/peopleSim/tech.js";
import { applyTuning } from "../src/peopleSim/tuning.js";

const STEP = +(process.argv[2] || "18000");
const LB   = process.argv[3] !== undefined ? +process.argv[3] : undefined;
const SEED = +(process.argv[4] || "8817");
if (LB !== undefined) applyTuning({ LEARN_BASE: LB });
const W = 480, H = 240, N = W * H, PS = 1000, YEAR1000 = 9720;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rivers.riverMag ? rivers.riverMag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });

// Mirror WorldSim.jsx stepToYear (YEAR_STEP_SCALE = 18).
const stepToYear = (step) => { const ys = Math.min(1000, step / 18);
  if (ys <= 200) return 2000 - ys * 7; if (ys <= 500) return 600 - (ys - 200) * 5;
  if (ys <= 800) return -(900 + (ys - 500) * 2.5); return -(1650 + (ys - 800) * 1.875); };
const yr = (st) => { const y = stepToYear(st); return y > 0 ? `${Math.round(y)} BC` : `${Math.round(-y)} AD`; };

const firstEra = new Array(ERAS.length).fill(-1);
let snap1000 = null;
for (let s = 1; s <= STEP; s++) {
  stepPeopleSim(world, 1);
  if (s % 50 === 0) {
    let maxEra = 0;
    for (const x of world.settlements) { if (x.mode !== "settled") continue; const e = techState(x.knowledge || {}).era; if (e > maxEra) maxEra = e; }
    for (let e = 0; e <= maxEra; e++) if (firstEra[e] < 0) firstEra[e] = s;
  }
  if (s === YEAR1000) {
    const cs = world.settlements.filter(x => x.mode === "settled").sort((a, b) => b.people - a.people);
    let o1 = 0, o2 = 0, tot = 0, lead = 0;
    for (const x of cs) { const d = x.people * PS; if (d >= 1e6) o1++; if (d >= 2e6) o2++; tot += x.people; const e = techState(x.knowledge || {}).era; if (e > lead) lead = e; }
    snap1000 = { lead, o1, o2, tot, top: cs.slice(0, 5) };
  }
}
console.log(`LEARN_BASE = ${LB !== undefined ? LB : "default"}  ·  earth seed ${SEED}  ·  to step ${STEP}\n`);
console.log(`Era first reached by the leading civilisation (vs the displayed calendar):`);
for (let e = 0; e < ERAS.length; e++)
  console.log(`  ${ERAS[e].padEnd(11)} ${firstEra[e] < 0 ? "never" : `step ${String(firstEra[e]).padStart(5)} (~${yr(firstEra[e])})`}`);
if (snap1000) {
  console.log(`\nAt "year 1000 AD" (step ${YEAR1000}):  lead era ${ERAS[snap1000.lead]}  ·  worldPop ${(snap1000.tot * PS / 1e6).toFixed(1)}M  ·  cities ≥1M: ${snap1000.o1}  ≥2M: ${snap1000.o2}`);
  console.log(`  biggest: ${snap1000.top.map(s => `${(s.people * PS / 1e6).toFixed(2)}M(${ERAS[techState(s.knowledge || {}).era].slice(0, 4)})`).join("  ")}`);
}
