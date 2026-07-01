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
if (process.env.SIM_TUNE) {
  const ov = {};
  for (const kv of process.env.SIM_TUNE.split(",")) { const [k, v] = kv.split("="); if (k && v !== undefined) ov[k.trim()] = +v; }
  applyTuning(ov);
  console.log("[SIM_TUNE]", JSON.stringify(ov));
}

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
