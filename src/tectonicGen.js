// ── Tectonic Plate Terrain Generator ──
// Iterative PlaTec-style simulation: start with fractal crust on plates,
// move plates, handle collisions/subduction/rifting over N steps,
// then build final elevation from the accumulated crust.

import { simulateWind } from "./windSim.js";

export function generateTectonicWorld(W, H, seed, noiseFns) {
const { initNoise, fbm, ridged, noise2D } = noiseFns;
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
// STEP 5: Iterative plate simulation with merging,
// consumption, and Wilson cycle restart.
// ═══════════════════════════════════════════════════════
const CYCLES = 2;
const STEPS_PER_CYCLE = 40;
// Max plate ID we'll ever use (original + new plates from re-splitting)
let maxPlateId = numPlates;
// Mutable velocities and cell counts
let plateVX = new Float32Array(256);
let plateVY = new Float32Array(256);
let plateCells = new Float32Array(256);
let plateAlive = new Uint8Array(256); // track which plates still exist
for (let p = 0; p < numPlates; p++) {
  plateVX[p] = plates[p].vx;
  plateVY[p] = plates[p].vy;
  plateAlive[p] = 1;
}
for (let i = 0; i < N; i++) plateCells[plateMap[i]]++;
// Track overlap between plate pairs for merging
const overlapCount = new Map(); // "p1,p2" → count

for (let cycle = 0; cycle < CYCLES; cycle++) {

  for (let step = 0; step < STEPS_PER_CYCLE; step++) {
    const nextCrust = new Float32Array(N).fill(-0.15);
    const nextOwner = new Int16Array(N).fill(-1);
    const contCollisions = new Float32Array(256);
    const oceCollisions = new Float32Array(256);
    overlapCount.clear();

    // Move each cell
    for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
      const si = ty * cw + tx;
      const p = plateMap[si];
      if (!plateAlive[p]) continue;

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
        const ep = nextOwner[di];
        const bothContinental = existingCrust > 0 && incomingCrust > 0;
        const bothOceanic = existingCrust <= 0 && incomingCrust <= 0;

        // Track overlap for merging
        const key = Math.min(p, ep) + ',' + Math.max(p, ep);
        overlapCount.set(key, (overlapCount.get(key) || 0) + 1);

        if (bothContinental) {
          // Continental collision: fold upward
          nextCrust[di] = existingCrust + incomingCrust * 0.6;
          contCollisions[p]++;
          contCollisions[ep]++;
          // Incoming continental crust is consumed (folded into existing)
          // — the incoming plate loses this cell
        } else if (bothOceanic) {
          // Oceanic convergence: one subducts, slight island arc
          nextCrust[di] = Math.max(existingCrust, incomingCrust) + 0.008;
          oceCollisions[p]++;
          // Subducted plate loses this cell
        } else {
          // Subduction: oceanic consumed under continental
          const contVal = existingCrust > 0 ? existingCrust : incomingCrust;
          const oceVal = existingCrust <= 0 ? existingCrust : incomingCrust;
          nextCrust[di] = contVal + Math.abs(oceVal) * 0.3;
          oceCollisions[p]++;
          // Continental plate keeps ownership
          nextOwner[di] = existingCrust > 0 ? ep : p;
        }
      } else {
        nextCrust[di] = Math.max(nextCrust[di], crust[si]);
      }
    }

    // Fill unclaimed cells with new oceanic crust (rifting/divergence)
    for (let i = 0; i < N; i++) {
      if (nextOwner[i] === -1) {
        nextCrust[i] = -0.06 + fbm((i % cw) / cw * 8 + step + cycle * 100, Math.floor(i / cw) / ch * 8 + step, 2, 2, 0.5) * 0.01;
        const tx = i % cw, ty = Math.floor(i / cw);
        let bestD = 1e9, bestP = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
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

    // Collision resistance
    for (let p = 0; p < maxPlateId; p++) {
      if (!plateAlive[p]) continue;
      const cells = Math.max(1, plateCells[p]);
      const contRatio = contCollisions[p] / cells;
      const oceRatio = oceCollisions[p] / cells;
      const drag = 1 - Math.min(0.95, contRatio * 8 + oceRatio * 2);
      plateVX[p] *= drag;
      plateVY[p] *= drag;
      // Velocity death threshold
      if (Math.abs(plateVX[p]) < 0.03 && Math.abs(plateVY[p]) < 0.03) {
        plateVX[p] = 0; plateVY[p] = 0;
      }
    }

    // Plate merging: if two plates overlap > 30% of the smaller plate, merge
    for (const [key, count] of overlapCount) {
      const [a, b] = key.split(',').map(Number);
      if (!plateAlive[a] || !plateAlive[b]) continue;
      const smaller = Math.min(plateCells[a], plateCells[b]);
      if (count > smaller * 0.3) {
        // Merge smaller into larger
        const keep = plateCells[a] >= plateCells[b] ? a : b;
        const remove = keep === a ? b : a;
        for (let i = 0; i < N; i++) {
          if (nextOwner[i] === remove) nextOwner[i] = keep;
        }
        plateAlive[remove] = 0;
        plateVX[keep] = (plateVX[keep] * plateCells[keep] + plateVX[remove] * plateCells[remove])
          / (plateCells[keep] + plateCells[remove]);
        plateVY[keep] = (plateVY[keep] * plateCells[keep] + plateVY[remove] * plateCells[remove])
          / (plateCells[keep] + plateCells[remove]);
      }
    }

    // Copy back and recount
    plateCells.fill(0);
    for (let i = 0; i < N; i++) {
      crust[i] = nextCrust[i];
      plateMap[i] = nextOwner[i] >= 0 ? nextOwner[i] : plateMap[i];
      plateCells[plateMap[i]]++;
    }
  }

  // ── Wilson Cycle: re-split into new plates for next cycle ──
  if (cycle < CYCLES - 1) {
    // Generate new plate seeds using Voronoi on the existing terrain
    const newNumPlates = 8 + Math.floor(rng() * 8); // 8-15 new plates
    const newPlates = [];
    for (let i = 0; i < newNumPlates; i++) {
      const cx = rng(), cy = 0.05 + rng() * 0.9;
      const angle = rng() * Math.PI * 2, speed = 0.3 + rng() * 0.7;
      newPlates.push({ cx, cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
    }
    // Re-assign cells to new plates via Voronoi (with warping for organic boundaries)
    const warpSeed2 = rng() * 100;
    for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
      const nx = tx / cw, ny = ty / ch;
      const wx = nx + fbm(nx * 3 + warpSeed2, ny * 3 + warpSeed2, 3, 2, 0.5) * 0.08;
      const wy = ny + fbm(nx * 3 + warpSeed2 + 50, ny * 3 + warpSeed2 + 50, 3, 2, 0.5) * 0.08;
      let bestD = 1e9, bestP = 0;
      for (let p = 0; p < newNumPlates; p++) {
        let dx = wx - newPlates[p].cx;
        if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
        const dy = wy - newPlates[p].cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestP = p; }
      }
      plateMap[ty * cw + tx] = maxPlateId + bestP;
    }
    // Set up new plate velocities
    for (let i = 0; i < newNumPlates; i++) {
      const pid = maxPlateId + i;
      plateVX[pid] = newPlates[i].vx;
      plateVY[pid] = newPlates[i].vy;
      plateAlive[pid] = 1;
    }
    maxPlateId += newNumPlates;
    // Recount cells
    plateCells.fill(0);
    for (let i = 0; i < N; i++) plateCells[plateMap[i]]++;
  }
}

// Smoothing passes to soften grid artifacts
for (let pass = 0; pass < 3; pass++) {
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
}

// Update pixPlate from final coarse plateMap
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  pixPlate[y * W + x] = plateMap[Math.min(ch - 1, Math.floor(y / CG)) * cw + Math.min(cw - 1, Math.floor(x / CG))];
}

// ═══════════════════════════════════════════════════════
// STEP 6: Build pixel-level elevation from simulated crust
// Bicubic interpolation + domain warping for smooth, organic sampling.
// ═══════════════════════════════════════════════════════
const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100, s4 = rng() * 100, s5 = rng() * 100;
const warp = (x, y, freq, oct, str, o1, o2) => [
  x + fbm(x * freq + o1, y * freq + o1, oct, 2, 0.5) * str,
  y + fbm(x * freq + o2, y * freq + o2, oct, 2, 0.5) * str
];

// Bicubic helper: sample crust grid with smooth interpolation
const crustAt = (gx, gy) => {
  const tx = ((Math.floor(gx) % cw) + cw) % cw;
  const ty = Math.max(0, Math.min(ch - 1, Math.floor(gy)));
  return crust[ty * cw + tx];
};
const cubicW = (t) => {
  // Catmull-Rom weights
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

  // Domain-warped sample coordinates — breaks up grid alignment
  const warpStr = 1.5; // warp in coarse grid cells
  const swx = x / CG + fbm(nx * 3 + s1 + 200, ny * 3 + s1 + 200, 3, 2, 0.5) * warpStr;
  const swy = y / CG + fbm(nx * 3 + s1 + 250, ny * 3 + s1 + 250, 3, 2, 0.5) * warpStr;

  // Bicubic interpolation of coarse crust grid
  let e = sampleCrust(swx, swy);

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
// STEP 7: Physics-based wind simulation for moisture
// ═══════════════════════════════════════════════════════
const windResult = simulateWind(elevation, temperature, W, H, { fbm, noise2D }, seed);
for (let i = 0; i < W * H; i++) moisture[i] = windResult.moisture[i];

return { elevation, moisture, temperature, pixPlate };
}
