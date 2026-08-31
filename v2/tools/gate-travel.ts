import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONSERVATION_EPSILON, M0_DEFAULT_SEED } from "../src/sim/constants";
import {
  TRAVEL_COST_FREIGHT_LAND,
  TRAVEL_COST_FREIGHT_RIVER,
  TRAVEL_COST_FREIGHT_SEA,
  TRAVEL_FOOT_KM_PER_DAY,
  TRAVEL_PACK_KM_PER_DAY,
} from "../src/sim/constants";
import { buildSubstrate, type Substrate } from "../src/sim/substrate";
import { createTravelEngine, type TravelRoute } from "../src/sim/travel/engine";
import type { Capability, TravelMetric, TravelMode } from "../src/sim/travel/cost";
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
  readonly source: string;
  readonly tolerance: number;
}

interface RouteMeasurement {
  readonly id: string;
  readonly grid: GridPreset;
  readonly actualDays: number;
  readonly expectedDays: number;
  readonly relativeError: number;
  readonly pathCells: number;
  readonly source: string;
  readonly status: "pass" | "fail";
}

const routes = JSON.parse(
  readFileSync(new URL("../data/reality/travel-routes.json", import.meta.url), "utf8"),
) as readonly RouteFixture[];

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
    const start = cellAt(route.from, substrate);
    const goal = cellAt(route.to, substrate);
    const result: TravelRoute = engine.query(start, goal, metricFor(route));
    const relativeError = Math.abs(result.days - route.expectedDays) / Math.max(route.expectedDays, CONSERVATION_EPSILON);
    const status = Number.isFinite(result.days) && relativeError <= route.tolerance ? "pass" : "fail";
    measurements.push({
      id: route.id,
      grid,
      actualDays: result.days,
      expectedDays: route.expectedDays,
      relativeError,
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

function checkCrossGrid(measurements: readonly RouteMeasurement[]): {
  readonly measurements: readonly RouteMeasurement[];
  readonly checks: readonly CrossGridCheck[];
} {
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
    if (!dev || !target || !Number.isFinite(dev.actualDays) || !Number.isFinite(target.actualDays)) {
      continue;
    }
    const parity = Math.abs(dev.actualDays - target.actualDays) / Math.max(dev.actualDays, target.actualDays, CONSERVATION_EPSILON);
    checks.push({
      id,
      devDays: dev.actualDays,
      targetDays: target.actualDays,
      relativeDifference: parity,
      status: parity <= 0.1 ? "pass" : "fail",
    });
  }
  return { measurements, checks };
}

function nonRouteChecks(measurements: readonly RouteMeasurement[]): readonly Record<string, unknown>[] {
  const freight = [TRAVEL_COST_FREIGHT_SEA, TRAVEL_COST_FREIGHT_RIVER, TRAVEL_COST_FREIGHT_LAND];
  const footPass = TRAVEL_FOOT_KM_PER_DAY >= 20 && TRAVEL_FOOT_KM_PER_DAY <= 30;
  const packPass = TRAVEL_PACK_KM_PER_DAY >= 30 && TRAVEL_PACK_KM_PER_DAY <= 40;
  const calicutMay = measurements.find((row) => row.id === "calicut-aden" && row.grid === "target")?.actualDays ?? 0;
  const calicutOctober = measurements.find((row) => row.id === "calicut-aden-monsoon" && row.grid === "target")?.actualDays ?? 0;
  return [
    { id: "freight-ratio", actual: freight, expected: [1, 5, 28], status: freight.join(":") === "1:5:28" ? "pass" : "fail" },
    { id: "foot-day", actual: TRAVEL_FOOT_KM_PER_DAY, expected: "20..30 km/day", status: footPass ? "pass" : "fail" },
    { id: "ride-day", actual: TRAVEL_PACK_KM_PER_DAY, expected: "30..40 km/day", status: packPass ? "pass" : "fail" },
    { id: "monsoon-asymmetry", actual: [calicutMay, calicutOctober], expected: "seasonally distinct", status: Math.abs(calicutMay - calicutOctober) > 0.01 ? "pass" : "fail" },
  ];
}

async function main(): Promise<void> {
  const stamps = {
    dev: provenance(new World({ seed: M0_DEFAULT_SEED, grid: "dev", config: { preset: "earth_sim" } })),
    target: provenance(new World({ seed: M0_DEFAULT_SEED, grid: "target", config: { preset: "earth_sim" } })),
  };
  const dev = await measureGrid("dev");
  const target = await measureGrid("target");
  const crossGrid = checkCrossGrid([...dev, ...target]);
  const measurements = crossGrid.measurements;
  const checks = nonRouteChecks(measurements);
  const failed = measurements.filter((row) => row.status === "fail").length
    + crossGrid.checks.filter((row) => row.status === "fail").length
    + checks.filter((row) => row.status === "fail").length;
  console.log(JSON.stringify({
    gate: failed === 0 ? "pass" : "fail",
    provenance: { seed: M0_DEFAULT_SEED, grids: ["dev", "target"], routeCount: routes.length, stamps },
    checks,
    crossGrid: crossGrid.checks,
    routes: measurements,
  }));
  assert.equal(failed, 0, `${failed} travel gate checks failed`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
