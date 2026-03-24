// ── Tectonic Plate Terrain Generator ──
// Hybrid model: stamp-based land shapes + Voronoi plate boundaries.
// Land shapes use multi-stamp composition (from Random mode) centered on
// continental plate nuclei, giving organic coastlines with peninsulas and bays.
// Tectonic boundary effects (mountains, rifts) are layered on top.
// Continentality-based interior terrain fills land interiors.

export function generateTectonicWorld(W, H, seed, noiseFns) {
const { initNoise, fbm, ridged, noise2D, worley } = noiseFns;
initNoise(seed);
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
const numMajor = 5 + Math.floor(rng() * 3);   // 5-7 major
const numMinor = 6 + Math.floor(rng() * 6);   // 6-11 minor
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
    ? 0.012 + rng() * 0.025   // major: 0.012-0.037
    : 0.001 + rng() * 0.005;  // minor: 0.001-0.006

  const hasCont = isMajor ? rng() < 0.70 : rng() < 0.20;

  const nucAngle = rng() * Math.PI * 2;
  const nucOffset = 0.02 + rng() * 0.08;
  const nucX = cx + Math.cos(nucAngle) * nucOffset;
  const nucY = cy + Math.sin(nucAngle) * nucOffset;

  // Larger continent radii for major plates → more cohesive landmasses
  const contRadius = hasCont ? (isMajor ? 0.14 + rng() * 0.18 : 0.06 + rng() * 0.07) : 0;

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

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  // Large-scale organic shape warping
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 5, 2, 0.5) * 0.14
    + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 4, 2, 0.5) * 0.05;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 5, 2, 0.5) * 0.14
    + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 4, 2, 0.5) * 0.05;
  // High-frequency jagged detail — ridged noise for sharp, bumpy edges
  const jagX = ridged(nx * 12 + 41.3, ny * 12 + 41.3, 3, 2.2, 2.0, 1.0) * 0.025
    - noise2D(nx * 18 + 55.1, ny * 18 + 55.1) * 0.012;
  const jagY = ridged(nx * 12 + 91.3, ny * 12 + 91.3, 3, 2.2, 2.0, 1.0) * 0.025
    - noise2D(nx * 18 + 105.1, ny * 18 + 105.1) * 0.012;
  const wnx = nx + warpX + jagX, wny = ny + warpY + jagY;
  let bestD = 1e9, bestP = 0;
  for (let p = 0; p < numPlates; p++) {
    let dx = wnx - plates[p].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    const dy = wny - plates[p].cy;
    // Stretch X distance slightly → plates become narrower and taller
    const d = dx * dx * 1.3 + dy * dy * 0.8 - plates[p].weight;
    if (d < bestD) { bestD = d; bestP = p; }
  }
  pixPlate[y * W + x] = bestP;
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

for (let p = 0; p < numPlates; p++) {
  const plate = plates[p];
  if (!plate.hasCont || plate.contRadius <= 0) continue;

  const isMaj = p < numMajor;
  const cx = plate.nucX, cy = plate.nucY;
  const no = rng() * 100;
  const scale = plate.contRadius / 0.18;

  // Major plates: 5-9 tightly packed stamps for cohesive bulk
  // Minor plates: 2-4 stamps for small landmasses
  const numSubs = isMaj ? 5 + Math.floor(rng() * 5) : 2 + Math.floor(rng() * 3);

  for (let s = 0; s < numSubs; s++) {
    const ang = rng() * Math.PI * 2;
    // Tighter clustering: stamps stay closer to nucleus (reduced max offset)
    const dist = s === 0 ? 0 : (0.03 + rng() * 0.08) * scale;
    const aspect = s === 0 ? 1 + rng() * 0.4
      : s <= 2 && rng() < 0.35 ? 1.3 + rng() * 1.2  // some elongated sub-stamps
      : 1 + rng() * 1.0;
    // Larger base radii for major plates, especially the core stamp
    const baseR = (s === 0
      ? (isMaj ? 0.12 + rng() * 0.10 : 0.07 + rng() * 0.06)
      : (isMaj ? 0.05 + rng() * 0.08 : 0.03 + rng() * 0.05)
    ) * scale;
    const rot = rng() * Math.PI;
    posStamps.push({
      cx: cx + Math.cos(ang) * dist,
      cy: cy + Math.sin(ang) * dist,
      rx: baseR * aspect, ry: baseR / aspect,
      rot, cos: Math.cos(rot), sin: Math.sin(rot),
      str: s === 0 ? 0.9 + rng() * 0.3 : 0.5 + rng() * 0.4,
      no: no + s * 17,
      plateId: p,
      contRadius: plate.contRadius // for size-dependent cross-plate bleed
    });
  }

  // 0-2 negative stamps for bays/gulfs (only on major plates)
  const numNegs = isMaj ? Math.floor(rng() * 2.5) : Math.floor(rng() * 1.5);
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
      plateId: p,
      contRadius: plate.contRadius
    });
  }
}

const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100;
const s4 = rng() * 100, s5 = rng() * 100;
const warp = (x, y, freq, oct, str, o1, o2) => [
  x + fbm(x * freq + o1, y * freq + o1, oct, 2, 0.5) * str,
  y + fbm(x * freq + o2, y * freq + o2, oct, 2, 0.5) * str
];

// Generate raw elevation from stamps
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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

  // Positive stamps — cross-plate bleed based on plate size ratio
  // Large plates can spill onto SMALL plates (India pushing into smaller plate)
  // but large-to-large spilling is nearly zero. Small plates never spill.
  const pxPlateId = pixPlate[y * W + x];
  const pxPlateW = plates[pxPlateId] ? plates[pxPlateId].weight : 0;
  for (const c of posStamps) {
    let dx = wnx - c.cx + cnA; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    let dy = wny - c.cy + cnB;
    let dd = Math.sqrt(Math.pow((dx * c.cos + dy * c.sin) / c.rx, 2) + Math.pow((-dx * c.sin + dy * c.cos) / c.ry, 2));
    dd += Math.abs(coastRidge + noise2D(wnx * 7 + c.no, wny * 7 + c.no) * 0.5) * 0.2;
    if (dd > 0.7 && dd < 1.3) { const rn = 1 - Math.abs(noise2D(wnx * 8 + c.no + 70, wny * 8 + c.no + 70)); dd += rn * rn * 0.12; }
    if (dd < 1) {
      const f2 = 1 - dd;
      let plateFactor = 1.0;
      if (pxPlateId !== c.plateId) {
        const stampW = plates[c.plateId] ? plates[c.plateId].weight : 0;
        // Ratio: how much bigger is the stamp's plate vs the pixel's plate?
        // Large→small (ratio>3): allow some bleed (up to 0.18)
        // Large→large (ratio~1): nearly zero bleed (0.02)
        const ratio = pxPlateW > 0.001 ? stampW / pxPlateW : 5;
        plateFactor = ratio > 2.5 ? Math.min(0.18, (ratio - 2.5) * 0.06) : 0.02;
      }
      e += f2 * f2 * c.str * plateFactor;
    }
  }

  // Negative stamps (bays/gulfs) — same ratio-based bleed
  for (const c of negStamps) {
    let dx = wnx - c.cx + cnA; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    let dy = wny - c.cy + cnB;
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

  // Peninsula/bay noise features — only on continental plates
  const onContPlate = plates[pxPlate] && plates[pxPlate].hasCont ? 1.0 : 0.12;
  const penNoise = fbm(wnx * 4 + s3 + 90, wny * 4 + s3 + 90, 3, 2, 0.5);
  if (penNoise > 0.4) e += (penNoise - 0.4) * 0.2 * onContPlate;
  const bayNoise = fbm(wnx * 3.5 + s4 + 120, wny * 3.5 + s4 + 120, 3, 2, 0.5);
  if (bayNoise > 0.45) e -= (bayNoise - 0.45) * 0.18 * onContPlate;

  // Worley F2-F1 near existing land
  const [wf1, wf2] = worley(wnx * 5 + s5, wny * 5 + s5);
  if (e > -0.1) e += (wf2 - wf1) * 0.04 - 0.02;

  // Domain-warped base terrain + fine detail
  e += fbm(wnx * 7 + 3.7, wny * 7 + 3.7, 4, 2, 0.5) * 0.10;
  e += fbm(nx * 20 + s3, ny * 20 + s3, 2, 2, 0.4) * 0.025;

  rawElev[y * W + x] = e;
}

// ═══════════════════════════════════════════════════════
// STEP 4b: Sea level + derive crustType from stamps
// ═══════════════════════════════════════════════════════
const sorted = Float32Array.from(rawElev).sort();
const sl = sorted[Math.floor(W * H * 0.72)]; // ~72% ocean for tectonic mode
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
      const strength = Math.min(1.5, convRate);
      if (myType === 1 && neighborType === 1) {
        // Continent-continent: uplift on BOTH sides (Himalayas straddle boundary)
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.18);
        boundaryConv[ni] = Math.max(boundaryConv[ni], strength * 0.14);
        boundaryCont[i] = 1;
        boundaryCont[ni] = 1;
      } else if (myType === 1 && neighborType === 0) {
        // Continent meets ocean: uplift on continent side, some on ocean side too
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.07);
        boundaryConv[ni] = Math.max(boundaryConv[ni], strength * 0.03);
        boundaryOceCont[i] = 1;
      } else if (myType === 0 && neighborType === 1) {
        // Ocean meets continent: uplift on BOTH sides (subduction creates
        // volcanic arc on overriding plate + forearc uplift)
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.03);
        boundaryConv[ni] = Math.max(boundaryConv[ni], strength * 0.07);
        boundaryOceCont[ni] = 1;
      } else {
        // Ocean-ocean: uplift on both sides (island arc straddles boundary)
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.02);
        boundaryConv[ni] = Math.max(boundaryConv[ni], strength * 0.02);
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
{
  const dist = new Float32Array(N).fill(1e9);
  const queue = [];
  for (let i = 0; i < N; i++) {
    if (boundaryConv[i] > 0) {
      mtnEffect[i] = boundaryConv[i];
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const ci = queue[qi];
    const cd = dist[ci];
    if (cd > 14) continue;
    const ty = Math.floor(ci / cw), tx = ci % cw;
    for (const [ddx, ddy] of D8) {
      const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
      if (ny2 < 0 || ny2 >= ch) continue;
      const ni = ny2 * cw + nx2;
      const nd = cd + (Math.abs(ddx) + Math.abs(ddy) > 1 ? 1.41 : 1);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        const spread = boundaryCont[ci] ? 10 : (boundaryOceCont[ci] ? 6 : 4);
        const falloff = Math.exp(-nd * nd / (2 * spread * spread));
        const effect = boundaryConv[ci] * falloff;
        if (effect > mtnEffect[ni]) {
          mtnEffect[ni] = effect;
          queue.push(ni);
        }
      }
    }
  }
}

// Rift propagation (divergent effects)
{
  const dist = new Float32Array(N).fill(1e9);
  const queue = [];
  for (let i = 0; i < N; i++) {
    if (boundaryDiv[i] > 0) {
      riftEffect[i] = boundaryDiv[i];
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const ci = queue[qi];
    const cd = dist[ci];
    if (cd > 6) continue;
    const ty = Math.floor(ci / cw), tx = ci % cw;
    for (const [ddx, ddy] of D8) {
      const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
      if (ny2 < 0 || ny2 >= ch) continue;
      const ni = ny2 * cw + nx2;
      const nd = cd + (Math.abs(ddx) + Math.abs(ddy) > 1 ? 1.41 : 1);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        const falloff = Math.exp(-nd * nd / 8);
        const effect = boundaryDiv[ci] * falloff;
        if (effect > riftEffect[ni]) {
          riftEffect[ni] = effect;
          queue.push(ni);
        }
      }
    }
  }
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
const cubicW = (t) => {
  const t2 = t * t, t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2
  ];
};
const sampleCrust = (fx, fy) => {
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const dx = fx - ix, dy = fy - iy;
  const wx = cubicW(dx), wy = cubicW(dy);
  let val = 0;
  for (let jy = -1; jy <= 2; jy++) {
    let rowVal = 0;
    for (let jx = -1; jx <= 2; jx++) {
      rowVal += crustAt(ix + jx, iy + jy) * wx[jx + 1];
    }
    val += rowVal * wy[jy + 1];
  }
  return val;
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
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;

  // Start with stamp elevation relative to sea level
  let e = (rawElev[i] - sl) * 0.3;

  // Add interpolated tectonic modifier (mountains/rifts from plate boundaries)
  const tcx = x / CG, tcy = y / CG;
  const tecMod = sampleCrust(tcx, tcy);
  e += tecMod;

  if (e > 0) {
    // Continentality-based interior terrain shaping
    const raw = e;
    const domeH = Math.min(1, raw / 0.15);
    const cd = cdist[Math.min(dh - 1, Math.floor(y / DG)) * dw + Math.min(dw - 1, Math.floor(x / DG))];
    const interior = Math.min(1, cd / 15);

    // Ridged mountains in interior (stronger where tectonic uplift exists)
    const tecBoost = 1 + Math.max(0, tecMod) * 3; // tectonic uplift amplifies mountains
    const [wmx, wmy] = warp(nx, ny, 2, 3, 0.1, s4, s4 + 40);
    e += ridged(wmx * 4 + s5, wmy * 4 + s5, 5, 2.2, 2.0, 1.0) * interior * interior * domeH * 0.45 * tecBoost;

    // Hills
    const [whx, why] = warp(nx, ny, 4, 3, 0.05, s3 + 20, s3 + 70);
    e += Math.max(0, fbm(whx * 6 + s2, why * 6 + s2, 4, 2, 0.5)) * 0.08 * Math.sqrt(interior);

    // Valley carving
    e -= Math.max(0, fbm(nx * 5 + s1 + 60, ny * 5 + s1 + 60, 3, 2, 0.5) + 0.15) * 0.06 * interior;

    // Power curve for realistic elevation distribution
    e = Math.pow(Math.max(0, e), 0.85) * 1.2;
    e = Math.max(0.003, e);
  }

  // Fine texture
  e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.006;

  // Polar reduction
  if (lat > 0.88) e -= (lat - 0.88) * 2;

  elevation[i] = e;
  temperature[i] = Math.max(0, Math.min(1,
    1 - lat * 1.05 - Math.max(0, e) * 0.4 + fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5) * 0.08));
}

// ═══════════════════════════════════════════════════════
// STEP 9: Moisture (latitude zones + coast distance + noise)
// ═══════════════════════════════════════════════════════
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, nx = x / W, ny = y / H, lat = Math.abs(ny - 0.5) * 2;
  if (elevation[i] <= 0) { moisture[i] = 0.5 + fbm(nx * 3 + 30, ny * 3 + 30, 2, 2, 0.5) * 0.1; continue; }
  const cd = cdist[Math.min(dh - 1, Math.floor(y / DG)) * dw + Math.min(dw - 1, Math.floor(x / DG))];
  const coastProx = Math.max(0, 1 - cd / 8);
  const tropWet = Math.max(0, 1 - lat * 2.5);
  const subtropDry = Math.exp(-((lat - 0.28) ** 2) / (2 * 0.06 * 0.06)) * 0.50 * (1 - coastProx * 0.5);
  const tempWet = Math.exp(-((lat - 0.55) ** 2) / 0.025) * 0.22;
  const tropF = Math.max(0, 1 - lat * 3);
  const contRate = 0.006 + (1 - tropF) * 0.014;
  const cont = Math.min(0.28, cd * contRate);
  const polarDry = Math.max(0, (lat - 0.75)) * 0.25;
  let m = 0.42 + tropWet * 0.42 - subtropDry + tempWet - cont - polarDry
    + fbm(nx * 4 + 50, ny * 4 + 50, 4, 2, 0.55) * 0.12;
  if (elevation[i] > 0.15) m -= Math.min(0.2, (elevation[i] - 0.15) * 1);
  if (elevation[i] < 0.02) m += 0.10;
  moisture[i] = Math.max(0.02, Math.min(1, m));
}

return { elevation, moisture, temperature, pixPlate };
}
