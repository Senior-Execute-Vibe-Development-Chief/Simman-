import {
  MATH_NEGATIVE_ONE,
  PEOPLE_COHORT_CHILD_FRACTION,
  PEOPLE_COHORT_ELDER_FRACTION,
  PEOPLE_COHORT_WORKING_FRACTION,
  PEOPLE_INITIAL_FILL_FRACTION,
} from "../constants";
import { deriveCapacity } from "./capacity";
import { cellAreasKm2, annualClimateFromSubstrate, foragerCapacity } from "./habitability";
import { grow } from "./growth";
import { migrate } from "./migration";
import { initializeTechnique, stepTechnique } from "./technique";
import { asPeopleWorld, type PeopleWorld } from "./types";
import { World } from "../world";
import type { WorldOptions } from "../world";

function allocatePeopleScratch(world: PeopleWorld): void {
  const length = world.N;
  world.capField = new Float64Array(length);
  world._peopleNext = new Float64Array(length);
  world._techniqueNext = new Float64Array(length);
  world._childrenMass = new Float64Array(length);
  world._workingMass = new Float64Array(length);
  world._eldersMass = new Float64Array(length);
  world._childrenNext = new Float64Array(length);
  world._workingNext = new Float64Array(length);
  world._eldersNext = new Float64Array(length);
  world._migrationOut = new Float64Array(length);
  world._migrationWeight = new Float64Array(length);
  world._migrationPopulation = new Float64Array(length);
  world._landCells = new Int32Array(length);
  let landCount = 0;
  for (let cell = 0; cell < length; cell++) {
    if (!world.substrate.landMask[cell]) continue;
    world._landCells[landCount++] = cell;
  }
  world._landCells = world._landCells.slice(0, landCount);
  world._annualTemperature = new Float64Array(length);
  world._annualMoisture = new Float64Array(length);
  world._techniqueSuitability = new Float64Array(length);
  world.cellAreaKm2 = cellAreasKm2(world.width, world.height);
}

function seedPopulation(world: PeopleWorld): number {
  const substrate = world.substrate;
  let total = 0;
  for (const cell of world._landCells) {
    const peopled = (substrate.ancestry.lineage[cell] ?? MATH_NEGATIVE_ONE) >= 0
      && (substrate.ancestry.arrival[cell] ?? MATH_NEGATIVE_ONE) >= 0;
    if (!peopled) continue;
    const density = foragerCapacity(world, cell) * PEOPLE_INITIAL_FILL_FRACTION;
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
  world.ledger.beginPass(
    "people",
    world.people,
    "initialPeopling",
    "deaths",
    world.cellAreaKm2,
  );
  const initialPeople = seedPopulation(world);
  initializeTechnique(world);
  deriveCapacity(world);
  world.ledger.recordChannel("people", "initialPeopling", initialPeople, 0);
  world.ledger.endPass("people", world.people, initialPeople, 0);
  world.peopleInitialized = true;
  return world;
}

function normalizeCohorts(world: PeopleWorld): void {
  for (const cell of world._landCells) {
    const population = world.people[cell] ?? 0;
    if (population <= 0) {
      world.children[cell] = 0;
      world.working[cell] = 0;
      world.elders[cell] = 0;
      continue;
    }
    const child = Math.max(0, Math.min(1, (world._childrenMass[cell] ?? 0) / population));
    const working = Math.max(0, Math.min(1 - child, (world._workingMass[cell] ?? 0) / population));
    world.children[cell] = child;
    world.working[cell] = working;
    world.elders[cell] = Math.max(0, 1 - child - working);
  }
}

export function stepPeople(worldInput: World): void {
  const world = initializePeople(worldInput);
  world.ledger.beginPass(
    "people",
    world.people,
    "births",
    "deaths",
    world.cellAreaKm2,
  );
  stepTechnique(world);
  deriveCapacity(world);
  const growth = grow(world);
  const migration = migrate(world, world.calendarMonth);
  world.people.set(world._peopleNext);
  normalizeCohorts(world);
  world.ledger.recordChannel("people", "migration", migration, migration);
  world.ledger.endPass("people", world.people, growth.births, growth.deaths);
  world.ledger.assertAll();
  world.debug.peoplePasses++;
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
