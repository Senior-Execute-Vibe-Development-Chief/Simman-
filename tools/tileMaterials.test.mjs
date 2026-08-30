// Named tile-materials classifier (`src/sim/tileMaterials.js`).
// Climate-eligibility cases — endemism is a later hook (faunaPresent ≡ true).
// `npm test` runs this after the smoke suite.

import {
  B_TAIGA, B_BOREAL, B_TEMP_FOREST, B_TEMP_RAIN, B_TROP_RAIN, B_SAVANNA,
  B_GRASSLAND, B_DESERT, B_SHRUBLAND, B_TROP_DRY, B_SUBTROP, B_TUNDRA,
} from "../src/sim/biomeClass.js";
import { materialsFromSignals, tileMaterials, idsOf, TAU } from "../src/sim/tileMaterials.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

function ctx(over = {}) {
  const dep = {
    timber: 0, stone: 0, copper: 0, tin: 0, iron: 0, coal: 0, salt: 0,
    horses: 0, precious: 0, gems: 0, spices: 0, furs: 0, incense: 0, dyes: 0,
    ...(over.dep || {}),
  };
  return {
    world: {}, ti: 3, seed: 8817,
    elev: 0.08, temp: 0.70, moist: 0.45, dry: 0, sumDry: 0,
    biome: B_TEMP_FOREST, flood: false, riverMag: 0, relief: 0.1,
    coastDist: 20, boundDist: 255, livestock: 0.4,
    ...over,
    dep: { ...dep, ...(over.dep || {}) },
  };
}

function has(list, id) { return idsOf(list).includes(id); }
function noneOf(list, ids) { return ids.every(id => !has(list, id)); }

// ── ocean ──────────────────────────────────────────────────────────────────
{
  const empty = materialsFromSignals(ctx({ elev: 0 }));
  ok(empty.trees.length === 0 && empty.fauna.length === 0, "ocean: no land materials");
}

// ── determinism ────────────────────────────────────────────────────────────
{
  const a = materialsFromSignals(ctx({ biome: B_SAVANNA, temp: 0.82, moist: 0.38, dep: { timber: 0.4 } }));
  const b = materialsFromSignals(ctx({ biome: B_SAVANNA, temp: 0.82, moist: 0.38, dep: { timber: 0.4 } }));
  ok(JSON.stringify(a) === JSON.stringify(b), "same signals → identical JSON");
}

// ── boreal / taiga ─────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_TAIGA, temp: 0.54, moist: 0.55, dep: { timber: 0.5, furs: 0.6 }, livestock: 0.05,
  }));
  ok(has(m.trees, "pine") || has(m.trees, "spruce") || has(m.trees, "larch"), "taiga: conifer");
  ok(noneOf(m.trees, ["teak", "mahogany", "palm"]), "taiga: no tropical timber");
  ok(has(m.furs, "sable") || has(m.furs, "fox"), "taiga: cold furs");
  ok(has(m.fauna, "bear") || has(m.fauna, "wolf") || has(m.fauna, "elk") || has(m.fauna, "reindeer"), "taiga: cold fauna");
  ok(!has(m.fauna, "lion") && !has(m.fauna, "tiger"), "taiga: no savanna/trop cats");
}

{
  const m = materialsFromSignals(ctx({
    biome: B_BOREAL, temp: 0.56, moist: 0.50, dep: { timber: 0.4, furs: 0.5 }, livestock: 0.1,
  }));
  ok(has(m.trees, "pine") || has(m.trees, "spruce") || has(m.trees, "birch"), "boreal: northern tree");
  ok(has(m.fauna, "bear") || has(m.fauna, "wolf") || has(m.fauna, "elk"), "boreal: cold forest fauna");
}

// ── Sahel / savanna ────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_SAVANNA, temp: 0.84, moist: 0.38, dep: { timber: 0.2 }, livestock: 0.55,
  }));
  ok(has(m.trees, "acacia") || has(m.trees, "palm"), "savanna: acacia/palm");
  ok(noneOf(m.trees, ["pine", "oak", "spruce"]), "savanna: no boreal/temperate oak as primary band");
  ok(has(m.fauna, "lion") || has(m.fauna, "antelope") || has(m.fauna, "elephant") || has(m.fauna, "cattle"),
    "savanna: grassland fauna");
  ok(!has(m.fauna, "reindeer") && !has(m.fauna, "tiger"), "savanna: no reindeer/tiger");
  ok(has(m.crops, "sorghum") || has(m.crops, "millet") || has(m.crops, "maize"), "savanna: dry-warm crop");
}

// ── temperate forest ───────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_TEMP_FOREST, temp: 0.70, moist: 0.50, dep: { timber: 0.6, stone: 0.4 }, livestock: 0.5,
  }));
  ok(has(m.trees, "oak") || has(m.trees, "beech") || has(m.trees, "birch"), "temp forest: oak/beech/birch");
  ok(noneOf(m.trees, ["teak", "mahogany"]), "temp forest: no teak");
  ok(has(m.fauna, "deer") || has(m.fauna, "boar") || has(m.fauna, "bear") || has(m.fauna, "wolf"), "temp forest: woodland fauna");
}

// ── trop rain ──────────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_TROP_RAIN, temp: 0.88, moist: 0.72, dep: { timber: 0.7, spices: 0.5, dyes: 0.4 },
    livestock: 0.1,
  }));
  ok(has(m.trees, "teak") || has(m.trees, "mahogany") || has(m.trees, "bamboo"), "trop rain: trop timber");
  ok(noneOf(m.trees, ["pine", "oak", "spruce"]), "trop rain: no pine/oak");
  ok(has(m.spices, "pepper") || has(m.spices, "cinnamon") || has(m.spices, "cloves"), "trop rain: spices");
  ok(has(m.dyes, "indigo"), "trop rain + dyes: indigo");
  ok(!has(m.fauna, "lion"), "trop rain: not lion country");
}

// ── Nile-class floodplain ──────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_DESERT, temp: 0.82, moist: 0.22, flood: true, riverMag: 4,
    dep: { stone: 0.3, dyes: 0.2 }, livestock: 0.5,
  }));
  ok(has(m.trees, "reed") || has(m.trees, "mulberry") || has(m.trees, "date-palm") || has(m.trees, "papyrus"), "floodplain: reed/mulberry/date/papyrus");
  ok(has(m.fauna, "crocodile") || has(m.fauna, "hippo") || has(m.fauna, "fish"), "floodplain: river fauna");
  ok(has(m.fibres, "flax") || has(m.fibres, "cotton") || has(m.fibres, "hemp"), "floodplain: fibre plants");
}

// ── Tyrian coast ───────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_SHRUBLAND, temp: 0.76, moist: 0.32, coastDist: 1, dep: { dyes: 0.5 },
  }));
  ok(has(m.dyes, "tyrian"), "coast + dyes: tyrian");
}

// ── mulberry / silk belt ───────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_SUBTROP, temp: 0.82, moist: 0.55, dep: { timber: 0.3 },
  }));
  ok(has(m.trees, "mulberry") || has(m.trees, "oak") || has(m.trees, "bamboo"), "subtrop: mulberry possible");
  ok(has(m.fibres, "silk") || has(m.trees, "mulberry"), "subtrop wet: silk or mulberry precursor");
}

// ── desert incense + camel ─────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_DESERT, temp: 0.86, moist: 0.08, riverMag: 2, dep: { incense: 0.5, salt: 0.4 },
    livestock: 0.05,
  }));
  ok(has(m.incense, "frankincense") || has(m.incense, "myrrh") || has(m.incense, "olibanum"), "desert: incense");
  ok(has(m.fauna, "camel"), "desert: camel");
  ok(has(m.trees, "date-palm"), "desert river: date-palm");
  ok(has(m.salt, "rock-salt"), "interior salt: rock-salt");
}

// ── sea salt on coast ──────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_GRASSLAND, temp: 0.68, moist: 0.40, coastDist: 2, dep: { salt: 0.4 },
  }));
  ok(has(m.salt, "sea-salt"), "coast salt: sea-salt");
}

// ── horses deposit ─────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_GRASSLAND, temp: 0.62, moist: 0.35, dep: { horses: 0.5 }, livestock: 0.6,
  }));
  ok(has(m.fauna, "horse") || has(m.deposits, "horses"), "steppe: horse");
}

// ── tileMaterials on a mini world ──────────────────────────────────────────
{
  const N = 16, tw = 4, th = 4;
  const elev = new Float32Array(N).fill(0.1);
  const temp = new Float32Array(N).fill(0.70);
  const moist = new Float32Array(N).fill(0.48);
  const coast = new Uint8Array(N);
  coast[0] = 1;
  elev[15] = 0;
  const timber = new Float32Array(N).fill(0.5);
  const world = {
    N, tw, th, seed: 1, elev, temp, moist, coast, tFlood: new Uint8Array(N),
    riverMag: new Float32Array(N), deposits: { timber },
  };
  const land = tileMaterials(world, 1);
  const sea = tileMaterials(world, 15);
  ok(land.trees.length + land.fauna.length > 0, "mini world land tile has materials");
  ok(sea.trees.length === 0 && sea.deposits.length === 0, "mini world ocean tile empty");
  const again = tileMaterials(world, 1);
  ok(JSON.stringify(land) === JSON.stringify(again), "tileMaterials determinism on world");
}

// ── TAU gate ───────────────────────────────────────────────────────────────
{
  const m = materialsFromSignals(ctx({
    biome: B_TROP_RAIN, temp: 0.88, moist: 0.7, dep: { spices: TAU - 0.01, timber: 0.5 },
  }));
  ok(!has(m.spices, "pepper") && !has(m.spices, "cinnamon") && !has(m.spices, "ginger"),
    "spices below TAU do not name");
}

if (fails) {
  console.error(`tileMaterials: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`tileMaterials: ${checks} checks ok`);
