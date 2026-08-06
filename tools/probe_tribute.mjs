// THE STOREHOUSE ECONOMY, MEASURED — does tribute give pre-city nations an
// economy, and realms a land-based fisc?
//
// Prints at checkpoints: polity counts by kind, total tribute in store (land
// nations vs realms), treasury totals (the Egypt-channel monetisation), and
// famine mortality (settlement.starved events) — the Joseph's-granary effect
// reads as an A/B on deaths.
//
//   SIM_TUNE="TRIBUTE_OF_LAND=1,..." node tools/probe_tribute.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
console.log(`TRIBUTE_OF_LAND=${T.TRIBUTE_OF_LAND | 0} STATE_OF_LAND=${T.STATE_OF_LAND | 0} DAWN_LIVE=${T.DAWN_LIVE | 0} CITY_AT_BIRTH=${T.CITY_AT_BIRTH | 0}  W=${W} seed=${SEED}`);
console.log(`step | landNations realms | tribute: land / realm | metal | prestige | treasury Σ | famine Σ`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % 1000 !== 0 && i !== STEPS - 1) continue;
  const seats = world._landSeats;
  const nLand = seats ? seats.size : 0;
  const nRealm = world.countries ? world.countries.size : 0;
  let tribLand = 0, tribRealm = 0, treas = 0, metal = 0, prest = 0;
  if (world.polities) for (const [id, p] of world.polities) {
    if (p.endedStep >= 0) continue;
    if (seats && seats.has(id)) tribLand += p.tribute || 0;
    else tribRealm += p.tribute || 0;
    treas += p.treasury || 0;
    metal += p.metal || 0;
    prest += p.prestige || 0;
  }
  let starved = 0;
  for (const e of world.events || []) if (e.type === "settlement.starved" || e.type === "famine.struck") starved++;
  console.log(`${String(world.step).padStart(5)} | ${String(nLand).padStart(11)} ${String(nRealm).padStart(6)} | ${tribLand.toFixed(0).padStart(7)} / ${tribRealm.toFixed(0).padStart(6)} | ${metal.toFixed(1).padStart(5)} | ${prest.toFixed(1).padStart(8)} | ${treas.toFixed(0).padStart(9)} | ${starved}`);
}
