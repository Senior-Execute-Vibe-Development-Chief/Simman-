// ── The biome classifier — ONE copy ────────────────────────────────────────────
// Until now this logic was duplicated in WorldSim.jsx (the render), resourceGen.js (the
// sim) and again inside every probe in tools/. They drifted, and the drift is how a
// render bug survived a whole session of "validation": the probes were scoring a
// reimplementation, not the code. Everything now calls this.
//
// It maps a climate to a land cover. That is a CLASSIFICATION, not a mechanism — the
// analogue of Koppen or Holdridge rather than of the wind solver — so its thresholds are
// legitimately calibrated against a published global scheme. What is not legitimate, and
// is not done here, is any threshold that names a place: every cut below is global, keyed
// only on physical fields, and was fitted over all land at once.
//
// Calibration: cuts derived against Koppen truth over 21,587 land points, scored in the
// observed-climate mode so the classifier was tuned against near-true inputs rather than
// against the solver's errors. Objective was mean per-class F1 plus a share-matching
// term — plain accuracy rewards deleting rare classes (it drove tundra to 3% against a
// true 6.9%), and a world map is judged on its MIX as much as its hits.
// Result: 79.4% agreement (from 67.7%), class shares within 1 point of truth throughout.
// See tools/probe_climate_truth.mjs.

export const B_TUNDRA = 4, B_ICE = 5, B_TAIGA = 6, B_BOREAL = 7, B_TEMP_FOREST = 8,
  B_TEMP_RAIN = 9, B_TROP_RAIN = 10, B_SAVANNA = 11, B_GRASSLAND = 12, B_DESERT = 13,
  B_SHRUBLAND = 14, B_TROP_DRY = 15, B_ALPINE = 16, B_SUBTROP = 17,
  B_COLD_DESERT = 18, B_FLOODPLAIN = 19, B_MEDITERRANEAN = 20;
// Mediterranean is a NEW id, not a rename of Shrubland (14). Reusing 14 looked tempting —
// its colour comment already said "chaparral" — but 14 is a live arid-fringe class with
// four resource rules keyed to it (evaporites, steppe horses, oil basins, incense), and
// taking it over deleted a working biome from the map while the Mediterranean branch was
// still disabled. Two distinct things: 14 is hot semi-desert scrub, 20 is winter-wet
// sclerophyll.
// B_ALPINE (16) is never returned: high ground is already cold ground, so the lapse rate
// sends real mountains through the ICE / tundra / cold-desert branches on temperature
// alone. It is kept because resourceGen reads it, and because a future rock-and-scree
// class above the treeline would want the id.

// ── Holdridge biotemperature ───────────────────────────────────────────────────
// Holdridge's PET is 58.93 x biotemperature, where biotemperature averages the monthly
// means with each clamped to [0,30] — frozen months demand no water, and above 30degC
// the extra heat buys no extra growth. We hold only the ANNUAL mean, so approximate it
// with a softplus, which tends to the mean when no month freezes and to zero in permanent
// cold, exactly as the clamping does. k is the scale of the annual swing; 6.5 measures
// out at 0.89degC mean error against true Holdridge biotemperature over all land.
const BIO_K = 6.5;
export function bioTemp(t) {
  return Math.min(30, BIO_K * Math.log(1 + Math.exp(((t - 0.6) * 100) / BIO_K)));
}
// Evaporative demand, normalised to tropical PET and floored at the polar ratio real PET
// actually has (~200 mm arctic against ~1500 mm tropical). It tracks measured PET closely:
// bioT 5 -> 0.28 (real ~0.23), 10 -> 0.42 (~0.40), 20 -> 0.71 (~0.67), 30 -> 1.0.
//
// This replaced `0.5 + 0.5*t`, which varied only 1.6x from pole to equator where real PET
// varies about sevenfold — the classifier's own comment claimed the "Holdridge PET
// principle" while implementing almost none of it. Worth recording what the fix was
// actually worth: on its own, close to nothing. Because the temperature BANDS already
// separate climates before moisture is consulted, `demand` is near-constant inside any
// one band and the band's own cut absorbs it. Nearly all of the accuracy gain came from
// re-deriving the cuts. It is kept because it is the honest quantity — the cuts now mean
// something physical, and they no longer lean on Earth's particular band structure to
// carry a normalisation that belongs in the demand term.
export function demand(t) { return 0.13 + 0.87 * Math.min(1, bioTemp(t) / 30); }

// Temperature bands, on the calibrated air-temp scale (t = 0.60 + degC/100):
//   ICE < -15 · tundra/taiga -15..-8 · -8..-2 · -2..+1.5 · temperate +1.5..+18 ·
//   subtropical +18..+25 · tropical > +25.
// The boreal/temperate edge sits at +1.5degC (was +5): that is where annual mean
// temperature best separates Koppen D from C over all land, at 93.5%.
const BANDS = [0.45, 0.52, 0.58, 0.615, 0.78, 0.85];
// Per band: [wettest cut, forest cut, grass cut]. Read wettest-first.
//
// The FOREST cut in each band, and the grass cut in the warm bands, come from the F1
// calibration above — those decide the coarse class, which is what the probe scores.
//
// The WETTEST cut, and the grass cut in the COLD bands, separate two biomes that collapse
// to the SAME coarse class, so the probe's agreement number is blind to them. They were
// first set by scaling the old constants, and that silently deleted three biomes from the
// world — tropical rainforest, subtropical forest and cold desert all fell to 0.0% of land
// while temperate rainforest swallowed the temperate band. A class-level score cannot
// catch that; only the full biome histogram can. They are now placed by share-matching
// inside their own band against the finer Koppen group each one stands for:
//   Boreal Forest <- Dfb/Dwb · Temperate Rainforest <- Cfb/Cfc
//   Subtropical <- Cfa/Cwa   · Tropical Rainforest  <- Af/Am
//   Cold Desert <- BWk/BSk
// Fourth entry, where present, is a further ARID step below the grass cut (shrubland
// before true desert). Carried across from the old scale at its original relative
// position (0.09/0.16) rather than recalibrated: both sides of it collapse to the same
// coarse class, so the probe cannot see it, and preserving the old look is the point.
const CUT = [
  [null,  1.163, 0.120],          // -15..-8   taiga / tundra / cold desert
  [null,  1.137, 0.311],          //  -8..-2
  [1.898, 0.950, 0.420],          //  -2..+1.5 boreal / taiga / tundra / cold desert
  [1.550, 0.371, 0.067],          // +1.5..+18 temperate rain / forest / grassland / desert
  [0.987, 0.823, 0.064, 0.036],   // +18..+25  subtropical / trop dry forest / savanna / shrubland / desert
  [0.806, 0.744, 0.070],          // > +25     tropical rain / dry forest / savanna+grassland / desert
];
// ── Mediterranean ──────────────────────────────────────────────────────────────
// A temperate or subtropical climate whose drought falls in SUMMER. That phase, not the
// annual total, is what Koppen's Cs is defined by and what makes sclerophyll scrub
// instead of forest, so it is tested before the wet/dry ladder and only in the bands
// where C climates live. Cuts placed with the same F1 objective as the rest.
const MED_PHASE = 0.390, MED_EM = 0.166;
// DISABLED, and the reason is worth keeping. The rule itself is right: given a truthful
// summer-dry phase it places Mediterranean at 1.1% of land against a true 0.9%, with 52%
// recall at 49% precision. But the SOLVER's phase field cannot support it. Measured over
// 21,587 land points, the solver's summerDry reaches a best-case MED F1 of 0.157 at 4.8%
// of land — 3-6% precision at every threshold tried, i.e. 94-97% of the Mediterranean it
// would paint would be in the wrong place, several percent of the default world.
//
// The cause is diagnosable and is NOT this classifier: the solver's two solstice solves
// differ mainly by where the ITCZ sits, so their phase difference is close to zonally
// uniform (median summerDry 0.00 against observation's -0.29). Real Mediterranean climate
// needs the west-coast pattern — a subtropical high that suppresses summer rain over the
// eastern side of an ocean, and a mid-latitude storm track that moves equatorward in
// winter to water it. The solver models no seasonal storm track, so it cannot make one.
//
// Turn this on when it can: re-run tools/probe_climate_truth.mjs and check that the MED
// column of the confusion matrix is near the 0.9% truth row rather than several times it.
// Everything else — the field, the biome, the colour, the calibrated cuts — is in place
// and working, and the observed-climate mode already exercises the whole path.
const MED_ENABLED = false;

/**
 * @param {number} e elevation (>0 = land; callers handle water themselves)
 * @param {number} m moisture 0-1
 * @param {number} t temperature 0-1 (t = 0.60 + degC/100)
 * @param {number} [dry] fraction of the year that is arid (world.dryFrac)
 * @param {number} [sumDry] summer-dry phase, -1..1; >0 means the drought is in summer
 *                          (world.summerDry). 0 means "unknown", which disables the
 *                          Mediterranean branch and reproduces the older behaviour.
 * @returns {number} biome id
 */
export function classifyBiome(e, m, t, dry, sumDry) {
  if (e <= 0) return -1;
  if (t < BANDS[0]) return B_ICE;
  const band = t < BANDS[1] ? 0 : t < BANDS[2] ? 1 : t < BANDS[3] ? 2
             : t < BANDS[4] ? 3 : t < BANDS[5] ? 4 : 5;
  const [wet, forest, grass, arid] = CUT[band];
  let em = m / demand(t);
  // Dry-season LENGTH. The same annual water carries rainforest if it arrives all year
  // and savanna if it arrives in one half of it — the Koppen Af/Am-vs-Aw distinction, a
  // property of the vegetation rather than of the water, so it belongs here and not in
  // `moisture` (which the fertility, river and migration systems read as real water).
  // Gated on warmth, because a cold winter is dry too and the vegetation does not starve
  // in it: that is the Koppen A-vs-C split (savanna Aw vs humid-subtropical Cwa — monsoon
  // China has a bone-dry winter and is forest). Without the gate this turns western
  // Europe, the eastern US and New Zealand into grassland.
  const warmth = Math.max(0, Math.min(1, (t - 0.79) / 0.035));
  if (dry > 0 && warmth > 0) {
    // Floored at this band's OWN grass cut: a long dry season makes grassland, not
    // desert — desert is a shortfall in the yearly total, which is `m`'s business. The
    // floor used to be a bare 0.17, which only suited the old em scale; expressing it
    // relative to the band lets it follow any change in the demand term.
    const seas = em * (1 - 0.68 * warmth * Math.max(0, Math.min(1, (dry - 0.28) / 0.10)));
    em = Math.max(seas, Math.min(em, grass));
  }
  if (band <= 2) {
    if (wet !== null && em > wet) return B_BOREAL;
    return em > forest ? B_TAIGA : em > grass ? B_TUNDRA : B_COLD_DESERT;
  }
  if (MED_ENABLED && band <= 4 && sumDry > MED_PHASE && em > MED_EM) return B_MEDITERRANEAN;
  if (em > wet) return band === 3 ? B_TEMP_RAIN : band === 4 ? B_SUBTROP : B_TROP_RAIN;
  if (em > forest) return band === 3 ? B_TEMP_FOREST : B_TROP_DRY;
  if (em > grass) return band === 3 ? B_GRASSLAND
    : band === 4 ? B_SAVANNA
    : em > grass * 1.78 ? B_SAVANNA : B_GRASSLAND;
  if (arid !== undefined && em > arid) return B_SHRUBLAND;
  return B_DESERT;
}

// ── The mechanics' canopy field (T.CANOPY_CLASS) ─────────────────────────────
// The sim has always had TWO answers to "is this tile forest": this classifier
// (Koppen-calibrated, 79.4% agreement, consumed by resources and the render)
// and a raw moisture ramp clamp((m-0.38)/0.20) consumed by every MECHANIC (the
// forest state bar, stateCapacityMul, FOREST_LOCK). The ramp mis-reads the
// temperate oceanic belt because the moisture INDEX does: Britain reads 0.46
// and semi-arid Mesopotamia 0.45 on the same scale, so closed-forest Europe
// gets a ~40% signal. This helper gives the mechanics the classifier's answer
// instead: a cached per-tile CLOSED-CANOPY mask over the axe-locked classes —
// temperate forest, temperate rainforest, taiga, boreal. Deliberately NOT
// included: tropical rainforest and humid subtropical (band 4) — the warm-wet
// belt is the DISEASE bar's ground (the same double-count temperateBand exists
// to prevent), and locking monsoon China's capacity is exactly the regression
// the COURT_SPHERE arm warned about. dry/sumDry pass 0 ("unknown", the
// classifier's own documented fallback, identical to resourceGen's) because
// the people-sim world does not retain those fields. Rebuilt on a slow cadence
// so climate drift, if any, re-derives the cover.
const CANOPY_REBUILD = 2000;
// THE shared per-tile biome field (owner 2026-08-24: "so now there is 1 unified
// biome map?" — "do it"). One Int8Array at sim resolution, classified by this
// module with the SAME inputs the atlas lens and resourceGen pass — including
// the dry-season fields, which state.js now carries onto the sim world
// (world._dryFrac/_summerDry) instead of the dry=0 "unknown" fallback the first
// canopy build used. Any mechanic that wants a biome reads THIS field; the
// atlas keeps its per-pixel render of the same classifier (a higher-resolution
// view of the same law, not a different law). Rebuilt on a slow cadence so
// climate drift re-derives the cover; on a loaded save the dry fields are
// absent until the next fresh world (they fall back to 0, which cannot move
// the canopy classes — the dry-season correction is warmth-gated to the hot
// bands the canopy set excludes).
export function ensureBiome(world) {
  let bm = world._biome;
  if (bm && bm.length === world.N && (world.step - (world._biomeStep || 0)) < CANOPY_REBUILD) return bm;
  const { N, elev, moist, temp } = world;
  const dryF = world._dryFrac, sumF = world._summerDry;
  if (!bm || bm.length !== N) bm = world._biome = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    bm[i] = elev[i] > 0
      ? classifyBiome(elev[i], moist[i], temp[i], dryF ? dryF[i] : 0, sumF ? sumF[i] : 0)
      : -1;
  }
  world._biomeStep = world.step | 0;
  return bm;
}
export function ensureCanopy(world) {
  let cn = world._canopy;
  if (cn && cn.length === world.N && (world.step - (world._canopyStep || 0)) < CANOPY_REBUILD) return cn;
  const bm = ensureBiome(world);
  if (!cn || cn.length !== world.N) cn = world._canopy = new Uint8Array(world.N);
  for (let i = 0; i < world.N; i++) {
    const b = bm[i];
    cn[i] = (b === B_TEMP_FOREST || b === B_TEMP_RAIN || b === B_TAIGA || b === B_BOREAL) ? 1 : 0;
  }
  world._canopyStep = world.step | 0;
  return cn;
}
