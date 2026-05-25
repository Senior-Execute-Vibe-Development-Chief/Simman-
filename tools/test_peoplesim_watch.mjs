// Detailed peopleSim observation — run a longer sim on a more realistic
// synthetic world (rivers, varied fertility, multiple continents),
// print per-settlement stats at each checkpoint so we can watch how
// the population, farmland, knowledge, and tier-up actually evolve.

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

function makeWorld(W = 512, H = 256) {
  const elevation   = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);
  const moisture    = new Float32Array(W * H);
  const coastal     = new Uint8Array(W * H);
  // Two-continent synthetic geography with noise. Tilted-cosine landmasses
  // give variable elevation; sin/cos moisture for variety.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = x / W, ny = y / H;
      // Continent A: centred at (0.3, 0.5)
      const dxA = nx - 0.3, dyA = ny - 0.5;
      const dA = Math.sqrt(dxA * dxA + dyA * dyA);
      // Continent B: centred at (0.75, 0.55)
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
      // Coast = land tile with at least one water neighbour.
      let coastal_b = 0;
      if (x > 0     && elevation[i - 1] <= 0) coastal_b = 1;
      if (x < W - 1 && elevation[i + 1] <= 0) coastal_b = 1;
      if (y > 0     && elevation[i - W] <= 0) coastal_b = 1;
      if (y < H - 1 && elevation[i + W] <= 0) coastal_b = 1;
      coastal[i] = coastal_b;
    }
  }
  // Procedural rivers — pick a few high-elevation start points, flow down.
  const riverMag = new Uint8Array(W * H);
  const seeds = [
    [0.30, 0.40], [0.32, 0.55], [0.28, 0.50],   // continent A
    [0.78, 0.50], [0.72, 0.60], [0.80, 0.55],   // continent B
  ];
  for (const [sx, sy] of seeds) {
    let x = (sx * W) | 0, y = (sy * H) | 0;
    for (let step = 0; step < 80; step++) {
      if (x < 1 || x >= W - 1 || y < 1 || y >= H - 1) break;
      const idx = y * W + x;
      if (elevation[idx] <= 0) break;
      riverMag[idx] = Math.min(4, (riverMag[idx] || 0) + 2);
      // Greedy downhill (4-neighbour).
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

function settlementLine(s, world) {
  let farmFert = 0;
  for (const fti of s.farmland) farmFert += world.fert[fti] || 0;
  const K = Math.max(20, farmFert * 14 * (1 + (s.knowledge.agriculture || 0) * 1.2));
  const tier = ["village","town","city","metropolis"][s.tier];
  const px = (s.pos.x | 0), py = (s.pos.y | 0);
  return `  #${String(s.id).padStart(2)} ${tier.padEnd(10)} (${String(px).padStart(3)},${String(py).padStart(3)}) ` +
    `pop ${String(Math.round(s.people)).padStart(4)}/${String(Math.round(K)).padStart(4)}  ` +
    `food ${String(Math.round(s.food)).padStart(3)}  ` +
    `farm ${String(s.farmland.size).padStart(2)}t fert${(farmFert / Math.max(1, s.farmland.size)).toFixed(2)}  ` +
    `ag ${(s.knowledge.agriculture * 100 | 0)}% org ${(s.knowledge.organization * 100 | 0)}%`;
}

console.log("=== peopleSim run-and-watch ===");
const w = makeWorld(512, 256);
const world = initPeopleSim(w, { seed: 4242 });
console.log(`world: tw=${world.tw} th=${world.th} N=${world.N}`);
console.log(`initial settlements:`);
for (const s of world.settlements) console.log(settlementLine(s, world));

const checkpoints = [500, 1500, 3000, 6000, 10000, 15000, 20000];
let cpIdx = 0;
const t0 = performance.now();
const TICKS = 20000;
for (let s = 1; s <= TICKS; s++) {
  try { stepPeopleSim(world, 1); }
  catch (e) { console.error(`step ${s} crashed:`, e.message, e.stack); process.exit(1); }
  if (s === checkpoints[cpIdx]) {
    console.log(`\n— step ${s} — ${JSON.stringify(peopleSimStats(world))}`);
    for (const sett of world.settlements) {
      if (sett.mode === "dead") continue;
      console.log(settlementLine(sett, world));
    }
    cpIdx++;
  }
}
const dt = performance.now() - t0;
console.log(`\n${TICKS} steps in ${dt.toFixed(1)}ms (${(dt / TICKS).toFixed(3)}ms/step)`);
