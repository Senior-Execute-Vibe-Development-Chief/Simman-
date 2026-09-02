import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_BAND_COUNT,
  PEOPLE_COHORT_CHILD_FRACTION,
  PEOPLE_COHORT_ELDER_FRACTION,
  PEOPLE_COHORT_WORKING_FRACTION,
  PEOPLE_INITIAL_FILL_FRACTION,
} from "../constants";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { deriveCapacity } from "./capacity";
import { deriveTechniqueFromFarmers, initializeCropFields, refreshTechniqueShare } from "./crop";
import { cellAreasKm2, annualClimateFromSubstrate, fillStaticHabitability } from "./habitability";
import { grow } from "./growth";
import { fillMigrationShareRows, migrate } from "./migration";
import { convertFarmers, initializeTechnique, prepareTechnique, stepTechnique } from "./technique";
import { asPeopleWorld, type PeopleWorld } from "./types";
import { World } from "../world";
import type { WorldOptions } from "../world";
import { createPeopleKernel, defaultPeopleWorkers } from "../peopleKernel";
import { allocateFields } from "../fields";
import { passDtMonths, passFires } from "../scheduler";
import { fixedPeopleBands } from "./bands";
import { buildPeopleNeighborTable } from "./neighbors";

export const peoplePhaseMilliseconds: Record<string, number> = {
  technique: 0,
  conversion: 0,
  capacity: 0,
  growth: 0,
  migration: 0,
  cohorts: 0,
  ledger: 0,
};

export function resetPeoplePhaseMilliseconds(): void {
  for (const key of Object.keys(peoplePhaseMilliseconds)) peoplePhaseMilliseconds[key] = 0;
}

function addPhaseTime(name: keyof typeof peoplePhaseMilliseconds, started: number): void {
  peoplePhaseMilliseconds[name] += performance.now() - started;
}

function allocatePeopleScratch(world: PeopleWorld): void {
  const length = world.N;
  world._landCells = new Int32Array(length);
  let landCount = 0;
  for (let cell = 0; cell < length; cell++) {
    if (world.substrate.landMask[cell]) world._landCells[landCount++] = cell;
  }
  world._landCells = world._landCells.slice(0, landCount);
  world._packedOf = new Int32Array(length);
  world._packedOf.fill(MATH_NEGATIVE_ONE);
  for (let packed = 0; packed < landCount; packed++) {
    const cell = world._landCells[packed] ?? 0;
    world._packedOf[cell] = packed;
  }
  world._peopleBands = fixedPeopleBands(world.width, world.height, world._landCells);
  world.capField = new Float64Array(length);
  world._peopleNext = new Float64Array(landCount);
  world._techniqueNext = new Float64Array(landCount);
  world._childrenMass = new Float64Array(landCount);
  world._workingMass = new Float64Array(landCount);
  world._eldersMass = new Float64Array(landCount);
  world._childrenNext = new Float64Array(landCount);
  world._workingNext = new Float64Array(landCount);
  world._eldersNext = new Float64Array(landCount);
  world.farmers = {};
  world._farmersNext = {};
  world._farmersMigration = {};
  world._farmerTotal = new Float64Array(landCount);
  world._farmerTotalNext = new Float64Array(landCount);
  world._farmerMigrationTotal = new Float64Array(landCount);
  world._activePackage = new Uint8Array(CROP_PACKAGES.length);
  for (const pkg of CROP_PACKAGES) {
    world.farmers[pkg.id] = new Float64Array(landCount);
    world._farmersNext[pkg.id] = new Float64Array(landCount);
    world._farmersMigration[pkg.id] = new Float64Array(landCount);
  }
  world._migrationOut = new Float64Array(landCount);
  world._migrationWeight = new Float64Array(landCount);
  world._migrationPopulation = new Float64Array(landCount);
  world._migrationReceived = new Float64Array(landCount);
  world._birthsByBand = new Float64Array(PEOPLE_BAND_COUNT);
  world._deathsByBand = new Float64Array(PEOPLE_BAND_COUNT);
  world._migrationByBand = new Float64Array(PEOPLE_BAND_COUNT);
  world._migrationReceivedByBand = new Float64Array(PEOPLE_BAND_COUNT);
  world._annualTemperature = new Float64Array(length);
  world._annualMoisture = new Float64Array(length);
  world._techniqueSuitability = new Float64Array(length);
  world.cellAreaKm2 = cellAreasKm2(world.width, world.height);
  world._peopledMask = new Uint8Array(length);
  for (let cell = 0; cell < length; cell++) {
    const peopled = (world.substrate.ancestry.lineage[cell] ?? MATH_NEGATIVE_ONE) >= 0
      && (world.substrate.ancestry.arrival[cell] ?? MATH_NEGATIVE_ONE) >= 0;
    world._peopledMask[cell] = peopled ? 1 : 0;
  }
  world._migrationDaysPerKm = new Float64Array(length);
  world._migrationDaysPerKmByMonth = new Array(MONTHS_PER_YEAR).fill(undefined);
  world._waterAccess = new Float64Array(length);
  world._reliefMult = new Float64Array(length);
  world._foragerCapacity = new Float64Array(length);
  world._diseaseBurden = new Float64Array(length);
  world._migrationShareRow = new Float64Array(world.height);
  world._canGrow = [];
  world._nativeRanges = [];
  world._dominantPackage = new Uint8Array(length);
  const neighbors = buildPeopleNeighborTable(world);
  world._neighborTargets = neighbors.targets;
  world._neighborDistanceKm = neighbors.distanceKm;
  world._neighborMode = neighbors.mode;
}

function seedPopulation(world: PeopleWorld): number {
  const substrate = world.substrate;
  let total = 0;
  for (const cell of world._landCells) {
    const peopled = (substrate.ancestry.lineage[cell] ?? MATH_NEGATIVE_ONE) >= 0
      && (substrate.ancestry.arrival[cell] ?? MATH_NEGATIVE_ONE) >= 0;
    if (!peopled) continue;
    const density = (world._foragerCapacity[cell] ?? 0) * PEOPLE_INITIAL_FILL_FRACTION;
    world.people[cell] = density;
    world.children[cell] = PEOPLE_COHORT_CHILD_FRACTION;
    world.working[cell] = PEOPLE_COHORT_WORKING_FRACTION;
    world.elders[cell] = PEOPLE_COHORT_ELDER_FRACTION;
    total += density * (world.cellAreaKm2[cell] ?? 0);
  }
  return total;
}

export function initializePeople(worldInput: World): PeopleWorld {
  const world = asPeopleWorld(worldInput);
  if (world.peopleInitialized) return world;
  allocatePeopleScratch(world);
  annualClimateFromSubstrate(world);
  fillStaticHabitability(world);
  fillMigrationShareRows(world);
  initializeCropFields(world);
  prepareTechnique(world);
  const forceTypeScript = world.config.peopleKernel === "ts";
  if (!forceTypeScript) {
    const configuredWorkers = Number(world.config.peopleWorkers);
    const workers = Number.isFinite(configuredWorkers) && configuredWorkers >= 1
      ? Math.floor(configuredWorkers)
      : defaultPeopleWorkers();
    world._wasmPeopleKernel = createPeopleKernel(
      world,
      workers,
      world.config.peopleThreads === true,
    );
  }
  if (!world._wasmPeopleKernel) {
    allocateFields(world as unknown as Record<string, unknown>, world.N);
  }
  world.ledger.beginPass(
    "people",
    world.people,
    "initialPeopling",
    "deaths",
    world.cellAreaKm2,
    world._landCells,
  );
  const initialPeople = seedPopulation(world);
  initializeTechnique(world);
  deriveCapacity(world);
  world.ledger.recordChannel("people", "initialPeopling", initialPeople, 0);
  world.ledger.endPass("people", world.people, initialPeople, 0, world._landCells);
  world.peopleInitialized = true;
  return world;
}

function normalizeCohorts(world: PeopleWorld): void {
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const population = world.people[cell] ?? 0;
    if (population <= 0) {
      world.children[cell] = 0;
      world.working[cell] = 0;
      world.elders[cell] = 0;
      continue;
    }
    const child = Math.max(0, Math.min(1, (world._childrenMass[packed] ?? 0) / population));
    const working = Math.max(0, Math.min(1 - child, (world._workingMass[packed] ?? 0) / population));
    world.children[cell] = child;
    world.working[cell] = working;
    world.elders[cell] = Math.max(0, 1 - child - working);
  }
}

export function stepPeople(worldInput: World): void {
  const world = initializePeople(worldInput);
  const due = new Map(
    world.schedule.map((schedule) => [schedule.name, passFires(world, schedule)]),
  );
  const techniqueSchedule = world.schedule.find(({ name }) => name === "people.technique");
  const conversionSchedule = world.schedule.find(({ name }) => name === "people.conversion");
  const capacitySchedule = world.schedule.find(({ name }) => name === "people.capacity");
  const growthSchedule = world.schedule.find(({ name }) => name === "people.growth");
  const migrationSchedule = world.schedule.find(({ name }) => name === "people.migration");
  const cohortsSchedule = world.schedule.find(({ name }) => name === "people.cohorts");
  const techniqueDue = due.get("people.technique") === true;
  const conversionDue = due.get("people.conversion") === true;
  const capacityDue = due.get("people.capacity") === true;
  const growthDue = due.get("people.growth") === true;
  const migrationDue = due.get("people.migration") === true;
  const cohortsDue = due.get("people.cohorts") === true;
  if (!techniqueDue && !conversionDue && !capacityDue && !growthDue && !migrationDue && !cohortsDue) return;

  world.ledger.beginPass(
    "people",
    world.people,
    "births",
    "deaths",
    world.cellAreaKm2,
    world._landCells,
  );
  if (techniqueDue) {
    const started = performance.now();
    stepTechnique(world, passDtMonths(techniqueSchedule!));
    addPhaseTime("technique", started);
  }
  if (conversionDue) {
    const started = performance.now();
    convertFarmers(world, passDtMonths(conversionSchedule!));
    addPhaseTime("conversion", started);
  }
  if (capacityDue) {
    const started = performance.now();
    deriveCapacity(world);
    addPhaseTime("capacity", started);
  }
  const growth = growthDue
    ? (() => {
      const started = performance.now();
      const result = grow(world, passDtMonths(growthSchedule!));
      addPhaseTime("growth", started);
      return result;
    })()
    : { births: 0, deaths: 0 };
  const migration = migrationDue
    ? (() => {
      const started = performance.now();
      const result = migrate(
        world,
        world.calendarMonth,
        passDtMonths(migrationSchedule!),
        growthDue,
      );
      addPhaseTime("migration", started);
      return result;
    })()
    : 0;
  if (growthDue || migrationDue) {
    if (world._wasmPeopleKernel) world._wasmPeopleKernel.commitPopulation();
    else {
      for (let packed = 0; packed < world._landCells.length; packed++) {
        const cell = world._landCells[packed] ?? 0;
        world.people[cell] = world._peopleNext[packed] ?? 0;
      }
    }
    refreshTechniqueShare(world);
    deriveCapacity(world);
    // Cohort normalization is a commit invariant, including migration-only
    // months. The scheduled cohorts pass records the annual ageing cadence;
    // this epilogue keeps fractions valid between those firings.
    const started = performance.now();
    normalizeCohorts(world);
    addPhaseTime("cohorts", started);
  }
  const ledgerStarted = performance.now();
  if (migrationDue) world.ledger.recordChannel("people", "migration", migration, migration);
  world.ledger.endPass("people", world.people, growth.births, growth.deaths, world._landCells);
  world.ledger.assertAll();
  addPhaseTime("ledger", ledgerStarted);
  world.debug.conservationChecks++;
  for (const schedule of world.schedule) {
    if (!passFires(world, schedule)) continue;
    world.debug.peoplePasses[schedule.name] = (world.debug.peoplePasses[schedule.name] ?? 0) + 1;
  }
  world.debug.peopleBirths = growth.births;
  world.debug.peopleDeaths = growth.deaths;
  world.debug.peopleMigration = migration;
}

export function populationTotal(worldInput: World): number {
  const world = asPeopleWorld(worldInput);
  let total = 0;
  for (const cell of world._landCells) total += (world.people[cell] ?? 0) * (world.cellAreaKm2[cell] ?? 0);
  return total;
}

export function populationDensityMean(worldInput: World): number {
  const world = asPeopleWorld(worldInput);
  let people = 0;
  let area = 0;
  for (const cell of world._landCells) {
    const cellArea = world.cellAreaKm2[cell] ?? 0;
    people += (world.people[cell] ?? 0) * cellArea;
    area += cellArea;
  }
  return area > 0 ? people / area : 0;
}

export function populationWorld(
  options: WorldOptions,
  substrate = options.substrate,
): PeopleWorld {
  if (!substrate) throw new Error("populationWorld requires a built substrate.");
  const world = new World({ ...options, substrate }) as PeopleWorld;
  return initializePeople(world);
}

export const createPeopleWorld = populationWorld;
export { asPeopleWorld };
