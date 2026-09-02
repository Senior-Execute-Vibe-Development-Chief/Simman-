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

function addSourceWeight(
  world: PeopleWorld,
  target: number,
  edge: number,
): number {
  const packed = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
  if (packed < 0 || !peopled(world, target)) return 0;
  const spare = Math.max(
    0,
    (world.capField[target] ?? 0) - (world._peopleNext[packed] ?? 0),
  ) * (world.cellAreaKm2[target] ?? 0);
  if (spare <= 0) return 0;
  const cost = (world._migrationDaysPerKm[target] ?? Number.POSITIVE_INFINITY) * edge;
  if (Number.isFinite(cost) && cost >= 0) return (1 / (1 + cost)) * spare;
  return 0;
}

function sourceFlow(
  world: PeopleWorld,
  source: number,
  conductance: number,
  targetSpare: number,
): number {
  const packed = world._packedOf[source] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  const amount = world._migrationOut[packed] ?? 0;
  const weight = world._migrationWeight[packed] ?? 0;
  return amount > 0 && weight > 0
    ? amount * conductance * targetSpare / weight
    : 0;
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
    wasm.prepareMigration();
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
  const edgeH = world._migrationEdgeH;
  const edgeV = world._migrationEdgeV;
  const capField = world.capField;
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

  // Preparation is a separate packed phase so every neighbor's frozen next
  // population is ready before any source computes its weights.
  for (const band of world._peopleBands) {
    out.fill(0, band.rawLo, band.rawHi);
    weights.fill(0, band.rawLo, band.rawHi);
    for (let row = band.rowLo; row < band.rowHi; row++) {
      if (dtMonths !== 1) {
        world._migrationShareRow[row] = migrationShareForArea(
          world.cellAreaKm2[row * width] ?? 0,
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
    }
  }

  // Source scan, direction order E, W, S, N (the original DX/DY order).
  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const population = next[packed] ?? 0;
      if (population <= 0) continue;
      const area = areas[cell] ?? 0;
      if (area <= 0) continue;
      const y = (cell / width) | 0;
      const x = cell - y * width;
      const share = world._migrationShareRow[y] ?? 0;
      const rowLength = edgeH[y] ?? 0;
      let sumWeight = 0;

      const east = y * width + (x + 1 === width ? 0 : x + 1);
      sumWeight += addSourceWeight(world, east, rowLength);
      const west = y * width + (x === 0 ? width - 1 : x - 1);
      sumWeight += addSourceWeight(world, west, rowLength);
      if (y + 1 < world.height) {
        const south = cell + width;
        sumWeight += addSourceWeight(world, south, edgeV);
      }
      if (y > 0) {
        const north = cell - width;
        sumWeight += addSourceWeight(world, north, edgeV);
      }
      if (sumWeight > 0) {
        out[packed] = population * area * share;
        weights[packed] = sumWeight;
        world._migrationByBand[band.index] = (world._migrationByBand[band.index] ?? 0)
          + out[packed];
      }
    }
  }

  // Debit scan is a separate packed phase over the frozen source records.
  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const amount = out[packed] ?? 0;
      if (amount <= 0) continue;
      next[packed] = Math.max(0, (next[packed] ?? 0) - amount / (areas[cell] ?? 1));
      const densityMoved = amount / (areas[cell] ?? 1);
      const population = migrationPopulation[packed] ?? 0;
      if (population > 0) {
        childNext[packed] = Math.max(
          0,
          (childNext[packed] ?? 0) - densityMoved * (world._childrenMass[packed] ?? 0) / population,
        );
        workingNext[packed] = Math.max(
          0,
          (workingNext[packed] ?? 0) - densityMoved * (world._workingMass[packed] ?? 0) / population,
        );
        elderNext[packed] = Math.max(
          0,
          (elderNext[packed] ?? 0) - densityMoved * (world._eldersMass[packed] ?? 0) / population,
        );
      }
    }
  }

  // Gather, flow order N, S, W, E (the original explicit sequence). A source's
  // per-edge conductance uses the SOURCE row's horizontal length — for
  // horizontal edges the rows coincide, exactly as before.
  for (const band of world._peopleBands) {
    world._migrationReceived.fill(0, band.rawLo, band.rawHi);
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
    const target = world._landCells[packed] ?? 0;
    if (!peopled(world, target)) continue;
    const targetArea = areas[target] ?? 0;
    if (targetArea <= 0) continue;
    const targetSpare = Math.max(
      0,
      (capField[target] ?? 0) - (migrationPopulation[packed] ?? 0),
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
    const northFlow = north >= 0
      ? sourceFlow(world, north, verticalConductance, targetSpare) : 0;
    const southFlow = south >= 0
      ? sourceFlow(world, south, verticalConductance, targetSpare) : 0;
    const westFlow = sourceFlow(world, west, horizontalConductance, targetSpare);
    const eastFlow = sourceFlow(world, east, horizontalConductance, targetSpare);
    let received = 0;
    received += northFlow;
    received += southFlow;
    received += westFlow;
    received += eastFlow;
    next[packed] = (next[packed] ?? 0) + received / targetArea;
    world._migrationReceived[packed] = received;
    world._migrationReceivedByBand[band.index] = (world._migrationReceivedByBand[band.index] ?? 0)
      + received;
    childNext[packed] = (childNext[packed] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._childrenMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._childrenMass) : 0) / targetArea
      + cohortShareOf(world, westFlow, west, world._childrenMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._childrenMass) / targetArea;
    workingNext[packed] = (workingNext[packed] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._workingMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._workingMass) : 0) / targetArea
      + cohortShareOf(world, westFlow, west, world._workingMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._workingMass) / targetArea;
    elderNext[packed] = (elderNext[packed] ?? 0)
      + (north >= 0 ? cohortShareOf(world, northFlow, north, world._eldersMass) : 0) / targetArea
      + (south >= 0 ? cohortShareOf(world, southFlow, south, world._eldersMass) : 0) / targetArea
      + cohortShareOf(world, westFlow, west, world._eldersMass) / targetArea
      + cohortShareOf(world, eastFlow, east, world._eldersMass) / targetArea;
    }
  }

  // The gather uses the same frozen weights as the source scan. Deposit the
  // final floating-point remainder at the first land index so the conserved
  // person ledger is exact even when row areas differ at latitude.
  const total = sumBands(world._migrationByBand);
  const receivedTotal = sumBands(world._migrationReceivedByBand);
  const remainder = total - receivedTotal;
  let remainderPacked = MATH_NEGATIVE_ONE;
  for (const cell of world._landCells) {
    if (peopled(world, cell)) {
      remainderPacked = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
      break;
    }
  }
  const remainderCell = remainderPacked >= 0 ? world._landCells[remainderPacked] ?? 0 : 0;
  const remainderArea = remainderPacked >= 0 ? areas[remainderCell] ?? 0 : 0;
  const remainderPopulation = remainderPacked >= 0
    ? migrationPopulation[remainderPacked] ?? 0 : 0;
  if (remainderPacked >= 0 && remainderArea > 0) {
    const density = remainder / remainderArea;
    next[remainderPacked] = (next[remainderPacked] ?? 0) + density;
    if (remainderPopulation > 0) {
      childNext[remainderPacked] = (childNext[remainderPacked] ?? 0)
        + density * (world._childrenMass[remainderPacked] ?? 0) / remainderPopulation;
      workingNext[remainderPacked] = (workingNext[remainderPacked] ?? 0)
        + density * (world._workingMass[remainderPacked] ?? 0) / remainderPopulation;
      elderNext[remainderPacked] = (elderNext[remainderPacked] ?? 0)
        + density * (world._eldersMass[remainderPacked] ?? 0) / remainderPopulation;
    }
  }

  world._childrenMass.set(childNext);
  world._workingMass.set(workingNext);
  world._eldersMass.set(elderNext);

  return total;
}
