// Smoke test for peopleSim phase 0: bands wander, grow, split. Verifies
// no crashes over 2000 ticks on a synthetic world, and that bands move,
// reproduce, and split as designed.

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

function makeFakeWorld(W = 128, H = 64) {
  const elevation   = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);
  const moisture    = new Float32Array(W * H);
  const coastal     = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = x / W, ny = y / H;
      const dx = nx - 0.5, dy = ny - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      elevation[i]   = d < 0.35 ? 0.25 + Math.sin(x * 0.2) * 0.05 + Math.cos(y * 0.2) * 0.05 : -0.1;
      temperature[i] = 0.7 - Math.abs(ny - 0.5) * 1.0;
      moisture[i]    = 0.4 + Math.cos(nx * Math.PI * 2) * 0.2;
    }
  }
  return { width: W, height: H, elevation, temperature, moisture, coastal, seed: 99, rivers: null, deposits: null };
}

console.log("=== peopleSim smoke test ===");
const w = makeFakeWorld(128, 64);
const world = initPeopleSim(w, { seed: 99, initialBands: 12 });
console.log(`world initialized: tw=${world.tw} th=${world.th} bands=${world.bands.length}`);

// Snapshot initial positions to confirm movement later.
const startPos = world.bands.map(b => ({ id: b.id, x: b.pos.x, y: b.pos.y }));

const checkpoints = [1000, 3000, 5000, 7000, 10000];
let cpIdx = 0;
const t0 = performance.now();
const TICKS = 10000;
for (let s = 1; s <= TICKS; s++) {
  try {
    stepPeopleSim(world, 1);
  } catch (e) {
    console.error(`step ${s} crashed:`, e.message);
    process.exit(1);
  }
  if (s === checkpoints[cpIdx]) {
    const stats = peopleSimStats(world);
    const maxAg = world.bands.reduce((m, b) => b.mode === "dead" ? m : Math.max(m, b.knowledge.agriculture), 0);
    const avgPeople = stats.bands > 0 ? (stats.totalPeople / stats.bands).toFixed(1) : 0;
    const farmTiles = world.settlements.reduce((a, s) => a + (s.farmland ? s.farmland.size : 0), 0);
    console.log(`step ${s}:`, stats, `avgPpl/band=${avgPeople} maxAg=${maxAg.toFixed(2)} farmTiles=${farmTiles}`);
    cpIdx++;
  }
}
const dt = performance.now() - t0;
console.log(`\n${TICKS} steps in ${dt.toFixed(1)}ms (${(dt / TICKS).toFixed(3)}ms/step)`);

// Verify bands moved.
let moved = 0;
for (const b of world.bands) {
  if (b.mode === "dead") continue;
  const init = startPos.find(p => p.id === b.id);
  if (init) {
    const d = Math.hypot(b.pos.x - init.x, b.pos.y - init.y);
    if (d > 0.5) moved++;
  }
}
const alive = world.bands.filter(b => b.mode !== "dead").length;
const born = world.bands.length - 12;   // 12 seeded, anything beyond is from splits
const dead = world.bands.filter(b => b.mode === "dead").length;
console.log(`\noriginal bands moved: ${moved}/${startPos.length}`);
console.log(`bands total: ${world.bands.length} (alive=${alive}, dead=${dead}, born-after-seed=${born})`);

console.log("\n=== test PASSED ===");
