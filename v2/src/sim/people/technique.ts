import {
  EARTH_CIRCUMFERENCE_KM,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_HEARTH_BASIN_RADIUS_KM,
  PEOPLE_HEARTH_MIN_SEPARATION_KM,
  PEOPLE_HEARTH_SEED_FRACTION,
  PEOPLE_TECHNIQUE_PRESENT,
} from "../constants";
import { migrationEdgeLengths } from "../travel/cost";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
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

function basinRadiusCells(world: PeopleWorld): number {
  return Math.max(
    1,
    Math.round(PEOPLE_HEARTH_BASIN_RADIUS_KM / (EARTH_CIRCUMFERENCE_KM / world.width)),
  );
}

/**
 * Summed-area table of value × cell area over the full grid, (width+1) ×
 * (height+1) so a window sum is four reads. Basins are square windows of
 * the basin radius; the table does not wrap at the dateline, and no native
 * range sits within a basin radius of it.
 */
function fillSummedArea(world: PeopleWorld, values: ArrayLike<number>, out: Float64Array): void {
  const width = world.width;
  const stride = width + 1;
  out.fill(0, 0, stride);
  for (let y = 0; y < world.height; y++) {
    let rowSum = 0;
    const rowBase = (y + 1) * stride;
    out[rowBase] = 0;
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      rowSum += (values[cell] ?? 0) * (world.cellAreaKm2[cell] ?? 0);
      out[rowBase + x + 1] = (out[rowBase - stride + x + 1] ?? 0) + rowSum;
    }
  }
}

function windowSum(world: PeopleWorld, table: Float64Array, cell: number, radius: number): number {
  const width = world.width;
  const stride = width + 1;
  const y = Math.floor(cell / width);
  const x = cell - y * width;
  const x0 = Math.max(0, x - radius);
  const x1 = Math.min(width - 1, x + radius) + 1;
  const y0 = Math.max(0, y - radius);
  const y1 = Math.min(world.height - 1, y + radius) + 1;
  return (table[y1 * stride + x1] ?? 0)
    - (table[y0 * stride + x1] ?? 0)
    - (table[y1 * stride + x0] ?? 0)
    + (table[y0 * stride + x0] ?? 0);
}

/**
 * Peopled-basin fill: people in the basin against the basin's STATIC forager
 * capacity — the M2 law, unchanged. Measuring against the live capacity
 * stalled every hearth the moment a neighbouring wave lifted the basin to
 * farmed capacity (M2 finding); measuring against a global density bar
 * clamped every peopled basin to "full" from the opening tick (M3a review),
 * which reduced the maturity law to the catalogue lag alone.
 */
function basinFill(world: PeopleWorld, cell: number, radius: number): number {
  const capacity = windowSum(world, world._basinCapacitySum, cell, radius);
  if (capacity <= 0) return 0;
  return clamp01(windowSum(world, world._basinPeopleSum, cell, radius) / capacity);
}

function packageIndexOf(packageId: string): number {
  for (let index = 0; index < CROP_PACKAGES.length; index++) {
    if (CROP_PACKAGES[index]?.id === packageId) return index;
  }
  return MATH_NEGATIVE_ONE;
}

function canGrowAt(world: PeopleWorld, packageIndex: number, cell: number): boolean {
  const packed = world._packedOf[cell] ?? MATH_NEGATIVE_ONE;
  return packed >= 0 && (world._canGrow[packageIndex]?.[packed] ?? 0) !== 0;
}

function seedHearth(world: PeopleWorld, hearth: HearthState): void {
  const packageIndex = packageIndexOf(hearth.packageId);
  if (packageIndex < 0) return;
  const packed = world._packedOf[hearth.cell] ?? MATH_NEGATIVE_ONE;
  const farmers = world.farmers[hearth.packageId];
  if (packed < 0 || !farmers || !canGrowAt(world, packageIndex, hearth.cell)) return;
  const people = Math.max(0, world.people[hearth.cell] ?? 0);
  const current = Math.max(0, farmers[packed] ?? 0);
  const available = foragerDensity(world, hearth.cell);
  const amount = Math.min(available, Math.max(0, people * PEOPLE_HEARTH_SEED_FRACTION - current));
  farmers[packed] = current + amount;
  world._farmerTotal[packed] += amount;
  markPackageActive(world, packageIndex);
}

/**
 * Hearths condense. Every cell of a package's native range where the crop
 * can grow accrues peopled-basin years at its basin's fill; the first cells
 * to reach the package's domestication lag ignite, and a cell within the
 * separation bar of an ignited hearth of the same package is the same
 * hearth. No search window, no score, no pin: which range ignites first,
 * and where on it, is the population history of that range.
 */
function updateHearths(world: PeopleWorld, dtMonths: number): void {
  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const radius = basinRadiusCells(world);
  fillSummedArea(world, world.people, world._basinPeopleSum);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    const pkg = CROP_PACKAGES[packageIndex];
    const cells = world._nativeCells[packageIndex];
    const years = world._hearthYears[packageIndex];
    const canGrow = world._canGrow[packageIndex];
    if (!pkg || !cells || !years || !canGrow) continue;
    const ignited = world.hearths
      .filter((hearth) => hearth.ignited && hearth.packageId === pkg.id)
      .map((hearth) => hearth.cell);
    for (let index = 0; index < cells.length; index++) {
      const packed = cells[index] ?? MATH_NEGATIVE_ONE;
      if (packed < 0 || canGrow[packed] !== 1) continue;
      const cell = world._landCells[packed] ?? 0;
      const fill = basinFill(world, cell, radius);
      if (fill <= 0) continue;
      const accrued = (years[index] ?? 0) + fill * dtYears;
      years[index] = accrued;
      if (accrued < pkg.domLagY) continue;
      if ((world.people[cell] ?? 0) <= 0) continue;
      if (!separated(world, cell, ignited)) continue;
      const hearth: HearthState = {
        id: `hearth-${pkg.id}-${cell}`,
        cell,
        packageId: pkg.id,
        lagYears: pkg.domLagY,
        score: fill,
        armedYears: accrued,
        ignited: true,
      };
      world.hearths.push(hearth);
      ignited.push(cell);
      seedHearth(world, hearth);
    }
  }
}

/**
 * Farming is a label carried by people. The annual conversion pass moves
 * labels only: foragers living among farmers adopt their package where it
 * out-yields foraging, and farmers whose package cannot feed them revert.
 * Contact is LOCAL — the farmer share of the cell — so a cell converts at a
 * rate, never at a distance: a neighbour-stencil contact term moves the
 * front one cell per conversion interval and its speed is the grid spacing
 * (review, M3a; the third cardinal rule). Spread is the farmers moving.
 * The advantage saturates, adv/(1+adv): a package ten times better than
 * foraging is adopted at the rate, not ten times faster than one twice as
 * good.
 */
export function convertFarmers(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): void {
  updateHearths(world, dtMonths);
  const dtYears = dtMonths / MONTHS_PER_YEAR;
  const active = activePackageIndices(world);
  if (active.length > 0) {
    for (let packed = 0; packed < world._landCells.length; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const population = Math.max(0, world.people[cell] ?? 0);
      if (population <= 0) continue;
      const foragerCapacity = world._foragerCapacity[cell] ?? 0;
      let available = foragerDensity(world, cell);
      for (const packageIndex of active) {
        const pkg = CROP_PACKAGES[packageIndex];
        const farmer = pkg ? world.farmers[pkg.id] : undefined;
        if (!farmer) continue;
        const present = Math.max(0, farmer[packed] ?? 0);
        const farmCapacity = packageCapacity(world, cell, packageIndex);
        const advantage = foragerCapacity > 0
          ? (farmCapacity - foragerCapacity) / foragerCapacity
          : 0;
        if (advantage > 0) {
          if (available <= 0 || present <= 0) continue;
          const contact = Math.min(1, present / population);
          const amount = Math.min(
            available,
            available * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * contact * (advantage / (1 + advantage)),
          );
          farmer[packed] = present + amount;
          world._farmerTotal[packed] += amount;
          available -= amount;
        } else if (advantage < 0 && present > 0) {
          const amount = Math.min(
            present,
            present * PEOPLE_ADOPTION_RATE_PER_YEAR * dtYears * Math.min(1, -advantage),
          );
          farmer[packed] = Math.max(0, present - amount);
          world._farmerTotal[packed] = Math.max(0, (world._farmerTotal[packed] ?? 0) - amount);
          available += amount;
        }
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
  fillSummedArea(world, world._foragerCapacity, world._basinCapacitySum);
}

export function initializeTechnique(world: PeopleWorld): void {
  world.technique.fill(0);
  world._techniqueNext.fill(0);
  deriveTechniqueFromFarmers(world);
  world.hearths = [];
  for (const years of world._hearthYears) years.fill(0);
}

/**
 * Compatibility wrapper: technique is the farmed share, kept current by the
 * commit epilogue after every growth/migration month, so the scheduled
 * pass only reports coverage (a second derivation here cost a full pass
 * over every package per year for no change in state).
 */
export function stepTechnique(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): number {
  void dtMonths;
  let covered = 0;
  for (const cell of world._landCells) {
    if ((world.technique[cell] ?? 0) >= PEOPLE_TECHNIQUE_PRESENT) covered++;
  }
  return world._landCells.length > 0 ? covered / world._landCells.length : 0;
}
