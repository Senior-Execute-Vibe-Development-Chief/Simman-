// ── Heraldry: a realm's visual identity, PROJECTED from what it has become ──
//
// This module invents NOTHING. A coat of arms / banner here is a deterministic
// READOUT of state the world already grew — the same discipline as every other
// subsystem: build the cause, read the effect, never paint it.
//
//   • TINCTURES (the palette) fall out of MATERIAL: which dye/pigment resources a
//     realm's territory and trade actually give it — the reason Tyrian purple
//     meant "imperial" is that murex was ruinously expensive, so only a rich
//     realm could fly purpure. Personality and the state faith then BIAS the
//     palette (a warlike people reddens; a mercantile one gilds; an ascetic
//     creed strips it toward austere metal).
//   • The CHARGE (the emblem) is drawn from the salient facts of the realm's life
//     — the beasts of its ground, its economy (a maritime power shows a ship, an
//     agrarian one a sheaf), its martial history, its faith's own holy device.
//   • The LAYOUT (division, quartering, ornateness) reads political STRUCTURE and
//     DEVELOPMENT: a single people on one land is plain; a realm marshalling many
//     peoples quarters them; a developed, literate state carries more detail.
//   • Whether it reads as a dynastic COAT OF ARMS or a simplified national FLAG is
//     itself emergent: identity vested in the ruling HOUSE (ornate arms) until
//     development is high AND the identity has BROADENED to the nation (a bold,
//     few-colour flag). Driven by state — never by the calendar/era.
//
// CLUSTERING & DIVERGENCE come for free through REAL channels, not a shared
// display colour: a stock shares an intrinsic aesthetic seed (entityRng on the
// culture FAMILY), co-religionists share their faith's own liturgical tincture
// and holy device (seeded on the faith's ROOT), and neighbours sharing dyes and
// biome share a regional look. So related realms look related and rivals of a
// different stock/creed look distinct — the pan-colour effect, caused by descent
// and faith rather than scripted.
//
// PURE: armsOf() only READS the world (personalityOf lazily fills a polity's
// temperament exactly as every other reader does; nothing else mutates). It is a
// projection, so it can be recomputed any time, on any seed, and replays
// identically.

import { personalityOf } from "./peopleSim/personality.js";
import { getFaith, faithTemperament } from "./peopleSim/faiths.js";
import { getCulture, familyOf, dominantCulture } from "./peopleSim/cultures.js";
import { dominantFaith } from "./peopleSim/faiths.js";
import { getPolity } from "./peopleSim/entities.js";
import { entityRng, hash32 } from "./peopleSim/rng.js";

// ── Tinctures ─────────────────────────────────────────────────────────────
// The heraldic palette: two METALS (or, argent) and the COLOURS. The rule of
// tincture — never colour-on-colour or metal-on-metal — is a real contrast
// constraint (arms had to read at a distance), so we honour it when picking what
// sits on what. RGBs are muted, aged-pigment tones (not primary screen colours),
// which is what makes a sheet of these read as heraldry rather than a palette.
export const TINCTURES = {
  or:      { rgb: [0xd7, 0xb0, 0x45], metal: true,  label: "or" },       // gold
  argent:  { rgb: [0xe9, 0xe7, 0xdd], metal: true,  label: "argent" },   // silver / white
  gules:   { rgb: [0xa6, 0x2b, 0x2f], metal: false, label: "gules" },    // red
  azure:   { rgb: [0x28, 0x4b, 0x93], metal: false, label: "azure" },    // blue
  vert:    { rgb: [0x2f, 0x74, 0x42], metal: false, label: "vert" },     // green
  purpure: { rgb: [0x6d, 0x2e, 0x7e], metal: false, label: "purpure" },  // purple
  sable:   { rgb: [0x27, 0x25, 0x2b], metal: false, label: "sable" },    // black
  tenne:   { rgb: [0xb4, 0x5d, 0x2b], metal: false, label: "tenné" },    // orange-tan
};
const TINCTURE_IDS = Object.keys(TINCTURES);

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function pos(x) { return x > 0 ? x : 0; }

// ── Material signature ──────────────────────────────────────────────────────
// Mean local resources across the realm's settled members (capital weighted
// double — a realm's heart supplies its court), plus the capital's water access
// and development. This is the physical substrate the palette and charge read.
function realmSignature(world, c) {
  const cap = c.capital;
  const mat = {};
  let n = 0;
  const add = (s, w) => {
    if (!s || s.mode !== "settled") return;
    const lr = s.localRes || {};
    for (const k in lr) mat[k] = (mat[k] || 0) + (lr[k] || 0) * w;
    n += w;
  };
  add(cap, 2);
  if (c.members) for (const s of c.members) if (s !== cap) add(s, 1);
  if (n > 0) for (const k in mat) mat[k] /= n;
  const K = (cap && cap.knowledge) || {};
  const water = (cap && cap.waterAccess) || 0;
  const navigation = K.navigation || 0;
  // MARITIME ≠ riverside. Nearly every capital sits on water (settlements need
  // it), so waterAccess alone is no signal for a SEA power. What sets a Phoenicia
  // apart is real seafaring: navigation tech and an actual sea-trade network
  // (_seaReach), with only a true coast (very high water) adding to it. This is
  // what earns the azure field and the ship — a river town gets neither.
  const seaReach = cap && cap._seaReach ? cap._seaReach.size : 0;
  const maritime = clamp01(navigation * 0.8 + Math.min(1, seaReach / 6) * 0.8 + pos(water - 0.85) * 0.6);
  return { mat, water, maritime, org: K.organization || 0, metallurgy: K.metallurgy || 0, navigation };
}

// A realm's dominant people share (population-weighted) and how many distinct
// peoples it holds — the "one nation vs a marshalled patchwork" reading that
// sets both the flag/arms form and the quartering.
function peoplesOf(world, c) {
  const pop = new Map();
  let total = 0;
  if (c.members) for (const s of c.members) {
    if (s.mode !== "settled") continue;
    const cid = dominantCulture(s);
    if (cid < 0) continue;
    const p = Math.max(1, s.people || 0);
    pop.set(cid, (pop.get(cid) || 0) + p);
    total += p;
  }
  let domId = -1, domPop = 0;
  for (const [cid, p] of pop) if (p > domPop) { domPop = p; domId = cid; }
  let distinct = 0;
  for (const [, p] of pop) if (p / Math.max(1, total) >= 0.12) distinct++;   // a people worth marshalling
  return { domId, domShare: total > 0 ? domPop / total : 1, distinct: Math.max(1, distinct) };
}

// ── The faith's own emblem: a liturgical tincture + a holy device ───────────
// Seeded on the faith FAMILY (rootFaithId) and shaped by doctrine, so EVERY
// realm of that religion carries the same sacred colour/device — the cross-and-
// crescent, pan-Islamic-green channel — while a schism (its own root band) reads
// as a related shade. Returns null for folk / stateless faith (no organized
// device to fly).
function faithEmblem(world, faithId) {
  const f = getFaith(world, faithId);
  if (!f || f.kind !== "organized") return null;
  const root = f.rootFaithId ?? f.id;
  const d = f.doctrine || {};
  // Liturgical tincture: doctrine decides the FAMILY of colour; the root seed
  // picks the exact one, so sibling creeds of one root share a band.
  let liturg;
  if ((d.asceticism || 0) > 0.6) liturg = "argent";                 // renunciation → white
  else if ((d.militancy || 0) > 0.55) liturg = "gules";             // holy war → red
  else if ((d.worldliness || 0) > 0.6) liturg = "or";               // engaged, rich → gold
  else if ((d.hierarchy || 0) > 0.6) liturg = "azure";              // ordered church → blue
  else liturg = ["vert", "purpure", "azure", "or"][hash32(root, "liturg") % 4];
  // Holy device: hierarchy → an ordered cross; militancy → a mullet (star);
  // low hierarchy / mystical → a crescent; ascetic → a plain roundel (a disc).
  let device;
  if ((d.asceticism || 0) > 0.6) device = "roundel";
  else if ((d.hierarchy || 0) > 0.6) device = "cross";
  else if ((d.militancy || 0) > 0.5) device = "star";
  else device = ["crescent", "cross", "star"][hash32(root, "device") % 3];
  return { liturg, device, zeal: d.zeal || 0.4, militancy: d.militancy || 0, hierarchy: d.hierarchy || 0 };
}

// ── Palette: pigment availability, biased by character and creed ────────────
function pigmentScores(world, c, sig, pers, emblem) {
  const m = sig.mat;
  const water = sig.water;
  // Base availability — what the ground and trade actually yield. Small floors
  // where a pigment is near-universal (ochre red, charcoal black, leaf green) so
  // no realm is left with an empty palette.
  const s = {
    purpure: (m.dyes || 0) * 1.2 + (m.gems || 0) * 0.7,                     // murex / gemstone dye — rare, prestige
    or:      (m.precious || 0) * 1.2 + (m.incense || 0) * 0.5,              // gold, gilding
    gules:   (m.iron || 0) * 0.5 + (m.copper || 0) * 0.5 + 0.18,           // red earth / ochre — common
    azure:   sig.maritime * 0.9 + (m.dyes || 0) * 0.3,                      // a SEA power's blue + woad/indigo dye
    vert:    (m.timber || 0) * 0.8 + 0.10,                                  // forest green
    argent:  (m.salt || 0) * 0.9 + (m.furs || 0) * 0.6 + 0.12,             // salt, snow, winter pelts
    sable:   (m.coal || 0) * 1.0 + (m.iron || 0) * 0.2 + 0.10,             // coal, charcoal
    tenne:   (m.copper || 0) * 0.6 + (m.spices || 0) * 0.5,                 // copper, warm spice-lands
  };
  // Prestige gate: purple and gold are EXPENSIVE — a realm flies them only if it
  // has the materials AND the commerce/development to afford the display. This is
  // the whole reason those two colours read as royal.
  const wealth = clamp01(0.45 + 0.4 * pos(pers.commerce) + 0.4 * sig.org);
  s.purpure *= 0.25 + 0.75 * wealth;
  s.or *= 0.4 + 0.6 * wealth;
  // Character bias — projecting the realm's real temperament onto its colours.
  s.gules *= 1 + pos(pers.aggression) * 0.9;
  s.sable *= 1 + pos(pers.aggression) * 0.5;
  s.or *= 1 + pos(pers.commerce) * 0.6;
  s.purpure *= 1 + pos(pers.commerce) * 0.5;
  s.vert *= 1 + pos(-pers.aggression) * 0.3;               // a peaceable people greens
  // Faith's liturgical colour — the shared channel that clusters co-religionists.
  // A TILT, not an override: it multiplies the realm toward the creed's colour,
  // so a devout realm with no loud material voice drifts to the faith default
  // (a whole communion trends one colour), while a realm whose GROUND speaks
  // plainly — a maritime azure, a gold-rich trading or, a warlike gules — still
  // overrides it. Faith colours the default; the land and character override it.
  if (emblem) {
    s[emblem.liturg] = (s[emblem.liturg] || 0) * (1.35 + 0.5 * emblem.zeal) + 0.06;
  }
  return s;
}

// Rank tinctures and choose a scheme that respects the rule of tincture: a FIELD,
// a COMPANION of the opposite class (for a divided field), and a CHARGE tincture
// that contrasts the field. A fine fimbriation (outline) is applied at render
// time so a charge stays legible even where it crosses a division.
function choosePalette(scores, rng) {
  const ranked = TINCTURE_IDS.slice().sort((a, b) => scores[b] - scores[a]);
  const field = ranked[0];
  const fieldMetal = TINCTURES[field].metal;
  const opposite = ranked.filter(t => TINCTURES[t].metal !== fieldMetal);
  const sameClass = ranked.filter(t => t !== field && TINCTURES[t].metal === fieldMetal);
  const companion = opposite[0] || sameClass[0] || field;
  // charge contrasts the field: opposite class, and not the same tincture as the
  // companion when we can avoid it (so a charged, divided shield reads in 3 tones)
  const charge = opposite.find(t => t !== companion) || opposite[0] || companion;
  const detail = sameClass[0] || (fieldMetal ? "sable" : "or");   // small accents (pips, outlines)
  return { field, companion, charge, detail };
}

// ── Charge: the primary emblem, weighted by the realm's life ────────────────
function chooseCharge(world, c, sig, pers, emblem, peoples, gov, rng) {
  const m = sig.mat;
  const water = sig.water;
  // arid signal — no biome array here, so read it off the ground: incense &
  // spice come from hot dry/exotic lands, timber & water from wet ones.
  const arid = clamp01((m.incense || 0) * 0.7 + (m.spices || 0) * 0.4 + (0.35 - water - (m.timber || 0)));
  const cold = clamp01((m.furs || 0) * 0.9);
  const ore = Math.max(m.iron || 0, m.copper || 0, m.tin || 0);

  const cand = [
    ["lion",     pos(pers.aggression) * 0.9 + sig.metallurgy * 0.3 + 0.10],   // beast of valour
    ["eagle",    pos(pers.expansionism) * 0.9 + sig.org * 0.35],              // imperial reach
    ["wolf",     pos(pers.aggression) * 0.5 + cold * 0.6],                    // the wild frontier
    ["ship",     sig.maritime * 1.2],                                         // a genuine sea power
    ["anchor",   sig.maritime * 0.7 + pos(pers.commerce) * 0.4],              // a trading port
    ["grain",    (m.timber || 0) * 0.2 + pos(-pers.aggression) * 0.3 + 0.25], // an agrarian heartland
    ["tree",     (m.timber || 0) * 0.9],                                      // a forest people
    ["sun",      arid * 1.0 + (m.incense || 0) * 0.4],                        // the burning south
    ["mountain", ore * 0.8 + 0.1],                                            // a mining / highland realm
    ["tower",    pos(pers.commerce) * 0.5 + sig.org * 0.6],                   // a civic, built-up state
    ["star",     0.18 + pos(pers.expansionism) * 0.2],                       // a modest celestial default
  ];
  // The faith's holy device LEADS the shield only where the priesthood itself
  // rules (a theocracy) or a fiercely militant/hierarchical creed dominates —
  // the crusading order, the temple-state. Elsewhere a realm's MAIN charge stays
  // secular/dynastic (the lion, the eagle, the ship) and the faith is carried by
  // the tincture instead; the device is still available, but rarely wins. This is
  // why one religion can blanket a map yet every realm's arms still differ.
  if (emblem) {
    const theo = gov === "theocracy";
    const zealous = emblem.militancy > 0.6 && emblem.zeal > 0.6;
    const w = theo ? 1.6 : zealous ? 0.9 : 0.22;
    cand.push([emblem.device, w]);
  }

  // Intrinsic aesthetic: a stock leans toward a motif family (seeded on the
  // culture FAMILY), so kin realms rhyme even when their circumstances differ.
  for (const e of cand) e[1] *= 0.75 + rng() * 0.5;

  cand.sort((a, b) => b[1] - a[1]);
  return cand[0][0];
}

// ── The genome ──────────────────────────────────────────────────────────────
/**
 * armsOf(world, country) → the realm's heraldic identity, projected from state.
 * Pure read. Deterministic: same world + same realm → same arms, every run.
 */
export function armsOf(world, c) {
  if (!c || !c.capital) return null;
  const polity = getPolity(world, c.id);
  const pers = personalityOf(world, c) || { aggression: 0, commerce: 0, expansionism: 0, _label: "Insular" };
  const sig = realmSignature(world, c);
  const peoples = peoplesOf(world, c);

  const faithId = polity && polity.faithId >= 0 ? polity.faithId : dominantFaith(c.capital);
  const emblem = faithId >= 0 ? faithEmblem(world, faithId) : null;

  // Two RNG streams, both reproducible from the world seed:
  //   • family stream — the stock's shared aesthetic (kin rhyme)
  //   • realm stream  — this realm's own differencing off that stock
  const cul = getCulture(world, polity ? polity.cultureId : dominantCulture(c.capital));
  const familyId = cul ? familyOf(world, cul.id) : c.id;
  const famRng = entityRng(world, "heraldry.family", familyId);
  const rng = entityRng(world, "heraldry.realm", c.id);

  const scores = pigmentScores(world, c, sig, pers, emblem);
  const palette = choosePalette(scores, rng);
  const charge = chooseCharge(world, c, sig, pers, emblem, peoples, polity ? polity.gov : null, famRng);

  // ── Form: dynastic ARMS vs national FLAG — emergent, never era-gated ──
  // A flag is the mass, national symbol of a developed state whose identity has
  // broadened from the ruling house to one people; below that, identity is vested
  // in the dynasty and reads as a coat of arms.
  const national = sig.org > 0.5 && peoples.domShare > 0.6;
  const style = national ? "flag" : "arms";

  // ── Division & ornateness ──
  // A realm marshalling several peoples quarters them; a developed single-people
  // realm takes a clean ordinary (pale/fess/bend/chief); the plainest is a lone
  // charge on a plain field. Flags simplify — at most a two-tincture party field.
  let division;
  if (!national && peoples.distinct >= 2) {
    division = peoples.distinct >= 3 ? "quarterly" : "perPale";       // marshalled
  } else {
    const ordinaries = style === "flag"
      ? ["plain", "perPale", "perFess"]
      : ["plain", "chief", "perFess", "perPale", "bend"];
    division = ordinaries[Math.floor(famRng() * ordinaries.length)];
  }
  // ornateness: development + how many houses have ruled (an old aristocratic line
  // accretes detail); flags stay spare regardless.
  const houses = polity && polity.houses ? polity.houses.length : 1;
  const complexity = style === "flag" ? 0
    : clamp01(sig.org * 0.6 + Math.min(1, houses / 6) * 0.4);

  return {
    style, division, charge, complexity,
    tinctures: palette,
    // provenance — the drivers, surfaced so a preview can be eyeballed / audited
    provenance: {
      realm: (polity && polity.name) || c.name || `#${c.id}`,
      people: cul ? cul.name : "?",
      familyId,
      personality: pers._label,
      faith: emblem ? (getFaith(world, faithId) || {}).name : null,
      gov: polity ? polity.gov : null,
      domShare: peoples.domShare, distinctPeoples: peoples.distinct,
      org: sig.org,
    },
  };
}

// A terse blazon-ish description for labels/tooltips.
export function blazon(arms) {
  if (!arms) return "";
  const t = arms.tinctures;
  const T = id => (TINCTURES[id] ? TINCTURES[id].label : id);
  const divWord = {
    plain: "", perPale: "party per pale", perFess: "party per fess",
    bend: "a bend", chief: "a chief", quarterly: "quarterly", saltire: "a saltire",
  }[arms.division] || "";
  const parts = [];
  parts.push(T(t.field).replace(/^\w/, ch => ch.toUpperCase()));
  if (divWord && arms.division !== "plain") parts.push(divWord + " " + T(t.companion));
  parts.push(`a ${arms.charge} ${T(t.charge)}`);
  return parts.join(", ");
}

export function tinctureRGB(id) {
  return (TINCTURES[id] || TINCTURES.sable).rgb;
}
