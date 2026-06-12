// Tech-effects balance A/B — same world + seed, run once with TECH_EFFECTS=0
// (the old continuous-knowledge formulas) and once with =1 (fully tech-driven),
// comparing demographics, city tiers and the largest settlement. If the two
// columns are close, the discrete tech bonuses preserve the tuned balance.
//   node tools/probe_techab.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "10000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W * H);
function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);

const fmt = n => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n|0);
function run(te) {
  T.TECH_EFFECTS = te;
  const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });
  world._checkInvariants = true;
  for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
  const st = peopleSimStats(world);
  let largest = 0, totPop = 0; const pops = [];
  for (const s of world.settlements) { if (s.mode !== "settled") continue; totPop += s.people; pops.push(s.people); if (s.people > largest) largest = s.people; }
  pops.sort((a,b)=>b-a);
  const hits = world.debug.invariantHits || {}; const nHits = Object.values(hits).reduce((a,b)=>a+b,0);
  return { st, totPop, largest, top5: pops.slice(0,5), inv: nHits===0?"CLEAN":JSON.stringify(hits) };
}

const off = run(0), on = run(1);
console.log(`Tech-effects A/B @ step ${STEPS} ${W}x${H} seed ${SEED}\n`);
console.log(`                       TECH_EFFECTS=0 (old)   TECH_EFFECTS=1 (new)`);
const line = (lbl, a, b) => console.log(`  ${lbl.padEnd(20)} ${String(a).padStart(18)}   ${String(b).padStart(18)}`);
line("settlements", off.st.settlements, on.st.settlements);
line("villages", off.st.villages, on.st.villages);
line("towns", off.st.towns, on.st.towns);
line("cities", off.st.cities, on.st.cities);
line("metropolises", off.st.metropolises, on.st.metropolises);
line("total people", fmt(off.totPop), fmt(on.totPop));
line("largest settlement", fmt(off.largest), fmt(on.largest));
line("countries", off.st.countries, on.st.countries);
line("largest empire (tiles)", fmt(off.st.largestEmpire), fmt(on.st.largestEmpire));
line("total wealth", fmt(off.st.totalWealth), fmt(on.st.totalWealth));
line("top5 pops", off.top5.map(fmt).join(","), on.top5.map(fmt).join(","));
line("invariants", off.inv, on.inv);
const dPop = on.totPop / Math.max(1, off.totPop);
console.log(`\npopulation ratio new/old = ${dPop.toFixed(3)}  (≈1.0 means the tech bonuses preserved the balance)`);
