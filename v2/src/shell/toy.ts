/**
 * M4 toy playground — Canvas2D, main thread, 100×100 Nile-mouth Earth crop.
 *
 * Lenses make communities, exit (cage), store, and tribute edges obvious at
 * cell scale. Not the Earth product surface.
 */
import { createToyWorld, stepToyYear } from "../sim/toy/index";
import { yearFromStep } from "../sim/horizon";
import {
  CAGE_KNEE_FREE_SHARE,
  COMMUNITY_BAR_PERSONS,
  MONTHS_PER_YEAR,
} from "../sim/constants";
import type { World } from "../sim/world";

const CELL_PX = 5; // 100 cells → 500px backing store
type Lens = "politics" | "terrain" | "climate" | "people" | "store" | "exit";

let seed = 7;
let { world } = createToyWorld(seed);
let lens: Lens = "politics";
let playing = false;
let playTimer: number | null = null;

const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const GRID_W = world.width;
const GRID_H = world.height;
canvas.width = GRID_W * CELL_PX;
canvas.height = GRID_H * CELL_PX;

const statsEl = document.getElementById("stats")!;
const logEl = document.getElementById("log")!;
const hoverEl = document.getElementById("hover")!;
const legendEl = document.getElementById("legend")!;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const speedEl = document.getElementById("speed") as HTMLSelectElement;

function cellAt(clientX: number, clientY: number): number {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((clientX - rect.left) / rect.width) * GRID_W);
  const y = Math.floor(((clientY - rect.top) / rect.height) * GRID_H);
  if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) return -1;
  return y * GRID_W + x;
}

function heat(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  if (u < 0.5) {
    const s = u * 2;
    return [20 + s * 40, 30 + s * 80, 60 + s * 120];
  }
  const s = (u - 0.5) * 2;
  return [60 + s * 195, 110 + s * 100, 180 - s * 100];
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.floor((r + m) * 255), Math.floor((g + m) * 255), Math.floor((b + m) * 255)];
}

function moistureAt(w: World, cell: number): number {
  const month = w.calendarMonth % MONTHS_PER_YEAR;
  return w.substrate?.moisture[cell * MONTHS_PER_YEAR + month] ?? 0;
}

function paint(): void {
  const sub = world.substrate!;
  const land = sub.landMask;
  const elev = sub.elevation;
  const flow = sub.rivers.flowAccum;
  const lake = sub.rivers.lake;
  const owner = world._communityOwner;
  const N = GRID_W * GRID_H;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const data = img.data;
  const RIVER_FLOW = 40;

  let maxPeople = 1;
  let maxStore = 1;
  for (let i = 0; i < N; i++) {
    if ((world.people[i] ?? 0) > maxPeople) maxPeople = world.people[i] ?? 0;
    if ((world.store[i] ?? 0) > maxStore) maxStore = world.store[i] ?? 0;
  }

  for (let i = 0; i < N; i++) {
    const x = i % GRID_W;
    const y = (i / GRID_W) | 0;
    let r = 8, g = 10, b = 18;
    if (land[i]) {
      const channel = (flow[i] ?? 0) > RIVER_FLOW;
      if (lens === "terrain") {
        // Nile crop elev tops out ~0.35 — stretch for readable relief.
        const t = Math.min(1, (elev[i] + 0.02) / 0.4);
        [r, g, b] = [48 + t * 140, 52 + t * 90, 36 + t * 40];
        const water = Math.min(1, (channel ? 0.85 : 0) + ((lake[i] ?? -1) >= 0 ? 0.55 : 0));
        if (water > 0) {
          r = Math.floor(r * (1 - water) + 20 * water);
          g = Math.floor(g * (1 - water) + (70 + water * 90) * water);
          b = Math.floor(b * (1 - water) + (110 + water * 120) * water);
        }
      } else if (lens === "climate") {
        const t = moistureAt(world, i);
        [r, g, b] = [40 + (1 - t) * 140, 50 + t * 140, 40 + t * 40];
      } else if (lens === "people") {
        [r, g, b] = heat((world.people[i] ?? 0) / maxPeople);
      } else if (lens === "store") {
        [r, g, b] = heat((world.store[i] ?? 0) / maxStore);
      } else if (lens === "exit") {
        const cap = world.capField[i] ?? 0;
        const free = cap > 0 ? Math.max(0, 1 - (world.people[i] ?? 0) / cap) : 1;
        r = Math.floor(40 + (1 - free) * 180);
        g = Math.floor(40 + free * 160);
        b = 50;
      } else {
        const who = owner[i] ?? -1;
        if (who >= 0) [r, g, b] = hsl((who * 47) % 360, 0.55, 0.42);
        else [r, g, b] = [28, 32, 40];
        if (channel) {
          r = Math.floor(r * 0.45 + 24);
          g = Math.floor(g * 0.45 + 95);
          b = Math.floor(b * 0.45 + 170);
        }
      }
    } else {
      r = 12; g = 18; b = 36;
    }

    for (let dy = 0; dy < CELL_PX; dy++) {
      for (let dx = 0; dx < CELL_PX; dx++) {
        const px = (y * CELL_PX + dy) * canvas.width + (x * CELL_PX + dx);
        const o = px * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  for (const c of world.communities) {
    const x = (c.seat % GRID_W) * CELL_PX + CELL_PX / 2;
    const y = ((c.seat / GRID_W) | 0) * CELL_PX + CELL_PX / 2;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(3.5, CELL_PX * 0.75), 0, Math.PI * 2);
    ctx.fillStyle = c.exitBlocked ? "#e74c3c" : "#f5f5f5";
    ctx.fill();
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }

  if (lens === "politics" || lens === "exit" || lens === "store") {
    const byId = new Map(world.communities.map((c) => [c.id, c]));
    for (const e of world.obligationEdges) {
      if (e.kind !== "tribute") continue;
      const from = byId.get(e.from);
      const to = byId.get(e.to);
      if (!from || !to) continue;
      const x0 = (from.seat % GRID_W) * CELL_PX + CELL_PX / 2;
      const y0 = ((from.seat / GRID_W) | 0) * CELL_PX + CELL_PX / 2;
      const x1 = (to.seat % GRID_W) * CELL_PX + CELL_PX / 2;
      const y1 = ((to.seat / GRID_W) | 0) * CELL_PX + CELL_PX / 2;
      ctx.strokeStyle = "rgba(255, 220, 60, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 7 * Math.cos(ang - 0.4), y1 - 7 * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - 7 * Math.cos(ang + 0.4), y1 - 7 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 220, 60, 0.95)";
      ctx.fill();
    }
  }

  updateHud();
}

function updateHud(): void {
  const year = yearFromStep(world.step);
  const tributes = world.obligationEdges.filter((e) => e.kind === "tribute").length;
  const caged = world.communities.filter((c) => c.exitBlocked).length;
  let pop = 0;
  let stor = 0;
  for (let i = 0; i < world.people.length; i++) {
    const area = world.cellAreaKm2[i] ?? 0;
    pop += (world.people[i] ?? 0) * area;
    stor += (world.store[i] ?? 0) * area;
  }
  statsEl.innerHTML =
    `<div>year <b>${Math.round(year)}</b> · step ${world.step}</div>` +
    `<div>communities <b>${world.communities.length}</b> (caged seats ${caged})</div>` +
    `<div>tribute edges <b>${tributes}</b></div>` +
    `<div>people Σ ${pop.toFixed(0)} · store Σ ${stor.toFixed(0)} t</div>` +
    `<div>events this year ${world.events.length}</div>` +
    `<div style="margin-top:6px;color:#8b9bb4;font-size:12px">bar ${COMMUNITY_BAR_PERSONS}p · cage knee free≥${CAGE_KNEE_FREE_SHARE}</div>`;

  const recent = world.events.slice(-16);
  logEl.innerHTML = recent.length
    ? recent
        .map((e) => `<div class="${e.kind}">${e.kind} @${e.cell} (step ${e.step})</div>`)
        .join("")
    : `<div style="color:#8b9bb4">(no events this year)</div>`;

  legendEl.innerHTML = legendFor(lens);
}

function legendFor(l: Lens): string {
  switch (l) {
    case "politics":
      return (
        `<span><span class="swatch" style="background:#e74c3c"></span>caged seat</span>` +
        `<span><span class="swatch" style="background:#f5f5f5"></span>open seat</span>` +
        `<span><span class="swatch" style="background:#ffdc3c"></span>tribute arrow</span>` +
        `<span>colour = community</span>`
      );
    case "exit":
      return (
        `<span><span class="swatch" style="background:#28a745"></span>open exit</span>` +
        `<span><span class="swatch" style="background:#e74c3c"></span>caged</span>`
      );
    case "store":
      return `<span>brighter = more granary · raids target bright cells</span>`;
    case "people":
      return `<span>population density</span>`;
    case "terrain":
      return `<span>heights · rivers/lakes overlaid</span>`;
    case "climate":
      return `<span>moisture (wetter = greener)</span>`;
  }
}

function showHover(i: number): void {
  const land = world.substrate?.landMask;
  if (i < 0 || !land || !land[i]) {
    hoverEl.textContent = "Hover a land cell…";
    return;
  }
  const owner = world._communityOwner[i] ?? -1;
  const c = owner >= 0 ? world.communities.find((x) => x.id === owner) : null;
  const cap = world.capField[i] ?? 0;
  const free = cap > 0 ? Math.max(0, 1 - (world.people[i] ?? 0) / cap) : 1;
  const area = world.cellAreaKm2[i] ?? 0;
  hoverEl.textContent =
    `cell ${i} (${i % GRID_W},${(i / GRID_W) | 0})  elev ${(world.substrate!.elevation[i] ?? 0).toFixed(2)}  moist ${moistureAt(world, i).toFixed(2)}\n` +
    `people ${(world.people[i] ?? 0).toFixed(2)}/km² (${((world.people[i] ?? 0) * area).toFixed(0)} p)  store ${(world.store[i] ?? 0).toFixed(2)} t/km²\n` +
    `cap ${cap.toFixed(2)}  freeShare ${free.toFixed(2)}  technique ${(world.technique[i] ?? 0).toFixed(2)}\n` +
    (c
      ? `community #${c.id} seat=${c.seat} exit=${c.exit.toFixed(2)} ${c.exitBlocked ? "CAGED" : "open"} appropriable=${c.appropriable.toFixed(0)}t members=${c.members.length} unrest=${c.unrest.toFixed(2)}`
      : "no community");
}

function stepOnce(): void {
  try {
    stepToyYear(world);
    paint();
  } catch (err) {
    console.error("toy step failed", err);
  }
}

function setPlaying(on: boolean): void {
  playing = on;
  playBtn.textContent = on ? "Pause" : "Play";
  if (playTimer != null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  if (on) {
    const ms = Number(speedEl.value) || 350;
    playTimer = window.setInterval(() => stepOnce(), ms);
  }
}

document.getElementById("step")!.addEventListener("click", () => {
  setPlaying(false);
  stepOnce();
});
playBtn.addEventListener("click", () => setPlaying(!playing));
document.getElementById("reset")!.addEventListener("click", () => {
  setPlaying(false);
  seed = (seed + 1) | 0;
  ({ world } = createToyWorld(seed));
  paint();
});
document.getElementById("lens")!.addEventListener("change", (e) => {
  lens = (e.target as HTMLSelectElement).value as Lens;
  paint();
});
speedEl.addEventListener("change", () => {
  if (playing) setPlaying(true);
});
canvas.addEventListener("mousemove", (e) => showHover(cellAt(e.clientX, e.clientY)));


// Debug / automation hook for the playground shell.
(window as unknown as { __toy: Record<string, unknown> }).__toy = {
  stepOnce,
  setPlaying,
  paint,
  getWorld: () => world,
  getLens: () => lens,
  setLens: (next: Lens) => {
    lens = next;
    const sel = document.getElementById("lens") as HTMLSelectElement | null;
    if (sel) sel.value = next;
    paint();
  },
};

paint();
