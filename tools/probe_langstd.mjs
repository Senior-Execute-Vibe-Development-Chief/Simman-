// Probe: state-prestige language standardization.
//
// Confirms the mechanism added to updateCultures: a realm's provinces converge
// on the CAPITAL's language, with the pull decaying by transport distance from
// the capital. We expect, across sizable realms:
//   • the well-connected CORE shares the capital's tongue far more than the FRONTIER;
//   • that gap WIDENS over time (the heartland Latinizes; the marches resist).
//
//   node tools/probe_langstd.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getCulture, dominantCulture } from "../src/sim/peopleSim/cultures.js";

const W = 320, H = 160, SEED = 4242;
const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

// Distance bucket for a member, from its stamped capital-relative transport cost.
function bucketOf(m, reach) {
  const cost = m._capCostId === m.countryId ? m._capCost : reach;
  if (!isFinite(cost)) return "far";
  if (cost <= reach * 0.5) return "core";
  if (cost <= reach) return "mid";
  return "far";
}
function langOf(world, cultureId) {
  const c = getCulture(world, cultureId);
  return c ? c.languageId : -1;
}

// Across every realm of >= minMembers, tally how many member provinces speak the
// CAPITAL's language, split by distance bucket.
function measure(world, minMembers = 5) {
  const acc = { core: { n: 0, same: 0 }, mid: { n: 0, same: 0 }, far: { n: 0, same: 0 } };
  let realms = 0, biggest = null, biggestN = 0;
  for (const c of world.countries.values()) {
    const members = c.members.filter((m) => m.mode === "settled" && m.countryId === c.id);
    if (members.length < minMembers || !c.capital) continue;
    realms++;
    const reach = Math.max(8, c.holdReach || c.range || 20);
    const capLang = langOf(world, dominantCulture(c.capital));
    if (members.length > biggestN) { biggestN = members.length; biggest = c; }
    for (const m of members) {
      if (m.id === c.capitalId) continue;
      const b = acc[bucketOf(m, reach)];
      b.n++;
      if (langOf(world, dominantCulture(m)) === capLang) b.same++;
    }
  }
  return { acc, realms, biggest, biggestN };
}

function pct(s) { return s.n ? ((100 * s.same) / s.n).toFixed(0) + "%" : "  –"; }
function report(world, label) {
  const { acc, realms } = measure(world);
  console.log(
    `  ${label.padEnd(12)} realms=${String(realms).padStart(2)}  ` +
    `core ${pct(acc.core).padStart(4)} (${String(acc.core.n).padStart(3)})  ` +
    `mid ${pct(acc.mid).padStart(4)} (${String(acc.mid.n).padStart(3)})  ` +
    `frontier ${pct(acc.far).padStart(4)} (${String(acc.far.n).padStart(3)})`
  );
}

console.log(`[probe] state-prestige language standardization — ${W}x${H} seed ${SEED}`);
console.log("        share of member provinces speaking the CAPITAL's language, by transport distance:\n");

const checkpoints = [12000, 20000, 30000];
let at = 0;
for (const target of checkpoints) {
  while (at < target) { const n = Math.min(1000, target - at); stepPeopleSim(world, n); at += n; }
  report(world, `step ${at}`);
}

// A worked example: the largest realm — capital tongue + how its provinces line up.
const { biggest } = measure(world);
if (biggest) {
  const reach = Math.max(8, biggest.holdReach || biggest.range || 20);
  const capCul = getCulture(world, dominantCulture(biggest.capital));
  const capLang = capCul ? capCul.languageId : -1;
  console.log(`\n  largest realm: capital "${biggest.capital.name}" — people ${capCul ? capCul.name : "?"} (lang #${capLang}), ${biggest.members.length} members, reach ${reach.toFixed(0)}`);
  const byB = { core: [], mid: [], far: [] };
  for (const m of biggest.members) {
    if (m.id === biggest.capitalId || m.mode !== "settled") continue;
    const cul = getCulture(world, dominantCulture(m));
    byB[bucketOf(m, reach)].push((cul ? cul.name : "?") + (cul && cul.languageId === capLang ? "*" : ""));
  }
  for (const b of ["core", "mid", "far"]) {
    console.log(`    ${b.padEnd(4)}: ${byB[b].slice(0, 12).join(", ")}${byB[b].length > 12 ? " …" : ""}`);
  }
  console.log("    (* = already speaks the capital's tongue)");
}
