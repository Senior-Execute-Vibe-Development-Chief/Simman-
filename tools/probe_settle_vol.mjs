// Settlement volatility referee — which levers collapse the register?
//   node tools/probe_settle_vol.mjs [steps=45000] [seed=8817] [W=480]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 45000);
const SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 480), H = W >> 1;

const ARMS = [
  ["live", {}],
  ["no_harvest", { HARVEST_YEARS: 0 }],
  ["no_lean", { LEAN_YEAR: 0 }],
  ["no_harvest_lean", { HARVEST_YEARS: 0, LEAN_YEAR: 0 }],
  ["no_stamp_retire", { STAMP_RETIRE: 0 }],
  ["no_market_pull", { MARKET_PULL: 0 }],
  ["no_starve_shed", { STARVE_SHED: 0 }],
  ["no_food_gate", { URBAN_FOOD_GATE: 0 }],
  ["no_dissolve_towns", { DISSOLVE_TOWNS: 0 }],
];

function countEvents(world) {
  const types = ["settlement.withered", "settlement.abandoned", "settlement.lapsed",
    "settlement.founded", "settlement.dissolved", "famine.struck"];
  const c = Object.fromEntries(types.map(t => [t, 0]));
  for (const ev of world.events || []) if (c[ev.type] !== undefined) c[ev.type]++;
  return c;
}

function endSnap(world) {
  const settled = world.settlements.filter(s => s.mode === "settled");
  let lean = 0, lowFed = 0, deficitUi = 0;
  for (const s of settled) {
    const need = s._coreNeed || 0;
    const flow = s._foodSupply || 0;
    const store = s.food || 0;
    const surplus = flow - (s._foodDemand || 0);
    if (s._harvestYearMul !== undefined && s._harvestYearMul < 0.85) lean++;
    if ((s._fedM ?? 1) < 0.7) lowFed++;
    if (surplus < -0.02 && !(store > need * 4)) deficitUi++;
  }
  return { n: settled.length, lean, lowFed, deficitUi };
}

console.log(`\n=== SETTLEMENT VOLATILITY  W=${W} seed=${SEED} steps=${STEPS} ===\n`);
console.log("arm".padEnd(20) + "settled  w/ab/lap/diss  fam.str  lean%  lowFed%  uiDef%  founded");
console.log("-".repeat(88));

for (const [label, overrides] of ARMS) {
  resetTuning();
  applyTuning({ ...SIM_TUNE_OVERRIDES, ...overrides });
  const world = buildSim({ W, H, seed: SEED });
  for (let s = 0; s < STEPS; s++) stepPeopleSim(world, 1);
  const ev = countEvents(world);
  const snap = endSnap(world);
  const deaths = `${ev["settlement.withered"]}/${ev["settlement.abandoned"]}/${ev["settlement.lapsed"]}/${ev["settlement.dissolved"] || 0}`;
  console.log(
    label.padEnd(20) +
    String(snap.n).padStart(6) + "  " +
    deaths.padStart(14) + "  " +
    String(ev["famine.struck"]).padStart(7) + "  " +
    String((100 * snap.lean / Math.max(1, snap.n)).toFixed(0)).padStart(5) + "%  " +
    String((100 * snap.lowFed / Math.max(1, snap.n)).toFixed(0)).padStart(7) + "%  " +
    String((100 * snap.deficitUi / Math.max(1, snap.n)).toFixed(0)).padStart(6) + "%  " +
    String(ev["settlement.founded"]).padStart(7)
  );
}
