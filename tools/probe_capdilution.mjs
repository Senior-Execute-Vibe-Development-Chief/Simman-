// Diffusion-pace campaign fix lap (docs/atlas-gap-2026-08-14.md): lap 0 found
// the development clock CURED (org 1.05x at tw=480) and renamed the residual —
// the FIELD carries 0.61x the people per real km2 at the finer grid, with
// cities and claims tracking it exactly. This decomposes the capacity formula
// across grids to name the term that loses mass at 2x resolution: recompute
// capBand's crop formula post-hoc from world fields with each factor
// neutralized in turn; the cross-grid ratio of each variant's Σ (per real
// area) isolates the diluting term. Suspects: the access premium's band width
// (ACCESS_BAND is ON yet dilution persists at 1.63x), the FIELD_CRADLE
// irr/allu 1-D inputs, the devF arrival timing, relief sampling, works.
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_capdilution.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { RM_FULL, ACCESS_RIVER, ACCESS_COAST, ACCESS_DEV0, ACCESS_DEVK, RELIEF_PEN, DEV_BASE, DEV_TECH, WORKS_PRESS } from "../src/sim/peopleSim/popFieldKernel.js";

const STEPS = +(process.argv[2] || 21000), W = +(process.argv[3] || 480), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);

const { elev, fert, relief, moist, N, tw } = world;
const rm = (T.ACCESS_BAND && world._rmBand) ? world._rmBand : world.riverMag;
const coast = (T.ACCESS_BAND && world._coastBand) ? world._coastBand : world.coast;
const devF = world.devField, worksF = world.worksField, pasture = world._pastureCap;
const rn = tw / 240, capPerFert = 1200 / (rn * rn);
const irrB = (T.IRRIG_BOOST || 0) * (T.FIELD_CRADLE || 0), alluB = (T.ALLUVIUM || 0) * (T.FIELD_CRADLE || 0);
const arid0 = T.IRRIG_ARID0 ?? 0.52;

// variant switches: which factor to neutralize (set to 1 / dev to full)
function sumCap(v) {
  let s = 0, landN = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    landN++;
    const water = rm ? Math.min(1, rm[i] / RM_FULL) : 0;
    const cv = coast ? coast[i] : 0;
    const access = v.access ? ACCESS_RIVER * water + ACCESS_COAST * cv : 0;
    const a = devF ? devF[i] : 0;
    const reach = 1 + access * (ACCESS_DEV0 + ACCESS_DEVK * (v.dev ? a : 1));
    const reliefMul = v.relief && relief ? 1 / (1 + RELIEF_PEN * relief[i]) : 1;
    const devMul = v.dev ? (DEV_BASE + DEV_TECH * a) : (DEV_BASE + DEV_TECH);
    const wkMul = v.works && worksF ? 1 + (T.LAND_WORKS || 0) * worksF[i] : 1;
    let crop = (fert ? fert[i] : 0) * capPerFert * devMul * reach * reliefMul * wkMul;
    if (v.cradle && (irrB > 0 || alluB > 0) && devF && moist) {
      const farmTech = Math.min(1, a / 0.5);
      if (farmTech > 0 && (water > 0 || cv > 0)) {
        const arid = Math.max(0, Math.min(1, (arid0 - moist[i]) / 0.20));
        crop *= (1 + irrB * arid * water * farmTech) * (1 + alluB * (water + 0.5 * cv) * farmTech);
      }
    }
    const range = v.pasture && pasture ? pasture[i] : 0;
    s += crop > range ? crop : range;
  }
  return { s, landN };
}

const FULL = { access: 1, dev: 1, relief: 1, works: 1, cradle: 1, pasture: 1 };
const base = sumCap(FULL);
const realCap = (() => { let s = 0; const c = world.capField; for (let i = 0; i < N; i++) if (elev[i] > 0) s += c[i]; return s; })();
const perArea = (x) => x / base.landN * (tw / 240) ** 2;  // mass per REFERENCE-tile-equivalent (real-area-fair)
console.log(`[capdilution] tw=${tw} steps=${STEPS} landN=${base.landN}`);
console.log(`  formulaFull perRefTile=${perArea(base.s).toFixed(1)}  worldCapField perRefTile=${perArea(realCap).toFixed(1)} (post FOOD_K/spikes/tillage)`);
for (const k of ["access", "dev", "relief", "works", "cradle", "pasture"]) {
  const v = { ...FULL, [k]: 0 };
  const r = sumCap(v);
  console.log(`  -${k}: perRefTile=${perArea(r.s).toFixed(1)}  factorMass=${(base.s / r.s).toFixed(3)}x`);
}

// Works-structure section (the campaign's re-aimed lap 2): WHERE the works
// stock's mass lives. IRR_BAND fixed the input's real width but the works
// dilution only moved 0.854 -> 0.871 — the accumulation law itself carries the
// rest. Over irrigable land (irr>0), all quantities dimensionless (shares and
// means over land / irr-land), so the two grids compare directly. This
// discriminates the BREADTH hypothesis (a reference fat tile smears w=1 over
// its whole real area when its core presses, while the fine grid resolves a
// saturated core + unbuilt shoulder — threshold effects do not conserve mass)
// from the SKILL-LAG hypothesis (devF arrives later at the fine grid, and the
// stock integrates skill over its whole build history).
{
  const irrF = world._irrigable, pf = world.popField, capF = world.capField;
  if (worksF && irrF && pf && capF) {
    let nIrr = 0, irrMass = 0, wkMass = 0, nSat = 0, nMid = 0, nZero = 0;
    let pressSum = 0, nPress = 0, excSum = 0, devSum = 0;
    for (let i = 0; i < N; i++) {
      if (!(elev[i] > 0)) continue;
      const a = irrF[i];
      if (!(a > 0)) continue;
      nIrr++; irrMass += a;
      const w = worksF[i];
      wkMass += w;
      if (w >= 0.9) nSat++; else if (w > 0) nMid++; else nZero++;
      const k2 = capF[i], press = k2 > 0 ? pf[i] / k2 : 0;
      pressSum += press; if (press > WORKS_PRESS) nPress++;
      excSum += Math.max(0, press - WORKS_PRESS);
      devSum += devF ? devF[i] : 0;
    }
    console.log(`  [works-structure] irrLand/land=${(100 * nIrr / base.landN).toFixed(2)}% meanIrr(land)=${(irrMass / base.landN).toFixed(4)} meanWk(land)=${(wkMass / base.landN).toFixed(4)}`);
    console.log(`    over irr>0 land: sat(w>=.9)=${(100 * nSat / nIrr).toFixed(1)}%  mid=${(100 * nMid / nIrr).toFixed(1)}%  zero=${(100 * nZero / nIrr).toFixed(1)}%  meanPress=${(pressSum / nIrr).toFixed(3)}  press>thr=${(100 * nPress / nIrr).toFixed(1)}%  meanExcess=${(excSum / nIrr).toFixed(4)}  meanDev=${(devSum / nIrr).toFixed(3)}`);
    // irr term decomposition (_ensureIrr: irr = min(1, water + flood + wet)) —
    // which of the three terms carries the cross-grid mass deficit. Uses the
    // same (banded-when-live) rm the works law sees; at the reference the band
    // equals the raw line, so both grids read their own honest input.
    let wm = 0, flN = 0, wetm = 0, clip = 0;
    const tFl = world.tFlood;
    for (let i = 0; i < N; i++) {
      if (!(elev[i] > 0)) continue;
      const water = rm ? Math.min(1, rm[i] / RM_FULL) : 0;
      const fl = tFl && tFl[i] ? 0.85 : 0;
      const wet = Math.max(0, ((moist ? moist[i] : 0) - 0.55) / 0.45) * 0.6;
      wm += water; if (fl > 0) flN++; wetm += wet;
      const v = water + fl + wet; clip += v > 1 ? 1 : v;
    }
    console.log(`    irr terms (mean over land): water=${(wm / base.landN).toFixed(4)}  floodShare=${(100 * flN / base.landN).toFixed(2)}% (mass ${(0.85 * flN / base.landN).toFixed(4)})  wet=${(wetm / base.landN).toFixed(4)}  clippedSum=${(clip / base.landN).toFixed(4)}`);
  }
}
