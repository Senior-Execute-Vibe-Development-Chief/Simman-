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
// on FLAG cloth the composition gene decodes through corpus-weighted windows
// (the FLAG_PARTITIONS idiom): the vexillological grammar — stripes, crosses,
// cantons, arrays, a lone central device — is what a national flag almost
// always is, so it DOMINATES; the calligraphic, sacred-sigil, tamga and
// tilework traditions are the rare institutional banners they are on real
// flagpoles. Every composition stays REACHABLE on cloth (reachability is the
// decoupling constraint, not equal odds); radial is a roundel badge by
// nature and simply isn't flown as cloth.
const FLAG_COMPOSITIONS = [
  ...Array(20).fill("heraldic"), ...Array(5).fill("central"),
  "seme", "script", "sacred", "brand", "plain",
];
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
// on FLAG cloth the palette gene is corpus-weighted too (the FLAG_PARTITIONS
// idiom): a modern flag is DYED BUNTING — the "heraldic" bright-bolt palette —
// so it dominates. Imperial silk and earth pigment are old banner and cloth
// traditions (they even remap the hue away from the bunting bolts), and pure
// ink monochrome is the engraver's; all stay reachable on cloth but become
// the rarities they are. This is what lets the dyer's-wheel hue (and the blue
// rescue) actually reach most flags instead of being overridden by a silk.
const FLAG_PALETTES = [
  ...Array(16).fill("heraldic"), "monochrome", "monochrome", "imperial", "earth",
];
const PARTITIONS  = ["plain", "perPale", "perFess", "perBend", "quarterly", "gyronny", "perSaltire", "chevron", "barry", "paly", "chequy", "lozengy", "tiercedPale", "tiercedFess"];
// on CLOTH the SAME gene decodes through corpus-weighted windows instead
// (the DYE_VATS / MOTIF_CATS idiom): horizontal stripes dominate real
// flags, vertical bands next, diagonals and the hoist wedge present, the
// rotational cuts genuine rarities — and the engraver-only partitions
// (gyronny, grids) don't exist here at all, only their sewn kin.
const FLAG_PARTITIONS = [
  "plain", "plain", "plain",
  "perFess", "perFess", "perFess", "tiercedFess", "tiercedFess", "tiercedFess", "tiercedFess", "tiercedFess",
  "barry", "barry", "barry",
  "perPale", "perPale", "tiercedPale", "tiercedPale", "tiercedPale", "paly",
  "perBend", "perBend", "hoistTriangle", "hoistTriangle",
  "quarterly", "perSaltire",
];
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
// the COMPACT categories — stars, discs, crescents — are the only devices
// flag cloth repeats or strews; everything else is a FIGURE there
const COMPACT_CATS = new Set(["celestial", "geometric"]);
// THE CONSTELLATION GRAMMAR — how flag cloth ORGANIZES a repeated compact
// device. Real flags never wallpaper their repeats: the count enumerates
// something (states, islands, provinces) and the devices are arranged — a
// ring (the federal circle), an arc over the middle, offset rows (the
// star-field), or a seeded constellation (a literal little sky map).
// Weighted like every other frequency window: rows and rings common, the
// arc and the sky map rarer.
const ARRAY_PATTERNS = ["rows", "rows", "ring", "ring", "arc", "constellation", "satellites"];
// what bounds a lone device on cloth: the disc dominates real flags, the
// small armorial shield (the INESCUTCHEON — a state-arms panel) is the
// serious rarity, the lozenge the odd one out
const PANEL_SHAPES = ["lozenge", "disc", "disc", "escutcheon"];
// THE FLAG DEVICE VOCABULARY: a repeated, housed, or band-riding device is
// cut from folded cloth many times over — only the simple silhouettes
// survive mass sewing and distance (stars, discs, crescents, suns). The
// ornate interlace — knots, frets, clan marks — stays a shield's and a
// mon's business; a LONE central device keeps the full pool (a flag may
// fly one strange thing, never five).
const FLAG_SIMPLE = {
  geometric: ["mullet", "mullet", "mullet", "mullet6", "mullet8", "roundel", "annulet", "lozenge", "triangle"],
  celestial: ["sun", "moon", "estoile", "moonIncrescent", "moonDecrescent", "moonCrescent", "sunRays", "sunOutline", "starAndCrescent", "starAndCrescent"],
};
// motif ids resolve to charge art in the renderer (DrawShield / game-icons).
// @INJECT:MOTIFS-START — the lab build (tools/build_lab.mjs) replaces this whole
// block with the size-filtered subset so the artifact's pools match its bundled art.
const MOTIFS = {
  beast: ["lion", "wolf", "boar", "bull", "bear", "horse", "ram", "stag", "elephant", "rabbit", "antelope", "camel", "tiger", "leopard", "fox", "greyhound", "hedgehog", "badger", "otter", "squirrel", "ass", "cow", "lizardStatant", "kangarooSalient", "rhinoceros", "llama", "reindeerSalient", "hippo", "jerboa", "reindeer", "elephantHead", "rat", "squirrelRampant", "ferret", "weasel", "weaselRampant", "wolfHeadAffronty", "cat", "cockHead", "sheep", "cowHead", "horseSalient", "pig", "lionHeadReguardant", "lionHeadGuardant", "lionLegCouped", "lionLegErased", "lionCouchant", "lionHeadErased", "lionHead", "lionDormant", "lionSejant", "greyhoundSalient", "greyhoundCourant", "dog", "dogHead", "dogCouchantGuardant", "polarBear", "bearSejant", "bearStatantErect"],
  insect: ["bee", "butterfly", "spider", "ant", "grasshopper", "dragonfly", "stagbeetle", "snail", "moth", "hornet", "beetle", "fly", "wasp", "cricket", "cicada"],
  bird: ["eagle", "falcon", "dove", "raven", "rooster", "crane", "swan", "owl", "peacock", "pelican", "martlet", "crowReguardant", "blackbird", "magpieVolantEnArriere", "storkVolant", "seagullVolant", "shoveller", "starling", "crowHead", "doveFondant", "wing", "ravenHead", "feather", "eagleClaw", "germanEagle", "eagleNatural", "alerionDisplayedTowardsBase", "alerionDisplayed", "alerion", "eagleKleestengel", "eagleLeg", "duck", "falconReguardant", "falconJessed", "falconVolant"],
  mythic: ["dragon", "wyvern", "griffin", "unicorn", "pegasus", "hydra", "phoenix", "cockatrice", "basilisk", "sphinx", "salamander", "seadragon", "sealion", "harpy", "centaur", "chimera", "manticore", "ouroboros", "fishtailGriffin", "griffinHead", "bagwyn", "unicornHeadErased", "amphiptere", "chatloup", "mermaidInHerModesty", "chatloupWingedSejant", "dragonHead", "tribalDragon", "dragonHeadCouped", "dragonHeadCaboshed"],
  sea: ["dolphin", "serpent", "mermaid", "fish", "pike", "salmon", "whale", "lobster", "shark", "escallop", "octopus", "narwhal", "shrimp", "whelk", "seaTurtle", "zydrach", "polypus", "dolphinWinged", "manatee", "carpEmbowed", "roachNaissant", "roach", "catfishEmbowed", "luceEmbowed", "luce", "snakeGlissant", "snake", "serpentNowed", "serpentErect", "serpentErectTailNowed", "seaSerpent"],
  plant: ["rose", "tree", "lotus", "thistle", "garb", "oak", "oakleaf", "olive", "palm", "lily", "cinquefoil", "quatrefoil", "trefoil", "sunflower", "iris", "poppy", "shamrock", "acorn", "vine", "grapes", "pineapple", "fleur", "crocus", "sexfoil", "tulip", "octofoil", "violet", "geranium", "tulipBundle3", "periwinkleFlower", "forgetMeNot", "pear", "lemon", "mapleLeaf", "lindenLeaf", "mapleLeafConjoined3", "pineNewEnglandTree", "apple", "lemonSlippedLeaved", "yewTree", "limeLeaf", "seeblatt", "cloverLeaf", "clover", "reedBundle3", "vineLeaf", "cactus", "pepper", "aubergine", "onion", "pumpkin"],
  object: ["crown", "key", "sword", "anchor", "ship", "scales", "harp", "lyre", "book", "bell", "bugle", "clarion", "lute", "drum", "chalice", "amphora", "anvil", "hammer", "millrind", "millstone", "scythe", "sickle", "plough", "pitchfork", "compass", "lantern", "lamp", "scroll", "mirror", "shears", "quill", "distaff", "axe", "halberd", "arrow", "arrows", "pheon", "trident", "spear", "bow", "crossbow", "flail", "club", "cannon", "mace", "warhammer", "catherinewheel", "cartwheel", "cogwheel", "helmet", "gauntlet", "breastplate", "mailedfist", "horseshoe", "spur", "stirrup", "saddle", "wagon", "beehive", "beacon", "brazier", "torch", "grenade", "chest", "wolfiron", "staple", "musicalNote", "noteQuarter", "noteEighth", "fireSteel", "comb", "bookModernClosed", "candlestick", "vallary", "saxon", "palisado", "antique", "earl", "duke", "helmetKnight", "helmetEsquire", "helmetNorman", "helmetPeer", "helmetKnightAffronty", "archeryTarget", "lance", "dagger", "rapier", "swordstpaul", "sabre", "seax", "slaughterAxe", "pickAxe", "addice", "waterBouget", "mug", "barrel", "scoop", "funnel", "table", "flag", "frenchGemstoneInProfile", "arrowBroad", "spearHeadImbrued", "oar", "rudderPole", "oarInsaltire2", "fishingBoat", "crowsNest", "barge", "lymphadFurled", "lymphadSailsSet", "buckle", "maunche", "stirrupLeathered", "hawkbell", "farmingFlail", "fishhook", "farmingFlailInsaltire2", "shepherdsCrook", "butterChurn", "ploughshare", "chessPawn", "chessRook", "chessKing"],
  architecture: ["tower", "castle", "bridge", "gate", "arch", "house", "city", "keystoneCouped", "pyramid", "obelisk", "fountainNatural", "pillar", "bridgeThreeArches", "keystone", "lighthouse"],
  natural: ["cloud", "teardrop", "flint", "flames", "fireball"],
  celestial: ["sun", "moon", "estoile", "moonIncrescent", "moonPendant", "estoileInflamed", "moonDecrescent", "moonCrescent", "sunOutline", "sunRays", "starAndCrescent"],
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
// THE BUNTING SHELF: mass-sewn flag cloth comes off standard bolts — the
// six fast, cheap colours (or, argent, gules, azure, vert, sable). The
// overdyed STAINS (tawny, murrey, sanguine) are engraver's and livery
// colours, and PURPURE is the princely dye — Tyrian purple was the rarest,
// costliest dyestuff in history, never mass-produced as bunting (which is
// why real modern flags almost never fly purple). All four stay on shields
// and silks; on cloth such an intent comes back as its vat's fast recipe,
// or failing that as the mill's nearest standard bolt.
const BOLTS = T_NAMES.filter(n => TINCTURES[n].kind !== "stain" && n !== "purpure");
const BUNTING = new Set(BOLTS);   // what the mill actually sews
// THE BUNTING RECIPES: the same named bolts, the mill's own dye lots.
// A painter's tincture is aged pigment on vellum; industrial fast dyes run
// VIVID — real flags fly the saturated end of each name (the "Olympic"
// gamut). Names, classes and every derivation stay in the painter's space
// (the blazon never changes); only the woven cloth's rgb does. Classes and
// pairwise legibility re-verified: the recipes' metal-dark floor (0.397)
// exceeds the paint's own (0.152).
const BUNTING_RGB = {
  or:      [0xfc, 0xd1, 0x16],
  argent:  [0xf2, 0xf2, 0xed],
  gules:   [0xce, 0x11, 0x26],
  azure:   [0x00, 0x55, 0xa4],
  vert:    [0x00, 0x7a, 0x3d],
  sable:   [0x14, 0x14, 0x14],
  purpure: [0x63, 0x30, 0x92],
};
const BUNTING_BY_REF = new Map(BOLTS.map(n => [TINCTURES[n].rgb, BUNTING_RGB[n]]));
// swap every canonical bolt rgb in an assembled flag phenotype for its
// bunting recipe (identity lookup — on cloth every colour IS a named bolt)
function clothDye(o, seenSet) {
  const seen = seenSet || new Set();
  if (!o || typeof o !== "object" || seen.has(o)) return o;
  seen.add(o);
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (Array.isArray(v) && BUNTING_BY_REF.has(v)) o[k] = BUNTING_BY_REF.get(v);
    else if (v && typeof v === "object") clothDye(v, seen);
  }
  return o;
}

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
// what SEPARATES sewn pieces is never a design statement: it is undyed
// cloth showing between them, or soot when the pieces run pale — whichever
// stands farther from everything it touches (a two-member constructive
// pick, like the two-pole modes')
const sepPick = touch => {
  const a = T("argent"), s = T("sable");
  const dmin = c => Math.min(...touch.map(g => dE(c.rgb, g.rgb)));
  return dmin(a) >= dmin(s) ? a : s;
};
// ── the DYER'S WHEEL: a colour intent is a dye-vat, not a spectrometer.
// Hue availability follows the great dyestuffs — madder and kermes reds, weld
// and saffron golds, woad and indigo blues, copper and sap greens — while true
// purples and hot magentas were princely rarities. A uniform gene walks this
// wheel; vat WIDTHS are the availability model, exactly the way the MOTIF_CATS
// windows model armorial frequency. Each vat's end is the next vat's start, so
// the map is continuous and monotonic (mod 1) and a small mutation still
// drifts hue smoothly.
//
// Naming dyed cloth is a VAT question first: hue names the family, and only
// then do depth and purity pick the member. A plain 3D nearest-colour fails
// here — a vivid green intent matches muted tinctures on LIGHTNESS and comes
// out "tenné" — so each vat lists the names it can be CALLED, and OKLab
// nearness only ranks within that family (argent and sable join a field's
// candidates: undyed cloth and the soot vat are always on the shelf).
// lightLo..lightHi is the depth the dyestuff can actually reach — weld is a
// light dye, woad a deep one; the value gene picks the depth WITHIN the vat,
// it cannot ask weld for black.
const DYE_VATS = [ // [share, hue0, hue1, callable names, lightLo, lightHi]
  [24, 0.960, 1.010, ["gules", "sanguine"], 0.22, 0.62],  // madder / kermes
  [ 3, 0.010, 0.055, ["gules", "tenne"], 0.30, 0.65],     // scarlet-orange
  [ 4, 0.055, 0.100, ["tenne"], 0.30, 0.60],              // tawny
  [17, 0.100, 0.150, ["or", "tenne"], 0.42, 0.78],        // weld / saffron
  [ 4, 0.150, 0.260, ["or", "vert"], 0.35, 0.70],         // yellow-greens
  [14, 0.260, 0.400, ["vert"], 0.25, 0.60],               // copper / sap green
  [ 4, 0.400, 0.560, ["vert", "azure"], 0.25, 0.60],      // teals
  [22, 0.560, 0.680, ["azure"], 0.22, 0.58],              // woad / indigo
  [ 4, 0.680, 0.820, ["purpure"], 0.25, 0.58],            // purple (princely)
  [ 4, 0.820, 0.960, ["murrey", "purpure"], 0.22, 0.55],  // mulberry
];
const DYE_TOTAL = DYE_VATS.reduce((s, w) => s + w[0], 0);
function vatAt(u) {
  let t = (u - Math.floor(u)) * DYE_TOTAL;
  for (const [w, h0, h1, members, lo, hi] of DYE_VATS) {
    if (t <= w) return { hue: (h0 + (t / w) * (h1 - h0)) % 1, members, lo, hi };
    t -= w;
  }
  const [, h0, , members, lo, hi] = DYE_VATS[0];
  return { hue: h0 % 1, members, lo, hi };
}
const dyeHue = u => vatAt(u).hue;
// a FIELD from the wheel: the vat's family plus the two ever-present
// achromatics (a pale dull intent comes out argent, a deep dull one sable).
// On BUNTING the vat offers only its fast members; a pure-stain vat sends
// the order to the mill's nearest standard bolt.
function namedDyeField(u, sat, val, bunting) {
  const v = vatAt(u);
  const rgb = hsl(v.hue, sat, v.lo + val * (v.hi - v.lo));
  let members = v.members;
  if (bunting) {
    // a vat LED by a non-bunting dye (a stain, or princely purpure) is not
    // milled as bunting at all: the order comes back as the nearest bolt
    if (!BUNTING.has(members[0])) return nearestTincture(rgb, BOLTS);
    members = members.filter(n => BUNTING.has(n));
    if (!members.length) return nearestTincture(rgb, BOLTS);
  }
  const name = nearestTincture(rgb, [...members, "argent", "sable"]);
  if (!bunting) return name;
  // BLUE and GREEN don't collapse to grey. A saturated colour order is
  // DYED, not left near-neutral: a real-chroma intent whose vat carries a
  // colour keeps that colour instead of falling through to undyed cloth or
  // soot on lightness alone (the mill stocks the flag-blue and flag-green
  // bolts, not a dusty near-neutral). Only a genuinely DULL order — below
  // the dullest dyed bolt — ships undyed or soot.
  if (name === "argent" || name === "sable") {
    const colours = members.filter(n => TINCTURES[n].kind === "colour");
    const ab = oklab(rgb);
    if (colours.length && Math.hypot(ab[1], ab[2]) >= DYE_CHROMA_MIN)
      return nearestTincture(rgb, colours);
  }
  return name;
}
// a DARK mark from the wheel (the rule-of-tincture pick on a metal ground):
// the vat's non-metal members plus the soot vat, at the vat's own saturation
function namedDyeDark(u, val, exclude, bunting) {
  const v = vatAt(u);
  let members = v.members;
  if (bunting) members = !BUNTING.has(members[0]) ? []
    : members.filter(n => BUNTING.has(n));
  // the painter keeps soot beside every vat; the MILL dyes the intended
  // colour when it has one — soot is the fallback, not a rival
  let cands = [...members.filter(n => TINCTURES[n].kind !== "metal"), ...(bunting ? [] : ["sable"])];
  if (exclude) cands = cands.filter(n => n !== exclude);
  if (!cands.length) cands = (bunting ? BOLTS : DARKS).filter(n => TINCTURES[n].kind !== "metal" && n !== exclude);
  return nearestTincture(hsl(v.hue, 0.75, v.lo + val * (v.hi - v.lo)), cands);
}
// the light/dark boundary the palette itself implies (midway, in OKLab
// lightness, between the darkest metal and the lightest non-metal) — used to
// type the CONTINUOUS colours of the non-heraldic palette modes
const CLASS_L = (Math.min(...METALS.map(n => T_LAB[n][0])) + Math.max(...DARKS.map(n => T_LAB[n][0]))) / 2;
// the hue of an rgb, 0..1 (HSL hue), and the dyer's-wheel family that hue
// falls in — so a CONTINUOUS colour (imperial silk, earth pigment, or a
// bunting snap) is named by its HUE first, never by 3D nearest. A vivid
// green matches muted tinctures on LIGHTNESS under plain nearest and comes
// out "or"; committing to the hue family first (exactly the dyer's-wheel
// principle) names it "vert". Near-neutrals still fall to metal/soot.
function rgbHue([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-6) return 0;
  let h = mx === r ? (g - b) / d : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}
function hueFamily(h) {
  for (const [, h0, h1, members] of DYE_VATS) {
    const a = ((h0 % 1) + 1) % 1, b = ((h1 % 1) + 1) % 1;
    if (a <= b ? (h >= a && h < b) : (h >= a || h < b)) return members;
  }
  return DYE_VATS[0][3];
}
const T_HUE = {}; for (const n of T_NAMES) T_HUE[n] = rgbHue(TINCTURES[n].rgb);
function nameByHue(rgb, candidates) {
  const ab = oklab(rgb);
  if (Math.hypot(ab[1], ab[2]) < DYE_CHROMA_MIN * 0.7) return nearestTincture(rgb, candidates);
  const fam = hueFamily(rgbHue(rgb)).filter(n => candidates.includes(n));
  if (!fam.length) return nearestTincture(rgb, candidates);
  // within the family, pick by HUE distance — not 3D nearest, which leans to
  // the brighter metal (a chartreuse names "or" over "vert" on lightness even
  // though it reads green; by hue it's nearer vert)
  const h = rgbHue(rgb);
  let best = fam[0], bd = Infinity;
  for (const n of fam) { let d = Math.abs(h - T_HUE[n]); d = Math.min(d, 1 - d); if (d < bd) { bd = d; best = n; } }
  return best;
}
const P = rgb => ({ name: nameByHue(rgb, T_NAMES), kind: oklab(rgb)[0] > CLASS_L ? "metal" : "colour", rgb });
const classOf = t => (t.kind === "metal" ? "metal" : "dark");
// what strict class opposition itself GUARANTEES: the smallest OKLab distance
// between any metal and any dark. A reused bolt that clears this bar reads at
// least as well as the rule of tincture ever promises.
const OPPOSITION_FLOOR = Math.min(...METALS.flatMap(m => DARKS.map(d => dE(TINCTURES[m].rgb, TINCTURES[d].rgb))));
// a flag is sewn from named bolts. Dye LOTS are saturated by nature: a
// PALE order duller than the dullest dyed bolt isn't a dye at all — it
// ships as UNDYED cloth (why dusty pigment traditions fly white, not
// mustard); every other order takes the nearest standard lot, soot
// included by plain nearness.
const DYE_CHROMA_MIN = Math.min(...["or", "gules", "azure", "vert", "purpure"]
  .map(n => Math.hypot(T_LAB[n][1], T_LAB[n][2])));
const toBolt = t => {
  const lab = oklab(t.rgb);
  if (Math.hypot(lab[1], lab[2]) < DYE_CHROMA_MIN && lab[0] > CLASS_L) return T("argent");
  return T(nameByHue(t.rgb, BOLTS));   // by hue, so a green silk snaps to vert, not or
};

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
// `opts.bunting` restricts every named pick to the bunting bolts (flags);
// `opts.flying` is the SEWING ECONOMY: tinctures already on the table, in
// seniority order — a mark reuses one whenever it reads on its ground (the
// class opposition on a uniform ground; at least the OPPOSITION_FLOOR on a
// mixed one) instead of cutting a fresh bolt. Real flags run 2–4 colours
// not because anyone counts, but because a new colour is a new bolt.
function tinctureOn(grounds, hue, val, poles = [], opts = {}) {
  const genuine = grounds.every(g => TINCTURES[g.name] && TINCTURES[g.name].rgb === g.rgb);
  const uniform = genuine && new Set(grounds.map(classOf)).size === 1;
  if (opts.flying) {
    for (const c of opts.flying) {
      const d = Math.min(...grounds.map(g => dE(c.rgb, g.rgb)));
      if (uniform ? classOf(c) !== classOf(grounds[0]) : d >= OPPOSITION_FLOOR) return { name: c.name, kind: c.kind, rgb: c.rgb };
    }
  }
  if (uniform) {
    // on a metal ground the mark is DYED cloth — named by its vat; on a dark
    // ground it is METAL thread — gilt when the intent runs warm, silver when
    // pale or cool. On BUNTING there is no thread: the light mark is either
    // UNDYED cloth (argent — the mill's default, and the reason white
    // dominates real flags) or a yellow dye lot, so the pick follows the
    // intent's own saturation instead of a painter's fixed gilt.
    const msat = opts.bunting && opts.chroma != null ? 0.25 + opts.chroma * 0.65 : 0.3;
    return classOf(grounds[0]) === "metal"
      ? T(namedDyeDark(hue, val, null, opts.bunting))
      : T(nearestTincture(hsl(dyeHue(hue), msat, 0.62 + val * 0.3), METALS));
  }
  let best = null, bd = -1;
  for (const c of [...poles, ...(opts.bunting ? BOLTS : T_NAMES).map(T)]) {
    const d = Math.min(...grounds.map(g => dE(c.rgb, g.rgb)));
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}

function decodePalette(get, bunting, solidGround) {
  const mode = pickEnum(get("paletteMode"), bunting ? FLAG_PALETTES : PALETTES);
  const hA = get("hueA"), hB = get("hueB"), chroma = get("chroma"), val = get("value");
  // GOLD grounds a flag only rarely, and only when it stands ALONE. On cloth
  // the metal that grounds a whole flag is undyed (argent, the default bolt);
  // gold is a device-and-stripe metal — the rule of tincture's charge-metal —
  // and a solid gold ground reads weak at distance. So a SOLID gold field
  // from any but the most saturated intent grounds as undyed cloth instead;
  // gold as a STRIPE, charge or canton (a partitioned field) is untouched,
  // because a gold band is common (Germany, Colombia, Lithuania).
  const groundGold = t => (bunting && solidGround && t.name === "or" && chroma < 0.877 ? T("argent") : t);
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
    const hF = T(namedDyeField(hA, 0.25 + chroma * 0.65, val));
    const hC = tinctureOn([hF], hB, val);
    hatch = { field: hF.name, charge: hC.name,
      companion: classOf(hF) === "dark" && get("secondary") > 0.5
        ? namedDyeDark(hB, val, hF.name)
        : hC.name };
  } else if (mode === "imperial") {
    // imperial silk: vivid, but rich rather than highlighter (the top of the
    // saturation range pulled back from neon)
    fieldT = P(hsl(hA, 0.46 + chroma * 0.28, 0.42 + val * 0.12));
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
    // heraldic: the genome's colour INTENT walks the dyer's wheel and is named
    // by its vat — a bright weld intent lands or, a pale dull one argent, a
    // deep dull one sable, so METAL FIELDS emerge exactly where the genes
    // imply them; stains only ever claim their own narrow vats
    fieldT = groundGold(T(namedDyeField(hA, 0.25 + chroma * 0.65, val, bunting)));
    chargeT = tinctureOn([fieldT], hB, val, [], { bunting, chroma });
    // the partition companion: a second dark beside a dark field when the
    // secondary gene asks for one (colour-and-colour parties are lawful), else
    // the opposite class — the classic party of colour and metal
    // colour-and-colour parties are lawful but read poorly at distance —
    // on cloth they need a stronger intent (the same legibility economics
    // that empties flags of beasts); shields keep the painter's window
    companionT = classOf(fieldT) === "dark" && get("secondary") > (bunting ? 0.75 : 0.5)
      ? T(namedDyeDark(hB, val, fieldT.name, bunting))
      : chargeT;
    accentT = chargeT;
  }
  // a FLAG is sewn from the bunting shelf whatever the tradition: the silk's
  // and the pigment's continuous FIELD comes back as its nearest standard
  // bolt — and because the mill only sews named bolts, the marks are then
  // re-derived AGAINST that bolt by the same constructive rules the
  // heraldic mode uses (a raw-space pick snapped after the fact can land on
  // its own ground; a bolt-space derivation cannot)
  if (bunting && (mode === "imperial" || mode === "earth")) {
    fieldT = groundGold(toBolt(fieldT));   // gold grounds rarely, every tradition
    chargeT = tinctureOn([fieldT], hB, val, [], { bunting, chroma });
    companionT = classOf(fieldT) === "dark" && get("secondary") > 0.75
      ? T(namedDyeDark(hB, val, fieldT.name, true))
      : chargeT;
    accentT = chargeT;
    poles = poles.map(toBolt);
  } else if (bunting) {
    // heraldic and monochrome already live in bolt space; the achromatics
    // (ink, bone) just take their named bolts
    fieldT = toBolt(fieldT); companionT = toBolt(companionT);
    chargeT = toBolt(chargeT); accentT = toBolt(accentT);
    poles = poles.map(toBolt);
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

  // the substrate gene names the ground first; a FLAG then reads its
  // composition through the corpus-weighted window (the vexillological
  // grammar dominates cloth), a shield or roundel through the general one
  let substrate = pickEnum(get("substrate"), SUBSTRATES);
  const baseIsFlag = FLAG_SUBSTRATES.has(substrate);
  let composition = pickEnum(get("composition"), baseIsFlag ? FLAG_COMPOSITIONS : COMPOSITIONS);
  const aniconic = iconism < 0.34;
  // A strongly figurative culture won't fly pure calligraphy / tamga.
  if (iconism > 0.72 && (composition === "script" || composition === "brand")) composition = "heraldic";
  if (composition === "radial") substrate = "roundel";                 // a badge wants a round field
  if (composition === "script" && substrate === "roundel") substrate = "banner";
  // a shield's outline — the brandSeed gene is idle on shields, so it picks
  const shieldShape = substrate === "shield" ? pickEnum(get("brandSeed"), SHIELD_SHAPES) : "heater";
  const isFlag = FLAG_SUBSTRATES.has(substrate);
  // THE CLOTH CUT: a banner's ratio comes from the substrate gene's position
  // WITHIN its own window — the same gene that picked the cloth picks the
  // cut, and it drifts smoothly under mutation. The span covers the real
  // spread of rectangular flags, 1:2 (long) … 2:3 (stocky); the traditional
  // tailed substrates keep their fixed cuts.
  const sWin = get("substrate") * SUBSTRATES.length;
  const flagRatio = substrate === "banner" ? 0.5 + (sWin - Math.floor(sWin)) * 0.167
    : substrate === "pennon" ? 0.6 : 0.62;

  // the field's partition is settled first — the palette needs to know whether
  // the field will be a SOLID ground (a whole flag one colour) or a striped
  // one, because gold grounds a whole flag only rarely but stripes freely
  let partition = composition === "heraldic"
    ? pickEnum(get("partition"), isFlag ? FLAG_PARTITIONS : PARTITIONS)
    : "plain";
  const solidGround = partition === "plain";
  const pal = decodePalette(get, isFlag, solidGround);
  const symmetry = composition === "radial" ? "radial" : pickEnum(get("symmetry"), SYMMETRIES);

  // field — a heraldic field can be divided (partition), draped in a FUR, laid with
  // an ORDINARY, and topped by a CHIEF / bounded by a BORDURE, all with a line-style
  // on their edges, and optionally COUNTERCHANGED across a partition. These reuse the
  // otherwise-idle genes in heraldic composition (hueC, pearl, border, crescent,
  // symmetry) so no genome grows — the depth was latent in the vector.
  const tinctures = [pal.field, pal.companion];
  const field = { partition, tinctures, names: [pal.fieldT.name, pal.companionT.name],
    // stripe COUNT is low-biased with a long tail: most striped fields run
    // 2–5 (bicolour/tricolour bars), a minority reach the many-barred flags
    // (the US thirteen, Greece's nine) — a gentle power curve, not a uniform
    line: pickEnum(get("line"), LINES), stripes: 2 + Math.floor(get("stripes") ** 1.7 * 11) };
  // the typed GROUND any mark over this field lies on
  let grounds = partition === "plain" ? [pal.fieldT] : [pal.fieldT, pal.companionT];
  const TWO_REGION = ["perPale", "perFess", "perBend"];
  // a TIERCED field bears three bands: the middle wears the class-opposed
  // chargeT (the bright centre of a tricolour), and the far band is the second
  // companion when one exists (A-B-C, the French pattern) or the field again
  // (A-B-A, the Austrian) — the secondary gene already decides which
  if (partition === "tiercedPale" || partition === "tiercedFess") {
    const t3 = pal.companionT.name !== pal.chargeT.name ? pal.companionT : pal.fieldT;
    field.tinctures = [pal.field, pal.chargeT.rgb, t3.rgb];
    field.names = [pal.fieldT.name, pal.chargeT.name, t3.name];
    grounds = [pal.fieldT, pal.chargeT, t3];
    // the SPANISH-FESS system: the thickness gene — the same one that splits
    // an ordinary into diminutives, same windows — may double one band:
    // the middle (1:2:1) or, at the gene's top, the first (2:1:1)
    if (get("stripes") > 0.62) field.tiercedWide = get("stripes") > 0.86 ? 0 : 1;
  }
  // a field TREATMENT drapes the WHOLE field (so no partition/counterchange
  // under it). A fur IS the ground — ermine reads as argent strewn with
  // sable, vair as argent-and-azure — so marks pick against those; the
  // lattice treatments (fretty, masoned) are thin lines over the field
  // colour, so the field stays the ground.
  if (composition === "heraldic" && get("crescent") > 0.74) {
    const fur = pickEnum((get("crescent") - 0.74) / 0.26, TREATMENTS);
    // FURS are the engraver's and the herald's, never the mill's: a field
    // strewn with ermine spots or vair bells reads as scattered noise at
    // flag distance, and no modern flag is furred. All four treatments stay
    // on shields and silks; cloth simply doesn't express them.
    if (!isFlag) {
      field.fur = fur;
      field.partition = partition = "plain";
      delete field.tiercedWide;                  // the fur drapes the WHOLE field
      if (field.fur === "ermine") grounds = [T("argent")];
      else if (field.fur === "vair") grounds = [T("argent"), T("azure")];
      else grounds = [pal.fieldT];                 // fretty / masoned: thin lines over the field colour
      field.names = grounds.length === 2 ? [grounds[0].name, grounds[1].name] : [grounds[0].name, grounds[0].name];
    }
  }
  // sewn edges run straight; the one fancy line flags DO fly is the serrated
  // hoist seam (an indented per-pale line keeps its teeth, Bahrain-fashion).
  // Sits after the fur override so a fur's plain field can't smuggle one in.
  if (isFlag && !(field.line === "indented" && field.partition === "perPale")) field.line = "straight";
  // the tincture any mark lying on this field wears — chargeT was constructed
  // against the plain field; every other ground (a party, a fur) re-derives
  const markT = grounds.length === 1 && grounds[0] === pal.fieldT ? pal.chargeT
    : tinctureOn(grounds, get("hueB"), get("value"), pal.poles, { bunting: isFlag, chroma: get("chroma") });
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
    // FIMBRIATION on flags: the thin separating outline (a Nordic cross's
    // white edge) — its tincture picked to read against EVERYTHING it
    // separates, band and field bands alike
    // FIMBRIATION exists to do a JOB: separating same-class neighbours (a
    // colour band on a colour ground — its rule-of-tincture function). A
    // metal band on a dark field needs none and real flags fly none; and
    // the separator itself is undyed cloth or soot, never a statement.
    if (isFlag && field.ordinary !== "none" && !field.counterchange && get("motifCount") > 0.6
      && grounds.some(g => classOf(g) === classOf(markT))) {
      // the separator is judged on its JOB: the band and the grounds of the
      // band's own class (it may run invisibly across the others — the
      // white fimbriation crossing a white region is the real construction)
      const fb = sepPick([markT, ...grounds.filter(g => classOf(g) === classOf(markT))]);
      field.fimbriation = fb.rgb; field.fimbName = fb.name;
      // a fimbriated COUCHED PALL encloses its hoist MOUTH: the wedge the
      // arms embrace takes its own statement colour, picked to stand off
      // from band and field alike (the full unity-Y construction)
      if (field.ordinary === "pall") {
        const mt = tinctureOn([markT, ...grounds], get("hueA"), get("value"), pal.poles, { bunting: true, chroma: get("chroma") });
        field.pallMouth = mt.rgb; field.pallMouthName = mt.name;
      }
    }
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
    // A LIVING FIGURE flies only from a strongly FIGURAL tradition — the same
    // iconism boundary that already forces a heraldic composition (0.72).
    // Weaker figuration keeps its beasts on shields and silks but sews a
    // non-living device on cloth: the distance-legibility economics that
    // emptied real flags of beasts (~5% of flags carry one, vs ~45% of arms).
    if (isFlag && iconism <= 0.72 && LIVING_CATS.has(cat)) {
      cat = NONLIVING_CATS[Math.floor(get("motifCount") * NONLIVING_CATS.length) % NONLIVING_CATS.length];
    }
    // WEATHER AND ROCK don't fly: the natural category (flint, fireball,
    // cloud, flames, teardrop) reads as an unclear blob at flag distance,
    // not an emblem — so on cloth it remaps to a clean celestial or
    // geometric device (the same remap idiom as aniconism and the figure
    // window). It stays a legitimate charge on shields and silks.
    if (isFlag && cat === "natural") cat = get("motifCount") > 0.5 ? "celestial" : "geometric";
    // a strewing on a FLAG remaps its category to a compact pick (the
    // star-spangled rule), exactly the way aniconism remaps a living one
    const strewn = composition === "seme"
      || (composition === "heraldic" && pickEnum(get("arrange"), ARRANGES) === "seme");
    if (isFlag && strewn && !COMPACT_CATS.has(cat))
      cat = get("motifCount") > 0.5 ? "celestial" : "geometric";
    const compact = COMPACT_CATS.has(cat);
    const pool = MOTIFS[cat];
    let id = pool[Math.min(pool.length - 1, Math.floor(get("motifIdx") * pool.length))];
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
      // sewn cloth never wallpapers UNDER a band: on a flag the semé company
      // doesn't express — the bare band IS the design (the commonest real case)
      if (isFlag && slot === "seme") slot = "none";
      // THE BARE ORDINARY IS THE FLAG: a cross, saltire, pile or Y almost
      // always flies alone (Scandinavia, Greece, Cuba, South Africa carry no
      // charge on the band) — so on cloth an ordinary sheds its company
      // unless the arrange gene genuinely calls for it
      if (isFlag && get("arrange") < 0.6) slot = "none";
      // no single band to sit ON: a chevron, a counterchanged ordinary, or a
      // diminutive group keep their company BETWEEN instead
      if (slot === "on" && (field.ordinary === "chevron" || field.counterchange || field.ordinaryCount > 1)) slot = "between";
      if (slot === "between" || slot === "on") {
        let spec = ORD_SLOTS[field.ordinary];
        // on a FLAG the cross sits Nordic (crossing toward the hoist) and the
        // pile points from the hoist — the company follows the band
        if (isFlag && field.ordinary === "cross") spec = { between: [[0.13, 0.24], [0.63, 0.25], [0.13, 0.76], [0.63, 0.75]], on: [[0.34, 0.5]] };
        if (isFlag && field.ordinary === "pile") spec = { between: [[0.8, 0.26], [0.8, 0.74]], on: [[0.28, 0.5]] };
        // the couched Y and chevron: company sits in the hoist wedge and the
        // fly panels; the pall's stem carries the "on" station
        if (isFlag && field.ordinary === "pall") spec = { between: [[0.14, 0.5], [0.66, 0.24], [0.66, 0.76]], on: [[0.68, 0.5]] };
        if (isFlag && field.ordinary === "chevron") spec = { between: [[0.16, 0.5], [0.74, 0.28], [0.74, 0.72]] };
        // a chief owns the top band: company positions under it are dropped
        let pts = (slot === "on" ? spec.on : spec.between) || spec.between;
        if (field.chief) pts = pts.filter(([, uy]) => uy > 0.34);
        if (pts.length) {
          arrange = slot === "on" ? "onOrdinary" : "between";
          slots = pts;
          tilt = (slot === "on" && spec.tilt) || 0;
          if (slot === "on") tincture = tinctureOn([markT], get("hueA"), get("value"), [], isFlag ? { bunting: true, flying: grounds, chroma: get("chroma") } : {});
        }
      } else if (slot === "seme") { arrange = "seme"; tincture = tinctureOn(grounds, get("hueA"), get("value"), [], { bunting: isFlag }); }
    } else {
      arrange = composition === "central" || composition === "radial" ? "single"
        : composition === "seme" ? "seme" : pickEnum(get("arrange"), ARRANGES);
      counterchange = composition === "heraldic" && !field.fur && mixedGround
        && TWO_REGION.includes(partition) && get("symmetry") > 0.6;
      // THE FIELD IS THE FLAG: on partitioned cloth most flags fly the
      // geometry ALONE — a tricolour needs no badge (~60% of real flags carry
      // no device at all; the stripes do the identity work at any distance).
      // A device appears only from the arrange gene's upper band, and it is a
      // LONE central emblem (compact multiples still organize into an array).
      // A plain field (no stripes, no ordinary) always speaks through its device.
      if (isFlag && composition === "heraldic" && partition !== "plain") {
        arrange = get("arrange") < 0.6 ? null
          : (compact && get("arrange") >= 0.82) ? "seme" : "single";
      }
    }
    // ON A FLAG A FIGURE STEPS BACK: no herds of beasts across the cloth —
    // multiples collapse to a lone device, and in an ordinary's company it
    // keeps a single station, the hoist-most one
    if (isFlag && !compact) {
      if (arrange === "three" || arrange === "inPale") arrange = "single";
      if (slots && slots.length > 1) slots = [slots[0]];
    }
    // THE CONSTELLATION GRAMMAR: on a flag a compact device's multiple-intent
    // — the same genes that station three lions on a shield or strew a silk —
    // expresses as an ORGANIZED array: ring / arc / rows / seeded sky map.
    // The count gene counts the devices (real counts enumerate members); the
    // otherwise-idle script gene picks the pattern, and the brand gene seeds
    // the constellation, exactly as it seeds a tamga. Each pattern imposes its
    // own geometric floor (a "ring" of three is not a ring).
    let array = null;
    if (isFlag && compact && !hasOrdinary && ["three", "inPale", "seme"].includes(arrange)) {
      let count = arrange === "seme" ? 5 + Math.min(7, Math.floor(get("motifCount") * 8))
        : 2 + Math.min(4, Math.floor(get("motifCount") * 5));
      const pattern = pickEnum(get("scriptDensity"), ARRAY_PATTERNS);
      if (pattern === "ring") count = Math.max(4, count);
      else if (pattern === "arc") count = Math.min(9, Math.max(3, count));
      else if (pattern === "constellation") count = Math.min(9, Math.max(4, count));
      else if (pattern === "satellites") count = Math.min(8, Math.max(3, count));   // one greater, the rest attend
      array = { pattern, count, seed: Math.floor(get("brandSeed") * 1e6), sizeF: 0.75 + get("motifScale") * 0.5 };
      arrange = "array";
      counterchange = false;                     // an array is appliqué from one bolt
    }
    // a heraldic semé is a FIELD treatment: it lies beneath chief, bordure and
    // ordinary, not over them
    behind = arrange === "seme" && composition === "heraldic";
    // ATTITUDE: rarely a charge is borne INVERTED or turned TO SINISTER —
    // the tails of the sunDisc gene, otherwise idle for charges. An armorial
    // abatement is a shield's business: a flag flies its device upright.
    const attitude = isFlag ? null : get("sunDisc") < 0.12 ? "inverted" : get("sunDisc") > 0.88 ? "sinister" : null;
    // THE CANTON HOUSES THE DEVICE: on flag cloth the canton is the position
    // of honour, not a second device beside the first — a compact device (or
    // its whole array) moves INTO the canton block and dresses against it
    // (the tincture rule, one layer up). A figure never boards the canton.
    const housed = isFlag && composition === "heraldic" && !hasOrdinary && compact
      && get("star") > 0.62 && (arrange === "single" || arrange === "array");
    if (housed) tincture = tinctureOn([markT], get("hueA"), get("value"), [], { bunting: true, flying: grounds, chroma: get("chroma") });
    // repeated / housed / band-riding devices draw from the flag vocabulary
    if (isFlag && compact && (array || housed || slots) && FLAG_SIMPLE[cat]) {
      const p2 = FLAG_SIMPLE[cat];
      id = p2[Math.min(p2.length - 1, Math.floor(get("motifIdx") * p2.length))];
    }
    // FLAG DETAILING: a single device may sit on a bounded PANEL (disc or
    // lozenge — the charge then dresses against the panel, the tincture rule
    // applied recursively), or wear a FIMBRIATION halo; both are how modern
    // flags separate a figure from a busy ground
    let panel = null, fimb = null;
    if (!housed && isFlag && !hasOrdinary && !counterchange && (composition === "heraldic" || composition === "central")) {
      // a lone FIGURE wants a ground of its own to sit on — its panel window
      // opens wide; a compact device (a disc, a star) flies bare more often
      if (arrange === "single" && get("crescent") > (compact ? 0.56 : 0.38) && get("crescent") <= 0.74) {
        // the panel may be a disc, a lozenge, or an INESCUTCHEON — the small
        // state-arms shield modern flags carry at their centre
        panel = { shape: pickEnum(get("symmetry"), PANEL_SHAPES), tincture: markT.rgb, name: markT.name };
        tincture = tinctureOn([markT], get("hueA"), get("value"), [], { bunting: true, flying: grounds, chroma: get("chroma") });
      } else if (arrange === "single" && get("motifCount") > 0.6
        && grounds.some(g => classOf(g) === classOf(tincture))) {
        fimb = sepPick([tincture, ...grounds.filter(g => classOf(g) === classOf(tincture))]);
      }
    }
    if (arrange) motif = { id, cat, tincture: tincture.rgb, tinctureName: tincture.name, counterchange, behind,
      slots, tilt, attitude, panel, array, inCanton: housed || undefined,
      fimbriation: fimb ? fimb.rgb : null, fimbName: fimb ? fimb.name : null,
      count: slots ? slots.length : array ? array.count : arrange === "three" ? 3 : arrange === "inPale" ? 2 : 1, arrange,
      // on a flag a figure sits like a badge, not an armorial beast filling
      // the cloth — it rides at roughly three-quarter size
      scale: (composition === "central" ? 0.86 : composition === "radial" ? 0.7 : 0.5)
        * (0.75 + get("motifScale") * 0.5) * (isFlag && !compact ? 0.72 : 1) };
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
  // on FLAG cloth the hoist-top must be free cloth (no canton over an
  // ordinary's arm) and the canton is the device's house, never a second
  // device beside a figure: it flies with a housed device, or alone
  const flagCantonOK = !isFlag || composition !== "heraldic"
    || (!hasOrdinary && (!motif || motif.inCanton));
  const ornaments = {
    border: get("border") > 0.5 || composition === "central",
    cornerAccent: composition === "central" && get("pearl") > 0.5,           // small disc, clear of the device
    canton: cantonOK && flagCantonOK && get("star") > 0.62,
    cantonKind: get("sunDisc") > 0.5 ? "sun" : "star",
    cantonColor: markT.rgb,                     // the canton lies on the field: it wears markT
    cantonName: markT.name,

    scriptDensity: 0.4 + get("scriptDensity") * 0.6,
    brandSeed: Math.floor(get("brandSeed") * 1e6),
  };

  // cadency — the inherited mark of difference, worn small in chief in a
  // tincture that reads on the field (chargeT, by construction)
  const cadency = genome.cadency
    ? { mark: CADENCY_MARKS[Math.min(CADENCY_MARKS.length, genome.cadency) - 1],
      tincture: pal.chargeT.rgb, tinctureName: pal.chargeT.name }
    : null;

  const phen = { substrate, shieldShape, isFlag, flagRatio, composition, symmetry, iconism, colors: pal, field, motif, geometry, sigil, ornaments,
    cadency, gen: genome.gen || 0 };
  // woven cloth takes the mill's vivid dye lots — names untouched
  return isFlag ? clothDye(phen) : phen;
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
const NUMWORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen"];
const CHARGE_NAME = {
  mullet6: "mullet of six points", mullet8: "mullet of eight points", rowel: "pierced mullet",
  crossCouped: "cross couped", crossPattee: "cross pattée", crosslet: "cross crosslet",
  oakleaf: "oak leaf", stagbeetle: "stag beetle", mailedfist: "mailed fist",
  catherinewheel: "Catherine wheel", cartwheel: "cart wheel", cogwheel: "cog wheel",
  seadragon: "sea-dragon", sealion: "sea-lion", fleur: "fleur-de-lys",
  starAndCrescent: "star and crescent",
};
const chargeName = id => CHARGE_NAME[id] || id;
const plural1 = w => /(s|x|z|ch|sh)$/.test(w) ? w + "es"
  : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + "ies"
  : /[^f]f$/.test(w) ? w.slice(0, -1) + "ves"                       // leaf → leaves, wolf → wolves
  : w + "s";
// heraldic French-order names pluralize their HEAD ("crosses couped",
// "mullets of six points", "fleurs-de-lys"); English compounds their tail
// ("pierced mullets", "oak leaves", "sea-dragons")
const NOUN_FIRST = /^(cross |mullet |fleur-)/;
const pluralize = name => {
  const sep = name.includes("-") && !name.includes(" ") ? "-" : " ";
  const parts = name.split(sep);
  const i = NOUN_FIRST.test(name) ? 0 : parts.length - 1;
  parts[i] = plural1(parts[i]);
  return parts.join(sep);
};
const art = name => (/^[aeiou]/i.test(name) ? "an" : "a");
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
    case "hoistTriangle": s = `${a}, a wedge issuant from the hoist ${b}`; break;
    case "barry": s = `Barry${ln} of ${NUMWORD[f.stripes]} ${a} and ${b}`; break;
    case "paly": s = `Paly${ln} of ${NUMWORD[f.stripes]} ${a} and ${b}`; break;
    case "chequy": s = `Chequy ${a} and ${b}`; break;
    case "lozengy": s = `Lozengy ${a} and ${b}`; break;
    case "tiercedPale": s = `Tierced in pale ${a}, ${b} and ${tName(f.names[2])}`
      + (f.tiercedWide === 0 ? ", the hoist band doubled" : f.tiercedWide === 1 ? ", the middle band doubled" : ""); break;
    case "tiercedFess": s = `Tierced in fess ${a}, ${b} and ${tName(f.names[2])}`
      + (f.tiercedWide === 0 ? ", the upper band doubled" : f.tiercedWide === 1 ? ", the middle band doubled" : ""); break;
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
    // marshalled CLOTH blazons as an ensign — the senior coat in the canton,
    // the house's own style as the field; shields enumerate their quarters
    const pOwn = expressGenome(genome);
    if (pOwn.isFlag) {
      const own = blazonGenome({ genes: genome.genes, gen: genome.gen, seed: genome.seed, cadency: genome.cadency });
      // two band-led cloths FUSE by superimposition (the 1606 construction):
      // the senior's cross rides over the whole, separated by undyed cloth
      const q = genome.quarters[0];
      const qGenes = q.genes.slice(); qGenes[IDX.substrate] = genome.genes[IDX.substrate];
      const q0 = expressGenome({ genes: qGenes, gen: q.gen || 0, seed: q.seed });
      const OV = ["cross", "saltire"];
      if (pOwn.composition === "heraldic" && q0.composition === "heraldic"
        && OV.includes(pOwn.field.ordinary) && OV.includes(q0.field.ordinary)
        && pOwn.field.ordinary !== q0.field.ordinary) {
        const sep = q0.field.ordinaryName === "argent" ? "Sable" : "Argent";
        return `${own}; surmounted, for the union, by a ${ordName(q0.field.ordinary)} ${tName(q0.field.ordinaryName)} fimbriated ${sep}`;
      }
      const un = blazonGenome({ genes: q.genes, gen: q.gen, seed: q.seed });
      return `${own}; in the canton the union: ${un}`;
    }
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
  // a canton flying its lone symbol (no other device on the cloth)
  if (!m && p.isFlag && p.ornaments.canton)
    parts.push(`on a canton ${tName(p.ornaments.cantonName)} a ${p.ornaments.cantonKind === "sun" ? "sun" : "mullet"} ${tName(f.names[0])}`);
  const mT = m ? (m.counterchange ? "counterchanged" : tName(m.tinctureName)) : "";
  const ATT = { inverted: " inverted", sinister: " contourné" };
  const mName = m ? chargeName(m.id) + (ATT[m.attitude] || "") : "";
  const hasOrd = f.ordinary && f.ordinary !== "none";
  const oLn = hasOrd && f.line !== "straight" ? ` ${f.line}` : "";
  const oT = hasOrd ? (f.counterchange ? "counterchanged" : tName(f.ordinaryName)) : "";
  const DIM_NAME = { fess: "bar", pale: "pallet", bend: "bendlet", bendSinister: "scarpe", chevron: "chevronel" };
  // on cloth the pall and the chevron lie COUCHED (issuing from the hoist)
  const couch = o => (p.isFlag && (o === "pall" || o === "chevron") ? `${ordName(o)} couched` : ordName(o));
  const nOrd = (hasOrd && f.ordinaryCount) || 1;
  const oFimb = hasOrd && f.fimbriation ? ` fimbriated ${tName(f.fimbName)}` : "";
  const mFimb = m && m.fimbriation ? ` fimbriated ${tName(m.fimbName)}` : "";
  const oMouth = hasOrd && f.pallMouth ? `, enclosing at the hoist a wedge ${tName(f.pallMouthName)}` : "";
  const ordClause = nOrd > 1 ? `${NUMWORD[nOrd]} ${pluralize(DIM_NAME[f.ordinary])}${oLn} ${oT}${oFimb}`
    : hasOrd ? `a ${couch(f.ordinary)}${oLn} ${oT}${oFimb}${oMouth}` : "";
  if (hasOrd && m && m.arrange === "between") {
    parts.push(`${ordClause} between ${m.count === 1 ? `${art(mName)} ${mName}` : `${NUMWORD[m.count]} ${pluralize(mName)}`} ${mT}`);   // ordClause already carries the mouth
  } else if (hasOrd && m && m.arrange === "onOrdinary") {
    parts.push(`on a ${couch(f.ordinary)}${oLn} ${oT}${oFimb} ${m.count === 1 ? `${art(mName)} ${mName}` : `${NUMWORD[m.count]} ${pluralize(mName)}`} ${mT}${oMouth}`);
  } else {
    if (hasOrd) parts.push(ordClause);
    if (m && m.arrange !== "seme") {
      // an ARRAY blazons with its arrangement phrase; housed in a canton it
      // becomes the canton's charge ("on a canton Azure, five mullets in annulo Or")
      let clause;
      if (m.arrange === "array") {
        const A = m.array;
        const ph = A.pattern === "ring" ? "in annulo" : A.pattern === "arc" ? "in arc"
          : A.pattern === "constellation" ? "in constellation"
          : A.pattern === "satellites" ? "in majesty" : A.count <= 4 ? "in fess" : "in rows";
        clause = `${NUMWORD[A.count]} ${pluralize(mName)} ${ph} ${mT}`;
      }
      else if (m.arrange === "three") clause = `three ${pluralize(mName)} ${mT}${mFimb}`;
      else if (m.arrange === "inPale") clause = `two ${pluralize(mName)} in pale ${mT}${mFimb}`;
      else if (p.composition === "radial") clause = `${art(mName)} ${mName} ${mT} within an annulet`;
      else if (m.panel) { const pn = m.panel.shape === "disc" ? "roundel" : m.panel.shape === "escutcheon" ? "inescutcheon" : "lozenge";
        clause = `${art(pn)} ${pn} ${tName(m.panel.name)} charged with ${art(mName)} ${mName} ${mT}`; }
      else clause = `${art(mName)} ${mName} ${mT}${mFimb}`;
      parts.push(m.inCanton ? `on a canton ${tName(p.ornaments.cantonName)} ${clause}` : clause);
    }
  }
  if (f.chief) parts.push(`a chief${f.line !== "straight" ? ` ${f.line}` : ""} ${tName(f.ordinaryName)}`);
  if (f.bordure) parts.push(`a bordure ${tName(f.ordinaryName)}`);
  if (p.cadency) parts.push(`${art(chargeName(p.cadency.mark))} ${chargeName(p.cadency.mark)} ${tName(p.cadency.tinctureName)} for difference`);
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
  if (genome.quarters && genome.quarters.length > 1) bits.unshift(p.isFlag ? `ensign of ${genome.quarters.length}` : `quarterly of ${genome.quarters.length}`);
  if (p.cadency) bits.push(`diff·${p.cadency.mark}`);
  if (p.composition === "heraldic") {
    const f = p.field;
    bits.push(f.fur ? f.fur : f.partition !== "plain" ? `${f.partition} ${f.names.join("·")}` : f.names[0]);
    if (f.ordinary && f.ordinary !== "none") bits.push((f.counterchange ? "counterchanged " : "") + f.ordinary + " " + f.ordinaryName + (f.line !== "straight" ? " " + f.line : ""));
    if (f.chief) bits.push("chief");
    if (f.bordure) bits.push("bordure");
  }
  if (p.motif) {
    const m = p.motif, t = m.counterchange ? "counterchanged" : m.tinctureName;
    const head = m.arrange === "between" ? "between: " : m.arrange === "onOrdinary" ? "on it: "
      : m.arrange === "array" ? `${m.array.pattern}${m.inCanton ? "@canton" : ""} ` : m.behind ? "semé " : "";
    bits.push(head + m.id + (m.count > 1 ? `×${m.count}` : "") + " " + t + (m.inCanton && m.arrange !== "array" ? " @canton" : ""));
  }
  else if (p.composition === "script") bits.push("calligraphy");
  else if (p.composition === "brand") bits.push("tamga");
  else if (p.composition === "plain") bits.push(p.geometry.mode === "lattice" ? "star-lattice" : "rosette");
  else if (p.composition === "sacred") bits.push(`sigil·${p.sigil.fold}·${p.sigil.arm}`);
  return bits.join(" · ");
}

export { SUBSTRATES, COMPOSITIONS, PALETTES, MOTIFS, MOTIF_CATS, INK, BONE, GOLD, BUNTING_RGB };
