// ── Tectonic Plate Terrain Generator ──
// Hybrid model: stamp-based land shapes + Voronoi plate boundaries.
// Land shapes use multi-stamp composition (from Random mode) centered on
import { solveWind } from "./windSolver.js";
import { solveMoisture } from "./moistureSolver.js";
// continental plate nuclei, giving organic coastlines with peninsulas and bays.
// Tectonic boundary effects (mountains, rifts) are layered on top.
// Continentality-based interior terrain fills land interiors.

export function generateTectonicWorld(W, H, seed, noiseFns, params = {}) {
const { initNoise, fbm, ridged, noise2D, worley } = noiseFns;
initNoise(seed);
const p = (k, d) => params[k] !== undefined ? params[k] : d;
let rngState = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
const rng = () => { rngState = (rngState * 16807) % 2147483647; return (rngState - 1) / 2147483646; };
const elevation = new Float32Array(W * H);
const moisture = new Float32Array(W * H);
const temperature = new Float32Array(W * H);
const RES = 2;

// ═══════════════════════════════════════════════════════
// STEP 1: Coarse simulation grid
// ═══════════════════════════════════════════════════════
const CG = 4;
const cw = Math.ceil(W / CG), ch = Math.ceil(H / CG);
const N = cw * ch;

// ═══════════════════════════════════════════════════════
// STEP 2: Generate plates with velocities
// Real plates have huge size variation (Pacific plate is ~30% of Earth's
// surface, Juan de Fuca is tiny). Use weighted Voronoi (power diagram)
// with log-normal-ish weight distribution for realistic size disparity.
// ═══════════════════════════════════════════════════════
const numMajor = p('numMajorBase', 6) + Math.floor(rng() * p('numMajorRange', 3));
const numMinor = p('numMinorBase', 5) + Math.floor(rng() * p('numMinorRange', 4));
const numPlates = numMajor + numMinor;
const plates = [];

for (let i = 0; i < numPlates; i++) {
  const isMajor = i < numMajor;
  let cx, cy;
  if (isMajor) {
    // Spread major plates but with more randomness than before
    cx = (i + 0.1 + rng() * 0.8) / numMajor;
    cy = 0.10 + rng() * 0.80;
  } else {
    cx = rng();
    cy = 0.06 + rng() * 0.88;
  }
  cx = ((cx % 1) + 1) % 1;
  cy = Math.max(0.02, Math.min(0.98, cy));
  const angle = rng() * Math.PI * 2;
  const speed = 0.4 + rng() * 0.8;

  // Power diagram weights: major plates get large weights (big territory),
  // minor plates get small weights (tiny territory). Variance within each
  // class adds further irregularity. Weight units are squared-distance offsets.
  const weight = isMajor
    ? p('majorWeightMin', 0.012) + rng() * p('majorWeightRange', 0.020)
    : p('minorWeightMin', 0.003) + rng() * p('minorWeightRange', 0.005);

  const hasCont = isMajor ? rng() < p('majorContProb', 0.70) : rng() < p('minorContProb', 0.40);

  const nucAngle = rng() * Math.PI * 2;
  const nucOffset = 0.02 + rng() * 0.08;
  const nucX = cx + Math.cos(nucAngle) * nucOffset;
  const nucY = cy + Math.sin(nucAngle) * nucOffset;

  // Larger continent radii for major plates → more cohesive landmasses
  const contRadius = hasCont ? (isMajor ? p('majorContRadMin', 0.10) + rng() * p('majorContRadRange', 0.10) : p('minorContRadMin', 0.05) + rng() * p('minorContRadRange', 0.06)) : 0;

  plates.push({
    cx, cy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    id: i,
    weight,
    hasCont,
    nucX, nucY,
    contRadius,
  });
}
// Guarantee at least 3 major plates carry continental crust
let numWithCont = plates.filter(p => p.hasCont).length;
while (numWithCont < 3) {
  const idx = Math.floor(rng() * numMajor);
  if (!plates[idx].hasCont) {
    plates[idx].hasCont = true;
    plates[idx].contRadius = 0.10 + rng() * 0.10;
    numWithCont++;
  }
}

// ═══════════════════════════════════════════════════════
// STEP 3: Weighted Voronoi (power diagram) with multi-scale warping
// Power diagram: d_eff = d² - weight, so larger weights → larger plates.
// Warping uses smooth fbm for large-scale shape + ridged/Worley noise
// for jagged, irregular boundary details like real plate edges.
// ═══════════════════════════════════════════════════════
const plateMap = new Uint8Array(N);
const pixPlate = new Uint8Array(W * H);

// Compute plate assignment at half resolution (4x fewer noise calls)
const PS = 2;
const ppW = Math.ceil(W / PS), ppH = Math.ceil(H / PS);
const pixPlateCoarse = new Uint8Array(ppW * ppH);

const _ws1 = p('warpStr1', 0.11), _ws2 = p('warpStr2', 0.05), _js = p('jagStr', 0.04);
const _psx = p('plateStretchX', 1.3), _psy = p('plateStretchY', 0.8);
for (let py = 0; py < ppH; py++) for (let px = 0; px < ppW; px++) {
  const x = px * PS, y = py * PS;
  const nx = x / W, ny = y / H;
  // Latitude correction for plate distance (geometry), not noise
  const cL = Math.max(0.15, Math.cos((ny - 0.5) * Math.PI));
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 3, 2, 0.5) * _ws1
    + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 3, 2, 0.5) * _ws2;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 3, 2, 0.5) * _ws1
    + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 3, 2, 0.5) * _ws2;
  const jagX = ridged(nx * 12 + 41.3, ny * 12 + 41.3, 3, 2.2, 2.0, 1.0) * _js
    - noise2D(nx * 18 + 55.1, ny * 18 + 55.1) * 0.012;
  const jagY = ridged(nx * 12 + 91.3, ny * 12 + 91.3, 3, 2.2, 2.0, 1.0) * _js
    - noise2D(nx * 18 + 105.1, ny * 18 + 105.1) * 0.012;
  const wnx = nx + warpX + jagX, wny = ny + warpY + jagY;
  const plateLat = (ny - 0.5) * Math.PI;
  const plateCosLat = Math.max(0.15, Math.cos(plateLat));
  let bestD = 1e9, bestP = 0;
  for (let pi = 0; pi < numPlates; pi++) {
    let dx = wnx - plates[pi].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    dx *= plateCosLat; // correct for longitude convergence at poles
    const dy = wny - plates[pi].cy;
    const d = dx * dx * _psx + dy * dy * _psy - plates[pi].weight;
    if (d < bestD) { bestD = d; bestP = pi; }
  }
  pixPlateCoarse[py * ppW + px] = bestP;
}

// Nearest-neighbor upsample to full resolution
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  pixPlate[y * W + x] = pixPlateCoarse[Math.min(ppH - 1, (y / PS) | 0) * ppW + Math.min(ppW - 1, (x / PS) | 0)];
}
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 4: Multi-stamp land generation centered on plate nuclei
// Major continental plates get many tightly-clustered overlapping ellipses
// for cohesive, bulky landmasses. Minor plates get fewer, smaller stamps.
// ═══════════════════════════════════════════════════════
const rawElev = new Float32Array(W * H);
const posStamps = [], negStamps = [];
// Map is 2:1 (equirectangular). Continent gen works in normalized 1x1 space,
// so a y-step must be AR* longer to cover the same display pixels as an x-step.
const AR = W / H;

for (let pi = 0; pi < numPlates; pi++) {
  const plate = plates[pi];
  if (!plate.hasCont || plate.contRadius <= 0) continue;

  const isMaj = pi < numMajor;
  const cx = plate.nucX, cy = plate.nucY;
  const no = rng() * 100;
  const scale = plate.contRadius / 0.18;

  const numSubs = isMaj ? p('majorSubsBase', 7) + Math.floor(rng() * p('majorSubsRange', 5)) : p('minorSubsBase', 3) + Math.floor(rng() * p('minorSubsRange', 4));

  // Grow the continent as a branching, curling walk of overlapping stamps —
  // elongated and irregular rather than a round cluster around the nucleus.
  const growAngle = rng() * Math.PI * 2;
  const elong = 0.4 + rng() * 0.5;
  const maxExtent = plate.contRadius * (1.4 + rng() * 1.0);
  const placed = [];
  for (let s = 0; s < numSubs; s++) {
    const baseR = (s === 0
      ? (isMaj ? p('majorCoreRadMin', 0.12) + rng() * p('majorCoreRadRange', 0.10) : p('minorCoreRadMin', 0.07) + rng() * p('minorCoreRadRange', 0.06))
      : (isMaj ? p('majorSubRadMin', 0.05) + rng() * p('majorSubRadRange', 0.08) : p('minorSubRadMin', 0.03) + rng() * p('minorSubRadRange', 0.05))
    ) * scale;
    let sx, sy;
    if (s === 0) { sx = cx; sy = cy; }
    else {
      const parent = rng() < 0.62 ? placed[placed.length - 1] : placed[Math.floor(rng() * placed.length)];
      const pdx = parent.x - cx, pdy = (parent.y - cy) / AR;
      const pull = Math.min(1, Math.sqrt(pdx * pdx + pdy * pdy) / maxExtent);
      let ang;
      if (rng() < pull * 0.85) ang = Math.atan2((cy - parent.y) / AR, cx - parent.x) + (rng() - 0.5) * 2.0;
      else ang = (rng() < elong) ? growAngle + (rng() - 0.5) * 1.7 : rng() * Math.PI * 2;
      const step = (parent.r + baseR) * (0.5 + rng() * 0.32);
      sx = parent.x + Math.cos(ang) * step;
      sy = parent.y + Math.sin(ang) * step * AR;
    }
    placed.push({ x: sx, y: sy, r: baseR });
    const aspect = s === 0 ? 1 + rng() * 0.5 : 1.2 + rng() * rng() * 2.2;
    const rot = rng() < 0.55 ? growAngle + (rng() - 0.5) * 0.9 : rng() * Math.PI;
    posStamps.push({
      cx: sx, cy: sy,
      rx: baseR * aspect, ry: baseR / aspect * AR,
      rot, cos: Math.cos(rot), sin: Math.sin(rot),
      str: s === 0 ? 0.9 + rng() * 0.3 : 0.55 + rng() * 0.4,
      no: no + s * 17,
      plateId: pi,
      contRadius: plate.contRadius
    });
  }

  const numNegs = isMaj ? Math.floor(rng() * p('majorNegsMax', 4)) : Math.floor(rng() * p('minorNegsMax', 1.5));
  for (let n = 0; n < numNegs; n++) {
    const anchor = placed[Math.floor(rng() * placed.length)];
    const ang = rng() * Math.PI * 2;
    const dist = anchor.r * (0.55 + rng() * 0.85);
    const rot = rng() * Math.PI;
    negStamps.push({
      cx: anchor.x + Math.cos(ang) * dist,
      cy: anchor.y + Math.sin(ang) * dist,
      rx: (0.02 + rng() * 0.05) * scale,
      ry: (0.015 + rng() * 0.035) * scale * AR,
      rot, cos: Math.cos(rot), sin: Math.sin(rot),
      str: 0.25 + rng() * 0.3,
      no: no + 50 + n * 13,
      plateId: pi,
      contRadius: plate.contRadius
    });
  }
}

// Pre-compute bounding radius for early-out in stamp loops
for (const c of posStamps) {
  const b = Math.max(c.rx, c.ry) + 0.08;
  c.bound2 = b * b;
}
for (const c of negStamps) {
  const b = Math.max(c.rx, c.ry) + 0.08;
  c.bound2 = b * b;
}

const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100;
const s4 = rng() * 100, s5 = rng() * 100;
const warp = (x, y, freq, oct, str, o1, o2) => [
  x + fbm(x * freq + o1, y * freq + o1, oct, 2, 0.5) * str,
  y + fbm(x * freq + o2, y * freq + o2, oct, 2, 0.5) * str
];

// Generate raw elevation from stamps at half resolution (4x fewer noise calls)
const ES = 2;
const ewW = Math.ceil(W / ES), ewH = Math.ceil(H / ES);
const rawElevCoarse = new Float32Array(ewW * ewH);

for (let ey = 0; ey < ewH; ey++) for (let ex = 0; ex < ewW; ex++) {
  const x = ex * ES, y = ey * ES;
  const nx = x / W, ny = y / H;
  const cL = Math.max(0.15, Math.cos((ny - 0.5) * Math.PI));
  let e = 0;

  // Iterative domain warping (double Quilez warp)
  const w1x = fbm(nx * 2.5 + s1, ny * 2.5 + s1, 2, 2, 0.5) * 0.08;
  const w1y = fbm(nx * 2.5 + s1 + 50, ny * 2.5 + s1 + 50, 2, 2, 0.5) * 0.08;
  const wnx = nx + w1x + fbm((nx + w1x) * 5 + s2, (ny + w1y) * 5 + s2, 2, 2, 0.5) * 0.04;
  const wny = ny + w1y + fbm((nx + w1x) * 5 + s2 + 30, (ny + w1y) * 5 + s2 + 30, 2, 2, 0.5) * 0.04;

  // Shared coastline noise
  const cnA = noise2D(wnx * 5 + s1, wny * 5 + s1) * 0.04;
  const cnB = noise2D(wnx * 5 + s1 + 30, wny * 5 + s1 + 30) * 0.04;
  const coastRidge = noise2D(wnx * 14 + s2 + 50, wny * 14 + s2 + 50);

  const pxPlateId = pixPlate[y * W + x];
  const pxPlateW = plates[pxPlateId] ? plates[pxPlateId].weight : 0;
  // Latitude correction: scale X distance by cos(lat) so stamps
  // are physically round on the sphere, not stretched at poles
  const lat = (ny - 0.5) * Math.PI; // -π/2 to π/2
  const cosLat = Math.max(0.15, Math.cos(lat)); // clamp to prevent infinity at poles
  for (const c of posStamps) {
    let dx = wnx - c.cx; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    dx *= cosLat; // correct for longitude convergence
    const dy0 = wny - c.cy;
    if (dx * dx + dy0 * dy0 > c.bound2) continue;
    dx += cnA; let dy = dy0 + cnB;
    let dd = Math.sqrt(Math.pow((dx * c.cos + dy * c.sin) / c.rx, 2) + Math.pow((-dx * c.sin + dy * c.cos) / c.ry, 2));
    dd += Math.abs(coastRidge + noise2D(wnx * 7 + c.no, wny * 7 + c.no) * 0.5) * 0.2;
    if (dd > 0.7 && dd < 1.3) { const rn = 1 - Math.abs(noise2D(wnx * 8 + c.no + 70, wny * 8 + c.no + 70)); dd += rn * rn * 0.12; }
    if (dd < 1) {
      const f2 = 1 - dd;
      let plateFactor = 1.0;
      if (pxPlateId !== c.plateId) {
        const stampW = plates[c.plateId] ? plates[c.plateId].weight : 0;
        const ratio = pxPlateW > 0.001 ? stampW / pxPlateW : 5;
        plateFactor = ratio > 2.5 ? Math.min(0.18, (ratio - 2.5) * 0.06) : 0.02;
      }
      e += f2 * f2 * c.str * plateFactor;
    }
  }

  for (const c of negStamps) {
    let dx = wnx - c.cx; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    dx *= cosLat;
    const dy0 = wny - c.cy;
    if (dx * dx + dy0 * dy0 > c.bound2) continue;
    dx += cnA; let dy = dy0 + cnB;
    let dd = Math.sqrt(Math.pow((dx * c.cos + dy * c.sin) / c.rx, 2) + Math.pow((-dx * c.sin + dy * c.cos) / c.ry, 2));
    dd += Math.abs(coastRidge + noise2D(wnx * 5 + c.no, wny * 5 + c.no) * 0.5) * 0.18;
    if (dd < 1) {
      const f2 = 1 - dd;
      let plateFactor = 1.0;
      if (pxPlateId !== c.plateId) {
        const stampW = plates[c.plateId] ? plates[c.plateId].weight : 0;
        const ratio = pxPlateW > 0.001 ? stampW / pxPlateW : 5;
        plateFactor = ratio > 2.5 ? Math.min(0.18, (ratio - 2.5) * 0.06) : 0.02;
      }
      e -= f2 * f2 * c.str * plateFactor;
    }
  }

  const onContPlate = plates[pxPlateId] && plates[pxPlateId].hasCont ? 1.0 : 0.12;
  const penNoise = fbm(wnx * 4 + s3 + 90, wny * 4 + s3 + 90, 3, 2, 0.5);
  if (penNoise > p('penThreshold', 0.4)) e += (penNoise - p('penThreshold', 0.4)) * p('penStrength', 0.3) * onContPlate;
  const bayNoise = fbm(wnx * 3.5 + s4 + 120, wny * 3.5 + s4 + 120, 3, 2, 0.5);
  if (bayNoise > p('bayThreshold', 0.45)) e -= (bayNoise - p('bayThreshold', 0.45)) * p('bayStrength', 0.25) * onContPlate;

  const [wf1, wf2] = worley(wnx * 5 + s5, wny * 5 + s5);
  if (e > -0.1) e += (wf2 - wf1) * 0.04 - 0.02;

  e += fbm(wnx * 7 + 3.7, wny * 7 + 3.7, 4, 2, 0.5) * 0.10;
  e += fbm(nx * 20 + s3, ny * 20 + s3, 2, 2, 0.4) * 0.025;

  rawElevCoarse[ey * ewW + ex] = e;
}

// Bilinear upsample to full resolution
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = x / ES, fy = y / ES;
  const ix = Math.min(ewW - 2, fx | 0), iy = Math.min(ewH - 2, fy | 0);
  const ixr = (ix + 1) % ewW; // wrap X
  const dx = fx - ix, dy = fy - iy;
  rawElev[y * W + x] = (rawElevCoarse[iy * ewW + ix] * (1 - dx) + rawElevCoarse[iy * ewW + ixr] * dx) * (1 - dy)
    + (rawElevCoarse[(iy + 1) * ewW + ix] * (1 - dx) + rawElevCoarse[(iy + 1) * ewW + ixr] * dx) * dy;
}
// Blend seam: cross-fade a strip at the antimeridian so left/right edges match
{
  const blendW = Math.round(W * 0.03); // ~3% of map width = ~58 pixels
  for (let y = 0; y < H; y++) {
    for (let bx = 0; bx < blendW; bx++) {
      const t = bx / blendW; // 0 at edge, 1 at blend boundary
      // Left edge pixel and its mirror on the right
      const iL = y * W + bx;
      const iR = y * W + (W - 1 - bx);
      // Average of both sides at the seam
      const avg = (rawElev[iL] + rawElev[iR]) * 0.5;
      // Blend toward average near the edge, keep original further in
      const s = 0.5 * (1 - t); // blend strength: 0.5 at edge, 0 at boundary
      rawElev[iL] = rawElev[iL] * (1 - s) + avg * s;
      rawElev[iR] = rawElev[iR] * (1 - s) + avg * s;
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 4b: Sea level + derive crustType from stamps
// ═══════════════════════════════════════════════════════
const sorted = Float32Array.from(rawElev).sort();
const sl = sorted[Math.floor(W * H * p('seaLevel', 0.67))];
const isLandArr = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) isLandArr[i] = rawElev[i] > sl ? 1 : 0;

// Add coastline noise at full resolution to break up smooth bilinear edges
// This creates fractal coastlines, fjords, and small offshore islands
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  // Only apply near the coastline (within ~0.03 of sea level)
  const dist = rawElev[i] - sl;
  if (Math.abs(dist) < 0.04) {
    const coastNoise = fbm(nx * 30 + s2 + 200, ny * 30 + s2 + 200, 3, 2, 0.5) * 0.035
      + fbm(nx * 60 + s3 + 300, ny * 60 + s3 + 300, 2, 2, 0.4) * 0.018
      + fbm(nx * 120 + s4 + 400, ny * 120 + s4 + 400, 2, 2, 0.4) * 0.008;
    rawElev[i] += coastNoise;
    isLandArr[i] = rawElev[i] > sl ? 1 : 0;
  }
}

// Remove tiny isolated land clusters (< 5 pixels)
const visited = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (!isLandArr[i] || visited[i]) continue;
  const q = [i], cluster = []; visited[i] = 1;
  while (q.length) {
    const ci = q.pop(); cluster.push(ci);
    const cx2 = ci % W, cy2 = (ci - cx2) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx2 = (cx2 + dx + W) % W, ny2 = cy2 + dy;
      if (ny2 < 0 || ny2 >= H) continue;
      const ni = ny2 * W + nx2;
      if (isLandArr[ni] && !visited[ni]) { visited[ni] = 1; q.push(ni); }
    }
  }
  if (cluster.length < 5) for (const ci of cluster) { isLandArr[ci] = 0; rawElev[ci] = sl - 0.01; }
}

// Derive crustType on coarse grid from stamp land
const crustType = new Uint8Array(N);
const crust = new Float32Array(N); // tectonic modifier (starts at 0)
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const px = Math.min(W - 1, tx * CG), py = Math.min(H - 1, ty * CG);
  crustType[ty * cw + tx] = isLandArr[py * W + px];
}

// ═══════════════════════════════════════════════════════
// STEP 5: Compute boundary interactions
// ═══════════════════════════════════════════════════════
const D8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

const boundaryConv = new Float32Array(N);
const boundaryDiv = new Float32Array(N);
const boundaryCont = new Uint8Array(N);
const boundaryOceCont = new Uint8Array(N);

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const i = ty * cw + tx;
  const myPlate = plateMap[i];

  for (const [ddx, ddy] of D8) {
    const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2;
    const neighborPlate = plateMap[ni];
    if (neighborPlate === myPlate) continue;

    const pA = plates[myPlate], pB = plates[neighborPlate];
    if (!pA || !pB) continue;

    let bnx = ddx, bny = ddy;
    const bl = Math.sqrt(bnx * bnx + bny * bny) || 1;
    bnx /= bl; bny /= bl;

    const convRate = ((pB.vx - pA.vx) * bnx + (pB.vy - pA.vy) * bny);
    const myType = crustType[i];
    const neighborType = crustType[ni];

    if (convRate > 0.05) {
      // Uplift only on THIS cell's side (overriding plate). Never the neighbor.
      const strength = Math.min(1.5, convRate);
      if (myType === 1 && neighborType === 1) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * p('contContUplift', 0.20));
        boundaryCont[i] = 1;
      } else if (myType === 1 && neighborType === 0) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * p('contOceanUplift', 0.15));
        boundaryOceCont[i] = 1;
      } else if (myType === 0 && neighborType === 1) {
        boundaryDiv[i] = Math.max(boundaryDiv[i], strength * 0.04);
      } else {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.02);
      }
    } else if (convRate < -0.05) {
      const divStrength = Math.min(1.5, -convRate);
      if (myType === 1) {
        boundaryDiv[i] = Math.max(boundaryDiv[i], divStrength * 0.06);
      } else {
        boundaryConv[i] = Math.max(boundaryConv[i], divStrength * 0.015);
      }
    }
  }
}

// ── Propagate boundary effects inward via BFS ──
const mtnEffect = new Float32Array(N);
const riftEffect = new Float32Array(N);

// Mountain propagation (convergent effects)
// BFS stays within the same plate. Range scales by boundary type:
// continent-continent: 60 cells (~1300km) for Tibet/Himalaya-scale plateaus
// ocean-continent: 25 cells (~550km) for Andes/Altiplano-scale
// ocean-ocean: 12 cells
{
  const dist = new Float32Array(N).fill(1e9);
  const seedPlate = new Uint8Array(N);
  const seedType = new Uint8Array(N); // 2=cont-cont, 1=oce-cont, 0=oce-oce
  const seedStr = new Float32Array(N); // original boundary strength for this seed
  const queue = [];
  for (let i = 0; i < N; i++) {
    if (boundaryConv[i] > 0) {
      mtnEffect[i] = boundaryConv[i];
      dist[i] = 0;
      seedPlate[i] = plateMap[i];
      seedType[i] = boundaryCont[i] ? 2 : (boundaryOceCont[i] ? 1 : 0);
      seedStr[i] = boundaryConv[i];
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const ci = queue[qi];
    const cd = dist[ci];
    const st = seedType[ci];
    const maxDist = st === 2 ? p('contContMaxDist', 60) : (st === 1 ? p('contOceanMaxDist', 25) : 12);
    if (cd > maxDist) continue;
    const ty = Math.floor(ci / cw), tx = ci % cw;
    const srcPlate = seedPlate[ci];
    for (const [ddx, ddy] of D8) {
      const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
      if (ny2 < 0 || ny2 >= ch) continue;
      const ni = ny2 * cw + nx2;
      if (plateMap[ni] !== srcPlate) continue;
      const nd = cd + (Math.abs(ddx) + Math.abs(ddy) > 1 ? 1.41 : 1);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        seedPlate[ni] = srcPlate;
        seedType[ni] = st;
        seedStr[ni] = seedStr[ci];
        // Plateau-with-ramp falloff: small flat core then steeper Gaussian decay
        // cont-cont: flat for 10 cells (~220km) then ramp sigma=10
        // oce-cont: flat for 4 cells (~88km) then ramp sigma=8
        // oce-oce: pure Gaussian, sigma=5
        let falloff;
        if (st === 2) {
          const d = Math.max(0, nd - p('contContFlatCore', 10));
          const _s = p('contContSigma', 10);
          falloff = Math.exp(-d * d / (2 * _s * _s));
        } else if (st === 1) {
          const d = Math.max(0, nd - p('contOceanFlatCore', 4));
          const _s = p('contOceanSigma', 8);
          falloff = Math.exp(-d * d / (2 * _s * _s));
        } else {
          falloff = Math.exp(-nd * nd / (2 * 5 * 5));
        }
        const effect = seedStr[ci] * falloff;
        if (effect > mtnEffect[ni]) {
          mtnEffect[ni] = effect;
          queue.push(ni);
        }
      }
    }
  }
}

// Rift propagation (divergent effects) — also plate-constrained
{
  const dist = new Float32Array(N).fill(1e9);
  const seedPlate = new Uint8Array(N);
  const seedStr = new Float32Array(N);
  const queue = [];
  for (let i = 0; i < N; i++) {
    if (boundaryDiv[i] > 0) {
      riftEffect[i] = boundaryDiv[i];
      dist[i] = 0;
      seedPlate[i] = plateMap[i];
      seedStr[i] = boundaryDiv[i];
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const ci = queue[qi];
    const cd = dist[ci];
    if (cd > 10) continue;
    const ty = Math.floor(ci / cw), tx = ci % cw;
    const srcPlate = seedPlate[ci];
    for (const [ddx, ddy] of D8) {
      const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
      if (ny2 < 0 || ny2 >= ch) continue;
      const ni = ny2 * cw + nx2;
      if (plateMap[ni] !== srcPlate) continue;
      const nd = cd + (Math.abs(ddx) + Math.abs(ddy) > 1 ? 1.41 : 1);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        seedPlate[ni] = srcPlate;
        seedStr[ni] = seedStr[ci];
        const falloff = Math.exp(-nd * nd / 18);
        const effect = seedStr[ci] * falloff;
        if (effect > riftEffect[ni]) {
          riftEffect[ni] = effect;
          queue.push(ni);
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// Zero out ocean cells so the blur doesn't create land halos
for (let i = 0; i < N; i++) {
  if (crustType[i] !== 1) mtnEffect[i] = 0;
}

// ═══════════════════════════════════════════════════════
// STEP 5c: Wide plateau field via Gaussian blur of mtnEffect
// mtnEffect (sharp) gates where ridge TEXTURE appears.
// mtnBroad (blurred) creates wide plateau/foothill uplift (Tibet, Altiplano).
// ═══════════════════════════════════════════════════════
const mtnBroad = new Float32Array(N);
{
  const sigma = p('blurSigma', 14);
  const radius = Math.ceil(sigma * 2.5);
  const kernel = [];
  let kSum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-k * k / (2 * sigma * sigma));
    kernel.push(v); kSum += v;
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= kSum;

  // Horizontal pass
  const tmp = new Float32Array(N);
  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const sx = ((tx + k) % cw + cw) % cw;
      sum += mtnEffect[ty * cw + sx] * kernel[k + radius];
    }
    tmp[ty * cw + tx] = sum;
  }
  // Vertical pass
  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const sy = Math.max(0, Math.min(ch - 1, ty + k));
      sum += tmp[sy * cw + tx] * kernel[k + radius];
    }
    mtnBroad[ty * cw + tx] = sum;
  }
  // Ocean pixels are already gated by isLandArr in Step 8 — no need to
  // zero mtnBroad here. Letting the blur spread naturally into ocean cells
  // preserves a smooth gradient on the land side of the coastline.
}

// ═══════════════════════════════════════════════════════
// STEP 6: Build tectonic modifier on coarse grid
// ═══════════════════════════════════════════════════════
for (let i = 0; i < N; i++) {
  crust[i] = mtnEffect[i] - riftEffect[i];
  if (crustType[i] === 1) {
    crust[i] = Math.min(0.50, crust[i]);
    crust[i] = Math.max(-0.01, crust[i]);
  } else {
    crust[i] = Math.max(-0.25, crust[i]);
    if (crust[i] > 0 && crust[i] < 0.025) crust[i] = -0.01;
  }
}

// Smoothing: 4 passes
for (let pass = 0; pass < 4; pass++) {
  const smoothed = new Float32Array(N);
  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    const i = ty * cw + tx;
    let sum = crust[i] * 3, count = 3;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx2 = (tx + dx + cw) % cw, ny2 = ty + dy;
      if (ny2 < 0 || ny2 >= ch) continue;
      sum += crust[ny2 * cw + nx2]; count++;
    }
    smoothed[i] = sum / count;
  }
  for (let i = 0; i < N; i++) crust[i] = smoothed[i];
}

// ═══════════════════════════════════════════════════════
// STEP 7: Bicubic interpolation of tectonic modifier
// ═══════════════════════════════════════════════════════
const crustAt = (gx, gy) => {
  const tx = ((Math.floor(gx) % cw) + cw) % cw;
  const ty = Math.max(0, Math.min(ch - 1, Math.floor(gy)));
  return crust[ty * cw + tx];
};
// Bilinear interpolation (4 lookups vs 16 for bicubic — coarse grid is
// already smooth after 4 smoothing passes + sigma-14 blur)
const sampleCrust = (fx, fy) => {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const dx = fx - ix, dy = fy - iy;
  const v00 = crustAt(ix, iy), v10 = crustAt(ix + 1, iy);
  const v01 = crustAt(ix, iy + 1), v11 = crustAt(ix + 1, iy + 1);
  return (v00 * (1 - dx) + v10 * dx) * (1 - dy) + (v01 * (1 - dx) + v11 * dx) * dy;
};

// Bilinear sampler for coarse-grid fields (mtnEffect, mtnBroad)
const sampleCoarse = (field, fx, fy) => {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const dx = fx - ix, dy = fy - iy;
  const g = (gx, gy) => field[Math.max(0, Math.min(ch - 1, gy)) * cw + ((gx % cw) + cw) % cw];
  const val = (g(ix, iy) * (1 - dx) + g(ix + 1, iy) * dx) * (1 - dy)
    + (g(ix, iy + 1) * (1 - dx) + g(ix + 1, iy + 1) * dx) * dy;
  return Math.max(0, val);
};

// ═══════════════════════════════════════════════════════
// STEP 7b: Coast-distance BFS for continentality terrain
// ═══════════════════════════════════════════════════════
const DG = 1, dw = Math.ceil(W / DG), dh = Math.ceil(H / DG);
const cdist = new Uint8Array(dw * dh); cdist.fill(255);
const cdQ = [];
for (let ty = 0; ty < dh; ty++) for (let tx = 0; tx < dw; tx++) {
  const px = Math.min(W - 1, tx * DG), py = Math.min(H - 1, ty * DG), ti = ty * dw + tx;
  if (!isLandArr[py * W + px]) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx2 = (tx + dx + dw) % dw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const np = Math.min(W - 1, nx2 * DG), npy = Math.min(H - 1, ny2 * DG);
    if (!isLandArr[npy * W + np]) { cdist[ti] = 0; cdQ.push(ti); break; }
  }
}
for (let qi = 0; qi < cdQ.length; qi++) {
  const ci = cdQ[qi], cd = cdist[ci], cx = ci % dw, cy2 = (ci - cx) / dw;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx + dx + dw) % dw, ny2 = cy2 + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const ni = ny2 * dw + nx2, nd = cd + 1;
    const np = Math.min(W - 1, nx2 * DG), npy = Math.min(H - 1, ny2 * DG);
    if (nd < cdist[ni] && isLandArr[npy * W + np]) {
      cdist[ni] = nd; cdQ.push(ni);
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 8: Build final pixel-level elevation
// Stamp base + tectonic effects + continentality terrain
// ═══════════════════════════════════════════════════════
const smoothstep = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// Pre-compute low-frequency noise fields on coarse grid
// Eliminates ~28 per-pixel fbm calls (replaced with cheap bilinear lookups)
const NG = 4;
const ngW = Math.ceil(W / NG) + 1, ngH = Math.ceil(H / NG) + 1;
const precompute = (fn) => {
  const d = new Float32Array(ngW * ngH);
  for (let gy = 0; gy < ngH; gy++) for (let gx = 0; gx < ngW; gx++)
    d[gy * ngW + gx] = fn(gx * NG / W, gy * NG / H);
  // Copy first column to last for seamless X wrapping
  for (let gy = 0; gy < ngH; gy++)
    d[gy * ngW + (ngW - 1)] = d[gy * ngW + 0];
  return d;
};
const sg = (d, px, py) => {
  const fx = px / NG, fy = py / NG;
  const ix = Math.min(ngW - 2, fx | 0), iy = Math.min(ngH - 2, fy | 0);
  const ixr = (ix + 1) % ngW; // wrap X for seamless globe
  const dx = fx - ix, dy = fy - iy;
  return (d[iy * ngW + ix] * (1 - dx) + d[iy * ngW + ixr] * dx) * (1 - dy)
    + (d[(iy + 1) * ngW + ix] * (1 - dx) + d[(iy + 1) * ngW + ixr] * dx) * dy;
};
const nfTecWX = precompute((nx, ny) => fbm(nx * 3 + 200, ny * 3 + 200, 3, 2, 0.5));
const nfTecWY = precompute((nx, ny) => fbm(nx * 3 + 250, ny * 3 + 250, 3, 2, 0.5));
const nfPlateau = precompute((nx, ny) => fbm(nx * 3 + s1 + 50, ny * 3 + s1 + 50, 2, 2, 0.5));
const nfMtnBump = precompute((nx, ny) => fbm(nx * 8 + s2 + 30, ny * 8 + s2 + 30, 4, 2, 0.55));
const nfCoastEN = precompute((nx, ny) => fbm(nx * 10 + s3 + 40, ny * 10 + s3 + 40, 2, 2, 0.5));
const nfTemp = precompute((nx, ny) => fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5));
const nfTempBroad = precompute((nx, ny) => fbm(nx * 1.2 + s1 + 55, ny * 1.2 + s1 + 55, 3, 2, 0.55));
const nfMoistOce = precompute((nx, ny) => fbm(nx * 3 + 30, ny * 3 + 30, 2, 2, 0.5));
const nfMoistLand = precompute((nx, ny) => fbm(nx * 4 + 50, ny * 4 + 50, 4, 2, 0.55));
const nfMoistBroad = precompute((nx, ny) => fbm(nx * 1.5 + s2 + 90, ny * 1.5 + s2 + 90, 3, 2, 0.55));
const nfShield = precompute((nx, ny) => fbm(nx * 1.4 + s1 + 30, ny * 1.4 + s1 + 30, 2, 2, 0.6));
const nfBasin = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 2, 2, 0.03, s2 + 40, s2 + 90);
  return fbm(wx * 3.5 + s2 + 15, wy * 3.5 + s2 + 15, 3, 2, 0.55);
});
const nfEscarpment = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 3, 2, 0.04, s3 + 55, s3 + 105);
  return ridged(wx * 4 + s3 + 20, wy * 4 + s3 + 20, 3, 2.0, 0.6, 1.0);
});
const nfMedTerrain = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 4, 2, 0.035, s1 + 65, s1 + 115);
  return fbm(wx * 7 + s1 + 40, wy * 7 + s1 + 40, 4, 2.0, 0.5);
});
const nfMtnRidge = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 5, 2, 0.05, s4 + 70, s4 + 120);
  return ridged(wx * 12 + s4, wy * 12 + s4, 4, 2.2, 0.6, 1.0);
});
const nfMtnValley = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 4, 2, 0.04, s5 + 30, s5 + 80);
  const [f1] = worley(wx * 8 + s5, wy * 8 + s5);
  return f1;
});
// Fine-detail terrain: higher frequency for local variation everywhere
const nfFineTerrain = precompute((nx, ny) => {
  const [wx, wy] = warp(nx, ny, 5, 2, 0.025, s3 + 25, s3 + 75);
  return fbm(wx * 14 + s3 + 35, wy * 14 + s3 + 35, 3, 2.0, 0.5);
});

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;

  const stampE = (rawElev[i] - sl) * 0.3;

  const tcx = x / CG, tcy = y / CG;
  const twx = tcx + sg(nfTecWX, x, y) * 2.0;
  const twy = tcy + sg(nfTecWY, x, y) * 2.0;
  const tecMod = sampleCrust(twx, twy);
  let e = stampE + tecMod;

  if (!isLandArr[i]) {
    e = Math.min(e, -0.001);
    // ── Layered bathymetric noise ──
    // Without this, the ocean was a smooth bilinear interpolation of
    // stamp values — the Depth view showed it as a uniform gradient.
    // Real bathymetry has continental shelves, abyssal plains broken
    // by seamount fields, and mid-ocean ridges. Three fBm octaves for
    // general roughness + a ridged component for linear ridge
    // features. Amplitude scales with depth so continental shelves
    // (shallow, near-coast) stay smooth while abyssal plains (deep)
    // get the full texture.
    const depthMag  = Math.min(1, -e * 6);
    const oceanBroad = fbm(nx *  4 +  800, ny *  4 +  800, 4, 2, 0.50);
    const oceanMid   = fbm(nx * 15 +  900, ny * 15 +  900, 3, 2, 0.50);
    const oceanFine  = fbm(nx * 45 + 1000, ny * 45 + 1000, 2, 2, 0.40);
    const oceanRidge = ridged(nx * 7 + 1100, ny * 7 + 1100, 3, 2.0, 2.0, 1.0);
    e += (oceanBroad * 0.035 + oceanMid * 0.015 + oceanFine * 0.005
        + oceanRidge * 0.020)
        * (0.3 + depthMag * 0.7);
    e = Math.min(e, -0.0008);
  }

  if (e > 0) {
    const cd = cdist[Math.min(dh - 1, (y / DG) | 0) * dw + Math.min(dw - 1, (x / DG) | 0)];
    const interior = Math.min(1, cd / 15);

    const sharpVal = sampleCoarse(mtnEffect, twx, twy);
    const broadVal = sampleCoarse(mtnBroad, twx, twy);

    const plateauNoise = 0.7 + 0.6 * sg(nfPlateau, x, y);
    const plateau = broadVal * p('plateauMult', 1.5) * plateauNoise;
    const peaks = Math.max(0, tecMod) * p('peaksMult', 1.9);
    const mtnBump = sg(nfMtnBump, x, y)
      * p('mtnBumpStr', 0.10) * Math.min(1, (plateau + peaks) * 3);
    const tecLift = plateau + peaks + mtnBump;

    // Coast blend: smoothly suppress elevation near the coast.
    // tecStr can reduce coastBlend (mountains at coast, like Andes) but
    // always keep a minimum blend so the very coastline stays low.
    const rawCoastBlend = smoothstep(1 - cd / 6);
    const tecStr = Math.min(1, tecLift * 2);
    const coastBlend = Math.max(rawCoastBlend * 0.3, rawCoastBlend * (1 - tecStr * 0.6));

    const coastE = 0.005 + (1 - coastBlend) * 0.01
      + sg(nfCoastEN, x, y) * 0.004;

    // ── Multi-scale continental interior terrain ──
    // tecZone: how much this pixel is in a tectonic mountain zone (0=craton, 1=mountains)
    // Interior noise is SUPPRESSED in mountain zones (different geology)
    // and AMPLIFIED near broad tectonic uplift (plateau texture)
    const tecZone = smoothstep(tecLift * 2.5);
    const cratonZone = (1 - tecZone); // weight for stable interior noise
    const plateauZone = smoothstep(broadVal * 3); // broad tectonic uplift (Tibet-like)

    // Shield blocks: continent-scale elevated regions — suppressed where plates collide
    // Real shields: Canadian Shield ~300m, African Plateau ~1000m
    const shieldVal = sg(nfShield, x, y);
    const shieldE = smoothstep(shieldVal * 1.5 + 0.1) * 0.07 * interior * cratonZone;

    // Basin: medium-scale depressions and swells — only in stable interiors
    const basinVal = sg(nfBasin, x, y);
    const basinE = basinVal * 0.04 * interior * cratonZone;
    // Endorheic depressions → isolated lake basins. The Worley input is
    // domain-warped (so basins are irregular blobs, not perfect circles), its
    // edge is roughened, and the threshold varies by region so basin sizes
    // differ widely and many areas have none at all.
    const ebwx = fbm(nx * 7 + 711, ny * 7 + 711, 3, 2, 0.5) * 0.05;
    const ebwy = fbm(nx * 7 + 811, ny * 7 + 811, 3, 2, 0.5) * 0.05;
    let [wF1] = worley((nx + ebwx) * 10 + 500, (ny + ebwy) * 10 + 500);
    wF1 += noise2D(nx * 46 + 33, ny * 46 + 33) * 0.022;
    const ebThresh = Math.max(0, fbm(nx * 2.2 + 901, ny * 2.2 + 901, 2, 2, 0.5) * 0.30 + 0.03);
    const endorheicE = wF1 < ebThresh ? -(ebThresh - wF1) * 0.34 * interior * cratonZone : 0;

    // Escarpment: sharp elevation breaks — at shield edges in stable interiors
    const escarpVal = sg(nfEscarpment, x, y);
    const escarpE = escarpVal * 0.025 * interior * cratonZone
      * smoothstep(Math.abs(shieldVal) * 3);

    // Medium terrain: rolling hills — present everywhere but louder on plateaus
    const medTerrain = sg(nfMedTerrain, x, y) * (0.018 + plateauZone * 0.035) * interior;

    // Fine local detail: small-scale undulation — present everywhere on land
    const fineTerrain = sg(nfFineTerrain, x, y) * 0.014;

    // Base elevation: most flat continental land is 50-200m (0.006-0.023).
    // Coast near sea level, ramps gently inland.
    const baseE = 0.010 + interior * 0.020;
    const plateauBoost = Math.max(0, stampE) * 0.10 * interior;
    const cratonE = baseE + shieldE + basinE + endorheicE + escarpE + medTerrain
      + fineTerrain + plateauBoost;

    // ── Mountain-specific texture ──
    // Ridgeline veining: sharp drainage-aligned ridges, amplitude scales with tecLift
    const ridgeVal = sg(nfMtnRidge, x, y);
    const valleyVal = sg(nfMtnValley, x, y);
    // Ridges push up, valleys carve down — only in tectonic mountain zones
    const mtnTexture = (ridgeVal * 0.18 - (1 - valleyVal) * 0.10) * tecZone;

    // Per-pixel micro-terrain: bypasses precompute grid for true pixel-level roughness
    // Simulates local geology — ridges, gullies, rock outcrops at 1-2km scale
    // Direct fBm micro-terrain — adds hills and roughness, killed near coast
    const microTerrain = interior > 0.3 ? fbm(nx * 20 + s1 + 200, ny * 20 + s1 + 200, 4, 2.0, 0.5)
      * 0.014 * (0.6 + tecZone * 0.5) : 0;

    // Scale tectonic lift by coast distance so mountains ramp up inland
    const tecCoastRamp = smoothstep(interior * 1.5);
    e = cratonE + tecLift * tecCoastRamp + mtnTexture * tecCoastRamp + microTerrain;
    // Cross-term: terrain noise modulates mountain zones for local variation
    e += medTerrain * tecLift * tecCoastRamp * 3.0;
    e = e * (1 - coastBlend * 0.7) + coastE * coastBlend * 0.7;

    e = Math.max(0, e);
    // Hypsometric redistribution: gamma > 1 pushes the bulk of land down toward
    // low plains while the rescale keeps peak height, so mountains read as a tall
    // minority above broad lowlands (Earth-like) rather than a high rolling mass.
    e = Math.pow(e, 1.38) * 1.23;
    e = Math.max(0.002, Math.min(1.0, e));
  }

  // Per-pixel fine texture (land only) — adapts to terrain type
  if (isLandArr[i] && e > 0) {
    // High-frequency detail: stronger amplitude in high-elevation zones
    const fineBase = fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4);
    const elevBoost = Math.min(1, Math.max(0, e - 0.02) * 6);
    e += fineBase * (0.004 + elevBoost * 0.012);
    if (e > 0.15) {
      const microRidge = fbm(nx * 40 + s5 + 10, ny * 40 + s5 + 10, 2, 2.2, 0.45);
      e += microRidge * 0.008 * Math.min(1, (e - 0.15) * 5);
    }
  }

  // ── Universal Perlin layer (land + ocean) ──
  // Final fBm pass applied to every tile so the Depth view shows
  // continuous terrain variation everywhere, not just at the
  // type-specific feature lines added by the land/ocean paths above.
  // Three octaves stacked: broad rolling variation, mid-scale
  // texture, fine roughness. Re-clamp to preserve land/ocean
  // identity so the noise can't accidentally raise sea floor above
  // sea level or sink low land below it.
  const uBroad = fbm(nx *  6 + 2000, ny *  6 + 2000, 4, 2, 0.50);
  const uMid   = fbm(nx * 22 + 2100, ny * 22 + 2100, 3, 2, 0.50);
  const uFine  = fbm(nx * 70 + 2200, ny * 70 + 2200, 2, 2, 0.40);
  e += uBroad * 0.028 + uMid * 0.012 + uFine * 0.005;
  if (isLandArr[i]) e = Math.max(0.0010, Math.min(1.0, e));
  else              e = Math.min(-0.0010, e);

  elevation[i] = e;
}

// ═══════════════════════════════════════════════════════
// STEP 8b: Hydraulic Erosion — physically-based terrain texturing
// ═══════════════════════════════════════════════════════
if (p('erodeDropsPerPixel', 1.5) > 0) {
  // Run erosion on a 4x-downscaled grid for speed (~16x fewer pixels)
  const EG = 4;
  const eW = Math.ceil(W / EG), eH = Math.ceil(H / EG);
  const eN = eW * eH;

  // Downsample elevation to erosion grid
  const eElev = new Float32Array(eN);
  const eLand = new Uint8Array(eN);
  for (let ey = 0; ey < eH; ey++) for (let ex = 0; ex < eW; ex++) {
    const px = Math.min(W - 1, ex * EG), py = Math.min(H - 1, ey * EG);
    const v = elevation[py * W + px];
    eElev[ey * eW + ex] = v;
    eLand[ey * eW + ex] = v > 0 ? 1 : 0;
  }

  const dropCount = Math.round(eN * p('erodeDropsPerPixel', 1.0));
  const maxLife = 30;
  const inertia = p('erodeInertia', 0.3);
  const cap = p('erodeCapacity', 4.0);
  const minSlope = 0.005;
  const depositRate = p('erodeDeposit', 0.3);
  const erodeRate = p('erodeRate', 0.15);
  const evapRate = p('erodeEvaporate', 0.02);
  const grav = p('erodeGravity', 6.0);
  const brushR = p('erodeBrushRadius', 2);

  // Pre-compute brush weights
  const bOff = [], bWt = [];
  let wSum = 0;
  for (let by = -brushR; by <= brushR; by++) for (let bx = -brushR; bx <= brushR; bx++) {
    const d2 = bx * bx + by * by;
    if (d2 > brushR * brushR) continue;
    bOff.push(bx, by);
    const w = Math.max(0, 1 - Math.sqrt(d2) / brushR);
    bWt.push(w); wSum += w;
  }
  for (let k = 0; k < bWt.length; k++) bWt[k] /= wSum;

  // Bilinear helpers on erosion grid (wraps X, clamps Y)
  const eAt = (gx, gy) => eElev[Math.max(0, Math.min(eH - 1, gy)) * eW + ((gx % eW) + eW) % eW];
  const eSample = (px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    return eAt(ix, iy) * (1-fx)*(1-fy) + eAt(ix+1, iy) * fx*(1-fy)
      + eAt(ix, iy+1) * (1-fx)*fy + eAt(ix+1, iy+1) * fx*fy;
  };
  const eGrad = (px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const h00 = eAt(ix, iy), h10 = eAt(ix+1, iy), h01 = eAt(ix, iy+1), h11 = eAt(ix+1, iy+1);
    return [(h10-h00)*(1-fy)+(h11-h01)*fy, (h01-h00)*(1-fx)+(h11-h10)*fx];
  };

  for (let drop = 0; drop < dropCount; drop++) {
    // Spawn on land
    let px, py, att = 0;
    do { px = rng() * eW; py = rng() * (eH - 2) + 1; att++; }
    while (att < 8 && !eLand[Math.floor(py) * eW + Math.floor(px) % eW]);
    if (!eLand[Math.floor(py) * eW + Math.floor(px) % eW]) continue;

    let ddx = 0, ddy = 0, speed = 1, water = 1, sed = 0;
    for (let step = 0; step < maxLife; step++) {
      const cx = Math.floor(px), cy = Math.floor(py);
      if (!eLand[cy * eW + ((cx % eW + eW) % eW)]) break; // drop reached ocean, sediment lost to sea
      const oldH = eSample(px, py);

      const [gx, gy] = eGrad(px, py);
      ddx = ddx * inertia - gx * (1 - inertia);
      ddy = ddy * inertia - gy * (1 - inertia);
      const len = Math.sqrt(ddx * ddx + ddy * ddy);
      if (len < 1e-6) { const a = rng() * 6.283; ddx = Math.cos(a); ddy = Math.sin(a); }
      else { ddx /= len; ddy /= len; }

      const nx2 = px + ddx, ny2 = py + ddy;
      if (ny2 < 1 || ny2 >= eH - 1) break;
      const wx = ((nx2 % eW) + eW) % eW;
      const newH = eSample(wx, ny2);
      const dH = newH - oldH;
      const c2 = Math.max(-dH, minSlope) * speed * water * cap;

      if (dH > 0 || sed > c2) {
        const amt = dH > 0 ? Math.min(dH, sed) : (sed - c2) * depositRate;
        sed -= amt;
        const fx = px - cx, fy = py - cy;
        const x0 = ((cx % eW) + eW) % eW, x1 = ((cx + 1) % eW + eW) % eW;
        const y0 = Math.max(0, Math.min(eH-1, cy)), y1 = Math.max(0, Math.min(eH-1, cy+1));
        if (eLand[y0*eW+x0]) eElev[y0*eW+x0] += amt*(1-fx)*(1-fy);
        if (eLand[y0*eW+x1]) eElev[y0*eW+x1] += amt*fx*(1-fy);
        if (eLand[y1*eW+x0]) eElev[y1*eW+x0] += amt*(1-fx)*fy;
        if (eLand[y1*eW+x1]) eElev[y1*eW+x1] += amt*fx*fy;
      } else {
        const amt = Math.min((c2 - sed) * erodeRate, -dH + 0.002);
        for (let k = 0; k < bWt.length; k++) {
          const bx = bOff[k*2], by = bOff[k*2+1];
          const ey = Math.max(0, Math.min(eH-1, cy + by));
          const ex = ((cx + bx) % eW + eW) % eW;
          const ei = ey * eW + ex;
          if (!eLand[ei]) continue;
          eElev[ei] = Math.max(0.002, eElev[ei] - amt * bWt[k]);
        }
        sed += amt;
      }
      speed = Math.sqrt(Math.max(0.001, speed * speed + dH * grav));
      water *= (1 - evapRate);
      px = wx; py = ny2;
    }
  }

  // Compute erosion delta (eroded - original) and apply to full-res via bilinear
  const eDelta = new Float32Array(eN);
  for (let ey = 0; ey < eH; ey++) for (let ex = 0; ex < eW; ex++) {
    const ei = ey * eW + ex;
    const px = Math.min(W - 1, ex * EG), py = Math.min(H - 1, ey * EG);
    eDelta[ei] = eElev[ei] - elevation[py * W + px]; // change caused by erosion
  }
  // Zero out delta on ocean cells; clamp delta to non-positive on coastal land
  // cells (prevents sediment deposition rim at coastlines)
  for (let ey = 0; ey < eH; ey++) for (let ex = 0; ex < eW; ex++) {
    const ei = ey * eW + ex;
    if (!eLand[ei]) { eDelta[ei] = 0; continue; }
    // Check if any neighbor is ocean → this is a coastal cell
    let coastal = false;
    for (let dy = -1; dy <= 1 && !coastal; dy++) for (let dx = -1; dx <= 1 && !coastal; dx++) {
      if (!dx && !dy) continue;
      const ny2 = ey + dy, nx2 = ((ex + dx) % eW + eW) % eW;
      if (ny2 < 0 || ny2 >= eH) continue;
      if (!eLand[ny2 * eW + nx2]) coastal = true;
    }
    if (coastal) eDelta[ei] = Math.min(0, eDelta[ei]); // only allow erosion at coast
  }
  // Clamp delta magnitude so erosion reshapes but doesn't flatten.
  // Max erosion = 30% of original elevation at that cell. This preserves
  // the overall height distribution while carving realistic detail.
  for (let ey = 0; ey < eH; ey++) for (let ex = 0; ex < eW; ex++) {
    const ei = ey * eW + ex;
    if (!eLand[ei]) continue;
    const px = Math.min(W - 1, ex * EG), py = Math.min(H - 1, ey * EG);
    const origE = elevation[py * W + px];
    const maxDrop = origE * 0.3;
    eDelta[ei] = Math.max(-maxDrop, eDelta[ei]);
  }
  const eDAt = (gx, gy) => eDelta[Math.max(0, Math.min(eH-1, gy)) * eW + ((gx % eW) + eW) % eW];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!isLandArr[i]) continue;
    const fx = x / EG, fy = y / EG;
    const ix = Math.min(eW - 2, fx | 0), iy = Math.min(eH - 2, fy | 0);
    const dx2 = fx - ix, dy2 = fy - iy;
    const delta = eDAt(ix,iy)*(1-dx2)*(1-dy2) + eDAt(ix+1,iy)*dx2*(1-dy2)
      + eDAt(ix,iy+1)*(1-dx2)*dy2 + eDAt(ix+1,iy+1)*dx2*dy2;
    elevation[i] = Math.max(0.002, elevation[i] + delta);
  }
}

// ── Rotate the map so its wraparound seam lands on the emptiest ocean ──
// Pick the column band with the least land and cyclically shift the world
// so that band sits on the x=0 / x=W edge (and the wind/moisture solved
// below run on the already-shifted elevation, staying consistent).
{
  const colLand = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let c = 0;
    for (let y = 0; y < H; y++) if (elevation[y * W + x] > 0) c++;
    colLand[x] = c;
  }
  const HW = 40; // band half-width — keeps the seam clear of nearby coasts
  let bestX = 0, bestSum = Infinity;
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -HW; k <= HW; k++) s += colLand[((x + k) % W + W) % W];
    if (s < bestSum) { bestSum = s; bestX = x; }
  }
  if (bestX !== 0) {
    const shiftField = (arr) => {
      const tmp = arr.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
        arr[y * W + x] = tmp[y * W + ((x + bestX) % W)];
    };
    shiftField(elevation);
    shiftField(pixPlate);
  }
}

// Blend final elevation seam at antimeridian
{
  const blendW = Math.round(W * 0.025);
  for (let y = 0; y < H; y++) {
    for (let bx = 0; bx < blendW; bx++) {
      const t = bx / blendW;
      const iL = y * W + bx, iR = y * W + (W - 1 - bx);
      const avg = (elevation[iL] + elevation[iR]) * 0.5;
      const s = 0.5 * (1 - t);
      elevation[iL] = elevation[iL] * (1 - s) + avg * s;
      elevation[iR] = elevation[iR] * (1 - s) + avg * s;
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 8c: 2D Wind Field — Atmospheric Circulation
// ═══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
// WIND PHYSICS — delegated to standalone solveWind() function
// ══════════════════════════════════════════════════════════════════
const { windX: fullWindX, windY: fullWindY } = solveWind(W, H, elevation, fbm, params, s3);


// ═══════════════════════════════════════════════════════
// STEP 8c: Moisture transport — physically-grounded cycle
// Evaporation → wind transport → precipitation (orographic, convective, convergence)
// ═══════════════════════════════════════════════════════
const windMoisture = solveMoisture(W, H, elevation, fullWindX, fullWindY, temperature, params);

// Coarse grid for temperature advection
const mW = Math.ceil(W / 2), mH = Math.ceil(H / 2);

// ═══════════════════════════════════════════════════════
// STEP 8c2: Wind-advected temperature transport
// Heat carried by wind — warm equatorial air pushed poleward by westerlies,
// cold polar air pushed equatorward by easterlies. Same principle as moisture
// advection but temperature relaxes toward local latitude value (thermal inertia).
// ═══════════════════════════════════════════════════════
const windTemp = new Float32Array(W * H);
const tGrid = new Float32Array(mW * mH);
// Seed with latitude-based temperature
for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
  const px = Math.min(W - 1, mx * 2), py = Math.min(H - 1, my * 2);
  const tLat2 = Math.abs(py / H - 0.5) * 2;  // thermal latitude, shifted north
  const e2 = elevation[py * W + px];
  tGrid[my * mW + mx] = Math.max(0, Math.min(1, 0.92 - Math.pow(tLat2, 1.5) * 0.50 - Math.pow(tLat2, 6) * 0.80
    + Math.exp(-((tLat2 - 0.20) * (tLat2 - 0.20)) / (2 * 0.08 * 0.08)) * 0.06 - Math.max(0, e2) * (0.65 + 0.8 * tLat2)));
}
// Advect temperature along wind vectors
for (let step = 0; step < 25; step++) {
  const prev = new Float32Array(tGrid);
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const px = Math.min(W - 1, mx * 2), py = Math.min(H - 1, my * 2);
    const fi = py * W + px;
    const wx2 = fullWindX[fi], wy2 = fullWindY[fi];
    const srcX = mx - wx2 * 2.0, srcY = my - wy2 * 2.0;
    const sx = Math.min(mW - 2, Math.max(0, srcX | 0));
    const sy = Math.min(mH - 2, Math.max(0, srcY | 0));
    const fdx = Math.max(0, Math.min(1, srcX - sx));
    const fdy = Math.max(0, Math.min(1, srcY - sy));
    const sxr = Math.min(mW - 1, sx + 1);
    const upwindT = (prev[sy * mW + sx] * (1 - fdx) + prev[sy * mW + sxr] * fdx) * (1 - fdy)
      + (prev[(sy + 1) * mW + sx] * (1 - fdx) + prev[(sy + 1) * mW + sxr] * fdx) * fdy;
    const e2 = elevation[fi];
    const tLat2 = Math.abs(py / H - 0.5) * 2;
    const localT = Math.max(0, Math.min(1, 0.92 - Math.pow(tLat2, 1.5) * 0.50 - Math.pow(tLat2, 6) * 0.80
      + Math.exp(-((tLat2 - 0.20) * (tLat2 - 0.20)) / (2 * 0.08 * 0.08)) * 0.06 - Math.max(0, e2) * (0.65 + 0.8 * tLat2)));
    if (e2 <= 0) {
      // Ocean: high thermal inertia, mostly local temp with slight wind influence
      tGrid[my * mW + mx] = localT * 0.88 + upwindT * 0.12;
    } else {
      // Land: wind carries heat — warming penetrates easier than cooling
      // (warm air masses are more persistent than cold outbreaks)
      const terrainBlock = Math.min(0.8, Math.max(0, e2 - 0.05) * 3);
      const baseInf = (1 - terrainBlock * 0.5) * 0.22;
      // Warm bias: upwind warmer than local → stronger influence
      const warmBias = upwindT > localT ? 1.3 : 0.8;
      const windInf = Math.min(0.35, baseInf * warmBias);
      tGrid[my * mW + mx] = localT * (1 - windInf) + upwindT * windInf;
    }
  }
}
// Upscale wind temperature to full resolution
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = x / 2, fy = y / 2;
  const ix = Math.min(mW - 2, fx | 0), iy = Math.min(mH - 2, fy | 0);
  const dx2 = fx - ix, dy2 = fy - iy;
  const ixr2 = (ix + 1) % mW;
  windTemp[y * W + x] = (tGrid[iy * mW + ix] * (1 - dx2) + tGrid[iy * mW + ixr2] * dx2) * (1 - dy2)
    + (tGrid[(iy + 1) * mW + ix] * (1 - dx2) + tGrid[(iy + 1) * mW + ixr2] * dx2) * dy2;
}

// ═══════════════════════════════════════════════════════
// STEP 8d: Temperature & Moisture (final combination)
// ═══════════════════════════════════════════════════════
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;
  const e = elevation[i];

  // Maritime temperature moderation + continental heating
  const cdm = cdist[Math.min(dh - 1, (y / DG) | 0) * dw + Math.min(dw - 1, (x / DG) | 0)];
  const coastProx = Math.max(0, 1 - cdm / 8);
  // Thermal latitude centered for procedural worlds (Earth Sim uses 0.42 offset)
  const tLat = Math.abs(ny - 0.5) * 2;
  const subtropHeat = Math.exp(-((tLat - 0.20) * (tLat - 0.20)) / (2 * 0.08 * 0.08)) * 0.06;
  // Latitude→temperature: 0.92 at equator (+32°C, reads red), with a
  // sharp polar plunge (lat^6 term) so high-elev polar interiors hit
  // ICE biome (t<0.08). lat^1.5 governs the mid-lat shape. Calibrated
  // visually + against NASA GISS zonal means in temperate bands. See
  // tools/probe_temperature.mjs.
  const baseTemp = 0.92 - Math.pow(tLat, 1.5) * 0.50 - Math.pow(tLat, 6) * 0.80 + subtropHeat - Math.max(0, e) * (0.65 + 0.8 * tLat) + sg(nfTemp, x, y) * 0.08
    + sg(nfTempBroad, x, y) * 0.10;
  // Continental heating: interiors at low/mid latitudes get hotter (no ocean buffering).
  // At high latitudes, interiors get colder (continental winters dominate).
  const inland = Math.max(0, 1 - coastProx);  // 0 at coast, 1 deep inland
  const contHeat = tLat < 0.5
    ? inland * (0.5 - tLat) * 0.20
    : inland * (tLat - 0.5) * -0.12;
  // Maritime moderation: coasts pull toward moderate temp (0.45)
  const modTemp = baseTemp + (0.45 - baseTemp) * coastProx * 0.2 + contHeat;
  // Blend latitude-based temperature with wind-advected temperature.
  // Wind transport carries warmth poleward (westerlies) and cold equatorward.
  // Kept moderate (25%) to avoid false tundra at mid-latitudes from cold intrusions.
  const wt = windTemp[i];
  const temp = modTemp * 0.75 + wt * 0.25;
  temperature[i] = Math.max(0, Math.min(1, temp));

  moisture[i] = windMoisture[i];
}

// Moisture→temperature feedback: dry areas heat up more (no evaporative cooling,
// clear skies). Wet areas stay cooler (clouds, transpiration).
// This makes dry subtropical continents (like Australia) hotter than wet ones.
for (let i = 0; i < W * H; i++) {
  if (elevation[i] <= 0) continue;
  const m = moisture[i], t = temperature[i];
  // Dry warming: less moisture = more heating (clear skies, no evaporation)
  // Wet cooling: high moisture = slight cooling (cloud cover, transpiration)
  const dryBoost = m < 0.3 ? (0.3 - m) * 0.15 : 0;         // up to +0.045
  const wetCool = m > 0.5 ? (m - 0.5) * -0.08 : 0;          // up to -0.04
  temperature[i] = Math.max(0, Math.min(1, t + dryBoost + wetCool));
}

return { elevation, moisture, temperature, pixPlate, windX: fullWindX, windY: fullWindY };
}


