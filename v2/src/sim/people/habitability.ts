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
  PEOPLE_WORKS_RAIN_FLOOR,
  PEOPLE_WORKS_RAIN_SHARE,
  PEOPLE_RELIEF_PENALTY,
  HARVEST_COOL_ONSET_C,
  HARVEST_COOL_RAMP_C,
  HARVEST_CV_BASE,
  HARVEST_CV_FLOOD,
  HARVEST_CV_MARGIN,
  HARVEST_CV_SEASON,
  HARVEST_CV_WINTER,
  HARVEST_GAUSSEN_SHAPE,
  HARVEST_MOISTURE_ONSET,
  HARVEST_MOISTURE_RAMP,
  HARVEST_MONSOON_ONSET,
  HARVEST_SEASON_AMPLITUDE_MIN_C,
  DEGC_PER_TEMPERATURE_UNIT,
  MONTHS_PER_YEAR,
  MATH_HALF,
  MATH_NEGATIVE_ONE,
  TRAVEL_HALF,
} from "../constants";
import { dcos } from "../dmath";
import { D8_DX, D8_DY } from "../../ported/worldgen/riverGen.js";
import { demand } from "../../ported/worldgen/biomeClass.js";
import { temperatureC } from "../snow";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * The share of a cell that is ground (W19). Every capacity law here is a
 * density per km² of LAND, and the area it is multiplied by to reach a
 * headcount is the whole cell — so a cell the coastline runs through has to
 * charge its living to the ground it actually has, not to the sea beside it.
 * The land/sea bit says WHETHER there is ground here; this says HOW MUCH.
 * One wherever the world carries no cover plane, which is what every law
 * did before the plane existed.
 */
export function landShare(world: PeopleWorld, cell: number): number {
  return clamp01(world.substrate.landFraction[cell] ?? 1);
}

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
 * W13's drainage order as a packed permutation (W30): Kahn's order over the
 * flow graph — the same walk `routeRunoff` makes, cell for cell — and each
 * land cell's downstream land cell as a packed index (−1 at a sink or the
 * sea). The harvest rows route the weather down it in the composition of
 * the flow. A cell on a cycle (none in a proper flow field) never enters
 * the order; `order` is exactly the cells the walk reached.
 */
export function drainageOrder(world: PeopleWorld): { readonly order: Int32Array; readonly next: Int32Array } {
  const { substrate } = world;
  const count = world._landCells.length;
  const pending = new Int32Array(world.N);
  const order = new Int32Array(count);
  const next = new Int32Array(count).fill(MATH_NEGATIVE_ONE);
  for (let packed = 0; packed < count; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const downstream = downstreamCell(world, cell);
    if (downstream >= 0 && substrate.landMask[downstream]) {
      next[packed] = world._packedOf[downstream] ?? MATH_NEGATIVE_ONE;
      pending[downstream] = (pending[downstream] ?? 0) + 1;
    }
  }
  let head = 0;
  let tail = 0;
  for (let packed = 0; packed < count; packed++) {
    if ((pending[world._landCells[packed] ?? 0] ?? 0) === 0) order[tail++] = packed;
  }
  while (head < tail) {
    const packed = order[head++] ?? 0;
    const downstream = next[packed] ?? MATH_NEGATIVE_ONE;
    if (downstream < 0) continue;
    const cell = world._landCells[downstream] ?? 0;
    pending[cell] = (pending[cell] ?? 0) - 1;
    if (pending[cell] === 0) order[tail++] = downstream;
  }
  return { order: order.subarray(0, tail), next };
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

/**
 * The improvable share of a cell (W28, static): the ground works can be
 * built on. Two sources, as v1's `_ensureIrr` had them. Water that can be
 * LED onto fields — the routed stream, the floodplain, the river and the
 * lake, which is the surface access W13 already states — and a climate wet
 * enough that its works are drainage, terracing and levelling, needing no
 * water brought: the share rises from nothing at the woodland moisture band
 * to `PEOPLE_WORKS_RAIN_SHARE` of the cell at the wettest climate. Rain-fed
 * dry farming on a plain improves nothing, which is what keeps the steppe
 * at its rain-fed ceiling while the valley beside it densifies.
 */
export function irrigableShare(world: PeopleWorld, cell: number): number {
  if (!world.substrate.landMask[cell]) return 0;
  const moisture = world._annualMoisture[cell] ?? 0;
  const wet = Math.max(0, (moisture - PEOPLE_WORKS_RAIN_FLOOR) / (1 - PEOPLE_WORKS_RAIN_FLOOR))
    * PEOPLE_WORKS_RAIN_SHARE;
  return clamp01((world._surfaceAccess[cell] ?? 0) + wet);
}

export interface YieldVarianceParts {
  /** How close the rain-fed harvest sits to the crop's water minimum, 0..1: nothing where the effective moisture clears the semi-arid onset, one at the desert margin. */
  readonly rainMargin: number;
  /** How far one season carries the year, 0..1: the Gaussen dry-season shape or the warm half's rain concentration, whichever is larger. */
  readonly seasonal: number;
  /** The continental cold margin, 0..1, from the cool half's mean temperature. */
  readonly winterRisk: number;
  /** The surface-watered share of the cell's farmland, 0..1: the ground a river, a floodplain, a lake or the routed stream water against the ground the rain can farm. */
  readonly water: number;
  /** The rain-fed CV before the water blend. */
  readonly cvRain: number;
  /** The harvest's exposure to the cell's own sky (W30): the rain-fed CV over the rain-fed share plus the winter term — the part of the CV a local anomaly moves. */
  readonly rainExposure: number;
  /** The harvest's exposure to the river's sky (W30): the flood regime's CV over the surface-watered share — the part of the CV the catchment's anomaly moves. */
  readonly floodExposure: number;
  /** The coefficient of variation of the annual harvest: the two exposures together. */
  readonly cv: number;
}

/**
 * The yield-variance map (W29): the coefficient of variation of a cell's
 * ANNUAL harvest — how hard the year-to-year swing hits this ground. v1's
 * validated formula (harvest.js, 11 of 12 literature regions in band, the
 * 2026-08-25 lap), on v2's own inputs. Four real factors, each named:
 *
 * - RAIN MARGIN: rain-fed variance rises as the effective moisture — the
 *   annual index over the evaporative DEMAND, biomeClass's Holdridge layer,
 *   so cool-wet England and hot-dry Mesopotamia are not confused at the
 *   same index — nears the crop minimum.
 * - SEASONALITY: a one-rainy-season regime bets the year on one season.
 *   Two signals, the larger taken: the Gaussen dry-season shape, peaking at
 *   the half-dry year (mediterranean, Sahel, monsoon with arid months; a
 *   desert's twelve dry months are the margin's business); and the warm
 *   half's rain concentration, which sees the East Asian monsoon that
 *   stacks the rain in the warm half yet shows few Gaussen-arid months —
 *   read only where the year has seasons (the amplitude gate: in the
 *   low-amplitude tropics the "warmest six months" are the pre-rain heat).
 * - WINTER RISK: the continental margin — winterkill, spring frost, the
 *   short season between frost and drought — on the COOL half's mean, not
 *   the amplitude: scorching summers over a mild winter carry no risk. The
 *   axis that separates maritime England from the Pontic steppe at the
 *   same annual water. It stays outside the water blend: a frozen valley
 *   is frozen however well it floods.
 * - THE WATER SHARE: a river-fed field decouples from the local rain and
 *   carries the flood regime's own variance instead. The share is of the
 *   cell's FARMLAND, not of its water: the surface-watered ground (W13's
 *   surface access — routed stream, floodplain, river, lake — an area-
 *   weighted term by construction) against the rain-fed ground, which is
 *   the rest of the cell in proportion to the rain's viability, one minus
 *   the margin. So a cell watered by its river reads as the river's, a
 *   rain-fed plain beside it as the rain's, and on a desert bank where
 *   rain farming is impossible whatever is farmed is water-fed — v1's
 *   construction credit, stated as the ground it is: charging such a cell
 *   the desert's rain-fed variance describes farms that cannot be there.
 *
 *   cvRain = BASE + MARGIN·rainMargin + SEASON·seasonal·(1 − rainMargin/2)
 *   cv     = cvRain·(1 − water) + FLOOD·water + WINTER·winterRisk
 */
export function yieldVarianceParts(world: PeopleWorld, cell: number): YieldVarianceParts {
  const substrate = world.substrate;
  const moisture = world._annualMoisture[cell] ?? 0;
  const temperature = world._annualTemperature[cell] ?? 0;
  const effectiveMoisture = moisture / demand(temperature);
  const rainMargin = clamp01((HARVEST_MOISTURE_ONSET - effectiveMoisture) / HARVEST_MOISTURE_RAMP);
  const dry = substrate.dryFraction[cell] ?? 0;
  const gaussen = Math.max(0, HARVEST_GAUSSEN_SHAPE * dry * (1 - dry) - 1);
  const amplitudeC = (substrate.temperatureAmplitude[cell] ?? 0) * DEGC_PER_TEMPERATURE_UNIT;
  const warmShare = substrate.warmRainFraction[cell] ?? MATH_HALF;
  const concentration = Math.abs(warmShare - MATH_HALF) * 2;
  const monsoon = amplitudeC >= HARVEST_SEASON_AMPLITUDE_MIN_C
    ? Math.max(0, (concentration - HARVEST_MONSOON_ONSET) / (1 - HARVEST_MONSOON_ONSET))
    : 0;
  const seasonal = Math.max(gaussen, monsoon);
  const coolHalfC = temperatureC(temperature) - amplitudeC;
  const winterRisk = amplitudeC > 0
    ? clamp01((HARVEST_COOL_ONSET_C - coolHalfC) / HARVEST_COOL_RAMP_C)
    : 0;
  const surface = clamp01(world._surfaceAccess[cell] ?? 0);
  const rainFarmable = (1 - surface) * (1 - rainMargin);
  const water = surface + rainFarmable > 0 ? surface / (surface + rainFarmable) : 0;
  const cvRain = HARVEST_CV_BASE + HARVEST_CV_MARGIN * rainMargin
    + HARVEST_CV_SEASON * seasonal * (1 - rainMargin * MATH_HALF);
  const cv = cvRain * (1 - water) + HARVEST_CV_FLOOD * water + HARVEST_CV_WINTER * winterRisk;
  const rainExposure = cvRain * (1 - water) + HARVEST_CV_WINTER * winterRisk;
  const floodExposure = HARVEST_CV_FLOOD * water;
  return { rainMargin, seasonal, winterRisk, water, cvRain, rainExposure, floodExposure, cv };
}

/** The yield CV of a land cell (W29); zero on water. */
export function yieldVariance(world: PeopleWorld, cell: number): number {
  if (!world.substrate.landMask[cell]) return 0;
  return yieldVarianceParts(world, cell).cv;
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
    * reliefMultiplier(world, cell)
    * landShare(world, cell);
}

export function foragerCapacity(world: PeopleWorld, cell: number): number {
  const climate = 1 - PEOPLE_DISEASE_RATE * diseaseBurden(world, cell);
  // The terrestrial living is charged to the cell's ground (W19); the aquatic
  // living is not. The second term prices the WATER'S EDGE — shore, river
  // bank, lake margin, floodplain — and water standing inside the cell does
  // not take that edge away, it is that edge. Scaling it by the land share
  // would say a narrow channel feeds fewer fishers than a dry plain beside a
  // lake of the same access.
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
    world._irrigable[cell] = irrigableShare(world, cell);
    world._yieldCv[cell] = yieldVariance(world, cell);
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
