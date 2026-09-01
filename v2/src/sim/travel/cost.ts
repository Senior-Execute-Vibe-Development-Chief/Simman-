import {
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  ELEVATION_METERS_PER_UNIT,
  MONTHS_PER_YEAR,
  TRAVEL_BASE_TERRAIN,
  TRAVEL_COLD_COST_FACTOR,
  TRAVEL_COLD_THRESHOLD,
  TRAVEL_COASTAL_BAND_KM,
  TRAVEL_COASTAL_KM_PER_DAY,
  TRAVEL_COASTAL_MIN_FACTOR,
  SEA_FREEZING_TEMPERATURE,
  TRAVEL_COST_FREIGHT_LAND,
  TRAVEL_COST_FREIGHT_RIVER,
  TRAVEL_COST_FREIGHT_SEA,
  TRAVEL_ELEVATION_FACTOR,
  TRAVEL_INFRASTRUCTURE_FACTOR,
  TRAVEL_LAND_MIN_FACTOR,
  TRAVEL_MOISTURE_FLOOR,
  TRAVEL_MODE_COASTAL_INDEX,
  TRAVEL_MODE_OPEN_SEA_INDEX,
  TRAVEL_MODE_RIVER_INDEX,
  TRAVEL_MUD_COST_FACTOR,
  TRAVEL_OPEN_SEA_KM_PER_DAY,
  TRAVEL_PACK_KM_PER_DAY,
  TRAVEL_RIVER_KM_PER_DAY,
  TRAVEL_RIVER_DOWNSTREAM_FACTOR,
  TRAVEL_RIVER_UPSTREAM_FACTOR,
  TRAVEL_RIVER_MIN_MAGNITUDE,
  TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM,
  TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM,
  TRAVEL_RIVER_GRADIENT_BASELINE_KM,
  TRAVEL_RIVER_GRADIENT_MAX_STEPS,
  TRAVEL_SEASONAL_AMPLITUDE,
  TRAVEL_SLOPE_COST_FACTOR,
  TRAVEL_TRANSFER_DAYS,
  TRAVEL_WATERLOG_THRESHOLD,
  TRAVEL_WIND_GAIN,
  TRAVEL_WIND_REF_MS,
  TRAVEL_FOOT_KM_PER_DAY,
  TRAVEL_CART_KM_PER_DAY,
  TRAVEL_RELIEF_COST_FACTOR,
  TRAVEL_RELIEF_THRESHOLD,
  TRAVEL_HALF,
} from "../constants";
import { dcos } from "../dmath";
import { D8_DX, D8_DY } from "../../ported/worldgen/riverGen.js";
import type { Substrate } from "../substrate";
import { sampleRiverReachGradients } from "../../ported/worldgen/riverDirSample.js";

export const TRAVEL_MODES = [
  "foot",
  "pack",
  "cart",
  "river",
  "coastal",
  "open-sea",
] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];
export type Capability = "packAnimals" | "wheelsDraft" | "boats" | "navigation";

export interface TravelMetric {
  readonly month: number;
  readonly modes: readonly TravelMode[];
  readonly capabilities: readonly Capability[];
}

/**
 * A customized metric: per cell × mode traversal cost in DAYS PER KM (the
 * engine multiplies by the true per-edge length, so east–west edges shrink
 * with cos(latitude) instead of being averaged away), plus the month's wind
 * field (m/s) for the sail modes' alignment response.
 */
export interface CostField {
  readonly modeCostPerKm: Float64Array;
  readonly modeMask: Uint8Array;
  readonly windU: Float64Array;
  readonly windV: Float64Array;
  readonly riverGradient: Float64Array;
  readonly transferDays: number;
  readonly slopeFactor: number;
  readonly riverDownstreamFactor: number;
  readonly riverUpstreamFactor: number;
  readonly riverDownGradientLimit: number;
  readonly riverUpGradientLimit: number;
  readonly windGain: number;
  readonly windRefMs: number;
}

interface LegacyTerrain {
  readonly elev: ArrayLike<number>;
  readonly temp: ArrayLike<number>;
  readonly moist: ArrayLike<number>;
  readonly coast?: ArrayLike<number>;
  readonly relief?: ArrayLike<number>;
  readonly riverMag?: ArrayLike<number>;
}

const modeIndex: Record<TravelMode, number> = {
  foot: 0,
  pack: 1,
  cart: 2,
  river: TRAVEL_MODE_RIVER_INDEX,
  coastal: TRAVEL_MODE_COASTAL_INDEX,
  "open-sea": TRAVEL_MODE_OPEN_SEA_INDEX,
};

function hasCapability(metric: TravelMetric, capability: Capability): boolean {
  return metric.capabilities.includes(capability);
}

function monthAt(month: number): number {
  const normalized = month % MONTHS_PER_YEAR;
  return normalized < 0 ? normalized + MONTHS_PER_YEAR : normalized;
}

function climateIndex(cell: number, month: number): number {
  return cell * MONTHS_PER_YEAR + monthAt(month);
}

/** North–south extent of one cell, km — constant over the grid. */
export function northSouthKm(substrate: Pick<Substrate, "height">): number {
  return EARTH_MERIDIONAL_KM / substrate.height;
}

/** East–west extent of a cell in each row, km — shrinks with cos(latitude). */
export function rowEastWestKm(substrate: Pick<Substrate, "width" | "height">): Float64Array {
  const rows = new Float64Array(substrate.height);
  for (let y = 0; y < substrate.height; y++) {
    const latitude = (EARTH_HALF_DEGREES * TRAVEL_HALF
      - ((y + TRAVEL_HALF) / substrate.height) * EARTH_HALF_DEGREES) * DEG_TO_RAD;
    rows[y] = EARTH_CIRCUMFERENCE_KM / substrate.width * Math.max(0, dcos(latitude));
  }
  return rows;
}

function terrainFactor(substrate: Substrate, cell: number): number {
  const elevation = substrate.elevation[cell];
  const relief = substrate.relief[cell];
  const reliefCost = Math.max(0, relief - TRAVEL_RELIEF_THRESHOLD) * TRAVEL_RELIEF_COST_FACTOR;
  const factor = TRAVEL_BASE_TERRAIN
    + elevation * TRAVEL_ELEVATION_FACTOR
    + reliefCost;
  return Math.max(TRAVEL_LAND_MIN_FACTOR, factor);
}

// Land months slow for real reasons (cold: snow and pass closure; waterlogged
// ground: the mud season). At sea the weather physics are the wind DIRECTION
// effect (per-edge in the engine, from the observed monthly wind) and ICE
// (blocking, below). A previous cold-storm term here only fired below −30°C
// air — dead in practice — and was retired when ice blocking landed.
function seasonalFactor(substrate: Substrate, cell: number, month: number, water: boolean): number {
  const index = climateIndex(cell, month);
  const temperature = substrate.climate.temperature[index];
  if (water) return 1;
  const moisture = substrate.climate.moisture[index];
  const cold = Math.max(0, TRAVEL_COLD_THRESHOLD - temperature) * TRAVEL_COLD_COST_FACTOR;
  const mud = Math.max(0, moisture - TRAVEL_WATERLOG_THRESHOLD) * TRAVEL_MUD_COST_FACTOR;
  return 1 + (cold + mud) * TRAVEL_SEASONAL_AMPLITUDE;
}

/**
 * Sea ice closes water to sail: in any month below seawater's freezing
 * point, and YEAR-ROUND where the annual mean is below it (multi-year
 * pack — the heat budget never clears the ice). The Baltic freezing shut
 * in January while the Northeast Passage never opens both fall out of
 * the same two lines and the climate data.
 */
function seaIceBlocked(substrate: Substrate, cell: number, month: number): boolean {
  if (substrate.climate.temperature[climateIndex(cell, month)] < SEA_FREEZING_TEMPERATURE) {
    return true;
  }
  let annual = 0;
  for (let m = 0; m < MONTHS_PER_YEAR; m++) {
    annual += substrate.climate.temperature[cell * MONTHS_PER_YEAR + m] ?? 0;
  }
  return annual / MONTHS_PER_YEAR < SEA_FREEZING_TEMPERATURE;
}

/**
 * Reach-scale river gradient, m/km per cell: follow the river's own course
 * downstream over the baseline distance and divide total fall by total
 * length. This is both the physically right definition of navigability
 * (a reach, not a cell edge) and the cure for the DEM's ~37 m elevation
 * quantization, which makes single-edge gradients pure noise. Cached per
 * substrate — the geometry is metric-independent.
 */
const reachGradientCache = new WeakMap<Substrate, Float64Array>();

/**
 * Water-surface elevation estimate for a channel cell: the MINIMUM cell
 * elevation over the cell and its next two cells downstream. A meander cell
 * whose average includes the valley wall is one-cell noise — one of the next
 * cells is clean floodplain and reveals the surface — while a real incised
 * gorge (the Livingstone Falls canyon) stays high across many consecutive
 * cells and keeps its full drop. The window length is the raster's noise
 * scale (per-cell wall contamination), not a tuning knob. Water cells clamp
 * at sea level (the receiving SURFACE, never the sea floor).
 */
function surfaceElevation(substrate: Substrate, cell: number): number {
  const { width, height } = substrate;
  const elevationOf = (at: number): number => (substrate.landMask[at]
    ? substrate.elevation[at]
    : Math.max(0, substrate.elevation[at]));
  let minimum = elevationOf(cell);
  let current = cell;
  for (let step = 0; step < 2; step++) {
    if (!substrate.landMask[current]) break;
    const direction = substrate.rivers.direction[current];
    if (direction === undefined || direction > 7) break;
    const y = Math.floor(current / width);
    const ny = y + (D8_DY[direction] ?? 0);
    if (ny < 0 || ny >= height) break;
    current = ny * width + ((((current - y * width) + (D8_DX[direction] ?? 0)) % width + width) % width);
    const value = elevationOf(current);
    if (value < minimum) minimum = value;
  }
  return minimum;
}

export function riverReachGradient(substrate: Substrate): Float64Array {
  const cached = reachGradientCache.get(substrate);
  if (cached) return cached;
  const { width, height, N } = substrate;
  const rows = rowEastWestKm(substrate);
  const nsKm = EARTH_MERIDIONAL_KM / height;
  // Earth presets carry MEASURED channel-floor reach gradients (baked from
  // fine ETOPO samples along the real channels — QUESTIONS.md #22); the
  // walk below is the estimator for cells without data and for procedural
  // worlds, where only the sim's own elevation exists.
  const baked = substrate.preset === "earth" || substrate.preset === "earth_sim"
    ? sampleRiverReachGradients(width, height)
    : null;
  const result = new Float64Array(N);
  for (let cell = 0; cell < N; cell++) {
    if ((substrate.rivers.magnitude[cell] ?? 0) < TRAVEL_RIVER_MIN_MAGNITUDE) continue;
    const measured = baked ? baked[cell] ?? -1 : -1;
    if (measured >= 0) {
      result[cell] = measured;
      continue;
    }
    let current = cell;
    let km = 0;
    for (let step = 0; step < TRAVEL_RIVER_GRADIENT_MAX_STEPS
      && km < TRAVEL_RIVER_GRADIENT_BASELINE_KM; step++) {
      const direction = substrate.rivers.direction[current];
      if (direction === undefined || direction > 7) break;
      const y = Math.floor(current / width);
      const dx = D8_DX[direction] ?? 0;
      const dy = D8_DY[direction] ?? 0;
      const ny = y + dy;
      if (ny < 0 || ny >= height) break;
      const nx = (((current - y * width) + dx) % width + width) % width;
      const next = ny * width + nx;
      const ew = dx !== 0 ? ((rows[y] ?? 0) + (rows[ny] ?? 0)) * TRAVEL_HALF : 0;
      const ns = dy !== 0 ? nsKm : 0;
      km += Math.sqrt(ew * ew + ns * ns);
      current = next;
      if (!substrate.landMask[current]) break;
    }
    if (km > 0) {
      const drop = Math.max(0, (surfaceElevation(substrate, cell) - surfaceElevation(substrate, current)))
        * ELEVATION_METERS_PER_UNIT;
      result[cell] = drop / km;
    }
  }
  reachGradientCache.set(substrate, result);
  return result;
}

function modeIsAvailable(
  substrate: Substrate,
  metric: TravelMetric,
  mode: TravelMode,
  cell: number,
): boolean {
  if (!metric.modes.includes(mode)) return false;
  const land = substrate.landMask[cell] !== 0;
  if (mode === "foot") return land;
  if (mode === "pack") return land && hasCapability(metric, "packAnimals");
  if (mode === "cart") return land && hasCapability(metric, "wheelsDraft");
  if (mode === "river") {
    if (!land || !hasCapability(metric, "boats")) return false;
    if (substrate.rivers.lake[cell] >= 0) return true;
    // Navigable = big enough AND gentle enough at reach scale: rapids are
    // portage country (M1 review, owner play-report — boats were rowing up
    // Himalayan gorges).
    return substrate.rivers.magnitude[cell] >= TRAVEL_RIVER_MIN_MAGNITUDE
      && (riverReachGradient(substrate)[cell] ?? 0) <= TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM;
  }
  if (mode === "coastal") {
    return hasCapability(metric, "boats")
      && ((land && substrate.coast[cell] !== 0)
        || (!land
          && substrate.coastDistanceKm[cell] <= TRAVEL_COASTAL_BAND_KM
          && !seaIceBlocked(substrate, cell, metric.month)));
  }
  // Navigation is a technique, not a vessel: open sea needs the boat too
  // (M1 review: navigation alone was unlocking the ocean).
  return hasCapability(metric, "boats")
    && hasCapability(metric, "navigation")
    && (!land || substrate.coastDistanceKm[cell] <= TRAVEL_COASTAL_BAND_KM)
    && (land || !seaIceBlocked(substrate, cell, metric.month));
}

function modeDaysPerKm(
  substrate: Substrate,
  metric: TravelMetric,
  mode: TravelMode,
  cell: number,
): number {
  const land = substrate.landMask[cell] !== 0;
  if (mode === "foot" || mode === "pack" || mode === "cart") {
    const speed = mode === "foot"
      ? TRAVEL_FOOT_KM_PER_DAY
      : mode === "pack" ? TRAVEL_PACK_KM_PER_DAY : TRAVEL_CART_KM_PER_DAY;
    return 1 / speed
      * terrainFactor(substrate, cell)
      * seasonalFactor(substrate, cell, metric.month, false)
      * TRAVEL_INFRASTRUCTURE_FACTOR;
  }
  if (mode === "river") {
    // Navigability is binary at M1 (mode availability gates on magnitude);
    // direction asymmetry lives in the engine's river factor. A
    // per-magnitude speed boost had no grounding and broke the emergent
    // 1:5:28 freight ratio (M1 review).
    return 1 / TRAVEL_RIVER_KM_PER_DAY
      * seasonalFactor(substrate, cell, metric.month, false);
  }
  if (mode === "coastal") {
    return 1 / TRAVEL_COASTAL_KM_PER_DAY
      * seasonalFactor(substrate, cell, metric.month, !land);
  }
  return 1 / TRAVEL_OPEN_SEA_KM_PER_DAY
    * seasonalFactor(substrate, cell, metric.month, true);
}

/** The v1-compatible terrain seed used by buildTerritory's crossing overlay. */
export function baseEdgeCost(world: LegacyTerrain, from: number, to: number): number {
  if (world.elev[to] <= 0) return Number.POSITIVE_INFINITY;
  const elevation = world.elev[to];
  const slope = Math.abs(elevation - world.elev[from]);
  const temperature = world.temp[to];
  const moisture = world.moist[to];
  let cost = TRAVEL_BASE_TERRAIN
    + elevation * TRAVEL_ELEVATION_FACTOR
    + slope * TRAVEL_SLOPE_COST_FACTOR
    + (world.relief?.[to] ?? 0) * TRAVEL_RELIEF_COST_FACTOR;
  cost += Math.max(0, TRAVEL_COLD_THRESHOLD - temperature) * TRAVEL_COLD_COST_FACTOR;
  cost += Math.max(0, TRAVEL_MOISTURE_FLOOR - moisture) * TRAVEL_MUD_COST_FACTOR;
  // v1 semantics: the shore is a cheap corridor MULTIPLICATIVELY — a coastal
  // mountain is still a mountain (M1 review: a min() clamp here made every
  // coast cost ≤0.8 regardless of terrain).
  if (world.coast?.[to]) cost *= TRAVEL_COASTAL_MIN_FACTOR;
  return cost;
}

export function buildCostField(substrate: Substrate, metric: TravelMetric): CostField {
  const cells = substrate.N;
  const modeCostPerKm = new Float64Array(cells * TRAVEL_MODES.length);
  modeCostPerKm.fill(Number.POSITIVE_INFINITY);
  const modeMask = new Uint8Array(cells);
  const windU = new Float64Array(cells);
  const windV = new Float64Array(cells);
  const month = monthAt(metric.month);
  for (let cell = 0; cell < cells; cell++) {
    const windIndex = cell * MONTHS_PER_YEAR + month;
    windU[cell] = substrate.wind.u[windIndex] ?? 0;
    windV[cell] = substrate.wind.v[windIndex] ?? 0;
    let mask = 0;
    for (const mode of TRAVEL_MODES) {
      if (!modeIsAvailable(substrate, metric, mode, cell)) continue;
      const index = modeIndex[mode];
      modeCostPerKm[cell * TRAVEL_MODES.length + index] = modeDaysPerKm(substrate, metric, mode, cell);
      mask |= 1 << index;
    }
    modeMask[cell] = mask;
  }
  return {
    modeCostPerKm,
    modeMask,
    windU,
    windV,
    riverGradient: riverReachGradient(substrate),
    transferDays: TRAVEL_TRANSFER_DAYS,
    slopeFactor: TRAVEL_SLOPE_COST_FACTOR,
    riverDownstreamFactor: TRAVEL_RIVER_DOWNSTREAM_FACTOR,
    riverUpstreamFactor: TRAVEL_RIVER_UPSTREAM_FACTOR,
    // Reach-scale bars, m/km, matching the riverGradient array's units.
    riverDownGradientLimit: TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM,
    riverUpGradientLimit: TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM,
    windGain: TRAVEL_WIND_GAIN,
    windRefMs: TRAVEL_WIND_REF_MS,
  };
}

/**
 * Freight cost in relative per-ton units for a haul of `days` by `mode`:
 * time × the mode's cost-per-ton-day, where cost-per-ton-day = nominal speed
 * × the Duncan-Jones per-ton-km ratio — so on reference terrain the 1:5:28
 * ratio emerges per km, and terrain/season modulate it.
 */
export function freightCost(mode: TravelMode, days: number): number {
  if (mode === "open-sea" || mode === "coastal") {
    return days * TRAVEL_OPEN_SEA_KM_PER_DAY * TRAVEL_COST_FREIGHT_SEA;
  }
  if (mode === "river") {
    return days * TRAVEL_RIVER_KM_PER_DAY * TRAVEL_COST_FREIGHT_RIVER;
  }
  return days * TRAVEL_CART_KM_PER_DAY * TRAVEL_COST_FREIGHT_LAND;
}
