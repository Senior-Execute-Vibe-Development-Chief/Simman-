import {
  MONTHS_PER_YEAR,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_WATER_ACCESS_GAIN,
} from "../constants";
import { CROP_PACKAGES, pkgClimateBell } from "../../ported/worldgen/cropPackages.js";
import { sampleCropRanges } from "../../ported/worldgen/cropRangeData.js";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The farmed capacity of package p in a cell: persons per km² the land
 * supports when farmed with p. It does not depend on how many farmers are
 * there now — the first family to arrive grows toward the same land as the
 * last. (Review, M3a: scaling it by the farmer share made every founding
 * group's advantage negative, so arrivals reverted and the wave could only
 * cross a cell by out-migrating its own reversion.) The technique regime,
 * base + gain × farmed share, is the state-keyed maturity term M2 already
 * carried: a cell where most people farm has cleared, worked land.
 */
export function packageCapacity(world: PeopleWorld, cell: number, packageIndex: number): number {
  const pkg = CROP_PACKAGES[packageIndex];
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (!pkg || packed < 0) return 0;
  if ((world._canGrow[packageIndex]?.[packed] ?? 0) === 0) return 0;
  const fertility = clamp01(world.substrate.fertility[cell] ?? 0);
  const technique = clamp01(world.technique[cell] ?? 0);
  const access = world._waterAccess[cell] ?? 0;
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * (pkg.yield ?? 1)
    * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
    * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
    * (world._reliefMult[cell] ?? 0);
}

/**
 * Build the annual climate and native-range overlays once at initialization.
 * The monthly test is intentionally local: a crop can be admissible in an
 * annual climate bell yet fail because the growing season is too short.
 * The native cells of each package are listed once; the hearth law accrues
 * peopled-basin years on exactly that list.
 */
export function initializeCropFields(world: PeopleWorld): void {
  const landCount = world._landCells.length;
  const sourceRanges = world.substrate.cropNativeRanges
    ?? sampleCropRanges(world.width, world.height);
  const nativeRanges: Uint8Array[] = [];
  const nativeCells: Int32Array[] = [];
  const canGrow: Uint8Array[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    const source = sourceRanges[packageIndex];
    const native = new Uint8Array(landCount);
    const grow = new Uint8Array(landCount);
    const listed: number[] = [];
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      native[packed] = source?.[cell] ?? 0;
      if (native[packed] === 1) listed.push(packed);
      let season = 0;
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        const climateIndex = cell * MONTHS_PER_YEAR + month;
        const temperature = world.substrate.climate.temperature[climateIndex] ?? 0;
        const moisture = world.substrate.climate.moisture[climateIndex] ?? 0;
        if (temperature >= (pkg.baseTemperature ?? pkg.tOpt - pkg.tTol)
          && pkgClimateBell(pkg, temperature, moisture) >= PEOPLE_TECHNIQUE_CLIMATE_FLOOR) {
          season++;
        }
      }
      grow[packed] = season >= (pkg.seasonMinimumMonths ?? 1) ? 1 : 0;
    }
    nativeRanges.push(native);
    nativeCells.push(Int32Array.from(listed));
    canGrow.push(grow);
  }
  world._nativeRanges = nativeRanges;
  world._nativeCells = nativeCells;
  world._canGrow = canGrow;
  world._hearthYears = nativeCells.map((cells) => new Float64Array(cells.length));
}

/** Derive the compatibility technique cache: the farmed share of each cell. */
export function refreshTechniqueShare(world: PeopleWorld): void {
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    const population = Math.max(0, world.people[cell] ?? 0);
    const farmed = Math.max(0, world._farmerTotal[packed] ?? 0);
    world.technique[cell] = population > 0 ? Math.min(1, farmed / population) : 0;
  }
}

export function activePackageIndices(world: PeopleWorld): number[] {
  const result: number[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    if (world._activePackage[packageIndex] === 1) result.push(packageIndex);
  }
  return result;
}

export function markPackageActive(world: PeopleWorld, packageIndex: number): void {
  if (packageIndex >= 0 && packageIndex < world._activePackage.length) {
    world._activePackage[packageIndex] = 1;
  }
}

/**
 * The dominant package of a cell: the largest farmer mass among the active
 * packages, index order breaking ties, package 0 where nobody farms. Both
 * kernels compute it with this rule wherever capacity is derived.
 */
export function dominantPackageOf(world: PeopleWorld, packed: number, active: readonly number[]): number {
  let dominant = 0;
  let dominantMass = 0;
  for (const packageIndex of active) {
    const mass = Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
    if (mass > dominantMass) {
      dominantMass = mass;
      dominant = packageIndex;
    }
  }
  return dominant;
}

/** The farmer total is the package sum in package order; inactive packages are zero. */
export function rebuildFarmerTotals(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    let total = 0;
    for (const packageIndex of active) {
      total += Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
    }
    world._farmerTotal[packed] = total;
  }
}

export function deriveTechniqueFromFarmers(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    world._dominantPackage[cell] = dominantPackageOf(world, packed, active);
  }
  rebuildFarmerTotals(world);
  refreshTechniqueShare(world);
}

export function foragerDensity(world: PeopleWorld, cell: number): number {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  return packed >= 0
    ? Math.max(0, (world.people[cell] ?? 0) - (world._farmerTotal[packed] ?? 0))
    : Math.max(0, world.people[cell] ?? 0);
}
