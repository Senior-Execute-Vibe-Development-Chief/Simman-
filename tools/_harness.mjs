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

/** generateWorld + buildTerritory; returns the legacy harness shape. */
export function buildWorld(opts = {}) {
  const { w, ter } = pipelineBuild(opts);
  return { w, tw: ter.tw, th: ter.th, ter, rivers: ter.rivers, tCrop: ter.tCrop, deposits: ter.deposits };
}

/** Full pipeline → a running people-sim world (tileRes 1, app-identical). */
export function buildSim(opts = {}) {
  const { w, tCrop, deposits } = buildWorld(opts);
  return initPeopleSim(w, { seed: w.seed, tCrop, tileRes: 1, deposits, ...(opts.simOpts || {}) });
}
