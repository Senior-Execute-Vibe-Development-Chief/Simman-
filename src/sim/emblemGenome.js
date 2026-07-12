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
// Motif categories split into LIVING (figures a strict aniconism forbids) and
// NON-LIVING (plant, object, architecture, natural, celestial, geometry — borne
// even by aniconic faiths as arabesque / device / phenomenon). This split is what
// lets low iconism mean "no living figures" rather than "no charge at all".
const MOTIF_CATS  = ["beast", "insect", "bird", "mythic", "sea", "plant", "object", "architecture", "natural", "celestial", "geometric"];
const LIVING_CATS = new Set(["beast", "insect", "bird", "mythic", "sea"]);
const NONLIVING_CATS = ["plant", "object", "architecture", "natural", "celestial", "geometric"];
// motif ids resolve to charge art in the renderer (DrawShield / game-icons).
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
  geometric: ["lozenge", "fusil", "roundel", "billet", "fret", "triskele"],
};

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

const lum = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
// pick, from options, the colour whose luminance is furthest from a background —
// so an overlaid mark or charge always READS (never same-on-same).
function contrastPick(bg, options) { let best = options[0], bd = -1; for (const c of options) { const d = Math.abs(lum(bg) - lum(c)); if (d > bd) { bd = d; best = c; } } return best; }
// nearest-luminance distance to any of a set of backgrounds
const minDist = (c, bgs) => Math.min(...bgs.map(b => Math.abs(lum(b) - lum(c))));
function decodePalette(get) {
  const mode = pickEnum(get("paletteMode"), PALETTES);
  const hA = get("hueA"), hB = get("hueB"), chroma = get("chroma"), val = get("value");
  let field, companion, charge, accent = GOLD;
  if (mode === "monochrome") {
    const inv = val > 0.5; field = inv ? INK : BONE; companion = inv ? BONE : INK; charge = inv ? BONE : INK;
  } else if (mode === "imperial") {
    field = hsl(hA, 0.55 + chroma * 0.35, 0.42 + val * 0.12); companion = GOLD; charge = GOLD; accent = [0xc0, 0x39, 0x2b];
  } else if (mode === "earth") {
    field = hsl(0.06 + hA * 0.12, 0.25 + chroma * 0.2, 0.46 + val * 0.14); companion = [0x3a, 0x2e, 0x22]; charge = [0x2b, 0x24, 0x1c]; accent = BONE;
  } else {                                       // heraldic: a colour field + a metal
    field = hsl(hA, 0.5 + chroma * 0.35, 0.34 + val * 0.14); const metal = val > 0.5 ? GOLD : SILVER;
    companion = get("secondary") > 0.5 ? hsl(hB, 0.5 + chroma * 0.3, 0.36) : metal; charge = metal; accent = metal;
  }
  // contrast guard — the motif must READ on the field (no gold-on-gold)
  if (Math.abs(lum(field) - lum(charge)) < 0.32) charge = lum(field) > 0.5 ? INK : SILVER;
  return { mode, field, companion, charge, accent, ink: INK };
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

  // field
  const partition = composition === "heraldic" ? pickEnum(get("partition"), PARTITIONS) : "plain";
  const field = { partition, tinctures: [pal.field, pal.companion],
    line: pickEnum(get("line"), LINES), stripes: 2 + Math.floor(get("stripes") * 7) };

  // motif — a figurative composition carries a charge. Low iconism forbids LIVING
  // figures, so a living category (beast/bird/mythic/sea) is remapped to a
  // non-living one (celestial / geometric / plant / object). Only the abstract
  // compositions carry no charge.
  let motif = null;
  const figuralComp = ["heraldic", "central", "radial", "seme"].includes(composition);
  if (figuralComp) {
    let cat = pickEnum(get("motifCat"), MOTIF_CATS);
    if (aniconic && LIVING_CATS.has(cat)) {
      cat = NONLIVING_CATS[Math.floor(get("motifCount") * NONLIVING_CATS.length) % NONLIVING_CATS.length];
    }
    const pool = MOTIFS[cat];
    const id = pool[Math.min(pool.length - 1, Math.floor(get("motifIdx") * pool.length))];
    let arrange = composition === "central" || composition === "radial" ? "single"
      : composition === "seme" ? "seme" : pickEnum(get("arrange"), ARRANGES);
    // charge tincture must READ over EVERY tincture it sits on — for a DIVIDED
    // heraldic field that means both halves, not just the base (no metal-on-metal).
    let tincture = pal.charge;
    const bgs = partition !== "plain" ? field.tinctures : [pal.field];
    if (minDist(tincture, bgs) < 0.3) tincture = [INK, BONE, GOLD].reduce((best, c) => minDist(c, bgs) > minDist(best, bgs) ? c : best);
    motif = { id, cat, tincture,
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
    cantonColor: contrastPick(pal.field, [pal.accent, pal.charge, GOLD, BONE, INK]),
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
  if (p.motif) bits.push(p.motif.id + (p.motif.count > 1 ? `×${p.motif.count}` : ""));
  else if (p.composition === "script") bits.push("calligraphy");
  else if (p.composition === "brand") bits.push("tamga");
  else if (p.composition === "plain") bits.push(p.geometry.mode === "lattice" ? "star-lattice" : "rosette");
  else if (p.composition === "sacred") bits.push(`sigil·${p.sigil.fold}·${p.sigil.arm}`);
  return bits.join(" · ");
}

export { SUBSTRATES, COMPOSITIONS, PALETTES, MOTIFS, MOTIF_CATS };
