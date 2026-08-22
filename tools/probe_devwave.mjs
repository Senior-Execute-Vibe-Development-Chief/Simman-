// Lap 3 of the field-concentration wave (docs/atlas-gap-2026-08-14.md): the
// devF technique wave lags in real km at finer grids (TILLAGE lap-1 measured
// mean devF 0.090 vs 0.067 at tw=240/480, 6k) — the lag that blocked both
// TILLAGE's suit-door lap and the RURAL_BIND_DENS coupled recalibration. The
// wave's speed (ivl ∝ tileKm) and thinning (loss = 1/tw) are km-honest by
// construction; the suspect is the DIFF_CLIM toll — paid per TILE CROSSING on
// |Δtemp|+|Δmoist| between neighbours, and a finer grid samples more residual
// micro-variation even after the real-radius zone smoothing (every up-down
// wiggle pays twice). This measures the front directly: mean devF over land
// and the REAL AREA carrying devF ≥ {0.05, 0.15, 0.30}, per checkpoint.
// Run the 2x2: tw=240/480 x DIFF_CLIM {def, 0} — if the cross-grid gap closes
// at ck=0, the toll's residual total-variation is the bug.
//   SIM_TUNE="DAWN_LIVE=1[,DIFF_CLIM=0]" node tools/probe_devwave.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 8000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const EVERY = 2000;
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % EVERY === 0) report(s); }

function report(step) {
  const dev = world.devField, elev = world.elev, N = world.N;
  if (!dev) { console.log(`[devwave] step ${step} (no devField)`); return; }
  let landN = 0, sum = 0, a05 = 0, a15 = 0, a30 = 0, mx = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    landN++;
    const v = dev[i];
    sum += v;
    if (v >= 0.05) a05++;
    if (v >= 0.15) a15++;
    if (v >= 0.30) a30++;
    if (v > mx) mx = v;
  }
  const km2 = (510e6 * 0.29) / landN;
  console.log(`[devwave] step ${step} tw=${world.tw} meanDev=${(sum / landN).toFixed(4)} max=${mx.toFixed(2)} ` +
    `area(dev>=.05)=${(a05 * km2 / 1e6).toFixed(1)}M km2 area(>=.15)=${(a15 * km2 / 1e6).toFixed(1)}M area(>=.30)=${(a30 * km2 / 1e6).toFixed(1)}M`);
}
