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
      // Latitude-based temperature estimate (same formula used by wind solver)
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
  // Phase 1: Initialize atmospheric moisture + precipitation accumulator
  // ═══════════════════════════════════════════════════════
  const atmos = new Float32Array(mN);       // atmospheric moisture content
  const precipAccum = new Float32Array(mN); // accumulated precipitation

  // Precompute wind divergence for convergence precipitation
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

  // Precompute elevation gradient for orographic precipitation
  // Dot product of wind with gradient detects upslope flow
  const gradX = new Float32Array(mN);
  const gradY = new Float32Array(mN);
  for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
    const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
    const ci = my * mW + mx;
    gradX[ci] = (elev[my * mW + mxR] - elev[my * mW + mxL]) * 0.5;
    gradY[ci] = (elev[(my + 1) * mW + mx] - elev[(my - 1) * mW + mx]) * 0.5;
  }

  // Ocean evaporation: warm windy ocean produces more moisture
  for (let i = 0; i < mN; i++) {
    if (isOcean[i]) {
      const ws = Math.sqrt(wX[i] * wX[i] + wY[i] * wY[i]);
      atmos[i] = Math.min(0.95, Math.max(0.3,
        0.3 + temp[i] * 0.5 * _moistOcnW / 0.20 + Math.min(0.2, ws * 0.4)));
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 2: Iterative transport with precipitation
  // ═══════════════════════════════════════════════════════
  const STEPS = 70;
  const reach = 1.2 + _moistAdvW * 1.5; // advection reach scaled by param

  for (let step = 0; step < STEPS; step++) {
    const prev = new Float32Array(atmos);

    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      const ci = my * mW + mx;

      // ── 1. Ocean: replenish evaporation ──
      if (isOcean[ci]) {
        const ws = Math.sqrt(wX[ci] * wX[ci] + wY[ci] * wY[ci]);
        atmos[ci] = Math.min(0.95, Math.max(prev[ci],
          0.3 + temp[ci] * 0.5 * _moistOcnW / 0.20 + Math.min(0.2, ws * 0.4)));
        continue;
      }

      // ── 2. Transport: backward-trace advection ──
      const wxc = wX[ci], wyc = wY[ci];
      const ws = Math.sqrt(wxc * wxc + wyc * wyc);

      // Backward trace: where did this air come from?
      const srcX = mx - wxc * reach;
      const srcY = my - wyc * reach;

      // Bilinear sample from previous step
      const sx = Math.min(mW - 2, Math.max(0, srcX | 0));
      const sy = Math.min(mH - 2, Math.max(0, srcY | 0));
      const fdx = Math.max(0, Math.min(1, srcX - sx));
      const fdy = Math.max(0, Math.min(1, srcY - sy));
      const sxr = Math.min(mW - 1, sx + 1);
      const upwind = (prev[sy * mW + sx] * (1 - fdx) + prev[sy * mW + sxr] * fdx) * (1 - fdy)
        + (prev[(sy + 1) * mW + sx] * (1 - fdx) + prev[(sy + 1) * mW + sxr] * fdx) * fdy;

      // Neighbor average (handles offshore wind + diffusion)
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const nAvg = (prev[my * mW + mxL] + prev[my * mW + mxR]
        + prev[(my - 1) * mW + mx] + prev[(my + 1) * mW + mx]) * 0.25;

      // Blend: mostly advected, partially diffused
      let moist = upwind * 0.7 + nAvg * 0.3;

      // ── 3. Continental decay ──
      moist *= _moistDecay;

      // ── 4. Clausius-Clapeyron: moisture capacity depends on temperature ──
      // Warm air holds much more moisture. At altitude, air is thinner and colder.
      const elevEffect = Math.max(0, elev[ci]) * _moistElevDry * 0.15;
      const capacity = Math.max(0.05, 0.08 + temp[ci] * 0.92 - elevEffect);

      // ── 5. Precipitation triggers ──
      let precip = 0;

      // a) Orographic precipitation: dot product of wind with elevation gradient
      // Positive = wind pushing uphill = forced ascent → precipitation
      // Zero when wind parallel to ridge, maximum when hitting head-on
      if (ws > 0.005) {
        const windDirX = wxc / ws, windDirY = wyc / ws;
        const upslope = windDirX * gradX[ci] + windDirY * gradY[ci];
        if (upslope > 0) {
          const oroRate = Math.min(0.5, upslope * ws * _moistTBlock * 15);
          const oroPrecip = moist * oroRate;
          precip += oroPrecip;
          moist -= oroPrecip;
        }
      }

      // b) Convective precipitation: hot land drives convective uplift
      const py = Math.min(H - 1, my * 2);
      const lat = Math.abs(py / H - 0.5) * 2;
      if (temp[ci] > 0.55 && moist > 0.1) {
        // Stronger in tropics (low latitude), weaker at high latitudes
        const tropicalBoost = Math.max(0, 1 - lat * 2) * 0.5 + 0.5;
        const convPrecip = moist * (temp[ci] - 0.5) * 0.10 * tropicalBoost;
        precip += convPrecip;
        moist -= convPrecip;
      }

      // c) Convergence precipitation: wind convergence forces air up
      const div = divField[ci];
      if (div < -0.001 && moist > 0.05) {
        const convgPrecip = moist * Math.min(0.15, -div * 2.0);
        precip += convgPrecip;
        moist -= convgPrecip;
      }

      // d) Capacity overflow: if moisture exceeds what air can hold, it precipitates
      if (moist > capacity) {
        precip += moist - capacity;
        moist = capacity;
      }

      // ── 6. Transpiration recycling ──
      // Wet warm land re-evaporates moisture back into the atmosphere
      // Requires accumulated precipitation (there must be water on the ground)
      if (precipAccum[ci] > 0.05 && temp[ci] > 0.3) {
        const warmFactor = lat < 0.5 ? 1.0 : Math.max(0, 1 - (lat - 0.5) * 3);
        const recycled = precipAccum[ci] * _moistRecycling * warmFactor * 0.04;
        moist += recycled;
      }

      atmos[ci] = Math.max(0, moist);
      precipAccum[ci] += precip;
    }

    // Diffusion pass every 5 steps (turbulent mixing)
    if (step % 5 === 4) {
      const dPrev = new Float32Array(atmos);
      for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
        if (isOcean[my * mW + mx]) continue;
        const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
        const ci = my * mW + mx;
        atmos[ci] = dPrev[ci] * 0.55
          + (dPrev[my * mW + mxL] + dPrev[my * mW + mxR]
            + dPrev[(my - 1) * mW + mx] + dPrev[(my + 1) * mW + mx]) * 0.1125;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 3: Post-process and normalize
  // ═══════════════════════════════════════════════════════

  // Find max precipitation for normalization (land only)
  let maxPrecip = 0;
  for (let i = 0; i < mN; i++) {
    if (!isOcean[i] && precipAccum[i] > maxPrecip) maxPrecip = precipAccum[i];
  }
  if (maxPrecip < 0.001) maxPrecip = 1; // avoid division by zero

  // Normalize with a soft curve to spread values across [0,1]
  // Use sqrt to give more dynamic range in the low end
  const normalized = new Float32Array(mN);
  for (let i = 0; i < mN; i++) {
    if (isOcean[i]) {
      normalized[i] = 0.5;
    } else {
      const raw = precipAccum[i] / maxPrecip;
      normalized[i] = Math.max(0.02, Math.min(1, Math.sqrt(raw)));
    }
  }

  // Smooth precipitation (3 passes to remove advection artifacts)
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
      // Check if any neighbor is ocean
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      if (isOcean[my * mW + mxL] || isOcean[my * mW + mxR]
        || isOcean[(my - 1) * mW + mx] || isOcean[(my + 1) * mW + mx]) {
        normalized[ci] = Math.min(1, normalized[ci] + 0.08);
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
