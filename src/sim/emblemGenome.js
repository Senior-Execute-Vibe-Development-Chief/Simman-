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
const COMPOSITIONS = ["heraldic", "central", "radial", "script", "brand", "plain", "seme"];
const SYMMETRIES  = ["none", "bilateral", "radial", "quarterly"];
const PALETTES    = ["heraldic", "monochrome", "imperial", "earth"];
const PARTITIONS  = ["plain", "perPale", "perFess", "perBend", "quarterly", "gyronny", "perSaltire", "chevron", "barry", "paly"];
const LINES       = ["straight", "straight", "wavy", "engrailed", "embattled", "indented"];
const ARRANGES    = ["single", "single", "three", "inPale", "seme"];
const MOTIF_CATS  = ["beast", "bird", "mythic", "sea", "plant", "object"];
// motif ids resolve to charge art in the renderer (DrawShield / game-icons).
const MOTIFS = {
  beast:  ["lion", "wolf", "boar", "bull", "bear", "horse", "ram", "stag", "elephant", "rabbit"],
  bird:   ["eagle", "falcon", "dove", "raven", "rooster"],
  mythic: ["dragon", "wyvern", "griffin", "unicorn", "pegasus", "hydra"],
  sea:    ["dolphin", "serpent", "mermaid"],
  plant:  ["rose", "tree", "lotus", "thistle", "garb"],
  object: ["crown", "key", "sword", "anchor", "ship", "scales", "harp", "lyre", "book", "tower", "castle"],
};

const pickEnum = (v, arr) => arr[Math.min(arr.length - 1, Math.floor(v * arr.length))];

// ── construction ──────────────────────────────────────────────────────────
// A fresh, random genome from a numeric seed.
function randomGenes(seed) {
  const rng = prng(seed);
  return GENES.map(() => rng());
}

/**
 * foundGenome(seed, traits) — seed a genome from a realm's emergent state.
 * `traits` are 0..1 signals (any may be omitted → that gene stays random):
 *   aniconism   — a faith's aversion to figures  → drives iconism DOWN, toward
 *                 script/brand/geometry (the single biggest tradition divider)
 *   nomad       — pastoral/mobile subsistence     → toward the brand (tamga) look
 *   develop     — literacy/organisation            → toward banners & calligraphy,
 *                 away from the bare shield
 *   centralised — one divine monarchy vs many lords→ toward one central sacred beast
 *   refined     — a courtly, ordered aesthetic     → toward the radial monochrome badge
 *   martial, commerce — temperament               → palette & motif-category lean
 *   hue         — the stock's base hue (0..1)      → seeds the palette
 * The genes are the world's fingerprint; everything after is evolution.
 */
export function foundGenome(seed, traits = {}) {
  const g = randomGenes(seed);
  const rng = prng((seed ^ 0x9e3779b9) >>> 0);
  const set = (name, v) => (g[IDX[name]] = clamp01(v));
  const nudge = (name, v, w) => (g[IDX[name]] = clamp01(g[IDX[name]] * (1 - w) + v * w));
  const t = traits;

  if (t.aniconism != null) set("iconism", clamp01(1 - t.aniconism + bell(rng) * 0.12));
  // composition lean, by priority: aniconic → script/brand/plain; centralised →
  // one central beast; refined → radial badge; iconic → heraldic; nomad → brand.
  let comp = null;
  if (t.aniconism != null && t.aniconism > 0.6) comp = 0.43 + rng() * 0.4;              // script..plain
  else if (t.centralised != null && t.centralised > 0.6) comp = 0.16 + rng() * 0.1;     // central
  else if (t.refined != null && t.refined > 0.6) comp = 0.30 + rng() * 0.1;             // radial
  else if (t.aniconism != null && t.aniconism < 0.4) comp = rng() < 0.85 ? rng() * 0.14 : 0.87 + rng() * 0.12; // heraldic/seme
  if (t.nomad != null && t.nomad > 0.55) comp = 0.58 + rng() * 0.12;                    // brand (overrides)
  if (comp != null) set("composition", comp);
  // substrate: developed realms fly banners; refined ones a roundel badge
  if (t.develop != null) nudge("substrate", t.develop > 0.5 ? 0.2 : 0.02, 0.5);            // banner / shield
  if (t.refined != null && t.refined > 0.6) set("substrate", 0.36);                        // roundel
  // palette mode: aniconic→often monochrome/earth; centralised→imperial
  if (t.aniconism != null && t.aniconism > 0.6) nudge("paletteMode", t.refined > 0.5 ? 0.3 : 0.85, 0.6); // mono / earth
  if (t.centralised != null && t.centralised > 0.6) set("paletteMode", 0.6);               // imperial
  if (t.hue != null) { set("hueA", wrap01(t.hue + bell(rng) * 0.05)); set("hueB", wrap01(t.hue + 0.5 + bell(rng) * 0.1)); }
  // temperament: martial → beasts + bold; commerce → objects + gold
  if (t.martial != null && t.martial > 0.55) { nudge("motifCat", 0.05, 0.5); nudge("value", 0.35, 0.3); }
  if (t.commerce != null && t.commerce > 0.55) nudge("motifCat", 0.95, 0.4);               // object

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
  // ANICONISM gates the figurative compositions off — an aniconic culture cannot
  // express a beast, so its genes route to script / brand / plain / geometry.
  if (iconism < 0.34 && ["heraldic", "central", "radial", "seme"].includes(composition)) {
    composition = ["script", "brand", "plain"][Math.floor(get("brandSeed") * 3) % 3];
  }
  // …and the reverse: a strongly figurative culture won't fly pure calligraphy.
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

  // motif (only where figures are expressed)
  let motif = null;
  const figurative = iconism >= 0.34 && ["heraldic", "central", "radial", "seme"].includes(composition);
  if (figurative) {
    const cat = pickEnum(get("motifCat"), MOTIF_CATS);
    const pool = MOTIFS[cat];
    const id = pool[Math.min(pool.length - 1, Math.floor(get("motifIdx") * pool.length))];
    let arrange = composition === "central" || composition === "radial" ? "single"
      : composition === "seme" ? "seme" : pickEnum(get("arrange"), ARRANGES);
    motif = { id, cat, tincture: pal.charge,
      count: arrange === "three" ? 3 : arrange === "inPale" ? 2 : 1, arrange,
      scale: (composition === "central" ? 0.86 : composition === "radial" ? 0.7 : 0.5) * (0.75 + get("motifScale") * 0.5) };
  }

  const ornaments = {
    border: get("border") > 0.5 || composition === "central" || composition === "plain",
    pearl: composition === "central" && get("pearl") > 0.5,
    sunDisc: get("sunDisc") > 0.62,
    star: get("star") > 0.6,
    crescent: (composition === "script" || composition === "plain") && get("crescent") > 0.45,
    scriptDensity: 0.4 + get("scriptDensity") * 0.6,
    brandSeed: Math.floor(get("brandSeed") * 1e6),
  };

  return { substrate, composition, symmetry, iconism, colors: pal, field, motif, ornaments,
    gen: genome.gen || 0 };
}

// A short human description of what a genome became.
export function describeGenome(genome) {
  const p = expressGenome(genome);
  const bits = [p.composition, p.substrate, p.colors.mode];
  if (p.motif) bits.push(p.motif.id + (p.motif.count > 1 ? `×${p.motif.count}` : ""));
  else if (p.composition === "script") bits.push("calligraphy");
  else if (p.composition === "brand") bits.push("tamga");
  return bits.join(" · ");
}

export { SUBSTRATES, COMPOSITIONS, PALETTES, MOTIFS, MOTIF_CATS };
