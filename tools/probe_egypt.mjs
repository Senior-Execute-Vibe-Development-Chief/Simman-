// Track the EGYPT cradle's territory (tiles + km²) across a run, vs real Egypt.
//   node tools/probe_egypt.mjs [steps] [W] [H]
// Anchors on the Nile cradle settlement; reports its economic catchment (_terrTiles)
// and the political COUNTRY that rules the Nile core, converting owned tiles to km²
// by summing true per-tile area (equirectangular: Δlat·Δlon·cos(lat)).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "30000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const world = buildSim({ W, H, seed: 8817 });
const TW = world.tw, TH = world.th;
const lonOf = x => x / TW * 360 - 180, latOf = y => 90 - y / TH * 180;
const xx = lon => { let x = Math.round(((lon + 180) / 360) * TW) % TW; if (x < 0) x += TW; return x; };
const yy = lat => Math.round((90 - lat) / 180 * (TH - 1));

// per-tile area (km²) at a row y
const DLAT_KM = (180 / TH) * 111.32;
const tileKm2 = y => DLAT_KM * (360 / TW) * 111.32 * Math.cos(latOf(y) * Math.PI / 180);

// Egypt / Nile core box to find the cradle settlement and anchor tile
const ELAT0 = 20, ELAT1 = 33, ELON0 = 24, ELON1 = 36;
function egyptCradle() {
  let best = null;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const la = latOf(s.pos.y), lo = lonOf(s.pos.x);
    if (la >= ELAT0 && la <= ELAT1 && lo >= ELON0 && lo <= ELON1 && (!best || s.people > best.people)) best = s;
  }
  return best;
}
function countryKm2AndTiles(cid) {
  const co = world._countryOwner; if (!co || cid == null || cid < 0) return { tiles: 0, km2: 0 };
  let tiles = 0, km2 = 0;
  for (let y = 0; y < TH; y++) { const a = tileKm2(y); for (let x = 0; x < TW; x++) { if (co[y * TW + x] === cid) { tiles++; km2 += a; } } }
  return { tiles, km2 };
}

console.log(`[${W}x${H} tw${TW}] Egypt tile ≈ ${Math.round(tileKm2(yy(26)))} km²`);
console.log(`Real Egypt: Old Kingdom core (Nile valley+delta administered) ~50k km² cultivated;`);
console.log(`            state extent incl. claimed desert ~0.5-1.0M km²; modern Egypt 1.00M km².\n`);
console.log('step    org   cradle      catchment(tiles)   COUNTRY(tiles)  COUNTRY(km²)  vs modern-Egypt');
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  if (i % 2500 === 0 || i === 500) {
    const c = egyptCradle();
    if (!c) { console.log(`${String(i).padStart(6)}  (no Egypt settlement yet)`); continue; }
    const org = (c.knowledge && c.knowledge.organization) || 0;
    const cid = c.countryId;
    const { tiles, km2 } = countryKm2AndTiles(cid);
    const pct = (100 * km2 / 1.0e6).toFixed(0);
    console.log(`${String(i).padStart(6)}  ${org.toFixed(2)}  ${(c.name||'').padEnd(10)}  ${String(c._terrTiles||0).padStart(6)}             ${String(tiles).padStart(5)}        ${String(Math.round(km2)).padStart(8)}      ${pct.padStart(4)}%`);
  }
}
