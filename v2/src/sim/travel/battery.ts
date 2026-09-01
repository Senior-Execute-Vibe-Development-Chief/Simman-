import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  ROUTING_SYMMETRY_EPSILON,
  ROUTING_FIXTURE_COAST_KM,
  ROUTING_FIXTURE_DEV_HEIGHT,
  ROUTING_FIXTURE_DEV_WIDTH,
  ROUTING_FIXTURE_LAND_ELEVATION,
  ROUTING_FIXTURE_MOISTURE,
  ROUTING_FIXTURE_TARGET_HEIGHT,
  ROUTING_FIXTURE_TARGET_WIDTH,
  ROUTING_FIXTURE_TEMPERATURE,
  ROUTING_FIXTURE_WATER_ELEVATION,
  ROUTING_FIXTURE_WIND_MS,
  TRAVEL_RIVER_TEST_MAGNITUDE,
  UINT8_SENTINEL,
} from "../constants";
import { hash32 } from "../../ported/rng";
import type { GridPreset } from "../world";
import type { Substrate } from "../substrate";
import { TravelEngine } from "./engine";
import type { TravelMetric, TravelMode } from "./cost";

function fixtureSubstrate(grid: GridPreset): Substrate {
  const width = grid === "dev" ? ROUTING_FIXTURE_DEV_WIDTH : ROUTING_FIXTURE_TARGET_WIDTH;
  const height = grid === "dev" ? ROUTING_FIXTURE_DEV_HEIGHT : ROUTING_FIXTURE_TARGET_HEIGHT;
  const N = width * height;
  const elevation = new Float32Array(N);
  const landMask = new Uint8Array(N);
  const coast = new Uint8Array(N);
  const coastDistanceKm = new Float32Array(N);
  const relief = new Float32Array(N);
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
  const magnitude = new Uint8Array(N);
  const direction = new Uint8Array(N);
  direction.fill(UINT8_SENTINEL);
  const flowAccum = new Float32Array(N);
  const lake = new Int32Array(N);
  lake.fill(MATH_NEGATIVE_ONE);
  // A uniform eastward breeze: sail modes must come out direction-asymmetric
  // (the monsoon mechanism), while land modes stay exactly symmetric.
  const windU = new Float32Array(N * MONTHS_PER_YEAR);
  windU.fill(ROUTING_FIXTURE_WIND_MS);
  const windV = new Float32Array(N * MONTHS_PER_YEAR);

  for (let cell = 0; cell < N; cell++) {
    const y = Math.floor(cell / width);
    const water = y === 0;
    elevation[cell] = water ? ROUTING_FIXTURE_WATER_ELEVATION : ROUTING_FIXTURE_LAND_ELEVATION;
    landMask[cell] = water ? 0 : 1;
    coast[cell] = y <= 1 ? 1 : 0;
    coastDistanceKm[cell] = y * ROUTING_FIXTURE_COAST_KM;
    if (y === Math.floor(height / 2)) {
      magnitude[cell] = TRAVEL_RIVER_TEST_MAGNITUDE;
      direction[cell] = 0;
      flowAccum[cell] = 1;
    }
    for (let month = 0; month < MONTHS_PER_YEAR; month++) {
      const climateIndex = cell * MONTHS_PER_YEAR + month;
      temperature[climateIndex] = ROUTING_FIXTURE_TEMPERATURE;
      moisture[climateIndex] = ROUTING_FIXTURE_MOISTURE;
    }
  }

  const climate = { temperature, moisture };
  return {
    seed: 0,
    grid,
    width,
    height,
    N,
    preset: "routing-fixture",
    elevation,
    landMask,
    climate,
    wind: { u: windU, v: windV },
    temperature,
    moisture,
    rivers: { magnitude, direction, flowAccum, lake },
    ancestry: {
      lineage: new Int16Array(N),
      arrival: new Float32Array(N),
      count: 1,
      hue: new Float32Array(1),
      light: new Float32Array(1),
      originFx: 0,
      originFy: 0,
    },
    floodplain: new Uint8Array(N),
    biome: new Uint8Array(N),
    soil: new Float32Array(N),
    fertility: new Float32Array(N),
    wildCropSuitability: new Float32Array(N),
    crossingCost: new Float32Array(N),
    resources: {},
    relief,
    coast,
    coastDistanceKm,
  };
}

const MODES_BY_BATTERY: readonly TravelMode[] = [
  "foot",
  "pack",
  "cart",
  "river",
  "coastal",
  "open-sea",
];

function metricFor(mode: TravelMode, month: number): TravelMetric {
  const capabilities = mode === "foot"
    ? []
    : mode === "pack"
      ? ["packAnimals"] as const
      : mode === "cart"
        ? ["wheelsDraft"] as const
        : mode === "river" || mode === "coastal"
          ? ["boats"] as const
          : ["navigation"] as const;
  return { month, modes: [mode], capabilities };
}

export interface RoutingBatteryResult {
  readonly grid: GridPreset;
  readonly queries: number;
  readonly hash: number;
}

export async function runRoutingBattery(grid: GridPreset): Promise<RoutingBatteryResult> {
  const substrate = fixtureSubstrate(grid);
  const engine = await TravelEngine.create(substrate);
  let hash = hash32(substrate.width, substrate.height, grid);
  let queries = 0;
  for (let month = 0; month < MONTHS_PER_YEAR; month++) {
    for (const mode of MODES_BY_BATTERY) {
      const metric = metricFor(mode, month);
      const row = Math.floor(substrate.height / 2);
      const start = mode === "open-sea" || mode === "coastal"
        ? 1
        : mode === "river"
          ? row * substrate.width + 1
          : substrate.width + 1;
      const goal = mode === "open-sea" || mode === "coastal"
        ? substrate.width - 2
        : mode === "river"
          ? row * substrate.width + substrate.width - 2
          : substrate.width + substrate.width - 2;
      const route = engine.query(start, goal, metric);
      if (!Number.isFinite(route.days) || route.path.length < 2) {
        throw new Error(`Routing battery could not route ${mode} on ${grid}.`);
      }
      hash = hash32(hash, month, mode, route.days, ...route.path);
      queries++;
    }
  }
  const base = engine.query(
    substrate.width + 1,
    substrate.width + substrate.width - 2,
    metricFor("foot", 0),
  ).days;
  const expanded = engine.query(
    substrate.width + 1,
    substrate.width + substrate.width - 2,
    { month: 0, modes: ["foot", "pack"], capabilities: ["packAnimals"] },
  ).days;
  if (expanded > base) throw new Error(`Capability monotonicity failed on ${grid}.`);
  const map = engine.distanceMap([substrate.width + 1], metricFor("foot", 0));
  if (!Number.isFinite(map[substrate.width + substrate.width - 2])) {
    throw new Error(`Multi-source distance map failed on ${grid}.`);
  }
  hash = hash32(hash, base, expanded, map[substrate.width + substrate.width - 2] ?? 0);
  const riverRow = Math.floor(substrate.height / 2) * substrate.width;
  const riverGoal = riverRow + Math.floor(substrate.width / 2);
  const riverForward = engine.query(
    riverRow + 1,
    riverGoal,
    metricFor("river", 0),
  );
  const riverReverse = engine.query(
    riverGoal,
    riverRow + 1,
    metricFor("river", 0),
  );
  if (!(riverReverse.days > riverForward.days)) {
    throw new Error(`Directed river asymmetry failed on ${grid}.`);
  }
  const middle = substrate.width + Math.floor(substrate.width / 2);
  const first = substrate.width + 1;
  const last = substrate.width + substrate.width - 2;
  const ab = engine.query(first, middle, metricFor("foot", 0)).days;
  const bc = engine.query(middle, last, metricFor("foot", 0)).days;
  const ac = engine.query(first, last, metricFor("foot", 0)).days;
  if (ac > ab + bc) throw new Error(`Triangle inequality failed on ${grid}.`);
  const ca = engine.query(last, first, metricFor("foot", 0)).days;
  if (Math.abs(ac - ca) > ROUTING_SYMMETRY_EPSILON) throw new Error(`Symmetry failed on ${grid}.`);
  // Adjacent cells, so the wrap-around cannot reverse the heading: with the
  // fixture's eastward breeze, the one-edge downwind hop must beat upwind.
  const sailEast = engine.query(1, 2, metricFor("open-sea", 0)).days;
  const sailWest = engine.query(2, 1, metricFor("open-sea", 0)).days;
  if (!(sailEast < sailWest)) {
    throw new Error(`Wind asymmetry failed on ${grid}: downwind must beat upwind.`);
  }
  hash = hash32(hash, riverForward.days, riverReverse.days, ab, bc, ac, ca, sailEast, sailWest);
  return { grid, queries, hash };
}

export async function runRoutingBatteries(): Promise<readonly RoutingBatteryResult[]> {
  return [await runRoutingBattery("dev"), await runRoutingBattery("target")];
}
