// ── Style taste — residual fashion within the deterministic envelope ─────────
//
// peopleStyle.js decides cut, fibre, wall, roof (climate × materials × wealth).
// This module decides HOW that envelope is worn and trimmed: haircut, embroidery,
// palette layout, roof-corner flare — the taste genome two silk courts need to
// read apart while sharing robe + courtyard.
//
// Pure + deterministic. No save fields, no UI, no culture names. Genes bias from
// abstract axes (ornament, austerity, colour) the way emblemGenome biases from
// regal/martial/devout — soft windows, every pattern reachable.

import { styleOf } from "./peopleStyle.js";
import { canGrowBeard } from "./lineageGenetics.js";

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
function bell(rng) { return rng() + rng() + rng() - 1.5; }

export const TASTE_GENES = [
  "hairLength", "hairArrange", "beardWear",
  "embroidery", "pattern", "paletteField", "paletteTrim", "hueShift", "chroma",
  "jewelleryForm",
  "cosmetics", "headdressStyle", "sleeveFashion",
  "cornerFlare", "eavesForm", "facadeRhythm", "wallWash", "trimContrast",
];
const IDX = Object.fromEntries(TASTE_GENES.map((g, i) => [g, i]));

const MICRO_RATE = 0.48;
const MACRO_RATE = 0.04;
const STEP = 0.14;

function randomGenes(seed) {
  const rng = prng(seed >>> 0);
  return TASTE_GENES.map(() => rng());
}

const pickEnum = (v, arr) => arr[Math.min(arr.length - 1, Math.floor(clamp01(v) * arr.length))];

/**
 * foundTasteGenome(seed, axes) — culture / court seed biased by abstract axes (0–1).
 *   ornament   — embroidery, jewellery, brocade, corner flare
 *   austerity  — plain hair, clean beard, natural walls, low chroma
 *   colour     — saturated palette, trim contrast, lime/ochre wash
 *   pattern    — stripe, check, facade rhythm
 */
export function foundTasteGenome(seed, axes = {}) {
  const g = randomGenes(seed);
  const rng = prng((seed ^ 0x7a3c9e2d) >>> 0);
  const set = (name, v) => (g[IDX[name]] = clamp01(v));
  const nudge = (name, v, w) => (g[IDX[name]] = clamp01(g[IDX[name]] * (1 - w) + v * w));
  const a = axes;

  if (a.ornament != null) {
    nudge("embroidery", a.ornament, 0.65);
    nudge("jewelleryForm", a.ornament, 0.55);
    nudge("pattern", 0.55 + a.ornament * 0.35, 0.45);
    nudge("cornerFlare", a.ornament * 0.7, 0.4);
    nudge("eavesForm", a.ornament * 0.65, 0.35);
  }
  if (a.austerity != null) {
    nudge("embroidery", 0.08, a.austerity * 0.75);
    nudge("beardWear", 0.12, a.austerity * 0.55);
    nudge("pattern", 0.1, a.austerity * 0.6);
    nudge("chroma", 0.15, a.austerity * 0.65);
    nudge("cornerFlare", 0.1, a.austerity * 0.5);
    nudge("wallWash", 0.2, a.austerity * 0.4);
    nudge("hairArrange", 0.25, a.austerity * 0.35);
  }
  if (a.colour != null) {
    nudge("chroma", a.colour, 0.7);
    nudge("paletteTrim", a.colour, 0.55);
    nudge("trimContrast", a.colour, 0.5);
    nudge("hueShift", 0.5 + a.colour * 0.2, 0.35);
    nudge("wallWash", 0.55 + a.colour * 0.25, 0.4);
    nudge("cosmetics", a.colour * 0.65, 0.45);
  }
  if (a.pattern != null) {
    nudge("pattern", a.pattern, 0.7);
    nudge("facadeRhythm", a.pattern, 0.45);
    nudge("paletteField", 0.35 + a.pattern * 0.3, 0.35);
  }
  if (a.regal != null) {
    nudge("embroidery", 0.72, a.regal * 0.55);
    nudge("jewelleryForm", 0.68, a.regal * 0.5);
    nudge("facadeRhythm", 0.62, a.regal * 0.4);
    nudge("hairArrange", 0.7, a.regal * 0.35);
    nudge("headdressStyle", 0.75, a.regal * 0.5);
  }
  if (a.pastoral != null) {
    nudge("wallWash", 0.35, a.pastoral * 0.5);
    nudge("chroma", 0.35, a.pastoral * 0.4);
    nudge("hairLength", 0.45, a.pastoral * 0.3);
  }
  if (a.arid != null) {
    nudge("wallWash", 0.62, a.arid * 0.55);
    nudge("paletteField", 0.55, a.arid * 0.4);
    set("hairArrange", clamp01(0.55 + bell(rng) * 0.1));
  }

  return { genes: g, gen: 0, seed: seed >>> 0 };
}

export function mutateTasteGenome(genome, seed, strength = 1) {
  const rng = prng(seed >>> 0);
  const genes = genome.genes.map(v => {
    let nv = v;
    if (rng() < MICRO_RATE * strength) nv = wrap01(v + bell(rng) * STEP * strength);
    if (rng() < MACRO_RATE * strength) nv = rng();
    return clamp01(nv);
  });
  return { genes, gen: (genome.gen || 0) + 1, seed: genome.seed };
}

/** Weighted blend for culMix / migration (shareB = weight on b). */
export function blendTasteGenome(a, b, shareB) {
  const w = clamp01(shareB);
  const genes = TASTE_GENES.map((_, i) => clamp01(a.genes[i] * (1 - w) + b.genes[i] * w));
  return { genes, gen: Math.max(a.gen || 0, b.gen || 0), seed: a.seed };
}

function hairStyleOf(G, dress) {
  if (dress.cut === "bare" && dress.station === "plain") {
    return pickEnum(G[IDX.hairLength], ["shaved", "cropped", "cropped"]);
  }
  const len = G[IDX.hairLength];
  const arr = G[IDX.hairArrange];
  if (len < 0.22) return "cropped";
  if (arr > 0.72) return pickEnum(arr, ["plait", "bun", "topknot"]);
  if (len < 0.45) return "shoulder";
  return pickEnum(len, ["long", "shoulder", "long"]);
}

function beardStyleOf(G, look, dress) {
  if (!canGrowBeard(look)) return "none";
  const wear = G[IDX.beardWear];
  if (dress.station === "fine" && wear < 0.28) return "none";
  if (wear < 0.22) return "none";
  if (wear < 0.48) return "stubble";
  if (wear > 0.82 && G[IDX.hairArrange] > 0.65) return "plait";
  return "full";
}

function embroideryOf(G, dress) {
  if (dress.cut === "bare" || dress.weight === "bare") return "none";
  if (dress.station !== "fine" && dress.fibre !== "silk" && G[IDX.embroidery] < 0.55) return "none";
  return pickEnum(G[IDX.embroidery], ["none", "border", "cuff", "allover"]);
}

function patternOf(G, dress) {
  if (dress.cut === "bare" || dress.fibre === "fur" || dress.fibre === "leather") return "plain";
  return pickEnum(G[IDX.pattern], ["plain", "stripe", "check", "brocade"]);
}

function paletteOf(G, dress) {
  const layout = pickEnum(G[IDX.paletteField], ["field", "trim", "border"]);
  return {
    layout,
    hueShift: wrap01(G[IDX.hueShift]),
    saturation: clamp01(0.12 + G[IDX.chroma] * 0.82),
    trim: clamp01(G[IDX.paletteTrim]),
    dye: dress.dye || null,
  };
}

function jewelleryOf(G, dress) {
  if (!dress.ornament && dress.station !== "fine") return "none";
  if (G[IDX.jewelleryForm] < 0.18 && !dress.ornament) return "none";
  return pickEnum(G[IDX.jewelleryForm], ["bead", "filigree", "plate", "torque"]);
}

function cosmeticsOf(G, dress) {
  if (dress.cut === "bare" || dress.weight === "bare") return "none";
  if (dress.bodyArt && dress.bodyArt !== "none" && G[IDX.cosmetics] < 0.55) return dress.bodyArt;
  return pickEnum(G[IDX.cosmetics], ["none", "kohl", "rouge", "stain"]);
}

function headdressStyleOf(G, dress) {
  if (!dress.headdress || dress.headdress === "none") return "none";
  if (dress.headdress === "crown") return pickEnum(G[IDX.headdressStyle], ["crown", "fillet", "plume"]);
  if (dress.headdress === "turban") return pickEnum(G[IDX.headdressStyle], ["turban", "wrapped", "tall"]);
  return pickEnum(G[IDX.headdressStyle], ["plain", "folded", "pinned"]);
}

function sleeveFashionOf(G, dress) {
  if (dress.sleeve === "bare") return "none";
  return pickEnum(G[IDX.sleeveFashion], ["plain", "flared", "layered", "cuffed"]);
}

function cornerFlareOf(G, built) {
  if (built.roof === "tent" || built.roof === "low" || built.roof === "flat") return "none";
  return pickEnum(G[IDX.cornerFlare], ["none", "mild", "upturned", "horn"]);
}

function eavesFormOf(G, built) {
  if (built.eaves !== "deep" && G[IDX.eavesForm] < 0.55) return "plain";
  return pickEnum(G[IDX.eavesForm], ["plain", "bracket", "corbel"]);
}

function facadeOf(G, built) {
  if (built.plan === "camp") return "open";
  return pickEnum(G[IDX.facadeRhythm], ["symmetric", "stepped", "arcade"]);
}

function wallWashOf(G, built) {
  if (built.wall === "felt" || built.wall === "turf") return "natural";
  return pickEnum(G[IDX.wallWash], ["natural", "whitewash", "ochre", "lime"]);
}

function trimOf(G, built) {
  return pickEnum(G[IDX.trimContrast], ["none", "contrast", "dark", "light"]);
}

/** Taste phenotype within the envelope. Cannot override cut, fibre, or wall. */
export function expressTaste(envelope, genome) {
  if (!envelope || !genome || !genome.genes) return { dress: {}, built: {} };
  const G = genome.genes;
  const dress = envelope.dress || {};
  const built = envelope.built || {};
  const look = envelope.look || {};
  return {
    dress: {
      hair: hairStyleOf(G, dress),
      beard: beardStyleOf(G, look, dress),
      embroidery: embroideryOf(G, dress),
      pattern: patternOf(G, dress),
      palette: paletteOf(G, dress),
      jewellery: jewelleryOf(G, dress),
      cosmetics: cosmeticsOf(G, dress),
      headdressStyle: headdressStyleOf(G, dress),
      sleeveFashion: sleeveFashionOf(G, dress),
    },
    built: {
      cornerFlare: cornerFlareOf(G, built),
      eavesForm: eavesFormOf(G, built),
      facade: facadeOf(G, built),
      wallWash: wallWashOf(G, built),
      trim: trimOf(G, built),
    },
  };
}

/** Envelope + taste in one call. No sim wiring — pass genome explicitly. */
export function styleWithTaste(c, genome) {
  const base = styleOf(c);
  return { ...base, taste: expressTaste(base, genome) };
}

export function tasteFingerprint(taste) {
  if (!taste) return "";
  const d = taste.dress || {}, b = taste.built || {};
  return [
    d.hair, d.beard, d.embroidery, d.pattern, d.jewellery,
    d.cosmetics, d.headdressStyle, d.sleeveFashion,
    d.palette && d.palette.layout, b.cornerFlare, b.eavesForm, b.facade, b.wallWash, b.trim,
  ].join("|");
}

export function formatTasteLine(taste) {
  if (!taste) return "";
  const bits = [];
  const d = taste.dress;
  const b = taste.built;
  if (d) bits.push(`${d.hair || ""} ${d.beard || ""} ${d.embroidery || ""} ${d.pattern || ""}`.trim());
  if (b) bits.push(`${b.cornerFlare || ""} ${b.eavesForm || ""} ${b.wallWash || ""}`.trim());
  return bits.join(" · ");
}
