// WHERE does the residual cross-grid drift in the package distance field live?
//
// After the per-tile /rn fix, wheat's land-median distance still reads ~1.23×
// higher at tw=480 than tw=240 (recorded in the CROP_BIOGEO lever desc as the
// open resgate blocker). Hypothesis: the climate toll |Δtemp|+|Δmoist| only
// TELESCOPES on monotone paths — a finer grid resolves more climate NOISE, and
// every resolved wiggle pays twice (up and down). Total variation of a noisy
// field GROWS with sampling resolution; the telescoping claim in the DIFF_CLIM
// desc is only true of the smooth part.
//
// Test: compute land-median package distances at both grids, then recompute at
// the FINE grid with the toll fields box-blurred to the coarse grid's physical
// bandwidth (radius ~rn/2). If the blurred fine-grid medians converge to the
// coarse ones, the drift is noise-variation and bandwidth-normalizing the toll
// is the mechanism-honest fix (a crop adapts to the regional climate BAND, not
// to tile-scale noise).
//
//   node tools/probe_biogeodrift.mjs [seedList]
import { buildSim } from "./_harness.mjs";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";
import { ensureDistFields } from "../src/sim/peopleSim/biogeography.js";

const SEEDS = (process.argv[2] || "8817").split("+").map(Number);

function blur(src, tw, th, r) {
  if (r <= 0) return src;
  const out = new Float32Array(src.length);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= th) continue;
      for (let dx = -r; dx <= r; dx++) {
        sum += src[yy * tw + (((x + dx) % tw) + tw) % tw]; n++;
      }
    }
    out[y * tw + x] = sum / n;
  }
  return out;
}

function medians(world) {
  const pd = world._pkgDist;
  const { elev, N } = world;
  const out = {};
  for (const [id, f] of Object.entries(pd.fields)) {
    const land = [];
    for (let ti = 0; ti < N; ti++) if (elev[ti] > 0 && isFinite(f[ti])) land.push(f[ti]);
    land.sort((a, b) => a - b);
    out[id] = land.length ? land[land.length >> 1] : NaN;
  }
  return out;
}

for (const seed of SEEDS) {
  const rows = {};
  for (const W of [480, 960]) {
    const world = buildSim({ W, H: W / 2, seed });
    ensureDistFields(world);
    rows[`tw=${world.tw}`] = medians(world);
    if (W === 960) {
      // rebuild with bandwidth-normalized toll: blur temp/moist to the
      // reference tile's physical scale, then recompute the fields
      const rn = rNormPop(world);
      const r = Math.max(1, Math.round(rn / 2));
      world.temp = blur(world.temp, world.tw, world.th, r);
      world.moist = blur(world.moist, world.tw, world.th, r);
      world._pkgDist = null;
      ensureDistFields(world);
      rows[`tw=${world.tw} blurred r=${r}`] = medians(world);
    }
  }
  console.log(`\nseed ${seed}  (CROP_BIOGEO=${T.CROP_BIOGEO}, DIFF_CLIM=${T.DIFF_CLIM})  land-median package distance:`);
  const pkgs = Object.keys(Object.values(rows)[0]);
  console.log("  ".padEnd(22) + pkgs.map((p) => p.padStart(9)).join(""));
  for (const [tag, m] of Object.entries(rows)) {
    console.log(`  ${tag.padEnd(20)}` + pkgs.map((p) => (m[p] ?? NaN).toFixed(2).padStart(9)).join(""));
  }
}
