// THE CITY ARC — the owner's five city symptoms, measured as a time series.
//
// Owner 2026-08: "we dont really have a historically accurate city situation.
// either not enough, cities in no where wilderness, stone age cities, no cities
// being born, trade roads being huge very early and odd looking."
//
// Each symptom is a measurable claim about the ARC, not a snapshot:
//   • stone age cities      → at the step the first city label appears, what is
//                             the leading civ's development (agri/org/metal)?
//                             A city before farming matures is the bug.
//   • roads huge very early → road-tile count over time. Under an honest ladder
//                             villages (tier 0) plan no trunk roads
//                             (ROAD_MIN_TIER), so the web should START at ~0 and
//                             grow with real towns — not saturate at dawn.
//   • no cities being born  → settlement.tier promotion events over the run:
//                             first town, first city, and the running count.
//   • wilderness cities     → tier≥2 with countryId < 0 at each checkpoint.
//   • not enough            → the tier pyramid at each checkpoint (does it
//                             look like villages ≫ towns ≫ cities?).
//
//   SIM_TUNE="CITY_CORE=1" node tools/probe_cityarc.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const CHECK = 500;

const lead = (k) => {
  let m = 0;
  for (const s of world.settlements) if (s.mode === "settled" && s.knowledge) m = Math.max(m, s.knowledge[k] || 0);
  return m;
};
const firstSeen = new Map();   // tier -> {step, dev} recorded at the checkpoint AFTER the event fired

console.log(`CITY_CORE=${T.CITY_CORE | 0}  W=${W} seed=${SEED} steps=${STEPS}`);
console.log(`step | vill town city metro | realms wild% | roadTiles | leadAgri leadOrg leadMetal`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % CHECK !== 0 && i !== STEPS - 1) continue;
  const setts = world.settlements.filter((s) => s.mode === "settled");
  const tiers = [0, 0, 0, 0];
  let wild = 0;
  for (const s of setts) {
    tiers[Math.max(0, Math.min(3, s.tier | 0))]++;
    if (s.countryId < 0) wild++;
  }
  const realms = world.countries ? world.countries.size : 0;
  const wildPct = Math.round((100 * wild) / Math.max(1, setts.length));
  const roads = world._roadTiles ? world._roadTiles.size : 0;
  console.log(
    `${String(world.step).padStart(5)} | ${String(tiers[0]).padStart(4)} ${String(tiers[1]).padStart(4)} ${String(tiers[2]).padStart(4)} ${String(tiers[3]).padStart(5)} | ${String(realms).padStart(6)} ${String(wildPct + "%").padStart(5)} | ${String(roads).padStart(9)} | ${lead("agriculture").toFixed(2).padStart(8)} ${lead("organization").toFixed(2).padStart(7)} ${lead("metallurgy").toFixed(2).padStart(9)}`
  );
  for (const t of [1, 2, 3]) {
    if (!firstSeen.has(t) && tiers.slice(t).some((n) => n > 0)) {
      firstSeen.set(t, { step: world.step, agri: lead("agriculture"), org: lead("organization"), metal: lead("metallurgy") });
    }
  }
}

// The chronicle's own record: first promotion EVENTS (exact steps, not checkpoint-quantised).
const dissolved = (world.events || []).filter((e) => e.type === "settlement.dissolved").length;
if (dissolved) console.log(`\nsettlements faded back into the countryside over the run: ${dissolved}`);
const evs = (world.events || []).filter((e) => e.type === "settlement.tier" && e.up);
const firstEv = new Map();
for (const e of evs) if (!firstEv.has(e.tier)) firstEv.set(e.tier, e);
console.log(`\npromotion events over the run: ${evs.length}  (by rung: ` +
  [1, 2, 3].map((t) => `${t}:${evs.filter((e) => e.tier === t).length}`).join("  ") + `)`);
for (const t of [1, 2, 3]) {
  const e = firstEv.get(t);
  if (e) console.log(`  first ${e.tierName || "tier" + t}: step ${e.step}  "${e.sName}"  core-census ${e.people}`);
  else console.log(`  first tier-${t}: never`);
}
for (const [t, d] of firstSeen) {
  console.log(`  dev when tier≥${t} first seen at a checkpoint (step ${d.step}): agri ${d.agri.toFixed(2)}  org ${d.org.toFixed(2)}  metal ${d.metal.toFixed(2)}`);
}
