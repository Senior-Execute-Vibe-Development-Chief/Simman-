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
const COMPOSITIONS = ["heraldic", "central", "radial", "script", "brand", "plain", "seme", "sacred"];
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
const PARTITIONS  = ["plain", "perPale", "perFess", "perBend", "quarterly", "gyronny", "perSaltire", "chevron", "barry", "paly"];
const LINES       = ["straight", "straight", "wavy", "engrailed", "embattled", "indented"];
const ARRANGES    = ["single", "single", "three", "inPale", "seme"];
// when an ordinary is present, the SAME arrange gene instead decides the
// ordinary's COMPANY: nothing (the bare ordinary is the design — still the
// common case), charges BETWEEN it in the free field, charges ON the band
// itself, or a semé field strewn beneath it.
const ORD_COMPANY = ["none", "none", "between", "on", "seme"];
// ordinaries — the bold geometric charges of heraldry, laid over the field (with
// the field's line-style on their edges). "none" weighted so a plain field stays common.
const ORDINARIES  = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "fess", "pale", "bend", "bendSinister", "chevron", "cross", "saltire", "pile", "pall"];
// Motif categories split into LIVING (figures a strict aniconism forbids) and
// NON-LIVING (plant, object, architecture, natural, celestial, geometry — borne
// even by aniconic faiths as arabesque / device / phenomenon). This split is what
// lets low iconism mean "no living figures" rather than "no charge at all".
const MOTIF_CATS  = ["beast", "insect", "bird", "mythic", "sea", "plant", "object", "architecture", "natural", "celestial", "geometric"];
const LIVING_CATS = new Set(["beast", "insect", "bird", "mythic", "sea"]);
const NONLIVING_CATS = ["plant", "object", "architecture", "natural", "celestial", "geometric"];
// motif ids resolve to charge art in the renderer (DrawShield / game-icons).
// @INJECT:MOTIFS-START — the lab build (tools/build_lab.mjs) replaces this whole
// block with the size-filtered subset so the artifact's pools match its bundled art.
const MOTIFS = {
  beast:  ["lion", "wolf", "boar", "bull", "bear", "horse", "ram", "stag", "elephant", "rabbit", "antelope", "camel", "tiger", "leopard", "fox", "greyhound", "hedgehog", "badger", "otter", "squirrel", "ass", "cow"],
  insect: ["bee", "butterfly", "spider", "ant", "grasshopper", "dragonfly", "stagbeetle", "snail", "moth", "hornet"],
  bird:   ["eagle", "falcon", "dove", "raven", "rooster", "crane", "swan", "owl", "peacock", "pelican", "martlet"],
  mythic: ["dragon", "wyvern", "griffin", "unicorn", "pegasus", "hydra", "phoenix", "cockatrice", "basilisk", "sphinx", "salamander", "seadragon", "sealion", "harpy", "centaur", "chimera", "manticore"],
  sea:    ["dolphin", "serpent", "mermaid", "fish", "pike", "salmon", "whale", "crab", "lobster", "shark", "escallop", "octopus", "narwhal", "shrimp", "whelk"],
  plant:  ["rose", "tree", "lotus", "thistle", "garb", "oak", "oakleaf", "olive", "palm", "lily", "cinquefoil", "quatrefoil", "trefoil", "sunflower", "iris", "poppy", "shamrock", "acorn", "vine", "grapes", "bamboo", "pineapple", "fleur"],
  object: ["crown", "key", "sword", "anchor", "ship", "scales", "harp", "lyre", "book", "bell", "bugle", "clarion", "lute", "drum", "chalice", "amphora", "anvil", "hammer", "millrind", "millstone", "scythe", "sickle", "plough", "pitchfork", "compass", "lantern", "lamp", "scroll", "mirror", "shears", "quill", "distaff", "axe", "halberd", "arrow", "arrows", "pheon", "trident", "spear", "bow", "crossbow", "flail", "club", "cannon", "mace", "warhammer", "catherinewheel", "cartwheel", "cogwheel", "helmet", "gauntlet", "breastplate", "mailedfist", "horseshoe", "spur", "stirrup", "saddle", "wagon", "beehive", "beacon", "brazier", "torch", "grenade", "chest"],
  architecture: ["tower", "castle", "bridge", "gate", "arch", "house", "city"],
  natural: ["cloud", "lightning", "snowflake", "teardrop", "flint", "flames", "fireball"],
  celestial: ["sun", "moon", "estoile", "comet"],
  // mostly VECTOR PRIMITIVES (parametric paths in the renderer — crisp,
  // counterchangeable, semé-able); fret and triskele stay raster art
  geometric: ["mullet", "mullet6", "mullet8", "rowel", "roundel", "annulet", "lozenge", "fusil", "mascle", "billet", "delf", "crossCouped", "crossPattee", "crosslet", "goutte", "fret", "triskele"],
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
  return { genes, gen: (genome.gen || 0) + 1, seed: genome.seed };
}
const MICRO_RATE = 0.5;   // fraction of genes that drift a little each step
const MACRO_RATE = 0.03;  // per-gene chance of a wholesale jump
const STEP = 0.14;        // drift size

/** A successor inherits the parent's genome with a little drift — recognisably
 *  the same house, diverging over generations. */
export function inheritGenome(parent, seed) {
  return mutateGenome(parent, seed, 0.5);
}

/** Recombination — a union or conquest MARSHALS two genomes. Per-gene the child
 *  takes one parent's allele (classic uniform crossover), with light mutation.
 *  When both parents are heraldic, the child leans to a QUARTERED field — the
 *  literal marshalling of two coats. */
export function crossGenome(a, b, seed) {
  const rng = prng(seed >>> 0);
  const genes = GENES.map((_, i) => (rng() < 0.5 ? a.genes[i] : b.genes[i]));
  // small post-cross mutation
  for (let i = 0; i < genes.length; i++) if (rng() < 0.15) genes[i] = clamp01(genes[i] + bell(rng) * STEP);
  const compA = pickEnum(a.genes[IDX.composition], COMPOSITIONS);
  const compB = pickEnum(b.genes[IDX.composition], COMPOSITIONS);
  if (compA === "heraldic" && compB === "heraldic") {
    genes[IDX.composition] = 0.02;             // heraldic
    genes[IDX.partition] = 0.42;               // quarterly — marshalled
  }
  return { genes, gen: Math.max(a.gen || 0, b.gen || 0) + 1, seed: a.seed };
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
  let fieldT, companionT, chargeT, accentT, poles = [];
  if (mode === "monochrome") {
    // ink and bone are, in tincture terms, sable and argent — typed so the
    // class rules see them
    const inkT = P(INK), boneT = P(BONE), inv = val > 0.5;
    fieldT = inv ? inkT : boneT; companionT = chargeT = accentT = inv ? boneT : inkT;
    poles = [inkT, boneT];
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
    ink: INK, fieldT, companionT, chargeT, accentT, poles };
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
  // a fur drapes the WHOLE field (so no partition/counterchange under it) — and
  // it IS the ground: ermine reads as argent strewn with sable, vair as
  // argent-and-azure, so marks pick against those, not the colour they replaced
  if (composition === "heraldic" && get("crescent") > 0.74) {
    field.fur = get("value") > 0.5 ? "ermine" : "vair";
    field.partition = partition = "plain";
    grounds = field.fur === "ermine" ? [T("argent")] : [T("argent"), T("azure")];
    field.names = grounds.length === 2 ? [grounds[0].name, grounds[1].name] : [grounds[0].name, grounds[0].name];
  }
  // the tincture any mark lying on this field wears — chargeT was constructed
  // against the plain field; every other ground (a party, a fur) re-derives
  const markT = grounds.length === 1 && grounds[0] === pal.fieldT ? pal.chargeT
    : tinctureOn(grounds, get("hueB"), get("value"), pal.poles);
  const mixedGround = new Set(grounds.map(g => g.kind === "metal" ? "metal" : "dark")).size > 1;
  if (composition === "heraldic") {
    field.ordinary = pickEnum(get("hueC"), ORDINARIES);
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
    let arrange = null, tincture = markT, counterchange = false, behind = false;
    if (hasOrdinary) {
      // an ordinary no longer suppresses the charge — the arrange gene decides
      // its company. Charges ON the band derive their tincture against the
      // band (the same constructive rule, applied one layer up); a chevron has
      // no room on it and a counterchanged ordinary is no single ground, so
      // both keep their company BETWEEN instead.
      let slot = pickEnum(get("arrange"), ORD_COMPANY);
      if (slot === "on" && (field.ordinary === "chevron" || field.counterchange)) slot = "between";
      if (slot === "between") arrange = "between";
      else if (slot === "on") { arrange = "onOrdinary"; tincture = tinctureOn([markT], get("hueA"), get("value")); }
      else if (slot === "seme") { arrange = "seme"; tincture = tinctureOn(grounds, get("hueA"), get("value")); }
    } else {
      arrange = composition === "central" || composition === "radial" ? "single"
        : composition === "seme" ? "seme" : pickEnum(get("arrange"), ARRANGES);
      counterchange = composition === "heraldic" && !field.fur && mixedGround
        && TWO_REGION.includes(partition) && get("symmetry") > 0.6;
    }
    // a heraldic semé is a FIELD treatment: it lies beneath chief, bordure and
    // ordinary, not over them
    behind = arrange === "seme" && composition === "heraldic";
    if (arrange) motif = { id, cat, tincture: tincture.rgb, tinctureName: tincture.name, counterchange, behind,
      count: arrange === "three" ? 3 : arrange === "inPale" ? 2 : 1, arrange,
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

  return { substrate, composition, symmetry, iconism, colors: pal, field, motif, geometry, sigil, ornaments,
    gen: genome.gen || 0 };
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

// A short human description of what a genome became.
export function describeGenome(genome) {
  const p = expressGenome(genome);
  const bits = [p.composition, p.substrate, p.colors.mode];
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
