// ── Web Worker for world generation ──
// Runs generateWorld() off the main thread so the UI stays responsive
// during the 2-5 second generation process.
//
// Usage: postMessage({ type: 'generate', W, H, seed, preset, oceanLevel, realWind, tecParams })
// Returns: postMessage({ type: 'result', world: { elevation, moisture, temperature, windX, windY, ... } })
//
// All heavy computation (tectonic gen, wind solver, moisture solver) runs here.

import { generateTectonicWorld } from './tectonicGen.js';
// Deterministic noise + RNG — single source of truth (was duplicated here
// verbatim; the copies drifted only in formatting). worldgenUtils owns the PERM
// table, so the imported initNoise/noise2D/fbm/ridged/worley share one seed.
import { initNoise, noise2D, fbm, ridged, worley } from './worldgenUtils.js';

// ── Message handler ──
self.onmessage = function(e) {
  const { type, W, H, seed, preset, oceanLevel, realWind, tecParams } = e.data;

  if (type === 'generate') {
    try {
      const t0 = performance.now();
      initNoise(seed);

      if (preset !== 'tectonic') {
        self.postMessage({ type: 'fallback', preset });
        return;
      }

      const nf = { initNoise, fbm, ridged, noise2D, worley };
      const tec = generateTectonicWorld(W, H, seed, nf, tecParams || {});
      const { elevation, moisture, temperature } = tec;

      // ── Post-processing: coastal detection (matches generateWorld lines 407-412) ──
      const RES = 1;
      const ctw = Math.ceil(W / RES), cth = Math.ceil(H / RES);
      const coastal = new Uint8Array(ctw * cth);
      for (let ty = 1; ty < cth - 1; ty++) for (let tx = 0; tx < ctw; tx++) {
        const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
        if (elevation[py * W + px] > 0) {
          outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const wx = ((tx + dx) % ctw + ctw) % ctw, wy = ty + dy;
            if (wy < 0 || wy >= cth) continue;
            const npx = Math.min(W - 1, wx * RES), npy = Math.min(H - 1, wy * RES);
            if (elevation[npy * W + npx] <= 0) { coastal[ty * ctw + tx] = 1; break outer; }
          }
        }
      }

      // ── Post-processing: swamp detection (matches generateWorld lines 414-418) ──
      const swamp = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (elevation[i] > 0 && elevation[i] < 0.025 && moisture[i] > 0.45 && temperature[i] > 0.35) {
          const nv = fbm(x / W * 20 + 300, y / H * 20 + 300, 2, 2, 0.5);
          if (nv > -0.1) swamp[i] = 1;
        }
      }

      const dt = performance.now() - t0;
      console.log(`[Worker] Tectonic world gen complete in ${dt.toFixed(0)}ms`);

      // Build complete world object matching generateWorld return signature
      const result = {
        elevation, moisture, temperature, coastal, swamp,
        pixPlate: tec.pixPlate, windX: tec.windX, windY: tec.windY,
        width: W, height: H, preset: 'tectonic', _seed: seed
      };

      // Transfer typed arrays (zero-copy) back to main thread
      const transferables = [];
      for (const val of Object.values(result)) {
        if (val && val.buffer instanceof ArrayBuffer) {
          transferables.push(val.buffer);
        }
      }

      self.postMessage({ type: 'result', world: result, time: dt }, transferables);
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message, stack: err.stack });
    }
  }
};
