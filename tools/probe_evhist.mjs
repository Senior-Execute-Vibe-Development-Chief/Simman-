// Histogram of event types in the global log — how noisy is the chronicle?
//   node tools/probe_evhist.mjs [step] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEP = +(process.argv[2] || "12000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rivers.riverMag ? rivers.riverMag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
console.log(`[stats]`, peopleSimStats(world));

const evs = world._events || world.events || [];
const hist = new Map();
for (const e of evs) hist.set(e.type, (hist.get(e.type) || 0) + 1);
const rows = [...hist.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n${evs.length} total events, ${rows.length} types:`);
for (const [t, n] of rows) console.log(`  ${String(n).padStart(6)}  ${t}`);
