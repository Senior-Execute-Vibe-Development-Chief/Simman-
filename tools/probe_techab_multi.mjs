// Multi-seed tech-effects balance A/B. The sim is chaotic, so a single seed is
// noisy — this runs several seeds, each old (TECH_EFFECTS=0) vs new (=1), and
// reports the per-seed population ratio plus the mean, so a real balance shift
// is distinguishable from butterfly noise.
//   node tools/probe_techab_multi.mjs [steps] [W] [H] [seed1,seed2,...]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "8000", 10);
const W = parseInt(process.argv[3] || "360", 10), H = parseInt(process.argv[4] || "180", 10);
const SEEDS = (process.argv[5] || "8817,4242,1337").split(",").map(s => parseInt(s, 10));

function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
function buildWorld(SEED) {
  const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
  const tCrop = new Float32Array(W * H);
  const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
  w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);
  return { w, tCrop };
}
function pop(world) { let p = 0; for (const s of world.settlements) if (s.mode === "settled") p += s.people; return p; }
function run(w, tCrop, SEED, te) {
  T.TECH_EFFECTS = te;
  const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });
  world._checkInvariants = true;
  for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
  const st = peopleSimStats(world);
  const hits = world.debug.invariantHits || {}; const nHits = Object.values(hits).reduce((a, b) => a + b, 0);
  return { pop: pop(world), st, inv: nHits === 0 };
}

const fmt = n => n >= 1e3 ? (n/1e3).toFixed(1)+"k" : String(n|0);
console.log(`Multi-seed A/B @ ${STEPS} steps ${W}x${H}, seeds ${SEEDS.join(",")}\n`);
console.log("seed     pop old→new (ratio)     countries   largest-empire(tiles)   cities/metros        inv");
let sum = 0, n = 0, esum = 0;
for (const SEED of SEEDS) {
  const { w, tCrop } = buildWorld(SEED);
  const off = run(w, tCrop, SEED, 0), on = run(w, tCrop, SEED, 1);
  const r = on.pop / Math.max(1, off.pop); sum += r; n++;
  const er = on.st.largestEmpire / Math.max(1, off.st.largestEmpire); esum += er;
  console.log(`${String(SEED).padEnd(6)} ${fmt(off.pop)}→${fmt(on.pop)} (${r.toFixed(2)})      ${String(off.st.countries+"→"+on.st.countries).padEnd(8)}    ${(fmt(off.st.largestEmpire)+"→"+fmt(on.st.largestEmpire)+" ("+er.toFixed(2)+")").padEnd(20)}   ${off.st.cities}/${off.st.metropolises}→${on.st.cities}/${on.st.metropolises}         ${off.inv&&on.inv?"ok":"BAD"}`);
}
console.log(`\nmean pop ratio = ${(sum/n).toFixed(3)}   mean largest-empire ratio = ${(esum/n).toFixed(3)}   (≈1.0 = balance preserved)`);
