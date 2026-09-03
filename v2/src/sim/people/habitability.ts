import {
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_DEGREES,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  PEOPLE_DISEASE_MOISTURE_FLOOR,
  PEOPLE_DISEASE_MOISTURE_RANGE,
  PEOPLE_DISEASE_RATE,
  PEOPLE_DISEASE_WARMTH_FLOOR,
  PEOPLE_DISEASE_WARMTH_RANGE,
  PEOPLE_SHORE_STRIP_KM,
  PEOPLE_FORAGER_AQUATIC_CAPACITY_PER_KM2,
  PEOPLE_FORAGER_CAPACITY_PER_KM2,
  PEOPLE_FORAGER_FERTILITY_BASE,
  PEOPLE_FORAGER_FERTILITY_GAIN,
  PEOPLE_FLOODPLAIN_ACCESS_WEIGHT,
  PEOPLE_LAKE_ACCESS_WEIGHT,
  PEOPLE_RIVER_ACCESS_DIVISOR,
  PEOPLE_RIVER_ACCESS_WEIGHT,
  PEOPLE_RELIEF_PENALTY,
  MONTHS_PER_YEAR,
  MATH_NEGATIVE_ONE,
  TRAVEL_HALF,
} from "../constants";
import { dcos } from "../dmath";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function cellAreasKm2(width: number, height: number): Float64Array {
  const areas = new Float64Array(width * height);
  const northSouth = EARTH_MERIDIONAL_KM / height;
  for (let y = 0; y < height; y++) {
    // 90 - 180*f (latitude spans 180 degrees): the original full-circle span
    // gave the whole southern hemisphere ZERO cell area — south-of-equator
    // people weighed nothing in the person-unit census and ledger.
    const latitude = (EARTH_HALF_DEGREES * TRAVEL_HALF
      - ((y + TRAVEL_HALF) / height) * EARTH_HALF_DEGREES) * DEG_TO_RAD;
    const eastWest = EARTH_CIRCUMFERENCE_KM / width * Math.max(0, dcos(latitude));
    const area = northSouth * eastWest;
    for (let x = 0; x < width; x++) areas[y * width + x] = area;
  }
  return areas;
}

/** Static tropical disease pressure, derived only from annual climate state. */
export function diseaseBurden(world: PeopleWorld, cell: number): number {
  const temperature = world._annualTemperature[cell] ?? 0;
  const moisture = world._annualMoisture[cell] ?? 0;
  const warmth = clamp01(
    (temperature - PEOPLE_DISEASE_WARMTH_FLOOR) / PEOPLE_DISEASE_WARMTH_RANGE,
  );
  const damp = clamp01(
    (moisture - PEOPLE_DISEASE_MOISTURE_FLOOR) / PEOPLE_DISEASE_MOISTURE_RANGE,
  );
  return warmth * damp;
}

export function reliefMultiplier(world: PeopleWorld, cell: number): number {
  return 1 / (1 + PEOPLE_RELIEF_PENALTY * (world.substrate.relief[cell] ?? 0));
}

/**
 * Water access is an area-weighted land property. In particular, floodplain is
 * already a fraction of the cell, so it is never widened into a full-cell
 * river bonus.
 */
export function waterAccess(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const flood = substrate.floodplain[cell] ?? 0;
  const river = Math.min(
    1,
    (substrate.rivers.magnitude[cell] ?? 0) / PEOPLE_RIVER_ACCESS_DIVISOR,
  );
  const lake = (substrate.rivers.lake[cell] ?? MATH_NEGATIVE_ONE) >= 0 ? 1 : 0;
  const rainfall = world._annualMoisture[cell] ?? 0;
  return clamp01(
    rainfall
    + flood * PEOPLE_FLOODPLAIN_ACCESS_WEIGHT
    + river * PEOPLE_RIVER_ACCESS_WEIGHT
    + lake * PEOPLE_LAKE_ACCESS_WEIGHT,
  );
}

/**
 * Forager capacity by habitat (W8): the terrestrial density (M2's law) plus
 * the aquatic density at the cell's water access — shores, rivers and lakes
 * held foragers at ten to a hundred times the density of the interior
 * (Binford 2001; Kelly 2013). The wild-stand term is added once the crop
 * fields exist (`applyWildStands`).
 */
/**
 * Aquatic access for foragers (W8): the shore, rivers, lakes and the
 * floodplain — the waters a forager fishes — and not rainfall, which is
 * farming's water. The shore counts as the strip a coastal forager works,
 * as a share of the cell: a 22 km cell on the coast is nearly all shore, a
 * 167 km cell is a tenth shore (third cardinal rule — at the reference grid
 * a third of the peopled cells touch the sea).
 */
export function aquaticAccess(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const flood = substrate.floodplain[cell] ?? 0;
  const river = Math.min(
    1,
    (substrate.rivers.magnitude[cell] ?? 0) / PEOPLE_RIVER_ACCESS_DIVISOR,
  );
  const lake = (substrate.rivers.lake[cell] ?? MATH_NEGATIVE_ONE) >= 0 ? 1 : 0;
  const area = world.cellAreaKm2[cell] ?? 0;
  const shore = (substrate.coast[cell] ?? 0) !== 0 && area > 0
    ? Math.min(1, PEOPLE_SHORE_STRIP_KM / Math.sqrt(area))
    : 0;
  return clamp01(
    flood * PEOPLE_FLOODPLAIN_ACCESS_WEIGHT
    + river * PEOPLE_RIVER_ACCESS_WEIGHT
    + lake * PEOPLE_LAKE_ACCESS_WEIGHT
    + shore,
  );
}

/** The terrestrial forager density: M2's law, the living of the interior. */
export function foragerTerrestrialCapacity(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const fertility = Math.max(0, Math.min(1, substrate.fertility[cell] ?? 0));
  const climate = 1 - PEOPLE_DISEASE_RATE * diseaseBurden(world, cell);
  return PEOPLE_FORAGER_CAPACITY_PER_KM2
    * (PEOPLE_FORAGER_FERTILITY_BASE + PEOPLE_FORAGER_FERTILITY_GAIN * fertility)
    * climate
    * reliefMultiplier(world, cell);
}

export function foragerCapacity(world: PeopleWorld, cell: number): number {
  const climate = 1 - PEOPLE_DISEASE_RATE * diseaseBurden(world, cell);
  return foragerTerrestrialCapacity(world, cell)
    + PEOPLE_FORAGER_AQUATIC_CAPACITY_PER_KM2 * aquaticAccess(world, cell) * climate;
}

/** Add each cell's richest wild stand to its forager capacity (W8): dense, sedentary foragers on the stands before any farming. */
export function applyWildStands(world: PeopleWorld): void {
  for (const cell of world._landCells) {
    world._foragerCapacity[cell] = (world._foragerCapacity[cell] ?? 0) + (world._standCapacityBest[cell] ?? 0);
  }
}

/** Precompute the static per-cell habitability quantities (annual-climate properties). */
export function fillStaticHabitability(world: PeopleWorld): void {
  for (let cell = 0; cell < world.N; cell++) {
    world._diseaseBurden[cell] = diseaseBurden(world, cell);
    world._waterAccess[cell] = waterAccess(world, cell);
    world._reliefMult[cell] = reliefMultiplier(world, cell);
    world._foragerCapacity[cell] = world.substrate.landMask[cell]
      ? foragerCapacity(world, cell)
      : 0;
    world._foragerTerrestrial[cell] = world.substrate.landMask[cell]
      ? foragerTerrestrialCapacity(world, cell)
      : 0;
  }
}

export function annualClimateFromSubstrate(world: PeopleWorld): void {
  const { substrate, _annualTemperature: temperature, _annualMoisture: moisture } = world;
  const months = MONTHS_PER_YEAR;
  for (let cell = 0; cell < world.N; cell++) {
    let temperatureSum = 0;
    let moistureSum = 0;
    for (let month = 0; month < months; month++) {
      const index = cell * months + month;
      temperatureSum += substrate.climate.temperature[index] ?? 0;
      moistureSum += substrate.climate.moisture[index] ?? 0;
    }
    temperature[cell] = temperatureSum / months;
    moisture[cell] = moistureSum / months;
  }
}
