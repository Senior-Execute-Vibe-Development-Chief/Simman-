// ── Tribe step orchestrator + contract assertions ──
//
// `runTribeStep(ter, w, stepFn)` is the SINGLE entry point for advancing
// the tribe simulation by one tick. The simulation loop must call this
// (not stepTerritory directly) so the contract and assertions are
// always honoured.
//
// The actual pass bodies still live in WorldSim.jsx for the moment —
// stepFn is the orchestrator (currently legacy stepTerritory). This
// module owns the contract, the assertion checks, and the seam where
// future passes (CULTURAL, CLEANUP) will be added.
//
// As individual passes get rewritten to fix audit flaws, they move
// here one at a time; the wrapper stays stable for the loop.

import { ensureTribeViews } from "./tribeModel.js";

// ────────────────────────────────────────────────────────────────────
// Per-step contract (the order every tick MUST run in)
// ────────────────────────────────────────────────────────────────────
//
//   1. EXPANSION    — only path that mutates owner[]. Uses canonical
//                     writers (claimTile / transferTile / abandonTile).
//                     Invariant after: tribe.size & tribe.strength match
//                     owner[].
//   2. POPULATION   — given final owner[], recompute bgPop/cityPop.
//                     Famine shrinks BOTH bgPop and cityPop.
//                     Invariant after: |tribe.pop − Σ(bgPop+cityPop)| < ε.
//   3. SETTLEMENTS  — promotion / decay (process, not bucket reclassify).
//   4. TRADE        — each (i,j) pair processed exactly once. Atomic
//                     writes to both sides.
//   5. BUDGET       — adjusts from personality + pressures.
//   6. KNOWLEDGE    — gain + diffusion + (possible) decay.
//   7. DIPLOMACY    — opinion deltas, war declarations, conquest events.
//   8. CULTURAL     — (future) religion / language / culture evolution.
//   9. CLEANUP      — alive→false on size==0, prune registry holders,
//                     drop relations from other tribes.
//
// Units (declared once, enforced):
//   pop    — absolute count of people (not popK).
//   food   — absolute units / tick.
//   wealth — absolute "gold". Decay per YEAR, multiply by yearsPerStep.
//   power  — derived from pop × military_tech × wealth_factor. ONE func.

// ────────────────────────────────────────────────────────────────────
// Invariant checks (dev-mode; cheap enough to run every tick)
// ────────────────────────────────────────────────────────────────────

// Toggle: in production you can flip this false to skip the checks.
// Cost is ~O(tribes) per tick, negligible at the scales we run.
const CHECK_INVARIANTS = true;

// Throttle warnings — repeating the same violation every tick floods
// the console. We track each (kind, id) → last step we warned about.
const _warned = new Map();
function warnOnce(kind, id, step, msg) {
  const key = kind + ":" + id;
  const last = _warned.get(key) || -Infinity;
  if (step - last < 64) return;          // at most one warning per 64 steps
  _warned.set(key, step);
  console.warn(`[tribe-invariant ${kind}#${id} @step ${step}] ${msg}`);
}

// Cumulative violation counter — exposed on ter so a HUD can show
// "12 invariant warnings this session" instead of you having to scroll
// the console.
function bumpViolations(ter, kind) {
  if (!ter._invariantHits) ter._invariantHits = {};
  ter._invariantHits[kind] = (ter._invariantHits[kind] || 0) + 1;
}

// Cross-check that ter.tribes[] (views) is in sync with the canonical
// parallel arrays. Cheap. Catches the case where newTribe was called
// without ensureTribeViews (e.g. crystallisation in stepBackgroundPop).
function checkViewSync(ter) {
  if (!ter.tribes || !ter.tribeSizes) return;
  if (ter.tribes.length !== ter.tribeSizes.length) {
    warnOnce("view-sync", "all", ter.stepCount,
      `views=${ter.tribes.length} but tribeSizes=${ter.tribeSizes.length} — calling ensureTribeViews`);
    bumpViolations(ter, "view-sync");
    ensureTribeViews(ter);
  }
}

// Population conservation: tribe.pop should equal sum of bgPop+cityPop
// over its owned tiles (within rounding). Catches accounting drift in
// stepBackgroundPop / stepPopulation. Walk is O(land tiles), not O(N²).
function checkPopulationConservation(ter) {
  if (!ter.tribePopulation || !ter.bgPop || !ter.cityPop || !ter.owner) return;
  const n = ter.tribeSizes.length;
  const sums = new Float64Array(n);
  const N = ter.owner.length;
  for (let i = 0; i < N; i++) {
    const o = ter.owner[i];
    if (o < 0) continue;
    sums[o] += (ter.bgPop[i] || 0) + (ter.cityPop[i] || 0);
  }
  for (let i = 0; i < n; i++) {
    if (ter.tribeSizes[i] <= 0) continue;
    const recorded = ter.tribePopulation[i] || 0;
    const computed = sums[i];
    const tol = Math.max(0.5, computed * 0.05);   // 5% or half-a-person
    if (Math.abs(recorded - computed) > tol) {
      warnOnce("pop-conservation", i, ter.stepCount,
        `recorded=${recorded.toFixed(2)} computed=${computed.toFixed(2)} diff=${(recorded-computed).toFixed(2)}`);
      bumpViolations(ter, "pop-conservation");
    }
  }
}

// Tribe-size conservation: tribe.size should equal count of tiles with
// owner==i. Catches the migration "abandon worst tile" bug where owner
// is cleared without updating size, and the stale-tribeTiles bug.
function checkSizeConservation(ter) {
  if (!ter.tribeSizes || !ter.owner) return;
  const n = ter.tribeSizes.length;
  const counts = new Int32Array(n);
  const N = ter.owner.length;
  for (let i = 0; i < N; i++) {
    const o = ter.owner[i];
    if (o >= 0 && o < n) counts[o]++;
  }
  for (let i = 0; i < n; i++) {
    if (counts[i] === ter.tribeSizes[i]) continue;
    warnOnce("size-conservation", i, ter.stepCount,
      `recorded=${ter.tribeSizes[i]} computed=${counts[i]} diff=${ter.tribeSizes[i]-counts[i]}`);
    bumpViolations(ter, "size-conservation");
  }
}

// Trade symmetry: A's exports to B should equal B's imports from A.
// Currently the trade pass double-counts; this check makes the bug
// visible at runtime until phase 2 fixes the loop.
function checkTradeSymmetry(ter) {
  if (!ter.tradeData) return;
  // Cheap one-sided check: every tribe's foodExports should have a
  // matching foodImports somewhere. Don't enforce exact-pair matching
  // (that's expensive); just flag wildly asymmetric totals.
  let totalImp = 0, totalExp = 0;
  for (let i = 0; i < ter.tradeData.length; i++) {
    if (ter.tribeSizes[i] <= 0) continue;
    const td = ter.tradeData[i]; if (!td) continue;
    totalImp += td.foodImports || 0;
    totalExp += td.foodExports || 0;
  }
  if (totalImp + totalExp < 0.01) return;     // no trade yet
  const ratio = totalImp / Math.max(0.001, totalExp);
  if (ratio < 0.5 || ratio > 2.0) {
    warnOnce("trade-symmetry", "all", ter.stepCount,
      `foodImports=${totalImp.toFixed(2)} foodExports=${totalExp.toFixed(2)} ratio=${ratio.toFixed(2)}`);
    bumpViolations(ter, "trade-symmetry");
  }
}

function runInvariants(ter) {
  checkViewSync(ter);
  checkSizeConservation(ter);
  checkPopulationConservation(ter);
  checkTradeSymmetry(ter);
}

// ────────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────────

// stepFn is the legacy orchestrator (stepTerritory from WorldSim.jsx).
// Wrapping it here means the loop only knows about runTribeStep, and
// when we replace stepFn with a re-written contract-enforcing version
// the loop doesn't change.
export function runTribeStep(ter, w, stepFn) {
  const out = stepFn(ter, w);

  // Keep views in sync after any tribe was created during the step
  // (crystallisation / splits). ensureTribeViews is idempotent.
  ensureTribeViews(ter);

  if (CHECK_INVARIANTS) runInvariants(ter);

  return out;
}

// Reset the invariant warning throttle — call from regenerate so a
// fresh world starts with no warning history.
export function resetInvariantState(ter) {
  _warned.clear();
  if (ter) ter._invariantHits = {};
}
