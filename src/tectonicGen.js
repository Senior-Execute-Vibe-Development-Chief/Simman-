// ── Tectonic Plate Terrain Generator ──
// Boundary-stress model: plates are static Voronoi regions. Terrain is shaped
// by computing relative velocity at plate boundaries and propagating effects
// (mountains, rifts, volcanic arcs) inward with distance falloff.
//
// Key physics preserved:
//  - Continental crust is buoyant: it cannot be destroyed or subducted
//  - Continental area is preserved during collisions (crust thickens, not shrinks)
//  - Oceanic crust subducts under continental crust (destroyed, slight arc uplift)
//  - Mountain heights capped by isostatic equilibrium
//  - Transform boundaries: lateral sliding, no crust creation/destruction
//  - Mass roughly conserved: crust created at ridges ≈ destroyed at trenches

export function generateTectonicWorld(W, H, seed, noiseFns) {
const { initNoise, fbm, ridged } = noiseFns;
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
// ═══════════════════════════════════════════════════════
const numMajor = 4 + Math.floor(rng() * 3);   // 4-6 major
const numMinor = 4 + Math.floor(rng() * 4);   // 4-7 minor
const numPlates = numMajor + numMinor;
const plates = [];

// Each plate with continental crust gets a "nucleus" — the center of the
// continent, which can sit anywhere in the plate (including near an edge,
// like Africa on the African plate). contRadius controls how far the
// continental crust extends from the nucleus.
for (let i = 0; i < numPlates; i++) {
  let cx, cy;
  if (i < numMajor) {
    cx = (i + 0.2 + rng() * 0.6) / numMajor;
    cy = 0.12 + rng() * 0.76;
  } else {
    cx = rng();
    cy = 0.08 + rng() * 0.84;
  }
  cx = ((cx % 1) + 1) % 1;
  cy = Math.max(0.02, Math.min(0.98, cy));
  const angle = rng() * Math.PI * 2;
  const speed = 0.4 + rng() * 0.8;

  // Decide if this plate carries continental crust
  const isMajor = i < numMajor;
  const hasCont = isMajor ? rng() < 0.65 : rng() < 0.30;

  // Nucleus: offset from plate center in a random direction
  // The offset can be large — continent sits near a plate edge
  const nucAngle = rng() * Math.PI * 2;
  const nucOffset = 0.02 + rng() * 0.10; // significant offset from plate center
  const nucX = cx + Math.cos(nucAngle) * nucOffset;
  const nucY = cy + Math.sin(nucAngle) * nucOffset;

  // Continental radius: how far the continent extends from the nucleus
  // These need to be large enough to create substantial landmasses
  const contRadius = hasCont ? (isMajor ? 0.12 + rng() * 0.14 : 0.07 + rng() * 0.09) : 0;

  plates.push({
    cx, cy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    id: i,
    hasCont,
    nucX, nucY,
    contRadius,
  });
}
// Guarantee at least 3 plates carry continental crust (for ~30% land)
let numWithCont = plates.filter(p => p.hasCont).length;
while (numWithCont < 3) {
  const idx = Math.floor(rng() * numMajor);
  if (!plates[idx].hasCont) {
    plates[idx].hasCont = true;
    plates[idx].contRadius = 0.12 + rng() * 0.12;
    numWithCont++;
  }
}

// ═══════════════════════════════════════════════════════
// STEP 3: Voronoi plate assignment with domain warping
// ═══════════════════════════════════════════════════════
const plateMap = new Uint8Array(N); // coarse grid plate ownership
const pixPlate = new Uint8Array(W * H); // pixel-level plate ownership

// Assign at pixel level (for overlay), then downsample to coarse
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  // Multi-scale warping for organic boundaries
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 5, 2, 0.5) * 0.14
    + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 4, 2, 0.5) * 0.05;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 5, 2, 0.5) * 0.14
    + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 4, 2, 0.5) * 0.05;
  const wnx = nx + warpX, wny = ny + warpY;
  let bestD = 1e9, bestP = 0;
  for (let p = 0; p < numPlates; p++) {
    let dx = wnx - plates[p].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    const dy = wny - plates[p].cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestP = p; }
  }
  pixPlate[y * W + x] = bestP;
}
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 4: Initial crust from continent nuclei
// Each plate with hasCont has a nucleus (nucX, nucY) that can be anywhere
// in the plate — often near an edge (like Africa on the African plate).
// Continental crust radiates from the nucleus with noise-warped edges.
// Cells on the same plate but far from the nucleus are oceanic.
// ═══════════════════════════════════════════════════════
const crustSeed = rng() * 100;
const crust = new Float32Array(N);      // height/thickness
const crustType = new Uint8Array(N);    // 0 = oceanic, 1 = continental

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const i = ty * cw + tx;
  const nx = tx / cw, ny = ty / ch;

  // Noise for irregular continent edges and intra-plate variation
  const edgeNoise = fbm(nx * 4 + crustSeed, ny * 4 + crustSeed, 4, 2, 0.5) * 0.04
    + fbm(nx * 8 + crustSeed + 40, ny * 8 + crustSeed + 40, 3, 2, 0.5) * 0.02;
  const variation = fbm(nx * 3 + crustSeed + 80, ny * 3 + crustSeed + 80, 3, 2, 0.5) * 0.05;

  // Check distance to ALL continental nuclei (not just this cell's plate).
  // A cell is continental if it's close enough to any nucleus AND on the
  // same plate as that nucleus. This lets continents sit anywhere in the plate.
  let isCont = false;
  let bestInteriorness = 0;
  const pid = plateMap[i];

  for (let p = 0; p < numPlates; p++) {
    const plate = plates[p];
    if (!plate.hasCont || plate.contRadius <= 0) continue;
    // Only affect cells on this plate
    if (p !== pid) continue;

    // Distance from this cell to the continent nucleus (wrapping X)
    let dx = nx - plate.nucX;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    const dy = ny - plate.nucY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Continental if within radius + noise
    const threshold = plate.contRadius + edgeNoise;
    if (dist < threshold) {
      isCont = true;
      const interior = Math.max(0, 1 - dist / Math.max(0.01, threshold));
      if (interior > bestInteriorness) bestInteriorness = interior;
    }
  }

  if (isCont) {
    crustType[i] = 1;
    // Higher in interior, lower near coast (continental shelf effect)
    crust[i] = 0.02 + bestInteriorness * 0.06 + Math.abs(variation) + variation;
  } else {
    crustType[i] = 0;
    crust[i] = -0.08 + variation;
  }
}

// ═══════════════════════════════════════════════════════
// STEP 5: Compute boundary interactions
// For each boundary cell, determine convergent/divergent/transform
// rate from relative plate velocity, then propagate effects inward.
// Run multiple epochs (with re-plating) for Wilson cycle.
// ═══════════════════════════════════════════════════════
const D8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

// ── Find boundary cells and compute interaction type ──
// Same plates that define the continents also define the boundaries.
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

    // Boundary normal: points from this cell toward neighbor
    let bnx = ddx, bny = ddy;
    const bl = Math.sqrt(bnx * bnx + bny * bny) || 1;
    bnx /= bl; bny /= bl;

    // Convergent rate = dot(relVel, boundaryNormal)
    const convRate = ((pB.vx - pA.vx) * bnx + (pB.vy - pA.vy) * bny);

    const myType = crustType[i];
    const neighborType = crustType[ni];

    if (convRate > 0.05) {
      const strength = Math.min(1.5, convRate);
      if (myType === 1 && neighborType === 1) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.18);
        boundaryCont[i] = 1;
      } else if (myType === 1 && neighborType === 0) {
        boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.07);
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
// STEP 6: Combine base crust with tectonic effects
// ═══════════════════════════════════════════════════════
for (let i = 0; i < N; i++) {
  crust[i] += mtnEffect[i] - riftEffect[i];

  // Isostatic equilibrium: cap mountain heights
  // Real mountains max at ~0.5 in our scale (~9km equivalent)
  if (crustType[i] === 1) {
    crust[i] = Math.min(0.50, crust[i]);
    // Continental crust can't go below sea level from rifting
    // (it's too buoyant) — but it can get close
    crust[i] = Math.max(-0.01, crust[i]);
  } else {
    // Ocean floor: cap depth and any uplift
    crust[i] = Math.max(-0.25, crust[i]);
    // Ocean speckle suppression: oceanic crust barely above 0 sinks back
    if (crust[i] > 0 && crust[i] < 0.025) crust[i] = -0.01;
  }
}

// Smoothing: 4 passes to blend effects naturally
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
// STEP 7: Build pixel-level elevation from crust
// Bicubic interpolation + domain warping for organic coastlines
// ═══════════════════════════════════════════════════════
const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100;
const s4 = rng() * 100, s5 = rng() * 100;
const warp = (x, y, freq, oct, str, o1, o2) => [
  x + fbm(x * freq + o1, y * freq + o1, oct, 2, 0.5) * str,
  y + fbm(x * freq + o2, y * freq + o2, oct, 2, 0.5) * str
];

// Bicubic helpers
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

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;

  // Multi-scale domain warping for organic coastlines
  const swx = x / CG
    + fbm(nx * 1.5 + s1 + 200, ny * 1.5 + s1 + 200, 4, 2, 0.5) * 2.5
    + fbm(nx * 4 + s1 + 300, ny * 4 + s1 + 300, 3, 2, 0.5) * 1.0
    + fbm(nx * 10 + s1 + 400, ny * 10 + s1 + 400, 2, 2, 0.5) * 0.3;
  const swy = y / CG
    + fbm(nx * 1.5 + s1 + 250, ny * 1.5 + s1 + 250, 4, 2, 0.5) * 2.5
    + fbm(nx * 4 + s1 + 350, ny * 4 + s1 + 350, 3, 2, 0.5) * 1.0
    + fbm(nx * 10 + s1 + 450, ny * 10 + s1 + 450, 2, 2, 0.5) * 0.3;

  let e = sampleCrust(swx, swy);

  // Mountain ridges on elevated land (tectonically thickened crust)
  const crustW = Math.min(1, Math.max(0, e * 4));
  const [wmx2, wmy2] = warp(nx, ny, 2, 3, 0.1, s4, s4 + 40);
  e += ridged(wmx2 * 4 + s5, wmy2 * 4 + s5, 5, 2.2, 2.0, 1.0) * 0.10 * crustW;

  // Broad terrain variation
  const [wbx, wby] = warp(nx, ny, 2.5, 3, 0.06, s3 + 10, s3 + 60);
  e += fbm(wbx * 5 + s3, wby * 5 + s3, 5, 2, 0.5) * 0.04;

  // Hills
  const [whx, why] = warp(nx, ny, 4, 3, 0.05, s3 + 20, s3 + 70);
  e += fbm(whx * 6 + s2, why * 6 + s2, 4, 2, 0.5) * 0.02;

  // Valley carving
  e -= Math.max(0, fbm(nx * 5 + s1 + 60, ny * 5 + s1 + 60, 3, 2, 0.5) + 0.15) * 0.025;

  // Fine texture
  e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.006;

  // Polar reduction
  if (lat > 0.88) e -= (lat - 0.88) * 2;

  elevation[i] = e;
  temperature[i] = Math.max(0, Math.min(1,
    1 - lat * 1.05 - Math.max(0, e) * 0.4 + fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5) * 0.08));
}

// ═══════════════════════════════════════════════════════
// STEP 8: Coast-distance BFS for moisture
// ═══════════════════════════════════════════════════════
const DG = RES, dw = Math.ceil(W / DG), dh = Math.ceil(H / DG);
const cdist = new Uint8Array(dw * dh); cdist.fill(255);
const cdQ = [];
for (let ty = 0; ty < dh; ty++) for (let tx = 0; tx < dw; tx++) {
  const px = Math.min(W - 1, tx * DG), py = Math.min(H - 1, ty * DG), ti = ty * dw + tx;
  if (elevation[py * W + px] <= 0) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx2 = (tx + dx + dw) % dw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const np = Math.min(W - 1, nx2 * DG), npy = Math.min(H - 1, ny2 * DG);
    if (elevation[npy * W + np] <= 0) { cdist[ti] = 0; cdQ.push(ti); break; }
  }
}
for (let qi = 0; qi < cdQ.length; qi++) {
  const ci = cdQ[qi], cd = cdist[ci], cx = ci % dw, cy2 = (ci - cx) / dw;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx + dx + dw) % dw, ny2 = cy2 + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const ni = ny2 * dw + nx2, nd = cd + 1;
    if (nd < cdist[ni] && elevation[Math.min(H - 1, ny2 * DG) * W + Math.min(W - 1, nx2 * DG)] > 0) {
      cdist[ni] = nd; cdQ.push(ni);
    }
  }
}

// Moisture: latitude zones + coast distance + noise
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
