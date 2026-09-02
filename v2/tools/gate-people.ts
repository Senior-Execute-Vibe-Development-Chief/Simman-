import assert from "node:assert/strict";
import populationCurve from "../data/reality/population-curve.json";
import farmingArrivals from "../data/reality/farming-arrivals.json";
import neolithicArrivals from "../data/reality/neolithic-arrivals.json";
import { buildSubstrate } from "../src/sim/substrate";
import { populationTotal } from "../src/sim/people";
import type { PeopleWorld } from "../src/sim/people/types";
import { runSteps, type GridPreset, World } from "../src/sim/world";
import { provenance } from "./lib/provenance";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import {
  CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS,
  CADENCE_TRAJECTORY_POP_TOLERANCE,
} from "../src/sim/constants";

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

if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");

function disposePeople(world: World): void {
  (world as PeopleWorld)._wasmPeopleKernel?.dispose();
}

function measure(grid: GridPreset): GridResult {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const world = new World({
    seed: 42042,
    grid,
    config: { preset: "earth_sim", horizon: "YD-to-1CE", peopleKernel: "wasm" },
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
    if ((world as PeopleWorld)._peopledMask[cell] !== 1 && (world.people[cell] ?? 0) !== 0) {
      emptyUnpeopledCells++;
    }
  }
  for (const hearth of world.hearths) if (hearth.ignited) ignitedHearths++;
  const balance = world.ledger.snapshot().people;
  const result = {
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
  disposePeople(world);
  return result;
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
// GATE_PEOPLE_LONG=1 both grids run the full YD→1 CE primary horizon; target
// is the shipped-grid verdict and dev remains the fast cross-grid comparison.
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

interface TrajectorySample {
  readonly curve: Array<{ year: number; people: number; inBand: boolean }>;
  readonly arrivalStep: Map<string, number>;
  readonly detailedArrivalStep: Map<string, number>;
  readonly southOfClimateBarrierBeforeWindow: boolean;
  readonly world: World;
}

function collectTrajectory(
  grid: GridPreset,
  config: Record<string, string | number | boolean> = {},
): TrajectorySample {
  const substrate = buildSubstrate(42042, { preset: "earth_sim" }, grid);
  const world = new World({
    seed: 42042,
    grid,
    config: {
      preset: "earth_sim",
      horizon: "YD-to-1CE",
      // The pre-warmed pool (threads) is hash-identical to serial — the
      // parity harness asserts it — and the long arm is hours serial.
      peopleKernel: "wasm",
      ...config,
    },
    substrate,
  });
  const checkpointSteps = populationCurve.bands
    .map((band) => ({ band, step: monthsFromYear(band.year) }))
    .filter(({ step }) => step >= 0 && step <= monthsFromYear(YD_START_YEAR + horizonYears));
  const arrivalStep = new Map<string, number>();
  const detailedArrivalStep = new Map<string, number>();
  const regionCells = new Map<string, readonly number[]>();
  const regionTables = [
    ...farmingArrivals.regions,
    ...neolithicArrivals.regions,
  ];
  for (const region of regionTables) {
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
  let southOfClimateBarrierBeforeWindow = false;
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
      for (const region of neolithicArrivals.regions) {
        if (detailedArrivalStep.has(region.id)) continue;
        const cells = regionCells.get(region.id) ?? [];
        for (const cell of cells) {
          if ((world.technique[cell] ?? 0) >= 0.5) {
            detailedArrivalStep.set(region.id, step);
            break;
          }
        }
      }
    }
    // The wall: nothing farmed inside the barrier box (data, not a mechanism)
    // when its window opens. A bare latitude limit caught every tropic on
    // Earth — Mesoamerica, India, New Guinea — not the Sahara.
    const barrier = neolithicArrivals.regions.find((region) => region.barrier !== undefined);
    if (barrier && step === monthsFromYear(barrier.earliest)) {
      const box = barrier.barrier ?? [];
      const minLon = box[0] ?? 0;
      const maxLon = box[1] ?? 0;
      const minLat = box[2] ?? 0;
      const maxLat = box[3] ?? 0;
      for (let cell = 0; cell < world.N; cell++) {
        if (!substrate.landMask[cell]) continue;
        const y = Math.floor(cell / world.width);
        const x = cell - y * world.width;
        const latitude = 90 - ((y + 0.5) / world.height) * 180;
        const longitude = ((x + 0.5) / world.width) * 360 - 180;
        if (longitude >= minLon && longitude <= maxLon && latitude >= minLat && latitude <= maxLat
          && (world.technique[cell] ?? 0) >= 0.5) {
          southOfClimateBarrierBeforeWindow = true;
          break;
        }
      }
    }
  }
  return { curve, arrivalStep, detailedArrivalStep, southOfClimateBarrierBeforeWindow, world };
}

function runCadenceArm(grid: GridPreset, shipped: TrajectorySample): void {
  const reference = collectTrajectory(grid, {
    peopleGrowthStride: 1,
    peopleMigrationStride: 1,
  });
  const popDeltas = reference.curve.map((point, index) => {
    const shippedPoint = shipped.curve[index];
    const people = shippedPoint?.people ?? 0;
    const relative = point.people > 0 ? Math.abs(people - point.people) / point.people : 0;
    return {
      year: point.year,
      reference: point.people,
      shipped: people,
      relative,
    };
  });
  const arrivalDeltas = farmingArrivals.regions.map((region) => {
    const refStep = reference.arrivalStep.get(region.id);
    const shippedStep = shipped.arrivalStep.get(region.id);
    const refYear = refStep === undefined ? null : YD_START_YEAR + refStep / 12;
    const shippedYear = shippedStep === undefined ? null : YD_START_YEAR + shippedStep / 12;
    const deltaYears = refYear !== null && shippedYear !== null
      ? Math.abs(shippedYear - refYear)
      : null;
    return { id: region.id, reference: refYear, shipped: shippedYear, deltaYears };
  });
  const popFail = popDeltas.filter((row) => row.relative > CADENCE_TRAJECTORY_POP_TOLERANCE);
  const arrivalFail = arrivalDeltas.filter((row) => (
    row.deltaYears !== null && row.deltaYears > CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS
  ));
  findings.cadence = {
    ...(findings.cadence as Record<string, unknown> ?? {}),
    [grid]: {
      schedule: shipped.world.schedule,
      referenceSchedule: reference.world.schedule,
      population: popDeltas,
      arrivals: arrivalDeltas,
    },
  };
  measured.add(`cadence-trajectory:${grid}`);
  if (popFail.length > 0 || arrivalFail.length > 0) {
    failures.push(`cadence-trajectory:${grid}`);
  }
  disposePeople(reference.world);
}

function arrivalSpeed(
  first: { readonly latitude: number; readonly longitude: number },
  second: { readonly latitude: number; readonly longitude: number },
  firstStep: number | undefined,
  secondStep: number | undefined,
): number | null {
  if (firstStep === undefined || secondStep === undefined || firstStep === secondStep) return null;
  const dx = (second.longitude - first.longitude) * 111 * Math.cos((first.latitude * Math.PI) / 180);
  const dy = (second.latitude - first.latitude) * 111;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance / Math.abs(secondStep - firstStep) * 12;
}

function runTrajectory(grid: GridPreset, shipped?: TrajectorySample): void {
  const {
    curve,
    arrivalStep,
    detailedArrivalStep,
    southOfClimateBarrierBeforeWindow,
    world,
  } = shipped ?? collectTrajectory(grid);
  const substrate = world.substrate!;
  const scope = `${grid}`;
  for (const point of curve) {
    const id = `population:${point.year}:${scope}`;
    measured.add(id);
    if (!point.inBand) failures.push(id);
  }
  const arrivals = farmingArrivals.regions.map((region) => {
    const step = arrivalStep.get(region.id);
    const year = step === undefined ? null : YD_START_YEAR + step / 12;
    const inWindow = year !== null && year >= region.earliest - 800 && year <= region.latest + 800;
    return { id: region.id, year, earliest: region.earliest, latest: region.latest, inWindow };
  });
  const trajectory = (findings.trajectory ?? {}) as Record<string, unknown>;
  const detailedArrivals = neolithicArrivals.regions.map((region) => {
    const step = detailedArrivalStep.get(region.id);
    const year = step === undefined ? null : YD_START_YEAR + step / 12;
    const inWindow = year !== null && year >= region.earliest - 800 && year <= region.latest + 800;
    return { id: region.id, year, earliest: region.earliest, latest: region.latest, inWindow };
  });
  trajectory[grid] = { curve, arrivals, detailedArrivals };
  findings.trajectory = trajectory;
  if (longArm) {
    for (const arrival of arrivals) {
      const id = `arrival:${arrival.id}:${scope}`;
      measured.add(id);
      if (!arrival.inWindow) failures.push(id);
    }
    for (const arrival of detailedArrivals) {
      const id = `arrival:${arrival.id}:${scope}`;
      measured.add(id);
      if (!arrival.inWindow) failures.push(id);
    }
    const detailedById = new Map(neolithicArrivals.regions.map((region) => [region.id, region]));
    const europeanSpeed = arrivalSpeed(
      detailedById.get("balkans")!,
      detailedById.get("rhine")!,
      detailedArrivalStep.get("balkans"),
      detailedArrivalStep.get("rhine"),
    );
    const meanSpeed = europeanSpeed;
    findings.front = {
      meanSpeedKmPerYear: meanSpeed,
      southOfClimateBarrierBeforeWindow,
    };
    if (meanSpeed !== null && (meanSpeed < 0.6 || meanSpeed > 1.3)) {
      const id = `europe-front-speed:${scope}`;
      measured.add(id);
      failures.push(id);
    }
    if (southOfClimateBarrierBeforeWindow) {
      const id = `climate-barrier:${scope}`;
      measured.add(id);
      failures.push(id);
    }
    // Density ordering at the final primary-horizon state.
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
    const ordering = (findings.densityOrdering ?? {}) as Record<string, unknown>;
    ordering[grid] = { river, rainfed, forager };
    findings.densityOrdering = ordering;
    measured.add(`density-ordering:${scope}`);
    if (!(river > rainfed && rainfed > forager)) failures.push(`density-ordering:${scope}`);
  } else {
    // The short arm keeps one trajectory horizon in the default gate.
    let ignited = 0;
    for (const hearth of world.hearths) if (hearth.ignited) ignited++;
    const ignition = (findings.ignitedAt3000Years ?? {}) as Record<string, unknown>;
    ignition[grid] = ignited;
    findings.ignitedAt3000Years = ignition;
    const id = `no-hearth-ignition-by-3000y:${scope}`;
    measured.add(id);
    if (ignited < 1) failures.push(id);
  }
  disposePeople(world);
}

// The stride arm and trajectory run at dev by default; the target grid
// (two 3000-year runs, ~1 h on a 4-core box) joins under GATE_PEOPLE_LONG=1
// or GATE_PEOPLE_TARGET=1 — the W4 review ran it once and recorded the
// deltas (QUESTIONS #36), the per-commit gate stays minutes.
const trajectoryGrids = longArm || process.env.GATE_PEOPLE_TARGET === "1"
  ? (["dev", "target"] as const)
  : (["dev"] as const);
for (const grid of trajectoryGrids) {
  const shipped = collectTrajectory(grid);
  runCadenceArm(grid, shipped);
  runTrajectory(grid, shipped);
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
    "The long horizon is primary at the shipped target grid; dev is retained as a cross-grid comparison.",
  ],
}));
process.exit(0);
