// URBAN_PRINT A/B — do city rings go dark from the rural drain?
//   node tools/probe_print.mjs [steps=12000] [seed=8817] [W=480]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning, T } from "../src/sim/peopleSim/tuning.js";
import { urbanCoreR } from "../src/sim/peopleSim/popField.js";

const STEPS = +(process.argv[2] || 12000);
const SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 480), H = W >> 1;
const EVERY = 4000;
const LIVE = {
  DAWN_LIVE: 1, STATE_RECORDS: 1, LAND_KNOW: 1, PEER_SEATS: 1, FOUND_DRIFT: 1,
  ABSORB_ORG_ERA: 1, WAR_FINISH: 1, SETT_STRIDE: 3, TRADE_STRIDE: 5, CORE_LOCAL: 1,
};

function ringOcc(world) {
  const pf = world.popField, cap = world.capField, tw = world.tw, th = world.th;
  const coreR = urbanCoreR(world);
  const RING = Math.max(2, coreR + 4);
  let coreP = 0, coreK = 0, ringP = 0, ringK = 0, n = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    n++;
    const cx = s.pos.x | 0, cy = s.pos.y | 0;
    for (let dy = -RING; dy <= RING; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= th) continue;
      for (let dx = -RING; dx <= RING; dx++) {
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        const ti = yy * tw + (((cx + dx) % tw) + tw) % tw;
        if (cheb <= coreR) { coreP += pf[ti]; coreK += cap[ti]; }
        else { ringP += pf[ti]; ringK += cap[ti]; }
      }
    }
  }
  return {
    n,
    coreOcc: coreK > 0 ? coreP / coreK : 0,
    ringOcc: ringK > 0 ? ringP / ringK : 0,
  };
}

console.log(`\n=== URBAN_PRINT RING TEST  W=${W} seed=${SEED} steps=${STEPS} ===\n`);
for (const [label, extra] of [["pull (live)", {}], ["print", { URBAN_PRINT: 1 }]]) {
  resetTuning();
  applyTuning({ ...SIM_TUNE_OVERRIDES, ...LIVE, ...extra });
  console.log(`--- ${label}  URBAN_PRINT=${T.URBAN_PRINT} ---`);
  const world = buildSim({ W, H, seed: SEED });
  for (let s = 1; s <= STEPS; s++) {
    stepPeopleSim(world, 1);
    if (s % EVERY === 0 || s === STEPS) {
      const r = ringOcc(world);
      console.log(`  @${String(s).padStart(5)}  n=${String(r.n).padStart(3)}  coreOcc=${(100 * r.coreOcc).toFixed(0)}%  ringOcc=${(100 * r.ringOcc).toFixed(0)}%  (ring/core=${(r.ringOcc / Math.max(1e-9, r.coreOcc)).toFixed(2)})`);
    }
  }
  console.log("");
}
