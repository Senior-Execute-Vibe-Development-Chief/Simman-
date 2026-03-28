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

// Known locations with expected moisture levels
const locations = [
  // Very wet (should be > 0.7)
  { name: 'Amazon (Manaus)',       lat: -3.1,  lon: -60.0,  expected: 'very wet (>0.7)' },
  { name: 'Congo Basin',          lat: 0.5,   lon: 21.0,   expected: 'very wet (>0.7)' },
  { name: 'Indonesia (Borneo)',   lat: 0.0,   lon: 115.0,  expected: 'very wet (>0.7)' },
  { name: 'SE Asia (Myanmar)',    lat: 18.0,  lon: 97.0,   expected: 'wet (>0.5)' },

  // Wet (should be 0.4-0.7)
  { name: 'Eastern US (Atlanta)', lat: 33.7,  lon: -84.4,  expected: 'wet (0.4-0.7)' },
  { name: 'Western Europe (Paris)', lat: 48.8, lon: 2.3,   expected: 'moderate (0.3-0.6)' },
  { name: 'Japan (Tokyo)',        lat: 35.7,  lon: 139.7,  expected: 'wet (0.4-0.7)' },
  { name: 'Eastern China',        lat: 30.0,  lon: 118.0,  expected: 'wet (0.4-0.7)' },

  // Moderate (should be 0.2-0.5)
  { name: 'US Great Plains',      lat: 40.0,  lon: -100.0, expected: 'moderate (0.2-0.5)' },
  { name: 'Southern Russia',      lat: 55.0,  lon: 50.0,   expected: 'moderate (0.2-0.5)' },
  { name: 'Southern India',       lat: 12.0,  lon: 78.0,   expected: 'wet (0.4-0.7)' },
  { name: 'Argentina (Pampas)',   lat: -35.0, lon: -60.0,  expected: 'moderate (0.3-0.5)' },

  // Dry (should be < 0.2)
  { name: 'Sahara (center)',      lat: 23.0,  lon: 10.0,   expected: 'very dry (<0.1)' },
  { name: 'Arabian Desert',       lat: 23.0,  lon: 46.0,   expected: 'very dry (<0.1)' },
  { name: 'Australian Outback',   lat: -25.0, lon: 135.0,  expected: 'dry (<0.2)' },
  { name: 'Atacama (Chile)',      lat: -24.0, lon: -70.0,  expected: 'very dry (<0.1)' },
  { name: 'Gobi Desert',         lat: 43.0,  lon: 105.0,  expected: 'dry (<0.15)' },
  { name: 'Namibia',             lat: -23.0, lon: 17.0,   expected: 'dry (<0.15)' },

  // Cold/polar (should be low-moderate)
  { name: 'Siberia (Yakutsk)',   lat: 62.0,  lon: 130.0,  expected: 'low (0.15-0.35)' },
  { name: 'Greenland coast',     lat: 65.0,  lon: -45.0,  expected: 'low (0.1-0.3)' },
  { name: 'Antarctica',          lat: -80.0, lon: 0.0,    expected: 'very dry (<0.1)' },

  // Coastal wet
  { name: 'Pacific NW (Seattle)', lat: 47.6, lon: -122.3, expected: 'wet (0.5-0.8)' },
  { name: 'Norway (Bergen)',      lat: 60.4,  lon: 5.3,   expected: 'wet (0.5-0.8)' },
  { name: 'West Colombia',       lat: 5.0,   lon: -77.0,  expected: 'very wet (>0.7)' },
];

console.log('Location Moisture Check:');
console.log('='.repeat(85));
console.log(`${'Location'.padEnd(28)} ${'Moisture'.padStart(8)} ${'Elev'.padStart(6)} ${'WindU'.padStart(6)} ${'WindV'.padStart(6)}  Expected`);
console.log('-'.repeat(85));

let good = 0, bad = 0;
for (const loc of locations) {
  const s = sample(loc.lat, loc.lon);
  const mStr = s.moisture.toFixed(3).padStart(8);
  const eStr = s.elevation.toFixed(3).padStart(6);
  const uStr = s.windU.toFixed(1).padStart(6);
  const vStr = s.windV.toFixed(1).padStart(6);

  // Simple check: is the value roughly in the expected range?
  let ok = '?';
  if (loc.expected.includes('>0.7') && s.moisture > 0.6) ok = '✓';
  else if (loc.expected.includes('>0.7') && s.moisture <= 0.6) ok = '✗';
  else if (loc.expected.includes('<0.1') && s.moisture < 0.15) ok = '✓';
  else if (loc.expected.includes('<0.1') && s.moisture >= 0.15) ok = '✗';
  else if (loc.expected.includes('<0.15') && s.moisture < 0.2) ok = '✓';
  else if (loc.expected.includes('<0.15') && s.moisture >= 0.2) ok = '✗';
  else if (loc.expected.includes('<0.2') && s.moisture < 0.25) ok = '✓';
  else if (loc.expected.includes('<0.2') && s.moisture >= 0.25) ok = '✗';
  else ok = '~';

  if (ok === '✓') good++;
  else if (ok === '✗') bad++;

  console.log(`${ok} ${loc.name.padEnd(26)} ${mStr} ${eStr} ${uStr} ${vStr}  ${loc.expected}`);
}

console.log('-'.repeat(85));
console.log(`Score: ${good} correct, ${bad} wrong, ${locations.length - good - bad} unchecked`);

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
