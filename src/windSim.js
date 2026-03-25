// ═══════════════════════════════════════════════════════════════════════════
// Physics-based atmospheric wind & moisture simulation
// ═══════════════════════════════════════════════════════════════════════════
//
// Models global atmospheric circulation with:
//  - Hadley, Ferrel, and Polar cells (pressure from latitude)
//  - Thermal pressure perturbations from elevation and land/ocean contrast
//  - Coriolis deflection (latitude-dependent)
//  - Terrain obstruction and orographic uplift
//  - Iterative moisture advection with orographic precipitation
//  - Convergence/divergence precipitation and drying
//
// Operates on a coarse grid (1/4 resolution) for performance, then
// interpolates results back to full resolution.

const CELL_SCALE = 4; // coarse grid divisor

/**
 * Run the full wind + moisture simulation.
 *
 * @param {Float32Array} elevation - full-res elevation (<=0 = ocean)
 * @param {Float32Array} temperature - full-res temperature (0-1)
 * @param {number} W - full width
 * @param {number} H - full height
 * @param {object} noiseKit - {fbm, noise2D} from caller
 * @param {number} seed - for noise offsets
 * @returns {{moisture: Float32Array, windU: Float32Array, windV: Float32Array}}
 *          moisture at full res, wind vectors at coarse res
 */
export function simulateWind(elevation, temperature, W, H, noiseKit, seed) {
  const { fbm, noise2D } = noiseKit;
  const cw = Math.ceil(W / CELL_SCALE);
  const ch = Math.ceil(H / CELL_SCALE);
  const cn = cw * ch;

  // ── 1. Downsample elevation and temperature to coarse grid ──
  const cElev = new Float32Array(cn);
  const cTemp = new Float32Array(cn);
  const cOcean = new Uint8Array(cn); // 1 = ocean
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const ci = cy * cw + cx;
      const px = Math.min(W - 1, cx * CELL_SCALE);
      const py = Math.min(H - 1, cy * CELL_SCALE);
      const fi = py * W + px;
      cElev[ci] = elevation[fi];
      cTemp[ci] = temperature[fi];
      cOcean[ci] = elevation[fi] <= 0 ? 1 : 0;
    }
  }

  // ── 2. Compute pressure field ──
  // Pressure = f(latitude) + thermal perturbations
  const pressure = new Float32Array(cn);
  for (let cy = 0; cy < ch; cy++) {
    const lat = Math.abs(cy / ch - 0.5) * 2; // 0 at equator, 1 at poles
    // Base pressure from atmospheric cells (Hadley/Ferrel/Polar)
    // Low pressure at equator (ITCZ) and ~60° (polar front)
    // High pressure at ~30° (subtropical ridge) and poles
    const itczLow = -Math.exp(-(lat * lat) / (2 * 0.08 * 0.08)) * 0.6;
    const subtropHigh = Math.exp(-((lat - 0.33) * (lat - 0.33)) / (2 * 0.09 * 0.09)) * 0.7;
    const polarFrontLow = -Math.exp(-((lat - 0.65) * (lat - 0.65)) / (2 * 0.08 * 0.08)) * 0.35;
    const polarHigh = Math.exp(-((lat - 0.95) * (lat - 0.95)) / (2 * 0.1 * 0.1)) * 0.4;
    const latPressure = itczLow + subtropHigh + polarFrontLow + polarHigh;

    for (let cx = 0; cx < cw; cx++) {
      const ci = cy * cw + cx;
      let p = latPressure;

      // Thermal pressure: warm land = low pressure (rising air), cold = high
      // Ocean is more thermally stable → less extreme pressure
      if (cOcean[ci]) {
        p += 0.05; // ocean slightly higher than neutral (stable)
      } else {
        // Hot land creates thermal lows; high elevation creates pressure reduction
        p -= cTemp[ci] * 0.15;
        p -= Math.max(0, cElev[ci] - 0.1) * 0.3; // altitude pressure drop
      }

      // Add noise for weather-scale variation
      const nx = cx / cw, ny = cy / ch;
      p += fbm(nx * 5 + seed * 0.01, ny * 5 + seed * 0.01, 3, 2, 0.5) * 0.08;

      pressure[ci] = p;
    }
  }

  // ── 3. Derive wind from pressure gradient + Coriolis ──
  const windU = new Float32Array(cn); // east-west component (positive = eastward)
  const windV = new Float32Array(cn); // north-south component (positive = southward)

  for (let cy = 1; cy < ch - 1; cy++) {
    const lat = Math.abs(cy / ch - 0.5) * 2;
    const hemisphere = cy / ch < 0.5 ? 1 : -1; // 1 = north, -1 = south
    // Coriolis parameter: zero at equator, max at poles
    const coriolisF = Math.sin(lat * Math.PI / 2) * 0.7;
    // Near-equator: pressure gradient flow dominates
    // Mid-latitudes: geostrophic balance (Coriolis deflects flow ~90°)
    // Blend between pure pressure-gradient flow and geostrophic flow
    const geoBlend = Math.min(1, lat * 4); // 0 at equator, 1 by lat>0.25

    for (let cx = 0; cx < cw; cx++) {
      const ci = cy * cw + cx;
      const cxE = (cx + 1) % cw;
      const cxW = (cx - 1 + cw) % cw;

      // Pressure gradient (high → low pressure)
      const dpdx = (pressure[cy * cw + cxE] - pressure[cy * cw + cxW]) / 2;
      const dpdy = (pressure[(cy + 1) * cw + cx] - pressure[(cy - 1) * cw + cx]) / 2;

      // Pure pressure gradient flow (down-gradient)
      const pgU = -dpdx * 3.0;
      const pgV = -dpdy * 3.0;

      // Geostrophic wind (perpendicular to pressure gradient, Coriolis-balanced)
      // In NH: wind flows with low pressure to the left → rotate gradient -90°
      const geoU = dpdy * hemisphere * 3.0;
      const geoV = -dpdx * hemisphere * 3.0;

      // Blend: near equator use pressure gradient, mid-lat use geostrophic
      let u = pgU * (1 - geoBlend) + geoU * geoBlend;
      let v = pgV * (1 - geoBlend) + geoV * geoBlend;

      // Surface friction reduces wind speed and turns it slightly toward low pressure
      // (Ekman spiral effect — surface winds cross isobars at ~15-30°)
      const frictionTurn = 0.25; // fraction of pressure gradient to add back
      u += pgU * frictionTurn * geoBlend;
      v += pgV * frictionTurn * geoBlend;

      // Terrain friction: mountains slow wind
      if (!cOcean[ci]) {
        const terrainDrag = 1 / (1 + Math.max(0, cElev[ci]) * 4);
        u *= terrainDrag;
        v *= terrainDrag;
      }

      windU[ci] = u;
      windV[ci] = v;
    }
  }

  // Copy edge rows
  for (let cx = 0; cx < cw; cx++) {
    windU[cx] = windU[cw + cx];
    windV[cx] = windV[cw + cx];
    windU[(ch - 1) * cw + cx] = windU[(ch - 2) * cw + cx];
    windV[(ch - 1) * cw + cx] = windV[(ch - 2) * cw + cx];
  }

  // ── 4. Iterative smoothing of wind field (simulate pressure equilibration) ──
  for (let iter = 0; iter < 3; iter++) {
    const tmpU = Float32Array.from(windU);
    const tmpV = Float32Array.from(windV);
    for (let cy = 1; cy < ch - 1; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const ci = cy * cw + cx;
        const cxE = (cx + 1) % cw;
        const cxW = (cx - 1 + cw) % cw;
        const n = (cy - 1) * cw + cx;
        const s = (cy + 1) * cw + cx;
        const e = cy * cw + cxE;
        const w = cy * cw + cxW;
        windU[ci] = tmpU[ci] * 0.5 + (tmpU[n] + tmpU[s] + tmpU[e] + tmpU[w]) * 0.125;
        windV[ci] = tmpV[ci] * 0.5 + (tmpV[n] + tmpV[s] + tmpV[e] + tmpV[w]) * 0.125;
      }
    }
  }

  // ── 5. Moisture advection ──
  // Start with ocean as moisture source, then iteratively transport moisture
  // along wind vectors, with orographic precipitation and evaporation.
  const cMoist = new Float32Array(cn);

  // Initialize: ocean cells are moisture sources
  for (let i = 0; i < cn; i++) {
    if (cOcean[i]) {
      // Warm ocean evaporates more
      cMoist[i] = 0.6 + cTemp[i] * 0.35;
    } else {
      // Land starts with small base moisture from local evapotranspiration
      cMoist[i] = 0.05;
    }
  }

  // Advection iterations: wind carries moisture from cell to cell
  const NUM_ADVECT = 18;
  for (let iter = 0; iter < NUM_ADVECT; iter++) {
    const prevMoist = Float32Array.from(cMoist);

    for (let cy = 1; cy < ch - 1; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const ci = cy * cw + cx;

        // Ocean cells replenish moisture each iteration
        if (cOcean[ci]) {
          cMoist[ci] = 0.6 + cTemp[ci] * 0.35;
          continue;
        }

        // Trace wind backwards to find upstream moisture (semi-Lagrangian)
        const u = windU[ci];
        const v = windV[ci];
        const speed = Math.sqrt(u * u + v * v);
        if (speed < 0.001) continue;

        // Source position (upwind)
        let srcX = cx - u * 0.8;
        let srcY = cy - v * 0.8;

        // Wrap X, clamp Y
        srcX = ((srcX % cw) + cw) % cw;
        srcY = Math.max(0, Math.min(ch - 1, srcY));

        // Bilinear interpolation of upstream moisture
        const sx0 = Math.floor(srcX), sy0 = Math.floor(srcY);
        const sx1 = (sx0 + 1) % cw, sy1 = Math.min(ch - 1, sy0 + 1);
        const fx = srcX - sx0, fy = srcY - sy0;
        const m00 = prevMoist[sy0 * cw + sx0];
        const m10 = prevMoist[sy0 * cw + sx1];
        const m01 = prevMoist[sy1 * cw + sx0];
        const m11 = prevMoist[sy1 * cw + sx1];
        const upstreamMoist = m00 * (1 - fx) * (1 - fy) + m10 * fx * (1 - fy)
          + m01 * (1 - fx) * fy + m11 * fx * fy;

        // Blend current moisture with upstream advected moisture
        // Stronger wind = more advection influence
        const advectStr = Math.min(0.85, speed * 0.6);
        let m = cMoist[ci] * (1 - advectStr) + upstreamMoist * advectStr;

        // ── Orographic precipitation ──
        // When wind hits rising terrain, air is forced up → cools → precipitates
        // Check elevation gradient in wind direction
        const downX = cx + Math.round(u * 0.5);
        const downY = cy + Math.round(v * 0.5);
        const dwx = ((downX % cw) + cw) % cw;
        const dwy = Math.max(0, Math.min(ch - 1, downY));
        const downElev = cElev[dwy * cw + dwx];
        const elevGrad = downElev - cElev[ci]; // positive = terrain rising downwind

        if (elevGrad > 0) {
          // Windward side: forced uplift → precipitation
          // More moisture + steeper slope = more rain
          const upliftPrecip = Math.min(m * 0.7, elevGrad * speed * m * 4.0);
          m -= upliftPrecip;
        } else if (elevGrad < -0.01) {
          // Leeward side: descending air → drying (rain shadow)
          // Foehn effect: air descends and warms, reducing relative humidity
          m *= 0.92;
        }

        // General moisture loss over land (continentality)
        m *= 0.97;

        // Local evapotranspiration adds small moisture (warm + vegetated areas)
        if (cTemp[ci] > 0.3) {
          m += cTemp[ci] * 0.008;
        }

        cMoist[ci] = Math.max(0.02, Math.min(1, m));
      }
    }
  }

  // ── 6. Wind convergence/divergence precipitation adjustment ──
  // Where winds converge → rising air → more rain
  // Where winds diverge → sinking air → drier
  for (let cy = 1; cy < ch - 1; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const ci = cy * cw + cx;
      if (cOcean[ci]) continue;

      const cxE = (cx + 1) % cw;
      const cxW = (cx - 1 + cw) % cw;
      // Divergence = du/dx + dv/dy
      const div = (windU[cy * cw + cxE] - windU[cy * cw + cxW]) / 2
        + (windV[(cy + 1) * cw + cx] - windV[(cy - 1) * cw + cx]) / 2;

      // Negative divergence (convergence) → uplift → more moisture retained
      // Positive divergence → subsidence → drying
      if (div < 0) {
        cMoist[ci] = Math.min(1, cMoist[ci] + Math.abs(div) * 0.3);
      } else {
        cMoist[ci] *= 1 - Math.min(0.3, div * 0.4);
      }
    }
  }

  // ── 7. Lateral diffusion pass (smooth out sharp edges) ──
  for (let iter = 0; iter < 2; iter++) {
    const tmp = Float32Array.from(cMoist);
    for (let cy = 1; cy < ch - 1; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const ci = cy * cw + cx;
        if (cOcean[ci]) continue;
        const cxE = (cx + 1) % cw;
        const cxW = (cx - 1 + cw) % cw;
        cMoist[ci] = tmp[ci] * 0.6
          + (tmp[(cy - 1) * cw + cx] + tmp[(cy + 1) * cw + cx]
            + tmp[cy * cw + cxE] + tmp[cy * cw + cxW]) * 0.1;
      }
    }
  }

  // ── 8. Upsample moisture to full resolution (bilinear interpolation) ──
  const moisture = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;

      if (elevation[i] <= 0) {
        // Ocean: gentle moisture variation
        const nx = x / W, ny = y / H;
        moisture[i] = 0.5 + fbm(nx * 3 + 30, ny * 3 + 30, 2, 2, 0.5) * 0.1;
        continue;
      }

      // Bilinear interpolation from coarse grid
      const cfx = x / CELL_SCALE;
      const cfy = y / CELL_SCALE;
      const cx0 = Math.floor(cfx), cy0 = Math.floor(cfy);
      const cx1 = Math.min(cw - 1, (cx0 + 1) % cw);
      const cy1 = Math.min(ch - 1, cy0 + 1);
      const fx = cfx - cx0, fy = cfy - cy0;
      const cx0c = Math.min(cw - 1, cx0);
      const cy0c = Math.min(ch - 1, cy0);

      const m00 = cMoist[cy0c * cw + cx0c];
      const m10 = cMoist[cy0c * cw + cx1];
      const m01 = cMoist[cy1 * cw + cx0c];
      const m11 = cMoist[cy1 * cw + cx1];

      let m = m00 * (1 - fx) * (1 - fy) + m10 * fx * (1 - fy)
        + m01 * (1 - fx) * fy + m11 * fx * fy;

      // Elevation adjustment at full res: high peaks are drier, lowlands wetter
      if (elevation[i] > 0.15) m -= Math.min(0.2, (elevation[i] - 0.15) * 1);
      if (elevation[i] < 0.02) m += 0.10;

      moisture[i] = Math.max(0.02, Math.min(1, m));
    }
  }

  return { moisture, windU, windV, coarseW: cw, coarseH: ch };
}
