// ── Named tile-material overlay catalog ─────────────────────────────────────
// The classifier (`tileMaterials.js`) names what grows, lives, or sits on a tile.
// This module turns that into map fields + a layer checklist (Economy → Materials),
// parallel to the deposit Resources overlay.

import { tileMaterials, labelOf } from "./tileMaterials.js";
import { CROP_PACKAGES } from "./cropPackages.js";

/** Category order and base hues for stable swatch colours. */
const CATEGORIES = [
  { id: "trees",    label: "Trees & plants", hue: 118 },
  { id: "stone",    label: "Stone",          hue: 28 },
  { id: "dyes",     label: "Dyes",           hue: 290 },
  { id: "fibres",   label: "Fibres",         hue: 42 },
  { id: "crops",    label: "Crops",          hue: 88 },
  { id: "spices",   label: "Spices",         hue: 18 },
  { id: "incense",  label: "Incense",        hue: 38 },
  { id: "furs",     label: "Furs",           hue: 22 },
  { id: "fauna",    label: "Fauna",          hue: 8 },
  { id: "gems",     label: "Gems",           hue: 275 },
  { id: "metals",   label: "Precious metal", hue: 48 },
  { id: "salt",     label: "Salt",           hue: 200 },
  { id: "marine",   label: "Marine",         hue: 205 },
  { id: "geology",  label: "Geology",        hue: 0 },
];

// Id lists — kept in sync with tileMaterials rule tables.
const LAYER_IDS = {
  trees: [
    "pine", "spruce", "larch", "birch", "oak", "beech", "teak", "mahogany", "palm",
    "olive", "grapevine", "acacia", "mulberry", "bamboo", "reed", "papyrus", "date-palm", "cedar",
  ],
  stone: ["granite", "limestone", "marble", "sandstone", "slate", "basalt", "flint"],
  dyes: ["tyrian", "indigo", "madder", "weld", "ochre", "cochineal", "kermes"],
  fibres: ["wool", "cotton", "flax", "hemp", "silk"],
  crops: CROP_PACKAGES.map(p => p.id),
  spices: ["pepper", "cinnamon", "cloves", "nutmeg", "ginger", "tea", "coffee"],
  incense: ["frankincense", "myrrh", "sandalwood", "olibanum"],
  furs: ["sable", "ermine", "fox", "beaver", "seal"],
  fauna: [
    "lion", "leopard", "tiger", "bear", "wolf", "hyena", "horse", "cattle", "bison", "camel",
    "llama", "yak", "elephant", "reindeer", "deer", "elk", "antelope", "boar",
    "crocodile", "hippo", "fish", "salmon",
  ],
  gems: ["ruby", "sapphire", "emerald", "diamond", "pearl"],
  metals: ["gold", "silver"],
  salt: ["sea-salt", "rock-salt"],
  marine: ["coral", "whale", "amber", "mangrove"],
  geology: ["obsidian", "sulfur", "pumice", "metamorphic", "natron"],
};

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function swatchColor(catHue, idx, n) {
  const spread = n > 1 ? (idx / (n - 1)) * 24 - 12 : 0;
  const h = (catHue + spread + (idx * 7) % 9) % 360;
  return hslToRgb(h, 0.52, 0.46);
}

function buildLayer(cat, id, idx, n) {
  const catMeta = CATEGORIES.find(c => c.id === cat);
  return {
    id,
    label: labelOf(id),
    category: cat,
    catLabel: catMeta ? catMeta.label : cat,
    color: swatchColor(catMeta ? catMeta.hue : 0, idx, n),
  };
}

/** Flat layer list for rendering + lookup. */
export const MATERIAL_LAYERS = [];
/** Grouped for the checklist UI. */
export const MATERIAL_CATEGORIES = [];

const _seenIds = new Set();
for (const cat of CATEGORIES) {
  const ids = (LAYER_IDS[cat.id] || []).filter(id => {
    if (_seenIds.has(id)) return false;
    _seenIds.add(id);
    return true;
  });
  const layers = ids.map((id, i) => buildLayer(cat.id, id, i, ids.length));
  if (layers.length) MATERIAL_CATEGORIES.push({ id: cat.id, label: cat.label, layers });
  MATERIAL_LAYERS.push(...layers);
}

export const MATERIAL_BY_ID = Object.fromEntries(MATERIAL_LAYERS.map(l => [l.id, l]));

/** Shared view bag for tileMaterials at sim / map resolution. */
export function materialView(world, ter) {
  return {
    N: ter.tw * ter.th,
    tw: ter.tw,
    th: ter.th,
    seed: world.seed,
    preset: world.preset,
    elev: ter.tElev,
    temp: ter.tTemp,
    moist: ter.tMoist,
    coast: ter.tCoast,
    tFlood: ter.tFlood,
    riverMag: ter.rivers && ter.rivers.riverMag,
    relief: ter.tRelief,
    deposits: ter.deposits,
    pixPlate: world.pixPlate,
    earthPixPlate: world.earthPixPlate,
    boundKind: world.boundKind,
    hotspotDist: world.hotspotDist,
    width: world.width,
    height: world.height,
    tileRes: ter.tw > 0 ? world.width / ter.tw : 1,
    worldRef: world,
    _dryFrac: world.dryFrac,
    _summerDry: world.summerDry,
    realClimateUsed: world.realClimateUsed,
    realWindUsed: world.realWindUsed,
  };
}

const MATERIAL_KEYS = [
  "trees", "stone", "dyes", "fibres", "crops", "spices", "incense", "furs",
  "fauna", "gems", "metals", "salt", "marine", "geology",
];

/**
 * Precompute per-material presence on the territory grid (same resolution as
 * ter.deposits). Called once when the world is forged.
 */
export function buildMaterialFields(world, ter) {
  const N = ter.tw * ter.th;
  if (!N) return {};
  const mv = materialView(world, ter);
  const fields = {};
  for (let ti = 0; ti < N; ti++) {
    const m = tileMaterials(mv, ti);
    for (const key of MATERIAL_KEYS) {
      for (const x of m[key] || []) {
        if (!x || !x.id) continue;
        let arr = fields[x.id];
        if (!arr) {
          arr = new Uint8Array(N);
          fields[x.id] = arr;
        }
        arr[ti] = 1;
      }
    }
  }
  return fields;
}

/** Count tiles where a layer is present (for checklist hints). */
export function layerTileCount(fields, id) {
  const arr = fields && fields[id];
  if (!arr) return 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i]) n++;
  return n;
}
