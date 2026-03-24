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

// Decide which plates are continental (~40-55% of major, ~15-25% of minor)
const contFlags = [];
let numCont = 0;
for (let i = 0; i < numPlates; i++) {
  const isMajor = i < numMajor;
  const prob = isMajor ? 0.50 : 0.20;
  const isCont = rng() < prob ? 1 : 0;
  contFlags.push(isCont);
  numCont += isCont;
}
// Guarantee at least 2 continental and 2 oceanic plates
if (numCont < 2) { contFlags[0] = 1; contFlags[1] = 1; }
if (numCont > numPlates - 2) { contFlags[numPlates - 1] = 0; contFlags[numPlates - 2] = 0; }

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
  plates.push({
    cx, cy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    id: i,
    continental: contFlags[i],
  });
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
// STEP 4: Initial crust from plate ownership
// Continental plates → land, oceanic plates → ocean floor.
// Noise adds variation within each plate and softens edges.
// ═══════════════════════════════════════════════════════
const crustSeed = rng() * 100;
const crust = new Float32Array(N);      // height/thickness
const crustType = new Uint8Array(N);    // 0 = oceanic, 1 = continental

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const i = ty * cw + tx;
  const nx = tx / cw, ny = ty / ch;
  const pid = plateMap[i];
  const isCont = plates[pid].continental;

  // Noise for intra-plate variation (shelves, basins, highlands)
  const variation = fbm(nx * 3 + crustSeed, ny * 3 + crustSeed, 4, 2, 0.5) * 0.06
    + fbm(nx * 6 + crustSeed + 40, ny * 6 + crustSeed + 40, 3, 2, 0.5) * 0.02;

  if (isCont) {
    crustType[i] = 1;
    // Continental: base 0.04 + variation → mostly above sea level
    // Some low areas near edges can be continental shelves
    crust[i] = 0.04 + Math.abs(variation) * 1.5 + variation;
  } else {
    crustType[i] = 0;
    // Oceanic: base -0.08 + variation → below sea level
    crust[i] = -0.08 + variation;
  }
}

// ═══════════════════════════════════════════════════════
// STEP 5: Compute boundary interactions
// For each boundary cell, determine convergent/divergent/transform
// rate from relative plate velocity, then propagate effects inward.
// Run multiple epochs (with re-plating) for Wilson cycle.
// ═══════════════════════════════════════════════════════
const EPOCHS = 2;
const D8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

// Working arrays for boundary effects
const mtnEffect = new Float32Array(N); // mountain building (positive)
const riftEffect = new Float32Array(N); // rift/trench (negative)

let curPlateMap = plateMap;
let curPlates = plates;
let curNumPlates = numPlates;

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  // ── Find boundary cells and compute interaction type ──
  const boundaryConv = new Float32Array(N); // convergent rate at boundary
  const boundaryDiv = new Float32Array(N);  // divergent rate at boundary
  const boundaryCont = new Uint8Array(N);   // is this a continental boundary?
  const boundaryOceCont = new Uint8Array(N); // oceanic-continental subduction?
  const isBoundary = new Uint8Array(N);

  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    const i = ty * cw + tx;
    const myPlate = curPlateMap[i];

    for (const [ddx, ddy] of D8) {
      const nx2 = (tx + ddx + cw) % cw, ny2 = ty + ddy;
      if (ny2 < 0 || ny2 >= ch) continue;
      const ni = ny2 * cw + nx2;
      const neighborPlate = curPlateMap[ni];
      if (neighborPlate === myPlate) continue;

      isBoundary[i] = 1;

      // Relative velocity: how fast plates move toward each other
      const pA = curPlates[myPlate], pB = curPlates[neighborPlate];
      if (!pA || !pB) continue;

      // Boundary normal: points from this cell toward neighbor
      let bnx = ddx, bny = ddy;
      const bl = Math.sqrt(bnx * bnx + bny * bny) || 1;
      bnx /= bl; bny /= bl;

      // Relative velocity of B w.r.t. A
      const relVx = pB.vx - pA.vx;
      const relVy = pB.vy - pA.vy;

      // Convergent rate = dot(relVel, boundaryNormal)
      // Positive = plates moving toward each other (convergent)
      // Negative = plates moving apart (divergent)
      const convRate = (relVx * bnx + relVy * bny);

      // Classify crust types at boundary
      const myType = crustType[i];
      const neighborType = crustType[ni];

      if (convRate > 0.05) {
        // ── Convergent boundary ──
        let strength = Math.min(1.5, convRate);

        if (myType === 1 && neighborType === 1) {
          // Continental-continental: strong mountain building
          boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.18);
          boundaryCont[i] = 1;
        } else if (myType === 1 && neighborType === 0) {
          // Oceanic subducting under this continental cell: volcanic arc
          boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.07);
          boundaryOceCont[i] = 1;
        } else if (myType === 0 && neighborType === 1) {
          // This oceanic cell subducts: trench forms here
          boundaryDiv[i] = Math.max(boundaryDiv[i], strength * 0.04);
        } else {
          // Oceanic-oceanic: very minor island arc
          boundaryConv[i] = Math.max(boundaryConv[i], strength * 0.02);
        }
      } else if (convRate < -0.05) {
        // ── Divergent boundary ──
        const divStrength = Math.min(1.5, -convRate);

        if (myType === 1) {
          // Continental rift
          boundaryDiv[i] = Math.max(boundaryDiv[i], divStrength * 0.06);
        } else {
          // Mid-ocean ridge: slightly elevated ocean floor
          boundaryConv[i] = Math.max(boundaryConv[i], divStrength * 0.015);
        }
      }
      // Transform (|convRate| < 0.05): minimal effect, intentionally ignored
    }
  }

  // ── Propagate boundary effects inward via BFS ──
  // Mountains spread ~8-12 cells from boundary, rifts ~3-5 cells
  const epochMtn = new Float32Array(N);
  const epochRift = new Float32Array(N);

  // Mountain propagation (convergent effects)
  {
    const dist = new Float32Array(N).fill(1e9);
    const queue = [];
    for (let i = 0; i < N; i++) {
      if (boundaryConv[i] > 0) {
        epochMtn[i] = boundaryConv[i];
        dist[i] = 0;
        queue.push(i);
      }
    }
    // BFS flood with decay
    const mtnSpread = boundaryCont[0] ? 10 : 7; // continental collisions spread wider
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
          // Gaussian-ish falloff: strongest at boundary, fading inward
          const spread = boundaryCont[ci] ? 10 : (boundaryOceCont[ci] ? 6 : 4);
          const falloff = Math.exp(-nd * nd / (2 * spread * spread));
          const effect = boundaryConv[ci] * falloff;
          if (effect > epochMtn[ni]) {
            epochMtn[ni] = effect;
            queue.push(ni);
          }
        }
      }
    }
  }

  // Rift propagation (divergent effects) — narrower spread
  {
    const dist = new Float32Array(N).fill(1e9);
    const queue = [];
    for (let i = 0; i < N; i++) {
      if (boundaryDiv[i] > 0) {
        epochRift[i] = boundaryDiv[i];
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
          if (effect > epochRift[ni]) {
            epochRift[ni] = effect;
            queue.push(ni);
          }
        }
      }
    }
  }

  // Accumulate epoch effects
  for (let i = 0; i < N; i++) {
    mtnEffect[i] += epochMtn[i];
    riftEffect[i] += epochRift[i];
  }

  // ── Wilson Cycle: re-assign plates for next epoch ──
  if (epoch < EPOCHS - 1) {
    const newNum = 6 + Math.floor(rng() * 6); // 6-11 plates
    const newPlates = [];
    for (let i = 0; i < newNum; i++) {
      const cx = rng(), cy = 0.05 + rng() * 0.9;
      const angle = rng() * Math.PI * 2;
      const speed = 0.3 + rng() * 0.8;
      newPlates.push({ cx, cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, id: i, continental: 0 });
    }
    // Re-assign coarse grid with warping
    const ws2 = rng() * 100;
    for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
      const nx = tx / cw, ny = ty / ch;
      const wx = nx + fbm(nx * 3 + ws2, ny * 3 + ws2, 3, 2, 0.5) * 0.10;
      const wy = ny + fbm(nx * 3 + ws2 + 50, ny * 3 + ws2 + 50, 3, 2, 0.5) * 0.10;
      let bestD = 1e9, bestP = 0;
      for (let p = 0; p < newNum; p++) {
        let dx = wx - newPlates[p].cx;
        if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
        const dy = wy - newPlates[p].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestP = p; }
      }
      curPlateMap[ty * cw + tx] = bestP;
    }
    curPlates = newPlates;
    curNumPlates = newNum;
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
