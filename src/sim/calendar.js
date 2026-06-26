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

// ── DISPLAY calendar: THE clock, anchored to the EMERGENT tech era ──
// The displayed year — and everything timed against it (a ruler's age, a reign's
// length, how often thrones turn over) — tracks how far the world has actually
// DEVELOPED, not a fixed linear count that drifts to "10250 AD". It's pinned to
// the historical date each era was reached and interpolated between. Because the
// dynasty layer measures time on THIS calendar too, reigns and successions pace
// with the displayed years and FIT the displayed history (~100 sovereigns across
// 3000 BC → ~1950 AD, not 200 crammed in). This is read-only — derived from
// emergent development, never an input to a mechanic — exactly as the calendar is
// meant to be used.
//
// `eraAt` (world._eraAt) is the step the LEADING civ first reached each era. The
// curve is piecewise-linear and STRICTLY INCREASING (a floor guarantees time
// never stalls — no immortal rulers — so a slow world's eras simply land late).
const ERA_ANCHOR = [-3300, -3000, -700, 500, 1450, 1800, 1950];
const ERA_FLOOR = 0.04;        // min display-years per step (time never stops; slow worlds drift their eras later)
const ERA_OPEN_STEPS = 2600;   // expected steps to cross an era, for dating the CURRENT (open-ended) era
const ERA_MODERN_CAP = 2200;   // the Modern frontier heads toward this date

function anchor(e){ return ERA_ANCHOR[e < 0 ? 0 : e >= ERA_ANCHOR.length ? ERA_ANCHOR.length - 1 : e]; }

// The display year at the START of each reached era — the historical anchor, but
// never less than what the floor has accrued (so a long, stalled era pushes its
// successors later instead of flat-lining). Strictly increasing.
function eraBoundaries(eraAt){
  const n = eraAt.length, y = new Array(n);
  y[0] = anchor(0);
  for (let e = 1; e < n; e++){
    const span = Math.max(1, eraAt[e] - eraAt[e - 1]);
    y[e] = Math.max(anchor(e), y[e - 1] + ERA_FLOOR * span);
  }
  return y;
}

// The rate (display-years/step) of the CURRENT open era — heads toward the next
// anchor over ~ERA_OPEN_STEPS, never below the floor.
function openRate(base, e){
  const target = anchor(e + 1);
  return Math.max(ERA_FLOOR, (target - base) / ERA_OPEN_STEPS);
}

export function displayYear(eraAt, step){
  if (!eraAt || !eraAt.length) return anchor(0) + Math.max(0, step) * ERA_FLOOR;
  const y = eraBoundaries(eraAt), n = eraAt.length;
  if (step <= eraAt[0]) return y[0] + (step - eraAt[0]) * ERA_FLOOR;
  let e = 0; for (let i = 0; i < n; i++){ if (eraAt[i] <= step) e = i; else break; }
  if (e < n - 1){                                  // completed era → linear interp between boundaries
    const span = Math.max(1, eraAt[e + 1] - eraAt[e]);
    return y[e] + (y[e + 1] - y[e]) * Math.min(1, (step - eraAt[e]) / span);
  }
  const base = y[n - 1], dstep = step - eraAt[n - 1];   // the open, leading era
  if (e >= ERA_ANCHOR.length - 1)                                       // Modern: head toward the cap (floored)
    return base + Math.max(ERA_FLOOR, (ERA_MODERN_CAP - base) / (ERA_OPEN_STEPS * 2)) * dstep;
  return base + openRate(base, e) * dstep;
}

// Inverse: a display year → the step it falls on (for "born N years ago").
export function displayStep(eraAt, year){
  if (!eraAt || !eraAt.length) return (year - anchor(0)) / ERA_FLOOR;
  const y = eraBoundaries(eraAt), n = eraAt.length;
  if (year <= y[0]) return eraAt[0] + (year - y[0]) / ERA_FLOOR;
  for (let e = 0; e < n - 1; e++){
    if (year <= y[e + 1]){
      const f = y[e + 1] > y[e] ? (year - y[e]) / (y[e + 1] - y[e]) : 0;
      return eraAt[e] + (eraAt[e + 1] - eraAt[e]) * (f < 0 ? 0 : f > 1 ? 1 : f);
    }
  }
  const base = y[n - 1];
  const rate = (n - 1 >= ERA_ANCHOR.length - 1)
    ? Math.max(ERA_FLOOR, (ERA_MODERN_CAP - base) / (ERA_OPEN_STEPS * 2))
    : openRate(base, n - 1);
  return eraAt[n - 1] + (year - base) / rate;
}

export function displayYearStr(eraAt, step){
  const y = Math.round(displayYear(eraAt, step));
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
