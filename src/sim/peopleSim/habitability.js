// ── Habitability brakes — the geographic reasons sub-Saharan Africa stayed sparse ──
// Pure climate-STATE signals (0..1), NEVER time: a tile is hostile because of what
// the land IS (heat, moisture, water access), so these self-calibrate on any map.
// They model the real causes that kept sub-Saharan Africa a thin, tribal continent
// for most of history — the WET-TROPIC rainforest brake (already long modelled) was
// only one of them; these add the SAVANNA / SAHEL brakes it was missing.
//
//   • malariaSignal  — endemic disease (falciparum malaria, sleeping sickness):
//     warm AND at least SUB-humid. Broader than rainforest — the savanna woodland
//     carried it too (seasonal standing water still breeds it) — so the damp floor
//     sits low. Spares the bone-dry Sahara and the cool temperate core.
//   • tsetseSignal   — trypanosomiasis belt: the warm sub-humid-to-humid woodland
//     where the fly killed cattle, horses and oxen → no draft animals, no plough,
//     no cavalry across most of the sub-Sahara (Diamond). Excludes the dry open
//     grassland where herding thrived (the Sahel fringe, the Eurasian steppe) and
//     the cool temperate grassland belt.
//   • aridSignal     — hot rain-fed aridity: the Sahel / dry savanna, erratic
//     rainfall, low and unreliable carrying capacity, pastoral not dense-farming.
//     A MANAGED RIVER (the Nile) escapes — it gets the irrigation lift instead —
//     so the penalty fades with river access.

const c01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

export function malariaSignal(temp, moist) {
  const heat = c01((temp - 0.62) / 0.20);
  const damp = c01((moist - 0.18) / 0.30);
  return heat * damp;
}

export function tsetseSignal(temp, moist) {
  const heat = c01((temp - 0.66) / 0.16);   // genuinely tropical heat — spares the warm-temperate Med
  const damp = c01((moist - 0.30) / 0.18);
  return heat * damp;
}

export function aridSignal(temp, moist, riverAcc = 0) {
  const dry   = c01((0.34 - moist) / 0.22);   // ramps in below ~0.34 moisture
  const heat  = c01((temp - 0.55) / 0.20);
  const river = c01(riverAcc / 0.30);          // a managed river lifts the floor
  return dry * heat * (1 - river);
}

// Coverage hostility for the SPACING lever (crystallisation + colonisation): how
// strongly the land resists settlements APPEARING (not merely how few people they
// hold). The max of the brakes — a tile is hostile if disease OR aridity OR (to a
// lesser degree, since it suppresses livestock/states more than raw presence)
// tsetse bites. riverAcc lets a managed river escape the arid term; pass 0 where
// per-tile river access isn't to hand.
export function settleHostility(temp, moist, riverAcc = 0) {
  return Math.min(1, Math.max(
    malariaSignal(temp, moist),
    aridSignal(temp, moist, riverAcc),
    0.6 * tsetseSignal(temp, moist),
  ));
}

// Claim-cost hostility for political reach: malaria + tsetse only, NOT aridity —
// the open DRY Sahel claimed cheap historically (Mali, Songhai, Kanem-Bornu ran
// huge across the grass sea), but the humid disease/tsetse belt was near-impossible
// to administer. (Barren desert is already handled by the fertility-deficit term.)
export function claimHostility(temp, moist) {
  return Math.min(1, Math.max(malariaSignal(temp, moist), 0.6 * tsetseSignal(temp, moist)));
}
