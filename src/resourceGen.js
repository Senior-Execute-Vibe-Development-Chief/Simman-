// ── Natural Resource Generation ──
// Places resource deposits on territory tiles based on geology, climate, and biome.
// Designed for 8000 BC → modern era span with era-gated availability.

// Resource definitions
// era: "all" | "early" | "mid" | "late" — when this resource becomes relevant
// Each deposit has a richness 0-1 indicating concentration at that tile.
export const RESOURCES = [
  { id: 'timber',    label: 'Timber',          color: [90, 140, 60],   era: 'all',   icon: 'T' },
  { id: 'stone',     label: 'Stone',           color: [160, 155, 145], era: 'all',   icon: 'S' },
  { id: 'copper',    label: 'Copper',          color: [200, 120, 60],  era: 'early', icon: 'Cu' },
  { id: 'tin',       label: 'Tin',             color: [180, 180, 190], era: 'early', icon: 'Sn' },
  { id: 'iron',      label: 'Iron',            color: [140, 80, 80],   era: 'mid',   icon: 'Fe' },
  { id: 'salt',      label: 'Salt',            color: [230, 225, 210], era: 'all',   icon: 'Na' },
  { id: 'horses',    label: 'Horses',          color: [170, 130, 80],  era: 'mid',   icon: 'H' },
  { id: 'precious',  label: 'Precious Metals', color: [220, 195, 60],  era: 'all',   icon: 'Au' },
  { id: 'coal',      label: 'Coal',            color: [50, 45, 40],    era: 'late',  icon: 'C' },
  { id: 'oil',       label: 'Oil',             color: [30, 30, 30],    era: 'late',  icon: 'O' },
  { id: 'gems',      label: 'Gems / Luxury',   color: [160, 60, 180],  era: 'all',   icon: 'G' },
];

export const RES_BY_ID = {};
for (const r of RESOURCES) RES_BY_ID[r.id] = r;

// Simple seeded noise for resource placement (independent of world noise)
function mkResRng(seed) {
  let s = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// Hash a tile coordinate to a pseudo-random value [0,1)
function tileHash(x, y, salt) {
  let h = (x * 374761 + y * 668265 + salt * 982451) & 0x7fffffff;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

// Biome IDs (matching WorldSim.jsx getBiomeD)
const B_TUNDRA = 4, B_TAIGA = 6, B_BOREAL = 7, B_TEMP_FOREST = 8,
  B_TEMP_RAIN = 9, B_TROP_RAIN = 10, B_SAVANNA = 11, B_GRASSLAND = 12,
  B_DESERT = 13, B_SHRUBLAND = 14, B_TROP_DRY = 15, B_ALPINE = 16,
  B_SUBTROP = 17, B_COLD_DESERT = 18;

function getBiome(e, m, t) {
  if (e <= 0) return -1; // ocean
  const demand = 0.5 + t * 0.5;
  const em = Math.min(1, m / demand);
  if (t < 0.08) return 5; // snow
  if (t < 0.15) return em > 0.4 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.25) return em > 0.35 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.38) return em > 0.45 ? B_BOREAL : em > 0.25 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.55) return em > 0.55 ? B_TEMP_RAIN : em > 0.35 ? B_TEMP_FOREST : em > 0.15 ? B_GRASSLAND : B_DESERT;
  if (t < 0.72) return em > 0.5 ? B_SUBTROP : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_SHRUBLAND : B_DESERT;
  return em > 0.5 ? B_TROP_RAIN : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_GRASSLAND : B_DESERT;
}

// Generate resource deposits for every land tile in the territory grid.
// Returns: Map<resourceId, Float32Array(tw*th)> — richness per tile (0 = none)
export function generateResources(tw, th, tElev, tTemp, tMoist, tCoast, world, seed) {
  const rng = mkResRng(seed * 7 + 31337);
  const N = tw * th;
  const RES = 2; // territory downscale factor (matches WorldSim RES)

  // Pre-compute biome + plate boundary distance per tile
  const tileBiome = new Int8Array(N);
  const nearBoundary = new Uint8Array(N); // 1 if within ~6 tiles of plate boundary
  const nearCoast = new Uint8Array(N); // distance to coast (0-8, 255 = far)

  for (let ti = 0; ti < N; ti++) {
    const e = tElev[ti], t = tTemp[ti], m = tMoist[ti];
    tileBiome[ti] = getBiome(e, m, t);
  }

  // Plate boundary proximity (only available in tectonic/earth modes)
  if (world.pixPlate) {
    const W = world.width, H = world.height;
    // Mark tiles near plate boundaries
    const plateBound = new Uint8Array(N);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
      const myP = world.pixPlate[py * W + px];
      const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dx, dy] of DIRS) {
        const nx = Math.min(W - 1, Math.max(0, px + dx * RES));
        const ny = Math.min(H - 1, Math.max(0, py + dy * RES));
        if (world.pixPlate[ny * W + nx] !== myP) { plateBound[ty * tw + tx] = 1; break; }
      }
    }
    // BFS expand to 8 tiles
    const bDist = new Uint8Array(N); bDist.fill(255);
    const q = [];
    for (let i = 0; i < N; i++) if (plateBound[i] && tElev[i] > 0) { bDist[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = bDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 8) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (bDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        bDist[ni] = cd + 1; q.push(ni);
      }
    }
    for (let i = 0; i < N; i++) nearBoundary[i] = bDist[i] < 8 ? 1 : 0;
  }

  // Coast distance BFS (simple 8-tile radius)
  {
    nearCoast.fill(255);
    const q = [];
    for (let i = 0; i < N; i++) {
      if (tCoast && tCoast[i] && tElev[i] > 0) { nearCoast[i] = 0; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = nearCoast[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 8) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (nearCoast[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        nearCoast[ni] = cd + 1; q.push(ni);
      }
    }
  }

  // Allocate richness arrays
  const deposits = {};
  for (const r of RESOURCES) deposits[r.id] = new Float32Array(N);

  // Global salt value for noise variation
  const s0 = (rng() * 99999) | 0;

  for (let ti = 0; ti < N; ti++) {
    const e = tElev[ti], t = tTemp[ti], m = tMoist[ti];
    if (e <= 0) continue; // skip ocean
    const biome = tileBiome[ti];
    const tx = ti % tw, ty = (ti - tx) / tw;
    const h = (salt) => tileHash(tx, ty, salt + s0);
    const isMountain = e > 0.25;
    const isHighland = e > 0.15;
    const isLowland = e < 0.08;
    const isBoundary = nearBoundary[ti];
    const coastDist = nearCoast[ti];

    // ── TIMBER ──
    // Forested biomes. Richness scales with moisture & temperature.
    if (biome === B_TAIGA || biome === B_BOREAL || biome === B_TEMP_FOREST ||
        biome === B_TEMP_RAIN || biome === B_TROP_RAIN || biome === B_TROP_DRY ||
        biome === B_SUBTROP) {
      let richness = 0.3 + m * 0.4 + t * 0.2;
      // Tropical rainforest = highest timber
      if (biome === B_TROP_RAIN) richness += 0.2;
      // Boreal/taiga = decent but slower growth
      if (biome === B_TAIGA || biome === B_BOREAL) richness *= 0.7;
      deposits.timber[ti] = Math.min(1, richness + (h(1) - 0.5) * 0.15);
    }

    // ── STONE ──
    // Mountains, highlands, and rocky terrain. Near-universal but concentrated in mountains.
    if (isHighland || biome === B_ALPINE || biome === B_TUNDRA) {
      let richness = 0.3;
      if (isMountain) richness = 0.6 + e * 0.5;
      if (biome === B_ALPINE) richness = 0.8;
      deposits.stone[ti] = Math.min(1, richness + (h(2) - 0.5) * 0.2);
    } else if (h(20) > 0.92) {
      // Sparse stone outcrops in lowlands
      deposits.stone[ti] = 0.15 + h(21) * 0.15;
    }

    // ── COPPER ──
    // Volcanic/tectonic zones, mountains. Concentrated near plate boundaries.
    {
      let score = 0;
      if (isBoundary && isMountain) score = 0.5 + h(3) * 0.4;
      else if (isBoundary && isHighland) score = 0.3 + h(3) * 0.3;
      else if (isMountain && h(30) > 0.85) score = 0.2 + h(31) * 0.2;
      if (score > 0) deposits.copper[ti] = Math.min(1, score);
    }

    // ── TIN ──
    // Alluvial deposits near mountains, rarer than copper. Specific geological niches.
    {
      let score = 0;
      // Alluvial tin: lowlands downstream of mountains
      if (isLowland && m > 0.3 && h(4) > 0.88) score = 0.3 + h(40) * 0.4;
      // Primary tin: mountain veins (rare)
      if (isHighland && h(41) > 0.93) score = Math.max(score, 0.25 + h(42) * 0.35);
      // Tropical tin belts (SE Asia, Nigeria, Bolivia analogs)
      if (t > 0.55 && m > 0.35 && isHighland && h(43) > 0.85) score = Math.max(score, 0.35 + h(44) * 0.3);
      if (score > 0) deposits.tin[ti] = Math.min(1, score);
    }

    // ── IRON ──
    // Widespread in mountains and hills. More common than copper/tin.
    // Banded iron formations in older geological areas, bog iron in wetlands.
    {
      let score = 0;
      if (isMountain) score = 0.4 + h(5) * 0.4;
      else if (isHighland) score = h(50) > 0.7 ? 0.2 + h(51) * 0.3 : 0;
      // Bog iron in swampy/wet lowlands
      if (isLowland && m > 0.5 && t > 0.3 && h(52) > 0.82) score = Math.max(score, 0.2 + h(53) * 0.2);
      // Massive deposits near plate boundaries (shield cratons)
      if (isBoundary && h(54) > 0.75) score = Math.min(1, score + 0.3);
      if (score > 0) deposits.iron[ti] = Math.min(1, score);
    }

    // ── SALT ──
    // Coastal (sea salt), desert evaporite basins, inland deposits.
    {
      let score = 0;
      // Coastal salt: direct ocean access
      if (coastDist === 0) score = 0.4 + h(6) * 0.3;
      else if (coastDist <= 2) score = 0.2 + h(60) * 0.2;
      // Desert salt flats / evaporites
      if (biome === B_DESERT || biome === B_COLD_DESERT) {
        if (isLowland) score = Math.max(score, 0.5 + h(61) * 0.4); // salt flats
        else score = Math.max(score, 0.15 + h(62) * 0.2);
      }
      // Inland salt deposits (rare, from ancient seas)
      if (h(63) > 0.96) score = Math.max(score, 0.3 + h(64) * 0.3);
      if (score > 0) deposits.salt[ti] = Math.min(1, score);
    }

    // ── HORSES ──
    // Grasslands, steppes, savannas. Moderate temperature, open terrain.
    // Not a mineral — represents wild horse habitat / breeding grounds.
    {
      let score = 0;
      if (biome === B_GRASSLAND || biome === B_SHRUBLAND) {
        // Steppe: the classic horse territory
        score = 0.4 + (1 - Math.abs(t - 0.45) * 3) * 0.3;
        if (e < 0.15) score += 0.15; // flat open terrain preferred
      }
      if (biome === B_SAVANNA && t > 0.45) score = Math.max(score, 0.25 + h(7) * 0.2);
      // Temperate grassland sweet spot
      if (biome === B_GRASSLAND && t > 0.35 && t < 0.60) score += 0.15;
      if (score > 0) deposits.horses[ti] = Math.min(1, score + (h(70) - 0.5) * 0.15);
    }

    // ── PRECIOUS METALS (Gold/Silver) ──
    // Volcanic zones, plate boundaries, alluvial rivers. Rare but high-value.
    {
      let score = 0;
      // Primary deposits: volcanic/tectonic mountain zones
      if (isBoundary && isMountain && h(8) > 0.7) score = 0.3 + h(80) * 0.5;
      else if (isBoundary && isHighland && h(81) > 0.8) score = 0.2 + h(82) * 0.3;
      // Alluvial gold: rivers in lowlands near mountains
      if (isLowland && m > 0.35 && h(83) > 0.9) score = Math.max(score, 0.2 + h(84) * 0.35);
      // Quartz vein gold in non-boundary mountains (rarer)
      if (isMountain && !isBoundary && h(85) > 0.92) score = Math.max(score, 0.15 + h(86) * 0.25);
      if (score > 0) deposits.precious[ti] = Math.min(1, score);
    }

    // ── COAL ──
    // Sedimentary basins: temperate swampy lowlands (ancient forests → peat → coal).
    // Also found in hilly sedimentary terrain.
    {
      let score = 0;
      // Classic coal: temperate/subtropical, moderate moisture, low-mid elevation
      if (t > 0.30 && t < 0.65 && m > 0.30 && e < 0.20 && h(9) > 0.78) {
        score = 0.3 + h(90) * 0.5;
        if (m > 0.45) score += 0.15; // wetter = more ancient swamp forest
      }
      // Highland coal seams
      if (isHighland && !isMountain && t > 0.25 && h(91) > 0.88) {
        score = Math.max(score, 0.25 + h(92) * 0.35);
      }
      // Tropical coal (younger deposits)
      if (t > 0.60 && m > 0.40 && e < 0.12 && h(93) > 0.85) {
        score = Math.max(score, 0.2 + h(94) * 0.3);
      }
      if (score > 0) deposits.coal[ti] = Math.min(1, score);
    }

    // ── OIL ──
    // Sedimentary basins, especially low-elevation areas near coasts.
    // Desert regions with ancient marine sediments. Continental shelves.
    {
      let score = 0;
      // Desert/arid sedimentary basins (Middle East, Sahara analog)
      if ((biome === B_DESERT || biome === B_SHRUBLAND) && e < 0.12 && h(10) > 0.8) {
        score = 0.4 + h(100) * 0.5;
      }
      // Coastal sedimentary (Gulf of Mexico, North Sea analogs)
      if (coastDist <= 3 && isLowland && h(101) > 0.82) {
        score = Math.max(score, 0.3 + h(102) * 0.4);
      }
      // Interior basins (less common)
      if (isLowland && m < 0.35 && t > 0.35 && h(103) > 0.9) {
        score = Math.max(score, 0.2 + h(104) * 0.3);
      }
      // Continental shelf / shallow water deposits (near coast)
      if (coastDist === 0 && h(105) > 0.85) {
        score = Math.max(score, 0.25 + h(106) * 0.35);
      }
      if (score > 0) deposits.oil[ti] = Math.min(1, score);
    }

    // ── GEMS / LUXURY ──
    // Volcanic zones (diamonds from kimberlite pipes), tropical mountains (emeralds, rubies).
    // Rare, localized, high trade value.
    {
      let score = 0;
      // Kimberlite pipes: plate boundary regions, any climate (diamonds)
      if (isBoundary && h(11) > 0.88) score = 0.3 + h(110) * 0.5;
      // Tropical/subtropical highland gems (emeralds, rubies, sapphires)
      if (t > 0.45 && isHighland && h(111) > 0.9) score = Math.max(score, 0.25 + h(112) * 0.4);
      // Alluvial gemstones (washed downstream)
      if (isLowland && t > 0.5 && m > 0.4 && h(113) > 0.93) score = Math.max(score, 0.15 + h(114) * 0.3);
      // Amber in temperate forests (fossil resin)
      if ((biome === B_TEMP_FOREST || biome === B_BOREAL) && coastDist <= 3 && h(115) > 0.92) {
        score = Math.max(score, 0.15 + h(116) * 0.25);
      }
      if (score > 0) deposits.gems[ti] = Math.min(1, score);
    }
  }

  return deposits;
}

// Get a summary of resources at a tile for display
export function tileResourceSummary(deposits, ti) {
  const result = [];
  for (const r of RESOURCES) {
    const v = deposits[r.id][ti];
    if (v > 0.05) result.push({ ...r, richness: v });
  }
  result.sort((a, b) => b.richness - a.richness);
  return result;
}

// Get the dominant (highest richness) resource at a tile, or null
export function dominantResource(deposits, ti) {
  let best = null, bestV = 0.05;
  for (const r of RESOURCES) {
    const v = deposits[r.id][ti];
    if (v > bestV) { bestV = v; best = r; }
  }
  return best;
}
