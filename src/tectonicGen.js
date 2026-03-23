// ── Tectonic Plate Terrain Generator ──
// Standalone module: generates elevation, moisture, temperature arrays
// using simplified plate tectonics simulation.
//
// Approach: independent noise-based crust field (PlaTec-style) defines
// where continental vs oceanic crust exists. Plates define boundaries
// where that crust interacts. Boundary effects modify the crust field.

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
// STEP 1: Generate plates (positions + velocities only)
// ═══════════════════════════════════════════════════════
const numMajor = 3 + Math.floor(rng() * 2);
const numMinor = 5 + Math.floor(rng() * 3);
const numMicro = 8 + Math.floor(rng() * 7);
const numPlates = numMajor + numMinor + numMicro;
const plates = [];
const clusterCenters = [];
for (let c = 0; c < 2 + Math.floor(rng() * 2); c++) {
  clusterCenters.push({ x: rng(), y: 0.15 + rng() * 0.7 });
}
for (let i = 0; i < numPlates; i++) {
  let cx, cy;
  if (i < numMajor) {
    cx = (i + 0.2 + rng() * 0.6) / numMajor;
    cy = 0.15 + rng() * 0.7;
  } else if (i < numMajor + numMinor) {
    cx = rng(); cy = 0.08 + rng() * 0.84;
  } else {
    const cc = clusterCenters[Math.floor(rng() * clusterCenters.length)];
    cx = cc.x + (rng() - 0.5) * 0.2; cy = cc.y + (rng() - 0.5) * 0.15;
  }
  cx = ((cx % 1) + 1) % 1; cy = Math.max(0.02, Math.min(0.98, cy));
  const angle = rng() * Math.PI * 2, speed = 0.3 + rng() * 0.7;
  plates.push({ cx, cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, id: i });
}

// ═══════════════════════════════════════════════════════
// STEP 2: Voronoi plate assignment + crust thickness field
// ═══════════════════════════════════════════════════════
const CG = 4;
const cw = Math.ceil(W / CG), ch = Math.ceil(H / CG);
const pixPlate = new Uint8Array(W * H);
const crustSeed = rng() * 100;

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 5, 2, 0.5) * 0.14
              + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 4, 2, 0.5) * 0.05
              + (1 - Math.abs(fbm(nx * 14 + 51.3, ny * 14 + 51.3, 3, 2.2, 0.5))) * 0.025;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 5, 2, 0.5) * 0.14
              + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 4, 2, 0.5) * 0.05
              + (1 - Math.abs(fbm(nx * 14 + 99.7, ny * 14 + 99.7, 3, 2.2, 0.5))) * 0.025;
  let bestD = 1e9, bestP = 0;
  const wnx = nx + warpX, wny = ny + warpY;
  for (let p = 0; p < numPlates; p++) {
    let dx = wnx - plates[p].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    const dy = wny - plates[p].cy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; bestP = p; }
  }
  pixPlate[y * W + x] = bestP;
}

const plateMap = new Uint8Array(cw * ch);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// Crust thickness field — independent of plates, like a fractal heightmap.
// Positive = thick continental crust, negative = thin oceanic crust.
// Uses low-frequency noise so continents are large coherent blobs.
// Biased slightly negative so ~65-70% is ocean by default.
const crustCoarse = new Float32Array(cw * ch);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const nx = tx / cw, ny = ty / ch;
  crustCoarse[ty * cw + tx] = fbm(nx * 2.5 + crustSeed, ny * 2.5 + crustSeed, 5, 2, 0.5) * 0.16
    + fbm(nx * 5 + crustSeed + 40, ny * 5 + crustSeed + 40, 3, 2, 0.5) * 0.05
    - 0.03; // bias toward ocean
}

// ═══════════════════════════════════════════════════════
// STEP 3: Classify boundaries using velocity + local crust
// ═══════════════════════════════════════════════════════
const boundaryType = new Uint8Array(cw * ch);
const boundaryStr = new Float32Array(cw * ch);
const boundaryNX = new Float32Array(cw * ch);
const boundaryNY = new Float32Array(cw * ch);

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const ti = ty * cw + tx;
  const myPlate = plates[plateMap[ti]];
  let maxStr = 0, bestType = 0, bestNX = 0, bestNY = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (tx + dx + cw) % cw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2;
    if (plateMap[ni] === plateMap[ti]) continue;
    const otherPlate = plates[plateMap[ni]];
    const bnx = (tx - nx2) / cw, bny = (ty - ny2) / ch;
    const bl = Math.sqrt(bnx * bnx + bny * bny) || 1;
    const nnx = bnx / bl, nny = bny / bl;
    const relV = (myPlate.vx - otherPlate.vx) * nnx + (myPlate.vy - otherPlate.vy) * nny;
    const tanV = Math.abs((myPlate.vx - otherPlate.vx) * (-nny) + (myPlate.vy - otherPlate.vy) * nnx);
    let type = 0, str = 0;
    const myCrust = crustCoarse[ti], otherCrust = crustCoarse[ni];
    const myThick = myCrust > 0, otherThick = otherCrust > 0;
    if (relV > 0.2) {
      if (myThick && otherThick) { type = 1; str = relV * 1.2; }       // continent-continent collision
      else if (myThick || otherThick) { type = 2; str = relV * 0.9; }   // subduction (oceanic under continental)
      else { type = 5; str = relV * 0.5; }                              // oceanic-oceanic convergence
    } else if (relV < -0.2) {
      if (myThick) { type = 6; str = Math.abs(relV) * 0.7; }           // continental rift
      else { type = 3; str = Math.abs(relV) * 0.5; }                    // oceanic divergence (mid-ocean ridge)
    } else if (tanV > 0.3) { type = 4; str = tanV * 0.3; }             // transform
    if (str > maxStr) { maxStr = str; bestType = type; bestNX = nnx; bestNY = nny; }
  }
  boundaryType[ti] = bestType;
  boundaryStr[ti] = Math.min(1, maxStr);
  boundaryNX[ti] = bestNX;
  boundaryNY[ti] = bestNY;
}

// ═══════════════════════════════════════════════════════
// STEP 4: BFS — modify crust at boundaries asymmetrically
// The base crust already defines continents. Boundaries sculpt edges.
// ═══════════════════════════════════════════════════════
const crustMod = new Float32Array(cw * ch); // additive modification to crust
const faultDist = new Float32Array(cw * ch).fill(255);
const faultQ = [];

for (let i = 0; i < cw * ch; i++) {
  if (boundaryType[i] === 0) continue;
  faultDist[i] = 0;
  const bt = boundaryType[i], bs = boundaryStr[i];
  // Seed the boundary cell with a crust modification
  if (bt === 1) crustMod[i] = 0.20 + bs * 0.25;        // collision: massive uplift (Himalayas)
  else if (bt === 2) crustMod[i] = 0.12 + bs * 0.15;    // subduction: volcanic arc on overriding side
  else if (bt === 5) crustMod[i] = 0.05 + bs * 0.06;    // oceanic convergence: island arc
  else if (bt === 3) crustMod[i] = 0.02 + bs * 0.01;    // mid-ocean ridge: uplift
  else if (bt === 6) crustMod[i] = -0.06 - bs * 0.04;   // continental rift: pull apart, thin crust
  else crustMod[i] = 0;                                   // transform: no mod
  faultQ.push(i);
}

for (let qi = 0; qi < faultQ.length; qi++) {
  const ci = faultQ[qi], cd = faultDist[ci];
  const cx2 = ci % cw, cy2 = (ci - cx2) / cw;
  const bt = boundaryType[ci], srcMod = crustMod[ci];
  const bnx = boundaryNX[ci], bny = boundaryNY[ci];
  const maxSpread = bt === 1 ? 25 : bt === 2 ? 18 : bt === 6 ? 12 : bt === 5 ? 8 : 5;

  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx2 + dx + cw) % cw, ny2 = cy2 + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2, nd = cd + 1;
    if (nd >= faultDist[ni] || nd > maxSpread) continue;

    const propDX = (nx2 - cx2) / cw, propDY = (ny2 - cy2) / ch;
    const propL = Math.sqrt(propDX * propDX + propDY * propDY) || 1;
    const dot = (propDX / propL) * bnx + (propDY / propL) * bny;
    const decay = Math.exp(-(nd * nd) / (maxSpread * maxSpread * 0.25));

    let newMod;
    if (bt === 1) {
      // Collision: both sides get broad uplift (Tibetan Plateau)
      newMod = srcMod * decay;
    } else if (bt === 2) {
      if (dot > 0) {
        // Overriding side: thick crust, volcanic mountains (Andes)
        newMod = srcMod * decay;
      } else {
        // Subducting side: deep trench
        newMod = -(0.10 + boundaryStr[ci] * 0.08) * decay;
      }
    } else if (bt === 5) {
      if (dot > 0) {
        // Overriding side: island arc
        newMod = srcMod * decay;
      } else {
        // Subducting side: trench
        newMod = -(0.04 + boundaryStr[ci] * 0.03) * decay;
      }
    } else if (bt === 6) {
      // Continental rift: both sides thin
      newMod = srcMod * decay;
    } else if (bt === 3) {
      // Mid-ocean ridge: slight symmetric uplift
      newMod = srcMod * decay;
    } else {
      newMod = 0;
    }

    if (Math.abs(newMod) > Math.abs(crustMod[ni])) {
      faultDist[ni] = nd;
      crustMod[ni] = newMod;
      boundaryType[ni] = bt;
      boundaryNX[ni] = bnx;
      boundaryNY[ni] = bny;
      faultQ.push(ni);
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 5: Build elevation from crust + boundary modifications
// ═══════════════════════════════════════════════════════
const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100, s4 = rng() * 100, s5 = rng() * 100;
const warp = (x, y, freq, oct, str, o1, o2) => [
  x + fbm(x * freq + o1, y * freq + o1, oct, 2, 0.5) * str,
  y + fbm(x * freq + o2, y * freq + o2, oct, 2, 0.5) * str
];

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;
  const ctx = Math.min(cw - 1, Math.floor(x / CG));
  const cty = Math.min(ch - 1, Math.floor(y / CG));
  const ci = cty * cw + ctx;

  // Base: crust field + tectonic modifications
  let e = crustCoarse[ci] + crustMod[ci];

  // Mountain ridges — scale by how thick the crust is locally
  const localCrust = e;
  const crustW = Math.min(1, Math.max(0, localCrust * 5));
  const [wmx2, wmy2] = warp(nx, ny, 2, 3, 0.1, s4, s4 + 40);
  e += ridged(wmx2 * 4 + s5, wmy2 * 4 + s5, 5, 2.2, 2.0, 1.0) * 0.12 * crustW;

  // Broad terrain variation (zero-centered)
  const [wbx, wby] = warp(nx, ny, 2.5, 3, 0.06, s3 + 10, s3 + 60);
  e += fbm(wbx * 5 + s3, wby * 5 + s3, 5, 2, 0.5) * 0.05;

  // Hills (zero-centered)
  const [whx, why] = warp(nx, ny, 4, 3, 0.05, s3 + 20, s3 + 70);
  e += fbm(whx * 6 + s2, why * 6 + s2, 4, 2, 0.5) * 0.025;

  // Valley / basin carving
  e -= Math.max(0, fbm(nx * 5 + s1 + 60, ny * 5 + s1 + 60, 3, 2, 0.5) + 0.15) * 0.03;

  // Fine texture
  e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.008;

  // Polar reduction
  if (lat > 0.88) e -= (lat - 0.88) * 2;

  elevation[i] = e;
  temperature[i] = Math.max(0, Math.min(1,
    1 - lat * 1.05 - Math.max(0, e) * 0.4 + fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5) * 0.08));
}

// ═══════════════════════════════════════════════════════
// STEP 6: Coast-distance BFS for continentality
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

// ═══════════════════════════════════════════════════════
// STEP 7: Moisture
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
