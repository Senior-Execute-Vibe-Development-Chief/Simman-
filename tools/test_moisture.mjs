// ── Moisture Calibration Test ──
// Runs moisture solver against real Earth heightmap + NCEP wind data
// and checks moisture values at known locations against expected values.
//
// Usage: node tools/test_moisture.mjs

import { readFileSync } from 'fs';

// ── Inline noise functions (copied from WorldSim.jsx) ──
const PERM = new Uint8Array(512);
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
function noise2D(x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const aa = PERM[PERM[X] + Y], ab = PERM[PERM[X] + Y + 1];
  const ba = PERM[PERM[X + 1] + Y], bb = PERM[PERM[X + 1] + Y + 1];
  const d = (g, x2, y2) => GRAD[g % 8][0] * x2 + GRAD[g % 8][1] * y2;
  const l1 = d(aa, xf, yf) + u * (d(ba, xf - 1, yf) - d(aa, xf, yf));
  const l2 = d(ab, xf, yf - 1) + u * (d(bb, xf - 1, yf - 1) - d(ab, xf, yf - 1));
  return l1 + v * (l2 - l1);
}
function fbm(x, y, o, l, g) {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < o; i++) { v += noise2D(x * f, y * f) * a; m += a; a *= g; f *= l; }
  return v / m;
}

// ── Load Earth elevation data ──
const earthSrc = readFileSync('src/earthData.js', 'utf8');
const b64Match = earthSrc.match(/export const EARTH_ELEV="([^"]+)"/);
const earthB64 = b64Match[1];
const earthData = Buffer.from(earthB64, 'base64');
const EARTH_W = 720, EARTH_H = 360;

function sampleEarth(data, sw, sh, x, y, tw, th) {
  const fx = (x / tw) * sw, fy = (y / th) * sh;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const v00 = data[y0 * sw + (x0 % sw)], v10 = data[y0 * sw + (x1 % sw)];
  const v01 = data[y1 * sw + (x0 % sw)], v11 = data[y1 * sw + (x1 % sw)];
  return v00 * (1 - dx) * (1 - dy) + v10 * dx * (1 - dy) + v01 * (1 - dx) * dy + v11 * dx * dy;
}

// ── Load real wind data ──
const windData = JSON.parse(readFileSync('data/global_wind.json', 'utf8'));

function sampleWind(x, y, W, H) {
  const lats = windData.lat, lons = windData.lon;
  const nLat = lats.length, nLon = lons.length;
  const lat = 90 - (y / (H - 1)) * 180;
  const lon = ((x / W) * 360 + 180) % 360;

  let latIdx0 = 0;
  for (let i = 0; i < nLat - 1; i++) {
    if (lats[i] >= lat && lats[i + 1] < lat) { latIdx0 = i; break; }
  }
  const latIdx1 = Math.min(nLat - 1, latIdx0 + 1);
  const latRange = lats[latIdx1] - lats[latIdx0];
  const latFrac = latRange !== 0 ? (lat - lats[latIdx0]) / latRange : 0;

  let lonIdx0 = 0;
  for (let i = 0; i < nLon - 1; i++) {
    if (lons[i] <= lon && lons[i + 1] > lon) { lonIdx0 = i; break; }
    if (i === nLon - 2) lonIdx0 = i;
  }
  const lonIdx1 = (lonIdx0 + 1) % nLon;
  const lonRange = lonIdx1 > lonIdx0 ? lons[lonIdx1] - lons[lonIdx0] : (360 - lons[lonIdx0] + lons[lonIdx1]);
  const lonFrac = lonRange !== 0 ? ((lon - lons[lonIdx0] + 360) % 360) / lonRange : 0;

  let u00 = 0, u10 = 0, u01 = 0, u11 = 0;
  let v00 = 0, v10 = 0, v01 = 0, v11 = 0;
  for (let m = 0; m < 12; m++) {
    const md = windData[String(m)];
    u00 += md.u[latIdx0][lonIdx0]; u10 += md.u[latIdx0][lonIdx1];
    u01 += md.u[latIdx1][lonIdx0]; u11 += md.u[latIdx1][lonIdx1];
    v00 += md.v[latIdx0][lonIdx0]; v10 += md.v[latIdx0][lonIdx1];
    v01 += md.v[latIdx1][lonIdx0]; v11 += md.v[latIdx1][lonIdx1];
  }
  const inv12 = 1 / 12;
  u00 *= inv12; u10 *= inv12; u01 *= inv12; u11 *= inv12;
  v00 *= inv12; v10 *= inv12; v01 *= inv12; v11 *= inv12;

  const lf = Math.max(0, Math.min(1, latFrac));
  const xf = Math.max(0, Math.min(1, lonFrac));
  return {
    u: (u00 * (1 - xf) + u10 * xf) * (1 - lf) + (u01 * (1 - xf) + u11 * xf) * lf,
    v: (v00 * (1 - xf) + v10 * xf) * (1 - lf) + (v01 * (1 - xf) + v11 * xf) * lf,
  };
}

// ── Import moisture solver ──
// We need to dynamically import the ES module
const moistMod = await import('../src/moistureSolver.js');
const { solveMoisture } = moistMod;

// ── Build Earth elevation + wind arrays ──
const W = 1920, H = 960;
const elevation = new Float32Array(W * H);
const temperature = new Float32Array(W * H); // will be zeros (solver handles this)
const windX = new Float32Array(W * H);
const windY = new Float32Array(W * H);

initNoise(42);

console.log('Building Earth elevation...');
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, nx = x / W, ny = y / H;
  const he = sampleEarth(earthData, EARTH_W, EARTH_H, x, y, W, H);
  const noise = fbm(nx * 20 + 3.7, ny * 20 + 3.7, 3, 2, .5) * .012 + fbm(nx * 40 + 7, ny * 40 + 7, 2, 2, .4) * .006;
  if (he < 3) {
    const depth = fbm(nx * 8 + 50, ny * 8 + 50, 3, 2, .5) * .04;
    elevation[i] = -0.03 - Math.max(0, (1 - he / 3)) * 0.12 + depth;
  } else {
    let e = (he - 3) / 252 * 0.55 + 0.005 + noise;
    elevation[i] = Math.max(0.001, e);
  }
}

console.log('Filling real wind data...');
const SCALE = 0.008;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const { u, v } = sampleWind(x, y, W, H);
  const i = y * W + x;
  windX[i] = u * SCALE;
  windY[i] = v * SCALE;
}

// ── Run moisture solver ──
console.log('Running moisture solver...');
const t0 = Date.now();
const moisture = solveMoisture(W, H, elevation, windX, windY, temperature, {});
const elapsed = Date.now() - t0;
console.log(`Moisture solver completed in ${elapsed}ms\n`);

// ── Check locations ──
// Pixel coordinates assume: x=0 is 180°W, x=W is 180°E
// lat/lon to pixel: x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H

function llToPixel(lat, lon) {
  const x = Math.round(((lon + 180) / 360) * W) % W;
  const y = Math.round(((90 - lat) / 180) * H);
  return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
}

function sample(lat, lon) {
  const { x, y } = llToPixel(lat, lon);
  const i = y * W + x;
  return {
    moisture: moisture[i],
    elevation: elevation[i],
    windU: windX[i] / SCALE,
    windV: windY[i] / SCALE,
  };
}

// Known locations with expected moisture levels (based on real climate data)
// Ranges: 0 = extreme desert, 0.5 = moderate, 1.0 = extreme rainforest
const locations = [
  // ═══ TROPICAL WET (>0.7) — ITCZ convergence, trade wind moisture ═══
  { name: 'Amazon (Manaus)',       lat: -3.1,  lon: -60.0,  min: 0.7, max: 1.0 },
  { name: 'Amazon (Belem)',        lat: -1.4,  lon: -48.5,  min: 0.7, max: 1.0 },
  { name: 'Congo Basin',           lat: 0.5,   lon: 21.0,   min: 0.7, max: 1.0 },
  { name: 'Indonesia (Borneo)',    lat: 1.1,   lon: 113.8,  min: 0.7, max: 1.0 },
  { name: 'West Colombia',         lat: 5.6,   lon: -76.9,  min: 0.7, max: 1.0 },
  { name: 'Papua New Guinea',      lat: -5.1,  lon: 145.5,  min: 0.6, max: 1.0 },
  { name: 'Central Africa',        lat: 3.0,   lon: 28.0,   min: 0.6, max: 0.9 },

  // ═══ MONSOON / TROPICAL WET (0.5-0.8) ═══
  { name: 'SE Asia (Myanmar)',      lat: 18.0,  lon: 97.0,   min: 0.5, max: 0.8 },
  { name: 'Southern India',         lat: 13.1,  lon: 76.9,   min: 0.5, max: 0.8 },
  { name: 'Bangladesh',             lat: 23.0,  lon: 90.0,   min: 0.6, max: 0.9 },
  { name: 'Vietnam',                lat: 18.0,  lon: 105.9,  min: 0.5, max: 0.8 },
  { name: 'West Africa (Nigeria)',  lat: 7.0,   lon: 4.0,    min: 0.5, max: 0.8 },
  { name: 'Madagascar (east)',      lat: -16.5, lon: 47.4,   min: 0.5, max: 0.8 },

  // ═══ TEMPERATE WET (0.4-0.7) — westerlies bring oceanic moisture ═══
  { name: 'Eastern US (Atlanta)',   lat: 33.7,  lon: -84.4,  min: 0.4, max: 0.7 },
  { name: 'Eastern US (New York)',  lat: 40.7,  lon: -74.0,  min: 0.4, max: 0.7 },
  { name: 'US Southeast (Florida)', lat: 27.0,  lon: -81.0,  min: 0.5, max: 0.8 },
  { name: 'Japan (Honshu)',         lat: 38.1,  lon: 137.3,  min: 0.4, max: 0.7 },
  { name: 'Eastern China',          lat: 30.0,  lon: 118.0,  min: 0.4, max: 0.7 },
  { name: 'UK (London)',            lat: 51.5,  lon: -0.1,   min: 0.4, max: 0.7 },
  { name: 'Pacific NW (Seattle)',   lat: 47.6,  lon: -122.3, min: 0.5, max: 0.8 },
  { name: 'Norway (Bergen)',        lat: 60.4,  lon: 5.3,    min: 0.5, max: 0.8 },
  { name: 'New Zealand',            lat: -38.8, lon: 172.7,  min: 0.5, max: 0.8 },
  { name: 'Southern Chile',         lat: -45.0, lon: -72.0,  min: 0.5, max: 0.8 },
  { name: 'SE Brazil (Sao Paulo)',  lat: -23.5, lon: -46.6,  min: 0.4, max: 0.7 },

  // ═══ MODERATE (0.3-0.6) — continental interiors with some moisture ═══
  { name: 'Western Europe (Paris)', lat: 48.8,  lon: 2.3,    min: 0.3, max: 0.6 },
  { name: 'Germany (Berlin)',       lat: 52.5,  lon: 13.4,   min: 0.3, max: 0.6 },
  { name: 'US Great Plains',        lat: 40.0,  lon: -100.0, min: 0.2, max: 0.5 },
  { name: 'US Midwest (Chicago)',   lat: 41.9,  lon: -87.6,  min: 0.3, max: 0.6 },
  { name: 'Argentina (Pampas)',     lat: -35.0, lon: -60.0,  min: 0.3, max: 0.5 },
  { name: 'Uruguay',                lat: -34.5, lon: -56.0,  min: 0.3, max: 0.6 },
  { name: 'South Africa (east)',    lat: -29.4, lon: 29.4,   min: 0.3, max: 0.5 },
  { name: 'Turkey (Ankara)',        lat: 39.9,  lon: 32.9,   min: 0.2, max: 0.4 },
  { name: 'Northern India',         lat: 28.0,  lon: 80.0,   min: 0.3, max: 0.6 },

  // ═══ RUSSIA / HIGH-LATITUDE CONTINENTAL (0.15-0.45) ═══
  { name: 'Moscow',                 lat: 55.8,  lon: 37.6,   min: 0.25, max: 0.5 },
  { name: 'Southern Russia (Volga)',lat: 55.0,  lon: 50.0,   min: 0.2, max: 0.45 },
  { name: 'W Siberia (Novosibirsk)',lat: 55.0,  lon: 83.0,   min: 0.2, max: 0.4 },
  { name: 'E Siberia (Yakutsk)',    lat: 62.0,  lon: 130.0,  min: 0.15, max: 0.35 },
  { name: 'NE Siberia (Magadan)',   lat: 59.6,  lon: 150.0,  min: 0.15, max: 0.35 },
  { name: 'Far East (Vladivostok)', lat: 43.7,  lon: 131.4,  min: 0.3, max: 0.6 },
  { name: 'Scandinavia (Stockholm)',lat: 60.6,  lon: 19.5,   min: 0.3, max: 0.55 },
  { name: 'Finland (Helsinki)',     lat: 60.2,  lon: 25.0,   min: 0.3, max: 0.5 },
  { name: 'Iceland (Reykjavik)',    lat: 64.1,  lon: -22.0,  min: 0.35, max: 0.6 },
  { name: 'Alaska (Anchorage)',     lat: 61.2,  lon: -150.0, min: 0.2, max: 0.5 },
  { name: 'Canada (Winnipeg)',      lat: 49.9,  lon: -97.1,  min: 0.2, max: 0.45 },
  { name: 'Canada (Vancouver)',     lat: 49.3,  lon: -123.1, min: 0.5, max: 0.8 },

  // ═══ SEMI-ARID (0.1-0.25) ═══
  { name: 'Central Asia (Kazakh)',  lat: 48.0,  lon: 68.0,   min: 0.1, max: 0.25 },
  { name: 'Iran (Tehran)',          lat: 35.7,  lon: 51.4,   min: 0.1, max: 0.25 },
  { name: 'Spain (Madrid)',         lat: 40.4,  lon: -3.7,   min: 0.2, max: 0.4 },
  { name: 'US Southwest (Phoenix)', lat: 33.4,  lon: -112.0, min: 0.05, max: 0.2 },
  { name: 'Patagonia (dry)',        lat: -45.0, lon: -69.0,  min: 0.1, max: 0.25 },
  { name: 'Mongolia',               lat: 47.0,  lon: 107.0,  min: 0.1, max: 0.2 },

  // ═══ DESERT / VERY DRY (<0.15) ═══
  { name: 'Sahara (center)',        lat: 23.0,  lon: 10.0,   min: 0.0, max: 0.08 },
  { name: 'Sahara (west)',          lat: 24.0,  lon: -5.0,   min: 0.0, max: 0.08 },
  { name: 'Sahara (east/Libya)',    lat: 25.0,  lon: 20.0,   min: 0.0, max: 0.08 },
  { name: 'Arabian Desert',         lat: 23.0,  lon: 46.0,   min: 0.0, max: 0.08 },
  { name: 'Arabian (Empty Quarter)',lat: 20.0,  lon: 50.0,   min: 0.0, max: 0.08 },
  { name: 'Australian Outback',     lat: -25.0, lon: 135.0,  min: 0.0, max: 0.15 },
  { name: 'Atacama (Chile)',         lat: -24.0, lon: -70.0,  min: 0.0, max: 0.08 },
  { name: 'Gobi Desert',            lat: 43.0,  lon: 105.0,  min: 0.0, max: 0.15 },
  { name: 'Namibia (Namib)',         lat: -23.0, lon: 15.0,   min: 0.0, max: 0.1 },
  { name: 'Kalahari',               lat: -24.0, lon: 23.0,   min: 0.05, max: 0.2 },
  { name: 'Thar Desert (India)',     lat: 27.0,  lon: 71.0,   min: 0.0, max: 0.15 },
  { name: 'Taklamakan',              lat: 39.0,  lon: 83.0,   min: 0.0, max: 0.1 },

  // ═══ COLD/POLAR (<0.15) ═══
  { name: 'Greenland (inland)',     lat: 72.0,  lon: -40.0,  min: 0.0, max: 0.1 },
  { name: 'Greenland (coast)',      lat: 65.0,  lon: -45.0,  min: 0.1, max: 0.3 },
  { name: 'N Canada (Arctic)',      lat: 72.6,  lon: -94.9,  min: 0.0, max: 0.15 },
  { name: 'Antarctica (inland)',    lat: -80.0, lon: 0.0,    min: 0.0, max: 0.05 },
  { name: 'Antarctica (coast)',     lat: -68.6, lon: 69.4,   min: 0.0, max: 0.15 },
  { name: 'Svalbard',               lat: 78.0,  lon: 16.0,   min: 0.0, max: 0.2 },
];

console.log('Location Moisture Check:');
console.log('='.repeat(90));
console.log(`${'Location'.padEnd(28)} ${'Moist'.padStart(6)} ${'Target'.padStart(12)} ${'Elev'.padStart(6)} ${'Wind'.padStart(10)}`);
console.log('-'.repeat(90));

let good = 0, bad = 0, close = 0;
let lastSection = '';
for (const loc of locations) {
  const s = sample(loc.lat, loc.lon);
  const m = s.moisture;
  const mStr = m.toFixed(3).padStart(6);
  const eStr = s.elevation.toFixed(3).padStart(6);
  const wStr = `${s.windU.toFixed(1)},${s.windV.toFixed(1)}`.padStart(10);
  const rangeStr = `${loc.min.toFixed(2)}-${loc.max.toFixed(2)}`.padStart(12);

  let ok;
  if (m >= loc.min && m <= loc.max) { ok = '✓'; good++; }
  else if (m >= loc.min - 0.1 && m <= loc.max + 0.1) { ok = '~'; close++; }
  else { ok = '✗'; bad++; }

  console.log(`${ok} ${loc.name.padEnd(26)} ${mStr} ${rangeStr} ${eStr} ${wStr}`);
}

console.log('-'.repeat(90));
console.log(`Score: ${good}/${locations.length} in range, ${close} close, ${bad} wrong`);

// ── Summary statistics ──
let landCount = 0, landSum = 0, minM = 1, maxM = 0;
for (let i = 0; i < W * H; i++) {
  if (elevation[i] > 0) {
    landCount++;
    landSum += moisture[i];
    if (moisture[i] < minM) minM = moisture[i];
    if (moisture[i] > maxM) maxM = moisture[i];
  }
}
console.log(`\nLand stats: mean=${(landSum/landCount).toFixed(3)}, min=${minM.toFixed(3)}, max=${maxM.toFixed(3)}, pixels=${landCount}`);
