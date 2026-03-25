// ══════════════════════════════════════════════════════════════════
// Single-layer wind solver with FIXED pressure field.
// Pressure is prescribed (three-cell belts + noise), never modified.
// Wind iterates toward geostrophic balance with friction + terrain.
// ══════════════════════════════════════════════════════════════════

export function solveWind(W, H, elevation, fbm, params = {}, noiseSeed = 42) {
const p = (k, d) => params[k] !== undefined ? params[k] : d;
const s3 = noiseSeed;

// ── Coarse grid (4x downscale) ──
const WG = 4, wW = Math.ceil(W / WG), wH = Math.ceil(H / WG);
const N = wW * wH;

// ── Geography ──
const wElev = new Float32Array(N);
const _oceanDrag = p("oceanDrag", 0.04);
const _landDrag = p("landDrag", 0.35);
const drag = new Float32Array(N);
for (let wy = 0; wy < wH; wy++) for (let wx = 0; wx < wW; wx++) {
  const px = Math.min(W - 1, wx * WG), py = Math.min(H - 1, wy * WG);
  const e0 = elevation[py * W + px];
  const i = wy * wW + wx;
  wElev[i] = Math.max(0, e0);
  if (e0 <= 0) {
    drag[i] = _oceanDrag;
  } else {
    drag[i] = Math.max(_oceanDrag * 2, _landDrag - e0 * _landDrag * 0.5);
  }
}

// ── FIXED pressure field (never modified during iteration) ──
// Three-cell belt structure + FBM noise for longitude variation.
const _pScale = p("pressureScale", 4.0);
const _threeCellStr = p("threeCellStrength", 1.0);
const pressure = new Float32Array(N);
for (let wy = 0; wy < wH; wy++) {
  const latFrac = Math.abs(wy / wH - 0.5) * 2; // 0=equator, 1=pole
  const sinLat = Math.sin(latFrac * Math.PI / 2);
  const sin2 = sinLat * sinLat, sin4 = sin2 * sin2;
  const latTemp = 1 - 0.65 * sin2 - 0.35 * sin4;
  const latDeg = latFrac * 90;
  const subtropHigh = Math.exp(-((latDeg - 30) * (latDeg - 30)) / 144);
  const subpolarLow = -0.6 * Math.exp(-((latDeg - 60) * (latDeg - 60)) / 100);
  const itczLow = -0.4 * Math.exp(-((latDeg - 5) * (latDeg - 5)) / 64);
  const anomaly = (subtropHigh + subpolarLow + itczLow) * _threeCellStr;
  const baseP = -latTemp * _pScale + anomaly * _pScale;
  for (let wx = 0; wx < wW; wx++) {
    const nx = wx / wW, ny = wy / wH;
    const noise = fbm(nx * 4 + s3 + 300, ny * 4 + s3 + 300, 2, 2, 0.5) * 0.15 * _pScale;
    pressure[wy * wW + wx] = baseP + noise;
  }
}

// ── Wind arrays ──
const windX = new Float32Array(N);
const windY = new Float32Array(N);
const _fMax = p("coriolisStrength", 0.25);

// ── Geostrophic wind initialization ──
// u_g = -(1/f) dp/dy, v_g = (1/f) dp/dx * cos(lat)
for (let wy = 1; wy < wH - 1; wy++) {
  const latSigned = (wy / wH - 0.5) * 2;
  const f = -Math.sin(latSigned * Math.PI / 2) * _fMax;
  const fSign = f >= 0 ? 1 : -1;
  const fSafe = fSign * Math.max(Math.abs(f), _fMax * 0.15);
  const cosLat = Math.cos(Math.abs(latSigned) * Math.PI / 2);
  for (let wx = 0; wx < wW; wx++) {
    const i = wy * wW + wx;
    const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
    const dpdy = (pressure[(wy + 1) * wW + wx] - pressure[(wy - 1) * wW + wx]) * 0.5;
    const dpdx = (pressure[wy * wW + wr] - pressure[wy * wW + wl]) * 0.5;
    windX[i] = -(1 / fSafe) * dpdy * 0.3;
    windY[i] = (1 / fSafe) * dpdx * cosLat * 0.3;
  }
}

// ── Main solver: iterate toward steady state ──
const _windIter = p("windSolverIter", 30);
const dt = 0.5;
const visc = 0.04;
const _tDefl = p("terrainDeflect", 5.0);

for (let iter = 0; iter < _windIter; iter++) {

  // Semi-Lagrangian advection (propagates terrain wakes downstream)
  if (iter > 0) {
    const prevX = new Float32Array(windX);
    const prevY = new Float32Array(windY);
    const advDt = 0.8;
    for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const dx2 = Math.max(-2, Math.min(2, prevX[i] * advDt));
      const dy2 = Math.max(-2, Math.min(2, prevY[i] * advDt));
      const sx = ((wx - dx2) % wW + wW) % wW;
      const sy = Math.max(1, Math.min(wH - 2, wy - dy2));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const fx = sx - ix, fy = sy - iy;
      const ix1 = (ix + 1) % wW, iy1 = Math.min(wH - 2, iy + 1);
      const ax = prevX[iy * wW + ix] * (1 - fx) * (1 - fy) + prevX[iy * wW + ix1] * fx * (1 - fy)
               + prevX[iy1 * wW + ix] * (1 - fx) * fy + prevX[iy1 * wW + ix1] * fx * fy;
      const ay = prevY[iy * wW + ix] * (1 - fx) * (1 - fy) + prevY[iy * wW + ix1] * fx * (1 - fy)
               + prevY[iy1 * wW + ix] * (1 - fx) * fy + prevY[iy1 * wW + ix1] * fx * fy;
      windX[i] = ax * 0.6 + prevX[i] * 0.4;
      windY[i] = ay * 0.6 + prevY[i] * 0.4;
    }
  }

  // Momentum equation: v += dt * (-∇p + f×v - kf·v) + visc·∇²v + terrain deflection
  const tmpX = new Float32Array(windX);
  const tmpY = new Float32Array(windY);
  for (let wy = 1; wy < wH - 1; wy++) {
    const latSigned = (wy / wH - 0.5) * 2;
    const f = -Math.sin(latSigned * Math.PI / 2) * _fMax;
    const cosLat = Math.cos(Math.abs(latSigned) * Math.PI / 2);
    for (let wx = 0; wx < wW; wx++) {
      const i = wy * wW + wx;
      const wl = (wx - 1 + wW) % wW, wr = (wx + 1) % wW;
      const nl = wy * wW + wl, nr = wy * wW + wr;
      const nu = (wy - 1) * wW + wx, nd = (wy + 1) * wW + wx;

      // Pressure gradient force (fixed pressure, cos(lat) corrected)
      const pgfX = -(pressure[nr] - pressure[nl]) * 0.5 * cosLat;
      const pgfY = -(pressure[nd] - pressure[nu]) * 0.5;

      // Coriolis + Drag + Laplacian diffusion
      const corX = -f * tmpY[i], corY = f * tmpX[i];
      const kf = drag[i];
      const drgX = -kf * tmpX[i], drgY = -kf * tmpY[i];
      const lapX = (tmpX[nl] + tmpX[nr] + tmpX[nu] + tmpX[nd]) * 0.25 - tmpX[i];
      const lapY = (tmpY[nl] + tmpY[nr] + tmpY[nu] + tmpY[nd]) * 0.25 - tmpY[i];

      let vx = tmpX[i] + dt * (pgfX + corX + drgX) + visc * lapX;
      let vy = tmpY[i] + dt * (pgfY + corY + drgY) + visc * lapY;

      // Froude number terrain deflection
      const px = Math.min(W - 1, wx * WG), py = Math.min(H - 1, wy * WG);
      const eC = Math.max(0, elevation[py * W + px]);
      if (eC > 0.01) {
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed > 1e-6) {
          const Fr = speed / Math.max(0.001, eC * _tDefl);
          const blockFrac = Math.max(0, Math.min(0.95, 1 - Fr));
          if (blockFrac > 0.01) {
            const pxL = (px - WG + W) % W, pxR = (px + WG) % W;
            const pyU = Math.max(0, py - WG), pyD = Math.min(H - 1, py + WG);
            const gx = (Math.max(0, elevation[py * W + pxR]) - Math.max(0, elevation[py * W + pxL])) * 0.5;
            const gy = (Math.max(0, elevation[pyD * W + px]) - Math.max(0, elevation[pyU * W + px])) * 0.5;
            const gm2 = gx * gx + gy * gy;
            if (gm2 > 1e-8) {
              const gm = Math.sqrt(gm2);
              const dot = vx * gx + vy * gy;
              if (dot > 0) {
                const rmX = blockFrac * dot * gx / gm2;
                const rmY = blockFrac * dot * gy / gm2;
                vx -= rmX; vy -= rmY;
                const perpX = -gy / gm, perpY = gx / gm;
                const tang = vx * perpX + vy * perpY;
                const redir = Math.sqrt(rmX * rmX + rmY * rmY) * 0.7;
                vx += (tang >= 0 ? 1 : -1) * perpX * redir;
                vy += (tang >= 0 ? 1 : -1) * perpY * redir;
              }
            } else {
              vx *= (1 - blockFrac * 0.5);
              vy *= (1 - blockFrac * 0.5);
            }
          }
        }
      }

      windX[i] = vx;
      windY[i] = vy;
    }
  }
} // end iterations

// ── Post-processing ──
const _windScale = p("windScale", 1.0);
const _windContrast = p("windContrast", 1.0);
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

// Sub-grid turbulence eddies
const _eddyOcean = p("eddyStrength", 0.015);
const _eddyLand = _eddyOcean * 0.4;
for (let wy = 1; wy < wH - 1; wy++) for (let wx = 0; wx < wW; wx++) {
  const i = wy * wW + wx;
  const nx = wx / wW, ny = wy / wH;
  const eps = 0.003;
  const n0 = fbm(nx * 6 + s3 + 100, ny * 6 + s3 + 100, 3, 2, 0.5);
  const nDx = fbm((nx + eps) * 6 + s3 + 100, ny * 6 + s3 + 100, 3, 2, 0.5);
  const nDy = fbm(nx * 6 + s3 + 100, (ny + eps) * 6 + s3 + 100, 3, 2, 0.5);
  const amp = wElev[i] > 0 ? _eddyLand : _eddyOcean;
  windX[i] += (nDy - n0) / eps * amp;
  windY[i] -= (nDx - n0) / eps * amp;
}

// ── Bilinear upscale to full resolution ──
const fullWindX = new Float32Array(W * H);
const fullWindY = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
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

return { windX: fullWindX, windY: fullWindY };
}
