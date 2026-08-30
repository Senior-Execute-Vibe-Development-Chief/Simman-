// Earth / procedural endemism (`src/sim/faunaBiogeography.js`).
import { classifyBiome, B_SAVANNA } from "../src/sim/biomeClass.js";
import {
  faunaPresent, floraPresent, ensureFaunaFields, mapDist, isEarthPreset,
} from "../src/sim/faunaBiogeography.js";
import { materialsFromSignals, idsOf } from "../src/sim/tileMaterials.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

function fillBlob(elev, tw, th, fx, fy, r) {
  const N = tw * th;
  for (let ti = 0; ti < N; ti++) {
    const y = (ti / tw) | 0, x = ti - y * tw;
    if (mapDist((x + 0.5) / tw, (y + 0.5) / th, fx, fy) < r) elev[ti] = 0.1;
  }
}

function nearestLand(world, fx, fy) {
  const { tw, th, elev } = world;
  let best = -1, bestD = Infinity;
  for (let ti = 0; ti < world.N; ti++) {
    if (elev[ti] <= 0) continue;
    const y = (ti / tw) | 0, x = ti - y * tw;
    const d = mapDist((x + 0.5) / tw, (y + 0.5) / th, fx, fy);
    if (d < bestD) { bestD = d; best = ti; }
  }
  return best;
}

function earthToy() {
  const tw = 180, th = 90, N = tw * th;
  const elev = new Float32Array(N);
  fillBlob(elev, tw, th, 0.55, 0.48, 0.07);  // Africa
  fillBlob(elev, tw, th, 0.28, 0.50, 0.07);  // Amazon
  fillBlob(elev, tw, th, 0.76, 0.38, 0.06);  // India
  const temp = new Float32Array(N).fill(0.84);
  const moist = new Float32Array(N).fill(0.38);
  const dry = new Float32Array(N).fill(0.3);
  return {
    N, tw, th, elev, temp, moist, _dryFrac: dry, seed: 8817, preset: "earth_sim",
  };
}

{
  ok(mapDist(0.1, 0.5, 0.9, 0.5) < 0.25, "mapDist wraps longitude");
  ok(mapDist(0.55, 0.48, 0.28, 0.50) > 0.20, "Africa–Amazon farther than lion African reach");
}

{
  const w = earthToy();
  ok(isEarthPreset(w), "earth_sim is Earth");
  const africa = nearestLand(w, 0.55, 0.48);
  const amazon = nearestLand(w, 0.28, 0.50);
  const india = nearestLand(w, 0.76, 0.38);
  ok(africa >= 0 && amazon >= 0 && india >= 0, "three land blobs");
  ok(africa !== amazon && faunaPresent(w, africa, "lion"), "lion in Africa");
  ok(!faunaPresent(w, amazon, "lion"), "no lion in Amazon");
  ok(!faunaPresent(w, africa, "tiger"), "no tiger in Africa");
  ok(faunaPresent(w, india, "tiger"), "tiger in India");
  ok(!faunaPresent(w, amazon, "tiger"), "no tiger in Amazon");
  ok(faunaPresent(w, africa, "elephant"), "elephant in Africa");
  ok(faunaPresent(w, india, "elephant"), "elephant in India");
  ok(!faunaPresent(w, amazon, "elephant"), "no elephant in Amazon");
  ok(faunaPresent(w, africa, "hippo"), "hippo in Africa");
  ok(!faunaPresent(w, amazon, "hippo"), "no hippo in Amazon");
  ok(faunaPresent(w, africa, "deer"), "deer cosmopolitan → present in Africa");
  ok(faunaPresent(w, amazon, "deer"), "deer cosmopolitan → present in Amazon");
  ok(!floraPresent(w, amazon, "mulberry"), "no mulberry in Amazon");
  ok(!floraPresent(w, africa, "nutmeg"), "no nutmeg in Africa");
}

{
  // Island hops: cloves reach neighbouring islets, not a far continent.
  const tw = 180, th = 90, N = tw * th;
  const elev = new Float32Array(N);
  fillBlob(elev, tw, th, 0.855, 0.505, 0.012);
  fillBlob(elev, tw, th, 0.868, 0.505, 0.012);
  fillBlob(elev, tw, th, 0.55, 0.48, 0.07);
  const w = {
    N, tw, th, elev, temp: new Float32Array(N).fill(0.86),
    moist: new Float32Array(N).fill(0.7), seed: 3, preset: "earth_sim",
  };
  const a = nearestLand(w, 0.855, 0.505);
  const b = nearestLand(w, 0.868, 0.505);
  const africa = nearestLand(w, 0.55, 0.48);
  ok(floraPresent(w, a, "cloves"), "cloves on origin islet");
  ok(floraPresent(w, b, "cloves"), "cloves hop a neighbouring islet");
  ok(!floraPresent(w, africa, "cloves"), "cloves do not hop to Africa");
}

{
  const w = earthToy();
  const africa = nearestLand(w, 0.55, 0.48);
  const amazon = nearestLand(w, 0.28, 0.50);
  const sav = {
    world: w, seed: 8817, elev: 0.1, temp: 0.84, moist: 0.38, dry: 0.3, sumDry: 0,
    biome: B_SAVANNA, flood: false, riverMag: 0, relief: 0, coastDist: 20, boundDist: 255,
    livestock: 0.55, dep: { timber: 0.2, horses: 0, spices: 0, furs: 0, incense: 0, dyes: 0,
      stone: 0, copper: 0, tin: 0, iron: 0, coal: 0, salt: 0, precious: 0, gems: 0 },
  };
  const a = materialsFromSignals({ ...sav, ti: africa });
  const z = materialsFromSignals({ ...sav, ti: amazon });
  ok(idsOf(a.fauna).includes("lion") || idsOf(a.fauna).includes("elephant") || idsOf(a.fauna).includes("antelope"),
    "Africa savanna fauna includes African game");
  ok(!idsOf(z.fauna).includes("lion"), "Amazon savanna materials omit lion");
  ok(!idsOf(z.fauna).includes("hippo"), "Amazon savanna materials omit hippo");
}

{
  // Procedural: two savanna continents → lion on exactly one landmass.
  const tw = 80, th = 40, N = tw * th;
  const elev = new Float32Array(N);
  fillBlob(elev, tw, th, 0.25, 0.50, 0.10);
  fillBlob(elev, tw, th, 0.75, 0.50, 0.10);
  const w = {
    N, tw, th, elev,
    temp: new Float32Array(N).fill(0.84),
    moist: new Float32Array(N).fill(0.38),
    _dryFrac: new Float32Array(N).fill(0.3),
    seed: 4242, preset: "tectonic",
  };
  const west = nearestLand(w, 0.25, 0.50);
  const east = nearestLand(w, 0.75, 0.50);
  ok(classifyBiome(0.1, 0.38, 0.84, 0.3, 0) === B_SAVANNA, "toy climate is savanna");
  const lw = faunaPresent(w, west, "lion");
  const le = faunaPresent(w, east, "lion");
  ok(lw !== le, "procedural lion on exactly one savanna landmass");
  ok(lw || le, "procedural lion assigned somewhere");
  ensureFaunaFields(w);
  const again = faunaPresent(w, west, "lion");
  ok(again === lw, "cached fields are stable");
}

if (fails) {
  console.error(`faunaBiogeography: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`faunaBiogeography: ${checks} checks ok`);
