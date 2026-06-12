// Shared node-side world pipeline for tools/ scripts.
//
// Replicates the APP's exact path from worldgen to a running people-sim —
// the same arrays, in the same order, with the same boosts — so a probe
// measures the world the browser actually simulates. Source of truth is
// WorldSim.jsx: generate() → finalizeWorld() → createTerritory() →
// initPeopleSim(). If createTerritory changes, change buildWorld to match.
//
// The bits older tools used to skip (and silently diverge on):
//   - river + lake moisture boosts run BEFORE tCrop, so river valleys rate
//     as cropland for the sim exactly like the overlay shows
//   - bDist (plate-boundary distance) feeds cropSuitability's young-soil
//     exemption on tectonic/earth worlds
//   - generateResources receives the BOOSTED moisture and the rivers object
//   - the sim seed comes from the worldgen seed (w.seed alias)
//
// Usage:
//   import { buildWorld, buildSim } from "./_harness.mjs";
//   const { w, tCrop, deposits } = buildWorld({ W: 480, H: 240, seed: 42 });
//   const world = buildSim({ W: 480, H: 240, seed: 42 });   // people-sim world
//   stepPeopleSim(world, 1000);

import { generateWorld } from "../src/worldgen.js";
import { computeRivers, RIVER_STREAM } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim } from "../src/peopleSim/index.js";

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * generateWorld + the sim-relevant half of WorldSim's createTerritory.
 * Returns { w, tw, th, rivers, tCrop, deposits } with w.rivers / w.deposits /
 * w.seed already attached (as finalizeWorld does), ready for initPeopleSim.
 * Tile resolution is 1 (the app's RES), so tile index === pixel index.
 */
export function buildWorld({ W = 480, H = W >> 1, seed = 1, preset = "earth_sim", oceanLevel = 0.78, tecParams = {} } = {}) {
  const w = generateWorld(W, H, seed, preset, oceanLevel, true, false, tecParams);
  if (w.seed == null) w.seed = w._seed ?? seed;

  const tw = W, th = H, N = tw * th;
  // Copies: the boosts below must not touch w.moisture — the sim's initTerrain
  // reads the raw arrays, only tCrop sees the boosted moisture (app parity).
  const tElev = Float32Array.from(w.elevation);
  const tTemp = Float32Array.from(w.temperature);
  const tMoist = Float32Array.from(w.moisture);
  const tCoast = w.coastal;

  // ── River hydrology (uses pre-boost moisture, like the app) ──
  const rivers = computeRivers(tw, th, tElev, tMoist, tTemp);

  // ── River moisture boost (WorldSim createTerritory, verbatim) ──
  const riverMoist = new Float32Array(N);
  {
    const riverRadius = [0, 0, 1, 2, 3];          // NONE,STREAM,TRIB,MAJOR,GREAT
    const riverMoistPeak = [0, 0, 0.25, 0.40, 0.55];
    for (let ti = 0; ti < N; ti++) {
      const mag = rivers.riverMag[ti];
      if (mag < RIVER_STREAM) continue;
      const R = riverRadius[mag], peak = riverMoistPeak[mag];
      if (R < 1) continue;
      const sx = ti % tw, sy = (ti - sx) / tw;
      for (let dy = -R; dy <= R; dy++) {
        const ny = sy + dy; if (ny < 0 || ny >= th) continue;
        for (let dx = -R; dx <= R; dx++) {
          const nx = (sx + dx + tw) % tw;
          const ni = ny * tw + nx;
          if (tElev[ni] <= 0) continue;
          let ddx = Math.abs(dx); if (ddx > tw / 2) ddx = tw - ddx;
          const dist = Math.sqrt(ddx * ddx + dy * dy);
          if (dist > R) continue;
          const effDist = Math.max(dist, 0.8);
          const t2 = effDist / R, falloff = 0.5 + 0.5 * Math.cos(t2 * Math.PI);
          const v = peak * falloff;
          riverMoist[ni] = Math.max(riverMoist[ni], v);
        }
      }
    }
    for (let ti = 0; ti < N; ti++) {
      if (riverMoist[ti] < 0.01) continue;
      const rm = riverMoist[ti], oldMoist = tMoist[ti];
      tMoist[ti] = oldMoist < 0.45 ? Math.min(0.50, oldMoist + rm) : Math.min(1, oldMoist + rm * 0.08);
    }
  }

  // ── Lake moisture boost ──
  if (rivers.lake) {
    const lakeRadius = 3, lakeMoistPeak = 0.20;
    for (let ti = 0; ti < N; ti++) {
      if (rivers.lake[ti] < 0) continue;
      const sx = ti % tw, sy = (ti - sx) / tw;
      for (let dy = -lakeRadius; dy <= lakeRadius; dy++) {
        const ny = sy + dy; if (ny < 0 || ny >= th) continue;
        for (let dx = -lakeRadius; dx <= lakeRadius; dx++) {
          const nx = (sx + dx + tw) % tw;
          const ni = ny * tw + nx;
          if (tElev[ni] <= 0 || rivers.lake[ni] >= 0) continue;
          let ddx = Math.abs(dx); if (ddx > tw / 2) ddx = tw - ddx;
          const dist = Math.sqrt(ddx * ddx + dy * dy);
          if (dist > lakeRadius) continue;
          const effDist = Math.max(dist, 0.8);
          const falloff = 0.5 + 0.5 * Math.cos(effDist / lakeRadius * Math.PI);
          const boost = lakeMoistPeak * falloff;
          const oldM = tMoist[ni];
          tMoist[ni] = oldM < 0.45 ? Math.min(0.50, oldM + boost) : Math.min(1, oldM + boost * 0.08);
        }
      }
    }
    for (let ti = 0; ti < N; ti++) if (rivers.lake[ti] >= 0) tMoist[ti] = 0.8;
  }

  // ── Plate-boundary distance (feeds tCrop's young-soil exemption) ──
  let bDist = null;
  if (w.pixPlate) {
    const plateBound = new Uint8Array(N);
    for (let ti = 0; ti < N; ti++) {
      const tx = ti % tw, ty = (ti - tx) / tw;
      const myP = w.pixPlate[ti];
      for (const [dx, dy] of DIRS) {
        const nx2 = Math.min(tw - 1, Math.max(0, tx + dx)), ny2 = Math.min(th - 1, Math.max(0, ty + dy));
        if (w.pixPlate[ny2 * tw + nx2] !== myP) { plateBound[ti] = 1; break; }
      }
    }
    bDist = new Uint8Array(N); bDist.fill(255);
    const bdQ = [];
    for (let i = 0; i < N; i++) if (plateBound[i] && tElev[i] > 0) { bDist[i] = 0; bdQ.push(i); }
    for (let qi = 0; qi < bdQ.length; qi++) {
      const ci = bdQ[qi], cd = bDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 15) continue;
      for (const [dx, dy] of DIRS) {
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (bDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        bDist[ni] = cd + 1; bdQ.push(ni);
      }
    }
  }

  // ── tCrop: the sim's fertility array ──
  const tCrop = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) {
    const e = tElev[ti];
    if (e <= 0) { tCrop[ti] = 0; continue; }
    tCrop[ti] = cropSuitability(tTemp[ti], tMoist[ti], e, tCoast[ti],
      rivers.riverMag ? rivers.riverMag[ti] : 0, bDist ? bDist[ti] : null);
  }

  // ── Deposits (sees the boosted moisture, like the app) ──
  const deposits = generateResources(tw, th, tElev, tTemp, tMoist, tCoast, w, w._seed || 0, rivers);

  w.rivers = rivers;
  w.deposits = deposits;
  return { w, tw, th, rivers, tCrop, deposits };
}

/**
 * Full pipeline → a running people-sim world (tileRes 1, app-identical).
 * Extra people-sim options (e.g. { _checkInvariants: true } is set via the
 * returned world) ride through `simOpts`.
 */
export function buildSim(opts = {}) {
  const { w, tCrop, deposits } = buildWorld(opts);
  return initPeopleSim(w, { seed: w.seed, tCrop, tileRes: 1, deposits, ...(opts.simOpts || {}) });
}
