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
import { passRng } from "./rng.js";
import { T } from "./tuning.js";
import { logEvent } from "./events.js";

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
 * THIRD water signal — arid-land agriculture is water-fed BY CONSTRUCTION.
 * Where the rain margin saturates, rain farming cannot exist; whatever
 * cropland the capacity stack built there, it built from water access (the
 * irrigation stack's channel, the floodplain, the ALLUVIUM_COAST delta — its
 * own terms). Charging such land the full rain-fed desert CV (~0.45) describes
 * farms that could not be there: the Nile's ribbon-adjacent bank tiles read
 * fert 0.93 / moist 0.02 / chan 3 (probe_nilebox 2026-08-25), and lower
 * Mesopotamia's cropland is Gulf-delta alluvium on a mag-2 thread. So the
 * flood weight also rises with rainMargin × waterAccess, where waterAccess =
 * max(channel-in-reach (chan−1)/2, coast × 0.5) — the 0.5 is ALLUVIUM_COAST's
 * own weighting, one language with the capacity stack.
 * @param {object} world  sim world (moist/temp/_dryFrac/_warmRainFrac/_tAmp)
 * @param {number} i      tile index
 * @param {number} chan   river channel magnitude feeding the tile (0 if none)
 * @param {number} flood  1 if the tile is arid-river floodplain (world.tFlood)
 */
export function yieldCvParts(world, i, chan, flood) {
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
  const chanBand = Math.max(0, Math.min(1, (chan - 2) / 3));
  const waterAccess = Math.max(Math.max(0, Math.min(1, (chan - 1) / 2)), (world.coast && world.coast[i] ? 0.5 : 0));
  // The cv/annual water blend is THE FLIP-VALIDATED FORM — do not touch it
  // (2026-08-25 lesson, paid three battery rounds: every attempt to "tighten"
  // this term while fixing the founding bars moved seed 777's world and broke
  // its gate; the identical-failure-number pairs in the mixfix run logs are
  // the proof the founding problem never lived here). constructShare — the
  // "water-fed by construction" credit, valid only where rain farming is
  // impossible (rainMargin ≳ 0.7) — is computed for the DEEP-YEAR lift in
  // ensureYieldCv and plays no part in the cv itself.
  const constructShare = Math.max(0, Math.min(1, (rainMargin - 0.7) / 0.3));
  const water = flood ? 1 : Math.max(chanBand, rainMargin * waterAccess);
  const cvRain = CV_BASE + CV_MARGIN * rainMargin + CV_SEASON * seasonal * (1 - rainMargin * 0.5);
  return { cv: cvRain * (1 - water) + CV_FLOOD * water + CV_WINTER * winterRisk,
    cvRain, water, winterRisk, flood, chanBand, waterAccess, constructShare };
}

export function yieldCvAt(world, i, chan, flood) {
  return yieldCvParts(world, i, chan, flood).cv;
}

/**
 * The whole map, computed once per world from static climate fields and cached.
 * Channel read: 3×3 neighbourhood max of riverMag (flood farms sit BESIDE the
 * channel — the Nile's median cropland tile is mag 1 next to a mag-4 channel).
 *
 * TWO maps come out of the same pass (2026-08-25, the play-report lap):
 *   world._yieldCv    — the annual swing amplitude (the harvest years' cv)
 *   world._yieldDeep  — the DEEP-YEAR multiplier (the once-a-century harvest,
 *                       LEAN_YEAR's founding statistic), computed PER WATER
 *                       COMPONENT: the rain-fed share can fail to zero while
 *                       the water-fed share bottoms at the flood regime's own
 *                       deep year. Deriving the deep year from the COMPOSITE
 *                       cv (1 − 2.33·cv) treats a half-irrigated valley as a
 *                       Gaussian with a huge cv — its tail then reads as
 *                       near-total loss and the founding margin explodes
 *                       through the clamp: measured at the app grid, that
 *                       priced Mesopotamia (water ~0.5 delta/channel land)
 *                       and the Levant at 4-5× and OUT OF CIVILIZATION
 *                       (probe_foundbar 1920; the owner's "not a single city
 *                       in the middle east"). The mixture is the honest tail:
 *                       irrigated Mesopotamia keeps its watered half in the
 *                       worst year — which is why Sumer could exist. For pure
 *                       rain land (water 0) it reduces exactly to 1 − 2.33·cv.
 *
 * NO neighbourhood pass on either map (two were measured and killed, run
 * logs 2026-08-25: the fert-weighted MEAN dragged marginal pockets toward
 * their poor surroundings, the richest-fert MAX cheapened bars beside every
 * good tile — each hard-failed seed 777's register). The ghost-tile trap the
 * passes chased (a desert tile beside the Nile wearing max-pooled valley
 * fert) is already priced by the formula's own 3×3 CHANNEL read plus the
 * saturation gate: such a tile sits at rainMargin 1 with the channel in
 * reach, so its construct credit is full and its deep year is the flood
 * regime's. The CV map stays the honest per-tile formula — the validated
 * quantity (11/12 literature regions) and the annual amplitude.
 */
export function ensureYieldCv(world) {
  if (world._yieldCv) return world._yieldCv;
  const { tw, th, N } = world;
  const rm = world.riverMag;
  const cv0 = new Float32Array(N);
  const deep0 = new Float32Array(N);
  // T.ARID_SECURE component maps (construct-water share + rain-side cv) — the
  // annual draw reads them so the year physics agrees with the founding lift.
  const wd0 = T.ARID_SECURE > 0 ? (world._yieldWaterDeep = new Float32Array(N)) : null;
  const cvR0 = T.ARID_SECURE > 0 ? (world._yieldCvRain = new Float32Array(N)) : null;
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
    const parts = yieldCvParts(world, i, chan, world.tFlood ? world.tFlood[i] : 0);
    cv0[i] = parts.cv;
    // The deep year. DEFAULT: the composite 1 − 2.33·cv — the exact physics
    // the 2026-08-25 flip ladder validated, seed 777 included.
    //
    // T.ARID_SECURE lifts it by the per-component mixture where the water IS
    // the farm — the flood mask, or channel/coast access on SATURATED-arid
    // land (constructShare: rain farming impossible, the cropland water-fed
    // by construction). There the rain share fails to zero while the watered
    // share keeps the flood regime's own deep year, which the composite's
    // Gaussian tail cannot see — it reads half-irrigated Mesopotamia as
    // near-total loss and prices it at the 5× clamp, out of civilization at
    // the app grid (probe_foundbar 1920, the owner's empty Middle East).
    // GATED, NOT DEFAULT, after a four-round elimination (mixfix1-6 run
    // logs): the lift alone tells the FOUNDING law "secure" while the ANNUAL
    // draw still swings the same tiles at composite famine amplitude — the
    // maps disagree, desert-coast mints become doom-cities, and seed 777's
    // register bled to 15-17 settlements in every unpaired variant. The lift
    // is only coherent PAIRED with the component-wise annual draw below
    // (updateHarvestYears), so both ride one lever with their own ladder.
    let deep = 1 - 2.33 * parts.cv;
    if (T.ARID_SECURE > 0) {
      const waterDeep = parts.flood ? 1 : parts.constructShare * Math.max(parts.chanBand, parts.waterAccess);
      wd0[i] = waterDeep;
      const mixDeep = waterDeep * (1 - 2.33 * CV_FLOOD)
        + (1 - waterDeep) * Math.max(0, 1 - 2.33 * parts.cvRain)
        - 2.33 * CV_WINTER * parts.winterRisk;
      if (mixDeep > deep) deep = mixDeep;
      cvR0[i] = parts.cvRain;
    }
    deep0[i] = Math.max(0, Math.min(1, deep));
  }
  world._yieldCv = cv0;
  world._yieldDeep = deep0;
  return cv0;
}

// ═════════════════════ THE HARVEST YEARS (T.HARVEST_YEARS) ═════════════════════
// The ANNUAL layer the climate stack was missing. climate.js is the CENTURY
// scale (a global walk + volcanic winters — "cradles barely move"); this is the
// year: every region draws an annual harvest index whose amplitude is its OWN
// yield CV from the map above, spatially correlated at weather-system scale and
// mildly year-persistent (drought runs — the seven lean years). The index
// multiplies each settlement's landFood, so granaries drain, prices move,
// relief flows and unrest rises through the systems that already exist.
//
// FAMINE DERIVES FROM THE TAIL. A famine is no longer a scripted die aimed by
// a vulnerability score (T.FAMINE_CHANCE / FAMINE_SEVERITY / FAMINE_RADIUS —
// retired under this lever): it is the label for a year the physics actually
// produced — the region below its p10 AND losing more than a third of the
// harvest (the old FAMINE_SEVERITY's own loss bar, now met emergently, so
// England famines ~twice a millennium while the Sahel famines chronically —
// each region's real cadence, not a global rate constant).
//
// Determinism: the z-grid advances once per harvest year from
// passRng(world, "harvest") (keyed on step); only _harvestZ is cross-tick
// state (persisted — the settlement whitelist carries _harvestYearMul and the
// standing _famineUntil). Everything else derives.

export const HARVEST_INTERVAL = 2;   // 0.5 yr/tick → a new harvest YEAR every 2 ticks (×G via the caller's _ivl, like CLIMATE_INTERVAL)
const CELL_DEG = 12;                 // weather-system correlation scale (~1300 km): one drought = one region, not one tile, not a continent
const RHO = 0.30;                    // AR(1) year persistence: real interannual yield autocorrelation is low but positive — bad years RUN
const SMOOTH_NORM = Math.sqrt(0.5 * 0.5 + 4 * 0.125 * 0.125);   // unit variance after the 3×3 spatial smooth of iid cells
export const LEAN_Z = -1.28;         // the p10 year by construction (LEAN_YEAR's own statistic)
const FAMINE_LOSS = 0.65;            // famine bar: the year must also destroy >35% of the harvest (1−FAMINE_SEVERITY, the retired lever's own severity, now emergent)
const MUL_FLOOR = 0.15, MUL_CEIL = 1.6;   // sanity clamp on the annual multiplier (a Sahel deep year bottoms at −85%; the pastoral floor and the field carry life)
const HARVEST_CW = Math.ceil(360 / CELL_DEG), HARVEST_CH = Math.ceil(180 / CELL_DEG);

// One standard normal from two uniform draws (Box-Muller), tail-clamped so a
// 1-in-a-billion draw cannot zero a harvest outright.
function gauss(rng) {
  const u1 = Math.max(1e-12, rng()), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z < -3.5 ? -3.5 : z > 3.5 ? 3.5 : z;
}

// The smoothed, unit-variance z read at a tile (bilinear over the coarse grid;
// X wraps, Y clamps). Between cell nodes the interpolation shrinks variance a
// little (~10-20%) — accepted and conservative (less variance, never more).
function zAt(world, tx, ty, zs) {
  const fx = (tx / world.tw) * HARVEST_CW - 0.5, fy = (ty / world.th) * HARVEST_CH - 0.5;
  const cx = Math.floor(fx), cy = Math.max(0, Math.min(HARVEST_CH - 2, Math.floor(fy)));
  const dx = fx - cx, dy = Math.max(0, Math.min(1, fy - cy));
  const x0 = ((cx % HARVEST_CW) + HARVEST_CW) % HARVEST_CW, x1 = (x0 + 1) % HARVEST_CW;
  return (zs[cy * HARVEST_CW + x0] * (1 - dx) + zs[cy * HARVEST_CW + x1] * dx) * (1 - dy)
       + (zs[(cy + 1) * HARVEST_CW + x0] * (1 - dx) + zs[(cy + 1) * HARVEST_CW + x1] * dx) * dy;
}

function smoothZ(raw, zs) {
  for (let cy = 0; cy < HARVEST_CH; cy++) for (let cx = 0; cx < HARVEST_CW; cx++) {
    const xL = (cx + HARVEST_CW - 1) % HARVEST_CW, xR = (cx + 1) % HARVEST_CW;
    const yU = Math.max(0, cy - 1), yD = Math.min(HARVEST_CH - 1, cy + 1);
    zs[cy * HARVEST_CW + cx] = (raw[cy * HARVEST_CW + cx] * 0.5
      + (raw[cy * HARVEST_CW + xL] + raw[cy * HARVEST_CW + xR]
        + raw[yU * HARVEST_CW + cx] + raw[yD * HARVEST_CW + cx]) * 0.125) / SMOOTH_NORM;
  }
}

/** Advance one harvest year and stamp every settled settlement's annual
 *  multiplier + derived famine state. Called from index.js on the
 *  HARVEST_INTERVAL cadence, before the territory/food passes. */
export function updateHarvestYears(world) {
  if (!T.HARVEST_YEARS) return;
  const CN = HARVEST_CW * HARVEST_CH;
  let raw = world._harvestZ;
  if (!raw || raw.length !== CN) raw = world._harvestZ = new Float32Array(CN);
  const rng = passRng(world, "harvest");
  const keep = RHO, fresh = Math.sqrt(1 - RHO * RHO);
  for (let c = 0; c < CN; c++) raw[c] = keep * raw[c] + fresh * gauss(rng);
  let zs = world._harvestZs;
  if (!zs || zs.length !== CN) zs = world._harvestZs = new Float32Array(CN);
  smoothZ(raw, zs);
  // Per-settlement: the year's multiplier, and famine derived from the tail.
  const cv = ensureYieldCv(world);
  const tw = world.tw;
  const yearTicks = Math.max(1, Math.round(HARVEST_INTERVAL / (world._dt || 1)));
  const hitPolities = new Set();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const tx = s.pos.x | 0, ty = s.pos.y | 0;
    const ti = ty * tw + tx;
    const z = zAt(world, tx, ty, zs);
    const c = cv[ti] || 0;
    let mul = 1 + z * c;
    // T.ARID_SECURE: on construct-water land the year is the same mixture the
    // founding lift prices — the watered share swings at the flood regime's
    // amplitude while the rain share can fail outright. Without this half the
    // lift mints cities whose annual draw still famines at composite
    // amplitude (the mixfix doom-city elimination — see ensureYieldCv).
    if (T.ARID_SECURE > 0 && world._yieldWaterDeep) {
      const wd = world._yieldWaterDeep[ti];
      if (wd > 0) mul = wd * (1 + z * CV_FLOOD) + (1 - wd) * Math.max(0, 1 + z * (world._yieldCvRain[ti] || 0));
    }
    mul = Math.max(MUL_FLOOR, Math.min(MUL_CEIL, mul));
    s._harvestYearMul = mul;
    if (z < LEAN_Z && mul < FAMINE_LOSS) {
      const onset = world.step >= (s._famineUntil || 0);   // read BEFORE extending
      // +1 so the window still covers THIS tick at the next year boundary: a
      // famine that persists into year 2 extends seamlessly (no re-logged
      // onset); a recovery year leaves at most one tick of trailing distress.
      s._famineUntil = world.step + yearTicks + 1;         // this famine YEAR (distress/faith/relief consumers unchanged)
      // One event per afflicted realm per onset (the outbreak is the story,
      // not each village's bad harvest) — the retired spawner's own grain.
      if (onset && s.countryId >= 0 && !hitPolities.has(s.countryId)) {
        hitPolities.add(s.countryId);
        logEvent(world, "famine.struck", { polity: s.countryId, x: tx, y: ty });
      }
    }
  }
}
