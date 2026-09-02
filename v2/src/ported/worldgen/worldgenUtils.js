/* V2 M1 PORT
 * source: src/sim/worldgenUtils.js; deviations: none.
 * source commit: 97f51dd7c3a3142bfbb366f2e08491f582367e30
 */
// ── Worldgen utilities: deterministic noise + RNG ────────────────────
//
// Extracted from WorldSim.jsx so worldgen code can run headlessly (Node
// tests, future tooling) without dragging React/DOM in. Pure JavaScript;
// uses ONE piece of module-level state — the PERM array for the Perlin
// noise table, set by initNoise(). All noise functions (noise2D, fbm,
// warp, ridged, worley) read PERM. Call initNoise(seed) once per world
// to seed the table, then call the noise functions freely.
//
// Behaviour MUST stay bit-identical to the inline copies that previously
// lived at the top of WorldSim.jsx — worlds generated headlessly need to
// match worlds the browser shows, given the same seed and inputs.

const PERM = new Uint8Array(512);
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

export function initNoise(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

export function noise2D(x, y) {
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

export function fbm(x, y, o, l, g) {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < o; i++) { v += noise2D(x * f, y * f) * a; m += a; a *= g; f *= l; }
  return v / m;
}

// Domain warping: distort coordinates using noise for organic shapes
// (Inigo Quilez technique).
export function warp(x, y, freq, oct, str, off1, off2) {
  const wx = x + fbm(x * freq + off1, y * freq + off1, oct, 2, .5) * str;
  const wy = y + fbm(x * freq + off2, y * freq + off2, oct, 2, .5) * str;
  return [wx, wy];
}

// Ridged multifractal noise: sharp ridges at zero-crossings, feedback-
// weighted.
export function ridged(x, y, oct, lac, gain, off) {
  let v = 0, a = 1, f = 1, w = 1, m = 0;
  for (let i = 0; i < oct; i++) {
    let s = off - Math.abs(noise2D(x * f, y * f));
    s *= s; s *= w; w = Math.min(1, Math.max(0, s * gain));
    v += s * a; m += a; a *= .5; f *= lac;
  }
  return v / m;
}

// Worley (cellular) noise: returns [F1, F2] distances to nearest two
// seed points.
export function worley(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let d1 = 9, d2 = 9;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const h1 = PERM[(PERM[(cx & 255)] + ((cy & 255))) & 511], h2 = PERM[(h1 + 73) & 511];
    const px = cx + (h1 / 255), py = cy + (h2 / 255);
    const dd = (x - px) * (x - px) + (y - py) * (y - py);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  return [Math.sqrt(d1), Math.sqrt(d2)];
}

// Seedable PRNG (Park-Miller); same as peopleSim/rng.js's mkRng, kept
// here to keep worldgen self-contained.
export function mkRng(s) {
  s = ((s % 2147483647) + 2147483647) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// ── Local RELIEF: the vertical range of the 3×3 neighbourhood ─────────
// Cell-MEAN elevation is blind to what a mountain RANGE actually is: a 4000 m
// ridge-and-valley system averages to unremarkable cells (the Alps read ~0.31,
// below every altitude threshold) while a flat plateau of the same mean keeps
// its full height. What resists movement and administration is the local
// VERTICAL RANGE — gorge-and-ridge country — so relief is a first-class terrain
// field: max−min elevation over the 3×3 neighbourhood (x wraps, y clamps; sea
// counts at 0 so coastal scarps read, but pure-ocean cells are 0). Pure function
// of the elevation field → deterministic, preset-agnostic (works for real-Earth
// and tectonic worlds alike), and recomputable anywhere (never persisted).
export function computeRelief(elev, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (elev[i] <= 0) continue;              // ocean: no land relief
      let lo = Infinity, hi = -Infinity;
      for (let ny = y0; ny <= y1; ny++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + w) % w;
          const v = Math.max(0, elev[ny * w + nx]);   // sea floor counts as 0 (a coastal scarp is real relief)
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      out[i] = hi - lo;
    }
  }
  return out;
}
