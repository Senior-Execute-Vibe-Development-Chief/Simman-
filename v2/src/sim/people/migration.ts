import {
  MATH_NEGATIVE_ONE,
  MATH_THREE,
  MONTHS_PER_YEAR,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_MIGRATION_MAX_SUBSTEPS,
} from "../constants";
import { migrationConductance } from "../travel/cost";
import type { PeopleWorld } from "./types";

const DX = [1, MATH_NEGATIVE_ONE, 0, 0] as const;
const DY = [0, 0, 1, MATH_NEGATIVE_ONE] as const;

function neighbor(world: PeopleWorld, cell: number, direction: number): number {
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  const targetY = y + (DY[direction] ?? 0);
  if (targetY < 0 || targetY >= world.height) return MATH_NEGATIVE_ONE;
  return targetY * world.width
    + ((x + (DX[direction] ?? 0) + world.width) % world.width);
}

function migrationShare(world: PeopleWorld, cell: number): number {
  const area = Math.max(1, world.cellAreaKm2[cell] ?? 0);
  const annualShare = PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR / area;
  const rawShare = annualShare / MONTHS_PER_YEAR;
  const substeps = Math.max(
    1,
    Math.min(
      PEOPLE_MIGRATION_MAX_SUBSTEPS,
      Math.ceil(rawShare / PEOPLE_MIGRATION_MAX_SHARE),
    ),
  );
  const share = rawShare / substeps;
  let effective = 0;
  for (let index = 0; index < substeps; index++) effective += (1 - effective) * share;
  return Math.min(PEOPLE_MIGRATION_MAX_SHARE, effective);
}

function incomingFrom(
  world: PeopleWorld,
  source: number,
  target: number,
  month: number,
  targetSpare: number,
): number {
  const amount = world._migrationOut[source] ?? 0;
  const weight = world._migrationWeight[source] ?? 0;
  if (amount <= 0 || weight <= 0 || targetSpare <= 0) return 0;
  const conductance = migrationConductance(world.substrate, source, target, month);
  return amount * conductance * targetSpare / weight;
}

function incomingCohort(
  world: PeopleWorld,
  source: number,
  target: number,
  month: number,
  targetSpare: number,
  sourceMass: Float64Array,
): number {
  const migrationPopulation = world._migrationPopulation[source] ?? 0;
  if (migrationPopulation <= 0) return 0;
  return incomingFrom(world, source, target, month, targetSpare)
    * (sourceMass[source] ?? 0) / migrationPopulation;
}

/**
 * Capacity-gradient diffusion. The source scan records every outflow first;
 * the target scan then gathers the frozen records, making migration
 * order-independent and keeping the migration channel balanced.
 */
export function migrate(world: PeopleWorld, month: number): number {
  const people = world.people;
  const next = world._peopleNext;
  const out = world._migrationOut;
  const weights = world._migrationWeight;
  const migrationPopulation = world._migrationPopulation;
  const childNext = world._childrenNext;
  const workingNext = world._workingNext;
  const elderNext = world._eldersNext;
  out.fill(0);
  weights.fill(0);
  migrationPopulation.set(next);
  childNext.set(world._childrenMass);
  workingNext.set(world._workingMass);
  elderNext.set(world._eldersMass);

  for (const cell of world._landCells) {
    const population = next[cell] ?? 0;
    if (population <= 0) continue;
    const area = world.cellAreaKm2[cell] ?? 0;
    if (area <= 0) continue;
    const share = migrationShare(world, cell);
    let sumWeight = 0;
    for (let direction = 0; direction < DX.length; direction++) {
      const target = neighbor(world, cell, direction);
      if (target < 0 || !world.substrate.landMask[target]) continue;
      const spare = Math.max(0, (world.capField[target] ?? 0) - (next[target] ?? 0))
        * (world.cellAreaKm2[target] ?? 0);
      if (spare <= 0) continue;
      sumWeight += migrationConductance(world.substrate, cell, target, month) * spare;
    }
    if (sumWeight > 0) {
      out[cell] = population * area * share;
      weights[cell] = sumWeight;
    }
  }

  let total = 0;
  for (const cell of world._landCells) {
    const amount = out[cell] ?? 0;
    if (amount <= 0) continue;
    total += amount;
    next[cell] = Math.max(0, (next[cell] ?? 0) - amount / (world.cellAreaKm2[cell] ?? 1));
    const densityMoved = amount / (world.cellAreaKm2[cell] ?? 1);
    const population = migrationPopulation[cell] ?? 0;
    if (population > 0) {
      childNext[cell] = Math.max(
        0,
        (childNext[cell] ?? 0) - densityMoved * (world._childrenMass[cell] ?? 0) / population,
      );
      workingNext[cell] = Math.max(
        0,
        (workingNext[cell] ?? 0) - densityMoved * (world._workingMass[cell] ?? 0) / population,
      );
      elderNext[cell] = Math.max(
        0,
        (elderNext[cell] ?? 0) - densityMoved * (world._eldersMass[cell] ?? 0) / population,
      );
    }
  }

  for (const target of world._landCells) {
    const targetArea = world.cellAreaKm2[target] ?? 0;
    if (targetArea <= 0) continue;
    const targetSpare = Math.max(
      0,
      (world.capField[target] ?? 0) - (migrationPopulation[target] ?? 0),
    ) * targetArea;
    if (targetSpare <= 0) continue;
    const north = neighbor(world, target, MATH_THREE);
    const south = neighbor(world, target, 2);
    const west = neighbor(world, target, 1);
    const east = neighbor(world, target, 0);
    let received = 0;
    if (north >= 0) received += incomingFrom(world, north, target, month, targetSpare);
    if (south >= 0) received += incomingFrom(world, south, target, month, targetSpare);
    if (west >= 0) received += incomingFrom(world, west, target, month, targetSpare);
    if (east >= 0) received += incomingFrom(world, east, target, month, targetSpare);
    next[target] = (next[target] ?? 0) + received / targetArea;
    childNext[target] = (childNext[target] ?? 0)
      + (north >= 0 ? incomingCohort(world, north, target, month, targetSpare, world._childrenMass) : 0)
        / targetArea
      + (south >= 0 ? incomingCohort(world, south, target, month, targetSpare, world._childrenMass) : 0)
        / targetArea
      + (west >= 0 ? incomingCohort(world, west, target, month, targetSpare, world._childrenMass) : 0)
        / targetArea
      + (east >= 0 ? incomingCohort(world, east, target, month, targetSpare, world._childrenMass) : 0)
        / targetArea;
    workingNext[target] = (workingNext[target] ?? 0)
      + (north >= 0 ? incomingCohort(world, north, target, month, targetSpare, world._workingMass) : 0)
        / targetArea
      + (south >= 0 ? incomingCohort(world, south, target, month, targetSpare, world._workingMass) : 0)
        / targetArea
      + (west >= 0 ? incomingCohort(world, west, target, month, targetSpare, world._workingMass) : 0)
        / targetArea
      + (east >= 0 ? incomingCohort(world, east, target, month, targetSpare, world._workingMass) : 0)
        / targetArea;
    elderNext[target] = (elderNext[target] ?? 0)
      + (north >= 0 ? incomingCohort(world, north, target, month, targetSpare, world._eldersMass) : 0)
        / targetArea
      + (south >= 0 ? incomingCohort(world, south, target, month, targetSpare, world._eldersMass) : 0)
        / targetArea
      + (west >= 0 ? incomingCohort(world, west, target, month, targetSpare, world._eldersMass) : 0)
        / targetArea
      + (east >= 0 ? incomingCohort(world, east, target, month, targetSpare, world._eldersMass) : 0)
        / targetArea;
  }

  world._childrenMass.set(childNext);
  world._workingMass.set(workingNext);
  world._eldersMass.set(elderNext);

  return total;
}

