// ── The emblem transmission layer: heritable arms/banners that EVOLVE ──
//
// The standalone emblem ENGINE (src/sim/emblemGenome.js) turns a gene vector into
// a flat banner and can already EVOLVE it — found from soft "axes", drift under
// mutation, pass to a successor with cadency, recombine two coats under a union
// (marshalling as genetic crossover). What it deliberately never had (see the
// "What's deliberately NOT here yet" note in docs/emblems.md) is the half that
// wires it into the living world. THIS module is that half.
//
// Here every realm's emblem, every house's arms, every people's visual TRADITION
// and every creed's sacred sigil FALLS OUT of emergent state and then EVOLVES
// through the sim's own history:
//   • a people's TRADITION is founded from the land it cradles on and drifts when
//     a daughter people splits off (colony, dialect, ethnogenesis);
//   • a HOUSE's arms are minted from the realm's character when the house rises;
//   • a REALM's displayed emblem descends down its rulers (cadency), is MARSHALLED
//     when a new house inherits/unites a throne or when the realm swallows another,
//     and drifts when a realm shatters into successor states;
//   • a FAITH's sigil is a devout, aniconic sacred glyph that drifts on schism and
//     blends on syncretism.
//
// THE TWO CARDINAL RULES govern every line here.
//  1. NOTHING fires on a clock. An emblem is founded / inherited / marshalled
//     because of an EVENT (a house accedes, a realm is absorbed, a people splits)
//     and its LOOK is read from STATE — what the realm lives on (biome), how it
//     fights (temperament), how rich its court (treasury vs peers), how it worships
//     (doctrine), how developed & large it is (organisation + size). Never a step,
//     never a year. The "referent climb" the real history shows — a communal device
//     that the first royal house takes up and makes dynastic, then marshals as
//     houses unite — is gated on the EMERGENT arrival of a literate dynasty (the
//     same gate king-lists already use), not on a date.
//  2. Build the SYSTEM, never fit the OUTCOME. The look is produced by mapping
//     genuine state variables onto the engine's SOFT axes (each only makes a look
//     more likely, never forces it — every pattern stays reachable by every realm).
//     No constant is tuned to make a named realm look a certain way. Wealth and
//     size read RELATIVE to the world's own live median (self-calibrating on any
//     map / seed / pace — the codebase's _refRevenue idiom), so nothing is pinned
//     to an absolute gold figure or member count.
//
// STORAGE. Every field lives on an existing registry record (culture / dynasty /
// polity / faith), so it round-trips through save/load for FREE — persist.js
// serialises whole Map entries. Nothing here is read back by any other system, so
// emblems cannot perturb the sim's behaviour, determinism, or stylized facts; they
// are a pure, heritable OUTPUT laid over the world.
//
// DETERMINISM. Every operator is seeded from (world.seed, tag, ids) via hash32 —
// independent substreams (rng.js discipline), so an emblem and its whole
// evolutionary tree replay identically and adding this system perturbs no other's
// dice. No Math.random, no Date.now.

import { hash32 } from "./rng.js";
import { T } from "./tuning.js";
import { getPolity } from "./entities.js";
import { getCulture, dominantCulture } from "./cultures.js";
import { getFaith, dominantFaith } from "./faiths.js";
import { getDynasty, getPerson } from "./dynasties.js";
import { logEvent } from "./events.js";
import {
  foundGenome, mutateGenome, inheritGenome, crossGenome, blazonGenome,
} from "../emblemGenome.js";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const CITY_TIER = 2;   // tier ≥ 2 reads as a city (settlement.js: 0 rural, 1 town, 2 city, 3 metropolis)

// A deterministic emblem seed from stable ids — its OWN substream, so emblem
// draws never touch another system's sequence.
const eseed = (world, ...parts) => hash32(world.seed || 1, "emblem", ...parts);

// A gentle bell step in [-0.5, 0.5] for drifting an axis, from a seeded stream.
function bellFrom(seed) {
  let a = seed >>> 0;
  const r = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (r() + r() + r() - 1.5) / 3;
}

// ── environment axes: the biome a people heraldises ──────────────────────────
// A settlement's homeland terrain → the four ENVIRONMENT axes the engine reads
// (maritime / sylvan / arid / montane). All from cached site statics (computed
// once at founding by settlement.js) — pure reads, no mutation. These are what a
// people depicts because it depends on it: a coastal people the sea, a woodland
// people the forest, a desert people the sparse sun-and-sand, a highland people
// stark stone. The moisture lines (arid < ~0.34, forest ≳ 0.40) are the sim's own
// biome classification, not a value tuned to any outcome.
function envAxes(world, s) {
  if (!s) return {};
  const river = clamp01(s._riverAcc || 0);
  const sea = clamp01((s.waterAccess || 0) - river);          // sea-facing share (a river town isn't "maritime")
  const moist = s._climMoist != null ? clamp01(s._climMoist) : 0.5;
  const temp = s._climTemp != null ? clamp01(s._climTemp) : 0.5;
  const rugged = clamp01(s._rugged || 0);
  const timber = s.localRes ? clamp01(s.localRes.timber || 0) : 0;
  // aridity: prefer the sim's own cached signal, else fall to the moisture line
  const arid = s._aridity != null ? clamp01(s._aridity) : clamp01((0.34 - moist) / 0.34);
  // sylvan: forest needs both water AND warmth (and timber on the ground is the
  // clinching sign) — a wet cold tundra or a wet hot swamp is not woodland.
  const sylvan = clamp01(Math.max((moist - 0.40) / 0.45, timber) * (0.35 + 0.65 * temp));
  return { maritime: sea, sylvan, arid, montane: rugged };
}

// ── the world's live realm baselines (self-calibrating peer medians) ─────────
// Wealth and size only mean anything RELATIVE to the other realms alive right now
// — "rich" is rich-for-this-world, "big" is big-for-this-world. A per-pass median
// (the _refRevenue idiom) self-calibrates on any map, seed, resolution or pace, so
// no absolute gold figure or member count is ever hard-coded. Transient cache,
// recomputed at most once per step (it is a read-through of the live country view,
// exactly like world.countries — never serialized, never hashed, never read
// across ticks outside this pass).
function baselines(world) {
  if (world._emblemBase && world._emblemBase.step === world.step) return world._emblemBase;
  const treas = [], sizes = [];
  if (world.countries) for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (pol && pol.endedStep < 0) treas.push(Math.max(0, pol.treasury || 0));
    sizes.push(c.members ? c.members.length : 1);
  }
  const median = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const base = { step: world.step, medTreas: Math.max(1, median(treas)), medSize: Math.max(1, median(sizes)) };
  world._emblemBase = base;
  return base;
}

// ── ethos & structure axes: the realm's character ───────────────────────────
// The non-environment axes, read from the polity's emergent state at the moment
// the look is founded. Temperament (personality.js) IS the realm's disposition;
// wealth-vs-peers IS whether its court is rich; organisation + relative size IS
// how grand and centralised a state it has become; the doctrine composite IS how
// devoutly the court holds its faith. Each maps to a soft lean; the outcome is
// whatever the engine makes of it.
function ethosAxes(world, c) {
  const pol = getPolity(world, c.id);
  const cap = c.capital;
  const axes = {};

  // TEMPERAMENT — the two material axes of personality.js (aggression, commerce),
  // each in −1..1; the assertive pole leans the look.
  const per = pol && pol.personality;
  if (per) {
    axes.martial = clamp01(0.5 + (per.aggression || 0) * 0.5);      // blood-and-iron gules/sable, a bold charge
    axes.mercantile = clamp01(0.5 + (per.commerce || 0) * 0.5);     // bright bars, ships / keys / scales
  }

  // STATEHOOD — organisation knowledge + size relative to the world's realms,
  // read as one 0..1 "how grand & centralised": imperial at the top, tribal at the
  // bottom. Self-calibrating (size normalised on the live median) and gated on
  // EMERGENT development (organisation), never a clock — so a world that stays
  // primitive keeps flying clan brands, one that builds empires flies quartered
  // regalia, on any seed.
  const b = baselines(world);
  const org = cap && cap.knowledge ? clamp01(cap.knowledge.organization || 0) : 0;
  const nMembers = c.members ? c.members.length : 1;
  const size = nMembers / (nMembers + b.medSize);                   // 0.5 at the median realm, →1 for a giant
  const statehood = clamp01(org * 0.6 + size * 0.4);
  axes.imperial = statehood;
  axes.tribal = clamp01(1 - statehood);

  // WEALTH — court riches vs the world's median treasury → the regal, gilded look.
  const treasury = pol ? Math.max(0, pol.treasury || 0) : 0;
  axes.regal = treasury / (treasury + b.medTreas);                 // 0.5 at the median, →1 for a rich court

  // FAITH — how devoutly the court holds its state faith (the theocracy gate's own
  // product: the capital's adherence share × doctrine zeal × hierarchy).
  axes.devout = devoutness(world, c, pol);

  // AUSTERITY — an ascetic doctrine strips the field bare; so does a pious-but-poor
  // realm (devotion without the gold to gild it).
  const asc = doctrineOf(world, c, pol) ? clamp01((doctrineOf(world, c, pol).asceticism) || 0) : 0;
  axes.austere = clamp01(Math.max(asc, axes.devout * (1 - axes.regal)));

  // PASTORAL — a countryside of herders (little urbanisation + horse / livestock
  // land) flies plain earth-toned fields with beasts.
  axes.pastoral = pastoralness(world, c);

  return axes;
}

function doctrineOf(world, c, pol) {
  const fid = pol && pol.faithId >= 0 ? pol.faithId : (c.capital ? dominantFaith(c.capital) : -1);
  const f = fid >= 0 ? getFaith(world, fid) : null;
  return f && f.doctrine ? f.doctrine : null;
}

function devoutness(world, c, pol) {
  const cap = c.capital;
  const share = cap && cap.faithMix && cap.faithMix.length ? clamp01(cap.faithMix[0][1]) : 0;
  const d = doctrineOf(world, c, pol);
  if (!d) return 0;
  const zeal = clamp01(d.zeal || 0), hier = clamp01(d.hierarchy || 0);
  return clamp01(share * (0.4 + 0.6 * zeal) * (0.4 + 0.6 * hier));
}

function pastoralness(world, c) {
  const members = c.members || [];
  let rural = 0, n = 0;
  for (const m of members) { n++; const tier = m && typeof m === "object" ? (m.tier | 0) : 0; if (tier < CITY_TIER) rural++; }
  const ruralFrac = n ? rural / n : 1;
  const cap = c.capital;
  const horses = cap && cap.localRes ? clamp01(cap.localRes.horses || 0) : 0;
  const livestock = cap && cap._livestock != null ? clamp01(cap._livestock) : 0;
  return clamp01(ruralFrac * 0.45 + Math.max(horses, livestock) * 0.6);
}

// Drift a set of axes by a bell step ∝ strength (a daughter people's tradition
// wanders from its parent's, further the deeper it branched).
function driftAxes(axes, seed, strength) {
  const out = {};
  let i = 0;
  for (const k in axes) out[k] = clamp01(axes[k] + bellFrom((seed + i++ * 0x9e3779b9) >>> 0) * strength);
  return out;
}
// Blend two axis sets (daughter = parent-drifted grammar, adapted toward its own
// new homeland). Missing keys default to the other set's value.
function blendAxes(a, b, w) {
  const out = { ...a };
  for (const k in b) out[k] = a[k] != null ? a[k] * (1 - w) + b[k] * w : b[k];
  return out;
}

// ── culture TRADITION: a people's shared visual grammar ──────────────────────
// The stable, environment-and-lineage half of a people's look (the "Japanese mon
// vs European quartered heraldry" layer). A root people's tradition is its
// cradle's biome; a daughter people carries the parent's tradition, DRIFTED by how
// far it branched and blended toward its own new homeland (a colony in a forest
// grows woodland motifs even if the parent was maritime). Founded lazily and
// ONCE (idempotent) — the grammar is then inherited, never recomputed on a clock.
export function ensureTradition(world, culture) {
  if (!T.EMBLEMS || !culture) return null;
  if (culture.tradition) return culture.tradition;
  const seed = eseed(world, "trad", culture.id);
  const origin = culture.originSettlementId >= 0 && world._byId ? world._byId.get(culture.originSettlementId) : null;
  const parent = culture.parentCultureId >= 0 ? getCulture(world, culture.parentCultureId) : null;
  let axes;
  if (parent) {
    const pt = ensureTradition(world, parent);
    const div = culture.divergence != null ? clamp01(culture.divergence) : 0.5;
    const drifted = driftAxes(pt ? pt.axes : {}, eseed(world, "tradD", culture.id), 0.25 * div);
    axes = blendAxes(drifted, envAxes(world, origin), 0.4 * div);   // adapt to the new land ∝ divergence
  } else {
    axes = envAxes(world, origin);                                  // a root people: its cradle's biome
  }
  if (culture.hue != null) axes.hue = ((culture.hue % 360) + 360) % 360 / 360;   // the people's colour family (weak baseline)
  culture.tradition = { seed, axes };
  return culture.tradition;
}

function traditionAxes(world, cultureId) {
  const cul = getCulture(world, cultureId);
  const t = cul ? ensureTradition(world, cul) : null;
  return t ? t : { seed: eseed(world, "trad0", cultureId | 0), axes: {} };
}

// ── faith SIGIL: a procedural sacred glyph ──────────────────────────────────
// A creed's own evolvable sign — devout and aniconic by lean (the engine's sacred
// sigil vocabulary), hued to the faith, grounded in its people's tradition and
// sharpened by its doctrine (a militant creed a bolder sign, an ascetic one a
// barer one). A SCHISM drifts the parent's sigil (a reform reads as a variant of
// the same sign); a SYNCRETIC fusion blends two parents' sigils (crossover).
// Routed through newFaith so folk, organised, schism and syncretic faiths all get
// one uniformly. Idempotent.
export function ensureSigil(world, faith) {
  if (!T.EMBLEMS || !faith) return null;
  if (faith.sigil) return faith.sigil;
  const seed = eseed(world, "sigil", faith.id);
  const parent = faith.parentFaithId >= 0 ? getFaith(world, faith.parentFaithId) : null;
  const parent2 = faith.parentFaith2 >= 0 ? getFaith(world, faith.parentFaith2) : null;
  if (faith.syncretic && parent && parent2) {
    faith.sigil = crossGenome(ensureSigil(world, parent), ensureSigil(world, parent2), seed);
  } else if (parent) {
    faith.sigil = mutateGenome(ensureSigil(world, parent), seed, 1);
  } else {
    const trad = traditionAxes(world, faith.cultureId);
    const axes = { ...trad.axes, devout: 0.8 };
    if (faith.hue != null) axes.hue = ((faith.hue % 360) + 360) % 360 / 360;
    const d = faith.doctrine;
    if (d) { axes.austere = clamp01(d.asceticism || 0); axes.boldness = clamp01(0.4 + (d.militancy || 0) * 0.4); }
    faith.sigil = foundGenome((trad.seed ^ seed) >>> 0, axes);
  }
  return faith.sigil;
}

// ── dynasty ARMS: the house's founding look ─────────────────────────────────
// A house's arms are minted from its founding realm's TRADITION (its people's
// grammar) and the realm's CHARACTER at the moment the house rises (its ethos and
// standing), tilted a touch by the founder's own temperament (a bold founder, a
// bolder charge). These are the house's canonical arms — the family resemblance
// every realm the house comes to rule carries. Idempotent.
export function foundHouseArms(world, dyn, polityId, founder) {
  if (!T.EMBLEMS || !dyn) return null;
  if (dyn.arms) return dyn.arms;
  const c = world.countries ? world.countries.get(polityId) : null;
  const trad = traditionAxes(world, dyn.cultureId);
  const axes = { ...trad.axes };
  if (c) Object.assign(axes, ethosAxes(world, c));
  if (founder && founder.traits) {
    axes.martial = clamp01((axes.martial != null ? axes.martial : 0.5) + (founder.traits.boldness || 0) * 0.2 + (founder.traits.ruthlessness || 0) * 0.15);
    axes.figuration = clamp01(0.5 + (founder.traits.vigor || 0) * 0.2);
  }
  dyn.arms = foundGenome((eseed(world, "arms", dyn.id) ^ trad.seed) >>> 0, axes);
  return dyn.arms;
}

// ── polity EMBLEM: the realm's displayed, evolving arms ─────────────────────
// The single source of truth for what a realm flies. Founded as a CIVIC device
// (place + people, from the culture's tradition + the realm's state) while the
// realm is pre-dynastic — the institution referent, before literacy brings kings.
// Idempotent.
export function foundCivicEmblem(world, c) {
  const pol = getPolity(world, c.id);
  if (!T.EMBLEMS || !pol || pol.emblem) return pol ? pol.emblem : null;
  const culId = pol.cultureId >= 0 ? pol.cultureId : (c.capital ? dominantCulture(c.capital) : -1);
  const trad = traditionAxes(world, culId);
  const axes = { ...trad.axes, ...ethosAxes(world, c) };
  pol.emblem = foundGenome((eseed(world, "civic", c.id) ^ trad.seed) >>> 0, axes);
  pol._emblemKind = "civic";
  return pol.emblem;
}

// ── the ACCESSION hook: descent, adoption, and marshalling ──────────────────
// Called from crown() — the universal accession funnel (every throne change passes
// through it). `oldHouseId` is the realm's house BEFORE this accession (captured at
// crown entry). The three cases are the real heraldic grammar:
//   • same house, ordinary succession → the arms pass DOWN the line with a mark of
//     difference (cadency) and a little drift: recognisably the same house.
//   • the realm's FIRST royal house over a communal device → the house TAKES UP the
//     civic emblem and makes it dynastic (continuity — the commune's arms become the
//     crown's). This is the referent climbing institution → lineage, fired by the
//     emergent arrival of a literate house, never a date.
//   • a DIFFERENT house on an existing throne (inheritance, election, a won claim,
//     a usurpation) → the two lineages are MARSHALLED on one shield (crossover with
//     accumulating quarters — heraldry's real union of arms).
export function emblemOnAccession(world, polity, person, dyn, how, newHouse, oldHouseId) {
  if (!T.EMBLEMS || !polity) return;
  const seed = eseed(world, "acc", polity.id, (person && person.id) || 0);
  if (dyn && !dyn.arms) foundHouseArms(world, dyn, polity.id, person);
  const prior = polity.emblem;

  // A DYNASTIC UNION — a house comes to hold this crown ALONGSIDE another, by
  // inheritance or a won claim (how === "claim", the personal-union / inherited-throne
  // path) — MARSHALS the two lineages on one shield: the union quarters its arms. This
  // is heraldry's real, and almost only, source of quartering (the Habsburg accretion,
  // England quartering France on Edward III's claim). Making it the SOLE marshalling
  // trigger keeps quartered arms the EXCEPTION they are in reality — a realm that
  // serially unites crowns accretes quarters (capped at four), the rest stay simple.
  if (how === "claim" && prior && dyn && dyn.arms && dyn.arms !== prior) {
    polity.emblem = crossGenome(dyn.arms, prior, seed);
    polity._emblemKind = "house";
    logEmblem(world, "emblem.marshalled", polity, person, dyn, how);
    return;
  }
  if (prior) {
    // A realm's arms are TERRITORIAL — they outlast the house. An ordinary succession,
    // a new local line after a succession crisis, an elected or clerical office
    // changing hands: none repaint the realm's shield (France stayed fleur-de-lys
    // across Valois and Bourbon). The ONE change here is the referent climbing
    // institution → lineage: the realm's FIRST royal house takes up the communal
    // device as its own dynastic arms — fired by the emergent arrival of a literate
    // house (the king-list gate), never a date.
    if (polity._emblemKind === "civic") {
      if (dyn) dyn.arms = prior;
      polity._emblemKind = "house";
      logEmblem(world, "emblem.dynastic", polity, person, dyn, how);
    }
    return;
  }
  // The realm's first sovereign with no prior device flies the house's arms.
  polity.emblem = (dyn && dyn.arms) || foundGenome(seed, {});
  polity._emblemKind = "house";
}

// NOTE ON CONQUEST. Raw conquest does NOT marshal. When a realm is destroyed and
// absorbed, its arms are extinguished (they persist on its never-deleted record, so a
// later restoration digs them back up) — annexation is not a claim of that crown's
// sovereignty, and real heraldry does not quarter every conquered province. The one
// conquest that DOES quarter — a won succession war that seats the victor's house on
// the defeated throne as a personal UNION (CLAIMANT_WARS) — flows through crown() as a
// how==="claim" accession and marshals via emblemOnAccession above, exactly as the
// dynastic mechanism should. So the marshalling grammar has a single, faithful source.

// ── the FRAGMENTATION hook: a successor state inherits its parent's arms ─────
// Called beside inheritPersonality() at the secession / shatter sites: a splinter
// realm carries the dead empire's arms, DRIFTED (the Diadochi resembling their
// predecessor before diverging). A restored nation (same id) keeps its OWN stored
// emblem — the guard below no-ops when the child already has one.
export function inheritEmblem(world, parentId, childId) {
  if (!T.EMBLEMS) return;
  const child = getPolity(world, childId);
  if (!child || child.emblem) return;
  const parent = getPolity(world, parentId);
  if (!parent || !parent.emblem) return;
  // A successor / breakaway realm bears the parent realm's arms DIFFERENCED — the
  // cadet branch's mark of cadency (and, via the engine's rare macro-mutation, the
  // occasional deeper divergence): the Diadochi read as heirs of their predecessor
  // before they grow apart. This is where descent + cadency genuinely live — a junior
  // line founding its own state — rather than on every peaceful succession.
  child.emblem = inheritGenome(parent.emblem, eseed(world, "splinter", childId));
  child._emblemKind = parent._emblemKind || "civic";
}

// ── the per-pass reconciler ─────────────────────────────────────────────────
// Run from updatePolities right after reconcilePolities (so every substantial
// polity record exists). It (a) FOUNDS the missing pieces — a civic emblem for a
// realm not yet under a house — and (b) keeps the displayed emblem tracking the
// referent: once a house reigns, the realm flies its house's arms. Founding is
// idempotent; evolution happens only at the event hooks above. This never mutates
// any state another system reads, so it cannot perturb history.
export function reconcileEmblems(world, countries) {
  if (!T.EMBLEMS || !countries) return;
  for (const c of countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol.endedStep >= 0 || !c.capital) continue;
    const dyn = pol.dynastyId >= 0 ? getDynasty(world, pol.dynastyId) : null;
    if (dyn) {
      // a reigning house: ensure it has arms, and (for a realm whose emblem was
      // never founded — e.g. a house that acceded before the first reconcile) fly
      // them. Ordinary evolution has already run through emblemOnAccession; here we
      // only fill a genuine gap, never overwrite an evolved emblem.
      if (!dyn.arms) foundHouseArms(world, dyn, c.id, getPerson(world, pol.rulerId));
      if (!pol.emblem && dyn.arms) { pol.emblem = dyn.arms; pol._emblemKind = "house"; }
    } else if (!pol.emblem) {
      foundCivicEmblem(world, c);
    }
  }
}

// ── read accessors (for the snapshot / tools / chronicle) ───────────────────
export function emblemOf(world, id) {
  const pol = getPolity(world, id);
  return pol ? pol.emblem || null : null;
}
export function blazonOf(world, id) {
  const g = emblemOf(world, id);
  return g ? blazonGenome(g) : null;
}

// A small, gated history note so the evolution is VISIBLE in the event feed /
// chronicle (marshalling, a union of arms, a house taking up a civic device). Kept
// deterministic and output-only — never read back by any mechanism.
function logEmblem(world, type, polity, person, dyn, how, other) {
  if (!T.EMBLEM_EVENTS) return;
  const capS = world._byId ? world._byId.get(polity.capitalId) : null;
  logEvent(world, type, {
    polity: polity.id, name: polity.name,
    dynasty: dyn ? dyn.id : (polity.dynastyId ?? -1), dynastyName: dyn ? dyn.name : undefined,
    person: person ? person.id : undefined, personName: person ? person.name : undefined,
    other: other ? other.id : undefined, otherName: other ? other.name : undefined,
    how,
    x: capS ? capS.pos.x | 0 : undefined, y: capS ? capS.pos.y | 0 : undefined,
  });
}
