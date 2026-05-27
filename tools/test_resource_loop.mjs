// Iterative observation of the full resource → stockpile → tech loop.
//
// Generates a synthetic world WITH deposits (via the real
// generateResources from src/resourceGen.js), runs the people sim
// for 50k ticks, and prints at each checkpoint:
//   - Total deposits per resource (map-wide map of where stuff is)
//   - Settlements with their pop, era, knowledge, accessible
//     resources (resAccess), stockpile, and any shortages
//   - Aggregate: how many settlements have access to each resource

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { generateResources, RESOURCES } from "../src/resourceGen.js";

const RES_IDS = ["timber","stone","copper","tin","iron","coal","horses","salt"];

function makeWorld(W = 512, H = 256) {
  const elevation   = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);
  const moisture    = new Float32Array(W * H);
  const coastal     = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = x / W, ny = y / H;
      const dxA = nx - 0.3, dyA = ny - 0.5;
      const dA = Math.sqrt(dxA * dxA + dyA * dyA);
      const dxB = nx - 0.75, dyB = ny - 0.55;
      const dB = Math.sqrt(dxB * dxB + dyB * dyB);
      const land = Math.max(0.25 - dA, 0.22 - dB);
      elevation[i] = land > 0
        ? Math.min(0.42, 0.05 + land * 1.5 + Math.sin(x * 0.15 + y * 0.1) * 0.05 + Math.cos(y * 0.2) * 0.04)
        : -0.15;
      temperature[i] = 0.78 - Math.abs(ny - 0.5) * 1.1;
      moisture[i]    = 0.40 + Math.cos(nx * Math.PI * 2.5) * 0.18 + Math.sin(ny * Math.PI * 3) * 0.10;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (elevation[i] <= 0) continue;
      let cb = 0;
      if (x > 0     && elevation[i - 1] <= 0) cb = 1;
      if (x < W - 1 && elevation[i + 1] <= 0) cb = 1;
      if (y > 0     && elevation[i - W] <= 0) cb = 1;
      if (y < H - 1 && elevation[i + W] <= 0) cb = 1;
      coastal[i] = cb;
    }
  }
  const riverMag = new Uint8Array(W * H);
  const seeds = [
    [0.30, 0.40], [0.32, 0.55], [0.28, 0.50],
    [0.78, 0.50], [0.72, 0.60], [0.80, 0.55],
  ];
  for (const [sx, sy] of seeds) {
    let x = (sx * W) | 0, y = (sy * H) | 0;
    for (let step = 0; step < 80; step++) {
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) break;
      const idx = y * W + x;
      if (elevation[idx] <= 0) break;
      riverMag[idx] = Math.min(4, (riverMag[idx] || 0) + 2);
      let best = -1, bestE = elevation[idx];
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || nx >= W - 1 || ny < 1 || ny >= H - 1) continue;
        const e = elevation[ny * W + nx];
        if (e < bestE) { bestE = e; best = ny * W + nx; }
      }
      if (best < 0) break;
      y = (best / W) | 0;
      x = best - y * W;
    }
  }
  return {
    width: W, height: H, elevation, temperature, moisture, coastal,
    rivers: { riverMag },
    seed: 4242,
  };
}

// Build a worldgen "ter"-equivalent and generate deposits.
function makeDeposits(w) {
  const tw = w.width, th = w.height, N = tw * th;
  const tElev = w.elevation;
  const tTemp = w.temperature;
  const tMoist = w.moisture;
  const tCoast = w.coastal;
  // generateResources expects a "world" with width/height + optional
  // pixPlate. We don't have plates in this synthetic world; resource
  // gen falls back to climate-based placement.
  const worldRef = { width: w.width, height: w.height };
  return generateResources(tw, th, tElev, tTemp, tMoist, tCoast, worldRef, w.seed, w.rivers);
}

function depositTotals(deposits) {
  const out = {};
  for (const id of RES_IDS) {
    const a = deposits[id];
    if (!a) { out[id] = 0; continue; }
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] > 0.05 ? 1 : 0;
    out[id] = s;          // tiles with meaningful deposit
  }
  return out;
}

function settlementsWithAccess(world) {
  const out = {};
  for (const id of RES_IDS) out[id] = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const r = s.localRes || {};
    for (const id of RES_IDS) if ((r[id] || 0) > 0.10) out[id]++;
  }
  return out;
}

const ERAS = [
  [0.88, "steel"], [0.68, "iron"], [0.42, "bronze"], [0.15, "chalco"], [0, "stone"]
];
function eraFor(m) {
  for (const [thr, n] of ERAS) if (m >= thr) return n;
  return "stone";
}

function settlementLine(s) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  const st = s.stockpile || {};
  const sh = s._shortages || {};
  const era = eraFor(k.metallurgy || 0);
  // Compact resource access string: "Cu0.4 Fe0.3 H0.1"
  const resStr = RES_IDS.map(id => {
    const v = r[id] || 0;
    if (v < 0.10) return null;
    const abbrev = { timber:"T",stone:"St",copper:"Cu",tin:"Sn",iron:"Fe",coal:"Co",horses:"H",salt:"Na" }[id];
    return `${abbrev}${v.toFixed(1)}`;
  }).filter(Boolean).join(" ") || "—";
  // Compact stockpile string with shortage markers
  const stStr = RES_IDS.map(id => {
    const v = st[id] || 0;
    const short = sh[id];
    if (v < 1 && !short) return null;
    const abbrev = { timber:"T",stone:"St",copper:"Cu",tin:"Sn",iron:"Fe",coal:"Co",horses:"H",salt:"Na" }[id];
    return `${abbrev}${Math.round(v)}${short ? "!" : ""}`;
  }).filter(Boolean).join(" ") || "—";
  return (
    `  #${String(s.id).padStart(2)} ` +
    `(${String(s.pos.x|0).padStart(3)},${String(s.pos.y|0).padStart(3)}) ` +
    `pop ${String(Math.round(s.people)).padStart(4)} ` +
    `${era.padEnd(7)}` +
    `ag ${(k.agriculture*100|0).toString().padStart(2)} ` +
    `c ${(k.construction*100|0).toString().padStart(2)} ` +
    `t ${(k.toolmaking*100|0).toString().padStart(2)} ` +
    `m ${(k.metallurgy*100|0).toString().padStart(2)} ` +
    `n ${(k.navigation*100|0).toString().padStart(2)} ` +
    `mb ${(k.mobility*100|0).toString().padStart(2)} | ` +
    `res ${resStr.padEnd(28)} | ` +
    `stk ${stStr}`
  );
}

// ── Run ──
console.log("=== resource → stockpile → tech loop observation ===\n");

const w = makeWorld(512, 256);
console.log(`world: ${w.width}x${w.height}`);

const deposits = makeDeposits(w);
const tot = depositTotals(deposits);
console.log("\nDeposit tiles map-wide (richness >= 0.05):");
for (const id of RES_IDS) console.log(`  ${id.padEnd(8)} ${String(tot[id]).padStart(5)} tiles`);

const world = initPeopleSim(w, { seed: 4242, deposits });
console.log(`\npeopleSim tile grid: ${world.tw}x${world.th} (TILE_RES=${world.tileRes})`);
console.log(`initial settlements: ${world.settlements.length}`);
for (const s of world.settlements) console.log(settlementLine(s));

const checkpoints = [2000, 8000, 20000, 35000, 50000];
let cpIdx = 0;
const t0 = performance.now();
const TICKS = 50000;
for (let i = 1; i <= TICKS; i++) {
  stepPeopleSim(world, 1);
  if (i === checkpoints[cpIdx]) {
    const stats = peopleSimStats(world);
    const access = settlementsWithAccess(world);
    console.log(`\n— step ${i} — ${JSON.stringify(stats)}`);
    console.log("settlements w/ access: " + RES_IDS.map(id => `${id}:${access[id]}`).join("  "));
    // Sort alive settlements by population desc, print top 8 to keep output readable
    const alive = world.settlements
      .filter(s => s.mode === "settled")
      .sort((a, b) => b.people - a.people);
    console.log("(top 8 by pop)");
    for (const s of alive.slice(0, 8)) console.log(settlementLine(s));
    cpIdx++;
  }
}
const dt = performance.now() - t0;
console.log(`\n${TICKS} steps in ${dt.toFixed(1)}ms (${(dt / TICKS).toFixed(3)}ms/step)`);
