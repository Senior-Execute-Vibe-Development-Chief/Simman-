import {
  M0_DEFAULT_SEED,
  MONTHS_PER_YEAR,
  TRAVEL_RIVER_MIN_MAGNITUDE,
  TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM,
  TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM,
} from "../sim/constants";
import { buildSubstrate, type Substrate } from "../sim/substrate";
import { createTravelEngine, type TravelRoute } from "../sim/travel/engine";
import { riverReachGradient, type Capability, type TravelMetric } from "../sim/travel/cost";
import type { GridPreset } from "../sim/world";

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
if (!canvas || !lens || !month || !monthLabel || !zoomInput || !zoomLabel || !status || !route) {
  throw new Error("M1 shell markup is incomplete.");
}

const context = canvas.getContext("2d")!;
if (!context) throw new Error("Canvas is unavailable.");

const substrate = buildSubstrate(M0_DEFAULT_SEED, { preset: "earth_sim" }, GRID);
const travel = await createTravelEngine(substrate);
// Render at the simulation's own resolution; CSS scales the display.
canvas.width = substrate.width;
canvas.height = substrate.height;
const frame = new ImageData(substrate.width, substrate.height);
const base = document.createElement("canvas");
base.width = substrate.width;
base.height = substrate.height;
const baseContext = base.getContext("2d")!;
let baseKey = "";

const worker = new Worker(new URL("../sim/worker.ts", import.meta.url), { type: "module" });
worker.postMessage({ type: "create", seed: M0_DEFAULT_SEED, grid: GRID });
worker.addEventListener("message", (event) => {
  if (event.data?.type === "created") status.textContent = `Worker ready · ${event.data.hash}`;
  if (event.data?.type === "snapshot" && event.data.buffer instanceof ArrayBuffer) {
    worker.postMessage({ type: "recycle", buffer: event.data.buffer }, [event.data.buffer]);
  }
});
window.setInterval(() => worker.postMessage({ type: "tick", steps: 1 }), 1000);

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

function clampView(): void {
  zoom = clamp(zoom, 1, 64);
  viewX = clamp(viewX, 0, substrate.width - substrate.width / zoom);
  viewY = clamp(viewY, 0, substrate.height - substrate.height / zoom);
}

/** Set zoom keeping the map point under (fx, fy) — canvas fractions — fixed. */
function setZoom(next: number, fx = 0.5, fy = 0.5): void {
  const anchorX = viewX + fx * substrate.width / zoom;
  const anchorY = viewY + fy * substrate.height / zoom;
  zoom = clamp(next, 1, 64);
  viewX = anchorX - fx * substrate.width / zoom;
  viewY = anchorY - fy * substrate.height / zoom;
  zoomInput.value = String(Math.log2(zoom));
  zoomLabel.textContent = `Zoom ${zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}×`;
  draw();
}

function terrainColor(cell: number, moisture: number, y: number): [number, number, number] {
  const elevation = substrate.elevation[cell];
  const river = substrate.rivers.magnitude[cell];
  const green = clamp(85 + moisture * 100 - elevation * 40, 0, 210);
  const brown = clamp(135 - elevation * 90, 40, 170);
  return river >= 2 ? [45, 125, 155] : [brown, green, 65 + (y % 3) * 10];
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
    if ((substrate.rivers.lake?.[cell] ?? -1) >= 0) return [80, 200, 200];
    if (magnitude >= 1) {
      if (magnitude < TRAVEL_RIVER_MIN_MAGNITUDE) return [120, 125, 135];
      const gradient = riverReachGradient(substrate)[cell] ?? 0;
      if (gradient > TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM) return [235, 60, 50];
      if (gradient > TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM) return [240, 170, 40];
      return [70, 225, 90];
    }
    const [red, green, blue] = terrainColor(cell, moisture, y);
    return [Math.round(red * 0.35), Math.round(green * 0.35), Math.round(blue * 0.35)];
  }
  if (!substrate.landMask[cell]) return [25, 55, 86];
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
  const key = `${lens.value}|${selectedMonth}`;
  if (key === baseKey) return;
  const pixels = frame.data;
  for (let cell = 0; cell < substrate.N; cell++) {
    const [red, green, blue] = pixelColor(cell, selectedMonth);
    const offset = cell * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  baseContext.putImageData(frame, 0, 0);
  baseKey = key;
}

function toScreenXY(x: number, y: number): [number, number] {
  return [(x + 0.5 - viewX) * zoom, (y + 0.5 - viewY) * zoom];
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
  const startX = Math.floor(viewX / stride) * stride;
  const startY = Math.max(0, Math.floor(viewY / stride) * stride);
  const endX = viewX + substrate.width / zoom;
  const endY = Math.min(substrate.height - 1, viewY + substrate.height / zoom);
  context.lineCap = "round";
  context.lineWidth = Math.max(0.5, 1.4 / displayScale);
  for (let y = startY; y <= endY; y += stride) {
    for (let x = startX; x <= endX; x += stride) {
      const cx = ((x % substrate.width) + substrate.width) % substrate.width;
      const cell = y * substrate.width + cx;
      const index = cell * MONTHS_PER_YEAR + selectedMonth;
      const u = substrate.wind.u[index] ?? 0;
      const v = substrate.wind.v[index] ?? 0;
      const speed = Math.hypot(u, v);
      if (speed < 0.05) continue;
      const warm = Math.min(1, speed / WIND_ARROW_FULL_MS);
      const glyph = stride * zoom * (0.25 + 0.6 * warm);
      const dx = (u / speed) * glyph;
      const dy = (-v / speed) * glyph;
      const [sx, sy] = toScreenXY(x, y);
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
    viewX, viewY, substrate.width / zoom, substrate.height / zoom,
    0, 0, canvas.width, canvas.height,
  );
  const stroke = Math.max(1.5, substrate.width / 300);
  if (lastRoute && lastRoute.path.length > 1) {
    context.lineCap = "round";
    for (let index = 1; index < lastRoute.path.length; index++) {
      const a = lastRoute.path[index - 1] ?? 0;
      const b = lastRoute.path[index] ?? 0;
      const ay = Math.floor(a / substrate.width);
      const by = Math.floor(b / substrate.width);
      const ax = a - ay * substrate.width;
      let bx = b - by * substrate.width;
      // A segment that wraps the antimeridian is drawn out through the
      // seam, not straight across the map: shift the far endpoint by a
      // world width and draw the mirrored piece too.
      let wrapped = 0;
      if (bx - ax > substrate.width / 2) { bx -= substrate.width; wrapped = -1; }
      else if (ax - bx > substrate.width / 2) { bx += substrate.width; wrapped = 1; }
      context.strokeStyle = MODE_COLORS[lastRoute.modes[index] ?? 0] ?? "#ffd166";
      context.lineWidth = stroke;
      context.beginPath();
      const [sax, say] = toScreenXY(ax, ay);
      const [sbx, sby] = toScreenXY(bx, by);
      context.moveTo(sax, say);
      context.lineTo(sbx, sby);
      if (wrapped !== 0) {
        const [max2, may2] = toScreenXY(ax + wrapped * substrate.width, ay);
        const [mbx2, mby2] = toScreenXY(bx + wrapped * substrate.width, by);
        context.moveTo(max2, may2);
        context.lineTo(mbx2, mby2);
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

function cellFromPointer(event: MouseEvent): number {
  const bounds = canvas.getBoundingClientRect();
  const fx = (event.clientX - bounds.left) / bounds.width;
  const fy = (event.clientY - bounds.top) / bounds.height;
  const x = clamp(Math.floor(viewX + fx * substrate.width / zoom), 0, substrate.width - 1);
  const y = clamp(Math.floor(viewY + fy * substrate.height / zoom), 0, substrate.height - 1);
  return y * substrate.width + x;
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
  viewX -= dx / bounds.width * substrate.width / zoom;
  viewY -= dy / bounds.height * substrate.height / zoom;
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

const riverLegend = document.querySelector<HTMLElement>("#river-legend");
lens.addEventListener("change", () => {
  if (riverLegend) riverLegend.hidden = lens.value !== "rivers";
  draw();
});
month.addEventListener("input", draw);
for (const input of document.querySelectorAll<HTMLInputElement>("input[data-capability]")) {
  input.addEventListener("change", () => {
    if (startCell !== undefined) draw();
  });
}
draw();
