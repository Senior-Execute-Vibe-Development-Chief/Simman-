// ── Tectonic Plate Terrain Generator ──
// Hybrid model: stamp-based land shapes + Voronoi plate boundaries.
// Land shapes use multi-stamp composition (from Random mode) centered on
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
const numMajor = p('numMajorBase', 5) + Math.floor(rng() * p('numMajorRange', 3));
const numMinor = p('numMinorBase', 6) + Math.floor(rng() * p('numMinorRange', 6));
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
    ? p('majorWeightMin', 0.012) + rng() * p('majorWeightRange', 0.025)
    : p('minorWeightMin', 0.001) + rng() * p('minorWeightRange', 0.005);

  const hasCont = isMajor ? rng() < p('majorContProb', 0.70) : rng() < p('minorContProb', 0.20);

  const nucAngle = rng() * Math.PI * 2;
  const nucOffset = 0.02 + rng() * 0.08;
  const nucX = cx + Math.cos(nucAngle) * nucOffset;
  const nucY = cy + Math.sin(nucAngle) * nucOffset;

  // Larger continent radii for major plates → more cohesive landmasses
  const contRadius = hasCont ? (isMajor ? p('majorContRadMin', 0.14) + rng() * p('majorContRadRange', 0.18) : p('minorContRadMin', 0.06) + rng() * p('minorContRadRange', 0.07)) : 0;

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
    plates[idx].contRadius = 0.14 + rng() * 0.16;
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

const _ws1 = p('warpStr1', 0.14), _ws2 = p('warpStr2', 0.05), _js = p('jagStr', 0.025);
const _psx = p('plateStretchX', 1.3), _psy = p('plateStretchY', 0.8);
for (let py = 0; py < ppH; py++) for (let px = 0; px < ppW; px++) {
  const x = px * PS, y = py * PS;
  const nx = x / W, ny = y / H;
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 3, 2, 0.5) * _ws1
    + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 3, 2, 0.5) * _ws2;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 3, 2, 0.5) * _ws1
    + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 3, 2, 0.5) * _ws2;
  const jagX = ridged(nx * 12 + 41.3, ny * 12 + 41.3, 3, 2.2, 2.0, 1.0) * _js
    - noise2D(nx * 18 + 55.1, ny * 18 + 55.1) * 0.012;
  const jagY = ridged(nx * 12 + 91.3, ny * 12 + 91.3, 3, 2.2, 2.0, 1.0) * _js
    - noise2D(nx * 18 + 105.1, ny * 18 + 105.1) * 0.012;
  const wnx = nx + warpX + jagX, wny = ny + warpY + jagY;
  let bestD = 1e9, bestP = 0;
  for (let pi = 0; pi < numPlates; pi++) {
    let dx = wnx - plates[pi].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
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

for (let pi = 0; pi < numPlates; pi++) {
  const plate = plates[pi];
  if (!plate.hasCont || plate.contRadius <= 0) continue;

  const isMaj = pi < numMajor;
  const cx = plate.nucX, cy = plate.nucY;
  const no = rng() * 100;
  const scale = plate.contRadius / 0.18;

  const numSubs = isMaj ? p('majorSubsBase', 5) + Math.floor(rng() * p('majorSubsRange', 5)) : p('minorSubsBase', 2) + Math.floor(rng() * p('minorSubsRange', 3));

  for (let s = 0; s < numSubs; s++) {
    const ang = rng() * Math.PI * 2;
    const dist = s === 0 ? 0 : (0.03 + rng() * 0.08) * scale;
    const aspect = s === 0 ? 1 + rng() * 0.4
      : s <= 2 && rng() < 0.35 ? 1.3 + rng() * 1.2
      : 1 + rng() * 1.0;
    const baseR = (s === 0
      ? (isMaj ? p('majorCoreRadMin', 0.12) + rng() * p('majorCoreRadRange', 0.10) : p('minorCoreRadMin', 0.07) + rng() * p('minorCoreRadRange', 0.06))
      : (isMaj ? p('majorSubRadMin', 0.05) + rng() * p('majorSubRadRange', 0.08) : p('minorSubRadMin', 0.03) + rng() * p('minorSubRadRange', 0.05))
    ) * scale;
    const rot = rng() * Math.PI;
    posStamps.push({
      cx: cx + Math.cos(ang) * dist,
      cy: cy + Math.sin(ang) * dist,
      rx: baseR * aspect, ry: baseR / aspect,
      rot, cos: Math.cos(rot), sin: Math.sin(rot),
      str: s === 0 ? 0.9 + rng() * 0.3 : 0.5 + rng() * 0.4,
      no: no + s * 17,
      plateId: pi,
      contRadius: plate.contRadius
    });
  }

  const numNegs = isMaj ? Math.floor(rng() * p('majorNegsMax', 2.5)) : Math.floor(rng() * p('minorNegsMax', 1.5));
  for (let n = 0; n < numNegs; n++) {
    const ang = rng() * Math.PI * 2;
    const dist = (0.02 + rng() * 0.06) * scale;
    const rot = rng() * Math.PI;
    negStamps.push({
      cx: cx + Math.cos(ang) * dist,
      cy: cy + Math.sin(ang) * dist,
      rx: (0.02 + rng() * 0.04) * scale,
      ry: (0.015 + rng() * 0.03) * scale,
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
  for (const c of posStamps) {
    let dx = wnx - c.cx; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
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
  if (penNoise > p('penThreshold', 0.4)) e += (penNoise - p('penThreshold', 0.4)) * p('penStrength', 0.2) * onContPlate;
  const bayNoise = fbm(wnx * 3.5 + s4 + 120, wny * 3.5 + s4 + 120, 3, 2, 0.5);
  if (bayNoise > p('bayThreshold', 0.45)) e -= (bayNoise - p('bayThreshold', 0.45)) * p('bayStrength', 0.18) * onContPlate;

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
  const dx = fx - ix, dy = fy - iy;
  rawElev[y * W + x] = (rawElevCoarse[iy * ewW + ix] * (1 - dx) + rawElevCoarse[iy * ewW + ix + 1] * dx) * (1 - dy)
    + (rawElevCoarse[(iy + 1) * ewW + ix] * (1 - dx) + rawElevCoarse[(iy + 1) * ewW + ix + 1] * dx) * dy;
}

// ═══════════════════════════════════════════════════════
// STEP 4b: Sea level + derive crustType from stamps
// ═══════════════════════════════════════════════════════
const sorted = Float32Array.from(rawElev).sort();
const sl = sorted[Math.floor(W * H * p('seaLevel', 0.72))];
const isLandArr = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) isLandArr[i] = rawElev[i] > sl ? 1 : 0;

// Remove tiny isolated land clusters (< 20 pixels)
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
  if (cluster.length < 20) for (const ci of cluster) { isLandArr[ci] = 0; rawElev[ci] = sl - 0.01; }
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
        boundaryConv[i] = Math.max(boundaryConv[i], strength * p('contContUplift', 0.18));
        boundaryCont[i] = 1;
      } else if (myType === 1 && neighborType === 0) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * p('contOceanUplift', 0.13));
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
    if (cd > 6) continue;
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
        const falloff = Math.exp(-nd * nd / 8);
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
const DG = RES, dw = Math.ceil(W / DG), dh = Math.ceil(H / DG);
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
  return d;
};
const sg = (d, px, py) => {
  const fx = px / NG, fy = py / NG;
  const ix = Math.min(ngW - 2, fx | 0), iy = Math.min(ngH - 2, fy | 0);
  const dx = fx - ix, dy = fy - iy;
  return (d[iy * ngW + ix] * (1 - dx) + d[iy * ngW + ix + 1] * dx) * (1 - dy)
    + (d[(iy + 1) * ngW + ix] * (1 - dx) + d[(iy + 1) * ngW + ix + 1] * dx) * dy;
};
const nfTecWX = precompute((nx, ny) => fbm(nx * 3 + 200, ny * 3 + 200, 3, 2, 0.5));
const nfTecWY = precompute((nx, ny) => fbm(nx * 3 + 250, ny * 3 + 250, 3, 2, 0.5));
const nfPlateau = precompute((nx, ny) => fbm(nx * 3 + s1 + 50, ny * 3 + s1 + 50, 2, 2, 0.5));
const nfMtnBump = precompute((nx, ny) => fbm(nx * 8 + s2 + 30, ny * 8 + s2 + 30, 4, 2, 0.55));
const nfCoastEN = precompute((nx, ny) => fbm(nx * 10 + s3 + 40, ny * 10 + s3 + 40, 2, 2, 0.5));
const nfContinent = precompute((nx, ny) => fbm(nx * 2.2 + s1 + 30, ny * 2.2 + s1 + 30, 3, 2, 0.55));
const nfBroadSwell = precompute((nx, ny) => fbm(nx * 1.8 + s1, ny * 1.8 + s1, 2, 2, 0.6));
const nfTemp = precompute((nx, ny) => fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5));
const nfMoistOce = precompute((nx, ny) => fbm(nx * 3 + 30, ny * 3 + 30, 2, 2, 0.5));
const nfMoistLand = precompute((nx, ny) => fbm(nx * 4 + 50, ny * 4 + 50, 4, 2, 0.55));

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;

  const stampE = (rawElev[i] - sl) * 0.3;

  const tcx = x / CG, tcy = y / CG;
  const twx = tcx + sg(nfTecWX, x, y) * 3.0;
  const twy = tcy + sg(nfTecWY, x, y) * 3.0;
  const tecMod = sampleCrust(twx, twy);
  let e = stampE + tecMod;

  if (!isLandArr[i]) {
    if (tecMod < 0.03) e = Math.min(e, -0.001);
    else e = Math.min(e, tecMod * 0.4 - 0.01);
  }

  if (e > 0) {
    const cd = cdist[Math.min(dh - 1, (y / DG) | 0) * dw + Math.min(dw - 1, (x / DG) | 0)];
    const interior = Math.min(1, cd / 15);

    const sharpVal = sampleCoarse(mtnEffect, twx, twy);
    const broadVal = sampleCoarse(mtnBroad, twx, twy);

    const plateauNoise = 0.7 + 0.6 * sg(nfPlateau, x, y);
    const plateau = broadVal * p('plateauMult', 1.5) * plateauNoise;
    const peaks = Math.max(0, tecMod) * p('peaksMult', 2.0);
    const mtnBump = sg(nfMtnBump, x, y)
      * p('mtnBumpStr', 0.10) * Math.min(1, (plateau + peaks) * 3);
    const tecLift = plateau + peaks + mtnBump;

    const rawCoastBlend = smoothstep(1 - cd / 6);
    const tecStr = Math.min(1, tecLift * 2);
    const coastBlend = rawCoastBlend * (1 - tecStr * 0.85);

    const coastE = 0.003 + (1 - coastBlend) * 0.008
      + sg(nfCoastEN, x, y) * 0.004;

    const baseE = 0.006 + interior * 0.012;
    const continentNoise = sg(nfContinent, x, y);
    const highlandMask = smoothstep(continentNoise * 2 + 0.2);
    const regionalE = highlandMask * 0.12 * interior;

    const broadSwell = sg(nfBroadSwell, x, y) * 0.012;
    const [rhx, rhy] = warp(nx, ny, 3, 2, 0.04, s2 + 10, s2 + 60);
    const rolling = fbm(rhx * 6 + s2, rhy * 6 + s2, 3, 2, 0.5) * 0.010;
    const plateauBoost = Math.max(0, stampE) * 0.15 * interior;

    const cratonE = baseE + regionalE + broadSwell + rolling + plateauBoost;
    e = cratonE + tecLift;
    e += (broadSwell + rolling) * tecLift * 5.0;
    e = e * (1 - coastBlend * 0.7) + coastE * coastBlend * 0.7;

    e = Math.max(0, e);
    e = Math.pow(e, 1.08) * 1.1;
    e = Math.max(0.002, Math.min(1.0, e));
  }

  // Fine texture (high freq — must stay per-pixel)
  e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.004;

  if (lat > 0.88) e -= (lat - 0.88) * 2;

  elevation[i] = e;
}

// ═══════════════════════════════════════════════════════
// STEP 8b: 2D Wind Field — Atmospheric Circulation
// Three-cell model: Hadley (0-30°), Ferrel (30-60°), Polar (60-90°)
// with Coriolis deflection + terrain deflection via relaxation
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// Wind simulation using simplified shallow-fluid solver
// Land = solid wall boundaries. Wind must flow AROUND land.
// Divergence correction ensures mass conservation (Venturi/channeling).
// ═══════════════════════════════════════════════════════

// Work on coarser grid for performance (4x downscale)
const WG = 4, wW = Math.ceil(W / WG), wH = Math.ceil(H / WG);
const windX = new Float32Array(wW * wH);
const windY = new Float32Array(wW * wH);

// ── Geography on wind grid ──
const wElev = new Float32Array(wW * wH);
// Drag: surface friction. Lowlands have HIGH drag (sheltered), peaks LOW drag (exposed)
// This matches real-world: valleys ~2km/h, ridges/peaks ~15-40km/h
const drag = new Float32Array(wW * wH);
for (let wy = 0; wy < wH; wy++) for (let wx = 0; wx < wW; wx++) {
  const px = Math.min(W - 1, wx * WG), py = Math.min(H - 1, wy * WG);
  const e0 = elevation[py * W + px];
  wElev[wy * wW + wx] = Math.max(0, e0);
  if (e0 <= 0) {
    drag[wy * wW + wx] = 0.02; // ocean: very low friction
  } else if (e0 < 0.06) {
    drag[wy * wW + wx] = 0.55 + e0 * 3; // coastal lowlands: high friction (sheltered)
  } else if (e0 < 0.20) {
    drag[wy * wW + wx] = 0.73 - (e0 - 0.06) * 1.5; // inland: decreasing as elevation rises
  } else {
    // Mountains/peaks: LOW drag (exposed to upper winds), minimum 0.05
    drag[wy * wW + wx] = Math.max(0.05, 0.52 - (e0 - 0.20) * 1.5);
  }
}

// Smooth land fraction for pressure (continent-scale)
const smoothField = (src, dst, w2, h2, passes, rad) => {
  const r = rad || 2;
  const tmp = new Float32Array(w2 * h2);
  let inp = src, out = tmp;
  for (let p2 = 0; p2 < passes; p2++) {
    for (let y2 = 0; y2 < h2; y2++) for (let x2 = 0; x2 < w2; x2++) {
      let sum = 0, cnt = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx2 = (x2 + dx + w2) % w2, ny2 = y2 + dy;
        if (ny2 >= 0 && ny2 < h2) { sum += inp[ny2 * w2 + nx2]; cnt++; }
      }
      out[y2 * w2 + x2] = sum / cnt;
    }
    if (p2 < passes - 1) { const sw = inp; inp = out; out = sw; }
    else { for (let i = 0; i < w2 * h2; i++) dst[i] = out[i]; }
  }
};
const landFracRaw = new Float32Array(wW * wH);
for (let i = 0; i < drag.length; i++) landFracRaw[i] = drag[i] > 0 ? 1 : 0;
const landFrac = new Float32Array(wW * wH);
smoothField(landFracRaw, landFrac, wW, wH, 6, 3);

// ── Pressure field ──
// Built from randomly placed highs and lows, biased by latitude and land/ocean.
// NO abs(lat) symmetry — each hemisphere gets its own independent systems.
const pressure = new Float32Array(wW * wH);

// Place semi-permanent pressure systems (the real drivers of global wind)
// Subtropical highs, subpolar lows, thermal lows/highs over continents
const numSystems = 20 + Math.floor(rng() * 15);
for (let pi = 0; pi < numSystems; pi++) {
  const pcx = rng() * wW;
  const pcy = 0.03 * wH + rng() * 0.94 * wH;
  const latN = pcy / wH; // 0=top(north pole), 1=bottom(south pole)
  const latAbs = Math.abs(latN - 0.5) * 2; // 0=equator, 1=pole
  const wi0 = Math.min(wH - 1, pcy | 0) * wW + Math.min(wW - 1, pcx | 0);
  const lf = landFrac[wi0], oc = 1 - lf;

  // Bias: subtropical ocean → high, mid-lat ocean → low,
  // tropical land → low (thermal), polar land → high
  let highProb = 0.40;
  if (latAbs > 0.20 && latAbs < 0.45) highProb += oc * 0.35;  // subtropical ocean highs
  if (latAbs > 0.50 && latAbs < 0.80) highProb -= oc * 0.25;  // subpolar ocean lows
  if (latAbs < 0.30) highProb -= lf * 0.20;                     // tropical continental lows
  if (latAbs > 0.75) highProb += lf * 0.15;                     // polar continental highs
  const isHigh = rng() < highProb;

  const str = (0.3 + rng() * 0.9) * (0.4 + oc * 0.7);
  const rad = 12 + rng() * 40;
  for (let wy = 0; wy < wH; wy++) for (let wx = 0; wx < wW; wx++) {
    let ddx = wx - pcx;
    if (ddx > wW / 2) ddx -= wW; if (ddx < -wW / 2) ddx += wW;
    const ddy = wy - pcy;
    const d2 = ddx * ddx + ddy * ddy, r2 = rad * rad;
    if (d2 < r2 * 4) pressure[wy * wW + wx] += (isHigh ? 1 : -1) * str * Math.exp(-d2 / (2 * r2));
  }
}

// Add gentle large-scale noise to break any remaining regularity
for (let wy = 0; wy < wH; wy++) for (let wx = 0; wx < wW; wx++) {
  const wi = wy * wW + wx;
  pressure[wi] += fbm(wx / wW * 3 + s3 + 50, wy / wH * 3 + s3 + 50, 2, 2, 0.5) * 0.15;
}

// Smooth pressure
const pSmooth = new Float32Array(wW * wH);
smoothField(pressure, pSmooth, wW, wH, 5, 4);
for (let i = 0; i < pressure.length; i++) pressure[i] = pSmooth[i];

// ── Driving force field ──
// How real surface wind works on a rotating planet:
// 1. Pressure gradient pushes air toward low pressure
// 2. Coriolis deflects it RIGHT (NH) / LEFT (SH) — so strongly that
//    wind ends up flowing nearly PARALLEL to isobars (geostrophic balance)
// 3. Surface friction pulls it back ~15-25° across isobars toward low pressure
// Result: wind spirals around pressure systems, not straight into them.
//
// We model this as: rotate the pressure-gradient vector by a large angle
// (60-68° at mid-lats, 0° at equator) using tanh for smooth transition.
const forceX = new Float32Array(wW * wH);
const forceY = new Float32Array(wW * wH);
for (let wy = 1; wy < wH - 1; wy++) {
  const latSigned = (wy / wH - 0.5) * 2; // -1(north) to +1(south)
  // Coriolis rotation: saturates at ~68° (1.18 rad) near poles,
  // ~58° at mid-latitudes, 0 at equator. tanh prevents over-rotation.
  // Sign: NH (latSigned<0) → positive rotation, SH → negative
  // This creates: clockwise flow around NH highs, counter-clockwise around SH highs
  const coriolisAngle = -Math.tanh(latSigned * 2.5) * 1.2;
  const cosA = Math.cos(coriolisAngle), sinA = Math.sin(coriolisAngle);
  for (let wx = 0; wx < wW; wx++) {
    const wi = wy * wW + wx;
    const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
    const dpDx = (pressure[wy * wW + wr] - pressure[wy * wW + wl]) * 0.5;
    const dpDy = (pressure[(wy + 1) * wW + wx] - pressure[(wy - 1) * wW + wx]) * 0.5;
    // Base flow: toward low pressure
    const baseX = -dpDx, baseY = -dpDy;
    // Rotate by Coriolis angle — at mid-lats this turns "toward low"
    // into "mostly along isobars with slight inward spiral"
    forceX[wi] = baseX * cosA - baseY * sinA;
    forceY[wi] = baseX * sinA + baseY * cosA;
  }
}

// ── Fluid solver with continuous drag ──
// No hard walls. All cells participate.
// Drag slows sheltered lowlands, mountains have low drag (exposed).

// Initialize from driving force
for (let i = 0; i < wW * wH; i++) {
  windX[i] = forceX[i];
  windY[i] = forceY[i];
}

const divP = new Float32Array(wW * wH);

for (let iter = 0; iter < 25; iter++) {
  // 1) Diffuse + drag + driving force
  const tmpX = new Float32Array(windX);
  const tmpY = new Float32Array(windY);
  for (let wy = 1; wy < wH - 1; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const wi = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      const nl = wy * wW + wl, nr = wy * wW + wr;
      const nu = (wy - 1) * wW + wx, nd = (wy + 1) * wW + wx;

      // Neighbor average (all cells participate)
      const sx = (tmpX[nl] + tmpX[nr] + tmpX[nu] + tmpX[nd]) * 0.25;
      const sy = (tmpY[nl] + tmpY[nr] + tmpY[nu] + tmpY[nd]) * 0.25;

      // Terrain gradient: deflects wind along contour lines
      const eL = wElev[nl], eR = wElev[nr], eU = wElev[nu], eD = wElev[nd];
      const gradX = (eR - eL) * 0.5, gradY = (eD - eU) * 0.5;
      const gradMag = Math.sqrt(gradX * gradX + gradY * gradY);
      // Deflection force perpendicular to slope (terrain steering)
      const deflectStr = Math.min(0.8, gradMag * 4);
      const dfx = -gradY * deflectStr, dfy = gradX * deflectStr;

      // Blend: current + neighbors + force + deflection
      let vx = tmpX[wi] * 0.45 + sx * 0.30 + forceX[wi] * 0.25 + dfx;
      let vy = tmpY[wi] * 0.45 + sy * 0.30 + forceY[wi] * 0.25 + dfy;

      // Apply drag per iteration
      const d = drag[wi];
      windX[wi] = vx * (1 - d * 0.25);
      windY[wi] = vy * (1 - d * 0.25);
    }
  }

  // 2) Divergence correction every 2nd iteration
  if (iter % 2 === 0) {
    for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
      const wi = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      divP[wi] = (windX[wy * wW + wr] - windX[wy * wW + wl]
        + windY[(wy + 1) * wW + wx] - windY[(wy - 1) * wW + wx]) * 0.5;
    }
    const pCorr = new Float32Array(wW * wH);
    for (let ji = 0; ji < 10; ji++) {
      const pTmp = new Float32Array(pCorr);
      for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
        const wi = wy * wW + wx;
        const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
        pCorr[wi] = (pTmp[wy * wW + wl] + pTmp[wy * wW + wr]
          + pTmp[(wy - 1) * wW + wx] + pTmp[(wy + 1) * wW + wx]
          - divP[wi]) * 0.25;
      }
    }
    for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
      const wi = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      windX[wi] -= (pCorr[wy * wW + wr] - pCorr[wy * wW + wl]) * 0.5;
      windY[wi] -= (pCorr[(wy + 1) * wW + wx] - pCorr[(wy - 1) * wW + wx]) * 0.5;
    }
  }
}

// ── Percentile normalization: median → 0.18 ──
// Most area should be blue-green. Only the top ~20% reaches yellow/orange.
// Red reserved for exceptional jets only.
{
  const speeds = [];
  for (let i = 0; i < wW * wH; i++) {
    const s = Math.sqrt(windX[i] * windX[i] + windY[i] * windY[i]);
    if (s > 0.001) speeds.push(s);
  }
  speeds.sort((a, b) => a - b);
  const p50 = speeds[Math.min(speeds.length - 1, (speeds.length * 0.50) | 0)] || 1;
  const scale = 0.18 / p50;
  for (let i = 0; i < wW * wH; i++) {
    windX[i] *= scale;
    windY[i] *= scale;
  }
}

// ── Subtle curl noise for mesoscale eddies (all cells, reduced amplitude) ──
for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
  const wi = wy * wW + wx;
  const nx = wx / wW, ny = wy / wH;
  const eps = 0.003;
  const n0 = fbm(nx * 5 + s3 + 100, ny * 5 + s3 + 100, 3, 2, 0.5);
  const nDx = fbm((nx + eps) * 5 + s3 + 100, ny * 5 + s3 + 100, 3, 2, 0.5);
  const nDy = fbm(nx * 5 + s3 + 100, (ny + eps) * 5 + s3 + 100, 3, 2, 0.5);
  const amp = wElev[wi] > 0 ? 0.008 : 0.015;
  windX[wi] += (nDy - n0) / eps * amp;
  windY[wi] -= (nDx - n0) / eps * amp;
}

// Upscale wind to full resolution for moisture advection + export
const fullWindX = new Float32Array(W * H);
const fullWindY = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  // Bilinear interpolation from wind grid
  const fx = x / WG, fy = y / WG;
  const ix = Math.min(wW - 2, fx | 0), iy = Math.min(wH - 2, fy | 0);
  const dx = fx - ix, dy = fy - iy;
  const i00 = iy * wW + ix, i10 = iy * wW + Math.min(wW - 1, ix + 1);
  const i01 = Math.min(wH - 1, iy + 1) * wW + ix;
  const i11 = Math.min(wH - 1, iy + 1) * wW + Math.min(wW - 1, ix + 1);
  const fi = y * W + x;
  fullWindX[fi] = (windX[i00] * (1 - dx) + windX[i10] * dx) * (1 - dy)
    + (windX[i01] * (1 - dx) + windX[i11] * dx) * dy;
  fullWindY[fi] = (windY[i00] * (1 - dx) + windY[i10] * dx) * (1 - dy)
    + (windY[i01] * (1 - dx) + windY[i11] * dx) * dy;
}

// ═══════════════════════════════════════════════════════
// STEP 8c: Wind-advected moisture transport
// Moisture emitted by ocean, carried by wind, blocked by terrain
// Multi-step particle advection on the wind grid
// ═══════════════════════════════════════════════════════
const windMoisture = new Float32Array(W * H);
// Use coarse grid for advection (performance)
const mW = Math.ceil(W / 2), mH = Math.ceil(H / 2);
const mGrid = new Float32Array(mW * mH);
// Seed ocean tiles with moisture
for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
  const px = Math.min(W - 1, mx * 2), py = Math.min(H - 1, my * 2);
  if (elevation[py * W + px] <= 0) mGrid[my * mW + mx] = 0.8;
}
// Advect moisture along wind vectors for several iterations
for (let step = 0; step < 30; step++) {
  const prev = new Float32Array(mGrid);
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const px = Math.min(W - 1, mx * 2), py = Math.min(H - 1, my * 2);
    const fi = py * W + px;
    const wx2 = fullWindX[fi], wy2 = fullWindY[fi];
    // Sample upwind (where the wind is coming from)
    const srcX = mx - wx2 * 1.8, srcY = my - wy2 * 1.8;
    const sx = Math.min(mW - 2, Math.max(0, srcX | 0));
    const sy = Math.min(mH - 2, Math.max(0, srcY | 0));
    const fdx = srcX - sx, fdy = srcY - sy;
    const fdx1 = Math.max(0, Math.min(1, fdx)), fdy1 = Math.max(0, Math.min(1, fdy));
    const sxr = Math.min(mW - 1, sx + 1);
    // Bilinear sample from previous state
    const upwind = (prev[sy * mW + sx] * (1 - fdx1) + prev[sy * mW + sxr] * fdx1) * (1 - fdy1)
      + (prev[(sy + 1) * mW + sx] * (1 - fdx1) + prev[(sy + 1) * mW + sxr] * fdx1) * fdy1;
    const e2 = elevation[fi];
    if (e2 <= 0) {
      // Ocean: recharge moisture
      mGrid[my * mW + mx] = Math.max(prev[my * mW + mx], 0.75);
    } else {
      // Land: carry upwind moisture, terrain blocks
      const terrainBlock = Math.min(0.8, Math.max(0, e2 - 0.05) * 3);
      // Orographic lift: dump extra moisture on windward slopes
      const windSpeed = Math.sqrt(wx2 * wx2 + wy2 * wy2);
      const lift = Math.min(0.15, e2 * windSpeed * 0.4);
      const carried = upwind * (1 - terrainBlock * 0.3) * 0.96 - lift;
      mGrid[my * mW + mx] = Math.max(0, carried);
    }
  }
}
// Upscale moisture advection result to full resolution
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = x / 2, fy = y / 2;
  const ix = Math.min(mW - 2, fx | 0), iy = Math.min(mH - 2, fy | 0);
  const dx = fx - ix, dy = fy - iy;
  windMoisture[y * W + x] = (mGrid[iy * mW + ix] * (1 - dx) + mGrid[iy * mW + Math.min(mW - 1, ix + 1)] * dx) * (1 - dy)
    + (mGrid[(iy + 1) * mW + ix] * (1 - dx) + mGrid[(iy + 1) * mW + Math.min(mW - 1, ix + 1)] * dx) * dy;
}

// ═══════════════════════════════════════════════════════
// STEP 8d: Temperature & Moisture (final combination)
// ═══════════════════════════════════════════════════════
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;
  const e = elevation[i];

  // Maritime temperature moderation: coast proximity → milder temps
  const cdm = cdist[Math.min(dh - 1, (y / DG) | 0) * dw + Math.min(dw - 1, (x / DG) | 0)];
  const coastProx = Math.max(0, 1 - cdm / 8);
  const baseTemp = 1 - lat * 1.05 - Math.max(0, e) * 0.4 + sg(nfTemp, x, y) * 0.08;
  // Pull extreme temps toward 0.45 (ocean moderating effect)
  const moderated = baseTemp + (0.45 - baseTemp) * coastProx * 0.2;
  temperature[i] = Math.max(0, Math.min(1, moderated));

  if (e <= 0) {
    moisture[i] = 0.5 + sg(nfMoistOce, x, y) * 0.1;
  } else {
    const tropWet = Math.max(0, 1 - lat * 2.5);
    const subtropDry = Math.exp(-((lat - 0.28) ** 2) / (2 * 0.06 * 0.06)) * 0.50 * (1 - coastProx * 0.5);
    const tempWet = Math.exp(-((lat - 0.55) ** 2) / 0.025) * 0.22;
    const tropF = Math.max(0, 1 - lat * 3);
    const contRate = 0.006 + (1 - tropF) * 0.014;
    const cont = Math.min(0.28, cdm * contRate);
    const polarDry = Math.max(0, (lat - 0.75)) * 0.25;
    let m = 0.42 + tropWet * 0.42 - subtropDry + tempWet - cont - polarDry
      + sg(nfMoistLand, x, y) * 0.12;
    // Wind-advected moisture: high on windward coasts, low in rain shadow
    const wm = windMoisture[i];
    const windBoost = (wm - 0.3) * 0.6;
    m += windBoost;
    // Orographic lift: windward slopes get extra precipitation
    if (e > 0.1 && wm > 0.35) m += Math.min(0.12, (e - 0.1) * wm * 0.5);
    // Lowland moisture accumulation
    if (e < 0.02) m += 0.10;
    moisture[i] = Math.max(0.02, Math.min(1, m));
  }
}

return { elevation, moisture, temperature, pixPlate, windX: fullWindX, windY: fullWindY };
}
