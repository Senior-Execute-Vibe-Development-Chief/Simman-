// ── Natural Resource Generation ──
// Places resource deposits using regional noise fields for realistic clustering.
// Resources form localized deposits (not per-tile random), gated by geology/climate.

export const RESOURCES = [
  { id: 'timber',    label: 'Timber',          color: [90, 140, 60],   era: 'all',   icon: 'T' },
  { id: 'stone',     label: 'Stone',           color: [160, 155, 145], era: 'all',   icon: 'S' },
  { id: 'copper',    label: 'Copper',          color: [200, 120, 60],  era: 'early', icon: 'Cu' },
  { id: 'tin',       label: 'Tin',             color: [180, 180, 190], era: 'early', icon: 'Sn' },
  { id: 'iron',      label: 'Iron',            color: [140, 80, 80],   era: 'mid',   icon: 'Fe' },
  { id: 'salt',      label: 'Salt',            color: [230, 225, 210], era: 'all',   icon: 'Na' },
  { id: 'horses',    label: 'Horses',          color: [170, 130, 80],  era: 'mid',   icon: 'H' },
  { id: 'precious',  label: 'Precious Metals', color: [220, 195, 60],  era: 'all',   icon: 'Au' },
  { id: 'coal',      label: 'Coal',            color: [90, 70, 45],    era: 'late',  icon: 'C' },
  { id: 'oil',       label: 'Oil',             color: [60, 90, 110],   era: 'late',  icon: 'O' },
  { id: 'gems',      label: 'Gems / Luxury',   color: [160, 60, 180],  era: 'all',   icon: 'G' },
];

export const RES_BY_ID = {};
for (const r of RESOURCES) RES_BY_ID[r.id] = r;

// ── Noise primitives (independent from world noise) ──

// Simple hash-based noise for resource fields
function resHash(x, y, salt) {
  let h = (x * 374761 + y * 668265 + salt * 982451) & 0x7fffffff;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

// Value noise sampled at fractional coords — creates smooth regional fields
function valueNoise(fx, fy, salt) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const dx = fx - x0, dy = fy - y0;
  // Smoothstep
  const sx = dx * dx * (3 - 2 * dx), sy = dy * dy * (3 - 2 * dy);
  const v00 = resHash(x0, y0, salt);
  const v10 = resHash(x0 + 1, y0, salt);
  const v01 = resHash(x0, y0 + 1, salt);
  const v11 = resHash(x0 + 1, y0 + 1, salt);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

// Multi-octave value noise (fBm) for resource provinces
function resFBM(fx, fy, salt, octaves, lacunarity, gain) {
  let v = 0, amp = 1, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(fx * freq, fy * freq, salt + i * 7919) * amp;
    total += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return v / total;
}

// Deposit field: smooth noise thresholded to create isolated patches.
// Returns 0 outside deposits, 0-1 richness inside.
// freq: spatial frequency (higher = smaller, more numerous deposits)
// threshold: 0-1 (higher = rarer deposits; 0.7 means top 30% of noise becomes deposit)
function depositField(tx, ty, tw, th, salt, freq, threshold) {
  const nx = tx / tw, ny = ty / th;
  const n = resFBM(nx * freq, ny * freq, salt, 3, 2.2, 0.5);
  if (n < threshold) return 0;
  return (n - threshold) / (1 - threshold); // 0 at edge, 1 at center of deposit
}

// Biome IDs (matching WorldSim.jsx getBiomeD)
const B_TUNDRA = 4, B_TAIGA = 6, B_BOREAL = 7, B_TEMP_FOREST = 8,
  B_TEMP_RAIN = 9, B_TROP_RAIN = 10, B_SAVANNA = 11, B_GRASSLAND = 12,
  B_DESERT = 13, B_SHRUBLAND = 14, B_TROP_DRY = 15, B_ALPINE = 16,
  B_SUBTROP = 17, B_COLD_DESERT = 18;

function getBiome(e, m, t) {
  if (e <= 0) return -1;
  const demand = 0.5 + t * 0.5;
  const em = Math.min(1, m / demand);
  if (t < 0.08) return 5;
  if (t < 0.15) return em > 0.4 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.25) return em > 0.35 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.38) return em > 0.45 ? B_BOREAL : em > 0.25 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.55) return em > 0.55 ? B_TEMP_RAIN : em > 0.35 ? B_TEMP_FOREST : em > 0.15 ? B_GRASSLAND : B_DESERT;
  if (t < 0.72) return em > 0.5 ? B_SUBTROP : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_SHRUBLAND : B_DESERT;
  return em > 0.5 ? B_TROP_RAIN : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_GRASSLAND : B_DESERT;
}

export function generateResources(tw, th, tElev, tTemp, tMoist, tCoast, world, seed) {
  const N = tw * th;
  const RES = 2;

  // Pre-compute biome per tile
  const tileBiome = new Int8Array(N);
  for (let ti = 0; ti < N; ti++) {
    tileBiome[ti] = getBiome(tElev[ti], tMoist[ti], tTemp[ti]);
  }

  // Plate boundary proximity (tectonic/earth modes)
  const boundDist = new Uint8Array(N);
  boundDist.fill(255);
  if (world.pixPlate) {
    const W = world.width, H = world.height;
    const q = [];
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
      const myP = world.pixPlate[py * W + px];
      const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dx, dy] of DIRS) {
        const nx = Math.min(W - 1, Math.max(0, px + dx * RES));
        const ny = Math.min(H - 1, Math.max(0, py + dy * RES));
        if (world.pixPlate[ny * W + nx] !== myP) {
          const ti = ty * tw + tx;
          if (tElev[ti] > 0) { boundDist[ti] = 0; q.push(ti); }
          break;
        }
      }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = boundDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 12) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (boundDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        boundDist[ni] = cd + 1; q.push(ni);
      }
    }
  }

  // Coast distance BFS
  const coastDist = new Uint8Array(N);
  coastDist.fill(255);
  {
    const q = [];
    for (let i = 0; i < N; i++) {
      if (tCoast && tCoast[i] && tElev[i] > 0) { coastDist[i] = 0; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = coastDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 12) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (coastDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        coastDist[ni] = cd + 1; q.push(ni);
      }
    }
  }

  // Allocate
  const deposits = {};
  for (const r of RESOURCES) deposits[r.id] = new Float32Array(N);

  // Salt offset for seed variation
  const s0 = ((seed * 16807 + 31337) % 99991) | 0;

  for (let ti = 0; ti < N; ti++) {
    const e = tElev[ti], t = tTemp[ti], m = tMoist[ti];
    if (e <= 0) continue;
    const biome = tileBiome[ti];
    const tx = ti % tw, ty = (ti - tx) / tw;
    const isMountain = e > 0.25;
    const isHighland = e > 0.15;
    const isLowland = e < 0.08;
    const bd = boundDist[ti];
    const cd = coastDist[ti];
    const hasBoundary = bd < 12;

    // ── TIMBER ──
    // Forest biomes with regional variation — not every forest tile has harvestable timber
    {
      const isForest = biome === B_TAIGA || biome === B_BOREAL || biome === B_TEMP_FOREST ||
        biome === B_TEMP_RAIN || biome === B_TROP_RAIN || biome === B_TROP_DRY || biome === B_SUBTROP;
      if (isForest) {
        const field = depositField(tx, ty, tw, th, s0 + 100, 8, 0.25);
        if (field > 0) {
          let richness = field * 0.5;
          if (biome === B_TROP_RAIN || biome === B_TEMP_RAIN) richness += 0.35;
          else if (biome === B_TEMP_FOREST || biome === B_SUBTROP) richness += 0.25;
          else if (biome === B_TAIGA || biome === B_BOREAL) richness += 0.12;
          deposits.timber[ti] = Math.min(1, richness);
        }
      }
    }

    // ── STONE ──
    // Mountains, highlands, desert exposures — regional quarry-quality deposits
    {
      let score = 0;
      if (isMountain || biome === B_ALPINE) {
        const field = depositField(tx, ty, tw, th, s0 + 200, 10, 0.30);
        if (field > 0) score = 0.3 + field * 0.7;
      } else if (isHighland) {
        const field = depositField(tx, ty, tw, th, s0 + 201, 12, 0.45);
        if (field > 0) score = 0.2 + field * 0.5;
      } else if (biome === B_DESERT || biome === B_COLD_DESERT) {
        const field = depositField(tx, ty, tw, th, s0 + 202, 14, 0.55);
        if (field > 0) score = 0.15 + field * 0.35;
      }
      if (score > 0) deposits.stone[ti] = Math.min(1, score);
    }

    // ── COPPER ──
    // Highland/mountain copper belts + scattered mountain deposits
    {
      let score = 0;
      // Large copper provinces (like Andes belt, African Copperbelt)
      const province = depositField(tx, ty, tw, th, s0 + 300, 5, 0.60);
      if (province > 0 && (isMountain || isHighland)) {
        score = province * 0.7;
        if (hasBoundary) score += (1 - bd / 12) * 0.3;
      }
      // Smaller scattered deposits in any mountain area
      if (score === 0 && isMountain) {
        const spot = depositField(tx, ty, tw, th, s0 + 301, 16, 0.78);
        if (spot > 0) score = spot * 0.45;
      }
      // Highland deposits outside major belts
      if (score === 0 && isHighland) {
        const minor = depositField(tx, ty, tw, th, s0 + 302, 14, 0.82);
        if (minor > 0) score = minor * 0.3;
      }
      if (score > 0) deposits.copper[ti] = Math.min(1, score);
    }

    // ── TIN ──
    // Rare. Concentrated belts + alluvial deposits near highlands.
    {
      let score = 0;
      // Tin belts: rare large-scale provinces
      const belt = depositField(tx, ty, tw, th, s0 + 400, 5, 0.72);
      if (belt > 0) {
        if (isHighland || isMountain) score = belt * 0.6;
        else if (isLowland && m > 0.25) score = belt * 0.45; // alluvial
      }
      // Tropical tin (SE Asia, Nigeria, Bolivia analogs)
      if (score === 0 && t > 0.45 && (isHighland || isLowland)) {
        const tropBelt = depositField(tx, ty, tw, th, s0 + 401, 7, 0.75);
        if (tropBelt > 0) score = tropBelt * 0.45;
      }
      if (score > 0) deposits.tin[ti] = Math.min(1, score);
    }

    // ── IRON ──
    // Common mineral. Shield deposits + mountain veins + bog iron.
    {
      let score = 0;
      // Shield/craton BIF deposits: large, moderate elevation, ancient geology
      const shield = depositField(tx, ty, tw, th, s0 + 500, 5, 0.50);
      if (shield > 0 && e > 0.02 && e < 0.35) {
        score = shield * 0.8;
      }
      // Mountain/highland veins
      if (isHighland || isMountain) {
        const mtnIron = depositField(tx, ty, tw, th, s0 + 501, 9, 0.55);
        if (mtnIron > 0) score = Math.max(score, mtnIron * 0.65);
      }
      // Bog iron: wet temperate lowlands
      if (isLowland && m > 0.40 && t > 0.28) {
        const bog = depositField(tx, ty, tw, th, s0 + 502, 15, 0.70);
        if (bog > 0) score = Math.max(score, bog * 0.35);
      }
      if (score > 0) deposits.iron[ti] = Math.min(1, score);
    }

    // ── SALT ──
    // Coastal pans, desert evaporites, inland domes. Regional clustering.
    {
      let score = 0;
      // Coastal salt: warm/dry coasts
      if (cd <= 3) {
        const saltCoast = depositField(tx, ty, tw, th, s0 + 600, 10, 0.50);
        if (saltCoast > 0) {
          score = saltCoast * 0.5;
          if (t > 0.40 && m < 0.50) score += 0.2; // warm dry coasts better
        }
      }
      // Desert evaporite basins
      if ((biome === B_DESERT || biome === B_COLD_DESERT || biome === B_SHRUBLAND) && e < 0.15) {
        const evap = depositField(tx, ty, tw, th, s0 + 601, 7, 0.45);
        if (evap > 0) score = Math.max(score, evap * 0.8);
      }
      // Inland rock salt domes (any climate, rarer)
      {
        const dome = depositField(tx, ty, tw, th, s0 + 602, 16, 0.82);
        if (dome > 0 && e > 0) score = Math.max(score, dome * 0.5);
      }
      if (score > 0) deposits.salt[ti] = Math.min(1, score);
    }

    // ── HORSES ──
    // Grasslands and steppes. Large contiguous regions, not tiny patches.
    {
      let score = 0;
      const isSteppe = biome === B_GRASSLAND || biome === B_SHRUBLAND;
      const isSavanna = biome === B_SAVANNA;
      if (isSteppe && t > 0.20 && t < 0.65 && e < 0.25) {
        // Low threshold = large contiguous horse country
        const field = depositField(tx, ty, tw, th, s0 + 700, 5, 0.25);
        if (field > 0) {
          score = 0.25 + field * 0.45;
          const tempFit = 1 - Math.abs(t - 0.45) * 2.5;
          score += Math.max(0, tempFit) * 0.25;
        }
      }
      if (isSavanna && t > 0.40 && e < 0.18) {
        const field = depositField(tx, ty, tw, th, s0 + 701, 7, 0.45);
        if (field > 0) score = Math.max(score, 0.15 + field * 0.35);
      }
      if (score > 0) deposits.horses[ti] = Math.min(1, score);
    }

    // ── PRECIOUS METALS (Gold/Silver) ──
    // Clustered gold/silver belts + alluvial + isolated veins.
    {
      let score = 0;
      // Major gold provinces
      const belt = depositField(tx, ty, tw, th, s0 + 800, 5, 0.73);
      if (belt > 0) {
        if (isMountain || isHighland) score = belt * 0.75;
        else if (isLowland && m > 0.25) score = belt * 0.4; // alluvial
        else if (e > 0.02) score = belt * 0.2; // traces
      }
      if (hasBoundary && score > 0) score = Math.min(1, score + (1 - bd / 12) * 0.2);
      // Isolated vein deposits
      if (score === 0 && (isMountain || isHighland)) {
        const vein = depositField(tx, ty, tw, th, s0 + 801, 18, 0.82);
        if (vein > 0) score = vein * 0.4;
      }
      if (score > 0) deposits.precious[ti] = Math.min(1, score);
    }

    // ── COAL ──
    // Temperate sedimentary basins. Multiple overlapping noise fields for coverage.
    {
      let score = 0;
      const isCoalClimate = t > 0.25 && t < 0.65 && m > 0.22;
      // Primary coalfields
      if (isCoalClimate && e < 0.25) {
        const field = depositField(tx, ty, tw, th, s0 + 900, 6, 0.55);
        if (field > 0) {
          score = field * 0.65;
          if (m > 0.35) score += 0.15;
          if (e < 0.12) score += 0.10;
        }
      }
      // Secondary coalfields (different noise = different locations)
      if (isCoalClimate && e < 0.20) {
        const field2 = depositField(tx, ty, tw, th, s0 + 902, 8, 0.60);
        if (field2 > 0) score = Math.max(score, field2 * 0.55 + (m > 0.35 ? 0.1 : 0));
      }
      // Highland coal seams
      if (isHighland && !isMountain && t > 0.22) {
        const seam = depositField(tx, ty, tw, th, s0 + 901, 12, 0.68);
        if (seam > 0) score = Math.max(score, seam * 0.5);
      }
      if (score > 0) deposits.coal[ti] = Math.min(1, score);
    }

    // ── OIL ──
    // Sedimentary basins with multiple province noise fields.
    {
      let score = 0;
      // Desert/arid basins (Middle East, N.Africa, Central Asia)
      if ((biome === B_DESERT || biome === B_SHRUBLAND || biome === B_SAVANNA) && e < 0.18) {
        const basin = depositField(tx, ty, tw, th, s0 + 1000, 5, 0.52);
        if (basin > 0) score = basin * 0.8;
      }
      // Coastal/deltaic basins (Niger Delta, Gulf of Mexico, North Sea)
      if (cd <= 5 && e < 0.10) {
        const coastal = depositField(tx, ty, tw, th, s0 + 1001, 8, 0.60);
        if (coastal > 0) score = Math.max(score, coastal * 0.65);
      }
      // Interior basins (West Texas, Siberian, Permian)
      if (e < 0.12 && m < 0.45) {
        const interior = depositField(tx, ty, tw, th, s0 + 1002, 7, 0.62);
        if (interior > 0) score = Math.max(score, interior * 0.55);
      }
      if (score > 0) deposits.oil[ti] = Math.min(1, score);
    }

    // ── GEMS / LUXURY ──
    // Rare. Multiple small deposit types.
    {
      let score = 0;
      // Diamond provinces (kimberlite — cratonic interiors)
      {
        const pipe = depositField(tx, ty, tw, th, s0 + 1100, 5, 0.72);
        if (pipe > 0 && e > 0.02) {
          score = pipe * 0.6;
          if (hasBoundary) score += 0.15;
        }
      }
      // Highland gem belts (rubies, emeralds, sapphires)
      if (t > 0.35 && isHighland) {
        const gemBelt = depositField(tx, ty, tw, th, s0 + 1101, 6, 0.68);
        if (gemBelt > 0) score = Math.max(score, gemBelt * 0.55);
      }
      // Alluvial gemstones (tropical lowlands)
      if (t > 0.40 && isLowland && m > 0.30) {
        const alluvial = depositField(tx, ty, tw, th, s0 + 1103, 10, 0.72);
        if (alluvial > 0) score = Math.max(score, alluvial * 0.4);
      }
      // Coastal amber
      if ((biome === B_TEMP_FOREST || biome === B_BOREAL) && cd <= 5) {
        const amber = depositField(tx, ty, tw, th, s0 + 1102, 12, 0.78);
        if (amber > 0) score = Math.max(score, amber * 0.35);
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
