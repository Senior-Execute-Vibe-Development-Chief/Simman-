import assert from "node:assert/strict";
import populationCurve from "../data/reality/population-curve.json";
import farmingArrivals from "../data/reality/farming-arrivals.json";
import { buildSubstrate } from "../src/sim/substrate";
import { populationTotal } from "../src/sim/people";
import { runSteps, type GridPreset, World } from "../src/sim/world";
import { provenance } from "./lib/provenance";

interface GridResult {
  readonly grid: GridPreset;
  readonly initialPeople: number;
  readonly finalPeople: number;
  readonly techniqueCoverage: number;
  readonly ignitedHearths: number;
  readonly hearthCount: number;
  readonly emptyUnpeopledCells: number;
  readonly conservationError: number;
  readonly provenance: ReturnType<typeof provenance>;
}

const FAST_MONTHS = 12;

function measure(grid: GridPreset): GridResult {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const world = new World({
    seed: 42042,
    grid,
    config: { preset: "earth_sim", horizon: "YD-to-1CE" },
    substrate,
  });
  const initialPeople = populationTotal(world);
  runSteps(world, FAST_MONTHS);
  const finalPeople = populationTotal(world);
  let land = 0;
  let covered = 0;
  let ignitedHearths = 0;
  let emptyUnpeopledCells = 0;
  for (let cell = 0; cell < world.N; cell++) {
    if (!substrate.landMask[cell]) continue;
    land++;
    if ((world.technique[cell] ?? 0) >= 0.01) covered++;
    const ancestry = substrate.ancestry.lineage[cell] ?? -1;
    if (ancestry < 0 && (world.people[cell] ?? 0) !== 0) emptyUnpeopledCells++;
  }
  for (const hearth of world.hearths) if (hearth.ignited) ignitedHearths++;
  const balance = world.ledger.snapshot().people;
  return {
    grid,
    initialPeople,
    finalPeople,
    techniqueCoverage: land > 0 ? covered / land : 0,
    ignitedHearths,
    hearthCount: world.hearths.length,
    emptyUnpeopledCells,
    conservationError: balance?.unexplained ?? Number.POSITIVE_INFINITY,
    provenance: provenance(world),
  };
}

const dev = measure("dev");
const target = measure("target");
const initialBand = populationCurve.bands[0];
if (!initialBand) throw new Error("Population reality fixture has no opening band.");
assert.ok(dev.initialPeople >= initialBand.minimum && dev.initialPeople <= initialBand.maximum);
assert.ok(target.initialPeople >= initialBand.minimum && target.initialPeople <= initialBand.maximum);
assert.ok(dev.finalPeople >= dev.initialPeople, "dev population must not fall during the opening window");
assert.ok(target.finalPeople >= target.initialPeople, "target population must not fall during the opening window");
assert.equal(dev.emptyUnpeopledCells, 0);
assert.equal(target.emptyUnpeopledCells, 0);
assert.ok(Math.abs(dev.conservationError) < 0.001);
assert.ok(Math.abs(target.conservationError) < 0.001);

const initialParity = Math.abs(dev.initialPeople - target.initialPeople)
  / Math.max(dev.initialPeople, target.initialPeople, 1);
const warnings = [
  "The fast mechanical arm samples the opening window; the full YD→1 CE curve is run in the overnight gate battery.",
  `Farming arrival fixture contains ${farmingArrivals.regions.length} archaeological regions; arrival timing is pending the long horizon arm.`,
];
console.log(JSON.stringify({
  gate: "pass",
  horizon: "YD-to-1CE",
  mode: "fast-mechanical-opening-window",
  populationCurve: populationCurve.source,
  farmingArrivals: farmingArrivals.source,
  crossGridInitialRelativeDifference: initialParity,
  crossGrid: initialParity <= 0.25 ? "pass" : "warning",
  grids: [dev, target],
  warnings,
}));
