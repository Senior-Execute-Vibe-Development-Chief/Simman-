// ── Tectonic Plate Terrain Generator ──
// Iterative PlaTec-style simulation: start with fractal crust on plates,
// move plates, handle collisions/subduction/rifting over N steps,
// then build final elevation from the accumulated crust.

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
// STEP 1: Setup — coarse simulation grid
// ═══════════════════════════════════════════════════════
const CG = 4;
const cw = Math.ceil(W / CG), ch = Math.ceil(H / CG);
const N = cw * ch;

// ═══════════════════════════════════════════════════════
// STEP 2: Generate plates
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
    cx = (i + 0.2 + rng() * 0.6) / numMajor; cy = 0.15 + rng() * 0.7;
  } else if (i < numMajor + numMinor) {
    cx = rng(); cy = 0.08 + rng() * 0.84;
  } else {
    const cc = clusterCenters[Math.floor(rng() * clusterCenters.length)];
    cx = cc.x + (rng() - 0.5) * 0.2; cy = cc.y + (rng() - 0.5) * 0.15;
  }
  cx = ((cx % 1) + 1) % 1; cy = Math.max(0.02, Math.min(0.98, cy));
  const angle = rng() * Math.PI * 2, speed = 0.3 + rng() * 0.7;
  // Velocity in coarse grid cells per step
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  plates.push({ cx, cy, vx, vy, id: i });
}

// ═══════════════════════════════════════════════════════
// STEP 3: Voronoi plate assignment (coarse grid)
// ═══════════════════════════════════════════════════════
const pixPlate = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  const warpX = fbm(nx * 2 + 13.7, ny * 2 + 13.7, 5, 2, 0.5) * 0.14
              + fbm(nx * 6 + 37.1, ny * 6 + 37.1, 4, 2, 0.5) * 0.05
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

// Coarse plate ownership
const plateMap = new Uint8Array(N);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 4: Initial fractal crust on the coarse grid
// Each cell gets a height. Above ~0 = continental, below = oceanic.
// ═══════════════════════════════════════════════════════
const crustSeed = rng() * 100;
// Initial continental crust — larger blobs, plates will reshape them
const crust = new Float32Array(N);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const nx = tx / cw, ny = ty / ch;
  crust[ty * cw + tx] = fbm(nx * 1.8 + crustSeed, ny * 1.8 + crustSeed, 5, 2, 0.5) * 0.22
    + fbm(nx * 4 + crustSeed + 40, ny * 4 + crustSeed + 40, 3, 2, 0.5) * 0.06
    - 0.02;
}

// ═══════════════════════════════════════════════════════
// STEP 5: Iterative plate simulation
// Move plates, handle collisions/subduction/rifting.
// ═══════════════════════════════════════════════════════
const SIM_STEPS = 200;
// Mutable velocities — plates slow down from collisions
const plateVX = new Float32Array(numPlates);
const plateVY = new Float32Array(numPlates);
const plateCells = new Float32Array(numPlates); // cell count per plate
for (let p = 0; p < numPlates; p++) {
  plateVX[p] = plates[p].vx;
  plateVY[p] = plates[p].vy;
}
// Count initial cells per plate
for (let i = 0; i < N; i++) plateCells[plateMap[i]]++;

for (let step = 0; step < SIM_STEPS; step++) {
  const nextCrust = new Float32Array(N).fill(-0.15);
  const nextOwner = new Int8Array(N).fill(-1);
  // Track collisions per plate this step
  const contCollisions = new Float32Array(numPlates); // continental collision count
  const oceCollisions = new Float32Array(numPlates);  // oceanic/subduction collision count

  // Move each cell by its plate's current velocity
  for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
    const si = ty * cw + tx;
    const p = plateMap[si];

    const ntx = Math.round(tx + plateVX[p] * 1.5);
    const nty = Math.round(ty + plateVY[p] * 1.5);
    const dtx = ((ntx % cw) + cw) % cw;
    const dty = Math.max(0, Math.min(ch - 1, nty));
    const di = dty * cw + dtx;

    if (nextOwner[di] === -1) {
      nextCrust[di] = crust[si];
      nextOwner[di] = p;
    } else if (nextOwner[di] !== p) {
      const existingCrust = nextCrust[di];
      const incomingCrust = crust[si];
      const bothContinental = existingCrust > 0 && incomingCrust > 0;
      const bothOceanic = existingCrust <= 0 && incomingCrust <= 0;

      if (bothContinental) {
        // Continental collision: fold upward, strong resistance
        nextCrust[di] = existingCrust + incomingCrust * 0.8;
        contCollisions[p]++;
        contCollisions[nextOwner[di]]++;
      } else if (bothOceanic) {
        nextCrust[di] = Math.max(existingCrust, incomingCrust) + 0.01;
        oceCollisions[p]++;
      } else {
        // Subduction: moderate resistance
        const contVal = existingCrust > 0 ? existingCrust : incomingCrust;
        const oceVal = existingCrust <= 0 ? existingCrust : incomingCrust;
        nextCrust[di] = contVal + Math.abs(oceVal) * 0.5;
        oceCollisions[p]++;
        nextOwner[di] = existingCrust > 0 ? nextOwner[di] : p;
      }
    } else {
      nextCrust[di] = Math.max(nextCrust[di], crust[si]);
    }
  }

  // Fill unclaimed cells with new oceanic crust
  for (let i = 0; i < N; i++) {
    if (nextOwner[i] === -1) {
      nextCrust[i] = -0.06 + fbm((i % cw) / cw * 8 + step, Math.floor(i / cw) / ch * 8 + step, 2, 2, 0.5) * 0.01;
      const tx = i % cw, ty = Math.floor(i / cw);
      let bestD = 1e9, bestP = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx2 = (tx + dx + cw) % cw, ny2 = ty + dy;
        if (ny2 < 0 || ny2 >= ch) continue;
        const ni = ny2 * cw + nx2;
        if (nextOwner[ni] >= 0) {
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; bestP = nextOwner[ni]; }
        }
      }
      nextOwner[i] = bestP;
    }
  }

  // Apply collision resistance — slow plates based on collision ratio
  for (let p = 0; p < numPlates; p++) {
    const cells = Math.max(1, plateCells[p]);
    // Continental collisions create strong resistance (can't subduct)
    // Oceanic collisions create moderate resistance (friction from subduction)
    const contRatio = contCollisions[p] / cells;
    const oceRatio = oceCollisions[p] / cells;
    // Strong drag from continental collision, moderate from subduction
    const drag = 1 - Math.min(0.95, contRatio * 8 + oceRatio * 2);
    plateVX[p] *= drag;
    plateVY[p] *= drag;
  }

  // Copy back and recount cells
  plateCells.fill(0);
  for (let i = 0; i < N; i++) {
    crust[i] = nextCrust[i];
    plateMap[i] = nextOwner[i] >= 0 ? nextOwner[i] : plateMap[i];
    plateCells[plateMap[i]]++;
  }
}

// One smoothing pass at the end to clean up blocky edges
const smoothed = new Float32Array(N);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const i = ty * cw + tx;
  let sum = crust[i] * 2, count = 2;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (tx + dx + cw) % cw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    sum += crust[ny2 * cw + nx2]; count++;
  }
  smoothed[i] = sum / count;
}
for (let i = 0; i < N; i++) crust[i] = smoothed[i];

// Update pixPlate from final coarse plateMap
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  pixPlate[y * W + x] = plateMap[Math.min(ch - 1, Math.floor(y / CG)) * cw + Math.min(cw - 1, Math.floor(x / CG))];
}

// pixPlate stays as the original warped Voronoi — organic plate shapes
// The simulation reshapes crust but plate identity is cosmetic for overlay

// ═══════════════════════════════════════════════════════
// STEP 6: Build pixel-level elevation from simulated crust
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

  // Base from simulated crust
  let e = crust[ci];

  // Mountain ridges on thick crust
  const crustW = Math.min(1, Math.max(0, e * 5));
  const [wmx2, wmy2] = warp(nx, ny, 2, 3, 0.1, s4, s4 + 40);
  e += ridged(wmx2 * 4 + s5, wmy2 * 4 + s5, 5, 2.2, 2.0, 1.0) * 0.12 * crustW;

  // Broad terrain variation (zero-centered)
  const [wbx, wby] = warp(nx, ny, 2.5, 3, 0.06, s3 + 10, s3 + 60);
  e += fbm(wbx * 5 + s3, wby * 5 + s3, 5, 2, 0.5) * 0.05;

  // Hills (zero-centered)
  const [whx, why] = warp(nx, ny, 4, 3, 0.05, s3 + 20, s3 + 70);
  e += fbm(whx * 6 + s2, why * 6 + s2, 4, 2, 0.5) * 0.025;

  // Valley carving
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
// STEP 7: Coast-distance BFS for moisture
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

// Moisture
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
