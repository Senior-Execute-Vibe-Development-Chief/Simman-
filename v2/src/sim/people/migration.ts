import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_MIGRATION_MAX_SUBSTEPS,
} from "../constants";
import { monthIndex } from "../scheduler";
import { fillMigrationDaysPerKm, migrationEdgeLengths } from "../travel/cost";
import type { PeopleWorld } from "./types";

function peopled(world: PeopleWorld, cell: number): boolean {
  return world._peopledMask[cell] === 1;
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
  const migrationSource = world._migrationPopulation[source] ?? 0;
  if (flow <= 0 || migrationSource <= 0) return 0;
  return flow * (sourceMass[source] ?? 0) / migrationSource;
}

/**
 * Capacity-gradient diffusion. The source scan records every outflow first;
 * the target scan then gathers the frozen records, making migration
 * order-independent and keeping the migration channel balanced.
 *
 * Hot-loop form (M2 review): neighbor indices and conductances are computed
 * with row-local integer arithmetic — the same VALUES in the same
 * accumulation ORDER as the original neighbor()/conductance() helpers (the
 * world hash is byte-identical), without a Math.floor and modulo per edge
 * visit. Days/km fields are cached per month; climate is periodic, so the
 * cost model is paid twelve fills total.
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
    wasm.migrateSources();
    wasm.debitMigration();
    wasm.gatherMigration();
    wasm.finishMigration();
    return wasm.migrationTotal();
  }
  const width = world.width;
  if (world._migrationEdgeH === undefined || world._migrationEdgeH.length !== world.height) {
    const lengths = migrationEdgeLengths(world.substrate);
    world._migrationEdgeH = lengths.horizontal;
    world._migrationEdgeV = lengths.vertical;
  }
  const cycleMonth = monthIndex(month);
  let days = world._migrationDaysPerKmByMonth[cycleMonth];
  if (!days) {
    days = new Float64Array(world.N);
    fillMigrationDaysPerKm(world.substrate, cycleMonth, days);
    world._migrationDaysPerKmByMonth[cycleMonth] = days;
  }
  world._migrationDaysPerKm = days;
  fillMigrationShareRows(world, dtMonths);
  const edgeH = world._migrationEdgeH;
  const edgeV = world._migrationEdgeV;
  const landMask = world.substrate.landMask;
  const peopledMask = world._peopledMask;
  const capField = world.capField;
  const areas = world.cellAreaKm2;
  const next = world._peopleNext;
  const out = world._migrationOut;
  const weights = world._migrationWeight;
  const migrationPopulation = world._migrationPopulation;
  const childNext = world._childrenNext;
  const workingNext = world._workingNext;
  const elderNext = world._eldersNext;
  out.fill(0);
  weights.fill(0);
  if (growthPrepared) {
    migrationPopulation.set(next);
    childNext.set(world._childrenMass);
    workingNext.set(world._workingMass);
    elderNext.set(world._eldersMass);
  } else {
    next.set(world.people);
    migrationPopulation.set(world.people);
    for (const cell of world._landCells) {
      const population = world.people[cell] ?? 0;
      childNext[cell] = population * (world.children[cell] ?? 0);
      workingNext[cell] = population * (world.working[cell] ?? 0);
      elderNext[cell] = population * (world.elders[cell] ?? 0);
    }
    world._childrenMass.set(childNext);
    world._workingMass.set(workingNext);
    world._eldersMass.set(elderNext);
  }

  // Source scan, direction order E, W, S, N (the original DX/DY order).
  for (const cell of world._landCells) {
    const population = next[cell] ?? 0;
    if (population <= 0) continue;
    const area = areas[cell] ?? 0;
    if (area <= 0) continue;
    const y = (cell / width) | 0;
    const x = cell - y * width;
    const share = world._migrationShareRow[y] ?? 0;
    const rowLength = edgeH[y] ?? 0;
    let sumWeight = 0;

    const east = y * width + (x + 1 === width ? 0 : x + 1);
    if (landMask[east] && peopledMask[east] === 1) {
      const spare = Math.max(0, (capField[east] ?? 0) - (next[east] ?? 0)) * (areas[east] ?? 0);
      if (spare > 0) {
        const cost = (days[east] ?? Number.POSITIVE_INFINITY) * rowLength;
        sumWeight += (Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0) * spare;
      }
    }
    const west = y * width + (x === 0 ? width - 1 : x - 1);
    if (landMask[west] && peopledMask[west] === 1) {
      const spare = Math.max(0, (capField[west] ?? 0) - (next[west] ?? 0)) * (areas[west] ?? 0);
      if (spare > 0) {
        const cost = (days[west] ?? Number.POSITIVE_INFINITY) * rowLength;
        sumWeight += (Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0) * spare;
      }
    }
    if (y + 1 < world.height) {
      const south = cell + width;
      if (landMask[south] && peopledMask[south] === 1) {
        const spare = Math.max(0, (capField[south] ?? 0) - (next[south] ?? 0)) * (areas[south] ?? 0);
        if (spare > 0) {
          const cost = (days[south] ?? Number.POSITIVE_INFINITY) * edgeV;
          sumWeight += (Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0) * spare;
        }
      }
    }
    if (y > 0) {
      const north = cell - width;
      if (landMask[north] && peopledMask[north] === 1) {
        const spare = Math.max(0, (capField[north] ?? 0) - (next[north] ?? 0)) * (areas[north] ?? 0);
        if (spare > 0) {
          const cost = (days[north] ?? Number.POSITIVE_INFINITY) * edgeV;
          sumWeight += (Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0) * spare;
        }
      }
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
    next[cell] = Math.max(0, (next[cell] ?? 0) - amount / (areas[cell] ?? 1));
    const densityMoved = amount / (areas[cell] ?? 1);
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

  // Gather, flow order N, S, W, E (the original explicit sequence). A source's
  // per-edge conductance uses the SOURCE row's horizontal length — for
  // horizontal edges the rows coincide, exactly as before.
  let receivedTotal = 0;
  for (const target of world._landCells) {
    if (peopledMask[target] !== 1) continue;
    const targetArea = areas[target] ?? 0;
    if (targetArea <= 0) continue;
    const targetSpare = Math.max(
      0,
      (capField[target] ?? 0) - (migrationPopulation[target] ?? 0),
    ) * targetArea;
    if (targetSpare <= 0) continue;
    const y = (target / width) | 0;
    const x = target - y * width;
    const rowLength = edgeH[y] ?? 0;
    const targetDays = days[target] ?? Number.POSITIVE_INFINITY;
    const north = y > 0 ? target - width : MATH_NEGATIVE_ONE;
    const south = y + 1 < world.height ? target + width : MATH_NEGATIVE_ONE;
    const west = y * width + (x === 0 ? width - 1 : x - 1);
    const east = y * width + (x + 1 === width ? 0 : x + 1);

    const verticalCost = targetDays * edgeV;
    const verticalConductance = Number.isFinite(verticalCost) && verticalCost >= 0
      ? 1 / (1 + verticalCost) : 0;
    const horizontalCost = targetDays * rowLength;
    const horizontalConductance = Number.isFinite(horizontalCost) && horizontalCost >= 0
      ? 1 / (1 + horizontalCost) : 0;
    let northFlow = 0;
    if (north >= 0) {
      const amount = out[north] ?? 0;
      const weight = weights[north] ?? 0;
      if (amount > 0 && weight > 0) northFlow = amount * verticalConductance * targetSpare / weight;
    }
    let southFlow = 0;
    if (south >= 0) {
      const amount = out[south] ?? 0;
      const weight = weights[south] ?? 0;
      if (amount > 0 && weight > 0) southFlow = amount * verticalConductance * targetSpare / weight;
    }
    let westFlow = 0;
    {
      const amount = out[west] ?? 0;
      const weight = weights[west] ?? 0;
      if (amount > 0 && weight > 0) westFlow = amount * horizontalConductance * targetSpare / weight;
    }
    let eastFlow = 0;
    {
      const amount = out[east] ?? 0;
      const weight = weights[east] ?? 0;
      if (amount > 0 && weight > 0) eastFlow = amount * horizontalConductance * targetSpare / weight;
    }
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
      + cohortShareOf(world, westFlow, west, world._childrenMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._childrenMass) / targetArea;
    workingNext[target] = (workingNext[target] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._workingMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._workingMass) : 0) / targetArea
      + cohortShareOf(world, westFlow, west, world._workingMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._workingMass) / targetArea;
    elderNext[target] = (elderNext[target] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._eldersMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._eldersMass) : 0) / targetArea
      + cohortShareOf(world, westFlow, west, world._eldersMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._eldersMass) / targetArea;
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
  const remainderArea = remainderCell >= 0 ? areas[remainderCell] ?? 0 : 0;
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
