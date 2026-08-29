// Mint-ready foresight (T.INVENT_JUMP): open the map when the first city is
// about to mint — invent first, then gather through URBAN_DRIFT / land-know
// with minting held so play watches the birth on camera.
//
// Lives in its own module so hearthInvent ↔ crystallize stay one-way
// (crystallize imports igniteHearth; this imports both).

import { T } from "./tuning.js";
import { stepPopField } from "./popField.js";
import { jumpToFirstInvent } from "./hearthInvent.js";
import { maybeDawnGather } from "./crystallize.js";

/**
 * Open at first CITY-ready moment (mint-ready, not yet minted).
 * Invent-jump first, then a cheap dawn loop: popField + land-know/site gather
 * only, with minting held so play watches the first city rise.
 */
export function jumpToCivReady(world) {
  if (!(T.INVENT_JUMP > 0) || !T.DAWN_LIVE) return false;
  const invented = jumpToFirstInvent(world);
  if (!invented && !(world._hearthSeeds && world._hearthSeeds.length)) return false;

  world._dawnHoldMint = true;
  world._dawnMintReady = false;
  world._dt = 1 / Math.max(1, T.SIM_GRANULARITY || 1);
  const inventStep = world.step;
  // Safety horizon: Neolithic under CAGE_FILL can run long; ~display-millennia.
  const maxStep = inventStep + 80_000;
  const t0 = performance.now();

  // Amortize: popField every step (technique + capacity + spikes' field);
  // gather cadence matches the live site pass. Mint hold prevents birth.
  while (world.step < maxStep && !world._dawnMintReady) {
    world.step++;
    stepPopField(world, 1);
    maybeDawnGather(world);
  }

  delete world._dawnHoldMint;
  const ms = (performance.now() - t0).toFixed(0);
  if (world._dawnMintReady) {
    console.log(`[peopleSim] invent-jump: mint-ready at step ${world.step} (invent @ ${inventStep}, +${world.step - inventStep} steps) in ${ms}ms — first city will mint on play`);
    return true;
  }
  console.warn(`[peopleSim] invent-jump: no mint-ready site by step ${world.step} (${ms}ms) — opening with farming; live mint continues`);
  return false;
}
