// ── Tile materials — named classification of what grows, lives, or sits here ──
//
// Companion to docs/materials-vocabulary.md and docs/earth-materials.md.
// Pure derivation from existing tile signals. No new deposit arrays, no save
// fields. Range (endemism) is faunaBiogeography.js — climate eligibility here,
// presence there. Cosmopolitan species stay climate-only.
//
// Cardinal rules: classification, not a fitted outcome; no time gates; no
// `if (Nile)`. Earth pins belong in faunaBiogeography.js when that lands.

import { classifyBiome, B_TUNDRA, B_TAIGA, B_BOREAL, B_TEMP_FOREST, B_TEMP_RAIN,
  B_TROP_RAIN, B_SAVANNA, B_GRASSLAND, B_DESERT, B_SHRUBLAND, B_TROP_DRY,
  B_SUBTROP, B_COLD_DESERT, B_MEDITERRANEAN } from "./biomeClass.js";
import { hash32 } from "./peopleSim/rng.js";
import { CROP_PACKAGES, pkgClimateBell } from "./cropPackages.js";
import { livestockClimate } from "./peopleSim/settlement.js";
import { faunaPresent, floraPresent } from "./faunaBiogeography.js";

export const TAU = 0.12;

export const DEPOSIT_IDS = [
  "timber", "stone", "copper", "tin", "iron", "coal", "salt", "horses",
  "precious", "gems", "spices", "furs", "incense", "dyes",
];

const EMPTY = Object.freeze({
  deposits: Object.freeze([]),
  trees: Object.freeze([]),
  stone: Object.freeze([]),
  dyes: Object.freeze([]),
  fibres: Object.freeze([]),
  crops: Object.freeze([]),
  spices: Object.freeze([]),
  incense: Object.freeze([]),
  furs: Object.freeze([]),
  fauna: Object.freeze([]),
  gems: Object.freeze([]),
  metals: Object.freeze([]),
  salt: Object.freeze([]),
});

// Endemism: faunaPresent / floraPresent (faunaBiogeography.js). Cosmopolitan
// species and incomplete worlds stay climate-only.
export { faunaPresent, floraPresent } from "./faunaBiogeography.js";

export function pickNamed(list, seed, ti, tag) {
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return list[hash32(seed >>> 0, ti | 0, tag) % list.length];
}

function at(arr, ti) {
  if (!arr) return 0;
  const v = arr[ti];
  return v == null ? 0 : v;
}

function ensureCoastDist(world) {
  const N = world.N;
  if (world._matCoastDist && world._matCoastDist.length === N) return world._matCoastDist;
  const { tw, th, elev, coast } = world;
  const dist = new Uint8Array(N);
  dist.fill(255);
  if (!elev || !tw) { world._matCoastDist = dist; return dist; }
  const q = [];
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    if (coast && coast[i]) { dist[i] = 0; q.push(i); }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cd = dist[ci];
    if (cd >= 12) continue;
    const cx = ci % tw, cy = (ci - cx) / tw;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = (cx + dx + tw) % tw, ny = cy + dy;
      if (ny < 0 || ny >= th) continue;
      const ni = ny * tw + nx;
      if (dist[ni] <= cd + 1 || elev[ni] <= 0) continue;
      dist[ni] = cd + 1;
      q.push(ni);
    }
  }
  world._matCoastDist = dist;
  return dist;
}

function ensureBoundDist(world) {
  const N = world.N;
  if (world._matBoundDist && world._matBoundDist.length === N) return world._matBoundDist;
  const dist = new Uint8Array(N);
  dist.fill(255);
  const plates = world.pixPlate;
  const { tw, th, elev } = world;
  if (!plates || plates.length !== N || !elev) { world._matBoundDist = dist; return dist; }
  const q = [];
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    const cx = i % tw, cy = (i - cx) / tw;
    const my = plates[i];
    const ns = [cy * tw + (cx === 0 ? tw - 1 : cx - 1), cy * tw + (cx === tw - 1 ? 0 : cx + 1),
      cy > 0 ? i - tw : -1, cy < th - 1 ? i + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni >= 0 && plates[ni] !== my) { dist[i] = 0; q.push(i); break; }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cd = dist[ci];
    if (cd >= 12) continue;
    const cx = ci % tw, cy = (ci - cx) / tw;
    const ns = [cy * tw + (cx === 0 ? tw - 1 : cx - 1), cy * tw + (cx === tw - 1 ? 0 : cx + 1),
      cy > 0 ? ci - tw : -1, cy < th - 1 ? ci + tw : -1];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0 || elev[ni] <= 0 || dist[ni] <= cd + 1) continue;
      dist[ni] = cd + 1;
      q.push(ni);
    }
  }
  world._matBoundDist = dist;
  return dist;
}

function signals(world, ti) {
  const elev = at(world.elev, ti);
  const temp = at(world.temp, ti);
  const moist = at(world.moist, ti);
  const dry = at(world._dryFrac, ti);
  const sumDry = at(world._summerDry, ti);
  const biome = elev > 0 ? classifyBiome(elev, moist, temp, dry, sumDry) : -1;
  const flood = !!(world.tFlood && world.tFlood[ti]);
  const riverMag = at(world.riverMag, ti);
  const relief = at(world.relief, ti);
  const coastDist = ensureCoastDist(world)[ti];
  const boundDist = ensureBoundDist(world)[ti];
  const dep = {};
  const deposits = world.deposits || {};
  for (const id of DEPOSIT_IDS) dep[id] = at(deposits[id], ti);
  return {
    world, ti, seed: (world.seed >>> 0) || 1,
    elev, temp, moist, dry, sumDry, biome, flood, riverMag, relief,
    coastDist, boundDist, dep,
    livestock: livestockClimate(temp, moist),
  };
}

function rich(c, id) { return c.dep[id] || 0; }
function timberOk(c) { return rich(c, "timber") >= TAU; }
function stoneOk(c) { return rich(c, "stone") >= TAU; }

const COLD_FOREST = new Set([B_TAIGA, B_BOREAL]);
const TEMP_WOOD = new Set([B_TEMP_FOREST, B_TEMP_RAIN, B_SUBTROP, B_MEDITERRANEAN]);
const TROP_WET = new Set([B_TROP_RAIN, B_SUBTROP]);
const DRY_OPEN = new Set([B_SAVANNA, B_GRASSLAND, B_SHRUBLAND, B_DESERT, B_COLD_DESERT]);
const ARID = new Set([B_DESERT, B_COLD_DESERT, B_SHRUBLAND]);
const HOT_GRASS = new Set([B_SAVANNA, B_GRASSLAND]);
const MEDISH = new Set([B_MEDITERRANEAN, B_SHRUBLAND]);

function collect(rules, c, tag) {
  const elig = [];
  for (const r of rules) if (r.ok(c)) elig.push(r.id);
  const primary = pickNamed(elig, c.seed, c.ti, tag);
  if (!primary) return [];
  const rest = elig.filter(id => id !== primary);
  const secondary = rest.length && pickNamed(rest, c.seed, c.ti, tag + ":2");
  const out = [{ id: primary }];
  if (secondary) out.push({ id: secondary });
  return out;
}

const TREE_RULES = [
  { id: "pine",       ok: c => (COLD_FOREST.has(c.biome) || (c.elev > 0.25 && c.temp < 0.62)) && timberOk(c) },
  { id: "spruce",     ok: c => COLD_FOREST.has(c.biome) && timberOk(c) },
  { id: "larch",      ok: c => (c.biome === B_TAIGA || (COLD_FOREST.has(c.biome) && c.temp < 0.58)) && timberOk(c) },
  { id: "birch",      ok: c => (c.biome === B_BOREAL || c.biome === B_TUNDRA || (c.biome === B_TEMP_FOREST && c.temp < 0.70)) && timberOk(c) },
  { id: "oak",        ok: c => TEMP_WOOD.has(c.biome) && timberOk(c) },
  { id: "beech",      ok: c => (c.biome === B_TEMP_FOREST || c.biome === B_TEMP_RAIN) && c.moist > 0.45 && timberOk(c) },
  { id: "teak",       ok: c => (c.biome === B_TROP_RAIN || c.biome === B_TROP_DRY) && timberOk(c) },
  { id: "mahogany",   ok: c => c.biome === B_TROP_RAIN && c.moist > 0.65 && timberOk(c) },
  { id: "palm",       ok: c => (c.biome === B_TROP_DRY || c.biome === B_SAVANNA || (c.biome === B_DESERT && c.coastDist <= 3)) && c.moist > 0.25 },
  { id: "olive",      ok: c => c.biome === B_MEDITERRANEAN || (c.biome === B_SHRUBLAND && c.temp > 0.70 && c.temp < 0.84) },
  { id: "acacia",     ok: c => c.biome === B_SAVANNA || c.biome === B_SHRUBLAND || (c.biome === B_DESERT && c.moist > 0.12) },
  { id: "mulberry",   ok: c => (c.biome === B_SUBTROP || c.biome === B_TEMP_RAIN || c.flood) && floraPresent(c.world, c.ti, "mulberry") },
  { id: "bamboo",     ok: c => c.biome === B_TROP_RAIN || c.biome === B_TROP_DRY || (c.biome === B_SUBTROP && c.moist > 0.50) },
  { id: "reed",       ok: c => c.flood || c.riverMag >= 3 },
  { id: "date-palm",  ok: c => (c.biome === B_DESERT || c.biome === B_COLD_DESERT) && (c.coastDist <= 4 || c.riverMag >= 1) },
  { id: "cedar",      ok: c => c.biome === B_MEDITERRANEAN || (c.elev > 0.18 && c.biome === B_SHRUBLAND) || (c.biome === B_TEMP_FOREST && c.moist < 0.40) },
];

function treesOf(c) {
  const elig = TREE_RULES.filter(r => r.ok(c)).map(r => r.id);
  const primary = pickNamed(elig, c.seed, c.ti, "tree");
  if (!primary) return [];
  const out = [{ id: primary, richness: Math.max(rich(c, "timber"), 0.2) }];
  const rest = elig.filter(id => id !== primary);
  if (rest.length && rich(c, "timber") >= 0.45) {
    const second = pickNamed(rest, c.seed, c.ti, "tree:2");
    if (second) out.push({ id: second, richness: rich(c, "timber") * 0.6 });
  }
  return out;
}

function mulberryEligible(c) {
  return TREE_RULES.find(r => r.id === "mulberry").ok(c);
}

const STONE_RULES = [
  { id: "granite",    ok: c => stoneOk(c) && (c.elev > 0.30 || c.relief > 0.45) },
  { id: "limestone",  ok: c => stoneOk(c) && (c.elev < 0.12 || c.coastDist <= 4 || c.flood) && c.moist > 0.4 },
  { id: "marble",     ok: c => stoneOk(c) && (c.elev > 0.30 || c.relief > 0.45) && c.temp > 0.65 && c.moist >= 0.35 && c.moist <= 0.55 },
  { id: "sandstone",  ok: c => stoneOk(c) && DRY_OPEN.has(c.biome) },
  { id: "slate",      ok: c => stoneOk(c) && c.elev > 0.20 && c.moist > 0.45 },
  { id: "basalt",     ok: c => stoneOk(c) && c.boundDist < 8 && c.elev > 0.08 },
  { id: "flint",      ok: c => stoneOk(c) && (c.elev < 0.12 || c.coastDist <= 4 || c.flood) && c.moist > 0.4 && c.temp >= 0.60 && c.temp <= 0.75 },
];

function stoneOf(c) {
  const ids = collect(STONE_RULES, c, "stone");
  return ids.map(({ id }) => ({ id, richness: rich(c, "stone") }));
}

const DYE_RULES = [
  { id: "tyrian",     ok: c => rich(c, "dyes") >= TAU && c.coastDist <= 4 },
  { id: "indigo",     ok: c => rich(c, "dyes") >= TAU && c.moist > 0.5 && (TROP_WET.has(c.biome) || c.biome === B_TEMP_RAIN) },
  { id: "madder",     ok: c => rich(c, "dyes") >= TAU && (c.biome === B_GRASSLAND || c.biome === B_MEDITERRANEAN || (c.biome === B_SUBTROP && c.moist < 0.5)) && !(TROP_WET.has(c.biome) && c.moist > 0.5) },
  { id: "weld",       ok: c => rich(c, "dyes") >= TAU && c.temp >= 0.58 && c.temp <= 0.78 && c.moist >= 0.35 && c.moist <= 0.55 },
  { id: "ochre",      ok: c => DRY_OPEN.has(c.biome) },
  { id: "cochineal",  ok: c => rich(c, "dyes") >= TAU && (c.biome === B_TROP_DRY || (c.biome === B_SUBTROP && c.moist < 0.45)) },
  { id: "kermes",     ok: c => rich(c, "dyes") >= TAU && MEDISH.has(c.biome) },
];

function dyesOf(c) {
  const elig = DYE_RULES.filter(r => r.ok(c)).map(r => r.id);
  // Coastal purple is the distinctive split — always keep it when the coast
  // qualifies, then fill remaining slots by pick.
  const out = [];
  if (elig.includes("tyrian")) out.push("tyrian");
  const rest = elig.filter(id => id !== "tyrian");
  while (out.length < 2 && rest.length) {
    const id = pickNamed(rest, c.seed, c.ti, "dye:" + out.length);
    if (!id) break;
    out.push(id);
    const i = rest.indexOf(id);
    if (i >= 0) rest.splice(i, 1);
  }
  return out.map(id => ({
    id,
    richness: id === "ochre" ? Math.max(0.15, rich(c, "stone") * 0.4) : rich(c, "dyes"),
  }));
}

function fibresOf(c) {
  const out = [];
  const m = c.flood ? Math.max(c.moist, 0.5) : c.moist;
  if (Math.abs(c.temp - 0.45) < 0.12 && c.livestock > 0.35) out.push({ id: "wool", suit: c.livestock });
  if (c.temp > 0.55 && m > 0.4) out.push({ id: "cotton", suit: Math.min(1, (c.temp - 0.55) * 2) });
  if (c.temp >= 0.58 && c.temp <= 0.78 && m >= 0.35 && m <= 0.65) {
    out.push({ id: "flax", suit: 1 - Math.abs(c.temp - 0.68) });
  }
  if (c.temp > 0.52 && m > 0.45) {
    const suit = Math.min(1, 0.5 + (c.riverMag >= 1 ? 0.25 : 0));
    out.push({ id: "hemp", suit });
  }
  if (mulberryEligible(c) && (c.biome === B_SUBTROP || c.biome === B_TEMP_RAIN) && m > 0.45) {
    out.push({ id: "silk", suit: 0.7 });
  }
  return out;
}

function cropsOf(c) {
  const scored = [];
  for (const pkg of CROP_PACKAGES) {
    const suit = pkgClimateBell(pkg, c.temp, c.moist);
    if (suit > 0.25) scored.push({ id: pkg.id, suit });
  }
  scored.sort((a, b) => b.suit - a.suit);
  return scored.slice(0, 2);
}

const SPICE_RULES = [
  { id: "pepper",     ok: c => rich(c, "spices") >= TAU && (c.biome === B_TROP_RAIN || c.biome === B_TROP_DRY) },
  { id: "cinnamon",   ok: c => rich(c, "spices") >= TAU && ((c.biome === B_TROP_RAIN && c.moist > 0.6) || (c.biome === B_SUBTROP && c.moist > 0.55)) },
  { id: "cloves",     ok: c => rich(c, "spices") >= TAU && c.biome === B_TROP_RAIN && c.moist > 0.55 && floraPresent(c.world, c.ti, "cloves") },
  { id: "nutmeg",     ok: c => rich(c, "spices") >= TAU && c.biome === B_TROP_RAIN && c.coastDist <= 6 && floraPresent(c.world, c.ti, "nutmeg") },
  { id: "ginger",     ok: c => rich(c, "spices") >= TAU && (c.biome === B_SUBTROP || c.biome === B_TROP_DRY) },
];

const INCENSE_RULES = [
  { id: "frankincense", ok: c => rich(c, "incense") >= TAU && (c.biome === B_DESERT || c.biome === B_SHRUBLAND) && floraPresent(c.world, c.ti, "frankincense") },
  { id: "myrrh",        ok: c => rich(c, "incense") >= TAU && (c.biome === B_DESERT || (c.biome === B_SHRUBLAND && c.moist < 0.28)) && floraPresent(c.world, c.ti, "myrrh") },
  { id: "sandalwood",   ok: c => rich(c, "incense") >= TAU && (c.biome === B_TROP_DRY || c.biome === B_SUBTROP) },
  { id: "olibanum",     ok: c => rich(c, "incense") >= TAU && (c.biome === B_COLD_DESERT || (c.biome === B_DESERT && c.elev > 0.18)) },
];

const FUR_RULES = [
  { id: "sable",   ok: c => rich(c, "furs") >= TAU && COLD_FOREST.has(c.biome) },
  { id: "ermine",  ok: c => rich(c, "furs") >= TAU && (c.biome === B_TUNDRA || (c.biome === B_BOREAL && c.temp < 0.55)) },
  { id: "fox",     ok: c => rich(c, "furs") >= TAU && (COLD_FOREST.has(c.biome) || c.biome === B_TUNDRA) },
  { id: "beaver",  ok: c => rich(c, "furs") >= TAU && (c.biome === B_BOREAL || c.biome === B_TEMP_FOREST) && c.riverMag >= 2 },
  { id: "seal",    ok: c => c.coastDist <= 2 && c.temp < 0.55 },
];

function withRich(rules, c, tag, depId) {
  return collect(rules, c, tag).map(({ id }) => ({
    id,
    richness: id === "seal" ? 0.35 : rich(c, depId),
  }));
}

const FAUNA_RULES = [
  { id: "lion",      ok: c => HOT_GRASS.has(c.biome) && c.temp > 0.70 && c.moist >= 0.25 && c.moist <= 0.55 },
  { id: "leopard",   ok: c => c.biome === B_SAVANNA || c.biome === B_SHRUBLAND || c.biome === B_TROP_DRY },
  { id: "tiger",     ok: c => (c.biome === B_TROP_RAIN || c.biome === B_SUBTROP) && c.moist > 0.55 },
  { id: "bear",      ok: c => (COLD_FOREST.has(c.biome) || c.biome === B_TEMP_FOREST) && c.moist > 0.35 },
  { id: "wolf",      ok: c => (COLD_FOREST.has(c.biome) || c.biome === B_GRASSLAND || c.biome === B_TEMP_FOREST) && c.temp < 0.72 },
  { id: "hyena",     ok: c => c.biome === B_SAVANNA || (c.biome === B_SHRUBLAND && c.temp > 0.72) },
  { id: "horse",     ok: c => rich(c, "horses") >= TAU || c.biome === B_GRASSLAND || (c.biome === B_SHRUBLAND && c.temp < 0.70) },
  { id: "cattle",    ok: c => (c.biome === B_GRASSLAND || c.biome === B_SAVANNA || c.biome === B_MEDITERRANEAN) && c.livestock > 0.45 },
  { id: "bison",     ok: c => (c.biome === B_GRASSLAND || (c.biome === B_SHRUBLAND && c.temp < 0.70)) && c.temp >= 0.45 && c.temp <= 0.70 },
  { id: "camel",     ok: c => ARID.has(c.biome) },
  { id: "elephant",  ok: c => (c.biome === B_SAVANNA || c.biome === B_TROP_DRY) && c.moist > 0.30 },
  { id: "reindeer",  ok: c => (c.biome === B_TUNDRA || c.biome === B_TAIGA) && c.temp < 0.58 },
  { id: "deer",      ok: c => c.biome === B_TEMP_FOREST || c.biome === B_BOREAL || c.biome === B_TEMP_RAIN },
  { id: "elk",       ok: c => COLD_FOREST.has(c.biome) || (c.biome === B_TEMP_FOREST && c.temp < 0.68) },
  { id: "antelope",  ok: c => c.biome === B_GRASSLAND || c.biome === B_SAVANNA || (c.biome === B_SHRUBLAND && c.moist < 0.35) },
  { id: "boar",      ok: c => c.biome === B_TEMP_FOREST || c.biome === B_MEDITERRANEAN || c.biome === B_SUBTROP },
  { id: "crocodile", ok: c => (c.temp > 0.78) && (c.riverMag >= 2 || c.flood) },
  { id: "hippo",     ok: c => (c.biome === B_SAVANNA || c.biome === B_TROP_RAIN || c.biome === B_TROP_DRY) && c.riverMag >= 3 && c.moist > 0.45 },
  { id: "fish",      ok: c => c.coastDist <= 3 || c.riverMag >= 1 },
  { id: "salmon",    ok: c => (c.coastDist <= 3 || c.riverMag >= 1) && c.temp >= 0.45 && c.temp <= 0.65 },
];

function faunaOf(c) {
  const elig = FAUNA_RULES.filter(r => r.ok(c) && faunaPresent(c.world, c.ti, r.id)).map(r => r.id);
  const out = [];
  const used = new Set();
  const tags = ["fauna:pred", "fauna:herd", "fauna:game", "fauna:wet"];
  for (const tag of tags) {
    const pool = elig.filter(id => !used.has(id));
    const id = pickNamed(pool, c.seed, c.ti, tag);
    if (!id) continue;
    used.add(id);
    out.push({ id, abundance: 0.45 + (hash32(c.seed, c.ti, id) % 50) / 100 });
  }
  return out;
}

function gemsOf(c) {
  if (rich(c, "gems") < TAU) return [];
  const elig = ["ruby", "sapphire", "emerald", "diamond"];
  if (c.coastDist <= 3) elig.push("pearl");
  const id = pickNamed(elig, c.seed, c.ti, "gem");
  return id ? [{ id, richness: rich(c, "gems") }] : [];
}

function metalsOf(c) {
  if (rich(c, "precious") < TAU) return [];
  const elig = [];
  if (c.riverMag >= 2 || c.elev > 0.15) elig.push("gold");
  if (c.elev > 0.18 && c.riverMag < 2) elig.push("silver");
  if (!elig.length) elig.push("gold");
  const id = pickNamed(elig, c.seed, c.ti, "metal");
  return id ? [{ id, richness: rich(c, "precious") }] : [];
}

function saltOf(c) {
  if (rich(c, "salt") < TAU) return [];
  const id = c.coastDist <= 3 ? "sea-salt" : "rock-salt";
  return [{ id, richness: rich(c, "salt") }];
}

function depositsOf(c) {
  const out = [];
  for (const id of DEPOSIT_IDS) {
    const richness = rich(c, id);
    if (richness > 0.05) out.push({ id, richness });
  }
  out.sort((a, b) => b.richness - a.richness);
  return out;
}

/** Core classifier — tests may pass a hand-built signal bag. */
export function materialsFromSignals(c) {
  if (!(c.elev > 0)) return EMPTY;
  return {
    deposits: depositsOf(c),
    trees: treesOf(c),
    stone: stoneOf(c),
    dyes: dyesOf(c),
    fibres: fibresOf(c),
    crops: cropsOf(c),
    spices: withRich(SPICE_RULES, c, "spice", "spices"),
    incense: withRich(INCENSE_RULES, c, "incense", "incense"),
    furs: withRich(FUR_RULES, c, "fur", "furs"),
    fauna: faunaOf(c),
    gems: gemsOf(c),
    metals: metalsOf(c),
    salt: saltOf(c),
  };
}

export function tileMaterials(world, ti) {
  if (!world || ti == null || ti < 0) return EMPTY;
  const N = world.N != null ? world.N : (world.elev && world.elev.length) || 0;
  if (ti >= N) return EMPTY;
  return materialsFromSignals(signals(world, ti));
}

export function idsOf(list) {
  return (list || []).map(x => x.id);
}
