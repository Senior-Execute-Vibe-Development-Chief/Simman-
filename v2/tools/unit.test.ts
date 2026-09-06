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
  MEAN_DAYS_PER_MONTH,
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
import { deriveTechniqueFromFarmers, markPackageActive, packageCapacity, packageCapacityAt, standCapacity } from "../src/sim/people/crop";
import { hearthAccrualRate } from "../src/sim/people/technique";
import { cellAreasKm2 } from "../src/sim/people/habitability";
import { mixtureCapacity } from "../src/sim/people/capacity";
import { CROP_PACKAGES, pkgMoistureBell, pkgTemperatureBell } from "../src/ported/worldgen/cropPackages.js";
import { orographicFootprintRadius, orographicShare } from "../src/ported/worldgen/realClimateData.js";
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

  // W14 (P18), corrected W15: the sub-grid orographic share, referenced to
  // the ground the wind climbed FROM. On flat land every pixel gets its
  // footprint's rain, whatever the wind; a ridge in a westerly draws the
  // footprint's rain onto its windward face and leaves the lee behind it
  // drier — and turning the wind around turns the wet and dry sides around
  // with it; the sea is untouched; and the land as a whole keeps what the
  // table gave it. The footprint is the widest odd box inside one 1.9° table
  // cell: none at the reference grid, four cells at the 1800-wide target
  // grid, two at the app's 960-wide Half grid.
  let orographyReport: Record<string, number>;
  {
    const width = 64;
    const height = 32;
    const rad = 2;
    const westerly = (w: number, h: number, speed: number): { u: Float32Array; v: Float32Array } => ({
      u: new Float32Array(w * h).fill(speed),
      v: new Float32Array(w * h),
    });
    const west = westerly(width, height, 1);
    const east = westerly(width, height, -1);
    const flat = new Float32Array(width * height).fill(0.1);
    for (let x = 0; x < width; x++) {
      flat[x] = 0;
      flat[(height - 1) * width + x] = -0.1;
    }
    const flatShare = orographicShare(width, height, flat, rad, west.u, west.v);
    for (let i = 0; i < flat.length; i++) assert.ok(Math.abs((flatShare[i] ?? 0) - 1) < 1e-6, "flat land keeps its footprint's rain");
    // A range six cells wide either side of its crest, symmetric in the
    // ground it stands on: any asymmetry in the rain it keeps is the wind's.
    const ridge = Float32Array.from(flat, (e) => (e > 0 ? 0.05 : e));
    const crestX = 32;
    const halfWidth = 6;
    for (let y = 1; y < height - 1; y++) {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        ridge[y * width + crestX + d] = 0.05 + 0.3 * (1 - Math.abs(d) / halfWidth);
      }
    }
    const share = orographicShare(width, height, ridge, rad, west.u, west.v);
    const at = (x: number): number => share[16 * width + x] ?? 0;
    assert.ok(at(crestX) > 1 && at(crestX) > at(crestX + 1), "the climb draws the footprint's rain onto the crest");
    // The wind blows toward +x, so the crest's WINDWARD side is the smaller x
    // and its LEE the larger. The two were identical while the footprint was
    // aspect-blind; referencing the climb to the ground upwind is what
    // separates them, on ground that is symmetric about the crest.
    assert.ok(at(crestX - 1) > 1 && at(crestX + 1) < 1, "the windward foot is wet and the lee foot is dry");
    for (let d = 1; d <= halfWidth; d++) {
      assert.ok(at(crestX - d) > at(crestX + d), "every windward step keeps more rain than the lee step facing it");
    }
    const flipped = orographicShare(width, height, ridge, rad, east.u, east.v);
    const atFlipped = (x: number): number => flipped[16 * width + x] ?? 0;
    for (let d = 1; d <= halfWidth; d++) {
      assert.ok(Math.abs(atFlipped(crestX + d) - at(crestX - d)) < 1e-6, "reversing the wind reverses which face is wet");
    }
    assert.ok(Math.abs(at(crestX + 12) - 1) < 1e-6 && Math.abs(at(crestX - 12) - 1) < 1e-6, "land beyond the footprint's reach is untouched");
    assert.equal(share[crestX] ?? 0, 1, "the sea is untouched");
    assert.equal(share[(height - 1) * width + crestX] ?? 0, 1);
    const calm = orographicShare(width, height, ridge, rad, new Float32Array(width * height), new Float32Array(width * height));
    for (let i = 0; i < ridge.length; i++) assert.equal(calm[i] ?? 0, 1, "a dead calm has no windward side");
    let landSum = 0;
    let landCount = 0;
    for (let i = 0; i < ridge.length; i++) {
      if ((ridge[i] ?? 0) <= 0) continue;
      landSum += share[i] ?? 0;
      landCount++;
    }
    const landMean = landSum / landCount;
    assert.ok(Math.abs(landMean - 1) < 0.01, "the land as a whole keeps its rain to first order");
    const zeroShare = orographicShare(width, height, ridge, 0, west.u, west.v);
    for (let i = 0; i < ridge.length; i++) assert.equal(zeroShare[i] ?? 0, 1, "no footprint, no redistribution");
    assert.equal(orographicFootprintRadius(240), 0, "inert at the reference grid");
    assert.equal(orographicFootprintRadius(480), 0, "inert at the 0.75° proxy: a 3-cell box would be wider than the table cell");
    assert.equal(orographicFootprintRadius(960), 2, "a 5-cell, 1.875° box at the app's Half grid");
    assert.equal(orographicFootprintRadius(1800), 4, "a 9-cell, 1.8° box at the target grid");
    assert.equal(orographicFootprintRadius(1920), 4);
    orographyReport = {
      crest: Number(at(crestX).toFixed(3)),
      windward: Number(at(crestX - 1).toFixed(3)),
      lee: Number(at(crestX + 1).toFixed(3)),
      landMean: Number(landMean.toFixed(4)),
    };
  }

  // W14, corrected W15, graded over the cycle by W17: the paddy. The same
  // flood on the same ground raises a FARMED wetland crop by the package's
  // response and lowers an upland one's fit; a flood in months a crop is not
  // growing is nothing to it; a stream beside a wetland crop is a paddy and
  // beside an upland crop is nothing; ground with no standing water is
  // unchanged for every package. The paddy is husbandry (W15), so it is worth
  // nothing to a first cultivator and nothing to the wild stand, while the
  // drowning is physiology and is in the fit at every regime.
  // W17 grades all of it over the run the crop occupies rather than the year,
  // which is what decides WHEN it is sown: a wetland crop moves its date onto
  // the flood, and an upland crop moves its date off it wherever the season
  // leaves room. The last two cases are the year's other two shapes — a
  // season shorter than the cycle, and a perennial that outlasts the year.
  {
    const riceIndex = CROP_PACKAGES.findIndex((pkg) => pkg.id === "rice");
    const wheatIndex = CROP_PACKAGES.findIndex((pkg) => pkg.id === "wheat");
    assert.ok(riceIndex >= 0 && wheatIndex >= 0);
    const riceResponse = CROP_PACKAGES[riceIndex]?.standingWaterResponse ?? 0;
    const wheatResponse = CROP_PACKAGES[wheatIndex]?.standingWaterResponse ?? 0;
    assert.ok(riceResponse > 0 && wheatResponse < 0, "rice is a wetland grass; wheat drowns");
    const row = 60;
    const flooded = row * 240 + 100;
    const winterFlood = row * 240 + 110;
    const control = row * 240 + 120;
    const head = row * 240 + 130;
    const bank = head + 1;
    // Warm enough for wheat in five months only, three of them under the
    // flood: ground where the water cannot be planted around.
    const wetSeason = row * 240 + 140;
    // Dry ground, one crop's season five months long and the other's whole,
    // for the two normalisations that do not involve water at all.
    const shortYear = row * 240 + 150;
    const longYear = row * 240 + 160;
    const pulseMonths = [6, 7, 8];
    const build = (pulse: boolean, stream: boolean, withFlow = true): PeopleWorld => {
      const base = peopleFixture();
      const flow = new Float32Array(base.N * MONTHS_PER_YEAR).fill(1);
      for (const cell of [flooded, winterFlood, wetSeason]) {
        base.floodplain[cell] = 0.5;
        if (pulse) for (const month of pulseMonths) flow[cell * MONTHS_PER_YEAR + month] = 3;
      }
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        base.climate.temperature[flooded * MONTHS_PER_YEAR + month] = 0.86;
        base.climate.temperature[winterFlood * MONTHS_PER_YEAR + month] = pulseMonths.includes(month) ? 0.3 : 0.73;
        base.climate.temperature[control * MONTHS_PER_YEAR + month] = 0.8;
        base.climate.temperature[bank * MONTHS_PER_YEAR + month] = 0.86;
        base.climate.moisture[bank * MONTHS_PER_YEAR + month] = 1;
        base.climate.temperature[wetSeason * MONTHS_PER_YEAR + month] = month >= 5 && month <= 9 ? 0.73 : 0.2;
        const rooting = month >= 2 && month <= 6;
        base.climate.temperature[shortYear * MONTHS_PER_YEAR + month] = rooting ? 0.78 : 0.2;
        base.climate.moisture[shortYear * MONTHS_PER_YEAR + month] = 0.7;
        base.climate.temperature[longYear * MONTHS_PER_YEAR + month] = 0.78;
        base.climate.moisture[longYear * MONTHS_PER_YEAR + month] = 0.7;
      }
      base.floodplain[control] = 0.3;
      base.rivers.direction[head] = 0;
      if (stream) base.rivers.runoff[head] = 10;
      const substrate: Substrate = withFlow ? { ...base, rivers: { ...base.rivers, seasonalFlowScale: flow } } : base;
      return new World({ seed: 5, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    };
    const still = build(false, false);
    const flooding = build(true, false);
    const streaming = build(false, true);
    const bare = build(false, false, false);
    // The fit itself: what the ground yields before anyone impounds it.
    const fit = (world: PeopleWorld, packageIndex: number, cell: number): number =>
      world._cropFit[packageIndex]?.[world._packedOf[cell] ?? 0] ?? 0;
    // The fit a farmer at the full technique regime works, paddy included.
    const paddied = (world: PeopleWorld, packageIndex: number, cell: number): number => {
      const packed = world._packedOf[cell] ?? 0;
      return (world._cropFit[packageIndex]?.[packed] ?? 0)
        * (1 + (world._standingGain[packageIndex]?.[packed] ?? 0));
    };
    const strip = Math.min(1, PEOPLE_CHANNEL_STRIP_KM / Math.sqrt(cellAreasKm2(240, 120)[bank] ?? 0));
    // The cycle each package occupies the ground for, in months of the
    // climate — the run a harvest is graded over (W17).
    const cycleMonths = (packageIndex: number): number =>
      Math.min((CROP_PACKAGES[packageIndex]?.cycleDays ?? 0) / MEAN_DAYS_PER_MONTH, MONTHS_PER_YEAR);
    // Three flood months at a flow twice the year's mean over a plain that is
    // half the cell: the plain is under water in those three, so a wetland
    // crop gains response × 0.5 in each of them. The gain is charged to the
    // run the crop is in the ground for, not to the year — rice sows into the
    // flood, so all three months fall inside its 4.93-month cycle.
    const paddyOver = (response: number, packageIndex: number): number =>
      1 + (pulseMonths.length * 0.5 * response) / cycleMonths(packageIndex);
    assert.ok(fit(still, riceIndex, flooded) > 0 && fit(still, wheatIndex, flooded) > 0, "both packages grow on the still plain");
    assert.ok(Math.abs(paddied(flooding, riceIndex, flooded) / fit(still, riceIndex, flooded) - paddyOver(riceResponse, riceIndex)) < 1e-9, "the flood is the rice farmer's paddy");
    // And the same flood does not drown the wheat HERE, because here it does
    // not have to stand in it: nine of the twelve months are dry and its
    // cycle is 3.94 of them, so it is sown when the water is off the field.
    // Grading the year whole charged it for a flood it was not standing in.
    assert.equal(fit(flooding, wheatIndex, flooded), fit(still, wheatIndex, flooded), "wheat is sown when the water is off the field");
    assert.equal(
      packageCapacityAt(flooding, flooded, wheatIndex, 0),
      packageCapacityAt(still, flooded, wheatIndex, 0),
      "so a flood it can plant around costs it nothing at any regime",
    );
    // Where it cannot be planted around, the drowning is charged in full.
    // Five months are warm enough for wheat on this ground and the flood
    // takes three of them, so the best run it can sow is one dry month, two
    // under water, and the tail of a third.
    const drowned = 1 + wheatResponse * 0.5;
    const wheatTail = cycleMonths(wheatIndex) - Math.floor(cycleMonths(wheatIndex));
    const boxedIn = (1 + 2 * drowned + wheatTail * drowned) / cycleMonths(wheatIndex);
    assert.ok(fit(still, wheatIndex, wetSeason) > 0, "five months is wheat's season minimum, so it grows there");
    assert.ok(Math.abs(fit(flooding, wheatIndex, wetSeason) / fit(still, wheatIndex, wetSeason) - boxedIn) < 1e-9, "a flood inside the only season there is drowns the wheat");
    // W15: the paddy is a built thing. It is worth nothing to the crop
    // itself, so the fit is untouched, and nothing to a first cultivator or
    // a wild stand, so the technique-0 capacity every stand and hearth
    // payoff is read from is untouched too. The drowning is not built, so it
    // is in wheat's fit and in wheat's technique-0 capacity alike.
    assert.equal(fit(flooding, riceIndex, flooded), fit(still, riceIndex, flooded), "the flood alone is not a paddy");
    assert.equal(paddied(flooding, wheatIndex, flooded), fit(flooding, wheatIndex, flooded), "an upland crop has no paddy to gain");
    assert.equal(
      packageCapacityAt(flooding, flooded, riceIndex, 0),
      packageCapacityAt(still, flooded, riceIndex, 0),
      "a first cultivator on the flood arrives before the bund",
    );
    assert.ok(packageCapacityAt(flooding, flooded, riceIndex, 1) > packageCapacityAt(still, flooded, riceIndex, 1) * 1.1,
      "and the same ground worked at the full regime is the paddy");
    assert.ok(packageCapacityAt(flooding, wetSeason, wheatIndex, 0) < packageCapacityAt(still, wetSeason, wheatIndex, 0),
      "drowning is physiology: it costs the first cultivator too");
    assert.ok(fit(still, wheatIndex, winterFlood) > 0);
    assert.equal(fit(flooding, wheatIndex, winterFlood), fit(still, wheatIndex, winterFlood), "a flood in months the crop is not growing is nothing to it");
    assert.equal(fit(flooding, riceIndex, winterFlood), fit(still, riceIndex, winterFlood));
    for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
      assert.equal(fit(flooding, packageIndex, control), fit(still, packageIndex, control), "ground with no standing water is unchanged");
      assert.equal(fit(bare, packageIndex, control), fit(still, packageIndex, control), "a substrate without a seasonal flow reads a flat year");
      assert.equal(fit(bare, packageIndex, flooded), fit(still, packageIndex, flooded));
    }
    assert.ok((streaming._runoffInflow[bank] ?? 0) > strip, "the stream arrives at the bank");
    assert.equal(streaming._waterAccess[bank], still._waterAccess[bank], "a wet bank takes nothing from the stream (W13)");
    assert.ok(Math.abs(paddied(streaming, riceIndex, bank) / fit(still, riceIndex, bank) - (1 + riceResponse * strip)) < 1e-9, "a stream beside rice keeps its strip under water");
    assert.equal(fit(streaming, riceIndex, bank), fit(still, riceIndex, bank), "the stream is a paddy only once someone leads it onto the field");
    assert.equal(fit(streaming, wheatIndex, bank), fit(still, wheatIndex, bank), "a stream beside wheat is nothing to it: only the flood it cannot drain hurts");
    // W17's other two shapes of year, on dry ground. A season shorter than
    // the cycle is a crop short of TIME: its harvest falls in proportion
    // rather than to nothing, so five months of a 6.9-month cycle is 5/6.9 of
    // the same ground worked all year. A perennial outlasts the year it has,
    // so its run IS the year and it is graded by the whole of it — which is
    // exactly the annual share the wild stand reads, and is why W17 leaves
    // the stand untouched.
    const tuberIndex = CROP_PACKAGES.findIndex((pkg) => pkg.id === "tubers");
    const perennialIndex = CROP_PACKAGES.findIndex((pkg) => pkg.id === "highland-roots");
    assert.ok(tuberIndex >= 0 && perennialIndex >= 0);
    assert.ok(cycleMonths(tuberIndex) > 1 && cycleMonths(tuberIndex) < MONTHS_PER_YEAR, "a root crop's cycle is months");
    assert.equal(cycleMonths(perennialIndex), MONTHS_PER_YEAR, "enset stands for years, and is graded by the year it gets");
    const rootSeason = 5;
    for (const packageIndex of [tuberIndex, perennialIndex]) {
      const whole = fit(still, packageIndex, longYear);
      const partial = fit(still, packageIndex, shortYear);
      assert.ok(whole > 0 && partial > 0, "both years grow the crop");
      assert.ok(Math.abs(partial / whole - rootSeason / cycleMonths(packageIndex)) < 1e-9,
        "a short season is a short harvest, not no harvest");
    }
  }

  console.log(JSON.stringify({
    tests: "ok",
    rng: "v1-byte-compatible",
    dmath: "golden",
    saveLoad: "byte-identical",
    routing: "ok",
    runoff: "ok",
    orography: orographyReport,
    paddy: "ok",
    scheduler: "ok",
    solve: frontReport,
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
