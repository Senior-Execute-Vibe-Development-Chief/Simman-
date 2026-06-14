// Probe: prehistoric / distance differentiation.
//
// The complaint: one people (and one tongue) spanning a huge connected strip —
// "Nile to Sweden", all of stone-age Africa or Europe speaking the same language.
// Distance drift should fragment a people once it spreads beyond its era's
// cohesion radius, WITHOUT needing isolation or a state — so even early/stateless,
// the biggest people/tongue covers only a modest patch, and the count is bounded.
//
//   node tools/probe_prehistory.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { dominantCulture, dominantLanguage, familyOf } from "../src/sim/peopleSim/cultures.js";

const W = 320, H = 160, SEED = 4242;
const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });
const tw = world.tw;

// geographic RADIUS of a group: max distance of any member from its most-populous
// member (torus-wrapped in x). Reported as a % of map width.
function radiusPct(members) {
  let core = members[0];
  for (const m of members) if ((m.people || 0) > (core.people || 0)) core = m;
  let mx = 0;
  for (const m of members) {
    let dx = Math.abs(m.pos.x - core.pos.x); if (dx > tw / 2) dx = tw - dx;
    const dy = m.pos.y - core.pos.y; const d = Math.sqrt(dx * dx + dy * dy);
    if (d > mx) mx = d;
  }
  return (100 * mx) / tw;
}

function groupBy(keyOf) {
  const g = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const k = keyOf(s); if (k < 0) continue;
    let a = g.get(k); if (!a) g.set(k, a = []); a.push(s);
  }
  return g;
}

function measure() {
  const byP = groupBy((s) => dominantCulture(s));
  const byL = groupBy((s) => dominantLanguage(s));
  const fams = new Set(); for (const k of byP.keys()) fams.add(familyOf(world, k));
  const big = (g) => { let best = null; for (const a of g.values()) if (!best || a.length > best.length) best = a; return best; };
  const bigP = big(byP), bigL = big(byL);
  let total = 0; for (const a of byP.values()) total += a.length;
  return {
    peoples: byP.size, families: fams.size, langs: byL.size,
    bigPeopleShare: (100 * bigP.length) / total, bigPeopleRadius: radiusPct(bigP),
    bigLangShare: (100 * bigL.length) / total, bigLangRadius: radiusPct(bigL),
  };
}

console.log(`[probe] prehistoric / distance differentiation — ${W}x${H} seed ${SEED}\n`);
let at = 0;
for (const target of [5000, 12000, 20000, 30000]) {
  while (at < target) { stepPeopleSim(world, 200); at += 200; }
  const m = measure();
  console.log(`  step ${String(at).padStart(5)}  ` +
    `peoples ${String(m.peoples).padStart(3)} / langs ${String(m.langs).padStart(3)} / families ${m.families}  ·  ` +
    `biggest people ${m.bigPeopleShare.toFixed(0)}% of places, reaches ${m.bigPeopleRadius.toFixed(0)}% of map  ·  ` +
    `biggest tongue ${m.bigLangShare.toFixed(0)}%, reaches ${m.bigLangRadius.toFixed(0)}%`);
}
console.log(`\n  total cultures ever minted: ${(world._nextCultureId || 1) - 1}  (bounded ⇒ no runaway fragmentation)`);
console.log(`  (fix ⇒ biggest people/tongue reaches only a modest % of the map, even early)`);
