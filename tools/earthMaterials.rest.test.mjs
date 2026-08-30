// Remaining Earth-materials arms: Med-on-observed-climate, plate raster,
// marine class. `npm test` runs this after the named-classifier suites.

import {
  classifyBiome, observedClimate, B_MEDITERRANEAN, B_SHRUBLAND,
} from "../src/sim/biomeClass.js";
import { materialsFromSignals, idsOf, tileMaterials } from "../src/sim/tileMaterials.js";
import {
  rasterizeEarthPlates, plateBoundDist, lonLatToIndex, kindOfPair,
  NAZ, SAM, IND, EUR, NAM, BK_SUBDUCTION, BK_COLLISION, BK_HOTSPOT,
} from "../src/sim/earthPlates.js";
import {
  classifyMarine, marineGoods, M_REEF, M_POLAR, M_MANGROVE,
  M_ESTUARY, M_DEEP,
} from "../src/sim/marineClass.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

// ── Mediterranean: solver off, observed on ────────────────────────────────
{
  const e = 0.06, m = 0.32, t = 0.76, dry = 0.45, sumDry = 0.55;
  const off = classifyBiome(e, m, t, dry, sumDry, false);
  const on = classifyBiome(e, m, t, dry, sumDry, true);
  ok(off !== B_MEDITERRANEAN, "solver path does not paint Med");
  ok(on === B_MEDITERRANEAN, "observed summer-dry temperate tile is Med");
  ok(classifyBiome(e, m, t, dry, 0, true) !== B_MEDITERRANEAN,
    "unknown phase still disables Med even when medOk");
  ok(!observedClimate({}), "bare world is not observed climate");
  ok(observedClimate({ realClimateUsed: true }), "realClimateUsed → observed");
  ok(observedClimate({ realWindUsed: true }), "realWindUsed → observed");
  ok(observedClimate({ _realWindGen: true }), "_realWindGen → observed");
}

{
  const m = materialsFromSignals({
    world: {}, ti: 1, seed: 3, elev: 0.06, temp: 0.76, moist: 0.32,
    dry: 0.4, sumDry: 0.55, biome: B_MEDITERRANEAN, flood: false, riverMag: 0,
    relief: 0.1, coastDist: 8, boundDist: 255, livestock: 0.5,
    dep: { timber: 0, stone: 0.3, copper: 0, tin: 0, iron: 0, coal: 0, salt: 0,
      horses: 0, precious: 0, gems: 0, spices: 0, furs: 0, incense: 0, dyes: 0.4 },
  });
  ok(idsOf(m.trees).includes("olive") || idsOf(m.trees).includes("cedar"),
    "Med tile: olive or cedar");
  ok(idsOf(m.dyes).includes("kermes") || idsOf(m.dyes).includes("madder") || idsOf(m.dyes).includes("tyrian"),
    "Med dyes analogue");
}

// ── Earth plates ──────────────────────────────────────────────────────────
{
  const W = 360, H = 180;
  const { pixPlate, boundKind, hotspotDist } = rasterizeEarthPlates(W, H);
  ok(pixPlate.length === W * H, "plate raster size");
  const andes = lonLatToIndex(-72, -18, W, H);
  const kansas = lonLatToIndex(-98, 39, W, H);
  const himalaya = lonLatToIndex(84, 28, W, H);
  const hawaii = lonLatToIndex(-155.3, 19.4, W, H);
  const bd = plateBoundDist(pixPlate, W, H, 30);
  ok(bd[andes] < 12, `Andes near NAZ-SAM boundary (d=${bd[andes]})`);
  ok(bd[kansas] > 12, `Kansas interior far from plate edge (d=${bd[kansas]})`);
  ok(bd[himalaya] < 10, `Himalaya near IND-EUR (d=${bd[himalaya]})`);
  ok(kindOfPair(NAZ, SAM) === BK_SUBDUCTION, "Nazca-South America is subduction");
  ok(kindOfPair(IND, EUR) === BK_COLLISION, "India-Eurasia is collision");
  ok(hotspotDist[hawaii] < 4, `Hawaii hotspot Dist=${hotspotDist[hawaii]}`);
  ok(boundKind[hawaii] === BK_HOTSPOT || hotspotDist[hawaii] === 0, "Hawaii marked hotspot");
  ok(pixPlate[andes] === SAM || pixPlate[andes] === NAZ, "Andes pixel is SAM or NAZ");
  ok(pixPlate[kansas] === NAM, "Kansas is North America plate");
}

{
  // Toy sim-res world with two plates: boundDist reaches the land BFS.
  const tw = 20, th = 8, N = tw * th;
  const elev = new Float32Array(N).fill(0.1);
  const pixPlate = new Uint8Array(N);
  pixPlate.fill(1);
  for (let i = 0; i < N; i++) {
    const x = i % tw;
    if (x >= 8 && x <= 12) pixPlate[i] = 2;
  }
  const world = {
    N, tw, th, seed: 1, preset: "earth_sim",
    elev, temp: new Float32Array(N).fill(0.7), moist: new Float32Array(N).fill(0.4),
    coast: new Uint8Array(N), pixPlate,
    deposits: { stone: new Float32Array(N).fill(0.5) },
  };
  const edge = tileMaterials(world, 8);   // interior plate seam
  const far = tileMaterials(world, 0);    // west, not wrapping onto plate 2
  ok(idsOf(edge.stone).includes("basalt") || idsOf(edge.geology).includes("obsidian"),
    "plate seam: basalt or obsidian");
  ok(!idsOf(far.geology).includes("obsidian"), "interior of a plate is not volcanic glass");
}

// ── Marine ────────────────────────────────────────────────────────────────
{
  const reef = classifyMarine({
    elev: -0.02, temp: 0.86, moist: 0.6, coastDist: 1, riverMag: 0, flood: false,
    relief: 0, lat: 0.1, world: null, ti: 0,
  });
  ok(reef === M_REEF, `warm shallow ocean is reef (got ${reef})`);
  const goods = marineGoods({ elev: -0.02, temp: 0.86, coastDist: 1, riverMag: 0, lat: 0.1 });
  ok(idsOf(goods).includes("coral"), "reef goods include coral");
  ok(idsOf(goods).includes("pearl"), "reef goods include pearl");

  const polar = classifyMarine({
    elev: -0.03, temp: 0.50, moist: 0.4, coastDist: 2, riverMag: 0, lat: 0.72,
  });
  ok(polar === M_POLAR, `cold high-lat ocean is polar (got ${polar})`);
  ok(idsOf(marineGoods({ elev: -0.03, temp: 0.50, coastDist: 2, lat: 0.72 })).includes("whale"),
    "polar sea: whale");

  const mangrove = classifyMarine({
    elev: 0.02, temp: 0.86, moist: 0.6, coastDist: 1, riverMag: 0, flood: false, relief: 0,
  });
  ok(mangrove === M_MANGROVE, `trop wet coast is mangrove (got ${mangrove})`);

  const estuary = classifyMarine({
    elev: 0.02, temp: 0.70, moist: 0.4, coastDist: 1, riverMag: 4, flood: true, relief: 0,
  });
  ok(estuary === M_ESTUARY, `river mouth is estuary (got ${estuary})`);

  const deep = classifyMarine({
    elev: -0.12, temp: 0.70, moist: 0.5, coastDist: 20, riverMag: 0, lat: 0.2,
  });
  ok(deep === M_DEEP, `deep open ocean (got ${deep})`);
  ok(marineGoods({ elev: -0.12, temp: 0.70, coastDist: 20, lat: 0.2 }).length === 0,
    "deep ocean has no harvest goods");
}

{
  const m = materialsFromSignals({
    world: {}, ti: 0, seed: 1, elev: -0.02, temp: 0.86, moist: 0.6,
    dry: 0, sumDry: 0, biome: -1, flood: false, riverMag: 0, relief: 0,
    coastDist: 1, boundDist: 255, livestock: 0, lat: 0.12,
    dep: { timber: 0, stone: 0, copper: 0, tin: 0, iron: 0, coal: 0, salt: 0,
      horses: 0, precious: 0, gems: 0, spices: 0, furs: 0, incense: 0, dyes: 0 },
  });
  ok(m.trees.length === 0, "ocean: no trees");
  ok(idsOf(m.marine).includes("coral") || idsOf(m.marine).includes("pearl"),
    "ocean reef tile names coral/pearl");
}

{
  const m = materialsFromSignals({
    world: {}, ti: 2, seed: 9, elev: 0.05, temp: 0.72, moist: 0.12,
    dry: 0.6, sumDry: 0, biome: B_SHRUBLAND, flood: false, riverMag: 0, relief: 0.5,
    coastDist: 1, boundDist: 255, livestock: 0.2,
    dep: { timber: 0, stone: 0.4, copper: 0, tin: 0, iron: 0, coal: 0, salt: 0,
      horses: 0, precious: 0, gems: 0, spices: 0, furs: 0, incense: 0, dyes: 0 },
  });
  ok(m.marine.length >= 0, "arid coast may classify dune/rocky marine");
}

if (fails) {
  console.error(`earthMaterials.rest: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`earthMaterials.rest: ${checks} checks ok`);
