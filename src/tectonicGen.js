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

// Compute plate assignment at half resolution (4x fewer noise calls)
const PS = 2;
const ppW = Math.ceil(W / PS), ppH = Math.ceil(H / PS);
const pixPlateCoarse = new Uint8Array(ppW * ppH);

for (let py = 0; py < ppH; py++) for (let px = 0; px < ppW; px++) {
  const x = px * PS, y = py * PS;
  const nx = x / W, ny = y / H;
  // Large-scale organic shape warping (3 octaves — sufficient for smooth boundaries)
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 3, 2, 0.5) * 0.14
    + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 3, 2, 0.5) * 0.05;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 3, 2, 0.5) * 0.14
    + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 3, 2, 0.5) * 0.05;
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
    const d = dx * dx * 1.3 + dy * dy * 0.8 - plates[p].weight;
    if (d < bestD) { bestD = d; bestP = p; }
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
  if (penNoise > 0.4) e += (penNoise - 0.4) * 0.2 * onContPlate;
  const bayNoise = fbm(wnx * 3.5 + s4 + 120, wny * 3.5 + s4 + 120, 3, 2, 0.5);
  if (bayNoise > 0.45) e -= (bayNoise - 0.45) * 0.18 * onContPlate;

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
      // Uplift only on THIS cell's side (overriding plate). Never the neighbor.
      const strength = Math.min(1.5, convRate);
      if (myType === 1 && neighborType === 1) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.18);
        boundaryCont[i] = 1;
      } else if (myType === 1 && neighborType === 0) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.13);
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
    const maxDist = st === 2 ? 60 : (st === 1 ? 25 : 12);
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
          const d = Math.max(0, nd - 10);
          falloff = Math.exp(-d * d / (2 * 10 * 10));
        } else if (st === 1) {
          const d = Math.max(0, nd - 4);
          falloff = Math.exp(-d * d / (2 * 8 * 8));
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
  const sigma = 14; // coarse cells — moderate influence for foothill spread
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
    const plateau = broadVal * 1.5 * plateauNoise;
    const peaks = Math.max(0, tecMod) * 2.0;
    const mtnBump = sg(nfMtnBump, x, y)
      * 0.10 * Math.min(1, (plateau + peaks) * 3);
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
  temperature[i] = Math.max(0, Math.min(1,
    1 - lat * 1.05 - Math.max(0, e) * 0.4 + sg(nfTemp, x, y) * 0.08));

  if (e <= 0) {
    moisture[i] = 0.5 + sg(nfMoistOce, x, y) * 0.1;
  } else {
    const cdm = cdist[Math.min(dh - 1, (y / DG) | 0) * dw + Math.min(dw - 1, (x / DG) | 0)];
    const coastProx = Math.max(0, 1 - cdm / 8);
    const tropWet = Math.max(0, 1 - lat * 2.5);
    const subtropDry = Math.exp(-((lat - 0.28) ** 2) / (2 * 0.06 * 0.06)) * 0.50 * (1 - coastProx * 0.5);
    const tempWet = Math.exp(-((lat - 0.55) ** 2) / 0.025) * 0.22;
    const tropF = Math.max(0, 1 - lat * 3);
    const contRate = 0.006 + (1 - tropF) * 0.014;
    const cont = Math.min(0.28, cdm * contRate);
    const polarDry = Math.max(0, (lat - 0.75)) * 0.25;
    let m = 0.42 + tropWet * 0.42 - subtropDry + tempWet - cont - polarDry
      + sg(nfMoistLand, x, y) * 0.12;
    if (e > 0.15) m -= Math.min(0.2, (e - 0.15) * 1);
    if (e < 0.02) m += 0.10;
    moisture[i] = Math.max(0.02, Math.min(1, m));
  }
}

return { elevation, moisture, temperature, pixPlate };
}
