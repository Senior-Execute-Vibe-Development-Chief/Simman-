// The 12k pile: why do cities sit at EXACTLY the mint bar, starving forever?
// (Owner 2026-08-22: "EVERY SINGLE CITY with a population of EXACTLY 12k is
// starving. i am almost 100% sure this is because they CANNOT become smaller
// than 12k.")
//
// The suspect: T.CORE_HOLD stashes `_coreHoldCapF = coreBarF × 1.2` on every
// site-minted city — the site law's own gathering bound, 1.2 × a 10k core =
// 12k — and the field pass floors that city's capacity at
// `min(liveCore, _coreHoldCapF) × fedM` (T.STARVE_SHED's melt). Because the
// floor takes the MIN with the LIVE core, it tracks the core down and
// re-stabilises: a 90%-fed city melts to ~0.9 × 12k, where its smaller core
// is then fully fed, and the floor climbs back. A stable attractor at the
// mint bar, permanently labelled starving.
//
// This measures the attractor directly: the urban-core histogram, how many
// cores sit within a few percent of their OWN stashed bound, their fed-ness,
// and whether the floor is the BINDING capacity term (floor > import kCap) —
// the difference between "the floor pins them" and "the land does".
//   SIM_TUNE="<live stack>" node tools/probe_corepile.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 5000;

const world = buildSim({ W, H, seed: SEED });
let evSeen = -1;
const q = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0;
  const cores = [], feds = [], atBound = [], hist = new Map();
  let n = 0, starving = 0, boundHeld = 0, noStash = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    n++;
    const core = (s._urbanPop || 0) * POP_SCALE;      // real people in the city itself
    cores.push(core);
    // the histogram bucket, in thousands of real people
    const b = Math.round(core / 1000);
    hist.set(b, (hist.get(b) || 0) + 1);
    if (s._fedM !== undefined) feds.push(s._fedM);
    const sup = s._foodSupply || 0, need = s._coreNeed || 0;
    if ((s.food || 0) <= 0.01 && need > 0 && sup < need) starving++;
    // is this core sitting AT its own stashed bound? (_coreHoldCapF is in
    // FIELD units; the live core in field units is core/POP_SCALE/bridge)
    if (!(s._coreHoldCapF > 0)) { noStash++; continue; }
    const coreF = bridge > 0 ? (s._urbanPop || 0) / bridge : 0;
    const ratio = coreF / s._coreHoldCapF;
    atBound.push(ratio);
    if (ratio > 0.9 && ratio < 1.1) boundHeld++;
  }
  // dissolutions since the last checkpoint, split by which bar failed
  let dBasin = 0, dCore = 0;
  for (const ev of world.events || []) {
    if (ev.id <= evSeen || ev.type !== "settlement.dissolved") continue;
    if (ev.why === "core") dCore++; else dBasin++;
  }
  { const evs = world.events || []; if (evs.length) evSeen = evs[evs.length - 1].id; }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => `${k}k:${v}`).join("  ");
  console.log(`\n=== step ${world.step}  cities=${n}  starving=${starving} (${(100 * starving / Math.max(1, n)).toFixed(0)}%)  noStash=${noStash}`);
  console.log(`    urbanCore(real people): p10=${(q(cores, 0.1) / 1000).toFixed(1)}k p50=${(q(cores, 0.5) / 1000).toFixed(1)}k p90=${(q(cores, 0.9) / 1000).toFixed(1)}k max=${(q(cores, 1) / 1000).toFixed(0)}k`);
  console.log(`    modal buckets: ${top}`);
  console.log(`    core/ownBound: p10=${q(atBound, 0.1).toFixed(2)} p50=${q(atBound, 0.5).toFixed(2)} p90=${q(atBound, 0.9).toFixed(2)}   AT-BOUND(0.9-1.1)=${boundHeld} (${(100 * boundHeld / Math.max(1, n)).toFixed(0)}%)`);
  console.log(`    dissolved since last: basin=${dBasin} core=${dCore}`);
  console.log(`    fedM: p10=${q(feds, 0.1).toFixed(2)} p50=${q(feds, 0.5).toFixed(2)} p90=${q(feds, 0.9).toFixed(2)}`);
}
