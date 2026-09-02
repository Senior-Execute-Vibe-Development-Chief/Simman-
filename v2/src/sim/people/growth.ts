import {
  MONTHS_PER_YEAR,
  PEOPLE_CHILD_AGE_YEARS,
  PEOPLE_CHILD_MORTALITY_FACTOR,
  PEOPLE_DISEASE_RATE,
  PEOPLE_ELDER_MORTALITY_FACTOR,
  PEOPLE_GRAVEYARD_DENSITY,
  PEOPLE_GRAVEYARD_GAMMA,
  PEOPLE_GRAVEYARD_RATE,
  PEOPLE_GROWTH_FORAGER_FACTOR,
  PEOPLE_GROWTH_TECHNIQUE_GAIN,
  PEOPLE_R_GROWTH_PER_YEAR,
  PEOPLE_WORKING_AGE_YEARS,
  PEOPLE_WORKING_MORTALITY_FACTOR,
} from "../constants";
import { dpow } from "../dmath";
import type { PeopleWorld } from "./types";

export interface GrowthResult {
  readonly births: number;
  readonly deaths: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Logistic demographic pass. Cohort amounts are carried as density buffers
 * beside the authoritative people field so aging and migration use the same
 * mass without creating a second population representation.
 */
export function grow(world: PeopleWorld): GrowthResult {
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.beginGrowth();
    world._wasmPeopleKernel.grow();
    return {
      births: world._wasmPeopleKernel.births(),
      deaths: world._wasmPeopleKernel.deaths(),
    };
  }
  const people = world.people;
  const next = world._peopleNext;
  const childMass = world._childrenMass;
  const workingMass = world._workingMass;
  const elderMass = world._eldersMass;
  next.fill(0);
  childMass.fill(0);
  workingMass.fill(0);
  elderMass.fill(0);
  let births = 0;
  let deaths = 0;
  for (const cell of world._landCells) {
    const population = Math.max(0, people[cell] ?? 0);
    const capacity = world.capField[cell] ?? 0;
    if (population <= 0 || capacity <= 0) {
      next[cell] = 0;
      childMass[cell] = 0;
      workingMass[cell] = 0;
      elderMass[cell] = 0;
      continue;
    }
    const technique = clamp01(world.technique[cell] ?? 0);
    const regime = PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN * technique;
    const rate = PEOPLE_R_GROWTH_PER_YEAR / MONTHS_PER_YEAR
      * regime
      / (1 + PEOPLE_DISEASE_RATE * (world._diseaseBurden[cell] ?? 0));
    const naturalBirths = population * rate;
    const densityPressure = clamp01(
      (population - PEOPLE_GRAVEYARD_DENSITY) / PEOPLE_GRAVEYARD_DENSITY,
    );
    const graveyardDeaths = densityPressure > 0
      ? population * PEOPLE_GRAVEYARD_RATE * dpow(densityPressure, PEOPLE_GRAVEYARD_GAMMA)
      : 0;
    const crowdingDeaths = naturalBirths * clamp01(population / capacity);
    const cellDeaths = Math.min(population + naturalBirths, graveyardDeaths + crowdingDeaths);
    const nextPopulation = Math.max(0, population + naturalBirths - cellDeaths);
    next[cell] = nextPopulation;
    births += naturalBirths * (world.cellAreaKm2[cell] ?? 0);
    deaths += cellDeaths * (world.cellAreaKm2[cell] ?? 0);

    const child = population * clamp01(world.children[cell] ?? 0);
    const working = population * clamp01(world.working[cell] ?? 0);
    const elders = population * clamp01(world.elders[cell] ?? 0);
    const mortalityWeight = child * PEOPLE_CHILD_MORTALITY_FACTOR
      + working * PEOPLE_WORKING_MORTALITY_FACTOR
      + elders * PEOPLE_ELDER_MORTALITY_FACTOR;
    const childDeaths = mortalityWeight > 0
      ? cellDeaths * child * PEOPLE_CHILD_MORTALITY_FACTOR / mortalityWeight : 0;
    const workingDeaths = mortalityWeight > 0
      ? cellDeaths * working * PEOPLE_WORKING_MORTALITY_FACTOR / mortalityWeight : 0;
    const elderDeaths = Math.max(0, cellDeaths - childDeaths - workingDeaths);
    const childAfter = Math.max(0, child - childDeaths);
    const workingAfter = Math.max(0, working - workingDeaths);
    const eldersAfter = Math.max(0, elders - elderDeaths);
    const childToWorking = Math.min(
      childAfter,
      childAfter / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR),
    );
    const workingToElders = Math.min(
      workingAfter,
      workingAfter / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR),
    );
    childMass[cell] = Math.max(0, childAfter - childToWorking) + naturalBirths;
    workingMass[cell] = Math.max(0, workingAfter - workingToElders) + childToWorking;
    elderMass[cell] = eldersAfter + workingToElders;
  }
  return { births, deaths };
}

