// Smoke test for peopleSim (settlements-only model). Verifies the
// cradle village seeds, daughter colonies spread, no crashes over a
// long run.

import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

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

console.log("=== peopleSim smoke test (settlements-only) ===");
const w = makeFakeWorld(128, 64);
const world = initPeopleSim(w, { seed: 99 });
console.log(`world initialized: tw=${world.tw} th=${world.th} settlements=${world.settlements.length}`);

// Exercise the dev invariant harness (finiteness / non-negative wealth / tier
// range + money/pop totals) over the whole run — a free regression net.
world._checkInvariants = true;

const checkpoints = [500, 1500, 3000, 6000, 10000];
let cpIdx = 0;
const t0 = performance.now();
const TICKS = 10000;
for (let s = 1; s <= TICKS; s++) {
  try { stepPeopleSim(world, 1); }
  catch (e) { console.error(`step ${s} crashed:`, e.message, e.stack); process.exit(1); }
  if (s === checkpoints[cpIdx]) {
    console.log(`step ${s}:`, peopleSimStats(world));
    cpIdx++;
  }
}
const dt = performance.now() - t0;
console.log(`\n${TICKS} steps in ${dt.toFixed(1)}ms (${(dt / TICKS).toFixed(3)}ms/step)`);

const hits = world.debug.invariantHits || {};
const nHits = Object.values(hits).reduce((a, b) => a + b, 0);
console.log(`invariant hits: ${nHits === 0 ? "none" : JSON.stringify(hits)}`);
console.log(`final totals: coin=${Math.round(world.debug.totalCoin)} people=${Math.round(world.debug.totalPeople)} settlements=${world.debug.aliveSettlements}`);
if (nHits > 0) { console.error("=== test FAILED: invariant violations ==="); process.exit(1); }
console.log("\n=== test PASSED ===");
