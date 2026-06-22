// ── Identity cohesion: the four identity maps as political forces ──────────
// Ancestry, Peoples, Language and Faith each push on the nation sim, but as
// DIFFERENT forces peaking in DIFFERENT eras, so the axis of political conflict
// SHIFTS across history — dynastic antiquity → the religious medieval → the
// bureaucratic / standardising early-modern → the nation-state.
//
// Salience is era-weighted (eraIdentityWeights). The per-province friction is the
// mismatch between a settlement's mixture and its STATE CORE (the capital's
// dominant identity on each axis), which feeds two existing levers in conquest.js:
//   • UNREST     — a heterodox-FAITH or foreign-PEOPLE province simmers and revolts
//                  (identityGrievance): heretic risings in the religious age, the
//                  restive national minority in the modern.
//   • ADMIN LOAD — a foreign-TONGUE province is costlier to govern, so a polyglot
//                  empire overreaches and sheds sooner (adminFriction).
// ANCESTRY is a faint, ever-present floor: a deeply foreign subject is harder to
// reconcile than a cousin people, but no one rallies to a haplogroup. The same
// model reads as a casus belli for war-targeting (armies.js).

// Share of identity `id` within a [[id, share], ...] mixture (0 if absent).
export function mixShare(mix, id) {
  if (!mix || id < 0) return 0;
  for (let i = 0; i < mix.length; i++) if (mix[i][0] === id) return mix[i][1];
  return 0;
}

// Fraction of a province NOT of the core's dominant identity on one axis (0 = same
// people/tongue/faith as the state core; 1 = wholly foreign). No core id → 0.
function layerMis(coreMix, sMix) {
  const core = coreMix && coreMix.length ? coreMix[0][0] : -1;
  return core < 0 ? 0 : 1 - mixShare(sMix, core);
}

// Era-dependent SALIENCE of each identity layer as a political force. The `year`
// passed in is the DEVELOPMENT pseudo-year (world._civYear, mapped from the leading
// state's organisation in index.js), not the wall-clock — so nationalism crests when
// civilisation actually reaches the industrial age, whenever that is, rather than on a
// fixed date. The ramp anchors still read as historical years because the mapping is
// calibrated to the historical organisation-vs-time curve.
export function eraIdentityWeights(year) {
  const ramp = (a, b) => Math.max(0, Math.min(1, (year - a) / (b - a)));
  return {
    // Faith: universal creeds make heterodoxy a cause for revolt from late antiquity;
    // it crests through the wars of religion and eases (never vanishing) in the
    // secular modern state.
    faith:  0.12 + 0.88 * ramp(100, 700) - 0.30 * ramp(1800, 1970),
    // Peoples: the NATIONAL idea — near-silent until the late 18th century, then the
    // defining force (unification AND the breakup of multi-ethnic empires).
    people: 0.08 + 0.92 * ramp(1750, 1920),
    // Language: administrative friction — always some, rising as states build the
    // bureaucracies that run on a single chancery tongue.
    lang:   0.25 + 0.50 * ramp(-500, 1750),
    // Ancestry: a faint ever-present substrate.
    anc:    0.12,
  };
}
export function identityWeightsNow(world) { return eraIdentityWeights(world._civYear ?? -9000); }

const GRIEVANCE_W = 0.6;   // peak identity contribution to a province's unrest (hunger still dominates)
const FRICTION_W  = 0.6;   // peak language surcharge on admin load (a wholly foreign-tongue province ≈ +0.45×)

// Popular identity grievance → UNREST (added to the hunger/tax/war grievances).
export function identityGrievance(cap, s, w) {
  if (!cap || cap === s || !s) return 0;
  const m = w.faith * layerMis(cap.faithMix, s.faithMix)
          + w.people * layerMis(cap.culMix, s.culMix)
          + w.anc   * layerMis(cap.ancMix, s.ancMix);
  return GRIEVANCE_W * Math.min(1, m);
}

// Administrative friction → ADMIN LOAD. Returns the FRACTION to add (caller does
// load × (1 + this)); a polyglot realm thus hits its reach budget on fewer provinces.
export function adminFriction(cap, s, w) {
  if (!cap || cap === s || !s) return 0;
  return FRICTION_W * w.lang * layerMis(cap.langMix, s.langMix);
}

// Label when identity is the LEADING grievance (info panel): which axis dominates.
export function identityGrievanceCause(cap, s, w) {
  if (!cap || cap === s) return "unrest";
  const f = w.faith  * layerMis(cap.faithMix, s.faithMix);
  const p = w.people * layerMis(cap.culMix, s.culMix);
  return p >= f ? "nationalism" : "religion";
}

// ── War-targeting casus belli (armies.js) ──────────────────────────────────
// A MULTIPLIER on the attack bar between two states: < 1 makes the war RIGHTEOUS
// (the bar is easier to clear) — a foreign-faith neighbour in the religious age, a
// foreign nation in the modern, or a province of the attacker's OWN people under
// foreign rule (irredentism). > 1 is KINSHIP RESTRAINT — co-religionists and
// co-nationals are spared. Era-weighted, so it is ~neutral in antiquity and shifts
// axis with the calendar exactly like the loyalty/unrest hooks.
const CASUS_W = 0.30;   // strength of the righteous-war / kinship-restraint bar shift
const IRRED_W = 0.25;   // extra eagerness to "liberate" a co-national province held by a foreign state
export function casusBelliMul(aCap, dCap, tileOwner, w) {
  if (!aCap || !dCap) return 1;
  const dom = (mix) => (mix && mix.length ? mix[0][0] : -1);
  // signed per axis: +1 wholly foreign (righteous), −1 same identity (kin → restraint)
  const sgn = (coreMix, otherMix) => { const id = dom(coreMix); return id < 0 ? 0 : 1 - 2 * mixShare(otherMix, id); };
  let R = w.faith  * sgn(aCap.faithMix, dCap.faithMix)
        + w.people * sgn(aCap.culMix,   dCap.culMix)
        + w.anc    * sgn(aCap.ancMix,   dCap.ancMix);
  // irredentist pull: the contested province's OWN people are the attacker's nation
  // under foreign rule — eagerly reclaimed in the national age (reads the tile owner).
  const pid = dom(aCap.culMix);
  if (pid >= 0 && tileOwner) R += IRRED_W * w.people * mixShare(tileOwner.culMix, pid);
  return Math.max(0.6, Math.min(1.6, 1 - CASUS_W * R));   // R>0 righteous → lower bar; R<0 kin → higher bar
}

