// ── Coastal Temperature Test ──
// Runs the full Earth(Sim) pipeline and checks temperature values
// at coastal locations where ocean currents create asymmetries.
//
// Usage: node tools/test_coastal_temp.mjs

import { readFileSync } from 'fs';

// ── Inline noise functions ──
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
const earthData = Buffer.from(b64Match[1], 'base64');
const EARTH_W = 720, EARTH_H = 360;

function sampleEarth(data, sw, sh, x, y, tw, th) {
  const fx = (x / tw) * sw, fy = (y / th) * sh;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  return data[y0*sw+(x0%sw)]*(1-dx)*(1-dy)+data[y0*sw+(x1%sw)]*dx*(1-dy)+data[y1*sw+(x0%sw)]*(1-dx)*dy+data[y1*sw+(x1%sw)]*dx*dy;
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
  let u00=0,u10=0,u01=0,u11=0,v00=0,v10=0,v01=0,v11=0;
  for (let m=0;m<12;m++){const md=windData[String(m)];
  u00+=md.u[latIdx0][lonIdx0];u10+=md.u[latIdx0][lonIdx1];u01+=md.u[latIdx1][lonIdx0];u11+=md.u[latIdx1][lonIdx1];
  v00+=md.v[latIdx0][lonIdx0];v10+=md.v[latIdx0][lonIdx1];v01+=md.v[latIdx1][lonIdx0];v11+=md.v[latIdx1][lonIdx1];}
  const inv12=1/12;u00*=inv12;u10*=inv12;u01*=inv12;u11*=inv12;v00*=inv12;v10*=inv12;v01*=inv12;v11*=inv12;
  const lf=Math.max(0,Math.min(1,latFrac)),xf=Math.max(0,Math.min(1,lonFrac));
  return{u:(u00*(1-xf)+u10*xf)*(1-lf)+(u01*(1-xf)+u11*xf)*lf,v:(v00*(1-xf)+v10*xf)*(1-lf)+(v01*(1-xf)+v11*xf)*lf};
}

// ── Import solvers ──
const { solveMoisture } = await import('../src/moistureSolver.js');

// ── Build Earth elevation + wind ──
const W = 1920, H = 960;
const elevation = new Float32Array(W * H);
const temperature = new Float32Array(W * H);
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

// ── Coast distance BFS ──
console.log('Computing coast distance...');
const CDT = 4, CDW = Math.ceil(W / CDT), CDH = Math.ceil(H / CDT);
const cdist = new Uint8Array(CDW * CDH); cdist.fill(255);
const cdQ = [];
for (let ty = 0; ty < CDH; ty++) for (let tx = 0; tx < CDW; tx++) {
  const px = Math.min(W-1, tx*CDT), py = Math.min(H-1, ty*CDT), ti = ty*CDW+tx;
  if (elevation[py*W+px] <= 0) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx2 = (tx+dx+CDW)%CDW, ny2 = ty+dy;
    if (ny2 < 0 || ny2 >= CDH) continue;
    if (elevation[Math.min(H-1,ny2*CDT)*W+Math.min(W-1,nx2*CDT)] <= 0) { cdist[ti] = 0; cdQ.push(ti); break; }
  }
}
for (let qi = 0; qi < cdQ.length; qi++) {
  const ci = cdQ[qi], cd = cdist[ci], cx = ci%CDW, cy = (ci-cx)/CDW;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx+dx+CDW)%CDW, ny2 = cy+dy;
    if (ny2 < 0 || ny2 >= CDH) continue;
    const ni = ny2*CDW+nx2, nd = cd+1;
    if (nd < cdist[ni] && elevation[Math.min(H-1,ny2*CDT)*W+Math.min(W-1,nx2*CDT)] > 0) { cdist[ni] = nd; cdQ.push(ni); }
  }
}

// ── Run moisture solver ──
console.log('Running moisture solver...');
const moisture = solveMoisture(W, H, elevation, windX, windY, temperature, {});

// ── Wind-advected temperature (same as WorldSim earth_sim) ──
console.log('Computing wind-advected temperature...');
const mW2 = Math.ceil(W/2), mH2 = Math.ceil(H/2);
const windTemp = new Float32Array(W * H);
const tGrid = new Float32Array(mW2 * mH2);
for (let my = 0; my < mH2; my++) for (let mx = 0; mx < mW2; mx++) {
  const px = Math.min(W-1, mx*2), py = Math.min(H-1, my*2);
  const lt = Math.abs(py/H - 0.42) * 2, e2 = elevation[py*W+px];
  tGrid[my*mW2+mx] = Math.max(0, Math.min(1, 1 - Math.pow(lt, 1.35)*1.15 + Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06 - Math.max(0,e2)*0.65));
}
for (let step = 0; step < 25; step++) {
  const prev = new Float32Array(tGrid);
  for (let my = 1; my < mH2-1; my++) for (let mx = 0; mx < mW2; mx++) {
    const px = Math.min(W-1, mx*2), py = Math.min(H-1, my*2), fi = py*W+px;
    const wx2 = windX[fi], wy2 = windY[fi];
    const srcX = mx - wx2*2.0, srcY = my - wy2*2.0;
    const sx = Math.min(mW2-2, Math.max(0, srcX|0)), sy = Math.min(mH2-2, Math.max(0, srcY|0));
    const fdx = Math.max(0, Math.min(1, srcX-sx)), fdy = Math.max(0, Math.min(1, srcY-sy));
    const sxr = Math.min(mW2-1, sx+1);
    const upT = (prev[sy*mW2+sx]*(1-fdx)+prev[sy*mW2+sxr]*fdx)*(1-fdy)+(prev[(sy+1)*mW2+sx]*(1-fdx)+prev[(sy+1)*mW2+sxr]*fdx)*fdy;
    const e2 = elevation[fi], lt = Math.abs(py/H - 0.42)*2;
    const locT = Math.max(0, Math.min(1, 1 - Math.pow(lt,1.35)*1.15 + Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06 - Math.max(0,e2)*0.65));
    if (e2 <= 0) { tGrid[my*mW2+mx] = locT*0.88 + upT*0.12; }
    else { const tb = Math.min(0.8, Math.max(0, e2-0.05)*3);
    const bi = (1-tb*0.5)*0.22, wb = upT>locT?1.3:0.8;
    const wi = Math.min(0.35, bi*wb);
    tGrid[my*mW2+mx] = locT*(1-wi) + upT*wi; }
  }
}
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = x/2, fy = y/2, ix = Math.min(mW2-2, fx|0), iy = Math.min(mH2-2, fy|0);
  const dx2 = fx-ix, dy2 = fy-iy;
  windTemp[y*W+x] = (tGrid[iy*mW2+ix]*(1-dx2)+tGrid[iy*mW2+Math.min(mW2-1,ix+1)]*dx2)*(1-dy2)+(tGrid[(iy+1)*mW2+ix]*(1-dx2)+tGrid[(iy+1)*mW2+Math.min(mW2-1,ix+1)]*dx2)*dy2;
}

// ── Final temperature blend (same as WorldSim earth_sim) ──
console.log('Blending final temperature...');
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y*W+x, nx = x/W, ny = y/H, e = elevation[i];
  const cd = cdist[Math.min(CDH-1, Math.floor(y/CDT))*CDW + Math.min(CDW-1, Math.floor(x/CDT))];
  const cp = Math.max(0, 1 - cd/8);
  const tLat = Math.abs(ny - 0.42) * 2;
  const shE = Math.exp(-((tLat-0.20)*(tLat-0.20))/(2*0.08*0.08)) * 0.06;
  const bt = 1 - Math.pow(tLat,1.35)*1.15 + shE - Math.max(0,e)*0.65 + fbm(nx*3+80,ny*3+80,3,2,.5)*.08 + fbm(nx*1.2+55,ny*1.2+55,3,2,.55)*.10;
  const inland = Math.max(0, 1 - cp);
  const ch = tLat < 0.5 ? inland*(0.5-tLat)*0.20 : inland*(tLat-0.5)*-0.12;
  const mt = bt + (0.45 - bt)*cp*0.2 + ch;
  const wt = windTemp[i];
  temperature[i] = Math.max(0, Math.min(1, mt*0.75 + wt*0.25));
  moisture[i] = moisture[i]; // already from solver
}

// ── Coastal temperature modification (Ekman transport) ──
console.log('Applying coastal Ekman transport...');
const fWX = windX, fWY = windY;
for (let y = 2; y < H-2; y++) for (let x = 0; x < W; x++) {
  const i = y*W+x;
  if (elevation[i] <= 0) continue;
  const cd = cdist[Math.min(CDH-1, Math.floor(y/CDT))*CDW + Math.min(CDW-1, Math.floor(x/CDT))];
  if (cd > 10) continue;
  let normX = 0, normY = 0; const scanR = 8;
  for (let dy = -scanR; dy <= scanR; dy++) for (let dx = -scanR; dx <= scanR; dx++) {
    if (!dx && !dy) continue; const nx2 = (x+dx+W)%W, ny2 = y+dy;
    if (ny2 < 0 || ny2 >= H) continue;
    if (elevation[ny2*W+nx2] <= 0) { const d = Math.sqrt(dx*dx+dy*dy); normX += dx/d; normY += dy/d; }
  }
  const normLen = Math.sqrt(normX*normX + normY*normY); if (normLen < 0.1) continue;
  normX /= normLen; normY /= normLen;
  let owx = 0, owy = 0, found = false;
  for (let step = 1; step <= 15; step++) {
    const ox = (x + Math.round(normX*step) + W) % W, oy = y + Math.round(normY*step);
    if (oy < 0 || oy >= H) continue;
    if (elevation[oy*W+ox] <= 0) { owx = fWX[oy*W+ox]; owy = fWY[oy*W+ox]; found = true; break; }
  }
  if (!found) continue;
  const lat2 = y/H - 0.5, hemi = lat2 >= 0 ? 1 : -1;
  const ekmanX = hemi*owy, ekmanY = -hemi*owx;
  const ekmanDot = ekmanX*normX + ekmanY*normY;
  const absLat2 = Math.abs(lat2)*2;
  const latF = Math.exp(-((absLat2-0.45)*(absLat2-0.45))/(2*0.25*0.25));
  const windSpd = Math.sqrt(owx*owx + owy*owy);
  const decay = Math.exp(-cd * 0.15);
  const ekmanNorm = windSpd > 0.001 ? ekmanDot / windSpd : 0;
  const strength = Math.min(1, windSpd * 60) * latF * decay;
  if (ekmanNorm > 0.1) {
    temperature[i] = Math.max(0, temperature[i] - Math.min(0.15, ekmanNorm*strength*0.18));
    moisture[i] = Math.max(0.02, moisture[i] - Math.min(0.12, ekmanNorm*strength*0.12));
  } else if (ekmanNorm < -0.1) {
    temperature[i] = Math.min(1, temperature[i] + Math.min(0.12, -ekmanNorm*strength*0.15));
    moisture[i] = Math.min(1, moisture[i] + Math.min(0.04, -ekmanNorm*strength*0.04));
  }
}

// ── Helpers ──
function llToPixel(lat, lon) {
  const x = Math.round(((lon + 180) / 360) * W) % W;
  const y = Math.round(((90 - lat) / 180) * H);
  return { x: Math.max(0, Math.min(W-1, x)), y: Math.max(0, Math.min(H-1, y)) };
}

// Sample nearest land pixel within a search radius
function sample(lat, lon) {
  const { x, y } = llToPixel(lat, lon);
  // Search expanding radius for land pixels
  for (let r = 0; r <= 8; r++) {
    let tSum = 0, mSum = 0, cnt = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (r > 0 && Math.abs(dx) < r && Math.abs(dy) < r) continue; // only shell
      const sx = (x+dx+W)%W, sy = Math.max(0, Math.min(H-1, y+dy));
      const si = sy*W+sx;
      if (elevation[si] > 0) { tSum += temperature[si]; mSum += moisture[si]; cnt++; }
    }
    if (cnt > 0) return { temp: tSum/cnt, moist: mSum/cnt };
  }
  return { temp: 0, moist: 0 };
}

// Convert sim temp (0-1) to approximate °C (0=~-30°C, 1=~30°C)
function toCelsius(t) { return (t * 60 - 30).toFixed(1); }

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' COASTAL TEMPERATURE ASYMMETRY TEST');
console.log(' Comparing same-latitude warm vs cold coasts');
console.log('═══════════════════════════════════════════════════════════════\n');

// Pairs of warm-coast vs cold-coast at similar latitudes
const pairs = [
  // ~50-55°N: Western Europe (warm Gulf Stream) vs Newfoundland (cold Labrador Current)
  { warm: { name: 'London', lat: 51.5, lon: -0.1, realC: 11 },
    cold: { name: "St. John's NL", lat: 47.6, lon: -52.7, realC: 5 } },

  // ~45-48°N: Bordeaux vs Halifax
  { warm: { name: 'Bordeaux', lat: 44.8, lon: -0.6, realC: 13 },
    cold: { name: 'Halifax', lat: 44.6, lon: -63.6, realC: 7 } },

  // ~37-40°N: Lisbon vs New York
  { warm: { name: 'Lisbon', lat: 38.7, lon: -9.1, realC: 17 },
    cold: { name: 'New York', lat: 40.7, lon: -74.0, realC: 12 } },

  // ~35°N: Tokyo (warm Kuroshio) vs Los Angeles (cold California Current)
  { warm: { name: 'Tokyo', lat: 35.7, lon: 139.7, realC: 16 },
    cold: { name: 'Los Angeles', lat: 34.0, lon: -118.2, realC: 18 } },

  // ~33°S: Sydney (warm E. Australian) vs Santiago (cold Humboldt)
  { warm: { name: 'Sydney', lat: -33.9, lon: 151.2, realC: 18 },
    cold: { name: 'Santiago', lat: -33.4, lon: -70.7, realC: 14 } },

  // ~23°S: Maputo (warm Agulhas) vs Walvis Bay (cold Benguela)
  { warm: { name: 'Maputo', lat: -26.0, lon: 32.6, realC: 22 },
    cold: { name: 'Walvis Bay', lat: -22.9, lon: 14.5, realC: 18 } },

  // Bergen vs Labrador coast
  { warm: { name: 'Bergen, Norway', lat: 60.4, lon: 5.3, realC: 8 },
    cold: { name: 'Nain, Labrador', lat: 56.5, lon: -61.7, realC: -3 } },
];

for (const pair of pairs) {
  const w = sample(pair.warm.lat, pair.warm.lon);
  const c = sample(pair.cold.lat, pair.cold.lon);
  const wC = toCelsius(w.temp);
  const cC = toCelsius(c.temp);
  const diff = (parseFloat(wC) - parseFloat(cC)).toFixed(1);
  const realDiff = (pair.warm.realC - pair.cold.realC).toFixed(0);

  console.log(`  ${pair.warm.name} vs ${pair.cold.name}`);
  console.log(`    Warm coast: ${wC}°C (sim)  ${pair.warm.realC}°C (real)  [t=${w.temp.toFixed(3)}]`);
  console.log(`    Cold coast: ${cC}°C (sim)  ${pair.cold.realC}°C (real)  [t=${c.temp.toFixed(3)}]`);
  console.log(`    Δ sim: ${diff}°C   Δ real: ${realDiff}°C`);
  console.log();
}

// Also check known upwelling coasts should be dry
console.log('═══════════════════════════════════════════════════════════════');
console.log(' UPWELLING COAST DRYNESS CHECK');
console.log('═══════════════════════════════════════════════════════════════\n');

const upwellingSpots = [
  { name: 'Lima, Peru (Humboldt)',        lat: -12.0, lon: -77.0, expectDry: true },
  { name: 'Walvis Bay, Namibia (Benguela)', lat: -22.9, lon: 14.5, expectDry: true },
  { name: 'San Francisco (California)',    lat: 37.8, lon: -122.4, expectDry: false }, // Mediterranean climate, not desert
  { name: 'Nouakchott, Mauritania',        lat: 18.1, lon: -15.9, expectDry: true },
  { name: 'Arica, Chile',                  lat: -18.5, lon: -70.3, expectDry: true },
];

for (const spot of upwellingSpots) {
  const s = sample(spot.lat, spot.lon);
  const dry = s.moist < 0.25;
  const status = dry === spot.expectDry ? '✓' : '✗';
  console.log(`  ${status} ${spot.name}: moisture=${s.moist.toFixed(3)}, temp=${toCelsius(s.temp)}°C ${spot.expectDry ? '(should be dry)' : '(moderate)'}`);
}

// Debug: check Ekman values at specific locations
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' EKMAN DIAGNOSTICS');
console.log('═══════════════════════════════════════════════════════════════\n');

const debugLocs = [
  { name: 'London',        lat: 51.5,  lon: -0.1 },
  { name: "St. John's NL", lat: 47.6,  lon: -52.7 },
  { name: 'Bergen',        lat: 60.4,  lon: 5.3 },
  { name: 'Nain, Labrador',lat: 56.5,  lon: -61.7 },
  { name: 'Lima',          lat: -12.0, lon: -77.0 },
  { name: 'Walvis Bay',    lat: -22.9, lon: 14.5 },
];

for (const loc of debugLocs) {
  const { x, y } = llToPixel(loc.lat, loc.lon);
  // Find nearest land pixel
  let lx = x, ly = y;
  for (let r = 0; r <= 8; r++) {
    let found2 = false;
    for (let dy = -r; dy <= r && !found2; dy++) for (let dx = -r; dx <= r && !found2; dx++) {
      if (r > 0 && Math.abs(dx) < r && Math.abs(dy) < r) continue;
      const sx = (x+dx+W)%W, sy = Math.max(0, Math.min(H-1, y+dy));
      if (elevation[sy*W+sx] > 0) { lx = sx; ly = sy; found2 = true; }
    }
    if (found2) break;
  }
  const i = ly*W+lx;
  const cd = cdist[Math.min(CDH-1, Math.floor(ly/CDT))*CDW + Math.min(CDW-1, Math.floor(lx/CDT))];

  // Compute coast normal
  let normX2 = 0, normY2 = 0; const scanR = 8;
  for (let dy = -scanR; dy <= scanR; dy++) for (let dx = -scanR; dx <= scanR; dx++) {
    if (!dx && !dy) continue; const nx2 = (lx+dx+W)%W, ny2 = ly+dy;
    if (ny2 < 0 || ny2 >= H) continue;
    if (elevation[ny2*W+nx2] <= 0) { const d = Math.sqrt(dx*dx+dy*dy); normX2 += dx/d; normY2 += dy/d; }
  }
  const normLen = Math.sqrt(normX2*normX2 + normY2*normY2);
  if (normLen > 0.1) { normX2 /= normLen; normY2 /= normLen; }

  // Find ocean wind
  let owx2 = 0, owy2 = 0;
  for (let step = 1; step <= 15; step++) {
    const ox = (lx + Math.round(normX2*step) + W) % W, oy = ly + Math.round(normY2*step);
    if (oy < 0 || oy >= H) continue;
    if (elevation[oy*W+ox] <= 0) { owx2 = fWX[oy*W+ox]; owy2 = fWY[oy*W+ox]; break; }
  }

  const lat2 = ly/H - 0.5, hemi = lat2 >= 0 ? 1 : -1;
  const ekmanX2 = hemi*owy2, ekmanY2 = -hemi*owx2;
  const ekmanDot2 = ekmanX2*normX2 + ekmanY2*normY2;
  const absLat3 = Math.abs(lat2)*2;
  const latF2 = Math.exp(-((absLat3-0.45)*(absLat3-0.45))/(2*0.25*0.25));
  const windSpd2 = Math.sqrt(owx2*owx2 + owy2*owy2);

  console.log(`  ${loc.name} (px ${lx},${ly}): cd=${cd} norm=(${normX2.toFixed(2)},${normY2.toFixed(2)}) wind=(${owx2.toFixed(4)},${owy2.toFixed(4)}) ekmanDot=${ekmanDot2.toFixed(4)} latF=${latF2.toFixed(3)} windSpd=${windSpd2.toFixed(4)}`);
}

console.log('\nDone.');
