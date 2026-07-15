// Probe: does the emblem transmission layer (emblems.js) actually EVOLVE arms in a
// live sim? Runs a real world, then reports coverage (realms/houses/peoples/faiths
// with emblems) and the deepest lineages (gen / cadency / quarters), and traces one
// long-lived realm's arms as they descend and marshal.
//
//   node tools/probe_emblems.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { blazonGenome, describeGenome } from "../src/sim/emblemGenome.js";

const STEPS = +(process.argv[2] || 16000);
const SEED = +(process.argv[3] || 4242);
const W = +(process.argv[4] || 320), H = +(process.argv[5] || 160);

const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

// Track a handful of realms' arms over the run to SEE the descent/marshalling.
const track = new Map();   // polityId -> [{step, gen, cad, q, blazon}]
const CHUNK = 1000;
for (let done = 0; done < STEPS; done += CHUNK) {
  stepPeopleSim(world, Math.min(CHUNK, STEPS - done));
  // sample the largest living realms
  const live = [...(world.countries ? world.countries.values() : [])]
    .map(c => ({ c, pol: getPolity(world, c.id) }))
    .filter(x => x.pol && x.pol.endedStep < 0 && x.pol.emblem)
    .sort((a, b) => (b.c.members ? b.c.members.length : 0) - (a.c.members ? a.c.members.length : 0))
    .slice(0, 6);
  for (const { c, pol } of live) {
    const g = pol.emblem;
    const row = track.get(c.id) || [];
    const last = row[row.length - 1];
    const sig = `${g.gen}|${g.cadency || 0}|${g.quarters ? g.quarters.length : 1}`;
    if (!last || last.sig !== sig) row.push({ step: world.step, sig, gen: g.gen, cad: g.cadency || 0, q: g.quarters ? g.quarters.length : 1, blazon: blazonGenome(g), name: pol.name });
    track.set(c.id, row);
  }
}

// ── coverage ──
let realms = 0, withEmblem = 0, withQuarters = 0, withCadency = 0, maxGen = 0;
for (const p of world.polities.values()) {
  if (p.endedStep >= 0) continue;
  realms++;
  if (p.emblem) { withEmblem++; if (p.emblem.quarters && p.emblem.quarters.length > 1) withQuarters++; if (p.emblem.cadency) withCadency++; maxGen = Math.max(maxGen, p.emblem.gen || 0); }
}
let houses = 0, houseArms = 0;
for (const d of (world.dynasties ? world.dynasties.values() : [])) { if (d.endedStep >= 0) continue; houses++; if (d.arms) houseArms++; }
let cultures = 0, trads = 0;
for (const c of (world.cultures ? world.cultures.values() : [])) { cultures++; if (c.tradition) trads++; }
let faiths = 0, sigils = 0;
for (const f of (world.faiths ? world.faiths.values() : [])) { faiths++; if (f.sigil) sigils++; }

console.log(`\n═══ EMBLEM COVERAGE after ${world.step} steps (seed ${SEED}, ${W}x${H}) ═══`);
console.log(`  living realms:   ${withEmblem}/${realms} bear an emblem`);
console.log(`    ...marshalled: ${withQuarters} carry quartered arms (a union/conquest of houses)`);
console.log(`    ...cadenced:   ${withCadency} bear a mark of difference (a cadet line)`);
console.log(`    deepest line:  ${maxGen} generations of descent`);
console.log(`  living houses:   ${houseArms}/${houses} have founding arms`);
console.log(`  peoples:         ${trads}/${cultures} carry a visual tradition`);
console.log(`  faiths:          ${sigils}/${faiths} have a sacred sigil`);

// ── the deepest evolutionary story ──
let best = null, bestLen = 0;
for (const [id, row] of track) if (row.length > bestLen) { bestLen = row.length; best = { id, row }; }
if (best) {
  console.log(`\n═══ ONE REALM'S ARMS OVER TIME — polity ${best.id} (${best.row.length} distinct states) ═══`);
  for (const r of best.row) {
    const marks = [`gen ${r.gen}`, r.cad ? `cadency ${r.cad}` : null, r.q > 1 ? `${r.q} quarters` : null].filter(Boolean).join(", ");
    console.log(`  step ${String(r.step).padStart(6)} — ${r.name || "?"}  [${marks}]`);
    console.log(`             ${r.blazon}`);
  }
}

// ── a spread of realms right now: the look FOUNDED FROM STATE ──
console.log(`\n═══ CURRENT ARMS OF THE GREAT REALMS (founded from emergent state) ═══`);
const now = [...world.countries.values()]
  .map(c => ({ c, pol: getPolity(world, c.id) }))
  .filter(x => x.pol && x.pol.endedStep < 0 && x.pol.emblem)
  .sort((a, b) => (b.c.members ? b.c.members.length : 0) - (a.c.members ? a.c.members.length : 0))
  .slice(0, 12);
for (const { c, pol } of now) {
  console.log(`  ${(pol.name || "?").padEnd(16)} (${(c.members ? c.members.length : 0)} settlements)  ${blazonGenome(pol.emblem)}`);
}
console.log("");
