// Probe: political ethnogenesis — does a connected megapeople fragment along
// durable state lines (the Mediterranean → France/Spain/Italy, not one blob)?
//
// Measures over time:
//   • distinct dominant PEOPLES, and the LARGEST people's share of settled places
//     (a megapeople shows up as one people covering a big fraction; fragmentation
//     drops that share and raises the count);
//   • per realm (≥4 members): is its dominant people UNIQUE to it? (high ⇒ each
//     country ≈ its own people);
//   • distinct FAMILIES stay low (fragmentation is WITHIN a family — French and
//     Spanish are both Romance), so peoples ≫ families.
//
//   node tools/probe_ethnogenesis.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { dominantCulture, familyOf } from "../src/sim/peopleSim/cultures.js";

const W = 320, H = 160, SEED = 4242;
const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

function measure() {
  // peoples + largest share, over settled places
  const byPeople = new Map(); let total = 0;
  const families = new Set();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cid = dominantCulture(s); if (cid < 0) continue;
    total++; byPeople.set(cid, (byPeople.get(cid) || 0) + 1);
    families.add(familyOf(world, cid));
  }
  let largest = 0; for (const v of byPeople.values()) if (v > largest) largest = v;

  // per realm: dominant people, and whether it's unique to this realm
  const realmDom = [];                 // [{realm, people}]
  const realmsByPeople = new Map();    // people → #realms it's dominant in
  for (const c of world.countries.values()) {
    const members = c.members.filter((m) => m.mode === "settled" && m.countryId === c.id);
    if (members.length < 4) continue;
    const tally = new Map();
    for (const m of members) { const k = dominantCulture(m); if (k >= 0) tally.set(k, (tally.get(k) || 0) + 1); }
    let dom = -1, best = 0; for (const [k, n] of tally) if (n > best) { best = n; dom = k; }
    if (dom < 0) continue;
    realmDom.push({ realm: c.id, people: dom });
    realmsByPeople.set(dom, (realmsByPeople.get(dom) || 0) + 1);
  }
  const uniqueRealms = realmDom.filter((r) => realmsByPeople.get(r.people) === 1).length;

  return {
    peoples: byPeople.size, families: families.size,
    largestShare: largest / Math.max(1, total),
    realms: realmDom.length,
    realmUnique: uniqueRealms / Math.max(1, realmDom.length),
    nations: realmsByPeople.size,   // distinct peoples that are dominant in some realm
  };
}

console.log(`[probe] political ethnogenesis — ${W}x${H} seed ${SEED}\n`);
let at = 0;
for (const target of [12000, 20000, 30000]) {
  while (at < target) { stepPeopleSim(world, 200); at += 200; }
  const m = measure();
  console.log(`  step ${String(at).padStart(5)}  ` +
    `peoples ${String(m.peoples).padStart(3)} in ${m.families} families  ·  ` +
    `largest people = ${(m.largestShare * 100).toFixed(0)}% of places  ·  ` +
    `realms ${m.realms}: ${(m.realmUnique * 100).toFixed(0)}% have their OWN people  ·  ` +
    `distinct realm-peoples ${m.nations}`);
}
console.log(`\n  (fragmentation ⇒ largest-people share falls, realm-own-people rises, peoples ≫ families)`);
