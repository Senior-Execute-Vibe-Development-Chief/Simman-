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
    const arrival = substrate.ancestry.arrival[cell] ?? -1;
    if ((ancestry < 0 || arrival < 0) && (world.people[cell] ?? 0) !== 0) {
      emptyUnpeopledCells++;
    }
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

// ── The horizon arms (M2 review). ──────────────────────────────────────────
// Default: a ~3000-year dev trajectory arm — long enough for the first hearth
// ignitions and the early wave, cheap enough for every gate run. With
// GATE_PEOPLE_LONG=1: the full YD→1 CE dev arm checks the real M2 table —
// population checkpoint bands, farming arrival order and timing, density
// ordering — with misses acknowledged in data/reality/known-misses-people.json
// or failing the gate. The TARGET-grid long horizon stays a recorded
// limitation (QUESTIONS #30): ~0.8 s/tick × 116k ticks is not a gate arm
// until the banded/wasm kernel lands; dev is the fast sanity, and carries the
// verdict alone for now, honestly labeled.
const YD_START_YEAR = -9700;
const monthsFromYear = (year: number): number => Math.round((year - YD_START_YEAR) * 12);
const longArm = process.env.GATE_PEOPLE_LONG === "1";
const horizonYears = longArm ? 1 - YD_START_YEAR : 3000;

interface KnownPeopleMiss { readonly id: string; readonly reason: string; }
let peopleMisses: readonly KnownPeopleMiss[] = [];
try {
  peopleMisses = (await import("../data/reality/known-misses-people.json", { with: { type: "json" } })).default.misses;
} catch { peopleMisses = []; }
const acknowledged = new Map(peopleMisses.map((miss) => [miss.id, miss.reason]));
const failures: string[] = [];
// Only checks the CURRENT arm actually concludes participate in the
// stale-ratchet: the fast trajectory arm must not read the long-horizon
// manifest rows as stale merely because it cannot measure them.
const measured = new Set<string>();
const findings: Record<string, unknown> = {};

{
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, "dev");
  const world = new World({
    seed: 42042,
    grid: "dev",
    config: { preset: "earth_sim", horizon: "YD-to-1CE" },
    substrate,
  });
  const checkpointSteps = populationCurve.bands
    .map((band) => ({ band, step: monthsFromYear(band.year) }))
    .filter(({ step }) => step >= 0 && step <= monthsFromYear(YD_START_YEAR + horizonYears));
  const arrivalStep = new Map<string, number>();
  const regionCells = new Map<string, readonly number[]>();
  for (const region of farmingArrivals.regions) {
    const cells: number[] = [];
    for (let cell = 0; cell < world.N; cell++) {
      if (!substrate.landMask[cell]) continue;
      const y = Math.floor(cell / world.width);
      const x = cell - y * world.width;
      const lat = 90 - ((y + 0.5) / world.height) * 180;
      const lon = ((x + 0.5) / world.width) * 360 - 180;
      if (Math.abs(lat - region.latitude) <= 3 && Math.abs(lon - region.longitude) <= 3) cells.push(cell);
    }
    regionCells.set(region.id, cells);
  }
  const curve: Array<{ year: number; people: number; inBand: boolean }> = [];
  let nextCheckpoint = 0;
  const totalSteps = monthsFromYear(YD_START_YEAR + horizonYears);
  for (let step = 0; step <= totalSteps; step++) {
    if (step > 0) runSteps(world, 1);
    while (nextCheckpoint < checkpointSteps.length
      && checkpointSteps[nextCheckpoint]!.step === step) {
      const { band } = checkpointSteps[nextCheckpoint]!;
      const people = populationTotal(world);
      curve.push({ year: band.year, people, inBand: people >= band.minimum && people <= band.maximum });
      nextCheckpoint++;
    }
    if (step % 120 === 0) {
      for (const region of farmingArrivals.regions) {
        if (arrivalStep.has(region.id)) continue;
        const cells = regionCells.get(region.id) ?? [];
        for (const cell of cells) {
          if ((world.technique[cell] ?? 0) >= 0.5) { arrivalStep.set(region.id, step); break; }
        }
      }
    }
  }
  for (const point of curve) {
    measured.add(`population:${point.year}`);
    if (!point.inBand) failures.push(`population:${point.year}`);
  }
  findings.curve = curve;
  const arrivals = farmingArrivals.regions.map((region) => {
    const step = arrivalStep.get(region.id);
    const year = step === undefined ? null : YD_START_YEAR + step / 12;
    const inWindow = year !== null && year >= region.earliest - 800 && year <= region.latest + 800;
    return { id: region.id, year, earliest: region.earliest, latest: region.latest, inWindow };
  });
  findings.arrivals = arrivals;
  if (longArm) {
    for (const arrival of arrivals) {
      measured.add(`arrival:${arrival.id}`);
      if (!arrival.inWindow) failures.push(`arrival:${arrival.id}`);
    }
    // Density ordering at the -3000 checkpoint class boundaries, measured on
    // the final state as the mid-run proxy the fast arm can afford.
    let riverPeople = 0; let riverArea = 0;
    let rainfedPeople = 0; let rainfedArea = 0;
    let foragerPeople = 0; let foragerArea = 0;
    for (let cell = 0; cell < world.N; cell++) {
      if (!substrate.landMask[cell]) continue;
      const area = world.cellAreaKm2[cell] ?? 0;
      const technique = world.technique[cell] ?? 0;
      const flood = substrate.floodplain[cell] ?? 0;
      if (technique >= 0.5 && flood > 0.1) { riverPeople += (world.people[cell] ?? 0) * area; riverArea += area; }
      else if (technique >= 0.5) { rainfedPeople += (world.people[cell] ?? 0) * area; rainfedArea += area; }
      else { foragerPeople += (world.people[cell] ?? 0) * area; foragerArea += area; }
    }
    const river = riverArea > 0 ? riverPeople / riverArea : 0;
    const rainfed = rainfedArea > 0 ? rainfedPeople / rainfedArea : 0;
    const forager = foragerArea > 0 ? foragerPeople / foragerArea : 0;
    findings.densityOrdering = { river, rainfed, forager };
    measured.add("density-ordering");
    if (!(river > rainfed && rainfed > forager)) failures.push("density-ordering");
  } else {
    // Trajectory arm: at 3000 years the first hearths must have ignited and
    // the wave must be moving; the curve checkpoints inside the window bind.
    let ignited = 0;
    for (const hearth of world.hearths) if (hearth.ignited) ignited++;
    findings.ignitedAt3000Years = ignited;
    measured.add("no-hearth-ignition-by-3000y");
    if (ignited < 1) failures.push("no-hearth-ignition-by-3000y");
  }
}

const unacknowledged = failures.filter((id) => !acknowledged.has(id));
const stale = [...acknowledged.keys()].filter((id) => measured.has(id) && !failures.includes(id));
// Print the measurements BEFORE asserting: an honest failure must still
// report what it measured, or the miss cannot be reasoned into the manifest.
if (unacknowledged.length > 0 || stale.length > 0) {
  console.log(JSON.stringify({ gate: "fail", findings, failures, unacknowledged, stale }));
}
assert.deepEqual(unacknowledged, [], `unacknowledged people-gate failures: ${unacknowledged.join(", ")}`);
assert.deepEqual(stale, [], `stale people known-misses: ${stale.join(", ")}`);

console.log(JSON.stringify({
  gate: "pass",
  horizon: longArm ? "YD-to-1CE-full" : "YD-plus-3000y-trajectory",
  mode: longArm ? "long-dev-arm" : "fast-mechanical-plus-trajectory",
  populationCurve: populationCurve.source,
  farmingArrivals: farmingArrivals.source,
  crossGridInitialRelativeDifference: initialParity,
  crossGrid: initialParity <= 0.25 ? "pass" : "warning",
  grids: [dev, target],
  findings,
  knownMisses: [...acknowledged.entries()].map(([id, reason]) => ({ id, reason })),
  warnings: [
    "The target-grid long horizon is a recorded limitation (QUESTIONS #30) pending the banded/wasm kernel; the dev arm carries the horizon verdict.",
  ],
}));
