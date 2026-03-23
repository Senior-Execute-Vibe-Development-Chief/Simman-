// ── Tectonic Plate Terrain Generator ──
// Standalone module: generates elevation, moisture, temperature arrays
// using simplified plate tectonics simulation.
//
// Uses WorldSim's noise functions (passed in) to avoid PERM table conflicts.

// ── Main generator ──
// noiseFns: { initNoise, fbm, ridged, noise2D } from WorldSim
export function generateTectonicWorld(W, H, seed, noiseFns) {
const { initNoise, fbm, ridged } = noiseFns;
initNoise(seed);
// Seeded RNG
let rngState = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
const rng = () => { rngState = (rngState * 16807) % 2147483647; return (rngState - 1) / 2147483646; };
const elevation = new Float32Array(W * H);
const moisture = new Float32Array(W * H);
const temperature = new Float32Array(W * H);
const RES = 2;

// ═══════════════════════════════════════════════════════
// STEP 1: Generate tectonic plates
// ═══════════════════════════════════════════════════════
// Plate count: 3-4 major + 5-7 minor + 8-14 micro ≈ 16-25 total
const numMajor = 3 + Math.floor(rng() * 2);
const numMinor = 5 + Math.floor(rng() * 3);
const numMicro = 8 + Math.floor(rng() * 7);
const numPlates = numMajor + numMinor + numMicro;
const plates = [];
// Seed placement: major plates spaced, micro plates cluster
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
    cx = rng();
    cy = 0.08 + rng() * 0.84;
  } else {
    const cc = clusterCenters[Math.floor(rng() * clusterCenters.length)];
    cx = cc.x + (rng() - 0.5) * 0.2;
    cy = cc.y + (rng() - 0.5) * 0.15;
  }
  cx = ((cx % 1) + 1) % 1;
  cy = Math.max(0.02, Math.min(0.98, cy));
  const angle = rng() * Math.PI * 2;
  const speed = 0.3 + rng() * 0.7;
  plates.push({ cx, cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, id: i });
}
// Crust thickness field — continuous, independent of plates.
// Large-scale noise blobs create continent-shaped regions of thick crust
// (positive = continental, floats high) and thin crust (negative = oceanic, sits low).
const crustSeed = rng() * 100;
const crust = new Float32Array(W * H);

// ═══════════════════════════════════════════════════════
// STEP 2: Voronoi plate assignment at pixel level
// Strong domain warp for organic, non-geometric plate shapes
// ═══════════════════════════════════════════════════════
const CG = 4;
const cw = Math.ceil(W / CG), ch = Math.ceil(H / CG);
const pixPlate = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  // Aggressive multi-scale warp for organic, jagged plate boundaries
  // Layer 1: broad continental-scale distortion
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 5, 2, 0.5) * 0.14
  // Layer 2: medium-scale irregularity
              + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 4, 2, 0.5) * 0.05
  // Layer 3: fine jagged edges via ridged noise
              + (1 - Math.abs(fbm(nx * 14 + 51.3, ny * 14 + 51.3, 3, 2.2, 0.5))) * 0.025;
  const warpY = fbm(nx * 2 + 63.7, ny * 2 + 63.7, 5, 2, 0.5) * 0.14
              + fbm(nx * 6 + 87.1, ny * 6 + 87.1, 4, 2, 0.5) * 0.05
              + (1 - Math.abs(fbm(nx * 14 + 99.7, ny * 14 + 99.7, 3, 2.2, 0.5))) * 0.025;
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
// Coarse plate map for BFS
const plateMap = new Uint8Array(cw * ch);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 2b: Generate crust thickness field (independent of plates)
// ═══════════════════════════════════════════════════════
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  // Low-frequency blobs for continent shapes
  crust[y * W + x] = fbm(nx * 2.5 + crustSeed, ny * 2.5 + crustSeed, 5, 2, 0.5) * 0.14
    + fbm(nx * 5 + crustSeed + 40, ny * 5 + crustSeed + 40, 3, 2, 0.5) * 0.04;
}
// Coarse crust map for boundary classification
const crustMap = new Float32Array(cw * ch);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  crustMap[ty * cw + tx] = crust[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 3: Classify plate boundaries using local crust thickness
// ═══════════════════════════════════════════════════════
const boundaryType = new Uint8Array(cw * ch);
const boundaryStr = new Float32Array(cw * ch);

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const ti = ty * cw + tx;
  const myPlate = plates[plateMap[ti]];
  let maxStr = 0, bestType = 0;
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
    // Use local crust thickness to classify boundary type
    const myCrust = crustMap[ti], otherCrust = crustMap[ni];
    const myThick = myCrust > 0.02, otherThick = otherCrust > 0.02;
    if (relV > 0.3) {
      if (myThick && otherThick) { type = 1; str = relV * 1.2; } // continent-continent collision
      else if (myThick || otherThick) { type = 2; str = relV * 0.9; } // subduction
      else { type = 2; str = relV * 0.5; } // oceanic convergence
    } else if (relV < -0.3) { type = 3; str = Math.abs(relV) * 0.6; } // divergence
    else if (tanV > 0.4) { type = 4; str = tanV * 0.3; } // strike-slip
    if (str > maxStr) { maxStr = str; bestType = type; }
  }
  boundaryType[ti] = bestType;
  boundaryStr[ti] = Math.min(1, maxStr);
}

// ═══════════════════════════════════════════════════════
// STEP 4: BFS from boundaries — propagate mountain features
// ═══════════════════════════════════════════════════════
const faultDist = new Float32Array(cw * ch).fill(255);
const faultElev = new Float32Array(cw * ch);
const faultQ = [];
for (let i = 0; i < cw * ch; i++) {
  if (boundaryType[i] > 0) {
    faultDist[i] = 0;
    const bt = boundaryType[i], bs = boundaryStr[i];
    if (bt === 1) faultElev[i] = 0.25 + bs * 0.20;
    else if (bt === 2) faultElev[i] = 0.12 + bs * 0.15;
    else if (bt === 3) faultElev[i] = 0.03 + bs * 0.04;
    else faultElev[i] = 0.01 + bs * 0.03;
    faultQ.push(i);
  }
}
for (let qi = 0; qi < faultQ.length; qi++) {
  const ci = faultQ[qi], cd = faultDist[ci];
  const cx = ci % cw, cy = (ci - cx) / cw;
  const srcElev = faultElev[ci];
  const bt = boundaryType[ci];
  const maxSpread = bt === 1 ? 14 : bt === 2 ? 10 : 5;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx + dx + cw) % cw, ny2 = cy + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2, nd = cd + 1;
    if (nd < faultDist[ni] && nd <= maxSpread) {
      faultDist[ni] = nd;
      const decay = Math.exp(-(nd * nd) / (maxSpread * maxSpread * 0.18));
      faultElev[ni] = Math.max(faultElev[ni], srcElev * decay);
      if (boundaryType[ni] === 0) boundaryType[ni] = bt;
      faultQ.push(ni);
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 5: Build pixel-level elevation — unified, no land/ocean split
// Crust thickness drives base elevation; same terrain layers everywhere.
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
  const fe = faultElev[ci], fd = faultDist[ci], bt = boundaryType[ci];

  // Base elevation from crust thickness (continuous: thick → high, thin → low)
  let e = crust[i] * 0.8;

  // Tectonic boundary features (mountains at collisions, trenches at subduction)
  if (fe > 0) {
    if (bt === 2 && crust[i] < 0.02) {
      // Subduction trench on oceanic side
      e -= fe * 0.4;
    } else {
      // Mountains / ridges
      const [wmx, wmy] = warp(nx, ny, 3, 3, 0.08, s1, s1 + 40);
      const ridgeStr = fe * (fd < 3 ? 0.7 + 0.3 * ridged(wmx * 5, wmy * 5, 4, 2.2, 2.0, 1.0) : 1.0);
      if (fd < 8) {
        const rv = ridged(wmx * 6 + s2, wmy * 6 + s2, 5, 2.1, 2.0, 1.0);
        e += ridgeStr * (0.5 + rv * 0.5);
      } else {
        e += ridgeStr * 0.6;
      }
    }
  }

  // Independent mountain ridges (old ranges, hotspot chains)
  const [wmx2, wmy2] = warp(nx, ny, 2, 3, 0.1, s4, s4 + 40);
  e += ridged(wmx2 * 4 + s5, wmy2 * 4 + s5, 5, 2.2, 2.0, 1.0) * 0.15;

  // Broad terrain variation (domain-warped)
  const [wbx, wby] = warp(nx, ny, 2.5, 3, 0.06, s3 + 10, s3 + 60);
  e += fbm(wbx * 5 + s3, wby * 5 + s3, 5, 2, 0.5) * 0.10;

  // Hills (domain-warped)
  const [whx, why] = warp(nx, ny, 4, 3, 0.05, s3 + 20, s3 + 70);
  e += Math.max(0, fbm(whx * 6 + s2, why * 6 + s2, 4, 2, 0.5)) * 0.05;

  // Valley / basin carving
  e -= Math.max(0, fbm(nx * 5 + s1 + 60, ny * 5 + s1 + 60, 3, 2, 0.5) + 0.15) * 0.04;

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
// STEP 7: Moisture — same climate model as WorldSim
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
