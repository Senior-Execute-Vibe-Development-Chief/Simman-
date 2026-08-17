// The DENOMINATOR question (owner, 2026-08-14): history's "hegemon held 25-50%"
// is share of the CONNECTED state-world of its era, not of the planet. Group
// claimed land into contact-connected BELTS (claims within a marchland gap of
// each other connect) and report each belt's top realm's share OF ITS BELT.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_beltshare.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
const STEPS = +(process.argv[2] || 45000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
const co = world._countryOwner, elev = world.elev, tw = world.tw, th = world.th, N = world.N;
let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
const km2 = (510e6 * 0.29) / landN;
// dilate claimed by GAP tiles over land, then label components
const GAP = 6;
const mask = new Uint8Array(N);
for (let i = 0; i < N; i++) if (co[i] >= 0) mask[i] = 1;
for (let g = 0; g < GAP; g++) {
  const nx = new Uint8Array(mask);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x;
    if (mask[i] || !(elev[i] > 0)) continue;
    const n = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw];
    for (const j of n) if (j >= 0 && j < N && mask[j]) { nx[i] = 1; break; }
  }
  mask.set(nx);
}
const belt = new Int32Array(N).fill(-1);
let nb = 0;
for (let s0 = 0; s0 < N; s0++) {
  if (!mask[s0] || belt[s0] >= 0) continue;
  const q = [s0]; belt[s0] = nb;
  while (q.length) {
    const i = q.pop(); const y = (i / tw) | 0, x = i - y * tw;
    for (const j of [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw])
      if (j >= 0 && j < N && mask[j] && belt[j] < 0) { belt[j] = nb; q.push(j); }
  }
  nb++;
}
// per belt: total claimed + per-realm tally
const beltTot = new Map(), beltRealm = new Map();
let globTot = 0; const globRealm = new Map();
for (let i = 0; i < N; i++) {
  if (co[i] < 0) continue;
  globTot++; globRealm.set(co[i], (globRealm.get(co[i]) || 0) + 1);
  const b = belt[i];
  beltTot.set(b, (beltTot.get(b) || 0) + 1);
  let m = beltRealm.get(b); if (!m) beltRealm.set(b, m = new Map());
  m.set(co[i], (m.get(co[i]) || 0) + 1);
}
const belts = [...beltTot.entries()].sort((a, b) => b[1] - a[1]);
console.log(`[beltshare] step ${STEPS} belts=${belts.length} claimed=${(globTot * 100 / landN).toFixed(1)}% of land`);
const gTop = Math.max(...globRealm.values());
console.log(`GLOBAL top-1 share: ${(gTop * 100 / globTot).toFixed(1)}%  (the old metric)`);
for (const [b, tot] of belts.slice(0, 6)) {
  const m = beltRealm.get(b);
  const top = [...m.entries()].sort((x, y) => y[1] - x[1])[0];
  console.log(`  belt#${b}: ${Math.round(tot * km2 / 1e6 * 10) / 10}M km2 claimed, realms=${m.size}, top realm ${Math.round(top[1] * km2 / 1e6 * 10) / 10}M = ${(top[1] * 100 / tot).toFixed(1)}% OF ITS BELT (${(tot * 100 / globTot).toFixed(0)}% of world's claimed)`);
}
