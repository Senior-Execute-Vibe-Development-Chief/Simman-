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
export function yearToStep(year){ return (year - START_YEAR) / YEARS_PER_STEP; }

// ── Dynasty clock — a SEPARATE, slower uniform clock for human lifespans ──
// The dynasty layer (ages, reigns, lifespans, succession) runs on this, NOT on
// stepToYear above. It must be UNIFORM (so a king reigns ~50 years whatever the
// pace) — the era-anchored display calendar below has a spiky rate and cannot
// time durations. Its rate is HALF the mechanic clock so a full run spans roughly
// 3000 BC → ~2000 AD: the count of sovereigns then fits the displayed history
// (~100 across a realm's life, not ~200 crammed in) and its years sit in the same
// range as the display calendar. Kept separate from stepToYear so retuning ruler
// turnover never disturbs the demographic anchor (which reads stepToYear).
const DYN_START = -3000, DYN_RATE = 0.25;
export function dynYear(step){ return DYN_START + step * DYN_RATE; }
export function dynStep(year){ return (year - DYN_START) / DYN_RATE; }

// ── DISPLAY calendar: the UNIFORM clock ─────────────────────────────────────
// One honest clock. With SCI_COMPOUND on, era durations emerge at ~their
// historical lengths (tools/probe_erapace.mjs: Bronze 1.4×, Medieval 0.9×,
// Renaissance 1.3×, Industrial 1.0×), so the displayed date is simply linear:
// DISP_RATE years per step from DISP_START, chosen so the measured era
// attainments line up with their historical dates (Bronze ≈ 3200 BC, Medieval
// ≈ 500 AD, Industrial ≈ 1800 AD at the calibration run's steps). The old
// era-anchored elastic clock — which stretched years-per-tick to hide the
// flat-ceiling pacing this replaced — is gone; eraAt is accepted and ignored
// for signature compatibility. Still read-only: no mechanic may consume it.
const DISP_START = -4850, DISP_RATE = 0.25;
export function displayYear(eraAt, step){ return DISP_START + Math.max(0, step) * DISP_RATE; }
export function displayStep(eraAt, year){ return (year - DISP_START) / DISP_RATE; }

export function displayYearStr(eraAt, step){
  const y = Math.round(displayYear(eraAt, step));
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
