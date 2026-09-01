import {
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  MONTHS_PER_YEAR,
  TRAVEL_BASE_TERRAIN,
  TRAVEL_COLD_COST_FACTOR,
  TRAVEL_COLD_THRESHOLD,
  TRAVEL_COASTAL_BAND_KM,
  TRAVEL_COASTAL_KM_PER_DAY,
  TRAVEL_COASTAL_MIN_FACTOR,
  TRAVEL_COLD_SEA_THRESHOLD,
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
  TRAVEL_OPEN_SEA_STORM_FACTOR,
  TRAVEL_PACK_KM_PER_DAY,
  TRAVEL_RIVER_KM_PER_DAY,
  TRAVEL_RIVER_DOWNSTREAM_FACTOR,
  TRAVEL_RIVER_UPSTREAM_FACTOR,
  TRAVEL_RIVER_MIN_MAGNITUDE,
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
import type { Substrate } from "../substrate";

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
  readonly transferDays: number;
  readonly slopeFactor: number;
  readonly riverDownstreamFactor: number;
  readonly riverUpstreamFactor: number;
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
// ground: the mud season). At sea only COLD storms and ice slow everyone
// alike — the monsoon is not a symmetric weather tax but a wind DIRECTION
// effect, applied per-edge in the engine from the observed monthly wind
// (M1 review: a |moisture−floor| term here taxed all tropical sea travel
// identically both ways, which is not a monsoon).
function seasonalFactor(substrate: Substrate, cell: number, month: number, water: boolean): number {
  const index = climateIndex(cell, month);
  const temperature = substrate.climate.temperature[index];
  if (water) {
    const storm = Math.max(0, TRAVEL_COLD_SEA_THRESHOLD - temperature) * TRAVEL_OPEN_SEA_STORM_FACTOR;
    return 1 + storm * TRAVEL_SEASONAL_AMPLITUDE;
  }
  const moisture = substrate.climate.moisture[index];
  const cold = Math.max(0, TRAVEL_COLD_THRESHOLD - temperature) * TRAVEL_COLD_COST_FACTOR;
  const mud = Math.max(0, moisture - TRAVEL_WATERLOG_THRESHOLD) * TRAVEL_MUD_COST_FACTOR;
  return 1 + (cold + mud) * TRAVEL_SEASONAL_AMPLITUDE;
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
    return land
      && hasCapability(metric, "boats")
      && (substrate.rivers.magnitude[cell] >= TRAVEL_RIVER_MIN_MAGNITUDE
        || substrate.rivers.lake[cell] >= 0);
  }
  if (mode === "coastal") {
    return hasCapability(metric, "boats")
      && ((land && substrate.coast[cell] !== 0)
        || (!land && substrate.coastDistanceKm[cell] <= TRAVEL_COASTAL_BAND_KM));
  }
  return hasCapability(metric, "navigation")
    && (!land || substrate.coastDistanceKm[cell] <= TRAVEL_COASTAL_BAND_KM);
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
    transferDays: TRAVEL_TRANSFER_DAYS,
    slopeFactor: TRAVEL_SLOPE_COST_FACTOR,
    riverDownstreamFactor: TRAVEL_RIVER_DOWNSTREAM_FACTOR,
    riverUpstreamFactor: TRAVEL_RIVER_UPSTREAM_FACTOR,
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
