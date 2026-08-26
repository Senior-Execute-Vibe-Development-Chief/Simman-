// ── Simulation calendar ──
import { T } from "./peopleSim/tuning.js";
// A plain, EXACT, constant-rate clock: the year advances a FIXED amount every
// tick, the same rate from the first step to the last — no anchoring to eras, no
// pinning to "real history", no acceleration. Step 0 is START_YEAR; each step
// adds YEARS_PER_STEP. That's the whole clock.
//
//   START_YEAR = -3000, YEARS_PER_STEP = 0.5  →  the clock starts at 3000 BC and
//   adds 1 year every 2 ticks. Change the two constants to retune the epoch or
//   the rate; the mapping stays linear either way.
// All three epochs below follow T.CRADLE_EVE (read at call time — the lever can
// change in the panel): 1 = the map opens at 3000 BC, the eve of states (the
// legacy injected-cradle world); 0 = cradles seed as natural late-neolithic
// proto-towns (the 2026-07 removal; genesis package made internally
// consistent and town-scaled — the urban floor — later that month:
// settlement.js, crystallize.js), the first kingdoms EMERGE over the
// following millennia (measured era-1 arrival 7200–7800, 3 seeds), so each
// clock opens earlier — in the late neolithic — and the eras still land on
// the dates history expects (Bronze displays at ~3300–3450 BC under the
// re-fit DISP_START below). Cosmetic both ways — no mechanic reads any of
// these (CLAUDE.md).
const START_YEAR     = () => (T.CRADLE_EVE ? -3000 : -5600);   // the year at step 0 (this clock runs 0.5y/tick)
const YEARS_PER_STEP = 0.5;     // years added per tick — constant, forever

export function stepToYear(step){ return START_YEAR() + step * YEARS_PER_STEP; }

export function yearStr(step){ const y=Math.round(stepToYear(step));
  return y<0?`${-y} BC`:`${y} AD`; }

// Inverse mapping: year → step (exact inverse of stepToYear).
export function yearToStep(year){ return (year - START_YEAR()) / YEARS_PER_STEP; }

// ── Dynasty clock — a SEPARATE, slower uniform clock for human lifespans ──
// The dynasty layer (ages, reigns, lifespans, succession) runs on this, NOT on
// stepToYear above. It must be UNIFORM (so a king reigns ~50 years whatever the
// pace) — the era-anchored display calendar below has a spiky rate and cannot
// time durations. Its rate is HALF the mechanic clock so a full run spans roughly
// 3000 BC → ~2000 AD: the count of sovereigns then fits the displayed history
// (~100 across a realm's life, not ~200 crammed in) and its years sit in the same
// range as the display calendar. Kept separate from stepToYear so retuning ruler
// turnover never disturbs the demographic anchor (which reads stepToYear).
// T.EPOCH_YD (v49, the genesis lap): the owner-ratified anchor — t=0 is the
// end of the Younger Dryas (~9700 BCE), the Holocene's opening, under the
// CAGE_FILL pace whose milestones then land on history's dates (farming
// ~7637 BCE, writing/cities ~3900 BCE, iron ~1012 BCE — tuning.js EPOCH_YD).
// DYN and DISP are one fused clock (same epoch, same rate) and move together;
// v<49 saves pin EPOCH_YD=0 so their stamped dynasty years (rulers' reignFrom/
// reignTo are absolute years) stay self-consistent under −5250.
const DYN_START = () => (T.CRADLE_EVE ? -3000 : (T.EPOCH_YD ? -9700 : -5250)), DYN_RATE = 0.25;
export function dynYear(step){ return DYN_START() + step * DYN_RATE; }
export function dynStep(year){ return (year - DYN_START()) / DYN_RATE; }

// ── DISPLAY calendar: the UNIFORM clock ─────────────────────────────────────
// One honest clock: the displayed date is simply linear — DISP_RATE years per
// step from DISP_START. The old era-anchored elastic clock (which stretched
// years-per-tick to hide the flat-ceiling pacing) is gone, and so is its
// vestigial eraAt parameter: the display clock takes a STEP, full stop.
// DISP_START is calibrated so measured era attainments line up with their
// historical dates on the 3-seed table (tools/probe_erapace.mjs prints each
// run's best-fit epoch). 2026-07 re-fit twice in the pacing pass: first after
// the consistent-neolithic genesis package (settlement.js), then after the
// URBAN FLOOR (crystallize.js — town-scale foundings learn faster, so Bronze
// attainment moved again, to 7.2–7.8k steps): the canon seeds now fit
// −5342/−5240/−5240 (mean ≈ −5270; ≈ −5080 with the Iron anchors excluded —
// the CLASSICAL GAP, Iron still ~0.4× its span, hegemonic-competition channel
// documented in probe_erapace, drags its anchors to −5725..−5950). −5250
// splits the estimates and lands Bronze on screen at ~3300–3450 BC across
// all three seeds — its historical date. Still read-only: no mechanic may
// consume it (CLAUDE.md — the calendar is cosmetic, never an input).
// −3000: the map STARTS at 3000 BC under CRADLE_EVE=1 — the genesis cradles
// are seeded at the eve of states (proto-urban towns, temple administration,
// chalcolithic copper — settlement.js makeSettlement), which is what 3000 BC
// was, so the first kingdoms crystallize within the opening centuries and the
// display epoch and the dynasty clock (DYN_START below) are ONE clock.
// (EPOCH_YD: see the DYN_START note — the fused display/dynasty clock
// re-anchors to the Younger-Dryas epoch −9700 under the CAGE_FILL pace.)
const DISP_START = () => (T.CRADLE_EVE ? -3000 : (T.EPOCH_YD ? -9700 : -5250)), DISP_RATE = 0.25;
export function displayYear(step){ return DISP_START() + Math.max(0, step) * DISP_RATE; }
export function displayStep(year){ return (year - DISP_START()) / DISP_RATE; }

export function displayYearStr(step){
  const y = Math.round(displayYear(step));
  return y < 0 ? `${-y} BC` : `${y} AD`;
}
