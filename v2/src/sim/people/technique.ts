import {
  EARTH_CIRCUMFERENCE_KM,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_FORAGER_DENSITY_BAR,
  PEOPLE_HEARTH_BASIN_RADIUS_KM,
  PEOPLE_HEARTH_MIN_SEPARATION_KM,
  PEOPLE_HEARTH_SEED_FRACTION,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_TECHNIQUE_PRESENT,
} from "../constants";
import { fillMigrationDaysPerKm, migrationEdgeLengths } from "../travel/cost";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { buildPeopleNeighborTable, coastalHopCost } from "./neighbors";
import {
  activePackageIndices,
  deriveTechniqueFromFarmers,
  foragerDensity,
  markPackageActive,
  packageCapacity,
} from "./crop";
import type { HearthState, PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function separated(world: PeopleWorld, candidate: number, chosen: readonly number[]): boolean {
  const candidateY = Math.floor(candidate / world.width);
  const candidateX = candidate - candidateY * world.width;
  const cellKm = EARTH_CIRCUMFERENCE_KM / world.width;
  const minimum = PEOPLE_HEARTH_MIN_SEPARATION_KM / cellKm;
  for (const other of chosen) {
    const otherY = Math.floor(other / world.width);
    const otherX = other - otherY * world.width;
    const rawDx = Math.abs(candidateX - otherX);
    const dx = Math.min(rawDx, world.width - rawDx);
    const dy = candidateY - otherY;
    if (Math.sqrt(dx * dx + dy * dy) < minimum) return false;
  }
  return true;
}

function basinFill(world: PeopleWorld, cell: number): number {
  const radius = Math.max(
    1,
    Math.round(PEOPLE_HEARTH_BASIN_RADIUS_KM / (EARTH_CIRCUMFERENCE_KM / world.width)),
  );
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  let people = 0;
  let area = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= world.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const xx = (x + dx + world.width) % world.width;
      const index = yy * world.width + xx;
      people += (world.people[index] ?? 0) * (world.cellAreaKm2[index] ?? 0);
      area += world.cellAreaKm2[index] ?? 0;
    }
  }
  const density = area > 0 ? people / area : 0;
  return clamp01(density / PEOPLE_FORAGER_DENSITY_BAR);
}

function packageIndex(packageId: string): number {
  for (let index = 0; index < CROP_PACKAGES.length; index++) {
    if (CROP_PACKAGES[index]?.id === packageId) return index;
  }
  return MATH_NEGATIVE_ONE;
}

function canGrowAt(world: PeopleWorld, packageIndex_: number, cell: number): boolean {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  return packed >= 0 && (world._canGrow[packageIndex_]?.[packed] ?? 0) !== 0;
}

function findCandidate(world: PeopleWorld, packageIndex_: number): HearthState | undefined {
  const pkg = CROP_PACKAGES[packageIndex_];
  if (!pkg) return undefined;
  const existingPending = world.hearths.some(
    (hearth) => !hearth.ignited && hearth.packageId === pkg.id,
  );
  if (existingPending) return undefined;
  const chosen = world.hearths
    .filter((hearth) => hearth.ignited && hearth.packageId === pkg.id)
    .map((hearth) => hearth.cell);
  const native = world._nativeRanges[packageIndex_];
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    if (native?.[packed] !== 1 || world._peopledMask[cell] !== 1) continue;
    if (!canGrowAt(world, packageIndex_, cell)) continue;
    if (basinFill(world, cell) <= 0 || !separated(world, cell, chosen)) continue;
    return {
      id: `hearth-${pkg.id}-${cell}`,
      cell,
      packageId: pkg.id,
      lagYears: pkg.domLagY,
      score: basinFill(world, cell),
      armedYears: 0,
      ignited: false,
    };
  }
  return undefined;
}

function seedHearth(world: PeopleWorld, hearth: HearthState): void {
  const packageIndex_ = packageIndex(hearth.packageId);
  if (packageIndex_ < 0) return;
  const packed = world._packedOf[hearth.cell] ?? MATH_NEGATIVE_ONE;
  const farmers = world.farmers[hearth.packageId];
  if (packed < 0 || !farmers || !canGrowAt(world, packageIndex_, hearth.cell)) return;
  const people = Math.max(0, world.people[hearth.cell] ?? 0);
  const current = Math.max(0, farmers[packed] ?? 0);
  const available = foragerDensity(world, hearth.cell);
  const amount = Math.min(available, Math.max(0, people * PEOPLE_HEARTH_SEED_FRACTION - current));
  farmers[packed] = current + amount;
  world._farmerTotal[packed] += amount;
  markPackageActive(world, packageIndex_);
}

function updateHearths(world: PeopleWorld, dtMonths: number): void {
  for (let packageIndex_ = 0; packageIndex_ < CROP_PACKAGES.length; packageIndex_++) {
    const candidate = findCandidate(world, packageIndex_);
    if (candidate) world.hearths.push(candidate);
  }
  for (const hearth of world.hearths) {
    if (hearth.ignited) continue;
    const fill = basinFill(world, hearth.cell);
    hearth.armedYears += fill * dtMonths / MONTHS_PER_YEAR;
    if (hearth.armedYears < hearth.lagYears) continue;
    hearth.ignited = true;
    seedHearth(world, hearth);
  }
}

function contactForPackage(world: PeopleWorld, cell: number, packageId: string): number {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  let days = world._migrationDaysPerKmByMonth[world.calendarMonth];
  if (!days) {
    days = new Float64Array(world.N);
    fillMigrationDaysPerKm(world.substrate, world.calendarMonth, days);
    world._migrationDaysPerKmByMonth[world.calendarMonth] = days;
  }
  const localPeople = Math.max(0, world.people[cell] ?? 0);
  let weightedContact = localPeople > 0
    ? (world.farmers[packageId]?.[packed] ?? 0) / localPeople
    : 0;
  let weightTotal = 1;
  const farmer = world.farmers[packageId];
  if (!farmer) return 0;
  for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
    const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
    const target = world._neighborTargets[slot] ?? MATH_NEGATIVE_ONE;
    const targetPacked = target >= 0 ? world._packedOf[target] ?? MATH_NEGATIVE_ONE : MATH_NEGATIVE_ONE;
    if (targetPacked < 0) continue;
    const distance = world._neighborDistanceKm[slot] ?? 0;
    const cost = world._neighborMode[slot] === 1
      ? coastalHopCost(distance)
      : (days[target] ?? Number.POSITIVE_INFINITY) * distance;
    if (!Number.isFinite(cost) || cost < 0) continue;
    const weight = 1 / (1 + cost);
    const targetPeople = Math.max(0, world.people[target] ?? 0);
    weightedContact += weight * (targetPeople > 0 ? (farmer[targetPacked] ?? 0) / targetPeople : 0);
    weightTotal += weight;
  }
  return clamp01(weightedContact / weightTotal);
}

/**
 * Farming is a demic label carried by people. The annual conversion pass
 * moves labels only; no scalar technique wave is allowed to outrun farmers.
 */
export function convertFarmers(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): void {
  updateHearths(world, dtMonths);
  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const active = activePackageIndices(world);
  for (const cell of world._landCells) {
    const population = Math.max(0, world.people[cell] ?? 0);
    if (population <= 0) continue;
    let available = foragerDensity(world, cell);
    for (const packageIndex_ of active) {
      const pkg = CROP_PACKAGES[packageIndex_];
      if (!pkg) continue;
      const farmer = world.farmers[pkg.id];
      if (!farmer) continue;
      const farmCapacity = packageCapacity(world, cell, packageIndex_);
      const foragerCapacity = world._foragerCapacity[cell] ?? 0;
      const advantage = foragerCapacity > 0
        ? (farmCapacity - foragerCapacity) / foragerCapacity
        : 0;
      const contact = contactForPackage(world, cell, pkg.id);
      if (advantage > 0 && available > 0) {
        const amount = Math.min(
          available,
          available * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * contact * advantage,
        );
        const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
        farmer[packed] = (farmer[packed] ?? 0) + amount;
        world._farmerTotal[packed] += amount;
        available -= amount;
      } else if (advantage < 0) {
        const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
        const amount = Math.min(
          farmer[packed] ?? 0,
          (farmer[packed] ?? 0) * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * Math.min(1, -advantage),
        );
        farmer[packed] = Math.max(0, (farmer[packed] ?? 0) - amount);
        world._farmerTotal[packed] = Math.max(0, (world._farmerTotal[packed] ?? 0) - amount);
        available += amount;
      }
    }
  }
  deriveTechniqueFromFarmers(world);
}

export function prepareTechnique(world: PeopleWorld): void {
  if (world._canGrow.length !== CROP_PACKAGES.length) {
    throw new Error("Crop fields were not initialized before the people pass.");
  }
  const lengths = migrationEdgeLengths(world.substrate);
  world._techniqueEdgeH = lengths.horizontal;
  world._techniqueEdgeV = lengths.vertical;
}

export function initializeTechnique(world: PeopleWorld): void {
  world.technique.fill(0);
  world._techniqueNext.fill(0);
  deriveTechniqueFromFarmers(world);
  world.hearths = [];
}

/** Compatibility wrapper: the technique cache is derived from farmer mass. */
export function stepTechnique(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): number {
  void dtMonths;
  deriveTechniqueFromFarmers(world);
  let covered = 0;
  for (const cell of world._landCells) {
    if ((world.technique[cell] ?? 0) >= PEOPLE_TECHNIQUE_PRESENT) covered++;
  }
  return world._landCells.length > 0 ? covered / world._landCells.length : 0;
}
