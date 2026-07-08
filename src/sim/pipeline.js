// ── World pipeline: worldgen output → simulation-ready territory ──
// The second half of world generation: rivers, river/lake moisture boosts,
// geological fertility modifiers, crop suitability (tCrop — the sim's
// fertility array), crossing difficulty (tCross — overlay), and resource
// deposits. Pure and isomorphic: used identically by the browser app
// (WorldSim), both workers, and the node tools harness — THE single source
// of truth; the tools no longer carry a hand-synced copy.

import { generateWorld } from "./worldgen.js";
import { computeRivers, RIVER_STREAM } from "./riverGen.js";
import { cropSuitability } from "./cropGen.js";
import { generateResources } from "./resourceGen.js";
import { baseEdgeCost } from "./peopleSim/transport.js";
import { computeRelief } from "./worldgenUtils.js";
import { mkRng, hash32 } from "./peopleSim/rng.js";
import { T } from "./peopleSim/tuning.js";

// Base climate fertility: temperature fitness × moisture bell curve, penalized by elevation
// Temperature fitness uses a COLD GATE (calibrated air-temp scale t=0.60+°C/100):
// near-zero below ~-3°C (short-season high latitudes — far-N Europe, Siberia are
// marginal), full by ~+10°C, broad warm plateau, gentle roll-off in extreme heat.
// Kept in sync with the tCrop bell below. Moisture bell peaks at 0.45.
export function tileFert(t,m,e){if(e>0.45)return 0.01;
const tFactor=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);
const mFactor=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));
const base=tFactor*mFactor;
return Math.max(0.01,base*(1-Math.max(0,e-0.15)*3));}

export const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

// ── Deep ancestry: a pre-history PEOPLING simulation ───────────────────────
// Homo sapiens filled the world tens of millennia BEFORE farming, so ancestry is
// laid down here, at worldgen — civilisation (the cradles) is a far later overlay.
// Instead of scattering populations evenly, we SIMULATE the peopling: one origin
// in the deep tropics spreads as a wavefront across the habitable world over "deep
// time" — slowed by mountains/desert, needing coastal HOPS over water, crossing the
// cold north and narrow straits (Bering / Sahul land-bridges) only LATE, so the
// Americas and deep Pacific are reached last. Each tile records its ARRIVAL time;
// RESIDENCE (time-since-settled) is how long that region has had to branch into
// distinct peoples. Anchors are then seeded with density ∝ residence × habitability,
// so long-settled livable land (Africa, the fertile belts) holds MANY small peoples
// while the late-reached frontier (the Americas) or thin land (arid Australia, the
// high north) holds a FEW broad ones — the real shape of human genetic diversity.
// Regions grow from the anchors by the same barrier-aware cost-distance, so their
// boundaries fall on oceans, ranges and deserts.
const ANC_BARRIER_W = 11;     // mountains / desert (tDiff) resistance to gene flow
const ANC_OCEAN_STEP= 6;      // base per-tile cost to cross water at the shoreline (a coastal hop / narrow strait)
const ANC_OCEAN_DEEP= 1.8;    // …multiplied by this PER TILE of distance from the nearest shore, so wide oceans
                              // (mid-Atlantic, deep Pacific) grow exponentially dear and stay uncrossable until boats,
                              // while short straits (Bering, Gibraltar, Bab-el-Mandeb, the Sunda→Sahul island hops) stay cheap
const ANC_CLIMATE_W = 9;      // resistance per unit of climate (temp+moisture) change across an edge
const ANC_ICE_TEMP  = 0.33;   // below this ≈ permanent ice: no anchors, no ancestry (uninhabited)
const ANC_ICE_STEP  = 13;     // …and ice is a strong barrier to migration
const ANC_SEP_DENSE = 0.030;  // finest people-spacing where carrying capacity is highest (wet tropics, New Guinea highlands)
const ANC_SEP_SPARSE= 0.17;   // broadest spacing in barren land (desert, tundra) — the floor for both founders and the fill
const ANC_SEP_FOUND = 0.090;  // founder spacing in rich land (the broad migration-wave layer; capacity widens it toward SPARSE)
const ANC_ISO_W     = 1.3;    // broken terrain (tDiff) packs in more peoples — but only where there's capacity to feed them
const ANC_HEAT_ARID = 0.35;   // how much heat raises evaporative demand (aridity): separates hot desert from hot rainforest
const ANC_FRONTIER_THIN = 0.85;  // serial-founder genetic bottleneck: deep-ancestry richness lost with distance from Africa (quadratic, so it bites the late frontier — Americas/Australia — and spares the Old World, which holds few DEEP lineages however many tribes the land could feed)
const ANC_POLAR_LAT = 0.80;   // a landmass whose northernmost tile is below this (fraction of height) is polar/uninhabited (Antarctica)
const ANC_COAST_FAST = 0.24;  // warm coastal land migrates faster — the prehistoric "beachcomber" highway: the southern coastal route ran along WARM shorelines (rich shellfish/forage) far quicker than the interior, carrying people to SE Asia and on to Sahul early, while the cold northern route to Beringia/the Americas got no such boost (so the Americas stay the LAST frontier)
const ANC_COAST_WARM = 0.45;  // …only coasts at least this warm count as the beachcomber highway (a frozen Arctic shore is no fast lane)
const ANC_HOP_FREE   = 4;     // near-shore water (≤ this many tiles from land) crosses at the flat shore cost — island-hopping a strait; the open-ocean exponential only bites BEYOND it, so Wallacea is passable early while the wide Atlantic/Pacific stay shut
const ANC_RESIDENCE_P = 1.3;  // in-situ subdivision ACCUMULATES with residence time: a region's peoples ∝ (time inhabited)^this, so the ancient homeland fragments deeply while a freshly-peopled frontier stays coarse however rich the land
function generateAncestry(tw, th, tElev, tTemp, tMoist, tDiff, tFert, seed, preset) {
  const N = tw * th;
  const anc = new Int16Array(N); anc.fill(-1);
  const rng = mkRng(hash32(seed >>> 0, "ancestry"));
  // Distance (in tiles) from every water tile to the nearest shore — 0 on land,
  // 1 for coastal water, growing out into the open ocean. Drives the crossing
  // penalty: a strait stays a 1-tile hop, but the middle of an ocean is far from
  // any land and therefore astronomically costly to reach.
  const distLand = new Int32Array(N);
  { const q = new Int32Array(N); let h = 0, t = 0;
    for (let ti = 0; ti < N; ti++) { if (tElev[ti] > 0) { distLand[ti] = 0; q[t++] = ti; } else distLand[ti] = 0x3fffffff; }
    while (h < t) { const ti = q[h++], d = distLand[ti] + 1, ty = (ti / tw) | 0, tx = ti - ty * tw;
      for (let k = 0; k < 4; k++) { const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue; const ni = ny * tw + ((tx + DIRS[k][0] + tw) % tw);
        if (distLand[ni] > d) { distLand[ni] = d; q[t++] = ni; } } } }
  // Coastal land (a land tile touching the sea): the prehistoric migration highway.
  // The southern "beachcomber" route ran along the shore far faster than through the
  // interior — the mechanism that carried people across southern Asia to Sahul early,
  // long before the continental interiors (Siberia, central Asia) filled in.
  const isCoast = new Uint8Array(N);
  for (let ti = 0; ti < N; ti++) { if (tElev[ti] <= 0) continue; const ty = (ti / tw) | 0, tx = ti - ty * tw;
    for (let k = 0; k < 4; k++) { const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue; const ni = ny * tw + ((tx + DIRS[k][0] + tw) % tw);
      if (tElev[ni] <= 0) { isCoast[ti] = 1; break; } } }
  // Barrier-aware step cost between adjacent tiles, shared by the peopling spread
  // and the ancestry growth: mountains/desert slow gene flow; ice is a strong but
  // passable barrier; open water costs ANC_OCEAN_STEP at the shore and rises by
  // ANC_OCEAN_DEEP for every tile further out, so coastal hops and narrow straits
  // pass while open oceans don't (no trans-Atlantic peopling before boats).
  const stepCost = (from, to, diag) => (
    tElev[to] <= 0 ? ANC_OCEAN_STEP * Math.pow(ANC_OCEAN_DEEP, Math.min(Math.max(0, distLand[to] - ANC_HOP_FREE), 16)) * diag
    : tTemp[to] < ANC_ICE_TEMP ? ANC_ICE_STEP * diag
    : (1 + tDiff[to] * ANC_BARRIER_W + (Math.abs(tTemp[to] - tTemp[from]) + Math.abs(tMoist[to] - tMoist[from])) * ANC_CLIMATE_W) * (isCoast[to] && tTemp[to] >= ANC_COAST_WARM ? ANC_COAST_FAST : 1) * diag
  );
  // Reusable binary-heap Dijkstra. `sources`: seed tiles. If `label` is given, each
  // tile is stamped with its nearest source's index. Returns the cost field.
  const dijkstra = (sources, label) => {
    const dist = new Float64Array(N); dist.fill(Infinity);
    let cap = N + 16, hti = new Int32Array(cap), hd = new Float64Array(cap), hn = 0;
    const push = (ti, d) => {
      if (hn + 1 >= cap) { cap *= 2; const a1 = new Int32Array(cap); a1.set(hti); hti = a1; const a2 = new Float64Array(cap); a2.set(hd); hd = a2; }
      let i = ++hn; hti[i] = ti; hd[i] = d;
      while (i > 1) { const p = i >> 1; if (hd[p] <= hd[i]) break; const a = hti[p], b = hd[p]; hti[p] = hti[i]; hd[p] = hd[i]; hti[i] = a; hd[i] = b; i = p; }
    };
    for (let s = 0; s < sources.length; s++) { const ti = sources[s]; dist[ti] = 0; if (label) label[ti] = s; push(ti, 0); }
    while (hn > 0) {
      const ti = hti[1], d = hd[1];
      hti[1] = hti[hn]; hd[1] = hd[hn]; hn--;
      { let i = 1; for (;;) { const l = i * 2, r = l + 1; let b = i; if (l <= hn && hd[l] < hd[b]) b = l; if (r <= hn && hd[r] < hd[b]) b = r; if (b === i) break; const a = hti[b], c = hd[b]; hti[b] = hti[i]; hd[b] = hd[i]; hti[i] = a; hd[i] = c; i = b; } }
      if (d > dist[ti]) continue;
      const ty = (ti / tw) | 0, tx = ti - ty * tw, lab = label ? label[ti] : 0;
      for (let k = 0; k < 8; k++) {
        const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + ((tx + DIRS[k][0] + tw) % tw);
        const nd = d + stepCost(ti, ni, (DIRS[k][0] && DIRS[k][1]) ? Math.SQRT2 : 1);
        if (nd < dist[ni]) { dist[ni] = nd; if (label) label[ni] = lab; push(ni, nd); }
      }
    }
    return dist;
  };

  // 1. ORIGIN — the cradle of the species: warm, watered, deep inside the LARGEST
  // landmass (≈ Africa on an Earth map). Interior-ness via distance to the sea,
  // weighted by landmass size so a big tropical continent beats a small one.
  const distSea = new Int32Array(N); distSea.fill(0x3fffffff);
  const comp = new Int32Array(N); comp.fill(-1); const compSize = [], compMinRow = [];
  { const q = new Int32Array(N); let h = 0, t = 0;
    for (let ti = 0; ti < N; ti++) if (tElev[ti] <= 0) { distSea[ti] = 0; q[t++] = ti; }
    while (h < t) { const ti = q[h++], d = distSea[ti] + 1, ty = (ti / tw) | 0, tx = ti - ty * tw;
      for (let k = 0; k < 4; k++) { const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue; const ni = ny * tw + ((tx + DIRS[k][0] + tw) % tw);
        if (distSea[ni] > d) { distSea[ni] = d; q[t++] = ni; } } }
    for (let s = 0; s < N; s++) { if (tElev[s] <= 0 || comp[s] >= 0) continue;
      const cid = compSize.length; let sz = 0, minRow = th; h = 0; t = 0; q[t++] = s; comp[s] = cid;
      while (h < t) { const ti = q[h++]; sz++; const ty = (ti / tw) | 0, tx = ti - ty * tw; if (ty < minRow) minRow = ty;
        for (let k = 0; k < 8; k++) { const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue; const ni = ny * tw + ((tx + DIRS[k][0] + tw) % tw);
          if (tElev[ni] > 0 && comp[ni] < 0) { comp[ni] = cid; q[t++] = ni; } } }
      compSize.push(sz); compMinRow.push(minRow); } }
  const polar = compMinRow.map(mr => mr > th * ANC_POLAR_LAT);   // a landmass entirely in the deep south (Antarctica) — uninhabited
  let maxComp = 1; for (const sz of compSize) if (sz > maxComp) maxComp = sz;
  // On Earth maps, hard-code the cradle of Homo sapiens at the East African Rift
  // (Lake Turkana / Omo basin, ≈4°N 37°E) where the fossil record actually places
  // our genesis. Equirectangular projection: x=(lon+180)/360, y=(90−lat)/180,
  // north at top — snapping outward to the nearest warm tile of the main landmass
  // so a coarse grid that puts that pixel just offshore still lands in Africa.
  // On procedural worlds Earth coordinates are meaningless, so fall back to the
  // computed cradle: warm, watered, deep inside the largest continent.
  let origin = -1;
  if (preset === "earth" || preset === "earth_sim") {
    const cx = Math.round(((37 + 180) / 360) * tw), cy = Math.round(((90 - 4) / 180) * th);
    for (let r = 0; r <= Math.max(tw, th) && origin < 0; r++) {
      let bestTi = -1, bestSz = -1;
      for (let dy = -r; dy <= r; dy++) { const y = cy + dy; if (y < 0 || y >= th) continue;
        for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;   // ring at radius r
          const x = ((cx + dx) % tw + tw) % tw, ti = y * tw + x;
          if (tElev[ti] > 0 && tTemp[ti] >= ANC_ICE_TEMP && comp[ti] >= 0 && !polar[comp[ti]]) {
            const sz = compSize[comp[ti]]; if (sz > bestSz) { bestSz = sz; bestTi = ti; }   // prefer Afro-Eurasia over an island
          } } }
      if (bestTi >= 0) origin = bestTi;
    }
  }
  if (origin < 0) {
    let best = -Infinity;
    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] <= 0 || tTemp[ti] < ANC_ICE_TEMP) continue;
      const warm = Math.exp(-((tTemp[ti] - 0.74) * (tTemp[ti] - 0.74)) / (2 * 0.12 * 0.12));   // deep-tropical optimum
      const score = warm * (0.3 + 0.7 * Math.min(1, tFert[ti] / 0.5)) * Math.min(36, distSea[ti]) * (compSize[comp[ti]] / maxComp) * (0.85 + 0.3 * rng());
      if (score > best) { best = score; origin = ti; }
    }
  }
  if (origin < 0) return { tAncestry: anc, ancestryCount: 0 };

  // 2. PEOPLING — spread the origin population from the cradle; arrival = cost-time.
  const arrival = dijkstra([origin], null);
  // Normalise by the 98th-percentile land arrival, NOT the raw max: a few very
  // remote islands (reachable only by long open-water voyages, now hugely costly)
  // would otherwise blow up the scale and squash every continent toward "just
  // settled". Anything past the percentile clamps to 1 (the last frontier).
  const arrSorted = [];
  for (let ti = 0; ti < N; ti++) if (tElev[ti] > 0 && tTemp[ti] >= ANC_ICE_TEMP && !polar[comp[ti]] && isFinite(arrival[ti])) arrSorted.push(arrival[ti]);
  arrSorted.sort((a, b) => a - b);
  const maxArr = Math.max(1e-9, arrSorted.length ? arrSorted[Math.floor((arrSorted.length - 1) * 0.98)] : 1e-9);

  // Normalised arrival time of the peopling wavefront (0 at the cradle → 1 at the
  // last-reached frontier): WHEN each tile is first peopled. Infinity = no ancestry.
  const arrN = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) arrN[ti] = (tElev[ti] > 0 && tTemp[ti] >= ANC_ICE_TEMP && isFinite(arrival[ti])) ? Math.min(1, arrival[ti] / maxArr) : Infinity;

  // 3. LINEAGES — peoples placed by CARRYING CAPACITY; divergence set by TIME.
  // Forager carrying capacity (≈ net primary productivity: warm × wet — rich in the
  // wet tropics, poor in desert & tundra; NOT agricultural tFert, which scorns the
  // rainforest) sets how MANY peoples a land holds. Each is a local population of
  // ~fixed size, so its territory scales as 1/capacity — New Guinea & Amazonia pack
  // dense mosaics, the Sahara & outback hold a few sprawling groups. WHEN a lineage
  // splits (birth, any time after its ground was settled) sets how DEEPLY it has
  // diverged, which the colouring shows: Africa's old splits run deep, recent
  // frontiers stay shallow. Every lineage keeps a BIRTH time and a PARENT for the
  // fission replay and the relatedness palette.
  const cap = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) {
    if (arrN[ti] >= Infinity) { cap[ti] = 0; continue; }
    const warm = Math.min(1, Math.max(0, (tTemp[ti] - 0.34) / 0.40));   // cold → 0, warm-temperate and up → 1
    // Aridity index: heat raises evaporative demand, so the same rainfall feeds
    // fewer in a hot place. This separates hot DESERTS (Sahara, outback) from hot
    // RAINFOREST (Congo, Amazon) that the flat simulated moisture alone cannot.
    const effMoist = tMoist[ti] - ANC_HEAT_ARID * Math.max(0, tTemp[ti] - 0.55);
    const wet  = Math.min(1, Math.max(0, (effMoist - 0.28) / 0.45));    // arid → 0, wet → 1 (Liebig: both needed)
    cap[ti] = warm * wet;
  }
  const ax = [], ay = [], aBirth = [], aParent = [];
  const land = [];
  for (let ti = 0; ti < N; ti++) if (arrN[ti] < Infinity && !polar[comp[ti]]) land.push(ti);
  for (let k = land.length - 1; k > 0; k--) { const j = rng.int(k + 1); const tt = land[k]; land[k] = land[j]; land[j] = tt; }
  // nearest existing lineage to (x,y) → [index, squared tile distance] (torus x)
  const nearestAnchor = (x, y) => { let best = -1, bd = Infinity;
    for (let a = 0; a < ax.length; a++) { let dx = Math.abs(x - ax[a]); if (dx > tw / 2) dx = tw - dx; const dy = y - ay[a]; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = a; } }
    return [best, bd]; };
  // Pass A — founders: the broad lineages seeded as the wavefront passes (born
  // when their ground is first reached). Spacing also widens where the land is
  // barren, so a desert/tundra carries only a sprawling people or two; greedy
  // placement still guarantees at least one per isolated landmass.
  for (const ti of land) {
    const x = ti % tw, y = (ti / tw) | 0;
    const fdens = Math.min(1, Math.pow(cap[ti], 1.3) * (1 + 0.5 * Math.min(1, tDiff[ti])) * (1 - ANC_FRONTIER_THIN * arrN[ti] * arrN[ti]));
    const fsep = Math.min(ANC_SEP_SPARSE, ANC_SEP_FOUND / Math.sqrt(Math.max(fdens, 0.05))) * tw;
    const [par, bd] = nearestAnchor(x, y);
    if (par >= 0 && bd < fsep * fsep) continue;
    ax.push(x); ay.push(y); aBirth.push(arrN[ti] < Infinity ? arrN[ti] : 1); aParent.push(-1);
  }
  // Pass B — population fill: extra peoples where the land can FEED them, spacing
  // ∝ 1/√capacity so the COUNT tracks population not area, tightened by terrain
  // isolation. Born some time after settling, splitting off the nearest older line.
  const subs = [];
  for (const ti of land) {
    const x = ti % tw, y = (ti / tw) | 0;
    // In-situ diversification ACCUMULATES with residence time: a region peopled at
    // genesis fragments into a deep mosaic over the millennia, while a freshly-reached
    // frontier holds only its founders however rich the land. (1−arrN) is the time
    // inhabited; capacity × terrain isolation set the diversification RATE. This is
    // what makes the ancient homeland far more subdivided than the recent frontier
    // (instead of capacity alone, which let rich New-World land match Africa).
    const dens = Math.min(1, Math.pow(cap[ti], 1.7) * (1 + ANC_ISO_W * Math.min(1, tDiff[ti])) * Math.pow(1 - arrN[ti], ANC_RESIDENCE_P));
    if (dens < 0.05) continue;
    const birth = arrN[ti] + (1 - arrN[ti]) * rng();
    const sep = Math.min(ANC_SEP_SPARSE, ANC_SEP_DENSE / Math.sqrt(dens)) * tw;
    subs.push([x, y, birth, sep * sep]);
  }
  subs.sort((p, q) => p[2] - q[2]);                             // oldest splits first → parents exist before children
  for (const s of subs) {
    const [par, bd] = nearestAnchor(s[0], s[1]);
    if (par >= 0 && bd < s[3]) continue;
    ax.push(s[0]); ay.push(s[1]); aBirth.push(s[2]); aParent.push(par);
  }
  const K = ax.length;
  if (!K) return { tAncestry: anc, ancestryCount: 0 };

  // 4. GROW lineage regions from the anchors (nearest by the same barrier cost).
  const src = new Array(K); for (let a = 0; a < K; a++) src[a] = ay[a] * tw + ax[a];
  dijkstra(src, anc);

  // 5. sea, permanent ice and polar landmasses carried gene flow but hold no ancestry.
  for (let ti = 0; ti < N; ti++) if (tElev[ti] <= 0 || tTemp[ti] < ANC_ICE_TEMP || (comp[ti] >= 0 && polar[comp[ti]])) anc[ti] = -1;
  const tArrival = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) tArrival[ti] = anc[ti] < 0 ? -1 : (arrN[ti] < Infinity ? arrN[ti] : 1);

  // Colour by RELATEDNESS: founders sorted by birth (Africa first) get base hues
  // spread around the wheel; every descendant keeps its founder's family hue,
  // drifting a little per generation and shading by sub-lineage. So the map reads
  // as ancestry families radiating out of Africa — the deepest, most-subdivided
  // African trees spread widest in hue, while the shallow frontier stays uniform.
  // Colour by RELATEDNESS via a circular layout of the lineage tree. Each subtree
  // owns an arc of the hue wheel sized by its DIVERGENCE (older lineages weigh
  // more), so the deep, early African splits fan across a wide span of hues while
  // the shallow, recent out-of-Africa branches stay clustered — the genetic truth
  // that the biggest differences in humanity are WITHIN Africa. Sibling lineages
  // sit on neighbouring hues; lineages an old split apart land far across the wheel.
  const ancHue = new Float32Array(K), ancLight = new Float32Array(K);
  { const kids = Array.from({ length: K }, () => []); const rootsL = [];
    for (let a = 0; a < K; a++) { if (aParent[a] < 0) rootsL.push(a); else kids[aParent[a]].push(a); }
    const subW = new Float32Array(K);
    const wOf = (n) => { let w = (1 - aBirth[n]) + 0.2; for (const c of kids[n]) w += wOf(c); subW[n] = w; return w; };   // older lineages weigh more → wider arc
    for (const r of rootsL) wOf(r);
    const layout = (n, lo, hi) => {
      ancHue[n] = ((lo + hi) / 2) % 360;
      const cs = kids[n].slice().sort((a, b) => aBirth[a] - aBirth[b]);
      let tot = 0; for (const c of cs) tot += subW[c];
      let cur = lo; for (const c of cs) { const w = (hi - lo) * subW[c] / (tot || 1); layout(c, cur, cur + w); cur += w; }
    };
    const rs = rootsL.slice().sort((a, b) => aBirth[a] - aBirth[b]);
    let tot = 0; for (const r of rs) tot += subW[r];
    let cur = 0; for (const r of rs) { const w = 360 * subW[r] / (tot || 1); layout(r, cur, cur + w); cur += w; }
    const jit = (id) => ((Math.imul(id + 1, 2654435761) >>> 0) / 4294967296) - 0.5;
    for (let a = 0; a < K; a++) ancLight[a] = 52 + jit(a) * 12;                       // slight per-lineage shade ~46–58%
  }
  return { tAncestry: anc, ancestryCount: K, tArrival, ancBirth: Float32Array.from(aBirth), ancParent: Int32Array.from(aParent), ancHue, ancLight, ancOriginFx: (origin % tw) / tw, ancOriginFy: ((origin / tw) | 0) / th };
}

export function buildTerritory(w,RES=1){
const tw=Math.ceil(w.width/RES),th=Math.ceil(w.height/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th),tDiff=new Float32Array(tw*th);
// Pass 1: base tile data + climate fertility
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){const px=Math.min(w.width-1,tx*RES),py=Math.min(w.height-1,ty*RES),i=py*w.width+px;
const ti=ty*tw+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti];
const e=w.elevation[i],t=w.temperature[i],m=w.moisture[i];let diff=0;
if(e>0.35)diff=Math.max(diff,Math.min(1,(e-0.35)*3));if(t>0.5&&m<0.2)diff=Math.max(diff,Math.min(0.85,(0.2-m)*3*(t-0.3)));
if(t<0.2)diff=Math.max(diff,Math.min(0.9,(0.2-t)*4));tDiff[ti]=diff;tFert[ti]=tileFert(t,m,e);
// Swamp bonus
{let hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(w.height-1,py+dy)*w.width+Math.min(w.width-1,px+dx);
if(w.swamp&&w.swamp[wi])hasSwamp=true;}
if(hasSwamp){tFert[ti]=Math.min(1,tFert[ti]+0.2);tDiff[ti]=Math.min(1,tDiff[ti]+0.25);}}}

// ── River hydrology ──
const rivers=computeRivers(tw,th,tElev,tMoist,tTemp);

// ── River moisture boost: rivers raise local moisture, then fertility recalculates ──
// This is the physically correct approach: rivers bring water → soil moisture rises →
// fertility formula (bell curve) naturally produces good values.
// Biome classification, resources, and all downstream systems react correctly.
const riverMoist=new Float32Array(tw*th);
const tFlood=new Uint8Array(tw*th);   // arid-river floodplain mask (Nile/Indus/Euphrates valley): its own biome + prime cropland
{// A river waters the floodplain band where farming concentrates — and how WIDE that
// band is is a property of the RIVER, not of the pixel grid. Hydraulic geometry: the
// alluvial valley a river lays down scales with the discharge that built it (valley
// width ∝ √flow), so the ribbon half-width here is FLOOD_W_KM · √(discharge-equivalent
// catchment km², from flowAccum) — a REAL distance, converted to pixels at whatever
// grid is in use. A great river's valley (the Nile/Indus corridor, ~10⁶ km² of
// catchment → HW ~50–120 km) spans pixels at any resolution and reads as the full
// breadbasket ribbon; a STREAM's alluvial strip (10⁴ km² → ~5 km) is far narrower
// than one pixel, so its pixel column reads only the pixel-AVERAGE: the same water
// spread across the whole column (peak × width-fraction — mass conservation), a
// faint riparian trace that never reads as a plain. Resolution-invariant by
// construction (all quantities in km), converging on the physically-resolved fine
// limit rather than any grid's artifact.
//   History: this replaced a per-class tile radius rescaled by tw/480, which kept the
// ribbon's drawn GEOMETRY constant but broke its physics — normalizing the falloff by
// the scaled radius lifted a stream's channel-pixel moisture from 0.02 (sub-threshold:
// streams stamped NO floodplain at the 480 reference) to ~0.2, so at the app's
// 1920-pixel grid every creek wore a ~150-km plain: floodplain share of land jumped
// 2.5% → 14.5% (6×), the fertility carpet dissolved the wasteland walls that bound
// political claims (countryTerritory's CLAIM_FERT_REF hostility), and realms ballooned
// far past their (otherwise healthy) dynamics.
//   Lever OFF (RES_INVARIANT_POP=0) keeps the legacy fixed tile radii byte-identically.
const FLOOD_W_KM=0.05;   // alluvial-valley HALF-width: km per √(discharge-equivalent km² of catchment). Hydraulic geometry (width ∝ √Q); ~2× generous vs Earth valleys for map legibility, but ORDER-true: Nile-scale → ~70 km, a 10⁴-km² stream → ~5 km
const kmPerPx=Math.sqrt(rivers.km2PerTile||1);   // linear km per pixel (area convention — matches riverGen's catchment bars)
const riverRadius=[0,1,2,3,3];   // legacy path (lever OFF): fixed NONE,STREAM,TRIB,MAJOR,GREAT tile radii
const riverMoistPeak=[0,0.22,0.45,0.52,0.58];
const resInv=!!T.RES_INVARIANT_POP;
for(let ti=0;ti<tw*th;ti++){
const mag=rivers.riverMag[ti];if(mag<RIVER_STREAM)continue;
let R,effHW,peak,minD;
if(resInv){
const hwPx=FLOOD_W_KM*Math.sqrt(Math.max(0,rivers.flowAccum[ti]*(rivers.km2PerAccum||0)))/kmPerPx;
effHW=Math.max(hwPx,0.8);                        // the grid can't draw a ribbon narrower than ~a pixel…
peak=riverMoistPeak[mag]*Math.min(1,hwPx/effHW); // …so a sub-pixel valley's water spreads over the column: proportionally damper
if(peak<0.01)continue;                           // below the apply cutoff everywhere — nothing to stamp
minD=0.25;                                       // channel pixel reads the profile ~¼ px off-axis (its own footprint average) — calibrated so the sub-pixel column reads ≈ its exact mass-conserving mean
R=Math.ceil(effHW);
}else{
R=riverRadius[mag];effHW=R;peak=riverMoistPeak[mag];minD=0.8;
if(R<1)continue;
}
const sx=ti%tw,sy=(ti-sx)/tw;
for(let dy=-R;dy<=R;dy++){const ny=sy+dy;if(ny<0||ny>=th)continue;
for(let dx=-R;dx<=R;dx++){const nx=(sx+dx+tw)%tw;
const ni=ny*tw+nx;
if(tElev[ni]<=0)continue;
let ddx=Math.abs(dx);if(ddx>tw/2)ddx=tw-ddx;
const dist=Math.sqrt(ddx*ddx+dy*dy);
if(dist>effHW)continue;
// Clamp minimum distance so the channel pixel blends with its surroundings (no biome spike)
const effDist=Math.max(dist,minD);
const t2=Math.min(1,effDist/effHW);const falloff=0.5+0.5*Math.cos(t2*Math.PI);
const v=peak*falloff;
riverMoist[ni]=Math.max(riverMoist[ni],v);}}}
// Apply moisture boost and recompute fertility
for(let ti=0;ti<tw*th;ti++){
if(riverMoist[ti]<0.01)continue;
const rm=riverMoist[ti];
const oldMoist=tMoist[ti];
// Cap moisture boost so it approaches but doesn't overshoot the bell curve peak.
// In dry areas: full boost toward 0.50 (near peak).
// In wet areas: minimal boost (land already has water, river just levels terrain).
if(oldMoist<0.45){
tMoist[ti]=Math.min(0.50,oldMoist+rm);
}else{
tMoist[ti]=Math.min(1,oldMoist+rm*0.08);
}
tFert[ti]=tileFert(tTemp[ti],tMoist[ti],tElev[ti]);
// Alluvial silt bonus: a floodplain is renewed with fresh nutrient-rich silt each
// flood, so it out-produces what its moisture alone (the bell curve) implies — the
// thin Nile/Indus/Mesopotamian ribbons fed the first dense civilisations from a strip
// of desert. A direct fertility lift on the wetted floodplain, strongest on DRY-land
// valleys (the river is the only water → irrigation transforms it) and gentle in
// already-wet land (the river just levels the terrain). tCoast deltas are richest.
// Cold-gated like the base fertility (tileFert's tFactor): a FROZEN floodplain is not
// prime cropland — the silt is there but the ground is frozen and the season too short
// to work it. Without this, cold great-river valleys (the Lena, Ob, Yenisei) read as
// alluvial breadbaskets and settle densely up into the Siberian taiga, which was in
// reality near-empty. Warm cradles (the Nile +22°C, even the Yellow River +12°C) keep
// full silt; the boreal north loses it.
const alluCold=Math.min(1,Math.max(0,(tTemp[ti]-0.57)/0.13));
const allu=rm*(oldMoist<0.30?0.55:oldMoist<0.45?0.30:0.10)*alluCold;
tFert[ti]=Math.min(1,tFert[ti]+allu);
// FLOODPLAIN: where a river runs through genuinely DRY land it lays a fertile
// alluvial valley — a distinct ecosystem, not the savanna the moisture boost
// alone reads as. Mark the whole wetted GREEN corridor (boosted moisture past the
// vegetation line) when the underlying land is arid — the Nile / Indus / Euphrates
// ribbon through desert, the full width that reads as non-desert.
if(oldMoist<0.32&&tMoist[ti]>0.14&&rm>0.04)tFlood[ti]=1;}}

// ── Lake moisture boost: lakes act as local moisture sources ──
if(rivers.lake){
const lakeRadius=3;const lakeMoistPeak=0.20;
for(let ti=0;ti<tw*th;ti++){
if(rivers.lake[ti]<0)continue;
const sx=ti%tw,sy=(ti-sx)/tw;
for(let dy=-lakeRadius;dy<=lakeRadius;dy++){const ny=sy+dy;if(ny<0||ny>=th)continue;
for(let dx=-lakeRadius;dx<=lakeRadius;dx++){const nx=(sx+dx+tw)%tw;
const ni=ny*tw+nx;
if(tElev[ni]<=0||rivers.lake[ni]>=0)continue;// skip ocean and other lake tiles
let ddx=Math.abs(dx);if(ddx>tw/2)ddx=tw-ddx;
const dist=Math.sqrt(ddx*ddx+dy*dy);
if(dist>lakeRadius)continue;
const effDist=Math.max(dist,0.8);
const falloff=0.5+0.5*Math.cos(effDist/lakeRadius*Math.PI);
const boost=lakeMoistPeak*falloff;
const oldM=tMoist[ni];
if(oldM<0.45){tMoist[ni]=Math.min(0.50,oldM+boost);}
else{tMoist[ni]=Math.min(1,oldM+boost*0.08);}
tFert[ni]=tileFert(tTemp[ni],tMoist[ni],tElev[ni]);}}}
// Lake tiles themselves: water, not land — zero fertility, impassable
for(let ti=0;ti<tw*th;ti++){
if(rivers.lake[ti]>=0){tMoist[ti]=0.8;tFert[ti]=0;tDiff[ti]=1.0;}}}

// ── Pass 2: Geological fertility modifiers ──
// These require neighbor access so run after base pass.

// 2a: Tropical soil penalty — laterite soils in hot wet regions are nutrient-poor.
// The Amazon/Congo paradox: lush forest but terrible soil for agriculture.
// Exception: river floodplains have fresh alluvial silt, not leached laterite.
for(let ti=0;ti<tw*th;ti++){
const t=tTemp[ti],m=tMoist[ti],e=tElev[ti];
if(e<=0)continue;
if(t>0.65&&m>0.50){
const tropicality=Math.min(1,(t-0.65)/0.25)*Math.min(1,(m-0.50)/0.35);
// River floodplains resist laterization: fresh silt replaces leached soil annually
const riverProtect=riverMoist[ti]>0.01?Math.min(0.8,riverMoist[ti]*2.5):0;
tFert[ti]*=(1-tropicality*0.55*(1-riverProtect));}}

// 2b: Temperate grassland bonus — chernozem/mollisol deep topsoil.
// Moderate temp, moderate moisture, low elevation = breadbasket zones.
for(let ti=0;ti<tw*th;ti++){
const e=tElev[ti],t=tTemp[ti],m=tMoist[ti];
if(e<=0||e>0.15)continue;
// Temperate sweet spot: not too hot, not too cold
const tempFit=Math.exp(-((t-0.45)*(t-0.45))/(2*0.10*0.10));// peak at t=0.45
// Semi-arid to moderate moisture: grassland/steppe zone (not forest, not desert)
const moistFit=Math.exp(-((m-0.28)*(m-0.28))/(2*0.10*0.10));// peak at m=0.28
const bonus=tempFit*moistFit*0.30;// up to +30%
if(bonus>0.02)tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}

// 2d: Volcanic soil bonus — near plate boundaries in tectonic mode.
// Andisols from volcanic ash are mineral-rich, excellent for agriculture.
// bDist (plate-boundary distance) is also exposed to Pass 3's tCrop
// so the tropical penalty can spare young volcanic / orogenic tropical
// regions (Java, Mekong, Ganges) that escape Amazon-style lateritic
// soil leaching.
let bDist=null;
if(w.pixPlate){const W=w.width,H=w.height;
// Build a plate-boundary distance map at tile resolution
const plateBound=new Uint8Array(tw*th);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
const myP=w.pixPlate[py*W+px];let isBoundary=false;
for(const[dx,dy]of DIRS){const nx2=Math.min(W-1,Math.max(0,px+dx*RES)),ny2=Math.min(H-1,Math.max(0,py+dy*RES));
if(w.pixPlate[ny2*W+nx2]!==myP){isBoundary=true;break;}}
if(isBoundary)plateBound[ty*tw+tx]=1;}
// Expand boundary influence: BFS to get distance from plate boundaries.
// Radius 15 so tCrop can see "near-orogenic" regions far enough inland
// to cover Ganges plain / Indochina interior; volcanic bonus still
// gates itself at <7 so its behavior is unchanged.
bDist=new Uint8Array(tw*th);bDist.fill(255);
const bdQ=[];
for(let i=0;i<tw*th;i++)if(plateBound[i]&&tElev[i]>0){bDist[i]=0;bdQ.push(i);}
for(let qi=0;qi<bdQ.length;qi++){const ci=bdQ[qi],cd=bDist[ci],cx=ci%tw,cy=(ci-cx)/tw;
if(cd>=15)continue;// max 15-tile influence radius
for(const[dx,dy]of DIRS){const nx=(cx+dx+tw)%tw,ny=cy+dy;if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(bDist[ni]<=cd+1||tElev[ni]<=0)continue;
bDist[ni]=cd+1;bdQ.push(ni);}}
// Apply volcanic bonus: strongest at boundary, decays with distance
for(let ti=0;ti<tw*th;ti++){if(bDist[ti]>=7||tElev[ti]<=0)continue;
// Only apply where there's enough moisture for agriculture
if(tMoist[ti]<0.15)continue;
const proximity=1-bDist[ti]/7;// 1.0 at boundary, 0 at distance 7
// Mountains near boundaries get less bonus (already high elevation)
const elevPenalty=tElev[ti]>0.25?Math.max(0,1-(tElev[ti]-0.25)*4):1;
const bonus=proximity*elevPenalty*0.40;// up to +40%
tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}}

// 2e: Coastal fertility bonus — fishing, salt, trade access.
for(let ti=0;ti<tw*th;ti++){
if(tCoast[ti]&&tElev[ti]>0)tFert[ti]=Math.min(1,tFert[ti]+0.06);}

// ── Pass 3: Analytical overlays (Crop suitability + Crossing difficulty) ──
// Two derived maps the user can toggle to inspect *why* settlements
// behave where they do. Stored separately from tFert so the sim's
// food-production math is untouched.
//
// tCrop — agronomic crop potential (primitive-tech baseline).
//   Differs from tFert:
//     - tighter moisture window (crops dislike waterlogging more than
//       biomass does — chernozem semi-humid > rainforest)
//     - HARDER tropical lateritic penalty (×0.25 at the rainforest
//       core, vs ×0.45 in tFert). The Amazon/Congo paradox writ large.
//     - hill / upland penalty (terracing without construction tech).
//   Temperate forest zones still rate high — they ARE prime cropland,
//   the clearing cost is a transport/construction issue handled
//   elsewhere, not an inherent crop-quality issue.
//
// tCross — average per-edge crossing cost across the 4 land
//   neighbours, using the same continuous baseEdgeCost as the sim's
//   transport map (peopleSim/transport.js). The slope component is
//   real — climbing a steep face costs more than walking a flat
//   plateau even at the same absolute elevation — so the rendered
//   gradient varies continuously rather than stair-stepping at the
//   old e=0.20 / e=0.35 thresholds. Normalized against CROSS_MAX so
//   most land falls in the visible mid-range; rivers / coast push to
//   the easy end, peaks + cold / peaks + desert sit at the brutal end.
const tCrop=new Float32Array(tw*th);
const tCross=new Float32Array(tw*th);
// Normalisation ceiling. With the wider cost spread, typical land
// reads between ~1.0 (plains) and ~6 (mid-mountains); peaks + climb
// can hit 12+. CROSS_MAX=6 maps that into the full green→yellow→red
// gradient — plains stay bright green, hills go yellow, real
// mountains hit red.
const CROSS_MAX=6.0;
const tRelief=computeRelief(tElev,tw,th);   // local vertical range — the ridge term in the edge cost (see transport.js)
const crossWorld={elev:tElev,temp:tTemp,moist:tMoist,coast:tCoast,relief:tRelief,
                  riverMag:rivers&&rivers.riverMag?rivers.riverMag:null};
for(let ti=0;ti<tw*th;ti++){
const e=tElev[ti],t=tTemp[ti],m=tMoist[ti];
if(e<=0){tCrop[ti]=0;tCross[ti]=1;continue;}
// Crop suitability. Temperature is now calibrated to real annual-mean air temp
// (t = 0.60 + °C/100, see tools/probe_temperature.mjs), so the optimum is a
// realistic agricultural band rather than the old wide bell (which, tuned to the
// previous hot scale, peaked in the cold and wrongly rated far-northern Europe /
// Siberia as prime farmland). A COLD GATE rules out short-season high latitudes
// (annual mean below ~-3°C ≈ 0; rising to full suitability by ~+10°C), then a
// broad warm plateau (temperate breadbaskets → subtropics → watered tropics)
// with only a gentle roll-off in extreme heat. Hot-wet laterite and aridity are
// handled by the moisture bell + penalties below.
tCrop[ti]=cropSuitability(t,m,e,tCoast[ti],rivers&&rivers.riverMag?rivers.riverMag[ti]:0,bDist?bDist[ti]:null);
// An arid-river FLOODPLAIN is prime irrigated cropland (the Nile / Mesopotamia /
// Indus alluvium — the most productive farmland there was), whatever the bare
// climate would rate the hot dry valley as — BUT only where it is warm enough to
// farm. A floodplain in a short-season high-latitude interior (a frozen Siberian
// river valley) is NOT the Nile, so gate the override by the SAME cold gate
// cropSuitability uses. Without this, drying a cold continental interior (which
// turns its river valleys "arid" and so flags them tFlood) would mint subarctic
// breadbaskets that bypass the cold gate entirely — a runaway-primate landmine.
// The hottest cradles' later salinisation (SOIL_EXHAUST, settlement.js) still
// applies the historical decline.
if(tFlood[ti]){const coldGate=Math.min(1,Math.max(0,(t-0.57)/0.13));tCrop[ti]=Math.max(tCrop[ti],0.92*coldGate);}
// Crossing difficulty: average edge cost from each land neighbour
// into this tile. Edge-based so slope shows up; averaged so the
// overlay is direction-agnostic.
const ty=(ti/tw)|0,tx=ti-ty*tw;
const left=ty*tw+(tx===0?tw-1:tx-1);
const right=ty*tw+(tx===tw-1?0:tx+1);
const up=ty>0?(ty-1)*tw+tx:-1;
const down=ty<th-1?(ty+1)*tw+tx:-1;
let csum=0,cnt=0;
const nbrs=[left,right,up,down];
for(let k=0;k<4;k++){
const ni=nbrs[k];
if(ni<0)continue;
if(tElev[ni]<=0)continue;// approach across water doesn't count
const c=baseEdgeCost(crossWorld,ni,ti);
if(c===Infinity)continue;
csum+=c;cnt++;}
const cAvg=cnt>0?csum/cnt:1.0;
tCross[ti]=Math.min(1,cAvg/CROSS_MAX);}

// ── Natural resource deposits ──
const deposits=generateResources(tw,th,tElev,tTemp,tMoist,tCoast,w,w._seed||0,rivers);
// (The legacy tribe-seeding / background-population layer that lived here —
// valley scoring, bgPop/cityPop, tribe knowledge/budget/port/coast tables —
// was removed with the tribe system itself: the peopleSim worker owns ALL
// population now, and the views that read those static estimates are gone.)
// Attach the products peopleSim reads off the worldgen object, and alias the
// seed (generateWorld stamps _seed; everything downstream reads w.seed).
if(w.seed==null)w.seed=w._seed??1;
w.rivers=rivers;w.deposits=deposits;
// Deep ancestry substrate (the pre-civilisation genetic map), from geography.
const{tAncestry,ancestryCount,tArrival,ancBirth,ancParent,ancHue,ancLight,ancOriginFx,ancOriginFy}=generateAncestry(tw,th,tElev,tTemp,tMoist,tDiff,tFert,(w._seed??w.seed??1),w.preset);
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tCrop,tCross,tFlood,tRelief,deposits,rivers,tAncestry,ancestryCount,tArrival,ancBirth,ancParent,ancHue,ancLight,ancOriginFx,ancOriginFy,stepCount:0};}

// Full headless compose: generateWorld + buildTerritory in one call.
export function buildWorld({W=480,H=W>>1,seed=1,preset="earth_sim",oceanLevel=0.78,tecParams={},realWind=false,realWindFns=null}={}){
  const w=generateWorld(W,H,seed,preset,oceanLevel,true,realWind,tecParams,realWindFns);
  const ter=buildTerritory(w,1);
  return{w,ter};
}
