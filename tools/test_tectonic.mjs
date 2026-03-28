// ── Tectonic Generation Calibration Test ──
// Generates multiple tectonic worlds and compares metrics against real Earth.
// Also generates Earth elevation for direct comparison.
//
// Usage: node tools/test_tectonic.mjs

import { readFileSync } from 'fs';

// ── Inline noise functions ──
const PERM = new Uint8Array(512);
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed) {
  const p = new Uint8Array(256); for (let i=0;i<256;i++) p[i]=i;
  for (let i=255;i>0;i--) { seed=(seed*16807)%2147483647; const j=seed%(i+1); [p[i],p[j]]=[p[j],p[i]]; }
  for (let i=0;i<512;i++) PERM[i]=p[i&255];
}
function noise2D(x,y) {
  const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y);
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];
  const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;
  const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf));
  const l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));
  return l1+v*(l2-l1);
}
function fbm(x,y,o,l,g) { let v=0,a=1,f=1,m=0; for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;} return v/m; }
function ridged(x,y,o,l,g) { let v=0,a=1,f=1,m=0; for(let i=0;i<o;i++){v+=(1-Math.abs(noise2D(x*f,y*f)))*a;m+=a;a*=g;f*=l;} return v/m; }
function worley(x,y) {
  const ix=Math.floor(x),iy=Math.floor(y); let d1=9,d2=9;
  for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
    const cx=ix+dx,cy=iy+dy;
    const h1=PERM[(PERM[(cx&255)]+((cy&255)))&511],h2=PERM[(h1+73)&511];
    const px=cx+(h1/255),py=cy+(h2/255);
    const dd=(x-px)*(x-px)+(y-py)*(y-py);
    if(dd<d1){d2=d1;d1=dd;}else if(dd<d2)d2=dd;
  }
  return [Math.sqrt(d1),Math.sqrt(d2)];
}

const noiseFns = { initNoise, fbm, ridged, noise2D, worley };

// ── Load Earth data for comparison ──
const earthSrc = readFileSync('src/earthData.js', 'utf8');
const b64Match = earthSrc.match(/export const EARTH_ELEV="([^"]+)"/);
const earthRaw = Buffer.from(b64Match[1], 'base64');
const EARTH_W = 720, EARTH_H = 360;

function sampleEarth(x, y, tw, th) {
  const fx = (x / tw) * EARTH_W, fy = (y / th) * EARTH_H;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  return earthRaw[y0 * EARTH_W + (x0 % EARTH_W)];
}

// ── Build Earth elevation at our resolution ──
const W = 1920, H = 960;

function buildEarthElev() {
  initNoise(42);
  const elevation = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, nx = x / W, ny = y / H;
    const he = sampleEarth(x, y, W, H);
    const noise = fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012 + fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
    if (he < 3) { elevation[i] = -0.03 - Math.max(0,(1-he/3))*0.12 + fbm(nx*8+50,ny*8+50,3,2,.5)*.04; }
    else { elevation[i] = Math.max(0.001, (he-3)/252*0.55 + 0.005 + noise); }
  }
  return elevation;
}

// ── Metric computation ──
function computeMetrics(elevation, label) {
  const N = W * H;
  let landCount = 0, oceanCount = 0;
  const landElevs = [];

  // Basic counts
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0) { landCount++; landElevs.push(elevation[i]); }
    else oceanCount++;
  }
  landElevs.sort((a, b) => a - b);

  const landFrac = landCount / N;

  // ── Continent detection via flood fill ──
  const visited = new Uint8Array(N);
  const continents = [];
  for (let i = 0; i < N; i++) {
    if (visited[i] || elevation[i] <= 0) continue;
    // BFS flood fill
    const queue = [i];
    visited[i] = 1;
    let size = 0, sumLat = 0, sumLon = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (queue.length > 0) {
      const ci = queue.pop();
      size++;
      const cx = ci % W, cy = (ci - cx) / W;
      sumLat += cy; sumLon += cx;
      if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
      // 4-connected neighbors (wrap X)
      const neighbors = [
        cy * W + (cx + 1) % W,
        cy * W + (cx - 1 + W) % W,
        Math.min(H-1, cy+1) * W + cx,
        Math.max(0, cy-1) * W + cx,
      ];
      for (const ni of neighbors) {
        if (!visited[ni] && elevation[ni] > 0) {
          visited[ni] = 1;
          queue.push(ni);
        }
      }
    }
    continents.push({ size, lat: sumLat / size, lon: sumLon / size, minX, maxX, minY, maxY });
  }
  continents.sort((a, b) => b.size - a.size);

  // ── Latitude distribution of land ──
  const latBands = 18; // 10° bands
  const latLand = new Array(latBands).fill(0);
  const latTotal = new Array(latBands).fill(0);
  for (let y = 0; y < H; y++) {
    const band = Math.min(latBands - 1, Math.floor(y / H * latBands));
    for (let x = 0; x < W; x++) {
      latTotal[band]++;
      if (elevation[y * W + x] > 0) latLand[band]++;
    }
  }

  // ── Elevation percentiles ──
  const p = (arr, pct) => arr[Math.floor(arr.length * pct)] || 0;

  // ── Coastline density (land pixels adjacent to ocean) ──
  let coastPixels = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (elevation[i] <= 0) continue;
    const xL = (x - 1 + W) % W, xR = (x + 1) % W;
    if (elevation[y * W + xL] <= 0 || elevation[y * W + xR] <= 0 ||
        elevation[(y-1) * W + x] <= 0 || elevation[(y+1) * W + x] <= 0) {
      coastPixels++;
    }
  }

  // ── Mountain pixels (elevation > threshold) ──
  let highMtn = 0, medMtn = 0;
  for (let i = 0; i < N; i++) {
    if (elevation[i] > 0.4) highMtn++;
    else if (elevation[i] > 0.2) medMtn++;
  }

  return {
    label,
    landFrac,
    landCount,
    numContinents: continents.filter(c => c.size > 500).length,
    numIslands: continents.filter(c => c.size > 20 && c.size <= 500).length,
    numTiny: continents.filter(c => c.size <= 20).length,
    top5: continents.slice(0, 5).map(c => ({
      size: c.size,
      pctOfLand: (c.size / landCount * 100).toFixed(1),
      centerLat: (90 - c.lat / H * 180).toFixed(0),
    })),
    largestPct: continents[0] ? (continents[0].size / landCount * 100).toFixed(1) : 0,
    smallest5Pct: continents.length >= 5 ? (continents[4].size / landCount * 100).toFixed(1) : 0,
    elevP10: p(landElevs, 0.10).toFixed(3),
    elevP25: p(landElevs, 0.25).toFixed(3),
    elevP50: p(landElevs, 0.50).toFixed(3),
    elevP75: p(landElevs, 0.75).toFixed(3),
    elevP90: p(landElevs, 0.90).toFixed(3),
    elevP99: p(landElevs, 0.99).toFixed(3),
    coastPixels,
    coastRatio: (coastPixels / landCount).toFixed(3),
    highMtnPct: (highMtn / landCount * 100).toFixed(1),
    medMtnPct: (medMtn / landCount * 100).toFixed(1),
    latLandPct: latLand.map((v, i) => ((v / latTotal[i]) * 100).toFixed(0)),
  };
}

function printMetrics(m) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${m.label}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Land fraction:     ${(m.landFrac * 100).toFixed(1)}%`);
  console.log(`  Continents (>500px): ${m.numContinents}`);
  console.log(`  Islands (20-500):    ${m.numIslands}`);
  console.log(`  Tiny (<20px):        ${m.numTiny}`);
  console.log(`  Largest continent:   ${m.largestPct}% of land`);
  console.log(`  5th largest:         ${m.smallest5Pct}% of land`);

  console.log(`\n  Top 5 landmasses:`);
  for (let i = 0; i < m.top5.length; i++) {
    const c = m.top5[i];
    console.log(`    ${(i+1)}. ${c.size.toLocaleString()} px (${c.pctOfLand}%) center ~${c.centerLat}°`);
  }

  console.log(`\n  Elevation percentiles (land only):`);
  console.log(`    10th: ${m.elevP10}  25th: ${m.elevP25}  50th: ${m.elevP50}`);
  console.log(`    75th: ${m.elevP75}  90th: ${m.elevP90}  99th: ${m.elevP99}`);

  console.log(`\n  Mountains: ${m.highMtnPct}% high (>0.4), ${m.medMtnPct}% medium (0.2-0.4)`);
  console.log(`  Coastline: ${m.coastPixels.toLocaleString()} pixels (${m.coastRatio} of land)`);

  console.log(`\n  Land % by latitude (10° bands, 90°N to 90°S):`);
  const bands = ['90-80N','80-70N','70-60N','60-50N','50-40N','40-30N','30-20N','20-10N','10-0N',
                  '0-10S','10-20S','20-30S','30-40S','40-50S','50-60S','60-70S','70-80S','80-90S'];
  for (let i = 0; i < 18; i++) {
    const bar = '█'.repeat(Math.round(+m.latLandPct[i] / 3));
    console.log(`    ${bands[i].padEnd(7)} ${m.latLandPct[i].padStart(3)}% ${bar}`);
  }
}

function compareMetrics(earth, gen) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  COMPARISON: Earth vs Generated');
  console.log(`${'═'.repeat(60)}`);

  const checks = [
    { name: 'Land fraction', eVal: earth.landFrac, gVal: gen.landFrac, fmt: v => (v*100).toFixed(1)+'%', tol: 0.03 },
    { name: 'Continents', eVal: earth.numContinents, gVal: gen.numContinents, fmt: v => v.toString(), tol: 3 },
    { name: 'Islands', eVal: earth.numIslands, gVal: gen.numIslands, fmt: v => v.toString(), tol: 20 },
    { name: 'Largest continent %', eVal: +earth.largestPct, gVal: +gen.largestPct, fmt: v => v.toFixed(1)+'%', tol: 10 },
    { name: 'Elevation P50', eVal: +earth.elevP50, gVal: +gen.elevP50, fmt: v => v.toFixed(3), tol: 0.03 },
    { name: 'Elevation P90', eVal: +earth.elevP90, gVal: +gen.elevP90, fmt: v => v.toFixed(3), tol: 0.05 },
    { name: 'High mountain %', eVal: +earth.highMtnPct, gVal: +gen.highMtnPct, fmt: v => v.toFixed(1)+'%', tol: 2 },
    { name: 'Coast ratio', eVal: +earth.coastRatio, gVal: +gen.coastRatio, fmt: v => v.toFixed(3), tol: 0.03 },
  ];

  let good = 0;
  for (const c of checks) {
    const diff = Math.abs(c.eVal - c.gVal);
    const ok = diff <= c.tol ? '✓' : (diff <= c.tol * 2 ? '~' : '✗');
    if (ok === '✓') good++;
    console.log(`  ${ok} ${c.name.padEnd(22)} Earth: ${c.fmt(c.eVal).padStart(8)}  Gen: ${c.fmt(c.gVal).padStart(8)}  diff: ${diff.toFixed(3)}`);
  }

  // Latitude band comparison
  console.log(`\n  Latitude land distribution comparison:`);
  const bands = ['90-80N','80-70N','70-60N','60-50N','50-40N','40-30N','30-20N','20-10N','10-0N',
                  '0-10S','10-20S','20-30S','30-40S','40-50S','50-60S','60-70S','70-80S','80-90S'];
  let latDiffSum = 0;
  for (let i = 0; i < 18; i++) {
    const e = +earth.latLandPct[i], g = +gen.latLandPct[i];
    const diff = Math.abs(e - g);
    latDiffSum += diff;
    const ok = diff <= 10 ? '✓' : (diff <= 20 ? '~' : '✗');
    console.log(`    ${ok} ${bands[i].padEnd(7)} E:${e.toString().padStart(3)}% G:${g.toString().padStart(3)}% diff:${diff.toFixed(0).padStart(3)}`);
  }
  console.log(`    Mean lat diff: ${(latDiffSum / 18).toFixed(1)}%`);

  return good;
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════

console.log('Building Earth reference...');
const earthElev = buildEarthElev();
const earthMetrics = computeMetrics(earthElev, 'REAL EARTH');
printMetrics(earthMetrics);

// Generate tectonic worlds
const { generateTectonicWorld } = await import('../src/tectonicGen.js');

const NUM_SEEDS = 3;
const allGenMetrics = [];

for (let s = 0; s < NUM_SEEDS; s++) {
  const seed = 42 + s * 137;
  console.log(`\nGenerating tectonic world (seed ${seed})...`);
  const t0 = Date.now();
  const world = generateTectonicWorld(W, H, seed, noiseFns, {});
  console.log(`Done in ${Date.now() - t0}ms`);

  const metrics = computeMetrics(world.elevation, `TECTONIC (seed ${seed})`);
  printMetrics(metrics);
  allGenMetrics.push(metrics);

  compareMetrics(earthMetrics, metrics);
}

// Average across seeds
if (NUM_SEEDS > 1) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  AVERAGE ACROSS ${NUM_SEEDS} SEEDS`);
  console.log(`${'═'.repeat(60)}`);
  const avg = (arr, key) => arr.reduce((s, m) => s + (+m[key] || 0), 0) / arr.length;
  console.log(`  Land fraction:  ${(avg(allGenMetrics, 'landFrac') * 100).toFixed(1)}% (Earth: ${(earthMetrics.landFrac * 100).toFixed(1)}%)`);
  console.log(`  Continents:     ${avg(allGenMetrics, 'numContinents').toFixed(1)} (Earth: ${earthMetrics.numContinents})`);
  console.log(`  Largest cont:   ${avg(allGenMetrics, 'largestPct').toFixed(1)}% (Earth: ${earthMetrics.largestPct}%)`);
  console.log(`  Elev P50:       ${avg(allGenMetrics, 'elevP50').toFixed(3)} (Earth: ${earthMetrics.elevP50})`);
  console.log(`  High mtn %:     ${avg(allGenMetrics, 'highMtnPct').toFixed(1)}% (Earth: ${earthMetrics.highMtnPct}%)`);
  console.log(`  Coast ratio:    ${avg(allGenMetrics, 'coastRatio').toFixed(3)} (Earth: ${earthMetrics.coastRatio})`);
}
