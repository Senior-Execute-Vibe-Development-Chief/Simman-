// Ground-truth temperature validation: map real cities (lat/lon + their real
// mean annual temp) onto the earth_sim grid and compare the sim's temperature
// there. The earth_sim heightmap IS real Earth geography, so a city's lat/lon
// lands on the right continent. Includes land/ocean/mountain ANCHORS first to
// confirm the coordinate mapping, then the cities.
//   node tools/probe_cities.mjs [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = parseInt(process.argv[4] || "480", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});

// Equirectangular: x = (lon+180)/360*W ; y = (0.5 - lat/180)*H  (y=0 = north pole)
function tileOf(lat, lon) {
  let x = Math.floor((lon + 180) / 360 * W) % W; x = (x % W + W) % W;
  const y = Math.max(0, Math.min(H - 1, Math.floor((0.5 - lat / 180) * H)));
  return y * W + x;
}
const simC = (i) => (w.temperature[i] * 100 - 60);
const elevM = (i) => { const e = w.elevation[i]; return e <= 0 ? "SEA" : (e / 0.55 * 6000 | 0) + "m"; };

// ── anchors: confirm the mapping lands where expected ──
const ANCHORS = [
  ["Sahara (should be LAND)", 23, 13],
  ["Amazon (LAND)", -3, -60],
  ["mid-Pacific (OCEAN)", 0, -150],
  ["mid-Atlantic (OCEAN)", 0, -30],
  ["Himalaya/Tibet (HIGH)", 30, 88],
  ["Australia outback (LAND)", -25, 133],
];
console.log("ANCHORS (verify coordinate mapping):");
for (const [name, lat, lon] of ANCHORS) {
  const i = tileOf(lat, lon);
  console.log(`  ${name.padEnd(28)} elev=${elevM(i).padStart(6)}  simT=${simC(i).toFixed(1)}°C`);
}

// ── cities: name, lat, lon, real mean annual °C (climate normals, approx) ──
const CITIES = [
  // sea-level / low-altitude (clean latitude test)
  ["Singapore",      1.35, 103.82, 27.0],
  ["Lagos",          6.45,   3.40, 26.8],
  ["Bangkok",       13.75, 100.50, 28.4],
  ["Mumbai",        19.08,  72.88, 27.2],
  ["Dubai",         25.20,  55.27, 28.0],
  ["Miami",         25.76, -80.19, 25.1],
  ["Phoenix",       33.45,-112.07, 24.0],
  ["Cairo",         30.04,  31.24, 21.8],
  ["Sydney",       -33.87, 151.21, 18.3],
  ["Los Angeles",   34.05,-118.24, 17.0],
  ["Sao Paulo",    -23.55, -46.63, 19.2],
  ["Rome",          41.90,  12.50, 15.7],
  ["Tokyo",         35.68, 139.69, 16.0],
  ["New York",      40.71, -74.01, 12.9],
  ["Beijing",       39.90, 116.40, 12.9],
  ["London",        51.51,  -0.13, 11.3],
  ["Berlin",        52.52,  13.40, 10.0],
  ["Moscow",        55.75,  37.62,  5.8],
  ["Anchorage",     61.22,-149.90,  2.8],
  ["Reykjavik",     64.15, -21.94,  4.5],
  ["Fairbanks",     64.84,-147.72, -2.0],
  ["Yakutsk",       62.03, 129.73, -8.8],
  ["Murmansk",      68.97,  33.08,  0.6],
  ["McMurdo (Ant.)",-77.85, 166.67,-17.0],
  // high-altitude (elevation lapse-rate test — low latitude but COLD)
  ["Nairobi *alt",  -1.29,  36.82, 17.8],
  ["Mexico City*alt",19.43, -99.13, 16.7],
  ["Quito *alt",    -0.18, -78.47, 14.0],
  ["La Paz *alt",  -16.50, -68.15,  8.5],
  ["Lhasa *alt",    29.65,  91.14,  8.0],
  ["Denver *alt",   39.74,-104.99, 10.4],
];

console.log("\nCITY                 real    sim     Δ       simElev   (note)");
console.log("─".repeat(72));
let sumAbs = 0, n = 0, sumAbsLow = 0, nLow = 0;
for (const [name, lat, lon, real] of CITIES) {
  const i = tileOf(lat, lon);
  const s = simC(i), d = s - real, e = elevM(i);
  const ocean = w.elevation[i] <= 0;
  console.log(`${name.padEnd(18)} ${real.toFixed(1).padStart(6)} ${s.toFixed(1).padStart(6)} ${(d >= 0 ? "+" : "") + d.toFixed(1)}`.padEnd(44) + `${e.padStart(7)}   ${ocean ? "[on OCEAN tile]" : name.includes("alt") ? "[altitude]" : ""}`);
  if (!ocean) { sumAbs += Math.abs(d); n++; if (!name.includes("alt")) { sumAbsLow += Math.abs(d); nLow++; } }
}
console.log("─".repeat(72));
console.log(`mean abs error (land cities): ${(sumAbs / n).toFixed(1)}°C  (sea-level only: ${(sumAbsLow / nLow).toFixed(1)}°C)`);

// ── equatorial lowland + genuinely HOT locations (real annual mean °C) ──
const EQHOT = [
  // equatorial humid lowland (~25-28°C)
  ["Kuala Lumpur",   3.14, 101.69, 27.5],
  ["Jakarta",       -6.20, 106.85, 27.6],
  ["Libreville",     0.39,   9.45, 26.0],
  ["Kinshasa",      -4.32,  15.31, 25.3],
  ["Belem (Amazon)",-1.46, -48.50, 26.8],
  ["Colombo",        6.93,  79.86, 27.6],
  ["Guayaquil",     -2.19, -79.88, 26.0],
  ["Mogadishu",      2.04,  45.34, 27.0],
  ["Paramaribo",     5.87, -55.17, 27.2],
  ["Manaus",        -3.10, -60.02, 27.4],
  // hot deserts / hottest inhabited (~26-35°C)
  ["Khartoum",      15.50,  32.56, 29.9],
  ["Niamey",        13.51,   2.11, 29.3],
  ["Timbuktu",      16.77,  -3.00, 28.9],
  ["Mecca",         21.43,  39.83, 31.0],
  ["Djibouti",      11.59,  43.15, 30.0],
  ["Assab",         13.00,  42.73, 30.5],
  ["Dallol(hottest)",14.24, 40.30, 34.6],
  ["Riyadh",        24.71,  46.68, 26.0],
  ["Alice Springs", -23.70, 133.88, 21.4],
  ["Las Vegas",     36.17, -115.14, 20.3],
];
console.log("\nEQUATORIAL & HOT      real    sim     Δ       simElev   (note)");
console.log("─".repeat(72));
let sa = 0, nn = 0;
for (const [name, lat, lon, real] of EQHOT) {
  const i = tileOf(lat, lon);
  const s = simC(i), d = s - real, e = elevM(i);
  const ocean = w.elevation[i] <= 0;
  console.log(`${name.padEnd(18)} ${real.toFixed(1).padStart(6)} ${s.toFixed(1).padStart(6)} ${(d >= 0 ? "+" : "") + d.toFixed(1)}`.padEnd(44) + `${e.padStart(7)}   ${ocean ? "[on OCEAN tile]" : ""}`);
  if (!ocean) { sa += Math.abs(d); nn++; }
}
console.log("─".repeat(72));
console.log(`mean abs error (equatorial & hot, land): ${(sa / nn).toFixed(1)}°C`);
