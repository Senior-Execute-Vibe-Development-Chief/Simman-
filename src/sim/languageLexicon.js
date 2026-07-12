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

export const CONCEPTS = D;

// frame-able verbs for the sentence layer + Lab dropdowns (append-only: existing
// indices are referenced by position in the probe, so new verbs go at the END)
export const VERBS = [BE, HAVE, GO, COME, DO, SAY, SEE, HEAR, KNOW, WANT, GIVE,
  TAKE, MAKE, EAT, DRINK, SLEEP, SIT, STAND, WALKV, RUN, FALL, DIE, KILL,
  FIGHTV, BURNV, BUILDV, RULEV, LOVEV, FEARV, FINISH, SEEM, EXCEED];

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
