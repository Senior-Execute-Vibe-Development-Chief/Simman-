import { M0_DEFAULT_SEED, MONTHS_PER_YEAR } from "../sim/constants";
import { buildSubstrate, type Substrate } from "../sim/substrate";
import { createTravelEngine, type TravelRoute } from "../sim/travel/engine";
import type { Capability, TravelMetric } from "../sim/travel/cost";
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
const status = document.querySelector<HTMLElement>("#status")!;
const route = document.querySelector<HTMLElement>("#route")!;
if (!canvas || !lens || !month || !monthLabel || !status || !route) {
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

// Viewport: wheel to zoom (cursor-anchored), drag to pan, click to route.
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

function pixelColor(cell: number, selectedMonth: number): [number, number, number] {
  const y = Math.floor(cell / substrate.width);
  const climateIndex = cell * MONTHS_PER_YEAR + selectedMonth;
  const temperature = substrate.temperature[climateIndex];
  const moisture = substrate.moisture[climateIndex];
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
  const elevation = substrate.elevation[cell];
  const river = substrate.rivers.magnitude[cell];
  const green = clamp(85 + moisture * 100 - elevation * 40, 0, 210);
  const brown = clamp(135 - elevation * 90, 40, 170);
  return river >= 2 ? [45, 125, 155] : [brown, green, 65 + (y % 3) * 10];
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

function toScreen(cell: number): [number, number] {
  const y = Math.floor(cell / substrate.width);
  const x = cell - y * substrate.width;
  return [(x + 0.5 - viewX) * zoom, (y + 0.5 - viewY) * zoom];
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
      const [ax, ay] = toScreen(lastRoute.path[index - 1] ?? 0);
      const [bx, by] = toScreen(lastRoute.path[index] ?? 0);
      context.strokeStyle = MODE_COLORS[lastRoute.modes[index] ?? 0] ?? "#ffd166";
      context.lineWidth = stroke;
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
    }
  }
  if (startCell !== undefined) {
    const [sx, sy] = toScreen(startCell);
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

let pointerDown: { x: number; y: number } | undefined;
let dragged = false;

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = { x: event.clientX, y: event.clientY };
  dragged = false;
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointerDown || event.buttons === 0) return;
  const dx = event.clientX - pointerDown.x;
  const dy = event.clientY - pointerDown.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
  if (!dragged) return;
  const bounds = canvas.getBoundingClientRect();
  viewX -= dx / bounds.width * substrate.width / zoom;
  viewY -= dy / bounds.height * substrate.height / zoom;
  pointerDown = { x: event.clientX, y: event.clientY };
  draw();
});
canvas.addEventListener("pointerup", (event) => {
  const wasDrag = dragged;
  pointerDown = undefined;
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
});
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const bounds = canvas.getBoundingClientRect();
  const fx = (event.clientX - bounds.left) / bounds.width;
  const fy = (event.clientY - bounds.top) / bounds.height;
  const anchorX = viewX + fx * substrate.width / zoom;
  const anchorY = viewY + fy * substrate.height / zoom;
  zoom = clamp(zoom * (event.deltaY < 0 ? 1.25 : 0.8), 1, 64);
  viewX = anchorX - fx * substrate.width / zoom;
  viewY = anchorY - fy * substrate.height / zoom;
  draw();
}, { passive: false });

lens.addEventListener("change", draw);
month.addEventListener("input", draw);
for (const input of document.querySelectorAll<HTMLInputElement>("input[data-capability]")) {
  input.addEventListener("change", () => {
    if (startCell !== undefined) draw();
  });
}
draw();
