// ── Simulation calendar ──
// A plain, EXACT, constant-rate clock: the year advances a FIXED amount every
// tick, the same rate from the first step to the last — no anchoring to eras, no
// pinning to "real history", no acceleration. Step 0 is START_YEAR; each step
// adds YEARS_PER_STEP. That's the whole clock.
//
//   YEARS_PER_STEP = 0.5  →  1 year every 2 ticks (so a ~22000-step run spans
//   ~11000 years, 9000 BC → ~2000 AD). Change the two constants to retune the
//   rate or the epoch; the mapping stays linear either way.
const START_YEAR     = -9000;   // the year at step 0 (Neolithic cradles, stone tools)
const YEARS_PER_STEP = 0.5;     // years added per tick — constant, forever

export function stepToYear(step){ return START_YEAR + step * YEARS_PER_STEP; }

export function yearStr(step){ const y=Math.round(stepToYear(step));
  return y<0?`${-y} BC`:`${y} AD`; }

// Inverse mapping: year → step (exact inverse of stepToYear).
// Used by the dynasty layer to give a person born "A years ago" a birth step.
export function yearToStep(year){ return (year - START_YEAR) / YEARS_PER_STEP; }
