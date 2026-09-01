/* V2 — dominant-river-tracing sampler for the baked real flow directions
 * (riverDirData.js; recorded deviation, QUESTIONS.md #21).
 *
 * Projects the 1920x960 HydroSHEDS-derived direction raster onto any sim
 * grid (tw,th ≤ raster): each sim cell is represented by its highest-
 * accumulation raster cell, whose flow path is walked until it settles in
 * another sim cell — that fixes the sim cell's D8 direction. All-integer
 * (no transcendentals: tri-engine hash identity); cycles the projection
 * creates are broken deterministically toward the next cell along the same
 * path, terminal as last resort.
 *
 * Returns Uint8Array(tw*th): 0-7 = D8 rose (E=0,SE=1,S=2,SW=3,W=4,NW=5,
 * N=6,NE=7), 8 = terminal inland sink, 255 = no data (ocean / polar
 * fringe) — callers derive those cells from elevation as before.
 */
import {
  RIVER_DIR,
  RIVER_GRAD,
  RIVER_DIR_W,
  RIVER_DIR_H,
  RIVER_DIR_TERMINAL,
  RIVER_DIR_NODATA,
  RIVER_GRAD_NODATA,
  RIVER_GRAD_PER_M_KM,
  decodeRiverDir,
} from "./riverDirData.js";

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const MAX_TRACE = 96;

let fineDir = null;
let fineAcc = null;
const cache = new Map();

function ensureFine() {
  if (fineDir) return;
  fineDir = decodeRiverDir(RIVER_DIR);
  const W = RIVER_DIR_W, H = RIVER_DIR_H, n = W * H;
  const targetIdx = new Int32Array(n).fill(-1);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const d = fineDir[i];
    if (d > 7) continue;
    const y = (i / W) | 0;
    const ny = y + D8_DY[d];
    if (ny < 0 || ny >= H) continue;
    const j = ny * W + ((i - y * W + D8_DX[d] + W) % W);
    targetIdx[i] = j;
    indeg[j]++;
  }
  fineAcc = new Uint32Array(n).fill(1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], j = targetIdx[i];
    if (j >= 0) {
      fineAcc[j] += fineAcc[i];
      if (--indeg[j] === 0) queue[tail++] = j;
    }
  }
}

// Nearest D8 rose index for a (dx,dy) sim-cell displacement, 22.5° sector
// boundaries via integer cross-multiplication (70/29 ≈ 1/tan 22.5°).
function rose(dx, dy) {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  const minor = ax < ay ? ax : ay;
  const major = ax < ay ? ay : ax;
  if (minor * 70 >= major * 29) {
    if (dx > 0) return dy > 0 ? 1 : 7;
    return dy > 0 ? 3 : 5;
  }
  if (ax >= ay) return dx > 0 ? 0 : 4;
  return dy > 0 ? 2 : 6;
}

export function sampleRiverDirections(tw, th) {
  return sampleRivers(tw, th).dirs;
}

/**
 * Baked channel-floor reach gradients (m/km; QUESTIONS.md #22) projected to
 * the sim grid at each cell's dominant channel — -1 where no data (the
 * caller falls back to its own estimate).
 */
export function sampleRiverReachGradients(tw, th) {
  return sampleRivers(tw, th).grads;
}

function sampleRivers(tw, th) {
  const key = tw + "x" + th;
  const cached = cache.get(key);
  if (cached) return cached;
  ensureFine();
  const W = RIVER_DIR_W, H = RIVER_DIR_H;
  const out = new Uint8Array(tw * th).fill(RIVER_DIR_NODATA);
  // Per-sim-cell member lists (fine data cells), via counting sort.
  // fine cell (fx,fy) belongs to sim cell (floor(fx*tw/W), floor(fy*th/H)).
  const memberCount = new Int32Array(tw * th);
  for (let fy = 0; fy < H; fy++) {
    const oy = ((fy * th) / H) | 0;
    for (let fx = 0; fx < W; fx++) {
      if (fineDir[fy * W + fx] === RIVER_DIR_NODATA) continue;
      memberCount[oy * tw + (((fx * tw) / W) | 0)]++;
    }
  }
  const memberStart = new Int32Array(tw * th + 1);
  for (let o = 0; o < tw * th; o++) memberStart[o + 1] = memberStart[o] + memberCount[o];
  const members = new Int32Array(memberStart[tw * th]);
  const fill = Int32Array.from(memberStart.subarray(0, tw * th));
  for (let fy = 0; fy < H; fy++) {
    const oy = ((fy * th) / H) | 0;
    for (let fx = 0; fx < W; fx++) {
      const fi = fy * W + fx;
      if (fineDir[fi] === RIVER_DIR_NODATA) continue;
      const o = oy * tw + (((fx * tw) / W) | 0);
      members[fill[o]++] = fi;
    }
  }
  // A sim cell POOLS only if the WHOLE cell drains inward: try its fine
  // cells in descending accumulation order and take the first whose path
  // leaves the cell (exits into a neighbour, or discharges into the sea).
  // A sub-grid playa or marsh slough that happens to carry the local
  // maximum must not swallow a through-river the same cell contains.
  const rep = new Int32Array(tw * th).fill(-1);
  const candidates = new Int32Array(tw * th * 3).fill(-1);
  const REP_TRIES = 12;
  const roseFor = (o, target) => {
    const oy = (o / tw) | 0;
    const cy = (target / tw) | 0;
    let dx = (target - cy * tw) - (o - oy * tw);
    if (dx > tw / 2) dx -= tw;
    if (dx < -tw / 2) dx += tw;
    return rose(dx, cy - oy);
  };
  for (let o = 0; o < tw * th; o++) {
    const start = memberStart[o];
    const end = memberStart[o + 1];
    if (start === end) continue;
    // Order this cell's members by accumulation, descending (insertion into
    // a small try-list — cells hold few members at any supported ratio).
    const tries = [];
    for (let m = start; m < end; m++) {
      const fi = members[m];
      let at = tries.length;
      while (at > 0 && fineAcc[tries[at - 1]] < fineAcc[fi]) at--;
      if (at < REP_TRIES) {
        tries.splice(at, 0, fi);
        if (tries.length > REP_TRIES) tries.pop();
      }
    }
    let resolved = false;
    for (const tryRep of tries) {
      let fi = tryRep;
      let found = 0;
      let arrival = -1;
      candidates[o * 3] = -1;
      candidates[o * 3 + 1] = -1;
      candidates[o * 3 + 2] = -1;
      for (let step = 0; step < MAX_TRACE && found < 3; step++) {
        const d = fineDir[fi];
        if (d === RIVER_DIR_TERMINAL) {
          // Unrescued pocket: hop onto the strongest adjacent BYPASSING
          // channel (one not flowing into this cell) — a braid pond spills
          // into the distributary beside it; a true sink never qualifies
          // because all its directed neighbours flow into it.
          const fy0 = (fi / W) | 0;
          const fx0 = fi - fy0 * W;
          let hop = -1;
          let hopAcc = -1;
          for (let hd = 0; hd < 8; hd++) {
            const ny0 = fy0 + D8_DY[hd];
            if (ny0 < 0 || ny0 >= H) continue;
            const j = ny0 * W + ((fx0 + D8_DX[hd] + W) % W);
            const jd = fineDir[j];
            if (jd > 7) continue;
            const jy = (j / W) | 0;
            const jny = jy + D8_DY[jd];
            if (jny >= 0 && jny < H
              && jny * W + ((j - jy * W + D8_DX[jd] + W) % W) === fi) continue;
            if (fineAcc[j] > hopAcc) { hopAcc = fineAcc[j]; hop = j; }
          }
          if (hop < 0) break; // pooled inside — try the next member
          fi = hop;
          const hy = (fi / W) | 0;
          const cc = (((hy * th) / H) | 0) * tw + ((((fi % W) * tw) / W) | 0);
          if (cc !== o && (found === 0 || candidates[o * 3 + found - 1] !== cc)) {
            candidates[o * 3 + found] = cc;
            found++;
          }
          continue;
        }
        if (d === RIVER_DIR_NODATA) {
          if (found === 0 && arrival >= 0) {
            // Reached the sea inside the cell: extend along the arrival
            // direction far enough to cross a whole sim cell so the mouth
            // discharges instead of pooling.
            const maxExtend = (((3 * W) / tw) | 0) + 2;
            let mx = fi % W;
            let my = (fi / W) | 0;
            for (let extend = 0; extend < maxExtend; extend++) {
              mx = (mx + D8_DX[arrival] + W) % W;
              my += D8_DY[arrival];
              if (my < 0 || my >= H) break;
              const cc = (((my * th) / H) | 0) * tw + (((mx * tw) / W) | 0);
              if (cc !== o) { candidates[o * 3] = cc; found = 1; break; }
            }
          }
          break;
        }
        const fy = (fi / W) | 0;
        const ny = fy + D8_DY[d];
        if (ny < 0 || ny >= H) break;
        fi = ny * W + ((fi - fy * W + D8_DX[d] + W) % W);
        arrival = d;
        const cc = (((ny * th) / H) | 0) * tw + ((((fi % W) * tw) / W) | 0);
        if (cc !== o && (found === 0 || candidates[o * 3 + found - 1] !== cc)) {
          candidates[o * 3 + found] = cc;
          found++;
        }
      }
      if (found > 0) {
        rep[o] = tryRep;
        out[o] = roseFor(o, candidates[o * 3]);
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      rep[o] = tries[0];
      candidates[o * 3] = -1;
      candidates[o * 3 + 1] = -1;
      candidates[o * 3 + 2] = -1;
      out[o] = RIVER_DIR_TERMINAL;
    }
  }
  // Break projection cycles deterministically.
  const targetOf = (o) => {
    const d = out[o];
    if (d > 7) return -1;
    const oy = (o / tw) | 0;
    const ny = oy + D8_DY[d];
    if (ny < 0 || ny >= th) return -1;
    return ny * tw + ((o - oy * tw + D8_DX[d] + tw) % tw);
  };
  for (let round = 0; round < 5; round++) {
    let broken = 0;
    const stamp = new Int32Array(tw * th).fill(-1);
    const resolved = new Uint8Array(tw * th);
    for (let s = 0; s < tw * th; s++) {
      if (out[s] > 7 || resolved[s]) continue;
      let o = s;
      const path = [];
      while (o >= 0 && !resolved[o] && out[o] <= 7) {
        if (stamp[o] === s) {
          // Repair the weakest cycle cell that HAS an escape candidate —
          // checking every cell before giving up: a terminal fallback on a
          // mainstem dams the whole river upstream.
          const cycle = [o];
          for (let c = targetOf(o); c !== o && c >= 0; c = targetOf(c)) cycle.push(c);
          cycle.sort((a, b) =>
            (rep[a] >= 0 ? fineAcc[rep[a]] : 0) - (rep[b] >= 0 ? fineAcc[rep[b]] : 0));
          let fixed = false;
          for (const cell of cycle) {
            for (let k = 1; k < 3 && !fixed; k++) {
              const cand = candidates[cell * 3 + k];
              if (cand >= 0 && !cycle.includes(cand)) {
                out[cell] = roseFor(cell, cand);
                fixed = true;
              }
            }
            if (fixed) break;
          }
          if (!fixed) out[cycle[0]] = RIVER_DIR_TERMINAL;
          broken++;
          break;
        }
        stamp[o] = s;
        path.push(o);
        o = targetOf(o);
      }
      for (const cell of path) resolved[cell] = 1;
    }
    if (broken === 0) break;
  }
  // Safety net: any cell still on a cycle after the repair rounds becomes a
  // terminal sink outright — a handful of cells at most, and a cycle in
  // flowDir would corrupt every downstream walk.
  {
    const state = new Uint8Array(tw * th); // 0 unvisited, 1 in progress, 2 done
    for (let s = 0; s < tw * th; s++) {
      if (state[s] !== 0 || out[s] > 7) continue;
      const path = [];
      let o = s;
      while (o >= 0 && out[o] <= 7 && state[o] === 0) {
        state[o] = 1;
        path.push(o);
        o = targetOf(o);
      }
      if (o >= 0 && state[o] === 1) out[o] = RIVER_DIR_TERMINAL; // closed the loop on itself
      for (const cell of path) state[cell] = 2;
    }
  }
  // Project the baked floor gradients at each sim cell's representative.
  const fineGrad = decodeRiverDir(RIVER_GRAD);
  const grads = new Float64Array(tw * th).fill(-1);
  for (let o = 0; o < tw * th; o++) {
    const fi = rep[o];
    if (fi < 0) continue;
    const g = fineGrad[fi];
    if (g !== RIVER_GRAD_NODATA) grads[o] = g / RIVER_GRAD_PER_M_KM;
  }
  const entry = { dirs: out, grads };
  cache.set(key, entry);
  return entry;
}
