// ══════════════════════════════════════════════════════════════════
// Particle-based atmospheric wind solver
//
// Instead of iterating a grid-based PGF/Coriolis/friction equation,
// this solver spawns air parcels that move according to forces.
// Particles naturally flow around mountains (can't go through solid
// terrain), conserve mass (particles don't vanish), and create
// realistic coastal flow (pressure pushes them onshore).
//
// The final wind field is produced by accumulating particle velocities
// onto a grid (kernel density estimation).
// ══════════════════════════════════════════════════════════════════

export function solveWindParticle(W, H, elevation, fbm, params = {}, noiseSeed = 42) {
  const p = (k, d) => params[k] !== undefined ? params[k] : d;
  const PI = Math.PI;
  const s3 = noiseSeed;

  // ── Parameters ──
  const _pressureScale   = p("pressureScale", 0.139);
  const _thermalContrast = p("thermalContrast", 0.82);
  const _hadleyStr       = p("hadleyStrength", 0.06);
  const _coriolisStr     = p("coriolisStrength", 0.365);
  const _landDrag        = p("landDrag", 0.06);
  const _oceanDrag       = p("oceanDrag", 0.018);
  const _deflection      = p("deflection", 25.0);
  const _itczOffset      = p("itczOffset", 0.033);
  const _eddyStrength    = p("eddyStrength", 0.006);
  const _landEddyStr     = p("landEddyStrength", 0.002);
  const _windAltitude    = p("windAltitude", 0.02);

  const particleCount    = p("particleCount", 80000);
  const particleSteps    = p("particleSteps", 120);
  const particleDt       = 0.8;

  // ── Coarse grid (4x downscale) ──
  const WG = 4;
  const wW = Math.ceil(W / WG), wH = Math.ceil(H / WG);
  const N = wW * wH;

  // ── Sample elevation onto coarse grid ──
  const wElevRaw = new Float32Array(N); // true elevation (for land mask, drag, temperature)
  const wElev = new Float32Array(N);    // altitude-adjusted (for deflection/blocking only)
  for (let wy = 0; wy < wH; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      let sum = 0, cnt = 0;
      for (let dy = 0; dy < WG; dy++) {
        const py = Math.min(H - 1, wy * WG + dy);
        for (let dx = 0; dx < WG; dx++) {
          const px = Math.min(W - 1, wx * WG + dx);
          sum += Math.max(0, elevation[py * W + px]);
          cnt++;
        }
      }
      const raw = sum / cnt;
      wElevRaw[wy * wW + wx] = raw;
      wElev[wy * wW + wx] = Math.max(0, raw - _windAltitude);
    }
  }

  // ── Land mask and fractions ──
  const landMask = new Float32Array(N);
  for (let i = 0; i < N; i++) landMask[i] = wElevRaw[i] > 0.005 ? 1 : 0;
  const landFrac = smoothField(landMask, wW, wH, 4, 5);

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Temperature field (same as grid solver)
  // ══════════════════════════════════════════════════════════════
  const temperature = new Float32Array(N);
  const seaLevelTemp = new Float32Array(N);
  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2;
    const absLat = Math.abs(latFrac);
    const sinLat = Math.sin(absLat * PI / 2);
    const sin2 = sinLat * sinLat;
    const latTemp = 1.0 - 0.55 * sin2 - 0.45 * sin2 * sin2;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const e = wElevRaw[i]; // use real elevation for temperature
      const lf = landFrac[i];
      let T = latTemp;
      const subtropFactor = Math.exp(-((absLat * 90 - 25) * (absLat * 90 - 25)) / 600);
      T += lf * _thermalContrast * (0.15 * subtropFactor + 0.03);
      T -= e * 0.65;
      const nx = wx / wW, ny = wy / wH;
      T += fbm(nx * 3 + s3 + 500, ny * 3 + s3 + 500, 2, 2, 0.5) * 0.03;
      temperature[i] = T;
      seaLevelTemp[i] = T + e * 0.65;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Pressure field
  // ══════════════════════════════════════════════════════════════
  const pressure = new Float32Array(N);

  const zonalMeanT = new Float32Array(wH);
  for (let wy = 0; wy < wH; wy++) {
    let sum = 0;
    for (let wx = 0; wx < wW; wx++) sum += seaLevelTemp[wy * wW + wx];
    zonalMeanT[wy] = sum / wW;
  }

  const oceanFrac = new Float32Array(N);
  for (let i = 0; i < N; i++) oceanFrac[i] = wElevRaw[i] <= 0.005 ? 1 : 0;
  const oceanFracSmooth = smoothField(oceanFrac, wW, wH, 3, 4);

  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2;
    const latDeg = latFrac * 90;
    const absLat = Math.abs(latFrac);

    const itczLat = 5 + _itczOffset * 90;
    const itcz = -0.5 * Math.exp(-((latDeg - itczLat) * (latDeg - itczLat)) / 250);
    const subtropN = 0.8 * Math.exp(-((latDeg - 30) * (latDeg - 30)) / 200);
    const subtropS = 0.8 * Math.exp(-((latDeg + 30) * (latDeg + 30)) / 200);
    const subpolarN = -0.5 * Math.exp(-((latDeg - 60) * (latDeg - 60)) / 180);
    const subpolarS = -0.5 * Math.exp(-((latDeg + 55) * (latDeg + 55)) / 180);
    const polarN = 0.2 * Math.exp(-((latDeg - 85) * (latDeg - 85)) / 100);
    const polarS = 0.3 * Math.exp(-((latDeg + 85) * (latDeg + 85)) / 100);
    const cellP = (itcz + subtropN + subtropS + subpolarN + subpolarS + polarN + polarS) * _hadleyStr;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const nx = wx / wW, ny = wy / wH;

      const subtropWeight = Math.exp(-((absLat * 90 - 30) * (absLat * 90 - 30)) / 250);
      const oceanHighBoost = oceanFracSmooth[i] * subtropWeight * 0.35 * _hadleyStr;

      const slt = seaLevelTemp[i];
      const thermalAnomaly = -(slt - zonalMeanT[wy]);
      const meridionalP = -slt * _pressureScale;

      const largeNoise = fbm(nx * 3 + s3 + 300, ny * 3 + s3 + 300, 2, 2, 0.5) * 0.08;
      const stormNoise = fbm(nx * 8 + s3 + 700, ny * 8 + s3 + 700, 3, 2, 0.5) * 0.06;
      const stormBelt = Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 400);
      const synopticNoise = (largeNoise + stormNoise * (0.3 + 0.7 * stormBelt)) * _pressureScale;

      pressure[i] = meridionalP + cellP * _pressureScale + thermalAnomaly * _pressureScale
        + oceanHighBoost * _pressureScale + synopticNoise;
    }
  }
  const smoothP = smoothField(pressure, wW, wH, 2, 2);
  for (let i = 0; i < N; i++) pressure[i] = smoothP[i];

  // ── Precompute pressure gradients ──
  const pgfX = new Float32Array(N);
  const pgfY = new Float32Array(N);
  for (let wy = 1; wy < wH - 1; wy++) {
    const cosLat = Math.cos(Math.abs((wy / wH - 0.5) * 2) * PI / 2);
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      pgfX[i] = -(pressure[wy * wW + wr] - pressure[wy * wW + wl]) * 0.5 / Math.max(0.15, cosLat);
      pgfY[i] = -(pressure[(wy + 1) * wW + wx] - pressure[(wy - 1) * wW + wx]) * 0.5;
    }
  }

  // ── Add Hadley meridional forcing to PGF ──
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const absLat = Math.abs(latSigned);
    const hadleyMerid = -Math.sign(latSigned) *
      Math.exp(-((absLat * 90 - 15) * (absLat * 90 - 15)) / 350) * 0.25 * _hadleyStr;
    const ferrelMerid = Math.sign(latSigned) *
      Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 300) * 0.1 * _hadleyStr;
    for (let wx = 0; wx < wW; wx++) {
      pgfY[wy * wW + wx] += (hadleyMerid + ferrelMerid) * _pressureScale;
    }
  }

  // ── Drag field ──
  const drag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    drag[i] = wElevRaw[i] > 0.005 ? _landDrag : _oceanDrag;
  }

  // ── Elevation gradient for terrain deflection ──
  const elevGradX = new Float32Array(N);
  const elevGradY = new Float32Array(N);
  for (let wy = 1; wy < wH - 1; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      elevGradX[i] = (wElev[wy * wW + wr] - wElev[wy * wW + wl]) * 0.5;
      elevGradY[i] = (wElev[(wy + 1) * wW + wx] - wElev[(wy - 1) * wW + wx]) * 0.5;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Particle simulation
  // ══════════════════════════════════════════════════════════════
  // Each particle is an air parcel. Forces: PGF, Coriolis, friction.
  // Terrain deflection: if a particle would enter higher terrain,
  // remove the uphill velocity component (Froude blocking).
  //
  // Accumulate velocities onto a grid to produce the wind field.
  const accX = new Float32Array(N);   // accumulated vx
  const accY = new Float32Array(N);   // accumulated vy
  const accW = new Float32Array(N);   // weight (number of samples)

  // Simple RNG for particle spawning
  let rngState = ((noiseSeed % 2147483647) + 2147483647) % 2147483647 || 1;
  const rng = () => { rngState = (rngState * 16807) % 2147483647; return (rngState - 1) / 2147483646; };

  // Bilinear sampler for coarse grid (wraps X, clamps Y)
  const sample = (field, fx, fy) => {
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const dx = fx - ix, dy = fy - iy;
    const x0 = ((ix % wW) + wW) % wW, x1 = ((ix + 1) % wW + wW) % wW;
    const y0 = Math.max(0, Math.min(wH - 1, iy));
    const y1 = Math.max(0, Math.min(wH - 1, iy + 1));
    return field[y0 * wW + x0] * (1 - dx) * (1 - dy)
      + field[y0 * wW + x1] * dx * (1 - dy)
      + field[y1 * wW + x0] * (1 - dx) * dy
      + field[y1 * wW + x1] * dx * dy;
  };

  for (let pi = 0; pi < particleCount; pi++) {
    // Spawn uniformly, avoiding poles
    let px = rng() * wW;
    let py = 1 + rng() * (wH - 2);
    let vx = 0, vy = 0;

    for (let step = 0; step < particleSteps; step++) {
      const latSigned = (py / wH - 0.5) * 2;
      const f = -Math.sin(latSigned * PI / 2) * _coriolisStr;

      // Sample forces at particle position (bilinear)
      const fx = sample(pgfX, px, py);
      const fy = sample(pgfY, px, py);
      const kf = sample(drag, px, py);
      const elev = sample(wElev, px, py);

      // Apply forces: PGF + Coriolis + friction
      const ax = fx - f * vy - kf * vx;
      const ay = fy + f * vx - kf * vy;

      vx += ax * particleDt;
      vy += ay * particleDt;

      // ── Terrain deflection (Froude blocking) ──
      // If particle is moving uphill, remove the uphill component
      // proportional to elevation * deflection / speed
      if (_deflection > 0 && elev > 0.005) {
        const gx = sample(elevGradX, px, py);
        const gy = sample(elevGradY, px, py);
        const gm = Math.sqrt(gx * gx + gy * gy);
        if (gm > 1e-6) {
          const nx = gx / gm, ny = gy / gm;
          const dot = vx * nx + vy * ny; // velocity into the slope
          if (dot > 0) {
            const speed = Math.sqrt(vx * vx + vy * vy);
            const block = Math.min(1, elev * _deflection * 0.36 / Math.max(0.01, speed));
            // Remove uphill component (energy-conserving: no redirect addition)
            vx -= dot * nx * block;
            vy -= dot * ny * block;
          }
        }
      }

      // ── Prevent particle from entering solid terrain ──
      const newPx = ((px + vx * particleDt) % wW + wW) % wW;
      const newPy = Math.max(1, Math.min(wH - 2, py + vy * particleDt));
      const newElev = sample(wElev, newPx, newPy);
      if (newElev > elev + 0.03 && newElev > 0.05) {
        // Would climb into terrain — kill velocity, particle stalls
        vx *= 0.05;
        vy *= 0.05;
      }

      // Move particle (wrap X, clamp Y)
      px = ((px + vx * particleDt) % wW + wW) % wW;
      py = Math.max(1, Math.min(wH - 2, py + vy * particleDt));

      // ── Accumulate onto grid ──
      // Only accumulate after particle has had time to accelerate (skip first few steps)
      if (step > 5) {
        const ix = Math.floor(px), iy = Math.floor(py);
        const dx = px - ix, dy = py - iy;
        const x0 = ((ix % wW) + wW) % wW, x1 = ((ix + 1) % wW + wW) % wW;
        const y0 = Math.max(0, Math.min(wH - 1, iy));
        const y1 = Math.max(0, Math.min(wH - 1, iy + 1));
        // Bilinear splatting
        const w00 = (1 - dx) * (1 - dy), w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy, w11 = dx * dy;
        accX[y0 * wW + x0] += vx * w00; accY[y0 * wW + x0] += vy * w00; accW[y0 * wW + x0] += w00;
        accX[y0 * wW + x1] += vx * w10; accY[y0 * wW + x1] += vy * w10; accW[y0 * wW + x1] += w10;
        accX[y1 * wW + x0] += vx * w01; accY[y1 * wW + x0] += vy * w01; accW[y1 * wW + x0] += w01;
        accX[y1 * wW + x1] += vx * w11; accY[y1 * wW + x1] += vy * w11; accW[y1 * wW + x1] += w11;
      }
    }
  }

  // ── Average accumulated velocities ──
  const windXCoarse = new Float32Array(N);
  const windYCoarse = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (accW[i] > 0) {
      windXCoarse[i] = accX[i] / accW[i];
      windYCoarse[i] = accY[i] / accW[i];
    }
  }

  // ── Smooth to fill gaps and reduce noise ──
  const smoothWX = smoothField(windXCoarse, wW, wH, 2, 2);
  const smoothWY = smoothField(windYCoarse, wW, wH, 2, 2);

  // ── Fill any remaining empty cells with smoothed neighbors ──
  for (let i = 0; i < N; i++) {
    if (accW[i] < 1) {
      windXCoarse[i] = smoothWX[i];
      windYCoarse[i] = smoothWY[i];
    } else {
      // Blend: mostly particle data, a little smoothing for noise reduction
      windXCoarse[i] = windXCoarse[i] * 0.7 + smoothWX[i] * 0.3;
      windYCoarse[i] = windYCoarse[i] * 0.7 + smoothWY[i] * 0.3;
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Bilinear upscale to full resolution
  // ══════════════════════════════════════════════════════════════
  const fullWindX = new Float32Array(W * H);
  const fullWindY = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x / WG, fy = y / WG;
      const ix = Math.min(wW - 2, fx | 0), iy = Math.min(wH - 2, fy | 0);
      const dx = fx - ix, dy = fy - iy;
      const i00 = iy * wW + ix, i10 = iy * wW + Math.min(wW - 1, ix + 1);
      const i01 = Math.min(wH - 1, iy + 1) * wW + ix;
      const i11 = Math.min(wH - 1, iy + 1) * wW + Math.min(wW - 1, ix + 1);
      const fi = y * W + x;
      fullWindX[fi] = (windXCoarse[i00] * (1 - dx) + windXCoarse[i10] * dx) * (1 - dy)
        + (windXCoarse[i01] * (1 - dx) + windXCoarse[i11] * dx) * dy;
      fullWindY[fi] = (windYCoarse[i00] * (1 - dx) + windYCoarse[i10] * dx) * (1 - dy)
        + (windYCoarse[i01] * (1 - dx) + windYCoarse[i11] * dx) * dy;
    }
  }

  return { windX: fullWindX, windY: fullWindY };
}

// ── Helper: box blur with wrapping X, clamped Y ──
function smoothField(src, w, h, passes, rad) {
  let inp = new Float32Array(src);
  let out = new Float32Array(w * h);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, cnt = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -rad; dx <= rad; dx++) {
            const nx = (x + dx + w) % w;
            sum += inp[ny * w + nx];
            cnt++;
          }
        }
        out[y * w + x] = sum / cnt;
      }
    }
    const tmp = inp; inp = out; out = tmp;
  }
  return inp;
}
