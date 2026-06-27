// Hydrology audit: enumerate every significant river (mouth, length, terminus) and
// every lake (centroid, area), and match each against the nearest real-world feature.
//   node tools/audit_hydro.mjs <seed> <W>
import { buildWorld } from "../src/sim/pipeline.js";
import { RIVER_MAJOR, RIVER_GREAT } from "../src/sim/riverGen.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "1920", 10), H = W >> 1;

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];

console.log(`[gen] ${W}x${H} seed=${SEED} ...`);
const { ter } = buildWorld({ W, H, seed: SEED });
const { tw, th, tElev, rivers: R } = ter;
const { riverMag, flowDir, flowAccum, lake, lakeInfo } = R;
const N = tw * th;

const latOf = (ty) => (0.5 - ty / th) * 180;
const lonOf = (tx) => (tx / tw) * 360 - 180;
const KM_DEG = 111.32;
// ground distance (km) of a D8 step from tile (tx,ty) in direction d
function stepKm(tx, ty, d) {
  const lat = latOf(ty) * Math.PI / 180;
  const dyKm = D8_DY[d] * (180 / th) * KM_DEG;
  const dxKm = D8_DX[d] * (360 / tw) * KM_DEG * Math.cos(lat);
  return Math.hypot(dxKm, dyKm);
}
const downstream = (ti) => {
  const d = flowDir[ti]; if (d === 255) return -1;
  const tx = ti % tw, ty = (ti - tx) / tw;
  const ny = ty + D8_DY[d]; if (ny < 0 || ny >= th) return -1;
  return ny * tw + ((tx + D8_DX[d] + tw) % tw);
};
// upstream neighbours that flow INTO ti
function upstreamOf(ti) {
  const tx = ti % tw, ty = (ti - tx) / tw; const ups = [];
  for (let d = 0; d < 8; d++) {
    const ny = ty + D8_DY[d]; if (ny < 0 || ny >= th) continue;
    const ni = ny * tw + ((tx + D8_DX[d] + tw) % tw);
    if (tElev[ni] > 0 && downstream(ni) === ti) ups.push(ni);
  }
  return ups;
}

// ── Rivers: a "river" = a main stem ending at the ocean OR a terminal sink/lake.
// Find mouth tiles: riverMag>=MAJOR whose downstream is ocean / terminal / a lake.
const mouths = [];
for (let ti = 0; ti < N; ti++) {
  if (tElev[ti] <= 0 || riverMag[ti] < RIVER_MAJOR) continue;
  const ds = downstream(ti);
  let term = null;
  if (ds < 0) term = "terminal(playa)";
  else if (tElev[ds] <= 0) term = "ocean";
  else if (lake[ds] >= 0) term = "lake";
  if (term) mouths.push({ ti, term });
}
// Trace each main stem upstream (follow the largest-flow contributor).
function traceStem(mouthTi) {
  let ti = mouthTi, lenKm = 0, peakMag = riverMag[ti];
  const guard = new Uint8Array(0); // not needed; flow is a DAG upstream by construction
  for (let steps = 0; steps < 100000; steps++) {
    peakMag = Math.max(peakMag, riverMag[ti]);
    const ups = upstreamOf(ti).filter(u => riverMag[u] >= 1);
    if (!ups.length) break;
    let best = ups[0];
    for (const u of ups) if (flowAccum[u] > flowAccum[best]) best = u;
    // distance from best -> ti
    const bx = best % tw, by = (best - bx) / tw;
    for (let d = 0; d < 8; d++) {
      const ny = by + D8_DY[d];
      if (ny >= 0 && ny < th && ny * tw + ((bx + D8_DX[d] + tw) % tw) === ti) { lenKm += stepKm(bx, by, d); break; }
    }
    ti = best;
  }
  return { lenKm, peakMag, sourceTi: ti };
}
let riversAll = mouths.map(m => {
  const tx = m.ti % tw, ty = (m.ti - tx) / tw;
  const st = traceStem(m.ti);
  return { lat: latOf(ty), lon: lonOf(tx), lenKm: st.lenKm, peakMag: st.peakMag, term: m.term, accum: flowAccum[m.ti] };
}).sort((a, b) => b.lenKm - a.lenKm);
// Dedup: distributaries / parallel mouths of one system land in the same ~3° cell —
// keep only the longest stem per (terminus-type, 3°-binned mouth) so each real river
// is counted once.
const seen = new Set(); const riversOut = [];
for (const r of riversAll) {
  const key = `${r.term}:${Math.round(r.lat / 3)}:${Math.round(r.lon / 3)}`;
  if (seen.has(key)) continue; seen.add(key); riversOut.push(r);
}

// ── Lakes: centroid + area (km², latitude-corrected) + depth.
const lakeTiles = {};
for (let ti = 0; ti < N; ti++) { const id = lake[ti]; if (id >= 0) (lakeTiles[id] ||= []).push(ti); }
const lakesOut = lakeInfo.map(lk => {
  const cells = lakeTiles[lk.id] || [];
  let sx = 0, sy = 0, areaKm2 = 0;
  for (const c of cells) {
    const cx = c % tw, cy = (c - cx) / tw; sx += cx; sy += cy;
    const lat = latOf(cy) * Math.PI / 180;
    areaKm2 += (360 / tw) * KM_DEG * Math.cos(lat) * (180 / th) * KM_DEG;
  }
  return { lat: latOf(sy / cells.length), lon: lonOf(sx / cells.length), tiles: cells.length, areaKm2, depth: lk.depth };
}).sort((a, b) => b.areaKm2 - a.areaKm2);

// ── Real-world reference features (mouth/centroid lat,lon; size).
const realRivers = [
  ["Nile", 31, 30, 6650], ["Amazon", 0, -50, 6400], ["Yangtze", 31, 121, 6300],
  ["Mississippi", 29, -89, 6275], ["Yenisei", 72, 82, 5540], ["Yellow R.", 38, 119, 5460],
  ["Ob", 67, 73, 5410], ["Paraná", -34, -58, 4880], ["Congo", -6, 12, 4700],
  ["Amur", 53, 141, 4440], ["Lena", 72, 127, 4400], ["Mekong", 10, 106, 4350],
  ["Mackenzie", 69, -135, 4240], ["Niger", 5, 6, 4180], ["Murray-Darling", -35, 139, 3670],
  ["Volga→Caspian", 46, 48, 3530], ["Indus", 24, 67, 3180], ["Danube", 45, 29, 2850],
  ["Zambezi", -18, 36, 2690], ["Euphrates-Tigris", 30, 48, 2800], ["Tarim→Lop Nur", 40, 88, 2030],
  ["Amu Darya→Aral", 44, 59, 2540], ["Colorado", 32, -115, 2330], ["Orange", -28, 16, 2200],
];
const realLakes = [
  ["Caspian", 41, 51, 371000], ["Superior", 47, -88, 82100], ["Victoria", -1, 33, 68900],
  ["Huron", 45, -82, 59600], ["Michigan", 44, -87, 58000], ["Tanganyika", -6, 30, 32900],
  ["Baikal", 53, 108, 31500], ["Great Bear", 66, -121, 31000], ["Malawi", -12, 34, 29500],
  ["Great Slave", 62, -114, 27200], ["Erie", 42, -81, 25700], ["Winnipeg", 52, -98, 24500],
  ["Ontario", 44, -78, 18900], ["Balkhash", 46, 74, 16400], ["Ladoga", 61, 31, 17700],
  ["Aral(hist)", 45, 60, 68000], ["Chad", 13, 14, 17800], ["Titicaca", -16, -69, 8400],
  ["Eyre", -29, 137, 9500], ["Tonlé Sap", 13, 104, 2700], ["Issyk-Kul", 42, 77, 6200],
];
function gcKm(la1, lo1, la2, lo2) {
  const r = Math.PI / 180, dLat = (la2 - la1) * r, dLon = (lo2 - lo1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
const nearest = (lat, lon, list) => {
  let best = null, bestD = Infinity;
  for (const r of list) { const d = gcKm(lat, lon, r[1], r[2]); if (d < bestD) { bestD = d; best = r; } }
  return { name: best[0], distKm: bestD, real: best[3], rlat: best[1], rlon: best[2] };
};

const MAG = ["", "Stream", "Trib", "MAJOR", "GREAT"];
console.log(`\n=== RIVERS (≥MAJOR, ${riversOut.length} found) — top 30 by length ===`);
console.log("len(km) mag    mouth(lat,lon)   terminus         nearest real (dist)");
for (const r of riversOut.slice(0, 30)) {
  const m = nearest(r.lat, r.lon, realRivers);
  const tag = m.distKm < 600 ? `${m.name} ~${m.real}km` : `(no match; nearest ${m.name} ${m.distKm|0}km away)`;
  console.log(`${(r.lenKm|0).toString().padStart(5)}  ${MAG[r.peakMag].padEnd(6)} ${r.lat.toFixed(0).padStart(3)},${r.lon.toFixed(0).toString().padStart(4)}   ${r.term.padEnd(15)} ${tag}`);
}
console.log(`\nRiver count by magnitude: GREAT=${riversOut.filter(r=>r.peakMag>=4).length}, MAJOR=${riversOut.filter(r=>r.peakMag===3).length}`);
let allMag = [0,0,0,0,0]; for (let i=0;i<N;i++) if (tElev[i]>0) allMag[riverMag[i]]++;
console.log(`Tile counts: stream=${allMag[1]} trib=${allMag[2]} major=${allMag[3]} great=${allMag[4]}`);

console.log(`\n=== LAKES (${lakesOut.length} found) — top 25 by area ===`);
console.log("area(km²) tiles depth  centroid(lat,lon)   nearest real (dist)");
for (const l of lakesOut.slice(0, 25)) {
  const m = nearest(l.lat, l.lon, realLakes);
  const tag = m.distKm < 700 ? `${m.name} ~${m.real}km²` : `(no match; nearest ${m.name} ${m.distKm|0}km away)`;
  console.log(`${(l.areaKm2|0).toString().padStart(7)} ${l.tiles.toString().padStart(5)} ${l.depth.toFixed(3)}  ${l.lat.toFixed(0).padStart(3)},${l.lon.toFixed(0).toString().padStart(4)}    ${tag}`);
}

// Coverage: which real features did we MISS (no detected feature within 600/700 km)?
console.log(`\n=== MISSING real rivers (no detected ≥MAJOR mouth within 700km) ===`);
for (const rr of realRivers) {
  let found = false;
  for (const r of riversOut) if (gcKm(r.lat, r.lon, rr[1], rr[2]) < 700) { found = true; break; }
  if (!found) console.log(`  MISSING: ${rr[0]} (real mouth ${rr[1]},${rr[2]})`);
}
console.log(`\n=== MISSING real lakes (no detected lake within 700km) ===`);
for (const rl of realLakes) {
  let found = false;
  for (const l of lakesOut) if (gcKm(l.lat, l.lon, rl[1], rl[2]) < 700) { found = true; break; }
  if (!found) console.log(`  MISSING: ${rl[0]} (real centroid ${rl[1]},${rl[2]}, ${rl[3]}km²)`);
}
