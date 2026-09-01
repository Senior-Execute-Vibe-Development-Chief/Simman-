import {
  MATH_NEGATIVE_ONE,
  MATH_THREE,
  MONTHS_PER_YEAR,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_MIGRATION_MAX_SUBSTEPS,
} from "../constants";
import { fillMigrationDaysPerKm, migrationEdgeLengths } from "../travel/cost";
import type { PeopleWorld } from "./types";

const DX = [1, MATH_NEGATIVE_ONE, 0, 0] as const;
const DY = [0, 0, 1, MATH_NEGATIVE_ONE] as const;

function peopled(world: PeopleWorld, cell: number): boolean {
  return world._peopledMask[cell] === 1;
}

/**
 * Cached per-tick conductance: bit-identical to cost.ts migrationConductance
 * (same factor order), with days/km paid once per cell per tick and the
 * 4-neighbor edge lengths from per-row tables.
 */
function conductance(world: PeopleWorld, from: number, to: number): number {
  const fromY = Math.floor(from / world.width);
  const toY = Math.floor(to / world.width);
  const length = fromY === toY
    ? world._migrationEdgeH[fromY] ?? 0
    : world._migrationEdgeV;
  const cost = (world._migrationDaysPerKm[to] ?? Number.POSITIVE_INFINITY) * length;
  return Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0;
}

function neighbor(world: PeopleWorld, cell: number, direction: number): number {
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  const targetY = y + (DY[direction] ?? 0);
  if (targetY < 0 || targetY >= world.height) return MATH_NEGATIVE_ONE;
  return targetY * world.width
    + ((x + (DX[direction] ?? 0) + world.width) % world.width);
}

function migrationShareForArea(area_: number): number {
  const area = Math.max(1, area_);
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

/** Cell area is a row property, so the substepped share is too. */
function fillMigrationShareRows(world: PeopleWorld): void {
  for (let y = 0; y < world.height; y++) {
    world._migrationShareRow[y] = migrationShareForArea(world.cellAreaKm2[y * world.width] ?? 0);
  }
}

function cohortShareOf(
  world: PeopleWorld,
  flow: number,
  source: number,
  sourceMass: Float64Array,
): number {
  const migrationSource = world._migrationPopulation[source] ?? 0;
  if (flow <= 0 || migrationSource <= 0) return 0;
  return flow * (sourceMass[source] ?? 0) / migrationSource;
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
  return amount * conductance(world, source, target) * targetSpare / weight;
}

/**
 * Capacity-gradient diffusion. The source scan records every outflow first;
 * the target scan then gathers the frozen records, making migration
 * order-independent and keeping the migration channel balanced.
 */
export function migrate(world: PeopleWorld, month: number): number {
  if (world._migrationEdgeH === undefined || world._migrationEdgeH.length !== world.height) {
    const lengths = migrationEdgeLengths(world.substrate);
    world._migrationEdgeH = lengths.horizontal;
    world._migrationEdgeV = lengths.vertical;
  }
  fillMigrationDaysPerKm(world.substrate, month, world._migrationDaysPerKm);
  fillMigrationShareRows(world);
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
    const share = world._migrationShareRow[Math.floor(cell / world.width)] ?? 0;
    let sumWeight = 0;
    for (let direction = 0; direction < DX.length; direction++) {
      const target = neighbor(world, cell, direction);
      if (target < 0 || !world.substrate.landMask[target] || !peopled(world, target)) continue;
      const spare = Math.max(0, (world.capField[target] ?? 0) - (next[target] ?? 0))
        * (world.cellAreaKm2[target] ?? 0);
      if (spare <= 0) continue;
      sumWeight += conductance(world, cell, target) * spare;
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

  let receivedTotal = 0;
  for (const target of world._landCells) {
    if (!peopled(world, target)) continue;
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
    const northFlow = north >= 0 ? incomingFrom(world, north, target, month, targetSpare) : 0;
    const southFlow = south >= 0 ? incomingFrom(world, south, target, month, targetSpare) : 0;
    const westFlow = west >= 0 ? incomingFrom(world, west, target, month, targetSpare) : 0;
    const eastFlow = east >= 0 ? incomingFrom(world, east, target, month, targetSpare) : 0;
    let received = 0;
    received += northFlow;
    received += southFlow;
    received += westFlow;
    received += eastFlow;
    next[target] = (next[target] ?? 0) + received / targetArea;
    receivedTotal += received;
    childNext[target] = (childNext[target] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._childrenMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._childrenMass) : 0) / targetArea
      + (west >= 0 ? cohortShareOf(world, westFlow, west, world._childrenMass) : 0) / targetArea
      + (east >= 0 ? cohortShareOf(world, eastFlow, east, world._childrenMass) : 0) / targetArea;
    workingNext[target] = (workingNext[target] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._workingMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._workingMass) : 0) / targetArea
      + (west >= 0 ? cohortShareOf(world, westFlow, west, world._workingMass) : 0) / targetArea
      + (east >= 0 ? cohortShareOf(world, eastFlow, east, world._workingMass) : 0) / targetArea;
    elderNext[target] = (elderNext[target] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._eldersMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._eldersMass) : 0) / targetArea
      + (west >= 0 ? cohortShareOf(world, westFlow, west, world._eldersMass) : 0) / targetArea
      + (east >= 0 ? cohortShareOf(world, eastFlow, east, world._eldersMass) : 0) / targetArea;
  }

  // The gather uses the same frozen weights as the source scan. Deposit the
  // final floating-point remainder at the first land index so the conserved
  // person ledger is exact even when row areas differ at latitude.
  const remainder = total - receivedTotal;
  let remainderCell = MATH_NEGATIVE_ONE;
  for (const cell of world._landCells) {
    if (peopled(world, cell)) {
      remainderCell = cell;
      break;
    }
  }
  const remainderArea = remainderCell >= 0 ? world.cellAreaKm2[remainderCell] ?? 0 : 0;
  const remainderPopulation = remainderCell >= 0
    ? migrationPopulation[remainderCell] ?? 0 : 0;
  if (remainderCell >= 0 && remainderArea > 0) {
    next[remainderCell] = (next[remainderCell] ?? 0) + remainder / remainderArea;
    if (remainderPopulation > 0) {
      childNext[remainderCell] = (childNext[remainderCell] ?? 0)
        + remainder / remainderArea * (world._childrenMass[remainderCell] ?? 0) / remainderPopulation;
      workingNext[remainderCell] = (workingNext[remainderCell] ?? 0)
        + remainder / remainderArea * (world._workingMass[remainderCell] ?? 0) / remainderPopulation;
      elderNext[remainderCell] = (elderNext[remainderCell] ?? 0)
        + remainder / remainderArea * (world._eldersMass[remainderCell] ?? 0) / remainderPopulation;
    }
  }

  world._childrenMass.set(childNext);
  world._workingMass.set(workingNext);
  world._eldersMass.set(elderNext);

  return total;
}

