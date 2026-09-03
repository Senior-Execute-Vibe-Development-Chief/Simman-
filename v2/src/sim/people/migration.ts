import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_FARMER_MOBILITY_RATIO,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_MIGRATION_MAX_SUBSTEPS,
  PEOPLE_NEIGHBOR_OPPOSITE,
} from "../constants";
import { monthIndex } from "../scheduler";
import { fillMeanMigrationDaysPerKm, fillMigrationDaysPerKm } from "../travel/cost";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { activePackageIndices, packageCapacity } from "./crop";
import type { PeopleWorld } from "./types";
import { coastalHopCost } from "./neighbors";

function sumBands(values: Float64Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) total += values[index] ?? 0;
  return total;
}

export function migrationShareForArea(
  area_: number,
  dtMonths = 1,
  diffusivity = PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
): number {
  const area = Math.max(1, area_);
  const annualShare = diffusivity / area;
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
export function fillMigrationShareRows(
  world: PeopleWorld,
  dtMonths = 1,
  diffusivity = PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
): void {
  for (let y = 0; y < world.height; y++) {
    world._migrationShareRow[y] = migrationShareForArea(
      world.cellAreaKm2[y * world.width] ?? 0,
      dtMonths,
      diffusivity,
    );
  }
}

/**
 * The regime's mobility (W5). A cell's mobile mass is foragers × forager
 * weight + farmers × farmer weight, and a source sends mobile × area ×
 * out-share, pair-split by conductance × pair spare; the farmers' part of
 * the flow is farmers × farmer weight / mobile.
 *
 * AWAKE: forager weight 1, farmer weight the mobility ratio, out-share the
 * row's forager share for the month — the kernel as it was, bit for bit.
 * SOLVE: the two groups take their OWN row shares for the stride (the
 * forager share substepped and capped by the kernel's bound, the farmer
 * share inside it by the stride's derivation) and the out-share is one.
 * Either way a farmer mass hops PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt /
 * area of itself per firing (the hop invariant). Foragers hop in both
 * regimes: the flat-field check found their inflow into farmed cells —
 * the mixture capacity opens room, and the newcomers dilute contact —
 * first-order at the front, not second (QUESTIONS #40).
 */
interface MigrationRegime {
  readonly solve: boolean;
}

function migrationRegime(solve: boolean): MigrationRegime {
  return { solve };
}

function conductance(world: PeopleWorld, target: number, slot: number): number {
  const distance = world._neighborDistanceKm[slot] ?? 0;
  const cost = world._neighborMode[slot] === 1
    ? coastalHopCost(distance)
    : (world._migrationDaysPerKm[target] ?? Number.POSITIVE_INFINITY) * distance;
  return Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0;
}

/**
 * The room a target has for what a source sends. Foragers see the target's
 * capacity as it stands (its people's own mixture); the farmers in the flow
 * see, in proportion to their share of the source, the land farmed with the
 * source's dominant package. A farming source can therefore enter forager
 * land that is full of foragers, and foragers passing through unfarmed land
 * that could be farmed cannot. Source weights and target flows evaluate this
 * same expression, so every unit that leaves a source arrives somewhere.
 */
function pairSpare(world: PeopleWorld, sourcePacked: number, target: number, targetPacked: number): number {
  const capacity = world.capField[target] ?? 0;
  const share = world._migrationFarmerShare[sourcePacked] ?? 0;
  let open = capacity;
  if (share > 0) {
    const sourceCell = world._landCells[sourcePacked] ?? 0;
    const farmed = packageCapacity(world, target, world._dominantPackage[sourceCell] ?? 0);
    open = capacity + share * Math.max(0, farmed - capacity);
  }
  return Math.max(0, open - (world._migrationPopulation[targetPacked] ?? 0))
    * (world.cellAreaKm2[target] ?? 0);
}

/**
 * Freeze the month's farmer masses and derive the mobile mass: foragers
 * move at the migration diffusivity, farmers at their own mobility, so a
 * farmer mass joins the flow at the mobility ratio. That ratio, not a speed
 * constant, is what makes the farming front slower than the peopling one.
 */
function prepareFarmers(
  world: PeopleWorld,
  packed: number,
  growthPrepared: boolean,
  active: readonly number[],
  regime: MigrationRegime,
): void {
  const total = growthPrepared
    ? world._farmerTotalNext[packed] ?? 0
    : world._farmerTotal[packed] ?? 0;
  world._farmerMigrationTotal[packed] = total;
  world._farmerTotalNext[packed] = total;
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    const current = growthPrepared
      ? world._farmersNext[id]?.[packed] ?? 0
      : world.farmers[id]?.[packed] ?? 0;
    world._farmersMigration[id]![packed] = current;
    world._farmersNext[id]![packed] = current;
  }
  const population = world._migrationPopulation[packed] ?? 0;
  const foragers = Math.max(0, population - total);
  const row = Math.floor((world._landCells[packed] ?? 0) / world.width);
  const farmerWeight = regime.solve
    ? world._migrationFarmerShareRow[row] ?? 0
    : PEOPLE_FARMER_MOBILITY_RATIO;
  const foragerWeight = regime.solve ? world._migrationShareRow[row] ?? 0 : 1;
  world._migrationFarmerWeight[packed] = farmerWeight;
  world._migrationMobile[packed] = foragers * foragerWeight + total * farmerWeight;
  world._migrationFarmerShare[packed] = population > 0 ? Math.min(1, total / population) : 0;
  world._migrationRatio[packed] = 0;
  world._pairWeight.fill(0, packed * PEOPLE_CROP_NEIGHBOR_COUNT, (packed + 1) * PEOPLE_CROP_NEIGHBOR_COUNT);
  if (population > 0) {
    world._childrenFraction[packed] = (world._childrenMass[packed] ?? 0) / population;
    world._workingFraction[packed] = (world._workingMass[packed] ?? 0) / population;
    world._eldersFraction[packed] = (world._eldersMass[packed] ?? 0) / population;
  } else {
    world._childrenFraction[packed] = 0;
    world._workingFraction[packed] = 0;
    world._eldersFraction[packed] = 0;
  }
}

function debitFarmers(
  world: PeopleWorld,
  packed: number,
  densityMoved: number,
  active: readonly number[],
): void {
  const mobile = world._migrationMobile[packed] ?? 0;
  const total = world._farmerMigrationTotal[packed] ?? 0;
  if (mobile <= 0 || total <= 0) return;
  const weight = world._migrationFarmerWeight[packed] ?? 0;
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    const fraction = (world._farmersMigration[id]?.[packed] ?? 0) * weight / mobile;
    world._farmersNext[id]![packed] = Math.max(
      0,
      (world._farmersNext[id]?.[packed] ?? 0) - densityMoved * fraction,
    );
  }
}

function gatherFarmers(
  world: PeopleWorld,
  targetPacked: number,
  sourcePacked: number,
  flow: number,
  targetArea: number,
  active: readonly number[],
): void {
  if (sourcePacked < 0 || flow <= 0) return;
  const mobile = world._migrationMobile[sourcePacked] ?? 0;
  const total = world._farmerMigrationTotal[sourcePacked] ?? 0;
  if (mobile <= 0 || total <= 0) return;
  const weight = world._migrationFarmerWeight[sourcePacked] ?? 0;
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    world._farmersNext[id]![targetPacked] += (
      flow * (world._farmersMigration[id]?.[sourcePacked] ?? 0) * weight / mobile
    ) / targetArea;
  }
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
  solve = false,
): number {
  const wasm = world._wasmPeopleKernel;
  if (wasm) {
    wasm.beginMigration(month, dtMonths, growthPrepared, solve);
    wasm.prepareMigration();
    wasm.migrateSources();
    wasm.debitMigration();
    wasm.gatherMigration();
    wasm.finishMigration();
    return wasm.migrationTotal();
  }
  // Month MONTHS_PER_YEAR is the thirteenth table, the annual mean, for a
  // firing that spans every season (the solve regime).
  const cycleMonth = month >= MONTHS_PER_YEAR ? MONTHS_PER_YEAR : monthIndex(month);
  let days = world._migrationDaysPerKmByMonth[cycleMonth];
  if (!days) {
    days = new Float64Array(world.N);
    if (cycleMonth === MONTHS_PER_YEAR) fillMeanMigrationDaysPerKm(world.substrate, days);
    else fillMigrationDaysPerKm(world.substrate, cycleMonth, days);
    world._migrationDaysPerKmByMonth[cycleMonth] = days;
  }
  world._migrationDaysPerKm = days;
  const regime = migrationRegime(solve);
  const areas = world.cellAreaKm2;
  const next = world._peopleNext;
  const out = world._migrationOut;
  const weights = world._migrationWeight;
  const migrationPopulation = world._migrationPopulation;
  const childNext = world._childrenNext;
  const workingNext = world._workingNext;
  const elderNext = world._eldersNext;
  const active = activePackageIndices(world);
  world._migrationByBand.fill(0);
  world._migrationReceivedByBand.fill(0);

  for (const band of world._peopleBands) {
    out.fill(0, band.rawLo, band.rawHi);
    weights.fill(0, band.rawLo, band.rawHi);
    for (let row = band.rowLo; row < band.rowHi; row++) {
      // Every firing prices its own stride: a monthly firing after the wake
      // must not inherit the solve regime's multi-year shares (review, W5;
      // the same expression as the opening fill, so a month is bit-identical).
      world._migrationShareRow[row] = migrationShareForArea(
        world.cellAreaKm2[row * world.width] ?? 0,
        dtMonths,
      );
      if (regime.solve) {
        world._migrationFarmerShareRow[row] = migrationShareForArea(
          world.cellAreaKm2[row * world.width] ?? 0,
          dtMonths,
          PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
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
      prepareFarmers(world, packed, growthPrepared, active, regime);
    }
  }

  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const population = next[packed] ?? 0;
      const cell = world._landCells[packed] ?? 0;
      const area = areas[cell] ?? 0;
      if (population <= 0 || area <= 0) continue;
      // Nothing mobile, nothing priced (an arithmetic no-op, both kernels).
      if ((world._migrationMobile[packed] ?? 0) <= 0) continue;
      const share = regime.solve ? 1 : world._migrationShareRow[Math.floor(cell / world.width)] ?? 0;
      let sumWeight = 0;
      for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
        const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
        const target = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
        if (target < 0) continue;
        const targetPacked = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
        if (targetPacked < 0) continue;
        const spare = pairSpare(world, packed, target, targetPacked);
        if (spare <= 0) continue;
        const contribution = conductance(world, target, slot) * spare;
        world._pairWeight[slot] = contribution;
        sumWeight += contribution;
      }
      if (sumWeight <= 0) continue;
      out[packed] = (world._migrationMobile[packed] ?? 0) * area * share;
      weights[packed] = sumWeight;
      world._migrationRatio[packed] = (out[packed] ?? 0) / sumWeight;
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
      debitFarmers(world, packed, amount / area, active);
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
      let received = 0;
      for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
        const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
        const source = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
        if (source < 0) continue;
        const sourcePacked = world._packedOf[source] ?? MATH_NEGATIVE_ONE;
        if (sourcePacked < 0) continue;
        // The source priced this pair in its own phase; read it back through
        // the reverse slot. A hop the source does not see in return (none by
        // construction) stays in the remainder.
        const reverse = sourcePacked * PEOPLE_CROP_NEIGHBOR_COUNT + (PEOPLE_NEIGHBOR_OPPOSITE[direction] ?? 0);
        if ((world._neighborTargets[reverse] ?? MATH_NEGATIVE_ONE) !== target) continue;
        const contribution = world._pairWeight[reverse] ?? 0;
        if (contribution <= 0) continue;
        const flow = (world._migrationRatio[sourcePacked] ?? 0) * contribution;
        if (flow <= 0) continue;
        received += flow;
        gatherFarmers(world, packed, sourcePacked, flow, targetArea, active);
        childNext[packed] += flow * (world._childrenFraction[sourcePacked] ?? 0) / targetArea;
        workingNext[packed] += flow * (world._workingFraction[sourcePacked] ?? 0) / targetArea;
        elderNext[packed] += flow * (world._eldersFraction[sourcePacked] ?? 0) / targetArea;
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
      const mobile = world._migrationMobile[remainderPacked] ?? 0;
      const farmerTotal = world._farmerMigrationTotal[remainderPacked] ?? 0;
      if (mobile > 0 && farmerTotal > 0) {
        for (const packageIndex of active) {
          const id = CROP_PACKAGES[packageIndex]?.id ?? "";
          world._farmersNext[id]![remainderPacked] += (
            density * ((world._farmersMigration[id]?.[remainderPacked] ?? 0) * (world._migrationFarmerWeight[remainderPacked] ?? 0) / mobile)
          );
        }
      }
    }
  }

  world._childrenMass.set(childNext);
  world._workingMass.set(workingNext);
  world._eldersMass.set(elderNext);
  // The farmer total is always the package sum in package order — never an
  // incrementally maintained value, which drifts from the sum by rounding
  // and cannot be rebuilt from a save (review, M3a: the technique field of a
  // loaded world differed in the last ulp).
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    world.farmers[id]!.set(world._farmersNext[id]!);
  }
  for (let packed = 0; packed < world._landCells.length; packed++) {
    let farmerTotal = 0;
    for (const packageIndex of active) {
      farmerTotal += world._farmersNext[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0;
    }
    world._farmerTotal[packed] = farmerTotal;
  }
  return total;
}
