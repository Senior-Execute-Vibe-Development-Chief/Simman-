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
  readonly check: "route" | "crossGrid" | "check" | "river" | "lake" | "floodplain" | "season";
  readonly id: string;
  readonly grid?: GridPreset;
  readonly reason: string;
}

// River-network anchors (QUESTIONS.md #21): factual, measured assertions on
// the baked real river geometry — continuity to the sea, confluences, bends,
// and channel distinctness at named real coordinates.
interface RiverFixture {
  readonly id: string;
  readonly type: "reaches" | "joins" | "distinct";
  readonly from?: { readonly lat: number; readonly lon: number };
  readonly with?: { readonly lat: number; readonly lon: number };
  readonly mouth?: { readonly latMin: number; readonly latMax: number; readonly lonMin: number; readonly lonMax: number };
  readonly minPathLat?: number;
  readonly lat?: number;
  readonly lonMin?: number;
  readonly lonMax?: number;
  readonly minChannels?: number;
  readonly minMagnitude?: number;
  readonly grids?: readonly GridPreset[];
  readonly source: string;
}

interface RiverMeasurement {
  readonly id: string;
  readonly grid: GridPreset;
  readonly status: "pass" | "fail";
  readonly detail: string;
}

interface LakeFixture {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly minActiveCells: number;
  readonly minGeometryCells: number;
  readonly source: string;
}

interface LakeRealityFixture {
  readonly anchors: readonly LakeFixture[];
  readonly totalGeometryAreaKm2: number;
  readonly totalAreaTolerance: number;
  readonly source: string;
}

interface FloodplainFixture {
  readonly id: string;
  readonly latMin: number;
  readonly latMax: number;
  readonly lonMin: number;
  readonly lonMax: number;
  readonly highFraction: number;
  readonly maxWidthCells?: number;
  readonly minWidthCells?: number;
  readonly source: string;
}

interface FloodplainRealityFixture {
  readonly corridors: readonly FloodplainFixture[];
  readonly globalShareMin: number;
  readonly globalShareMax: number;
  readonly source: string;
}

interface RiverSeasonFixture {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly expectedMaxMonth?: number;
  readonly maxMonthTolerance?: number;
  readonly maxMinRatioMax?: number;
  readonly source: string;
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
const riverFixtures = JSON.parse(
  readFileSync(new URL("../data/reality/river-network.json", import.meta.url), "utf8"),
) as readonly RiverFixture[];
const lakeFixture = JSON.parse(
  readFileSync(new URL("../data/reality/lakes.json", import.meta.url), "utf8"),
) as LakeRealityFixture;
const floodplainFixture = JSON.parse(
  readFileSync(new URL("../data/reality/floodplain.json", import.meta.url), "utf8"),
) as FloodplainRealityFixture;
const riverSeasonFixtures = JSON.parse(
  readFileSync(new URL("../data/reality/river-seasons.json", import.meta.url), "utf8"),
) as readonly RiverSeasonFixture[];

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

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];

function riverCellLatLon(substrate: Substrate, cell: number): { lat: number; lon: number } {
  const y = Math.floor(cell / substrate.width);
  const x = cell - y * substrate.width;
  return {
    lat: 90 - ((y + 0.5) / substrate.height) * 180,
    lon: ((x + 0.5) / substrate.width) * 360 - 180,
  };
}

/** Nearest channel cell (magnitude ≥ minMag) to a real coordinate, spiral search. */
function channelNear(substrate: Substrate, lat: number, lon: number, minMag = 2): number {
  const { width, height } = substrate;
  const cx = ((Math.round(((lon + 180) / 360) * width) % width) + width) % width;
  const cy = Math.max(0, Math.min(height - 1, Math.round(((90 - lat) / 180) * height)));
  const maxRadius = Math.max(3, Math.round((2.5 / 360) * width));
  let best = -1;
  let bestD = Infinity;
  for (let dy = -maxRadius; dy <= maxRadius; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      const cell = y * width + (((cx + dx) % width) + width) % width;
      if ((substrate.rivers.magnitude[cell] ?? 0) >= minMag) {
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = cell; }
      }
    }
  }
  return best;
}

/** Walk flowDir downstream to the first water cell (or a stall). */
function traceDownstream(substrate: Substrate, start: number): {
  readonly path: readonly number[];
  readonly maxLat: number;
  readonly waterCell: number;
} {
  const { width, height } = substrate;
  const path = [start];
  let maxLat = riverCellLatLon(substrate, start).lat;
  let cell = start;
  for (let step = 0; step < 4000; step++) {
    const d = substrate.rivers.direction[cell];
    if (d === undefined || d > 7) return { path, maxLat, waterCell: -1 };
    const y = Math.floor(cell / width);
    const ny = y + (D8_DY[d] ?? 0);
    if (ny < 0 || ny >= height) return { path, maxLat, waterCell: -1 };
    cell = ny * width + (((cell - y * width + (D8_DX[d] ?? 0)) % width) + width) % width;
    path.push(cell);
    const lat = riverCellLatLon(substrate, cell).lat;
    if (lat > maxLat) maxLat = lat;
    if (!substrate.landMask[cell]) return { path, maxLat, waterCell: cell };
  }
  return { path, maxLat, waterCell: -1 };
}

function riverChecks(grid: GridPreset): readonly RiverMeasurement[] {
  const substrate = gateSubstrate(grid);
  const rows: RiverMeasurement[] = [];
  for (const fixture of riverFixtures) {
    if (fixture.grids && !fixture.grids.includes(grid)) continue;
    let status: "pass" | "fail" = "fail";
    let detail = "";
    if (fixture.type === "distinct") {
      const y = Math.max(0, Math.min(substrate.height - 1,
        Math.round(((90 - (fixture.lat ?? 0)) / 180) * substrate.height)));
      const x1 = Math.floor((((fixture.lonMin ?? 0) + 180) / 360) * substrate.width);
      const x2 = Math.ceil((((fixture.lonMax ?? 0) + 180) / 360) * substrate.width);
      // Any non-channel cell between two channel runs separates them: the
      // Tigris and Euphrates pass within ~40 km (2 cells) at Baghdad.
      let channels = 0;
      let gap = 1;
      for (let x = x1; x <= x2; x++) {
        const isChannel = (substrate.rivers.magnitude[y * substrate.width + x] ?? 0) >= (fixture.minMagnitude ?? 2);
        if (isChannel && gap >= 1) channels++;
        gap = isChannel ? 0 : gap + 1;
      }
      status = channels >= (fixture.minChannels ?? 2) ? "pass" : "fail";
      detail = `${channels} distinct channel(s) crossing ${fixture.lat}N between ${fixture.lonMin}..${fixture.lonMax}E`;
    } else if (fixture.type === "reaches") {
      const start = channelNear(substrate, fixture.from?.lat ?? 0, fixture.from?.lon ?? 0);
      if (start < 0) {
        detail = "no channel near the source coordinate";
      } else {
        const trace = traceDownstream(substrate, start);
        if (trace.waterCell < 0) {
          const end = riverCellLatLon(substrate, trace.path[trace.path.length - 1] ?? start);
          detail = `stalls on land at ${end.lat.toFixed(1)},${end.lon.toFixed(1)} after ${trace.path.length} cells`;
        } else {
          const mouth = riverCellLatLon(substrate, trace.waterCell);
          const box = fixture.mouth;
          const inBox = !!box && mouth.lat >= box.latMin && mouth.lat <= box.latMax
            && mouth.lon >= box.lonMin && mouth.lon <= box.lonMax;
          const bendOk = fixture.minPathLat === undefined || trace.maxLat >= fixture.minPathLat;
          status = inBox && bendOk ? "pass" : "fail";
          detail = `mouth at ${mouth.lat.toFixed(1)},${mouth.lon.toFixed(1)} after ${trace.path.length} cells`
            + (fixture.minPathLat !== undefined ? `; northernmost point ${trace.maxLat.toFixed(1)}N` : "");
        }
      }
    } else {
      const a = channelNear(substrate, fixture.from?.lat ?? 0, fixture.from?.lon ?? 0);
      const b = channelNear(substrate, fixture.with?.lat ?? 0, fixture.with?.lon ?? 0);
      if (a < 0 || b < 0) {
        detail = "no channel near a source coordinate";
      } else {
        const pathA = new Set(traceDownstream(substrate, a).path);
        const traceB = traceDownstream(substrate, b);
        const met = traceB.path.find((cell) => pathA.has(cell) && substrate.landMask[cell]);
        if (met !== undefined) {
          const at = riverCellLatLon(substrate, met);
          status = "pass";
          detail = `confluence at ${at.lat.toFixed(1)},${at.lon.toFixed(1)}`;
        } else {
          detail = "paths never meet on land";
        }
      }
    }
    rows.push({ id: fixture.id, grid, status, detail });
  }
  return rows;
}

interface WaterMeasurement {
  readonly id: string;
  readonly grid: GridPreset;
  readonly status: "pass" | "fail";
  readonly detail: string;
}

function cellsInBox(
  substrate: Substrate,
  box: { readonly latMin: number; readonly latMax: number; readonly lonMin: number; readonly lonMax: number },
): number[] {
  const cells: number[] = [];
  for (let y = 0; y < substrate.height; y++) {
    const lat = riverCellLatLon(substrate, y * substrate.width).lat;
    if (lat < box.latMin || lat > box.latMax) continue;
    for (let x = 0; x < substrate.width; x++) {
      const cell = y * substrate.width + x;
      const lon = riverCellLatLon(substrate, cell).lon;
      if (lon >= box.lonMin && lon <= box.lonMax) cells.push(cell);
    }
  }
  return cells;
}

function lakeChecks(grid: GridPreset): readonly WaterMeasurement[] {
  if (grid !== "target") return [];
  const substrate = gateSubstrate(grid);
  const rows: WaterMeasurement[] = [];
  for (const anchor of lakeFixture.anchors) {
    const box = {
      latMin: anchor.lat - 2,
      latMax: anchor.lat + 2,
      lonMin: anchor.lon - 3,
      lonMax: anchor.lon + 3,
    };
    const cells = cellsInBox(substrate, box);
    const active = cells.filter((cell) => substrate.rivers.lake[cell] >= 0).length;
    const geometry = cells.filter((cell) => (substrate.rivers.lakeGeometry?.[cell] ?? 0) !== 0).length;
    const status = active >= anchor.minActiveCells && geometry >= anchor.minGeometryCells ? "pass" : "fail";
    rows.push({
      id: anchor.id,
      grid,
      status,
      detail: `${active} active lake cells, ${geometry} geometry cells near ${anchor.lat},${anchor.lon}`,
    });
  }
  const rowsArea = substrate.height;
  const northSouthKm = EARTH_MERIDIONAL_KM / substrate.height;
  const eastWest = rowEastWestKm(substrate);
  let actualArea = 0;
  for (let y = 0; y < rowsArea; y++) {
    const area = northSouthKm * (eastWest[y] ?? 0);
    for (let x = 0; x < substrate.width; x++) {
      if ((substrate.rivers.lakeGeometry?.[y * substrate.width + x] ?? 0) !== 0) actualArea += area;
    }
  }
  const relativeError = Math.abs(actualArea - lakeFixture.totalGeometryAreaKm2)
    / Math.max(lakeFixture.totalGeometryAreaKm2, CONSERVATION_EPSILON);
  rows.push({
    id: "lake-total-area",
    grid,
    status: relativeError <= lakeFixture.totalAreaTolerance ? "pass" : "fail",
    detail: `${actualArea.toFixed(0)} km² raster area vs ${lakeFixture.totalGeometryAreaKm2} km² source baseline`,
  });
  return rows;
}

function floodplainChecks(grid: GridPreset): readonly WaterMeasurement[] {
  if (grid !== "target") return [];
  const substrate = gateSubstrate(grid);
  const rows: WaterMeasurement[] = [];
  for (const corridor of floodplainFixture.corridors) {
    const cells = cellsInBox(substrate, corridor);
    let highCells = 0;
    let maxWidth = 0;
    for (let y = 0; y < substrate.height; y++) {
      let width = 0;
      for (const cell of cells) {
        if (Math.floor(cell / substrate.width) !== y) continue;
        if ((substrate.floodplain[cell] ?? 0) >= corridor.highFraction) {
          highCells++;
          width++;
        } else {
          maxWidth = Math.max(maxWidth, width);
          width = 0;
        }
      }
      maxWidth = Math.max(maxWidth, width);
    }
    const widthOk = (corridor.maxWidthCells === undefined || maxWidth <= corridor.maxWidthCells)
      && (corridor.minWidthCells === undefined || maxWidth >= corridor.minWidthCells);
    const status = highCells > 0 && widthOk ? "pass" : "fail";
    rows.push({
      id: corridor.id,
      grid,
      status,
      detail: `${highCells} high-f cells; maximum corridor width ${maxWidth} cells`,
    });
  }
  const northSouthKm = EARTH_MERIDIONAL_KM / substrate.height;
  const eastWest = rowEastWestKm(substrate);
  let weightedFlood = 0;
  let landArea = 0;
  for (let y = 0; y < substrate.height; y++) {
    const area = northSouthKm * (eastWest[y] ?? 0);
    for (let x = 0; x < substrate.width; x++) {
      const cell = y * substrate.width + x;
      if (!substrate.landMask[cell]) continue;
      landArea += area;
      weightedFlood += (substrate.floodplain[cell] ?? 0) * area;
    }
  }
  const share = landArea > 0 ? weightedFlood / landArea : 0;
  rows.push({
    id: "floodplain-global-share",
    grid,
    status: share >= floodplainFixture.globalShareMin && share <= floodplainFixture.globalShareMax
      ? "pass" : "fail",
    detail: `${(share * 100).toFixed(2)}% of land by area`,
  });
  return rows;
}

function monthDistance(actual: number, expected: number): number {
  const distance = Math.abs(actual - expected);
  return Math.min(distance, MONTHS_PER_YEAR - distance);
}

function riverSeasonChecks(grid: GridPreset): readonly WaterMeasurement[] {
  if (grid !== "target") return [];
  const substrate = gateSubstrate(grid);
  const rows: WaterMeasurement[] = [];
  for (const fixture of riverSeasonFixtures) {
    const cell = channelNear(substrate, fixture.lat, fixture.lon);
    if (cell < 0 || !substrate.rivers.seasonalFlowScale) {
      rows.push({ id: fixture.id, grid, status: "fail", detail: "no seasonal navigable channel near anchor" });
      continue;
    }
    const values = Array.from({ length: MONTHS_PER_YEAR }, (_, month) =>
      (substrate.rivers.flowAccum[cell] ?? 0)
      * (substrate.rivers.seasonalFlowScale?.[cell * MONTHS_PER_YEAR + month] ?? 0));
    let maxMonth = 0;
    for (let month = 1; month < values.length; month++) {
      if ((values[month] ?? 0) > (values[maxMonth] ?? 0)) maxMonth = month;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const ratio = min > 0 ? max / min : Number.POSITIVE_INFINITY;
    const peakOk = fixture.expectedMaxMonth === undefined
      || monthDistance(maxMonth, fixture.expectedMaxMonth) <= (fixture.maxMonthTolerance ?? 2);
    const ratioOk = fixture.maxMinRatioMax === undefined || ratio <= fixture.maxMinRatioMax;
    rows.push({
      id: fixture.id,
      grid,
      status: peakOk && ratioOk ? "pass" : "fail",
      detail: `peak month ${maxMonth + 1}, max/min ${ratio.toFixed(2)}`,
    });
  }
  return rows;
}

// Tools may cache the substrate per (seed, preset, grid) within a process
// (M2 handoff ruling 11) — the route arm and the river arm share one build.
const substrateCache = new Map<GridPreset, Substrate>();
function gateSubstrate(grid: GridPreset): Substrate {
  let substrate = substrateCache.get(grid);
  if (!substrate) {
    substrate = buildSubstrate(M0_DEFAULT_SEED, { preset: "earth_sim" }, grid);
    substrateCache.set(grid, substrate);
  }
  return substrate;
}

async function measureGrid(grid: GridPreset): Promise<readonly RouteMeasurement[]> {
  const substrate = gateSubstrate(grid);
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
    straitWidthKm: new Float32Array(N),
    landFraction: new Float32Array(N).fill(1),
    elevation,
    landMask,
    climate: { temperature, moisture },
    wind: { u: new Float32Array(N * MONTHS_PER_YEAR), v: new Float32Array(N * MONTHS_PER_YEAR) },
    temperature,
    moisture,
    rivers: { magnitude, direction, flowAccum: new Float32Array(N), runoff: new Float32Array(N), lake },
    ancestry: {
      lineage: new Int16Array(N),
      arrival: new Float32Array(N),
      count: 1,
      hue: new Float32Array(1),
      light: new Float32Array(1),
      originFx: 0,
      originFy: 0,
    },
    floodplain: new Float32Array(N),
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
  const sea = measure(REF_SEA_ROW, "open-sea", ["boats", "navigation"]);
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
  const rivers = [...riverChecks("dev"), ...riverChecks("target")];
  const lakes = lakeChecks("target");
  const floodplain = floodplainChecks("target");
  const seasons = riverSeasonChecks("target");

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
  for (const row of rivers) {
    if (row.status === "fail") failureKeys.add(missKey("river", row.id, row.grid));
  }
  for (const row of lakes) {
    if (row.status === "fail") failureKeys.add(missKey("lake", row.id, row.grid));
  }
  for (const row of floodplain) {
    if (row.status === "fail") failureKeys.add(missKey("floodplain", row.id, row.grid));
  }
  for (const row of seasons) {
    if (row.status === "fail") failureKeys.add(missKey("season", row.id, row.grid));
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
    rivers,
    lakes,
    floodplain,
    seasons,
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
