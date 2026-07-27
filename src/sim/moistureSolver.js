// ── Moisture Solver ──
// Physically-grounded moisture cycle: evaporation → transport → condensation/precipitation
// Produces precipitation accumulation map from elevation, wind, and temperature data.
// Shared by tectonic and earth_sim modes.

// ── Terrain shelter: how enclosed a cell is by the ground around it ──────────────
// Returns 0 (open) … 1 (deeply enclosed basin floor) at full resolution.
//
// A basin floor ringed by highland is poorly VENTILATED: the mean flow is deflected
// over and around the rim instead of flushing the floor, so the air inside is not
// replaced — it equilibrates with its surroundings by mixing, and what evaporates
// into it tends to stay. This is why the Sichuan Basin, the Po Valley and the Central
// Valley are humid, cloudy and fog-prone out of proportion to their rainfall, and why
// their pooled air is partly decoupled from the free troposphere above the rim.
//
// Enclosure is DIRECTIONAL. An isotropic measure — comparing a cell to a blur of the
// terrain — cannot tell a walled basin from a coastal slope backed by a range, and
// scores the Atacama, open to the whole Pacific, as sheltered as Sichuan. So rays are
// cast outward and each returns the highest ground it crosses, giving two numbers that
// answer different questions: the WEAKEST side (is there a way straight through?) and
// the MEAN wall (how deep is the bowl?). A basin has to satisfy both.
//
// The per-cell score is then pooled across the basin floor, since the sheltered air is
// a property of the whole hollow rather than of its single lowest point, and the pool
// is bounded by height — it fills to the rim and no further.
//
// Computed on the same 2× coarse grid the solver uses, then sampled back to full res.
export function terrainShelter(W, H, elevation) {
  const mW = Math.ceil(W / 2), mH = Math.ceil(H / 2), mN = mW * mH;
  const elev = new Float32Array(mN);
  const sea = new Uint8Array(mN);
  for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
    const fi = Math.min(H - 1, my * 2) * W + Math.min(W - 1, mx * 2);
    elev[my * mW + mx] = Math.max(0, elevation[fi]);
    sea[my * mW + mx] = elevation[fi] <= 0 ? 1 : 0;
  }
  const rad = Math.max(2, Math.round(5 * mW / 360));   // ~5° — resolution-independent
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const coarse = new Float32Array(mN);
  for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
    const ci = my * mW + mx;
    if (sea[ci]) continue;
    const e0 = elev[ci];
    let minBarrier = Infinity, sumBarrier = 0;
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0], dy = DIRS[d][1];
      let maxE = 0;
      for (let r = 1; r <= rad; r++) {
        const yy = my + dy * r; if (yy < 0 || yy >= mH) break;
        const si = yy * mW + ((mx + dx * r + mW * 4) % mW);
        // Open sea ends the ray: past the coast there is no rim, only whatever
        // barrier (if any) was already crossed on the way out.
        if (sea[si]) break;
        if (elev[si] > maxE) maxE = elev[si];
      }
      const barrier = maxE - e0;
      sumBarrier += Math.max(0, barrier);
      if (barrier < minBarrier) minBarrier = barrier;
    }
    // Two things have to be true, and they are different questions. ENCLOSURE (the
    // weakest side) asks whether the wind has a way straight through — one outlet is
    // still a basin, so this only needs a low sill, but a side that opens onto plain or
    // sea disqualifies the cell outright. DEPTH (the mean wall) asks how big the bowl
    // is, which is what decides whether enough air pools to matter. Requiring both
    // separates a deep basin with a gorge for an outlet (Sichuan: weakest side 0.07,
    // mean wall ~0.2) from the shallow scattered hollows of broken upland (the US
    // Southwest: enclosed on paper, but only just, and holding nothing).
    const enclosed = Math.max(0, Math.min(1, (minBarrier - 0.02) / 0.03));
    const depth    = Math.max(0, Math.min(1, (sumBarrier / 8 - 0.12) / 0.15));
    coarse[ci] = enclosed * depth;
  }
  // The sheltered air POOL is a property of the basin, not of the single most enclosed
  // cell in it. Measured per-cell the score comes out patchy: a ray cast toward a
  // neighbouring cell on the same basin floor finds no barrier at all, so only the very
  // lowest points score while the floor around them reads open. Air does not behave that
  // way — it pools across the whole floor up to the rim. So spread the score to ground
  // that lies within a short reach of enclosed ground (a dilation, not a blur: pooling
  // must not dilute the enclosure it spreads), then relax the result so the pool fades
  // out at its edges instead of ending on a hard step.
  // The spread is bounded by HEIGHT, not just by distance: pooled air fills a basin up
  // to its rim and no further, so a cell only joins a neighbouring cell's pool if it does
  // not stand above it. Without that gate the pool climbs out over the surrounding
  // country and greens it (measured: the US Southwest and the Tarim, both broken ground
  // where small enclosed hollows sit among much higher ridges).
  const pool = new Float32Array(mN);
  const pr = Math.max(1, Math.round(1.5 * mW / 360));   // ~1.5° — basin-floor scale
  const POOL_RISE = 0.03;                               // how far a floor may undulate
  for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
    const ci = my * mW + mx;
    if (sea[ci]) continue;
    let best = coarse[ci];
    for (let dy = -pr; dy <= pr; dy++) {
      const yy = my + dy; if (yy < 0 || yy >= mH) continue;
      for (let dx = -pr; dx <= pr; dx++) {
        const si = yy * mW + ((mx + dx + mW * 4) % mW);
        if (sea[si]) continue;
        if (elev[ci] > elev[si] + POOL_RISE) continue;  // this cell stands above that pool
        if (coarse[si] > best) best = coarse[si];
      }
    }
    pool[ci] = best;
  }
  const relaxed = new Float32Array(mN);
  for (let my = 0; my < mH; my++) for (let mx = 0; mx < mW; mx++) {
    const ci = my * mW + mx;
    if (sea[ci]) continue;
    let s = pool[ci] * 0.5, wsum = 0.5;
    for (let d = 0; d < 4; d++) {
      const yy = my + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (yy < 0 || yy >= mH) continue;
      const xx = (mx + (d === 0 ? 1 : d === 1 ? -1 : 0) + mW) % mW;
      s += pool[yy * mW + xx] * 0.125; wsum += 0.125;
    }
    relaxed[ci] = s / wsum;
  }

  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    out[y * W + x] = relaxed[Math.min(mH - 1, y >> 1) * mW + Math.min(mW - 1, x >> 1)];
  }
  return out;
}

export function solveMoisture(W, H, elevation, windX, windY, temperature, params = {}) {
  const p = (k, d) => params[k] !== undefined ? params[k] : d;

  const _moistRecycling  = p('moistRecycling', 0.25);
  const _moistTBlock     = p('moistTerrainBlock', 0.4);
  const _moistElevDry    = p('moistElevDry', 2.0);
  const _moistAdvW       = p('moistAdvectWeight', 0.60);
  const _moistOcnW       = p('moistOceanWeight', 0.20);
  // Depletive transport (replaces the old near-lossless max-of-neighbours flood).
  // Moisture is a CONSERVED budget: replenished only at the ocean, it loses water to
  // precipitation as it advects across land, so a deep interior reached only by a long
  // overland fetch dries out on its own — continentality is emergent, not a flat decay.
  //  - _moistDiffuse: weak, LOSSY isotropic spread modelling the seasonal/synoptic
  //    transport the annual-mean wind misses. Far below 1 so it nudges moisture between
  //    adjacent cells but, decaying ~half per cell, cannot carry ocean moisture dozens
  //    of cells inland the way the old flood-fill did. This is the lateral leak that,
  //    together with precipitation, makes interiors dry.
  const _moistDiffuse    = p('moistDiffuse', 0.75);
  // How much of the lateral mixing reads the MEAN of the land neighbours rather than the
  // wettest one (see the mixing block below). 0 = the old max-fill, which floors every
  // cell at the wettest neighbour's value and smears wet regions outward; 1 = a pure
  // averaging exchange, which lets sharp wet/dry boundaries form.
  const _mixMean         = p('moistMixMean', 1);
  // Evapotranspiration recycling strength (see the recycling term below). Boosted well
  // above the legacy 0.06/0.08 so warm, wet interiors (Amazon, Congo) recharge their own
  // air column now that the lossless max-fill no longer floods them for free. Temp-gated,
  // so it lifts the rainforests without re-wetting cold/dry continental interiors.
  const _moistRecyclRate = p('moistRecyclRate', 0.36);
  const _moistRecyclCap  = p('moistRecyclCap', 0.30);
  // Winter extratropical storm track (frontal/cyclonic rain). The sole rain source of
  // Mediterranean (Cs) climates — absent from the model, which left the Levant, the
  // Fertile-Crescent highlands, California and central Chile as desert. Fires only in
  // the seasonal solves, in the WINTER hemisphere's ~30-45° band, fed by the upwind sea.
  const _frontLat        = p('moistFrontLat', 37);   // band centre (degrees of latitude)
  const _frontWidth      = p('moistFrontWidth', 7);  // band half-width (degrees)
  const _frontStr        = p('moistFrontStr', 0.18);
  const _frontReach      = p('moistFrontReach', 5);  // ocean-distance decay (cells) — keeps interiors dry
  const _moistSteps      = Math.round(p('moistSteps', 140));
  const _moistConvective = p('moistConvective', 0.04);
  const _moistSubsidLat  = p('moistSubsidenceLat', 28);
  const _moistSubsidStr  = p('moistSubsidenceStr', 0.03);
  // ITCZ latitude (degrees, +N): 0 = annual mean (default, byte-identical to before).
  // For a seasonal solve the rain belt and the Hadley descent follow the sun into the
  // summer hemisphere (+ in boreal summer), so the monsoon tropics get convective rain
  // and escape the subtropical subsidence that an annual mean parks on them.
  const _itczLat         = p('itczLat', 0);

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
      // Latitude→temperature must match the calibrated curve used
      // in tectonicGen / WorldSim — see tools/probe_temperature.mjs.
      temp[mi] = Math.max(0, Math.min(1,
        0.92 - Math.pow(lat, 1.5) * 0.50 - Math.pow(lat, 6) * 0.80
        + Math.exp(-((lat - 0.20) * (lat - 0.20)) / (2 * 0.08 * 0.08)) * 0.06
        - e * (0.65 + 0.8 * lat)));
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
  // Smooth divergence (3 passes) — reuse single temp buffer
  const _smoothBuf = new Float32Array(mN);
  for (let pass = 0; pass < 3; pass++) {
    _smoothBuf.set(divField);
    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const ci = my * mW + mx;
      divField[ci] = _smoothBuf[ci] * 0.4
        + (_smoothBuf[my * mW + mxL] + _smoothBuf[my * mW + mxR]
          + _smoothBuf[(my - 1) * mW + mx] + _smoothBuf[(my + 1) * mW + mx]) * 0.15;
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
    if (s > 0.0005) {
      wDir[i * 2] = wX[i] / s;
      wDir[i * 2 + 1] = wY[i] / s;
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 1: Initialize atmospheric moisture
  // ═══════════════════════════════════════════════════════
  // Double-buffer to avoid per-step Float32Array allocation
  const atmos = new Float32Array(mN);
  const atmosPrev = new Float32Array(mN);
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

  // Distance (in cells) from each land tile to the nearest ocean — multi-source BFS,
  // capped. Used by the winter storm-track term so its frontal rain reaches coasts and
  // shrinking seas (the Mediterranean → the Levant) but fades out over deep interiors.
  const distToOcean = new Int16Array(mN).fill(999);
  {
    const distCap = Math.round(12 * mW / 240); // ~18° of reach, resolution-independent
    const dq = [];
    for (let i = 0; i < mN; i++) if (isOcean[i]) { distToOcean[i] = 0; dq.push(i); }
    let dh = 0;
    while (dh < dq.length) {
      const ci = dq[dh++], d = distToOcean[ci];
      if (d >= distCap) continue;
      const cx = ci % mW, cy = (ci - cx) / mW;
      const nb = [cy * mW + ((cx + 1) % mW), cy * mW + ((cx - 1 + mW) % mW),
        (cy + 1 < mH ? (cy + 1) * mW + cx : -1), (cy > 0 ? (cy - 1) * mW + cx : -1)];
      for (const ni of nb) if (ni >= 0 && distToOcean[ni] === 999) { distToOcean[ni] = d + 1; dq.push(ni); }
    }
  }

  // ═══════════════════════════════════════════════════════
  // Phase 2: Iterative transport with precipitation
  // ═══════════════════════════════════════════════════════
  const STEPS = _moistSteps;
  // baseReach is calibrated in CELLS at the 1440-wide reference (mW=720 → 0.5°/cell).
  // Moisture must advect the same number of DEGREES inland per step at any
  // resolution, otherwise a wider grid (the app runs 1920) penetrates fewer degrees
  // and desiccates every continental interior. Scale the reach by mW so °/step is
  // constant (this is what made the app far more desert than the 1440 test renders).
  const baseReach = (1.5 + _moistAdvW * 3.0) * (mW / 720); // 1.5-4.5 cells @ mW=720, scaled

  // Per-cell isotropic-diffusion survival, resolution-normalized to a fixed per-DEGREE
  // leak (same reasoning as baseReach above). _moistDiffuse is the survival across one
  // ~1.5°-wide cell (the W=480 calibration grid, mW=240). At a finer grid each cell is
  // fewer degrees, so the per-cell survival must be HIGHER to leak the same amount per
  // degree — otherwise the lateral spread that feeds e.g. the Great Plains off the Gulf
  // dies off in fewer degrees and over-dries interiors as the app's grid widens.
  const _DIFF_REF_DEG = 360 / 240; // 1.5° — cell width at the calibration resolution
  const diffPerCell = Math.pow(_moistDiffuse, (360 / mW) / _DIFF_REF_DEG);


  for (let step = 0; step < STEPS; step++) {
    atmosPrev.set(atmos);
    const prev = atmosPrev;

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
      const sx = srcXw | 0;                 // already wrapped to [0,mW-1]; clamping
                                            // to mW-2 made fdx exceed 1 at the seam
      const sy = Math.min(mH - 2, srcYc | 0);
      const fdx = srcXw - sx;               // now correctly in [0,1)
      const fdy = srcYc - sy;
      const sxr = (sx + 1) % mW;
      let upwind = (prev[sy * mW + sx] * (1 - fdx) + prev[sy * mW + sxr] * fdx) * (1 - fdy)
        + (prev[(sy + 1) * mW + sx] * (1 - fdx) + prev[(sy + 1) * mW + sxr] * fdx) * fdy;
      // If upwind trace lands on ocean, use the ocean moisture but decay it —
      // represents the coastal transition where oceanic moisture enters land.
      // This prevents desert cells adjacent to narrow seas from getting full ocean moisture.
      const srcIdx = sy * mW + sx;
      if (isOcean[srcIdx]) upwind *= 0.5;

      // Moisture transport — depletive advection (a conserved, drying budget):
      // - Upwind (directional): the budget the wind carried in, backward-traced along
      //   the mean wind. The traced source has ALREADY rained out its share at each
      //   land cell it crossed (the precipitation block below ran there on prior steps
      //   and was not undone by a max-refill), so the column dries MONOTONICALLY
      //   downwind and a mountain-ringed interior with a long dry fetch ends up
      //   near-rainless on its own. A parcel traced from OCEAN is the fresh source.
      // - Isotropic mixing: a WEAK, lossy lateral spread (_moistDiffuse << 1) modelling
      //   the seasonal/synoptic transport the annual-mean wind misses. Read from the
      //   MEAN of the land neighbours, not the wettest one. Taking the max makes this a
      //   flood-fill wearing a decay: every cell is then guaranteed at least
      //   (wettest neighbour × decay), so a wet region projects an exponential skirt
      //   outward that nothing downstream can cut, and no sharp wet/dry boundary can
      //   form anywhere. That is why savanna bordering rainforest came out as forest —
      //   the Llanos read WETTER in its dry season (0.68) than the Guinea coast (0.24),
      //   because the Amazon's skirt floors it. Averaging removes the floor and makes
      //   the spread respect geometry: a cell with one wet neighbour and three dry ones
      //   takes a quarter of the excess, not all of it, so moisture falls off sharply
      //   across a boundary while a cell enclosed by wet ground still stays wet.
      //   From LAND neighbours only (skip ocean to avoid flooding cold polar coasts).
      let moist = upwind;
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const iL = my * mW + mxL, iR = my * mW + mxR;
      const iU = (my - 1) * mW + mx, iD = (my + 1) * mW + mx;
      let nSum = 0, nCnt = 0;
      if (!isOcean[iL]) { nSum += prev[iL]; nCnt++; }
      if (!isOcean[iR]) { nSum += prev[iR]; nCnt++; }
      if (!isOcean[iU]) { nSum += prev[iU]; nCnt++; }
      if (!isOcean[iD]) { nSum += prev[iD]; nCnt++; }
      if (nCnt) {
        const nMean = nSum / nCnt;
        const nMax = Math.max(
          isOcean[iL] ? 0 : prev[iL], isOcean[iR] ? 0 : prev[iR],
          isOcean[iU] ? 0 : prev[iU], isOcean[iD] ? 0 : prev[iD]);
        const diffuse = (nMean * _mixMean + nMax * (1 - _mixMean)) * diffPerCell;
        if (diffuse > moist) moist = diffuse;
      }

      // ── Temperature capacity clamp ──
      // Cold air can't hold much moisture (Clausius-Clapeyron)
      const elevCool = Math.max(0, elev[ci]) * _moistElevDry * 0.12;
      const tempCapacity = Math.max(0.02, 0.05 + temp[ci] * 0.95 - elevCool);
      if (moist > tempCapacity) moist = tempCapacity;

      // ── Precipitation triggers ──
      let precip = 0;
      const py = Math.min(H - 1, my * 2);
      const lat = Math.abs(py / H - 0.5) * 2;
      const latDeg = lat * 90;
      const latSgn = (0.5 - py / H) * 180; // signed latitude, +N

      // Subtropical subsidence: Hadley cell descent at ~20-35°
      // Bimodal subsidence: sharp core (width 6°) for extreme deserts +
      // gentle wide shoulder (width 14°) for semi-arid margins.
      // Core dominates at 20-35°, shoulder extends to ~40° at reduced strength.
      // The descending branch sits poleward of the ITCZ in each hemisphere, so it
      // drifts with the season (_itczLat): in boreal summer the NH belt slides poleward
      // (off India/the Sahel) while the SH belt slides equatorward — which is what lets
      // the summer-hemisphere monsoon lands rain instead of sitting under subsidence.
      const subsidCenter = _moistSubsidLat + 0.20 * _itczLat * Math.sign(latSgn || 1);
      const subtropDist = Math.abs(latSgn) - subsidCenter;
      const coreSubsidence = Math.exp(-(subtropDist * subtropDist) / (2 * 6 * 6));
      const wideSubsidence = Math.exp(-(subtropDist * subtropDist) / (2 * 14 * 14));
      const subsidenceFactor = coreSubsidence * 0.7 + wideSubsidence * 0.3;

      // a) Orographic: wind pushing uphill rains out; descending the lee dries (föhn)
      if (ws > 0.0005) {
        const upslope = dirX * gradX[ci] + dirY * gradY[ci];
        if (upslope > 0) {
          const oroRate = Math.min(0.3, upslope * _moistTBlock * 4);
          precip += moist * oroRate;
          moist *= (1 - oroRate);
        } else if (upslope < 0) {
          // Leeward descent — föhn / rain shadow. Air sinking the lee slope warms and
          // dries. This was entirely missing (only the windward rain-out existed), so
          // lee basins stayed as wet as the windward side: it is what was leaving
          // Patagonia (lee of the Andes), the Great Basin (lee of the Sierra/Cascades)
          // and the Tarim (lee of the Pamir) far too green.
          moist *= 1 - Math.min(0.42, -upslope * _moistTBlock * 9);
        }
      }

      // b) Convective: hot land, strong at ITCZ, suppressed at subtropics
      // ITCZ width 8° — narrow band representing annual-mean position.
      // IRL the ITCZ migrates seasonally but only brings sustained rain to ~±8°.
      if (temp[ci] > 0.45 && moist > 0.05) {
        // The migrating monsoon ITCZ (follows the sun to _itczLat) PLUS a fixed
        // deep-equatorial band. A two-solstice solve parks the ITCZ at ±_itczLat, so the
        // equator would sit that far from convection in BOTH solves and the everwet
        // rainforests (Congo, Amazon, Borneo) would dry out. But the real equator is
        // warm year-round and the ITCZ crosses it twice (the equinoxes), so deep
        // convection there never stops — model that as an ITCZ floor centred on 0°.
        const itczMonsoon = Math.exp(-((latSgn - _itczLat) * (latSgn - _itczLat)) / (2 * 8 * 8));
        // The equatorial floor only exists to replace the convection the ±_itczLat shift
        // moved off the equator, so scale it by the shift: 0 for an annual-mean solve
        // (itczLat=0 stays byte-identical — the tectonic/earth presets rely on that),
        // full strength for the ±13° seasonal solves.
        const itczEquator = Math.exp(-(latSgn * latSgn) / (2 * 9 * 9)) * 0.9
          * Math.min(1, Math.abs(_itczLat) / 8);
        const itczFactor = Math.max(itczMonsoon, itczEquator);
        const subtropSuppress = 1 - subsidenceFactor * 0.9;
        const midlatFactor = Math.exp(-((latDeg - 45) * (latDeg - 45)) / (2 * 12 * 12)) * 0.3;
        const convFactor = (itczFactor + midlatFactor) * subtropSuppress;
        const convRate = (temp[ci] - 0.4) * _moistConvective * convFactor;
        const cp = moist * Math.max(0, convRate);
        precip += cp;
        moist -= cp;
      }

      // c) Convergence precipitation (suppressed at subtropics)
      const div = divField[ci];
      if (div < -0.001 && moist > 0.02) {
        const convgSuppress = 1 - subsidenceFactor * 0.8;
        const cp = moist * Math.min(0.10, -div * 2.0) * convgSuppress;
        precip += cp;
        moist -= cp;
      }

      // d) Capacity overflow — excess beyond what air can hold precipitates
      if (moist > tempCapacity) {
        precip += moist - tempCapacity;
        moist = tempCapacity;
      }

      // ── Subtropical subsidence drying ──
      // Per-step drain: moderate multiplier, sharp spatial focus.
      // At center (28°, factor=1.0, str=0.03): drain=9% → 0.91^90 ≈ 0.0001
      // At 34° (factor=0.41): drain=3.7% → 0.963^90 ≈ 0.034
      // At 38° (factor=0.10): drain=0.9% → 0.991^90 ≈ 0.44 (barely affected)
      if (subsidenceFactor > 0.05) {
        moist *= 1 - subsidenceFactor * _moistSubsidStr * 5;
      }

      // ── Winter extratropical storm track (frontal rain) ──
      // In the WINTER hemisphere the westerly storm track swings equatorward into ~30-45°
      // and its frontal cyclones drop ocean moisture as winter rain — the rain that makes
      // the Mediterranean (Cs) climates: the Levant and the Med basin, California, central
      // Chile, the Cape, SW Australia, and the Anatolian/Zagros highlands that feed the
      // Tigris-Euphrates. The model had no such term, so all of these were desert. Only in
      // the seasonal solves (itczLat≠0); the latitude window sits ABOVE the subtropical-
      // high deserts (the Atacama/Namib at ~23° get nothing), and the ocean-distance decay
      // keeps it off deep interiors (Central Asia), so it adds only where it should.
      if (_itczLat !== 0 && latSgn * _itczLat < 0) {              // this hemisphere is in winter
        const aLat = Math.abs(latSgn);
        const front = Math.exp(-((aLat - _frontLat) * (aLat - _frontLat)) / (2 * _frontWidth * _frontWidth));
        if (front > 0.03) {
          moist += front * _frontStr * Math.exp(-distToOcean[ci] / (_frontReach * mW / 240));
          if (moist > tempCapacity) { precip += moist - tempCapacity; moist = tempCapacity; }
        }
      }

      // ── Transpiration / evapotranspiration recycling ──
      // Vegetated, rained-on land returns moisture to the air column. This is the
      // mechanism that keeps DEEP TROPICAL INTERIORS wet (Amazon, Congo): ~half of
      // rainforest rainfall is locally recycled, so the budget is replenished as it
      // crosses the warm wet basin even though the overland fetch is long. It is
      // self-calibrating against the depletive transport: an arid interior has little
      // accumulated rain to recycle, so it stays dry, while a rainforest recharges the
      // column it sits under. Scales with surface water (accumulated rain) and with
      // temperature squared (evaporative demand — strongly tropics-weighted, replacing
      // the old latitude band so the source stays emergent), suppressed under subsidence.
      if (precipAccum[ci] > 0.01 && temp[ci] > 0.2) {
        const recycSuppress = 1 - subsidenceFactor * 0.6;
        const tempWeight = temp[ci] * temp[ci];
        const recycled = precipAccum[ci] * _moistRecycling * tempWeight * _moistRecyclRate * recycSuppress;
        moist += Math.min(_moistRecyclCap, recycled);
      }

      atmos[ci] = Math.max(0, moist);
      precipAccum[ci] += precip;
    }

    // Light diffusion every 8 steps
    if (step % 8 === 7) {
      atmosPrev.set(atmos);
      const dPrev = atmosPrev;
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

  // Combine atmospheric moisture (overall wetness) and precipitation accumulation
  // (contrast / where rain actually falls). Both normalized independently then blended.

  // Normalize atmospheric moisture
  const atmosLand = [];
  const precipLand = [];
  for (let i = 0; i < mN; i++) {
    if (!isOcean[i]) {
      if (atmos[i] > 0.001) atmosLand.push(atmos[i]);
      if (precipAccum[i] > 0.001) precipLand.push(precipAccum[i]);
    }
  }
  atmosLand.sort((a, b) => a - b);
  precipLand.sort((a, b) => a - b);

  const atmosP95 = atmosLand.length > 0 ? atmosLand[Math.floor(atmosLand.length * 0.95)] : 1;
  const atmosP05 = atmosLand.length > 0 ? atmosLand[Math.floor(atmosLand.length * 0.05)] : 0;
  const atmosRange = Math.max(0.01, atmosP95 - atmosP05);

  const precipP95 = precipLand.length > 0 ? precipLand[Math.floor(precipLand.length * 0.95)] : 1;
  const precipScale = precipP95 > 0.001 ? 1 / precipP95 : 1;

  const normalized = new Float32Array(mN);
  for (let i = 0; i < mN; i++) {
    if (isOcean[i]) {
      normalized[i] = 0.5;
    } else {
      // Atmospheric moisture: steady-state wetness (good for overall patterns)
      const aRaw = Math.max(0, (atmos[i] - atmosP05) / atmosRange);
      const aNorm = Math.pow(Math.min(1, aRaw), 0.7);

      // Precipitation accumulation: where rain falls (good for contrast)
      const pRaw = Math.min(1.3, precipAccum[i] * precipScale);
      const pNorm = Math.pow(Math.min(1, pRaw), 0.6);

      // Blend: 50% atmospheric (inland moisture penetration), 50% precip (contrast)
      let blend = aNorm * 0.5 + pNorm * 0.5;

      // Temperature capacity ceiling: cold areas can't be very wet regardless
      // of how much precipitation accumulates at the coast.
      // Steeper curve: temp 0.0→0.05, 0.2→0.25, 0.5→0.65, 0.8→1.0
      const tCap = Math.min(1, Math.pow(Math.max(0, temp[i]), 0.7) * 1.1 + 0.02);
      blend = Math.min(blend, tCap);

      normalized[i] = Math.max(0.02, Math.min(1, blend));
    }
  }

  // Smooth (3 passes) — reuse temp buffer
  const _normBuf = new Float32Array(mN);
  for (let pass = 0; pass < 3; pass++) {
    _normBuf.set(normalized);
    for (let my = 1; my < mH - 1; my++) for (let mx = 0; mx < mW; mx++) {
      if (isOcean[my * mW + mx]) continue;
      const mxL = (mx - 1 + mW) % mW, mxR = (mx + 1) % mW;
      const ci = my * mW + mx;
      normalized[ci] = _normBuf[ci] * 0.5
        + (_normBuf[my * mW + mxL] + _normBuf[my * mW + mxR]
          + _normBuf[(my - 1) * mW + mx] + _normBuf[(my + 1) * mW + mx]) * 0.125;
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
    const sxr = (ix + 1) % mW; // wrap X for seamless globe
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
