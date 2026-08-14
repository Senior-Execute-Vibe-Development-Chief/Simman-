// ── The timeline store: the political map, remembered at ~every year ────────
// Shared by BOTH sim homes — the worker (off-thread) and the main-thread
// fallback — so the history scrubber works identically wherever the sim runs.
//
// Density: a frame every CAPTURE_IVL steps (5 — at the app's era-anchored
// calendar that is at or under ONE DISPLAY YEAR through the historical arc;
// prehistory's longer years just change more slowly, so equal-step frames
// stay ≤1 year apart everywhere it matters). Memory: frames are SPARSE
// DIFFS against the previous frame ([tileIndex, id] pairs — political maps
// change a few hundred tiles per year at most), with a FULL run-length base
// every BASE_EVERY frames to bound reconstruction; a byte budget thins the
// oldest half to every-other-frame when exceeded, so a marathon run degrades
// to 2-year resolution in its distant past instead of eating the heap.
export const CAPTURE_IVL = 5;
const BASE_EVERY = 100;
const BYTE_BUDGET = 160e6;   // ~160MB of frames before the oldest half thins

export function makeTimeline() {
  return { frames: [], bytes: 0, _last: null, _sinceBase: 0 };
}

// The merged AUTHORITATIVE political layer (realm owner, land-nation fill on
// land; −1 elsewhere) — the sim's own truth, not the render-pretty field.
function mergedLayer(world) {
  const N = world.N, co = world._countryOwner, lo = world._landOwner, elev = world.elev;
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = elev[i] > 0 ? (co && co[i] >= 0 ? co[i] : (lo && lo[i] >= 0 ? lo[i] : -1)) : -1;
  }
  return out;
}

function rleEncode(arr) {
  const runs = [];
  let cur = arr[0], len = 1;
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v === cur) len++;
    else { runs.push(cur, len); cur = v; len = 1; }
  }
  runs.push(cur, len);
  return Int32Array.from(runs);
}

/** Capture the current political map as a frame (call every CAPTURE_IVL steps). */
export function captureFrame(tl, world) {
  const layer = mergedLayer(world);
  let frame;
  if (!tl._last || tl._sinceBase >= BASE_EVERY) {
    frame = { step: world.step, base: rleEncode(layer) };
    tl._sinceBase = 0;
    tl.bytes += frame.base.byteLength;
  } else {
    const prev = tl._last, diff = [];
    for (let i = 0; i < layer.length; i++) if (layer[i] !== prev[i]) diff.push(i, layer[i]);
    frame = { step: world.step, diff: Int32Array.from(diff) };
    tl._sinceBase++;
    tl.bytes += frame.diff.byteLength;
  }
  tl.frames.push(frame);
  tl._last = layer;
  // Byte budget: thin the OLDEST HALF to every-other frame (diffs must merge
  // forward — simplest correct thinning: drop a diff frame by folding it into
  // the NEXT diff frame's map; a base frame is never dropped).
  if (tl.bytes > BYTE_BUDGET) {
    const half = tl.frames.length >> 1;
    const kept = [];
    let carry = null;
    for (let i = 0; i < tl.frames.length; i++) {
      const f = tl.frames[i];
      if (i >= half || f.base || (i & 1) === 0) {
        if (carry && f.diff) {
          const m = new Map();
          for (let j = 0; j < carry.length; j += 2) m.set(carry[j], carry[j + 1]);
          for (let j = 0; j < f.diff.length; j += 2) m.set(f.diff[j], f.diff[j + 1]);
          const merged = [];
          for (const [k, v] of m) merged.push(k, v);
          f.diff = Int32Array.from(merged);
          carry = null;
        }
        kept.push(f);
      } else {
        carry = carry ? (() => {
          const m = new Map();
          for (let j = 0; j < carry.length; j += 2) m.set(carry[j], carry[j + 1]);
          for (let j = 0; j < f.diff.length; j += 2) m.set(f.diff[j], f.diff[j + 1]);
          const merged = [];
          for (const [k, v] of m) merged.push(k, v);
          return Int32Array.from(merged);
        })() : f.diff;
      }
    }
    tl.frames = kept;
    tl.bytes = 0;
    for (const f of tl.frames) tl.bytes += (f.base || f.diff).byteLength;
  }
}

/** Number of frames available to scrub. */
export function frameCount(tl) { return tl.frames.length; }

/** Reconstruct frame idx (clamped) → { step, claim:Int32Array }. */
export function frameAt(tl, idx, N) {
  if (!tl.frames.length) return null;
  const i = Math.max(0, Math.min(tl.frames.length - 1, idx | 0));
  // walk back to the governing base
  let b = i;
  while (b > 0 && !tl.frames[b].base) b--;
  const out = new Int32Array(N);
  const runs = tl.frames[b].base;
  let p = 0;
  for (let j = 0; j < runs.length; j += 2) { out.fill(runs[j], p, p + runs[j + 1]); p += runs[j + 1]; }
  for (let f = b + 1; f <= i; f++) {
    const d = tl.frames[f].diff;
    if (d) for (let j = 0; j < d.length; j += 2) out[d[j]] = d[j + 1];
  }
  return { step: tl.frames[i].step, claim: out };
}
