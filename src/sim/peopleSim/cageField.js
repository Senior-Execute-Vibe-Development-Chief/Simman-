// ── T.STATE_CAGE: the caging field — the core force of state formation ──────
// (2026-08-12, the owner's question that re-founded this subsystem: "nations
// spawn where population gets big enough... was that really the core force
// creating nations?" — docs/dawn-cradles-2026-08-07.md §10.)
//
// It was not. The sim's channels were POPULATION-MASS-gated, so nations rose
// wherever land is moderately liveable (Europe, the Sahel, the broad China
// plains) — while history's cradles are the ARID RIVER CORRIDORS the mass
// statistic reads as marginal (measured: Mesopotamia was this sim's WEAKEST
// cradle — wheat suit 0.27, the slowest arming clock of the arc — and the
// Mideast's first states trailed India's; the exact inverse of the record).
// The record's core forces: (1) surplus you can SEE, STORE and SEIZE —
// storable grain, the taxable crop; (2) CAGING — people who cannot walk away:
// Egypt and Sumer are dense arable ribbons hemmed by desert, where exit means
// death, while the rain-fed European plain offers exit in every direction and
// stayed stateless for millennia despite MORE total people; (3) density of
// the STRIP, not mass of the region.
//
// THE FIELD — Mann's caging priced directly: the OPPORTUNITY COST of exit.
// What fraction of their livelihood does the average fleeing household give
// up by leaving this ground for the country within flight distance?
//
//   cage(i) = 1 − min(1, exitQuality(i))
//   exitQuality = (mean FREE capacity over the ring's LAND)
//                 ─────────────────────────────────────────
//                 (capacity under the HOME basin's people)
//   home        = Σcap²/Σcap over the home box — the capacity-WEIGHTED mean,
//                 i.e. the land the basin's people actually stand on (people
//                 distribute ∝ capacity: popField's own logic). A narrow rich
//                 strip in desert reads as the strip (no desert dilution); a
//                 plain reads as the plain (no single-tile peakedness).
//   free        = not state-owned (an owned tile prices at 0: you cannot walk
//                 into a realm's land as a free household, only as its
//                 subject); water is neither exit nor cage — it leaves the
//                 denominator entirely
//   ring        = the TOWN_BASIN_R market-catchment disk (the horizon every
//                 basin law uses) minus the home basin disk (your OWN strip
//                 is not your escape)
//
// A rich strip in poor country reads ~1 (leaving the Nile for the Sahara
// forfeits the livelihood — exit means destitution); a uniform plain reads
// ~0 in EVERY direction (the defeated village walks and re-sows — Neolithic
// Europe); poor land in poor country reads ~0 (staying and leaving are
// equally bad: no differential, nothing to hold anyone to the spot). The one
// formula carries BOTH of history's cages — ecological at the dawn (the
// desert prices the Nile's exits at ~0) and POLITICAL as the frontier
// advances (each border that closes over the periphery zeroes that ground as
// exit and raises its neighbours' cage — states cascade outward, Mann's
// caging on the field the sim actually maintains).
//
// THREE FORMS MEASURED DEAD here first, recorded per custom (probe_cage,
// tw=480 from-0 dawn): (1) cage = 1 − exitMean/homeMean over box-mean
// CAPACITY — the ocean-share artifact (a mean prices half-a-horizon-of-
// Atlantic as half-caged: N France 0.618, Rhineland 0.689 OVER Nile 0.557,
// Mesopotamia 0.352 — the European false pristine REBUILT by the field meant
// to retire it) plus home-box desert dilution (the Nile's home mean read ~34
// against its 150 strip). (2) the viable-share form — share of ring land at
// or above the world's MEDIAN land capacity: the bar is broken BY
// CONSTRUCTION (half of land is above the median, and the true bottom half
// is tundra/ice/mountain, so the SAHARA cleared "ordinary" and read as
// viable exit: Nile 0.074, BELOW the world land mean of 0.394 — a ranked bar
// cannot price the desert; the opportunity-cost ratio has no bar at all).
// (3) the ratio with the SINGLE TILE as home — measures local PEAKEDNESS,
// not circumscription: a local capacity maximum always beats its ring's
// mean, so every settlement-grade tile on the planet read 0.5-0.7 caged
// (steppe 0.530, taiga 0.649, N France 0.558 vs Nile 0.679 — 1.2:1 where
// history is 10:1). The capacity-weighted home box removes both failure
// modes at once, and for the same reason popField spreads people by cap.
// Surplus richness enters the DRIVE as its own factor (cage × storable, both
// consumers) — Carneiro's actual triad: circumscription AND surplus AND
// pressure, each measured, none proxying the others. Recorded limitation:
// with a land-only denominator, sea-circumscription (Hawaii, Tonga) is not
// priced — an island interior reads only its own land ring.
//
// Everything is an existing quantity: capField (the capacity the field pass
// already maintains), _countryOwner/_landOwner (the political map),
// TOWN_BASIN_R × rNormPop (the market-catchment horizon every basin law
// uses), and the field's own median. Square windows via O(N) sliding sums (x
// wraps, y clamps); refreshed on a perf cadence (how OFTEN, never whether —
// the cardinal rule's carve-out).
import { T, rNormPop } from "./tuning.js";

const CAGE_REFRESH = 500;          // perf cadence (steps between rebuilds)
const CAGE_HORIZON_REF = 10;       // = TOWN_BASIN_R: one market catchment, in reference tiles

// O(N) box means via row sliding sums then column sliding sums. x wraps
// (longitude), y clamps (poles). Returns Float32Array of window MEANS
// (normalized by the FULL 2r+1 width and the CLAMPED row count — pole
// windows are approximate; everything within rExit of a pole is ice/ocean).
function boxMean(src, tw, th, r) {
  const N = tw * th;
  const rowS = new Float64Array(N);
  for (let y = 0; y < th; y++) {
    const base = y * tw;
    let s = 0;
    for (let dx = -r; dx <= r; dx++) s += src[base + ((dx % tw) + tw) % tw];
    rowS[base] = s;
    for (let x = 1; x < tw; x++) {
      s += src[base + ((x + r) % tw)] - src[base + (((x - r - 1) % tw) + tw) % tw];
      rowS[base + x] = s;
    }
  }
  const out = new Float32Array(N);
  const w = 2 * r + 1;
  for (let x = 0; x < tw; x++) {
    let s = 0, n = 0;
    for (let y = 0; y <= Math.min(th - 1, r); y++) { s += rowS[y * tw + x]; n++; }
    out[x] = s / (n * w);
    for (let y = 1; y < th; y++) {
      const yAdd = y + r, ySub = y - r - 1;
      if (yAdd < th) { s += rowS[yAdd * tw + x]; n++; }
      if (ySub >= 0) { s -= rowS[ySub * tw + x]; n--; }
      out[y * tw + x] = s / (n * w);
    }
  }
  return out;
}

/** Rebuild (or lazily create) the caging field. Reads capField + the
 *  political owner maps; writes world._cageField (Float32, 0..1). */
export function ensureCageField(world) {
  if (!T.STATE_CAGE || !world.capField) return null;
  // Epoch-locked refresh (not steps-since-last): within a run every consumer
  // sees the same field for a whole epoch regardless of who asked first.
  const epoch = (world.step / CAGE_REFRESH) | 0;
  const stale = world._cageEpoch !== epoch || !world._cageField || world._cageField.length !== world.N;
  if (!stale) return world._cageField;
  // A just-loaded world's capField is ZEROED until the field pass re-derives
  // it (persist.js: "capField re-derived next step") — building now would
  // stamp an all-zero cage for a whole epoch. Skip WITHOUT claiming the
  // epoch; the first call after the field pass builds for real.
  if (world._cageZeroStep === world.step) return null;   // already scanned this step
  const cap = world.capField;
  const { tw, th, N, elev } = world;
  let any = false;
  for (let i0 = 0; i0 < N; i0++) if (cap[i0] > 0) { any = true; break; }
  if (!any) { world._cageZeroStep = world.step; return null; }
  world._cageEpoch = epoch;
  const rHome = Math.max(1, Math.round(rNormPop(world)));
  const rExit = Math.max(rHome + 1, Math.round(CAGE_HORIZON_REF * rNormPop(world)));
  // LAND indicator, FREE capacity (state-owned ground prices at 0), and the
  // home-weighting squares (raw cap: home is the strip's quality, owned or not).
  const co = world._countryOwner, lo = world._landOwner;
  const landI = new Float32Array(N), fcap = new Float32Array(N), capSq = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    landI[i] = 1;
    capSq[i] = cap[i] * cap[i];
    if (!((co && co[i] >= 0) || (lo && lo[i] >= 0))) fcap[i] = cap[i];
  }
  const landW = boxMean(landI, tw, th, rExit), landH = boxMean(landI, tw, th, rHome);
  const fcW = boxMean(fcap, tw, th, rExit), fcH = boxMean(fcap, tw, th, rHome);
  const capH = boxMean(cap, tw, th, rHome), capSqH = boxMean(capSq, tw, th, rHome);
  const cage = world._cageField && world._cageField.length === N ? world._cageField : (world._cageField = new Float32Array(N));
  // Ring sums from the two box means (areas are the means' weights).
  const aH = (2 * rHome + 1) ** 2, aW = (2 * rExit + 1) ** 2;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) { cage[i] = 0; continue; }
    const h = capH[i] > 0 ? capSqH[i] / capH[i] : 0;   // capacity under the home basin's people
    if (!(h > 0)) { cage[i] = 0; continue; }
    const ringLand = landW[i] * aW - landH[i] * aH;
    if (!(ringLand > 0)) { cage[i] = 0; continue; }   // no land beyond the basin: the sea limitation above
    const ringCap = fcW[i] * aW - fcH[i] * aH;
    const c = 1 - Math.max(0, ringCap) / ringLand / h;
    cage[i] = c > 0 ? (c < 1 ? c : 1) : 0;
  }
  return cage;
}

/** The cage at a tile (0 = exit everywhere, 1 = no exit). 0 when the lever is off. */
export function cageAt(world, ti) {
  const f = ensureCageField(world);
  return f ? f[ti] : 0;
}
