// ── Package biogeography (T.CROP_BIOGEO) ─────────────────────────────────────
// Wild ancestors have HOMELANDS. The crop model let every package compete
// wherever its climate fit, so maize (a Mesoamerican teosinte descendant) was
// domesticable in Egypt the moment irrigation supplied water, and temperate
// South America grew the planet's oldest wheat hearth — the maize anachronism
// CRADLE_PACKAGE/CROP_PHOTOPERIOD beat back kept returning through whatever door
// was open next (docs/shape-of-the-map-2026-08.md, the IRRIG_CROP block). The
// missing fact is Earth-data of the hearth-pin class: each package was
// domesticated in ONE region and SPREAD outward with farmers, so it competes for
// a tile only once it has REACHED that tile.
//
// The realization is the technique wave's own physics (popField.js devField),
// frozen per package: a STATIC climate-tolled geodesic distance from each
// package's origin over land (a real range that a finer grid resolves the same),
// computed ONCE; presence is then a threshold that GROWS with the world's leading
// agriculture — near the origin at the dawn, across the reachable land as farming
// matures (the wave of advance). No per-tick field, no clock: the reach is read
// from emergent development exactly as devField's own capacity multiplier is.
//
// The same climate toll the technique wave pays (DIFF_CLIM × total climate
// variation crossed) makes a package race ALONG its latitude band and crawl
// ACROSS bands — the Eurasian east-west advantage falls out, and a package that
// must cross the Sahara or an ocean to reach a continent effectively never does
// in prehistory. Water is a hard penalty per hop (seaborne crop transfer is late
// and rare), so New-World and Old-World packages stay separate until late.

import { T } from "./tuning.js";
import { CROP_PACKAGES } from "../cropPackages.js";
import { rNormPop } from "./tuning.js";
import { pkgSuitAt } from "./agriculture.js";

// Native domestication centres, as fractional map coords (Earth preset). Same
// admissibility class as the EARTH_HEARTH_SITES pins — a real-world fact, not a
// tuned outcome. On a PROCEDURAL map these are ignored; origins are derived from
// where each package first wins as the best domesticable crop (deriveOrigins).
// Fractional centres per package. Wheat carries the Crescent's BREADTH (the
// arc ran from the Levant through Anatolia's foothills to the Zagros — the
// Nile, Mesopotamia and Indus cradles all lie within its early diffusion, which
// is exactly the history), so the Old-World river cradles domesticate wheat
// rather than reading as sorghum for want of a nearby enough origin at the dawn.
const PACKAGE_ORIGINS = {
  wheat:   [{ fx: 0.578, fy: 0.330 }, { fx: 0.622, fy: 0.330 }, { fx: 0.694, fy: 0.344 }],  // the Fertile Crescent arc: Levant/Nile · Mesopotamia · toward the Indus
  rice:    [{ fx: 0.790, fy: 0.380 }],                    // Yangtze / monsoon Asia
  maize:   [{ fx: 0.230, fy: 0.400 }],                    // Mesoamerica
  sorghum: [{ fx: 0.520, fy: 0.430 }, { fx: 0.800, fy: 0.300 }],  // Sahel + N-China millet
  tubers:  [{ fx: 0.560, fy: 0.560 }, { fx: 0.270, fy: 0.550 }],  // tropical W-Africa + Andes/Amazonia
};

// The climate toll per edge — the SAME term the technique wave pays (DIFF_CLIM),
// so package spread and technique spread obey one physics. Read at use time.
// Water is dear but a STRAIT is not an ocean. Priced per sea tile crossed, so a
// narrow crossing (the Bosphorus, Gibraltar, the Channel, Sicily) is a modest
// toll a farming package genuinely paid in prehistory, while a real ocean
// (the Atlantic/Pacific, tens of tiles) is prohibitive and keeps the hemispheres'
// agricultures separate — which is the fact this file is for. Measured on the
// generated Earth: at 40/tile even the Nile sat 41 units from a Crescent origin
// (i.e. across a strait) and Europe was unreachable at any reach — a whole
// continent starved of farming by an off-by-a-scale constant.
const WATER_HOP = 1.2;   // climate-distance-equivalent penalty PER sea tile crossed

// A plain binary min-heap keyed on distance (module-local — the file has no other).
class MinHeap {
  constructor() { this.k = []; this.d = []; this.n = 0; }
  push(key, dist) {
    const k = this.k, d = this.d;
    let i = this.n++;
    k[i] = key; d[i] = dist;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p] <= d[i]) break;
      const tk = k[p]; k[p] = k[i]; k[i] = tk;
      const td = d[p]; d[p] = d[i]; d[i] = td;
      i = p;
    }
  }
  pop() {
    const k = this.k, d = this.d;
    const top = k[0], topD = d[0];
    const last = --this.n;
    k[0] = k[last]; d[0] = d[last];
    k.length = last; d.length = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.n && d[l] < d[m]) m = l;
      if (r < this.n && d[r] < d[m]) m = r;
      if (m === i) break;
      const tk = k[m]; k[m] = k[i]; k[i] = tk;
      const td = d[m]; d[m] = d[i]; d[i] = td;
      i = m;
    }
    return { key: top, dist: topD };
  }
}

// Origin cell for a package: the highest-suitability land tile within a small
// window of each fractional centre (Earth), or the global best where that
// package is the winner (procedural fallback). Returns [ti, …] (may be several).
function originCells(world, pkg) {
  const { tw, th, elev } = world;
  const centres = PACKAGE_ORIGINS[pkg.id];
  const out = [];
  if (centres) {
    const rr = Math.max(2, Math.round(0.03 * tw));
    for (const c of centres) {
      const cx = Math.round(c.fx * tw), cy = Math.round(c.fy * th);
      let best = -1, bestS = 0;
      for (let dy = -rr; dy <= rr; dy++) {
        const yy = cy + dy; if (yy < 0 || yy >= th) continue;
        for (let dx = -rr; dx <= rr; dx++) {
          const ti = yy * tw + (((cx + dx) % tw) + tw) % tw;
          if (elev[ti] <= 0) continue;
          const s = pkgSuitAt(world, ti, pkg);
          if (s > bestS) { bestS = s; best = ti; }
        }
      }
      if (best >= 0) out.push(best);
    }
  }
  if (!out.length) {
    // Procedural / failed window: the single global tile where this package is
    // most suitable AND wins over the others (its native niche on this world).
    let best = -1, bestS = 0;
    const N = world.N;
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) continue;
      const s = pkgSuitAt(world, ti, pkg);
      if (s <= bestS) continue;
      let winner = true;
      for (const other of CROP_PACKAGES) if (other !== pkg && pkgSuitAt(world, ti, other) > s) { winner = false; break; }
      if (winner) { bestS = s; best = ti; }
    }
    if (best >= 0) out.push(best);
  }
  return out;
}

// The static per-package geodesic distance field, climate-tolled over land with a
// hard water penalty. Computed once and cached on the world (never mutated after
// — climate change does not move a wild ancestor's homeland). Distances are in
// climate-variation units + water hops, the same currency the technique wave uses.
function ensureDistFields(world) {
  if (world._pkgDist && world._pkgDist.N === world.N) return world._pkgDist;
  const { N, tw, th, elev, temp, moist } = world;
  const ck = Math.max(1e-3, T.DIFF_CLIM || 0.8);   // the spread physics uses a real toll even if the lever is low
  const fields = {};
  const origins = {};
  for (const pkg of CROP_PACKAGES) {
    // Float64, deliberately: an f32 store with an f64 compare (`nd < dist[ni]`)
    // can hold forever after rounding — the relaxation never converges and the
    // heap index overflows 2^32 ("Invalid array length", measured). ~0.9MB/package.
    const dist = new Float64Array(N).fill(Infinity);
    const heap = new MinHeap();
    const seeds = originCells(world, pkg);
    origins[pkg.id] = seeds;
    for (const s of seeds) { dist[s] = 0; heap.push(s, 0); }
    while (heap.n > 0) {
      const { key: ti, dist: d } = heap.pop();
      if (d > dist[ti]) continue;
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ti0temp = temp[ti], ti0moist = moist[ti];
      const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      for (const ni of ns) {
        if (ni < 0) continue;
        // Water hop: a fixed penalty (crop transfer by sea is dear); land edge:
        // the climate variation crossed (races along bands, crawls across them).
        const edge = elev[ni] > 0 ? ck * (Math.abs(temp[ni] - ti0temp) + Math.abs(moist[ni] - ti0moist)) + 0.02 : WATER_HOP;
        const nd = d + edge;
        if (nd < dist[ni]) { dist[ni] = nd; heap.push(ni, nd); }
      }
    }
    fields[pkg.id] = dist;
  }
  world._pkgDist = { N, fields, origins };
  return world._pkgDist;
}

// The reach the wave of advance has carried a package by now — grows with the
// world's LEADING agriculture (emergent development, never a clock), so at the
// dawn a package sits near its origin and by maturity it has crossed its whole
// reachable band. Units match ensureDistFields (climate variation + water hops).
// GROUNDED IN THE FIELD'S OWN SCALE, after two calibration misses worth
// recording (both caught by measuring the distribution instead of eyeballing a
// map): (1) WATER_HOP at 40/tile made every strait an ocean — the Nile read 41
// units from a Crescent origin and Europe was unreachable at ANY reach, a
// continent starved of farming by an off-by-a-scale constant; (2) the reach was
// then set from a guess (2.2) against a field whose land median is 11 and whose
// p90 is 30, so it excluded Europe (4.70) while the intent was to include it.
// The honest anchor is the measured field: wheat's own Crescent→Europe distance
// is ~4.7 and Crescent→Indus ~1.5, so a mature reach of ~7.6 (BASE + DEV) covers
// a package's home band end to end, while the p90 (30) and the New-World
// crossings (~90-130, oceans at 1.2/tile over tens of tiles) stay far outside —
// the hemispheres keep their own agricultures, which is what this file is for.
// REACH_BASE is the DOMESTICATION CORE — the region whose people held the wild
// ancestor and could domesticate it independently. It must be wide enough that a
// package's own homeland always qualifies as present at the dawn: measured under
// OBSERVED climate, a 0.6 core left the Nile and Mesopotamia pins with NO package
// at all (score 0.50 fallback, armed for 7,000y instead of seating) — the crop
// gate silently un-seating the historical cradles, which is worse than the
// anachronism it was fixing. 2.5 covers the Crescent arc end to end (measured
// Crescent→Levant 1.46, →Anatolia 2.69) without reaching another band's core.
const REACH_BASE = 2.5;   // the domestication core: present here from the first
const REACH_DEV  = 7.0;   // + this × leading agriculture — the mature along-band spread

function leadAgri(world) {
  let best = 0;
  for (const s of world.settlements) { if (s.mode !== "settled") continue; const a = (s.knowledge && s.knowledge.agriculture) || 0; if (a > best) best = a; }
  return best;
}

// PUBLIC: is this package available (has it spread) at this tile? True for every
// package when the lever is off or the fields aren't built yet (byte-identical).
export function packagePresent(world, ti, pkg) {
  if (!T.CROP_BIOGEO) return true;
  const pd = world._pkgDist || ensureDistFields(world);
  const f = pd.fields[pkg.id]; if (!f) return true;
  const d = f[ti];
  if (!isFinite(d)) return false;   // unreachable (a landmass the package never reached)
  const reach = REACH_BASE + REACH_DEV * (world._bioReachDev != null ? world._bioReachDev : leadAgri(world));
  return d <= reach * rNormPop(world);
}

// ── Distance also DISCOUNTS, it does not only gate ───────────────────────────
// Presence alone made the far-travelled package win wherever it merely arrived:
// rice outscores wheat on raw suitability, so once the reach covered Europe,
// Europe grew rice — the Old-World mirror of the maize anachronism. What is
// missing is that a package is at its BEST where its wild relatives, its pests,
// its pairings and its accumulated landrace knowledge are: a crop carried a long
// way arrives as a lesser version of itself (rice did reach the Mediterranean —
// as a minor late crop, never displacing wheat). So suitability is discounted by
// distance from the origin, on the same field, saturating so a package never
// falls to zero merely for being far: mul = 1/(1 + d/ADAPT_SCALE). At the
// measured scale (Crescent→Europe ≈ 4.7) an alien package lands ~40% down —
// enough that the LOCAL package wins its own band, not enough to forbid the
// genuine long-range transfers (rice in Iberia, wheat in China).
const ADAPT_SCALE = 3.0;
export function packageAdaptMul(world, ti, pkg) {
  if (!T.CROP_BIOGEO) return 1;
  const pd = world._pkgDist; if (!pd) return 1;
  const f = pd.fields[pkg.id]; if (!f) return 1;
  const d = f[ti];
  if (!isFinite(d)) return 0;
  return 1 / (1 + d / (ADAPT_SCALE * rNormPop(world)));
}

// Cache the reach driver once per pass (leadAgri is an O(settlements) scan) so a
// per-tile query in a hot loop doesn't re-scan. Call at the top of any pass that
// will query packagePresent many times; safe to skip (falls back to a live scan).
export function refreshBioReach(world) {
  if (T.CROP_BIOGEO) world._bioReachDev = leadAgri(world);
}
