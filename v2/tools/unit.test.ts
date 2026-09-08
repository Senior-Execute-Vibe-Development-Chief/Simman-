import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  buildSnowpack,
  emptySnowpack,
  meltFactorMm,
  monthMeltPotentialMm,
  monthSnowfallMm,
  snowCoverShare,
  snowCoveredArea,
  snowDepthCm,
  snowMeanMm,
  snowStepFactor,
  temperatureC,
  temperatureWithinMonthC,
} from "../src/sim/snow";
import { dnormalCdf, dnormalPdf } from "../src/sim/dmath";
import { fileURLToPath } from "node:url";
import { checkDmathGoldens } from "./lib/dmath-check";
import { collect } from "./lib/collect";
import { entityRng, hash32, mkRng, passRng } from "../src/ported/rng";
import { loadWorld, serializeWorld } from "../src/sim/persist";
import { populationTotal } from "../src/sim/people";
import { routingFixtureSubstrate, runRoutingBatteries } from "../src/sim/travel/battery";
import { TravelEngine } from "../src/sim/travel/engine";
import type { Substrate } from "../src/sim/substrate";
import { crossingAt, crossingHasGround, crossingIndex, fallbackCrossings } from "../src/sim/crossings";
import { CROSSING_LAND_LINK } from "../src/ported/worldgen/crossingData.js";
import { coverByte, FIRST_LAND_BYTE, hasGroundLink, SHELF_BYTE } from "../src/ported/worldgen/coverMask.js";
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
  CROSSING_ROSE_DX,
  CROSSING_ROSE_DY,
  CROSSING_SAMPLE_KM,
  ROUTING_FIXTURE_DEV_HEIGHT,
  ROUTING_FIXTURE_DEV_WIDTH,
  PEOPLE_COASTAL_HOP_KM,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_FARMED_MARKER_SHARE,
  PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_GROWTH_FORAGER_FACTOR,
  PEOPLE_GROWTH_STRIDE_MONTHS,
  PEOPLE_GROWTH_TECHNIQUE_GAIN,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_NEIGHBOR_DX,
  PEOPLE_NEIGHBOR_DY,
  PEOPLE_R_GROWTH_PER_YEAR,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_WORKS_BUILD_PER_YEAR,
  HARVEST_COOL_ONSET_C,
  HARVEST_COOL_RAMP_C,
  HARVEST_CV_BASE,
  HARVEST_CV_FLOOD,
  HARVEST_CV_MARGIN,
  HARVEST_CV_SEASON,
  HARVEST_CV_WINTER,
  HARVEST_MOISTURE_ONSET,
  HARVEST_MONSOON_ONSET,
  HARVEST_SEASON_AMPLITUDE_MIN_C,
  EARTH_DEGREES,
  EARTH_HALF_DEGREES,
  HARVEST_FAMINE_LOSS,
  HARVEST_LEAN_Z,
  HARVEST_MULTIPLIER_CEILING,
  HARVEST_MULTIPLIER_FLOOR,
  HARVEST_WEATHER_CELL_DEGREES,
  HARVEST_YEAR_PERSISTENCE,
  PEOPLE_STARVATION_RATE_PER_YEAR,
  MATH_HALF,
  PEOPLE_WORKS_DECAY_PER_YEAR,
  PEOPLE_WORKS_GAIN,
  PEOPLE_WORKS_PRESSURE_FLOOR,
  PEOPLE_WORKS_RAIN_FLOOR,
  PEOPLE_WORKS_RAIN_SHARE,
  TRAVEL_PASS_DIRECTIONS,
  TRAVEL_SLOPE_COST_FACTOR,
} from "../src/sim/constants";
import { migrationShareForArea } from "../src/sim/people/migration";
import { landStepCost } from "../src/sim/people/neighbors";
import {
  decodePasses, PASS_COUNT, PASS_MIN_CLIMB_M, PASS_MIN_PROMINENCE_M, PASS_SOURCE_COLS, PASS_SOURCE_ROWS,
} from "../src/ported/worldgen/passData.js";
import { decodeWalks, decodeWaypoints, WALK_DIRECTIONS } from "../src/ported/worldgen/walkData.js";
import { buildSubstrate } from "../src/sim/substrate";
import { northSouthKm, rowEastWestKm } from "../src/sim/travel/cost";
import { deriveCapacity } from "../src/sim/people/capacity";
import { deriveTechniqueFromFarmers, markPackageActive, packageCapacity, packageCapacityAt, standCapacity } from "../src/sim/people/crop";
import { hearthAccrualRate } from "../src/sim/people/technique";
import { cellAreasKm2, foragerCapacity, foragerTerrestrialCapacity, irrigableShare, yieldVariance, yieldVarianceParts } from "../src/sim/people/habitability";
import { stepWorks } from "../src/sim/people/works";
import {
  HARVEST_CELLS,
  HARVEST_COLUMNS,
  HARVEST_LOCAL_CORNERS,
  HARVEST_ROWS,
  advanceHarvestYear,
  harvestGridsOf,
  harvestLocalWeights,
  harvestMultiplier,
  harvestYearsOf,
  isFamineYear,
  readHarvestAnomaly,
  readHarvestRow,
  seedHarvestYears,
  smoothHarvestYear,
  stepHarvest,
} from "../src/sim/people/harvest";
import { mixtureCapacity } from "../src/sim/people/capacity";
import { CROP_PACKAGES, pkgMoistureBell, pkgTemperatureBell } from "../src/ported/worldgen/cropPackages.js";
import { demand } from "../src/ported/worldgen/biomeClass.js";
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
    crossings: fallbackCrossings(landMask, width, height),
    landFraction: new Float32Array(cells).fill(1),
    // No geometry finer than the fixture itself: its own mask, block of one.
    landShape: new Uint8Array(landMask),
    landShapeWidth: width,
    landShapeHeight: height,
    landShapeBlock: 1,
    walkKm: new Float32Array(cells * 4),
    snow: emptySnowpack(cells),
    dryFraction: new Float32Array(cells),
    temperatureAmplitude: new Float32Array(cells),
    warmRainFraction: new Float32Array(cells),
    walkAscent: new Float32Array(cells * 4),
    walkDescent: new Float32Array(cells * 4),
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
  // W23: which cells are land, read off the fine measurements. The byte's
  // bit stands except where the cover and the ground contradict it.
  {
    const land = FIRST_LAND_BYTE + 40;
    const sea = 1;
    assert.equal(coverByte(land, 1, true), land, "a land cell mostly land keeps its byte");
    assert.equal(coverByte(land, 0.2, true), land, "joined shore stays land however little of the cell it fills");
    assert.equal(coverByte(land, 0.2, false), SHELF_BYTE, "an islet under half the cell, joined to nothing, is shelf sea");
    assert.equal(coverByte(land, 0.6, false), land, "an island over half the cell stands on its own");
    assert.equal(coverByte(sea, 0.7, false), FIRST_LAND_BYTE, "a sea byte over a mostly-land cell is the first land byte");
    assert.equal(coverByte(sea, 0.3, true), sea, "a sea cell holding a sliver of joined shore stays sea");
    assert.equal(coverByte(sea, 0, false), sea, "open sea keeps its byte");
    // The ground link is read from the cell's own four entries and from the
    // four neighbours that store the mirrored edge; x wraps.
    const width = 4;
    const height = 3;
    const table = new Uint8Array(width * height * 4);
    assert.equal(hasGroundLink(table, width, height, 1, 1), false);
    table[(1 * width + 1) * 4 + 2] = CROSSING_LAND_LINK; // own S entry
    assert.equal(hasGroundLink(table, width, height, 1, 1), true);
    assert.equal(hasGroundLink(table, width, height, 1, 2), true, "the south neighbour reads the same edge");
    table.fill(0);
    table[(0 * width + 2) * 4 + 3] = CROSSING_LAND_LINK; // (2,0)'s SW entry is (1,1)'s NE
    assert.equal(hasGroundLink(table, width, height, 1, 1), true);
    assert.equal(hasGroundLink(table, width, height, 2, 0), true);
    table.fill(0);
    table[(1 * width + 3) * 4 + 0] = CROSSING_LAND_LINK; // (3,1)'s E entry wraps to (0,1)
    assert.equal(hasGroundLink(table, width, height, 0, 1), true, "the wrap-around west neighbour");
    assert.equal(hasGroundLink(table, width, height, 3, 1), true);
  }
  const routing = await runRoutingBatteries();
  assert.ok(routing.every((result) => result.queries >= 72));

  {
    // W22: the router reads the EDGE, not the two cells. On the fixture row 0
    // is water and every other row land, with the mask's own rule on every
    // edge (ground between land cells, open water on any edge touching the
    // sea). Three edges are then changed and only those three routes move.
    const width = ROUTING_FIXTURE_DEV_WIDTH;
    const height = ROUTING_FIXTURE_DEV_HEIGHT;
    const leftLand = width + 1;
    const rightLand = width + 2;
    const leftSea = 1;
    const rightSea = 2;
    const foot = { month: 0, modes: ["foot"] as const, capabilities: [] as const };
    const coastal = { month: 0, modes: ["coastal"] as const, capabilities: ["boats"] as const };
    const plain = await TravelEngine.create(routingFixtureSubstrate("dev"));
    const footDirect = plain.query(leftLand, rightLand, foot);
    assert.equal(footDirect.path.length, 2, "adjacent land with ground between is one step");
    const sailAround = plain.query(leftLand, rightLand, coastal);
    assert.ok(sailAround.path.length > 2, "two land cells with no water between are not sailed across");
    const sailDirect = plain.query(leftSea, rightSea, coastal);
    assert.equal(sailDirect.path.length, 2, "open water is sailed in one step");

    const edited = routingFixtureSubstrate("dev");
    // The ground between the two land cells is cut, and a channel runs there.
    edited.crossings[crossingIndex(width, height, leftLand, 1, 0)] = 1;
    // The open water between the two sea cells is closed.
    edited.crossings[crossingIndex(width, height, leftSea, 1, 0)] = 0;
    const engine = await TravelEngine.create(edited);
    const footAround = engine.query(leftLand, rightLand, foot);
    assert.ok(footAround.path.length > 2 && footAround.days > footDirect.days,
      "two land cells with a channel between them are two banks, not a road");
    const sailChannel = engine.query(leftLand, rightLand, coastal);
    assert.equal(sailChannel.path.length, 2, "a channel one sample wide between two land cells is sailed");
    assert.ok(sailChannel.days < sailAround.days);
    const sailBlocked = engine.query(leftSea, rightSea, coastal);
    assert.ok(sailBlocked.path.length > 2 && sailBlocked.days > sailDirect.days,
      "a water edge with no channel on it is not sailed");
    // W22d: an edge that carries BOTH ground and a channel is one shore, not
    // a strait — the ship keeps to the water cell beside it and the walker
    // takes the ground. The same edge with the ground cut (above) is sailed.
    const shore = routingFixtureSubstrate("dev");
    shore.crossings[crossingIndex(width, height, leftLand, 1, 0)] = CROSSING_LAND_LINK | 1;
    const shoreEngine = await TravelEngine.create(shore);
    assert.ok(shoreEngine.query(leftLand, rightLand, coastal).path.length > 2,
      "two land cells whose ground meets are not sailed between, channel or not");
    assert.equal(shoreEngine.query(leftLand, rightLand, foot).path.length, 2,
      "the ground on a shore edge is still walked");
    // Untouched edges route exactly as before: a walk whose shortest line
    // crosses none of the three edited edges (the fixture wraps in x, so a
    // walk that starts next to the cut would go round the far side instead).
    const midLand = width + Math.floor(width / 2);
    const far = width + width - 2;
    assert.equal(engine.query(midLand, far, foot).days, plain.query(midLand, far, foot).days);
  }

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

  {
    // W22 (was W18): a hop over water is charged the water the source says
    // is on the edge, not the cell. One water cell between two land cells is
    // two lattice edges — 333 km at the reference grid, four times the longest
    // crossing the Neolithic is known to have made — so the hop is refused
    // where the table says the edge is open water. Where the table says a
    // channel one sample wide lies on each edge, the step is charged that
    // instead. Nothing else in the table may move.
    const width = 240;
    const row = 60;
    const channelCell = row * width + 120;
    const CHANNEL_SAMPLES = 1;
    const build = (channel: boolean): PeopleWorld => {
      const base = peopleFixture();
      base.landMask[channelCell] = 0;
      base.elevation[channelCell] = -0.02;
      base.crossings.set(fallbackCrossings(base.landMask, base.width, base.height));
      if (channel) {
        for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
          const dx = PEOPLE_NEIGHBOR_DX[direction] ?? 0;
          const dy = PEOPLE_NEIGHBOR_DY[direction] ?? 0;
          base.crossings[crossingIndex(base.width, base.height, channelCell, dx, dy)] = CHANNEL_SAMPLES;
        }
      }
      return new World({ seed: 7, grid: "dev", config: { peopleKernel: "ts" }, substrate: base }) as PeopleWorld;
    };
    const uncarved = build(false);
    const carved = build(true);
    const slotsOf = (world: PeopleWorld, cell: number): readonly number[] => {
      const packed = world._packedOf[cell] ?? 0;
      const base = packed * PEOPLE_CROP_NEIGHBOR_COUNT;
      return Array.from({ length: PEOPLE_CROP_NEIGHBOR_COUNT }, (_unused, k) => base + k);
    };
    // The eight land cells around the channel: each has one direction whose
    // step lands in the water and continues to the far bank.
    const banks: number[] = [];
    for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
      const dx = PEOPLE_NEIGHBOR_DX[direction] ?? 0;
      const dy = PEOPLE_NEIGHBOR_DY[direction] ?? 0;
      banks.push((row + dy) * width + (120 + dx));
    }
    assert.equal(new Set(banks).size, PEOPLE_CROP_NEIGHBOR_COUNT);
    const crossings = new Set<number>();
    for (const bankCell of banks) {
      for (const slot of slotsOf(carved, bankCell)) {
        if ((carved._neighborTargets[slot] ?? -1) < 0) continue;
        if (carved._neighborMode[slot] !== 1) continue;
        crossings.add(slot);
      }
    }
    assert.equal(crossings.size, PEOPLE_CROP_NEIGHBOR_COUNT, "every bank reaches the far side once the channel is on the edges");
    for (const slot of crossings) {
      assert.equal(uncarved._neighborTargets[slot], -1, "a cell edge of open sea is four crossings too far");
      assert.ok(Math.abs((carved._neighborDistanceKm[slot] ?? 0) - 2 * CHANNEL_SAMPLES * CROSSING_SAMPLE_KM) < 1e-9,
        "the step is charged the channel at each end: a run of one water cell is two edges");
      assert.ok((carved._neighborDistanceKm[slot] ?? 0) < PEOPLE_COASTAL_HOP_KM);
    }
    // And the term is confined to the edges that changed: every other slot
    // in the table, land edge and sea hop alike, is bit-identical.
    let moved = 0;
    for (let slot = 0; slot < carved._neighborTargets.length; slot++) {
      if (crossings.has(slot)) continue;
      if (carved._neighborTargets[slot] === uncarved._neighborTargets[slot]
        && carved._neighborDistanceKm[slot] === uncarved._neighborDistanceKm[slot]
        && carved._neighborMode[slot] === uncarved._neighborMode[slot]) continue;
      moved++;
    }
    assert.equal(moved, 0, "a channel on eight edges moves nothing outside them");
  }

  {
    // W24/W26: a land step is charged what the router charges it — the
    // measured walk's length and the metres it climbs in that direction
    // where one was baked, else the straight geometry and the rise between
    // the two means — at the slope factor, so migration sees the ground and
    // the descent is free (Naismith). The walk tables store four directions
    // per cell; the step west out of the eastern cell reads the western
    // cell's eastward entry with its ascent back. Every edge the walk does
    // not sit on is bit-identical to the flat fixture (the rise moves its
    // own edges).
    const width = 240;
    const west = 60 * width + 100;
    const east = west + 1;
    const WALK_KM = 190;
    const ASCENT = 0.12;
    const DESCENT = 0.09;
    const RISE = 0.02;
    const build = (pass: boolean): PeopleWorld => {
      const base = peopleFixture();
      if (pass) {
        base.walkKm[west * TRAVEL_PASS_DIRECTIONS] = WALK_KM;
        base.walkAscent[west * TRAVEL_PASS_DIRECTIONS] = ASCENT;
        base.walkDescent[west * TRAVEL_PASS_DIRECTIONS] = DESCENT;
        base.elevation[east] = RISE;
      }
      return new World({ seed: 7, grid: "dev", config: { peopleKernel: "ts" }, substrate: base }) as PeopleWorld;
    };
    const flat = build(false);
    const passed = build(true);
    const slotOf = (world: PeopleWorld, cell: number, dx: number, dy: number): number => {
      const direction = PEOPLE_NEIGHBOR_DX.findIndex((x, k) => x === dx && PEOPLE_NEIGHBOR_DY[k] === dy);
      assert.ok(direction >= 0);
      return (world._packedOf[cell] ?? 0) * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
    };
    const eastward = slotOf(passed, west, 1, 0);
    const westward = slotOf(passed, east, -1, 0);
    assert.equal(passed._neighborTargets[eastward], east);
    assert.equal(passed._neighborTargets[westward], west);
    // The substrate holds the tables in single precision; the table is built from what it holds.
    const expected = Math.fround(ASCENT);
    assert.ok(Math.abs((passed._neighborAscent[eastward] ?? 0) - expected) < 1e-9, "the step east is charged the walk's ascent out");
    assert.ok(Math.abs((passed._neighborAscent[westward] ?? 0) - Math.fround(DESCENT)) < 1e-9, "the step west reads the west cell's eastward entry, climbing its descent");
    assert.equal(passed._neighborDistanceKm[eastward], Math.fround(WALK_KM), "the step is the walk's length");
    assert.equal(passed._neighborDistanceKm[westward], Math.fround(WALK_KM));
    assert.ok((flat._neighborDistanceKm[eastward] ?? 0) > 0 && flat._neighborDistanceKm[eastward] !== passed._neighborDistanceKm[eastward],
      "without a walk the step is the straight geometry");
    const km = passed._neighborDistanceKm[eastward] ?? 0;
    assert.ok(km > 0);
    const DAYS_PER_KM = 0.05;
    assert.equal(landStepCost(DAYS_PER_KM, km, 0), DAYS_PER_KM * km, "a flat step costs the walk alone");
    assert.equal(
      landStepCost(DAYS_PER_KM, km, expected),
      DAYS_PER_KM * km + expected * TRAVEL_SLOPE_COST_FACTOR,
      "the climb is charged at the router's slope factor",
    );
    assert.equal(flat._neighborAscent.length, passed._neighborAscent.length);
    assert.equal(flat._neighborAscent.length, flat._landCells.length * PEOPLE_CROP_NEIGHBOR_COUNT);
    // The rise moves the ascent of every edge touching the eastern cell; the
    // pass moves the one edge it sits on. Nothing else in the table moves.
    // The rise is climbed stepping ONTO the eastern cell and free stepping
    // off it (Naismith); the walk edge carries its own two ascents.
    const onto = new Set<number>();
    const off = new Set<number>();
    for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
      const dx = PEOPLE_NEIGHBOR_DX[direction] ?? 0;
      const dy = PEOPLE_NEIGHBOR_DY[direction] ?? 0;
      const around = (60 + dy) * width + (101 + dx);
      off.add(slotOf(passed, east, dx, dy));
      onto.add(slotOf(passed, around, -dx, -dy));
    }
    let moved = 0;
    for (let slot = 0; slot < passed._neighborAscent.length; slot++) {
      if (slot === eastward || slot === westward) continue;
      if (onto.has(slot)) {
        assert.ok(Math.abs((passed._neighborAscent[slot] ?? 0) - Math.fround(RISE)) < 1e-9, "every step onto the rise climbs it");
        continue;
      }
      if (off.has(slot)) {
        assert.equal(passed._neighborAscent[slot], 0, "every step off the rise descends for free");
        continue;
      }
      assert.equal(flat._neighborAscent[slot], 0);
      if (passed._neighborAscent[slot] === flat._neighborAscent[slot]
        && passed._neighborTargets[slot] === flat._neighborTargets[slot]
        && passed._neighborDistanceKm[slot] === flat._neighborDistanceKm[slot]) continue;
      moved++;
    }
    assert.equal(moved, 0, "a pass on one edge moves nothing outside the cells it joins");
  }

  {
    // W25: the pass list is what its header says. Every entry is above the
    // datum, its ridge drops at least the prominence bar to it, a route
    // climbs at least the climb bar to reach it, it lies on the raster, and
    // the list is sorted largest first so a lens can stop at a bar.
    const list = decodePasses();
    assert.equal(list.count, PASS_COUNT);
    assert.ok(list.count > 0);
    for (let k = 0; k < list.count; k++) {
      assert.ok((list.altitude[k] ?? 0) > 0, "a pass stands above the datum");
      assert.ok((list.prominence[k] ?? 0) >= PASS_MIN_PROMINENCE_M);
      assert.ok((list.climb[k] ?? 0) >= PASS_MIN_CLIMB_M);
      assert.ok((list.climb[k] ?? 0) <= (list.altitude[k] ?? 0), "a route climbs at most from the datum");
      assert.ok((list.column[k] ?? 0) < PASS_SOURCE_COLS);
      assert.ok((list.row[k] ?? 0) < PASS_SOURCE_ROWS);
      if (k > 0) assert.ok((list.prominence[k - 1] ?? 0) >= (list.prominence[k] ?? 0), "largest first");
    }
  }

  {
    // W26: the walk tables decode to what the header says, and the substrate
    // multiplies the grid's own straight edge back in: on the dev grid every
    // walked edge is at least as long as the straight line between the
    // centres and never more than the capped detour longer; every walk
    // lies on a land–land edge whose ground the crossing table joins; the
    // waypoints of every edge that has them are inside the window (0–255)
    // and at most six; and an edge with no walk reads zero on both tables.
    const walks = decodeWalks(240, 120);
    assert.ok(walks, "the dev grid carries a walk table");
    const substrate = buildSubstrate(42042, {}, "dev");
    const rows = rowEastWestKm(substrate);
    const northSouth = northSouthKm(substrate);
    let walked = 0;
    let offMask = 0;
    let offGround = 0;
    for (let cell = 0; cell < substrate.N; cell++) {
      const y = Math.floor(cell / substrate.width);
      const x = cell - y * substrate.width;
      for (let direction = 0; direction < WALK_DIRECTIONS; direction++) {
        const slot = cell * WALK_DIRECTIONS + direction;
        const km = substrate.walkKm[slot] ?? 0;
        const detour = walks.detour[slot] ?? 0;
        if (detour === 0) {
          assert.equal(km, 0);
          assert.equal(substrate.walkAscent[slot], 0);
          assert.equal(substrate.walkDescent[slot], 0);
          continue;
        }
        walked++;
        const dx = CROSSING_ROSE_DX[direction] ?? 0;
        const dy = CROSSING_ROSE_DY[direction] ?? 0;
        const ny = y + dy;
        const neighbour = ny * substrate.width + ((x + dx + substrate.width) % substrate.width);
        // The bake reads the sim's own mask and crossing table, so a walk
        // lies exactly where the router may walk: two land cells whose
        // ground the table joins.
        if (!substrate.landMask[cell] || !substrate.landMask[neighbour]) offMask++;
        if (!crossingHasGround(crossingAt(substrate.crossings, substrate.width, substrate.height, cell, dx, dy))) offGround++;
        const eastWest = dx === 0 ? 0 : dy === 0 ? (rows[y] ?? 0) : ((rows[y] ?? 0) + (rows[ny] ?? 0)) / 2;
        const straight = Math.sqrt(eastWest * eastWest + (dy === 0 ? 0 : northSouth * northSouth));
        assert.ok(km >= straight * (1 - 1e-6) && km <= straight * 1.52, `walk ${km} km against a straight ${straight} km`);
        assert.ok((substrate.walkAscent[slot] ?? 0) >= 0 && (substrate.walkDescent[slot] ?? 0) >= 0);
      }
    }
    assert.ok(walked > 30000, `only ${walked} dev edges walked`);
    assert.equal(offMask, 0, `${offMask} of ${walked} walks touch a cell the sim calls water`);
    assert.equal(offGround, 0, `${offGround} of ${walked} walks cross an edge whose ground the table does not join`);
    // How many edges bend enough to carry waypoints is an outcome of the
    // search, not a bar: the test asks only that the table is there and
    // that every entry is well formed.
    const waypoints = decodeWaypoints(240, 120);
    assert.ok(waypoints && waypoints.size > 0, "the dev grid carries waypoints");
    for (const [edge, points] of waypoints) {
      assert.ok((walks.detour[edge] ?? 0) > 0, "waypoints belong to a walked edge");
      assert.ok(points.length >= 2 && points.length <= 12 && points.length % 2 === 0);
    }
  }

  {
    // W27: the snowpack. (a) The two month laws follow from one daily
    // spread: the snow share of a month's rain is the share of its days
    // under the rain–snow threshold, the melt its positive degree-days.
    const sigma = 5;
    assert.ok(Math.abs(monthSnowfallMm(-10, 50) - 50 * dnormalCdf(11 / sigma)) < 1e-9);
    const warmSnow = monthSnowfallMm(15, 50);
    assert.ok(warmSnow > 0 && warmSnow < 0.2, `a +15°C month still snows on ${warmSnow} mm`);
    // The melt factor follows the sun: the summer-solstice value in June
    // in the north and in December in the south, the winter one opposite.
    assert.ok(Math.abs(meltFactorMm(5, false) - 4) < 0.02 && Math.abs(meltFactorMm(11, false) - 1.2) < 0.02);
    assert.ok(Math.abs(meltFactorMm(11, true) - 4) < 0.02 && Math.abs(meltFactorMm(5, true) - 1.2) < 0.02);
    assert.ok(Math.abs(meltFactorMm(5, false, 0.69) - 4) < 1e-6, "exactly the maximum at the solstice itself");
    // Within a month the air moves from the middle of its mean straight
    // toward the neighbouring means: half-way to each at the month's ends.
    assert.equal(temperatureWithinMonthC(-10, 0, 10, 0.5), 0);
    assert.ok(Math.abs(temperatureWithinMonthC(-10, 0, 10, 0) + 5) < 1e-9);
    assert.ok(Math.abs(temperatureWithinMonthC(-10, 0, 10, 1) - 5) < 1e-9);
    assert.ok(Math.abs(temperatureWithinMonthC(-10, 0, 6, 0.75) - 1.5) < 1e-9);
    const coldMelt = monthMeltPotentialMm(-10, 0, false);
    assert.ok(coldMelt > 1 && coldMelt < 2.5, `a −10°C January can melt ${coldMelt} mm`);
    const expectedWarmMelt = meltFactorMm(6, false) * 30.436875 * (sigma * dnormalPdf(2) + 10 * dnormalCdf(2));
    assert.ok(Math.abs(monthMeltPotentialMm(10, 6, false) - expectedWarmMelt) < 1e-9);
    assert.ok(monthMeltPotentialMm(10, 6, false) > 1000, "a +10°C July melts a metre of water");
    assert.equal(temperatureC(0.6), 0);
    assert.ok(Math.abs(temperatureC(0.5) + 10) < 1e-9);
    // (b) Four columns on a 2×2 grid (two north, two south), 50 mm a month:
    // cold all year is perennial; warm all year holds nothing; a southern
    // seasonal column builds a pack in its winter (July), melts out in its
    // summer (January) and repeats; a water cell holds nothing however cold.
    const cells = 4;
    const temperature = new Float32Array(cells * 12);
    const rain = new Float32Array(cells * 12).fill(50);
    const land = new Uint8Array([1, 1, 1, 0]);
    const sim = (celsius: number) => 0.6 + celsius / 100;
    for (let month = 0; month < 12; month++) {
      temperature[0 * 12 + month] = sim(-5);
      temperature[1 * 12 + month] = sim(15);
      temperature[2 * 12 + month] = sim(7 + 15 * Math.cos((2 * Math.PI * month) / 12));
      temperature[3 * 12 + month] = sim(-5);
    }
    const pack = buildSnowpack(temperature, rain, land, 2, 2);
    assert.equal(pack.perennial[0], 1, "a column colder than freezing all year is perennial");
    assert.ok(pack.endMm[11]! > pack.endMm[0]!, "and its pack grows through the year");
    assert.equal(pack.perennial[1], 0);
    for (let month = 0; month < 12; month++) assert.equal(pack.endMm[1 * 12 + month], 0, "a warm column holds no snow");
    assert.equal(pack.perennial[2], 0, "a seasonal column is not perennial");
    assert.ok(pack.endMm[2 * 12 + 6]! > 0, "a southern July holds a pack");
    assert.equal(pack.endMm[2 * 12 + 0], 0, "a southern January has melted out");
    // The stored year repeats: walking it once more from December's pack,
    // week by week with the air read between the monthly means,
    // reproduces every month to the table's unit.
    let replay = pack.endMm[2 * 12 + 11]!;
    for (let month = 0; month < 12; month++) {
      const before = temperatureC(temperature[2 * 12 + ((month + 11) % 12)]!);
      const mean = temperatureC(temperature[2 * 12 + month]!);
      const after = temperatureC(temperature[2 * 12 + ((month + 1) % 12)]!);
      for (let week = 0; week < 4; week++) {
        const fraction = (week + 0.5) / 4;
        const celsius = temperatureWithinMonthC(before, mean, after, fraction);
        replay = Math.max(0, replay + monthSnowfallMm(celsius, 50 / 4) - monthMeltPotentialMm(celsius, month, true, fraction) / 4);
      }
      assert.ok(Math.abs(replay - pack.endMm[2 * 12 + month]!) <= 1, `month ${month + 1}: replay ${replay} against ${pack.endMm[2 * 12 + month]}`);
    }
    for (let month = 0; month < 12; month++) assert.equal(pack.endMm[3 * 12 + month], 0, "water holds no pack");
    assert.equal(pack.perennial[3], 0);
    // (c) The readings: a month's mean pack is the mean of its two ends;
    // 30 mm of water is 10 cm of settled snow; the step factor is the
    // footprint term of the walking-energy coefficient, capped at the
    // deepest footprint measured.
    assert.equal(snowMeanMm(pack, 2, 0), (pack.endMm[2 * 12 + 11]! + pack.endMm[2 * 12 + 0]!) / 2);
    assert.ok(Math.abs(snowDepthCm(30) - 10) < 1e-9);
    const shallow = emptySnowpack(1);
    shallow.endMm.fill(30);
    assert.ok(Math.abs(snowStepFactor(shallow, 0, 3) - 1.82) < 1e-9);
    const deep = emptySnowpack(1);
    deep.endMm.fill(3000);
    assert.ok(Math.abs(snowStepFactor(deep, 0, 3) - (1 + 0.082 * 35)) < 1e-9);
    assert.equal(snowStepFactor(emptySnowpack(1), 0, 0), 1);
    // The depletion curve: all covered at the peak, bare at nothing, and
    // falling between — slowly at first (the drifts outlast the melt of the
    // mean), then steeply.
    assert.equal(snowCoveredArea(100, 100, 5), 1);
    assert.equal(snowCoveredArea(100, 0, 5), 0);
    assert.equal(snowCoveredArea(100, 4, 5), 0);
    const half = snowCoveredArea(100, 50, 5);
    const tenth = snowCoveredArea(100, 10, 5);
    assert.ok(half > 0.8 && half < 1, `half the peak left: ${half} covered`);
    assert.ok(tenth > 0.2 && tenth < half, `a tenth left: ${tenth} covered`);
    // A chart's month: whitening, the share of the month the pack stood
    // above the bar; melting, the depletion curve integrated over the month.
    const whitening = emptySnowpack(1);
    whitening.endMm[11] = 0;
    whitening.endMm[0] = 25;
    whitening.peakMm[0] = 25;
    assert.ok(Math.abs(snowCoverShare(whitening, 0, 0, 5) - 20 / 25) < 1e-9);
    const melting = emptySnowpack(1);
    melting.endMm[2] = 100;
    melting.endMm[3] = 0;
    melting.peakMm[0] = 100;
    const april = snowCoverShare(melting, 0, 3, 5);
    assert.ok(april > 0.4 && april < 0.8, `a month that melts a whole pack is ${april} covered`);
    assert.equal(snowCoverShare(melting, 0, 5, 5), 0);
    deep.peakMm[0] = 3000;
    assert.equal(snowCoverShare(deep, 0, 4, 5), 1);
    // (d) The dev grid's own pack: nothing on water, a perennial pack
    // somewhere, more of the northern hemisphere covered in January than in
    // July, and no pack in a cell no month of which can snow.
    const substrate = buildSubstrate(42042, {}, "dev");
    let perennial = 0;
    let januaryCovered = 0;
    let julyCovered = 0;
    for (let cell = 0; cell < substrate.N; cell++) {
      const y = Math.floor(cell / substrate.width);
      let coldest = Number.POSITIVE_INFINITY;
      let any = 0;
      for (let month = 0; month < 12; month++) {
        coldest = Math.min(coldest, temperatureC(substrate.climate.temperature[cell * 12 + month]!));
        any += substrate.snow.endMm[cell * 12 + month]!;
      }
      if (!substrate.landMask[cell]) {
        assert.equal(any, 0, "no pack on water");
        assert.equal(substrate.snow.perennial[cell], 0);
        continue;
      }
      if (any > 0) assert.ok(coldest < 1 + 4 * sigma, `a pack where no month is within 4σ of snowing (coldest ${coldest}°C)`);
      if (substrate.snow.perennial[cell]) perennial++;
      if (y < substrate.height / 2) {
        januaryCovered += snowCoverShare(substrate.snow, cell, 0, 5);
        julyCovered += snowCoverShare(substrate.snow, cell, 6, 5);
      }
    }
    assert.ok(perennial > 0, "the dev grid holds a pack that never melts out");
    assert.ok(januaryCovered > julyCovered, `January covers ${januaryCovered} cells, July ${julyCovered}`);
  }

  {
    // W19: every capacity law is a density per km² of LAND, and the area it is
    // multiplied by to reach a headcount is the whole cell. A cell the
    // coastline runs through therefore has to charge its living to the ground
    // it actually has. Three properties: the ground-derived terms scale with
    // the cover exactly; the water's-edge term does not, because water inside
    // the cell IS that edge and does not take it away; and no cell whose cover
    // did not change moves at all.
    const width = 240;
    const coverCell = 60 * width + 100;
    // A quarter, so the scaling is exact in binary and the assertion can be
    // an equality rather than a tolerance.
    const COVER = 0.25;
    const build = (share: number): PeopleWorld => {
      const base = peopleFixture();
      base.coast[coverCell] = 1; // give the cell a shore, so there is an aquatic term to hold fixed
      base.landFraction[coverCell] = share;
      return new World({ seed: 7, grid: "dev", config: { peopleKernel: "ts" }, substrate: base }) as PeopleWorld;
    };
    const whole = build(1);
    const part = build(COVER);
    const terrestrialWhole = foragerTerrestrialCapacity(whole, coverCell);
    const terrestrialPart = foragerTerrestrialCapacity(part, coverCell);
    assert.ok(terrestrialWhole > 0, "the fixture cell feeds foragers off its ground");
    assert.equal(terrestrialPart, terrestrialWhole * COVER, "the ground-derived living is charged to the ground");
    const aquaticWhole = foragerCapacity(whole, coverCell) - terrestrialWhole;
    const aquaticPart = foragerCapacity(part, coverCell) - terrestrialPart;
    assert.ok(aquaticWhole > 0, "the fixture cell has a shore to fish");
    assert.ok(Math.abs(aquaticPart - aquaticWhole) < 1e-12, "the water's edge is not diminished by water");
    let grown = -1;
    for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
      if (packageCapacityAt(whole, coverCell, packageIndex, 0) > 0) { grown = packageIndex; break; }
    }
    assert.ok(grown >= 0, "some package grows in the fixture, so the farmed law can be tested");
    assert.equal(
      packageCapacityAt(part, coverCell, grown, 0),
      packageCapacityAt(whole, coverCell, grown, 0) * COVER,
      "fields are ground too, and the wild stand is a share of the same capacity",
    );
    let coverMoved = 0;
    for (let cell = 0; cell < whole.N; cell++) {
      if ((whole._foragerCapacity[cell] ?? 0) === (part._foragerCapacity[cell] ?? 0)) continue;
      coverMoved++;
    }
    assert.equal(coverMoved, 1, "charging the ground moves only the cell whose cover changed");
  }

  // W28: the works slot. The improvable share is the surface water plus
  // what a wet climate improves alone; the built land builds where people
  // press their ceiling at the farmed share's skill, rots unstaffed, is
  // clamped to the cell, multiplies the crop ×(1 + gain·w) and nothing a
  // first cultivator or a stand sees, fires on the growth stride in both
  // regimes, survives a save, and comes out bit-identical from both kernels.
  {
    const substrate = peopleFixture();
    const ts = new World({ seed: 11, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    const worksClamp = (value: number): number => Math.max(0, Math.min(1, value));
    for (let cell = 0; cell < ts.N; cell++) {
      const share = ts._irrigable[cell] ?? 0;
      if (!substrate.landMask[cell]) {
        assert.equal(share, 0, "water improves nothing");
        continue;
      }
      assert.equal(share, irrigableShare(ts, cell));
      assert.ok(share >= 0 && share <= 1, "the improvable share is a share of the cell");
      assert.ok(share >= (ts._surfaceAccess[cell] ?? 0), "the surface water can be led onto fields");
    }
    const wheat = CROP_PACKAGES.findIndex((pkg) => pkg.id === "wheat");
    let cell = -1;
    for (const candidate of ts._landCells) {
      const packed = ts._packedOf[candidate] ?? -1;
      if ((ts._canGrow[wheat]?.[packed] ?? 0) === 0) continue;
      cell = candidate;
      break;
    }
    assert.ok(cell >= 0, "the fixture holds wheat ground");
    {
      // The wet term alone: at the wettest climate the rain share, at the
      // floor nothing, and the surface access on its own where it is dry.
      const savedMoisture = ts._annualMoisture[cell] ?? 0;
      const savedSurface = ts._surfaceAccess[cell] ?? 0;
      ts._annualMoisture[cell] = 1;
      ts._surfaceAccess[cell] = 0;
      assert.equal(irrigableShare(ts, cell), PEOPLE_WORKS_RAIN_SHARE, "the wettest climate improves the rain share");
      ts._annualMoisture[cell] = PEOPLE_WORKS_RAIN_FLOOR;
      assert.equal(irrigableShare(ts, cell), 0, "at the floor rain improves nothing");
      ts._annualMoisture[cell] = 0;
      ts._surfaceAccess[cell] = 0.3;
      assert.equal(irrigableShare(ts, cell), 0.3, "dry ground is improvable by its surface water alone");
      ts._annualMoisture[cell] = savedMoisture;
      ts._surfaceAccess[cell] = savedSurface;
    }
    // The fixture is a dry plain (uniform moisture under the rain floor, no
    // river): a stated improvable share stands in for the field here, the
    // derivation having been checked above.
    ts._irrigable[cell] = 0.5;
    const packed = ts._packedOf[cell] ?? -1;
    const wheatId = CROP_PACKAGES[wheat]!.id;
    ts.people[cell] = 1;
    ts.farmers[wheatId]![packed] = 1;
    markPackageActive(ts, wheat);
    deriveTechniqueFromFarmers(ts);
    deriveCapacity(ts);
    const capacity = ts.capField[cell] ?? 0;
    assert.ok(capacity > 0, "the farmed cell has a capacity");
    // Full to the ceiling, all of them farmers: fill 1, skill 1.
    ts.people[cell] = capacity;
    ts.farmers[wheatId]![packed] = capacity;
    deriveTechniqueFromFarmers(ts);
    deriveCapacity(ts);
    assert.equal(ts.technique[cell], 1);
    const before = ts.capField[cell] ?? 0;
    const unimproved = packageCapacityAt(ts, cell, wheat, 1);
    assert.equal(before, unimproved, "unimproved land is the first cultivator's capacity");
    stepWorks(ts, MONTHS_PER_YEAR);
    const build = PEOPLE_WORKS_BUILD_PER_YEAR * MONTHS_PER_YEAR / MONTHS_PER_YEAR;
    const built = build * (1 - PEOPLE_WORKS_PRESSURE_FLOOR) * 1 * (ts._irrigable[cell] ?? 0);
    assert.equal(ts.works[cell], built, "a year at the ceiling builds the pressure's share of the improvable ground");
    assert.ok(built > 0);
    deriveCapacity(ts);
    assert.equal(ts.capField[cell], before * (1 + PEOPLE_WORKS_GAIN * built), "the works multiply the crop");
    assert.equal(packageCapacityAt(ts, cell, wheat, 1), unimproved, "a first cultivator's question sees unimproved land");
    // Empty: the works rot at the full decay.
    const worked = ts.works[cell] ?? 0;
    ts.people[cell] = 0;
    stepWorks(ts, MONTHS_PER_YEAR);
    const decay = PEOPLE_WORKS_DECAY_PER_YEAR * MONTHS_PER_YEAR / MONTHS_PER_YEAR;
    assert.equal(ts.works[cell], worksClamp(worked - decay * (1 - 0) * worked), "unstaffed works rot");
    // Clamped to the cell, and nothing on ground that cannot be improved.
    ts.works[cell] = 1;
    ts.people[cell] = capacity;
    stepWorks(ts, MONTHS_PER_YEAR);
    assert.equal(ts.works[cell], 1, "the works are a share of the cell");
    ts.works[cell] = 0;
    ts._irrigable[cell] = 0;
    stepWorks(ts, MONTHS_PER_YEAR);
    assert.equal(ts.works[cell], 0, "dry rain-fed ground builds nothing");
    // The pass is scheduled with growth in both regimes.
    const awakeWorks = resolveSchedule(ts).find((row) => row.name === "people.works");
    const awakeGrowth = resolveSchedule(ts).find((row) => row.name === "people.growth");
    assert.ok(awakeWorks && awakeGrowth && awakeWorks.stride === awakeGrowth.stride, "the works fire on the growth stride");
    assert.equal(ts.solveSchedule.find((row) => row.name === "people.works")?.stride, resolveSolveStrides(ts).reaction);
    // Saved and hashed with the rest of the state.
    ts.works[cell] = 0.25;
    const loaded = loadWorld(serializeWorld(ts), substrate) as PeopleWorld;
    assert.equal(loaded.works[cell], 0.25, "the works survive a save");
    assert.equal(hashWorld(loaded), hashWorld(ts));
    ts.works[cell] = 0.5;
    assert.notEqual(hashWorld(loaded), hashWorld(ts), "the works are in the world hash");
    // Both kernels: the same field, byte for byte, after one solve firing
    // over a world filled to its ceiling.
    const earth = buildSubstrate(42042, {}, "dev");
    const oracle = new World({ seed: 12, grid: "dev", config: { peopleKernel: "ts" }, substrate: earth }) as PeopleWorld;
    const kernel = new World({ seed: 12, grid: "dev", config: { peopleKernel: "wasm", peopleWorkers: 1 }, substrate: earth }) as PeopleWorld;
    assert.ok(kernel._wasmPeopleKernel, "the wasm kernel is up for the works parity check");
    for (const world of [oracle, kernel]) {
      for (const land of world._landCells) {
        const at = world._packedOf[land] ?? -1;
        if ((world._canGrow[wheat]?.[at] ?? 0) === 0) continue;
        world.people[land] = 1;
        world.farmers[wheatId]![at] = 1;
      }
      markPackageActive(world, wheat);
      deriveTechniqueFromFarmers(world);
      deriveCapacity(world);
      for (const land of world._landCells) world.people[land] = world.capField[land] ?? 0;
      deriveTechniqueFromFarmers(world);
      deriveCapacity(world);
      stepWorks(world, resolveSolveStrides(world).reaction);
    }
    let builtCells = 0;
    for (const land of oracle._landCells) if ((oracle.works[land] ?? 0) > 0) builtCells++;
    assert.ok(builtCells > 0, "a full world builds somewhere");
    assert.ok(
      Buffer.from(oracle.works.buffer, oracle.works.byteOffset, oracle.works.byteLength)
        .equals(Buffer.from(kernel.works.buffer, kernel.works.byteOffset, kernel.works.byteLength)),
      "the two kernels build the same works, bit for bit",
    );
    kernel._wasmPeopleKernel?.dispose();
  }

  // W29: the yield-variance map. Each factor alone on a fixture cell, the
  // water blend, the winter outside it, and the field filled on the dev
  // substrate with every land cell inside the formula's range.
  {
    const substrate = peopleFixture();
    const ts = new World({ seed: 13, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    // The seasonal fields are float32: a degree of amplitude is stored to
    // ~1e-7 of itself, so the parts are read to that precision.
    const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);
    for (let cell = 0; cell < ts.N; cell++) {
      assert.equal(ts._yieldCv[cell], yieldVariance(ts, cell));
      if (!substrate.landMask[cell]) assert.equal(ts._yieldCv[cell], 0, "water has no harvest");
    }
    const cell = ts._landCells[Math.floor(ts._landCells.length / 2)] ?? 0;
    const savedMoisture = ts._annualMoisture[cell] ?? 0;
    const savedSurface = ts._surfaceAccess[cell] ?? 0;
    // The fixture: no dry season, no amplitude, no surface water.
    assert.equal(substrate.dryFraction[cell], 0);
    assert.equal(substrate.temperatureAmplitude[cell], 0);
    assert.equal(ts._surfaceAccess[cell], 0);
    // Reliably watered: the floor alone.
    ts._annualMoisture[cell] = 1;
    let parts = yieldVarianceParts(ts, cell);
    assert.equal(parts.rainMargin, 0, "wet ground has no rain margin");
    assert.equal(parts.seasonal, 0);
    assert.equal(parts.winterRisk, 0, "no amplitude, no winter");
    assert.equal(parts.water, 0, "no surface water, no flood share");
    near(parts.cv, HARVEST_CV_BASE, "the reliably-watered floor");
    // The desert margin: the full margin on top.
    ts._annualMoisture[cell] = 0;
    parts = yieldVarianceParts(ts, cell);
    assert.equal(parts.rainMargin, 1, "no rain is the full margin");
    near(parts.cv, HARVEST_CV_BASE + HARVEST_CV_MARGIN, "desert-edge rain farming");
    // The half-dry year: the full season term on watered ground; a desert's
    // twelve dry months and a rainforest's none add nothing.
    ts._annualMoisture[cell] = 1;
    substrate.dryFraction[cell] = 0.5;
    parts = yieldVarianceParts(ts, cell);
    near(parts.seasonal, 1, "the half-dry year is the full season");
    near(parts.cv, HARVEST_CV_BASE + HARVEST_CV_SEASON, "one season carries the year");
    substrate.dryFraction[cell] = 1;
    assert.equal(yieldVarianceParts(ts, cell).seasonal, 0, "twelve dry months are the margin's business");
    substrate.dryFraction[cell] = 0;
    // The margin halves the season's addition on the way to the desert.
    ts._annualMoisture[cell] = 0;
    substrate.dryFraction[cell] = 0.5;
    near(yieldVarianceParts(ts, cell).cv, HARVEST_CV_BASE + HARVEST_CV_MARGIN + HARVEST_CV_SEASON * (1 - MATH_HALF), "the season term is damped at the full margin");
    substrate.dryFraction[cell] = 0;
    ts._annualMoisture[cell] = 1;
    // The monsoon: all the rain in the warm half is the full season, read
    // only where the year has seasons.
    substrate.warmRainFraction[cell] = 1;
    substrate.temperatureAmplitude[cell] = (HARVEST_SEASON_AMPLITUDE_MIN_C - 1) / 100;
    assert.equal(yieldVarianceParts(ts, cell).seasonal, 0, "under the amplitude gate the warm half is not a season");
    // (A float32 field: a degree clear of the gate, not the gate itself.)
    substrate.temperatureAmplitude[cell] = (HARVEST_SEASON_AMPLITUDE_MIN_C + 1) / 100;
    parts = yieldVarianceParts(ts, cell);
    near(parts.seasonal, 1, "the whole year's rain in the warm half is the full season");
    substrate.warmRainFraction[cell] = MATH_HALF + HARVEST_MONSOON_ONSET / 2;
    near(yieldVarianceParts(ts, cell).seasonal, 0, "at the onset concentration nothing is read");
    // (Rain spread evenly over the year: the amplitude below is the winter's
    // alone, not a monsoon's.)
    substrate.warmRainFraction[cell] = MATH_HALF;
    substrate.temperatureAmplitude[cell] = 0;
    // The winter: the cool half's mean under the onset; a cool half at the
    // onset nothing — scorching summers over a mild winter carry no risk.
    const annualC = temperatureC(ts._annualTemperature[cell] ?? 0);
    substrate.temperatureAmplitude[cell] = (annualC - HARVEST_COOL_ONSET_C) / 100;
    near(yieldVarianceParts(ts, cell).winterRisk, 0, "a cool half at the onset carries no risk");
    substrate.temperatureAmplitude[cell] = (annualC - HARVEST_COOL_ONSET_C + HARVEST_COOL_RAMP_C) / 100;
    parts = yieldVarianceParts(ts, cell);
    near(parts.winterRisk, 1, "a cool half a ramp under the onset is the full winter");
    near(parts.cv, HARVEST_CV_BASE + HARVEST_CV_WINTER, "the winter adds on the floor");
    // The water share is of the farmland: half the cell watered on wet
    // ground is half the flood regime, and the winter stays outside the
    // blend; a strip of watered ground in the desert, where no rain farms,
    // is wholly the river's; no water at all is not a share.
    ts._surfaceAccess[cell] = MATH_HALF;
    parts = yieldVarianceParts(ts, cell);
    near(parts.water, MATH_HALF, "half the cell watered on farmable ground is half the flood regime");
    near(parts.cv, HARVEST_CV_BASE * MATH_HALF + HARVEST_CV_FLOOD * MATH_HALF + HARVEST_CV_WINTER, "the winter is outside the water blend");
    substrate.temperatureAmplitude[cell] = 0;
    ts._annualMoisture[cell] = 0;
    ts._surfaceAccess[cell] = 0.05;
    parts = yieldVarianceParts(ts, cell);
    assert.equal(parts.water, 1, "a watered strip in the desert is wholly the river's");
    near(parts.cv, HARVEST_CV_FLOOD, "a wholly river-fed valley carries the flood regime's own variance");
    ts._annualMoisture[cell] = HARVEST_MOISTURE_ONSET;
    ts._surfaceAccess[cell] = 0.2;
    parts = yieldVarianceParts(ts, cell);
    near(parts.water, 0.2 / (0.2 + (1 - 0.2) * (1 - parts.rainMargin)), "between, the rain-fed ground counts in proportion to the rain's viability");
    ts._annualMoisture[cell] = 0;
    ts._surfaceAccess[cell] = 0;
    assert.equal(yieldVarianceParts(ts, cell).water, 0, "no water at all is not a share");
    ts._annualMoisture[cell] = savedMoisture;
    ts._surfaceAccess[cell] = savedSurface;
    // The dev substrate: every land cell inside the formula's range, some
    // land river-fed and not all, the deserts at the full margin, no margin
    // above the semi-arid onset.
    const earth = buildSubstrate(42042, {}, "dev");
    const world = new World({ seed: 14, grid: "dev", config: { peopleKernel: "ts" }, substrate: earth }) as PeopleWorld;
    const ceiling = HARVEST_CV_BASE + HARVEST_CV_MARGIN + HARVEST_CV_SEASON + HARVEST_CV_WINTER;
    let rivers = 0;
    let dryLand = 0;
    for (const land of world._landCells) {
      const cv = world._yieldCv[land] ?? 0;
      assert.ok(cv >= Math.min(HARVEST_CV_BASE, HARVEST_CV_FLOOD) - 1e-12 && cv <= ceiling + 1e-12, `cv ${cv} inside the formula's range`);
      const p = yieldVarianceParts(world, land);
      if (p.water > 0) rivers++;
      if (p.rainMargin >= 1) dryLand++;
      const em = (world._annualMoisture[land] ?? 0) / demand(world._annualTemperature[land] ?? 0);
      if (em >= HARVEST_MOISTURE_ONSET) assert.equal(p.rainMargin, 0, "above the semi-arid onset there is no margin");
    }
    assert.ok(rivers > 0 && rivers < world._landCells.length, "some land is river-fed, not all");
    assert.ok(dryLand > 0, "the deserts sit at the full margin");
  }

  // W29: the harvest years. The weather grid's shape; the firings tile the
  // year line in both regimes, each year once; the anomaly is a stationary
  // unit-variance series with the stated persistence, a function of the
  // seed and the year index alone; the bilinear read wraps columns and
  // clamps rows; the multiple and the famine test; the deaths law on a
  // fixture cell with foragers exempt and the famine tally kept; the state
  // saved and hashed; the pass on the growth stride; both kernels bit for bit.
  {
    assert.equal(HARVEST_COLUMNS, EARTH_DEGREES / HARVEST_WEATHER_CELL_DEGREES);
    assert.equal(HARVEST_ROWS, EARTH_HALF_DEGREES / HARVEST_WEATHER_CELL_DEGREES);
    assert.equal(HARVEST_CELLS, HARVEST_COLUMNS * HARVEST_ROWS);
    // Tiling: awake firings a year apart and solve firings seven years apart
    // carry the same years, each exactly once; a flush to an epoch and the
    // awake firings after an odd wake step lose none and repeat none.
    const yearsCovered = (firings: Array<[number, number]>): number[] => {
      const seen: number[] = [];
      for (const [step, dt] of firings) {
        const { first, last } = harvestYearsOf(step, dt);
        for (let year = first; year <= last; year++) seen.push(year);
      }
      return seen;
    };
    const awake = yearsCovered(Array.from({ length: 14 }, (_, i) => [i * MONTHS_PER_YEAR, MONTHS_PER_YEAR] as [number, number]));
    const solve = yearsCovered([[0, 84], [84, 84]]);
    assert.deepEqual(awake, Array.from({ length: 14 }, (_, i) => i), "a year per awake firing");
    assert.deepEqual(solve, awake, "the solve regime carries the same years, seven per firing");
    const wake = yearsCovered([[0, 84], [84, 16], [108, 12], [120, 12]]);
    assert.deepEqual(wake, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "a flush to step 100 and the awake firings after it tile the years");
    assert.ok(harvestYearsOf(1, 6).last < harvestYearsOf(1, 6).first, "a firing with no harvest month carries no year");
    assert.deepEqual(harvestYearsOf(12, 1), { first: 1, last: 1 }, "a one-month firing on the harvest month carries it");
    // The series: seeded and advanced identically from the seed, differing
    // by seed, stationary at unit variance with the stated persistence, and
    // the smoothing keeps the variance.
    const substrate = peopleFixture();
    const a = new World({ seed: 21, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    const b = new World({ seed: 21, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    const c = new World({ seed: 22, grid: "dev", config: { peopleKernel: "ts" }, substrate }) as PeopleWorld;
    assert.deepEqual(Array.from(a.harvestZ), Array.from(b.harvestZ), "the opening anomaly is the seed's");
    assert.notDeepEqual(Array.from(a.harvestZ), Array.from(c.harvestZ), "another seed, another opening");
    assert.ok(a.harvestZ.some((value) => value !== 0), "the opening is a draw, not a calm");
    const sevenByOne = new Float64Array(7 * HARVEST_CELLS);
    for (let year = 0; year < 7; year++) {
      a.step = year * MONTHS_PER_YEAR;
      sevenByOne.set(harvestGridsOf(a, MONTHS_PER_YEAR), year * HARVEST_CELLS);
    }
    b.step = 0;
    const oneBySeven = harvestGridsOf(b, 84);
    assert.deepEqual(Array.from(oneBySeven), Array.from(sevenByOne), "seven yearly firings and one seven-year firing read the same years");
    assert.deepEqual(Array.from(a.harvestZ), Array.from(b.harvestZ), "and leave the same state");
    a.step = 7 * MONTHS_PER_YEAR + 1;
    assert.equal(harvestGridsOf(a, 1).length, 0, "a firing carrying no harvest month reads nothing");
    let sum = 0;
    let squares = 0;
    let lagged = 0;
    let smoothedSquares = 0;
    let polarSquares = 0;
    const years = 2000;
    const smoothed = new Float64Array(HARVEST_CELLS);
    const previous = Float64Array.from(c.harvestZ);
    for (let year = 0; year < years; year++) {
      advanceHarvestYear(c, year);
      smoothHarvestYear(c.harvestZ, smoothed, 0);
      for (let index = 0; index < HARVEST_CELLS; index++) {
        const value = c.harvestZ[index] ?? 0;
        sum += value;
        squares += value * value;
        lagged += value * (previous[index] ?? 0);
        previous[index] = value;
        // The polar rows' clamped neighbour is the cell itself, which
        // weights the centre up: the interior keeps unit variance, the two
        // polar rows (no farmland there) run a little over it.
        const row = Math.floor(index / HARVEST_COLUMNS);
        if (row === 0 || row === HARVEST_ROWS - 1) polarSquares += (smoothed[index] ?? 0) ** 2;
        else smoothedSquares += (smoothed[index] ?? 0) ** 2;
      }
    }
    const samples = years * HARVEST_CELLS;
    const interiorSamples = years * HARVEST_COLUMNS * (HARVEST_ROWS - 2);
    const polarSamples = years * HARVEST_COLUMNS * 2;
    assert.ok(Math.abs(sum / samples) < 0.02, `the anomaly is centred: mean ${sum / samples}`);
    assert.ok(Math.abs(squares / samples - 1) < 0.05, `unit variance: ${squares / samples}`);
    assert.ok(Math.abs(lagged / samples - HARVEST_YEAR_PERSISTENCE) < 0.03, `the stated persistence: ${lagged / samples}`);
    assert.ok(Math.abs(smoothedSquares / interiorSamples - 1) < 0.05, `the smoothing keeps unit variance inland: ${smoothedSquares / interiorSamples}`);
    assert.ok(polarSquares / polarSamples > 1 && polarSquares / polarSamples < 1.5, `the polar rows run over it by the clamped share: ${polarSquares / polarSamples}`);
    // The bilinear read: a flat grid reads flat everywhere; columns wrap so
    // the seam blends both edges; rows clamp so the pole row reads itself.
    const flat = new Float64Array(HARVEST_CELLS).fill(0.75);
    for (const land of a._landCells) {
      const y = Math.floor(land / a.width);
      const x = land - y * a.width;
      assert.ok(Math.abs(readHarvestAnomaly(flat, 0, x, y, a.width, a.height) - 0.75) < 1e-12, "a flat year reads flat");
    }
    const seam = new Float64Array(HARVEST_CELLS);
    for (let row = 0; row < HARVEST_ROWS; row++) seam[row * HARVEST_COLUMNS] = 1;
    const eastEdge = readHarvestAnomaly(seam, 0, a.width - 1, Math.floor(a.height / 2), a.width, a.height);
    const westEdge = readHarvestAnomaly(seam, 0, 0, Math.floor(a.height / 2), a.width, a.height);
    assert.ok(eastEdge > 0 && eastEdge < 1, "the eastern edge reads the column across the seam");
    assert.ok(westEdge > eastEdge, "the western edge sits nearer that column");
    const poles = new Float64Array(HARVEST_CELLS);
    for (let column = 0; column < HARVEST_COLUMNS; column++) poles[column] = 1;
    assert.equal(readHarvestAnomaly(poles, 0, 0, 0, a.width, a.height), 1, "the polar row reads its own row");
    assert.equal(readHarvestAnomaly(poles, 0, 0, a.height - 1, a.width, a.height), 0, "the far pole reads nothing of it");
    // The multiple and the famine test.
    assert.equal(harvestMultiplier(0, 0.5), 1, "the mean year is the mean year");
    assert.equal(harvestMultiplier(-4, 0.5), HARVEST_MULTIPLIER_FLOOR, "the worst year is the floor");
    assert.equal(harvestMultiplier(4, 0.5), HARVEST_MULTIPLIER_CEILING, "the best is the ceiling");
    assert.equal(harvestMultiplier(-1, 0.2), 1 - 0.2, "a valley's bad year is a fifth short");
    assert.ok(isFamineYear(HARVEST_LEAN_Z - 0.01, HARVEST_FAMINE_LOSS - 0.01), "a bottom-decile year a third short is a famine");
    assert.ok(!isFamineYear(HARVEST_LEAN_Z + 0.01, HARVEST_FAMINE_LOSS - 0.01), "an ordinary-decile year is not, however short");
    assert.ok(!isFamineYear(HARVEST_LEAN_Z - 0.01, HARVEST_FAMINE_LOSS + 0.01), "nor a bottom-decile year on reliably watered ground");
    // The deaths law on a fixture cell: at cv 0 every year is the mean year
    // and the excess over the ceiling dies back at the rate; foragers above
    // their own ceiling are untouched; at cv ½ the tally counts exactly the
    // years the multiple fell under 1 + cv × lean z.
    const wheat = CROP_PACKAGES.findIndex((pkg) => pkg.id === "wheat");
    const wheatId = CROP_PACKAGES[wheat]!.id;
    let cell = -1;
    for (const candidate of a._landCells) {
      const packed = a._packedOf[candidate] ?? -1;
      if ((a._canGrow[wheat]?.[packed] ?? 0) === 0) continue;
      cell = candidate;
      break;
    }
    assert.ok(cell >= 0, "the fixture holds wheat ground");
    const packed = a._packedOf[cell] ?? -1;
    markPackageActive(a, wheat);
    a.people[cell] = 1;
    a.farmers[wheatId]![packed] = 1;
    deriveTechniqueFromFarmers(a);
    deriveCapacity(a);
    const capacity = packageCapacity(a, cell, wheat);
    assert.ok(capacity > 0);
    a._yieldCv[cell] = 0;
    const foragersHere = 3;
    a.people[cell] = 2 * capacity + foragersHere;
    a.farmers[wheatId]![packed] = 2 * capacity;
    deriveTechniqueFromFarmers(a);
    // The ceiling is the technique regime's (the farmed share moved with the
    // foragers added): read it as the pass will.
    const ceiling = packageCapacity(a, cell, wheat);
    a.step = MONTHS_PER_YEAR;
    const deaths = stepHarvest(a, MONTHS_PER_YEAR);
    const dead = Math.min(2 * capacity, PEOPLE_STARVATION_RATE_PER_YEAR * (2 * capacity - ceiling));
    assert.equal(a.farmers[wheatId]![packed], 2 * capacity - dead, "the excess over the ceiling dies back at the rate");
    assert.equal(a._farmerTotal[packed], 2 * capacity - dead, "the total follows");
    assert.equal(a.people[cell], foragersHere + (2 * capacity - dead), "the foragers are untouched");
    assert.equal(a._yearMul[packed], 1, "at no variance every year is the mean year");
    assert.equal(a.famineYears[cell], 0, "and none is a famine");
    assert.equal(a.farmedYears[cell], 1, "the farmed years count the year the farmers stood through (W30)");
    assert.ok(Math.abs(deaths - dead * (a.cellAreaKm2[cell] ?? 0)) < 1e-9, "the pass reports the dead as persons");
    a.farmers[wheatId]![packed] = capacity / 2;
    a.people[cell] = capacity / 2 + foragersHere;
    deriveTechniqueFromFarmers(a);
    a.step = 2 * MONTHS_PER_YEAR;
    assert.equal(stepHarvest(a, MONTHS_PER_YEAR), 0, "under the ceiling nobody starves in the mean year");
    assert.equal(a.farmers[wheatId]![packed], capacity / 2);
    a._yieldCv[cell] = MATH_HALF;
    let famines = 0;
    let hungryYears = 0;
    for (let year = 3; year < 400; year++) {
      a.farmers[wheatId]![packed] = capacity;
      a.people[cell] = capacity + foragersHere;
      deriveTechniqueFromFarmers(a);
      a.step = year * MONTHS_PER_YEAR;
      const before = a.famineYears[cell] ?? 0;
      const ceilingNow = packageCapacity(a, cell, wheat);
      stepHarvest(a, MONTHS_PER_YEAR);
      const multiple: number = a._yearMul[packed] ?? 0;
      const expected = capacity - ceilingNow * multiple > 0
        ? Math.min(capacity, PEOPLE_STARVATION_RATE_PER_YEAR * (capacity - ceilingNow * multiple))
        : 0;
      assert.equal(a.farmers[wheatId]![packed], capacity - expected, "the year's shortfall is the year's dead");
      if (multiple < 1) hungryYears++;
      const famine: boolean = multiple < 1 + MATH_HALF * HARVEST_LEAN_Z;
      if (famine) famines++;
      assert.equal((a.famineYears[cell] ?? 0) - before, famine ? 1 : 0, "the tally counts the bottom-decile failures");
    }
    assert.ok(hungryYears > 100 && hungryYears < 300, `about half the years fall short: ${hungryYears}`);
    assert.ok(famines > 10 && famines < 90, `about a tenth are famines: ${famines}`);
    assert.equal(a.famineYears[cell], famines);
    assert.equal(a.farmedYears[cell], 399, "every firing on farmed ground counts its year (W30)");
    let unfarmed = -1;
    for (const candidate of a._landCells) {
      if (candidate !== cell && (a._farmerTotal[a._packedOf[candidate] ?? 0] ?? 0) <= 0) { unfarmed = candidate; break; }
    }
    assert.ok(unfarmed >= 0, "the fixture holds unfarmed ground");
    assert.equal(a.farmedYears[unfarmed], 0, "land nobody farms stands through no farmed year");
    // Saved and hashed with the rest of the state; the tally is a field.
    // (The pass leaves the technique share to the firing's commit: refresh
    // it as the commit would before comparing identities.)
    deriveTechniqueFromFarmers(a);
    deriveCapacity(a);
    const loaded = loadWorld(serializeWorld(a), substrate) as PeopleWorld;
    assert.deepEqual(Array.from(loaded.harvestZ), Array.from(a.harvestZ), "the anomaly state survives a save");
    assert.equal(loaded.famineYears[cell], a.famineYears[cell], "so does the tally");
    assert.equal(loaded.farmedYears[cell], a.farmedYears[cell], "and its denominator (W30)");
    assert.deepEqual(Array.from(loaded._harvestRowStart), Array.from(a._harvestRowStart), "the rows are rebuilt at load (W30)");
    assert.deepEqual(Array.from(loaded._harvestRowCell), Array.from(a._harvestRowCell));
    assert.deepEqual(Array.from(loaded._harvestRowWeight), Array.from(a._harvestRowWeight));
    assert.equal(hashWorld(loaded), hashWorld(a));
    loaded.harvestZ[0] = (loaded.harvestZ[0] ?? 0) + 1;
    assert.notEqual(hashWorld(loaded), hashWorld(a), "the anomaly state is in the world hash");
    // The pass is scheduled with growth in both regimes.
    const awakeHarvest = resolveSchedule(a).find((row) => row.name === "people.harvest");
    const awakeGrowth = resolveSchedule(a).find((row) => row.name === "people.growth");
    assert.ok(awakeHarvest && awakeGrowth && awakeHarvest.stride === awakeGrowth.stride, "the harvest fires on the growth stride");
    assert.equal(a.solveSchedule.find((row) => row.name === "people.harvest")?.stride, resolveSolveStrides(a).reaction);
    // Both kernels: the same fields, byte for byte, after one solve firing
    // over a world filled half again above its ceiling, and the same dead.
    const earth = buildSubstrate(42042, {}, "dev");
    const oracle = new World({ seed: 12, grid: "dev", config: { peopleKernel: "ts" }, substrate: earth }) as PeopleWorld;
    const kernel = new World({ seed: 12, grid: "dev", config: { peopleKernel: "wasm", peopleWorkers: 1 }, substrate: earth }) as PeopleWorld;
    assert.ok(kernel._wasmPeopleKernel, "the wasm kernel is up for the harvest parity check");
    const kernelDeaths: number[] = [];
    for (const world of [oracle, kernel]) {
      for (const land of world._landCells) {
        const at = world._packedOf[land] ?? -1;
        if ((world._canGrow[wheat]?.[at] ?? 0) === 0) continue;
        world.people[land] = 1;
        world.farmers[wheatId]![at] = 1;
      }
      markPackageActive(world, wheat);
      deriveTechniqueFromFarmers(world);
      deriveCapacity(world);
      for (const land of world._landCells) {
        const at = world._packedOf[land] ?? -1;
        if ((world.farmers[wheatId]?.[at] ?? 0) <= 0) continue;
        const ceiling = packageCapacity(world, land, wheat);
        world.farmers[wheatId]![at] = ceiling * (1 + MATH_HALF);
        world.people[land] = ceiling * (1 + MATH_HALF) + 1;
      }
      deriveTechniqueFromFarmers(world);
      deriveCapacity(world);
      world.step = 84;
      kernelDeaths.push(stepHarvest(world, resolveSolveStrides(world).reaction));
    }
    assert.ok((kernelDeaths[0] ?? 0) > 0, "a world above its ceiling starves somewhere");
    assert.equal(kernelDeaths[0], kernelDeaths[1], "the two kernels count the same dead");
    let famineCells = 0;
    for (const land of oracle._landCells) if ((oracle.famineYears[land] ?? 0) > 0) famineCells++;
    assert.ok(famineCells > 0, "seven years bring a famine somewhere");
    const same = (left: Float64Array, right: Float64Array, what: string): void => assert.ok(
      Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(Buffer.from(right.buffer, right.byteOffset, right.byteLength)),
      `the two kernels agree on ${what}, bit for bit`,
    );
    same(oracle.people, kernel.people, "the people");
    same(oracle.farmers[wheatId]!, kernel.farmers[wheatId]!, "the farmers");
    same(oracle._farmerTotal, kernel._farmerTotal, "the farmer totals");
    same(oracle.famineYears, kernel.famineYears, "the famine years");
    same(oracle.farmedYears, kernel.farmedYears, "the farmed years");
    same(oracle._yearMul, kernel._yearMul, "the year's multiple");
    kernel._wasmPeopleKernel?.dispose();
  }

  // W30: the catchment sky. Each land cell's row over the weather grid — its
  // own sky and, through the routing, its catchment's — is a fixed set of
  // weights in the yield's own sensitivities, normalised to unit variance
  // under the smoothing: a 1 σ year reads as a 1 σ year at every cell,
  // corners and poles included, where the bilinear read alone lost variance
  // between centres; the exposures sum to the map's CV; land no river
  // reaches reads its own four corners alone; a river's mouth reads a sky
  // its own corners do not; the rows are derived state, rebuilt at load.
  {
    const earth = buildSubstrate(42042, {}, "dev");
    const world = new World({ seed: 30, grid: "dev", config: { peopleKernel: "ts" }, substrate: earth }) as PeopleWorld;
    const count = world._landCells.length;
    const starts = world._harvestRowStart;
    assert.equal(starts.length, count + 1, "one start per land cell and a closing one");
    assert.equal(starts[0], 0);
    assert.equal(starts[count], world._harvestRowCell.length, "the closing start is the row store's length");
    assert.equal(world._harvestRowCell.length, world._harvestRowWeight.length);
    const localCells = new Int32Array(HARVEST_LOCAL_CORNERS);
    const localWeights = new Float64Array(HARVEST_LOCAL_CORNERS);
    let riverless = 0;
    let longest = 0;
    for (let packed = 0; packed < count; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const start = starts[packed] ?? 0;
      const end = starts[packed + 1] ?? 0;
      assert.ok(end > start, "every land cell reads some sky");
      longest = Math.max(longest, end - start);
      for (let index = start; index < end; index++) {
        const weather = world._harvestRowCell[index] ?? 0;
        assert.ok(weather >= 0 && weather < HARVEST_CELLS, "a row's weather cells are on the grid");
        if (index > start) assert.ok(weather > (world._harvestRowCell[index - 1] ?? 0), "weather cells ascend within a row");
        assert.ok((world._harvestRowWeight[index] ?? 0) > 0, "a row's weights are positive");
      }
      const parts = yieldVarianceParts(world, cell);
      assert.ok(Math.abs(parts.rainExposure + parts.floodExposure - parts.cv) < 1e-12, "the two exposures sum to the map's CV");
      if ((world._runoffInflow[cell] ?? 0) > 0) continue;
      // Nothing flows in: the row is the cell's own four corners, and no other.
      const y = Math.floor(cell / world.width);
      harvestLocalWeights(cell - y * world.width, y, world.width, world.height, localCells, localWeights, 0);
      for (let index = start; index < end; index++) {
        assert.ok(localCells.includes(world._harvestRowCell[index] ?? 0), "land no river reaches reads its own sky alone");
      }
      riverless++;
    }
    assert.ok(riverless > 0 && riverless < count, `some land is a headwater, some a valley: ${riverless} of ${count}`);
    assert.ok(longest > HARVEST_LOCAL_CORNERS, `a valley reads more skies than its corners: ${longest}`);
    // Unit variance at every cell over two thousand years, against the
    // bilinear read's loss between centres.
    const years = 2000;
    const smoothed = new Float64Array(HARVEST_CELLS);
    const rowSquares = new Float64Array(count);
    const localSquares = new Float64Array(count);
    for (let year = 0; year < years; year++) {
      advanceHarvestYear(world, year);
      smoothHarvestYear(world.harvestZ, smoothed, 0);
      for (let packed = 0; packed < count; packed++) {
        const value = readHarvestRow(world, smoothed, 0, packed);
        rowSquares[packed] = (rowSquares[packed] ?? 0) + value * value;
        const cell = world._landCells[packed] ?? 0;
        const y = Math.floor(cell / world.width);
        const local = readHarvestAnomaly(smoothed, 0, cell - y * world.width, y, world.width, world.height);
        localSquares[packed] = (localSquares[packed] ?? 0) + local * local;
      }
    }
    let rowMean = 0;
    let rowMin = Infinity;
    let rowMax = 0;
    let localMin = Infinity;
    let polarMin = Infinity;
    let polarMax = 0;
    for (let packed = 0; packed < count; packed++) {
      const variance = (rowSquares[packed] ?? 0) / years;
      rowMean += variance / count;
      rowMin = Math.min(rowMin, variance);
      rowMax = Math.max(rowMax, variance);
      localMin = Math.min(localMin, (localSquares[packed] ?? 0) / years);
      const y = Math.floor((world._landCells[packed] ?? 0) / world.width);
      if (y < world.height / HARVEST_ROWS || y >= world.height - world.height / HARVEST_ROWS) {
        polarMin = Math.min(polarMin, variance);
        polarMax = Math.max(polarMax, variance);
      }
    }
    assert.ok(Math.abs(rowMean - 1) < 0.05, `the rows read unit variance on average: ${rowMean}`);
    assert.ok(rowMin > 0.75 && rowMax < 1.3, `and at every cell: ${rowMin}..${rowMax}`);
    assert.ok(polarMin > 0.75 && polarMax < 1.3, `the polar rows included: ${polarMin}..${polarMax}`);
    assert.ok(localMin < 0.85, `where the bilinear read alone lost variance between centres: ${localMin}`);
    // A river's mouth reads a sky its own corners do not: a year that is
    // 1 σ on the weather cell its row leans on upstream and calm everywhere
    // else reads as a wet year at the mouth and as nothing under its own sky.
    let mouth = -1;
    let mouthInflow = 0;
    for (const cell of world._landCells) {
      if ((world._runoffInflow[cell] ?? 0) > mouthInflow) { mouthInflow = world._runoffInflow[cell] ?? 0; mouth = cell; }
    }
    assert.ok(mouth >= 0);
    const mouthPacked = world._packedOf[mouth] ?? 0;
    const mouthY = Math.floor(mouth / world.width);
    harvestLocalWeights(mouth - mouthY * world.width, mouthY, world.width, world.height, localCells, localWeights, 0);
    let upstreamSky = -1;
    let upstreamWeight = 0;
    let localShare = 0;
    let rowTotal = 0;
    for (let index = starts[mouthPacked] ?? 0; index < (starts[mouthPacked + 1] ?? 0); index++) {
      const weather = world._harvestRowCell[index] ?? 0;
      const weight = world._harvestRowWeight[index] ?? 0;
      rowTotal += weight;
      if (localCells.includes(weather)) { localShare += weight; continue; }
      if (weight > upstreamWeight) { upstreamWeight = weight; upstreamSky = weather; }
    }
    assert.ok(upstreamSky >= 0, "the largest river's mouth reads an upstream sky");
    assert.ok(localShare < rowTotal, `and leans on the catchment: ${1 - localShare / rowTotal} of its row is upstream`);
    const upstreamYear = new Float64Array(HARVEST_CELLS);
    upstreamYear[upstreamSky] = 1;
    assert.ok(readHarvestRow(world, upstreamYear, 0, mouthPacked) > 0, "a wet year upstream is a wet year at the mouth");
    assert.equal(readHarvestAnomaly(upstreamYear, 0, mouth - mouthY * world.width, mouthY, world.width, world.height), 0, "and nothing under the mouth's own sky");
  }

  console.log(JSON.stringify({
    tests: "ok",
    works: "ok",
    yieldVariance: "ok",
    harvest: "ok",
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
