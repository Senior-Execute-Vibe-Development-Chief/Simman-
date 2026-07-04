// Does the seeded kin graph carry FIREABLE cross-realm succession claims? This is the
// real step-4 gate (docs/marriage-market-cross-realm.md): claimant wars can only fire
// if, at a contested succession in realm B, some foreign sovereign is OF, MARRIED INTO,
// or DESCENDED FROM realm B's reigning house. Rather than reconstruct each historical
// crisis, this measures the STANDING claim graph the reverted _succClaims design draws
// on — sampled across the run: for every sitting ruler R (house H_R, realm A), a claim
// on another reigning realm B (house H_B) exists when R is
//   · MARRIED IN   — R's consort is trueborn of H_B, or
//   · DESCENDED    — R's other parent (their house-parent's spouse) was of H_B
//                    ("women's sons"), or their grandparent's spouse was, or
//   · OF THE HOUSE — H_R itself reigns in B too (a cadet branch on two thrones).
// Reports mean/peak distinct (claimant realm -> target realm) pairs live at once — i.e.
// how many claimant wars COULD be pressed at any moment. Lever on by default.
//   node tools/probe_claims.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { getPerson } from "../src/sim/peopleSim/dynasties.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = 320, H = 160, SAMPLE = 250, WARMUP = 4000;
T.CROSS_REALM_HEIRS = process.env.CROSS_REALM_HEIRS != null ? +process.env.CROSS_REALM_HEIRS : 1;

const houseOf = p => (p && p.dynastyId >= 0 ? p.dynastyId : -1);

function measure(world) {
  // reigning houses → the realm each sits (so a claim points at a real throne)
  const reignRealm = new Map();       // dynastyId → realmId
  const rulers = [];                  // { realmId, ruler, house }
  for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol.endedStep >= 0 || pol.rulerId == null || pol.rulerId < 0) continue;
    const ruler = getPerson(world, pol.rulerId);
    if (!ruler || ruler.died >= 0) continue;
    rulers.push({ realmId: c.id, ruler, house: houseOf(ruler) });
    if (pol.dynastyId >= 0 && !reignRealm.has(pol.dynastyId)) reignRealm.set(pol.dynastyId, c.id);
  }
  // R's other-parent house at a given ancestor depth (0 = R's parent's spouse, etc.)
  const otherParentHouse = (person) => {
    const parent = person.parentId >= 0 ? getPerson(world, person.parentId) : null;
    if (!parent || parent.spouseId < 0) return -1;
    const sp = getPerson(world, parent.spouseId);
    return houseOf(sp);
  };
  const claims = new Set();           // "A->B" distinct claimant→target realm pairs
  const kinds = { married: 0, descent: 0, ofHouse: 0 };
  for (const { realmId, ruler, house } of rulers) {
    const add = (targetHouse, kind) => {
      if (targetHouse < 0 || targetHouse === house) return;
      const targetRealm = reignRealm.get(targetHouse);
      if (targetRealm === undefined || targetRealm === realmId) return;
      const key = `${realmId}->${targetRealm}`;
      if (!claims.has(key)) { claims.add(key); kinds[kind]++; }
    };
    // married in
    if (ruler.spouseId >= 0) { const sp = getPerson(world, ruler.spouseId); if (sp && sp.died < 0) add(houseOf(sp), "married"); }
    // descent: parent's spouse, and grandparent's spouse (two generations of "women's sons")
    add(otherParentHouse(ruler), "descent");
    const parent = ruler.parentId >= 0 ? getPerson(world, ruler.parentId) : null;
    if (parent) add(otherParentHouse(parent), "descent");
    // of the house — H_R reigns in a second realm (a cadet branch on two thrones)
    for (const [dynId, r2] of reignRealm) if (dynId === house && r2 !== realmId) add(house, "ofHouse");
  }
  return { nRulers: rulers.length, pairs: claims.size, kinds, examples: [...claims].slice(0, 6) };
}

const world = buildSim({ W, H, seed: SEED });
const acc = [], kindTot = { married: 0, descent: 0, ofHouse: 0 };
let peak = 0, lastEx = [];
for (let s = 0; s < STEPS; s += SAMPLE) {
  stepPeopleSim(world, Math.min(SAMPLE, STEPS - s));
  if (s + SAMPLE < WARMUP) continue;
  const m = measure(world);
  acc.push(m.pairs); if (m.pairs > peak) peak = m.pairs;
  for (const k in kindTot) kindTot[k] += m.kinds[k];
  if (m.examples.length) lastEx = m.examples;
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const frac = (a, n) => a.length ? a.filter(x => x >= n).length / a.length : 0;

console.log(`── standing cross-realm CLAIM graph · seed ${SEED} · ${STEPS} steps · CROSS_REALM_HEIRS=${T.CROSS_REALM_HEIRS} · ${acc.length} samples ──`);
console.log(`fireable claimant-war pairs (claimant realm → target realm), live at once:`);
console.log(`  mean ${mean(acc).toFixed(2)} · peak ${peak} · ≥1 in ${(frac(acc, 1) * 100).toFixed(0)}% of samples · ≥2 in ${(frac(acc, 2) * 100).toFixed(0)}%`);
console.log(`  by kind (cumulative first-seen): married-in ${kindTot.married} · descent ${kindTot.descent} · of-the-house ${kindTot.ofHouse}`);
if (lastEx.length) console.log(`  recent live claim pairs: ${lastEx.join(", ")}`);
