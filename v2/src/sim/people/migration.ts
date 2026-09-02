import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_MIGRATION_MAX_SUBSTEPS,
} from "../constants";
import { monthIndex } from "../scheduler";
import { fillMigrationDaysPerKm } from "../travel/cost";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import type { PeopleWorld } from "./types";
import { coastalHopCost } from "./neighbors";

function sumBands(values: Float64Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) total += values[index] ?? 0;
  return total;
}

export function migrationShareForArea(area_: number, dtMonths = 1): number {
  const area = Math.max(1, area_);
  const annualShare = PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR / area;
  const rawShare = dtMonths === 1
    ? annualShare / MONTHS_PER_YEAR
    : annualShare * dtMonths / MONTHS_PER_YEAR;
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
export function fillMigrationShareRows(world: PeopleWorld, dtMonths = 1): void {
  for (let y = 0; y < world.height; y++) {
    world._migrationShareRow[y] = migrationShareForArea(
      world.cellAreaKm2[y * world.width] ?? 0,
      dtMonths,
    );
  }
}

function cohortShareOf(
  world: PeopleWorld,
  flow: number,
  source: number,
  sourceMass: Float64Array,
): number {
  const packed = world._packedOf[source] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  const migrationSource = world._migrationPopulation[packed] ?? 0;
  if (flow <= 0 || migrationSource <= 0) return 0;
  return flow * (sourceMass[packed] ?? 0) / migrationSource;
}

function conductance(world: PeopleWorld, target: number, slot: number): number {
  const distance = world._neighborDistanceKm[slot] ?? 0;
  const cost = world._neighborMode[slot] === 1
    ? coastalHopCost(distance)
    : (world._migrationDaysPerKm[target] ?? Number.POSITIVE_INFINITY) * distance;
  return Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0;
}

function addSourceWeight(world: PeopleWorld, target: number, slot: number): number {
  const packed = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  const spare = Math.max(
    0,
    (world.capField[target] ?? 0) - (world._peopleNext[packed] ?? 0),
  ) * (world.cellAreaKm2[target] ?? 0);
  if (spare <= 0) return 0;
  return conductance(world, target, slot) * spare;
}

function sourceFlow(
  world: PeopleWorld,
  source: number,
  conductance_: number,
  targetSpare: number,
): number {
  const packed = world._packedOf[source] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  const amount = world._migrationOut[packed] ?? 0;
  const weight = world._migrationWeight[packed] ?? 0;
  return amount > 0 && weight > 0
    ? amount * conductance_ * targetSpare / weight
    : 0;
}

function prepareFarmers(world: PeopleWorld, packed: number, growthPrepared: boolean): void {
  const total = growthPrepared
    ? world._farmerTotalNext[packed] ?? 0
    : world._farmerTotal[packed] ?? 0;
  world._farmerMigrationTotal[packed] = total;
  world._farmerTotalNext[packed] = total;
  for (const pkg of CROP_PACKAGES) {
    const current = growthPrepared
      ? world._farmersNext[pkg.id]?.[packed] ?? 0
      : world.farmers[pkg.id]?.[packed] ?? 0;
    world._farmersMigration[pkg.id]![packed] = current;
    world._farmersNext[pkg.id]![packed] = current;
  }
}

function debitFarmers(world: PeopleWorld, packed: number, densityMoved: number): void {
  const population = world._migrationPopulation[packed] ?? 0;
  if (population <= 0) return;
  world._farmerTotalNext[packed] = Math.max(
    0,
    (world._farmerTotalNext[packed] ?? 0)
      - densityMoved * (world._farmerMigrationTotal[packed] ?? 0) / population,
  );
  for (const pkg of CROP_PACKAGES) {
    const moved = densityMoved * (world._farmersMigration[pkg.id]?.[packed] ?? 0) / population;
    world._farmersNext[pkg.id]![packed] = Math.max(
      0,
      (world._farmersNext[pkg.id]?.[packed] ?? 0) - moved,
    );
  }
}

function gatherFarmers(
  world: PeopleWorld,
  targetPacked: number,
  source: number,
  flow: number,
  targetArea: number,
): void {
  if (source < 0 || flow <= 0) return;
  const sourcePacked = world._packedOf[source] ?? MATH_NEGATIVE_ONE;
  const sourcePopulation = sourcePacked >= 0
    ? world._migrationPopulation[sourcePacked] ?? 0
    : 0;
  if (sourcePopulation <= 0) return;
  const movedTotal = flow * (world._farmerMigrationTotal[sourcePacked] ?? 0) / sourcePopulation;
  for (const pkg of CROP_PACKAGES) {
    world._farmersNext[pkg.id]![targetPacked] += (
      flow * (world._farmersMigration[pkg.id]?.[sourcePacked] ?? 0) / sourcePopulation
    ) / targetArea;
  }
  world._farmerTotalNext[targetPacked] += movedTotal / targetArea;
}

/**
 * Eight-neighbour capacity-gradient diffusion. The same frozen farmer
 * masses that leave a source are gathered at the target, so farmer labels
 * conserve exactly with the people stock.
 */
export function migrate(
  world: PeopleWorld,
  month: number,
  dtMonths = 1,
  growthPrepared = true,
): number {
  const wasm = world._wasmPeopleKernel;
  if (wasm) {
    wasm.beginMigration(month, dtMonths, growthPrepared);
    wasm.prepareMigration();
    wasm.migrateSources();
    wasm.debitMigration();
    wasm.gatherMigration();
    wasm.finishMigration();
    return wasm.migrationTotal();
  }
  const cycleMonth = monthIndex(month);
  let days = world._migrationDaysPerKmByMonth[cycleMonth];
  if (!days) {
    days = new Float64Array(world.N);
    fillMigrationDaysPerKm(world.substrate, cycleMonth, days);
    world._migrationDaysPerKmByMonth[cycleMonth] = days;
  }
  world._migrationDaysPerKm = days;
  const areas = world.cellAreaKm2;
  const next = world._peopleNext;
  const out = world._migrationOut;
  const weights = world._migrationWeight;
  const migrationPopulation = world._migrationPopulation;
  const childNext = world._childrenNext;
  const workingNext = world._workingNext;
  const elderNext = world._eldersNext;
  world._migrationByBand.fill(0);
  world._migrationReceivedByBand.fill(0);

  for (const band of world._peopleBands) {
    out.fill(0, band.rawLo, band.rawHi);
    weights.fill(0, band.rawLo, band.rawHi);
    for (let row = band.rowLo; row < band.rowHi; row++) {
      if (dtMonths !== 1) {
        world._migrationShareRow[row] = migrationShareForArea(
          world.cellAreaKm2[row * world.width] ?? 0,
          dtMonths,
        );
      }
    }
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      if (growthPrepared) {
        migrationPopulation[packed] = next[packed] ?? 0;
        childNext[packed] = world._childrenMass[packed] ?? 0;
        workingNext[packed] = world._workingMass[packed] ?? 0;
        elderNext[packed] = world._eldersMass[packed] ?? 0;
      } else {
        const population = world.people[cell] ?? 0;
        next[packed] = population;
        migrationPopulation[packed] = population;
        childNext[packed] = population * (world.children[cell] ?? 0);
        workingNext[packed] = population * (world.working[cell] ?? 0);
        elderNext[packed] = population * (world.elders[cell] ?? 0);
        world._childrenMass[packed] = childNext[packed] ?? 0;
        world._workingMass[packed] = workingNext[packed] ?? 0;
        world._eldersMass[packed] = elderNext[packed] ?? 0;
      }
      prepareFarmers(world, packed, growthPrepared);
    }
  }

  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const population = next[packed] ?? 0;
      const cell = world._landCells[packed] ?? 0;
      const area = areas[cell] ?? 0;
      if (population <= 0 || area <= 0) continue;
      const share = world._migrationShareRow[Math.floor(cell / world.width)] ?? 0;
      let sumWeight = 0;
      for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
        const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
        const target = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
        if (target >= 0) sumWeight += addSourceWeight(world, target, slot);
      }
      if (sumWeight <= 0) continue;
      out[packed] = population * area * share;
      weights[packed] = sumWeight;
      world._migrationByBand[band.index] = (world._migrationByBand[band.index] ?? 0) + out[packed];
    }
  }

  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const amount = out[packed] ?? 0;
      if (amount <= 0) continue;
      const area = areas[cell] ?? 1;
      next[packed] = Math.max(0, (next[packed] ?? 0) - amount / area);
      debitFarmers(world, packed, amount / area);
      const population = migrationPopulation[packed] ?? 0;
      if (population > 0) {
        childNext[packed] = Math.max(
          0,
          (childNext[packed] ?? 0) - amount / area * (world._childrenMass[packed] ?? 0) / population,
        );
        workingNext[packed] = Math.max(
          0,
          (workingNext[packed] ?? 0) - amount / area * (world._workingMass[packed] ?? 0) / population,
        );
        elderNext[packed] = Math.max(
          0,
          (elderNext[packed] ?? 0) - amount / area * (world._eldersMass[packed] ?? 0) / population,
        );
      }
    }
  }

  for (const band of world._peopleBands) {
    world._migrationReceived.fill(0, band.rawLo, band.rawHi);
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const target = world._landCells[packed] ?? 0;
      const targetArea = areas[target] ?? 0;
      if (targetArea <= 0) continue;
      const targetSpare = Math.max(
        0,
        (world.capField[target] ?? 0) - (migrationPopulation[packed] ?? 0),
      ) * targetArea;
      if (targetSpare <= 0) continue;
      let received = 0;
      for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
        const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
        const source = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
        if (source < 0) continue;
        const flow = sourceFlow(world, source, conductance(world, target, slot), targetSpare);
        received += flow;
        gatherFarmers(world, packed, source, flow, targetArea);
        childNext[packed] += cohortShareOf(world, flow, source, world._childrenMass) / targetArea;
        workingNext[packed] += cohortShareOf(world, flow, source, world._workingMass) / targetArea;
        elderNext[packed] += cohortShareOf(world, flow, source, world._eldersMass) / targetArea;
      }
      if (received <= 0) continue;
      next[packed] = (next[packed] ?? 0) + received / targetArea;
      world._migrationReceived[packed] = received;
      world._migrationReceivedByBand[band.index] = (world._migrationReceivedByBand[band.index] ?? 0) + received;
      world._peopledMask[target] = 1;
    }
  }

  const total = sumBands(world._migrationByBand);
  const receivedTotal = sumBands(world._migrationReceivedByBand);
  const remainder = total - receivedTotal;
  let remainderPacked = MATH_NEGATIVE_ONE;
  for (const cell of world._landCells) {
    if (world._peopledMask[cell] === 1) {
      remainderPacked = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
      break;
    }
  }
  const remainderCell = remainderPacked >= 0 ? world._landCells[remainderPacked] ?? 0 : 0;
  const remainderArea = remainderPacked >= 0 ? areas[remainderCell] ?? 0 : 0;
  const remainderPopulation = remainderPacked >= 0 ? migrationPopulation[remainderPacked] ?? 0 : 0;
  if (remainderPacked >= 0 && remainderArea > 0) {
    const density = remainder / remainderArea;
    next[remainderPacked] = (next[remainderPacked] ?? 0) + density;
    if (remainderPopulation > 0) {
      childNext[remainderPacked] += density * (world._childrenMass[remainderPacked] ?? 0) / remainderPopulation;
      workingNext[remainderPacked] += density * (world._workingMass[remainderPacked] ?? 0) / remainderPopulation;
      elderNext[remainderPacked] += density * (world._eldersMass[remainderPacked] ?? 0) / remainderPopulation;
      world._farmerTotalNext[remainderPacked] += (
        density * (world._farmerMigrationTotal[remainderPacked] ?? 0) / remainderPopulation
      );
      for (const pkg of CROP_PACKAGES) {
        world._farmersNext[pkg.id]![remainderPacked] += (
          density * (world._farmersMigration[pkg.id]?.[remainderPacked] ?? 0) / remainderPopulation
        );
      }
    }
  }

  world._childrenMass.set(childNext);
  world._workingMass.set(workingNext);
  world._eldersMass.set(elderNext);
  world._farmerTotal.set(world._farmerTotalNext);
  for (const pkg of CROP_PACKAGES) world.farmers[pkg.id]!.set(world._farmersNext[pkg.id]!);
  return total;
}
