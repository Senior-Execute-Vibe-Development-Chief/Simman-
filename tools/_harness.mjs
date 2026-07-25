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
  applyTuning({ POP_FIELD_WORKERS: -1, ...SIM_TUNE_OVERRIDES });
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
