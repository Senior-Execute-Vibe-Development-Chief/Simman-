// Node-side world builder for tools/ scripts — a thin veneer over the
// app's own pipeline (src/sim/pipeline.js), so a probe measures exactly
// the world the browser simulates. No duplicated logic lives here.
//
// Usage:
//   import { buildWorld, buildSim } from "./_harness.mjs";
//   const { w, tCrop, deposits } = buildWorld({ W: 480, H: 240, seed: 42 });
//   const world = buildSim({ W: 480, H: 240, seed: 42 });   // people-sim world

import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";
import { initPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
// PROVENANCE STAMP: this session's container has silently reset its checkout
// to a pre-session commit THREE times (2026-08-06), twice mid-measurement —
// probe outputs from the stale tree were nearly published as findings both
// times ("the densest tiles are in Mongolia" came from one). Every harness
// consumer now prints the tree it actually ran on, so a probe output is
// self-identifying and a reset shows up as a wrong hash instead of a wrong
// conclusion. Cheap (once per process), and gates' outputs carry it too.
try {
  const { execSync } = await import("node:child_process");
  const head = execSync("git -C " + JSON.stringify(new URL("..", import.meta.url).pathname) + " rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  console.log(`[harness] tree ${head}`);
} catch { /* not a git checkout (packaged run) — no stamp */ }

// SIM_TUNE env override for calibration sweeps: SIM_TUNE="FISH_RATE=7,FISH_ERAPROD_POW=0.4".
// Lets a probe OR a gate (smoke/stylized) run with non-default levers without editing defaults.
// Parsed SIM_TUNE overrides, exported so snapshot-loading tools can RE-apply
// them after loadWorld — persist.js restores the SAVE's tuning on load
// (reset + saved non-defaults), which silently clobbers any pre-load lever.
export const SIM_TUNE_OVERRIDES = {};
if (process.env.SIM_TUNE) {
  for (const kv of process.env.SIM_TUNE.split(",")) { const [k, v] = kv.split("="); if (k && v !== undefined) SIM_TUNE_OVERRIDES[k.trim()] = +v; }
  console.log("[SIM_TUNE]", JSON.stringify(SIM_TUNE_OVERRIDES));
}

// TOOL DEFAULTS (owner decision 2026-07-25): every tool runs the popField
// worker pool at AUTO (-1 -> bands = cores, capped) unless SIM_TUNE says
// otherwise — proven bit-identical at every setting, so this only moves
// wall-clock, and the heavy tools are where the pool both pays (batteries
// -22%/tick) and accumulates soak for the eventual app default. The APP is
// deliberately NOT covered: its default stays T.POP_FIELD_WORKERS = 0 until
// production hosting sends the COOP/COEP headers (docs/popfield-parallel.md
// §5). Re-apply after ANY loadWorld — persist restores the save's tuning.
export function applyToolTuning() {
  // DAWN_LIVE ships ON for the app (the owner's born-from-nothing world), but
  // the measurement/gate harness pins the SEEDED dawn as its initial condition:
  // the stylized facts, resgate bands and smoke checks are MATURE-REGIME
  // properties, and DEV_INIT_YEARS was always an initial-condition choice —
  // running gates from the empty dawn would measure the Neolithic at their
  // fixed horizons (a semantic fail, not a physics one) at 2-3x wall clock.
  // The live dawn's own battery is the genesis arc suite (probe_cityarc /
  // probe_tribute under SIM_TUNE DAWN_LIVE=1 — docs/state-birth-2026-08.md).
  // An explicit SIM_TUNE override (spread last) still wins for those arcs.
  // STATE_RECORDS (2026-08-19) is pinned OFF for the same reason as DAWN_LIVE:
  // it re-times GENESIS (states wait for the writing bar), and the standing
  // gates measure mature-regime facts at fixed horizons — unpinned they would
  // measure the pre-literate Neolithic instead. Its own battery is the
  // live-dawn genesis suite (SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1"). THE
  // LESSON OF THIS DATE STANDS: any verdict about genesis geography or timing
  // MUST name its dawn regime and run the live arm explicitly — the app ships
  // BOTH levers ON.
  // LAND_KNOW (2026-08-20) joins the pinned set for the same reason: it
  // re-times genesis (cities and tribal nations wait for the tallies bar on
  // the land ledger). Its live arm: SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1".
  // PEER_SEATS (2026-08-20, the mega-catchment wave) joins for the same
  // reason again: it multiplies the genesis register (peer courts inside
  // claimed cells), so the fixed-horizon gates would measure a different
  // world. WAR_FINISH (2026-08-20, the consolidation wave) joins because it
  // re-arms the whole world (fed garrisons / city walls / relative seat
  // grade) and the mature-regime gates were calibrated on the old military
  // balance. THE FULL LIVE ARM IS NOW:
  //   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1"
  applyTuning({ POP_FIELD_WORKERS: -1, DAWN_LIVE: 0, STATE_RECORDS: 0, LAND_KNOW: 0, PEER_SEATS: 0, FOUND_DRIFT: 0, ABSORB_ORG_ERA: 0, TRIBUTE_UP: 0, ENGULF: 0, FEAR_REACH: 0, WAR_FINISH: 0, SMALL_WAR: 0, RELIEF_REACH: 0, EXCH_WAVE: 0, TECH_USE: 0, SETT_STRIDE: 1, TRADE_STRIDE: 3, ...SIM_TUNE_OVERRIDES });
}
applyToolTuning();

/** generateWorld + buildTerritory; returns the legacy harness shape. */
export function buildWorld(opts = {}) {
  const { w, ter } = pipelineBuild(opts);
  return { w, tw: ter.tw, th: ter.th, ter, rivers: ter.rivers, tCrop: ter.tCrop, deposits: ter.deposits };
}

/** Full pipeline → a running people-sim world (tileRes 1, app-identical). */
export function buildSim(opts = {}) {
  const { w, ter, tCrop, deposits } = buildWorld(opts);
  return initPeopleSim(w, { seed: w.seed, tCrop, tFlood: ter.tFlood, tileRes: 1, deposits, tAncestry: ter.tAncestry, terTw: ter.tw, terTh: ter.th, ancestryCount: ter.ancestryCount, ancHue: ter.ancHue, tArrival: ter.tArrival, ...(opts.simOpts || {}) });
}
