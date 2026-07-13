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

// Organisation → development pseudo-year (moved from index.js so the identity
// layer owns its own development mapping). Calibrated to the historical
// organisation-vs-time curve; the YEARS are labels for the ramp anchors above,
// the INPUT is always emergent state.
export const CIV_ORG_YEAR = [
  [0.10, -6000], [0.18, -3300], [0.38, -800], [0.50, 200], [0.62, 1100],
  [0.81, 1560], [0.88, 1680], [0.94, 1800], [0.98, 1875], [0.995, 1960],
];
export function civYearFromOrg(org) {
  const A = CIV_ORG_YEAR;
  if (org <= A[0][0]) return A[0][1];
  if (org >= A[A.length - 1][0]) return A[A.length - 1][1];
  let i = 1; while (i < A.length && org > A[i][0]) i++;
  const a = A[i - 1], b = A[i], t = (org - a[0]) / (b[0] - a[0]);
  return a[1] + (b[1] - a[1]) * t;
}

// Salience for the states actually INVOLVED — reads the more developed
// party's own capital organisation, never the planet-wide leader. (The old
// global read gave every realm the single most advanced capital's era: an
// uncontacted bronze-age continent acquired modern nationalist politics the
// moment anyone, anywhere, industrialised.) Taking the MAX of the two sides
// is deliberate: ideas travel with contact, and the more modern party brings
// the national/confessional question into the relationship with it — while
// two ancient states in contact stay ancient. Self-calibrating per region.
export function identityWeightsFor(world, a, b) {
  const orgOf = (x) => (x && x.knowledge && x.knowledge.organization) || 0;
  return eraIdentityWeights(civYearFromOrg(Math.max(orgOf(a), orgOf(b))));
}

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

// Resistance of a settlement to being PEACEFULLY ABSORBED into a foreign realm
// (conquest.js absorbWeakNeighbors). A city of the absorber's own people, tongue
// and faith slides into its orbit readily (building a national CORE); a wholly
// foreign one clings to independence and is only taken by force. Returns the
// era-weighted MEAN mismatch across all four identity axes, normalized to [0,1]
// (0 = kin, integrates freely; 1 = wholly foreign on every salient axis).
//
// Because the weights are era-derived from emergent development (identityWeightsNow
// reads _civYear, mapped from the leading state's organisation — NOT the wall-clock),
// this self-calibrates: in antiquity the salient axes are faith/tongue and the people
// axis is near-silent, so classical empires can still be multi-ethnic (Rome, Persia,
// the Mongols); as development reaches the national age the people axis crests and
// polyglot empires fracture into nation-states — emergent, never time-gated.
export function absorbResistance(absorberCap, s, w) {
  if (!absorberCap || absorberCap === s || !s) return 0;
  // The PEOPLE axis reads the whole province, not just the town census: under
  // T.TILE_IDENTITY every province carries its countryside's aggregate culture
  // (s._rurCulMix, popField-weighted — identityField.js) and the mismatch is
  // the people-weighted blend of town and countryside. EXACT, not an
  // approximation: layerMis is linear in the mixture's share of the core id,
  // so blending the scalars people-weighted equals measuring the blended
  // mixture. Rural people-weight converts to census units via the PROV_FIELD
  // anchor (world._provRatio); anchor absent (PROV_FIELD off / not yet
  // stamped) → town-only, exactly the legacy read. Lever off: s._rurCulMix is
  // never set, town-only — byte-identical.
  let peopleMis = layerMis(absorberCap.culMix, s.culMix);
  const wRur = s._rurCulMix ? (s._rurCulPeople || 0) : 0;   // already census units (stamped ×provRatio, identityField.js)
  if (wRur > 0) {
    const wCity = Math.max(0, s.people || 0);
    const rurMis = layerMis(absorberCap.culMix, s._rurCulMix);
    peopleMis = (peopleMis * wCity + rurMis * wRur) / (wCity + wRur);
  }
  const m = w.faith  * layerMis(absorberCap.faithMix, s.faithMix)
          + w.people * peopleMis
          + w.lang   * layerMis(absorberCap.langMix,  s.langMix)
          + w.anc    * layerMis(absorberCap.ancMix,   s.ancMix);
  const wsum = w.faith + w.people + w.lang + w.anc;
  return wsum > 0 ? Math.min(1, m / wsum) : 0;
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
export function casusBelliMul(aCap, dCap, tileOwner, w, tileCulShare) {
  if (!aCap || !dCap) return 1;
  const dom = (mix) => (mix && mix.length ? mix[0][0] : -1);
  // signed per axis: +1 wholly foreign (righteous), −1 same identity (kin → restraint)
  const sgn = (coreMix, otherMix) => { const id = dom(coreMix); return id < 0 ? 0 : 1 - 2 * mixShare(otherMix, id); };
  let R = w.faith  * sgn(aCap.faithMix, dCap.faithMix)
        + w.people * sgn(aCap.culMix,   dCap.culMix)
        + w.anc    * sgn(aCap.ancMix,   dCap.ancMix);
  // irredentist pull: the contested province's OWN people are the attacker's nation
  // under foreign rule — eagerly reclaimed in the national age. `tileCulShare`
  // (T.TILE_IDENTITY, armies.js) is THE CONTESTED GROUND's own share of the
  // attacker's people, read from the per-tile identity field — the honest local
  // read; without it the term reads the tile OWNER entity (a settlement in the
  // legacy modes; under tile-war the country adapter, where it was structurally
  // inert — the audit's open item, now wired).
  const pid = dom(aCap.culMix);
  if (pid >= 0) {
    if (tileCulShare !== undefined) R += IRRED_W * w.people * tileCulShare;
    else if (tileOwner) R += IRRED_W * w.people * mixShare(tileOwner.culMix, pid);
  }
  return Math.max(0.6, Math.min(1.6, 1 - CASUS_W * R));   // R>0 righteous → lower bar; R<0 kin → higher bar
}

