// Verify the colonial-dependency system fires: count colonies founded as dependencies,
// how many are currently bound to an overlord, and independence events over the run.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

let bound = 0;
const overlords = new Map();
if (world.polities) for (const [id, p] of world.polities) {
  if (p.endedStep >= 0) continue;
  if (p._overlord != null) { bound++; overlords.set(p._overlord, (overlords.get(p._overlord) || 0) + 1); }
}
const ev = world.events || [];
const founded = ev.filter(e => e.type === "colony.founded").length;
const indep = ev.filter(e => e.type === "colony.independent").length;
console.log(`colony dependencies founded (events): ${founded}`);
console.log(`independence events: ${indep}`);
console.log(`currently bound dependencies: ${bound}`);
console.log(`metropoles holding dependencies: ${overlords.size}`);
if (overlords.size) {
  console.log('  overlord countryId → #dependencies:');
  for (const [over, n] of [...overlords].sort((a,b)=>b[1]-a[1]).slice(0, 8)) console.log(`    ${over} → ${n}`);
}
