// ── Earth plate raster ─────────────────────────────────────────────────────
// Bird 2003 PB2002 polygons + typed boundary segments, upsampled onto the
// Earth heightmap. Same class of preset-gated Earth fact as NCEP climate:
// observed geometry, not a fitted "Andes = volcanoes" outcome. A subduction
// segment produces a volcanic arc wherever those plates meet.
//
// Hotspots are not in PB2002 (they are not plate edges). Skipping them
// deletes Hawaii / Yellowstone / Afar volcanism, so they stay as a short
// geographic list stamped on top of the Bird raster.

import { PW, PH, CODES, PLATE_RLE, KIND_RLE } from "./earthPlateRaster.js";

export const BK_NONE = 0;
export const BK_RIDGE = 1;
export const BK_TRANSFORM = 2;
export const BK_SUBDUCTION = 3;
export const BK_COLLISION = 4;
export const BK_HOTSPOT = 5;

export { PW, PH, CODES };

function codeId(code) {
  const i = CODES.indexOf(code);
  return i > 0 ? i : 0;
}

export const PAC = codeId("PA"), NAM = codeId("NA"), EUR = codeId("EU"),
  AFR = codeId("AF"), SAM = codeId("SA"), ANT = codeId("AN"), AUS = codeId("AU"),
  IND = codeId("IN"), NAZ = codeId("NZ"), COC = codeId("CO"), CAR = codeId("CA"),
  ARA = codeId("AR"), PHI = codeId("PS"), JDF = codeId("JF"), SCO = codeId("SC"),
  SUN = codeId("SU"), SOM = codeId("SO"), AP = codeId("AP"), ND = codeId("ND"),
  OKH = codeId("OK");

// Typed pairs for neighbour-fallback when a pixel sits on a plate seam the
// 0.5° kind raster did not paint. Unlisted adjacent pairs default to transform.
const PAIRS = [
  [NAM, EUR, BK_RIDGE], [NAM, AFR, BK_RIDGE], [SAM, AFR, BK_RIDGE],
  [AFR, ANT, BK_RIDGE], [SAM, ANT, BK_RIDGE], [AUS, ANT, BK_RIDGE],
  [PAC, NAZ, BK_RIDGE], [PAC, COC, BK_RIDGE], [PAC, ANT, BK_RIDGE],
  [AFR, SOM, BK_RIDGE], [AFR, ARA, BK_RIDGE], [NAM, JDF, BK_RIDGE],
  [PAC, NAM, BK_SUBDUCTION], [PAC, EUR, BK_SUBDUCTION], [PAC, PHI, BK_SUBDUCTION],
  [NAZ, SAM, BK_SUBDUCTION], [NAZ, AP, BK_SUBDUCTION], [NAZ, ND, BK_SUBDUCTION],
  [COC, NAM, BK_SUBDUCTION], [PAC, AUS, BK_SUBDUCTION],
  [AUS, SUN, BK_SUBDUCTION], [PHI, EUR, BK_SUBDUCTION], [PAC, SUN, BK_SUBDUCTION],
  [PAC, OKH, BK_SUBDUCTION],
  [SCO, SAM, BK_SUBDUCTION], [SCO, ANT, BK_SUBDUCTION], [JDF, NAM, BK_SUBDUCTION],
  [CAR, NAM, BK_SUBDUCTION], [CAR, SAM, BK_SUBDUCTION],
  [IND, EUR, BK_COLLISION], [AFR, EUR, BK_COLLISION], [ARA, EUR, BK_COLLISION],
  [AUS, EUR, BK_COLLISION], [IND, SUN, BK_COLLISION],
];

const PAIR_MAP = new Map();
for (const [a, b, k] of PAIRS) {
  if (!a || !b) continue;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  PAIR_MAP.set((lo << 8) | hi, k);
}

export function kindOfPair(a, b) {
  if (!a || !b || a === b) return BK_NONE;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  return PAIR_MAP.get((lo << 8) | hi) || BK_TRANSFORM;
}

export const HOTSPOTS = [
  { lat: 19.4, lon: -155.3 },   // Hawaii
  { lat: 44.4, lon: -110.7 },   // Yellowstone
  { lat: 64.4, lon: -17.3 },    // Iceland
  { lat: 11.5, lon: 41.8 },     // Afar
  { lat: -21.1, lon: 55.5 },    // Réunion
  { lat: -0.4, lon: -91.5 },    // Galápagos
  { lat: 38.5, lon: -28.0 },    // Azores
  { lat: 28.1, lon: -16.6 },    // Canary
  { lat: -49.0, lon: 69.5 },    // Kerguelen
  { lat: -17.6, lon: -149.6 },  // Society / Tahiti
  { lat: -14.3, lon: -170.1 },  // Samoa
  { lat: -27.1, lon: -109.3 },  // Easter
  { lat: -3.0, lon: 36.2 },     // Kenya / EARS
  { lat: 0.4, lon: 6.7 },       // Cameroon line
  { lat: 46.0, lon: -130.0 },   // Cobb
];

export function lonLatToIndex(lon, lat, W, H) {
  const x = ((Math.round((lon + 180) / 360 * W) % W) + W) % W;
  const y = Math.max(0, Math.min(H - 1, Math.round((90 - lat) / 180 * H)));
  return y * W + x;
}

function decodeRLE(b64, n) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i + 1 < bin.length && o < n;) {
    const v = bin[i++], c = bin[i++];
    out.fill(v, o, o + c);
    o += c;
  }
  return out;
}

let _srcPlate = null, _srcKind = null;
function sourceRasters() {
  if (_srcPlate) return;
  const n = PW * PH;
  _srcPlate = decodeRLE(PLATE_RLE, n);
  _srcKind = decodeRLE(KIND_RLE, n);
}

function sampleSrc(arr, lon, lat) {
  const x = ((Math.floor((lon + 180) / 360 * PW) % PW) + PW) % PW;
  const y = Math.max(0, Math.min(PH - 1, Math.floor((90 - lat) / 180 * PH)));
  return arr[y * PW + x];
}

export function rasterizeEarthPlates(W, H) {
  sourceRasters();
  const N = W * H;
  const pixPlate = new Uint8Array(N);
  const boundKind = new Uint8Array(N);
  const hotspotDist = new Uint8Array(N);
  hotspotDist.fill(255);

  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    for (let x = 0; x < W; x++) {
      const lon = (x + 0.5) / W * 360 - 180;
      const i = y * W + x;
      pixPlate[i] = sampleSrc(_srcPlate, lon, lat);
      boundKind[i] = sampleSrc(_srcKind, lon, lat);
    }
  }

  // Neighbour fallback: a seam the 0.5° kind brush missed still gets a type.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (boundKind[i]) continue;
      const me = pixPlate[i];
      const nbs = [
        pixPlate[y * W + ((x + 1) % W)],
        pixPlate[y * W + ((x - 1 + W) % W)],
        y > 0 ? pixPlate[i - W] : me,
        y < H - 1 ? pixPlate[i + W] : me,
      ];
      let kind = BK_NONE;
      for (let k = 0; k < 4; k++) {
        if (nbs[k] === me) continue;
        const t = kindOfPair(me, nbs[k]);
        if (t > kind) kind = t;
      }
      boundKind[i] = kind;
    }
  }

  const degPx = W / 360;
  const cap = Math.max(4, Math.round(4 * degPx));
  const q = [];
  for (const h of HOTSPOTS) {
    const i = lonLatToIndex(h.lon, h.lat, W, H);
    hotspotDist[i] = 0;
    boundKind[i] = Math.max(boundKind[i], BK_HOTSPOT);
    q.push(i);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cd = hotspotDist[ci];
    if (cd >= cap) continue;
    const cx = ci % W, cy = (ci - cx) / W;
    const nbs = [
      cy * W + ((cx + 1) % W),
      cy * W + ((cx - 1 + W) % W),
      cy > 0 ? ci - W : -1,
      cy < H - 1 ? ci + W : -1,
    ];
    for (let k = 0; k < 4; k++) {
      const ni = nbs[k];
      if (ni < 0 || hotspotDist[ni] <= cd + 1) continue;
      hotspotDist[ni] = cd + 1;
      if (boundKind[ni] < BK_HOTSPOT && hotspotDist[ni] <= Math.max(2, cap >> 1)) {
        boundKind[ni] = BK_HOTSPOT;
      }
      q.push(ni);
    }
  }

  return { pixPlate, boundKind, hotspotDist };
}

/** Chebyshev-ish BFS distance to a plate-id change, capped. Tests / probes. */
export function plateBoundDist(pixPlate, W, H, cap = 24) {
  const N = W * H;
  const dist = new Uint8Array(N);
  dist.fill(255);
  const q = [];
  for (let i = 0; i < N; i++) {
    const x = i % W, y = (i - x) / W;
    const me = pixPlate[i];
    const nbs = [
      pixPlate[y * W + ((x + 1) % W)],
      pixPlate[y * W + ((x - 1 + W) % W)],
      y > 0 ? pixPlate[i - W] : me,
      y < H - 1 ? pixPlate[i + W] : me,
    ];
    for (let k = 0; k < 4; k++) {
      if (nbs[k] !== me) { dist[i] = 0; q.push(i); break; }
    }
  }
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cd = dist[ci];
    if (cd >= cap) continue;
    const cx = ci % W, cy = (ci - cx) / W;
    const nbs = [
      cy * W + ((cx + 1) % W),
      cy * W + ((cx - 1 + W) % W),
      cy > 0 ? ci - W : -1,
      cy < H - 1 ? ci + W : -1,
    ];
    for (let k = 0; k < 4; k++) {
      const ni = nbs[k];
      if (ni < 0 || dist[ni] <= cd + 1) continue;
      dist[ni] = cd + 1;
      q.push(ni);
    }
  }
  return dist;
}
