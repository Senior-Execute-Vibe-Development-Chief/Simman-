import { M0_DEFAULT_SEED, MONTHS_PER_YEAR } from "../sim/constants";
import { buildSubstrate, type Substrate } from "../sim/substrate";
import { createTravelEngine, type TravelRoute } from "../sim/travel/engine";
import type { Capability, TravelMetric } from "../sim/travel/cost";
import type { GridPreset } from "../sim/world";

const GRID: GridPreset = "dev";
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
let lastPath: readonly number[] = [];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
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
  const elevation = substrate.elevation[cell];
  const river = substrate.rivers.magnitude[cell];
  const green = clamp(85 + moisture * 100 - elevation * 40, 0, 210);
  const brown = clamp(135 - elevation * 90, 40, 170);
  return river >= 2 ? [45, 125, 155] : [brown, green, 65 + (y % 3) * 10];
}

function draw(): void {
  const selectedMonth = Number(month.value);
  monthLabel.textContent = `Month ${selectedMonth + 1}`;
  const scaleX = canvas.width / substrate.width;
  const scaleY = canvas.height / substrate.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let cell = 0; cell < substrate.N; cell++) {
    const y = Math.floor(cell / substrate.width);
    const x = cell - y * substrate.width;
    const [red, green, blue] = pixelColor(cell, selectedMonth);
    context.fillStyle = `rgb(${red} ${green} ${blue})`;
    context.fillRect(x * scaleX, y * scaleY, scaleX + 1, scaleY + 1);
  }
  if (lastPath.length > 1) {
    context.strokeStyle = "#ffd166";
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index < lastPath.length; index++) {
      const cell = lastPath[index] ?? 0;
      const cellY = Math.floor(cell / substrate.width);
      const cellX = cell - cellY * substrate.width;
      const px = (cellX + 0.5) * scaleX;
      const py = (cellY + 0.5) * scaleY;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
  }
  if (startCell !== undefined) {
    const y = Math.floor(startCell / substrate.width);
    const x = startCell - y * substrate.width;
    context.fillStyle = "#ffd166";
    context.beginPath();
    context.arc((x + 0.5) * scaleX, (y + 0.5) * scaleY, 5, 0, Math.PI * 2);
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
  const x = clamp(Math.floor((event.clientX - bounds.left) / bounds.width * substrate.width), 0, substrate.width - 1);
  const y = clamp(Math.floor((event.clientY - bounds.top) / bounds.height * substrate.height), 0, substrate.height - 1);
  return y * substrate.width + x;
}

async function queryRoute(start: number, goal: number): Promise<void> {
  const metric: TravelMetric = {
    month: Number(month.value),
    modes: ["foot", "pack", "cart", "river", "coastal", "open-sea"],
    capabilities: capabilities(),
  };
  const result: TravelRoute = travel.query(start, goal, metric);
  const reachable = Number.isFinite(result.days) && result.days < 1e300;
  lastPath = reachable ? result.path : [];
  route.textContent = reachable
    ? `Route: ${result.days.toFixed(1)} days · ${result.path.length} cells · ${travel.cachedMetricCount} cached metric(s)`
    : "No route under the selected capabilities.";
  draw();
}

canvas.addEventListener("click", (event) => {
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
lens.addEventListener("change", draw);
month.addEventListener("input", draw);
for (const input of document.querySelectorAll<HTMLInputElement>("input[data-capability]")) {
  input.addEventListener("change", () => {
    if (startCell !== undefined) draw();
  });
}
draw();
