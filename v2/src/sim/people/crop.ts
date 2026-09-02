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

export function packageCapacity(world: PeopleWorld, cell: number, packageIndex: number): number {
  const pkg = CROP_PACKAGES[packageIndex];
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (!pkg || packed < 0) return 0;
  if ((world._canGrow[packageIndex]?.[packed] ?? 0) === 0) return 0;
  const fertility = Math.max(0, Math.min(1, world.substrate.fertility[cell] ?? 0));
  const technique = Math.max(0, Math.min(1, world.technique[cell] ?? 0));
  const access = world._waterAccess[cell] ?? 0;
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * (pkg.yield ?? 1)
    * technique
    * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
    * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
    * (world._reliefMult[cell] ?? 0);
}

/**
 * Build the annual climate and native-range overlays once at initialization.
 * The monthly test is intentionally local: a crop can be admissible in an
 * annual climate bell yet fail because the growing season is too short.
 */
export function initializeCropFields(world: PeopleWorld): void {
  const landCount = world._landCells.length;
  const sourceRanges = world.substrate.cropNativeRanges
    ?? sampleCropRanges(world.width, world.height);
  const nativeRanges: Uint8Array[] = [];
  const canGrow: Uint8Array[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    const source = sourceRanges[packageIndex];
    const native = new Uint8Array(landCount);
    const grow = new Uint8Array(landCount);
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      native[packed] = source?.[cell] ?? 0;
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
    canGrow.push(grow);
  }
  world._nativeRanges = nativeRanges;
  world._canGrow = canGrow;
}

/** Derive the compatibility technique cache and the package lens index. */
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

export function rebuildFarmerTotals(world: PeopleWorld): void {
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    let total = 0;
    for (const pkg of CROP_PACKAGES) {
      total += Math.max(0, world.farmers[pkg.id]?.[packed] ?? 0);
    }
    world._farmerTotal[packed] = total;
  }
}

export function deriveTechniqueFromFarmers(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  for (const cell of world._landCells) {
    const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
    let dominant = 0;
    let dominantMass = 0;
    for (const packageIndex of active) {
      const mass = Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
      if (mass > dominantMass) {
        dominantMass = mass;
        dominant = packageIndex;
      }
    }
    world._dominantPackage[cell] = dominant;
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
