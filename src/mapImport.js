/**
 * Map import utilities for external map generators.
 *
 * Supported formats:
 *  1. Azgaar's Fantasy Map Generator — "Full JSON" export
 *  2. Heightmap images (PNG/JPG) — grayscale elevation
 */

// ── Azgaar Full-JSON import ──────────────────────────────────────────────────
// Azgaar cells are Voronoi-based.  We rasterize them onto the simulation's
// regular grid via nearest-cell lookup (a fast spatial approach).

export function parseAzgaarJSON(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const pack = data.pack;
  if (!pack || !pack.cells) throw new Error("Not a valid Azgaar Full-JSON export (missing pack.cells)");

  const cells = pack.cells;
  // cells.p = flat array [x0,y0,x1,y1,...] of cell centre coords
  // cells.h = Uint8Array of heights (0-100, sea level ~20)
  // cells.t = temperatures
  // cells.prec = precipitation
  // cells.biome = biome indices
  // cells.state = state ownership per cell
  // cells.culture = culture per cell
  // cells.pop = population per cell

  const n = cells.i ? cells.i.length : cells.h.length;
  const mapW = data.info?.width || data.settings?.mapWidth || 960;
  const mapH = data.info?.height || data.settings?.mapHeight || 560;

  // Build flat arrays if they come as typed arrays or plain arrays
  const h = asArray(cells.h, n);
  const t = cells.t ? asArray(cells.t, n) : null;
  const prec = cells.prec ? asArray(cells.prec, n) : null;
  const state = cells.state ? asArray(cells.state, n) : null;
  const culture = cells.culture ? asArray(cells.culture, n) : null;

  // Cell centre coordinates — may be a flat [x0,y0,x1,y1,...] array
  let cx, cy;
  if (cells.p && cells.p.length >= n * 2) {
    cx = new Float32Array(n);
    cy = new Float32Array(n);
    for (let i = 0; i < n; i++) { cx[i] = cells.p[i * 2]; cy[i] = cells.p[i * 2 + 1]; }
  } else if (Array.isArray(cells.p) && Array.isArray(cells.p[0])) {
    cx = new Float32Array(n);
    cy = new Float32Array(n);
    for (let i = 0; i < n; i++) { cx[i] = cells.p[i][0]; cy[i] = cells.p[i][1]; }
  } else {
    throw new Error("Cannot read cell coordinates from Azgaar export");
  }

  // Collect unique states for tribe seeding
  const stateSet = new Set();
  if (state) for (let i = 0; i < n; i++) if (state[i] > 0) stateSet.add(state[i]);
  const states = pack.states || [];

  return { n, mapW, mapH, cx, cy, h, t, prec, state, culture, stateSet, states };
}

/**
 * Rasterize Azgaar cell data onto a regular W×H grid.
 * Returns an object shaped like generateWorld() output so createTerritory()
 * can consume it directly.
 */
export function rasterizeAzgaar(parsed, W, H) {
  const { n, mapW, mapH, cx, cy, h, t: tempArr, prec, state } = parsed;
  const scaleX = mapW / W;
  const scaleY = mapH / H;

  // Build a coarse spatial grid for fast nearest-cell lookup
  const BUCKET = 8; // bucket size in output pixels
  const bw = Math.ceil(W / BUCKET), bh = Math.ceil(H / BUCKET);
  const buckets = new Array(bw * bh);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];
  for (let i = 0; i < n; i++) {
    const bx = Math.min(bw - 1, Math.floor(cx[i] / scaleX / BUCKET));
    const by = Math.min(bh - 1, Math.floor(cy[i] / scaleY / BUCKET));
    buckets[by * bw + bx].push(i);
  }

  function nearest(px, py) {
    const bx0 = Math.floor(px / BUCKET), by0 = Math.floor(py / BUCKET);
    let best = -1, bd = Infinity;
    // Search 3×3 neighbourhood of buckets
    for (let dby = -1; dby <= 1; dby++) for (let dbx = -1; dbx <= 1; dbx++) {
      const bxi = bx0 + dbx, byi = by0 + dby;
      if (bxi < 0 || bxi >= bw || byi < 0 || byi >= bh) continue;
      const bucket = buckets[byi * bw + bxi];
      for (const ci of bucket) {
        const dx = px - cx[ci] / scaleX, dy = py - cy[ci] / scaleY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = ci; }
      }
    }
    // Fallback: brute force (should rarely trigger)
    if (best < 0) {
      for (let i = 0; i < n; i++) {
        const dx = px - cx[i] / scaleX, dy = py - cy[i] / scaleY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
    }
    return best;
  }

  const elevation = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ci = nearest(x, y);
    const idx = y * W + x;

    // Height: Azgaar uses 0-100, sea level ~20.  Map to our range: ocean <0, land 0.001–0.6
    const ah = h[ci];
    if (ah < 20) {
      elevation[idx] = -0.03 - (20 - ah) / 20 * 0.12; // ocean depth
    } else {
      elevation[idx] = 0.001 + (ah - 20) / 80 * 0.55;  // land height
    }

    // Temperature: Azgaar range roughly -20 to 30+.  Normalize to 0-1.
    if (tempArr) {
      temperature[idx] = Math.max(0, Math.min(1, (tempArr[ci] + 10) / 45));
    } else {
      // Estimate from latitude
      const lat = Math.abs(y / H - 0.5) * 2;
      temperature[idx] = Math.max(0, Math.min(1, 1 - lat * 1.05 - Math.max(0, elevation[idx]) * 0.4));
    }

    // Precipitation → moisture: Azgaar range ~0-250.  Normalize to 0-1.
    if (prec) {
      moisture[idx] = Math.max(0, Math.min(1, prec[ci] / 150));
    } else {
      moisture[idx] = 0.4;
    }
  }

  // Build coastal array at tile resolution
  const RES = 2;
  const ctw = Math.ceil(W / RES), cth = Math.ceil(H / RES);
  const coastal = new Uint8Array(ctw * cth);
  for (let ty = 1; ty < cth - 1; ty++) for (let tx = 0; tx < ctw; tx++) {
    const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
    if (elevation[py * W + px] > 0) {
      outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const wx = ((tx + dx) % ctw + ctw) % ctw, wy = ty + dy;
        if (wy < 0 || wy >= cth) continue;
        const npx = Math.min(W - 1, wx * RES), npy = Math.min(H - 1, wy * RES);
        if (elevation[npy * W + npx] <= 0) { coastal[ty * ctw + tx] = 1; break outer; }
      }
    }
  }

  // Empty feature arrays (rivers regenerated by the caller from imported heightmap)
  const empty = new Uint8Array(W * H);

  // Extract tribe seed positions from Azgaar states
  const tribeSeeds = [];
  if (state && parsed.states) {
    for (const s of parsed.states) {
      if (!s || s.removed || s.i === 0) continue; // state 0 = neutral
      // Find the cell with highest population for this state as the seed
      let bestCell = -1, bestH = -Infinity;
      for (let i = 0; i < n; i++) {
        if (state[i] === s.i && h[i] > 20 && h[i] > bestH) { bestH = h[i]; bestCell = i; }
      }
      if (bestCell >= 0) {
        tribeSeeds.push({
          x: Math.round(cx[bestCell] / scaleX),
          y: Math.round(cy[bestCell] / scaleY),
          name: s.name || `State ${s.i}`,
        });
      }
    }
  }

  return {
    elevation, moisture, temperature, coastal,
    river: empty, lake: empty, floodplain: empty, delta: empty,
    oasis: empty, swamp: empty,
    width: W, height: H,
    preset: "import",
    tribeSeeds,
  };
}

// ── Heightmap image import ───────────────────────────────────────────────────
// User drops a grayscale PNG/JPG — white = high, black = low.
// We sample it onto the sim grid and derive moisture/temperature from latitude.

export function rasterizeHeightmap(imageData, imgW, imgH, W, H) {
  const elevation = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // Bilinear sample from image
    const sx = x / W * imgW, sy = y / H * imgH;
    const ix = Math.min(imgW - 1, Math.floor(sx)), iy = Math.min(imgH - 1, Math.floor(sy));
    const pi = (iy * imgW + ix) * 4;
    // Average RGB channels
    const v = (imageData[pi] + imageData[pi + 1] + imageData[pi + 2]) / 3 / 255;

    // Sea level at ~0.3 brightness
    const seaThresh = 0.3;
    if (v < seaThresh) {
      elevation[y * W + x] = -0.03 - (seaThresh - v) / seaThresh * 0.12;
    } else {
      elevation[y * W + x] = 0.001 + (v - seaThresh) / (1 - seaThresh) * 0.55;
    }

    const lat = Math.abs(y / H - 0.5) * 2;
    const e = elevation[y * W + x];
    temperature[y * W + x] = Math.max(0, Math.min(1, 1 - lat * 1.05 - Math.max(0, e) * 0.4));
    moisture[y * W + x] = Math.max(0, Math.min(1, 0.45 + (1 - lat) * 0.2 - Math.max(0, e) * 0.3));
  }

  const RES = 2;
  const ctw = Math.ceil(W / RES), cth = Math.ceil(H / RES);
  const coastal = new Uint8Array(ctw * cth);
  for (let ty = 1; ty < cth - 1; ty++) for (let tx = 0; tx < ctw; tx++) {
    const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
    if (elevation[py * W + px] > 0) {
      outer: for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const wx = ((tx + dx) % ctw + ctw) % ctw, wy = ty + dy;
        if (wy < 0 || wy >= cth) continue;
        const npx = Math.min(W - 1, wx * RES), npy = Math.min(H - 1, wy * RES);
        if (elevation[npy * W + npx] <= 0) { coastal[ty * ctw + tx] = 1; break outer; }
      }
    }
  }

  const empty = new Uint8Array(W * H);
  return {
    elevation, moisture, temperature, coastal,
    river: empty, lake: empty, floodplain: empty, delta: empty,
    oasis: empty, swamp: empty,
    width: W, height: H,
    preset: "import",
    tribeSeeds: [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function asArray(src, len) {
  if (!src) return new Float32Array(len);
  if (src.length === len) return src;
  const out = new Float32Array(len);
  for (let i = 0; i < Math.min(src.length, len); i++) out[i] = src[i];
  return out;
}

/**
 * Load an image file (PNG/JPG) and return its RGBA pixel data.
 * Returns a promise that resolves to {data, width, height}.
 */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(url);
      resolve({ data: id.data, width: img.width, height: img.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load image")); };
    img.src = url;
  });
}
