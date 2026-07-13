// ── The emblem GENOME: one heritable design-genetics for every tradition ──
//
// A civilisation's banner is not a fixed picture — it is the EXPRESSION of a
// small gene vector that is seeded from what the realm has become, then EVOLVES:
// it mutates over generations, a successor inherits it with drift, and a union or
// conquest RECOMBINES two genomes (heraldry's real marshalling, as genetic
// crossover). The same genome can express European heraldry, a Chinese-style
// sacred beast on imperial silk, a monochrome radial badge (mon), an aniconic
// calligraphic banner, a steppe brand (tamga), or a plain bannered field — all on
// a FLAT plane (no physical standards). Which one it becomes falls out of the
// genes, and the genes fall out of the world; nothing is keyed to a real place.
//
// Genotype → phenotype: `expressGenome()` decodes the gene vector into a concrete
// design the renderer draws. Genes not relevant to the chosen composition are
// simply not expressed (like unexpressed DNA) — but they still ride along and can
// surface in a descendant, which is what makes the lineage feel alive.
//
// PURE + DETERMINISTIC: all randomness comes from a seeded PRNG, so a genome and
// its whole evolutionary tree replay identically. No Math.random.

// ── deterministic PRNG (mulberry32) ──
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrap01 = x => ((x % 1) + 1) % 1;
// a gentle bell in [0,1] (sum of uniforms), for mutation steps
function bell(rng) { return (rng() + rng() + rng() - 1.5); }

// ── the genes (ordered — order is the crossover backbone) ──
export const GENES = [
  "substrate", "composition", "iconism", "symmetry", "paletteMode",
  "hueA", "hueB", "hueC", "chroma", "value",
  "partition", "line", "stripes",
  "motifCat", "motifIdx", "motifCount", "arrange", "motifScale",
  "border", "scriptDensity", "brandSeed",
  "pearl", "sunDisc", "star", "crescent", "secondary",
];
const IDX = {}; GENES.forEach((g, i) => (IDX[g] = i));

// enums the genes decode into
const SUBSTRATES  = ["shield", "banner", "roundel", "pennon", "gonfalon", "lozenge"];
// escutcheon outlines a shield substrate can take (an idle gene picks — the
// heater stays the common silhouette)
const SHIELD_SHAPES = ["heater", "heater", "iberian", "french", "kite"];
const FLAG_SUBSTRATES = new Set(["banner", "gonfalon", "pennon"]);
// Weighted like the charge categories: real banners and arms are DOMINATED by
// charged fields (a device on a ground), while pure calligraphy, brands,
// tilework and sigil standards were the traditions of specific institutions —
// present, reachable, but a minority. Uniform windows made abstract line-art
// half of all emblems; these windows put charged compositions first.
const COMPOSITIONS = ["heraldic", "heraldic", "heraldic", "central", "central",
  "radial", "script", "brand", "plain", "seme", "sacred"];
// procedural SACRED SIGIL vocabulary — sacred primitives combined under symmetry.
// This is our OWN religious iconography: no real faith's symbol, but the visual
// grammar (radial/bilateral symmetry, radiating arms, a core, an enclosure, a
// base) that makes a glyph read as sacred. A faith gets a unique, evolvable one.
const SIGIL_FOLDS = [3, 4, 4, 4, 5, 6, 6, 8, 12];
const SIGIL_ARMS  = ["bar", "taper", "budded", "flared", "forked", "crescent", "looped", "petal", "trefoil"];
const SIGIL_CORES = ["orb", "ring", "eye", "triangle", "star", "void", "flame", "gem"];
const SIGIL_ENC   = ["none", "none", "ring", "ring", "double", "vesica", "triangle"];
const SIGIL_BASES = ["none", "none", "none", "steps", "lotus", "cradle"];
const SIGIL_INTER = ["none", "none", "dots", "rays", "pips"];
const SYMMETRIES  = ["none", "bilateral", "radial", "quarterly"];
const PALETTES    = ["heraldic", "monochrome", "imperial", "earth"];
const PARTITIONS  = ["plain", "perPale", "perFess", "perBend", "quarterly", "gyronny", "perSaltire", "chevron", "barry", "paly", "chequy", "lozengy"];
// field TREATMENTS (the crescent gene's high window): the two furs, plus the
// lattice treatments — fretty (interlaced bendlets) and masoned (brickwork)
const TREATMENTS  = ["ermine", "vair", "fretty", "masoned"];
// cadency — the marks of difference a cadet line accumulates, in order
const CADENCY_MARKS = ["label", "crescent", "mullet", "martlet", "annulet", "fleur"];
const LINES       = ["straight", "straight", "wavy", "engrailed", "embattled", "indented"];
const ARRANGES    = ["single", "single", "three", "inPale", "seme"];
// when an ordinary is present, the SAME arrange gene instead decides the
// ordinary's COMPANY: nothing (the bare ordinary is the design — still the
// common case), charges BETWEEN it in the free field, charges ON the band
// itself, or a semé field strewn beneath it.
const ORD_COMPANY = ["none", "none", "between", "on", "seme"];
// where an ordinary's company SITS — unit positions of each ordinary's open
// regions (between) and of the band itself (on; a bend's riders tilt with it).
// Lives in the phenotype so the renderer just draws it and the blazon can
// count it — one source of truth.
const ORD_SLOTS = {
  fess:         { between: [[0.28, 0.2], [0.72, 0.2], [0.5, 0.81]], on: [[0.28, 0.5], [0.5, 0.5], [0.72, 0.5]] },
  pale:         { between: [[0.2, 0.42], [0.8, 0.42]], on: [[0.5, 0.26], [0.5, 0.5], [0.5, 0.74]] },
  bend:         { between: [[0.74, 0.26], [0.26, 0.74]], on: [[0.3, 0.3], [0.5, 0.5], [0.7, 0.7]], tilt: 45 },
  bendSinister: { between: [[0.26, 0.26], [0.74, 0.74]], on: [[0.7, 0.3], [0.5, 0.5], [0.3, 0.7]], tilt: -45 },
  chevron:      { between: [[0.26, 0.3], [0.74, 0.3], [0.5, 0.8]] },
  cross:        { between: [[0.24, 0.26], [0.76, 0.26], [0.24, 0.74], [0.76, 0.74]], on: [[0.5, 0.5]] },
  saltire:      { between: [[0.5, 0.19], [0.19, 0.5], [0.81, 0.5], [0.5, 0.81]], on: [[0.5, 0.5]] },
  pile:         { between: [[0.19, 0.62], [0.81, 0.62]], on: [[0.5, 0.32]] },
  pall:         { between: [[0.5, 0.19], [0.24, 0.72], [0.76, 0.72]], on: [[0.5, 0.46]] },
};
// ordinaries — the bold geometric charges of heraldry, laid over the field (with
// the field's line-style on their edges). "none" weighted so a plain field stays common.
const ORDINARIES  = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "fess", "pale", "bend", "bendSinister", "chevron", "cross", "saltire", "pile", "pall"];
// Motif categories split into LIVING (figures a strict aniconism forbids) and
// NON-LIVING (plant, object, architecture, natural, celestial, geometry — borne
// even by aniconic faiths as arabesque / device / phenomenon). This split is what
// lets low iconism mean "no living figures" rather than "no charge at all".
// Weighted by rough ARMORIAL FREQUENCY (like the "none"-weighted ordinaries):
// beasts, objects and geometric devices dominate real rolls of arms; birds,
// mythics and plants are common; insects, rocks-and-weather and sea creatures
// were genuine rarities (a Barberini bee, a Gresham grasshopper — curiosities,
// not staples). Every category stays reachable; the windows just match the
// corpus instead of giving a cicada the same odds as a lion.
const MOTIF_CATS  = ["beast", "beast", "beast", "bird", "bird", "mythic", "mythic", "sea",
  "plant", "plant", "object", "object", "object", "architecture", "natural", "celestial",
  "geometric", "geometric", "geometric", "insect"];
const LIVING_CATS = new Set(["beast", "insect", "bird", "mythic", "sea"]);
const NONLIVING_CATS = ["plant", "object", "architecture", "natural", "celestial", "geometric"];
// motif ids resolve to charge art in the renderer (DrawShield / game-icons).
// @INJECT:MOTIFS-START — the lab build (tools/build_lab.mjs) replaces this whole
// block with the size-filtered subset so the artifact's pools match its bundled art.
const MOTIFS = {
  beast: ["lion", "wolf", "boar", "bull", "bear", "horse", "ram", "stag", "elephant", "rabbit", "antelope", "camel", "tiger", "leopard", "fox", "greyhound", "hedgehog", "badger", "otter", "squirrel", "ass", "cow", "lizardStatant", "kangarooSalient", "rhinoceros", "llama", "reindeerHead", "reindeerSalient", "hippo", "jerboa", "reindeer", "elephantHead", "rat", "squirrelRampant", "ferret", "weasel", "weaselRampant", "wolfHeadAffronty", "cat", "cockHead", "sheep", "cowHead", "horseSalient", "pig", "lionHeadReguardant", "lionHeadGuardant", "lionLegCouped", "lionLegErased", "lionCouchant", "lionHeadErased", "lionHead", "lionDormant", "lionSejant", "greyhoundSalient", "greyhoundCourant", "dog", "dogHead", "dogCouchantGuardant", "polarBear", "bearSejant", "bearStatantErect"],
  insect: ["bee", "butterfly", "spider", "ant", "grasshopper", "dragonfly", "stagbeetle", "snail", "moth", "hornet", "beetle", "fly", "wasp", "cricket", "cicada"],
  bird: ["eagle", "falcon", "dove", "raven", "rooster", "crane", "swan", "owl", "peacock", "pelican", "martlet", "crowReguardant", "blackbird", "magpieVolantEnArriere", "storkVolant", "seagullVolant", "shoveller", "starling", "crowHead", "doveFondant", "wing", "ravenHead", "feather", "eagleClaw", "germanEagle", "eagleNatural", "alerionDisplayedTowardsBase", "alerionDisplayed", "alerion", "eagleKleestengel", "eagleLeg", "duck", "falconReguardant", "falconJessed", "falconVolant"],
  mythic: ["dragon", "wyvern", "griffin", "unicorn", "pegasus", "hydra", "phoenix", "cockatrice", "basilisk", "sphinx", "salamander", "seadragon", "sealion", "harpy", "centaur", "chimera", "manticore", "ouroboros", "fishtailGriffin", "griffinHead", "bagwyn", "unicornHeadErased", "amphiptere", "chatloup", "mermaidInHerModesty", "chatloupWingedSejant", "dragonHead", "tribalDragon", "dragonHeadCouped", "dragonHeadCaboshed", "minotaur"],
  sea: ["dolphin", "serpent", "mermaid", "fish", "pike", "salmon", "whale", "lobster", "shark", "escallop", "octopus", "narwhal", "shrimp", "whelk", "seaTurtle", "turtle", "zydrach", "polypus", "dolphinWinged", "manatee", "carpEmbowed", "roachNaissant", "roach", "catfishEmbowed", "luceEmbowed", "catfishHaurientEmbowed", "luce", "snakeGlissant", "snake", "serpentNowed", "serpentErect", "serpentErectTailNowed", "seaSerpent"],
  plant: ["rose", "tree", "lotus", "thistle", "garb", "oak", "oakleaf", "olive", "palm", "lily", "cinquefoil", "quatrefoil", "trefoil", "sunflower", "iris", "poppy", "shamrock", "acorn", "vine", "grapes", "pineapple", "fleur", "crocus", "sexfoil", "tulip", "octofoil", "violet", "geranium", "tulipBundle3", "periwinkleFlower", "forgetMeNot", "pear", "lemon", "mapleLeaf", "lindenLeaf", "mapleLeafConjoined3", "pineNewEnglandTree", "apple", "lemonSlippedLeaved", "yewTree", "limeLeaf", "seeblatt", "cloverLeaf", "clover", "reedBundle3", "vineLeaf", "cactus", "pepper", "aubergine", "onion", "pumpkin"],
  object: ["crown", "key", "sword", "anchor", "ship", "scales", "harp", "lyre", "book", "bell", "bugle", "clarion", "lute", "drum", "chalice", "amphora", "anvil", "hammer", "millrind", "millstone", "scythe", "sickle", "plough", "pitchfork", "compass", "lantern", "lamp", "scroll", "mirror", "shears", "quill", "distaff", "axe", "halberd", "arrow", "arrows", "pheon", "trident", "spear", "bow", "crossbow", "flail", "club", "cannon", "mace", "warhammer", "catherinewheel", "cartwheel", "cogwheel", "helmet", "gauntlet", "breastplate", "mailedfist", "horseshoe", "spur", "stirrup", "saddle", "wagon", "beehive", "beacon", "brazier", "torch", "grenade", "chest", "wolfiron", "staple", "musicalNote", "noteQuarter", "noteEighth", "fireSteel", "comb", "bookModernClosed", "candlestick", "vallary", "saxon", "palisado", "antique", "earl", "duke", "helmetKnight", "helmetEsquire", "helmetNorman", "helmetPeer", "helmetKnightAffronty", "caltrap", "archeryTarget", "lance", "dagger", "rapier", "swordstpaul", "sabre", "seax", "slaughterAxe", "pickAxe", "addice", "waterBouget", "mug", "barrel", "scoop", "funnel", "table", "flag", "frenchGemstoneInProfile", "arrowBroad", "spearHeadImbrued", "oar", "rudderPole", "oarInsaltire2", "fishingBoat", "crowsNest", "barge", "lymphadFurled", "lymphadSailsSet", "buckle", "maunche", "stirrupLeathered", "hawkbell", "farmingFlail", "fishhook", "farmingFlailInsaltire2", "shepherdsCrook", "butterChurn", "ploughshare", "chessPawn", "chessRook", "chessKing", "horn", "heart"],
  architecture: ["tower", "castle", "bridge", "gate", "arch", "house", "city", "keystoneCouped", "pyramid", "obelisk", "millwheel", "waterwheel", "fountainNatural", "pillar", "bridgeThreeArches", "keystone", "lighthouse"],
  natural: ["cloud", "lightning", "teardrop", "flint", "flames", "fireball", "lightningBoltModern"],
  celestial: ["sun", "moon", "estoile", "comet", "moonIncrescent", "moonPendant", "estoileInflamed", "moonDecrescent", "moonCrescent", "rainbow", "sunOutline", "sunRays"],
  geometric: ["mullet", "mullet6", "mullet8", "rowel", "roundel", "annulet", "lozenge", "fusil", "mascle", "billet", "delf", "crossCouped", "crossPattee", "crosslet", "goutte", "fret", "triskele", "knot", "suffolkKnot", "carolingianKnot", "hungerfordKnot", "triangle", "shakefork", "saltire", "mulletOf5VoidedInterlaced", "mulletOf7VoidedInterlaced", "mulletOf8MasclesInterlaced", "annuletConcentricOf2", "annuletConcentricOf3", "takedaClanSymbol", "tokikikyoClanSymbol", "moriClanSymbol", "chosokabeClanSymbol"],
};
// @INJECT:MOTIFS-END

const pickEnum = (v, arr) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

// ── construction ──────────────────────────────────────────────────────────
// A fresh, random genome from a numeric seed.
function randomGenes(seed) {
  const rng = prng(seed);
  return GENES.map(() => rng());
}

/**
 * foundGenome(seed, axes) — a genome from a realm's seed, biased by ABSTRACT
 * visual axes (all 0..1; any omitted → that gene stays seed-random).
 *
 * Deliberately, NO axis picks a composition or a charge CATEGORY: which tradition
 * a realm expresses (heraldic beast, central device, radial badge, calligraphy,
 * tamga, geometry, semé …) and which charge it bears come purely from the
 * `composition`/`motifCat` genes and later evolution — so EVERY pattern is
 * reachable by EVERY realm. There is no "nomads get a tamga", no cultural
 * stereotype baked into the seed. The axes only shade abstract properties:
 *   figuration — abstract ↔ living figures   → the iconism gene
 *   ornateness — plain ↔ divided & bordered   → partition / border / stripes / arrange
 *   boldness   — small ↔ dominant charge      → motif scale
 *   saturation — muted ↔ vivid (mono at 0)    → chroma / secondary / palette mode
 *   symmetry   — free ↔ mirrored              → the symmetry gene
 *   tone       — dark ↔ light                 → the value gene
 *   hue        — the field's base hue          → hueA / hueB
 *   format     — shield ↔ banner ↔ badge      → substrate
 */
export function foundGenome(seed, axes = {}) {
  const g = randomGenes(seed);
  const rng = prng((seed ^ 0x9e3779b9) >>> 0);
  const set = (name, v) => (g[IDX[name]] = clamp01(v));
  const nudge = (name, v, w) => (g[IDX[name]] = clamp01(g[IDX[name]] * (1 - w) + v * w));
  const a = axes;

  if (a.figuration != null) set("iconism", clamp01(a.figuration + bell(rng) * 0.12));
  if (a.ornateness != null) { nudge("partition", a.ornateness, 0.55); nudge("border", a.ornateness, 0.4); nudge("stripes", a.ornateness, 0.3); nudge("arrange", a.ornateness * 0.85, 0.4); }
  if (a.boldness != null) nudge("motifScale", 0.35 + a.boldness * 0.6, 0.6);
  if (a.saturation != null) { set("chroma", clamp01(a.saturation + bell(rng) * 0.1)); nudge("secondary", a.saturation, 0.4); if (a.saturation < 0.18) nudge("paletteMode", 0.3, 0.55); }
  if (a.symmetry != null) nudge("symmetry", a.symmetry, 0.6);
  if (a.tone != null) set("value", clamp01(a.tone + bell(rng) * 0.1));
  if (a.hue != null) { set("hueA", wrap01(a.hue + bell(rng) * 0.05)); set("hueB", wrap01(a.hue + 0.5 + bell(rng) * 0.1)); }
  if (a.format != null) nudge("substrate", a.format, 0.6);

  return { genes: g, gen: 0, seed: seed >>> 0 };
}

// ── evolution operators ─────────────────────────────────────────────────────
/** Random drift: perturb genes by a bell step; a few genes may jump entirely
 *  (a rare macro-mutation — a new charge, a shift of tradition). */
export function mutateGenome(genome, seed, strength = 1) {
  const rng = prng(seed >>> 0);
  const genes = genome.genes.map((v, i) => {
    const rate = MICRO_RATE * strength;
    let nv = v;
    if (rng() < rate) nv = wrap01(v + bell(rng) * STEP * strength);
    if (rng() < MACRO_RATE * strength) nv = rng();     // macro-mutation: a fresh allele
    return clamp01(nv);
  });
  const out = { genes, gen: (genome.gen || 0) + 1, seed: genome.seed };
  if (genome.cadency) out.cadency = genome.cadency;   // drift is the same bearer: the difference stays
  // quarterings persist down a line, drifting gently with it; rarely a branch
  // SIMPLIFIES — resumes its own single coat and lets the accumulation go
  if (genome.quarters && genome.quarters.length > 1 && rng() >= MACRO_RATE * strength) {
    out.quarters = genome.quarters.map(q => ({
      genes: q.genes.map(v => (rng() < MICRO_RATE * 0.4 * strength ? clamp01(wrap01(v + bell(rng) * STEP * 0.5 * strength)) : v)),
      gen: (q.gen || 0) + 1, seed: q.seed,
    }));
  }
  return out;
}
const MICRO_RATE = 0.5;   // fraction of genes that drift a little each step
const MACRO_RATE = 0.03;  // per-gene chance of a wholesale jump
const STEP = 0.14;        // drift size

/** A successor inherits the parent's genome with a little drift — recognisably
 *  the same house, diverging over generations. CADENCY: the heir bears a mark
 *  of difference (label, crescent, mullet, …), and the marks accumulate down a
 *  cadet line; when a branch succeeds AS the house itself, they clear. */
export function inheritGenome(parent, seed, strength = 0.5) {
  const child = mutateGenome(parent, seed, strength);
  const headship = prng((seed ^ 0xcadec) >>> 0)() < 0.3;   // the heir takes the house outright
  const n = headship ? 0 : Math.min(CADENCY_MARKS.length, (parent.cadency || 0) + 1);
  if (n) child.cadency = n; else delete child.cadency;
  return child;
}

/** Recombination — a union or conquest MARSHALS two genomes. Per-gene the child
 *  takes one parent's allele (classic uniform crossover), with light mutation.
 *  And the union's SHIELD accumulates: each parent contributes its quarter
 *  list (itself, if it is a simple coat), duplicates collapse (the same coat
 *  is never quartered twice), and the four most senior survive. The child's
 *  own genes remain its house STYLE, carried beneath the marshalled display
 *  and expressed again if a descendant line ever simplifies. */
export function crossGenome(a, b, seed) {
  const rng = prng(seed >>> 0);
  const genes = GENES.map((_, i) => (rng() < 0.5 ? a.genes[i] : b.genes[i]));
  // small post-cross mutation
  for (let i = 0; i < genes.length; i++) if (rng() < 0.15) genes[i] = clamp01(genes[i] + bell(rng) * STEP);
  const coats = g => (g.quarters && g.quarters.length ? g.quarters : [{ genes: g.genes, gen: g.gen || 0, seed: g.seed }]);
  const merged = [];
  for (const q of [...coats(a), ...coats(b)])
    if (!merged.some(m => genomeDistance(m, q) < 0.02)) merged.push(q);
  const out = { genes, gen: Math.max(a.gen || 0, b.gen || 0) + 1, seed: a.seed };
  if (merged.length > 1) out.quarters = merged.slice(0, 4);
  return out;
}

// ── colour ──────────────────────────────────────────────────────────────────
function hsl(h, s, l) {
  h = wrap01(h) * 6; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 1) [r, g, b] = [c, x, 0]; else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x]; else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0];
}
const GOLD = [0xd7, 0xb0, 0x45], SILVER = [0xe9, 0xe7, 0xdd], INK = [0x22, 0x1f, 0x27], BONE = [0xf1, 0xec, 0xdd];

// ── the TINCTURE system ──────────────────────────────────────────────────────
// Heraldry's palette is TYPED: metals are the light class, colours the dark,
// stains the dark off-hues. The rule of tincture — no colour on colour, no
// metal on metal — is at bottom a lightness-class opposition that guarantees
// any mark reads on its ground. So contrast is never CHECKED after the fact:
// it is CONSTRUCTED — a mark's tincture is picked from the class opposite
// whatever it lies on — and the small, well-spread named palette makes any
// two named tinctures mutually distinct for free.
export const TINCTURES = {
  or:       { kind: "metal",  rgb: GOLD },
  argent:   { kind: "metal",  rgb: SILVER },
  gules:    { kind: "colour", rgb: [0xa5, 0x1d, 0x2d] },
  azure:    { kind: "colour", rgb: [0x2b, 0x4a, 0x8f] },
  vert:     { kind: "colour", rgb: [0x2d, 0x6e, 0x41] },
  sable:    { kind: "colour", rgb: INK },
  purpure:  { kind: "colour", rgb: [0x6b, 0x37, 0x80] },
  murrey:   { kind: "stain",  rgb: [0x73, 0x2b, 0x4b] },
  sanguine: { kind: "stain",  rgb: [0x86, 0x31, 0x2a] },
  tenne:    { kind: "stain",  rgb: [0xa8, 0x67, 0x25] },
};
const T_NAMES = Object.keys(TINCTURES);
const METALS = T_NAMES.filter(n => TINCTURES[n].kind === "metal");
const DARKS = T_NAMES.filter(n => TINCTURES[n].kind !== "metal");   // colours + stains

// OKLab — perceptual colour space, so distances match what the eye sees
function oklab([r, g, b]) {
  const f = u => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const l = Math.cbrt(0.41222147 * R + 0.53633254 * G + 0.05144599 * B);
  const m = Math.cbrt(0.2119035 * R + 0.68069955 * G + 0.10739696 * B);
  const s = Math.cbrt(0.08830246 * R + 0.28171884 * G + 0.6299787 * B);
  return [0.21045426 * l + 0.79361779 * m - 0.00407205 * s,
    1.9779985 * l - 2.42859221 * m + 0.45059371 * s,
    0.02590404 * l + 0.78277177 * m - 0.80867577 * s];
}
const dE = (a, b) => { const A = oklab(a), B = oklab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const T_LAB = {}; for (const n of T_NAMES) T_LAB[n] = oklab(TINCTURES[n].rgb);

function nearestTincture(rgb, names) {
  const p = oklab(rgb); let best = names[0], bd = Infinity;
  for (const n of names) { const L = T_LAB[n], d = Math.hypot(p[0] - L[0], p[1] - L[1], p[2] - L[2]); if (d < bd) { bd = d; best = n; } }
  return best;
}
const T = name => ({ name, kind: TINCTURES[name].kind, rgb: TINCTURES[name].rgb });
// the light/dark boundary the palette itself implies (midway, in OKLab
// lightness, between the darkest metal and the lightest non-metal) — used to
// type the CONTINUOUS colours of the non-heraldic palette modes
const CLASS_L = (Math.min(...METALS.map(n => T_LAB[n][0])) + Math.max(...DARKS.map(n => T_LAB[n][0]))) / 2;
const P = rgb => ({ name: nearestTincture(rgb, T_NAMES), kind: oklab(rgb)[0] > CLASS_L ? "metal" : "colour", rgb });
const classOf = t => (t.kind === "metal" ? "metal" : "dark");

// What a mark WEARS follows from what it LIES ON — the rule of tincture as a
// constructive rule, not a post-hoc contrast fix:
//  · a uniform-class ground of GENUINE named tinctures: pick from the OPPOSITE
//    class — the hue gene chooses freely inside the pool, because the named
//    palette's classes are well-separated by design, so opposition alone
//    guarantees the mark reads;
//  · anything else (a party of colour and metal, where the rule is silent, or
//    a CONTINUOUS colour from a non-heraldic mode, where the class boundary
//    proves nothing): pick the candidate farthest, in OKLab, from its nearest
//    ground tincture. An argmax needs no threshold, and a candidate equal to a
//    ground scores zero, so it can never be picked over a distinct one.
// `poles` lets a two-pole tradition offer its own colours as first-preference
// candidates (ties break to them), so its marks stay mode-coherent whenever
// its poles genuinely read.
function tinctureOn(grounds, hue, val, poles = []) {
  const genuine = grounds.every(g => TINCTURES[g.name] && TINCTURES[g.name].rgb === g.rgb);
  if (genuine && new Set(grounds.map(classOf)).size === 1) {
    const pool = classOf(grounds[0]) === "metal" ? DARKS : METALS;
    return T(nearestTincture(hsl(hue, 0.55, 0.25 + val * 0.5), pool));
  }
  let best = null, bd = -1;
  for (const c of [...poles, ...T_NAMES.map(T)]) {
    const d = Math.min(...grounds.map(g => dE(c.rgb, g.rgb)));
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

function decodePalette(get) {
  const mode = pickEnum(get("paletteMode"), PALETTES);
  const hA = get("hueA"), hB = get("hueB"), chroma = get("chroma"), val = get("value");
  // a mark in a two-pole tradition takes whichever pole sits farther from the
  // field — the same constructive pick, over a two-member palette
  const farPole = (bg, a, b) => (dE(bg, a.rgb) >= dE(bg, b.rgb) ? a : b);
  let fieldT, companionT, chargeT, accentT, poles = [], hatch = null;
  if (mode === "monochrome") {
    // ink and bone are, in tincture terms, sable and argent — typed so the
    // class rules see them
    const inkT = P(INK), boneT = P(BONE), inv = val > 0.5;
    fieldT = inv ? inkT : boneT; companionT = chargeT = accentT = inv ? boneT : inkT;
    poles = [inkT, boneT];
    // petra sancta: the hues the genes IMPLY, decoded exactly as the heraldic
    // mode would — the renderer engraves them as hatching on heraldic coats
    // (dots or, vertical gules, horizontal azure…), so a mono coat still
    // CARRIES its colour genome, the way an engraver's plate does
    const hF = T(nearestTincture(hsl(hA, 0.25 + chroma * 0.65, 0.18 + val * 0.62), T_NAMES));
    const hC = tinctureOn([hF], hB, val);
    hatch = { field: hF.name, charge: hC.name,
      companion: classOf(hF) === "dark" && get("secondary") > 0.5
        ? nearestTincture(hsl(hB, 0.55, 0.25 + val * 0.4), DARKS.filter(n => n !== hF.name))
        : hC.name };
  } else if (mode === "imperial") {
    fieldT = P(hsl(hA, 0.55 + chroma * 0.35, 0.42 + val * 0.12));
    poles = [T("or"), P(INK)];
    chargeT = companionT = farPole(fieldT.rgb, poles[0], poles[1]);   // gold on silk; ink if the silk runs light
    accentT = P([0xc0, 0x39, 0x2b]);
  } else if (mode === "earth") {
    fieldT = P(hsl(0.06 + hA * 0.12, 0.25 + chroma * 0.2, 0.46 + val * 0.14));
    companionT = P([0x3a, 0x2e, 0x22]);
    poles = [P([0x2b, 0x24, 0x1c]), P(BONE)];
    chargeT = farPole(fieldT.rgb, poles[0], poles[1]);
    accentT = P(BONE);
  } else {
    // heraldic: the genome's continuous colour INTENT, quantised to the nearest
    // named tincture — a pale dull intent lands argent, a warm light one or, so
    // METAL FIELDS (bearing colour charges) emerge exactly where the genes
    // imply them; stains sit in narrow off-hue pockets and stay naturally rare
    fieldT = T(nearestTincture(hsl(hA, 0.25 + chroma * 0.65, 0.18 + val * 0.62), T_NAMES));
    chargeT = tinctureOn([fieldT], hB, val);
    // the partition companion: a second dark beside a dark field when the
    // secondary gene asks for one (colour-and-colour parties are lawful), else
    // the opposite class — the classic party of colour and metal
    companionT = classOf(fieldT) === "dark" && get("secondary") > 0.5
      ? T(nearestTincture(hsl(hB, 0.55, 0.25 + val * 0.4), DARKS.filter(n => n !== fieldT.name)))
      : chargeT;
    accentT = chargeT;
  }
  return { mode, field: fieldT.rgb, companion: companionT.rgb, charge: chargeT.rgb, accent: accentT.rgb,
    ink: INK, fieldT, companionT, chargeT, accentT, poles, hatch };
}

// ── genotype → phenotype ─────────────────────────────────────────────────────
/** expressGenome(genome) → a concrete design the renderer draws. Deterministic. */
export function expressGenome(genome) {
  const G = genome.genes;
  const get = name => G[IDX[name]];
  const iconism = get("iconism");

  let composition = pickEnum(get("composition"), COMPOSITIONS);
  const aniconic = iconism < 0.34;
  // A strongly figurative culture won't fly pure calligraphy / tamga.
  if (iconism > 0.72 && (composition === "script" || composition === "brand")) composition = "heraldic";
  let substrate = pickEnum(get("substrate"), SUBSTRATES);
  if (composition === "radial") substrate = "roundel";                 // a badge wants a round field
  if (composition === "script" && substrate === "roundel") substrate = "banner";
  // a shield's outline — the brandSeed gene is idle on shields, so it picks
  const shieldShape = substrate === "shield" ? pickEnum(get("brandSeed"), SHIELD_SHAPES) : "heater";
  const isFlag = FLAG_SUBSTRATES.has(substrate);

  const pal = decodePalette(get);
  const symmetry = composition === "radial" ? "radial" : pickEnum(get("symmetry"), SYMMETRIES);

  // field — a heraldic field can be divided (partition), draped in a FUR, laid with
  // an ORDINARY, and topped by a CHIEF / bounded by a BORDURE, all with a line-style
  // on their edges, and optionally COUNTERCHANGED across a partition. These reuse the
  // otherwise-idle genes in heraldic composition (hueC, pearl, border, crescent,
  // symmetry) so no genome grows — the depth was latent in the vector.
  let partition = composition === "heraldic" ? pickEnum(get("partition"), PARTITIONS) : "plain";
  const tinctures = [pal.field, pal.companion];
  const field = { partition, tinctures, names: [pal.fieldT.name, pal.companionT.name],
    line: pickEnum(get("line"), LINES), stripes: 2 + Math.floor(get("stripes") * 7) };
  // the typed GROUND any mark over this field lies on
  let grounds = partition === "plain" ? [pal.fieldT] : [pal.fieldT, pal.companionT];
  const TWO_REGION = ["perPale", "perFess", "perBend"];
  // a field TREATMENT drapes the WHOLE field (so no partition/counterchange
  // under it). A fur IS the ground — ermine reads as argent strewn with
  // sable, vair as argent-and-azure — so marks pick against those; the
  // lattice treatments (fretty, masoned) are thin lines over the field
  // colour, so the field stays the ground.
  if (composition === "heraldic" && get("crescent") > 0.74) {
    field.fur = pickEnum((get("crescent") - 0.74) / 0.26, TREATMENTS);
    field.partition = partition = "plain";
    if (field.fur === "ermine") grounds = [T("argent")];
    else if (field.fur === "vair") grounds = [T("argent"), T("azure")];
    else grounds = [pal.fieldT];                   // fretty / masoned: thin lines over the field colour
    field.names = grounds.length === 2 ? [grounds[0].name, grounds[1].name] : [grounds[0].name, grounds[0].name];
  }
  // the tincture any mark lying on this field wears — chargeT was constructed
  // against the plain field; every other ground (a party, a fur) re-derives
  const markT = grounds.length === 1 && grounds[0] === pal.fieldT ? pal.chargeT
    : tinctureOn(grounds, get("hueB"), get("value"), pal.poles);
  const mixedGround = new Set(grounds.map(g => g.kind === "metal" ? "metal" : "dark")).size > 1;
  if (field.fur === "fretty") {
    // the lattice is a mark on the field: it wears what reads there
    field.treatTincture = markT.rgb; field.treatName = markT.name;
  } else if (field.fur === "masoned") {
    // mortar lines: whichever of ink/bone sits farther from the field
    field.treatTincture = dE(pal.field, INK) >= dE(pal.field, BONE) ? INK : BONE;
    field.treatName = field.treatTincture === INK ? "sable" : "argent";
  }
  if (composition === "heraldic") {
    field.ordinary = pickEnum(get("hueC"), ORDINARIES);
    // DIMINUTIVES: with the stripes gene otherwise idle, a linear ordinary
    // may split into its thinner plural form — bars, pallets, bendlets,
    // chevronels — two of them, or three at the gene's top
    field.ordinaryCount = ["fess", "pale", "bend", "bendSinister", "chevron"].includes(field.ordinary)
      && !["barry", "paly"].includes(partition) && get("stripes") > 0.62
      ? (get("stripes") > 0.86 ? 3 : 2) : 1;
    field.ordinaryTincture = markT.rgb;
    field.ordinaryName = markT.name;
    field.chief = get("pearl") > 0.66;
    field.bordure = get("border") > 0.62;
    field.subTincture = markT.rgb;                     // chief/bordure share the reading tincture
    // counterchange the ordinary across a two-region partition (per pale/fess/bend)
    field.counterchange = !field.fur && TWO_REGION.includes(partition) && get("symmetry") > 0.6;
  }

  // motif — a figurative composition carries a charge. Low iconism forbids LIVING
  // figures, so a living category (beast/bird/mythic/sea) is remapped to a
  // non-living one (celestial / geometric / plant / object). Only the abstract
  // compositions carry no charge.
  let motif = null;
  const hasOrdinary = composition === "heraldic" && field.ordinary && field.ordinary !== "none";
  if (["heraldic", "central", "radial", "seme"].includes(composition)) {
    let cat = pickEnum(get("motifCat"), MOTIF_CATS);
    if (aniconic && LIVING_CATS.has(cat)) {
      cat = NONLIVING_CATS[Math.floor(get("motifCount") * NONLIVING_CATS.length) % NONLIVING_CATS.length];
    }
    const pool = MOTIFS[cat];
    const id = pool[Math.min(pool.length - 1, Math.floor(get("motifIdx") * pool.length))];
    // the charge WEARS what its ground dictates (tinctureOn — the rule of
    // tincture, constructed); over a mixed two-region party it may instead be
    // COUNTERCHANGED — painted in the field's own tinctures, swapped across
    // the line, heraldry's own answer to a ground no one tincture can read on
    let arrange = null, tincture = markT, counterchange = false, behind = false, slots = null, tilt = 0;
    if (hasOrdinary) {
      // an ordinary no longer suppresses the charge — the arrange gene decides
      // its company. Charges ON the band derive their tincture against the
      // band (the same constructive rule, applied one layer up); a chevron has
      // no room on it and a counterchanged ordinary is no single ground, so
      // both keep their company BETWEEN instead.
      let slot = pickEnum(get("arrange"), ORD_COMPANY);
      // no single band to sit ON: a chevron, a counterchanged ordinary, or a
      // diminutive group keep their company BETWEEN instead
      if (slot === "on" && (field.ordinary === "chevron" || field.counterchange || field.ordinaryCount > 1)) slot = "between";
      if (slot === "between" || slot === "on") {
        let spec = ORD_SLOTS[field.ordinary];
        // on a FLAG the cross sits Nordic (crossing toward the hoist) and the
        // pile points from the hoist — the company follows the band
        if (isFlag && field.ordinary === "cross") spec = { between: [[0.13, 0.24], [0.63, 0.25], [0.13, 0.76], [0.63, 0.75]], on: [[0.34, 0.5]] };
        if (isFlag && field.ordinary === "pile") spec = { between: [[0.8, 0.26], [0.8, 0.74]], on: [[0.28, 0.5]] };
        // a chief owns the top band: company positions under it are dropped
        let pts = (slot === "on" ? spec.on : spec.between) || spec.between;
        if (field.chief) pts = pts.filter(([, uy]) => uy > 0.34);
        if (pts.length) {
          arrange = slot === "on" ? "onOrdinary" : "between";
          slots = pts;
          tilt = (slot === "on" && spec.tilt) || 0;
          if (slot === "on") tincture = tinctureOn([markT], get("hueA"), get("value"));
        }
      } else if (slot === "seme") { arrange = "seme"; tincture = tinctureOn(grounds, get("hueA"), get("value")); }
    } else {
      arrange = composition === "central" || composition === "radial" ? "single"
        : composition === "seme" ? "seme" : pickEnum(get("arrange"), ARRANGES);
      counterchange = composition === "heraldic" && !field.fur && mixedGround
        && TWO_REGION.includes(partition) && get("symmetry") > 0.6;
    }
    // a heraldic semé is a FIELD treatment: it lies beneath chief, bordure and
    // ordinary, not over them
    behind = arrange === "seme" && composition === "heraldic";
    // ATTITUDE: rarely a charge is borne INVERTED or turned TO SINISTER —
    // the tails of the sunDisc gene, otherwise idle for charges
    const attitude = get("sunDisc") < 0.12 ? "inverted" : get("sunDisc") > 0.88 ? "sinister" : null;
    if (arrange) motif = { id, cat, tincture: tincture.rgb, tinctureName: tincture.name, counterchange, behind,
      slots, tilt, attitude,
      count: slots ? slots.length : arrange === "three" ? 3 : arrange === "inPale" ? 2 : 1, arrange,
      scale: (composition === "central" ? 0.86 : composition === "radial" ? 0.7 : 0.5) * (0.75 + get("motifScale") * 0.5) };
  }

  // geometry — the "plain" composition is not a bare field: it is geometric
  // TILEWORK (a rosette or a star lattice).
  let geometry = null;
  if (composition === "plain") {
    geometry = {
      mode: get("symmetry") > 0.5 ? "lattice" : "rosette",
      points: [8, 8, 6, 12, 8, 10][Math.floor(get("motifCount") * 6) % 6],
      seed: Math.floor(get("brandSeed") * 1e6),
    };
  }

  // sacred sigil — our OWN religious iconography, procedural. A non-figural
  // device (abstract), so it is aniconism-safe and reachable by any genome.
  const sigil = composition === "sacred" ? sigilFromGenes(get) : null;

  // ornaments — a single small CANTON mark (top-dexter), only on compositions with
  // room for it, in a contrast-guaranteed colour so it never vanishes into the
  // field. No centred disc (it used to cover the device); no figure over a figure.
  const cantonOK = composition === "heraldic" || composition === "brand" || composition === "script";
  const ornaments = {
    border: get("border") > 0.5 || composition === "central",
    cornerAccent: composition === "central" && get("pearl") > 0.5,           // small disc, clear of the device
    canton: cantonOK && get("star") > 0.62,
    cantonKind: get("sunDisc") > 0.5 ? "sun" : "star",
    cantonColor: markT.rgb,                     // the canton lies on the field: it wears markT

    scriptDensity: 0.4 + get("scriptDensity") * 0.6,
    brandSeed: Math.floor(get("brandSeed") * 1e6),
  };

  // cadency — the inherited mark of difference, worn small in chief in a
  // tincture that reads on the field (chargeT, by construction)
  const cadency = genome.cadency
    ? { mark: CADENCY_MARKS[Math.min(CADENCY_MARKS.length, genome.cadency) - 1],
      tincture: pal.chargeT.rgb, tinctureName: pal.chargeT.name }
    : null;

  return { substrate, shieldShape, isFlag, composition, symmetry, iconism, colors: pal, field, motif, geometry, sigil, ornaments,
    cadency, gen: genome.gen || 0 };
}

// A sacred sigil spec from a gene reader (each aspect on its own gene, so it
// evolves legibly — a schism drifts the arms, a core, an enclosure…).
const pick = (v, arr) => arr[Math.floor(v * arr.length) % arr.length];
function sigilFromGenes(get) {
  return {
    fold: pick(get("motifCount"), SIGIL_FOLDS),
    arm: pick(get("motifIdx"), SIGIL_ARMS),
    core: pick(get("pearl"), SIGIL_CORES),
    enclosure: pick(get("border"), SIGIL_ENC),
    base: pick(get("sunDisc"), SIGIL_BASES),
    inter: pick(get("secondary"), SIGIL_INTER),
    axis: get("symmetry") > 0.5,
  };
}
/** sigilFromSeed(seed) — a faith's sacred sigil straight from a numeric seed,
 *  for use independent of a full emblem (each religion gets its own, evolvable
 *  by re-seeding a schism / recombining a syncretism). */
export function sigilFromSeed(seed) {
  const r = prng(seed >>> 0);
  return {
    fold: SIGIL_FOLDS[Math.floor(r() * SIGIL_FOLDS.length)],
    arm: SIGIL_ARMS[Math.floor(r() * SIGIL_ARMS.length)],
    core: SIGIL_CORES[Math.floor(r() * SIGIL_CORES.length)],
    enclosure: SIGIL_ENC[Math.floor(r() * SIGIL_ENC.length)],
    base: SIGIL_BASES[Math.floor(r() * SIGIL_BASES.length)],
    inter: SIGIL_INTER[Math.floor(r() * SIGIL_INTER.length)],
    axis: r() < 0.4,
  };
}

// ── BLAZON — the formal heraldic sentence for a phenotype ────────────────────
const NUMWORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const CHARGE_NAME = {
  mullet6: "mullet of six points", mullet8: "mullet of eight points", rowel: "pierced mullet",
  crossCouped: "cross couped", crossPattee: "cross pattée", crosslet: "cross crosslet",
  oakleaf: "oak leaf", stagbeetle: "stag beetle", mailedfist: "mailed fist",
  catherinewheel: "Catherine wheel", cartwheel: "cart wheel", cogwheel: "cog wheel",
  seadragon: "sea-dragon", sealion: "sea-lion", fleur: "fleur-de-lys",
};
const chargeName = id => CHARGE_NAME[id] || id;
const pluralize = name => {
  const parts = name.split(" ");
  let w = parts[0];
  if (w.includes("-")) w = w.replace(/^([^-]+)/, "$1s");            // fleur-de-lys → fleurs-de-lys
  else if (/(s|x|z|ch|sh)$/.test(w)) w += "es";
  else if (/[^aeiou]y$/.test(w)) w = w.slice(0, -1) + "ies";
  else w += "s";
  parts[0] = w;
  return parts.join(" ");
};
const tName = n => { const s = n === "tenne" ? "tenné" : n; return s[0].toUpperCase() + s.slice(1); };
const ORD_NAME = { bendSinister: "bend sinister" };
const ordName = o => ORD_NAME[o] || o;

// the field clause — partition (with its line-style), fur, and any semé
function fieldPhrase(f, m) {
  const [a, b] = f.names.map(tName);
  const ln = f.line !== "straight" ? ` ${f.line}` : "";
  let s;
  if (f.fur === "fretty") s = `${a} fretty ${tName(f.treatName)}`;
  else if (f.fur === "masoned") s = `${a} masoned`;
  else if (f.fur) s = tName(f.fur);
  else switch (f.partition) {
    case "perPale": s = `Per pale${ln} ${a} and ${b}`; break;
    case "perFess": s = `Per fess${ln} ${a} and ${b}`; break;
    case "perBend": s = `Per bend${ln} ${a} and ${b}`; break;
    case "perSaltire": s = `Per saltire ${a} and ${b}`; break;
    case "quarterly": s = `Quarterly ${a} and ${b}`; break;
    case "gyronny": s = `Gyronny of eight ${a} and ${b}`; break;
    case "chevron": s = `Per chevron ${a} and ${b}`; break;
    case "barry": s = `Barry${ln} of ${NUMWORD[f.stripes]} ${a} and ${b}`; break;
    case "paly": s = `Paly${ln} of ${NUMWORD[f.stripes]} ${a} and ${b}`; break;
    case "chequy": s = `Chequy ${a} and ${b}`; break;
    case "lozengy": s = `Lozengy ${a} and ${b}`; break;
    default: s = a;
  }
  if (m && m.arrange === "seme")
    s += ` semé of ${pluralize(chargeName(m.id))} ${m.counterchange ? "counterchanged" : tName(m.tinctureName)}`;
  return s;
}

/** blazonGenome(genome) → the formal blazon of the expressed design.
 *  Heraldic-grammar compositions (heraldic / central / radial / semé) get a
 *  true blazon; the other traditions (calligraphy, tamga, tilework, sigil)
 *  are not blazonable and get an honest plain-language line instead. */
export function blazonGenome(genome) {
  if (genome.quarters && genome.quarters.length > 1) {
    const qs = genome.quarters.map(q => blazonGenome({ genes: q.genes, gen: q.gen, seed: q.seed }));
    const ROMAN = ["I", "II", "III", "IV"];
    return `Quarterly: ${qs.map((q, i) => `${ROMAN[i]}. ${q}`).join("; ")}`;
  }
  const p = expressGenome(genome);
  const f = p.field, m = p.motif;
  if (!["heraldic", "central", "radial", "seme"].includes(p.composition)) {
    const what = p.composition === "script" ? "inscribed with devotional script"
      : p.composition === "brand" ? "charged with a clan tamga"
      : p.composition === "plain" ? "diapered with geometric tilework"
      : "bearing a sacred sigil";
    return `A ${p.substrate} ${tName(p.colors.fieldT.name).toLowerCase()}, ${what}`;
  }
  const parts = [fieldPhrase(f, m)];
  const mT = m ? (m.counterchange ? "counterchanged" : tName(m.tinctureName)) : "";
  const ATT = { inverted: " inverted", sinister: " contourné" };
  const mName = m ? chargeName(m.id) + (ATT[m.attitude] || "") : "";
  const hasOrd = f.ordinary && f.ordinary !== "none";
  const oLn = hasOrd && f.line !== "straight" ? ` ${f.line}` : "";
  const oT = hasOrd ? (f.counterchange ? "counterchanged" : tName(f.ordinaryName)) : "";
  const DIM_NAME = { fess: "bar", pale: "pallet", bend: "bendlet", bendSinister: "scarpe", chevron: "chevronel" };
  const nOrd = (hasOrd && f.ordinaryCount) || 1;
  const ordClause = nOrd > 1 ? `${NUMWORD[nOrd]} ${pluralize(DIM_NAME[f.ordinary])}${oLn} ${oT}`
    : hasOrd ? `a ${ordName(f.ordinary)}${oLn} ${oT}` : "";
  if (hasOrd && m && m.arrange === "between") {
    parts.push(`${ordClause} between ${m.count === 1 ? `a ${mName}` : `${NUMWORD[m.count]} ${pluralize(mName)}`} ${mT}`);
  } else if (hasOrd && m && m.arrange === "onOrdinary") {
    parts.push(`on a ${ordName(f.ordinary)}${oLn} ${oT} ${m.count === 1 ? `a ${mName}` : `${NUMWORD[m.count]} ${pluralize(mName)}`} ${mT}`);
  } else {
    if (hasOrd) parts.push(ordClause);
    if (m && m.arrange !== "seme") {
      if (m.arrange === "three") parts.push(`three ${pluralize(mName)} ${mT}`);
      else if (m.arrange === "inPale") parts.push(`two ${pluralize(mName)} in pale ${mT}`);
      else if (p.composition === "radial") parts.push(`a ${mName} ${mT} within an annulet`);
      else parts.push(`a ${mName} ${mT}`);
    }
  }
  if (f.chief) parts.push(`a chief${f.line !== "straight" ? ` ${f.line}` : ""} ${tName(f.ordinaryName)}`);
  if (f.bordure) parts.push(`a bordure ${tName(f.ordinaryName)}`);
  if (p.cadency) parts.push(`a ${chargeName(p.cadency.mark)} ${tName(p.cadency.tinctureName)} for difference`);
  return parts.join(", ") + (p.substrate !== "shield" ? ` — on a ${p.substrate}` : "");
}

// ── genome distance — cheap design-space metric ──────────────────────────────
/** genomeDistance(a, b) → 0 (identical) … ~1 (maximally different). The hue
 *  genes are circular (0 and 1 are the same hue); every other gene is a plain
 *  interval. One pass over the vector, no expression — cheap enough for
 *  dedup, fitness, and phylogeny. */
const CIRCULAR = new Set(["hueA", "hueB", "hueC"]);
export function genomeDistance(a, b) {
  let s = 0;
  for (let i = 0; i < GENES.length; i++) {
    const d = Math.abs(a.genes[i] - b.genes[i]);
    s += CIRCULAR.has(GENES[i]) ? Math.min(d, 1 - d) * 2 : d;
  }
  return s / GENES.length;
}

// A short human description of what a genome became.
export function describeGenome(genome) {
  const p = expressGenome(genome);
  const bits = [p.composition, p.substrate, p.colors.mode];
  if (genome.quarters && genome.quarters.length > 1) bits.unshift(`quarterly of ${genome.quarters.length}`);
  if (p.cadency) bits.push(`diff·${p.cadency.mark}`);
  if (p.composition === "heraldic") {
    const f = p.field;
    bits.push(f.fur ? f.fur : f.partition !== "plain" ? `${f.partition} ${f.names[0]}·${f.names[1]}` : f.names[0]);
    if (f.ordinary && f.ordinary !== "none") bits.push((f.counterchange ? "counterchanged " : "") + f.ordinary + " " + f.ordinaryName + (f.line !== "straight" ? " " + f.line : ""));
    if (f.chief) bits.push("chief");
    if (f.bordure) bits.push("bordure");
  }
  if (p.motif) {
    const m = p.motif, t = m.counterchange ? "counterchanged" : m.tinctureName;
    const head = m.arrange === "between" ? "between: " : m.arrange === "onOrdinary" ? "on it: " : m.behind ? "semé " : "";
    bits.push(head + m.id + (m.count > 1 ? `×${m.count}` : "") + " " + t);
  }
  else if (p.composition === "script") bits.push("calligraphy");
  else if (p.composition === "brand") bits.push("tamga");
  else if (p.composition === "plain") bits.push(p.geometry.mode === "lattice" ? "star-lattice" : "rosette");
  else if (p.composition === "sacred") bits.push(`sigil·${p.sigil.fold}·${p.sigil.arm}`);
  return bits.join(" · ");
}

export { SUBSTRATES, COMPOSITIONS, PALETTES, MOTIFS, MOTIF_CATS, INK, BONE, GOLD };
