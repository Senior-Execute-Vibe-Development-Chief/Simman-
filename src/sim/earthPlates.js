// ── Earth plate raster ─────────────────────────────────────────────────────
// Compact Bird/PB2002-class model: plate interiors as Voronoi seeds (lon/lat),
// typed pairs for the boundaries that matter geologically, plus a short
// hotspot list. Rasterized onto the Earth heightmap so existing boundDist
// BFS (resourceGen, pipeline volcanic soil, tileMaterials) has something to
// start from. Does NOT rebuild elevation — plates classify geology, they
// do not grow mountains.
//
// This is the same class of preset-gated Earth fact as crop PACKAGE_ORIGINS:
// observed plate geometry, not a fitted "Andes = volcanoes" outcome. A
// subduction pair produces a volcanic arc wherever those plates meet.

export const BK_NONE = 0;
export const BK_RIDGE = 1;
export const BK_TRANSFORM = 2;
export const BK_SUBDUCTION = 3;
export const BK_COLLISION = 4;
export const BK_HOTSPOT = 5;

export const PAC = 1, NAM = 2, EUR = 3, AFR = 4, SAM = 5, ANT = 6, AUS = 7,
  IND = 8, NAZ = 9, COC = 10, CAR = 11, ARA = 12, PHI = 13, JDF = 14,
  SCO = 15, SUN = 16, SOM = 17;

// Interior seeds. Several per plate so Voronoi follows the real outline
// well enough for boundary proximity (the quantity resourceGen already
// consumes). Coordinates are geographic lon/lat.
const SEEDS = [
  // Pacific
  [180, 0, PAC], [160, 12, PAC], [-155, 5, PAC], [170, -22, PAC],
  [-130, -12, PAC], [150, 22, PAC], [-160, -25, PAC], [175, 30, PAC],
  // North America
  [-100, 45, NAM], [-110, 58, NAM], [-90, 40, NAM], [-150, 62, NAM],
  [-80, 46, NAM], [-105, 32, NAM], [-120, 50, NAM], [-68, 48, NAM],
  // Eurasia
  [20, 52, EUR], [40, 55, EUR], [80, 56, EUR], [120, 60, EUR],
  [10, 48, EUR], [60, 48, EUR], [100, 42, EUR], [135, 62, EUR],
  [30, 42, EUR], [90, 50, EUR],
  // Africa
  [15, 8, AFR], [20, -10, AFR], [25, -22, AFR], [0, 16, AFR],
  [12, -2, AFR], [18, 22, AFR],
  // South America
  [-60, -10, SAM], [-65, -25, SAM], [-55, -4, SAM], [-70, -40, SAM],
  [-50, -15, SAM],
  // Antarctica
  [0, -80, ANT], [90, -80, ANT], [-90, -80, ANT], [180, -75, ANT],
  [45, -75, ANT], [-135, -75, ANT],
  // Australia
  [135, -25, AUS], [145, -20, AUS], [125, -28, AUS], [150, -35, AUS],
  [118, -24, AUS],
  // India
  [78, 18, IND], [80, 10, IND], [72, 22, IND],
  // Nazca
  [-95, -15, NAZ], [-100, -25, NAZ], [-88, -8, NAZ],
  // Cocos
  [-100, 12, COC], [-95, 8, COC],
  // Caribbean
  [-75, 15, CAR], [-68, 16, CAR],
  // Arabia
  [48, 22, ARA], [45, 17, ARA], [52, 20, ARA],
  // Philippine Sea
  [130, 15, PHI], [135, 12, PHI], [138, 20, PHI],
  // Juan de Fuca
  [-128, 46, JDF],
  // Scotia
  [-45, -57, SCO], [-30, -58, SCO],
  // Sunda
  [110, 2, SUN], [120, 6, SUN], [100, 4, SUN], [115, -4, SUN],
  // Somalia (East African Rift counterpart)
  [45, 4, SOM], [42, -6, SOM], [48, -2, SOM],
];

// Typed pairs. Unlisted adjacent pairs default to transform (weak volcanism).
const PAIRS = [
  // Ridges / rifts
  [NAM, EUR, BK_RIDGE], [NAM, AFR, BK_RIDGE], [SAM, AFR, BK_RIDGE],
  [AFR, ANT, BK_RIDGE], [SAM, ANT, BK_RIDGE], [AUS, ANT, BK_RIDGE],
  [PAC, NAZ, BK_RIDGE], [PAC, COC, BK_RIDGE], [PAC, ANT, BK_RIDGE],
  [AFR, SOM, BK_RIDGE], [AFR, ARA, BK_RIDGE], [NAM, JDF, BK_RIDGE],
  // Subduction
  [PAC, NAM, BK_SUBDUCTION], [PAC, EUR, BK_SUBDUCTION], [PAC, PHI, BK_SUBDUCTION],
  [NAZ, SAM, BK_SUBDUCTION], [COC, NAM, BK_SUBDUCTION], [PAC, AUS, BK_SUBDUCTION],
  [AUS, SUN, BK_SUBDUCTION], [PHI, EUR, BK_SUBDUCTION], [PAC, SUN, BK_SUBDUCTION],
  [SCO, SAM, BK_SUBDUCTION], [SCO, ANT, BK_SUBDUCTION], [JDF, NAM, BK_SUBDUCTION],
  [CAR, NAM, BK_SUBDUCTION], [CAR, SAM, BK_SUBDUCTION],
  // Collision
  [IND, EUR, BK_COLLISION], [AFR, EUR, BK_COLLISION], [ARA, EUR, BK_COLLISION],
  [AUS, EUR, BK_COLLISION], [IND, SUN, BK_COLLISION],
];

const PAIR_MAP = new Map();
for (const [a, b, k] of PAIRS) {
  const lo = a < b ? a : b, hi = a < b ? b : a;
  PAIR_MAP.set((lo << 8) | hi, k);
}

export function kindOfPair(a, b) {
  if (!a || !b || a === b) return BK_NONE;
  const lo = a < b ? a : b, hi = a < b ? b : a;
  return PAIR_MAP.get((lo << 8) | hi) || BK_TRANSFORM;
}

// Hotspots are not plate edges. Skipping them deletes Hawaii / Yellowstone /
// Afar / Iceland volcanism. Positions are geographic lon/lat; radius is
// degrees (the raster stamps a distance field in pixels).
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

function angDist2(lon1, lat1, lon2, lat2) {
  let dLon = lon1 - lon2;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const mlat = (lat1 + lat2) * 0.5 * Math.PI / 180;
  const dx = dLon * Math.cos(mlat);
  const dy = lat1 - lat2;
  return dx * dx + dy * dy;
}

function plateAtLonLat(lon, lat) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SEEDS.length; i++) {
    const [slon, slat, id] = SEEDS[i];
    const d = angDist2(lon, lat, slon, slat);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}

export function rasterizeEarthPlates(W, H) {
  const N = W * H;
  const pixPlate = new Uint8Array(N);
  const boundKind = new Uint8Array(N);
  const hotspotDist = new Uint8Array(N);
  hotspotDist.fill(255);

  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    for (let x = 0; x < W; x++) {
      const lon = (x + 0.5) / W * 360 - 180;
      pixPlate[y * W + x] = plateAtLonLat(lon, lat);
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
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
