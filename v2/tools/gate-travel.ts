import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONSERVATION_EPSILON,
  EARTH_MERIDIONAL_KM,
  GRAIN_SHED_EQUIVALENCE_SEA_KM,
  GRAIN_SHED_MAX_KM,
  GRAIN_SHED_MIN_KM,
  M0_DEFAULT_SEED,
  MONTHS_PER_YEAR,
  ROUTING_UNREACHABLE_DAYS,
} from "../src/sim/constants";
import { buildSubstrate, type Substrate } from "../src/sim/substrate";
import { createTravelEngine, TravelEngine, type TravelRoute } from "../src/sim/travel/engine";
import { freightCost, rowEastWestKm, type Capability, type TravelMetric, type TravelMode } from "../src/sim/travel/cost";
import { type GridPreset, World } from "../src/sim/world";
import { printProvenance, provenance } from "./lib/provenance";

interface RouteFixture {
  readonly id: string;
  readonly from: { readonly lat: number; readonly lon: number };
  readonly to: { readonly lat: number; readonly lon: number };
  readonly month: number;
  readonly modes: readonly TravelMode[];
  readonly capabilities: readonly Capability[];
  readonly expectedDays: number;
  readonly grids?: readonly GridPreset[];
  readonly source: string;
  readonly tolerance: number;
}

interface KnownMiss {
  readonly check: "route" | "crossGrid" | "check";
  readonly id: string;
  readonly grid?: GridPreset;
  readonly reason: string;
}

interface RouteMeasurement {
  readonly id: string;
  readonly grid: GridPreset;
  readonly actualDays: number;
  readonly expectedDays: number;
  readonly relativeError: number;
  readonly reachable: boolean;
  readonly pathCells: number;
  readonly source: string;
  readonly status: "pass" | "fail";
}

const routes = JSON.parse(
  readFileSync(new URL("../data/reality/travel-routes.json", import.meta.url), "utf8"),
) as readonly RouteFixture[];
const knownMisses = JSON.parse(
  readFileSync(new URL("../data/reality/known-misses.json", import.meta.url), "utf8"),
) as readonly KnownMiss[];

function missKey(check: string, id: string, grid?: string): string {
  return grid ? `${check}:${id}:${grid}` : `${check}:${id}`;
}

function cellAt(point: RouteFixture["from"], substrate: Substrate): number {
  const x = ((Math.round((point.lon + 180) / 360 * substrate.width) % substrate.width) + substrate.width) % substrate.width;
  const y = Math.max(0, Math.min(substrate.height - 1, Math.round((90 - point.lat) / 180 * substrate.height)));
  const initial = y * substrate.width + x;
  if (substrate.landMask[initial]) return initial;
  for (let radius = 1; radius < substrate.width + substrate.height; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidateX = (x + dx + substrate.width) % substrate.width;
        const candidateY = Math.max(0, Math.min(substrate.height - 1, y + dy));
        const candidate = candidateY * substrate.width + candidateX;
        if (substrate.landMask[candidate]) return candidate;
      }
    }
  }
  return initial;
}

function metricFor(route: RouteFixture): TravelMetric {
  return {
    month: route.month,
    modes: route.modes,
    capabilities: route.capabilities,
  };
}

async function measureGrid(grid: GridPreset): Promise<readonly RouteMeasurement[]> {
  const substrate = buildSubstrate(M0_DEFAULT_SEED, { preset: "earth_sim" }, grid);
  const stamp = new World({
    seed: M0_DEFAULT_SEED,
    grid,
    config: { preset: "earth_sim", substrate: "immutable" },
  });
  printProvenance(stamp);
  const engine = await createTravelEngine(substrate);
  const measurements: RouteMeasurement[] = [];
  for (const route of routes) {
    if (route.grids && !route.grids.includes(grid)) continue;
    const start = cellAt(route.from, substrate);
    const goal = cellAt(route.to, substrate);
    const result: TravelRoute = engine.query(start, goal, metricFor(route));
    const reachable = Number.isFinite(result.days) && result.days < ROUTING_UNREACHABLE_DAYS;
    const relativeError = reachable
      ? Math.abs(result.days - route.expectedDays) / Math.max(route.expectedDays, CONSERVATION_EPSILON)
      : Number.POSITIVE_INFINITY;
    const status = reachable && relativeError <= route.tolerance ? "pass" : "fail";
    measurements.push({
      id: route.id,
      grid,
      actualDays: reachable ? result.days : -1,
      expectedDays: route.expectedDays,
      relativeError,
      reachable,
      pathCells: result.path.length,
      source: route.source,
      status,
    });
  }
  return measurements;
}

interface CrossGridCheck {
  readonly id: string;
  readonly devDays: number;
  readonly targetDays: number;
  readonly relativeDifference: number;
  readonly status: "pass" | "fail";
}

function checkCrossGrid(measurements: readonly RouteMeasurement[]): readonly CrossGridCheck[] {
  const byId = new Map<string, RouteMeasurement[]>();
  for (const row of measurements) {
    const list = byId.get(row.id) ?? [];
    list.push(row);
    byId.set(row.id, list);
  }
  const checks: CrossGridCheck[] = [];
  for (const [id, rows] of byId) {
    if (rows.length < 2) continue;
    const dev = rows.find((row) => row.grid === "dev");
    const target = rows.find((row) => row.grid === "target");
    if (!dev || !target || !dev.reachable || !target.reachable) continue;
    const parity = Math.abs(dev.actualDays - target.actualDays)
      / Math.max(dev.actualDays, target.actualDays, CONSERVATION_EPSILON);
    checks.push({
      id,
      devDays: dev.actualDays,
      targetDays: target.actualDays,
      relativeDifference: parity,
      status: parity <= 0.1 ? "pass" : "fail",
    });
  }
  return checks;
}

// ── Reference-terrain measurements ───────────────────────────────────────
// Flat land, calm sea, one navigable river — every anchor below is measured
// THROUGH the engine on this substrate, so a broken cost chain fails it.
// (The gate's previous revision echoed the constants back at themselves.)

const REF_WIDTH = 24;
const REF_HEIGHT = 12;
const REF_WATER_ROWS = 6;
const REF_RIVER_ROW = 9;
const REF_MEASURE_ROW = 8;
const REF_SEA_ROW = 2;

function referenceSubstrate(): Substrate {
  const N = REF_WIDTH * REF_HEIGHT;
  const elevation = new Float32Array(N);
  const landMask = new Uint8Array(N);
  const coast = new Uint8Array(N);
  const coastDistanceKm = new Float32Array(N);
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  temperature.fill(0.6);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
  moisture.fill(0.5);
  const magnitude = new Uint8Array(N);
  const direction = new Uint8Array(N);
  direction.fill(255);
  const lake = new Int32Array(N);
  lake.fill(-1);
  for (let cell = 0; cell < N; cell++) {
    const y = Math.floor(cell / REF_WIDTH);
    const water = y < REF_WATER_ROWS;
    elevation[cell] = water ? -0.001 : 0.001;
    landMask[cell] = water ? 0 : 1;
    coast[cell] = y === REF_WATER_ROWS ? 1 : 0;
    coastDistanceKm[cell] = Math.abs(y - (REF_WATER_ROWS - 0.5)) * 25;
    if (y === REF_RIVER_ROW) {
      magnitude[cell] = 3;
      direction[cell] = 0;
    }
  }
  return {
    seed: 0,
    grid: "dev",
    width: REF_WIDTH,
    height: REF_HEIGHT,
    N,
    preset: "reference-terrain",
    elevation,
    landMask,
    climate: { temperature, moisture },
    wind: { u: new Float32Array(N * MONTHS_PER_YEAR), v: new Float32Array(N * MONTHS_PER_YEAR) },
    temperature,
    moisture,
    rivers: { magnitude, direction, flowAccum: new Float32Array(N), lake },
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
    relief: new Float32Array(N),
    coastDistanceKm,
    coast,
  };
}

interface ReferenceMeasurements {
  readonly footKmPerDay: number;
  readonly packKmPerDay: number;
  readonly freightPerKm: { readonly sea: number; readonly river: number; readonly land: number };
  readonly grainShedKm: number;
}

async function measureReference(): Promise<ReferenceMeasurements> {
  const substrate = referenceSubstrate();
  const engine = await TravelEngine.create(substrate);
  const rowKm = rowEastWestKm(substrate);
  const nsKm = EARTH_MERIDIONAL_KM / REF_HEIGHT;
  // Real length of the path the engine actually took (it may wrap the
  // cylinder the short way — the engine is right to, so measure that).
  const pathKm = (path: readonly number[]): number => {
    let km = 0;
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1] ?? 0;
      const b = path[index] ?? 0;
      const ay = Math.floor(a / REF_WIDTH);
      const by = Math.floor(b / REF_WIDTH);
      const ax = a - ay * REF_WIDTH;
      const bx = b - by * REF_WIDTH;
      const rawDx = Math.abs(ax - bx);
      const dx = Math.min(rawDx, REF_WIDTH - rawDx);
      const dy = Math.abs(ay - by);
      const ew = dx * ((rowKm[ay] ?? 0) + (rowKm[by] ?? 0)) * 0.5;
      const ns = dy * nsKm;
      km += Math.sqrt(ew * ew + ns * ns);
    }
    return km;
  };
  const measure = (
    row: number,
    mode: TravelMode,
    capabilities: readonly Capability[],
    reverse = false,
  ): { kmPerDay: number; days: number; km: number } => {
    const start = row * REF_WIDTH + (reverse ? REF_WIDTH - 2 : 1);
    const goal = row * REF_WIDTH + (reverse ? 1 : REF_WIDTH - 2);
    const metric: TravelMetric = { month: 0, modes: [mode], capabilities };
    const route = engine.query(start, goal, metric);
    assert.ok(route.days < ROUTING_UNREACHABLE_DAYS, `reference ${mode} route unreachable`);
    const km = pathKm(route.path);
    return { kmPerDay: km / route.days, days: route.days, km };
  };
  const foot = measure(REF_MEASURE_ROW, "foot", []);
  const pack = measure(REF_MEASURE_ROW, "pack", ["packAnimals"]);
  const cart = measure(REF_MEASURE_ROW, "cart", ["wheelsDraft"]);
  const sea = measure(REF_SEA_ROW, "open-sea", ["navigation"]);
  const riverDown = measure(REF_RIVER_ROW, "river", ["boats"]);
  const riverUp = measure(REF_RIVER_ROW, "river", ["boats"], true);
  const freightPerKm = {
    sea: freightCost("open-sea", sea.days) / sea.km,
    river: (freightCost("river", riverDown.days) + freightCost("river", riverUp.days)) / (riverDown.km + riverUp.km),
    land: freightCost("cart", cart.days) / cart.km,
  };
  return {
    footKmPerDay: foot.kmPerDay,
    packKmPerDay: pack.kmPerDay,
    freightPerKm,
    grainShedKm: GRAIN_SHED_EQUIVALENCE_SEA_KM * freightPerKm.sea / freightPerKm.land,
  };
}

function within(value: number, low: number, high: number): boolean {
  return value >= low && value <= high;
}

function referenceChecks(
  reference: ReferenceMeasurements,
  measurements: readonly RouteMeasurement[],
): readonly { id: string; actual: unknown; expected: string; status: "pass" | "fail" }[] {
  const ratioOk = (actual: number, target: number): boolean =>
    Math.abs(actual - target) / target <= 0.1;
  const monsoonAgainst = measurements.find((row) => row.id === "calicut-aden" && row.grid === "target");
  const monsoonWith = measurements.find((row) => row.id === "calicut-aden-monsoon" && row.grid === "target");
  const monsoonDirectional = monsoonAgainst !== undefined && monsoonWith !== undefined
    && monsoonAgainst.reachable && monsoonWith.reachable
    && monsoonWith.actualDays < monsoonAgainst.actualDays
    && (monsoonAgainst.actualDays - monsoonWith.actualDays) / monsoonAgainst.actualDays > 0.05;
  return [
    {
      id: "foot-day-measured",
      actual: reference.footKmPerDay,
      expected: "20..30 km/day on flat reference terrain",
      status: within(reference.footKmPerDay, 20, 30) ? "pass" : "fail",
    },
    {
      id: "ride-day-measured",
      actual: reference.packKmPerDay,
      expected: "30..40 km/day on flat reference terrain",
      status: within(reference.packKmPerDay, 30, 40) ? "pass" : "fail",
    },
    {
      id: "freight-ratio-measured",
      actual: [
        reference.freightPerKm.sea / reference.freightPerKm.sea,
        reference.freightPerKm.river / reference.freightPerKm.sea,
        reference.freightPerKm.land / reference.freightPerKm.sea,
      ],
      expected: "sea:river:land ≈ 1:5:28 (Duncan-Jones), ±10%",
      status: ratioOk(reference.freightPerKm.river / reference.freightPerKm.sea, 5)
        && ratioOk(reference.freightPerKm.land / reference.freightPerKm.sea, 28)
        ? "pass" : "fail",
    },
    {
      id: "grain-shed-measured",
      actual: reference.grainShedKm,
      expected: `${GRAIN_SHED_MIN_KM}..${GRAIN_SHED_MAX_KM} km land haul ≡ a ${GRAIN_SHED_EQUIVALENCE_SEA_KM} km sea crossing (the "cheaper across the sea than 75 miles inland" anchor)`,
      status: within(reference.grainShedKm, GRAIN_SHED_MIN_KM, GRAIN_SHED_MAX_KM) ? "pass" : "fail",
    },
    {
      id: "monsoon-directional",
      actual: [monsoonAgainst?.actualDays, monsoonWith?.actualDays],
      expected: "Calicut→Aden with the NE monsoon (Nov) beats against the SW (Jun) by >5%",
      status: monsoonDirectional ? "pass" : "fail",
    },
  ];
}

async function main(): Promise<void> {
  const stamps = {
    dev: provenance(new World({ seed: M0_DEFAULT_SEED, grid: "dev", config: { preset: "earth_sim" } })),
    target: provenance(new World({ seed: M0_DEFAULT_SEED, grid: "target", config: { preset: "earth_sim" } })),
  };
  const reference = await measureReference();
  const dev = await measureGrid("dev");
  const target = await measureGrid("target");
  const measurements = [...dev, ...target];
  const crossGrid = checkCrossGrid(measurements);
  const checks = referenceChecks(reference, measurements);

  const failureKeys = new Set<string>();
  for (const row of measurements) {
    if (row.status === "fail") failureKeys.add(missKey("route", row.id, row.grid));
  }
  for (const row of crossGrid) {
    if (row.status === "fail") failureKeys.add(missKey("crossGrid", row.id));
  }
  for (const row of checks) {
    if (row.status === "fail") failureKeys.add(missKey("check", row.id));
  }
  const manifestKeys = new Map(knownMisses.map((miss) => [missKey(miss.check, miss.id, miss.grid), miss.reason]));
  const unexpected = [...failureKeys].filter((key) => !manifestKeys.has(key));
  const stale = [...manifestKeys.keys()].filter((key) => !failureKeys.has(key));
  const acknowledged = [...failureKeys]
    .filter((key) => manifestKeys.has(key))
    .map((key) => ({ key, reason: manifestKeys.get(key) }));

  console.log(JSON.stringify({
    gate: unexpected.length === 0 && stale.length === 0 ? "pass" : "fail",
    provenance: { seed: M0_DEFAULT_SEED, grids: ["dev", "target"], routeCount: routes.length, stamps },
    reference,
    checks,
    crossGrid,
    routes: measurements,
    knownMisses: acknowledged,
    unexpectedFailures: unexpected,
    staleKnownMisses: stale,
  }));
  assert.equal(unexpected.length, 0, `unexpected travel gate failures: ${unexpected.join(", ")}`);
  assert.equal(stale.length, 0,
    `stale known-miss entries now pass — ratchet them out of known-misses.json: ${stale.join(", ")}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
