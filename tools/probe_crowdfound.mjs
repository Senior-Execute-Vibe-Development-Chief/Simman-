// DO TOWNS CRYSTALLISE OUT OF DENSE COUNTRYSIDE? — the CROWD_FOUND A/B.
//
// Owner, 2026-08: "do cities appear where populations are dense?" The lever's
// own diagnosis: measured NO as a rate — the basin's people are a pass/fail
// THRESHOLD (TOWN_BASIN_MIN), so a basin at ten times the bar founds no faster
// than one exactly at it, where historically the Nile/Yangtze/Ganges grew
// thickets of towns while equally fertile, thinly-peopled land grew few.
//
// This probe scores the claim directly: every founding's basin-mass ratio
// (crowdMassRatio — the exact quantity crowdMul reads, 1 = a bar-sized basin)
// sampled within 50 steps of birth, plus the founding count and the settled
// arc, so the lever's effect shows as a SHIFT IN WHERE (median founding-site
// mass up) and not merely MORE (count explosion / confetti).
//
//   SIM_TUNE="CROWD_FOUND=1" node tools/probe_crowdfound.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { crowdMassRatio } from "../src/sim/peopleSim/crystallize.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const seen = new Set(world.settlements.map((s) => s.id));
const births = [];   // {step, mass, river}

const q = (arr, f) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(f * a.length))];
};

console.log(`CROWD_FOUND=${T.CROWD_FOUND}  CITY_CORE=${T.CITY_CORE | 0}  W=${W} seed=${SEED} steps=${STEPS}`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % 50 !== 0) continue;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || seen.has(s.id)) continue;
    seen.add(s.id);
    births.push({
      step: world.step,
      mass: world.popField ? crowdMassRatio(world, s.pos.x | 0, s.pos.y | 0) : -1,
      river: (s._riverAcc || 0) > 0.05 ? 1 : 0,
    });
  }
}

const settled = world.settlements.filter((s) => s.mode === "settled").length;
const masses = births.map((b) => b.mass).filter((m) => m >= 0);
const riverShare = births.length ? births.filter((b) => b.river).length / births.length : 0;
console.log(`foundings tracked ${births.length}   settled at end ${settled}`);
console.log(`founding-site basin mass ratio (1 = the TOWN_BASIN_MIN bar):`);
console.log(`  p25 ${q(masses, 0.25).toFixed(2)}   p50 ${q(masses, 0.5).toFixed(2)}   p75 ${q(masses, 0.75).toFixed(2)}   p90 ${q(masses, 0.9).toFixed(2)}   max ${q(masses, 1).toFixed(2)}`);
console.log(`  share of foundings in a ≥2× basin: ${(100 * masses.filter((m) => m >= 2).length / Math.max(1, masses.length)).toFixed(0)}%   ≥4×: ${(100 * masses.filter((m) => m >= 4).length / Math.max(1, masses.length)).toFixed(0)}%`);
console.log(`  on-river share of foundings: ${(100 * riverShare).toFixed(0)}%`);
// Early vs late: the dense-basin gradient should matter MORE once basins have
// filled (late foundings), while the cradle wave itself is bar-limited.
const early = births.filter((b) => b.step <= STEPS / 2).map((b) => b.mass).filter((m) => m >= 0);
const late = births.filter((b) => b.step > STEPS / 2).map((b) => b.mass).filter((m) => m >= 0);
console.log(`  first-half foundings ${early.length} (mass p50 ${q(early, 0.5).toFixed(2)})   second-half ${late.length} (p50 ${q(late, 0.5).toFixed(2)})`);
