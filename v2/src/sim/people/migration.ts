import {
  MIGRATION_HOP_MEAN_SQUARE_WEIGHT,
  EARTH_CIRCUMFERENCE_KM,
  DIFFUSION_MSD_PER_DIFFUSIVITY,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR,
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

/** Two weights per pair: the forager weight then the farmer weight. */
const PAIR_GROUPS = 2;

function sumBands(values: Float64Array): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) total += values[index] ?? 0;
  return total;
}

/**
 * The mean square length of one hop out of a cell on this row, in km2 (W12).
 *
 * A hop lands on one of eight neighbours: two at the row's east-west spacing,
 * two at the north-south spacing, four on the diagonal at the root of their
 * squares. Averaged, that is `0.75 * (h_ew^2 + h_ns^2)` — one and a half
 * times the cell area where the cell is square, and increasingly more than
 * that toward the poles, where cells narrow east-west but keep their height.
 * The row's north-south spacing is a grid property; its east-west spacing
 * follows from the cell's area.
 */
export function meanSquareHopKm2(areaKm2: number, height: number): number {
  const northSouth = EARTH_CIRCUMFERENCE_KM / (2 * height);
  const eastWest = Math.max(1, areaKm2) / northSouth;
  return MIGRATION_HOP_MEAN_SQUARE_WEIGHT * (eastWest * eastWest + northSouth * northSouth);
}

/**
 * The per-firing share of a group that hops, for a diffusivity in km2/yr.
 *
 * A LATTICE HOP IS NOT A DIFFUSIVITY (W12, QUESTIONS #55). Moving a fraction
 * `s` of a cell's people one hop per unit time delivers a diffusion
 * coefficient of `s * <d^2> / 4`, because two-dimensional diffusion spreads
 * as `<r^2> = 4Dt`. To deliver the diffusivity the constant NAMES, the share
 * must therefore be `4 * D * dt / <d^2>`.
 *
 * It was `D * dt / area`, which is smaller by `4 * area / <d^2>` — a factor
 * of 2.67 on a square cell — so the scheme delivered about D/2.67 and the
 * front, which runs as the square root, came out at about 0.6 of its design.
 * Measured: 0.553 km/yr at the shipped grid against the ledger's own
 * `2*sqrt((r + adoption) * D)` = 0.936, with the Balkans 822 years late and
 * the Rhine 2,499. No value of the diffusivity fixes that, because dev
 * measured 1.077 — ABOVE design — so the error had opposite signs at the two
 * grids, which is the signature of a discretisation fault rather than a
 * wrong constant.
 */
export function migrationShareForArea(
  area_: number,
  dtMonths = 1,
  diffusivity: number,
  height: number,
): number {
  const area = Math.max(1, area_);
  const meanSquareHop = meanSquareHopKm2(area, height);
  const annualShare = DIFFUSION_MSD_PER_DIFFUSIVITY * diffusivity / meanSquareHop;
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

/** Cell area is a row property, so each group's substepped share is too. */
export function fillMigrationShareRows(world: PeopleWorld, dtMonths = 1): void {
  for (let y = 0; y < world.height; y++) {
    const area = world.cellAreaKm2[y * world.width] ?? 0;
    world._migrationShareRow[y] = migrationShareForArea(area, dtMonths, PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR, world.height);
    world._migrationFarmerShareRow[y] = migrationShareForArea(area, dtMonths, PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR, world.height);
  }
}

function conductance(world: PeopleWorld, target: number, slot: number): number {
  const distance = world._neighborDistanceKm[slot] ?? 0;
  const cost = world._neighborMode[slot] === 1
    ? coastalHopCost(distance)
    : (world._migrationDaysPerKm[target] ?? Number.POSITIVE_INFINITY) * distance;
  return Number.isFinite(cost) && cost >= 0 ? 1 / (1 + cost) : 0;
}

/**
 * Room by group (W6). Foragers see the land's forager capacity, farmers
 * the farmed capacity of the package they carry; both see everyone already
 * there as occupying it. On unfarmed land the forager room is what the
 * mixture gave before; in a farmed cell, whose people exceed its forager
 * capacity within a generation of arrival, it is zero — foragers do not
 * enter farmed land, and the only way in is adoption. (The M3a rule let a
 * forager source see the mixture capacity, so a cell that started farming
 * drew the foragers of all eight neighbours in as foragers: the flood the
 * W5 flat-field check measured at 58 %, QUESTIONS #40.) Room below the
 * numerical floor is no room, so a full region prices as exactly nothing.
 */
function foragerRoom(world: PeopleWorld, target: number, targetPacked: number): number {
  const room = (world._foragerCapacity[target] ?? 0) - (world._migrationPopulation[targetPacked] ?? 0);
  return room > PEOPLE_CAPACITY_FLOOR_PER_KM2 ? room * (world.cellAreaKm2[target] ?? 0) : 0;
}

function farmerRoom(world: PeopleWorld, sourcePacked: number, target: number, targetPacked: number): number {
  const sourceCell = world._landCells[sourcePacked] ?? 0;
  const farmed = packageCapacity(world, target, world._dominantPackage[sourceCell] ?? 0);
  const room = farmed - (world._migrationPopulation[targetPacked] ?? 0);
  return room > PEOPLE_CAPACITY_FLOOR_PER_KM2 ? room * (world.cellAreaKm2[target] ?? 0) : 0;
}

/**
 * Freeze the firing's population and farmer masses, the cohort fractions,
 * and each cell's room flags: whether foragers could enter it, and whether
 * the farmers of ANY active package could (a superset of what a given
 * source's package sees, so a skip never drops a flow that is not zero).
 */
function prepareCell(
  world: PeopleWorld,
  packed: number,
  growthPrepared: boolean,
  active: readonly number[],
): void {
  const cell = world._landCells[packed] ?? 0;
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
  world._migrationOut[packed] = 0;
  world._migrationOutFarmers[packed] = 0;
  world._migrationWeight[packed] = 0;
  world._migrationFarmerWeight[packed] = 0;
  world._migrationRatio[packed] = 0;
  world._migrationFarmerRatio[packed] = 0;
  world._pairWeight.fill(
    0,
    packed * PEOPLE_CROP_NEIGHBOR_COUNT * PAIR_GROUPS,
    (packed + 1) * PEOPLE_CROP_NEIGHBOR_COUNT * PAIR_GROUPS,
  );
  world._roomForagers[packed] = (world._foragerCapacity[cell] ?? 0) - population > PEOPLE_CAPACITY_FLOOR_PER_KM2 ? 1 : 0;
  let farmerRoomFlag = 0;
  for (const packageIndex of active) {
    if (packageCapacity(world, cell, packageIndex) - population > PEOPLE_CAPACITY_FLOOR_PER_KM2) {
      farmerRoomFlag = 1;
      break;
    }
  }
  world._roomFarmers[packed] = farmerRoomFlag;
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

/** Whether any neighbour has room for the group; the eight flag reads that let a full region skip its pair loop. */
function anyNeighbourRoom(world: PeopleWorld, packed: number, flags: Uint8Array): boolean {
  for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
    const target = world._neighborTargets[packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction] ?? MATH_NEGATIVE_ONE;
    if (target < 0) continue;
    const targetPacked = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
    if (targetPacked >= 0 && flags[targetPacked] === 1) return true;
  }
  return false;
}

function moveFarmers(
  world: PeopleWorld,
  sourcePacked: number,
  targetPacked: number,
  farmerFlow: number,
  targetArea: number,
  sign: number,
  active: readonly number[],
): void {
  const total = world._farmerMigrationTotal[sourcePacked] ?? 0;
  if (farmerFlow <= 0 || total <= 0) return;
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    const share = (world._farmersMigration[id]?.[sourcePacked] ?? 0) / total;
    const next = (world._farmersNext[id]?.[targetPacked] ?? 0) + sign * farmerFlow * share / targetArea;
    world._farmersNext[id]![targetPacked] = sign < 0 ? Math.max(0, next) : next;
  }
}

/**
 * Two flows over the eight-neighbour relation (W6): a source's foragers
 * split among its neighbours by conductance × forager room, its farmers by
 * conductance × farmer room, each group hopping its own share of the
 * firing and conserving itself. Each pair is priced once, in the source
 * phase, and read back through the reverse slot by the target. A source
 * none of whose neighbours has room for a group sends none of that group
 * and is not priced for it.
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
    world.debug.pricedPairs = wasm.pricedPairs();
    return wasm.migrationTotal();
  }
  // Month MONTHS_PER_YEAR is the thirteenth table, the annual mean, for a
  // firing that spans every season.
  const cycleMonth = month >= MONTHS_PER_YEAR ? MONTHS_PER_YEAR : monthIndex(month);
  let days = world._migrationDaysPerKmByMonth[cycleMonth];
  if (!days) {
    days = new Float64Array(world.N);
    if (cycleMonth === MONTHS_PER_YEAR) fillMeanMigrationDaysPerKm(world.substrate, days);
    else fillMigrationDaysPerKm(world.substrate, cycleMonth, days);
    world._migrationDaysPerKmByMonth[cycleMonth] = days;
  }
  world._migrationDaysPerKm = days;
  const areas = world.cellAreaKm2;
  const next = world._peopleNext;
  const outForagers = world._migrationOut;
  const outFarmers = world._migrationOutFarmers;
  const migrationPopulation = world._migrationPopulation;
  const childNext = world._childrenNext;
  const workingNext = world._workingNext;
  const elderNext = world._eldersNext;
  const active = activePackageIndices(world);
  world._migrationByBand.fill(0);
  world._migrationFarmerByBand.fill(0);
  world._migrationReceivedByBand.fill(0);
  world._migrationFarmerReceivedByBand.fill(0);
  let pricedPairs = 0;

  for (const band of world._peopleBands) {
    for (let row = band.rowLo; row < band.rowHi; row++) {
      // Every firing prices its own stride, each group its own share.
      const area = world.cellAreaKm2[row * world.width] ?? 0;
      world._migrationShareRow[row] = migrationShareForArea(area, dtMonths, PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR, world.height);
      world._migrationFarmerShareRow[row] = migrationShareForArea(area, dtMonths, PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR, world.height);
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
      prepareCell(world, packed, growthPrepared, active);
    }
  }

  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const population = migrationPopulation[packed] ?? 0;
      const cell = world._landCells[packed] ?? 0;
      const area = areas[cell] ?? 0;
      if (population <= 0 || area <= 0) continue;
      const farmers = world._farmerMigrationTotal[packed] ?? 0;
      const foragers = Math.max(0, population - farmers);
      const priceForagers = foragers > 0 && anyNeighbourRoom(world, packed, world._roomForagers);
      const priceFarmers = farmers > 0 && anyNeighbourRoom(world, packed, world._roomFarmers);
      if (!priceForagers && !priceFarmers) continue;
      let sumForagers = 0;
      let sumFarmers = 0;
      for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
        const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
        const target = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
        if (target < 0) continue;
        const targetPacked = world._packedOf[target] ?? MATH_NEGATIVE_ONE;
        if (targetPacked < 0) continue;
        pricedPairs++;
        const ease = conductance(world, target, slot);
        if (ease <= 0) continue;
        if (priceForagers) {
          const room = foragerRoom(world, target, targetPacked);
          if (room > 0) {
            const weight = ease * room;
            world._pairWeight[slot * PAIR_GROUPS] = weight;
            sumForagers += weight;
          }
        }
        if (priceFarmers) {
          const room = farmerRoom(world, packed, target, targetPacked);
          if (room > 0) {
            const weight = ease * room;
            world._pairWeight[slot * PAIR_GROUPS + 1] = weight;
            sumFarmers += weight;
          }
        }
      }
      const row = Math.floor(cell / world.width);
      if (sumForagers > 0) {
        const out = foragers * area * (world._migrationShareRow[row] ?? 0);
        outForagers[packed] = out;
        world._migrationWeight[packed] = sumForagers;
        world._migrationRatio[packed] = out / sumForagers;
        world._migrationByBand[band.index] = (world._migrationByBand[band.index] ?? 0) + out;
      }
      if (sumFarmers > 0) {
        const out = farmers * area * (world._migrationFarmerShareRow[row] ?? 0);
        outFarmers[packed] = out;
        world._migrationFarmerWeight[packed] = sumFarmers;
        world._migrationFarmerRatio[packed] = out / sumFarmers;
        world._migrationFarmerByBand[band.index] = (world._migrationFarmerByBand[band.index] ?? 0) + out;
      }
    }
  }
  world.debug.pricedPairs = pricedPairs;

  for (const band of world._peopleBands) {
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const foragerOut = outForagers[packed] ?? 0;
      const farmerOut = outFarmers[packed] ?? 0;
      const amount = foragerOut + farmerOut;
      if (amount <= 0) continue;
      const area = areas[cell] ?? 1;
      next[packed] = Math.max(0, (next[packed] ?? 0) - amount / area);
      moveFarmers(world, packed, packed, farmerOut, area, MATH_NEGATIVE_ONE, active);
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
      let receivedForagers = 0;
      let receivedFarmers = 0;
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
        const foragerFlow = (world._migrationRatio[sourcePacked] ?? 0) * (world._pairWeight[reverse * PAIR_GROUPS] ?? 0);
        const farmerFlow = (world._migrationFarmerRatio[sourcePacked] ?? 0) * (world._pairWeight[reverse * PAIR_GROUPS + 1] ?? 0);
        const flow = foragerFlow + farmerFlow;
        if (flow <= 0) continue;
        receivedForagers += foragerFlow;
        receivedFarmers += farmerFlow;
        moveFarmers(world, sourcePacked, packed, farmerFlow, targetArea, 1, active);
        childNext[packed] += flow * (world._childrenFraction[sourcePacked] ?? 0) / targetArea;
        workingNext[packed] += flow * (world._workingFraction[sourcePacked] ?? 0) / targetArea;
        elderNext[packed] += flow * (world._eldersFraction[sourcePacked] ?? 0) / targetArea;
      }
      const received = receivedForagers + receivedFarmers;
      if (received <= 0) continue;
      next[packed] = (next[packed] ?? 0) + received / targetArea;
      world._migrationReceived[packed] = received;
      world._migrationReceivedByBand[band.index] = (world._migrationReceivedByBand[band.index] ?? 0) + receivedForagers;
      world._migrationFarmerReceivedByBand[band.index] = (world._migrationFarmerReceivedByBand[band.index] ?? 0) + receivedFarmers;
      world._peopledMask[target] = 1;
    }
  }

  // Each group's rounding remainder goes to the first peopled cell so each
  // group's ledger channel closes to the person.
  const foragerTotal = sumBands(world._migrationByBand);
  const farmerTotal = sumBands(world._migrationFarmerByBand);
  const foragerRemainder = foragerTotal - sumBands(world._migrationReceivedByBand);
  const farmerRemainder = farmerTotal - sumBands(world._migrationFarmerReceivedByBand);
  let remainderPacked = MATH_NEGATIVE_ONE;
  for (const cell of world._landCells) {
    if (world._peopledMask[cell] === 1) {
      remainderPacked = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
      break;
    }
  }
  const remainderCell = remainderPacked >= 0 ? world._landCells[remainderPacked] ?? 0 : 0;
  const remainderArea = remainderPacked >= 0 ? areas[remainderCell] ?? 0 : 0;
  if (remainderPacked >= 0 && remainderArea > 0) {
    const density = (foragerRemainder + farmerRemainder) / remainderArea;
    next[remainderPacked] = (next[remainderPacked] ?? 0) + density;
    const remainderPopulation = migrationPopulation[remainderPacked] ?? 0;
    if (remainderPopulation > 0) {
      childNext[remainderPacked] += density * (world._childrenMass[remainderPacked] ?? 0) / remainderPopulation;
      workingNext[remainderPacked] += density * (world._workingMass[remainderPacked] ?? 0) / remainderPopulation;
      elderNext[remainderPacked] += density * (world._eldersMass[remainderPacked] ?? 0) / remainderPopulation;
    }
    if (farmerRemainder !== 0) {
      const total = world._farmerMigrationTotal[remainderPacked] ?? 0;
      if (total > 0) {
        for (const packageIndex of active) {
          const id = CROP_PACKAGES[packageIndex]?.id ?? "";
          world._farmersNext[id]![remainderPacked] += farmerRemainder / remainderArea
            * (world._farmersMigration[id]?.[remainderPacked] ?? 0) / total;
        }
      } else {
        const first = active[0];
        if (first !== undefined) {
          const id = CROP_PACKAGES[first]?.id ?? "";
          world._farmersNext[id]![remainderPacked] = Math.max(
            0,
            (world._farmersNext[id]?.[remainderPacked] ?? 0) + farmerRemainder / remainderArea,
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
  // and cannot be rebuilt from a save (review, M3a).
  for (const packageIndex of active) {
    const id = CROP_PACKAGES[packageIndex]?.id ?? "";
    world.farmers[id]!.set(world._farmersNext[id]!);
  }
  for (let packed = 0; packed < world._landCells.length; packed++) {
    let total = 0;
    for (const packageIndex of active) {
      total += world._farmersNext[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0;
    }
    world._farmerTotal[packed] = total;
  }
  return foragerTotal + farmerTotal;
}
