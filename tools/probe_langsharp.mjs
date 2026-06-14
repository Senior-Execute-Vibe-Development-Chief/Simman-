// Probe: is the language map as SHARP as "each country ≈ its own language"?
//
// Two measurable senses of that claim:
//   (A) DOMINANCE — within a realm, what share of its people speak the single
//       dominant tongue? (modern nation-states ≈ 0.9+; multilingual empires lower)
//   (B) BORDER SHARPNESS — do neighbouring places that share a country speak the
//       same tongue, while neighbours ACROSS a border speak different tongues?
//       (a sharp map: same-country match high, cross-border match low)
// Reported for LANGUAGE and, for contrast, for PEOPLE (ethnic identity).
//
//   node tools/probe_langsharp.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { dominantCulture, dominantLanguage } from "../src/sim/peopleSim/cultures.js";

const W = 320, H = 160, SEED = 4242, TARGET = 34000;
const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

let at = 0;
while (at < TARGET) { stepPeopleSim(world, 200); at += 200; }

// (A) dominant-tongue share per realm (population-weighted)
function dominanceFor(keyOf) {
  let realms = 0, sumTop = 0, mono85 = 0, mono95 = 0;
  for (const c of world.countries.values()) {
    const members = c.members.filter((m) => m.mode === "settled" && m.countryId === c.id);
    if (members.length < 4) continue;
    const byKey = new Map(); let tot = 0;
    for (const m of members) { const k = keyOf(m); if (k < 0) continue; const w = Math.max(1, m.people || 0); byKey.set(k, (byKey.get(k) || 0) + w); tot += w; }
    if (tot <= 0) continue;
    let top = 0; for (const v of byKey.values()) if (v > top) top = v;
    const share = top / tot;
    realms++; sumTop += share; if (share >= 0.85) mono85++; if (share >= 0.95) mono95++;
  }
  return { realms, avgTop: sumTop / Math.max(1, realms), mono85: mono85 / Math.max(1, realms), mono95: mono95 / Math.max(1, realms) };
}

// (B) border sharpness — neighbour pairs within R tiles, same vs different country
function bordersFor(keyOf) {
  const R = 7, R2 = R * R, tw = world.tw;
  const setts = world.settlements.filter((s) => s.mode === "settled" && s.countryId >= 0);
  let sameCtryN = 0, sameCtryMatch = 0, diffCtryN = 0, diffCtryMatch = 0;
  for (let i = 0; i < setts.length; i++) {
    const a = setts[i];
    for (let j = i + 1; j < setts.length; j++) {
      const b = setts[j];
      let dx = Math.abs(a.pos.x - b.pos.x); if (dx > tw / 2) dx = tw - dx;
      const dy = a.pos.y - b.pos.y;
      if (dx * dx + dy * dy > R2) continue;
      const ka = keyOf(a), kb = keyOf(b); if (ka < 0 || kb < 0) continue;
      const match = ka === kb ? 1 : 0;
      if (a.countryId === b.countryId) { sameCtryN++; sameCtryMatch += match; }
      else { diffCtryN++; diffCtryMatch += match; }
    }
  }
  return { sameMatch: sameCtryMatch / Math.max(1, sameCtryN), diffMatch: diffCtryMatch / Math.max(1, diffCtryN), sameN: sameCtryN, diffN: diffCtryN };
}

const langKey = (s) => dominantLanguage(s);
const culKey = (s) => dominantCulture(s);

console.log(`[probe] language sharpness — ${W}x${H} seed ${SEED}, step ${at}\n`);

const dL = dominanceFor(langKey), dC = dominanceFor(culKey);
console.log(`  (A) dominant ${"TONGUE".padEnd(6)} share within a realm: avg ${(dL.avgTop * 100).toFixed(0)}%  ·  realms ≥85% one tongue: ${(dL.mono85 * 100).toFixed(0)}%  ·  ≥95%: ${(dL.mono95 * 100).toFixed(0)}%   (${dL.realms} realms)`);
console.log(`      dominant ${"PEOPLE".padEnd(6)} share within a realm: avg ${(dC.avgTop * 100).toFixed(0)}%  ·  realms ≥85% one people: ${(dC.mono85 * 100).toFixed(0)}%  ·  ≥95%: ${(dC.mono95 * 100).toFixed(0)}%`);

const bL = bordersFor(langKey), bC = bordersFor(culKey);
console.log(`\n  (B) neighbours (≤7 tiles) speaking the SAME tongue:`);
console.log(`        same country : ${(bL.sameMatch * 100).toFixed(0)}%   across a border: ${(bL.diffMatch * 100).toFixed(0)}%   → border drop ${((bL.sameMatch - bL.diffMatch) * 100).toFixed(0)} pts`);
console.log(`      (people, for contrast)`);
console.log(`        same country : ${(bC.sameMatch * 100).toFixed(0)}%   across a border: ${(bC.diffMatch * 100).toFixed(0)}%   → border drop ${((bC.sameMatch - bC.diffMatch) * 100).toFixed(0)} pts`);
console.log(`\n  (sharp \"one country = one language\" ⇒ high dominance, high same-country match, low cross-border match)`);
