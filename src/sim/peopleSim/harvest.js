// ── The yield-variance map — famine proclivity from real factors ──────────────
//
// cv(tile): the coefficient of variation of the ANNUAL harvest — how hard the
// year-to-year swing hits this ground. The harvest-years wave's foundation
// (owner-ratified design 2026-08-24: "actual year to year production swing
// across the globe, based on real factors... wrapped into real output"): the
// annual harvest index multiplies landFood with this map as its amplitude,
// famine DERIVES from the tail, and LEAN_YEAR's founding margin grounds
// per-basin in the same statistic.
//
// Calibrated against literature yield-CV bands (FAO yield-variability studies +
// historical famine literature) over 12 real regions, in the OBSERVED-climate
// regime — the app's own (real NCEP precipitation/temperature through the
// quantile map), so the constants were tuned against near-true inputs rather
// than against the solver's errors, exactly as biomeClass.js was calibrated.
// tools/probe_yieldcv.mjs is the referee; tools/probe_moistcal.mjs is the
// input-side instrument that grounded the axes (2026-08-25).
//
// FOUR real factors, each with a physical name — and the moisture-calibration
// lap's central finding baked in: the raw moisture index is PRECIPITATION-like
// ("how much water this ground gets"), so any consumer reading it as ARIDITY
// against a flat global threshold conflates cool-wet with hot-dry (the recorded
// "Britain ≈ Mesopotamia" debt, which mis-fed the forest signal and then this
// map). Aridity is water vs evaporative DEMAND — biomeClass's own calibrated
// Holdridge layer:  em = moist / demand(temp).  Under em, England reads ~0.7-0.9
// and Mesopotamia ~0.03-0.10 in BOTH climate regimes — the debt dissolves
// without touching the index itself (the same one-language fix CANOPY_CLASS
// applied to forests).
//
//   RAIN MARGIN   — rain-fed CV rises as effective moisture em nears the crop
//                   minimum: margin = (EM0 − em)/EM_RAMP clamped 0..1.
//                   England-class (em ≳ 0.7) → 0; Sahel-class (em ~0.3) → ~0.5;
//                   desert margin → 1. EM0 0.55 sits at the ~38th percentile of
//                   land in both regimes — the semi-arid onset.
//   SEASONALITY   — one-rainy-season regimes bet the year on one season. TWO
//                   real signals, max() of:
//                   · Gaussen dry-season length (dryFrac): peak at df 0.5 (the
//                     half-dry year — mediterranean/Sahel/monsoon-with-arid-
//                     months); a desert's 12 dry months are the margin term's
//                     business, a rainforest's 0 needs none.
//                   · warm-half rain concentration (warmRainFrac): the East-
//                     Asian monsoon stacks ~90% of rain in the warm half yet
//                     shows FEW Gaussen-arid months (cold winters demand no
//                     water — N.China df 0.12, wf 0.88). Gated on real seasons
//                     existing (tAmp ≥ 4°C): in the low-amplitude tropics the
//                     "warmest six months" are the pre-rain heat, not a season
//                     axis (the Sahel reads wf 0.32 for that reason).
//   WINTER RISK   — the continental margin: winterkill / spring frost / the
//                   short season squeezed between frost and drought. Keyed on
//                   the COOL-HALF mean temperature (t − tAmp), NOT amplitude
//                   alone: Mesopotamia's 9.6°C amplitude is scorching summers
//                   over a mild winter (cool-half +13°C — no winter risk),
//                   while Kazakhstan's 11.8°C is a −8°C cool half. This is the
//                   axis that separates maritime England (CV ~0.10) from the
//                   Pontic/Kazakh steppe (0.25-0.42) at the SAME annual water.
//   FLOOD REGIME  — river-fed floodplains decouple from local rain (damping
//                   the rain terms) but carry their own flood variance: the
//                   pre-dam Nile's bad-flood years ran yield CV ~15-25% — the
//                   literal seven lean years. TWO signals (see yieldCvAt):
//                   the pipeline's arid-river floodplain mask tFlood (full
//                   flood regime — the Tigris-Euphrates never exceeds mag 2
//                   in-grid, so mag bars alone cannot see Mesopotamia), and
//                   the channel band (riverMag ≥ 2 navigable, ≥ 3 major:
//                   mag 2 → 0, mag 5+ → full) over the 3×3 neighbourhood
//                   (flood farms sit BESIDE the channel) for partial
//                   decoupling in rain-fed valleys.
//
//   cvRain = BASE + MARGIN·rainMargin + SEASON·seasonal·(1 − rainMargin/2)
//   cv     = cvRain·(1−water) + FLOOD·water + WINTER·winterRisk
//   (winter stays OUTSIDE the flood damp: a frozen valley is frozen however
//    well it floods; the Nile has no frost and loses nothing.)
//
// REGIME NOTE (from probe_moistcal, 2026-08-25): in the observed regime every
// axis reads near-truth. In the SOLVER regime the formula is identical but
// inherits the solver's own input errors, all measured and named: the Sahel/
// S.India/N.China moisture pattern (solver em too wet), dryFrac saturation
// (temperate lands read 12 Gaussen-dry months — the fixed 0.55 threshold),
// the weak seasonal PHASE (warmRainFrac misses the monsoon concentration —
// the recorded MED-classifier limitation), and sub-grid great rivers
// (Tigris-Euphrates below mag 3 at tw=240). Those are solver-skill debts
// tracked by probe_climate_truth, not formula constants to bend.

import { demand } from "../biomeClass.js";

// Calibration constants (real-data-anchored; see the header and the probe).
export const CV_BASE = 0.10;    // reliably-watered temperate floor (England/Java-class)
export const CV_MARGIN = 0.35;  // added at the full semi-arid margin (desert-edge rain farming ≈ 0.45)
export const CV_SEASON = 0.12;  // added at full one-season concentration
export const CV_WINTER = 0.17;  // added at the full continental cold margin (Kazakh-class; 0.16 left the Pontic 0.01 under its band floor — the 12-region table is the referee)
export const CV_FLOOD = 0.20;   // the flood-regime CV a fully river-fed valley converges to (pre-dam Nile)
export const CV_EM0 = 0.55;     // effective-moisture semi-arid onset (em units, m/demand)
export const CV_EM_RAMP = 0.50; // em span from onset to the full margin
export const CV_COOL0 = 6;      // °C cool-half mean below which winter risk engages
export const CV_COOL_RAMP = 13; // °C span to the full winter margin (≈ −7°C cool half)

/**
 * The yield CV at one tile. `chan` is the best river channel serving the tile
 * (the 3×3-neighbourhood max the map pass computes, or the banded field once
 * the sim carries one); `flood` is the pipeline's arid-river floodplain verdict
 * (world.tFlood) — the caller supplies both so this stays a pure formula.
 *
 * Two water signals because they answer different questions. The CHANNEL band
 * ((chan−2)/3, the codebase's absolute mag convention) reads partial flood
 * decoupling in land that also has rain (the Yellow River through the North
 * China plain). The FLOOD MASK is the pipeline's own physics saying "this
 * ground is arid and a river waters it" — at ANY channel size, which matters
 * because a great river can be grid-thin: the Tigris-Euphrates never exceeds
 * mag 2 at tw≤480 (probe_floodmask 2026-08-25), so every mag bar reads
 * Mesopotamia as rain-fed desert while the floodplain mask sees the valley.
 * @param {object} world  sim world (moist/temp/_dryFrac/_warmRainFrac/_tAmp)
 * @param {number} i      tile index
 * @param {number} chan   river channel magnitude feeding the tile (0 if none)
 * @param {number} flood  1 if the tile is arid-river floodplain (world.tFlood)
 */
export function yieldCvAt(world, i, chan, flood) {
  const m = world.moist[i], t = world.temp[i];
  const em = m / demand(t);
  const rainMargin = Math.max(0, Math.min(1, (CV_EM0 - em) / CV_EM_RAMP));
  // seasonality: Gaussen dry-season shape ∨ (amplitude-gated) monsoon concentration
  const df = world._dryFrac ? world._dryFrac[i] : 0;
  const gaussen = Math.max(4 * df * (1 - df) - 0.5, 0) * 2;   // 0 at df 0 or 1, 1 at df 0.5
  const ampC = world._tAmp ? world._tAmp[i] * 100 : 0;        // °C (absent on loaded saves → axis off)
  const wf = world._warmRainFrac ? world._warmRainFrac[i] : 0.5;
  const monsoon = ampC >= 4 ? Math.max(0, (Math.abs(wf - 0.5) * 2 - 0.3) / 0.7) : 0;
  const seasonal = Math.max(gaussen, monsoon);
  // winter risk: cool-half mean temperature (°C)
  const coolT = (t - 0.6) * 100 - ampC;
  const winterRisk = ampC > 0 ? Math.max(0, Math.min(1, (CV_COOL0 - coolT) / CV_COOL_RAMP)) : 0;
  const water = flood ? 1 : Math.max(0, Math.min(1, (chan - 2) / 3));
  const cvRain = CV_BASE + CV_MARGIN * rainMargin + CV_SEASON * seasonal * (1 - rainMargin * 0.5);
  return cvRain * (1 - water) + CV_FLOOD * water + CV_WINTER * winterRisk;
}

/**
 * The whole map, computed once per world from static climate fields and cached.
 * Channel read: 3×3 neighbourhood max of riverMag (flood farms sit BESIDE the
 * channel — the Nile's median cropland tile is mag 1 next to a mag-4 channel).
 */
export function ensureYieldCv(world) {
  if (world._yieldCv) return world._yieldCv;
  const { tw, th, N } = world;
  const rm = world.riverMag;
  const cv = new Float32Array(N);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const i = ty * tw + tx;
    if (world.elev[i] <= 0) continue;
    let chan = 0;
    if (rm) {
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ty + dy; if (yy < 0 || yy >= th) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const v = rm[yy * tw + (((tx + dx) % tw) + tw) % tw];
          if (v > chan) chan = v;
        }
      }
    }
    cv[i] = yieldCvAt(world, i, chan, world.tFlood ? world.tFlood[i] : 0);
  }
  world._yieldCv = cv;
  return cv;
}
