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
const numMajor = 3 + Math.floor(rng() * 2); // 3-4 giant plates
const numMinor = 5 + Math.floor(rng() * 3); // 5-7 medium plates
const numMicro = 8 + Math.floor(rng() * 7); // 8-14 microplates
const numPlates = numMajor + numMinor + numMicro;
const plates = [];
// Continental assignment: major plates are ~50% continental, minor ~40%, micro ~20%
const numContinental = Math.floor(numMajor * (0.4 + rng() * 0.2))
  + Math.floor(numMinor * (0.3 + rng() * 0.2))
  + Math.floor(numMicro * (0.1 + rng() * 0.2));
const plateOrder = Array.from({length: numPlates}, (_, i) => i);
for (let i = numPlates - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plateOrder[i], plateOrder[j]] = [plateOrder[j], plateOrder[i]]; }
const contSet = new Set(plateOrder.slice(0, numContinental));
// Seed placement: major plates get widely spaced seeds, micro plates cluster
// near convergent-like zones (random cluster centers)
const clusterCenters = [];
for (let c = 0; c < 2 + Math.floor(rng() * 2); c++) {
  clusterCenters.push({ x: rng(), y: 0.15 + rng() * 0.7 });
}
for (let i = 0; i < numPlates; i++) {
  let cx, cy;
  if (i < numMajor) {
    // Major plates: spread evenly with jitter to avoid clustering
    cx = (i + 0.2 + rng() * 0.6) / numMajor;
    cy = 0.15 + rng() * 0.7;
  } else if (i < numMajor + numMinor) {
    // Minor plates: random placement
    cx = rng();
    cy = 0.08 + rng() * 0.84;
  } else {
    // Microplates: cluster near random centers (like subduction zones)
    const cc = clusterCenters[Math.floor(rng() * clusterCenters.length)];
    cx = cc.x + (rng() - 0.5) * 0.2;
    cy = cc.y + (rng() - 0.5) * 0.15;
  }
  // Wrap x
  cx = ((cx % 1) + 1) % 1;
  cy = Math.max(0.02, Math.min(0.98, cy));
  const continental = contSet.has(i);
  const angle = rng() * Math.PI * 2;
  const speed = 0.3 + rng() * 0.7;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const baseElev = continental ? 0.03 : -0.08;
  plates.push({ cx, cy, vx, vy, continental, baseElev, id: i });
}

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
// STEP 3: Classify plate boundaries (coarse grid)
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
    if (relV > 0.3) {
      if (myPlate.continental && otherPlate.continental) { type = 1; str = relV * 1.2; }
      else if (myPlate.continental || otherPlate.continental) { type = 2; str = relV * 0.9; }
      else { type = 2; str = relV * 0.5; }
    } else if (relV < -0.3) { type = 3; str = Math.abs(relV) * 0.6; }
    else if (tanV > 0.4) { type = 4; str = tanV * 0.3; }
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
// STEP 5: Build pixel-level elevation
// No blending across land/ocean boundaries — that causes rings.
// Instead: hard plate type, smooth noise-based terrain on each side.
// ═══════════════════════════════════════════════════════
const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100, s4 = rng() * 100;

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;
  const ctx = Math.min(cw - 1, Math.floor(x / CG));
  const cty = Math.min(ch - 1, Math.floor(y / CG));
  const ci = cty * cw + ctx;
  const plate = plates[pixPlate[i]];
  const fe = faultElev[ci], fd = faultDist[ci], bt = boundaryType[ci];

  let e;
  if (plate.continental) {
    // ── LAND ELEVATION ──
    // Start at base continental height
    e = plate.baseElev;

    // Fault-line mountains (plate boundary features)
    if (fe > 0) {
      const ridgeStr = fe * (fd < 3 ? 0.7 + 0.3 * ridged(nx * 5 + s1, ny * 5 + s1, 4, 2.2, 2.0, 1.0) : 1.0);
      if (fd < 8) {
        const rv = ridged(nx * 6 + s2, ny * 6 + s2, 5, 2.1, 2.0, 1.0);
        e += ridgeStr * (0.5 + rv * 0.5);
      } else {
        e += ridgeStr * 0.6;
      }
    }

    // Broad terrain variation — gives continents character
    e += fbm(nx * 5 + s3, ny * 5 + s3, 5, 2, 0.5) * 0.08;

    // Interior highlands (old mountain ranges, independent of plate boundaries)
    const highlandVal = ridged(nx * 3.5 + s4 + 20, ny * 3.5 + s4 + 20, 4, 2.0, 1.8, 1.0);
    const highlandMask = fbm(nx * 2.5 + s1 + 80, ny * 2.5 + s1 + 80, 3, 2, 0.5);
    if (highlandMask > 0.1) e += highlandVal * (highlandMask - 0.1) * 0.22;

    // Plateaus
    const platNoise = fbm(nx * 3 + s2 + 40, ny * 3 + s2 + 40, 3, 2, 0.5);
    if (platNoise > 0.3) e += (platNoise - 0.3) * 0.08;

    // Rolling hills
    e += fbm(nx * 10 + s3 + 15, ny * 10 + s3 + 15, 3, 2, 0.5) * 0.03;

    // Basin carving
    const basinNoise = fbm(nx * 2.5 + s1 + 50, ny * 2.5 + s1 + 50, 3, 2, 0.5);
    if (basinNoise > 0.2) e -= (basinNoise - 0.2) * 0.06;

    // Fine texture
    e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.01;

    // Ensure land stays above sea level
    e = Math.max(0.002, e);

  } else {
    // ── OCEAN ELEVATION ──
    // Uniform base depth for all ocean
    e = -0.08;

    // Continuous ocean floor texture (no plate-dependent variation)
    e += fbm(nx * 8 + s3 + 30, ny * 8 + s3 + 30, 3, 2, 0.4) * 0.015;

    // Oceanic fault features (mid-ocean ridges, trenches)
    if (fe > 0) {
      if (bt === 2) e -= fe * 0.4; // trench
      else if (bt === 3) e += fe * 0.25; // mid-ocean ridge
    }
  }

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

return { elevation, moisture, temperature };
}
