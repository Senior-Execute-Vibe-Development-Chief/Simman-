// ── The lexicon: one shared concept graph, per-language lexicalization ───
//
// Spec phase L3 / D2. Meanings are SHARED across all languages (a curated
// concept inventory with relations); each language differs in the
// FORM→MEANING MAP: which concepts get atomic roots, which colexify (share
// one word — tree/wood, hand/arm, the CLICS patterns), and how the rest are
// DERIVED (compounds/affixes per the language's morphotype). The dictionary
// itself is VIRTUAL: wordOf(lang, concept) is a pure function of the record,
// computed on demand — a language stores only its seed, rule log and loans,
// and its full vocabulary exists the way terrain exists before you look.
//
// Concept ids are ARRAY INDICES and are persisted inside loan records —
// append new concepts at the END, never reorder.

// domain keys: wat water · lnd land · sky sky · plt plant · anm animal ·
// hab built/habitation · kin kinship · bod body · war war · fth faith ·
// crf craft · gov governance · qua quality · col color · vrt virtue/name
const D = [];
const c = (g, d, b, dv) => (D.push({ g, d, b, dv }), D.length - 1);

// ── nature: water/land/sky ──────────────────────────────────────────────
export const WATER = c("water", "wat", 1.0);
export const RIVER = c("river", "wat", 0.9);
export const LAKE = c("lake", "wat", 0.7);
export const SEA = c("sea", "wat", 0.8);
export const FORD = c("ford", "wat", 0.5, [RIVER, WATER]);
export const SPRING = c("spring", "wat", 0.5);
export const MARSH = c("marsh", "wat", 0.4);
export const ISLAND = c("island", "wat", 0.6);
export const BAY = c("bay", "wat", 0.5);
export const EARTH = c("earth", "lnd", 1.0);
export const LAND = c("land", "lnd", 0.95);
export const MOUNTAIN = c("mountain", "lnd", 0.9);
export const HILL = c("hill", "lnd", 0.8);
export const VALLEY = c("valley", "lnd", 0.7);
export const PLAIN = c("plain", "lnd", 0.6);
export const STONE = c("stone", "lnd", 1.0);
export const SAND = c("sand", "lnd", 0.6);
export const CLIFF = c("cliff", "lnd", 0.4);
export const CAVE = c("cave", "lnd", 0.5);
export const PASS = c("pass", "lnd", 0.4, [MOUNTAIN, LAND]);
export const SUN = c("sun", "sky", 1.0);
export const MOON = c("moon", "sky", 1.0);
export const STAR = c("star", "sky", 0.9);
export const SKYC = c("sky", "sky", 0.95);
export const DAY = c("day", "sky", 0.9);
export const NIGHT = c("night", "sky", 0.9);
export const MONTH = c("month", "sky", 0.5);
export const WIND = c("wind", "sky", 0.8);
export const RAIN = c("rain", "sky", 0.8);
export const SNOW = c("snow", "sky", 0.6);
export const STORM = c("storm", "sky", 0.5);
export const FIRE = c("fire", "sky", 1.0);
export const DAWN = c("dawn", "sky", 0.5, [SUN, DAY]);

// ── plants / animals ────────────────────────────────────────────────────
export const TREE = c("tree", "plt", 1.0);
export const WOOD = c("wood", "plt", 0.9);
export const FOREST = c("forest", "plt", 0.8);
export const GRASS = c("grass", "plt", 0.7);
export const GRAIN = c("grain", "plt", 0.8);
export const ROOTC = c("root", "plt", 0.7);
export const FLOWER = c("flower", "plt", 0.6);
export const OAK = c("oak", "plt", 0.4);
export const REED = c("reed", "plt", 0.4);
export const WOLF = c("wolf", "anm", 0.7);
export const BEAR = c("bear", "anm", 0.7);
export const EAGLE = c("eagle", "anm", 0.6);
export const RAVEN = c("raven", "anm", 0.5);
export const HORSE = c("horse", "anm", 0.8);
export const OX = c("ox", "anm", 0.7);
export const SHEEP = c("sheep", "anm", 0.7);
export const FISH = c("fish", "anm", 0.9);
export const SERPENT = c("serpent", "anm", 0.6);
export const LION = c("lion", "anm", 0.5);
export const DEER = c("deer", "anm", 0.6);
export const BOAR = c("boar", "anm", 0.5);
export const FALCON = c("falcon", "anm", 0.4);

// ── built / habitation ──────────────────────────────────────────────────
export const HOUSE = c("house", "hab", 1.0);
export const TOWN = c("town", "hab", 0.8);
export const FORT = c("fort", "hab", 0.7);
export const WALL = c("wall", "hab", 0.7);
export const BRIDGE = c("bridge", "hab", 0.6);
export const ROAD = c("road", "hab", 0.7);
export const MARKET = c("market", "hab", 0.6);
export const HARBOR = c("harbor", "hab", 0.5, [SEA, TOWN]);
export const MILL = c("mill", "hab", 0.4);
export const WELL = c("well", "hab", 0.6);
export const TOWER = c("tower", "hab", 0.5);
export const GATE = c("gate", "hab", 0.6);
export const FIELD = c("field", "hab", 0.8);
export const TEMPLE = c("temple", "fth", 0.6);
export const TOMB = c("tomb", "fth", 0.5);
export const HEARTH = c("hearth", "hab", 0.7);
export const SHIP = c("ship", "crf", 0.7);
export const CROSSING = c("crossing", "hab", 0.4, [ROAD, RIVER]);

// ── kinship / body / person ─────────────────────────────────────────────
export const MOTHER = c("mother", "kin", 1.0);
export const FATHER = c("father", "kin", 1.0);
export const SON = c("son", "kin", 1.0);
export const DAUGHTER = c("daughter", "kin", 0.9);
export const CHILD = c("child", "kin", 0.95);
export const BROTHER = c("brother", "kin", 0.9);
export const KINC = c("kin", "kin", 0.8);
export const HAND = c("hand", "bod", 1.0);
export const ARM = c("arm", "bod", 0.9);
export const EYE = c("eye", "bod", 1.0);
export const HEART = c("heart", "bod", 1.0);
export const BLOOD = c("blood", "bod", 0.95);
export const HEAD = c("head", "bod", 1.0);
export const BONE = c("bone", "bod", 0.9);
export const PEOPLE = c("people", "gov", 0.9);
export const MAN = c("man", "kin", 0.95);
export const WOMAN = c("woman", "kin", 0.95);

// ── war / governance / faith / craft ────────────────────────────────────
export const WAR = c("war", "war", 0.8);
export const SWORD = c("sword", "war", 0.6);
export const SPEAR = c("spear", "war", 0.7);
export const SHIELD = c("shield", "war", 0.6);
export const VICTORY = c("victory", "war", 0.5);
export const ARMY = c("army", "war", 0.6);
export const BATTLE = c("battle", "war", 0.6);
export const GUARD = c("guard", "war", 0.5);
export const KING = c("king", "gov", 0.8);
export const CHIEF = c("chief", "gov", 0.8);
export const QUEEN = c("queen", "gov", 0.6);
export const LAW = c("law", "gov", 0.6);
export const THRONE = c("throne", "gov", 0.4);
export const CROWN = c("crown", "gov", 0.5);
export const TAX = c("tax", "gov", 0.4);
export const COUNCIL = c("council", "gov", 0.4);
export const REALM = c("realm", "gov", 0.5, [KING, LAND]);
export const GOD = c("god", "fth", 0.9);
export const SPIRIT = c("spirit", "fth", 0.8);
export const HOLY = c("holy", "fth", 0.7);
export const PRIEST = c("priest", "fth", 0.6);
export const OATH = c("oath", "fth", 0.6);
export const GIFT = c("gift", "vrt", 0.7);
export const GOLD = c("gold", "crf", 0.8);
export const IRON = c("iron", "crf", 0.7);
export const SILVER = c("silver", "crf", 0.6);
export const SALT = c("salt", "crf", 0.7);
export const WINE = c("wine", "crf", 0.5);
export const SILK = c("silk", "crf", 0.4);
export const COIN = c("coin", "crf", 0.5);
export const BREAD = c("bread", "crf", 0.7);

// ── qualities / colors / virtues ────────────────────────────────────────
export const NEW = c("new", "qua", 1.0);
export const OLD = c("old", "qua", 1.0);
export const GREAT = c("great", "qua", 1.0);
export const LITTLE = c("little", "qua", 1.0);
export const HIGH = c("high", "qua", 0.9);
export const LOW = c("low", "qua", 0.8);
export const LONG = c("long", "qua", 0.9);
export const DEEP = c("deep", "qua", 0.7);
export const COLD = c("cold", "qua", 0.9);
export const WARM = c("warm", "qua", 0.8);
export const DRY = c("dry", "qua", 0.7);
export const RICH = c("rich", "qua", 0.6);
export const FAR = c("far", "qua", 0.7);
export const FAIR = c("fair", "qua", 0.6);
export const DARK = c("dark", "qua", 0.8);
export const BRIGHT = c("bright", "qua", 0.8);
export const BLACK = c("black", "col", 1.0);
export const WHITE = c("white", "col", 1.0);
export const RED = c("red", "col", 1.0);
export const GREEN = c("green", "col", 0.8);
export const BLUE = c("blue", "col", 0.7);
export const GOLDEN = c("golden", "col", 0.6, [GOLD, BRIGHT]);
export const GREY = c("grey", "col", 0.6);
export const BRAVE = c("brave", "vrt", 0.7);
export const STRONG = c("strong", "vrt", 0.9);
export const WISE = c("wise", "vrt", 0.7);
export const TRUE = c("true", "vrt", 0.7);
export const FREE = c("free", "vrt", 0.6);
export const PEACE = c("peace", "vrt", 0.7);
export const GLORY = c("glory", "vrt", 0.5);
export const HOPE = c("hope", "vrt", 0.6);
export const NOBLE = c("noble", "vrt", 0.5);
export const SWIFT = c("swift", "vrt", 0.6);
export const BELOVED = c("beloved", "vrt", 0.5);
export const GUARDIAN = c("guardian", "vrt", 0.4, [GUARD, MAN]);

// ── M1/M2 appends: verbs, grammatical-source nouns, quantifiers, numerals ──
// (append-only, as ever: ids are persisted in loan records and rule streams)
// Verbs carry basicness like everything else — b ≥ 0.9 is the irregularity
// belt: the verbs a speech community uses so often their paradigms fossilize.
export const BE = c("be", "act", 1.0);
export const HAVE = c("have", "act", 0.9);
export const GO = c("go", "act", 1.0);
export const COME = c("come", "act", 0.95);
export const DO = c("do", "act", 0.95);
export const SAY = c("say", "act", 0.95);
export const SEE = c("see", "act", 0.95);
export const HEAR = c("hear", "act", 0.85);
export const KNOW = c("know", "act", 0.9);
export const WANT = c("want", "act", 0.85);
export const GIVE = c("give", "act", 0.9);
export const TAKE = c("take", "act", 0.85);
export const MAKE = c("make", "act", 0.8);
export const EAT = c("eat", "act", 0.95);
export const DRINK = c("drink", "act", 0.85);
export const SLEEP = c("sleep", "act", 0.8);
export const SIT = c("sit", "act", 0.8);
export const STAND = c("stand", "act", 0.8);
export const WALKV = c("walk", "act", 0.75);
export const RUN = c("run", "act", 0.7);
export const FALL = c("fall", "act", 0.7);
export const DIE = c("die", "act", 0.9);
export const KILL = c("kill", "act", 0.7);
export const FIGHTV = c("fight", "act", 0.7);
export const BURNV = c("burn", "act", 0.65);
export const BUILDV = c("build", "act", 0.6);
export const RULEV = c("rule", "act", 0.55);
export const LOVEV = c("love", "act", 0.7);
export const FEARV = c("fear", "act", 0.6);
export const FINISH = c("finish", "act", 0.7);
// body/space nouns — the classic grammaticalization quarry (belly→in,
// head/back→on, foot→under, face→to, mouth→edge/from)
export const BELLY = c("belly", "bod", 0.75);
export const BACK = c("back", "bod", 0.75);
export const FACE = c("face", "bod", 0.85);
export const MOUTH = c("mouth", "bod", 0.85);
export const FOOT = c("foot", "bod", 0.9);
export const SIDE = c("side", "bod", 0.6);
export const MIDDLE = c("middle", "bod", 0.6);
// quantifiers (plural markers wear down from these)
export const MANY = c("many", "qua", 0.95);
export const ALL = c("all", "qua", 0.95);
// numerals — atoms; composition is grammar (languageGrammar.js numeral())
export const ONE = c("one", "num", 1.0);
export const TWO = c("two", "num", 1.0);
export const THREE = c("three", "num", 1.0);
export const FOUR = c("four", "num", 0.95);
export const FIVE = c("five", "num", 0.95);
export const SIX = c("six", "num", 0.85);
export const SEVEN = c("seven", "num", 0.85);
export const EIGHT = c("eight", "num", 0.85);
export const NINE = c("nine", "num", 0.85);
export const TEN = c("ten", "num", 0.95);
export const HUNDRED = c("hundred", "num", 0.65);

// ── typology-completion appends (spec: language-typology-completion-spec.md) ──
// APPEND-ONLY: new ids seed the dictionary LAST and only ever bump themselves.
// SEEM — perception/appearance verb; the inferential-evidential quarry ("it
//   seems/appears"). BODY — classifier source (human/animate/general) + the
//   inalienable-possession anchor. LEAF — the flat-thing classifier source.
//   EXCEED — the comparative verb ("A exceeds B in tallness" → the 'than' mark).
//   SAME — the equative standard ("tall AS"). LORD — the honorific/T-V source
//   (respect from a noble address term).
export const SEEM = c("seem", "act", 0.7);
export const BODY = c("body", "bod", 0.9);
export const LEAF = c("leaf", "plt", 0.7);
export const EXCEED = c("exceed", "act", 0.5);
export const SAME = c("same", "qua", 0.6);
export const LORD = c("lord", "gov", 0.55);

// ── lexical-typology appends (typology completion, phase 2) ──────────────
// APPEND-ONLY as ever, and none of these enter a name pool (appending to a
// pool would re-roll every name). Three families of concept:
//
// COLORS — the five Berlin–Kay terms above the pre-existing core (black/
// white/red/green/blue/grey are already universal here; the hierarchy
// governs everything above that floor). A term a family hasn't SPLIT yet
// colexifies onto its hierarchy parent (yellow→red, orange→yellow→…), so
// "how many basic color terms" is a per-family fact with the implicational
// order built in (language.js compile()).
export const YELLOW = c("yellow", "col", 0.75);
export const BROWN = c("brown", "col", 0.55);
export const PURPLE = c("purple", "col", 0.4);
export const PINK = c("pink", "col", 0.35);
export const ORANGE = c("orange", "col", 0.35);
// KIN TYPES — the distinct genealogical positions (world knowledge, not any
// language's answer): whether mother's-brother shares father's-brother's
// word — or father's — is the family's KINSHIP SYSTEM (Morgan's classic
// types, rolled per family in compile()). Grandparents usually derive
// ('great father' — the grand-père machine, via the ordinary dv pathway).
export const SISTER = c("sister", "kin", 0.9);
export const UNCLE_F = c("father's brother", "kin", 0.5);
export const UNCLE_M = c("mother's brother", "kin", 0.5);
export const AUNT_F = c("father's sister", "kin", 0.45);
export const AUNT_M = c("mother's sister", "kin", 0.45);
export const COUSIN = c("cousin", "kin", 0.45);
export const GRANDFATHER = c("grandfather", "kin", 0.55, [FATHER, GREAT]);
export const GRANDMOTHER = c("grandmother", "kin", 0.55, [MOTHER, GREAT]);
// PATH VERBS (Talmy) — a verb-framed family lexicalizes these as opaque
// roots (entrar); a satellite-framed one DERIVES them from GO + the same
// body-part sources its adpositions wear ('belly-go' = in-go, eingehen) —
// the derivation is conditioned on the family's motion type (language.js).
export const ENTER = c("enter", "act", 0.7);
export const EXIT = c("exit", "act", 0.65);
export const ASCEND = c("ascend", "act", 0.5);
export const DESCEND = c("descend", "act", 0.5);
// new colexification domains: heart/mind, tongue/language, skin/bark
export const MIND = c("mind", "bod", 0.7);
export const TONGUE = c("tongue", "bod", 0.9);
export const LANGUAGE_C = c("language", "gov", 0.6);
export const SKIN = c("skin", "bod", 0.85);
export const BARK = c("bark", "plt", 0.5, [SKIN, TREE]);

// ── affixal derivation: agent nouns (typology completion, item 1.5) ───────
// AGENT nouns — 'one who VERBs' — coined by a grammaticalized AGENTIVE affix,
// worn down from a 'person' word (man/people/body: the Heine–Kuteva agent-
// nominalizer quarry — Turkish -ci, Japanese -sha 者, Swahili m-, Persian -gar,
// English -er) and attached to a base verb. The build lives in language.js:
// the affix is a light reflex of the family's OWN 'person' word, shared across
// every agent → the "-er" regularity; the stem is the base verb's own reflex →
// transparent ('rule'→'ruler') and regularly-corresponding across the family
// (both morphemes ride the sound-change log). APPEND-ONLY, as ever; these seed
// the dictionary last and enter no name pool.
export const RULER = c("ruler", "gov", 0.5);
export const BUILDER = c("builder", "crf", 0.4);
export const WARRIOR = c("warrior", "war", 0.5);
export const SEER = c("seer", "fth", 0.4);
export const SPEAKER = c("speaker", "gov", 0.4);
// each agent's base verb (the stem the agentive affix attaches to). The affix
// SOURCE (the 'person' word) is a per-family choice made in language.js, not
// fixed here — the mechanism, not the outcome.
export const AGENT_BASE = new Map([
  [RULER, RULEV], [BUILDER, BUILDV], [WARRIOR, FIGHTV], [SEER, SEE], [SPEAKER, SAY],
]);

export const CONCEPTS = D;

// ── Berlin–Kay hierarchy data (shared world-structure, cardinal rule 2) ──
// The colexification PARENT of each unsplit term — yellow reads as (macro-)
// red, orange as yellow (resolving through the chain when yellow is unsplit
// too), purple as blue-or-black, pink as red, brown as black-or-red. The
// per-family split rolls live in language.js compile(); the eleven BASIC
// terms counted are exactly Berlin & Kay's: white black red green yellow
// blue brown purple pink orange grey.
export const BK_TERMS = [WHITE, BLACK, RED, GREEN, YELLOW, BLUE, BROWN, PURPLE, PINK, ORANGE, GREY];
export const BK_PARENT = new Map([
  [YELLOW, [[RED, 0.75], [GREEN, 0.25]]],
  [BROWN, [[BLACK, 0.5], [RED, 0.5]]],
  [PURPLE, [[BLUE, 0.55], [BLACK, 0.45]]],
  [PINK, [[RED, 1]]],
  [ORANGE, [[YELLOW, 1]]],
  // grey is a late/wildcard term (B&K stage VII-ish): a language below the
  // late stage has no basic grey — it reads as an achromatic (black/white).
  // It was previously always basic (missing here), so every small system
  // spuriously carried an independent grey (a reviewer caught 6/6).
  [GREY, [[BLACK, 0.55], [WHITE, 0.45]]],
]);

// ── kinship systems (Morgan's classic types) — merge lists per type ──────
// Each entry [newKin, target]: the family's word for newKin IS its word for
// target (colex, new→old only, so no pre-existing surface ever moves).
//   hawaiian — generational: all same-generation kin merge (uncle=father)
//   iroquois — bifurcate merging: parallel kin merge (FB=F, MZ=M), CROSS
//              kin (MB, FZ) keep their own words; cousin reads cross-cousin
//   eskimo   — lineal: one 'uncle', one 'aunt', distinct from the parents
//   sudanese — bifurcate collateral: every position its own word
export const KIN_TYPES = ["hawaiian", "iroquois", "eskimo", "sudanese"];
export const KIN_MERGES = {
  hawaiian: [[UNCLE_F, FATHER], [UNCLE_M, FATHER], [AUNT_F, MOTHER], [AUNT_M, MOTHER], [COUSIN, BROTHER]],
  iroquois: [[UNCLE_F, FATHER], [AUNT_M, MOTHER]],
  eskimo: [[UNCLE_M, UNCLE_F], [AUNT_M, AUNT_F]],
  sudanese: [],
};
export const KIN_SLOTS = [FATHER, MOTHER, BROTHER, SISTER, UNCLE_F, UNCLE_M, AUNT_F, AUNT_M, COUSIN, GRANDFATHER, GRANDMOTHER];

// ── motion typology (Talmy) — the satellite-framed derivation pathways ──
// [head, fallbackMod]: 'belly-go' = in-go, read by derivParts when the
// family is satellite-framed — and the modifier is the family's OWN
// adposition source (adpSourceOf, so the path verb is COGNATE with the
// satellite it echoes: a tongue whose 'in' wore down from 'house' says
// house-go), falling back to the canonical body source when the adposition
// is opaque. MOTION_PATH_ADP maps each path concept to the adposition
// meaning it rides — one table shared by the lexical layer, the clause
// renderer, and the satellite compound. The satellite share of the roll is
// here so both layers read ONE number.
export const MOTION_DV = new Map([
  [ENTER, [GO, BELLY]], [EXIT, [GO, MOUTH]], [ASCEND, [GO, HIGH]], [DESCEND, [GO, LOW]],
]);
export const MOTION_PATH_ADP = new Map([
  [ENTER, "in"], [EXIT, "from"], [ASCEND, "on"], [DESCEND, "under"],
]);
export const MOTION_SAT_RATE = 0.45;   // satellite-framed share (Talmy: roughly half the world packages path outside the verb)

// frame-able verbs for the sentence layer + Lab dropdowns (append-only: existing
// indices are referenced by position in the probe, so new verbs go at the END)
export const VERBS = [BE, HAVE, GO, COME, DO, SAY, SEE, HEAR, KNOW, WANT, GIVE,
  TAKE, MAKE, EAT, DRINK, SLEEP, SIT, STAND, WALKV, RUN, FALL, DIE, KILL,
  FIGHTV, BURNV, BUILDV, RULEV, LOVEV, FEARV, FINISH, SEEM, EXCEED,
  ENTER, EXIT, ASCEND, DESCEND];

// ── AGENTIVITY: proto-agent score over verb ids (Dowty) — the analogue of
// basicness `b`, for alignment (Group F). A verb's lone argument (intransitive
// S) patterns with the transitive AGENT when it scores high (control/volition:
// run, go), with the PATIENT when low (fall, die) — the split-S / active
// alignment. A world-knowledge dimension, not a language's answer (cardinal
// rule 2). Absent verb → patientive default (documented). Append-only, keys on
// existing verb ids.
export const AGENTIVITY = new Map([
  [GO, 0.9], [RUN, 0.9], [WALKV, 0.85], [COME, 0.85], [DO, 0.85],
  [SAY, 0.8], [EAT, 0.8], [DRINK, 0.8], [MAKE, 0.8], [RULEV, 0.8], [BUILDV, 0.8], [FIGHTV, 0.8], [KILL, 0.8],
  [STAND, 0.6], [SEE, 0.6], [WANT, 0.6], [TAKE, 0.7], [GIVE, 0.7], [SIT, 0.55], [FINISH, 0.52],
  [HAVE, 0.4], [KNOW, 0.4], [HEAR, 0.4], [LOVEV, 0.4], [FEARV, 0.4], [SEEM, 0.2],
  [SLEEP, 0.3], [BE, 0.3], [BURNV, 0.25], [FALL, 0.1], [DIE, 0.05],
  [ENTER, 0.85], [EXIT, 0.85], [ASCEND, 0.85], [DESCEND, 0.8],   // volitional motion (phase-2 appends)
]);

// ── CLICS-style colexification affinities ────────────────────────────────
// [a, b, probability that ONE word covers both in a given family] — the
// probabilities echo the real cross-linguistic frequencies in spirit.
export const COLEX = [
  [TREE, WOOD, 0.55], [HAND, ARM, 0.35], [MOON, MONTH, 0.5], [SUN, DAY, 0.35],
  [BLUE, GREEN, 0.35], [FIRE, HEARTH, 0.4], [EARTH, LAND, 0.5], [MOUNTAIN, HILL, 0.3],
  [RIVER, WATER, 0.2], [NIGHT, DARK, 0.3], [GOD, SKYC, 0.15], [KING, CHIEF, 0.4],
  [SEA, LAKE, 0.25], [PEOPLE, MAN, 0.2], [WAR, BATTLE, 0.35], [SPIRIT, WIND, 0.2],
  [FOREST, TREE, 0.25], [ROAD, CROSSING, 0.3], [CHILD, SON, 0.25], [GRAIN, BREAD, 0.25],
  // verb colexification (append-only; indices are famSeed-hash streams)
  [GO, WALKV, 0.25], [EAT, DRINK, 0.12], [WANT, LOVEV, 0.15], [SEE, HEAR, 0.08],
  // phase-2 domains (the taker is always the NEW concept, so no pre-existing
  // surface moves): heart-as-mind (with a head-as-mind minority — a later row
  // that fires overrides), tongue=language (THE classic), bark=skin
  [HEART, MIND, 0.45], [HEAD, MIND, 0.18], [TONGUE, LANGUAGE_C, 0.6], [SKIN, BARK, 0.3],
];

// ── intentional abstract derivation (the curated relations table) ─────────
// Abstract concepts (king, god, law, victory…) don't have to be opaque roots:
// most real languages BUILD them out of concrete ones — king ‹ "great man",
// god ‹ "sky father", law ‹ "old saying", victory ‹ "war's end". This is a
// relations table exactly like COLEX: a curated set of PLAUSIBLE derivation
// pathways, from which each family rolls one (or keeps an opaque root). It is a
// SYSTEM, not a fitted outcome — no row names a specific output; different
// families coin the same idea from different parts, and the etymology is
// recoverable and drifts with the rest of the language because the word IS the
// compound of these parts, replayed through the sound-change log (the machinery
// language.js already uses for the `dv` field on concrete concepts like FORD).
//
// Row = [target, HEAD, MOD, weight]. The word is the compound MOD+HEAD (per the
// family's compound strategy) and its gloss reads "‹ MOD HEAD" ("great man").
// Sources are always MORE basic than the target; the only cross-abstract
// references are to KING and GOD (which draw solely on concrete roots), so the
// graph is a shallow DAG — no cycles. A source that a family has colexified
// onto the target (sky=god, wind=spirit) would loop, so language.js drops that
// pathway and the family keeps the plain root — semantically right (if wind IS
// spirit, "spirit" needs no derivation).
export const DERIV = [
  // governance — the "one who sits on the throne" and its household
  [KING, MAN, GREAT, 3], [KING, MAN, OLD, 2], [KING, MAN, RULEV, 2], [KING, SIT, HIGH, 1],
  [QUEEN, WOMAN, GREAT, 3], [QUEEN, KING, WOMAN, 2], [QUEEN, WOMAN, HIGH, 1],   // "woman king" = regnant, not consort
  [THRONE, SIT, KING, 3], [THRONE, SIT, HIGH, 2], [THRONE, SIT, STONE, 1],
  [CROWN, HEAD, GOLD, 3], [CROWN, HEAD, KING, 2], [CROWN, HEAD, HIGH, 1],
  [TAX, GIFT, KING, 3], [TAX, GRAIN, KING, 2], [TAX, GIVE, KING, 1],
  [COUNCIL, MAN, WISE, 3], [COUNCIL, MAN, OLD, 2], [COUNCIL, SAY, MANY, 1],
  [LAW, SAY, OLD, 3], [LAW, SAY, TRUE, 2], [LAW, SAY, KING, 2], [LAW, SAY, STRONG, 1],
  // faith — the sky-father and those who serve it
  [GOD, FATHER, SKYC, 3], [GOD, SKYC, HIGH, 2], [GOD, SUN, GREAT, 1],
  [SPIRIT, WIND, GOD, 2], [SPIRIT, WIND, HIGH, 2], [SPIRIT, WIND, MAN, 1],
  [HOLY, HIGH, GOD, 2], [HOLY, TRUE, GOD, 2], [HOLY, GIFT, GOD, 1],
  [PRIEST, MAN, GOD, 3], [PRIEST, MAN, OLD, 2], [PRIEST, SAY, GOD, 1],
  [OATH, SAY, TRUE, 3], [OATH, HAND, GOD, 2], [OATH, HAND, TRUE, 1],
  // war — "war's end", "the many men", "the wall-watcher"
  [VICTORY, FINISH, WAR, 3], [VICTORY, STAND, WAR, 2], [VICTORY, WAR, GREAT, 1],
  [ARMY, MAN, MANY, 3], [ARMY, MAN, WAR, 2], [ARMY, SPEAR, MANY, 1],
  [GUARD, SEE, WALL, 2], [GUARD, STAND, GATE, 2], [GUARD, MAN, WALL, 1],
  [NOBLE, BLOOD, HIGH, 3], [NOBLE, KINC, GREAT, 2], [NOBLE, BLOOD, OLD, 1],
];

// ── CLF_SENSE: the sortal classifier sense of a noun (Group D) ────────────
// Shape/animacy is a world-knowledge dimension (like AGENTIVITY), NOT a
// language's answer (cardinal rule 2): a noun is assigned its classifier by its
// SENSE, and each language supplies the exponent for that sense. Humans → 'hum',
// long/rigid things → 'long', flat things → 'flat', round/compact → 'round';
// ANIMALS come free from the 'anm' domain (so no anm-domain concept is listed
// here — that would break the "every animal reads 'anm'" invariant); everything
// else falls back to 'gen'. Append-only, keys on existing concept ids.
export const CLF_SENSE = new Map([
  [MAN, "hum"], [WOMAN, "hum"], [KING, "hum"], [QUEEN, "hum"], [CHIEF, "hum"],
  [PRIEST, "hum"], [CHILD, "hum"], [MOTHER, "hum"], [FATHER, "hum"], [SON, "hum"],
  [DAUGHTER, "hum"], [BROTHER, "hum"], [PEOPLE, "hum"], [GUARD, "hum"], [LORD, "hum"], [NOBLE, "hum"],
  [TREE, "long"], [REED, "long"], [SPEAR, "long"], [SWORD, "long"], [ROAD, "long"],
  [RIVER, "long"], [ARM, "long"], [BRIDGE, "long"],
  [LEAF, "flat"], [SHIELD, "flat"], [FIELD, "flat"], [WALL, "flat"],
  [STONE, "round"], [GRAIN, "round"], [HEAD, "round"], [SUN, "round"], [MOON, "round"],
  [STAR, "round"], [GOLD, "round"], [SILVER, "round"],
  // phase-2 appends (new ids only — existing assignments never move)
  [SISTER, "hum"], [UNCLE_F, "hum"], [UNCLE_M, "hum"], [AUNT_F, "hum"], [AUNT_M, "hum"],
  [COUSIN, "hum"], [GRANDFATHER, "hum"], [GRANDMOTHER, "hum"],
  [TONGUE, "long"], [SKIN, "flat"], [BARK, "flat"],
]);
// A few nouns are GENUINELY ambiguous: a fish is animal AND long, a coin flat
// AND round, a ship long AND just-a-thing. These carry a [candidate, candidate]
// pair and each FAMILY rolls its salient sense (the COLEX/DERIV per-family idiom)
// — so classifier ASSIGNMENT varies across languages, not just the exponent.
export const CLF_AMBIG = new Map([
  [FISH, ["anm", "long"]], [SHIP, ["long", "gen"]], [COIN, ["round", "flat"]],
]);

// ── name-material pools (indices into CONCEPTS) ──────────────────────────
export const TOPO_HEAD = [RIVER, FORD, LAKE, BAY, ISLAND, HILL, MOUNTAIN, VALLEY,
  PLAIN, STONE, CAVE, PASS, SPRING, MARSH, FOREST, FIELD, TOWN, FORT, WALL, BRIDGE,
  MARKET, HARBOR, MILL, WELL, TOWER, GATE, TEMPLE, HOUSE, CLIFF, OAK, REED];
export const TOPO_MOD = [NEW, OLD, GREAT, LITTLE, HIGH, LOW, LONG, DEEP, COLD, DRY,
  RICH, FAR, FAIR, DARK, BRIGHT, BLACK, WHITE, RED, GREEN, GOLDEN, GREY, HOLY,
  KING, WOLF, BEAR, EAGLE, RAVEN, HORSE, SALT, IRON, STONE];
export const PERSON_POOL = [WOLF, BEAR, EAGLE, RAVEN, FALCON, LION, DEER, BOAR,
  STONE, IRON, GOLD, FIRE, STORM, STAR, DAWN, BRIGHT, DARK, BRAVE, STRONG, WISE,
  TRUE, FREE, PEACE, GLORY, HOPE, NOBLE, SWIFT, BELOVED, GOD, GIFT, VICTORY,
  SPEAR, SWORD, SHIELD, GUARDIAN, HEART, BLOOD, KING, HIGH, FAIR];
// domains a prestige language donates under contact (the pig/pork machine):
export const LOAN_POOL = [KING, LAW, THRONE, CROWN, TAX, COUNCIL, REALM, TEMPLE,
  PRIEST, HOLY, GOD, WINE, SILK, COIN, GOLD, SILVER, MARKET, ARMY, GUARD, TOWER,
  VICTORY, GLORY, NOBLE];
