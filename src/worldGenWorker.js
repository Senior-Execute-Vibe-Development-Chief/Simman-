// ── Web Worker for world generation ──
// Runs generateWorld() off the main thread so the UI stays responsive
// during the 2-5 second generation process.
//
// Usage: postMessage({ type: 'generate', W, H, seed, preset, oceanLevel, realWind, tecParams })
// Returns: postMessage({ type: 'result', world: { elevation, moisture, temperature, windX, windY, ... } })
//
// All heavy computation (tectonic gen, wind solver, moisture solver) runs here.

import { generateTectonicWorld } from './tectonicGen.js';

// ── Noise functions (copied from WorldSim.jsx to be self-contained) ──
const PERM = new Uint8Array(512);
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

function initNoise(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

function noise2D(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  const d = (g, x2, y2) => GRAD[g % 8][0] * x2 + GRAD[g % 8][1] * y2;
  const l1 = d(aa, xf, yf) + u * (d(ba, xf - 1, yf) - d(aa, xf, yf));
  const l2 = d(ab, xf, yf - 1) + u * (d(bb, xf - 1, yf - 1) - d(ab, xf, yf - 1));
  return l1 + v * (l2 - l1);
}

function fbm(x, y, o, l, g) {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < o; i++) {
    v += noise2D(x * f, y * f) * a;
    m += a; a *= g; f *= l;
  }
  return v / m;
}

function ridged(x, y, oct, lac, gain, off) {
  let v = 0, a = 1, f = 1, w = 1, m = 0;
  for (let i = 0; i < oct; i++) {
    let s = off - Math.abs(noise2D(x * f, y * f));
    s *= s; s *= w; w = Math.min(1, Math.max(0, s * gain));
    v += s * a; m += a; a *= 0.5; f *= lac;
  }
  return v / m;
}

function worley(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const h1 = PERM[(PERM[(cx & 255)] + ((cy & 255))) & 511];
    const h2 = PERM[(h1 + 73) & 511];
    const px = cx + (h1 / 255), py = cy + (h2 / 255);
    const dd = (x - px) * (x - px) + (y - py) * (y - py);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  return [Math.sqrt(d1), Math.sqrt(d2)];
}

function mkRng(s) {
  s = ((s % 2147483647) + 2147483647) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

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
