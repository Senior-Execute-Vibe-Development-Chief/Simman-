// IS THERE AN EARLY FOUNDING WAVE, AND ARE ITS SITES WORSE? — the "towns in
// inaccurate locations" complaint.
//
// Owner: "most of them are in inaccurate locations, is it possibly caused by a
// founding wave that happens early or something?"
//
// The hypothesis has a clear mechanism behind it. On the shipped path the sweep
// draws candidate sites as UNIFORM RANDOM TILES over the whole map, then filters
// them — on a fertility floor, on an area-fertility floor, and on SPACING against
// settlements that already exist. Early, the map is empty, so the spacing filter
// rejects nothing and a mediocre site is accepted that later would lose to a
// better-placed neighbour. Worse, once accepted it becomes part of the spacing
// lattice every later founding must respect, so a bad early placement does not
// merely persist — it BLOCKS the good site next to it.
//
// If that is what happens, two things must be visible:
//   1. a WAVE — foundings front-loaded, then decaying as spacing starts to bind
//   2. a QUALITY GRADIENT — settlements founded early sit on measurably worse
//      land than settlements founded late
//
// Measured per settlement, at its own tile, using exactly the quantities the
// founding filter reads (fert, the 5x5 area-fertility box, river, coast) plus
// climate, so "bad land" is the sim's own definition and not an eyeball.
//
//   node tools/probe_siting.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const { tw, th, elev, fert, coast, riverMag } = world;

function areaFertAt(tx, ty) {
  let a = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const ny = ty + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const ni = ny * tw + (((tx + dx) % tw) + tw) % tw;
      if (elev[ni] > 0) a += fert[ni];
    }
  }
  return a;
}

const q = (arr, f) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(f * a.length))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// The world's own land as a reference distribution: if foundings were a blind
// scatter over land clearing the fertility floor, their site quality would match
// this. A real siting process should sit WELL above it.
const landFert = [];
for (let ti = 0; ti < world.N; ti++) if (elev[ti] > 0) landFert.push(fert[ti]);
landFert.sort((a, b) => a - b);
const landP50 = landFert[landFert.length >> 1];

console.log(`# probe_siting  W=${W} seed=${SEED}  LABEL_BIRTH=${T.LABEL_BIRTH} (0 = uniform-random candidate tiles)`);
console.log(`# reference: all land fert p50 = ${landP50.toFixed(3)}\n`);

function report() {
  const setts = world.settlements.filter((s) => s.mode === "settled");
  // cohort by founding step
  const bands = [[0, 0], [1, 500], [501, 2000], [2001, 6000], [6001, 1e9]];
  const names = ["genesis (step 0)", "steps 1-500", "steps 501-2000", "steps 2001-6000", "steps 6000+"];
  console.log(`=== step ${world.step}   settled ${setts.length} ===`);
  console.log(`  cohort              n     fert p50   areaFert p50   on river   on coast   still alive`);
  for (let b = 0; b < bands.length; b++) {
    const [lo, hi] = bands[b];
    const c = setts.filter((s) => { const f = s.foundedStep | 0; return f >= lo && f <= hi; });
    if (!c.length) { console.log(`  ${names[b].padEnd(18)} (none)`); continue; }
    const fs = [], afs = [];
    let riv = 0, cst = 0;
    for (const s of c) {
      const tx = s.pos.x | 0, ty = s.pos.y | 0, ti = ty * tw + ((tx % tw) + tw) % tw;
      fs.push(fert[ti] || 0);
      afs.push(areaFertAt(tx, ty));
      if (riverMag && riverMag[ti] >= 2) riv++;
      if (coast && coast[ti]) cst++;
    }
    console.log(`  ${names[b].padEnd(18)} ${String(c.length).padEnd(5)} ` +
      `${q(fs, 0.5).toFixed(3).padStart(8)}   ${q(afs, 0.5).toFixed(1).padStart(11)}   ` +
      `${((100 * riv) / c.length).toFixed(0).padStart(7)}%   ${((100 * cst) / c.length).toFixed(0).padStart(7)}%`);
  }
  // the wave itself
  const byStep = setts.map((s) => s.foundedStep | 0).sort((a, b) => a - b);
  console.log(`  founding step distribution: p10 ${q(byStep, 0.1)}  p25 ${q(byStep, 0.25)}  p50 ${q(byStep, 0.5)}  p75 ${q(byStep, 0.75)}`);
  console.log(`  share founded by step 500: ${((100 * byStep.filter((x) => x <= 500).length) / byStep.length).toFixed(0)}%` +
    `   by 2000: ${((100 * byStep.filter((x) => x <= 2000).length) / byStep.length).toFixed(0)}%\n`);
}

const CHECKS = [500, 2000, 6000, 12000, 25000].filter((c) => c <= STEPS);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (CHECKS.includes(world.step)) report();
}
