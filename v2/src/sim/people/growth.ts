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
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { activePackageIndices, packageCapacity, foragerDensity } from "./crop";
import type { PeopleWorld } from "./types";

export interface GrowthResult {
  readonly births: number;
  readonly deaths: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function sumBands(values: Float64Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) total += values[index] ?? 0;
  return total;
}

interface GroupGrowth {
  readonly next: number;
  readonly births: number;
  readonly deaths: number;
}

function growGroup(
  population: number,
  capacity: number,
  disease: number,
  regime: number,
  dtMonths: number,
): GroupGrowth {
  if (population <= 0 || capacity <= 0) return { next: population, births: 0, deaths: 0 };
  const monthlyRate = dtMonths === 1
    ? PEOPLE_R_GROWTH_PER_YEAR / MONTHS_PER_YEAR
    : PEOPLE_R_GROWTH_PER_YEAR * dtMonths / MONTHS_PER_YEAR;
  const rate = monthlyRate * regime / (1 + PEOPLE_DISEASE_RATE * disease);
  const naturalBirths = population * rate;
  const densityPressure = clamp01(
    (population - PEOPLE_GRAVEYARD_DENSITY) / PEOPLE_GRAVEYARD_DENSITY,
  );
  const graveyardDeaths = densityPressure > 0
    ? population
      * (dtMonths === 1 ? PEOPLE_GRAVEYARD_RATE : PEOPLE_GRAVEYARD_RATE * dtMonths)
      * dpow(densityPressure, PEOPLE_GRAVEYARD_GAMMA)
    : 0;
  const crowdingDeaths = naturalBirths * clamp01(population / capacity);
  const deaths = Math.min(population + naturalBirths, graveyardDeaths + crowdingDeaths);
  return {
    next: Math.max(0, population + naturalBirths - deaths),
    births: naturalBirths,
    deaths,
  };
}

/**
 * Grow foragers and each farmer package independently. The total people
 * field remains the sole conserved stock; package labels move inside it.
 */
export function grow(world: PeopleWorld, dtMonths = 1): GrowthResult {
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.beginGrowth(dtMonths);
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
  world._birthsByBand.fill(0);
  world._deathsByBand.fill(0);
  const activePackages = activePackageIndices(world);
  for (const band of world._peopleBands) {
    let births = 0;
    let deaths = 0;
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const population = Math.max(0, people[cell] ?? 0);
      if (population <= 0) {
        next[packed] = 0;
        childMass[packed] = 0;
        workingMass[packed] = 0;
        elderMass[packed] = 0;
        world._farmerTotalNext[packed] = 0;
        for (const packageIndex of activePackages) {
          world._farmersNext[CROP_PACKAGES[packageIndex]?.id ?? ""]![packed] = 0;
        }
        continue;
      }
      const disease = world._diseaseBurden[cell] ?? 0;
      const foragers = foragerDensity(world, cell);
      const foragerGrowth = growGroup(
        foragers,
        world._foragerCapacity[cell] ?? 0,
        disease,
        PEOPLE_GROWTH_FORAGER_FACTOR,
        dtMonths,
      );
      let totalNext = foragerGrowth.next;
      let farmerTotalNext = 0;
      let cellBirths = foragerGrowth.births;
      let cellDeaths = foragerGrowth.deaths;
      // Only active packages carry mass anywhere, and a package absent from
      // a cell needs no capacity evaluation: both skips are arithmetic
      // no-ops (adding zero mass, zero births, zero deaths) that both
      // kernels apply identically.
      for (const packageIndex of activePackages) {
        const pkg = CROP_PACKAGES[packageIndex];
        if (!pkg) continue;
        const farmer = Math.max(0, world.farmers[pkg.id]?.[packed] ?? 0);
        if (farmer <= 0) {
          world._farmersNext[pkg.id]![packed] = 0;
          continue;
        }
        const farmGrowth = growGroup(
          farmer,
          packageCapacity(world, cell, packageIndex),
          disease,
          PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN,
          dtMonths,
        );
        world._farmersNext[pkg.id]![packed] = farmGrowth.next;
        farmerTotalNext += farmGrowth.next;
        totalNext += farmGrowth.next;
        cellBirths += farmGrowth.births;
        cellDeaths += farmGrowth.deaths;
      }
      next[packed] = totalNext;
      world._farmerTotalNext[packed] = farmerTotalNext;
      births += cellBirths * (world.cellAreaKm2[cell] ?? 0);
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
        dtMonths === 1
          ? childAfter / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR)
          : childAfter / (PEOPLE_CHILD_AGE_YEARS * MONTHS_PER_YEAR) * dtMonths,
      );
      const workingToElders = Math.min(
        workingAfter,
        dtMonths === 1
          ? workingAfter / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR)
          : workingAfter / (PEOPLE_WORKING_AGE_YEARS * MONTHS_PER_YEAR) * dtMonths,
      );
      childMass[packed] = Math.max(0, childAfter - childToWorking) + cellBirths;
      workingMass[packed] = Math.max(0, workingAfter - workingToElders) + childToWorking;
      elderMass[packed] = eldersAfter + workingToElders;
    }
    world._birthsByBand[band.index] = births;
    world._deathsByBand[band.index] = deaths;
  }
  return { births: sumBands(world._birthsByBand), deaths: sumBands(world._deathsByBand) };
}
