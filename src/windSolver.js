// ══════════════════════════════════════════════════════════════════
// Physically-based atmospheric wind solver
//
// Approach:
//   1. Compute surface temperature field (latitude + altitude + land/sea)
//   2. Derive thermal pressure from temperature via hypsometric equation
//   3. Add Hadley/Ferrel/Polar meridional overturning as direct forcing
//   4. Land-sea thermal contrast → monsoon pressure anomalies
//   5. Geostrophic + Ekman boundary layer solution
//   6. Iterative pressure correction for mass conservation
//   7. Terrain interaction: blocking, gap funneling, lee acceleration
//   8. Sub-grid mesoscale turbulence
// ══════════════════════════════════════════════════════════════════

export function solveWind(W, H, elevation, fbm, params = {}, noiseSeed = 42) {
  const p = (k, d) => params[k] !== undefined ? params[k] : d;
  const s3 = noiseSeed;
  const PI = Math.PI;

  // ── Tunable parameters ──
  const _pressureScale   = p("pressureScale", 4.0);
  const _thermalContrast = p("thermalContrast", 0.6);
  const _hadleyStr       = p("hadleyStrength", 1.0);
  const _coriolisStr     = p("coriolisStrength", 0.25);
  const _oceanDrag       = p("oceanDrag", 0.04);
  const _landDrag        = p("landDrag", 0.35);
  const _terrainDeflect  = p("terrainDeflect", 5.0);
  const _gapFunneling    = p("gapFunneling", 0.5);
  const _eddyStrength    = p("eddyStrength", 0.015);
  const _windScale       = p("windScale", 1.0);
  const _windContrast    = p("windContrast", 1.0);
  const _solverIter      = p("windSolverIter", 40);
  const _itczOffset      = p("itczOffset", 0.03);
  const _monsoonStr      = p("monsoonStrength", 0.5);

  // ── Coarse grid (4x downscale) ──
  const WG = 4;
  const wW = Math.ceil(W / WG), wH = Math.ceil(H / WG);
  const N = wW * wH;

  // ── Sample elevation onto coarse grid ──
  const wElev = new Float32Array(N);
  for (let wy = 0; wy < wH; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const px = Math.min(W - 1, wx * WG), py = Math.min(H - 1, wy * WG);
      wElev[wy * wW + wx] = Math.max(0, elevation[py * W + px]);
    }
  }

  // ── Compute smoothed land fraction for continental thermal effects ──
  const landMask = new Float32Array(N);
  for (let i = 0; i < N; i++) landMask[i] = wElev[i] > 0 ? 1 : 0;

  // Box-blur land fraction (large radius for continental-scale thermal)
  const landFrac = smoothField(landMask, wW, wH, 3, 4);

  // ════════════════════════════════════════════════════════════════
  // STEP 1: Surface temperature field
  // ════════════════════════════════════════════════════════════════
  // Real physics: T decreases with latitude (equator ~300K, poles ~240K)
  // Land heats more than ocean (lower heat capacity)
  // Elevation cools at ~6.5K/km lapse rate (normalized)
  const temperature = new Float32Array(N);
  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2; // -1 (south pole) to +1 (north pole)
    const absLat = Math.abs(latFrac);
    const sinLat = Math.sin(absLat * PI / 2);
    // Meridional temperature: warm equator, cold poles
    // Uses 4th-order polynomial fit to observed zonally-averaged temperature
    const sin2 = sinLat * sinLat;
    const latTemp = 1.0 - 0.55 * sin2 - 0.45 * sin2 * sin2;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const e = wElev[i];
      const lf = landFrac[i];

      // Base temperature from latitude
      let T = latTemp;

      // Land-sea thermal contrast: land is warmer in tropics, more extreme everywhere
      // This creates the thermal lows over continents that drive monsoons
      const tropicalBoost = Math.max(0, 1 - absLat * 2.5); // strongest near equator
      T += lf * _thermalContrast * (0.12 * tropicalBoost + 0.04);

      // Lapse rate: ~6.5K/km, normalized. Elevation of 1.0 ≈ 8000m → ΔT ≈ -0.65
      T -= e * 0.65;

      // Small noise for breaking symmetry
      const nx = wx / wW, ny = wy / wH;
      T += fbm(nx * 3 + s3 + 500, ny * 3 + s3 + 500, 2, 2, 0.5) * 0.03;

      temperature[i] = T;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 2: Pressure field from temperature (hypsometric)
  // ════════════════════════════════════════════════════════════════
  // In the real atmosphere, warm columns have lower surface pressure
  // (thermal low) and cold columns have higher surface pressure.
  // P ∝ -T (simplified hypsometric relation for surface pressure)
  const pressure = new Float32Array(N);

  // First: compute zonal-mean temperature for anomaly calculation
  const zonalMeanT = new Float32Array(wH);
  for (let wy = 0; wy < wH; wy++) {
    let sum = 0;
    for (let wx = 0; wx < wW; wx++) sum += temperature[wy * wW + wx];
    zonalMeanT[wy] = sum / wW;
  }

  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2;
    const absLat = Math.abs(latFrac);
    const latDeg = absLat * 90;

    // ── Hadley/Ferrel/Polar cell pressure signature ──
    // These arise from the meridional overturning circulation:
    // - ITCZ (shifted slightly north): thermal low from deep convection
    // - Subtropical high (~30°): descending branch of Hadley cell
    // - Subpolar low (~60°): polar front convergence
    // - Polar high (~85°): cold dense air
    const itczLat = (5 + _itczOffset * 90); // ITCZ position in degrees
    const isNorth = latFrac > 0 ? 1 : 0;
    const latDegSigned = latFrac * 90;

    // Each cell modeled as proper cosine-bell rather than thin Gaussians
    const itcz = -0.5 * Math.exp(-((latDegSigned - itczLat) * (latDegSigned - itczLat)) / 200);
    const subtropN = 0.7 * Math.exp(-((latDegSigned - 32) * (latDegSigned - 32)) / 180);
    const subtropS = 0.7 * Math.exp(-((latDegSigned + 28) * (latDegSigned + 28)) / 180);
    const subpolarN = -0.45 * Math.exp(-((latDegSigned - 58) * (latDegSigned - 58)) / 160);
    const subpolarS = -0.45 * Math.exp(-((latDegSigned + 62) * (latDegSigned + 62)) / 160);
    const polarN = 0.25 * Math.exp(-((latDegSigned - 85) * (latDegSigned - 85)) / 80);
    const polarS = 0.25 * Math.exp(-((latDegSigned + 85) * (latDegSigned + 85)) / 80);

    const cellPressure = (itcz + subtropN + subtropS + subpolarN + subpolarS + polarN + polarS) * _hadleyStr;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const nx = wx / wW, ny = wy / wH;

      // Thermal pressure: deviation from zonal mean drives monsoons
      const thermalAnomaly = -(temperature[i] - zonalMeanT[wy]) * _monsoonStr;

      // Base meridional pressure gradient
      const meridionalP = -temperature[i] * _pressureScale;

      // Combine: cell structure + thermal anomaly + noise
      const synopticNoise = fbm(nx * 5 + s3 + 300, ny * 5 + s3 + 300, 3, 2, 0.5) * 0.12 * _pressureScale;

      pressure[i] = meridionalP + cellPressure * _pressureScale + thermalAnomaly * _pressureScale + synopticNoise;
    }
  }

  // Smooth pressure to remove grid-scale noise (2 passes)
  const smoothP = smoothField(pressure, wW, wH, 2, 2);
  for (let i = 0; i < N; i++) pressure[i] = smoothP[i];

  // ════════════════════════════════════════════════════════════════
  // STEP 3: Drag field (surface friction)
  // ════════════════════════════════════════════════════════════════
  const drag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (wElev[i] <= 0) {
      drag[i] = _oceanDrag;
    } else {
      // Land: drag decreases with elevation (exposed ridges have less boundary layer friction)
      // But stays above ocean drag
      drag[i] = Math.max(_oceanDrag * 1.5, _landDrag * (1 - wElev[i] * 0.4));
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 4: Terrain analysis for gap detection & gradient field
  // ════════════════════════════════════════════════════════════════
  // Pre-compute elevation gradients and local terrain variance
  // for gap funneling and terrain deflection
  const gradX = new Float32Array(N);
  const gradY = new Float32Array(N);
  const terrainVar = new Float32Array(N); // local elevation variance → gap detection
  for (let wy = 1; wy < wH - 1; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      gradX[i] = (wElev[wy * wW + wr] - wElev[wy * wW + wl]) * 0.5;
      gradY[i] = (wElev[(wy + 1) * wW + wx] - wElev[(wy - 1) * wW + wx]) * 0.5;

      // Terrain variance in 3x3 neighborhood (for gap/valley detection)
      let eSum = 0, e2Sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny2 = wy + dy;
        if (ny2 < 0 || ny2 >= wH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx2 = (wx + dx + wW) % wW;
          const ev = wElev[ny2 * wW + nx2];
          eSum += ev; e2Sum += ev * ev; cnt++;
        }
      }
      const mean = eSum / cnt;
      terrainVar[i] = e2Sum / cnt - mean * mean; // variance
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 5: Wind solver — Ekman balance + iterative correction
  // ════════════════════════════════════════════════════════════════
  // Ekman balance: f×k̂×v = -(1/ρ)∇p - κv  (geostrophic + friction)
  // Solved analytically for each cell, then iteratively corrected.
  const windX = new Float32Array(N);
  const windY = new Float32Array(N);

  // ── Initialize with Ekman solution ──
  // Analytical Ekman balance: given ∇p and f, solve for (u,v)
  // The Ekman equations are:
  //   -f*v = -dp/dx - κ*u
  //    f*u = -dp/dy - κ*v
  // Solution: u = (-κ*px - f*py) / (f² + κ²)
  //           v = ( f*px - κ*py) / (f² + κ²)
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const f = -Math.sin(latSigned * PI / 2) * _coriolisStr;
    const cosLat = Math.cos(Math.abs(latSigned) * PI / 2);

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;

      // Pressure gradients (cos(lat) correction on zonal)
      const dpdx = (pressure[wy * wW + wr] - pressure[wy * wW + wl]) * 0.5 * cosLat;
      const dpdy = (pressure[(wy + 1) * wW + wx] - pressure[(wy - 1) * wW + wx]) * 0.5;

      const kf = drag[i];
      const denom = f * f + kf * kf;
      if (denom > 1e-8) {
        // Ekman analytical solution
        windX[i] = (-kf * dpdx - f * dpdy) / denom;
        windY[i] = (f * dpdx - kf * dpdy) / denom;
      } else {
        // Near equator: pressure-driven flow with friction
        windX[i] = -dpdx / Math.max(kf, 0.01);
        windY[i] = -dpdy / Math.max(kf, 0.01);
      }
    }
  }

  // ── Add Hadley cell meridional overturning (direct mass flux) ──
  // The Hadley cell has a strong equatorward surface flow component
  // that the pressure gradient alone doesn't fully capture.
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const latDeg = latSigned * 90;
    const absLat = Math.abs(latSigned);

    // Hadley cell: equatorward flow 0-30°, strongest at ~15°
    const hadleyMeridional = -Math.sign(latSigned) * Math.sin(absLat * PI * 3) *
      Math.exp(-((absLat * 90 - 15) * (absLat * 90 - 15)) / 400) * 0.3 * _hadleyStr;

    // Ferrel cell: poleward flow 30-60°, weaker
    const ferrelMeridional = Math.sign(latSigned) *
      Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 250) * 0.12 * _hadleyStr;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      windY[i] += (hadleyMeridional + ferrelMeridional) * _pressureScale;
    }
  }

  // ── Iterative refinement: momentum equation with diffusion ──
  const dt = 0.4;
  const visc = 0.05;

  for (let iter = 0; iter < _solverIter; iter++) {
    const tmpX = new Float32Array(windX);
    const tmpY = new Float32Array(windY);

    for (let wy = 1; wy < wH - 1; wy++) {
      const latSigned = (wy / wH - 0.5) * 2;
      const f = -Math.sin(latSigned * PI / 2) * _coriolisStr;
      const cosLat = Math.cos(Math.abs(latSigned) * PI / 2);

      for (let wx = 0; wx < wW; wx++) {
        const i = wy * wW + wx;
        const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
        const nl = wy * wW + wl, nr = wy * wW + wr;
        const nu = (wy - 1) * wW + wx, nd = (wy + 1) * wW + wx;

        // Pressure gradient force
        const pgfX = -(pressure[nr] - pressure[nl]) * 0.5 * cosLat;
        const pgfY = -(pressure[nd] - pressure[nu]) * 0.5;

        // Coriolis
        const corX = -f * tmpY[i];
        const corY = f * tmpX[i];

        // Friction
        const kf = drag[i];
        const drgX = -kf * tmpX[i];
        const drgY = -kf * tmpY[i];

        // Laplacian diffusion (viscosity)
        const lapX = (tmpX[nl] + tmpX[nr] + tmpX[nu] + tmpX[nd]) * 0.25 - tmpX[i];
        const lapY = (tmpY[nl] + tmpY[nr] + tmpY[nu] + tmpY[nd]) * 0.25 - tmpY[i];

        // Semi-implicit update
        let vx = tmpX[i] + dt * (pgfX + corX + drgX) + visc * lapX;
        let vy = tmpY[i] + dt * (pgfY + corY + drgY) + visc * lapY;

        // ── Terrain interaction ──
        const eC = wElev[i];
        if (eC > 0.01) {
          const speed = Math.sqrt(vx * vx + vy * vy);
          if (speed > 1e-6) {
            // Froude number: Fr = U / (N*h), where N*h is parameterized
            const Fr = speed / Math.max(0.001, eC * _terrainDeflect);
            const blockFrac = Math.max(0, Math.min(0.95, 1 - Fr));

            if (blockFrac > 0.01) {
              const gx = gradX[i], gy = gradY[i];
              const gm2 = gx * gx + gy * gy;

              if (gm2 > 1e-8) {
                const gm = Math.sqrt(gm2);
                const dot = vx * gx + vy * gy;
                if (dot > 0) {
                  // Remove component flowing into terrain
                  const rmX = blockFrac * dot * gx / gm2;
                  const rmY = blockFrac * dot * gy / gm2;
                  vx -= rmX; vy -= rmY;

                  // Redirect to perpendicular (flow around)
                  const perpX = -gy / gm, perpY = gx / gm;
                  const tang = vx * perpX + vy * perpY;
                  const redir = Math.sqrt(rmX * rmX + rmY * rmY) * 0.65;
                  const sign = tang >= 0 ? 1 : -1;
                  vx += sign * perpX * redir;
                  vy += sign * perpY * redir;
                }
              } else {
                // Flat-top mountain: just reduce speed
                vx *= (1 - blockFrac * 0.5);
                vy *= (1 - blockFrac * 0.5);
              }
            }

            // ── Gap funneling / Venturi effect ──
            // Where terrain variance is high but local elevation is low
            // (a valley between mountains), accelerate wind
            if (terrainVar[i] > 0.002 && eC < 0.15) {
              const funnelFactor = 1 + Math.min(0.8, terrainVar[i] * 40) * _gapFunneling;
              vx *= funnelFactor;
              vy *= funnelFactor;
            }

            // ── Lee-side acceleration ──
            // Downwind of mountains, air descends and accelerates (foehn/chinook)
            if (eC > 0.02 && eC < 0.2) {
              const gx2 = gradX[i], gy2 = gradY[i];
              const downslope = -(vx * gx2 + vy * gy2); // positive = descending
              if (downslope > 0.001) {
                const leeBoost = Math.min(0.3, downslope * 3);
                const spd = Math.sqrt(vx * vx + vy * vy);
                if (spd > 1e-6) {
                  vx *= (1 + leeBoost);
                  vy *= (1 + leeBoost);
                }
              }
            }
          }
        }

        windX[i] = vx;
        windY[i] = vy;
      }
    }

    // ── Mass conservation: divergence damping ──
    // Compute divergence and apply pressure correction to reduce it.
    // This ensures wind funnels through gaps rather than piling up.
    if (iter % 4 === 3) {
      const div = new Float32Array(N);
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          const wr = (wx + 1) % wW, wl = (wx - 1 + wW) % wW;
          div[i] = (windX[wy * wW + wr] - windX[wy * wW + wl]) * 0.5
                 + (windY[(wy + 1) * wW + wx] - windY[(wy - 1) * wW + wx]) * 0.5;
        }
      }
      // Apply divergence damping (pseudo-pressure correction)
      const dampStr = 0.15;
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          const wr = (wx + 1) % wW, wl = (wx - 1 + wW) % wW;
          windX[i] -= dampStr * (div[wy * wW + wr] - div[wy * wW + wl]) * 0.5;
          windY[i] -= dampStr * (div[(wy + 1) * wW + wx] - div[(wy - 1) * wW + wx]) * 0.5;
        }
      }
    }
  } // end iterations

  // ════════════════════════════════════════════════════════════════
  // STEP 6: Sub-grid mesoscale turbulence (curl noise)
  // ════════════════════════════════════════════════════════════════
  const _eddyOcean = _eddyStrength;
  const _eddyLand = _eddyStrength * 0.4;
  for (let wy = 1; wy < wH - 1; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const nx = wx / wW, ny = wy / wH;
      const eps = 0.003;
      const n0  = fbm(nx * 6 + s3 + 100, ny * 6 + s3 + 100, 3, 2, 0.5);
      const nDx = fbm((nx + eps) * 6 + s3 + 100, ny * 6 + s3 + 100, 3, 2, 0.5);
      const nDy = fbm(nx * 6 + s3 + 100, (ny + eps) * 6 + s3 + 100, 3, 2, 0.5);
      const amp = wElev[i] > 0 ? _eddyLand : _eddyOcean;
      windX[i] += (nDy - n0) / eps * amp;
      windY[i] -= (nDx - n0) / eps * amp;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 7: Post-processing (contrast + scale)
  // ════════════════════════════════════════════════════════════════
  if (_windScale !== 1.0 || _windContrast !== 1.0) {
    for (let i = 0; i < N; i++) {
      let vx = windX[i], vy = windY[i];
      if (_windContrast !== 1.0) {
        const mag = Math.sqrt(vx * vx + vy * vy);
        if (mag > 1e-6) {
          const s = Math.pow(mag, _windContrast) / mag;
          vx *= s; vy *= s;
        }
      }
      windX[i] = vx * _windScale;
      windY[i] = vy * _windScale;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 8: Bilinear upscale to full resolution
  // ════════════════════════════════════════════════════════════════
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
      fullWindX[fi] = (windX[i00] * (1 - dx) + windX[i10] * dx) * (1 - dy)
        + (windX[i01] * (1 - dx) + windX[i11] * dx) * dy;
      fullWindY[fi] = (windY[i00] * (1 - dx) + windY[i10] * dx) * (1 - dy)
        + (windY[i01] * (1 - dx) + windY[i11] * dx) * dy;
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
