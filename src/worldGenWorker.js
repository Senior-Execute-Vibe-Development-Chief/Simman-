// ── Web Worker for world generation ──
// Runs generateWorld() off the main thread so the UI stays responsive
// during the 2-5 second generation process — for EVERY preset (tectonic,
// earth, earth_sim, pangaea, random). Only two paths stay on the main
// thread, by design: imported maps (already rasterised there) and the
// Earth-Sim "Real Winds" toggle (the NCEP data set lives in the main
// bundle; duplicating 2.3MB of JSON into this worker isn't worth it —
// WorldSim falls back to main-thread generation for that combination).
//
// Usage: postMessage({ type: 'generate', W, H, seed, preset, oceanLevel, tecParams })
// Returns: postMessage({ type: 'result', world: { elevation, moisture, temperature, ... } })
//       or postMessage({ type: 'error', message, stack })

import { generateWorld } from './worldgen.js';

self.onmessage = function (e) {
  const { type, W, H, seed, preset, oceanLevel, tecParams } = e.data;
  if (type !== 'generate') return;
  try {
    const t0 = performance.now();
    // realWind stays false in the worker (see header); realWindFns omitted.
    const world = generateWorld(W, H, seed, preset, oceanLevel, true, false, tecParams || {});
    const dt = performance.now() - t0;
    console.log(`[Worker] ${preset} world gen complete in ${dt.toFixed(0)}ms`);

    // Transfer typed arrays (zero-copy) back to main thread.
    const transferables = [];
    for (const val of Object.values(world)) {
      if (val && val.buffer instanceof ArrayBuffer) transferables.push(val.buffer);
    }
    self.postMessage({ type: 'result', world, time: dt }, transferables);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message, stack: err.stack });
  }
};
