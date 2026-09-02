import {
  M0_DEFAULT_SEED,
  MONTHS_PER_YEAR,
  TRAVEL_RIVER_MIN_MAGNITUDE,
  RIVER_FREEZING_TEMPERATURE,
  TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM,
  TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM,
} from "../sim/constants";
import { buildSubstrate, type Substrate } from "../sim/substrate";
import { createTravelEngine, type TravelRoute } from "../sim/travel/engine";
import { riverReachGradient, type Capability, type TravelMetric } from "../sim/travel/cost";
import type { GridPreset } from "../sim/world";
import {
  buildProjectionTable,
  globeOutline,
  graticule,
  degreesToRadians,
  PROJECTIONS,
  type ProjectionName,
  type ProjectionTable,
} from "./projection";

// ?grid=target serves the full 1800×900 map (the shipped grid — expect a
// ~minute of substrate building on load); the default dev grid loads in
// seconds. Same physics, same seed, different resolution.
const GRID: GridPreset = new URLSearchParams(window.location.search).get("grid") === "target"
  ? "target"
  : "dev";
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const lens = document.querySelector<HTMLSelectElement>("#lens")!;
const month = document.querySelector<HTMLInputElement>("#month")!;
const monthLabel = document.querySelector<HTMLElement>("#month-label")!;
const zoomInput = document.querySelector<HTMLInputElement>("#zoom")!;
const zoomLabel = document.querySelector<HTMLElement>("#zoom-label")!;
const status = document.querySelector<HTMLElement>("#status")!;
const route = document.querySelector<HTMLElement>("#route")!;
const population = document.querySelector<HTMLElement>("#population")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;
const speedInput = document.querySelector<HTMLInputElement>("#speed")!;
const speedLabel = document.querySelector<HTMLElement>("#speed-label")!;
const projectionSelect = document.querySelector<HTMLSelectElement>("#projection")!;
const centreLabel = document.querySelector<HTMLElement>("#centre-label")!;
if (!canvas || !lens || !month || !monthLabel || !zoomInput || !zoomLabel || !status || !route
  || !population || !runButton || !speedInput || !speedLabel || !projectionSelect || !centreLabel) {
  throw new Error("M2 shell markup is incomplete.");
}

const context = canvas.getContext("2d")!;
if (!context) throw new Error("Canvas is unavailable.");

const substrate = buildSubstrate(M0_DEFAULT_SEED, { preset: "earth_sim" }, GRID);
const travel = await createTravelEngine(substrate);
// Colours are computed per SIM cell into `frame` (grid-sized), then sampled
// through the projection table into `projected` (map-sized); CSS scales the
// display. The projection is display only — the sim grid is lat-lon.
const frame = new ImageData(substrate.width, substrate.height);
const base = document.createElement("canvas");
const baseContext = base.getContext("2d")!;
let baseKey = "";
let lastFrameKey = "";
const OFF_GLOBE: readonly [number, number, number] = [12, 18, 24];
let table: ProjectionTable;
let projected: ImageData | undefined;
let outline: Array<[number, number]> = [];
let graticuleLines: Array<Array<[number, number]>> = [];
// Central meridian in degrees east. Dragging at zoom 1 spins the world about
// its polar axis so the studied region sits where shapes are near-true. The
// table is built once per projection; the centre is a column shift applied
// while sampling, so the spin is instant at any grid.
let centreDegrees = 0;

/** The central meridian in radians, snapped to the whole-cell shift the table uses. */
function centralMeridian(): number {
  const shift = table.shiftFor(degreesToRadians(centreDegrees));
  return (shift / substrate.width) * 2 * Math.PI;
}

function formatCentre(): string {
  const degrees = (centralMeridian() / Math.PI) * 180;
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return `Centre ${Math.abs(Math.round(wrapped))}°${wrapped < 0 ? "W" : "E"}`;
}

function applyCentre(): void {
  const centre = centralMeridian();
  outline = globeOutline(table, centre);
  graticuleLines = graticule(table, centre);
  centreLabel.textContent = formatCentre();
}

function applyProjection(name: ProjectionName): void {
  table = buildProjectionTable(PROJECTIONS[name], substrate.width, substrate.height);
  if (!projected || projected.width !== table.width || projected.height !== table.height) {
    projected = new ImageData(table.width, table.height);
    canvas.width = table.width;
    canvas.height = table.height;
    canvas.style.aspectRatio = `${table.width} / ${table.height}`;
    base.width = table.width;
    base.height = table.height;
  }
  applyCentre();
  baseKey = "";
}
applyProjection(projectionSelect.value as ProjectionName);

const worker = new Worker(new URL("../sim/worker.ts", import.meta.url), { type: "module" });
worker.postMessage({ type: "create", seed: M0_DEFAULT_SEED, grid: GRID, substrate });
let playing = true;
let speed = 1;
let overlayPopulation: Float32Array | undefined;
let overlayTechnique: Float32Array | undefined;
function displayDate(step: number): string {
  const year = -9700 + step / MONTHS_PER_YEAR;
  return year < 0 ? `${Math.round(-year)} BCE` : `${Math.round(year)} CE`;
}
worker.addEventListener("message", (event) => {
  if (event.data?.type === "created") {
    const isolated = event.data.isolated === true;
    const threaded = event.data.usesThreads === true;
    const kernel = event.data.kernel !== "wasm"
      ? "TypeScript people fallback"
      : threaded
        ? `WASM ${event.data.workerCount} threads`
        : isolated
          ? "serial WASM"
          : "serial WASM · host is not cross-origin isolated";
    const schedule = typeof event.data.scheduleLabel === "string" ? ` · ${event.data.scheduleLabel}` : "";
    status.textContent = `Worker ready · ${kernel}${schedule} · ${event.data.hash}`;
  }
  if (event.data?.type === "snapshot" && event.data.buffer instanceof ArrayBuffer) {
    tickPending = false;
    const buffer = event.data.buffer as ArrayBuffer;
    const count = Number(event.data.cells ?? substrate.N);
    const populationView = new Float32Array(buffer, 8, count);
    const techniqueView = new Float32Array(buffer, 8 + count * 4, count);
    overlayPopulation = new Float32Array(count);
    overlayTechnique = new Float32Array(count);
    overlayPopulation.set(populationView);
    overlayTechnique.set(techniqueView);
    population.textContent = `Population: ${Math.round(Number(event.data.population ?? 0)).toLocaleString()} persons · ${displayDate(Number(event.data.step ?? 0))}`;
    baseKey = "";
    lastFrameKey = "";
    draw();
    worker.postMessage({ type: "recycle", buffer }, [buffer]);
  }
});
// Backpressure: post the next tick batch only after the previous snapshot
// returns. A fixed-interval post outran the worker on the target grid
// (~0.5 s/tick) and queued unboundedly — the page read as frozen.
let tickPending = false;
function requestTicks(): void {
  if (!playing || tickPending) return;
  tickPending = true;
  worker.postMessage({ type: "tick", steps: speed });
}
window.setInterval(requestTicks, 250);

month.max = String(MONTHS_PER_YEAR - 1);
month.value = "0";
let startCell: number | undefined;
let lastRoute: TravelRoute | undefined;

// One color per travel mode, in engine mode-index order.
const MODE_NAMES = ["foot", "pack", "cart", "river", "coastal", "open-sea"] as const;
const MODE_COLORS = ["#ffd166", "#f4a259", "#e07a5f", "#5fd0c5", "#6ab6ff", "#3d7dff"] as const;

// Viewport: wheel or pinch to zoom (anchored), drag to pan, tap to route,
// and the zoom slider for one-handed control. The slider is log-scaled
// (value = log2(zoom)).
let zoom = 1;
let viewX = 0;
let viewY = 0;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

// The viewport lives in projected-map pixels (table.width × table.height).
// Horizontal movement is ALWAYS a spin of the central meridian (owner: "the
// pan should always recenter the map"), so the viewport stays horizontally
// centred at every zoom; only the vertical offset pans.
function clampView(): void {
  zoom = clamp(zoom, 1, 64);
  viewX = (table.width - table.width / zoom) / 2;
  viewY = clamp(viewY, 0, table.height - table.height / zoom);
}

/** Absolute longitude/latitude under a canvas fraction, or undefined off the globe. */
function lonLatAtScreen(fx: number, fy: number): [number, number] | undefined {
  return table.pixelToLonLat(viewX + fx * table.width / zoom, viewY + fy * table.height / zoom, centralMeridian());
}

/** Spin so that the longitude `lon` sits under canvas fraction (fx, fy). */
function spinLongitudeTo(lon: number, fx: number, fy: number): void {
  const after = lonLatAtScreen(fx, fy);
  if (!after) return;
  const delta = lon - after[0];
  centreDegrees += (Math.atan2(Math.sin(delta), Math.cos(delta)) / Math.PI) * 180;
  applyCentre();
}

/** Set zoom keeping the map point under (fx, fy) — canvas fractions — fixed. */
function setZoom(next: number, fx = 0.5, fy = 0.5): void {
  const before = lonLatAtScreen(fx, fy);
  const anchorY = viewY + fy * table.height / zoom;
  zoom = clamp(next, 1, 64);
  viewY = anchorY - fy * table.height / zoom;
  clampView();
  if (before) spinLongitudeTo(before[0], fx, fy);
  zoomInput.value = String(Math.log2(zoom));
  zoomLabel.textContent = `Zoom ${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`;
  draw();
}

function terrainColor(cell: number, moisture: number, _y: number): [number, number, number] {
  const elevation = substrate.elevation[cell];
  if ((substrate.rivers.lake?.[cell] ?? -1) >= 0) return [55, 135, 165];
  const river = substrate.rivers.magnitude[cell];
  const green = clamp(85 + moisture * 100 - elevation * 40, 0, 210);
  const brown = clamp(135 - elevation * 90, 40, 170);
  // Per-cell hash dither, not a row stripe: the old (y % 3) blue banding read
  // as horizontal scanlines at zoom (owner play-report).
  const dither = ((cell * 2654435761) >>> 28) & 3;
  return river >= 2 ? [45, 125, 155] : [brown, green, 62 + dither * 5];
}

function pixelColor(cell: number, selectedMonth: number): [number, number, number] {
  const y = Math.floor(cell / substrate.width);
  const climateIndex = cell * MONTHS_PER_YEAR + selectedMonth;
  const temperature = substrate.temperature[climateIndex];
  const moisture = substrate.moisture[climateIndex];
  if (lens.value === "wind") {
    // Muted geography so the arrow glyphs carry the signal over land and sea alike.
    if (!substrate.landMask[cell]) return [16, 34, 54];
    const [red, green, blue] = terrainColor(cell, moisture, y);
    return [Math.round(red * 0.45), Math.round(green * 0.45), Math.round(blue * 0.45)];
  }
  if (lens.value === "rivers") {
    // River passability: the reach gradient (m of fall per km over the 100 km
    // reach) that the router compares against its two bars. Green = sailable
    // both ways, orange = downstream only, red = cataract/falls (blocked),
    // grey = channel too small to navigate; everything else muted terrain.
    if (!substrate.landMask[cell]) return [16, 34, 54];
    const magnitude = substrate.rivers.magnitude[cell] ?? 0;
    // Ice: below freshwater freezing this month the leg is CLOSED (the router
    // refuses it) — show it as ice, not as an open channel (owner play-report:
    // northern lakes read as "not water" in January with no visible cause).
    const frozen = temperature < RIVER_FREEZING_TEMPERATURE;
    if ((substrate.rivers.lake?.[cell] ?? -1) >= 0) {
      return frozen ? [205, 225, 235] : [80, 200, 200];
    }
    if (magnitude >= 1) {
      if (frozen && magnitude >= TRAVEL_RIVER_MIN_MAGNITUDE) return [205, 225, 235];
      if (magnitude < TRAVEL_RIVER_MIN_MAGNITUDE) return [120, 125, 135];
      const flowScale = substrate.rivers.seasonalFlowScale?.[
        climateIndex
      ] ?? 1;
      const threshold = substrate.rivers.navigableThreshold ?? 0;
      if (threshold > 0 && (substrate.rivers.flowAccum[cell] ?? 0) * flowScale < threshold) {
        return [120, 125, 135];
      }
      const gradient = riverReachGradient(substrate)[cell] ?? 0;
      if (gradient > TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM) return [235, 60, 50];
      if (gradient > TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM) return [240, 170, 40];
      return [70, 225, 90];
    }
    const [red, green, blue] = terrainColor(cell, moisture, y);
    return [Math.round(red * 0.35), Math.round(green * 0.35), Math.round(blue * 0.35)];
  }
  if (!substrate.landMask[cell]) return [25, 55, 86];
  if (lens.value === "population") {
    // Log ramp over the historically meaningful density span, 0.01..100
    // persons/km2 (sparse foragers .. dense farmed valleys). EMPTY land is
    // dark - the old ramp's zero point was bright green, so an unpeopled
    // Antarctica read exactly like a peopled steppe (owner play-report).
    const density = overlayPopulation?.[cell] ?? 0;
    if (density <= 0) return [28, 34, 40];
    const intensity = Math.min(1, Math.max(0, (Math.log10(density) + 2) / 4));
    return [
      Math.round(40 + 215 * Math.min(1, intensity * 1.6)),
      Math.round(60 + 170 * intensity - (intensity > 0.75 ? 340 * (intensity - 0.75) : 0)),
      Math.round(90 - 60 * intensity),
    ];
  }
  if (lens.value === "technique") {
    const value = Math.max(0, Math.min(1, overlayTechnique?.[cell] ?? 0));
    return [Math.round(45 + 190 * value), Math.round(70 + 140 * value), Math.round(105 - 70 * value)];
  }
  if (lens.value === "climate") {
    return [Math.round(210 * temperature + 25), Math.round(180 * moisture + 30), Math.round(210 * (1 - temperature) + 25)];
  }
  if (lens.value === "fertility" || lens.value === "crops") {
    const value = lens.value === "fertility"
      ? substrate.fertility[cell]
      : substrate.wildCropSuitability[cell];
    const v = clamp(value, 0, 1);
    return [Math.round(60 + 40 * v), Math.round(45 + 175 * v), Math.round(40 + 25 * (1 - v))];
  }
  return terrainColor(cell, moisture, y);
}

function renderBase(selectedMonth: number): void {
  const shift = table.shiftFor(degreesToRadians(centreDegrees));
  const frameKey = `${lens.value}|${selectedMonth}`;
  const key = `${table.projection.name}|${shift}|${frameKey}`;
  if (key === baseKey) return;
  const pixels = frame.data;
  // Per-cell colours depend on lens and month only; projection and centre
  // are applied by sampling, so a spin never recomputes a colour.
  if (frameKey !== lastFrameKey) for (let cell = 0; cell < substrate.N; cell++) {
    const [red, green, blue] = pixelColor(cell, selectedMonth);
    const offset = cell * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  lastFrameKey = frameKey;
  if (!projected) return;
  const out = projected.data;
  const { rowOf, columnOf, width, gridWidth } = table;
  for (let py = 0, pixel = 0; py < table.height; py++) {
    const row = rowOf[py] ?? -1;
    for (let px = 0; px < width; px++, pixel++) {
    const column = row < 0 ? -1 : (columnOf[pixel] ?? -1);
    let x = column + shift;
    if (x >= gridWidth) x -= gridWidth;
    const cell = column < 0 ? -1 : row * gridWidth + x;
    const offset = pixel * 4;
    if (cell < 0) {
      out[offset] = OFF_GLOBE[0];
      out[offset + 1] = OFF_GLOBE[1];
      out[offset + 2] = OFF_GLOBE[2];
    } else {
      const source = cell * 4;
      out[offset] = pixels[source] ?? 0;
      out[offset + 1] = pixels[source + 1] ?? 0;
      out[offset + 2] = pixels[source + 2] ?? 0;
    }
    out[offset + 3] = 255;
    }
  }
  baseContext.putImageData(projected, 0, 0);
  baseKey = key;
}

/** Sim-grid cell coordinates → canvas pixels, through the projection and viewport. */
function toScreenXY(x: number, y: number): [number, number] {
  const [px, py] = table.gridToPixel(x + 0.5, y + 0.5, centralMeridian());
  return [(px - viewX) * zoom, (py - viewY) * zoom];
}

/** The seam meridian at a sim row, on the east (+1) or west (−1) map edge, in canvas pixels. */
function seamScreenXY(y: number, side: 1 | -1): [number, number] {
  const lat = Math.PI / 2 - ((y + 0.5) / substrate.height) * Math.PI;
  const centre = centralMeridian();
  const [px, py] = table.lonLatToPixel(centre + side * (Math.PI - 1e-9), lat, centre);
  return [(px - viewX) * zoom, (py - viewY) * zoom];
}

function mapToScreen(point: readonly [number, number]): [number, number] {
  return [(point[0] - viewX) * zoom, (point[1] - viewY) * zoom];
}

function strokePolyline(points: ReadonlyArray<readonly [number, number]>): void {
  context.beginPath();
  points.forEach((point, index) => {
    const [sx, sy] = mapToScreen(point);
    if (index === 0) context.moveTo(sx, sy);
    else context.lineTo(sx, sy);
  });
  context.stroke();
}

function drawGraticule(): void {
  context.lineWidth = Math.max(0.5, table.width / 1800);
  context.strokeStyle = "rgba(200, 215, 230, 0.16)";
  for (const line of graticuleLines) strokePolyline(line);
  context.strokeStyle = "rgba(200, 215, 230, 0.55)";
  context.lineWidth = Math.max(1, table.width / 900);
  strokePolyline([...outline, outline[0] ?? [0, 0]]);
}

// Wind glyphs: one downwind arrow per block of visible cells, decimated to a
// steady on-screen density; length and colour ramp with speed (cool → warm,
// saturating at WIND_ARROW_FULL_MS). v is northward; screen y grows south.
const WIND_ARROW_SPACING_DISPLAY_PX = 26;
const WIND_ARROW_FULL_MS = 10;

function drawWindArrows(selectedMonth: number): void {
  const bounds = canvas.getBoundingClientRect();
  const displayScale = bounds.width > 0 ? bounds.width / canvas.width : 1;
  const stride = Math.max(1, Math.round(WIND_ARROW_SPACING_DISPLAY_PX / (zoom * displayScale)));
  context.lineCap = "round";
  context.lineWidth = Math.max(0.5, 1.4 / displayScale);
  // Walk the sim grid at the stride and let the projection place each glyph;
  // off-canvas glyphs are skipped (the viewport is in projected pixels).
  const margin = stride * zoom;
  for (let y = 0; y < substrate.height; y += stride) {
    for (let x = 0; x < substrate.width; x += stride) {
      const [sx, sy] = toScreenXY(x, y);
      if (sx < -margin || sy < -margin || sx > canvas.width + margin || sy > canvas.height + margin) continue;
      const cell = y * substrate.width + x;
      const index = cell * MONTHS_PER_YEAR + selectedMonth;
      const u = substrate.wind.u[index] ?? 0;
      const v = substrate.wind.v[index] ?? 0;
      const speed = Math.hypot(u, v);
      if (speed < 0.05) continue;
      const warm = Math.min(1, speed / WIND_ARROW_FULL_MS);
      const glyph = stride * zoom * (0.25 + 0.6 * warm);
      const dx = (u / speed) * glyph;
      const dy = (-v / speed) * glyph;
      const headX = sx + dx / 2;
      const headY = sy + dy / 2;
      const head = glyph * 0.3;
      const angle = Math.atan2(dy, dx);
      context.strokeStyle = `rgba(${Math.round(140 + 115 * warm)}, ${Math.round(190 + 40 * warm)}, ${Math.round(255 - 150 * warm)}, 0.9)`;
      context.beginPath();
      context.moveTo(sx - dx / 2, sy - dy / 2);
      context.lineTo(headX, headY);
      context.moveTo(headX, headY);
      context.lineTo(headX - head * Math.cos(angle - 0.5), headY - head * Math.sin(angle - 0.5));
      context.moveTo(headX, headY);
      context.lineTo(headX - head * Math.cos(angle + 0.5), headY - head * Math.sin(angle + 0.5));
      context.stroke();
    }
  }
}

function draw(): void {
  const selectedMonth = Number(month.value);
  monthLabel.textContent = `Month ${selectedMonth + 1}`;
  renderBase(selectedMonth);
  clampView();
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    base,
    viewX, viewY, table.width / zoom, table.height / zoom,
    0, 0, canvas.width, canvas.height,
  );
  drawGraticule();
  const stroke = Math.max(1.5, table.width / 300);
  if (lastRoute && lastRoute.path.length > 1) {
    context.lineCap = "round";
    for (let index = 1; index < lastRoute.path.length; index++) {
      const a = lastRoute.path[index - 1] ?? 0;
      const b = lastRoute.path[index] ?? 0;
      const ay = Math.floor(a / substrate.width);
      const by = Math.floor(b / substrate.width);
      const ax = a - ay * substrate.width;
      const bx = b - by * substrate.width;
      context.strokeStyle = MODE_COLORS[lastRoute.modes[index] ?? 0] ?? "#ffd166";
      context.lineWidth = stroke;
      context.beginPath();
      const [sax, say] = toScreenXY(ax, ay);
      const [sbx, sby] = toScreenXY(bx, by);
      // A segment that crosses the seam is drawn out through it on both
      // sides (each piece runs to the map edge at its own latitude), never
      // straight across the map. The seam is wherever the centre puts it,
      // so the test is in projected pixels.
      if (Math.abs(sbx - sax) > table.width * zoom / 2) {
        const aSide: 1 | -1 = sax > sbx ? 1 : -1;
        const [eax, eay] = seamScreenXY(ay, aSide);
        const [ebx, eby] = seamScreenXY(by, aSide === 1 ? -1 : 1);
        context.moveTo(sax, say);
        context.lineTo(eax, eay);
        context.moveTo(ebx, eby);
        context.lineTo(sbx, sby);
      } else {
        context.moveTo(sax, say);
        context.lineTo(sbx, sby);
      }
      context.stroke();
    }
  }
  if (lens.value === "wind") drawWindArrows(selectedMonth);
  if (startCell !== undefined) {
    const y = Math.floor(startCell / substrate.width);
    const [sx, sy] = toScreenXY(startCell - y * substrate.width, y);
    context.fillStyle = "#ffd166";
    context.beginPath();
    context.arc(sx, sy, stroke * 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

function capabilities(): Capability[] {
  const result: Capability[] = [];
  for (const input of document.querySelectorAll<HTMLInputElement>("input[data-capability]")) {
    if (input.checked) result.push(input.dataset.capability as Capability);
  }
  return result;
}

/** The sim cell under the pointer, or undefined off the globe. */
function cellFromPointer(event: MouseEvent): number | undefined {
  const bounds = canvas.getBoundingClientRect();
  const fx = (event.clientX - bounds.left) / bounds.width;
  const fy = (event.clientY - bounds.top) / bounds.height;
  const px = clamp(Math.floor(viewX + fx * table.width / zoom), 0, table.width - 1);
  const py = clamp(Math.floor(viewY + fy * table.height / zoom), 0, table.height - 1);
  const cell = table.cellAt(px, py, table.shiftFor(degreesToRadians(centreDegrees)));
  return cell < 0 ? undefined : cell;
}

function describeModes(result: TravelRoute): string {
  const used: string[] = [];
  for (const mode of result.modes) {
    const name = MODE_NAMES[mode] ?? "?";
    if (!used.includes(name)) used.push(name);
  }
  return used.join(" → ");
}

async function queryRoute(start: number, goal: number): Promise<void> {
  const metric: TravelMetric = {
    month: Number(month.value),
    modes: ["foot", "pack", "cart", "river", "coastal", "open-sea"],
    capabilities: capabilities(),
  };
  const result: TravelRoute = travel.query(start, goal, metric);
  const reachable = Number.isFinite(result.days) && result.days < 1e300;
  lastRoute = reachable ? result : undefined;
  route.textContent = reachable
    ? `Route: ${result.days.toFixed(1)} days · ${result.path.length} cells · ${describeModes(result)} · ${travel.cachedMetricCount} cached metric(s)`
    : "No route under the selected capabilities.";
  draw();
}

// Pointer tracking supports one-finger pan/tap AND two-finger pinch. The
// canvas carries touch-action:none so the browser never turns these
// gestures into page scroll/zoom.
const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let pinchStart: { distance: number; zoom: number } | undefined;

function pinchState(): { distance: number; midX: number; midY: number } | undefined {
  if (pointers.size !== 2) return undefined;
  const [a, b] = [...pointers.values()];
  if (!a || !b) return undefined;
  return {
    distance: Math.hypot(a.x - b.x, a.y - b.y),
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
  };
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) dragged = false;
  const pinch = pinchState();
  if (pinch) {
    pinchStart = { distance: pinch.distance, zoom };
    dragged = true; // a pinch is never a route tap
  }
});
canvas.addEventListener("pointermove", (event) => {
  const previous = pointers.get(event.pointerId);
  if (!previous) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const bounds = canvas.getBoundingClientRect();
  const pinch = pinchState();
  if (pinch && pinchStart && pinchStart.distance > 0) {
    const fx = (pinch.midX - bounds.left) / bounds.width;
    const fy = (pinch.midY - bounds.top) / bounds.height;
    setZoom(pinchStart.zoom * (pinch.distance / pinchStart.distance), fx, fy);
    return;
  }
  if (pointers.size !== 1) return;
  const dx = event.clientX - previous.x;
  const dy = event.clientY - previous.y;
  if (Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y) > 4) dragged = true;
  if (!dragged) return;
  // A horizontal drag spins the world at every zoom, scaled so the land
  // under the pointer tracks it: one screen pixel is 360° over the width of
  // the pointer's own parallel (rows shrink toward the poles in Equal
  // Earth). Dragging right carries land east, so the centre moves west.
  const fy = (event.clientY - bounds.top) / bounds.height;
  const here = lonLatAtScreen(0.5, fy);
  const centre = centralMeridian();
  const lat = here ? here[1] : 0;
  const [westX] = table.lonLatToPixel(centre - Math.PI + 1e-9, lat, centre);
  const [eastX] = table.lonLatToPixel(centre + Math.PI - 1e-9, lat, centre);
  const rowWidthScreen = Math.max(1, (eastX - westX) * zoom * bounds.width / canvas.width);
  centreDegrees -= dx / rowWidthScreen * 360;
  viewY -= dy / bounds.height * table.height / zoom;
  applyCentre();
  draw();
});
function releasePointer(event: PointerEvent): void {
  const had = pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStart = undefined;
  if (!had) return;
  if (event.type !== "pointerup" || pointers.size > 0) return;
  const wasDrag = dragged;
  dragged = false;
  if (wasDrag) return;
  const cell = cellFromPointer(event);
  if (cell === undefined) return;
  if (startCell === undefined) {
    startCell = cell;
    route.textContent = "Start selected — choose a destination.";
    draw();
    return;
  }
  void queryRoute(startCell, cell);
  startCell = undefined;
}
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const bounds = canvas.getBoundingClientRect();
  const fx = (event.clientX - bounds.left) / bounds.width;
  const fy = (event.clientY - bounds.top) / bounds.height;
  setZoom(zoom * (event.deltaY < 0 ? 1.25 : 0.8), fx, fy);
}, { passive: false });
zoomInput.addEventListener("input", () => {
  setZoom(Math.pow(2, Number(zoomInput.value)));
});
runButton.addEventListener("click", () => {
  playing = !playing;
  runButton.textContent = playing ? "Pause" : "Run";
});
speedInput.addEventListener("input", () => {
  speed = Math.max(1, Math.pow(2, Number(speedInput.value)));
  speedLabel.textContent = `${speed}×`;
});

const riverLegend = document.querySelector<HTMLElement>("#river-legend");
lens.addEventListener("change", () => {
  if (riverLegend) riverLegend.hidden = lens.value !== "rivers";
  draw();
});
projectionSelect.addEventListener("change", () => {
  applyProjection(projectionSelect.value as ProjectionName);
  zoom = 1;
  viewX = 0;
  viewY = 0;
  zoomInput.value = "0";
  zoomLabel.textContent = "Zoom 1.0×";
  draw();
});
month.addEventListener("input", draw);
for (const input of document.querySelectorAll<HTMLInputElement>("input[data-capability]")) {
  input.addEventListener("change", () => {
    if (startCell !== undefined) draw();
  });
}
draw();
