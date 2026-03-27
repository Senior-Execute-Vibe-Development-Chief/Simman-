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
  const _pressureScale   = p("pressureScale", 0.139);
  const _thermalContrast = p("thermalContrast", 0.82);
  const _hadleyStr       = p("hadleyStrength", 0.06);
  const _coriolisStr     = p("coriolisStrength", 0.365);
  const _oceanDrag       = p("oceanDrag", 0.018);
  const _landDrag        = p("landDrag", 0.568);
  const _terrainDeflect  = p("terrainDeflect", 25.0);
  const _gapFunneling    = p("gapFunneling", 0.66);
  const _eddyStrength    = p("eddyStrength", 0.006);
  const _solverIter      = p("windSolverIter", 500);
  const _coandaStr       = p("coandaStrength", 3.0);
  const _gustThreshold   = p("gustThreshold", 0.055);
  const _gustBoost       = p("gustBoost", 3.6);
  const _curlBoost       = p("curlBoost", 2.4);
  const _itczOffset      = p("itczOffset", 0.033);

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
      // Thermal anomaly: deviation from zonal mean drives monsoon-like flows
      // This emerges naturally from thermalContrast — warm continents create
      // low pressure that draws in ocean air. No separate multiplier needed.
      const thermalAnomaly = -(temperature[i] - zonalMeanT[wy]);

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
      // High terrain gets very high drag to prevent PGF pushing wind through
      const mtnFactor = Math.min(1, e * 3);
      drag[i] = _landDrag + _landDrag * mtnFactor * 3.0;
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

        windX[i] = tmpX[i] + dt * (pgfX + corX + drgX) + visc * lapX;
        windY[i] = tmpY[i] + dt * (pgfY + corY + drgY) + visc * lapY;
      }
    }

    // ── Mountain wall: high terrain kills wind every iteration ──
    // Mountains are impenetrable walls. Instead of partial blocking,
    // simply scale wind down by (1 - solidity) each iteration.
    // PGF and diffusion can't rebuild wind through a cell that gets
    // zeroed every step. Low terrain keeps partial wind (land breeze).
    for (let wy = 1; wy < wH - 1; wy++) {
      for (let wx = 0; wx < wW; wx++) {
        const i = wy * wW + wx;
        const e = wElev[i];
        if (e < 0.005) continue;
        // solidity: 0 for low coast, 1 for mountains
        const solidity = Math.min(1, e * _terrainDeflect * 0.15);
        windX[i] *= (1 - solidity);
        windY[i] *= (1 - solidity);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 5: Downstream momentum transport
  // ════════════════════════════════════════════════════════════════
  // Wind carries its own momentum. A slow parcel leaving land doesn't
  // instantly speed up on ocean — it has to gradually accelerate.
  // Trace each cell backward along the wind and blend with upstream velocity.
  // Multiple passes propagate the effect further downstream.
  {
    const transportPasses = 8;
    const advDt = 0.6;
    const blendStr = 0.4; // 40% upstream influence
    for (let pass = 0; pass < transportPasses; pass++) {
      const prevX = new Float32Array(windX);
      const prevY = new Float32Array(windY);
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          // Trace backward: where did this air come from?
          const backX = wx - prevX[i] * advDt;
          const backY = wy - prevY[i] * advDt;
          const sx = ((backX % wW) + wW) % wW;
          const sy = Math.max(1, Math.min(wH - 2, backY));
          const ix = Math.floor(sx), iy = Math.floor(sy);
          const fx = sx - ix, fy = sy - iy;
          const ix1 = (ix + 1) % wW, iy1 = Math.min(wH - 2, iy + 1);
          const i00 = iy * wW + ix, i10 = iy * wW + ix1;
          const i01 = iy1 * wW + ix, i11 = iy1 * wW + ix1;
          // Bilinear interpolation of upstream velocity
          const upX = prevX[i00] * (1-fx)*(1-fy) + prevX[i10] * fx*(1-fy)
                    + prevX[i01] * (1-fx)*fy + prevX[i11] * fx*fy;
          const upY = prevY[i00] * (1-fx)*(1-fy) + prevY[i10] * fx*(1-fy)
                    + prevY[i01] * (1-fx)*fy + prevY[i11] * fx*fy;
          // Blend: current cell keeps (1-blend), upstream contributes blend
          windX[i] = prevX[i] * (1 - blendStr) + upX * blendStr;
          windY[i] = prevY[i] * (1 - blendStr) + upY * blendStr;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 6: Gap funneling (post-solve so it persists)
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
  // STEP 8: Gust boost — wind above threshold gets amplified
  // ════════════════════════════════════════════════════════════════
  // gustThreshold: speed above which wind gets boosted (in raw units)
  // gustBoost: fractional boost applied to the excess speed
  // e.g. threshold=0.15, boost=0.3: wind at 0.25 → excess=0.10 → 0.25 + 0.10*0.3 = 0.28
  if (_gustBoost > 0 && _gustThreshold > 0) {
    for (let i = 0; i < N; i++) {
      const vx = windX[i], vy = windY[i];
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > _gustThreshold) {
        const excess = speed - _gustThreshold;
        const factor = (speed + excess * _gustBoost) / speed;
        windX[i] *= factor;
        windY[i] *= factor;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 9: Curl boost — swirly areas get faster
  // ════════════════════════════════════════════════════════════════
  // Compute vorticity (curl = ∂v/∂x - ∂u/∂y). High curl = rotation.
  // Boost wind speed where curl is strong — this is why cyclones have
  // fast winds around their centers (tight rotation = fast flow).
  if (_curlBoost > 0) {
    const curl = new Float32Array(N);
    for (let wy = 1; wy < wH - 1; wy++) {
      for (let wx = 0; wx < wW; wx++) {
        const i = wy * wW + wx;
        const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
        // curl = dv/dx - du/dy
        const dvdx = (windY[wy * wW + wr] - windY[wy * wW + wl]) * 0.5;
        const dudy = (windX[(wy + 1) * wW + wx] - windX[(wy - 1) * wW + wx]) * 0.5;
        curl[i] = Math.abs(dvdx - dudy);
      }
    }
    // Smooth curl to avoid single-cell spikes
    const smoothCurl = smoothField(curl, wW, wH, 1, 2);
    for (let wy = 1; wy < wH - 1; wy++) {
      for (let wx = 0; wx < wW; wx++) {
        const i = wy * wW + wx;
        const speed = Math.sqrt(windX[i] * windX[i] + windY[i] * windY[i]);
        if (speed < 1e-6) continue;
        // Normalize curl by speed to get rotation rate
        const normCurl = smoothCurl[i] / speed;
        // Boost proportional to rotation intensity
        const boost = 1 + normCurl * _curlBoost * 5.0;
        const factor = Math.min(3.0, boost);
        windX[i] *= factor;
        windY[i] *= factor;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FINAL: Terrain deflection (runs LAST so nothing overwrites it)
  // ════════════════════════════════════════════════════════════════
  // Must run after all other post-processing (eddies, gusts, curl boost)
  // because those steps add noise and amplification that would drown out
  // the careful directional changes from terrain blocking.
  if (_terrainDeflect > 0) {
    const deflectPasses = 80;
    for (let pass = 0; pass < deflectPasses; pass++) {
      for (let wy = 1; wy < wH - 1; wy++) {
        for (let wx = 0; wx < wW; wx++) {
          const i = wy * wW + wx;
          const ti = wElev[i];
          if (ti < 0.005) continue;

          const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
          const gx = (wElev[wy * wW + wr] - wElev[wy * wW + wl]) * 0.5;
          const gy = (wElev[(wy + 1) * wW + wx] - wElev[(wy - 1) * wW + wx]) * 0.5;
          const gm = Math.sqrt(gx * gx + gy * gy);
          if (gm < 1e-6) continue;

          const nx = gx / gm, ny = gy / gm;
          let vx = windX[i], vy = windY[i];
          const dot = vx * nx + vy * ny;

          if (dot > 0) {
            const speed = Math.sqrt(vx * vx + vy * vy);
            const deflect = Math.min(1, ti * _terrainDeflect * 0.12 * _coandaStr / Math.max(0.01, speed));
            const rmX = dot * nx * deflect;
            const rmY = dot * ny * deflect;
            vx -= rmX; vy -= rmY;

            const tangX = -ny, tangY = nx;
            const tangDot = vx * tangX + vy * tangY;
            const redir = Math.sqrt(rmX * rmX + rmY * rmY) * 0.7;
            vx += (tangDot >= 0 ? 1 : -1) * tangX * redir;
            vy += (tangDot >= 0 ? 1 : -1) * tangY * redir;

            windX[i] = vx;
            windY[i] = vy;
          }
        }
      }

      if (pass < deflectPasses - 1 && pass % 2 === 0) {
        const tmpWx = new Float32Array(windX);
        const tmpWy = new Float32Array(windY);
        const blend = 0.25;
        for (let wy = 1; wy < wH - 1; wy++) {
          for (let wx = 0; wx < wW; wx++) {
            const i2 = wy * wW + wx;
            if (wElev[i2] < 0.002) continue;
            const wl2 = (wx - 1 + wW) % wW, wr2 = (wx + 1) % wW;
            const avgX = (tmpWx[wy * wW + wl2] + tmpWx[wy * wW + wr2]
                        + tmpWx[(wy - 1) * wW + wx] + tmpWx[(wy + 1) * wW + wx]) * 0.25;
            const avgY = (tmpWy[wy * wW + wl2] + tmpWy[wy * wW + wr2]
                        + tmpWy[(wy - 1) * wW + wx] + tmpWy[(wy + 1) * wW + wx]) * 0.25;
            windX[i2] = tmpWx[i2] * (1 - blend) + avgX * blend;
            windY[i2] = tmpWy[i2] * (1 - blend) + avgY * blend;
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Bilinear upscale to full resolution
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
