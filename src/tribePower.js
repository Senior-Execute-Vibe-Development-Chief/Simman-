// ── Single source of truth for tribe power ──
//
// The audit found three different "strength" surfaces in the sim
// (tribeStrength = fertility sum; tribePower = the proper power
// formula; localPower = projected power at a border tile). Border
// combat in particular was using tribeStrength as if it were
// population, so a fertile-but-empty colony beat a populous-but-barren
// empire. This module consolidates all of it.
//
// Public:
//   tribePower(ter, id)              — global power score for a tribe
//   localPower(ter, id, tx, ty)      — projected power at a tile
//   tribeOreAccess(tRes, metallurgy) — combat-relevant ore quality
//   tDistW(x1, y1, x2, y2, tw)       — torus distance helper
//   expFalloff(d)                    — gaussian power-projection LUT
//
// All readers (UI + sim) must go through these. Do not re-derive
// power from tribeStrength in place — that's what got us into the
// audit's finding #6 mess.

// ────────────────────────────────────────────────────────────────────
// Geometry / falloff helpers
// ────────────────────────────────────────────────────────────────────

// Torus-aware distance: longitudinal wrap-around on `tw`.
export function tDistW(x1, y1, x2, y2, tw) {
  let dx = Math.abs(x1 - x2);
  if (dx > tw / 2) dx = tw - dx;
  return Math.sqrt(dx * dx + (y1 - y2) * (y1 - y2));
}

// Precomputed exp(-d² / 280) LUT — eliminates Math.exp in the per-tile
// border-conflict hot loop.
const EXP_LUT_SIZE = 80;
const EXP_LUT = new Float32Array(EXP_LUT_SIZE + 1);
for (let d = 0; d <= EXP_LUT_SIZE; d++) EXP_LUT[d] = Math.exp(-d * d / 280);

export function expFalloff(d) {
  const di = d < 0 ? 0 : d > EXP_LUT_SIZE ? EXP_LUT_SIZE : d;
  const lo = di | 0;
  if (lo >= EXP_LUT_SIZE) return EXP_LUT[EXP_LUT_SIZE];
  const hi = lo + 1;
  const f = di - lo;
  return EXP_LUT[lo] * (1 - f) + EXP_LUT[hi] * f;
}

// ────────────────────────────────────────────────────────────────────
// Resource access (combat-relevant; also used by stepKnowledge)
// ────────────────────────────────────────────────────────────────────

export function tribeOreAccess(tRes, metallurgy) {
  let access = 0;
  if (tRes.copper > 0.5) access = Math.max(access, 0.4);
  if (tRes.copper > 0.5 && tRes.tin > 0.5) access = Math.max(access, 0.8);
  if (tRes.iron > 0.5) access = Math.max(access, 1.0);
  if (tRes.iron > 0.5 && tRes.coal > 0.5) access = Math.max(access, 1.3);
  return access * metallurgy;
}

// ────────────────────────────────────────────────────────────────────
// Power
// ────────────────────────────────────────────────────────────────────
//
// Power = population × military_tech × organization_logistics × military_focus
//         × trade_wealth_softpower × wealth_bonus
//
// Population is real `tribePopulation` when available; fallback is
// `tribeStrength * 10` (a fertility-based estimate for the first tick
// after crystallisation, before stepPopulation has run). The audit
// flagged that this fallback gives wildly different power scaling for
// fresh tribes — known limitation, fixed when phase 2 reconciles the
// population units across the model.

export function tribePower(ter, id) {
  const sz = ter.tribeSizes[id];
  if (sz <= 0) return 0;

  const pop = (ter.tribePopulation && ter.tribePopulation[id])
    ? ter.tribePopulation[id]
    : ter.tribeStrength[id] * 10;

  const k = ter.tribeKnowledge && ter.tribeKnowledge[id]
    ? ter.tribeKnowledge[id]
    : null;
  const org = k ? k.organization : 0;

  // Logistics: power degrades once empire size exceeds an organisational
  // threshold (raised by organization knowledge).
  const logThreshold = 40 + org * 260;
  const logistics = 1 / (1 + Math.max(0, sz - logThreshold) * 0.015);

  // Military tech from metallurgy + ore quality
  let milTech = 1;
  if (k && ter._resCache && ter._resCache[id]) {
    milTech = 1 + tribeOreAccess(ter._resCache[id], k.metallurgy) * 1.5;
  }

  // Budget military focus: Sparta-mode tribes hit harder
  const milB = ter.tribeBudget && ter.tribeBudget[id]
    ? ter.tribeBudget[id].military
    : 0.2;
  const milFocus = 0.5 + milB * 2.5;

  // Trade wealth soft power
  const tradeWealth = k ? 1 + k.trade * 0.3 : 1;

  // Wealth → mercenaries / allies
  const wealthBonus = ter.tribeBudget && ter.tribeBudget[id]
    ? 1 + Math.min(0.5, ter.tribeBudget[id].wealth * 0.001)
    : 1;

  return pop * 0.01 * milTech * logistics * milFocus * tradeWealth * wealthBonus;
}

// ────────────────────────────────────────────────────────────────────
// Local power projection at a border tile
// ────────────────────────────────────────────────────────────────────
//
// Sums the influence of each of this tribe's centers, weighted by
// gaussian distance falloff (range ~40 tiles). Used by per-tile border
// combat to decide who wins a single contested tile.
//
// Uses tribePopulation as the pop figure (audit #6 fix — was
// tribeStrength, the fertility sum, which silently meant a fertile-
// but-empty colony beat a populous-but-barren empire). Falls back to
// tribeStrength × 10 only for fresh tribes whose stepPopulation hasn't
// run yet so the first-tick combat doesn't return 0.

export function localPower(ter, tribeId, tx, ty) {
  const pop = (ter.tribePopulation && ter.tribePopulation[tribeId])
    ? ter.tribePopulation[tribeId]
    : ter.tribeStrength[tribeId] * 10;
  const sz = ter.tribeSizes[tribeId];
  if (sz <= 0) return 0;

  const centers = ter.tribeCenters[tribeId];
  if (!centers || centers.length === 0) return pop * 0.05;

  let total = 0;
  const limit = Math.min(centers.length, 30);
  for (let ci = 0; ci < limit; ci++) {
    const c = centers[ci];
    const d = tDistW(tx, ty, c.x, c.y, ter.tw);
    if (d > 40) continue;
    total += expFalloff(d) * c.prestige;
  }

  let base = pop * (0.03 + 0.97 * Math.min(1, total));

  // Metallurgy + ore access multiplies combat effectiveness
  if (ter.tribeKnowledge && ter.tribeKnowledge[tribeId]
      && ter._resCache && ter._resCache[tribeId]) {
    const met = ter.tribeKnowledge[tribeId].metallurgy;
    const ore = tribeOreAccess(ter._resCache[tribeId], met);
    base *= (1 + ore * 1.5);
  }

  // Military budget multiplier
  const milB = ter.tribeBudget && ter.tribeBudget[tribeId]
    ? ter.tribeBudget[tribeId].military
    : 0.2;
  base *= (0.5 + milB * 2.5);

  return base;
}
