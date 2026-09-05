import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { entityRng, hash32, mkRng, passRng } from "../src/ported/rng";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { populationTotal } from "../src/sim/people";
import { runRoutingBatteries } from "../src/sim/travel/battery";
import type { Substrate } from "../src/sim/substrate";
import type { PeopleWorld } from "../src/sim/people/types";
import { hashWorld, runSteps, World } from "../src/sim/world";
import { ensurePeopleWasm } from "../src/sim/peopleKernel";
import {
  passDtMonths,
  passFires,
  resolveSchedule,
  resolveSolveStrides,
  solveClockMonths,
  solveSpanMonths,
} from "../src/sim/scheduler";
import {
  HORIZON_OPENING_YEAR,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_CHANNEL_STRIP_KM,
  PEOPLE_CHILD_AGE_YEARS,
  PEOPLE_FARMED_MARKER_SHARE,
  PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_GROWTH_FORAGER_FACTOR,
  PEOPLE_GROWTH_STRIDE_MONTHS,
  PEOPLE_GROWTH_TECHNIQUE_GAIN,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_R_GROWTH_PER_YEAR,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
} from "../src/sim/constants";
import { migrationShareForArea } from "../src/sim/people/migration";
import { deriveCapacity } from "../src/sim/people/capacity";
import { deriveTechniqueFromFarmers, markPackageActive, packageCapacity, standCapacity } from "../src/sim/people/crop";
import { hearthAccrualRate } from "../src/sim/people/technique";
import { cellAreasKm2 } from "../src/sim/people/habitability";
import { mixtureCapacity } from "../src/sim/people/capacity";
import { CROP_PACKAGES, pkgMoistureBell, pkgTemperatureBell } from "../src/ported/worldgen/cropPackages.js";
import { stepFromYear } from "../src/sim/horizon";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PRIMED_HEARTH_YEARS = 1e6;
const rngInputs = {
  seed: 123456789,
  system: "golden.system",
  step: 37,
  entity: 9001,
};

function v1RngVectors(): unknown {
  const script = `
    import { hash32, mkRng, passRng, entityRng } from "./src/sim/peopleSim/rng.js";
    const input = ${JSON.stringify(rngInputs)};
    const stream = (rng) => [rng(), rng(), rng(), rng()];
    console.log(JSON.stringify({
      hash: hash32(input.seed, input.system, input.step),
      raw: stream(mkRng(input.seed)),
      pass: stream(passRng({ seed: input.seed, step: input.step }, input.system)),
      entity: stream(entityRng({ seed: input.seed }, input.system, input.entity)),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repoRoot,
    encoding: "utf8",
  }));
}

function tsRngVectors(): unknown {
  const stream = (rng: ReturnType<typeof mkRng>) => [rng(), rng(), rng(), rng()];
  return {
    hash: hash32(rngInputs.seed, rngInputs.system, rngInputs.step),
    raw: stream(mkRng(rngInputs.seed)),
    pass: stream(passRng(rngInputs.seed, rngInputs.system, rngInputs.step)),
    entity: stream(entityRng(rngInputs.seed, rngInputs.system, rngInputs.entity)),
  };
}

function peopleFixture(): Substrate {
  const width = 240;
  const height = 120;
  const cells = width * height;
  const monthly = cells * 12;
  const temperature = new Float32Array(monthly);
  const moisture = new Float32Array(monthly);
  temperature.fill(0.72);
  moisture.fill(0.5);
  const landMask = new Uint8Array(cells);
  landMask.fill(1);
  const ancestry = new Int16Array(cells);
  const arrival = new Float32Array(cells);
  ancestry.fill(0);
  return {
    seed: 0,
    grid: "dev",
    width,
    height,
    N: cells,
    preset: "people-fixture",
    elevation: new Float32Array(cells),
    landMask,
    climate: { temperature, moisture },
    wind: { u: new Float32Array(monthly), v: new Float32Array(monthly) },
    temperature,
    moisture,
    rivers: {
      magnitude: new Uint8Array(cells),
      direction: new Uint8Array(cells).fill(255),
      flowAccum: new Float32Array(cells),
      runoff: new Float32Array(cells),
      lake: new Int32Array(cells).fill(-1),
    },
    ancestry: {
      lineage: ancestry,
      arrival,
      count: 1,
      hue: new Float32Array(1),
      light: new Float32Array(1),
      originFx: 0,
      originFy: 0,
    },
    floodplain: new Float32Array(cells),
    biome: new Uint8Array(cells),
    soil: new Float32Array(cells),
    fertility: new Float32Array(cells).fill(0.5),
    wildCropSuitability: new Float32Array(cells).fill(0.5),
    crossingCost: new Float32Array(cells),
    resources: {},
    relief: new Float32Array(cells),
    coast: new Uint8Array(cells),
    coastDistanceKm: new Float32Array(cells),
  };
}

async function main(): Promise<void> {
  if (!await ensurePeopleWasm()) throw new Error("People WASM failed to initialize.");
  assert.deepEqual(tsRngVectors(), v1RngVectors(), "RNG port diverged from v1 oracle");
  assert.equal(checkDmathGoldens().length, 26);
  const routing = await runRoutingBatteries();
  assert.ok(routing.every((result) => result.queries >= 72));

  const world = new World({
    seed: 77,
    grid: "dev",
    config: { scenario: "save-round-trip", marker: 1 },
  });
  runSteps(world, 17);
  const saved = serializeWorld(world);
  const loaded = loadWorld(saved);
  assert.equal(hashWorld(loaded), hashWorld(world));
  assert.equal(serializeWorld(loaded), saved);
  runSteps(world, 31);
  runSteps(loaded, 31);
  assert.equal(hashWorld(loaded), hashWorld(world));

  const extra = world as unknown as Record<string, unknown>;
  extra.extraState = { numericLeaf: 12 };
  const metrics = collect(world);
  assert.equal(metrics["world.extraState.numericLeaf"], 12);
  assert.equal(metrics["field.people.n"], world.N);
  assert.equal(metrics["field.technique.n"], world.N);
  assert.equal(metrics["field.people.sum.n"], undefined);

  const substrate = peopleFixture();
  const peopleWorld = new World({
    seed: 99,
    grid: "dev",
    config: { peopleKernel: "wasm", peopleWorkers: 1 },
    substrate,
  });
  const opening = populationTotal(peopleWorld);
  const packedWorld = peopleWorld as PeopleWorld;
  for (const name of [
    "_peopleNext",
    "_techniqueNext",
    "_childrenMass",
    "_workingMass",
    "_eldersMass",
    "_childrenNext",
    "_workingNext",
    "_eldersNext",
    "_migrationOut",
    "_migrationWeight",
    "_migrationPopulation",
    "_migrationReceived",
  ]) {
    assert.equal(
      (packedWorld as unknown as Record<string, Float64Array>)[name]?.length,
      packedWorld._landCells.length,
      `${name} must be land-packed`,
    );
  }
  for (const name of ["people", "technique", "children", "working", "elders", "capField"]) {
    assert.equal(
      (packedWorld as unknown as Record<string, Float64Array>)[name]?.length,
      packedWorld.N,
      `${name} must retain its full-grid view`,
    );
  }
  for (const band of packedWorld._peopleBands) {
    const first = packedWorld._landCells[band.rawLo];
    const last = packedWorld._landCells[band.rawHi - 1];
    if (first !== undefined) assert.ok(first >= band.rowLo * packedWorld.width);
    if (last !== undefined) assert.ok(last < band.rowHi * packedWorld.width);
  }
  runSteps(peopleWorld, 24);
  assert.equal(peopleWorld.hearths.length, 0, "a hearth ignited before its range accrued its lag");
  // Prime every native cell's peopled-basin years past its lag: the next
  // conversion pass must ignite, seed farmers, and derive technique as the
  // farmed share of each cell.
  for (const years of packedWorld._hearthYears) years.fill(PRIMED_HEARTH_YEARS);
  runSteps(peopleWorld, 12);
  assert.ok(peopleWorld.hearths.some((hearth) => hearth.ignited), "hearths never ignite");
  let farmed = 0;
  for (const field of Object.values(packedWorld.farmers)) for (const value of field) farmed += value;
  assert.ok(farmed > 0, "ignition seeded no farmers");
  for (const cell of packedWorld._landCells) {
    const packed = packedWorld._packedOf[cell] ?? -1;
    const population = peopleWorld.people[cell] ?? 0;
    const expected = population > 0
      ? Math.min(1, Math.max(0, packedWorld._farmerTotal[packed] ?? 0) / population)
      : 0;
    assert.equal(peopleWorld.technique[cell], expected, "technique is not the farmed share");
  }
  const peopleSave = serializeWorld(peopleWorld);
  const peopleLoaded = loadWorld(peopleSave, substrate);
  assert.ok(opening > 0, "people initial condition is empty");
  assert.equal(serializeWorld(peopleLoaded), peopleSave);
  runSteps(peopleWorld, 12);
  runSteps(peopleLoaded, 12);
  assert.equal(hashWorld(peopleLoaded), hashWorld(peopleWorld), "people continuation diverged");
  const peopleBalance = peopleWorld.ledger.snapshot().people;
  assert.ok(peopleBalance, "people conservation sheet missing");
  assert.equal(peopleBalance?.sources.migration, peopleBalance?.sinks.migration);

  // ── W5/W12: the solve regime and the wake. ──────────────────────────────
  // Each solve pass takes the largest whole-year firing inside its OWN
  // bound. The REACTION bound — farmer growth, adoption, cohort ageing —
  // knows nothing of cell size, so it is the same at every grid and is
  // exactly these three constants. The TRANSPORT bound is migration's
  // alone, and migration is additionally capped at the reaction stride:
  // it carries the field the reaction passes wrote, and a longer firing
  // would integrate a field that no longer exists while buying no reach.
  {
    const world = new World({ seed: 5, grid: "dev", config: { peopleKernel: "ts" }, substrate });
    const reactionYears = Math.min(
      PEOPLE_MIGRATION_MAX_SHARE / (PEOPLE_R_GROWTH_PER_YEAR * (PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN)),
      PEOPLE_MIGRATION_MAX_SHARE / PEOPLE_ADOPTION_RATE_PER_YEAR,
      PEOPLE_MIGRATION_MAX_SHARE * PEOPLE_CHILD_AGE_YEARS,
    );
    const strides = resolveSolveStrides(world);
    assert.equal(
      strides.reaction,
      Math.max(1, Math.floor(reactionYears)) * MONTHS_PER_YEAR,
      "the reaction stride is not the reaction bound in whole years",
    );
    assert.ok(strides.migration <= strides.reaction, "transport outran the field it carries");
    for (const row of world.solveSchedule) {
      assert.equal(row.stride % MONTHS_PER_YEAR, 0, `${row.name} does not fire on a whole year`);
      assert.equal(
        row.stride,
        row.name === "people.migration" ? strides.migration : strides.reaction,
        `${row.name} is not on its own bound`,
      );
    }
    // The clock is the largest advance that lands on every cadence: it
    // divides them all, and nothing coarser does.
    const clock = solveClockMonths(world.solveSchedule);
    assert.equal(world.solveClock, clock);
    assert.ok(world.solveSchedule.every((row) => row.stride % clock === 0), "the clock misses a cadence");
    for (let months = clock + 1; months <= solveSpanMonths(world.solveSchedule); months++) {
      assert.ok(
        world.solveSchedule.some((row) => row.stride % months !== 0),
        `a ${months}-month clock also lands on every cadence`,
      );
    }
    // At the reference grid a cell is a degree and a half across and the
    // transport bound is over a century, so the reaction cap is what binds
    // and the whole schedule is uniform. That is a fact about the grid, not
    // about the mechanism: at the shipped grid the two differ in kind.
    assert.equal(strides.migration, strides.reaction, "the reference grid's solve schedule is not uniform");
    assert.equal(world.phase, "solve", "a peopled world must open in the solve regime");
    const forced = new World({ seed: 5, grid: "dev", config: { peopleKernel: "ts", peopleSolveStride: 24 }, substrate });
    assert.deepEqual(resolveSolveStrides(forced), { reaction: 24, migration: 24 });
    assert.equal(forced.solveClock, 24);
    const awake = new World({ seed: 5, grid: "dev", config: { peopleKernel: "ts", wake: HORIZON_OPENING_YEAR }, substrate });
    assert.equal(awake.phase, "awake", "a world whose epoch is the opening must open awake");
    assert.equal(awake.wakeStep, 0);
  }
  // The two hop invariants (W6): in one firing a cell's farmers hop
  // PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt / area of themselves (after
  // growth) and its foragers PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR × dt /
  // area, each on its own weights; and a source with no room beside it for
  // a group sends none of that group. Both are the kernel's own shares.
  const seedFarmers = (world: World, share: number): number => {
    const people = world as PeopleWorld;
    const cell = Math.floor(world.height / 2) * world.width + Math.floor(world.width / 2);
    const packed = people._packedOf[cell] ?? -1;
    assert.ok(packed >= 0);
    const wheat = CROP_PACKAGES.findIndex((pkg) => pkg.id === "wheat");
    assert.ok(wheat >= 0);
    people.farmers[CROP_PACKAGES[wheat]!.id]![packed] = share * (world.people[cell] ?? 0);
    markPackageActive(people, wheat);
    deriveTechniqueFromFarmers(people);
    deriveCapacity(people);
    return cell;
  };
  {
    const world = new World({ seed: 6, grid: "dev", config: { peopleKernel: "ts" }, substrate });
    const people = world as PeopleWorld;
    const cell = seedFarmers(world, 0.5);
    const packed = people._packedOf[cell] ?? -1;
    runSteps(world, 1);
    const area = world.cellAreaKm2[cell] ?? 0;
    const farmers = people._farmerMigrationTotal[packed] ?? 0;
    const foragers = (people._migrationPopulation[packed] ?? 0) - farmers;
    const solveMigration = resolveSolveStrides(world).migration;
    const farmerShare = migrationShareForArea(area, solveMigration, PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR, world.height);
    const foragerShare = migrationShareForArea(area, solveMigration, PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR, world.height);
    assert.ok(farmers > 0 && foragers > 0);
    assert.equal(people._migrationOutFarmers[packed], farmers * area * farmerShare, "farmers did not hop their own share");
    assert.equal(people._migrationOut[packed], foragers * area * foragerShare, "foragers did not hop their own share");
    assert.ok((world.debug.pricedPairs ?? 0) > 0, "no pair was priced on an unfilled field");
    const balance = world.ledger.snapshot().people;
    assert.equal(balance?.sources.migration, balance?.sinks.migration);
    // Fill every cell to its forager capacity: no room anywhere, so no
    // source is priced and nothing moves — exactly, not approximately.
    for (const full of people._landCells) world.people[full] = people._foragerCapacity[full] ?? 0;
    const wheat = CROP_PACKAGES.find((pkg) => pkg.id === "wheat")!.id;
    people.farmers[wheat]!.fill(0);
    deriveTechniqueFromFarmers(people);
    deriveCapacity(people);
    runSteps(world, 1);
    assert.equal(world.debug.pricedPairs, 0, "a full field still priced pairs");
    assert.equal(world.debug.peopleMigration, 0, "a full field still moved people");
  }
  // The switch: a chosen epoch wakes the world at exactly that year; the
  // solve steps before it match a never-waking world's field for field,
  // and the monthly steps after it diverge from it.
  {
    const epoch = HORIZON_OPENING_YEAR + 20;
    const chosen = new World({ seed: 7, grid: "dev", config: { peopleKernel: "ts", wake: epoch }, substrate });
    const never = new World({ seed: 7, grid: "dev", config: { peopleKernel: "ts", wake: "never" }, substrate });
    seedFarmers(chosen, 0.5);
    seedFarmers(never, 0.5);
    const bytes = (world: World) => Buffer.from(world.people.buffer, world.people.byteOffset, world.people.byteLength);
    runSteps(chosen, 2);
    runSteps(never, 2);
    assert.equal(chosen.phase, "solve");
    assert.deepEqual(bytes(chosen), bytes(never), "solve steps differ between a chosen epoch and never");
    runSteps(chosen, 1);
    assert.equal(chosen.step, stepFromYear(epoch), "the world did not wake at exactly its epoch");
    assert.equal(chosen.phase, "awake");
    assert.equal(chosen.wakeStep, stepFromYear(epoch));
    assert.equal(chosen.schedule.find((row) => row.name === "people.migration")?.stride, resolveSolveStrides(chosen).migration, "movement is not on its derived stride after the wake");
    assert.ok(chosen.events.some((event) => event.kind === "wake"));
    const before = chosen.step;
    runSteps(chosen, 1);
    assert.equal(chosen.step, before + 1, "an awake step is not one month");
    runSteps(never, 1);
    assert.equal(never.phase, "solve");
    assert.notDeepEqual(bytes(chosen), bytes(never), "the awake and solve regimes did not diverge after the wake");
    const chosenSave = serializeWorld(chosen);
    const chosenLoaded = loadWorld(chosenSave, substrate);
    assert.equal(chosenLoaded.phase, "awake");
    assert.equal(serializeWorld(chosenLoaded), chosenSave, "an awake save is not byte-identical");
    const neverSave = serializeWorld(never);
    const neverLoaded = loadWorld(neverSave, substrate);
    assert.equal(neverLoaded.phase, "solve");
    assert.equal(serializeWorld(neverLoaded), neverSave, "a solve-phase save is not byte-identical");
    runSteps(never, 3);
    runSteps(neverLoaded, 3);
    assert.equal(hashWorld(neverLoaded), hashWorld(never), "a loaded solve-phase world diverged");
  }
  // The flat-field front: the solve regime against the awake kernel on the
  // same uniform field from one seeded cell — a check of a law on a flat
  // field, not a history run. The farmed extent (Σ technique) and the
  // population after the span agree within a tenth. Beside them, the
  // linear spreading speed of the same hop-and-grow law is printed as a
  // diagnostic of the lattice regime (QUESTIONS #39), never as a bound.
  const frontYears = 280;
  const frontReport = (() => {
    const solveWorld = new World({ seed: 8, grid: "dev", config: { peopleKernel: "wasm", peopleWorkers: 1, wake: "never" }, substrate });
    const awakeWorld = new World({ seed: 8, grid: "dev", config: { peopleKernel: "wasm", peopleWorkers: 1, wake: HORIZON_OPENING_YEAR }, substrate });
    const seed = seedFarmers(solveWorld, 0.5);
    seedFarmers(awakeWorld, 0.5);
    const horizon = stepFromYear(HORIZON_OPENING_YEAR + frontYears);
    while (solveWorld.step < horizon) runSteps(solveWorld, 1);
    while (awakeWorld.step < horizon) runSteps(awakeWorld, 1);
    const extent = (world: World): number => {
      let sum = 0;
      for (const cell of (world as PeopleWorld)._landCells) sum += world.technique[cell] ?? 0;
      return sum;
    };
    const reach = (world: World): number => {
      const people = world as PeopleWorld;
      const seedY = Math.floor(seed / world.width);
      const seedX = seed - seedY * world.width;
      let farthest = 0;
      for (const cell of people._landCells) {
        if ((world.technique[cell] ?? 0) < PEOPLE_FARMED_MARKER_SHARE) continue;
        const y = Math.floor(cell / world.width);
        if (y !== seedY) continue;
        farthest = Math.max(farthest, Math.abs(cell - seedY * world.width - seedX));
      }
      return farthest;
    };
    const solveExtent = extent(solveWorld);
    const awakeExtent = extent(awakeWorld);
    const solvePeople = populationTotal(solveWorld);
    const awakePeople = populationTotal(awakeWorld);
    const rowKm = (solveWorld as PeopleWorld)._migrationEdgeH[Math.floor(seed / solveWorld.width)] ?? 0;
    const result = {
      years: frontYears,
      solveStep: solveWorld.step,
      awakeStep: awakeWorld.step,
      solveExtent,
      awakeExtent,
      solvePeople,
      awakePeople,
      solveReachCells: reach(solveWorld),
      awakeReachCells: reach(awakeWorld),
      rowCellKm: rowKm,
    };
    (solveWorld as PeopleWorld)._wasmPeopleKernel?.dispose();
    (awakeWorld as PeopleWorld)._wasmPeopleKernel?.dispose();
    return result;
  })();
  assert.ok(frontReport.awakeExtent > 0 && frontReport.solveExtent > 0, "the front did not move on the flat field");
  assert.ok(
    Math.abs(frontReport.solveExtent - frontReport.awakeExtent) <= 0.1 * frontReport.awakeExtent,
    `flat-field farmed extent: solve ${frontReport.solveExtent} vs awake ${frontReport.awakeExtent}`,
  );
  assert.ok(
    Math.abs(frontReport.solvePeople - frontReport.awakePeople) <= 0.1 * frontReport.awakePeople,
    `flat-field population: solve ${frontReport.solvePeople} vs awake ${frontReport.awakePeople}`,
  );

  for (const stride of [1, 3, 12]) {
    for (const phase of [0, 1, stride - 1]) {
      const hits: number[] = [];
      for (let step = 0; step < stride * 4; step++) {
        if (passFires({ step }, { stride, phase })) hits.push(step);
      }
      assert.equal(hits[0], ((phase % stride) + stride) % stride);
      assert.ok(hits.every((step) => ((step - phase) % stride + stride) % stride === 0));
      assert.equal(hits.length, 4);
      assert.equal(passDtMonths({ stride }), stride);
    }
  }
  // v1 SETT_STRIDE lcm scar: a slower rhythm is a second pass, never step%N
  // inside an already-strided pass. stride 12 fires January; a 24-month
  // companion is its own schedule row, not `fires && step % 24`.
  const annual: number[] = [];
  const biennial: number[] = [];
  for (let step = 0; step < 48; step++) {
    if (passFires({ step }, { stride: 12, phase: 0 })) annual.push(step);
    if (passFires({ step }, { stride: 24, phase: 0 })) biennial.push(step);
  }
  assert.deepEqual(annual, [0, 12, 24, 36]);
  assert.deepEqual(biennial, [0, 24]);
  assert.ok(annual.every((step) => step % 12 === 0));
  assert.ok(!annual.filter((step) => step % 24 !== 0).every((step) => biennial.includes(step)));

  const devWorld = new World({ seed: 1, grid: "dev" });
  const targetWorld = new World({ seed: 1, grid: "target" });
  const named = (world: World, name: string) => resolveSchedule(world).find((row) => row.name === name);
  assert.equal(named(devWorld, "people.growth")?.stride, PEOPLE_GROWTH_STRIDE_MONTHS);
  assert.equal(named(targetWorld, "people.growth")?.stride, PEOPLE_GROWTH_STRIDE_MONTHS);
  // Unpeopled poles are excluded from derivation; a world with every row
  // treated as peopled (no substrate mask) must pick 1, matching target.
  // W6: the awake movement stride is derived per group like the solve
  // stride and may exceed a year; on a world without a substrate every row
  // counts as peopled and no row can grow, so only the forager bound and
  // the pass bounds apply.
  const targetSolve = resolveSolveStrides(targetWorld);
  const devSolve = resolveSolveStrides(devWorld);
  assert.equal(named(targetWorld, "people.migration")?.stride, targetSolve.migration);
  assert.equal(named(devWorld, "people.migration")?.stride, devSolve.migration);
  assert.equal(targetSolve.migration % PEOPLE_GROWTH_STRIDE_MONTHS, 0);
  // W12: the two grids differ in KIND, not degree. The reaction bound is
  // the same at both — it knows no cell size — but at the shipped grid a
  // cell is small enough that the transport bound binds first, so movement
  // fires several times inside one growth firing and the solve clock runs
  // at their common divisor rather than at the single stride.
  assert.equal(targetSolve.reaction, devSolve.reaction, "the reaction bound is not grid-independent");
  assert.ok(targetSolve.migration < targetSolve.reaction, "the shipped grid's transport bound does not bind");
  assert.equal(devSolve.migration, devSolve.reaction, "the reference grid's transport bound binds");
  assert.equal(devWorld.solveClock, devSolve.reaction, "a uniform schedule does not clock at its stride");
  assert.ok(targetWorld.solveClock <= targetSolve.migration);
  assert.equal(targetSolve.reaction % targetWorld.solveClock, 0);
  assert.equal(targetSolve.migration % targetWorld.solveClock, 0);
  const forced = new World({
    seed: 1,
    grid: "target",
    config: { peopleGrowthStride: 12, peopleMigrationStride: 12 },
  });
  assert.equal(named(forced, "people.migration")?.stride, 12);

  // W7/W8: the hearth clock runs at the basin's fill × the basin's
  // dependence on the stand (the stand's share of the forager living) × the
  // share of the cell's subsistence that is still the forager yield, so a
  // cell off every stand never domesticates, and a cell farming has reached
  // all but stops — spreading pre-empts inventing.
  {
    const clockWorld = new World({ seed: 5, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    let standCell = -1;
    let standPackage = -1;
    let bareCell = -1;
    for (const cell of clockWorld._landCells) {
      const packed = clockWorld._packedOf[cell] ?? -1;
      for (let packageIndex = 0; packageIndex < clockWorld._standCapacity.length && standCell < 0; packageIndex++) {
        if ((clockWorld._standCapacity[packageIndex]?.[packed] ?? 0) > 0) { standCell = cell; standPackage = packageIndex; }
      }
      if (bareCell < 0 && (clockWorld._standCapacityBest[cell] ?? 0) === 0) bareCell = cell;
      if (standCell >= 0 && bareCell >= 0) break;
    }
    assert.ok(standCell >= 0 && bareCell >= 0, "the fixture holds a stand cell and a bare cell");
    const forager = clockWorld._foragerCapacity[standCell] ?? 0;
    // W10: the clock is the basin's fill x the cell's site quality for this
    // package (its stand times the payoff, as a share of the crop's best
    // ground) x the pre-emption term. Site quality is 0..1 and reaches 1 at
    // exactly the crop's best ground, which is what makes the catalogue lag
    // mean the duration measured AT THAT SITE.
    const site = clockWorld._hearthSiteQuality[standPackage]?.[clockWorld._packedOf[standCell] ?? 0] ?? 0;
    assert.ok(site > 0 && site <= 1, "site quality is a share of the crop's best ground");
    clockWorld.capField[standCell] = forager;
    assert.ok(Math.abs(hearthAccrualRate(clockWorld, standCell, 0.8, standPackage) - 0.8 * site) < 1e-12, "an unfarmed stand cell accrues at fill x site quality");
    clockWorld.capField[standCell] = forager * 100;
    assert.ok(Math.abs(hearthAccrualRate(clockWorld, standCell, 0.8, standPackage) - 0.8 * site / 100) < 1e-12, "a farmed cell's clock slows by its capacity ratio");
    assert.equal(hearthAccrualRate(clockWorld, bareCell, 1, standPackage), 0, "a cell off the stand never accrues");
    for (let packageIndex = 0; packageIndex < clockWorld._hearthSiteQuality.length; packageIndex++) {
      const scores = clockWorld._hearthSiteQuality[packageIndex];
      if (!scores) continue;
      let best = 0;
      for (const score of scores) { assert.ok(score >= 0 && score <= 1, "site quality stays a share"); if (score > best) best = score; }
      assert.ok(best === 0 || Math.abs(best - 1) < 1e-12, "a package with any site has exactly one best");
    }
    // The mixture is the capacity: with one package present it is the old
    // dominant-package mixture; with two it is the share-weighted sum.
    const packed = clockWorld._packedOf[standCell] ?? 0;
    const ids = CROP_PACKAGES.map((pkg) => pkg.id);
    clockWorld.people[standCell] = 10;
    clockWorld.farmers[ids[0]!]![packed] = 4;
    clockWorld.farmers[ids[1]!]![packed] = 4;
    markPackageActive(clockWorld, 0);
    markPackageActive(clockWorld, 1);
    const k0 = packageCapacity(clockWorld, standCell, 0);
    const k1 = packageCapacity(clockWorld, standCell, 1);
    const expected = forager * (1 - 0.8) + 0.4 * k0 + 0.4 * k1;
    assert.ok(Math.abs(mixtureCapacity(clockWorld, standCell, packed, [0, 1]) - expected) < 1e-9, "the mixture weights each package by its share");
  }

  // W13 (P17): the routed water. A chain of dry cells under one wet head:
  // the head takes nothing (its own runoff is its rain, counted once), each
  // dry cell below takes its strip's share, a wet cell passes the water on,
  // and the stream is used up along its course, so what the chain absorbs
  // is what the head shed. The same water admits a crop's month that rain
  // alone does not.
  {
    const runoffFixture = peopleFixture();
    const width = runoffFixture.width;
    const row = 60;
    const headX = 100;
    const chain = Array.from({ length: 11 }, (_, k) => row * width + headX + k);
    for (let k = 0; k < chain.length - 1; k++) runoffFixture.rivers.direction[chain[k] ?? 0] = 0;
    for (const cell of chain) {
      for (let month = 0; month < MONTHS_PER_YEAR; month++) runoffFixture.climate.moisture[cell * MONTHS_PER_YEAR + month] = 0;
    }
    const wet = chain[2] ?? 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) runoffFixture.climate.moisture[wet * MONTHS_PER_YEAR + month] = 1;
    const area = cellAreasKm2(width, runoffFixture.height)[chain[0] ?? 0] ?? 0;
    const strip = Math.min(1, PEOPLE_CHANNEL_STRIP_KM / Math.sqrt(area));
    runoffFixture.rivers.runoff[chain[0] ?? 0] = 3.5 * strip;
    // Read back: the substrate holds runoff in single precision.
    const shed = runoffFixture.rivers.runoff[chain[0] ?? 0] ?? 0;
    const runoffWorld = new World({ seed: 3, grid: "dev", config: { peopleKernel: "ts" }, substrate: runoffFixture }) as PeopleWorld;
    const term = (cell: number): number => runoffWorld._runoffAccess[cell] ?? 0;
    assert.equal(term(chain[0] ?? 0), 0, "a head cell takes none of its own runoff");
    assert.ok(Math.abs(term(chain[1] ?? 0) - strip) < 1e-12, "a dry cell takes its strip's share");
    assert.equal(term(wet), 0, "a wet cell takes nothing");
    assert.ok(Math.abs(term(chain[3] ?? 0) - strip) < 1e-12, "the water passes a wet cell on");
    assert.ok(Math.abs(term(chain[4] ?? 0) - strip) < 1e-12);
    assert.ok(Math.abs(term(chain[5] ?? 0) - (shed - 3 * strip)) < 1e-12, "the stream is used up along its course");
    for (let k = 6; k < chain.length; k++) assert.equal(term(chain[k] ?? 0), 0);
    let absorbed = 0;
    for (const cell of chain) absorbed += term(cell);
    assert.ok(Math.abs(absorbed - shed) < 1e-12, "what the chain absorbs is what the head shed");
    assert.ok(Math.abs((runoffWorld._waterAccess[chain[1] ?? 0] ?? 0) - strip) < 1e-12, "the routed term enters water access as rainfall does");
    assert.ok(Math.abs((runoffWorld._surfaceAccess[chain[1] ?? 0] ?? 0) - strip) < 1e-12, "the routed term is the land's own water");
    assert.equal(runoffWorld._surfaceAccess[wet], 0, "rain is not the land's own water");
    assert.equal(runoffWorld._waterAccess[wet], 1, "rain is water access");
    // The constant is in km: at the reference grid a 10 km strip is six
    // hundredths of a 167 km cell, at the shipped grid half of a 20 km cell,
    // and the same ground is irrigated at either.
    assert.ok(strip > 0.05 && strip < 0.07, "the strip is the share of the cell a 10 km strip covers");
    const temperature = runoffFixture.climate.temperature[(chain[1] ?? 0) * MONTHS_PER_YEAR] ?? 0;
    const admitted = CROP_PACKAGES.findIndex((pkg) => {
      const warmth = pkgTemperatureBell(pkg, temperature);
      return temperature >= (pkg.baseTemperature ?? pkg.tOpt - pkg.tTol)
        && warmth * pkgMoistureBell(pkg, 0) < PEOPLE_TECHNIQUE_CLIMATE_FLOOR
        && warmth * strip >= PEOPLE_TECHNIQUE_CLIMATE_FLOOR;
    });
    assert.ok(admitted >= 0, "some package is admitted by the routed water and not by the rain");
    assert.equal(runoffWorld._canGrow[admitted]?.[runoffWorld._packedOf[chain[1] ?? 0] ?? 0], 1, "the watered month counts toward the season");
    assert.equal(runoffWorld._canGrow[admitted]?.[runoffWorld._packedOf[chain[6] ?? 0] ?? 0], 0, "a dry cell the stream no longer reaches is not admitted");
  }

  console.log(JSON.stringify({
    tests: "ok",
    rng: "v1-byte-compatible",
    dmath: "golden",
    saveLoad: "byte-identical",
    routing: "ok",
    runoff: "ok",
    scheduler: "ok",
    solve: frontReport,
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
