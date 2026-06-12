// Dump per-country chronicles as plain text — verify the history log reads as a
// sensible blow-by-blow.  node tools/probe_chronicle.mjs [step] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { getChronicle, realmName } from "../src/sim/peopleSim/chronicle.js";

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

const fmt = (e) => `  [t${e.step}] ${e.text}`;
const realms = [...(world.countries ? world.countries.values() : [])].sort((a, b) => (b.members?.length || 0) - (a.members?.length || 0));
console.log(`\n────────────── LIVING REALMS (top 3 by size) ──────────────`);
for (const c of realms.slice(0, 3)) {
  const log = getChronicle(world, c.id);
  console.log(`\n═══ ${realmName(world, c.id)}  (realm #${c.id} · ${c.members?.length || 0} settlements · ${log.length} events) ═══`);
  for (const e of log) console.log(fmt(e));
}
const dead = world._deadChronicles || [];
console.log(`\n────────────── FALLEN REALMS (${dead.length} total; last 2) ──────────────`);
for (const d of dead.slice(-2)) {
  console.log(`\n═══ ${d.name}  (realm #${d.countryId} · ${d.log.length} events) ═══`);
  for (const e of d.log) console.log(fmt(e));
}
