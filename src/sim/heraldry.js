// ── Heraldry: a generative armorial grammar, seeded by house and lineage ──
//
// Real arms are NOT a semantic readout of a realm's economy — England's lions
// are not "aggression", France's fleurs-de-lis are not agriculture. Heraldry is
// a mostly-ABSTRACT visual language whose meaning lives in three real places:
//
//   1. LINEAGE — a house's arms are inherited and DIFFERENCED down its branches,
//      and a stock shares an aesthetic TRADITION, so kin rhyme and strangers
//      diverge. (This is why heraldry clusters at all.)
//   2. MARSHALLING — union and conquest COMBINE arms (impaling, quartering), so a
//      shield becomes a compressed record of who joined or absorbed whom.
//   3. A few genuine ANCHORS — the state faith's holy device (real iconography),
//      and CANTING: a visual pun on the realm's own NAME (ties to the language
//      system, which is deep, rather than the thin temperament vector).
//
// Everything ELSE — the partition, the ordinary and its line, the charges, their
// attitudes and arrangement — is GENERATED from a large grammar, seeded per house
// so it is unique, plausible, and reproducible. The old "maritime → a ship" map
// is gone: that was painting a literal effect (the very thing the second cardinal
// rule forbids). We build the SYSTEM; a distinct coat falls out for every house,
// on any seed, and the connection to the world is genealogy + faith + name, used
// only where it actually carries meaning.
//
// PURE + DETERMINISTIC: reads the world, mutates nothing, draws all randomness
// from seeded entityRng streams (never Math.random), so a world replays identically.

import { personalityOf } from "./peopleSim/personality.js";
import { getFaith } from "./peopleSim/faiths.js";
import { getCulture, familyOf, dominantCulture } from "./peopleSim/cultures.js";
import { dominantFaith } from "./peopleSim/faiths.js";
import { getPolity } from "./peopleSim/entities.js";
import { getDynasty } from "./peopleSim/dynasties.js";
import { entityRng, hash32 } from "./peopleSim/rng.js";

// ── Tinctures ───────────────────────────────────────────────────────────────
export const TINCTURES = {
  or:      { rgb: [0xd7, 0xb0, 0x45], metal: true,  label: "or" },
  argent:  { rgb: [0xe9, 0xe7, 0xdd], metal: true,  label: "argent" },
  gules:   { rgb: [0xa6, 0x2b, 0x2f], metal: false, label: "gules" },
  azure:   { rgb: [0x28, 0x4b, 0x93], metal: false, label: "azure" },
  vert:    { rgb: [0x2f, 0x74, 0x42], metal: false, label: "vert" },
  purpure: { rgb: [0x6d, 0x2e, 0x7e], metal: false, label: "purpure" },
  sable:   { rgb: [0x31, 0x2e, 0x38], metal: false, label: "sable" },
  tenne:   { rgb: [0xb4, 0x5d, 0x2b], metal: false, label: "tenné" },
  murrey:  { rgb: [0x7a, 0x24, 0x3e], metal: false, label: "murrey" },
};
export function tinctureRGB(id) { return (TINCTURES[id] || TINCTURES.sable).rgb; }
const METALS = ["or", "argent"];
const COLOURS = ["gules", "azure", "vert", "purpure", "sable", "tenne", "murrey"];
const isMetal = t => !!(TINCTURES[t] && TINCTURES[t].metal);

// ── Vocabulary ──────────────────────────────────────────────────────────────
// Field partitions. `n` marks the striped/checky ones (barry, paly, …) whose
// count varies. The renderer knows how to draw each; an unknown one degrades to
// a plain field.
const PARTITIONS = [
  "plain", "plain", "perPale", "perFess", "perBend", "perBendSinister",
  "perChevron", "perSaltire", "quarterly", "gyronny", "barry", "paly",
  "bendy", "chevronny", "chequy", "lozengy", "perCross",
];
// Ordinaries — the broad geometric bands, each drawable with a fancy edge.
const ORDINARIES = ["chief", "fess", "pale", "bend", "bendSinister", "chevron", "cross", "saltire", "pile", "bordure", "canton"];
const LINES = ["straight", "straight", "straight", "wavy", "engrailed", "embattled", "indented", "dovetailed"];
const ATTITUDES = ["rampant", "passant", "statant", "salient"];
const ARRANGEMENTS = ["single", "single", "three", "inPale", "seme"];

// Charges, grouped so a stock can lean toward a CATEGORY (one people loves beasts,
// another geometry) — the kind of coherence real regional heraldry has.
const CHARGES = {
  // beasts (take an attitude)
  lion:{cat:"beast"}, boar:{cat:"beast"}, stag:{cat:"beast"}, wolf:{cat:"beast"},
  bull:{cat:"beast"}, horse:{cat:"beast"}, bear:{cat:"beast"},
  eagle:{cat:"beast",fixed:"displayed"}, martlet:{cat:"beast",fixed:"close"},
  dolphin:{cat:"beast",fixed:"naiant"}, serpent:{cat:"beast",fixed:"glissant"},
  // mythic
  dragon:{cat:"mythic"}, griffin:{cat:"mythic"}, wyvern:{cat:"mythic"},
  // plants
  fleur:{cat:"plant"}, rose:{cat:"plant"}, garb:{cat:"plant"}, tree:{cat:"plant"}, thistle:{cat:"plant"},
  // objects
  tower:{cat:"object"}, key:{cat:"object"}, sword:{cat:"object"}, crown:{cat:"object"},
  anchor:{cat:"object"}, horn:{cat:"object"}, hammer:{cat:"object"}, bell:{cat:"object"},
  // geometric / celestial
  mullet:{cat:"geom"}, estoile:{cat:"geom"}, crescent:{cat:"geom"}, sun:{cat:"geom"},
  roundel:{cat:"geom"}, annulet:{cat:"geom"}, lozenge:{cat:"geom"}, escallop:{cat:"geom"}, crosslet:{cat:"geom"},
};
const CHARGE_IDS = Object.keys(CHARGES);
const BY_CAT = {};
for (const id of CHARGE_IDS) (BY_CAT[CHARGES[id].cat] || (BY_CAT[CHARGES[id].cat] = [])).push(id);
const CATEGORIES = Object.keys(BY_CAT);
// Charges that make good NAME-puns (concrete, recognisable things).
const CANTABLE = ["tower", "lion", "rose", "tree", "key", "sword", "garb", "boar", "stag",
  "escallop", "crescent", "mullet", "bell", "horn", "anchor", "hammer", "fleur", "eagle", "crown"];
// Small charges that read well strewn (semé) or in threes.
const SMALL = new Set(["mullet", "estoile", "crescent", "roundel", "annulet", "lozenge", "escallop",
  "crosslet", "fleur", "martlet", "rose", "bell", "billet"]);

// ── seeded rng helpers ──
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const chance = (rng, p) => rng() < p;

// ── Stock aesthetic tradition ────────────────────────────────────────────────
// Seeded on the culture FAMILY: a coherent house-style shared by every people of
// the stock — its favoured colours, whether it leans to beasts or geometry, how
// busy its fields run. This is the channel that makes kin realms look related
// WITHOUT copying a display colour: they draw from one tradition, then each house
// varies within it.
function stockTradition(world, familyId) {
  const r = entityRng(world, "arms.stock", familyId >= 0 ? familyId : 0);
  const primary = pick(r, COLOURS);
  let accent = pick(r, METALS);
  const secondary = chance(r, 0.5) ? pick(r, COLOURS.filter(c => c !== primary)) : accent;
  const catLean = [pick(r, CATEGORIES), pick(r, CATEGORIES)];   // one or two favoured charge families
  const partLean = pick(r, PARTITIONS);
  const lineLean = pick(r, LINES);
  const busy = 0.25 + r() * 0.6;                                // how ornate the tradition runs
  return { primary, accent, secondary, catLean, partLean, lineLean, busy };
}

// ── Faith device: real religious iconography, shared by a communion ──────────
// Seeded on the faith FAMILY (rootFaithId) + shaped by doctrine, so every realm of
// a religion tends to the same holy sign — the cross/crescent/wheel channel — and
// a schism (its own root) reads as a related sign. Also yields the creed's
// liturgical tincture, offered to the palette.
function faithDevice(world, faithId) {
  const f = getFaith(world, faithId);
  if (!f || f.kind !== "organized") return null;
  const root = f.rootFaithId ?? f.id;
  const d = f.doctrine || {};
  const devices = (d.hierarchy || 0) > 0.55 ? ["cross", "crosslet", "key"]
                : (d.militancy || 0) > 0.55 ? ["sword", "mullet", "sun"]
                : (d.asceticism || 0) > 0.55 ? ["roundel", "crescent", "annulet"]
                : ["estoile", "crescent", "rose", "sun"];
  const device = devices[hash32(root, "hdev") % devices.length];
  let liturg;
  if ((d.asceticism || 0) > 0.6) liturg = "argent";
  else if ((d.militancy || 0) > 0.55) liturg = "gules";
  else if ((d.worldliness || 0) > 0.6) liturg = "or";
  else if ((d.hierarchy || 0) > 0.6) liturg = "azure";
  else liturg = COLOURS[hash32(root, "hlit") % COLOURS.length];
  return { device, liturg, zeal: d.zeal || 0.4 };
}

// A loose visual pun on a name — canting arms, extremely common historically
// (Castile→castle, Barcelona's…). Deterministic from the name string.
function cantingCharge(name) {
  if (!name) return null;
  return CANTABLE[hash32(name, "cant") % CANTABLE.length];
}

// ── Palette: choose tinctures within the stock tradition, rule of tincture ──
function buildPalette(trad, faith, rng) {
  // field: a colour + a metal (rule of tincture); occasionally metal-primary.
  let a = trad.primary, b = trad.accent;
  if (chance(rng, 0.28)) { a = trad.accent; b = chance(rng, 0.5) ? trad.secondary : trad.primary; }   // metal field, colour companion
  if (a === b) b = isMetal(a) ? pick(rng, COLOURS) : pick(rng, METALS);
  // faith tilts ONE slot toward its liturgical colour sometimes (a devout house
  // wears its creed's colour) — a tilt, never a takeover.
  if (faith && chance(rng, 0.5)) { if (isMetal(a) === isMetal(faith.liturg)) b = faith.liturg; else a = faith.liturg; }
  const field = [a, b];
  const contrast = base => {
    const wantMetal = !isMetal(base);
    const poolHouse = [trad.primary, trad.accent, trad.secondary].filter(t => isMetal(t) === wantMetal);
    if (poolHouse.length && chance(rng, 0.7)) return pick(rng, poolHouse);
    return pick(rng, wantMetal ? METALS : COLOURS);
  };
  return { field, contrast };
}

// ── Generate one house's arms ────────────────────────────────────────────────
function generateArms(world, seedId, meta, trad) {
  const rng = entityRng(world, "arms.house", seedId);
  const faith = meta.faith;
  const pal = buildPalette(trad, faith, rng);
  const [f0, f1] = pal.field;

  // Field partition — the tradition leans, the house decides. `n` stripes vary.
  let partition = chance(rng, 0.34) ? trad.partLean : pick(rng, PARTITIONS);
  const striped = { barry: 1, paly: 1, bendy: 1, chevronny: 1, chequy: 1, lozengy: 1 }[partition];
  const count = striped ? (partition === "chequy" || partition === "lozengy" ? 5 : (chance(rng, 0.5) ? 6 : 8)) : 2;
  const line = chance(rng, 0.35) ? (chance(rng, 0.5) ? trad.lineLean : pick(rng, LINES)) : "straight";
  const field = { partition, tinctures: [f0, f1], count, line };

  // An ordinary, often — the single strongest driver of a heraldic silhouette.
  let ordinary = null, onOrdinary = null;
  if (chance(rng, 0.55)) {
    const kind = pick(rng, ORDINARIES);
    const otinc = pal.contrast(f0);
    ordinary = { kind, tincture: otinc, line: chance(rng, 0.4) ? pick(rng, LINES) : "straight" };
    // sometimes charge the ordinary (three mullets on a chief, etc.) — only the
    // clean BAND ordinaries carry charges legibly; a pile/chevron/saltire doesn't.
    if (["chief", "fess", "base", "pale"].includes(kind) && chance(rng, 0.42)) {
      const smalls = CHARGE_IDS.filter(c => SMALL.has(c));
      onOrdinary = { charge: pick(rng, smalls), tincture: pal.contrast(otinc), count: pick(rng, [3, 3, 5]) };
    }
  }

  // The primary charge — the heart of the shield. Source, in order:
  //   faith device (devout) → canting on the name → a tradition-led generative pick.
  let charge = null, fromFaith = false, canting = false;
  // The faith's device LEADS the shield only for a genuinely devout realm; for
  // everyone else the creed shows in the TINCTURE (buildPalette), not as the main
  // charge — otherwise one world-religion stamps its symbol on half the map. Most
  // houses cant on their name or take a tradition-led generative charge.
  if (faith && meta.devout) { charge = faith.device; fromFaith = true; }
  else if (meta.name && chance(rng, 0.32)) { charge = cantingCharge(meta.name); canting = true; }
  if (!charge) {
    const cat = pick(rng, chance(rng, 0.7) ? trad.catLean : CATEGORIES);
    const poolC = BY_CAT[cat] || CHARGE_IDS;
    charge = pick(rng, poolC);
  }
  // A faint temperament whisper (NOT a hard map): a martial house leans to beasts
  // and blades, a mercantile one to order and geometry — only nudges an otherwise
  // free pick, and only sometimes.
  if (!fromFaith && !canting && meta.pers) {
    if (meta.pers.aggression > 0.45 && chance(rng, 0.4)) charge = pick(rng, [...(BY_CAT.beast || []), "sword", "hammer", ...(BY_CAT.mythic || [])]);
    else if (meta.pers.commerce > 0.45 && chance(rng, 0.35)) charge = pick(rng, [...(BY_CAT.geom || []), "key", "crown", "tower"]);
  }

  const spec = CHARGES[charge] || { cat: "geom" };
  const beast = spec.cat === "beast" || spec.cat === "mythic";
  let arrangement = spec.fixed === "displayed" ? "single"
    : (SMALL.has(charge) ? pick(rng, ARRANGEMENTS) : (chance(rng, 0.22) ? "three" : "single"));
  if (arrangement === "seme" && !SMALL.has(charge)) arrangement = "single";
  const attitude = beast ? (spec.fixed || pick(rng, ATTITUDES)) : null;
  const chargeTinc = pal.contrast(ordinary && arrangement !== "seme" ? f0 : f0);
  const primary = { charge, tincture: chargeTinc, arrangement, attitude,
    count: arrangement === "three" ? 3 : arrangement === "inPale" ? pick(rng, [2, 3]) : 1 };

  // Semé (a strewn powdering) instead of a single charge — a distinctive, busy look.
  let seme = null;
  if (primary.arrangement === "seme") { seme = { charge, tincture: pal.contrast(f0) }; }

  // Cadency: a difference mark for this house's rank within its stock — the real
  // mechanism that distinguishes branches. Cheap proxy: the house's index in the
  // family, so siblings of a tradition carry different brisures.
  let cadency = null;
  if (meta.cadetIndex > 0 && chance(rng, 0.8)) {
    const marks = ["label", "crescent", "mullet", "annulet", "martlet", "bordure"];
    cadency = { mark: marks[meta.cadetIndex % marks.length], tincture: pal.contrast(f0) };
  }

  return {
    field, ordinary, onOrdinary,
    primary: seme ? null : primary,
    seme,
    cadency,
    marshalling: null,      // structure is ready; union/conquest marshalling is the next layer
    _pal: pal,
  };
}

// ── Public: the arms a realm bears (its ruling house's) ─────────────────────
export function armsForCountry(world, c) {
  if (!c || !c.capital) return null;
  const polity = getPolity(world, c.id);
  const cultureId = polity && polity.cultureId >= 0 ? polity.cultureId : dominantCulture(c.capital);
  const cul = getCulture(world, cultureId);
  const familyId = cul ? familyOf(world, cul.id) : c.id;
  const trad = stockTradition(world, familyId);

  const faithId = polity && polity.faithId >= 0 ? polity.faithId : dominantFaith(c.capital);
  const faith = faithId >= 0 ? faithDevice(world, faithId) : null;
  const pers = personalityOf(world, c) || null;

  // Arms belong to the ruling HOUSE; a realm with no recorded dynasty (folk /
  // pre-literate) bears a people's device seeded on its culture instead.
  const dyn = polity && polity.dynastyId >= 0 ? getDynasty(world, polity.dynastyId) : null;
  const houseName = dyn ? dyn.name : (cul ? cul.name : null);
  const seedId = dyn ? (1e6 + dyn.id) : (cultureId >= 0 ? (2e6 + cultureId) : c.id);
  const cadetIndex = polity && polity.houses ? Math.max(0, polity.houses.length - 1) : 0;

  const gov = polity ? polity.gov : null;
  // Only a THEOCRACY — where the priesthood itself rules — leads its shield with
  // the holy device. For every other realm the faith is worn in the TINCTURE, not
  // stamped as the charge, so one zealous world-religion can't key-stamp the map.
  const devout = gov === "theocracy";

  const meta = { name: houseName, realmName: (polity && polity.name) || c.name || `#${c.id}`,
    faith, pers, devout, cadetIndex, house: dyn ? dyn.name : null,
    people: cul ? cul.name : "?", gov };

  const arms = generateArms(world, seedId, meta, trad);

  // Emergent FORM: dynastic arms vs national flag — vested in the house until the
  // realm is developed AND its identity has broadened to one nation. State-driven,
  // never the calendar.
  let pop = new Map(), total = 0;
  for (const s of (c.members || [])) {
    if (s.mode !== "settled") continue;
    const cid = dominantCulture(s); if (cid < 0) continue;
    const p = Math.max(1, s.people || 0); pop.set(cid, (pop.get(cid) || 0) + p); total += p;
  }
  let dom = 0; for (const [, p] of pop) if (p > dom) dom = p;
  const org = (c.capital.knowledge && c.capital.knowledge.organization) || 0;
  const domShare = total > 0 ? dom / total : 1;
  arms.style = (org > 0.5 && domShare > 0.6) ? "flag" : "arms";

  arms.meta = {
    realm: meta.realmName, house: meta.house, people: meta.people,
    faith: faith ? (getFaith(world, faithId) || {}).name : null,
    gov, canting: null, tradition: `${trad.primary}/${trad.accent}`,
    domShare, org,
  };
  return arms;
}

// ── Blazon (terse, for labels) ──────────────────────────────────────────────
export function blazon(arms) {
  if (!arms) return "";
  const T = id => (TINCTURES[id] ? TINCTURES[id].label : id);
  const up = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  const f = arms.field;
  const partWord = {
    plain: "", perPale: "per pale", perFess: "per fess", perBend: "per bend",
    perBendSinister: "per bend sinister", perChevron: "per chevron", perSaltire: "per saltire",
    quarterly: "quarterly", perCross: "quarterly", gyronny: "gyronny", barry: "barry",
    paly: "paly", bendy: "bendy", chevronny: "chevronny", chequy: "chequy", lozengy: "lozengy",
  }[f.partition] || "";
  let s;
  if (!partWord) s = up(T(f.tinctures[0]));
  else s = `${up(partWord)} ${T(f.tinctures[0])} and ${T(f.tinctures[1])}`;
  const lw = arms.ordinary && arms.ordinary.line !== "straight" ? ` ${arms.ordinary.line}` : "";
  if (arms.ordinary) s += `, a ${arms.ordinary.kind}${lw} ${T(arms.ordinary.tincture)}`;
  if (arms.seme) s += `, semé of ${arms.seme.charge}s ${T(arms.seme.tincture)}`;
  else if (arms.primary) {
    const p = arms.primary;
    const n = p.count > 1 ? `${p.count} ${p.charge}s` : `a ${p.charge}`;
    const att = p.attitude && p.attitude !== "close" ? ` ${p.attitude}` : "";
    s += `, ${n}${att} ${T(p.tincture)}`;
  }
  if (arms.cadency) s += ` (${arms.cadency.mark})`;
  return s;
}

// exported for the renderer
export { CHARGES, LINES, PARTITIONS };
