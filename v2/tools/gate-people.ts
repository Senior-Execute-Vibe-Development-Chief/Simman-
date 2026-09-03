import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import populationCurve from "../data/reality/population-curve.json";
import farmingArrivals from "../data/reality/farming-arrivals.json";
import neolithicArrivals from "../data/reality/neolithic-arrivals.json";
import hearthCentres from "../data/reality/hearths.json";
import stapleByRegion from "../data/reality/staple-by-region.json";
import { aquaticAccess } from "../src/sim/people/habitability";
import { CROP_PACKAGES } from "../src/ported/worldgen/cropPackages.js";
import { buildSubstrate } from "../src/sim/substrate";
import { populationTotal } from "../src/sim/people";
import type { PeopleWorld } from "../src/sim/people/types";
import { runSteps, stepWorld, type GridPreset, World } from "../src/sim/world";
import { stepFromYear, yearFromStep } from "../src/sim/horizon";
import { provenance } from "./lib/provenance";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import {
  CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS,
  CADENCE_TRAJECTORY_POP_TOLERANCE,
  HORIZON_END_YEAR,
  HORIZON_OPENING_YEAR,
  MONTHS_PER_YEAR,
  PEOPLE_FARMED_MARKER_SHARE,
  SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS,
  SOLVE_AGREEMENT_POP_TOLERANCE,
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

const FAST_STEPS = 12;

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
  runSteps(world, FAST_STEPS);
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

// ── The horizon arms. ──────────────────────────────────────────────────────
// The awake (monthly) kernel simulates history and never runs per commit:
// its ~3000-year dev trajectory and the stride arm run under
// GATE_PEOPLE_TRAJECTORY=1, the full YD→1 CE batteries at both grids under
// GATE_PEOPLE_LONG=1 (the long workflow). The SOLVE regime (W5) is the same
// passes on the clock the farmer bound permits — seconds at either grid —
// and runs the full horizon with every reality instrument on every commit.
const longArm = process.env.GATE_PEOPLE_LONG === "1";
const horizonYears = longArm ? HORIZON_END_YEAR - HORIZON_OPENING_YEAR : 3000;
const fullHorizonStep = stepFromYear(HORIZON_END_YEAR);

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

interface RegionRow {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly earliest: number;
  readonly latest: number;
  readonly barrier?: readonly number[];
}

interface TrajectorySample {
  readonly curve: Array<{ year: number; step: number; people: number; inBand: boolean }>;
  readonly arrivalStep: Map<string, number>;
  readonly detailedArrivalStep: Map<string, number>;
  readonly southOfClimateBarrierBeforeWindow: boolean;
  readonly world: World;
  readonly wallMilliseconds: number;
}

function regionCellsOf(world: World, regions: readonly RegionRow[]): Map<string, readonly number[]> {
  const substrate = world.substrate!;
  const regionCells = new Map<string, readonly number[]>();
  for (const region of regions) {
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
  return regionCells;
}

/** The first step any cell of the region counted as farmed, from the world's arrival recorder. */
function regionArrival(world: World, cells: readonly number[]): number | undefined {
  const people = world as PeopleWorld;
  let first: number | undefined;
  for (const cell of cells) {
    const packed = people._packedOf[cell] ?? -1;
    if (packed < 0) continue;
    const step = people._arrivalStep[packed] ?? -1;
    if (step >= 0 && (first === undefined || step < first)) first = step;
  }
  return first;
}

function insideBox(world: World, cell: number, box: readonly number[]): boolean {
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  const latitude = 90 - ((y + 0.5) / world.height) * 180;
  const longitude = ((x + 0.5) / world.width) * 360 - 180;
  return longitude >= (box[0] ?? 0) && longitude <= (box[1] ?? 0)
    && latitude >= (box[2] ?? 0) && latitude <= (box[3] ?? 0);
}

/**
 * Run a world to a horizon in whichever regime its config puts it, sampling
 * the population at every checkpoint band (the first step at or past it —
 * a solve step may overshoot by up to its stride; the step is recorded) and
 * the barrier box when its window opens. Arrivals come from the recorder.
 */
function collectTrajectory(
  grid: GridPreset,
  config: Record<string, string | number | boolean>,
  horizonStep: number,
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
  const checkpoints = populationCurve.bands
    .map((band) => ({ band, step: stepFromYear(band.year) }))
    .filter(({ step }) => step >= 0 && step <= horizonStep)
    .sort((left, right) => left.step - right.step);
  const barrier = neolithicArrivals.regions.find((region) => region.barrier !== undefined);
  const barrierStep = barrier ? stepFromYear(barrier.earliest) : Number.POSITIVE_INFINITY;
  const curve: TrajectorySample["curve"] = [];
  let southOfClimateBarrierBeforeWindow = false;
  let barrierChecked = false;
  let nextCheckpoint = 0;
  const started = performance.now();
  const sample = (): void => {
    while (nextCheckpoint < checkpoints.length && checkpoints[nextCheckpoint]!.step <= world.step) {
      const { band } = checkpoints[nextCheckpoint]!;
      const people = populationTotal(world);
      curve.push({ year: band.year, step: world.step, people, inBand: people >= band.minimum && people <= band.maximum });
      nextCheckpoint++;
    }
    // The wall: nothing farmed inside the barrier box (data, not a
    // mechanism) when its window opens. A bare latitude limit caught every
    // tropic on Earth — Mesoamerica, India, New Guinea — not the Sahara.
    if (barrier && !barrierChecked && world.step >= barrierStep && barrierStep <= horizonStep) {
      barrierChecked = true;
      for (let cell = 0; cell < world.N; cell++) {
        if (!substrate.landMask[cell]) continue;
        if (insideBox(world, cell, barrier.barrier ?? []) && (world.technique[cell] ?? 0) >= PEOPLE_FARMED_MARKER_SHARE) {
          southOfClimateBarrierBeforeWindow = true;
          break;
        }
      }
    }
  };
  sample();
  while (world.step < horizonStep) {
    stepWorld(world);
    sample();
  }
  const wallMilliseconds = performance.now() - started;
  const arrivalStep = new Map<string, number>();
  const detailedArrivalStep = new Map<string, number>();
  const regionCells = regionCellsOf(world, [...farmingArrivals.regions, ...neolithicArrivals.regions]);
  for (const region of farmingArrivals.regions) {
    const step = regionArrival(world, regionCells.get(region.id) ?? []);
    if (step !== undefined) arrivalStep.set(region.id, step);
  }
  for (const region of neolithicArrivals.regions) {
    const step = regionArrival(world, regionCells.get(region.id) ?? []);
    if (step !== undefined) detailedArrivalStep.set(region.id, step);
  }
  return { curve, arrivalStep, detailedArrivalStep, southOfClimateBarrierBeforeWindow, world, wallMilliseconds };
}

function runCadenceArm(grid: GridPreset, shipped: TrajectorySample, horizonStep: number): void {
  const reference = collectTrajectory(grid, {
    wake: HORIZON_OPENING_YEAR,
    peopleGrowthStride: 1,
    peopleMigrationStride: 1,
  }, horizonStep);
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
    const refYear = refStep === undefined ? null : yearFromStep(refStep);
    const shippedYear = shippedStep === undefined ? null : yearFromStep(shippedStep);
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
      schedule: shipped.world.awakeSchedule,
      referenceSchedule: reference.world.awakeSchedule,
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
  return distance / Math.abs(secondStep - firstStep) * MONTHS_PER_YEAR;
}

function densityOrdering(world: World): { river: number; rainfed: number; forager: number } {
  const substrate = world.substrate!;
  let riverPeople = 0; let riverArea = 0;
  let rainfedPeople = 0; let rainfedArea = 0;
  let foragerPeople = 0; let foragerArea = 0;
  for (let cell = 0; cell < world.N; cell++) {
    if (!substrate.landMask[cell]) continue;
    const area = world.cellAreaKm2[cell] ?? 0;
    const technique = world.technique[cell] ?? 0;
    const flood = substrate.floodplain[cell] ?? 0;
    if (technique >= PEOPLE_FARMED_MARKER_SHARE && flood > 0.1) { riverPeople += (world.people[cell] ?? 0) * area; riverArea += area; }
    else if (technique >= PEOPLE_FARMED_MARKER_SHARE) { rainfedPeople += (world.people[cell] ?? 0) * area; rainfedArea += area; }
    else { foragerPeople += (world.people[cell] ?? 0) * area; foragerArea += area; }
  }
  return {
    river: riverArea > 0 ? riverPeople / riverArea : 0,
    rainfed: rainfedArea > 0 ? rainfedPeople / rainfedArea : 0,
    forager: foragerArea > 0 ? foragerPeople / foragerArea : 0,
  };
}

/**
 * The reality instruments over a completed run: population bands, both
 * arrival tables, the Europe front speed band, the wall, the density
 * ordering. `scope` names the arm and grid in every id; `full` says the run
 * reached the horizon's end so the long-horizon rows are measured.
 */
function judgeTrajectory(sample: TrajectorySample, scope: string, full: boolean): Record<string, unknown> {
  const { curve, arrivalStep, detailedArrivalStep, southOfClimateBarrierBeforeWindow, world } = sample;
  for (const point of curve) {
    const id = `population:${point.year}:${scope}`;
    measured.add(id);
    if (!point.inBand) failures.push(id);
  }
  const arrivals = farmingArrivals.regions.map((region) => {
    const step = arrivalStep.get(region.id);
    const year = step === undefined ? null : yearFromStep(step);
    const inWindow = year !== null && year >= region.earliest - 800 && year <= region.latest + 800;
    return { id: region.id, year, earliest: region.earliest, latest: region.latest, inWindow };
  });
  const detailedArrivals = neolithicArrivals.regions.map((region) => {
    const step = detailedArrivalStep.get(region.id);
    const year = step === undefined ? null : yearFromStep(step);
    const inWindow = year !== null && year >= region.earliest - 800 && year <= region.latest + 800;
    return { id: region.id, year, earliest: region.earliest, latest: region.latest, inWindow };
  });
  const result: Record<string, unknown> = { curve, arrivals, detailedArrivals, wallMilliseconds: sample.wallMilliseconds };
  if (!full) return result;
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
  const meanSpeed = arrivalSpeed(
    detailedById.get("balkans")!,
    detailedById.get("rhine")!,
    detailedArrivalStep.get("balkans"),
    detailedArrivalStep.get("rhine"),
  );
  result.front = { meanSpeedKmPerYear: meanSpeed, southOfClimateBarrierBeforeWindow };
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
  const ordering = densityOrdering(world);
  result.densityOrdering = ordering;
  measured.add(`density-ordering:${scope}`);
  if (!(ordering.river > ordering.rainfed && ordering.rainfed > ordering.forager)) {
    failures.push(`density-ordering:${scope}`);
  }
  return result;
}

function runTrajectory(grid: GridPreset, shipped: TrajectorySample): void {
  const { world } = shipped;
  const scope = `${grid}`;
  const trajectory = (findings.trajectory ?? {}) as Record<string, unknown>;
  trajectory[grid] = judgeTrajectory(shipped, scope, longArm);
  findings.trajectory = trajectory;
  if (!longArm) {
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
}

function cellLonLat(world: World, cell: number): { lon: number; lat: number } | null {
  if (cell < 0) return null;
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  return {
    lat: Math.round((90 - ((y + 0.5) / world.height) * 180) * 10) / 10,
    lon: Math.round((((x + 0.5) / world.width) * 360 - 180) * 10) / 10,
  };
}

function cellDistanceDegrees(world: World, cell: number, latitude: number, longitude: number): number {
  const at = cellLonLat(world, cell);
  if (!at) return Number.POSITIVE_INFINITY;
  const dLon = Math.abs(((at.lon - longitude + 540) % 360) - 180);
  return Math.max(Math.abs(at.lat - latitude), dLon);
}

/**
 * The centres of domestication (W8): every hearth must sit inside a cited
 * centre of its package, and every centre must have lit by its latest.
 * The count per centre is reported; it is a measurement now, not a spacing.
 */
function judgeHearths(world: World, scope: string): Record<string, unknown> {
  const radius = hearthCentres.radiusDegrees;
  const perCentre: Record<string, { hearths: number; first: number | null; regionCells: number; inWindow: boolean }> = {};
  const outside: Array<{ packageId: string; year: number; lat: number; lon: number }> = [];
  for (const centre of hearthCentres.centres) perCentre[centre.id] = { hearths: 0, first: null, regionCells: 0, inWindow: false };
  for (const hearth of world.hearths) {
    if (!hearth.ignited) continue;
    const year = Math.round(yearFromStep(hearth.ignitedStep));
    const centre = hearthCentres.centres.find((row) => row.packageId === hearth.packageId
      && cellDistanceDegrees(world, hearth.cell, row.latitude, row.longitude) <= ((row as { radiusDegrees?: number }).radiusDegrees ?? radius));
    if (!centre) {
      const at = cellLonLat(world, hearth.cell);
      outside.push({ packageId: hearth.packageId, year, lat: at?.lat ?? 0, lon: at?.lon ?? 0 });
      continue;
    }
    const row = perCentre[centre.id]!;
    row.hearths++;
    row.regionCells += hearth.regionCells;
    if (row.first === null || year < row.first) row.first = year;
  }
  for (const centre of hearthCentres.centres) {
    const row = perCentre[centre.id]!;
    row.inWindow = row.first !== null && row.first >= centre.earliest - 800 && row.first <= centre.latest + 800;
    const id = `hearth:${centre.id}:${scope}`;
    measured.add(id);
    if (!row.inWindow) failures.push(id);
  }
  const outsidePackages = new Set(outside.map((row) => row.packageId));
  for (const pkg of CROP_PACKAGES) {
    const id = `hearth-outside:${pkg.id}:${scope}`;
    measured.add(id);
    if (outsidePackages.has(pkg.id)) failures.push(id);
  }
  return { centres: perCentre, outside };
}

/** The staple by region at 1 CE (W8): the majority dominant package of a region's farmed cells. */
function judgeStaples(world: World, scope: string): Record<string, unknown> {
  const radius = stapleByRegion.radiusDegrees;
  const result: Record<string, unknown> = {};
  for (const region of stapleByRegion.regions) {
    const counts = new Map<string, number>();
    let farmed = 0;
    for (let cell = 0; cell < world.N; cell++) {
      if (!world.substrate!.landMask[cell]) continue;
      if ((world.technique[cell] ?? 0) < PEOPLE_FARMED_MARKER_SHARE) continue;
      if (cellDistanceDegrees(world, cell, region.latitude, region.longitude) > radius) continue;
      farmed++;
      const id = CROP_PACKAGES[(world as PeopleWorld)._dominantPackage[cell] ?? 0]?.id ?? "";
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let dominant = "";
    let dominantCount = 0;
    for (const [id, count] of counts) if (count > dominantCount) { dominant = id; dominantCount = count; }
    const pass = farmed > 0 && dominant === region.packageId;
    result[region.id] = { expected: region.packageId, dominant: dominant || null, farmedCells: farmed, pass };
    const id = `staple:${region.id}:${scope}`;
    measured.add(id);
    if (!pass) failures.push(id);
  }
  return result;
}

/**
 * Forager density by habitat at the opening (W8, Binford): shores and stands
 * hold denser foragers than fertile interior land, which holds denser than
 * desert and boreal land. Measured on the static forager capacity.
 */
function judgeForagerOrdering(world: World, scope: string): Record<string, unknown> {
  const people = world as PeopleWorld;
  const sums = { aquaticOrStand: [0, 0], fertileInterior: [0, 0], poorInterior: [0, 0] };
  for (const cell of people._landCells) {
    if (people._peopledMask[cell] !== 1) continue;
    const capacity = people._foragerCapacity[cell] ?? 0;
    const fertility = world.substrate!.fertility[cell] ?? 0;
    const rich = aquaticAccess(people, cell) >= 0.5 || (people._standBest[cell] ?? 0) >= 0.5;
    const bucket = rich ? sums.aquaticOrStand : fertility >= 0.6 ? sums.fertileInterior : fertility < 0.2 ? sums.poorInterior : null;
    if (!bucket) continue;
    bucket[0] += capacity;
    bucket[1] += 1;
  }
  const mean = (pair: number[]) => (pair[1]! > 0 ? pair[0]! / pair[1]! : 0);
  const ordering = { aquaticOrStand: mean(sums.aquaticOrStand), fertileInterior: mean(sums.fertileInterior), poorInterior: mean(sums.poorInterior) };
  const id = `forager-ordering:${scope}`;
  measured.add(id);
  if (!(ordering.aquaticOrStand > ordering.fertileInterior && ordering.fertileInterior > ordering.poorInterior)) failures.push(id);
  return ordering;
}

/**
 * The solve arm (W5): the solve regime to the end of the horizon, with the
 * caged-basin trigger recorded but not acted on (`wake: "never"`), so every
 * reality instrument is measured at both grids on every commit, and the
 * step the world WOULD have woken at is printed as a development clock.
 */
function runSolveArm(grid: GridPreset): TrajectorySample {
  const sample = collectTrajectory(grid, { wake: "never" }, fullHorizonStep);
  const scope = `solve:${grid}`;
  const { world } = sample;
  const solve = (findings.solve ?? {}) as Record<string, unknown>;
  solve[grid] = {
    ...judgeTrajectory(sample, scope, true),
    stride: world.solveStride,
    steps: world.debug.ticks,
    cagedStep: world.cagedStep,
    cagedYear: world.cagedStep >= 0 ? yearFromStep(world.cagedStep) : null,
    cagedWindowCentre: cellLonLat(world, world.cagedCell),
    hearths: world.hearths.map((hearth) => ({
      packageId: hearth.packageId,
      cell: hearth.cell,
      year: yearFromStep(hearth.ignitedStep),
      regionCells: hearth.regionCells,
    })),
    centres: judgeHearths(world, scope),
    staples: judgeStaples(world, scope),
    foragerOrdering: judgeForagerOrdering(world, scope),
  };
  findings.solve = solve;
  return sample;
}

/**
 * The agreement arm: the awake kernel from the opening against the solve
 * regime over the same horizon. Bounds on the median per-cell arrival delta
 * and the checkpoint populations; the 90th percentile, the reached-set
 * difference, the hearth deltas and the dominant-package difference are
 * reported until the first measurement says what they are.
 */
function runAgreementArm(grid: GridPreset, awake: TrajectorySample, horizonStep: number): void {
  const solve = collectTrajectory(grid, { wake: "never" }, horizonStep);
  const left = awake.world as PeopleWorld;
  const right = solve.world as PeopleWorld;
  const deltas: number[] = [];
  let onlyAwake = 0;
  let onlySolve = 0;
  let farmedBoth = 0;
  let packageDiffers = 0;
  for (let packed = 0; packed < left._landCells.length; packed++) {
    const a = left._arrivalStep[packed] ?? -1;
    const b = right._arrivalStep[packed] ?? -1;
    if (a >= 0 && b >= 0) {
      deltas.push(Math.abs(a - b) / MONTHS_PER_YEAR);
      farmedBoth++;
      const cell = left._landCells[packed] ?? 0;
      if (left._dominantPackage[cell] !== right._dominantPackage[cell]) packageDiffers++;
    } else if (a >= 0) onlyAwake++;
    else if (b >= 0) onlySolve++;
  }
  deltas.sort((x, y) => x - y);
  const median = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] ?? 0 : 0;
  const p90 = deltas.length > 0 ? deltas[Math.min(deltas.length - 1, Math.floor(0.9 * deltas.length))] ?? 0 : 0;
  const population = awake.curve.map((point, index) => {
    const other = solve.curve[index];
    const relative = point.people > 0 && other ? Math.abs(other.people - point.people) / point.people : 0;
    return { year: point.year, awake: point.people, solve: other?.people ?? null, relative };
  });
  const hearthDeltas = awake.world.hearths.map((hearth) => {
    const match = solve.world.hearths
      .filter((other) => other.packageId === hearth.packageId)
      .sort((x, y) => Math.abs(x.ignitedStep - hearth.ignitedStep) - Math.abs(y.ignitedStep - hearth.ignitedStep))[0];
    return {
      packageId: hearth.packageId,
      awakeYear: yearFromStep(hearth.ignitedStep),
      solveYear: match ? yearFromStep(match.ignitedStep) : null,
      deltaYears: match ? Math.abs(match.ignitedStep - hearth.ignitedStep) / MONTHS_PER_YEAR : null,
    };
  });
  const agreement = (findings.solveAgreement ?? {}) as Record<string, unknown>;
  agreement[grid] = {
    arrival: { medianYears: median, p90Years: p90, farmedBoth, onlyAwake, onlySolve, landCells: left._landCells.length },
    population,
    hearths: { awake: awake.world.hearths.length, solve: solve.world.hearths.length, deltas: hearthDeltas },
    dominantPackageDiffers: farmedBoth > 0 ? packageDiffers / farmedBoth : 0,
    solveWallMilliseconds: solve.wallMilliseconds,
    awakeWallMilliseconds: awake.wallMilliseconds,
  };
  findings.solveAgreement = agreement;
  const arrivalId = `solve-agreement-arrival:${grid}`;
  measured.add(arrivalId);
  if (median > SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS) failures.push(arrivalId);
  const popId = `solve-agreement-population:${grid}`;
  measured.add(popId);
  if (population.some((row) => row.relative > SOLVE_AGREEMENT_POP_TOLERANCE)) failures.push(popId);
  disposePeople(solve.world);
}

// The per-commit solve arm at dev (seconds). At the shipped grid a solve
// step is about 0.3 s serial and the full horizon 1,386 of them — minutes,
// past the per-commit budget the W5 spec set — so the target solve arm
// joins under GATE_PEOPLE_SOLVE_TARGET=1 (the long workflow, and any long
// arm). The awake trajectory, stride and agreement arms run at dev under
// GATE_PEOPLE_TRAJECTORY=1 and at both grids under GATE_PEOPLE_LONG=1 /
// GATE_PEOPLE_TARGET=1 (two 3000-year monthly runs at target are an hour).
const solveGrids: readonly GridPreset[] = process.env.GATE_PEOPLE_SOLVE_TARGET === "1"
  || process.env.GATE_PEOPLE_LONG === "1" || process.env.GATE_PEOPLE_TARGET === "1"
  ? ["dev", "target"]
  : ["dev"];
for (const grid of solveGrids) {
  const sample = runSolveArm(grid);
  disposePeople(sample.world);
}

const trajectoryArm = process.env.GATE_PEOPLE_TRAJECTORY === "1" || longArm
  || process.env.GATE_PEOPLE_TARGET === "1";
const trajectoryGrids = longArm || process.env.GATE_PEOPLE_TARGET === "1"
  ? (["dev", "target"] as const)
  : (["dev"] as const);
if (trajectoryArm) {
  const horizonStep = stepFromYear(HORIZON_OPENING_YEAR + horizonYears);
  for (const grid of trajectoryGrids) {
    const shipped = collectTrajectory(grid, { wake: HORIZON_OPENING_YEAR }, horizonStep);
    runCadenceArm(grid, shipped, horizonStep);
    runTrajectory(grid, shipped);
    runAgreementArm(grid, shipped, horizonStep);
    disposePeople(shipped.world);
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
  horizon: longArm ? "YD-to-1CE-full" : trajectoryArm ? "YD-plus-3000y-trajectory" : "mechanical-12-steps-plus-solve",
  mode: longArm ? "long-dev-arm" : trajectoryArm ? "fast-mechanical-plus-trajectory" : "fast-mechanical-plus-solve",
  solveGrids,
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
