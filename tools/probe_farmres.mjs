// IS THE FARM LEDGER RESOLUTION-INVARIANT? A direct two-grid comparison of every
// term between a tile and a plate of bread.
//
// WHY THIS EXISTS. urban-claim-memo recorded _landFood/_coreNeed at p50 0.101 on
// the shipped grid against 8.202 on the reference grid — "an 81x regime difference
// in the same statistic" — flagged it as exactly what the THIRD CARDINAL RULE
// warns about, and did not identify the cause. Reading the code suggests one
// (settlement.js:3370-3 states the resolution rule for the population scan, scales
// its radius by rNormPop and converts counts to reference-tile units; the farm path
// at territory.js:128 / settlement.js:2802 does neither), but a code reading is a
// HYPOTHESIS, and a first pass at the arithmetic did not cleanly reproduce even the
// SIGN of the measured difference, let alone its size. So measure it.
//
// Every printed quantity is a per-settlement median, at two grids, with the real
// area each tile stands for. A term that is resolution-invariant should hold its
// value; a term that is not will move with a power of rn = tw/240, and the power
// says which correction is missing (rn^1 -> a radius in tiles, rn^2 -> an area sum
// in tile units).
//
//   node tools/probe_farmres.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";
import { coreRadiusFor, hinterlandRadiusFor } from "../src/sim/peopleSim/territory.js";

const STEPS = +(process.argv[2] || 3000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);

const world = buildSim({ W, H, seed: SEED });
let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;

while (world.step < STEPS) stepPeopleSim(world, 1);

const settled = world.settlements.filter(s => s.mode === "settled" && s.people > 0);
const med = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const pick = (f) => med(settled.map(f).filter(Number.isFinite));

const rn = rNormPop(world);
console.log(`\n[farmres] W=${W} tw=${world.tw} rn=${rn.toFixed(2)} seed=${SEED} steps=${STEPS} settled=${settled.length}`);
console.log(`[farmres] one tile = ${Math.round(km2PerTile)} km2 (${Math.round(Math.sqrt(km2PerTile))} km across)`);
// WHICH TILE-DENOMINATED TERM ACTUALLY BINDS. Three of them set how much ground a
// settlement works, and all three are counted in TILES, so all three shrink in real
// area as the grid refines: the guaranteed core block (CORE_BY_TIER), the guaranteed
// farm belt (HINTERLAND_BY_TIER), and the Dijkstra reach budget
// (TERRITORY_BASE + reach*ORG_REACH, in transport-cost units where "a plain tile =
// 1.0"). Fixing the wrong one is worse than fixing none, so print all three beside
// the tile count they are competing to set. A radius r covers ~pi*r^2 tiles; if the
// actual count tracks the belt's area the belt binds, if it far exceeds it the
// budget does.
const TERRITORY_BASE_ECHO = 5;   // territory.js:48, echoed (not exported)
const budgetOf = (s) => TERRITORY_BASE_ECHO + ((s._reachLevel || s.reachLevel || 0) * T.ORG_REACH);
const rows = [
  ["core radius   (tiles)", pick(s => coreRadiusFor(s, world))],
  ["belt radius   (tiles)", pick(s => hinterlandRadiusFor(s, world))],
  ["belt area implied by radius (tiles)", pick(s => Math.PI * hinterlandRadiusFor(s, world) ** 2)],
  ["Dijkstra budget (tile-costs)", pick(s => budgetOf(s))],
  ["belt tiles        _terrTiles", pick(s => s._terrTiles)],
  ["worked tiles      _terrWorkTiles", pick(s => s._terrWorkTiles)],
  ["fertility SUM     _terrFertSum", pick(s => s._terrFertSum)],
  ["farm output       _landFood", pick(s => s._landFood)],
  ["core need         _coreNeed", pick(s => s._coreNeed)],
  ["catchment census  s.people", pick(s => s.people)],
  ["urban core        s._urbanPop", pick(s => s._urbanPop)],
  ["food supply       _foodSupply", pick(s => s._foodSupply)],
  ["food demand       _foodDemand", pick(s => s._foodDemand)],
];
for (const [k, v] of rows) console.log(`    ${k.padEnd(34)} ${v.toFixed(4)}`);
console.log(`    ${"RATIO _landFood / _coreNeed".padEnd(34)} ${(pick(s => (s._coreNeed > 0 ? s._landFood / s._coreNeed : NaN))).toFixed(4)}   <- the 81x statistic`);
console.log(`    ${"belt REAL AREA km2".padEnd(34)} ${Math.round(pick(s => s._terrTiles) * km2PerTile)}`);
console.log(`    ${"fert per REAL Mkm2".padEnd(34)} ${(pick(s => s._terrFertSum) / Math.max(1e-9, pick(s => s._terrTiles) * km2PerTile / 1e6)).toFixed(2)}`);
console.log(`    ${"farm output per REAL Mkm2".padEnd(34)} ${(pick(s => s._landFood) / Math.max(1e-9, pick(s => s._terrTiles) * km2PerTile / 1e6)).toFixed(4)}`);
