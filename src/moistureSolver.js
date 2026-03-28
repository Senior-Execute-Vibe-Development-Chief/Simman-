// ── Moisture Solver ──
// Physically-grounded moisture cycle: evaporation → transport → condensation/precipitation
// Produces precipitation accumulation map from elevation, wind, and temperature data.
// Shared by tectonic and earth_sim modes.

export function solveMoisture(W, H, elevation, windX, windY, temperature, params = {}) {
  const p = (k, d) => params[k] !== undefined ? params[k] : d;

  const _moistDecay      = p('moistDecay', 0.993);
  const _moistRecycling  = p('moistRecycling', 0.25);
  const _moistTBlock     = p('moistTerrainBlock', 0.4);
  const _moistElevDry    = p('moistElevDry', 2.0);
  const _moistAdvW       = p('moistAdvectWeight', 0.60);
  const _moistOcnW       = p('moistOceanWeight', 0.20);
  const _moistSteps      = Math.round(p('moistSteps', 90));
  const _moistConvective = p('moistConvective', 0.04);
  const _moistSubsidLat  = p('moistSubsidenceLat', 28);
  const _moistSubsidStr  = p('moistSubsidenceStr', 0.03);

  // Work on 2x coarse grid for performance
  const mW = Math.ceil(W / 2), mH = Math.ceil(H / 2);
  const mN = mW * mH;

  // Helper: full-resolution index from coarse coords
  const fullIdx = (mx, my) => {
    const px = Math.min(W - 1, mx * 2), py = Math.min(H - 1, my * 2);
    return py * W + px;
  };

  // Check if temperature data is available (may be all zeros in tectonic mode
  // where moisture is computed before temperature). If so, use latitude-based estimate.
  let hasTemp = false;
  for (let i = 0; i < Math.min(1000, W * H); i++) {
    if (temperature[i] > 0.001) { hasTemp = true; break; }
  }

  // Sample full-res data at coarse cell
  const elev = new Float32Array(mN);
  const temp = new Float32Array(mN);
  const wX = new Float32Array(mN);
  const wY = new Float32Array(mN);
  const isOcean = new Uint8Array(mN);

  for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
    const mi = my * mW + mx;
    const fi = fullIdx(mx, my);
    elev[mi] = elevation[fi];
    wX[mi] = windX[fi];
    wY[mi] = windY[fi];
    isOcean[mi] = elevation[fi] <= 0 ? 1 : 0;

    if (hasTemp) {
      temp[mi] = temperature[fi];
    } else {
      const py = Math.min(H - 1, my * 2);
      const lat = Math.abs(py / H - 0.5) * 2;
      const e = Math.max(0, elevation[fi]);
      temp[mi] = Math.max(0, Math.min(1,
        1 - Math.pow(lat, 1.35) * 1.15
        + Math.exp(-((lat - 0.20) * (lat - 0.20)) / (2 * 0.08 * 0.08)) * 0.06
        - e * 0.65));
    }
  }

  // ═══════════════════════════════════════════════════════
  // Precompute fields
  // ═══════════════════════════════════════════════════════

  // Wind divergence for convergence precipitation
  const divField = new Float32Array(mN);
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
    const ci = my * mW + mx;
    divField[ci] = (wX[my * mW + mxR] - wX[my * mW + mxL]
      + wY[(my + 1) * mW + mx] - wY[(my - 1) * mW + mx]) * 0.5;
  }
  // Smooth divergence (3 passes)
  for (let pass = 0; pass < 3; pass++) {
    const prev = new Float32Array(divField);
    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const ci = my * mW + mx;
      divField[ci] = prev[ci] * 0.4
        + (prev[my * mW + mxL] + prev[my * mW + mxR]
          + prev[(my - 1) * mW + mx] + prev[(my + 1) * mW + mx]) * 0.15;
    }
  }

  // Elevation gradient for orographic precipitation
  const gradX = new Float32Array(mN);
  const gradY = new Float32Array(mN);
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
    const ci = my * mW + mx;
    gradX[ci] = (elev[my * mW + mxR] - elev[my * mW + mxL]) * 0.5;
    gradY[ci] = (elev[(my + 1) * mW + mx] - elev[(my - 1) * mW + mx]) * 0.5;
  }

  // Precompute wind direction + speed on coarse grid
  const wDir = new Float32Array(mN * 2); // interleaved dirX, dirY
  const wSpd = new Float32Array(mN);
  for (let i = 0; i < mN; i++) {
    const s = Math.sqrt(wX[i] * wX[i] + wY[i] * wY[i]);
    wSpd[i] = s;
    if (s > 0.005) {
      wDir[i * 2] = wX[i] / s;
      wDir[i * 2 + 1] = wY[i] / s;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 1: Initialize atmospheric moisture
  // ═══════════════════════════════════════════════════════
  const atmos = new Float32Array(mN);
  const precipAccum = new Float32Array(mN);

  // Ocean evaporation capacity — temperature-driven
  const oceanMoist = new Float32Array(mN);
  for (let i = 0; i < mN; i++) {
    if (isOcean[i]) {
      const wsN = Math.min(1, wSpd[i] * 10);
      // Hot ocean = lots of evaporation. Scale by ocean weight param.
      const evap = (0.4 + temp[i] * 0.55) * (0.7 + 0.3 * wsN) * (0.5 + _moistOcnW * 2.5);
      oceanMoist[i] = Math.min(0.95, Math.max(0.35, evap));
      atmos[i] = oceanMoist[i];
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 2: Iterative transport with precipitation
  // ═══════════════════════════════════════════════════════
  const STEPS = _moistSteps;
  const baseReach = 1.0 + _moistAdvW * 2.0; // 1.0 - 3.0 cells

  for (let step = 0; step < STEPS; step++) {
    const prev = new Float32Array(atmos);

    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      const ci = my * mW + mx;

      // ── Ocean: reset to evaporation value ──
      if (isOcean[ci]) {
        atmos[ci] = oceanMoist[ci];
        continue;
      }

      // ── Transport: backward-trace advection ──
      const dirX = wDir[ci * 2], dirY = wDir[ci * 2 + 1];
      const ws = wSpd[ci];

      // Trace backward along normalized wind direction
      const cellReach = baseReach;
      const srcX = mx - dirX * cellReach;
      const srcY = my - dirY * cellReach;

      // Bilinear sample from previous step (with X wrapping)
      let srcXw = ((srcX % mW) + mW) % mW; // wrap X
      const srcYc = Math.max(0, Math.min(mH - 1.001, srcY)); // clamp Y
      const sx = Math.min(mW - 2, srcXw | 0);
      const sy = Math.min(mH - 2, srcYc | 0);
      const fdx = srcXw - sx;
      const fdy = srcYc - sy;
      const sxr = (sx + 1) % mW;
      const upwind = (prev[sy * mW + sx] * (1 - fdx) + prev[sy * mW + sxr] * fdx) * (1 - fdy)
        + (prev[(sy + 1) * mW + sx] * (1 - fdx) + prev[(sy + 1) * mW + sxr] * fdx) * fdy;

      // Small diffusion term for stability (mostly advection-driven)
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const nAvg = (prev[my * mW + mxL] + prev[my * mW + mxR]
        + prev[(my - 1) * mW + mx] + prev[(my + 1) * mW + mx]) * 0.25;

      // 85% advection, 15% neighbor diffusion
      let moist = upwind * 0.85 + nAvg * 0.15;

      // ── Continental decay ──
      moist *= _moistDecay;

      // ── Precipitation triggers ──
      let precip = 0;
      const py = Math.min(H - 1, my * 2);
      const lat = Math.abs(py / H - 0.5) * 2;
      const latDeg = lat * 90; // 0° at equator, 90° at poles

      // Subtropical subsidence factor: the descending branch of the Hadley cell
      // at ~20-35° latitude creates warm sinking air that suppresses precipitation
      // and actively dries the atmosphere. This is why all major deserts sit here.
      // Gaussian centered at ~28° latitude, width ~8°
      const subtropDist = latDeg - _moistSubsidLat;
      const subsidenceFactor = Math.exp(-(subtropDist * subtropDist) / (2 * 8 * 8));

      // Subtropical subsidence: actively drain atmospheric moisture
      // Sinking air warms adiabatically, increasing capacity → prevents condensation
      // and pushes moisture away. Stronger over land (no ocean buffering).
      if (subsidenceFactor > 0.1) {
        const subsidenceDrain = moist * subsidenceFactor * _moistSubsidStr;
        moist -= subsidenceDrain;
        // No precipitation from subsidence — the moisture just evaporates/disperses
      }

      // a) Orographic: wind pushing uphill forces precipitation
      if (ws > 0.005) {
        const upslope = dirX * gradX[ci] + dirY * gradY[ci];
        if (upslope > 0) {
          const oroRate = Math.min(0.35, upslope * _moistTBlock * 4);
          const oroPrecip = moist * oroRate;
          precip += oroPrecip;
          moist -= oroPrecip;
        }
      }

      // b) Convective: hot land triggers rainfall
      // Strong at ITCZ (0-15°), SUPPRESSED at subtropical highs (20-35°),
      // moderate at midlatitudes (35-55°)
      if (temp[ci] > 0.45 && moist > 0.05) {
        // ITCZ convergence zone: very strong convection near equator
        const itczFactor = Math.exp(-(latDeg * latDeg) / (2 * 12 * 12));
        // Subtropical suppression: Hadley cell descent inhibits convection
        const subtropSuppress = 1 - subsidenceFactor * 0.85;
        // Midlatitude frontal lifting (weaker than ITCZ but still present)
        const midlatFactor = Math.exp(-((latDeg - 45) * (latDeg - 45)) / (2 * 12 * 12)) * 0.3;

        const convFactor = (itczFactor + midlatFactor) * subtropSuppress;
        const convRate = (temp[ci] - 0.4) * _moistConvective * convFactor;
        const convPrecip = moist * Math.max(0, convRate);
        precip += convPrecip;
        moist -= convPrecip;
      }

      // c) Convergence: wind convergence forces uplift
      // This drives ITCZ rainfall and midlatitude frontal precipitation
      const div = divField[ci];
      if (div < -0.001 && moist > 0.02) {
        // Convergence precipitation is suppressed in the subtropical belt
        const convgSuppress = 1 - subsidenceFactor * 0.7;
        const convgPrecip = moist * Math.min(0.12, -div * 2.5) * convgSuppress;
        precip += convgPrecip;
        moist -= convgPrecip;
      }

      // d) Capacity overflow: cold/high-altitude air can't hold moisture
      const elevCool = Math.max(0, elev[ci]) * _moistElevDry * 0.12;
      const capacity = Math.max(0.03, 0.06 + temp[ci] * 0.94 - elevCool);
      if (moist > capacity) {
        precip += moist - capacity;
        moist = capacity;
      }

      // ── Transpiration recycling ──
      // Suppressed in subtropical belt (dry air inhibits transpiration)
      if (precipAccum[ci] > 0.02 && temp[ci] > 0.25) {
        const warmFactor = lat < 0.5 ? 1.0 : Math.max(0, 1 - (lat - 0.5) * 3);
        const recycSuppress = 1 - subsidenceFactor * 0.6;
        const recycled = Math.min(0.06, precipAccum[ci] * _moistRecycling * warmFactor * 0.04 * recycSuppress);
        moist += recycled;
      }

      atmos[ci] = Math.max(0, moist);
      precipAccum[ci] += precip;
    }

    // Light diffusion every 8 steps
    if (step % 8 === 7) {
      const dPrev = new Float32Array(atmos);
      for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
        if (isOcean[my * mW + mx]) continue;
        const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
        const ci = my * mW + mx;
        atmos[ci] = dPrev[ci] * 0.6
          + (dPrev[my * mW + mxL] + dPrev[my * mW + mxR]
            + dPrev[(my - 1) * mW + mx] + dPrev[(my + 1) * mW + mx]) * 0.1;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 3: Post-process and normalize
  // ═══════════════════════════════════════════════════════

  // Use percentile-based normalization so a few ultra-wet coastal cells
  // don't suppress everything else
  const landValues = [];
  for (let i = 0; i < mN; i++) {
    if (!isOcean[i] && precipAccum[i] > 0) landValues.push(precipAccum[i]);
  }
  landValues.sort((a, b) => a - b);

  // Use 95th percentile as the "1.0" reference point
  const p95 = landValues.length > 0 ? landValues[Math.floor(landValues.length * 0.95)] : 1;
  const normScale = p95 > 0.001 ? 1 / p95 : 1;

  const normalized = new Float32Array(mN);
  for (let i = 0; i < mN; i++) {
    if (isOcean[i]) {
      normalized[i] = 0.5;
    } else {
      // Scale by 95th percentile, apply power curve for dynamic range
      const raw = Math.min(1.3, precipAccum[i] * normScale); // allow slight overshoot
      normalized[i] = Math.max(0.02, Math.min(1, Math.pow(raw, 0.7)));
    }
  }

  // Smooth (3 passes)
  for (let pass = 0; pass < 3; pass++) {
    const prev = new Float32Array(normalized);
    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      if (isOcean[my * mW + mx]) continue;
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const ci = my * mW + mx;
      normalized[ci] = prev[ci] * 0.5
        + (prev[my * mW + mxL] + prev[my * mW + mxR]
          + prev[(my - 1) * mW + mx] + prev[(my + 1) * mW + mx]) * 0.125;
    }
  }

  // Coastal boost: very low land near ocean gets a moisture bump
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const ci = my * mW + mx;
    if (isOcean[ci]) continue;
    if (elev[ci] < 0.03) {
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      if (isOcean[my * mW + mxL] || isOcean[my * mW + mxR]
        || isOcean[(my - 1) * mW + mx] || isOcean[(my + 1) * mW + mx]) {
        normalized[ci] = Math.min(1, normalized[ci] + 0.06);
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // Upscale to full resolution via bilinear interpolation
  // ═══════════════════════════════════════════════════════
  const result = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = x / 2, fy = y / 2;
    const ix = Math.min(mW - 2, fx | 0), iy = Math.min(mH - 2, fy | 0);
    const dx = fx - ix, dy = fy - iy;
    const sxr = Math.min(mW - 1, ix + 1);
    const fi = y * W + x;
    if (elevation[fi] <= 0) {
      result[fi] = 0.5;
    } else {
      result[fi] = Math.max(0.02, Math.min(1,
        (normalized[iy * mW + ix] * (1 - dx) + normalized[iy * mW + sxr] * dx) * (1 - dy)
        + (normalized[(iy + 1) * mW + ix] * (1 - dx) + normalized[(iy + 1) * mW + sxr] * dx) * dy
      ));
    }
  }

  return result;
}
