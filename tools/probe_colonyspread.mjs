// Do colonies spread inland, or stall at the landing point? Flood-fill the land into
// CONTINENTS, then report how many settlements sit on each — and crucially, on continents
// OTHER than the big cradle landmasses (where everything is colony-descended). If colonies
// roll inland, the secondary continents carry real clusters; if they stall, they carry 1-2.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const { tw, th, elev, N } = world;
// Flood-fill continents (4-connected land, x wraps).
const cont = new Int32Array(N).fill(-1);
let nc = 0; const size = [];
const stack = [];
for (let i = 0; i < N; i++) {
  if (elev[i] <= 0 || cont[i] >= 0) continue;
  const id = nc++; let sz = 0; stack.length = 0; stack.push(i); cont[i] = id;
  while (stack.length) {
    const p = stack.pop(); sz++;
    const y = (p / tw) | 0, x = p - y * tw;
    const nb = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? p - tw : -1, y < th - 1 ? p + tw : -1];
    for (const q of nb) { if (q >= 0 && elev[q] > 0 && cont[q] < 0) { cont[q] = id; stack.push(q); } }
  }
  size[id] = sz;
}
// Count settlements per continent.
const setts = new Array(nc).fill(0);
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
  const c = cont[ti]; if (c >= 0) setts[c]++;
}
// Rank continents by land area; the top few are cradle landmasses.
const order = [...Array(nc).keys()].filter(c => size[c] >= 20).sort((a, b) => size[b] - size[a]);
console.log(`continents (land≥20 tiles): ${order.length}, total settlements ${world.settlements.filter(s=>s.mode==="settled").length}`);
console.log('rank  landTiles  settlements');
let secondarySetts = 0, secondaryWithSetts = 0;
order.forEach((c, idx) => {
  if (idx < 12) console.log(`  ${String(idx).padStart(2)}    ${String(size[c]).padStart(6)}     ${setts[c]}`);
  if (idx >= 3) { secondarySetts += setts[c]; if (setts[c] > 0) secondaryWithSetts++; }
});
console.log(`\nbeyond the top-3 cradle landmasses: ${secondarySetts} settlements across ${secondaryWithSetts} colonised continents`);
console.log('(if colonies roll inland, secondary continents carry real clusters; if they stall at the landing, ~0-1 each)');
