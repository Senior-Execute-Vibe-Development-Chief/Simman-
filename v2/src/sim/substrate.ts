import {
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
} from "./constants";
import { dsin } from "./dmath";
import { buildWorld, type PortedTerritory, type PortedWorld } from "../ported/worldgen/pipeline.js";
import { computeSeasonalRiverFlow } from "../ported/worldgen/riverGen.js";
import { classifyBiome } from "../ported/worldgen/biomeClass.js";
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
  /** Real width, km, of a sub-pixel channel the strait carve had to OPEN for
   * the raster to hold it — zero wherever the grid resolves the water on its
   * own, which is everywhere outside those channels and everywhere at all on
   * a preset that does not carve (W18). */
  readonly straitWidthKm: Float32Array;
}

// The monthly contract (M1 review ruling): where the observed NCEP monthly
// climatology is loaded, each cell's months are the sim's OWN annual fields
// (with their lapse/orography detail) plus the OBSERVED monthly anomaly —
// temperature as an additive °C anomaly on the sim scale, moisture as the
// month's share of the cell's annual rain (mean-preserving ratio). This is
// what carries the real monsoon and the real pass-closure winters; a
// hemisphere sine cannot. Data in, mechanism out (R7).
function observedMonthlyClimate(world: PortedWorld, N: number, orographicRain: boolean): MonthlyClimate | null {
  // The monthly ratios carry the W14 orographic share the annual fill used —
  // each month lifted by its own wind — so the seasonal cycle and the annual
  // total agree about which slope the rain fell on.
  const observed = sampleMonthlyClimate(world.width, world.height, world.elevation, { orographicRain });
  if (!observed) return null;
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
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
    }
  }
  return { temperature, moisture };
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
  return (width, height, elevation, moisture, temperature, dryFraction, summerDry, temperatureAmplitude, warmRainFraction) =>
    fillRealClimate(width, height, elevation, moisture, temperature, dryFraction, summerDry, temperatureAmplitude, warmRainFraction, { orographicRain });
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
  const climate = (observedClimate ? observedMonthlyClimate(world, cells, !(config.rawRain ?? false)) : null)
    ?? monthlyClimate(world, cells);
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
    // The carve runs on the world grid and buildTerritory samples it at RES 1,
    // so the field indexes exactly as every other substrate array does.
    straitWidthKm: world.straitWidthKm ?? new Float32Array(cells),
  };
  return Object.freeze(substrate);
}
