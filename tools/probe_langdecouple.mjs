// Probe: language ↔ people DECOUPLING.
//
// Before this change a settlement's language was a 1:1 readout of its people, so
// the Languages map was just a recolour of the Peoples map. Now language is its
// own layer (s.langMix) that shifts toward the capital's prestige tongue faster
// than ethnic identity follows. This probe confirms the two layers actually pull
// apart:
//   • DECOUPLING RATE — share of places whose SPOKEN tongue is no longer their
//     own people's native tongue (0 would mean still welded 1:1).
//   • PRESTIGE SPREAD — share of provinces that speak their CAPITAL's language
//     while remaining a DIFFERENT people (a conquered people, ruler's speech).
//   • PER-REALM — distinct languages vs distinct peoples among members (the
//     prestige tongue consolidates speech below the ethnic diversity).
//
//   node tools/probe_langdecouple.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getCulture, dominantCulture, dominantLanguage, langIdOfCulture } from "../src/sim/peopleSim/cultures.js";

const W = 320, H = 160, SEED = 4242;
const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

function measure() {
  let total = 0, decoupled = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.culMix || !s.culMix.length) continue;
    total++;
    const spoken = dominantLanguage(s);
    const native = langIdOfCulture(world, dominantCulture(s));   // the people's OWN tongue
    if (spoken >= 0 && native >= 0 && spoken !== native) decoupled++;
  }
  // prestige spread + per-realm diversity
  let provinces = 0, speakCapTongue = 0, capTongueDiffPeople = 0;
  let realmN = 0, sumLangs = 0, sumPeoples = 0;
  for (const c of world.countries.values()) {
    const members = c.members.filter((m) => m.mode === "settled" && m.countryId === c.id);
    if (members.length < 4 || !c.capital) continue;
    realmN++;
    const capLang = dominantLanguage(c.capital), capCul = dominantCulture(c.capital);
    const langs = new Set(), peoples = new Set();
    for (const m of members) {
      langs.add(dominantLanguage(m)); peoples.add(dominantCulture(m));
      if (m.id === c.capitalId) continue;
      provinces++;
      if (dominantLanguage(m) === capLang) {
        speakCapTongue++;
        if (dominantCulture(m) !== capCul) capTongueDiffPeople++;
      }
    }
    sumLangs += langs.size; sumPeoples += peoples.size;
  }
  return { total, decoupled, provinces, speakCapTongue, capTongueDiffPeople, realmN, sumLangs, sumPeoples };
}

console.log(`[probe] language ↔ people decoupling — ${W}x${H} seed ${SEED}\n`);
let at = 0;
for (const target of [10000, 18000, 26000]) {
  while (at < target) { stepPeopleSim(world, 200); at += 200; }
  const m = measure();
  console.log(`  step ${String(at).padStart(5)}  ` +
    `decoupled ${(100 * m.decoupled / Math.max(1, m.total)).toFixed(0)}% of ${m.total} places  ·  ` +
    `provinces on capital-tongue ${(100 * m.speakCapTongue / Math.max(1, m.provinces)).toFixed(0)}% ` +
    `(of which a DIFFERENT people: ${(100 * m.capTongueDiffPeople / Math.max(1, m.speakCapTongue)).toFixed(0)}%)  ·  ` +
    `per realm: ${(m.sumLangs / Math.max(1, m.realmN)).toFixed(1)} tongues vs ${(m.sumPeoples / Math.max(1, m.realmN)).toFixed(1)} peoples`);
}

// a worked example: the largest realm — its capital tongue vs its provinces' peoples
let big = null, bn = 0;
for (const c of world.countries.values()) { const n = c.members.filter(m => m.mode === "settled" && m.countryId === c.id).length; if (n > bn && c.capital) { bn = n; big = c; } }
if (big) {
  const capLang = dominantLanguage(big.capital), capCul = dominantCulture(big.capital);
  const capCulName = (getCulture(world, capCul) || {}).name;
  let shifted = 0, kept = 0, list = [];
  for (const m of big.members) {
    if (m.id === big.capitalId || m.mode !== "settled" || m.countryId !== big.id) continue;
    const sameP = dominantCulture(m) === capCul, sameL = dominantLanguage(m) === capLang;
    if (!sameP && sameL) { shifted++; if (list.length < 8) list.push((getCulture(world, dominantCulture(m)) || {}).name + "→cap-tongue"); }
    else if (!sameP && !sameL) kept++;
  }
  console.log(`\n  largest realm: capital ${big.capital.name} (people ${capCulName})`);
  console.log(`    foreign provinces speaking the CAPITAL's tongue but keeping their people: ${shifted}`);
  console.log(`    foreign provinces still on their own tongue: ${kept}`);
  if (list.length) console.log(`    e.g. ${list.join(", ")}`);
}
