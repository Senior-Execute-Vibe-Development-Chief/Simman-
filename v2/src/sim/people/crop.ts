import {
  MONTHS_PER_YEAR,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_TECHNIQUE_CLIMATE_FLOOR,
  PEOPLE_WATER_ACCESS_GAIN,
  PEOPLE_WILD_STAND_CAPACITY_PER_KM2,
} from "../constants";
import { CROP_PACKAGES, pkgClimateBell, pkgMoistureBell, pkgTemperatureBell, pkgWildBell } from "../../ported/worldgen/cropPackages.js";
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
  // The climate bell gates can-grow and (W8) grades the harvest: a
  // package's capacity in a cell scales with how well the cell suits it.
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * (pkg.yield ?? 1)
    * (world._cropFit[packageIndex]?.[packed] ?? 0)
    * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
    * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
    * (world._reliefMult[cell] ?? 0);
}

/**
 * Persons per km² a cell's wild stand of a package feeds (W8): the density
 * a dense stand held its gatherers at, graded by the stand's richness — the
 * wild-habitat bell on the cell's annual climate inside the range polygon.
 * Static; built once with the crop fields.
 */
export function standCapacity(world: PeopleWorld, cell: number, packageIndex: number): number {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  if (packed < 0) return 0;
  return world._standCapacity[packageIndex]?.[packed] ?? 0;
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
  const fits: Float64Array[] = [];
  const richness: Float64Array[] = [];
  world._standBest.fill(0);
  world._standCapacityBest.fill(0);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    const source = sourceRanges[packageIndex];
    const native = new Uint8Array(landCount);
    const grow = new Uint8Array(landCount);
    const fit = new Float64Array(landCount);
    const stand = new Float64Array(landCount);
    const listed: number[] = [];
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      native[packed] = source?.[cell] ?? 0;
      if (native[packed] === 1) listed.push(packed);
      let season = 0;
      let fitSum = 0;
      const access = world._waterAccess[cell] ?? 0;
      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        const climateIndex = cell * MONTHS_PER_YEAR + month;
        const temperature = world.substrate.climate.temperature[climateIndex] ?? 0;
        const moisture = world.substrate.climate.moisture[climateIndex] ?? 0;
        const bell = pkgClimateBell(pkg, temperature, moisture);
        if (temperature >= (pkg.baseTemperature ?? pkg.tOpt - pkg.tTol)
          && bell >= PEOPLE_TECHNIQUE_CLIMATE_FLOOR) {
          season++;
          // The fit (W8): the crop's warmth term times its water term, where
          // the water is met by rain or by the water the land gives access to
          // — a floodplain grows wheat in a desert.
          fitSum += pkgTemperatureBell(pkg, temperature) * Math.max(pkgMoistureBell(pkg, moisture), access);
        }
      }
      grow[packed] = season >= (pkg.seasonMinimumMonths ?? 1) ? 1 : 0;
      fit[packed] = grow[packed] === 1 ? fitSum / season : 0;
      // Stand richness (W8): inside the range polygon, where the crop can
      // grow, the wild-habitat bell on the annual climate.
      if (native[packed] === 1 && grow[packed] === 1) {
        stand[packed] = pkgWildBell(pkg, world._annualTemperature[cell] ?? 0, world._annualMoisture[cell] ?? 0);
      }
    }
    nativeRanges.push(native);
    nativeCells.push(Int32Array.from(listed));
    canGrow.push(grow);
    fits.push(fit);
    richness.push(stand);
  }
  world._nativeRanges = nativeRanges;
  world._nativeCells = nativeCells;
  world._canGrow = canGrow;
  world._cropFit = fits;
  world._standRichness = richness;
  world._hearthYears = nativeCells.map((cells) => new Float64Array(cells.length));
  world._hearthDone = nativeCells.map((cells) => new Uint8Array(cells.length));
  const standCapacities: Float64Array[] = [];
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const capacity = new Float64Array(landCount);
    const stand = richness[packageIndex]!;
    for (let packed = 0; packed < landCount; packed++) {
      const cell = world._landCells[packed] ?? 0;
      if ((stand[packed] ?? 0) <= 0) continue;
      capacity[packed] = PEOPLE_WILD_STAND_CAPACITY_PER_KM2 * (stand[packed] ?? 0);
      if ((stand[packed] ?? 0) > (world._standBest[cell] ?? 0)) world._standBest[cell] = stand[packed] ?? 0;
      if ((capacity[packed] ?? 0) > (world._standCapacityBest[cell] ?? 0)) world._standCapacityBest[cell] = capacity[packed] ?? 0;
    }
    standCapacities.push(capacity);
  }
  world._standCapacity = standCapacities;
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
