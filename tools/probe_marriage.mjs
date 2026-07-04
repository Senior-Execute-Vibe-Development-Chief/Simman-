// Acceptance probe for the cross-realm marriage market (docs/marriage-market-cross-realm.md).
// Measures the metrics the claimant-wars prerequisite stands on, SAMPLED across the
// whole run (not just the end — one snapshot is a noisy sample; claims fire at random
// contested successions, so the time-averaged LIVE stock is what matters):
//   (1) houses ruling  >1 realm  — a cadet branch that came to sit a second throne
//   (2) housed cross-realm consorts — a sitting ruler wed to a person BORN of another
//       realm's REIGNING house (real dynastyId, not a generated houseless in-law)
//   (3) cumulative cross-court marriage events (dynasty.union) over the run
// Baseline (before the fix) is ~0 houses / ~0-1 live consorts: dynasties are realm-siloed.
//   node tools/probe_marriage.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { getPerson, getDynasty } from "../src/sim/peopleSim/dynasties.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = +(process.env.W || 320), H = +(process.env.H || 160);
const SAMPLE = 250;                       // sample cadence (steps)
const WARMUP = 4000;                      // ignore pre-dynasty steps
// The lever under test — default ON (the enriched market is what this probe exists
// to measure). CROSS_REALM_HEIRS=0 env recovers the realm-siloed baseline.
T.CROSS_REALM_HEIRS = process.env.CROSS_REALM_HEIRS != null ? +process.env.CROSS_REALM_HEIRS : 1;
T.CLAIMANT_WARS = process.env.CLAIMANT_WARS != null ? +process.env.CLAIMANT_WARS : 1;   // both default ON since the W6-F flip

// One measurement of the current live cross-realm kin graph.
function measure(world) {
  const rulers = [];                      // { realmId, ruler, dynId }
  const houseRealms = new Map();          // dynastyId → [realmIds it currently reigns]
  for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol.endedStep >= 0 || pol.rulerId == null || pol.rulerId < 0) continue;
    const ruler = getPerson(world, pol.rulerId);
    if (!ruler || ruler.died >= 0) continue;
    rulers.push({ realmId: c.id, ruler, dynId: pol.dynastyId });
    if (pol.dynastyId >= 0) {
      if (!houseRealms.has(pol.dynastyId)) houseRealms.set(pol.dynastyId, []);
      houseRealms.get(pol.dynastyId).push(c.id);
    }
  }
  const multiRealm = [...houseRealms.values()].filter(rs => rs.length > 1).length;
  let housed = 0, foreignHouse = 0, crossRealm = 0;
  const examples = [];
  for (const { realmId, ruler, dynId } of rulers) {
    if (ruler.spouseId < 0) continue;
    const sp = getPerson(world, ruler.spouseId);
    if (!sp || sp.died >= 0 || sp.dynastyId < 0) continue;
    housed++;
    if (sp.dynastyId === dynId) continue;
    foreignHouse++;
    const elsewhere = (houseRealms.get(sp.dynastyId) || []).filter(r => r !== realmId);
    if (elsewhere.length) {
      crossRealm++;
      if (examples.length < 6) { const d = getDynasty(world, sp.dynastyId);
        examples.push(`realm ${realmId} ⚭ ${sp.name} of House ${d ? d.name : sp.dynastyId} (reigns ${elsewhere.join("/")})`); }
    }
  }
  return { nRulers: rulers.length, nHouses: houseRealms.size, multiRealm, housed, foreignHouse, crossRealm, examples };
}

const world = buildSim({ W, H, seed: SEED });
const acc = { multiRealm: [], crossRealm: [], foreignHouse: [], housed: [] };
let peakCross = 0, peakMulti = 0, lastExamples = [];
let claimsSum = 0, claimsPeak = 0, claimsSamples = 0;
for (let s = 0; s < STEPS; s += SAMPLE) {
  stepPeopleSim(world, Math.min(SAMPLE, STEPS - s));
  if (T.CLAIMANT_WARS && world._succClaims) { const n = world._succClaims.size; claimsSum += n; if (n > claimsPeak) claimsPeak = n; claimsSamples++; }
  if (s + SAMPLE < WARMUP) continue;
  const m = measure(world);
  acc.multiRealm.push(m.multiRealm); acc.crossRealm.push(m.crossRealm);
  acc.foreignHouse.push(m.foreignHouse); acc.housed.push(m.housed);
  if (m.crossRealm > peakCross) peakCross = m.crossRealm;
  if (m.multiRealm > peakMulti) peakMulti = m.multiRealm;
  if (m.examples.length) lastExamples = m.examples;
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const frac = a => a.length ? a.filter(x => x > 0).length / a.length : 0;
const atLeast = (a, n) => a.length ? a.filter(x => x >= n).length / a.length : 0;
const unions = (world.events || []).filter(e => e && e.type === "dynasty.union").length;
const inherits = (world.events || []).filter(e => e && e.type === "ruler.crowned" && e.how === "claim").length;
const crises = (world.events || []).filter(e => e && e.type === "succession.crisis").length;
const end = measure(world);

console.log(`── marriage-market acceptance probe · seed ${SEED} · ${STEPS} steps · ${W}×${H} · CROSS_REALM_HEIRS=${T.CROSS_REALM_HEIRS} · sampled every ${SAMPLE} after warmup ${WARMUP} ──`);
console.log(`persons ${world.persons ? world.persons.size : 0} · dynasties ${world.dynasties ? world.dynasties.size : 0} · samples ${acc.crossRealm.length}`);
console.log(`sitting rulers (end) ${end.nRulers} · distinct ruling houses (end) ${end.nHouses}`);
console.log(`HOUSES RULING >1 REALM      · mean ${mean(acc.multiRealm).toFixed(2)} · peak ${peakMulti} · any in ${(frac(acc.multiRealm) * 100).toFixed(0)}% of samples`);
console.log(`housed cross-realm consorts · mean ${mean(acc.crossRealm).toFixed(2)} · peak ${peakCross} · ≥1 live in ${(frac(acc.crossRealm) * 100).toFixed(0)}% · ≥2 in ${(atLeast(acc.crossRealm, 2) * 100).toFixed(0)}%`);
console.log(`  (of a foreign house, live · mean ${mean(acc.foreignHouse).toFixed(2)}) · (any housed consort · mean ${mean(acc.housed).toFixed(2)})`);
console.log(`cross-court marriages over run (dynasty.union events): ${unions}`);
if (T.CLAIMANT_WARS) {
  const wars = (world.events || []).filter(e => e && e.type === "war.began");
  const claimWars = wars.filter(e => e.claim).length;
  const claimWon = (world.events || []).filter(e => e && e.type === "war.claimWon").length;
  console.log(`CLAIMANT_WARS: succession crises ${crises} · foreign-inheritance crownings ${inherits} · wars ${wars.length} of which claim-pressed ${claimWars} · claimant wars WON (personal union) ${claimWon}`);
  console.log(`  live succession claims per pass: mean ${(claimsSum / Math.max(1, claimsSamples)).toFixed(2)} · peak ${claimsPeak}`);
}
if (lastExamples.length) { console.log(`recent live cross-realm ties:`); for (const e of lastExamples) console.log(`  · ${e}`); }
