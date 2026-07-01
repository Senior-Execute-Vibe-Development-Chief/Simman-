// Are peoples grounded in deep ancestry, or still 3 cradle families? Run the sim, then for
// every settled place look up its culture's ROOT family and report how concentrated the world
// is in a few families (the "3 cradles" symptom) vs spread across many ancestry-rooted stocks.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { familyOf } from "../src/sim/peopleSim/cultures.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const cultures = world.cultures ? world.cultures.size : 0;
let ancRooted = 0;
if (world.cultures) for (const c of world.cultures.values()) if (c._anc != null) ancRooted++;

// Each settled place → its culture's root family. Weight by population.
const famPop = new Map(); let total = 0;
for (const s of world.settlements) {
  if (s.mode !== "settled" || !(s.cultureId >= 0)) continue;
  const fam = familyOf(world, s.cultureId);
  const w = s.people || 0;
  famPop.set(fam, (famPop.get(fam) || 0) + w); total += w;
}
const fams = [...famPop.entries()].sort((a, b) => b[1] - a[1]);
const top3 = fams.slice(0, 3).reduce((a, [, p]) => a + p, 0);
console.log(`seed ${SEED}: ${cultures} cultures (${ancRooted} ancestry-rooted), ${fams.length} distinct ROOT families`);
console.log(`population share of the top-3 families: ${(100 * top3 / Math.max(1, total)).toFixed(0)}%  (≈100% = the "3 cradles flood the world" symptom)`);
console.log('top families by population share:');
for (const [fam, p] of fams.slice(0, 8)) {
  const c = world.cultures.get(fam);
  console.log(`  ${c ? c.name : fam}${c && c._anc != null ? " (ancestry-rooted)" : " (cradle)"}: ${(100 * p / Math.max(1, total)).toFixed(1)}%`);
}
