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
  TRAVEL_ELEVATION_FACTOR,
  TRAVEL_INFRASTRUCTURE_FACTOR,
  TRAVEL_LAND_MIN_FACTOR,
  TRAVEL_MOISTURE_FLOOR,
  TRAVEL_MONSOON_STORM_FACTOR,
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
  TRAVEL_RIVER_MIN_FACTOR,
  TRAVEL_RIVER_MIN_MAGNITUDE,
  TRAVEL_SEASONAL_AMPLITUDE,
  TRAVEL_SLOPE_COST_FACTOR,
  TRAVEL_TRANSFER_DAYS,
  TRAVEL_WATERLOG_THRESHOLD,
  TRAVEL_WET_COST_FACTOR,
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

export interface CostField {
  readonly modeCosts: Float64Array;
  readonly modeMask: Uint8Array;
  readonly transferDays: number;
  readonly slopeFactor: number;
  readonly riverDownstreamFactor: number;
  readonly riverUpstreamFactor: number;
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

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cellDistanceKm(substrate: Substrate, cell: number): number {
  const y = Math.floor(cell / substrate.width);
  const latitude = (EARTH_HALF_DEGREES * TRAVEL_HALF - ((y + TRAVEL_HALF) / substrate.height) * EARTH_HALF_DEGREES) * DEG_TO_RAD;
  const northSouth = EARTH_MERIDIONAL_KM / substrate.height;
  const eastWest = EARTH_CIRCUMFERENCE_KM / substrate.width * dcos(latitude);
  return (northSouth + eastWest) * TRAVEL_HALF;
}

function terrainFactor(substrate: Substrate, from: number, to: number): number {
  const elevation = substrate.elevation[to];
  const relief = substrate.relief[to];
  const slope = Math.abs(elevation - substrate.elevation[from]);
  const reliefCost = Math.max(0, relief - TRAVEL_RELIEF_THRESHOLD) * TRAVEL_RELIEF_COST_FACTOR;
  const factor = TRAVEL_BASE_TERRAIN
    + elevation * TRAVEL_ELEVATION_FACTOR
    + slope * TRAVEL_SLOPE_COST_FACTOR
    + reliefCost;
  return Math.max(TRAVEL_LAND_MIN_FACTOR, factor);
}

function seasonalFactor(substrate: Substrate, cell: number, month: number, water: boolean): number {
  const index = climateIndex(cell, month);
  const temperature = substrate.climate.temperature[index];
  const moisture = substrate.climate.moisture[index];
  const cold = Math.max(0, TRAVEL_COLD_THRESHOLD - temperature) * TRAVEL_COLD_COST_FACTOR;
  const mud = Math.max(0, moisture - TRAVEL_WATERLOG_THRESHOLD) * TRAVEL_MUD_COST_FACTOR;
  const seaStorm = water
    ? Math.max(0, TRAVEL_COLD_SEA_THRESHOLD - temperature) * TRAVEL_OPEN_SEA_STORM_FACTOR
      + Math.abs(moisture - TRAVEL_MOISTURE_FLOOR) * TRAVEL_MONSOON_STORM_FACTOR
    : 0;
  return 1 + (cold + mud + seaStorm) * TRAVEL_SEASONAL_AMPLITUDE;
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

function modeCost(
  substrate: Substrate,
  metric: TravelMetric,
  mode: TravelMode,
  cell: number,
): number {
  const land = substrate.landMask[cell] !== 0;
  const distance = cellDistanceKm(substrate, cell);
  if (mode === "foot") {
    return distance / TRAVEL_FOOT_KM_PER_DAY
      * terrainFactor(substrate, cell, cell)
      * seasonalFactor(substrate, cell, metric.month, false)
      * TRAVEL_INFRASTRUCTURE_FACTOR;
  }
  if (mode === "pack") {
    return distance / TRAVEL_PACK_KM_PER_DAY
      * terrainFactor(substrate, cell, cell)
      * seasonalFactor(substrate, cell, metric.month, false)
      * TRAVEL_INFRASTRUCTURE_FACTOR;
  }
  if (mode === "cart") {
    return distance / TRAVEL_CART_KM_PER_DAY
      * terrainFactor(substrate, cell, cell)
      * seasonalFactor(substrate, cell, metric.month, false)
      * TRAVEL_INFRASTRUCTURE_FACTOR;
  }
  if (mode === "river") {
    const magnitude = substrate.rivers.magnitude[cell];
    const channelFactor = Math.max(
      TRAVEL_RIVER_MIN_FACTOR,
      1 / Math.max(1, magnitude),
    );
    return distance / TRAVEL_RIVER_KM_PER_DAY
      * channelFactor
      * seasonalFactor(substrate, cell, metric.month, false);
  }
  if (mode === "coastal") {
    const coastalDistance = clampUnit(substrate.coastDistanceKm[cell] / TRAVEL_COASTAL_BAND_KM);
    return distance / TRAVEL_COASTAL_KM_PER_DAY
      * Math.max(TRAVEL_COASTAL_MIN_FACTOR, 1 - coastalDistance * TRAVEL_HALF)
      * seasonalFactor(substrate, cell, metric.month, !land);
  }
  return distance / TRAVEL_OPEN_SEA_KM_PER_DAY
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
  if (world.coast?.[to]) cost = Math.min(cost, TRAVEL_COASTAL_MIN_FACTOR);
  return cost;
}

export function buildCostField(substrate: Substrate, metric: TravelMetric): CostField {
  const cells = substrate.N;
  const modeCosts = new Float64Array(cells * TRAVEL_MODES.length);
  modeCosts.fill(Number.POSITIVE_INFINITY);
  const modeMask = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    let mask = 0;
    for (const mode of TRAVEL_MODES) {
      if (!modeIsAvailable(substrate, metric, mode, cell)) continue;
      const index = modeIndex[mode];
      modeCosts[cell * TRAVEL_MODES.length + index] = modeCost(substrate, metric, mode, cell);
      mask |= 1 << index;
    }
    modeMask[cell] = mask;
  }
  return {
    modeCosts,
    modeMask,
    transferDays: TRAVEL_TRANSFER_DAYS,
    slopeFactor: TRAVEL_SLOPE_COST_FACTOR,
    riverDownstreamFactor: TRAVEL_RIVER_DOWNSTREAM_FACTOR,
    riverUpstreamFactor: TRAVEL_RIVER_UPSTREAM_FACTOR,
  };
}

export function freightCost(mode: TravelMode, days: number): number {
  if (mode === "open-sea" || mode === "coastal") return days;
  if (mode === "river") return days * TRAVEL_COST_FREIGHT_RIVER;
  return days * TRAVEL_COST_FREIGHT_LAND;
}
