// Chronology distortion probe: how many DYN-YEARS (the uniform human clock,
// 0.25y/tick) does the world spend in each era, vs the historical duration?
//   node tools/probe_erapace.mjs        (SIM_TUNE="SCI_COMPOUND=0.6" for the A/B)
// Baseline (default, seed 8817, 42k): Neolithic 3.8x, Bronze 0.8x, Iron 0.3x,
// Medieval 1.0x, Renaissance 3.6x, Industrial 6.5x, Modern 38x — the flat-ceiling
// signature the SCI_COMPOUND curve exists to fix (settlement.js). Iterate the
// exponent against THIS table; never a per-era constant.
// α=0.6 (seed 8817, 42k): Neo 7.3x, Bronze 1.3x, Iron 0.3x, Med 0.9x, Ren 2.6x,
// Ind 3.5x, Modern 27x. Directionally right: tail compresses (38→27, 6.5→3.5,
// 3.6→2.6), medieval anchor holds (0.9x). Next iteration: (a) the 0.35 floor
// bites deep antiquity (Neo 3.8→7.3x) — raise it or make α asymmetric below the
// anchor; (b) Iron unmoved at 0.3x → SCI_MED_IDX 1.4 likely sits at the CLASSICAL
// hub's index, not the medieval one — add an idx-by-era diagnostic and re-anchor;
// (c) the tail wants α≈1.0-1.2 once (a)/(b) decouple it from the early game.
// idx-by-era (α=0.6 run): Bronze attained at leadIdx≈0.33, Iron≈1.1, Medieval≈1.6,
// Renaissance≈2.2, Industrial≈6.9, Modern≈16→50. FINDINGS: (1) the Modern row is a
// RUN-LENGTH artifact — the open final era accrues until step 42000; score eras to
// ATTAINMENT only, the true tail = Renaissance 2.6x / Industrial 3.5x. (2) The
// cap=6 binds from idx≈32 — raised to 12. (3) Iron 0.3x is NOT reachable by α alone
// (idx 1.1 vs anchor 1.6 is too narrow a gap for a 3x slowdown without wrecking
// Bronze) — the classical plateau is a MISSING MECHANISM (institutional
// stagnation), recorded as an honest gap, not to be dialled in. Iteration 2:
// α=1.5, SCI_MED_IDX=1.6, floor 0.6, cap 12 — targets Ren/Ind → ~1x.
// ITERATION 2 RESULT (α=1.5, seed 8817): Bronze 1.4x, Iron 0.4x (the named
// classical gap), Medieval 0.9x, Renaissance 1.3x, Industrial 1.0x — the tail has
// CONVERGED; historical era contraction is now an emergent output. Modern 37.5x
// and Neolithic 5.5x are scoring artifacts (open-era accrual / start-up epoch).
// COERCED-SHARE DIAGNOSTIC (42k, seed 8817): classical-era world share ~10%
// (slaves 8%, peak) vs Rome's ~30-40% core — LABOR_INNOV bites only ~6% there,
// hence no plateau. The supply channel (raids/captives) works — individual
// settlements reach 0.6-0.97 — but the DEMAND engine is missing: no latifundia
// dynamic (conquest wealth → land concentration → gang-labor estates → slave
// demand at scale). That mechanism is the remaining classical-gap work. NOTE the
// sim already reproduces the COLONATE transition for free: late-game slaves fall
// 0.08→0.01 while serfs rise 0.03→0.05 — slavery aging into serfdom, as Rome did.
// α=1.5 is the flip candidate. Before default-on: score eras to ATTAINMENT,
// 3-seed table, re-earn stylized at the new pacing, then delete displayYear.
// ── 3-SEED TABLE, hegemonic-stagnation era (27k, 3000 BC calibration, all levers
// default: latifundia/capitulation/amphib/PEER_COMPETE/HEGEMONY_STAG=0.75):
//              8817   31337   4242
//   Bronze     1.0x   1.2x    0.9x
//   Iron       0.8x   0.4x    0.7x   ← was 0.3-0.6x pre-law; two seeds near 1x
//   Medieval   1.1x   1.6x    1.0x
//   Renaiss.   0.9x   1.5x    0.9x
//   Industrial 1.0x   1.5x    1.0x
// 31337 is the divergent world BOTH ways and CONSISTENTLY: its iron-era world
// never consolidated (no pressure collapse → classical stays 0.4x) while its
// late world DID (a peerless early-modern hegemon → 1.5-1.6x tail — a
// Qing-world: consolidation delaying industry is the Scheidel counterfactual,
// legitimate emergence, not error). At HEGEMONY_STAG 0.55 the same seeds read
// Iron 0.6/0.4/0.5 with tails ~1x — 0.75 buys the classical row on worlds where
// the collapse happens, at the price of stronger consolidation stories where it
// happens late. Epoch fits −3395/−3770/−3215 (the 31337 outlier is its slow tail).
// ── OLDER 3-SEED TABLE (42k, pre-3000BC-calibration, latifundia/capitulation/
// amphib defaults) — attainment-scored:
//              8817   31337   4242    mean
//   Bronze     1.7x   1.7x    1.4x    1.6x
//   Iron       0.4x   0.6x    0.3x    0.43x   ← THE CLASSICAL GAP persists
//   Medieval   0.9x   1.7x    0.9x    1.2x
//   Renaiss.   1.1x   1.7x    0.9x    1.2x
//   Industrial 0.5x   1.0x    1.0x    0.8x
// The mid-table holds ~1x within seed noise. The residual is a consistent
// SHAPE: Bronze long + Iron short with Medieval on schedule — the Bronze→Iron
// attainment lands late and the classical span is squeezed from both sides.
// The named missing mechanism stands: hegemonic competition (one power
// absorbing the classical core should also collapse the competitive pressure
// that drives learning — competF reads trade-contact rivals, settlement.js).
// EPOCH: per-seed best fits −4790/−5345/−5825 STRADDLE the shipped −4850
// (calendar.js DISP_START); the mean correction (~−5320) is smaller than the
// per-world spread, so −4850 stands. The Iron anchors alone fit −5500..−6100 —
// the classical gap expressed in calendar years (~700y late) — and should
// converge to the rest once the competition channel lands.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
//   node tools/probe_erapace.mjs [seed=8817] [steps=42000]
const SEED = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "42000", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
// idx-by-era diagnostic: the leading hub's knowledge-production index (the same
// formula as settlement.js SCI_COMPOUND) every 1500 steps — read it at each era's
// attainment step to set SCI_MED_IDX (the =1 anchor) empirically.
const idxLog = [];
for (let t = 0; t < STEPS; t += 1500) {
  stepPeopleSim(world, 1500);
  let best = 0;
  for (const st of world.settlements) {
    if (st.mode !== "settled") continue;
    const sq = Math.sqrt(st._urbanPop != null ? st._urbanPop : Math.max(0, st.people || 0));
    const reach = st._tradeReach ? st._tradeReach.size : 0;
    const inst = (st._techEff && st._techEff.sciInst) || 1;
    const idx = Math.max(0.02, sq / 28) * Math.max(0.02, reach / 18) * inst;
    if (idx > best) best = idx;
  }
  idxLog.push(world.step + ":e" + ((world._eraAt || [0]).length - 1) + ":" + best.toFixed(2));
}
console.log("step:era:leadIdx  " + idxLog.join(" "));
const NAMES = ["Neolithic", "Bronze", "Iron/Classical", "Medieval", "Renaissance", "Industrial", "Modern"];
const HIST = [-3300, -3000, -700, 500, 1450, 1800, 1950, 2050];  // historical era-start years + endpoint
const ea = world._eraAt || [0];
// Eras are scored to ATTAINMENT: era e spans attained(e) → attained(e+1). The
// final attained era has no successor, so it is OPEN — unscoreable, not "38x too
// long" (the old accrue-to-run-end artifact). Neolithic is the start-up epoch
// (the sim skips the forager phase, so its "duration" measures genesis, not
// history) — printed, excluded from the epoch fit below.
console.log("era            reached@step  dyn-years spent   historical-years   ratio");
const fit = [];
for (let e = 0; e < ea.length; e++) {
  const open = e + 1 >= ea.length;
  const dynY = open ? null : (ea[e + 1] - ea[e]) * 0.25;
  const histY = (HIST[e + 1] ?? 2050) - HIST[e];
  console.log(`${(NAMES[e] || "era" + e).padEnd(15)} ${String(ea[e]).padStart(8)}    ${open ? "    open" : String(Math.round(dynY)).padStart(8)}          ${String(histY).padStart(6)}          ${open ? "  — " : (dynY / histY).toFixed(1) + "x"}`);
  if (e >= 1 && !open) fit.push(HIST[e] - 0.25 * ea[e]);   // epoch each anchor implies (display year = epoch + 0.25·step)
}
if (ea.length < 7) console.log(`(run ends step ${world.step}; later eras not reached)`);
// Best-fit DISPLAY EPOCH: the constant that lines the measured attainments up
// with their historical dates on the uniform 0.25y/step clock (calendar.js
// DISP_START). Mean over the scored anchors (Bronze..last-closed), per-anchor
// spread shown so a single outlier era is visible.
if (fit.length) {
  const mean = fit.reduce((a, b) => a + b, 0) / fit.length;
  console.log(`best-fit display epoch: ${Math.round(mean)} (per-anchor: ${fit.map((v) => Math.round(v)).join(", ")})`);
}
