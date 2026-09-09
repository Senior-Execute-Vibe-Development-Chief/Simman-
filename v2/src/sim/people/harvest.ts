import {
  EARTH_DEGREES,
  EARTH_HALF_DEGREES,
  FOOD_RATION_TONNES_PER_PERSON_YEAR,
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
  MATH_NEGATIVE_ONE,
  MATH_NEGATIVE_TWO,
  MATH_PI,
  MATH_THREE,
  MONTHS_PER_YEAR,
  PEOPLE_STARVATION_RATE_PER_YEAR,
} from "../constants";
import { dcos, dln } from "../dmath";
import { hash32, mkRng } from "../../ported/rng";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { activePackageIndices, packageCapacity } from "./crop";
import { drainageOrder, yieldVarianceParts } from "./habitability";
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
 *   index with a 3 × 3 spatial smoothing, read at every land cell through
 *   its ROW (W30): a fixed set of weights over the weather grid — the
 *   cell's own sky, the bilinear four, and its river's, the runoff-weighted
 *   sky of its catchment routed down the drainage order — blended by the
 *   harvest's exposure to each and normalised to unit variance under the
 *   smoothing, so a river valley's year is its basin's and the CV map
 *   means the same at every cell. The raw AR(1) state is world state (`harvestZ`,
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
 *   that package feeds die back at the starvation rate, on the excess the
 *   granary does not cover (W31); foragers are exempt (their living is not
 *   the harvest — the wild year is an open item). A bottom-decile year (z
 *   under HARVEST_LEAN_Z) that also fails by more than a third is counted
 *   in `famineYears`, the cell's tally of harvest failures its farmers lived
 *   through, and every year a cell has farmers is counted in `farmedYears`
 *   (W30), the tally's denominator.
 * - THE STORE (W31): tonnes per km² of storable food. Spoilage of what stood
 *   through the year comes first; a surplus fills the granary at the package's
 *   storability; a shortfall draws from it, pooled across packages; deaths
 *   fall only on the uncovered excess. A food balance sheet posts harvest,
 *   eaten, spoiled and unstorable.
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

/** The corners of a bilinear read: the four weather cells around a sim cell. */
export const HARVEST_LOCAL_CORNERS = MATH_FOUR;

/**
 * The bilinear geometry of a sim cell (column x, row y of a width × height
 * grid) over the weather grid: its four weather cells — top-left, top-right,
 * bottom-left, bottom-right — and their weights, written at `at` in `cells`
 * and `weights`. Columns wrap the globe, rows clamp at the poles.
 */
export function harvestLocalWeights(
  x: number,
  y: number,
  width: number,
  height: number,
  cells: Int32Array,
  weights: Float64Array,
  at: number,
): void {
  const fx = (x + MATH_HALF) / width * HARVEST_COLUMNS - MATH_HALF;
  const fy = (y + MATH_HALF) / height * HARVEST_ROWS - MATH_HALF;
  const cx = Math.floor(fx);
  const cy = Math.max(0, Math.min(HARVEST_ROWS - 2, Math.floor(fy)));
  const dx = fx - cx;
  const dy = Math.max(0, Math.min(1, fy - cy));
  const cx0 = ((cx % HARVEST_COLUMNS) + HARVEST_COLUMNS) % HARVEST_COLUMNS;
  const cx1 = (cx0 + 1) % HARVEST_COLUMNS;
  const top = cy * HARVEST_COLUMNS;
  const bottom = top + HARVEST_COLUMNS;
  cells[at] = top + cx0;
  weights[at] = (1 - dx) * (1 - dy);
  cells[at + 1] = top + cx1;
  weights[at + 1] = dx * (1 - dy);
  cells[at + 2] = bottom + cx0;
  weights[at + 2] = (1 - dx) * dy;
  cells[at + MATH_THREE] = bottom + cx1;
  weights[at + MATH_THREE] = dx * dy;
}

const localCellsScratch = new Int32Array(HARVEST_LOCAL_CORNERS);
const localWeightsScratch = new Float64Array(HARVEST_LOCAL_CORNERS);

/**
 * The anomaly at a sim cell under its own sky alone: the bilinear read over
 * the weather grid at `offset` in `grids` — the rows' local term, kept for
 * the tests and the builder. A row with no river reads exactly this, scaled.
 */
export function readHarvestAnomaly(
  grids: Float64Array,
  offset: number,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  harvestLocalWeights(x, y, width, height, localCellsScratch, localWeightsScratch, 0);
  let sum = 0;
  for (let corner = 0; corner < HARVEST_LOCAL_CORNERS; corner++) {
    sum += (localWeightsScratch[corner] ?? 0) * (grids[offset + (localCellsScratch[corner] ?? 0)] ?? 0);
  }
  return sum;
}

/**
 * The year's anomaly at a land cell (W30): its row over the weather grid at
 * `offset` in `grids`, summed in row order. The kernel sums the same row in
 * the same order.
 */
export function readHarvestRow(world: PeopleWorld, grids: Float64Array, offset: number, packed: number): number {
  const start = world._harvestRowStart[packed] ?? 0;
  const end = world._harvestRowStart[packed + 1] ?? start;
  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += (world._harvestRowWeight[index] ?? 0) * (grids[offset + (world._harvestRowCell[index] ?? 0)] ?? 0);
  }
  return sum;
}

/**
 * Add `weight` × the smoothing stencil of weather cell `index` to `raw`,
 * the coefficients over the raw draws (`smoothHarvestYear`'s own weights:
 * the cell at the centre weight, its four edge neighbours at the edge
 * weight, over the norm; a clamped polar row's neighbour is the cell
 * itself). The touched indices are appended for the caller to reset.
 */
function addSmoothStencil(index: number, weight: number, raw: Float64Array, touched: number[]): void {
  const row = Math.floor(index / HARVEST_COLUMNS);
  const column = index - row * HARVEST_COLUMNS;
  const north = Math.max(0, row - 1) * HARVEST_COLUMNS + column;
  const south = Math.min(HARVEST_ROWS - 1, row + 1) * HARVEST_COLUMNS + column;
  const west = row * HARVEST_COLUMNS + (column + HARVEST_COLUMNS - 1) % HARVEST_COLUMNS;
  const east = row * HARVEST_COLUMNS + (column + 1) % HARVEST_COLUMNS;
  const centre = weight * HARVEST_SMOOTH_CENTRE / HARVEST_SMOOTH_NORM;
  const edge = weight * HARVEST_SMOOTH_EDGE / HARVEST_SMOOTH_NORM;
  raw[index] = (raw[index] ?? 0) + centre;
  touched.push(index);
  for (const neighbour of [west, east, north, south]) {
    raw[neighbour] = (raw[neighbour] ?? 0) + edge;
    touched.push(neighbour);
  }
}

/**
 * The harvest rows (W30): each land cell's read of the year as a fixed set
 * of weights over the weather grid, built once from the substrate.
 *
 * - THE LOCAL SKY is the bilinear four (`harvestLocalWeights`).
 * - THE RIVER'S SKY is the catchment's: each weather cell's local weight is
 *   carried down W13's drainage order in the composition of the flow — a
 *   cell passes on what arrived less what it took (the same share of every
 *   sky, so the take changes the volume and not the mix) plus its own
 *   runoff under its own sky — and what flows THROUGH a cell, arriving plus
 *   own, is the sky its surface water was rained from. The Nile delta reads
 *   the highlands' year; a headwater reads its own.
 * - THE BLEND is the harvest's exposure to each (`yieldVarianceParts`: the
 *   rain-fed CV over the rain-fed share plus the winter term against the
 *   flood CV over the surface-watered share), so the row's direction is the
 *   yield anomaly's own sensitivity to the two skies.
 * - UNIT VARIANCE: the blended row is divided by its standard deviation
 *   under the smoothing's covariance (its coefficients over the raw draws,
 *   summed in squares), so the multiple 1 + z·cv keeps the map's CV at
 *   every cell. The bilinear read alone did not: between four centres it
 *   averaged four draws and read a 0.69 σ year for a 1 σ one, and the polar
 *   rows read 1.2 σ — the same fix closes both.
 *
 * Rows are gathered per weather cell over the cells the drainage walk from
 * that cell's block can reach, then sorted into CSR by cell, weather cells
 * ascending. No constant is introduced: the geometry, the routing and the
 * stencil are all the existing mechanisms'.
 */
export function buildHarvestRows(world: PeopleWorld): void {
  const land = world._landCells;
  const count = land.length;
  const corners = HARVEST_LOCAL_CORNERS;
  const localCell = new Int32Array(count * corners);
  const localWeight = new Float64Array(count * corners);
  const rainExposure = new Float64Array(count);
  const floodExposure = new Float64Array(count);
  // The cells under each weather cell (CSR by weather cell): the sources of
  // its sky in the routing.
  const underStart = new Int32Array(HARVEST_CELLS + 1);
  for (let packed = 0; packed < count; packed++) {
    const cell = land[packed] ?? 0;
    const y = Math.floor(cell / world.width);
    const x = cell - y * world.width;
    harvestLocalWeights(x, y, world.width, world.height, localCell, localWeight, packed * corners);
    const parts = yieldVarianceParts(world, cell);
    rainExposure[packed] = parts.rainExposure;
    floodExposure[packed] = parts.floodExposure;
    for (let corner = 0; corner < corners; corner++) underStart[(localCell[packed * corners + corner] ?? 0) + 1]++;
  }
  for (let weather = 0; weather < HARVEST_CELLS; weather++) underStart[weather + 1] += underStart[weather] ?? 0;
  const under = new Int32Array(count * corners);
  const underCursor = Int32Array.from(underStart.subarray(0, HARVEST_CELLS));
  for (let packed = 0; packed < count; packed++) {
    for (let corner = 0; corner < corners; corner++) {
      const weather = localCell[packed * corners + corner] ?? 0;
      under[underCursor[weather] ?? 0] = packed;
      underCursor[weather] = (underCursor[weather] ?? 0) + 1;
    }
  }
  const { order, next } = drainageOrder(world);
  const position = new Int32Array(count).fill(MATH_NEGATIVE_ONE);
  for (let index = 0; index < order.length; index++) position[order[index] ?? 0] = index;
  const arriving = world._runoffInflow;
  const taken = world._runoffAccess;
  const own = world.substrate.rivers.runoff;
  // The triples (cell, weather cell, weight), gathered per weather cell and
  // sorted into rows afterwards.
  let capacity = count * corners;
  let tripleRow = new Int32Array(capacity);
  let tripleCell = new Int32Array(capacity);
  let tripleWeight = new Float64Array(capacity);
  let filled = 0;
  const push = (packed: number, weather: number, weight: number): void => {
    if (filled === capacity) {
      capacity *= 2;
      const rows = new Int32Array(capacity);
      rows.set(tripleRow);
      tripleRow = rows;
      const cellsGrown = new Int32Array(capacity);
      cellsGrown.set(tripleCell);
      tripleCell = cellsGrown;
      const weightsGrown = new Float64Array(capacity);
      weightsGrown.set(tripleWeight);
      tripleWeight = weightsGrown;
    }
    tripleRow[filled] = packed;
    tripleCell[filled] = weather;
    tripleWeight[filled] = weight;
    filled++;
  };
  const flux = new Float64Array(count);
  const marked = new Uint8Array(count);
  const active: number[] = [];
  for (let weather = 0; weather < HARVEST_CELLS; weather++) {
    // The cells this sky can reach: its block and everything downstream of
    // it, walked once each, then in drainage order.
    active.length = 0;
    for (let index = underStart[weather] ?? 0; index < (underStart[weather + 1] ?? 0); index++) {
      let packed = under[index] ?? 0;
      while (packed >= 0 && (position[packed] ?? MATH_NEGATIVE_ONE) >= 0 && marked[packed] === 0) {
        marked[packed] = 1;
        active.push(packed);
        packed = next[packed] ?? MATH_NEGATIVE_ONE;
      }
    }
    active.sort((left, right) => (position[left] ?? 0) - (position[right] ?? 0));
    for (const packed of active) {
      const cell = land[packed] ?? 0;
      const base = packed * corners;
      let local = 0;
      for (let corner = 0; corner < corners; corner++) {
        if (localCell[base + corner] === weather) local += localWeight[base + corner] ?? 0;
      }
      const inflow = flux[packed] ?? 0;
      const cellArriving = arriving[cell] ?? 0;
      const cellOwn = own[cell] ?? 0;
      const through = cellArriving + cellOwn;
      const catchment = through > 0 ? (inflow + cellOwn * local) / through : local;
      const weight = (rainExposure[packed] ?? 0) * local + (floodExposure[packed] ?? 0) * catchment;
      if (weight !== 0) push(packed, weather, weight);
      const downstream = next[packed] ?? MATH_NEGATIVE_ONE;
      if (downstream < 0) continue;
      const passed = cellArriving > 0 ? inflow * ((cellArriving - (taken[cell] ?? 0)) / cellArriving) : 0;
      flux[downstream] = (flux[downstream] ?? 0) + passed + cellOwn * local;
    }
    for (const packed of active) {
      marked[packed] = 0;
      flux[packed] = 0;
    }
  }
  // A cell the walk never reached (a cycle in the flow field; none in a
  // proper one) reads its own sky at its whole exposure.
  for (let packed = 0; packed < count; packed++) {
    if ((position[packed] ?? MATH_NEGATIVE_ONE) >= 0) continue;
    const exposure = (rainExposure[packed] ?? 0) + (floodExposure[packed] ?? 0);
    for (let corner = 0; corner < corners; corner++) {
      const weight = exposure * (localWeight[packed * corners + corner] ?? 0);
      if (weight !== 0) push(packed, localCell[packed * corners + corner] ?? 0, weight);
    }
  }
  // Rows by counting sort on the cell; within a row the weather cells stay
  // ascending, the order they were gathered in.
  const starts = new Int32Array(count + 1);
  for (let index = 0; index < filled; index++) starts[(tripleRow[index] ?? 0) + 1]++;
  for (let packed = 0; packed < count; packed++) starts[packed + 1] += starts[packed] ?? 0;
  const cursor = Int32Array.from(starts.subarray(0, count));
  const rowCell = new Int32Array(filled);
  const rowWeight = new Float64Array(filled);
  for (let index = 0; index < filled; index++) {
    const packed = tripleRow[index] ?? 0;
    const slot = cursor[packed] ?? 0;
    rowCell[slot] = tripleCell[index] ?? 0;
    rowWeight[slot] = tripleWeight[index] ?? 0;
    cursor[packed] = slot + 1;
  }
  // Unit variance under the smoothing.
  const raw = new Float64Array(HARVEST_CELLS);
  const touched: number[] = [];
  for (let packed = 0; packed < count; packed++) {
    const start = starts[packed] ?? 0;
    const end = starts[packed + 1] ?? start;
    touched.length = 0;
    for (let index = start; index < end; index++) addSmoothStencil(rowCell[index] ?? 0, rowWeight[index] ?? 0, raw, touched);
    let variance = 0;
    for (const index of touched) {
      const value = raw[index] ?? 0;
      variance += value * value;
      raw[index] = 0;
    }
    if (variance <= 0) continue;
    const scale = 1 / Math.sqrt(variance);
    for (let index = start; index < end; index++) rowWeight[index] = (rowWeight[index] ?? 0) * scale;
  }
  world._harvestRowStart = starts;
  world._harvestRowCell = rowCell;
  world._harvestRowWeight = rowWeight;
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
 * The harvest pass: the firing's years applied to every land cell. Spoilage,
 * fill and draw of the store (W31); the farmers above what each year and the
 * granary feed dying back at the starvation rate. Returns the deaths, persons
 * (density × area), for the people ledger; the food-sheet channel totals are
 * left on the band scratch for `harvestBooks`.
 */
export function stepHarvest(world: PeopleWorld, dtMonths = MONTHS_PER_YEAR): number {
  const grids = harvestGridsOf(world, dtMonths);
  const years = grids.length / HARVEST_CELLS;
  if (years <= 0) return 0;
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.harvest(grids, years);
    const books = world._wasmPeopleKernel.harvestBooks();
    world._harvestBookHarvestByBand.fill(0);
    world._harvestBookEatenByBand.fill(0);
    world._harvestBookSpoiledByBand.fill(0);
    world._harvestBookUnstorableByBand.fill(0);
    world._harvestBookHarvestByBand[0] = books.harvest;
    world._harvestBookEatenByBand[0] = books.eaten;
    world._harvestBookSpoiledByBand[0] = books.spoiled;
    world._harvestBookUnstorableByBand[0] = books.unstorable;
    world._harvestRunDeaths += books.runDeaths;
    world._harvestRunDenom += books.runDenom;
    return world._wasmPeopleKernel.harvestDeaths();
  }
  world._harvestDeathsByBand.fill(0);
  world._harvestBookHarvestByBand.fill(0);
  world._harvestBookEatenByBand.fill(0);
  world._harvestBookSpoiledByBand.fill(0);
  world._harvestBookUnstorableByBand.fill(0);
  const active = activePackageIndices(world);
  const ration = FOOD_RATION_TONNES_PER_PERSON_YEAR;
  for (const band of world._peopleBands) {
    let deaths = 0;
    let harvestTonnes = 0;
    let eatenTonnes = 0;
    let spoiledTonnes = 0;
    let unstorableTonnes = 0;
    for (let packed = band.rawLo; packed < band.rawHi; packed++) {
      const cell = world._landCells[packed] ?? 0;
      const area = world.cellAreaKm2[cell] ?? 0;
      let total = world._farmerTotal[packed] ?? 0;
      let store = world.store[cell] ?? 0;
      // Nobody farms and nothing is stored: the years pass unread.
      if (total <= 0 && store <= 0) continue;
      const spoilage = world._spoilage[cell] ?? 0;
      // A granary with no farmers only spoils (W31): the store stays on its
      // land and decays by the climate's rate alone.
      if (total <= 0) {
        for (let index = 0; index < years; index++) {
          const spoiled = store * spoilage;
          store -= spoiled;
          spoiledTonnes += spoiled * area;
        }
        world.store[cell] = store;
        continue;
      }
      // The years the cell's farmers stand through (W30): the famine tally's
      // denominator, counted on the same cells and years.
      world.farmedYears[cell] = (world.farmedYears[cell] ?? 0) + years;
      const cv = world._yieldCv[cell] ?? 0;
      const foragers = Math.max(0, (world.people[cell] ?? 0) - total);
      let cellDeaths = 0;
      let previousShort = false;
      for (let index = 0; index < years; index++) {
        const spoiled = store * spoilage;
        store -= spoiled;
        spoiledTonnes += spoiled * area;

        const anomaly = readHarvestRow(world, grids, index * HARVEST_CELLS, packed);
        const multiplier = harvestMultiplier(anomaly, cv);
        world._yearMul[packed] = multiplier;
        const famine = isFamineYear(anomaly, multiplier);
        if (famine) world.famineYears[cell] = (world.famineYears[cell] ?? 0) + 1;

        // The land each package's farmers work is their share of the cell's
        // people — the mixture capacity's shares (W8) — so the cell's harvest
        // is the farmed part of the capacity the growth pass reads, and a
        // trace package left by a conversion does not reap the whole cell.
        let farmersNow = 0;
        for (const packageIndex of active) {
          farmersNow += Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
        }
        const population = foragers + farmersNow;
        let shortfallTotal = 0;
        const shortfalls: number[] = [];
        let yearHarvest = 0;
        let yearEaten = 0;
        let yearUnstorable = 0;
        let farmersAtRisk = 0;
        for (const packageIndex of active) {
          const pkg = CROP_PACKAGES[packageIndex];
          const id = pkg?.id ?? "";
          const farmer = Math.max(0, world.farmers[id]?.[packed] ?? 0);
          shortfalls[packageIndex] = 0;
          if (farmer <= 0) continue;
          farmersAtRisk += farmer;
          const share = population > 0 ? Math.min(1, farmer / population) : 0;
          const fed = share * packageCapacity(world, cell, packageIndex) * multiplier;
          const harvestMass = fed * ration;
          const need = farmer * ration;
          yearHarvest += harvestMass;
          if (harvestMass >= need) {
            yearEaten += need;
            const surplus = harvestMass - need;
            const storability = pkg?.storability ?? 0;
            store += storability * surplus;
            yearUnstorable += (1 - storability) * surplus;
          } else {
            yearEaten += harvestMass;
            const shortfall = need - harvestMass;
            shortfalls[packageIndex] = shortfall;
            shortfallTotal += shortfall;
          }
        }

        const draw = Math.min(store, shortfallTotal);
        store -= draw;
        yearEaten += draw;
        harvestTonnes += yearHarvest * area;
        eatenTonnes += yearEaten * area;
        unstorableTonnes += yearUnstorable * area;

        let yearDeaths = 0;
        if (shortfallTotal > 0) {
          const uncoveredShare = 1 - draw / shortfallTotal;
          for (const packageIndex of active) {
            const shortfall = shortfalls[packageIndex] ?? 0;
            if (shortfall <= 0) continue;
            const id = CROP_PACKAGES[packageIndex]?.id ?? "";
            const farmer = Math.max(0, world.farmers[id]?.[packed] ?? 0);
            if (farmer <= 0) continue;
            const excess = shortfall * uncoveredShare / ration;
            const dead = Math.min(farmer, PEOPLE_STARVATION_RATE_PER_YEAR * excess);
            world.farmers[id]![packed] = farmer - dead;
            yearDeaths += dead;
          }
        }

        if (famine && farmersAtRisk > 0) {
          world._severityAtRiskPersons[cell] =
            (world._severityAtRiskPersons[cell] ?? 0) + farmersAtRisk * area;
          world._severityDeathPersons[cell] =
            (world._severityDeathPersons[cell] ?? 0) + yearDeaths * area;
        }
        if (index > 0 && yearDeaths > 0) {
          const persons = yearDeaths * area;
          world._harvestRunDenom += persons;
          if (previousShort) world._harvestRunDeaths += persons;
        }
        previousShort = shortfallTotal > 0;
        cellDeaths += yearDeaths;
      }
      world.store[cell] = store;
      let farmerTotal = 0;
      for (const packageIndex of active) {
        farmerTotal += Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
      }
      world._farmerTotal[packed] = farmerTotal;
      world.people[cell] = foragers + farmerTotal;
      if (cellDeaths > 0) deaths += cellDeaths * area;
    }
    world._harvestDeathsByBand[band.index] = (world._harvestDeathsByBand[band.index] ?? 0) + deaths;
    world._harvestBookHarvestByBand[band.index] =
      (world._harvestBookHarvestByBand[band.index] ?? 0) + harvestTonnes;
    world._harvestBookEatenByBand[band.index] =
      (world._harvestBookEatenByBand[band.index] ?? 0) + eatenTonnes;
    world._harvestBookSpoiledByBand[band.index] =
      (world._harvestBookSpoiledByBand[band.index] ?? 0) + spoiledTonnes;
    world._harvestBookUnstorableByBand[band.index] =
      (world._harvestBookUnstorableByBand[band.index] ?? 0) + unstorableTonnes;
  }
  let total = 0;
  for (let index = 0; index < world._harvestDeathsByBand.length; index++) {
    total += world._harvestDeathsByBand[index] ?? 0;
  }
  return total;
}

/** The food-sheet channel totals of the last harvest firing (W31), tonnes. */
export function harvestBooks(world: PeopleWorld): {
  readonly harvest: number;
  readonly eaten: number;
  readonly spoiled: number;
  readonly unstorable: number;
} {
  let harvest = 0;
  let eaten = 0;
  let spoiled = 0;
  let unstorable = 0;
  for (let index = 0; index < world._harvestBookHarvestByBand.length; index++) {
    harvest += world._harvestBookHarvestByBand[index] ?? 0;
    eaten += world._harvestBookEatenByBand[index] ?? 0;
    spoiled += world._harvestBookSpoiledByBand[index] ?? 0;
    unstorable += world._harvestBookUnstorableByBand[index] ?? 0;
  }
  return { harvest, eaten, spoiled, unstorable };
}
