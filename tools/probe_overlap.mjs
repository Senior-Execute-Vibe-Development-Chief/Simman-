// DO TWO CITIES EVER FARM — OR COUNT — THE SAME GROUND?
// (2026-08-27, the catchment audit. The owner's rule: one tile's people belong
// to ONE city. This probe measures whether that holds, directly, in a live
// world, for every catchment species the code actually uses.)
//
// THREE CATCHMENTS LIVE IN THIS CODEBASE AND THEY ARE NOT THE SAME OBJECT:
//
//   A. THE CENSUS / ECONOMIC CATCHMENT — world._territoryOwner, one Int32Array
//      entry per tile (territory.js:174). deriveOnePop (popField.js:1840-1846)
//      reduces popField over it by owner id and sets s.people = f × _onePopScale
//      (popField.js:1999). tallyTerritory (territory.js:~465) reads the SAME
//      array for the harvest. It is a PARTITION: one owner per tile.
//   B. THE BASIN DISK — a raw Euclidean disk of TOWN_BASIN_R × rNormPop tiles
//      (crystallize.js:365 = 10 REFERENCE tiles), summed by townBasinMass
//      (crystallize.js:170). This is what every mint bar, the dissolution bar
//      (crystallize.js:1230/1245), CROWD_FOUND's reference (crystallize.js:2363)
//      and the cage horizon (cageField.js:84) read. Nothing makes it exclusive.
//   C. THE URBAN FOOTPRINT — diskSum over Chebyshev radius urbanCoreR
//      (popField.js:1586, 1577), the disk s._urbanPop is read off
//      (popField.js:2054). Owner-agnostic by explicit design note
//      (popField.js:1583-1585).
//
// So the question "can catchments overlap" has a different answer per species,
// and this probe reports all three separately instead of averaging them.
//
//   node tools/probe_overlap.mjs [steps=24000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { POP_SCALE } from "../src/sim/units.js";
import { rNormPop } from "../src/sim/peopleSim/tuning.js";
import { urbanCoreR } from "../src/sim/peopleSim/popField.js";
import { crowdMassRatio } from "../src/sim/peopleSim/crystallize.js";
import { coreRadiusFor, hinterlandRadiusFor, reachBudget } from "../src/sim/peopleSim/territory.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

const CADENCE = 250;
for (let done = 0; done < STEPS; done += CADENCE) stepPeopleSim(world, CADENCE);

// ── geometry ───────────────────────────────────────────────────────────────
const EARTH_KM = 40075;
const tw = world.tw, th = world.th, N = world.N;
const kmPerTile = EARTH_KM / tw;                       // equator-nominal tile pitch (also the meridional pitch: 20037/th)
const latOf = y => 90 - (y + 0.5) / th * 180;
const tileKm2 = y => kmPerTile * kmPerTile * Math.cos(latOf(y) * Math.PI / 180);
const rn = rNormPop(world);
const TOWN_BASIN_R = 10;               // crystallize.js:365, REFERENCE tiles (×rn at every use site)
const TOWN_BASIN_MIN = 360;           // crystallize.js:360 — used only to VERIFY the disk reproduction below
const rB = Math.round(TOWN_BASIN_R * rn);
const coreR = urbanCoreR(world);

const pf = world.popField, elev = world.elev, owner = world._territoryOwner;
const scale = world._onePopScale;
const settled = world.settlements.filter(s => s.mode === "settled");
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

console.log(`\n=== CATCHMENT OVERLAP  ${W}x${H} (tw=${tw}, th=${th})  seed ${SEED}  ${STEPS} steps ===`);
console.log(`  ${settled.length} settled · rNormPop ${rn} · _onePopScale ${scale} · tile pitch ${kmPerTile.toFixed(1)} km`);

// ── VERIFY the disk reproduction is the sim's own code path ────────────────
// townBasinMass is module-local, but crowdMassRatio (exported) is exactly
// townBasinMass(...rB)/TOWN_BASIN_MIN — so if my disk matches it, my disk IS
// the sim's disk. Any mismatch invalidates section B and is reported loudly.
function myDisk(tx, ty, r) {
  let m = 0;
  for (let dy = -r; dy <= r; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      m += pf[yy * tw + (((tx + dx) % tw) + tw) % tw];
    }
  }
  return m;
}
let worstRel = 0;
for (const s of settled.slice(0, 40)) {
  const x = s.pos.x | 0, y = s.pos.y | 0;
  const mine = myDisk(x, y, rB), theirs = crowdMassRatio(world, x, y) * TOWN_BASIN_MIN;
  if (theirs > 0) worstRel = Math.max(worstRel, Math.abs(mine - theirs) / theirs);
}
console.log(`  [self-check] my basin disk vs the sim's crowdMassRatio: worst rel. diff ${worstRel.toExponential(2)} ${worstRel < 1e-9 ? "(identical — section B reads the sim's own disk)" : "*** MISMATCH — section B is NOT the sim's disk ***"}`);

// ══ A. THE CENSUS / ECONOMIC CATCHMENT (world._territoryOwner) ═════════════
console.log(`\n  ── A. CENSUS CATCHMENT — world._territoryOwner, the array deriveOnePop reduces over ──`);
const mult = new Int32Array(N);       // how many settlements claim each tile
const tilesOf = new Map();            // sid → tile count
const areaOf = new Map();             // sid → km²
const massOf = new Map();             // sid → Σ popField
let ownedTiles = 0, landTiles = 0, ownedKm2 = 0, landKm2 = 0;
const live = new Set(settled.map(s => s.id));
for (let i = 0; i < N; i++) {
  if (elev[i] > 0) { landTiles++; landKm2 += tileKm2((i / tw) | 0); }
  const o = owner[i];
  if (o < 0) continue;
  if (!live.has(o)) continue;         // a dead owner not yet released — not a live catchment
  mult[i]++;                          // the partition can only ever add 1 here
  ownedTiles++; ownedKm2 += tileKm2((i / tw) | 0);
  tilesOf.set(o, (tilesOf.get(o) || 0) + 1);
  areaOf.set(o, (areaOf.get(o) || 0) + tileKm2((i / tw) | 0));
  massOf.set(o, (massOf.get(o) || 0) + (pf[i] > 0 ? pf[i] : 0));
}
let multA = 0, multMassA = 0, maxA = 0, totMassA = 0;
for (let i = 0; i < N; i++) {
  if (mult[i] === 0) continue;
  if (mult[i] > maxA) maxA = mult[i];
  totMassA += pf[i] > 0 ? pf[i] : 0;
  if (mult[i] > 1) { multA++; multMassA += pf[i] > 0 ? pf[i] : 0; }
}
console.log(`  catchment tiles ${ownedTiles} of ${landTiles} land (${(100 * ownedTiles / landTiles).toFixed(1)}% of land covered) · ${(ownedKm2 / 1e6).toFixed(2)} of ${(landKm2 / 1e6).toFixed(2)} Mkm²`);
console.log(`  tiles in >1 catchment: ${multA} / ${ownedTiles} = ${(100 * multA / Math.max(1, ownedTiles)).toFixed(3)}%   max settlements per tile: ${maxA}`);
console.log(`  double-counted people: ${(100 * multMassA / Math.max(1e-9, totMassA)).toFixed(3)}% of the field mass inside catchments`);
const areas = [...areaOf.values()];
const cnts = [...tilesOf.values()];
console.log(`  catchment TILES  p50 ${q(cnts, .5)} · p90 ${q(cnts, .9)} · max ${Math.max(0, ...cnts)}`);
console.log(`  catchment AREA   p50 ${Math.round(q(areas, .5)).toLocaleString()} km² · p90 ${Math.round(q(areas, .9)).toLocaleString()} km² · max ${Math.round(Math.max(0, ...areas)).toLocaleString()} km²`);
const rEq = a => Math.sqrt(a / Math.PI);
console.log(`  equivalent-disk RADIUS (√(area/π))  p50 ${Math.round(rEq(q(areas, .5)))} km · p90 ${Math.round(rEq(q(areas, .9)))} km · max ${Math.round(rEq(Math.max(0, ...areas)))} km`);
const buds = settled.map(s => reachBudget(s) * rn);
const cores = settled.map(coreRadiusFor), hints = settled.map(hinterlandRadiusFor);
console.log(`  (shape: NOT a disk — a cost-Dijkstra reach out of reachBudget×rNormPop, p50 budget ${q(buds, .5).toFixed(2)} cost-units;`);
console.log(`   guaranteed core radius p50 ${q(cores, .5)} tile(s) = ${Math.round(q(cores, .5) * kmPerTile)} km; guaranteed hinterland radius p50 ${q(hints, .5)} tiles = ${Math.round(q(hints, .5) * kmPerTile)} km)`);

// ══ B. THE BASIN DISK (TOWN_BASIN_R × rn) ═════════════════════════════════
console.log(`\n  ── B. BASIN DISK — TOWN_BASIN_R×rn = ${rB} tiles, the disk every mint/dissolve/crowd/cage bar reads ──`);
const multB = new Int32Array(N);
for (const s of settled) {
  const tx = s.pos.x | 0, ty = s.pos.y | 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      multB[yy * tw + (((tx + dx) % tw) + tw) % tw]++;
    }
  }
}
let coveredB = 0, multBn = 0, massB = 0, multMassB = 0, maxB = 0, sumCover = 0, coveredLandB = 0, coveredKm2B = 0;
for (let i = 0; i < N; i++) {
  const m = multB[i];
  if (m === 0) continue;
  sumCover += m;
  coveredB++;
  if (elev[i] > 0) { coveredLandB++; coveredKm2B += tileKm2((i / tw) | 0); }
  if (m > maxB) maxB = m;
  const p = pf[i] > 0 ? pf[i] : 0;
  massB += p;
  if (m > 1) { multBn++; multMassB += p; }
}
const diskKm2 = Math.PI * Math.pow(rB * kmPerTile, 2);
console.log(`  disk radius ${rB} tiles = ${Math.round(rB * kmPerTile).toLocaleString()} km (equator-nominal) · nominal disk area ${(diskKm2 / 1e6).toFixed(2)} Mkm²`);
console.log(`  land tiles covered by ≥1 disk: ${coveredLandB} (${(coveredKm2B / 1e6).toFixed(2)} Mkm² = ${(100 * coveredKm2B / landKm2).toFixed(1)}% of all land)`);
console.log(`  tiles in >1 disk: ${multBn} / ${coveredB} = ${(100 * multBn / Math.max(1, coveredB)).toFixed(1)}%   max settlements sharing one tile: ${maxB}`);
console.log(`  double-counted people: ${(100 * multMassB / Math.max(1e-9, massB)).toFixed(1)}% of the field mass under any disk`);
console.log(`  mean multiplicity over covered tiles: ${(sumCover / Math.max(1, coveredB)).toFixed(2)}×  (Σ over all disks ÷ once-counted area)`);
// The overcount factor the BARS actually see: Σ townBasinMass over all sites ÷ the field mass they collectively cover.
let sumBasins = 0;
for (const s of settled) sumBasins += myDisk(s.pos.x | 0, s.pos.y | 0, rB);
console.log(`  Σ basin-disk mass over all ${settled.length} sites = ${Math.round(sumBasins).toLocaleString()} field units vs ${Math.round(massB).toLocaleString()} actually standing under those disks ⇒ ${(sumBasins / Math.max(1e-9, massB)).toFixed(2)}× overcount at the bars`);
const hist = new Map();
for (let i = 0; i < N; i++) if (multB[i] > 0) hist.set(multB[i], (hist.get(multB[i]) || 0) + 1);
const keys = [...hist.keys()].sort((a, b) => a - b);
console.log(`  multiplicity histogram (tiles): ` + keys.slice(0, 14).map(k => `${k}×:${hist.get(k)}`).join(" ") + (keys.length > 14 ? ` … up to ${maxB}×` : ""));

// ══ C. THE URBAN FOOTPRINT DISK ═══════════════════════════════════════════
console.log(`\n  ── C. URBAN FOOTPRINT — diskSum Chebyshev radius ${coreR} (urbanCoreR), the disk s._urbanPop is read off ──`);
const multC = new Int32Array(N);
for (const s of settled) {
  const cx = s.pos.x | 0, cy = s.pos.y | 0;
  if (coreR <= 0) { multC[cy * tw + ((cx % tw) + tw) % tw]++; continue; }
  for (let y = Math.max(0, cy - coreR); y <= Math.min(th - 1, cy + coreR); y++)
    for (let dx = -coreR; dx <= coreR; dx++) multC[y * tw + ((cx + dx) % tw + tw) % tw]++;
}
let covC = 0, mC = 0, maxC = 0, massC = 0, multMassC = 0;
for (let i = 0; i < N; i++) {
  const m = multC[i]; if (!m) continue;
  covC++; if (m > maxC) maxC = m;
  const p = pf[i] > 0 ? pf[i] : 0; massC += p;
  if (m > 1) { mC++; multMassC += p; }
}
console.log(`  footprint radius ${coreR} tiles = ${Math.round(coreR * kmPerTile)} km · covered tiles ${covC}`);
console.log(`  tiles in >1 footprint: ${mC} / ${covC} = ${(100 * mC / Math.max(1, covC)).toFixed(2)}%   max ${maxC}   double-counted urban people: ${(100 * multMassC / Math.max(1e-9, massC)).toFixed(2)}%`);

// ══ D. THE CONSERVATION TEST — Σ census vs the field it is derived from ═══
console.log(`\n  ── D. CONSERVATION — Σ s.people vs the field mass, converted at _onePopScale ──`);
let fieldAllLand = 0;
for (let i = 0; i < N; i++) if (elev[i] > 0 && pf[i] > 0) fieldAllLand += pf[i];
const censusSum = settled.reduce((a, s) => a + (s.people || 0), 0);
const fieldInCatch = totMassA;                       // Σ pf over LIVE catchment tiles (section A)
console.log(`  Σ s.people (census, sim units)                       ${Math.round(censusSum).toLocaleString()}  = ${(censusSum * POP_SCALE / 1e6).toFixed(1)}M people`);
console.log(`  Σ popField over LIVE catchment tiles × _onePopScale  ${Math.round(fieldInCatch * scale).toLocaleString()}`);
console.log(`  Σ popField over ALL LAND × _onePopScale              ${Math.round(fieldAllLand * scale).toLocaleString()}`);
console.log(`  census ÷ catchment-field = ${(censusSum / Math.max(1e-9, fieldInCatch * scale)).toFixed(4)}   census ÷ all-land-field = ${(censusSum / Math.max(1e-9, fieldAllLand * scale)).toFixed(4)}`);
console.log(`  (>1 on the SECOND ratio would be the double-count signature: more census than there are people on the planet.`);
console.log(`   The first ratio is 1 by construction unless a settlement's census is stale — deriveOnePop keeps the old`);
console.log(`   value for a settlement whose catchment came back empty this pass, popField.js:2069.)`);
const staleN = settled.filter(s => !(massOf.get(s.id) > 0)).length;
console.log(`  settlements with an EMPTY live catchment this pass (census is stale): ${staleN} / ${settled.length}`);

// ══ E. WHAT THE BASIN DISK MEANS PER CITY ═════════════════════════════════
console.log(`\n  ── E. THE TWO RADII SIDE BY SIDE (median settlement) ──`);
console.log(`  census/economic catchment : ~${Math.round(rEq(q(areas, .5))).toLocaleString()} km equivalent radius · ${Math.round(q(areas, .5)).toLocaleString()} km² · EXCLUSIVE (one owner per tile)`);
console.log(`  basin disk (the bars)     : ${Math.round(rB * kmPerTile).toLocaleString()} km radius · ${Math.round(diskKm2).toLocaleString()} km² · FREELY OVERLAPPING`);
console.log(`  ratio of areas: the basin disk is ${(diskKm2 / Math.max(1, q(areas, .5))).toFixed(0)}× the median city's actual worked catchment`);
