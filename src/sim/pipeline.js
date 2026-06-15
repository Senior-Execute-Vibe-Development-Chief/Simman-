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
import { mkRng, hash32 } from "./peopleSim/rng.js";

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

// ── Deep ancestry: the pre-civilisation genetic substrate ──────────────────
// Humans filled the world tens of millennia before farming, so ancestry is laid
// down HERE, at worldgen, from GEOGRAPHY — not from the agricultural cradles
// (which seed civilisation, a far later overlay). The real driver is ISOLATION
// BY DISTANCE (genetic distance ≈ walking distance, the out-of-Africa serial
// founder effect): a smooth cline, steepened into distinct populations wherever
// gene flow is throttled — across open OCEAN, high MOUNTAINS, and DESERTS (all
// captured by tDiff), and across sharp CLIMATE gradients (populations adapted to
// very different climates mixed less). We grow regions out from scattered deep-
// population anchors by a barrier-aware cost-distance: each land tile takes the
// ancestry of its cheapest-to-reach anchor, so boundaries fall on the barriers
// and blend along the corridors. Civilisation's peoples and tongues later spread
// OVER this; the blood stays put (a conquered land keeps its deep ancestry).
const ANC_SEP_FRAC  = 0.15;   // anchor min-separation, as a fraction of map width (sets how many deep populations)
const ANC_BARRIER_W = 6;      // mountains / desert / cold (tDiff) resistance to gene flow
const ANC_OCEAN_STEP= 9;      // per-tile cost to cross open water — near islands share the mainland, oceans separate
const ANC_CLIMATE_W = 7;      // resistance per unit of climate (temp+moisture) change across an edge
function generateAncestry(tw, th, tElev, tTemp, tMoist, tDiff, seed) {
  const N = tw * th;
  const anc = new Int16Array(N); anc.fill(-1);
  const rng = mkRng(hash32(seed >>> 0, "ancestry"));
  // 1. anchors — deep population centres, greedy min-separation on land (seeded)
  const minSep = Math.max(6, ANC_SEP_FRAC * tw), minSep2 = minSep * minSep;
  const land = [];
  for (let ti = 0; ti < N; ti++) if (tElev[ti] > 0) land.push(ti);
  for (let k = land.length - 1; k > 0; k--) { const j = rng.int(k + 1); const t = land[k]; land[k] = land[j]; land[j] = t; }
  const ax = [], ay = [];
  for (const ti of land) {
    const x = ti % tw, y = (ti / tw) | 0; let ok = true;
    for (let a = 0; a < ax.length; a++) { let dx = Math.abs(x - ax[a]); if (dx > tw / 2) dx = tw - dx; const dy = y - ay[a]; if (dx * dx + dy * dy < minSep2) { ok = false; break; } }
    if (ok) { ax.push(x); ay.push(y); }
  }
  const K = ax.length;
  if (!K) return { tAncestry: anc, ancestryCount: 0 };
  // 2. multi-source Dijkstra — nearest anchor by barrier-aware cost
  const dist = new Float64Array(N); dist.fill(Infinity);
  let cap = N + 16, hti = new Int32Array(cap), hd = new Float64Array(cap), hn = 0;
  const push = (ti, d) => {
    if (hn + 1 >= cap) { cap *= 2; const t1 = new Int32Array(cap); t1.set(hti); hti = t1; const t2 = new Float64Array(cap); t2.set(hd); hd = t2; }
    let i = ++hn; hti[i] = ti; hd[i] = d;
    while (i > 1) { const p = i >> 1; if (hd[p] <= hd[i]) break; const a = hti[p], b = hd[p]; hti[p] = hti[i]; hd[p] = hd[i]; hti[i] = a; hd[i] = b; i = p; }
  };
  for (let a = 0; a < K; a++) { const ti = ay[a] * tw + ax[a]; dist[ti] = 0; anc[ti] = a; push(ti, 0); }
  while (hn > 0) {
    const ti = hti[1], d = hd[1];
    hti[1] = hti[hn]; hd[1] = hd[hn]; hn--;
    { let i = 1; for (;;) { const l = i * 2, r = l + 1; let b = i; if (l <= hn && hd[l] < hd[b]) b = l; if (r <= hn && hd[r] < hd[b]) b = r; if (b === i) break; const a = hti[b], c = hd[b]; hti[b] = hti[i]; hd[b] = hd[i]; hti[i] = a; hd[i] = c; i = b; } }
    if (d > dist[ti]) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw, myT = tTemp[ti], myM = tMoist[ti], myA = anc[ti];
    for (let k = 0; k < 8; k++) {
      const ny = ty + DIRS[k][1]; if (ny < 0 || ny >= th) continue;
      const nx = (tx + DIRS[k][0] + tw) % tw, ni = ny * tw + nx;
      const diag = (DIRS[k][0] && DIRS[k][1]) ? Math.SQRT2 : 1;
      const step = tElev[ni] <= 0
        ? ANC_OCEAN_STEP * diag
        : (1 + tDiff[ni] * ANC_BARRIER_W + (Math.abs(tTemp[ni] - myT) + Math.abs(tMoist[ni] - myM)) * ANC_CLIMATE_W) * diag;
      const nd = d + step;
      if (nd < dist[ni]) { dist[ni] = nd; anc[ni] = myA; push(ni, nd); }
    }
  }
  for (let ti = 0; ti < N; ti++) if (tElev[ti] <= 0) anc[ti] = -1;   // water only CARRIED gene flow (to reach islands); it has no ancestry of its own
  return { tAncestry: anc, ancestryCount: K };
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
{// Tributary+ rivers get moisture gradient. Streams are too small for map-scale effect.
const riverRadius=[0,0,1,2,3];// NONE,STREAM,TRIB,MAJOR,GREAT (~21km/tile)
const riverMoistPeak=[0,0,0.25,0.40,0.55];
for(let ti=0;ti<tw*th;ti++){
const mag=rivers.riverMag[ti];if(mag<RIVER_STREAM)continue;
const R=riverRadius[mag],peak=riverMoistPeak[mag];
if(R<1)continue;
const sx=ti%tw,sy=(ti-sx)/tw;
for(let dy=-R;dy<=R;dy++){const ny=sy+dy;if(ny<0||ny>=th)continue;
for(let dx=-R;dx<=R;dx++){const nx=(sx+dx+tw)%tw;
const ni=ny*tw+nx;
if(tElev[ni]<=0)continue;
let ddx=Math.abs(dx);if(ddx>tw/2)ddx=tw-ddx;
const dist=Math.sqrt(ddx*ddx+dy*dy);
if(dist>R)continue;
// Clamp minimum distance so center tile blends with surroundings (no biome spike)
const effDist=Math.max(dist,0.8);
const t2=effDist/R;const falloff=0.5+0.5*Math.cos(t2*Math.PI);
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
tFert[ti]=tileFert(tTemp[ti],tMoist[ti],tElev[ti]);}}

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
const crossWorld={elev:tElev,temp:tTemp,moist:tMoist,coast:tCoast,
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
const{tAncestry,ancestryCount}=generateAncestry(tw,th,tElev,tTemp,tMoist,tDiff,(w._seed??w.seed??1));
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tCrop,tCross,deposits,rivers,tAncestry,ancestryCount,stepCount:0};}

// Full headless compose: generateWorld + buildTerritory in one call.
export function buildWorld({W=480,H=W>>1,seed=1,preset="earth_sim",oceanLevel=0.78,tecParams={}}={}){
  const w=generateWorld(W,H,seed,preset,oceanLevel,true,false,tecParams);
  const ter=buildTerritory(w,1);
  return{w,ter};
}
