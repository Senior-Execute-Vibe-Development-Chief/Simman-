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

export function foragerCapacity(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const fertility = Math.max(0, Math.min(1, substrate.fertility[cell] ?? 0));
  const climate = 1 - PEOPLE_DISEASE_RATE * diseaseBurden(world, cell);
  return PEOPLE_FORAGER_CAPACITY_PER_KM2
    * (PEOPLE_FORAGER_FERTILITY_BASE + PEOPLE_FORAGER_FERTILITY_GAIN * fertility)
    * climate
    * reliefMultiplier(world, cell);
}

/** Precompute the static per-cell habitability quantities (annual-climate properties). */
export function fillStaticHabitability(world: PeopleWorld): void {
  for (let cell = 0; cell < world.N; cell++) {
    world._diseaseBurden[cell] = diseaseBurden(world, cell);
    world._foragerCapacity[cell] = world.substrate.landMask[cell]
      ? foragerCapacity(world, cell)
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
