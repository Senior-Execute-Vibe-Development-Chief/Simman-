// ── Simulation calendar ──
// A plain, EXACT, constant-rate clock: the year advances a FIXED amount every
// tick, the same rate from the first step to the last — no anchoring to eras, no
// pinning to "real history", no acceleration. Step 0 is START_YEAR; each step
// adds YEARS_PER_STEP. That's the whole clock.
//
//   START_YEAR = -3000, YEARS_PER_STEP = 0.5  →  the clock starts at 3000 BC and
//   adds 1 year every 2 ticks. Change the two constants to retune the epoch or
//   the rate; the mapping stays linear either way.
const START_YEAR     = -3000;   // the year at step 0
const YEARS_PER_STEP = 0.5;     // years added per tick — constant, forever

export function stepToYear(step){ return START_YEAR + step * YEARS_PER_STEP; }

export function yearStr(step){ const y=Math.round(stepToYear(step));
  return y<0?`${-y} BC`:`${y} AD`; }

// Inverse mapping: year → step (exact inverse of stepToYear).
// Used by the dynasty layer to give a person born "A years ago" a birth step.
export function yearToStep(year){ return (year - START_YEAR) / YEARS_PER_STEP; }

// ── DISPLAY calendar: a cosmetic year anchored to the EMERGENT tech era ──
// The mechanic clock above (stepToYear) keeps human-scale durations — a king
// reigns ~50 years whatever the development pace — but its ABSOLUTE position
// drifts hopelessly from the world's actual development (a Renaissance world
// reading "year 10250 AD"). The DISPLAYED year instead tracks how far the world
// has actually come: it's pinned to the historical date each era was reached and
// interpolated between. This is purely a read-only label — it never feeds a
// mechanic — which is exactly how the calendar is meant to be used.
//
// `eraAt` (recorded in the sim, world._eraAt) is the step the LEADING civ first
// reached each era, index 0..N. ERA_ANCHOR is the historical year that era maps
// to. The world begins ~3000 BC (the bronze-age dawn of cities) and each era
// lands near its real date.
const ERA_ANCHOR = [-3300, -3000, -700, 500, 1450, 1800, 1950];
const ERA_TAU = 1400;        // open-era ramp: steps to approach the next era's date
const ERA_MODERN_CAP = 2200; // the Modern frontier eases toward this and never runs away

function anchor(e){ return ERA_ANCHOR[e < 0 ? 0 : e >= ERA_ANCHOR.length ? ERA_ANCHOR.length - 1 : e]; }

export function displayYear(eraAt, step){
  if (!eraAt || !eraAt.length) return stepToYear(step);     // no timeline yet → linear fallback
  let e = 0;
  for (let i = 0; i < eraAt.length; i++){ if (eraAt[i] <= step) e = i; else break; }
  const aE = anchor(e), sE = eraAt[e];
  if (e + 1 < eraAt.length){                                // a COMPLETED era → linear interp to the next
    const aN = anchor(e + 1), sN = eraAt[e + 1];
    const f = sN > sE ? (step - sE) / (sN - sE) : 0;
    return aE + (aN - aE) * (f < 0 ? 0 : f > 1 ? 1 : f);
  }
  if (e + 1 >= ERA_ANCHOR.length)                                     // Modern frontier: ease toward a cap, never runs away
    return aE + (ERA_MODERN_CAP - aE) * (1 - Math.exp(-(step - sE) / (ERA_TAU * 3)));
  return aE + (anchor(e + 1) - aE) * (1 - Math.exp(-(step - sE) / ERA_TAU));   // open era: asymptote toward next
}

export function displayYearStr(eraAt, step){
  const y = Math.round(displayYear(eraAt, step));
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
