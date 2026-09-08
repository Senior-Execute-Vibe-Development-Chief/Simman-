import {
  CROSSING_ROSE_DX,
  CROSSING_ROSE_DY,
  CLIMATE_MONTHLY_RATIO_MAX,
  CLIMATE_MONTHLY_RATIO_MIN,
  DEGC_PER_TEMPERATURE_UNIT,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_MERIDIONAL_KM,
  CARDINAL_NEIGHBOR_COUNT,
  MATH_HALF,
  MATH_NEGATIVE_ONE,
  MATH_PI,
  MONTHS_PER_YEAR,
  TRAVEL_MONTH_PHASE,
  TRAVEL_SEASONAL_AMPLITUDE,
  DEFAULT_OCEAN_LEVEL,
  ELEVATION_METERS_PER_UNIT,
  TRAVEL_PASS_DIRECTIONS,
} from "./constants";
import { dsin } from "./dmath";
import { buildWorld, type PortedTerritory, type PortedWorld } from "../ported/worldgen/pipeline.js";
import { computeSeasonalRiverFlow } from "../ported/worldgen/riverGen.js";
import { classifyBiome } from "../ported/worldgen/biomeClass.js";
import { WALK_DETOUR_UNIT, WALK_VERTICAL_UNIT_M } from "../ported/worldgen/walkData.js";
import { northSouthKm, rowEastWestKm } from "./travel/cost";
import { fallbackCrossings } from "./crossings";
import { buildSnowpack, emptySnowpack, type Snowpack } from "./snow";
import {
  fillRealClimate,
  isRealClimateAvailable,
  provideRealClimateData,
  sampleMonthlyClimate,
} from "../ported/worldgen/realClimateData.js";
import {
  fillRealWind,
  isRealWindAvailable,
  provideRealWindData,
  sampleMonthlyWind,
} from "../ported/worldgen/realWindData.js";
import { dimensionsFor, type GridPreset } from "./world";
import precipitation from "../../data/reality/global_precip.json";
import airTemperature from "../../data/reality/global_airtemp.json";
import observedWind from "../../data/reality/global_wind.json";

export interface SubstrateConfig {
  readonly preset?: string;
  /** Oracle switch (QUESTIONS.md #21): derive rivers from elevation even on
   * Earth presets, so the v1-verbatim path can be compared exactly. */
  readonly rawRivers?: boolean;
  /** Probe switch (W14, P18): sample the Earth preset's rain from the 1.9°
   * table as is, without the sub-grid orographic share, so the placement
   * can be compared against the table. */
  readonly rawRain?: boolean;
  readonly oceanLevel?: number;
  readonly tecParams?: Readonly<Record<string, unknown>>;
  readonly realWind?: boolean;
}

export interface MonthlyClimate {
  readonly temperature: Float32Array;
  readonly moisture: Float32Array;
}

/** Monthly near-surface wind, m/s, cell × 12: u eastward, v northward. */
export interface MonthlyWind {
  readonly u: Float32Array;
  readonly v: Float32Array;
}

export interface SubstrateRivers {
  readonly magnitude: Uint8Array;
  readonly direction: Uint8Array;
  readonly flowAccum: Float32Array;
  /** Per-tile runoff the accumulation summed (moisture less evaporation, plus
   * mountain melt), in tile-depth units: one unit is a tile's area under one
   * moisture-unit of water. The people world routes it (P17). */
  readonly runoff: Float32Array;
  readonly lake: Int32Array;
  /** Baked lake placement, independent of whether the basin holds water. */
  readonly lakeGeometry?: Uint8Array;
  /** Monthly discharge divided by the annual flow at each cell. */
  readonly seasonalFlowScale?: Float32Array;
  /** Annual flow equivalent of the navigable tributary catchment bar. */
  readonly navigableThreshold?: number;
}

export interface SubstrateAncestry {
  readonly lineage: Int16Array;
  readonly arrival: Float32Array;
  readonly count: number;
  readonly hue: Float32Array;
  readonly light: Float32Array;
  readonly originFx: number;
  readonly originFy: number;
}

export interface Substrate {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly width: number;
  readonly height: number;
  readonly N: number;
  readonly preset: string;
  readonly elevation: Float32Array;
  readonly landMask: Uint8Array;
  readonly climate: MonthlyClimate;
  readonly wind: MonthlyWind;
  readonly temperature: Float32Array;
  readonly moisture: Float32Array;
  readonly rivers: SubstrateRivers;
  readonly ancestry: SubstrateAncestry;
  /** Share of each cell covered by measured flood-stage land, 0..1. */
  readonly floodplain: Float32Array;
  readonly biome: Uint8Array;
  readonly soil: Float32Array;
  readonly fertility: Float32Array;
  readonly wildCropSuitability: Float32Array;
  readonly crossingCost: Float32Array;
  readonly resources: Readonly<Record<string, Float32Array>>;
  readonly relief: Float32Array;
  readonly coast: Uint8Array;
  readonly coastDistanceKm: Float32Array;
  /** How each cell is JOINED to its neighbours, one byte per edge, measured
   * on the 1-arc-minute grid (W22): the high bit says ground runs between the
   * two cells' land, the low seven bits the width in source samples of the
   * widest water channel between their water, zero where there is none. The
   * mask says what a cell mostly is; this says what lies on the edge between
   * two of them, which at every grid the sim steps is where a strait, an
   * isthmus or an island's shore actually is. `cells × TRAVEL_PASS_DIRECTIONS`
   * in the router's rose (E, SE, S, SW); the other four directions are the
   * neighbour's opposite entry. A preset without a bake carries the mask's
   * own rule: land to land is ground, anything touching water is open water,
   * which is exactly what every consumer applied before the table existed. */
  readonly crossings: Uint8Array;
  /** The share of the cell that stands above sea level, 0..1, measured on the
   * 1-arc-minute grid (W19). A cell is a few hundred km2 and a coast, an
   * island or a lake shore routinely cuts through the middle of one, so the
   * land/sea bit above says WHETHER there is ground here and this says HOW
   * MUCH. One everywhere on a preset with no real bathymetry, which is the
   * behaviour every consumer had before the plane existed. */
  readonly landFraction: Float32Array;
  /** WHERE that ground is: one byte per cell, 1 = land, on a grid finer than
   * any the sim steps (W20). The mask says WHETHER a cell holds ground, the
   * cover says HOW MUCH, and this says WHERE inside it — at ~11 km, where a
   * coast, a strait or an island has a shape rather than a bit. It is
   * read-only geometry: the world is DRAWN from it and MEASURED against it,
   * never stepped on it, so it keeps its own resolution instead of being
   * sampled down to this grid. On a preset with no measured fine geometry it
   * carries this grid's own coastline, which is exactly what a consumer saw
   * before the plane existed. */
  readonly landShape: Uint8Array;
  readonly landShapeWidth: number;
  readonly landShapeHeight: number;
  /** The whole block of the shape plane each cell of this grid covers, on both
   * axes: `width * landShapeBlock === landShapeWidth`. Every quantity that
   * crosses the two grids therefore sums over a whole block, and no cell of
   * the plane is ever split between two cells of the sim. */
  readonly landShapeBlock: number;
  /** The extra climb a land route makes crossing to each neighbour BEYOND the
   * difference of the two cells' means: the lowest crossing of their shared
   * boundary measured on the 1-arc-minute grid, minus the higher mean, floored
   * at zero (W21). Elevation units, `cells × TRAVEL_PASS_DIRECTIONS`, directions
   * E, SE, S, SW; the other four are the neighbour's entry for the opposite
   * direction. Zero on any edge touching sea and on every preset without a
   * baked table, which is exactly the ascent the router charged before. */
  /** The walk between two adjacent land cells (W26), cells × TRAVEL_PASS_DIRECTIONS
   * (E, SE, S, SW; the other four are the neighbour's, with the two ascents
   * swapped): its length in km, its ascent from the cell to the neighbour
   * and its ascent back, in elevation units, measured on the fine land
   * under the foot law. Zero where the edge is not land–land or the preset
   * carries no table: the router and the people table then use the
   * straight geometry and the rise between the two means. */
  readonly walkKm: Float32Array;
  readonly walkAscent: Float32Array;
  readonly walkDescent: Float32Array;
  /** The snowpack (W27): water held as snow at each month's end and the
   * cells whose pack never melts out. Empty where the preset has no rain in
   * mm to build it from. */
  readonly snow: Snowpack;
}

// The monthly contract (M1 review ruling): where the observed NCEP monthly
// climatology is loaded, each cell's months are the sim's OWN annual fields
// (with their lapse/orography detail) plus the OBSERVED monthly anomaly —
// temperature as an additive °C anomaly on the sim scale, moisture as the
// month's share of the cell's annual rain (mean-preserving ratio). This is
// what carries the real monsoon and the real pass-closure winters; a
// hemisphere sine cannot. Data in, mechanism out (R7).
function observedMonthlyClimate(world: PortedWorld, N: number, orographicRain: boolean): (MonthlyClimate & { rainMm: Float32Array | null }) | null {
  // The monthly ratios carry the W14 orographic share the annual fill used —
  // each month lifted by its own wind — so the seasonal cycle and the annual
  // total agree about which slope the rain fell on.
  const observed = sampleMonthlyClimate(world.width, world.height, world.elevation, { orographicRain });
  if (!observed) return null;
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
  // W27: the month's rain in mm — the observed annual mm the fill measured
  // (with its orographic share) times the month's own unclamped share, so
  // the twelve sum to the year. The snowpack is built from this; the
  // moisture scale above is the crop side's and keeps its clamp.
  const annualRain = world.rainMm;
  const rainMm = annualRain ? new Float32Array(N * MONTHS_PER_YEAR) : null;
  for (let cell = 0; cell < N; cell++) {
    const baseTemperature = world.temperature[cell];
    const baseMoisture = world.moisture[cell];
    let annualC = 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      annualC += observed.tempC[cell * MONTHS_PER_YEAR + month];
    }
    annualC /= MONTHS_PER_YEAR;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const index = cell * MONTHS_PER_YEAR + month;
      const anomalyC = observed.tempC[index] - annualC;
      temperature[index] = baseTemperature + anomalyC / DEGC_PER_TEMPERATURE_UNIT;
      const ratio = Math.max(
        CLIMATE_MONTHLY_RATIO_MIN,
        Math.min(CLIMATE_MONTHLY_RATIO_MAX, observed.precipRatio[index]),
      );
      moisture[index] = Math.max(0, Math.min(1, baseMoisture * ratio));
      if (rainMm && annualRain) {
        rainMm[index] = ((annualRain[cell] ?? 0) / MONTHS_PER_YEAR) * (observed.precipRatio[index] ?? 1);
      }
    }
  }
  return { temperature, moisture, rainMm };
}

/** Monthly wind from observation; calm placeholder on procedural worlds. */
function monthlyWind(world: PortedWorld, N: number, observed: boolean): MonthlyWind {
  // M1-PLACEHOLDER (procedural presets only): calm seas until the wind
  // solver's own seasonal output is wired through; observed worlds get the
  // real monthly field below.
  if (observed && isRealWindAvailable()) {
    const sampled = sampleMonthlyWind(world.width, world.height);
    if (sampled) return sampled;
  }
  return {
    u: new Float32Array(N * MONTHS_PER_YEAR),
    v: new Float32Array(N * MONTHS_PER_YEAR),
  };
}

// M1-PLACEHOLDER: on procedural presets (no observed climatology) v1 exposes
// annual climate plus seasonal amplitude; retain seasonality without
// inventing a second climate solver until its monthly solver contract is
// ratified.
function monthlyClimate(world: PortedWorld, N: number): MonthlyClimate {
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
  const tAmp = world.tAmp ?? new Float32Array(N);
  const warmRain = world.warmRainFrac ?? new Float32Array(N);
  for (let cell = 0; cell < N; cell++) {
    const y = Math.floor(cell / world.width);
    const hemisphere = y < world.height * MATH_HALF ? 1 : MATH_NEGATIVE_ONE;
    const baseTemperature = world.temperature[cell];
    const baseMoisture = world.moisture[cell];
    const temperatureAmplitude = Math.min(tAmp[cell], baseTemperature);
    const rawRainAmplitude = Math.abs(warmRain[cell] - MATH_HALF) * TRAVEL_SEASONAL_AMPLITUDE;
    const rainAmplitude = baseMoisture > 0
      ? Math.min(rawRainAmplitude, Math.max(0, 1 / baseMoisture - 1))
      : 0;
    let seasonalMean = 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const phase = month * TRAVEL_MONTH_PHASE - hemisphere * MATH_PI * MATH_HALF;
      seasonalMean += dsin(phase);
    }
    seasonalMean /= MONTHS_PER_YEAR;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const phase = month * TRAVEL_MONTH_PHASE - hemisphere * MATH_PI * MATH_HALF;
      const seasonal = dsin(phase) - seasonalMean;
      const index = cell * MONTHS_PER_YEAR + month;
      temperature[index] = baseTemperature + temperatureAmplitude * seasonal;
      moisture[index] = baseMoisture * (1 + rainAmplitude * seasonal);
    }
  }
  return { temperature, moisture };
}

function coastDistances(elevation: Float32Array, width: number, height: number): Float32Array {
  const N = width * height;
  const hops = new Int32Array(N);
  hops.fill(MATH_NEGATIVE_ONE);
  const queue = new Int32Array(N);
  const neighbors = new Int32Array(CARDINAL_NEIGHBOR_COUNT);
  let read = 0;
  let write = 0;
  for (let cell = 0; cell < N; cell++) {
    if (elevation[cell] <= 0) {
      hops[cell] = 0;
      queue[write++] = cell;
    }
  }
  while (read < write) {
    const cell = queue[read++];
    const y = Math.floor(cell / width);
    const x = cell - y * width;
    const left = y * width + (x === 0 ? width - 1 : x - 1);
    const right = y * width + (x === width - 1 ? 0 : x + 1);
    neighbors[0] = left;
    neighbors[1] = right;
    neighbors[2] = y > 0 ? cell - width : MATH_NEGATIVE_ONE;
    neighbors[3] = y < height + MATH_NEGATIVE_ONE ? cell + width : MATH_NEGATIVE_ONE;
    for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex++) {
      const neighbor = neighbors[neighborIndex] ?? MATH_NEGATIVE_ONE;
      if (neighbor < 0 || hops[neighbor] >= 0) continue;
      hops[neighbor] = hops[cell] + 1;
      queue[write++] = neighbor;
    }
  }
  const kmPerCell = Math.min(EARTH_MERIDIONAL_KM / height, EARTH_CIRCUMFERENCE_KM / width);
  const result = new Float32Array(N);
  for (let cell = 0; cell < N; cell++) result[cell] = Math.max(0, hops[cell]) * kmPerCell;
  return result;
}

function makeLandMask(elevation: Float32Array): Uint8Array {
  const mask = new Uint8Array(elevation.length);
  for (let cell = 0; cell < elevation.length; cell++) mask[cell] = elevation[cell] > 0 ? 1 : 0;
  return mask;
}

/** The coastline a grid draws for itself, on the shape plane. A preset with no
 * measured fine geometry has no finer truth to show than its own mask, so each
 * cell fills the whole block of the plane it covers and the plane says exactly
 * what the mask said. */
function coastlineOf(mask: Uint8Array, width: number, height: number, block: number): Uint8Array {
  const planeWidth = width * block;
  const plane = new Uint8Array(planeWidth * height * block);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let inner = 0; inner < block; inner++) {
        const start = (y * block + inner) * planeWidth + x * block;
        plane.fill(1, start, start + block);
      }
    }
  }
  return plane;
}

function makeBiomes(world: PortedWorld, territory: PortedTerritory): Uint8Array {
  const result = new Uint8Array(territory.tElev.length);
  for (let cell = 0; cell < result.length; cell++) {
    result[cell] = classifyBiome(
      territory.tElev[cell],
      territory.tMoist[cell],
      territory.tTemp[cell],
      world.dryFrac[cell] ?? 0,
      world.summerDry[cell] ?? 0,
    );
  }
  return result;
}

/**
 * The Earth preset's climate fill with the W14 orographic share on unless
 * the probe switch turns it off; the worldgen calls it positionally with
 * the nine field arguments.
 */
function observedClimateFill(config: SubstrateConfig): typeof fillRealClimate {
  const orographicRain = !(config.rawRain ?? false);
  return (width, height, elevation, moisture, temperature, dryFraction, summerDry, temperatureAmplitude, warmRainFraction, options) =>
    fillRealClimate(width, height, elevation, moisture, temperature, dryFraction, summerDry, temperatureAmplitude, warmRainFraction, { ...(options ?? {}), orographicRain });
}

export function buildSubstrate(
  seed: number,
  config: SubstrateConfig = {},
  grid: GridPreset = "target",
): Substrate {
  const dimensions = dimensionsFor(grid);
  const width = dimensions.width;
  const height = dimensions.height;
  const preset = config.preset ?? "earth_sim";
  const observedClimate = config.realWind ?? preset === "earth_sim";
  if (observedClimate) {
    provideRealClimateData(precipitation, airTemperature);
    provideRealWindData(observedWind);
  }
  const generated = buildWorld({
    W: width,
    H: height,
    seed,
    preset,
    rawRivers: config.rawRivers ?? false,
    oceanLevel: config.oceanLevel ?? DEFAULT_OCEAN_LEVEL,
    tecParams: { ...(config.tecParams ?? {}) },
    realWind: observedClimate,
    realWindFns: observedClimate && isRealClimateAvailable() && isRealWindAvailable()
      ? { fillRealClimate: observedClimateFill(config), isRealClimateAvailable, fillRealWind, isRealWindAvailable }
      : null,
  });
  const world = generated.w;
  const territory = generated.ter;
  const cells = territory.tElev.length;
  const observedMonths = observedClimate ? observedMonthlyClimate(world, cells, !(config.rawRain ?? false)) : null;
  const climate: MonthlyClimate = observedMonths
    ? { temperature: observedMonths.temperature, moisture: observedMonths.moisture }
    : monthlyClimate(world, cells);
  const wind = monthlyWind(world, cells, observedClimate);
  const annualTemperature = new Float32Array(cells);
  const annualMoisture = new Float32Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    let temperatureSum = 0;
    let moistureSum = 0;
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const index = cell * MONTHS_PER_YEAR + month;
      temperatureSum += climate.temperature[index] ?? 0;
      moistureSum += climate.moisture[index] ?? 0;
    }
    annualTemperature[cell] = temperatureSum / MONTHS_PER_YEAR;
    annualMoisture[cell] = moistureSum / MONTHS_PER_YEAR;
  }
  const seasonalFlowScale = computeSeasonalRiverFlow({
    tw: width,
    th: height,
    tElev: territory.tElev,
    annualMoisture,
    annualTemperature,
    monthlyMoisture: climate.moisture,
    monthlyTemperature: climate.temperature,
    flowDir: territory.rivers.flowDir,
    annualFlow: territory.rivers.flowAccum,
    drainsTerminal: territory.rivers.drainsTerminal,
    resolutionInvariantLoss: preset === "earth" || preset === "earth_sim",
  });
  const elevation = territory.tElev;
  const landMask = makeLandMask(elevation);
  // W27: the pack cycled over the climate's year, from the monthly
  // temperature and the observed rain; empty where there is no rain in mm.
  const snow = observedMonths?.rainMm
    ? buildSnowpack(climate.temperature, observedMonths.rainMm, landMask, width, height)
    : emptySnowpack(cells);
  const shapeBlock = world.landShapeWidth / width;
  if (!Number.isInteger(shapeBlock) || world.landShapeHeight / height !== shapeBlock) {
    throw new Error(
      `the land shape plane (${world.landShapeWidth}x${world.landShapeHeight}) is not a whole `
      + `multiple of the ${width}x${height} grid, so a cell of it would straddle two cells of this one`,
    );
  }
  const substrate: Substrate = {
    seed,
    grid,
    width,
    height,
    N: width * height,
    preset,
    elevation,
    landMask,
    climate,
    wind,
    temperature: climate.temperature,
    moisture: climate.moisture,
    rivers: {
      magnitude: territory.rivers.riverMag,
      direction: territory.rivers.flowDir,
      flowAccum: territory.rivers.flowAccum,
      runoff: territory.rivers.runoff,
      lake: territory.rivers.lake,
      lakeGeometry: territory.rivers.lakeGeometry,
      seasonalFlowScale,
      navigableThreshold: territory.rivers.navigableThreshold,
    },
    ancestry: {
      lineage: territory.tAncestry,
      arrival: territory.tArrival,
      count: territory.ancestryCount,
      hue: territory.ancHue,
      light: territory.ancLight,
      originFx: territory.ancOriginFx,
      originFy: territory.ancOriginFy,
    },
    floodplain: territory.tFlood,
    biome: makeBiomes(world, territory),
    soil: territory.tFert,
    fertility: territory.tFert,
    wildCropSuitability: territory.tCrop,
    crossingCost: territory.tCross,
    resources: territory.deposits,
    relief: territory.tRelief,
    coast: territory.tCoast,
    coastDistanceKm: coastDistances(elevation, width, height),
    crossings: crossingsOf(world, landMask, width, height),
    // Sampled on the world grid beside the elevation it corrects; a preset
    // without it is wholly land wherever it is land at all.
    landFraction: world.landFraction ?? new Float32Array(cells).fill(1),
    // Its own resolution, not this grid's: the plane is measured geography,
    // and sampling it down to the grid would throw away the very thing it
    // carries. The block check is the seam — it holds for every grid preset.
    landShape: world.landShape ?? coastlineOf(landMask, width, height, shapeBlock),
    landShapeWidth: world.landShapeWidth,
    landShapeHeight: world.landShapeHeight,
    landShapeBlock: shapeBlock,
    ...walksOf(world, cells),
    snow,
  };
  return Object.freeze(substrate);
}

/** The baked crossing table, or the mask's own rule where the preset carries
 * none — two land cells share ground, an edge touching water is open water. */
function crossingsOf(
  world: PortedWorld,
  landMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const bytes = world.crossings;
  if (!bytes) return fallbackCrossings(landMask, width, height);
  const expected = width * height * TRAVEL_PASS_DIRECTIONS;
  if (bytes.length !== expected) {
    throw new Error(
      `the crossing table holds ${bytes.length} entries for ${width}x${height}; expected ${expected}`,
    );
  }
  return bytes;
}

/** The baked walk tables in km and elevation units, or all zeros where the
 * preset carries none — the router then charges the straight geometry and
 * the two means, as it did before W26. The bake stores each walk's detour
 * over the straight line; the straight line is this grid's own edge length
 * (the router's: one north–south extent, one east–west extent per row, the
 * hypotenuse of the two rows' mean for a diagonal), multiplied back in here. */
function walksOf(world: PortedWorld, cells: number): { walkKm: Float32Array; walkAscent: Float32Array; walkDescent: Float32Array } {
  const walkKm = new Float32Array(cells * TRAVEL_PASS_DIRECTIONS);
  const walkAscent = new Float32Array(cells * TRAVEL_PASS_DIRECTIONS);
  const walkDescent = new Float32Array(cells * TRAVEL_PASS_DIRECTIONS);
  const walks = world.walks;
  if (!walks) return { walkKm, walkAscent, walkDescent };
  if (walks.detour.length !== walkKm.length) {
    throw new Error(
      `the walk table holds ${walks.detour.length} entries for ${cells} cells; ` +
        `expected ${walkKm.length}`,
    );
  }
  const { width, height } = world;
  const rows = rowEastWestKm({ width, height });
  const northSouth = northSouthKm({ height });
  for (let cell = 0; cell < cells; cell++) {
    const y = Math.floor(cell / width);
    for (let direction = 0; direction < TRAVEL_PASS_DIRECTIONS; direction++) {
      const slot = cell * TRAVEL_PASS_DIRECTIONS + direction;
      const detour = walks.detour[slot] ?? 0;
      if (detour === 0) continue;
      const dx = CROSSING_ROSE_DX[direction] ?? 0;
      const dy = CROSSING_ROSE_DY[direction] ?? 0;
      const eastWest = dx === 0 ? 0 : dy === 0 ? (rows[y] ?? 0) : ((rows[y] ?? 0) + (rows[y + 1] ?? 0)) * MATH_HALF;
      const north = dy === 0 ? 0 : northSouth;
      const straight = Math.sqrt(eastWest * eastWest + north * north);
      walkKm[slot] = straight * (1 + (detour - 1) * WALK_DETOUR_UNIT);
      walkAscent[slot] = ((walks.up[slot] ?? 0) * WALK_VERTICAL_UNIT_M) / ELEVATION_METERS_PER_UNIT;
      walkDescent[slot] = ((walks.down[slot] ?? 0) * WALK_VERTICAL_UNIT_M) / ELEVATION_METERS_PER_UNIT;
    }
  }
  return { walkKm, walkAscent, walkDescent };
}
