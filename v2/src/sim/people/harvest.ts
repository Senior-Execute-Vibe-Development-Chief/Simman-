import {
  EARTH_DEGREES,
  EARTH_HALF_DEGREES,
  HARVEST_DRAW_CLAMP,
  HARVEST_FAMINE_LOSS,
  HARVEST_LEAN_Z,
  HARVEST_MULTIPLIER_CEILING,
  HARVEST_MULTIPLIER_FLOOR,
  HARVEST_SMOOTH_CENTRE,
  HARVEST_SMOOTH_EDGE,
  HARVEST_WEATHER_CELL_DEGREES,
  HARVEST_YEAR_PERSISTENCE,
  MATH_FOUR,
  MATH_HALF,
  MATH_NEGATIVE_TWO,
  MATH_PI,
  MONTHS_PER_YEAR,
  PEOPLE_STARVATION_RATE_PER_YEAR,
} from "../constants";
import { dcos, dln } from "../dmath";
import { hash32, mkRng } from "../../ported/rng";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { activePackageIndices, packageCapacity } from "./crop";
import type { PeopleWorld } from "./types";

/**
 * The harvest years (W29): v1's harvest.js ported as the field kernel it is.
 *
 * A year is not the mean year. The weather that made a harvest was one
 * anomaly over a synoptic-scale region — a drought over the whole Deccan,
 * a wet summer over all of northern Europe — persisting a little from one
 * year to the next, and a cell's harvest swung with it by as much as its
 * ground is exposed: the yield-variance map (`_yieldCv`, habitability.ts).
 *
 * - THE ANOMALY is a standard-normal field on a coarse weather grid (one
 *   cell per HARVEST_WEATHER_CELL_DEGREES), an AR(1) process in the year
 *   index with a 3 × 3 spatial smoothing, read at every land cell by
 *   bilinear interpolation. The raw AR(1) state is world state (`harvestZ`,
 *   persisted and hashed); each year's innovations come from an RNG stream
 *   addressed by the seed and the year index alone, so the awake regime
 *   (a year per firing) and the solve regime (seven per firing) advance the
 *   same series through the same years, each year exactly once: a firing
 *   at step s over dt months carries the years whose harvest month 12·k
 *   lies in [s, s + dt), and the firings tile the month line.
 * - THE YEAR'S YIELD MULTIPLE is 1 + z × cv, clamped to the floor and the
 *   ceiling: a cell on the desert edge swings by half, a river valley or a
 *   reliably watered temperate plain by a tenth.
 * - THE DEATHS: the farmers of a package above what the year's harvest of
 *   that package feeds die back at the starvation rate, in proportion to
 *   the excess; foragers are exempt (their living is not the harvest — the
 *   wild year is an open item). A bottom-decile year (z under HARVEST_LEAN_Z)
 *   that also fails by more than a third is counted in `famineYears`, the
 *   cell's tally of harvest failures its farmers lived through.
 *
 * Runs after the firing's capacity and before its growth, on the
 * authoritative fields in place, so the growth that follows starts from
 * the people the harvest left. Both kernels evaluate the same expression
 * in the same order, so the fields are bit-identical between them. Nothing
 * here is keyed on the calendar: the year index only addresses the RNG
 * stream, and the deaths follow from the cell's own ceiling and exposure.
 */
export const HARVEST_COLUMNS = EARTH_DEGREES / HARVEST_WEATHER_CELL_DEGREES;
export const HARVEST_ROWS = EARTH_HALF_DEGREES / HARVEST_WEATHER_CELL_DEGREES;
export const HARVEST_CELLS = HARVEST_COLUMNS * HARVEST_ROWS;

const HARVEST_STREAM = "harvest";
const HARVEST_OPENING = "opening";
/** The smoothing renormalises to unit variance: the root of the sum of the squared weights. */
const HARVEST_SMOOTH_NORM = Math.sqrt(
  HARVEST_SMOOTH_CENTRE * HARVEST_SMOOTH_CENTRE + MATH_FOUR * HARVEST_SMOOTH_EDGE * HARVEST_SMOOTH_EDGE,
);
/** The innovation's scale keeping the AR(1) process at unit variance. */
const HARVEST_INNOVATION = Math.sqrt(1 - HARVEST_YEAR_PERSISTENCE * HARVEST_YEAR_PERSISTENCE);

/** One standard-normal draw (Box–Muller, the cosine leg), clamped to the admitted extreme. */
function gaussian(rng: () => number): number {
  // 1 − u lies in (0, 1]: the logarithm is finite.
  const radius = Math.sqrt(MATH_NEGATIVE_TWO * dln(1 - rng()));
  const angle = 2 * MATH_PI * rng();
  const draw = radius * dcos(angle);
  return Math.max(-HARVEST_DRAW_CLAMP, Math.min(HARVEST_DRAW_CLAMP, draw));
}

/** The opening anomaly: a stationary draw, so the first year is as ordinary as any. */
export function seedHarvestYears(world: PeopleWorld): void {
  const rng = mkRng(hash32(world.seed, HARVEST_STREAM, HARVEST_OPENING));
  for (let index = 0; index < HARVEST_CELLS; index++) world.harvestZ[index] = gaussian(rng);
}

/** Advance the raw anomaly state through one year: persistence × last year + the year's innovation. */
export function advanceHarvestYear(world: PeopleWorld, year: number): void {
  const rng = mkRng(hash32(world.seed, HARVEST_STREAM, year));
  for (let index = 0; index < HARVEST_CELLS; index++) {
    world.harvestZ[index] = HARVEST_YEAR_PERSISTENCE * (world.harvestZ[index] ?? 0)
      + HARVEST_INNOVATION * gaussian(rng);
  }
}

/**
 * The 3 × 3 spatial smoothing of one year's raw state into `out` at
 * `offset`: the cell's own draw at the centre weight, its four edge
 * neighbours at the edge weight (columns wrap, rows clamp), renormalised
 * to unit variance.
 */
export function smoothHarvestYear(raw: Float64Array, out: Float64Array, offset: number): void {
  for (let row = 0; row < HARVEST_ROWS; row++) {
    const north = Math.max(0, row - 1) * HARVEST_COLUMNS;
    const south = Math.min(HARVEST_ROWS - 1, row + 1) * HARVEST_COLUMNS;
    const here = row * HARVEST_COLUMNS;
    for (let column = 0; column < HARVEST_COLUMNS; column++) {
      const west = (column + HARVEST_COLUMNS - 1) % HARVEST_COLUMNS;
      const east = (column + 1) % HARVEST_COLUMNS;
      const value = HARVEST_SMOOTH_CENTRE * (raw[here + column] ?? 0)
        + HARVEST_SMOOTH_EDGE * ((raw[here + west] ?? 0) + (raw[here + east] ?? 0)
          + (raw[north + column] ?? 0) + (raw[south + column] ?? 0));
      out[offset + here + column] = value / HARVEST_SMOOTH_NORM;
    }
  }
}

/**
 * The harvest years a firing at `step` over `dtMonths` carries: those whose
 * harvest month lies in [step, step + dtMonths). Empty (last < first) on a
 * firing shorter than the months to the next harvest.
 */
export function harvestYearsOf(step: number, dtMonths: number): { readonly first: number; readonly last: number } {
  return {
    first: Math.ceil(step / MONTHS_PER_YEAR),
    last: Math.floor((step + dtMonths - 1) / MONTHS_PER_YEAR),
  };
}

/**
 * The anomaly at a sim cell (column x, row y of a width × height grid),
 * bilinear over the weather grid at `offset` in `grids`: columns wrap the
 * globe, rows clamp at the poles. The kernel evaluates the same expression
 * in the same order.
 */
export function readHarvestAnomaly(
  grids: Float64Array,
  offset: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const fx = (x + MATH_HALF) / width * HARVEST_COLUMNS - MATH_HALF;
  const fy = (y + MATH_HALF) / height * HARVEST_ROWS - MATH_HALF;
  const cx = Math.floor(fx);
  const cy = Math.max(0, Math.min(HARVEST_ROWS - 2, Math.floor(fy)));
  const dx = fx - cx;
  const dy = Math.max(0, Math.min(1, fy - cy));
  const cx0 = ((cx % HARVEST_COLUMNS) + HARVEST_COLUMNS) % HARVEST_COLUMNS;
  const cx1 = (cx0 + 1) % HARVEST_COLUMNS;
  const top = offset + cy * HARVEST_COLUMNS;
  const bottom = top + HARVEST_COLUMNS;
  return (1 - dx) * (1 - dy) * (grids[top + cx0] ?? 0)
    + dx * (1 - dy) * (grids[top + cx1] ?? 0)
    + (1 - dx) * dy * (grids[bottom + cx0] ?? 0)
    + dx * dy * (grids[bottom + cx1] ?? 0);
}

/** The year's yield multiple: 1 + z × cv, between the floor and the ceiling. */
export function harvestMultiplier(anomaly: number, cv: number): number {
  return Math.max(HARVEST_MULTIPLIER_FLOOR, Math.min(HARVEST_MULTIPLIER_CEILING, 1 + anomaly * cv));
}

/** A famine year: a bottom-decile anomaly whose harvest fails by more than a third. */
export function isFamineYear(anomaly: number, multiplier: number): boolean {
  return anomaly < HARVEST_LEAN_Z && multiplier < HARVEST_FAMINE_LOSS;
}

/**
 * Advance the anomaly through the firing's years and return their smoothed
 * grids, one after another (`HARVEST_CELLS` each); empty when the firing
 * carries no harvest.
 */
export function harvestGridsOf(world: PeopleWorld, dtMonths: number): Float64Array {
  const { first, last } = harvestYearsOf(world.step, dtMonths);
  const years = last - first + 1;
  if (years <= 0) return new Float64Array(0);
  const grids = new Float64Array(years * HARVEST_CELLS);
  for (let index = 0; index < years; index++) {
    advanceHarvestYear(world, first + index);
    smoothHarvestYear(world.harvestZ, grids, index * HARVEST_CELLS);
  }
  return grids;
}

/**
 * The harvest pass: the firing's years applied to every land cell, the
 * farmers above what each year feeds dying back at the starvation rate.
 * Returns the deaths, persons (density × area), for the ledger.
 */
export function stepHarvest(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): number {
  const grids = harvestGridsOf(world, dtMonths);
  const years = grids.length / HARVEST_CELLS;
  if (years <= 0) return 0;
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.harvest(grids, years);
    return world._wasmPeopleKernel.harvestDeaths();
  }
  world._harvestDeathsByBand.fill(0);
  const active = activePackageIndices(world);
  for (const band of world._peopleBands) {
    let deaths = 0;
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const y = Math.floor(cell / world.width);
      const x = cell - y * world.width;
      const total = world._farmerTotal[packed] ?? 0;
      // Nobody farms here: the years pass over unread, so the pass costs the
      // farmed world and not the whole land (the multiple is a harvest's).
      if (total <= 0) continue;
      const cv = world._yieldCv[cell] ?? 0;
      const foragers = Math.max(0, (world.people[cell] ?? 0) - total);
      let cellDeaths = 0;
      for (let index = 0; index < years; index++) {
        const anomaly = readHarvestAnomaly(grids, index * HARVEST_CELLS, x, y, world.width, world.height);
        const multiplier = harvestMultiplier(anomaly, cv);
        world._yearMul[packed] = multiplier;
        if (isFamineYear(anomaly, multiplier)) world.famineYears[cell] = (world.famineYears[cell] ?? 0) + 1;
        let yearDeaths = 0;
        for (const packageIndex of active) {
          const id = CROP_PACKAGES[packageIndex]?.id ?? "";
          const farmer = Math.max(0, world.farmers[id]?.[packed] ?? 0);
          if (farmer <= 0) continue;
          const fed = packageCapacity(world, cell, packageIndex) * multiplier;
          const excess = farmer - fed;
          if (excess <= 0) continue;
          const dead = Math.min(farmer, PEOPLE_STARVATION_RATE_PER_YEAR * excess);
          world.farmers[id]![packed] = farmer - dead;
          yearDeaths += dead;
        }
        cellDeaths += yearDeaths;
      }
      if (cellDeaths <= 0) continue;
      let farmerTotal = 0;
      for (const packageIndex of active) {
        farmerTotal += Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
      }
      world._farmerTotal[packed] = farmerTotal;
      world.people[cell] = foragers + farmerTotal;
      deaths += cellDeaths * (world.cellAreaKm2[cell] ?? 0);
    }
    world._harvestDeathsByBand[band.index] = (world._harvestDeathsByBand[band.index] ?? 0) + deaths;
  }
  let total = 0;
  for (let index = 0; index < world._harvestDeathsByBand.length; index++) {
    total += world._harvestDeathsByBand[index] ?? 0;
  }
  return total;
}
