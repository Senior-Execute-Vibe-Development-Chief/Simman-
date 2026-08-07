// WHY DOES THE TARIM/HEXI CORRIDOR TOP THE DENSITY TABLE? — follow-up to the
// capruler retraction (docs/state-birth-2026-08.md): the corridor at 92-98E,
// 40-44N reads 6.3-7.9 ppl/km² — above every real cradle — on rMag-4 rivers
// with works 1.00. Two suspicions, separated here:
//   (a) an ALLUVIAL ARTIFACT: the fertility there is mostly the river pull on
//       arid land, on rivers the endorheic machinery (riverGen Step 3b) was
//       supposed to terminate — so print each top tile's fertility WITH and
//       WITHOUT its river (cropSuitability re-evaluated at rm=0), its
//       moisture, and whether its river is ocean-bound or terminal;
//   (b) CITY CORES: the top tiles might simply be where the biggest cities
//       sit — print the nearest settlement and its census.
// The Nile and Sumer ride along as controls. Also reads the Yangtze works
// question: is works 0.23 tracking technique arrival (young, not broken)?
//
//   node tools/probe_tarim.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { cropSuitability } from "../src/sim/cropGen.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
stepPeopleSim(world, STEPS);
const tw = world.tw, th = world.th, KM2 = 510e6 / world.N, br = world._onePopScale || 0;
const ll = (ti) => { const y = (ti / tw) | 0, x = ti - y * tw; return [x / tw * 360 - 180, 90 - y / th * 180]; };
const at = (lon, lat) => Math.round((90 - lat) / 180 * th) * tw + Math.round((lon + 180) / 360 * tw);
const R = world.rivers || {};

function describe(ti, label) {
  const [lon, lat] = ll(ti);
  const rm = world.riverMag ? world.riverMag[ti] : 0;
  const f = world.fert[ti] || 0;
  const fNoRiver = cropSuitability(world.temp[ti], world.moist[ti], world.elev[ti], 0, 0, undefined);
  const term = R.drainsTerminal ? R.drainsTerminal[ti] : -9;
  let best = null, bd = Infinity;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    let dx = Math.abs(s.pos.x - (ti % tw)); if (dx > tw / 2) dx = tw - dx;
    const dy = s.pos.y - ((ti / tw) | 0), d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = s; }
  }
  const settStr = best && bd <= 9 ? `${best.name} (${((best._urbanPop || 0)).toFixed(0)}k core, ${(best.people || 0).toFixed(0)}k catch)` : "—";
  console.log(`  ${label.padEnd(9)} ${lon.toFixed(1).padStart(7)}E ${lat.toFixed(1).padStart(6)}N | ${(world.popField[ti] * br * 1000 / KM2).toFixed(1).padStart(5)} ppl/km² | fert ${f.toFixed(2)} (no-river ${fNoRiver.toFixed(2)}) | moist ${(world.moist[ti] || 0).toFixed(2)} | rMag ${rm} ${term === 1 ? "TERMINAL" : term === 0 ? "→ocean" : "?"} | devF ${(world.devField ? world.devField[ti] : 0).toFixed(2)} | works ${(world.worksField ? world.worksField[ti] : 0).toFixed(2)} | ${settStr}`);
}

const arr = [];
for (let ti = 0; ti < world.N; ti++) if (world.elev[ti] > 0) arr.push([world.popField[ti] * br * 1000 / KM2, ti]);
arr.sort((a, b) => b[0] - a[0]);
console.log(`step ${world.step} · world ${(arr.reduce((a, b) => a + b[0], 0) * KM2 / 1e6).toFixed(1)}M\n`);
console.log("TOP 12 DENSITY TILES:");
for (const [, ti] of arr.slice(0, 12)) describe(ti, "top");
console.log("\nCONTROLS:");
describe(at(28.5, 27), "Nile");
describe(at(47, 30), "Sumer");
describe(at(44, 33), "MidEuphr");

// The alluvial share of the fertility, world-wide: how much of the planet's
// farmland VALUE exists only through the river pull on land whose rain would
// not farm — split by whether the river actually reaches the sea.
{
  let pullOcean = 0, pullTerm = 0, rainFed = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (world.elev[ti] <= 0) continue;
    const f = world.fert[ti] || 0;
    if (f <= 0.02) continue;
    const fNo = cropSuitability(world.temp[ti], world.moist[ti], world.elev[ti], 0, 0, undefined);
    const pull = Math.max(0, f - fNo);
    const term = R.drainsTerminal ? R.drainsTerminal[ti] : -9;
    if (pull > f * 0.5) { if (term === 1) pullTerm += f; else pullOcean += f; }
    else rainFed += f;
  }
  const tot = pullOcean + pullTerm + rainFed;
  console.log(`\nFARMLAND VALUE (Σfert) BY WATER SOURCE:`);
  console.log(`  rain-fed:                      ${(100 * rainFed / tot).toFixed(1)}%`);
  console.log(`  river-pull, ocean-bound river: ${(100 * pullOcean / tot).toFixed(1)}%   (Nile/Indus class — real)`);
  console.log(`  river-pull, TERMINAL river:    ${(100 * pullTerm / tot).toFixed(1)}%   (Tarim class — oasis strips in reality)`);
}

// Yangtze works vs technique arrival: works can only build where devF has
// arrived (the build gate) — print the joint distribution over the box.
{
  const box = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const lon = x / tw * 360 - 180, lat = 90 - y / th * 180;
    if (lon < 105 || lon > 122 || lat < 26 || lat > 33) continue;
    const ti = y * tw + x; if (world.elev[ti] > 0) box.push(ti);
  }
  let taught = 0, wTaught = 0, wAll = 0;
  for (const ti of box) {
    const d = world.devField ? world.devField[ti] : 0, w = world.worksField ? world.worksField[ti] : 0;
    wAll += w;
    if (d >= 0.45) { taught++; wTaught += w; }
  }
  console.log(`\nYANGTZE box: ${box.length} tiles · taught (devF≥0.45): ${taught} · works mean ALL ${(wAll / box.length).toFixed(2)} vs mean on TAUGHT ${(taught ? wTaught / taught : 0).toFixed(2)}`);
  console.log(`  (if taught tiles build like other cradles (~1.0), works is YOUNG, not broken)`);
}
