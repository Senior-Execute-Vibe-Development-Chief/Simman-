// THE SHELF'S DECISIVE QUESTION (2026-08-22, docs/the-12k-shelf-2026-08-22.md):
// two-thirds of the world's cities sit at exactly their 12k birth floor because
// urban capacity is 100% IMPORT-driven — `uTarget` is set only when the import
// ceiling kBeyond > 0, so a city feeding its core from its own hinterland has
// ZERO urban capacity and is pinned at birth size forever.
//
// Before building the local-surplus term, this asks whether the food is
// actually THERE: for every city, how much UNUSED carrying capacity stands in
// its own market basin (Σ capField − Σ popField over the basin disk)?
//   · headroom ≫ a core's worth  →  the land could feed a far bigger city and
//     the shelf is pure ACCOUNTING; the local-surplus term is the fix.
//   · headroom ≈ 0               →  these cities really are on exhausted land,
//     the honest outcome is that they DIE (the new core bar permits it), and a
//     capacity term would be inventing food that does not exist.
//
//   SIM_TUNE="<live stack>" node tools/probe_shelfsurplus.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { urbanCoreR, diskSum } from "../src/sim/peopleSim/popField.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 5000;

const world = buildSim({ W, H, seed: SEED });
const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  const cap = world.capField, pf = world.popField;
  if (!cap || !pf) { console.log(`step ${world.step}: no field yet`); continue; }
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0;
  const coreR = urbanCoreR(world);
  // The BASIN disk: the market catchment the city could draw a surplus from.
  // 3× the core radius — the same order the founding market kernel uses.
  const basinR = coreR * 3;
  const onShelf = [], offShelf = [];
  let n = 0, shelfN = 0, shelfWithFood = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    n++;
    const x = s.pos.x | 0, y = s.pos.y | 0;
    const capSum = diskSum(cap, world.tw, world.th, x, y, basinR);
    const popSum = diskSum(pf, world.tw, world.th, x, y, basinR);
    const headF = capSum - popSum;                       // unused capacity, FIELD units
    const headPeople = bridge > 0 ? headF * bridge * POP_SCALE : 0;   // real people it could feed
    const atShelf = s._coreHoldCapF > 0 && bridge > 0
      && Math.abs(((s._urbanPop || 0) / bridge) / s._coreHoldCapF - 1) < 0.1;
    if (atShelf) {
      shelfN++;
      onShelf.push(headPeople);
      // "enough spare food to double this core" — a core's worth is 10k people
      if (headPeople > 10000) shelfWithFood++;
    } else offShelf.push(headPeople);
  }
  console.log(`\n=== step ${world.step}  cities=${n}  onShelf=${shelfN} (${(100 * shelfN / Math.max(1, n)).toFixed(0)}%)`);
  console.log(`    SHELF cities' unused basin capacity (real people): p10=${(q(onShelf, 0.1) / 1000).toFixed(0)}k p50=${(q(onShelf, 0.5) / 1000).toFixed(0)}k p90=${(q(onShelf, 0.9) / 1000).toFixed(0)}k`);
  console.log(`    ...of which could feed +10k more core: ${shelfWithFood} of ${shelfN} (${(100 * shelfWithFood / Math.max(1, shelfN)).toFixed(0)}%)`);
  console.log(`    OFF-shelf cities' unused basin capacity: p50=${(q(offShelf, 0.5) / 1000).toFixed(0)}k`);
}
