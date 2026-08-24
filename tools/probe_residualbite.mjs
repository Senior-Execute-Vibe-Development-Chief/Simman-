// WHY DIDN'T MINT_RESIDUAL BITE? (2026-08-24)
//
// The residual arm measured ~inert (register turnover 385→342, anchors 19→21,
// docs/runs/2026-08-24/*residual*). Before a second design, measure the term:
// at live-regime density, how much of a candidate basin disk is actually
// CLAIMED in world._territoryOwner? If claimed-fraction is small — catchments
// clipped to political ground + tiny worked radii cover little of the peopled
// valley — residual ≈ gross everywhere and the bar never feels the exclusion.
//
// Prints, at each checkpoint, over (a) every settled settlement's site and
// (b) a lattice of peopled candidate tiles in the Egypt box:
//   gross disk mass, residual disk mass, residual/gross, claimed-tile share,
//   and whether the CITY BAR would pass gross vs residual.
//
//   SIM_TUNE="<live arm>" node tools/probe_residualbite.mjs [steps] [W] [seed] [ckpt]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { residualBasinMass } from "../src/sim/peopleSim/crystallize.js";

const STEPS = +(process.argv[2] || 20000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const CKPT = +(process.argv[5] || 4000);
const RBARG = +(process.argv[6] || 0);

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= 20 && la <= 33 && lo >= 24 && lo <= 36; };

// TOWN_BASIN_R = 10 REFERENCE-tiles (crystallize.js:336; ×rNormPop=1 at
// tw=240) — a ~314-tile disk, ~1,670 km radius at this grid. Note the scale:
// the "market catchment" bar asks whether a small country's worth of people
// stand within 1,700 km, which any cradle answers yes everywhere — a finding
// in its own right, measured below alongside the claimed-share question.
const RB = RBARG > 0 ? RBARG : 10;
const grossMass = (tx, ty) => {
  const pf = world.popField; let m = 0;
  for (let dy = -RB; dy <= RB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= TH) continue;
    for (let dx = -RB; dx <= RB; dx++) {
      if (dx * dx + dy * dy > RB * RB) continue;
      m += pf[yy * TW + (((tx + dx) % TW) + TW) % TW];
    }
  }
  return m;
};
const claimedShare = (tx, ty) => {
  const to = world._territoryOwner; if (!to) return 0;
  let n = 0, c = 0;
  for (let dy = -RB; dy <= RB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= TH) continue;
    for (let dx = -RB; dx <= RB; dx++) {
      if (dx * dx + dy * dy > RB * RB) continue;
      const ti = yy * TW + (((tx + dx) % TW) + TW) % TW;
      if (world.elev[ti] <= 0) continue;
      n++; if (to[ti] >= 0) c++;
    }
  }
  return n ? c / n : 0;
};

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
console.log(`\n=== WHY DIDN'T THE RESIDUAL BITE  ${W}x${H} (tw=${TW})  seed ${SEED}  rB=${RB} ===`);
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const bar = world._onePopScale > 0 ? (10 / 0.05) / world._onePopScale : Infinity;   // TIER_CORE[2]/URBAN_SHARE_REF in field units (10-census core / 5% share)
  const ratios = [], shares = [], flip = { grossPass: 0, resPass: 0, n: 0 };
  for (let ty = 0; ty < TH; ty++) {
    for (let tx = 0; tx < TW; tx++) {
      if (!inBox(tx, ty)) continue;
      const ti = ty * TW + tx;
      if (world.elev[ti] <= 0 || !world.popField || world.popField[ti] <= 0) continue;
      if ((tx + ty) % 2) continue;   // lattice thinning
      const g = grossMass(tx, ty);
      if (g <= 0) continue;
      const r = residualBasinMass(world, tx, ty, RB);
      ratios.push(r / g); shares.push(claimedShare(tx, ty));
      flip.n++;
      if (g >= bar) flip.grossPass++;
      if (r >= bar) flip.resPass++;
    }
  }
  console.log(`  step ${String(world.step).padStart(6)}  sites ${String(flip.n).padStart(4)}  residual/gross p10/p50/p90: ${q(ratios, .1).toFixed(2)}/${q(ratios, .5).toFixed(2)}/${q(ratios, .9).toFixed(2)}  claimed-share p50/p90: ${q(shares, .5).toFixed(2)}/${q(shares, .9).toFixed(2)}  CITY BAR pass: gross ${flip.grossPass} vs residual ${flip.resPass}`);
}
console.log(`\n  If residual/gross ≈ 1 and claimed-share is small, the catchment partition`);
console.log(`  covers too little of the peopled valley for the exclusion to reach the bar —`);
console.log(`  the claim ledger is the wrong exclusivity register for the mint.`);
