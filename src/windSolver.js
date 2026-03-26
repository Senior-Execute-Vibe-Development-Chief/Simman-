// ══════════════════════════════════════════════════════════════════
// Physically-based atmospheric wind solver v3
//
// Key improvements over v2:
//   - Subtropical anticyclonic gyres over each ocean basin
//   - Much less land drag (land is NOT a dead zone)
//   - Terrain blocking only for actual mountains, not all land
//   - Synoptic-scale variability (baroclinic waves at mid-latitudes)
//   - Stronger longitudinal pressure variation from continent geometry
//   - No artificial speed-up artifacts at coastlines
//   - Continental thermal lows that pull wind onshore (monsoons)
// ══════════════════════════════════════════════════════════════════

export function solveWind(W, H, elevation, fbm, params = {}, noiseSeed = 42) {
  const p = (k, d) => params[k] !== undefined ? params[k] : d;
  const s3 = noiseSeed;
  const PI = Math.PI;

  // ── Tunable parameters ──
  const _pressureScale   = p("pressureScale", 1.0);
  const _thermalContrast = p("thermalContrast", 1.275);
  const _hadleyStr       = p("hadleyStrength", 0.12);
  const _coriolisStr     = p("coriolisStrength", 0.32);
  const _oceanDrag       = p("oceanDrag", 0.04);
  const _landDrag        = p("landDrag", 1.901);
  const _terrainDeflect  = p("terrainDeflect", 20.0);
  const _gapFunneling    = p("gapFunneling", 0.645);
  const _eddyStrength    = p("eddyStrength", 0.019);
  const _windScale       = p("windScale", 0.295);
  const _windContrast    = p("windContrast", 0.825);
  const _solverIter      = p("windSolverIter", 250);
  const _coandaRedirect  = p("coandaRedirect", 0.7);
  const _coandaPull      = p("coandaPull", 0.003);
  const _itczOffset      = p("itczOffset", 0.033);
  const _monsoonStr      = p("monsoonStrength", 0.0);

  // ── Coarse grid (4x downscale) ──
  const WG = 4;
  const wW = Math.ceil(W / WG), wH = Math.ceil(H / WG);
  const N = wW * wH;

  // ── Sample elevation onto coarse grid (average, not point-sample) ──
  const wElev = new Float32Array(N);
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
      wElev[wy * wW + wx] = sum / cnt;
    }
  }

  // ── Land mask and smoothed land fraction ──
  const landMask = new Float32Array(N);
  for (let i = 0; i < N; i++) landMask[i] = wElev[i] > 0.005 ? 1 : 0;

  // Continental-scale land fraction (large blur for thermal effects)
  const landFrac = smoothField(landMask, wW, wH, 4, 5);
  // Medium-scale land fraction (for coastal pressure gradients)
  const landFracMed = smoothField(landMask, wW, wH, 2, 3);

  // ════════════════════════════════════════════════════════════════
  // STEP 1: Surface temperature field
  // ════════════════════════════════════════════════════════════════
  const temperature = new Float32Array(N);
  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2; // -1 to +1
    const absLat = Math.abs(latFrac);
    const sinLat = Math.sin(absLat * PI / 2);
    const sin2 = sinLat * sinLat;
    const latTemp = 1.0 - 0.55 * sin2 - 0.45 * sin2 * sin2;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const e = wElev[i];
      const lf = landFrac[i];

      let T = latTemp;

      // Land-sea thermal contrast: strongest in subtropics/tropics
      // Creates continental thermal lows (Saharan heat low, Asian heat low)
      const subtropFactor = Math.exp(-((absLat * 90 - 25) * (absLat * 90 - 25)) / 600);
      T += lf * _thermalContrast * (0.15 * subtropFactor + 0.03);

      // Lapse rate cooling
      T -= e * 0.65;

      // Noise for symmetry breaking
      const nx = wx / wW, ny = wy / wH;
      T += fbm(nx * 3 + s3 + 500, ny * 3 + s3 + 500, 2, 2, 0.5) * 0.03;

      temperature[i] = T;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 2: Pressure field
  // ════════════════════════════════════════════════════════════════
  // Three components:
  //   A) Zonal-mean cell structure (Hadley/Ferrel/Polar)
  //   B) Continental thermal anomalies (monsoon + subtropical highs over ocean)
  //   C) Synoptic-scale baroclinic waves (mid-latitude storms)
  const pressure = new Float32Array(N);

  // Zonal mean temperature for anomaly computation
  const zonalMeanT = new Float32Array(wH);
  for (let wy = 0; wy < wH; wy++) {
    let sum = 0;
    for (let wx = 0; wx < wW; wx++) sum += temperature[wy * wW + wx];
    zonalMeanT[wy] = sum / wW;
  }

  // Ocean basin detection: find connected ocean regions for gyre placement
  // Simplified: use longitude sectors weighted by ocean fraction
  const oceanFrac = new Float32Array(N);
  for (let i = 0; i < N; i++) oceanFrac[i] = wElev[i] <= 0.005 ? 1 : 0;
  const oceanFracSmooth = smoothField(oceanFrac, wW, wH, 3, 4);

  for (let wy = 0; wy < wH; wy++) {
    const latFrac = (wy / wH - 0.5) * 2;
    const latDegSigned = latFrac * 90;
    const absLat = Math.abs(latFrac);

    // ── A) Hadley/Ferrel/Polar cell pressure belts ──
    const itczLat = 5 + _itczOffset * 90;

    // Wider Gaussians for more realistic belt widths
    const itcz = -0.5 * Math.exp(-((latDegSigned - itczLat) * (latDegSigned - itczLat)) / 250);

    // Subtropical highs: these are the KEY feature for anticyclonic gyres
    // They should be strong and broad
    const subtropN = 0.8 * Math.exp(-((latDegSigned - 30) * (latDegSigned - 30)) / 200);
    const subtropS = 0.8 * Math.exp(-((latDegSigned + 30) * (latDegSigned + 30)) / 200);

    // Subpolar lows (Icelandic Low, Aleutian Low)
    const subpolarN = -0.5 * Math.exp(-((latDegSigned - 60) * (latDegSigned - 60)) / 180);
    const subpolarS = -0.5 * Math.exp(-((latDegSigned + 55) * (latDegSigned + 55)) / 180);

    // Polar highs
    const polarN = 0.2 * Math.exp(-((latDegSigned - 85) * (latDegSigned - 85)) / 100);
    const polarS = 0.3 * Math.exp(-((latDegSigned + 85) * (latDegSigned + 85)) / 100);

    const cellP = (itcz + subtropN + subtropS + subpolarN + subpolarS + polarN + polarS) * _hadleyStr;

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const nx = wx / wW, ny = wy / wH;

      // ── B) Subtropical high intensification over oceans ──
      // In reality, subtropical highs are strongest over the EASTERN sides
      // of ocean basins (cold upwelling reinforces subsidence)
      // Ocean areas at subtropical latitudes get extra high pressure
      const subtropWeight = Math.exp(-((absLat * 90 - 30) * (absLat * 90 - 30)) / 250);
      const oceanHighBoost = oceanFracSmooth[i] * subtropWeight * 0.35 * _hadleyStr;

      // ── C) Continental thermal anomaly ──
      // Warm continents → low pressure (thermal low, draws air onshore)
      // This is the monsoon driver
      const thermalAnomaly = -(temperature[i] - zonalMeanT[wy]) * _monsoonStr;

      // Base meridional pressure
      const meridionalP = -temperature[i] * _pressureScale;

      // ── D) Synoptic noise: larger scale for realistic weather patterns ──
      // Two scales: large (basin-scale highs/lows) and medium (storm-scale)
      const largeNoise = fbm(nx * 3 + s3 + 300, ny * 3 + s3 + 300, 2, 2, 0.5) * 0.08;
      const stormNoise = fbm(nx * 8 + s3 + 700, ny * 8 + s3 + 700, 3, 2, 0.5) * 0.06;
      // Storm noise stronger at mid-latitudes (baroclinic instability zone)
      const stormBelt = Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 400);
      const synopticNoise = (largeNoise + stormNoise * (0.3 + 0.7 * stormBelt)) * _pressureScale;

      pressure[i] = meridionalP + cellP * _pressureScale + thermalAnomaly * _pressureScale
        + oceanHighBoost * _pressureScale + synopticNoise;
    }
  }

  // Smooth pressure (gentle, preserve structure)
  const smoothP = smoothField(pressure, wW, wH, 2, 2);
  for (let i = 0; i < N; i++) pressure[i] = smoothP[i];

  // ════════════════════════════════════════════════════════════════
  // STEP 3: Drag field (surface friction)
  // ════════════════════════════════════════════════════════════════
  const drag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const e = wElev[i];
    if (e <= 0.005) {
      drag[i] = _oceanDrag;
    } else {
      // Land drag + extra friction scaled by elevation for mountains
      drag[i] = _landDrag + _landDrag * Math.min(1, e * 2) * 0.5;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 4: Terrain gradients (for Froude blocking)
  // ════════════════════════════════════════════════════════════════
  const gradX = new Float32Array(N);
  const gradY = new Float32Array(N);
  for (let wy = 1; wy < wH - 1; wy++) {
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      gradX[i] = (wElev[wy * wW + wr] - wElev[wy * wW + wl]) * 0.5;
      gradY[i] = (wElev[(wy + 1) * wW + wx] - wElev[(wy - 1) * wW + wx]) * 0.5;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 5: Wind solver
  // ════════════════════════════════════════════════════════════════
  const windX = new Float32Array(N);
  const windY = new Float32Array(N);

  // ── Initialize with Ekman analytical solution ──
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const f = -Math.sin(latSigned * PI / 2) * _coriolisStr;
    const cosLat = Math.cos(Math.abs(latSigned) * PI / 2);

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;

      const dpdx = (pressure[wy * wW + wr] - pressure[wy * wW + wl]) * 0.5 * cosLat;
      const dpdy = (pressure[(wy + 1) * wW + wx] - pressure[(wy - 1) * wW + wx]) * 0.5;

      const kf = drag[i];
      const denom = f * f + kf * kf;
      if (denom > 1e-8) {
        windX[i] = (-kf * dpdx - f * dpdy) / denom;
        windY[i] = (f * dpdx - kf * dpdy) / denom;
      } else {
        windX[i] = -dpdx / Math.max(kf, 0.02);
        windY[i] = -dpdy / Math.max(kf, 0.02);
      }
    }
  }

  // ── Hadley cell meridional overturning ──
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const absLat = Math.abs(latSigned);

    // Hadley: equatorward near surface, 0-30°
    const hadleyMerid = -Math.sign(latSigned) *
      Math.exp(-((absLat * 90 - 15) * (absLat * 90 - 15)) / 350) * 0.25 * _hadleyStr;

    // Ferrel: poleward, 30-60° (weaker)
    const ferrelMerid = Math.sign(latSigned) *
      Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 300) * 0.1 * _hadleyStr;

    for (let wx = 0; wx < wW; wx++) {
      windY[wy * wW + wx] += (hadleyMerid + ferrelMerid) * _pressureScale;
    }
  }

  // ── Iterative refinement ──
  const dt = 0.35;
  const visc = 0.06;

  // Pre-compute terrain normals (normalized elevation gradient = surface normal)
  const normX = new Float32Array(N);
  const normY = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const gm = Math.sqrt(gradX[i] * gradX[i] + gradY[i] * gradY[i]);
    if (gm > 1e-6) { normX[i] = gradX[i] / gm; normY[i] = gradY[i] / gm; }
  }

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

        // Diffusion
        const lapX = (tmpX[nl] + tmpX[nr] + tmpX[nu] + tmpX[nd]) * 0.25 - tmpX[i];
        const lapY = (tmpY[nl] + tmpY[nr] + tmpY[nu] + tmpY[nd]) * 0.25 - tmpY[i];

        let vx = tmpX[i] + dt * (pgfX + corX + drgX) + visc * lapX;
        let vy = tmpY[i] + dt * (pgfY + corY + drgY) + visc * lapY;

        // ── Terrain deflection + Coanda wrapping ──
        // 1. Deflection: wind hitting terrain gets its into-terrain component
        //    removed proportional to (elevation × strength / speed).
        //    Head-on = strong deflection, glancing = weak, fast = resists.
        // 2. Coanda: blocked energy redirects ALONG the terrain contour
        //    (perpendicular to normal), wrapping around points and capes.
        // 3. Near-terrain attraction: wind flowing past terrain gets pulled
        //    slightly to follow the surface.
        const eC = wElev[i];
        if (_terrainDeflect > 0 && eC > 0.01) {
          const tnx = normX[i], tny = normY[i];
          if (tnx !== 0 || tny !== 0) {
            const dot = vx * tnx + vy * tny;
            const speed = Math.sqrt(vx * vx + vy * vy);

            if (dot > 0) {
              // Wind flowing INTO terrain — deflect and redirect
              const deflect = Math.min(1, eC * _terrainDeflect * 0.1 / Math.max(0.01, speed));
              const removedX = dot * tnx * deflect;
              const removedY = dot * tny * deflect;
              vx -= removedX;
              vy -= removedY;

              // Coanda: redirect blocked energy along terrain contour
              // Tangent = perpendicular to normal (the "along the wall" direction)
              const tangX = -tny, tangY = tnx;
              // Which direction along the wall? Follow existing tangential flow
              const tangDot = vx * tangX + vy * tangY;
              const sign = tangDot >= 0 ? 1 : -1;
              const redirected = Math.sqrt(removedX * removedX + removedY * removedY);
              vx += sign * tangX * redirected * _coandaRedirect;
              vy += sign * tangY * redirected * _coandaRedirect;
            } else {
              // Wind flowing PAST terrain (not into it) — Coanda attraction
              // Pull slightly toward following the terrain contour
              // Stronger when closer to terrain (higher elevation = more surface contact)
              const tangX = -tny, tangY = tnx;
              const tangDot = vx * tangX + vy * tangY;
              const coandaPull = eC * _terrainDeflect * _coandaPull;
              // Add a slight nudge in the tangential direction wind is already going
              if (Math.abs(tangDot) > 1e-6) {
                const pullSign = tangDot >= 0 ? 1 : -1;
                vx += pullSign * tangX * coandaPull;
                vy += pullSign * tangY * coandaPull;
              }
            }
          }
        }

        windX[i] = vx;
        windY[i] = vy;
      }
    }

    // Divergence damping every 3rd iteration
    if (iter % 3 === 2) {
      const div = new Float32Array(N);
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          const wr = (wx + 1) % wW, wl = (wx - 1 + wW) % wW;
          div[i] = (windX[wy * wW + wr] - windX[wy * wW + wl]) * 0.5
                 + (windY[(wy + 1) * wW + wx] - windY[(wy - 1) * wW + wx]) * 0.5;
        }
      }
      const dampStr = 0.12;
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          const wr = (wx + 1) % wW, wl = (wx - 1 + wW) % wW;
          windX[i] -= dampStr * (div[wy * wW + wr] - div[wy * wW + wl]) * 0.5;
          windY[i] -= dampStr * (div[(wy + 1) * wW + wx] - div[(wy - 1) * wW + wx]) * 0.5;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 5: Gap funneling (post-solve so it persists)
  // ════════════════════════════════════════════════════════════════
  // Wind accelerates through valleys/gaps between high terrain (Venturi)
  if (_gapFunneling > 0) {
    for (let wy = 1; wy < wH - 1; wy++) {
      for (let wx = 0; wx < wW; wx++) {
        const i = wy * wW + wx;
        const eC = wElev[i];
        if (eC < 0.15 && eC > 0.001) {
          const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
          const eL = wElev[wy * wW + wl], eR = wElev[wy * wW + wr];
          const eU = wElev[(wy - 1) * wW + wx], eD = wElev[(wy + 1) * wW + wx];
          const maxN = Math.max(eL, eR, eU, eD);
          if (maxN > eC + 0.08) {
            const factor = 1 + Math.min(0.8, (maxN - eC) * 3) * _gapFunneling;
            windX[i] *= factor;
            windY[i] *= factor;
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 6: Mesoscale turbulence (multi-scale curl noise)
  // ════════════════════════════════════════════════════════════════
  // Two scales: large eddies (synoptic whorls) + small eddies (turbulence)
  for (let wy = 1; wy < wH - 1; wy++) {
    const absLat = Math.abs((wy / wH - 0.5) * 2);
    // Eddy activity stronger at mid-latitudes (baroclinic zone)
    const latFactor = 0.5 + 0.5 * Math.exp(-((absLat * 90 - 45) * (absLat * 90 - 45)) / 500);

    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const nx = wx / wW, ny = wy / wH;
      const isOcean = wElev[i] <= 0.005;
      const baseAmp = isOcean ? _eddyStrength : _eddyStrength * 0.5;
      const amp = baseAmp * latFactor;

      // Large-scale eddies (synoptic-ish, ~1000km)
      const eps = 0.003;
      const n0L = fbm(nx * 4 + s3 + 100, ny * 4 + s3 + 100, 2, 2, 0.5);
      const nDxL = fbm((nx + eps) * 4 + s3 + 100, ny * 4 + s3 + 100, 2, 2, 0.5);
      const nDyL = fbm(nx * 4 + s3 + 100, (ny + eps) * 4 + s3 + 100, 2, 2, 0.5);
      windX[i] += (nDyL - n0L) / eps * amp * 1.5;
      windY[i] -= (nDxL - n0L) / eps * amp * 1.5;

      // Small-scale eddies (mesoscale)
      const n0S = fbm(nx * 10 + s3 + 200, ny * 10 + s3 + 200, 2, 2, 0.5);
      const nDxS = fbm((nx + eps) * 10 + s3 + 200, ny * 10 + s3 + 200, 2, 2, 0.5);
      const nDyS = fbm(nx * 10 + s3 + 200, (ny + eps) * 10 + s3 + 200, 2, 2, 0.5);
      windX[i] += (nDyS - n0S) / eps * amp * 0.5;
      windY[i] -= (nDxS - n0S) / eps * amp * 0.5;
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 7: Post-processing
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
