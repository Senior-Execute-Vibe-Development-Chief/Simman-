// ── Habitability brakes — the geographic reasons sub-Saharan Africa stayed sparse ──
// Pure climate-STATE signals (0..1), NEVER time: a tile is hostile because of what
// the land IS (heat, moisture, water access), so these self-calibrate on any map.
// They model the real causes that kept sub-Saharan Africa a thin, tribal continent
// for most of history — the WET-TROPIC rainforest brake (already long modelled) was
// only one of them; these add the SAVANNA / SAHEL brakes it was missing.
//
// CALIBRATED TO THE BIOME SYSTEM (WorldSim.jsx getBiomeD / resourceGen.js getBiome).
// Those classifiers run on the air-temp scale t = 0.60 + °C/100 and on EFFECTIVE
// moisture em = m / (0.5 + 0.5·t) (Holdridge PET — hot land loses water to
// evaporation). The biome temperature bands are: temperate +5..+18°C (t 0.65–0.78),
// SUBTROPICAL +18..+25°C (t 0.78–0.85), TROPICAL > +25°C (t ≥ 0.85). On the
// reference world the equator reads t≈0.84 / em≈0.71 (classified mostly SUBTROPICAL
// FOREST, then tropical rainforest) — that is the "central Africa" these brakes must
// bite — while the temperate cradle latitudes read t≈0.65 and must be SPARED. So we
// gate warmth on the subtropical→tropical bands and read em, exactly like the biome
// map, instead of raw moisture on a guessed scale.
//
//   • malariaSignal  — endemic disease (falciparum malaria, sleeping sickness):
//     warm AND at least sub-humid. Covers the subtropical/tropical forest AND the
//     moister savanna (seasonal standing water still breeds it); spares the bone-dry
//     desert and the cool temperate core.
//   • tsetseSignal   — trypanosomiasis belt: the warm MOIST woodland-savanna→forest
//     where the fly killed cattle, horses and oxen → no draft animals, no plough,
//     no cavalry across most of the sub-Sahara (Diamond). Excludes the DRY open
//     grassland where herding thrived (the Sahel fringe, the Eurasian steppe).
//   • aridSignal     — hot rain-fed aridity: the Sahel / dry savanna / desert,
//     erratic rainfall, low and unreliable carrying capacity. A MANAGED RIVER
//     (the Nile) escapes — high em or river access lifts the floor.

const c01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Effective moisture — the SAME Holdridge PET ratio the biome classifier uses, so
// these brakes track the biomes the map actually shows.
function effMoist(temp, moist) { return Math.min(1, moist / (0.5 + temp * 0.5)); }

// Warmth across the SUBTROPICAL→TROPICAL bands. Zero through the temperate cradle
// latitudes (t ≤ 0.72 ≈ +12°C), climbing to full by the deep subtropics (t ≈ 0.82
// ≈ +22°C) so subtropical AND tropical forest both brake fully; the warm river
// cradles (Nile/Mesopotamia, t ≈ 0.76–0.78) take a partial hit — they were malarial
// too — and survive on irrigation, as they did historically.
function tropicalWarmth(temp) { return c01((temp - 0.72) / 0.10); }

export function malariaSignal(temp, moist) {
  const damp = c01((effMoist(temp, moist) - 0.16) / 0.34);   // moist savanna → forest
  return tropicalWarmth(temp) * damp;
}

export function tsetseSignal(temp, moist) {
  const damp = c01((effMoist(temp, moist) - 0.32) / 0.20);   // moist woodland/forest only — spares the dry grassland
  return tropicalWarmth(temp) * damp;
}

export function aridSignal(temp, moist, riverAcc = 0) {
  const dry   = c01((0.30 - effMoist(temp, moist)) / 0.20);  // dry savanna / desert (low em)
  const heat  = c01((temp - 0.70) / 0.14);
  const river = c01(riverAcc / 0.30);                        // a managed river lifts the floor
  return dry * heat * (1 - river);
}

// Multiplier on grain spoilage rates (stored grain, in-transit haul, mart shelf).
// 1 = cool-temperate reference. Hot+wet tropics rot fast; hot+dry semi-arid keeps
// grain (Egypt, Mediterranean granaries — seasonalSelect's dry-summer lobe).
export function grainSpoilClimate(temp, moist) {
  const t = temp ?? 0.5, m = moist ?? 0.5;
  const em = effMoist(t, m);
  const heat = c01((t - 0.55) / 0.30);
  const wetRot = c01((em - 0.35) / 0.35);
  const dryKeep = c01((0.22 - em) / 0.15) * heat;
  const rot = heat * (0.25 + 0.75 * wetRot);
  return Math.max(0.45, Math.min(2.8, 0.75 + rot * 1.6 - dryKeep * 0.55));
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
