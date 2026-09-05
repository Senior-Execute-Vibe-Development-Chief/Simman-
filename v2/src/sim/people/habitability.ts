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
  PEOPLE_CHANNEL_STRIP_KM,
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
import { D8_DX, D8_DY } from "../../ported/worldgen/riverGen.js";
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
 * The cell a cell's flow direction drains into, or none: a terminal
 * direction (an endorheic sink), an unset one, or the map's top or bottom
 * edge. Columns wrap as the worldgen's do.
 */
function downstreamCell(world: PeopleWorld, cell: number): number {
  const direction = world.substrate.rivers.direction[cell] ?? D8_DX.length;
  if (direction >= D8_DX.length) return MATH_NEGATIVE_ONE;
  const { width, height } = world;
  const y = Math.floor(cell / width);
  const ny = y + (D8_DY[direction] ?? 0);
  if (ny < 0 || ny >= height) return MATH_NEGATIVE_ONE;
  const x = cell - y * width;
  return ny * width + (((x + (D8_DX[direction] ?? 0)) % width + width) % width);
}

/**
 * The irrigable share of a cell (W13): the channel strip's share of it,
 * `PEOPLE_CHANNEL_STRIP_KM / √area` — the shore strip's law, the same
 * ground in real km at every grid (0.06 of a 167 km reference cell, ~0.5 of
 * a 20 km shipped one). Read by the routing (what a cell can take) and by
 * the crop fit (what a stream can keep under water, W14).
 */
export function channelStripShare(world: PeopleWorld, cell: number): number {
  const area = world.cellAreaKm2[cell] ?? 0;
  return area > 0 ? Math.min(1, PEOPLE_CHANNEL_STRIP_KM / Math.sqrt(area)) : 0;
}

/**
 * The routed water (W13, P17). The worldgen's per-tile runoff — rain less
 * evaporation, plus mountain melt — is carried down its own flow directions
 * in drainage order, and each cell takes from what arrives the water its
 * channel strip lacks in rain: the strip is the irrigable share of the cell
 * (`PEOPLE_CHANNEL_STRIP_KM / √area`, the shore strip's law) and what it
 * lacks is `1 − annual moisture`, so a wet cell takes little and a desert
 * cell under a mountain stream takes up to its strip. What a cell takes is
 * the term it adds to its water access, in the units rainfall enters at: a
 * cell-average depth, so a strip watered in full on a dry cell reads as the
 * strip's share of the cell. A cell's own runoff is passed on, never taken —
 * it is its rain, already counted. Upstream takes first, so a stream is used
 * up along its course and the floor the worldgen gives every desert tile
 * never sums into a river of its own (which is why the thresholded
 * magnitude, which it does sum into, is not the quantity read here). Kahn's
 * order over the flow graph; a cell on a cycle (none in a proper flow field)
 * is left at zero. What arrives at each cell is kept (`_runoffInflow`, W14):
 * the stream a wetland crop can draw on, in the runoff's own units.
 */
export function routeRunoff(world: PeopleWorld): void {
  const { substrate, _runoffAccess: access, _runoffInflow: inflow } = world;
  const runoff = substrate.rivers.runoff;
  const pending = new Int32Array(world.N);
  const order = new Int32Array(world._landCells.length);
  access.fill(0);
  inflow.fill(0);
  for (const cell of world._landCells) {
    const next = downstreamCell(world, cell);
    if (next >= 0 && substrate.landMask[next]) pending[next] = (pending[next] ?? 0) + 1;
  }
  let head = 0;
  let tail = 0;
  for (const cell of world._landCells) {
    if ((pending[cell] ?? 0) === 0) order[tail++] = cell;
  }
  while (head < tail) {
    const cell = order[head++] ?? 0;
    const demand = channelStripShare(world, cell) * Math.max(0, 1 - (world._annualMoisture[cell] ?? 0));
    const arriving = inflow[cell] ?? 0;
    const taken = Math.min(arriving, demand);
    access[cell] = taken;
    const next = downstreamCell(world, cell);
    if (next < 0 || !substrate.landMask[next]) continue;
    inflow[next] = (inflow[next] ?? 0) + (arriving - taken) + (runoff[cell] ?? 0);
    pending[next] = (pending[next] ?? 0) - 1;
    if (pending[next] === 0) order[tail++] = next;
  }
}

/**
 * The water the land itself gives a cell, rain aside (W13): the routed
 * stream, the floodplain, the river and the lake — the water that is there
 * in a month it does not rain. An area-weighted land property: floodplain is
 * already a fraction of the cell, so it is never widened into a full-cell
 * river bonus, and the routed term is a cell-average depth by construction.
 */
export function surfaceWaterAccess(world: PeopleWorld, cell: number): number {
  const substrate = world.substrate;
  const flood = substrate.floodplain[cell] ?? 0;
  const river = Math.min(
    1,
    (substrate.rivers.magnitude[cell] ?? 0) / PEOPLE_RIVER_ACCESS_DIVISOR,
  );
  const lake = (substrate.rivers.lake[cell] ?? MATH_NEGATIVE_ONE) >= 0 ? 1 : 0;
  return clamp01(
    (world._runoffAccess[cell] ?? 0)
    + flood * PEOPLE_FLOODPLAIN_ACCESS_WEIGHT
    + river * PEOPLE_RIVER_ACCESS_WEIGHT
    + lake * PEOPLE_LAKE_ACCESS_WEIGHT,
  );
}

/** Water access: the year's rain and the land's own water together. */
export function waterAccess(world: PeopleWorld, cell: number): number {
  return clamp01((world._annualMoisture[cell] ?? 0) + surfaceWaterAccess(world, cell));
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
  routeRunoff(world);
  for (let cell = 0; cell < world.N; cell++) {
    world._diseaseBurden[cell] = diseaseBurden(world, cell);
    world._surfaceAccess[cell] = surfaceWaterAccess(world, cell);
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
