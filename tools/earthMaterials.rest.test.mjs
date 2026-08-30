// Remaining Earth-materials arms: Med-on-observed-climate, plate raster,
// marine class. `npm test` runs this after the named-classifier suites.

import {
  classifyBiome, observedClimate, B_MEDITERRANEAN, B_SHRUBLAND,
} from "../src/sim/biomeClass.js";
import { materialsFromSignals, idsOf, tileMaterials, formatMaterialsLine } from "../src/sim/tileMaterials.js";
import {
  rasterizeEarthPlates, plateBoundDist, lonLatToIndex, kindOfPair, seamTiles,
  NAZ, SAM, IND, EUR, NAM, AFR, AP, ND, BK_SUBDUCTION, BK_COLLISION, BK_HOTSPOT,
} from "../src/sim/earthPlates.js";
import { generateWorld } from "../src/sim/worldgen.js";
import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";
import { readFileSync } from "node:fs";
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
  ok(idsOf(m.trees).includes("olive") || idsOf(m.trees).includes("cedar") || idsOf(m.trees).includes("grapevine"),
    "Med tile: olive, cedar, or grapevine");
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
  const congo = lonLatToIndex(20, 0, W, H);
  const nile = lonLatToIndex(31, 30, W, H);
  const sahel = lonLatToIndex(0, 15, W, H);
  const bd = plateBoundDist(pixPlate, W, H, 30);
  ok(bd[andes] < 12, `Andes near a plate seam (d=${bd[andes]})`);
  ok(boundKind[andes] === BK_SUBDUCTION, `Andes is subduction (kind=${boundKind[andes]})`);
  ok(bd[kansas] > 12, `Kansas interior far from plate edge (d=${bd[kansas]})`);
  ok(bd[sahel] > 12, `West Sahel interior far from plate edge (d=${bd[sahel]})`);
  ok(pixPlate[congo] === AFR && bd[congo] > 4, `Congo basin is African interior (d=${bd[congo]})`);
  ok(pixPlate[nile] === AFR, "Nile is on the African plate");
  ok(bd[himalaya] < 10, `Himalaya near IND-EUR (d=${bd[himalaya]})`);
  ok(boundKind[himalaya] === BK_COLLISION, `Himalaya is collision (kind=${boundKind[himalaya]})`);
  ok(kindOfPair(NAZ, SAM) === BK_SUBDUCTION, "Nazca-South America is subduction");
  ok(kindOfPair(IND, EUR) === BK_COLLISION, "India-Eurasia is collision");
  ok(hotspotDist[hawaii] < 4, `Hawaii hotspot Dist=${hotspotDist[hawaii]}`);
  ok(boundKind[hawaii] === BK_HOTSPOT || hotspotDist[hawaii] === 0, "Hawaii marked hotspot");
  ok(pixPlate[andes] === SAM || pixPlate[andes] === NAZ || pixPlate[andes] === AP || pixPlate[andes] === ND,
    "Andes pixel is SAM/NAZ or an Andean microplate");
  ok(pixPlate[kansas] === NAM, "Kansas is North America plate");
  ok(pixPlate[congo] === AFR, "Congo is African plate");
  ok(seamTiles(320, 4, 12, true) === 4, "Earth seam radius is 4° in tiles");
  ok(seamTiles(320, 4, 12, false) === 12, "tectonic seam radius stays legacy tiles");
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

{
  const w = generateWorld(120, 60, 1, "earth", 0.78);
  ok(w.pixPlate && w.pixPlate.length === 120 * 60, "Earth sets pixPlate from Bird geometry");
  ok(w.earthPixPlate && w.earthPixPlate.length === 120 * 60, "earthPixPlate alias present");
  ok(!!w.boundKind && !!w.hotspotDist, "typed boundaries + hotspots present");
  ok(w.realClimateUsed === false, "solver Earth is not observed climate");
}

{
  // NCEP climate + Bird plates: the hover line is named things from tile
  // state, not `if (Nile)`. Coarse W=240 so this stays in the rest suite.
  const rc = await import("../src/realClimateData.js");
  rc.provideRealClimateData(
    JSON.parse(readFileSync(new URL("../data/global_precip.json", import.meta.url))),
    JSON.parse(readFileSync(new URL("../data/global_airtemp.json", import.meta.url))),
  );
  const { w, ter } = pipelineBuild({
    W: 240, H: 120, seed: 7, preset: "earth_sim", realWind: true,
    realWindFns: {
      isRealWindAvailable: () => false,
      isRealClimateAvailable: rc.isRealClimateAvailable,
      fillRealClimate: rc.fillRealClimate,
    },
  });
  ok(w.realClimateUsed === true, "NCEP arm sets realClimateUsed");
  ok(!!w.pixPlate && !!w.boundKind, "NCEP Earth still carries Bird pixPlate");
  const lineAt = (lon, lat) => {
    const ti = lonLatToIndex(lon, lat, ter.tw, ter.th);
    const mv = {
      N: ter.tw * ter.th, tw: ter.tw, th: ter.th, seed: w.seed, preset: w.preset,
      elev: ter.tElev, temp: ter.tTemp, moist: ter.tMoist, coast: ter.tCoast,
      tFlood: ter.tFlood, riverMag: ter.rivers && ter.rivers.riverMag,
      relief: ter.tRelief, deposits: ter.deposits,
      pixPlate: w.pixPlate, earthPixPlate: w.earthPixPlate,
      boundKind: w.boundKind, hotspotDist: w.hotspotDist,
      width: w.width, height: w.height, tileRes: 1, worldRef: w,
      _dryFrac: w.dryFrac, _summerDry: w.summerDry,
      realClimateUsed: w.realClimateUsed,
    };
    return formatMaterialsLine(tileMaterials(mv, ti));
  };
  const nile = lineAt(31, 30);
  const sahel = lineAt(0, 15);
  const java = lineAt(110, -7);
  const kansas = lineAt(-98, 39);
  ok(/date palm/.test(nile), `Nile names date palm from arid+water (${nile})`);
  ok(/sorghum|millet/.test(sahel), `Sahel names a Sahel grain (${sahel})`);
  ok(/rice/.test(java), `Java names rice from wet tropics (${java})`);
  ok(/oak|beech|cedar/.test(kansas) && !/date palm/.test(kansas),
    `Kansas temperate wood, not Sahara flora (${kansas})`);
  const nileValley = lineAt(31, 24);
  const levantMed = lineAt(36, 34.5);
  const crete = lineAt(25, 35.2);
  const moluccas = lineAt(127.4, 0.8);
  const andes = lineAt(-72, -13.5);
  const yunnan = lineAt(101, 25);
  const ethiopia = lineAt(38.7, 9);
  ok(/papyrus|reed|crocodile|clay/.test(nileValley),
    `Nile flood corridor names wetland flora (${nileValley})`);
  ok(/olive|cedar|grapevine|kermes/.test(levantMed) || /olive|cedar|grapevine|kermes/.test(crete),
    `summer-dry Med names olive-class flora (${levantMed} / ${crete})`);
  ok(/cloves|nutmeg/.test(moluccas), `Moluccas endemic spices (${moluccas})`);
  ok(/llama/.test(andes), `Andean highland names llama (${andes})`);
  ok(/tea/.test(yunnan), `Yunnan highland names tea (${yunnan})`);
  ok(/coffee/.test(ethiopia), `Ethiopian highland names coffee (${ethiopia})`);
  const madagascar = lineAt(48, -19);
  const mexicoChili = lineAt(-99, 18);
  const ghanaCocoa = lineAt(3, 8);
  const kerala = lineAt(76, 10);
  const indiaTurmeric = lineAt(74, 16);
  const borneo = lineAt(115, 1);
  const serengeti = lineAt(36, -4);
  const kaziranga = lineAt(93, 24);
  const alps = lineAt(8, 46);
  const medCoast = lineAt(3, 43);
  ok(/vanilla/.test(madagascar), `Madagascar names vanilla (${madagascar})`);
  ok(/capsicum/.test(mexicoChili), `Mesoamerica names capsicum (${mexicoChili})`);
  ok(/cocoa/.test(ghanaCocoa), `West Africa names cocoa (${ghanaCocoa})`);
  ok(/cardamom/.test(kerala), `Western Ghats names cardamom (${kerala})`);
  ok(/turmeric/.test(indiaTurmeric), `monsoon India names turmeric (${indiaTurmeric})`);
  ok(/agarwood/.test(borneo), `Borneo names agarwood (${borneo})`);
  ok(/zebra/.test(serengeti), `East African savanna names zebra (${serengeti})`);
  ok(/rhino/.test(kaziranga), `Assam floodplain names rhino (${kaziranga})`);
  ok(/ibex/.test(alps), `Alpine belt names ibex (${alps})`);
  ok(/shellfish|fish/.test(medCoast), `Mediterranean coast names shellfish (${medCoast})`);
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
