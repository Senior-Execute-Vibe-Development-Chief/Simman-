/* global __BUILD_SHA__ */   // vite `define`: the commit sha baked into this bundle (stale-tab detector)
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { isRealWindAvailable, fillRealWind } from "./realWindData.js";
import { isRealClimateAvailable, fillRealClimate } from "./realClimateData.js";
import { classifyBiome } from "./sim/biomeClass.js";
import GlobeView from "./GlobeView.jsx";
import TuningPanel, { ParamEditor } from "./TuningPanel.jsx";
import { loadPresets, deletePreset } from "./paramDefs.js";
import { parseAzgaarJSON, rasterizeAzgaar, rasterizeHeightmap, loadImageFile } from "./mapImport.js";
// The observed-Earth data set, injected into worldgen as one bundle (see the
// realWindFns note there — worldgen must not import these modules itself, or the
// ~5MB of NCEP JSON gets inlined into the worker bundle a second time).
const REAL_FNS = { isRealWindAvailable, fillRealWind, isRealClimateAvailable, fillRealClimate };
// Is anything observed available to switch ON? Wind and climate load independently,
// so the toggle is live if EITHER data set made it into the bundle.
const realDataAvailable = () => isRealWindAvailable() || isRealClimateAvailable();
import { tileResourceSummary, RESOURCES } from "./sim/resourceGen.js";
import { RIVER_NAMES } from "./sim/riverGen.js";
import { makeTimeline, captureFrame, frameAt, frameCount, CAPTURE_IVL } from "./sim/timelineStore.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "./sim/peopleSim/index.js";
import { serializeWorld, loadWorld, SAVE_VERSION } from "./sim/persist.js";
import { applyTuning, resetTuning, tuningDefaults, T as SIM_T } from "./sim/peopleSim/tuning.js";
import SimLevers from "./SimLevers.jsx";
import { getExportBreakdown, getTradeProfile, getWealthReserve, TIER_THRESHOLD, TIER_CORE, TIER_NAME_CORE } from "./sim/peopleSim/settlement.js";
import { GOODS } from "./sim/peopleSim/goods.js";
import { IN_LABELS, OUT_LABELS, IN_GOODS, IN_MINING, IN_PILGRIM, IN_CARRY, IN_FINANCE, IN_SLAVE_TRADE, IN_ORE, IN_METAL, IN_CLOTH, IN_WARES } from "./sim/peopleSim/money.js";
import { TECHS, ERAS, techState, nextTechs } from "./sim/peopleSim/tech.js";
import { TechTreeOverlay, ChronicleOverlay, DynastyOverlay, CHRON_COL, ERA_BG } from "./ui/documents.jsx";
import { fmtPeople, fmtFood, fmtGoldKg, fmtUrbanCatchment, foodLedgerInfo, foodShockLabel, MiniChart, buildHistoryExport, Chip, PsKRow, PsSection } from "./ui/bits.jsx";
import { resetEmblems, realmEmblemImg, realmEmblemURL } from "./ui/emblems.jsx";
import { realmLabelAnchors, drawMapLabels } from "./ui/labels.js";
import { TopBarBell, ToastHost, HelpOverlay, evMeta, evCatColor, EV_CATS } from "./ui/events.jsx";
import { LEGENDS, LegendCard } from "./ui/legends.jsx";
import { useSurfaceStack, openSurface, closeSurface, closeTopSurface, isSurfaceOpen, surfaceZ } from "./ui/surfaces.js";


import WorldGenWorker from "./worldGenWorker.js?worker&inline";
import PeopleSimWorker from "./peopleSimWorker.js?worker&inline";
// The popField band-worker chunk's real URL (vite emits it as a sidecar file
// even under singlefile). Resolved HERE — page context, real URL — because the
// sim worker itself is an inline blob whose import.meta.url resolves nothing;
// threaded to the worker below so its pool can spawn nested band workers in
// the BUILT app (docs/popfield-parallel.md §8.4a).
import popFieldBandWorkerUrl from "./sim/peopleSim/popFieldWorker.browser.js?worker&url";

// Noise + PRNG utilities moved to src/worldgenUtils.js so worldgen code can
// also run headlessly (Node tests, future tooling) without dragging React in.
import { initNoise, noise2D, fbm, ridged, worley } from "./sim/worldgenUtils.js";

const RES=1;
// ── Mercator projection helpers ──
const MAX_LAT_DEG = 78;
const MAX_LAT = MAX_LAT_DEG * Math.PI / 180;
const MERC_MAX = Math.log(Math.tan(Math.PI / 4 + MAX_LAT / 2));
const CW_FLAT = 1920, CH_FLAT = 960; // equirectangular canvas (matches world at RES=1)
// Mercator height: match equator pixel scale to flat mode, then add space for polar stretch
// Formula: CH = 2 * MERC_MAX * (CH_FLAT / π) — equator stays same size as flat mode
const CH_MERC = Math.round(2 * MERC_MAX * CH_FLAT / Math.PI); // ~688
// Views whose base raster is a pure function of the world (not the sim), so it
// can be rendered once to an offscreen canvas and blitted each frame instead
// of rebuilt per-pixel. Sim-dependent views (population, transport, roads,
// money, tribes) and atlas are excluded.
const BASE_CACHE_VIEWS = new Set(["terrain","depth","wind","crop","crossing","resources","moisture","temperature","country","atlas"]);
// Sim-DYNAMIC data views: also cacheable (a GPU blit instead of a full-canvas
// putImageData every frame — the reason these lagged next to the country view),
// but their raster must refresh as the sim advances, so the cache key carries a
// step bucket: rebuild every STEP_CACHE_REGEN sim-steps, blit between (the same
// trick the political overlay uses). When paused the step is constant, so they
// blit every frame and cost nothing.
const STEP_CACHE_VIEWS = new Set(["money","goodsflow","roads"]);
// Goods-flow overlay: per-kind cargo colors + legend labels (grain split by
// channel: levy = fields→city; market = grain bought between cities).
const GOODS_FLOW_KINDS={grainL:[110,205,90],grainM:[190,255,80],materials:[176,148,109],ore:[151,151,166],metal:[121,166,209],cloth:[186,121,222],wares:[235,164,84],luxury:[240,95,190]};
const GOODS_FLOW_LABELS=[["grainL","Levy — fields \u2192 city"],["grainM","Market — city \u2194 city"],["materials","Materials"],["ore","Ore"],["metal","Metal"],["cloth","Cloth"],["wares","Wares"],["luxury","Luxury"]];
const STEP_CACHE_REGEN = 8;
let _mercator = false; // module-level flag for projection functions

function screenYtoDataY(sy, ch, H) {
  if (!_mercator) return Math.min(H - 1, sy * RES);
  const mercY = MERC_MAX - (sy / ch) * 2 * MERC_MAX;
  const latRad = 2 * Math.atan(Math.exp(mercY)) - Math.PI / 2;
  return Math.max(0, Math.min(H - 1, ((90 - latRad * 180 / Math.PI) / 180) * H));
}

function dataYtoScreenY(dy, H, ch) {
  if (!_mercator) return Math.min(ch - 1, dy / RES);
  const latDeg = 90 - (dy / H) * 180;
  const latClamped = Math.max(-MAX_LAT_DEG, Math.min(MAX_LAT_DEG, latDeg));
  const latRad = latClamped * Math.PI / 180;
  const mercY = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  return Math.max(0, Math.min(ch - 1, ((MERC_MAX - mercY) / (2 * MERC_MAX)) * ch));
}

let _tecParams = {};

// generateWorld extracted to ./worldgen.js so worldgen can run headlessly.
import { generateWorld } from "./sim/worldgen.js";
import { buildTerritory, tileFert } from "./sim/pipeline.js";
import { displayYearStr } from "./sim/calendar.js";

const BC=[
[10,22,56],      // 0  Deep Ocean
[20,48,95],      // 1  Shallow Ocean
[36,78,125],     // 2  Coastal Water
[194,182,140],   // 3  Beach (unused)
[168,158,130],   // 4  Tundra — brown-tan (lichen/permafrost, satellite)
[235,240,248],   // 5  Snow / Ice
[50,80,58],      // 6  Taiga — dark blue-green (spruce canopy from satellite)
[45,78,48],      // 7  Boreal Forest — darker spruce green
[50,105,45],     // 8  Temperate Forest — muted deciduous green (satellite)
[25,100,52],     // 9  Temperate Rainforest — deep emerald
[14,72,28],      // 10 Tropical Rainforest — dark dense canopy
[192,176,82],    // 11 Savanna — golden-tan with scattered green
[158,165,78],    // 12 Grassland — tan-green prairie (more green than pure golden)
[210,185,140],   // 13 Desert — warm sandy tan (slight orange like Sahara satellite)
[140,135,78],    // 14 Shrubland — olive-brown hot semi-desert scrub
[78,118,48],     // 15 Tropical Dry Forest — muted olive-green
[152,145,135],   // 16 Barren / Alpine — gray-brown rock
[42,110,38],     // 17 Subtropical Forest — warm humid (SE US, S China, SE Brazil)
[195,190,180],   // 18 Cold Desert / Polar Desert — pale gray-tan
[34,104,56],     // 19 Floodplain — vivid irrigated alluvium (the Nile/Indus green ribbon through desert)
[124,138,86]     // 20 Mediterranean — grey-green sclerophyll (olive, holm oak, maquis)
];
const BN=['Deep Ocean','Shallow Ocean','Coastal Water','Beach','Tundra','Snow / Ice','Taiga',
'Boreal Forest','Temperate Forest','Temperate Rainforest','Tropical Rainforest','Savanna',
'Grassland','Desert','Shrubland','Tropical Dry Forest','Barren / Alpine',
'Subtropical Forest','Cold Desert','Floodplain','Mediterranean'];
// dry    = fraction of the year that is arid  (world.dryFrac)
// sumDry = phase of that drought, >0 = summer-dry (world.summerDry)
// Both optional: 0 reproduces the older behaviour. The classification itself lives in
// src/sim/biomeClass.js — this wrapper only adds the things the RENDER knows about
// (sea level, floodplain ribbons) on top of it.
function getBiomeD(e,m,t,sl,flood,dry,sumDry){
  if(e<=sl)return e<sl-.08?0:e<sl-.01?1:2;
  if(flood)return 19;   // arid-river floodplain: its own biome, not the savanna its t+m alone reads as
  return classifyBiome(e,m,t,dry,sumDry);
}
function getColorD(e,m,t,sl,flood,dry,sumDry){const c=BC[getBiomeD(e,m,t,sl,flood,dry,sumDry)],v=((e*37.7+m*17.3+t*53.1)%1+1)%1;
return[(c[0]+(v-.5)*10)|0,(c[1]+(v-.5)*10)|0,(c[2]+(v-.5)*8)|0];}

// ── Live country colouring (Country view) ───────────────────────────
// Give every country a hue as DISTINCT as possible from the countries it borders,
// so the political map stays legible as the world changes. Builds the border-
// adjacency graph from the claim map, then runs a force-directed relaxation on the
// hue WHEEL: each country is pushed away from its neighbours' hues (repulsion that's
// stronger the closer two neighbours are). Previous hues seed the next solve, so the
// colours spread out and then drift smoothly rather than flickering each refresh.
function assignCountryColors(claimArr,tw,th,prev,rootOf){
  // Hue units are suzerainty BLOCS, not legal atoms: every member of an
  // empire (vassal or colony) resolves to its root before adjacency, so the
  // relaxation separates empires from NEIGHBOURING empires instead of pushing
  // a vassal's hue away from its own suzerain's (the old behaviour — the
  // exact inverse of how an atlas paints an empire). rootOf defaults to
  // identity so standalone callers keep the legacy per-realm solve.
  const R=rootOf||(c=>c);
  const adj=new Map(),present=[],seen=new Set();
  const link=(a,b)=>{let s=adj.get(a);if(!s)adj.set(a,s=new Set());s.add(b);let t=adj.get(b);if(!t)adj.set(b,t=new Set());t.add(a);};
  for(let ti=0;ti<claimArr.length;ti++){
    const c0=claimArr[ti];if(c0<0)continue;
    const cc=R(c0);
    if(!seen.has(cc)){seen.add(cc);present.push(cc);}
    const py=(ti/tw)|0,px=ti-py*tw;
    const ro0=claimArr[py*tw+(px===tw-1?0:px+1)];
    if(ro0>=0){const ro=R(ro0);if(ro!==cc)link(cc,ro);}
    if(py<th-1){const dno0=claimArr[ti+tw];if(dno0>=0){const dno=R(dno0);if(dno!==cc)link(cc,dno);}}
  }
  const hue=new Map();
  let seeded=0;
  for(const c of present){const had=prev.has(c);if(had)seeded++;hue.set(c,had?prev.get(c):((c*61)%360+360)%360);}
  // First solve needs the full relaxation to untangle the (c*61)%360 seeds;
  // once almost everything carries its previous hue, a short settle pass is
  // enough to absorb the handful of new countries — this runs per claim
  // refresh, so the steady-state cost matters.
  const iters=seeded>=present.length*0.9?14:60;
  for(let it=0;it<iters;it++){
    const nudge=[];
    for(const c of present){
      const ns=adj.get(c);if(!ns||ns.size===0){nudge.push(0);continue;}
      const hc=hue.get(c);let f=0;
      for(const n of ns){
        let d=((hc-hue.get(n)+540)%360)-180;          // signed hue gap (-180,180]
        if(d>-0.5&&d<0.5)d=d>=0?0.5:-0.5;             // break exact overlaps
        f+=Math.sign(d)*(180-Math.abs(d))/ns.size;     // repel — strongest when hues are close
      }
      nudge.push(f);
    }
    let i=0;for(const c of present)hue.set(c,((hue.get(c)+nudge[i++]*0.06)%360+360)%360);
  }
  return hue;   // Map: countryId → hue 0..360
}

// ── Map lenses ──────────────────────────────────────────────────────
// Grouped views: each lens is one way of READING the world; sub-modes are
// variations within it. Worldgen diagnostics live behind a ?dev URL flag.
const DEV=typeof location!=="undefined"&&new URLSearchParams(location.search).has("dev");
const LENSES=[
  {id:"terrain", label:"Terrain", icon:"🗺", subs:[["terrain","Map"],["atlas","Atlas"]]},
  {id:"politics",label:"Politics",icon:"👑", subs:[["country","Realms"],["loyalty","Loyalty"]]},
  {id:"peoples", label:"Peoples", icon:"👥", subs:[["culture","Peoples"],["population","Population"],["ancestry","Ancestry"]]},
  {id:"languages",label:"Tongues",icon:"💬", subs:[["language","Languages"]]},
  {id:"faiths",  label:"Faiths",  icon:"🕯", subs:[["faith","Faiths"]]},
  {id:"economy", label:"Economy", icon:"⚖", subs:[["roads","Trade"],["money","Money"],["tilecoin","Coin field"],["goodsflow","Goods"],["prices","Prices"],["society","Labour"],["resources","Resources"],["crop","Cropland"],["technique","Technique"]]},
  ...(DEV?[{id:"dev",label:"Dev",icon:"🔬",subs:[["depth","Depth"],["wind","Wind"],["moisture","Moisture"],["temperature","Temp"],["crossing","Crossing"]]}]:[]),
];
// Emergent availability (plan §6.5): a sub-lens lights up when its phenomenon
// first EXISTS in the world — state-gated, never time-gated. Returns null
// (available) or a short "why it's still dark" string shown as the tooltip.
function subLockReason(sub,psw,stats){
  if(!psw)return null;
  if(sub==="money"&&!((stats&&stats.totalWealth)>0))
    return "No coin has been struck yet — the world still barters.";
  if(sub==="tilecoin"){
    if(!(SIM_T.TILE_MONEY>0)) return "Per-tile coin is off — enable TILE_MONEY in levers.";
    // Open even at 0: an empty field is the finding (cities eat levy, not purchases).
  }
  if(sub==="goodsflow"){
    if(!(psw.settlements&&psw.settlements.some(s=>s&&s.mode!=="abandoned")))
      return "No cities yet — the land's harvest has nowhere to flow.";
  }
  if(sub==="prices"&&!(psw.settlements&&psw.settlements.some(s=>s&&s._gPrice)))
    return "No market prices yet — towns must first meet in trade.";
  if(sub==="society"&&!(psw.settlements&&psw.settlements.some(s=>s&&(s._coerce||0)>0.02)))
    return "No coerced labour anywhere yet.";
  return null;
}

// Country-editor field lists + a compact slider row.
const ED_KFIELDS=[["agriculture","Agriculture"],["construction","Construction"],["organization","Organization"],["metallurgy","Metallurgy"],["navigation","Navigation"],["mobility","Mobility"]];
const ED_PFIELDS=[["aggression","Aggression"],["commerce","Commerce"],["expansionism","Expansionism"]];
function EdRow({label,value,min,max,step,onChange,fmt}){
  return <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"0 6px",alignItems:"center",marginBottom:2}}>
    <span className="au-fade" style={{fontSize:10}}>{label}</span>
    <span style={{fontSize:10,fontVariantNumeric:"tabular-nums"}}>{fmt(value)}</span>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e=>onChange(+e.target.value)} style={{gridColumn:"1 / 3",width:"100%",height:13}}/>
  </div>;
}

function atlasHash(a,b){let h=(a*374761393+b*668265263)>>>0;h=((h^(h>>>13))*1274126177)>>>0;return((h^(h>>>16))>>>0)/4294967296;}
function atlasMountain(c,x,y,s,snow,tone){
const h=s,wd=s*0.86;
const lum=0.82+tone*0.32;
c.beginPath();c.moveTo(x,y-h);c.lineTo(x-wd,y+h*0.66);c.lineTo(x+wd,y+h*0.66);c.closePath();
c.fillStyle=`rgb(${(176*lum)|0},${(160*lum)|0},${(120*lum)|0})`;c.fill();
c.beginPath();c.moveTo(x,y-h);c.lineTo(x+wd,y+h*0.66);c.lineTo(x,y+h*0.66);c.closePath();
c.fillStyle='rgba(44,32,18,0.5)';c.fill();
c.strokeStyle='rgba(46,34,20,0.4)';c.lineWidth=Math.max(0.4,s*0.1);
c.beginPath();c.moveTo(x,y-h*0.18);c.lineTo(x+wd*0.5,y+h*0.5);c.stroke();
if(snow){c.beginPath();c.moveTo(x,y-h);c.lineTo(x-s*0.30,y-h*0.40);c.lineTo(x-s*0.08,y-h*0.56);
c.lineTo(x+s*0.13,y-h*0.38);c.lineTo(x+s*0.30,y-h*0.48);c.closePath();c.fillStyle='rgba(236,229,212,0.9)';c.fill();}
c.strokeStyle='rgba(38,28,15,0.9)';c.lineWidth=Math.max(0.55,s*0.15);
c.beginPath();c.moveTo(x-wd,y+h*0.66);c.lineTo(x,y-h);c.lineTo(x+wd,y+h*0.66);c.stroke();}
function atlasHill(c,x,y,s){
c.strokeStyle='rgba(74,58,36,0.78)';c.lineWidth=Math.max(0.5,s*0.32);
c.beginPath();c.arc(x,y+s*0.45,s,Math.PI,2*Math.PI);c.stroke();}
// Tree — same hand-inked style as the mountains: tall, pointy, shaded, with a trunk stump
// ── Atlas tree silhouettes — one distinct shape per forest type ──
// Conifer/fir — tall narrow spire with tier hatching (taiga, boreal)
function atlasConifer(c,x,y,s,tone){
const wd=s*0.30,baseY=y+s*0.42,apexY=y-s*0.60;
const tw=Math.max(0.9,s*0.15),thh=s*0.30;
c.fillStyle='#43331d';c.fillRect(x-tw/2,baseY-0.6,tw,thh);
c.strokeStyle='rgba(32,23,11,0.85)';c.lineWidth=Math.max(0.4,s*0.08);
c.strokeRect(x-tw/2,baseY-0.6,tw,thh);
const lum=0.80+tone*0.40;
c.beginPath();c.moveTo(x,apexY);c.lineTo(x-wd,baseY);c.lineTo(x+wd,baseY);c.closePath();
c.fillStyle=`rgb(${(88*lum)|0},${(112*lum)|0},${(78*lum)|0})`;c.fill();
c.beginPath();c.moveTo(x,apexY);c.lineTo(x+wd,baseY);c.lineTo(x,baseY);c.closePath();
c.fillStyle='rgba(20,28,12,0.46)';c.fill();
c.strokeStyle='rgba(24,32,15,0.5)';c.lineWidth=Math.max(0.35,s*0.09);
c.beginPath();c.moveTo(x-wd*0.62,baseY-s*0.30);c.lineTo(x+wd*0.62,baseY-s*0.30);
c.moveTo(x-wd*0.32,baseY-s*0.62);c.lineTo(x+wd*0.32,baseY-s*0.62);c.stroke();
c.strokeStyle='rgba(26,34,16,0.92)';c.lineWidth=Math.max(0.5,s*0.13);
c.beginPath();c.moveTo(x-wd,baseY);c.lineTo(x,apexY);c.lineTo(x+wd,baseY);c.stroke();}
// Deciduous — round lumpy canopy (temperate, subtropical broadleaf)
function atlasRoundTree(c,x,y,s,tone){
const rad=s*0.58,cy=y-s*0.10;
const tw=Math.max(0.8,s*0.15),thh=s*0.34;
c.fillStyle='#4a3820';c.fillRect(x-tw/2,cy+rad*0.5,tw,thh);
c.strokeStyle='rgba(32,23,11,0.8)';c.lineWidth=Math.max(0.4,s*0.08);
c.strokeRect(x-tw/2,cy+rad*0.5,tw,thh);
const lum=0.82+tone*0.36;
c.beginPath();
c.arc(x-rad*0.46,cy+rad*0.14,rad*0.62,0,6.2832);
c.arc(x+rad*0.46,cy+rad*0.18,rad*0.58,0,6.2832);
c.arc(x-rad*0.04,cy-rad*0.40,rad*0.66,0,6.2832);
c.arc(x+rad*0.22,cy+rad*0.04,rad*0.60,0,6.2832);
c.fillStyle=`rgb(${(128*lum)|0},${(142*lum)|0},${(74*lum)|0})`;c.fill();
c.strokeStyle='rgba(40,46,22,0.9)';c.lineWidth=Math.max(0.5,s*0.12);c.stroke();}
// Jungle — broad, dark, low spreading canopy (rainforest)
function atlasJungleTree(c,x,y,s,tone){
const tw=Math.max(0.7,s*0.12);
c.fillStyle='#3a2c18';c.fillRect(x-tw/2,y-s*0.04,tw,s*0.44);
const lum=0.72+tone*0.34,cy=y-s*0.30;
c.beginPath();
c.arc(x-s*0.62,cy+s*0.08,s*0.42,0,6.2832);
c.arc(x+s*0.62,cy+s*0.08,s*0.40,0,6.2832);
c.arc(x-s*0.24,cy-s*0.10,s*0.47,0,6.2832);
c.arc(x+s*0.26,cy-s*0.08,s*0.46,0,6.2832);
c.arc(x,cy+s*0.04,s*0.44,0,6.2832);
c.fillStyle=`rgb(${(70*lum)|0},${(94*lum)|0},${(50*lum)|0})`;c.fill();
c.strokeStyle='rgba(18,26,11,0.92)';c.lineWidth=Math.max(0.45,s*0.1);c.stroke();}
// Acacia — flat-topped crown on a tall trunk (tropical dry forest, savanna)
function atlasAcacia(c,x,y,s,tone){
const tw=Math.max(0.7,s*0.12),topY=y-s*0.46;
c.fillStyle='#4a3820';c.fillRect(x-tw/2,topY+s*0.06,tw,s*0.58);
c.strokeStyle='rgba(32,23,11,0.8)';c.lineWidth=Math.max(0.35,s*0.07);
c.strokeRect(x-tw/2,topY+s*0.06,tw,s*0.58);
const lum=0.80+tone*0.34;
c.beginPath();c.ellipse(x,topY,s*0.78,s*0.27,0,0,6.2832);
c.fillStyle=`rgb(${(122*lum)|0},${(130*lum)|0},${(70*lum)|0})`;c.fill();
c.strokeStyle='rgba(40,44,22,0.88)';c.lineWidth=Math.max(0.45,s*0.1);c.stroke();}
// Grass tuft — a small fan of curved blades
function atlasTuft(c,x,y,s,tone){
c.strokeStyle=`rgba(${(94+tone*46)|0},${(104+tone*30)|0},${(58+tone*22)|0},0.82)`;
c.lineWidth=Math.max(0.34,s*0.16);
c.beginPath();
c.moveTo(x,y);c.quadraticCurveTo(x-s*0.55,y-s*0.5,x-s*0.78,y-s*1.05);
c.moveTo(x,y);c.quadraticCurveTo(x-s*0.05,y-s*0.7,x+s*0.04,y-s*1.32);
c.moveTo(x,y);c.quadraticCurveTo(x+s*0.5,y-s*0.5,x+s*0.74,y-s*1.0);
c.stroke();}
// Shrub — a small lumpy bush
function atlasShrub(c,x,y,s,tone){
c.beginPath();
c.arc(x-s*0.42,y,s*0.5,0,6.2832);
c.arc(x+s*0.42,y+s*0.05,s*0.46,0,6.2832);
c.arc(x,y-s*0.4,s*0.54,0,6.2832);
c.fillStyle=`rgba(${(84+tone*34)|0},${(96+tone*26)|0},${(56+tone*20)|0},0.72)`;c.fill();
c.strokeStyle='rgba(42,48,28,0.6)';c.lineWidth=Math.max(0.3,s*0.12);c.stroke();}




const HISTORY_INTERVAL = 100;    // sim steps between History-chart samples
// ── SINGLE CANVAS: terrain + overlay composited together ──
export default function WorldSim(){
const canvasRef=useRef(null);
// Resolution-agnostic FEATURE overlay: a second canvas stacked over the map, always at a FIXED
// resolution (FEAT_W) regardless of the map scale, so borders / roads / settlement icons are drawn
// at a constant resolution and always look the same crisp size. The map (terrain + political tints)
// stays at map resolution below it; this canvas carries only the vector features.
const featRef=useRef(null);
const[seed,setSeed]=useState(8817);const[world,setWorld]=useState(null);
const[genBusy,setGenBusy]=useState(false);   // a world is being forged — show it (regens keep the old map up for ~a minute, which read as a dead control)
const[genesisProg,setGenesisProg]=useState(null); // mint-ready gather progress from the sim worker {phase,step,inventStep}
const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState(30);// speed = target ticks/sec (30 ≈ 1 step per frame)
// A sim/worker failure the user must SEE: {where:'step'|'snapshot'|'message'|'worker', step, message}.
// Before this, a worker error was console-only — a thrown step left the game silently frozen at its
// last frame forever ("the game shuts down at step N"), with the world still alive and saveable.
const[simError,setSimError]=useState(null);
// Quiet-ages auto-throttle (worker: autoEpoch): before the first nation the
// sim fast-forwards at the frame budget's max; the chip shows it and clicking
// it hands the dial back to the user.
const[autoEpoch,setAutoEpoch]=useState(true);
const[fastEpoch,setFastEpoch]=useState(false);
const[quietAges,setQuietAges]=useState(false);
// The stale-tab detector (owner report 2026-08-19: "a certain type of change
// doesn't reflect in the sim I run"): a long-lived tab keeps running the
// bundle it loaded with — deploys only arrive on a RELOAD, and reloading
// loses an unsaved world, so marathon tabs run days-old code without any
// visible sign. The deploy workflow writes version.json beside the bundle;
// this polls it and raises a header chip when the deployed sha differs from
// the one baked into this tab (__BUILD_SHA__, vite define). Local dev has
// neither — silent.
const[staleBuild,setStaleBuild]=useState(false);
const[buildInfo,setBuildInfo]=useState(null); // version.json {sha,branch,channel,…} when deployed
// Boot diagnostic (one console line): the build this tab runs + the live
// physics defaults. When "the update didn't take", F12 → this line IS the
// ground truth — paste it, compare shas/values, done. Printed once per boot.
useEffect(()=>{
  const sha=typeof __BUILD_SHA__!=="undefined"?__BUILD_SHA__:"dev";
  console.log(`[simman] build ${sha} · physics v${SAVE_VERSION} · iso=${typeof crossOriginIsolated!=="undefined"?crossOriginIsolated:"n/a"} · defaults DAWN_LIVE=${SIM_T.DAWN_LIVE} INVENT_JUMP=${SIM_T.INVENT_JUMP} STATE_RECORDS=${SIM_T.STATE_RECORDS} LAND_KNOW=${SIM_T.LAND_KNOW} BAND_SUM=${SIM_T.BAND_SUM} IRR_BAND=${SIM_T.IRR_BAND} FIELD_CRADLE=${SIM_T.FIELD_CRADLE} MARCH_FUNDED=${SIM_T.MARCH_FUNDED}`);
},[]);
// Bundle identity for the header chip — always available (unlike version.json,
// which only exists on deployed Pages builds). Local vite → "dev".
const buildSha=typeof __BUILD_SHA__!=="undefined"?__BUILD_SHA__:"dev";
const buildShort=buildSha==="dev"?"dev":buildSha.slice(0,8);
useEffect(()=>{
  const sha=typeof __BUILD_SHA__!=="undefined"?__BUILD_SHA__:"dev";
  if(sha==="dev")return;
  let stop=false;
  const check=()=>fetch(import.meta.env.BASE_URL+"version.json",{cache:"no-store"})
    .then(r=>r.ok?r.json():null)
    .then(v=>{
      if(stop||!v)return;
      setBuildInfo(v);
      if(v.sha&&v.sha!==sha)setStaleBuild(true);
    })
    .catch(()=>{});
  check();   // immediate — populate the channel chip; also catch a just-landed deploy
  const iv=setInterval(check,5*60e3);
  const onVis=()=>{if(document.visibilityState==="visible")check();};
  document.addEventListener("visibilitychange",onVis);
  return()=>{stop=true;clearInterval(iv);document.removeEventListener("visibilitychange",onVis);};
},[]);
const[viewMode,setViewMode]=useState("terrain");const[preset,setPreset]=useState("earth_sim");
// Prices lens: which good's local price paints the map (index into GOODS).
const[priceGood,setPriceGood]=useState(3);const priceGoodRef=useRef(3);
useEffect(()=>{priceGoodRef.current=priceGood;},[priceGood]);
// Transport-test mode state. Each click in this view places a capital;
// the BFS re-runs whenever params or capitals change.
const[depthFromSea,setDepthFromSea]=useState(false);
const[depthCeil,setDepthCeil]=useState(1.0);
const[showPlates,setShowPlates]=useState(false);
const[showRivers,setShowRivers]=useState(false);
const[showStreams,setShowStreams]=useState(false);
const[showLakes,setShowLakes]=useState(false);
const[importStatus,setImportStatus]=useState(null);
const[hoverInfo,setHoverInfo]=useState(null);
const[tecPresetName,setTecPresetName]=useState("Default");
const[showTuning,setShowTuning]=useState(false);
// ── iPhone mode: below 760px the codex becomes a slide-over drawer, the top
// bar sheds its dense readouts, the legend starts collapsed, and map labels
// get a physical floor. Pure display adaptation — same state, same engine.
const _mqNarrow=typeof matchMedia!=="undefined"?matchMedia("(max-width: 760px)"):null;
const[narrow,setNarrow]=useState(()=>!!(_mqNarrow&&_mqNarrow.matches));
const narrowRef=useRef(narrow);
useEffect(()=>{narrowRef.current=narrow;},[narrow]);
useEffect(()=>{
  const mq=matchMedia("(max-width: 760px)");
  const on=()=>setNarrow(mq.matches);
  mq.addEventListener("change",on);
  return()=>mq.removeEventListener("change",on);
},[]);
const[codexOpen,setCodexOpen]=useState(false);   // narrow only: the codex drawer
// peopleSim settlement selection — id of the clicked settlement, or -1.
const[selectedSettlementId,setSelectedSettlementId]=useState(-1);
const[settTraceEvery,setSettTraceEvery]=useState(10);
const[settTrace,setSettTrace]=useState({recording:false,id:-1,n:0,every:10,name:"",max:600});
const[settTraceCopied,setSettTraceCopied]=useState(false);
// ── Floating surfaces: ALL popovers/drawers/documents live on ONE external
// stack (src/ui/surfaces.js) — exclusive popovers & drawers, stacking
// documents, Esc pops the top, z from stack order. The derived consts +
// shim setters below keep every existing call site working unchanged.
const _surfStack=useSurfaceStack();
const _sOpen=(id)=>_surfStack.some(s=>s.id===id);
const menuOpen=_sOpen("menu"),        newWorldOpen=_sOpen("newworld"),
      chronicleOpen=_sOpen("chronicle"), dynastyOpen=_sOpen("dynasty"),
      techTreeOpen=_sOpen("techtree"),   layersOpen=_sOpen("layers"),
      helpOpen=_sOpen("help"),           leversOpen=_sOpen("levers"),
      editorOpen=_sOpen("editor");
const rightPanel=_sOpen("wind")?"params":"";
const _mkSet=(id,kind)=>(v)=>{const next=typeof v==="function"?v(isSurfaceOpen(id)):v;if(next)openSurface(id,kind);else closeSurface(id);};
const setMenuOpen=_mkSet("menu","popover"),      setLayersOpen=_mkSet("layers","popover"),
      setNewWorldOpen=_mkSet("newworld","document"), setChronicleOpen=_mkSet("chronicle","document"),
      setDynastyOpen=_mkSet("dynasty","document"),   setTechTreeOpen=_mkSet("techtree","document"),
      setHelpOpen=_mkSet("help","document"),         setLeversOpen=_mkSet("levers","drawer"),
      setEditorOpen=_mkSet("editor","drawer");
const setRightPanel=(v)=>{const val=typeof v==="function"?v(rightPanel):v;if(val==="params")openSurface("wind","drawer");else closeSurface("wind");};
const _zOf=(id)=>surfaceZ(_surfStack,id);
const[lens,setLens]=useState("terrain");const subMemRef=useRef({});
const[panelTab,setPanelTab]=useState("world");   // World Panel tab: world|realms|peoples|faiths|inspect
useEffect(()=>{panelTabRef.current=panelTab;},[panelTab]);
const[realmSel,setRealmSel]=useState(-1);   // realm inspected in the Realms tab
// ── Country editor: arm placement, then click the map to drop a seed capital
// with the chosen tech/knowledge/personality and watch what it grows into. ──
const[editorArmed,setEditorArmed]=useState(false); // next map click PLACES instead of selects
const[edParams,setEdParams]=useState({tier:2,people:500,
  knowledge:{agriculture:0.6,construction:0.3,organization:0.4,metallurgy:0.3,navigation:0.1,mobility:0.2},
  personality:{aggression:0,commerce:0,expansionism:0}});
const editorArmedRef=useRef(false);const edParamsRef=useRef(edParams);
useEffect(()=>{editorArmedRef.current=editorArmed;},[editorArmed]);
useEffect(()=>{edParamsRef.current=edParams;},[edParams]);
// Ref mirror so draw() (memoized) sees the current selection without
// needing the state in its dep list.
const selectedSettlementIdRef=useRef(-1);
const selRealmRef=useRef(-1);   // realmSel mirrored for the draw loop (map highlight + label emphasis)
useEffect(()=>{selRealmRef.current=realmSel;},[realmSel]);
const panelTabRef=useRef("world");   // mirrored for nav pushes from canvas handlers
useEffect(()=>{selectedSettlementIdRef.current=selectedSettlementId;},[selectedSettlementId]);
// ── Layer visibility ────────────────────────────────────────────────
// All toggles for what gets drawn on the peopleSim view. Tier toggles
// independently hide villages / towns / cities / metropolises; the road
// overlay also respects them (links with both endpoints in a hidden tier
// drop out). Stored as a single state object so the panel can edit it
// declaratively; mirrored to a ref so draw() (memoized) reads current
// values without needing them in its deps.
const[layers,setLayers]=useState({
  icons:true, tints:true, borders:true, provinces:true, roads:true, seaLanes:true,
  warFronts:true, sieges:true,   // war overlay: aggressor→defender arrows + siege/sack marks
  moneyFlow:true, ships:true, shocks:true,
  village:true, town:true, city:true, metropolis:true,
  labels:true, emblems:true,   // names + heraldry drawn on the map (plan §5.1–5.2)
});
const[dockFly,setDockFly]=useState(null);      // lens id whose sub-lens flyout is open (hover-transient)
const[tuneVals,setTuneVals]=useState(()=>tuningDefaults());
const tuneValsRef=useRef(tuneVals);
// Push a tuning change to the sim. Covers BOTH execution paths: postMessage to
// the worker (normal) and a direct applyTuning for the main-thread fallback sim.
const pushTune=useCallback((vals,reset)=>{
  if(reset){resetTuning();}
  applyTuning(vals);
  if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'tune',values:vals,reset:!!reset});
},[]);
const onLeverChange=useCallback((key,val)=>{
  setTuneVals(prev=>{const next={...prev,[key]:val};tuneValsRef.current=next;return next;});
  pushTune({[key]:val});
},[pushTune]);
const onLeverResetKey=useCallback((key)=>{
  const def=tuningDefaults()[key];
  setTuneVals(prev=>{const next={...prev,[key]:def};tuneValsRef.current=next;return next;});
  pushTune({[key]:def});
},[pushTune]);
const onLeverResetAll=useCallback(()=>{
  const def=tuningDefaults();tuneValsRef.current=def;setTuneVals(def);
  pushTune(def,true);
},[pushTune]);
const[boardMode,setBoardMode]=useState("countries");   // "countries" | "settlements"
const[boardSort,setBoardSort]=useState("size");        // see SORT_KEYS below
const[boardQuery,setBoardQuery]=useState("");          // browser search (name filter)
const layersRef=useRef(layers);
useEffect(()=>{layersRef.current=layers;},[layers]);
// Country view: live per-country hue assignment (seeded by the previous solve so
// colours drift smoothly as borders shift). Map: countryId → hue 0..360.
const countryColorsRef=useRef(new Map());
// Black diagonal stripes overlaid on COLONY territory (a dependency is drawn in its metropole's
// colour, striped to mark it). A repeating canvas pattern anchored at the origin can miss a tiny
// one-tile colony entirely — it lands in a gap between stripes and shows nothing — so instead we
// CLIP to the colony cells and stroke parallel 45° lines whose spacing scales with the tile size.
// That guarantees visible, continuous stripes on a colony of any size, down to a single tile.
function stripeCells(ctx,cells,TR,alpha){
  if(!cells||!cells.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  ctx.save();
  ctx.beginPath();
  for(let i=0;i<cells.length;i+=2){const x=cells[i],y=cells[i+1];ctx.rect(x,y,TR+0.6,TR+0.6);
    if(x<minX)minX=x;if(y<minY)minY=y;if(x+TR>maxX)maxX=x+TR;if(y+TR>maxY)maxY=y+TR;}
  ctx.clip();                                                 // stripes only fall on colony ground
  const gap=Math.max(2.6,TR*0.9);                             // stripe spacing follows the zoom
  ctx.strokeStyle=`rgba(0,0,0,${alpha})`;ctx.lineWidth=Math.max(1,TR*0.42);ctx.lineCap="butt";
  ctx.beginPath();
  for(let c=minX+minY;c<=maxX+maxY+gap;c+=gap){ctx.moveTo(c-minY,minY);ctx.lineTo(c-maxY,maxY);}  // x+y=c → 45°
  ctx.stroke();
  ctx.restore();
}
// Which collapsible sections of the settlement card are open. Persists
// across re-renders (the card re-renders every few ticks) and across
// selecting different settlements.
const[psCardOpen,setPsCardOpen]=useState({food:true,tech:true,knowledge:false,resources:false,trade:true,chronicle:true});
const togglePsCard=id=>setPsCardOpen(o=>({...o,[id]:!o[id]}));
const[useRealWind,setUseRealWind]=useState(true);   // Earth (Sim) default: OBSERVED climate (NCEP wind/rain/temp) — owner decision 2026-08; uncheck to simulate the climate instead. Only consulted on the earth_sim preset (see _realWind), degrades to simulated if the data isn't loaded.
const useMercator=false;
const[showGlobe,setShowGlobe]=useState(false);
const[globeBuf,setGlobeBuf]=useState(null);
const[globeVer,setGlobeVer]=useState(0);          // bumps when the (reused) globe buffer's contents changed
const globeBufScratchRef=useRef(null);            // the one 25MB texture buffer, reused across rebuilds
const globeStampRef=useRef(0);                    // last globe rebuild time (throttle)
const[globeTexSize,setGlobeTexSize]=useState({w:4096,h:2048});
// Map SCALE: the worldgen (and therefore sim) grid width in pixels. Lower = coarser coastlines
// but FASTER, MORE-VARIED development (the sim develops per real-area, and at high resolution the
// same Earth is spread over 4× the tiles, so ~half as many civilisations form per step — see the
// resolution-invariance investigation). 1920 = "2×" (finest, current default), 960 = "1×",
// 480 = "0.5×" (the calibration reference — most varied, quickest to fill). Canvas dims scale WITH
// the world (RES stays 1, world == canvas), so the map keeps its screen size, just pixelated finer
// or coarser. Changing this re-memoises `generate` (W/H are in its deps), which auto-regenerates
// the SAME seed at the new resolution via the [seed,generate] effect.
const[mapScale,setMapScale]=useState(1920);
// Sim resolution is DECOUPLED from map resolution: simDiv is how many map pixels each
// sim tile spans (1 = sim matches the land, 2 = half [default], 4 = quarter/faster). Map
// resolution (mapScale) sets terrain/coast crispness; simDiv sets sim granularity — which
// is speed AND emergent detail (a finer grid seeds more river cradles → a different world).
const[simDiv,setSimDiv]=useState(2);   // sim granularity default: HALF (tw=960) — owner decision 2026-08 (docs/shape-of-the-map-2026-08.md: the small-state tier of the political map exists at this grid and cannot be represented at Quarter; measured 69% of realms under 100k km² early vs 2-8% at the coarse grids). ~4× the sim cost of Quarter — the old phone-friendly default is one click away.
const genW=mapScale,genH=mapScale>>1;   // REQUESTED scale — the size the NEXT world generates at
// Render/data dimensions track the ACTUAL loaded world, never the requested mapScale. Worldgen is
// async, so between the scale change and the new world arriving the two differ; keying the canvas /
// terrain / sim-tile / overlay math off the loaded world keeps them all on ONE consistent resolution
// (a desync made tw↔CW disagree and blanked the overlay). Falls back to mapScale before the first world.
const W=world?world.width:mapScale, H=world?world.height:(mapScale>>1), CW=W;
const CH=useMercator?Math.round(2*MERC_MAX*H/Math.PI):H;
// Feature overlay is a FIXED resolution (independent of mapScale) with the same aspect as the map,
// so vector features render identically at every scale. CH/CW is constant across scales ⇒ FEAT_H fixed.
const FEAT_W=1920, FEAT_H=Math.round(FEAT_W*CH/CW);
_mercator=useMercator;
const[activeRes,setActiveRes]=useState(()=>{const s={};for(const r of RESOURCES)s[r.id]=true;return s;});
const[activeGoods,setActiveGoods]=useState(()=>{const s={};for(const[id]of GOODS_FLOW_LABELS)s[id]=true;return s;});
const[keyOpen,setKeyOpen]=useState(()=>!(typeof matchMedia!=="undefined"&&matchMedia("(max-width: 760px)").matches));   // phone: legend starts collapsed
useEffect(()=>{
  // On mouse-up, clear any in-flight pan that ended outside the canvas —
  // otherwise the next click would see panDragRef with a stale "moved" flag
  // and either pan or swallow the click depending on timing.
  const up=()=>{if(panDragRef.current&&!panDragRef.current.moved)panDragRef.current=null;};
  window.addEventListener("mouseup",up);
  return()=>window.removeEventListener("mouseup",up);
},[]);
const activeResRef=useRef(null);activeResRef.current=activeRes;
const activeGoodsRef=useRef(null);activeGoodsRef.current=activeGoods;
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(30),viewRef=useRef("terrain");
// ── Pan / zoom view transform ────────────────────────────────────────
// All map drawing applies `ctx.translate(panX,panY); ctx.scale(zoom,zoom)`
// so the existing draw code can stay in canvas-pixel coordinates; only the
// inverse is needed when hit-testing a click or hover. Stored as refs to
// avoid re-renders during a drag — the `draw()` call already runs every
// frame so we don't need React state for these to repaint.
const viewXRef=useRef(0),viewYRef=useRef(0),viewZRef=useRef(1);
const panDragRef=useRef(null);   // {sx,sy,vx,vy} during a middle/right or drag-from-empty-space pan
const hoverThrottleRef=useRef({ti:-2,t:0,x:0,y:0});   // hover-card re-render throttle (see onCanvasMove)
const ZOOM_MIN=0.5,ZOOM_MAX=8;
// peopleSim world — entity-based replacement for the legacy tribe system.
// Bands, settlements, etc. live here. The legacy `ter` object is kept
// alive only so the existing draw() pipeline doesn't break; it is not
// stepped (the runTribeStep call is disabled below).
const peopleRef=useRef(null);
// peopleSim runs in a Web Worker so its heavy passes can't stutter rendering.
// simWorkerRef holds the worker; peopleRef.current becomes a MIRROR populated
// from snapshots (shaped like the real world so draw()/the card read it
// unchanged). If the worker can't start, we fall back to stepping on the main
// thread (simWorkerRef stays null and the rAF loop steps as before).
const simWorkerRef=useRef(null);
// Monotonic id stamped on every generate() request. Worldgen runs in a worker, so a
// slow result (e.g. the initial 1920-wide world, ~25s) can land AFTER the scale changed
// — initialising the sim at a resolution that no longer matches the canvas (mapScale),
// which desyncs tw↔CW and blanks the overlay. Results whose id isn't the latest are dropped.
const genIdRef=useRef(0);
// Sim tile resolution (simDiv) read by finalizeWorld — a ref so the async worldgen
// finalize sees the value chosen at request time even though finalizeWorld is memoised.
const simTileResRef=useRef(2);   // mirrors simDiv's new Half default (finalizeWorld reads the ref at request time)
const applySnapshotRef=useRef(null);
const [psStats,setPsStats]=useState({step:0,bands:0,settlements:0,totalPeople:0});
// Live step counter, refreshed EVERY snapshot (~30Hz) so the year/step in the top
// bar visibly counts up tick-by-tick; the heavier psStats stays throttled to ~5Hz.
const [liveStep,setLiveStep]=useState(0);
// Timeline scrub (owner feature): null = live map; a number = the step the
// user is scrubbing to. scrubRef gates live-snapshot overwrites of the
// political layer; scrubShown mirrors the keyframe step actually displayed.
const [scrubStep,setScrubStep]=useState(null);
const scrubRef=useRef(false);
const [scrubShown,setScrubShown]=useState(null);
// The atlas bar (owner feature): hide nations below this claimed km² on the
// map — settlement-holding nations always show. Default: principality scale,
// the cutoff world-zoom historical atlases actually draw.
const [minKm2,setMinKm2]=useState(20000);
const fbTimelineRef=useRef(makeTimeline());   // fallback-mode history frames (worker mode keeps its own store)
const fbKeyRef=useRef(0);
const pausedDrawRef=useRef(0);
const drawNowRef=useRef(null);
const uiPulseRef=useRef(0);   // last React-pulse time — gates snapshot-driven renders to ≤4Hz
// Time-series of global metrics for the History charts + copyable export. Kept
// in a ref (no re-render on every sample); the charts read it on the regular
// psStats-driven re-render. Sampled every HISTORY_INTERVAL sim steps.
const psHistoryRef=useRef([]);
const [statsCopied,setStatsCopied]=useState(false);
const oceanLevelRef=useRef(0.78);const pendingSaveRef=useRef(null);const downloadSaveRef=useRef(null);const saveFileRef=useRef(null);const depthFromSeaRef=useRef(false);const depthCeilRef=useRef(1.0);const showPlatesRef=useRef(false);const showRiversRef=useRef(false);const showStreamsRef=useRef(false);const showLakesRef=useRef(false);const showGlobeRef=useRef(false);
const presetRef=useRef("earth_sim");const fileRef=useRef(null);const importedWorldRef=useRef(null);
const useRealWindRef=useRef(true);   // mirrors useRealWind's new default (the ref is what worldgen actually reads)
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
const atlasCache=useRef(null);
// Offscreen cache for the political overlay (territory tint + borders + roads).
// That overlay is a pure function of owner[]/roadQuality[], which change only
// slowly (territory recomputes every 96 ticks, roads on plan cycles), yet it
// re-rasterised ~460k tiles every frame. We render it to this canvas and only
// regenerate every PS_OVERLAY_REGEN sim-steps, blitting it otherwise.
const psOverlayRef=useRef(null);
// Political TINTS render on their own MAP-resolution layer (psTintRef), separate from the
// FEAT-resolution borders/roads (psOverlayRef/ov): tints are area fills that want to hug the
// coastline crisply, so they're drawn 1px-per-sim-tile into psTintSrcRef, nearest-owned
// flood-filled, then nearest-upscaled to the map grid + coast-clipped. Borders/roads/icons stay
// as the smooth 1920-res vectors on the feature canvas.
const psTintSrcRef=useRef(null);   // sim-res (tw×th) owner colours, 1px per tile
const psTintRef=useRef(null);      // map-res (CW×CH) tint layer, coast-clipped
const psOverlayMeta=useRef({step:-1,ch:0});
const identityFillRef=useRef(null);   // cached nearest-settlement map for the people/faith/language overlays
const labelAnchorsRef=useRef(null);   // cached realm-label anchors (recomputed when a new claim grid arrives)
const[toastVerbosity]=useState("epochal");   // "all" | "epochal" | "silent" (feed-bell menu, future)
const[feedCats,setFeedCats]=useState(()=>new Set());   // active feed category filters (empty = all)
const ancRevealRef=useRef({start:0,active:false});   // deep-ancestry "peopling" replay: wavefront spread time + whether animating
// Reusable scratch for the money-flow coin particles (money view). Coins are
// bucketed by link busyness so the whole overlay costs ~4 fillStyle changes
// instead of one per link; the position arrays are reused across frames to
// avoid per-frame allocation at 60fps.
const moneyDotsRef=useRef(null);
// Offscreen cache of the STATIC base raster (terrain etc.). Rebuilt only when
// the view or a relevant toggle changes; blitted every frame otherwise — the
// per-pixel terrain rebuild + putImageData was a big per-frame cost now that
// the sim is off-thread.
const baseLayerRef=useRef(null);
const baseLayerKey=useRef(null);
// Full-resolution LAND mask (opaque on land, transparent on ocean), used to clip the HALF-res
// political overlay to the real coastline so coasts stay crisp while the interior stays coarse.
const landMaskRef=useRef(null);
const landMaskKey=useRef(null);
// Reuse ImageData between frames to avoid 7.3MB allocation per draw
const imgRef=useRef(null);
// Wind particle animation state
const windParticlesRef=useRef(null);
// W, H, CW, CH are derived from mapScale above (near the CH definition).
const workerRef=useRef(null);
// Helper: finalize a generated world (shared by worker + main thread paths)
const finalizeWorld=useCallback((w)=>{
// generateWorld stamps the seed as `_seed`; everything downstream (people-sim
// RNG, resource placement) reads `w.seed`. Without this alias the sim's RNG
// silently fell back to seed 1 for EVERY world.
if(w.seed==null)w.seed=w._seed??1;
setGenBusy(false);
resetEmblems();labelAnchorsRef.current=null;   // a new world bears new arms & names
setWorld(w);worldRef.current=w;const t=buildTerritory(w,RES);
terRef.current=t;
// Rivers (and deposits) are computed inside buildTerritory and stored
// on the `ter` object, not on the raw worldgen output. peopleSim reads
// from `w` — so re-export those onto `w` so the cradle finder + settle
// check + later trade/port phases can see water access.
if(t.rivers)w.rivers=t.rivers;
if(t.deposits)w.deposits=t.deposits;
// peopleSim: entity-based simulator that replaces the legacy tribe model.
// Pass t.tCrop so the sim's fertility uses the SAME formula as the
// Crop overlay (young-soil discount, tropical penalty, wide bell).
// Runs in a Web Worker (off the render thread); peopleRef.current becomes a
// snapshot-fed mirror. Falls back to a main-thread sim if the worker fails.
let usedWorker=false;
// Real-wind saves must load on the MAIN thread: the NCEP wind data lives in
// this bundle only, so the worker's loadWorld would rebuild sim-wind terrain
// under a civilization that grew on real-wind terrain. Decide from the
// save's PARSED meta — a string sniff broke on any re-serialized save.
let _pendMeta=null;
if(pendingSaveRef.current){try{_pendMeta=JSON.parse(pendingSaveRef.current).meta||null;}catch{/* malformed JSON: loadWorld below raises the real error */}}
const _pendRW=!!(_pendMeta&&_pendMeta.realWind);
try{
  // Retire the previous sim worker FIRST, on every path: on the main-thread
  // load route a surviving worker kept stepping the OLD world (the rAF loop
  // defers to simWorkerRef) and its snapshots clobbered the loaded one.
  if(simWorkerRef.current){simWorkerRef.current.terminate();simWorkerRef.current=null;}
  if(_pendRW)throw new Error('real-wind save — loading on the main thread');
  setSimError(null);   // a fresh worker/world starts with a clean bill
  setGenesisProg({ phase: "starting", step: 0 });
  const sw=new PeopleSimWorker();
  const sawSnap={current:false};   // has this worker ever delivered a frame? gates the onerror fallback below
  sw.onmessage=(e)=>{
    const d=e.data;
    if(d.type==='snapshot'){sawSnap.current=true;setGenesisProg(null);if(applySnapshotRef.current)applySnapshotRef.current(d);}
    else if(d.type==='genesisProgress'){
      // Worker still inside initPeopleSim's mint-ready gather — ticks won't move
      // until this finishes; surface it so "play does nothing" isn't a mystery.
      setGenesisProg(d);
    }
    else if(d.type==='timelineFrame'){
      // The scrubbed frame rides a RENDER-ONLY override (_scrubClaim) — never
      // the authoritative layer (in fallback mode that array IS the sim's).
      const psw=peopleRef.current;
      if(psw&&scrubRef.current){
        const old=psw._scrubClaim;   // displaced per drag-notch — send its buffer home (buffer-return pool)
        psw._scrubClaim=d.frame;psw._claimVer=(psw._claimVer||0)+1;setScrubShown(d.step);if(drawNowRef.current)drawNowRef.current();
        if(old&&old.buffer&&old.buffer.byteLength){try{sw.postMessage({type:'bufret',bufs:[old.buffer]},[old.buffer]);}catch(e2){/* fall back to GC */}}
      }
    }
    else if(d.type==='saveData'){downloadSaveRef.current&&downloadSaveRef.current(d.json,d.step);}
    else if(d.type==='historyData'){
      const blob=new Blob([d.json],{type:"application/json"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);
      a.download=`simman-history-t${d.step??""}.json`;a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }
    else if(d.type==='settTraceData'){
      const json=d.json||"";
      const n=d.n|0;
      const name=(d.name||"settlement").replace(/[^\w\-]+/g,"_").slice(0,40);
      const save=()=>{
        const blob=new Blob([json||"{}"],{type:"application/json"});
        const a=document.createElement("a");a.href=URL.createObjectURL(blob);
        a.download=`simman-${name}-trace.json`;a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href),5000);
      };
      if(!json||d.empty){setSettTraceCopied(false);return;}
      const tryCopy=async()=>{
        try{
          if(navigator.clipboard&&navigator.clipboard.writeText) await navigator.clipboard.writeText(json);
          else throw new Error("no clipboard");
          setSettTraceCopied(true);
          setTimeout(()=>setSettTraceCopied(false),2000);
        }catch{
          save();
        }
      };
      // Huge traces miss the clipboard — download so nothing is lost.
      if(json.length>1_000_000) save();
      tryCopy();
    }
    else if(d.type==='runLog'){
      // The run journal (worker journalTick): the observation file to hand to
      // Claude — drop into docs/runs/ or paste; reads 1:1 vs the ladder tables.
      const blob=new Blob([d.text],{type:"text/plain"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);
      a.download=`simman-run-t${d.step??""}.txt`;a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }
    else if(d.type==='runReportData'){
      // The full observation artifact: one self-contained HTML — provenance,
      // a political-map image per ~1000 steps (temporally-stable hues via the
      // scrubber's own relaxation; identity roots for historical frames), and
      // the journal with its telemetry-funnel windows.
      const {tw,th,land,frames}=d;
      let hues=new Map();
      const cnv=document.createElement("canvas");cnv.width=tw;cnv.height=th;
      const cx2=cnv.getContext("2d");
      const out=document.createElement("canvas");out.width=tw*2;out.height=th*2;
      const ox=out.getContext("2d");ox.imageSmoothingEnabled=false;
      const h2rgb=(h)=>{const f=(n)=>{const k=(n+h/30)%12;return Math.round(255*(0.5-0.42*Math.max(-1,Math.min(1,Math.min(k-3,9-k)))));};return [f(0),f(8),f(4)];};
      const imgs=frames.map(fr=>{
        hues=assignCountryColors(fr.claim,tw,th,hues,null);
        const img=cx2.createImageData(tw,th);const p=img.data;
        for(let i=0;i<fr.claim.length;i++){
          const o=i*4;const id=fr.claim[i];
          if(!land[i]){p[o]=12;p[o+1]=16;p[o+2]=24;}
          else if(id<0){p[o]=42;p[o+1]=45;p[o+2]=51;}
          else{const hu=hues.get(id);const rgb=h2rgb(hu!=null?hu:((id*2654435761)>>>0)%360);p[o]=rgb[0];p[o+1]=rgb[1];p[o+2]=rgb[2];}
          p[o+3]=255;
        }
        cx2.putImageData(img,0,0);ox.drawImage(cnv,0,0,out.width,out.height);
        return `<figure style="margin:12px 0"><img src="${out.toDataURL("image/png")}" style="width:100%;image-rendering:pixelated"/><figcaption style="font:11px monospace;color:#888">step ${fr.step}</figcaption></figure>`;
      }).join("");
      const esc=(s)=>s.replace(/</g,"&lt;");
      const html=`<!doctype html><meta charset="utf-8"><title>Simman run t${d.step}</title><body style="background:#14110d;color:#d8cdb8;max-width:1100px;margin:20px auto;font:13px/1.5 monospace"><pre>${esc(d.head)}</pre><h3>Political map every ~1000 steps</h3>${imgs}<h3>Journal (metrics every 250 steps · funnel windows every 1000)</h3><pre style="white-space:pre-wrap">${esc(d.journal)}</pre></body>`;
      const blob=new Blob([html],{type:"text/html"});
      const a=document.createElement("a");a.href=URL.createObjectURL(blob);
      a.download=`simman-report-t${d.step}.html`;a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    }
    else if(d.type==='error'){console.error('[SimWorker]',d.where||'',d.message,d.stack);
      if(d.message&&d.message.indexOf('load failed')===0){alert('Could not load save: '+d.message.slice('load failed: '.length));return;}
      // Surface it. A STEP error means the worker paused the sim on a mid-step
      // throw — mirror that here so the play button tells the truth; the world
      // is still alive in the worker, so Save/Export can rescue the run.
      setSimError({where:d.where||'sim',step:d.step,message:d.message||'unknown error',stack:d.stack||null});
      if(d.where==='step'){playRef.current=false;setPlaying(false);}
    }
  };
  sw.onerror=(err)=>{
    // An UNCAUGHT worker exception. Two very different situations:
    //  * the worker never produced a frame — it failed to BOOT (bundle/init
    //    problem): fall back to the main-thread sim so the app still works.
    //  * it was mid-run — the old unconditional fallback here DESTROYED the
    //    run (terminate + re-init a fresh world at step 0, with init blocking
    //    the main thread for ~a minute at the app grid). The worker's own
    //    handlers now catch and report everything, so reaching here mid-run is
    //    exceptional: keep the worker and the world, surface the error, and
    //    let the user save.
    if(sawSnap.current){
      console.error('[SimWorker] uncaught worker error mid-run:',err.message);
      setSimError({where:'worker',message:err.message||'uncaught worker error',stack:err.filename?`${err.filename}:${err.lineno}`:null});
      return;
    }
    console.warn('[SimWorker] error before first frame — falling back to main-thread sim:',err.message);
    try{if(simWorkerRef.current){simWorkerRef.current.terminate();}}catch{/* already dead */}
    simWorkerRef.current=null;
    peopleRef.current=initPeopleSim(w,{seed:w.seed,tCrop:t.tCrop,tFlood:t.tFlood,tileRes:simTileResRef.current,simTileRes:simTileResRef.current,deposits:t.deposits,tAncestry:t.tAncestry,terTw:t.tw,terTh:t.th,ancestryCount:t.ancestryCount,ancHue:t.ancHue,tArrival:t.tArrival});
    setPsStats(peopleSimStats(peopleRef.current));
  };
  simWorkerRef.current=sw;
  // Console instrument (owner 2026-08-20): window.nations() prints the realm
  // census (km², centre, neighbours, cities, population, wealth, army, org,
  // era) from the sim worker into this console; it also auto-logs whenever
  // the realm register changes, and on a slow heartbeat.
  window.nations=()=>{const w2=simWorkerRef.current;if(!w2)return "sim worker not running (main-thread fallback has no census)";w2.postMessage({type:"nations"});return "realm census → console (from the sim worker)";};
  console.log("[simman] window.nations() → realm census table (auto-logs when the register changes)");
  // Band-worker URL for the popField pool (absolute — the worker's blob
  // context cannot resolve page-relative paths).
  try{sw.postMessage({type:'bandWorkerUrl',url:new URL(popFieldBandWorkerUrl,location.href).href});}catch{/* pool falls back to single-thread */}
  // Empty mirror until the first snapshot arrives.
  peopleRef.current={_isMirror:true,step:0,settlements:[],tw:t.tw||0,th:t.th||0,tileRes:simTileResRef.current,simTileRes:simTileResRef.current,N:0,countries:new Map(),_byId:new Map()};
  // Send ONLY the fields createWorld reads (structured-clone copies them; the
  // main thread keeps its own w arrays for terrain rendering). Avoids cloning
  // the full worldgen object, which may carry non-cloneable extras.
  const initW={width:w.width,height:w.height,seed:w.seed,preset:w.preset,
    elevation:w.elevation,temperature:w.temperature,moisture:w.moisture,coastal:w.coastal,
    windX:w.windX,windY:w.windY,
    rivers:(w.rivers&&w.rivers.riverMag)?{riverMag:w.rivers.riverMag}:null,
    deposits:w.deposits};
  const _gm={oceanLevel:oceanLevelRef.current,tecParams:_tecParams,realWind:!!w.realWindUsed};
  const _pend=pendingSaveRef.current;
  if(_pend){pendingSaveRef.current=null;sw.postMessage({type:'load',json:_pend,genMeta:_gm});}
  else sw.postMessage({type:'init',w:initW,tCrop:t.tCrop,tFlood:t.tFlood,tileRes:simTileResRef.current,simTileRes:simTileResRef.current,seed:w.seed,genMeta:_gm,tAncestry:t.tAncestry,terTw:t.tw,terTh:t.th,ancestryCount:t.ancestryCount,ancHue:t.ancHue,tArrival:t.tArrival});
  // Push current play/speed/view state to the fresh worker.
  sw.postMessage({type:'control',playing:false,speed:speedRef.current});
  sw.postMessage({type:'visibility',hidden:typeof document!=="undefined"&&document.hidden});
  sw.postMessage({type:'view',view:viewRef.current});
  sw.postMessage({type:'mapFilter',minKm2:minKm2Ref.current});
  // A fresh worker starts at default tuning — re-send the user's current levers.
  sw.postMessage({type:'tune',values:tuneValsRef.current});
  usedWorker=true;
}catch(e){console.warn('[SimWorker] init failed — main-thread sim:',e);}
if(!usedWorker){
  const _pend2=pendingSaveRef.current;
  if(_pend2){pendingSaveRef.current=null;
  try{peopleRef.current=loadWorld(_pend2,{realWindFns:REAL_FNS});}
  catch(err){
    console.error("load failed:",err);
    alert("Could not load save: "+(err&&err.message));
    peopleRef.current=initPeopleSim(w,{seed:w.seed,tCrop:t.tCrop,tFlood:t.tFlood,tileRes:simTileResRef.current,simTileRes:simTileResRef.current,deposits:t.deposits,tAncestry:t.tAncestry,terTw:t.tw,terTh:t.th,ancestryCount:t.ancestryCount,ancHue:t.ancHue,tArrival:t.tArrival});
    peopleRef.current._realWindGen=!!w.realWindUsed;
  }}
  else{peopleRef.current=initPeopleSim(w,{seed:w.seed,tCrop:t.tCrop,tFlood:t.tFlood,tileRes:simTileResRef.current,simTileRes:simTileResRef.current,deposits:t.deposits,tAncestry:t.tAncestry,terTw:t.tw,terTh:t.th,ancestryCount:t.ancestryCount,ancHue:t.ancHue,tArrival:t.tArrival});peopleRef.current._realWindGen=!!w.realWindUsed;}
  setPsStats(peopleSimStats(peopleRef.current));
}
setPlaying(false);playRef.current=false;
terrainCache.current=null;atlasCache.current=null;imgRef.current=null;},[]);
const generate=useCallback((s,ol)=>{
// Stamp this request; a worker result whose id has been superseded (the user changed
// scale/seed again before it finished) is a wrong-resolution world and must be ignored.
const _gid=++genIdRef.current;
setGenBusy(true);
// Import path
if(presetRef.current==="import"&&importedWorldRef.current){
const w=importedWorldRef.current;importedWorldRef.current=null;finalizeWorld(w);return;}
const _ol=ol!==undefined?ol:oceanLevelRef.current;
// Real-wind Earth-Sim stays on the main thread: the NCEP data set lives in
// this bundle only (duplicating 2.3MB of JSON into the worker isn't worth a
// rare power-user toggle). EVERYTHING else generates in the worker — the old
// main-thread path froze the UI 2-5s for every non-tectonic preset.
const _realWind=presetRef.current==="earth_sim"&&useRealWindRef.current&&realDataAvailable();
if(!_realWind){
try{
if(workerRef.current)workerRef.current.terminate();
const worker=new WorldGenWorker();workerRef.current=worker;
worker.onmessage=(e)=>{
if(_gid!==genIdRef.current)return;   // superseded by a newer generate → its world is the wrong scale now
if(e.data.type==='result'){console.log(`[Worker] Done in ${e.data.time?.toFixed(0)}ms`);finalizeWorld(e.data.world);}
else{console.warn('[Worker]',e.data.type,e.data.message||'');
finalizeWorld(generateWorld(genW,genH,s,presetRef.current,_ol,true,false,_tecParams));}};
worker.onerror=(err)=>{if(_gid!==genIdRef.current)return;console.warn('[Worker] Error:',err.message);
finalizeWorld(generateWorld(genW,genH,s,presetRef.current,_ol,true,false,_tecParams));};
worker.postMessage({type:'generate',W:genW,H:genH,seed:s,preset:presetRef.current,oceanLevel:_ol,tecParams:_tecParams});
return;}catch(e){console.warn('[Worker] Init failed:',e);}}
// Main thread: real-wind Earth-Sim (or worker init failure fallback).
finalizeWorld(Object.assign(generateWorld(genW,genH,s,presetRef.current,_ol,true,_realWind,_tecParams,REAL_FNS),{realWindUsed:_realWind}));},[finalizeWorld,genW,genH]);
useEffect(()=>{generate(seed)},[seed,generate]);
useEffect(()=>{fbTimelineRef.current=makeTimeline();fbKeyRef.current=0;setScrubStep(null);setScrubShown(null);scrubRef.current=false;const psw=peopleRef.current;if(psw)psw._scrubClaim=null;},[world]);
// Build globe texture at 2048×1024 (GPU-friendly power-of-2) with polar blending
// Clear caches when globe toggled off (canvas remounts)
useEffect(()=>{if(!showGlobe){terrainCache.current=null;imgRef.current=null;windParticlesRef.current=null;}
},[showGlobe]);

// Build terrain RGB cache at tile resolution (one entry per tile)
const updateTerrainCache=useCallback((w,ter)=>{
const buf=new Uint8Array(CW*CH*3);const sl=0;
// Smooth the boosted tile-moisture for RENDERING only: the river/lake
// boosts arrive in small integer-radius rings, and unsmoothed they flip
// biome colors in blocky stepped blobs (the "low-res layer" artifact).
let smoothM=null;
if(ter&&ter.tMoist){
  const tw2=ter.tw,th2=ter.th;smoothM=new Float32Array(tw2*th2);
  const tm=ter.tMoist;
  for(let y2=0;y2<th2;y2++)for(let x2=0;x2<tw2;x2++){
    let acc=0,n2=0;
    for(let dy=-1;dy<=1;dy++){const ny=y2+dy;if(ny<0||ny>=th2)continue;
      for(let dx=-1;dx<=1;dx++){const nx=(x2+dx+tw2)%tw2;acc+=tm[ny*tw2+nx];n2++;}}
    smoothM[y2*tw2+x2]=acc/n2;}
}
for(let ty=0;ty<CH;ty++){
const dataY=Math.round(screenYtoDataY(ty,CH,H));
for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,dataY);
const si=sy*W+sx;const e=w.elevation[si];
let m=w.moisture[si];
let flood=false;
if(smoothM){const tti=Math.min(ter.th-1,(sy/RES)|0)*ter.tw+Math.min(ter.tw-1,(sx/RES)|0);m=smoothM[tti];if(ter.tFlood)flood=ter.tFlood[tti]===1;}
const t=w.temperature[si];let r,g,b;
if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl,flood,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0);r=c[0];g=c[1];b=c[2];}
// Swamp overlay
let hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(H-1,sy+dy)*W+Math.min(W-1,sx+dx);
if(w.swamp&&w.swamp[wi])hasSwamp=true;}
let pr=r,pg=g,pb=b;
if(e>sl&&hasSwamp){pr=40;pg=58;pb=38;}
const ti3=(ty*CW+tx)*3;buf[ti3]=pr;buf[ti3+1]=pg;buf[ti3+2]=pb;}}
return buf;},[CH]);

// ── Atlas (olde-map) renderer: stained parchment land, dark seas, cartographic symbols ──
// Heavy build; runs once per world (cached as ImageData), reused each frame.
const buildAtlas=useCallback((w,ter)=>{
const cv=document.createElement("canvas");cv.width=CW;cv.height=CH;
const octx=cv.getContext("2d");
const img=new ImageData(CW,CH);const d=img.data;
const N=CW*CH,tw=ter.tw,th=ter.th;
const lk=ter.rivers&&ter.rivers.lake?ter.rivers.lake:null;
// Per-screen-pixel data index + water mask; find land elevation ceiling
const dataIdx=new Int32Array(N),water=new Uint8Array(N);
let landEMax=0.001;
for(let ty=0;ty<CH;ty++){
const dy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const tyTile=Math.min(th-1,(dy/RES)|0);
for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),si=dy*W+sx,i=ty*CW+tx;
dataIdx[i]=si;const e=w.elevation[si];
const isLake=lk?lk[tyTile*tw+Math.min(tw-1,(sx/RES)|0)]>=0:false;
water[i]=(e<=0||isLake)?1:0;
if(e>landEMax)landEMax=e;}}
const mtnHi=landEMax*0.55,mtnLo=landEMax*0.34,hillLo=landEMax*0.19,footLo=landEMax*0.10;
// Chamfer distance transform — coastDist drives the worn, inked shoreline
const chamfer=(f)=>{
for(let ty=0;ty<CH;ty++)for(let tx=0;tx<CW;tx++){const i=ty*CW+tx;let dd=f[i];
if(tx>0){const v=f[i-1]+1;if(v<dd)dd=v;}
if(ty>0){const v=f[i-CW]+1;if(v<dd)dd=v;}
if(tx>0&&ty>0){const v=f[i-CW-1]+1.4142;if(v<dd)dd=v;}
if(tx<CW-1&&ty>0){const v=f[i-CW+1]+1.4142;if(v<dd)dd=v;}
f[i]=dd;}
for(let ty=CH-1;ty>=0;ty--)for(let tx=CW-1;tx>=0;tx--){const i=ty*CW+tx;let dd=f[i];
if(tx<CW-1){const v=f[i+1]+1;if(v<dd)dd=v;}
if(ty<CH-1){const v=f[i+CW]+1;if(v<dd)dd=v;}
if(tx<CW-1&&ty<CH-1){const v=f[i+CW+1]+1.4142;if(v<dd)dd=v;}
if(tx>0&&ty<CH-1){const v=f[i+CW-1]+1.4142;if(v<dd)dd=v;}
f[i]=dd;}};
const coastDist=new Float32Array(N),seaDist=new Float32Array(N);
for(let i=0;i<N;i++){coastDist[i]=water[i]?0:1e9;seaDist[i]=water[i]?1e9:0;}
chamfer(coastDist);chamfer(seaDist);
// Downsampled fbm fields — staining is low-frequency, so 4× downsample is invisible (~16× fewer fbm calls)
const QW=(CW>>2)+2,QH=(CH>>2)+2;
const mkField=(fx,fy,oct,ox,oy)=>{const f=new Float32Array(QW*QH);
for(let j=0;j<QH;j++)for(let k=0;k<QW;k++)f[j*QW+k]=fbm(k*4/CW*fx+ox,j*4/CH*fy+oy,oct,2,0.5);
return f;};
const bigF=mkField(3.0,3.0,3,11,11),stnF=mkField(4.6,4.6,3,93,93),midF=mkField(8,8,3,40,40),
fineF=mkField(27,27,2,71,71);
const samp=(f,x,y)=>{const fx=x*0.25,fy=y*0.25,x0=fx|0,y0=fy|0,dx=fx-x0,dy=fy-y0,
a=f[y0*QW+x0],b=f[y0*QW+x0+1],cc=f[(y0+1)*QW+x0],dd=f[(y0+1)*QW+x0+1];
return a*(1-dx)*(1-dy)+b*dx*(1-dy)+cc*(1-dx)*dy+dd*dx*dy;};
// Base layer — stained, worn parchment land + dark, textured seas
const COAST=58,HALO=12;
for(let ty=0;ty<CH;ty++)for(let tx=0;tx<CW;tx++){
const i=ty*CW+tx,si=dataIdx[i],pi=i<<2,e=w.elevation[si];
const big=samp(bigF,tx,ty),mid=samp(midF,tx,ty),fine=samp(fineF,tx,ty),stn=samp(stnF,tx,ty);
const grain=atlasHash(tx,ty)-0.5;
if(water[i]){
// Sea: pale parchment, broadly discoloured by the wind field —
// windier water reads as darker, more weathered staining
let r=197,g=174,b=126;
let wd=0;
if(w.windX){const vx=w.windX[si],vy=w.windY[si];wd=Math.min(1,Math.pow(vx*vx+vy*vy,0.25));}
r-=wd*42;g-=wd*48;b-=wd*54;
r+=big*12;g+=big*11;b+=big*9;
r+=grain*9;g+=grain*9;b+=grain*8;
r+=(246-r)*0.2;g+=(242-g)*0.2;b+=(234-b)*0.2;
// broad darkened halo hugging every ocean coastline (skip lakes — too small,
// the halo would swallow them into dark blobs; their ink shore defines them)
const sd=seaDist[i];
if(sd<HALO&&!(lk&&lk[si]>=0)){const hh=1-sd/HALO,hk=hh*hh;
r-=hk*86;g-=hk*87;b-=hk*79;}
d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255;continue;}
const m=w.moisture[si],t=w.temperature[si],biome=getBiomeD(e,m,t,0,0,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0);
let r=197,g=174,b=126;
// broad uneven aged tone
r+=big*40;g+=big*37;b+=big*31;
// blotchy brown stains at two scales — worn discolouring
const stain=Math.max(0,mid+0.15)+Math.max(0,stn-0.05)*0.65;
r-=stain*36;g-=stain*44;b-=stain*49;
if(mid>0.30){const s=(mid-0.30)*1.6;r-=s*36;g-=s*40;b-=s*40;}
// finer mottle + per-pixel paper grain (fibres)
r+=fine*17+grain*12;g+=fine*16+grain*12;b+=fine*13+grain*11;
// biome discolouration
if(biome===13){r+=15;g-=3;b-=36;}           // desert — warm orange
else if(biome===14){r+=8;b-=21;}            // shrubland — mild tan
else if(biome===11){r+=9;g+=2;b-=18;}       // savanna — golden
else if(biome===12){r-=14;g+=4;b-=26;}      // grassland — soft green
else if(biome===5){r+=24;g+=27;b+=39;}      // snow / ice — aged white
else if(biome===4||biome===18){r+=11;g+=14;b+=22;} // tundra / cold desert — pale wash
else if(biome===6||biome===7){r-=14;g-=7;b-=14;}   // taiga / boreal — cool shade
else if(biome===8||biome===9||biome===10||biome===15||biome===17){r-=9;g-=3;b-=13;} // forest — faint green
if(e>mtnLo){const s=Math.min(1,(e-mtnLo)/(landEMax-mtnLo+1e-3));r-=s*16;g-=s*12;b-=s*4;}
// shoreline: broad gradient to a darker tea-stained discolour
if(coastDist[i]<COAST){const tt=1-coastDist[i]/COAST,t2=tt*(0.45+tt*0.55);
r-=t2*36;g-=t2*44;b-=t2*47;r+=tt*9;g+=tt*3;}
// hand-inked coastline — darkness varied so it reads as worn ink, not a clean vector line
if(coastDist[i]<=1.7){const ink=0.6+atlasHash(tx,ty)*0.34;
r=r*(1-ink)+34*ink;g=g*(1-ink)+27*ink;b=b*(1-ink)+18*ink;}
d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255;}
// Smudge the sea — water-only separable box blur so the swells read soft and natural
{const BR=3,tmp=new Float32Array(N*3);
for(let ty=0;ty<CH;ty++){const row=ty*CW;
for(let tx=0;tx<CW;tx++){const i=row+tx;if(!water[i])continue;
let sr=0,sg=0,sb=0,c=0;const x0=tx-BR<0?0:tx-BR,x1=tx+BR>=CW?CW-1:tx+BR;
for(let x2=x0;x2<=x1;x2++){const j=row+x2;if(!water[j])continue;
const pj=j<<2;sr+=d[pj];sg+=d[pj+1];sb+=d[pj+2];c++;}
const p3=i*3;tmp[p3]=sr/c;tmp[p3+1]=sg/c;tmp[p3+2]=sb/c;}}
for(let tx=0;tx<CW;tx++){
for(let ty=0;ty<CH;ty++){const i=ty*CW+tx;if(!water[i])continue;
let sr=0,sg=0,sb=0,c=0;const y0=ty-BR<0?0:ty-BR,y1=ty+BR>=CH?CH-1:ty+BR;
for(let y2=y0;y2<=y1;y2++){const j=y2*CW+tx;if(!water[j])continue;
const pj=j*3;sr+=tmp[pj];sg+=tmp[pj+1];sb+=tmp[pj+2];c++;}
const pi=i<<2;d[pi]=sr/c;d[pi+1]=sg/c;d[pi+2]=sb/c;}}}
octx.putImageData(img,0,0);
// ── Cartographic symbols ──
octx.lineJoin="round";octx.lineCap="round";
// Foxing — soft, irregular age-blooms across the whole sheet
for(let gy=5;gy<CH-5;gy+=11)for(let gx=5;gx<CW-5;gx+=11){
const h=atlasHash(gx+9,gy+9);if(h>0.34)continue;
const px=gx+(atlasHash(gx+3,gy+5)-0.5)*10,py=gy+(atlasHash(gx+7,gy+1)-0.5)*10;
const ix=px|0,iy=py|0;if(ix<2||ix>=CW-2||iy<2||iy>=CH-2)continue;
const onWater=water[iy*CW+ix];
const h2=atlasHash(gx+1,gy+4),h3=atlasHash(gx+6,gy+2);
const rad=1.7+h2*4.8;
let cr,cg,cb,ca;
if(onWater){cr=164;cg=142;cb=102;ca=0.10+h*0.36;}      // paler tan over the sea
else{cr=(98+h*94)|0;cg=(76+h*52)|0;cb=42;ca=0.05+h*0.36;} // brown on land
octx.save();octx.translate(px,py);octx.rotate(h2*6.283);octx.scale(1,0.5+h3*0.8);
const blobs=h<0.15?2:1;
for(let bi=0;bi<blobs;bi++){
const ox=bi?(h3-0.5)*rad*1.5:0,oy=bi?(h2-0.5)*rad*1.1:0,rr=bi?rad*(0.45+h3*0.4):rad;
const g=octx.createRadialGradient(ox,oy,0,ox,oy,rr);
g.addColorStop(0,`rgba(${cr},${cg},${cb},${ca})`);
g.addColorStop(0.5,`rgba(${cr},${cg},${cb},${ca*0.5})`);
g.addColorStop(1,`rgba(${cr},${cg},${cb},0)`);
octx.fillStyle=g;octx.beginPath();octx.arc(ox,oy,rr,0,6.2832);octx.fill();}
octx.restore();}
// Hachures — short downhill strokes shading steep ground (escarpments, hill flanks)
for(let gy=6;gy<CH-6;gy+=7)for(let gx=6;gx<CW-6;gx+=7){
const px=(gx+(atlasHash(gx+3,gy+1)-0.5)*5)|0,py=(gy+(atlasHash(gx+1,gy+5)-0.5)*5)|0;
if(px<4||px>=CW-4||py<4||py>=CH-4)continue;
const i=py*CW+px;if(water[i]||coastDist[i]<5)continue;
const si=dataIdx[i],e=w.elevation[si];if(e<=0||e>=mtnLo)continue;
const gX=w.elevation[si+3]-w.elevation[si-3],gY=w.elevation[si+3*W]-w.elevation[si-3*W];
const slope=Math.sqrt(gX*gX+gY*gY),steep=slope/(landEMax+1e-3);
if(steep<0.04)continue;
if(atlasHash(gx+9,gy+7)>Math.min(0.9,0.15+steep*8))continue;
const dl=slope||1,dx=-gX/dl,dy=-gY/dl,len=1.8+Math.min(3.2,steep*30);
octx.strokeStyle=`rgba(60,48,32,${0.26+Math.min(0.34,steep*5)})`;
octx.lineWidth=0.4+Math.min(0.5,steep*5);
octx.beginPath();octx.moveTo(px-dx*len*0.5,py-dy*len*0.5);octx.lineTo(px+dx*len*0.5,py+dy*len*0.5);octx.stroke();}
// Coastlines — hatched cliffs on steep shores, pale sand flecks on gentle ones
for(let gy=5;gy<CH-5;gy+=6)for(let gx=5;gx<CW-5;gx+=6){
const i0=gy*CW+gx;if(water[i0]||coastDist[i0]>5)continue;
const si=dataIdx[i0],e=w.elevation[si];if(e<=0)continue;
const gX=w.elevation[si+3]-w.elevation[si-3],gY=w.elevation[si+3*W]-w.elevation[si-3*W];
const slope=Math.sqrt(gX*gX+gY*gY),steep=slope/(landEMax+1e-3);
if(steep>0.05){
const dl=slope||1,dx=-gX/dl,dy=-gY/dl;
octx.strokeStyle='rgba(50,40,26,0.62)';octx.lineWidth=0.5;octx.beginPath();
for(let tk=-1;tk<=1;tk++){const ox=-dy*tk*1.7,oy=dx*tk*1.7;
octx.moveTo(gx+ox,gy+oy);octx.lineTo(gx+ox+dx*2.6,gy+oy+dy*2.6);}
octx.stroke();
}else if(atlasHash(gx+2,gy+8)<0.4){
octx.fillStyle='rgba(234,222,178,0.5)';
octx.beginPath();octx.arc(gx+(atlasHash(gx,gy)-0.5)*4,gy+(atlasHash(gx+4,gy)-0.5)*4,0.95,0,6.2832);octx.fill();}}
// Ground cover — grass, scrub and barren speckle for the open biomes
for(let gy=5;gy<CH-5;gy+=9)for(let gx=5;gx<CW-5;gx+=9){
const px=(gx+(atlasHash(gx+2,gy+3)-0.5)*8)|0,py=(gy+(atlasHash(gx+5,gy+7)-0.5)*8)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const m=w.moisture[si],biome=getBiomeD(e,m,w.temperature[si],0,0,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0);
const h=atlasHash(gx+11,gy+4),tone=atlasHash(gx+3,gy+9);
if(biome===12){if(h>0.42+m*0.5)continue;atlasTuft(octx,px,py,2.6+tone*2.1,tone);}
else if(biome===11){if(h>0.4)continue;
if(atlasHash(gx+7,gy+1)<0.1)atlasAcacia(octx,px,py,4.4+tone*2.1,tone);
else atlasTuft(octx,px,py,2.2+tone*1.8,tone);}
else if(biome===14){if(h>0.5)continue;atlasShrub(octx,px,py,1.9+tone*1.3,tone);}
else if(biome===4){if(h>0.34)continue;
octx.fillStyle=`rgba(${(112+tone*40)|0},${(114+tone*34)|0},${(106+tone*28)|0},0.5)`;
octx.beginPath();octx.arc(px,py,0.7+tone*0.6,0,6.2832);octx.fill();}
else if(biome===18){if(h>0.3)continue;
octx.fillStyle='rgba(120,110,92,0.45)';
octx.beginPath();octx.arc(px,py,0.6+tone*0.5,0,6.2832);octx.fill();}}
// Mountains — dense & overlapping so high ground forms continuous ranges; hills below
for(let gy=5;gy<CH-5;gy+=8)for(let gx=5;gx<CW-5;gx+=8){
const px=(gx+(atlasHash(gx,gy)-0.5)*6)|0,py=(gy+(atlasHash(gx+7,gy+3)-0.5)*6)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const e=w.elevation[dataIdx[i]];
if(e>=mtnLo){
const dens=(e-mtnLo)/(landEMax-mtnLo+1e-3);
if(atlasHash(gx+11,gy+19)>0.62+dens*0.36)continue;
const big=e>mtnHi,size=(big?5.4:3.6)+dens*3.8+atlasHash(gx+3,gy+9)*1.5;
atlasMountain(octx,px,py,size,big,atlasHash(gx+6,gy+2));
}else if(e>=hillLo){
if(atlasHash(gx+5,gy+8)>0.13)continue;
atlasHill(octx,px,py,1.7+atlasHash(gx+2,gy+6)*1.3);
}else if(e>=footLo){
if(atlasHash(gx+5,gy+8)>0.06)continue;
atlasHill(octx,px,py,0.85+atlasHash(gx+2,gy+6)*0.6);}}
// Ordinary forests — moderate scatter; tree silhouette varies by biome
for(let gy=4;gy<CH-4;gy+=6)for(let gx=4;gx<CW-4;gx+=6){
const px=(gx+(atlasHash(gx+1,gy+2)-0.5)*5)|0,py=(gy+(atlasHash(gx+4,gy+8)-0.5)*5)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const biome=getBiomeD(e,w.moisture[si],w.temperature[si],0,0,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0);
let cover=0,kind=0;                          // kind: 0 conifer, 1 deciduous, 2 acacia
if(biome===6){cover=0.40;kind=0;}            // taiga — fir, closed forest
else if(biome===8||biome===17){cover=0.42;kind=1;} // temperate / subtropical — broadleaf
else if(biome===15){cover=0.16;kind=2;}      // tropical dry forest — open acacia woodland
else continue;
if(atlasHash(gx+13,gy+5)>cover)continue;
const tone=atlasHash(gx+2,gy+11),size=4.2+atlasHash(gx+9,gy+1)*2.8;
if(kind===0)atlasConifer(octx,px,py,size,tone);
else if(kind===1)atlasRoundTree(octx,px,py,size,tone);
else atlasAcacia(octx,px,py,size,tone);}
// Dense forest — packed, overlapping thicket: rainforests (jungle) + boreal (fir)
for(let gy=3;gy<CH-3;gy+=4)for(let gx=3;gx<CW-3;gx+=4){
const px=(gx+(atlasHash(gx+1,gy+5)-0.5)*4)|0,py=(gy+(atlasHash(gx+6,gy+2)-0.5)*4)|0;
if(px<2||px>=CW-2||py<2||py>=CH-2)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si];if(e>=mtnLo)continue;
const bm=getBiomeD(e,w.moisture[si],w.temperature[si],0,0,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0);
if(bm!==9&&bm!==10&&bm!==7)continue;
if(atlasHash(gx+7,gy+9)>0.95)continue;
const tone=atlasHash(gx+2,gy+11);
if(bm===7)atlasConifer(octx,px,py,4.4+atlasHash(gx+9,gy+1)*2.3,tone);
else atlasJungleTree(octx,px,py,5.0+atlasHash(gx+9,gy+1)*2.4,tone);}
// Desert stipple (dune dots)
for(let gy=4;gy<CH-4;gy+=7)for(let gx=4;gx<CW-4;gx+=7){
const px=(gx+(atlasHash(gx+6,gy+1)-0.5)*6)|0,py=(gy+(atlasHash(gx+2,gy+9)-0.5)*6)|0;
if(px<1||px>=CW-1||py<1||py>=CH-1)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i],e=w.elevation[si],dm=w.moisture[si];
if(getBiomeD(e,dm,w.temperature[si],0,0,w.dryFrac?w.dryFrac[si]:0,w.summerDry?w.summerDry[si]:0)!==13)continue;
if(atlasHash(gx+3,gy+7)>0.62-dm*1.6)continue;
octx.fillStyle="rgba(120,84,38,0.5)";
octx.beginPath();octx.arc(px,py,0.7,0,6.2832);octx.fill();}
// Swamp reeds
if(w.swamp){
for(let gy=5;gy<CH-5;gy+=10)for(let gx=5;gx<CW-5;gx+=10){
const px=(gx+(atlasHash(gx+8,gy+4)-0.5)*7)|0,py=(gy+(atlasHash(gx+5,gy+2)-0.5)*7)|0;
if(px<1||px>=CW-1||py<1||py>=CH-1)continue;
const i=py*CW+px;if(water[i])continue;
const si=dataIdx[i];if(!w.swamp[si])continue;
octx.strokeStyle="rgba(64,72,48,0.75)";octx.lineWidth=0.7;
octx.beginPath();
octx.moveTo(px-2.4,py+1);octx.lineTo(px+2.4,py+1);
octx.moveTo(px-1.4,py+1);octx.lineTo(px-1.4,py-2);
octx.moveTo(px,py+1);octx.lineTo(px,py-2.6);
octx.moveTo(px+1.4,py+1);octx.lineTo(px+1.4,py-2);
octx.stroke();}}
// Re-stamp lake water over the symbol layer. Tree canopies from shoreline
// trees overhang small lakes and would otherwise bury them; the base layer
// (d) still holds the clean water colour, so copy it back for lake tiles
// only — land symbols are left untouched.
if(lk){const cur=octx.getImageData(0,0,CW,CH),cd=cur.data;
for(let i=0;i<N;i++){if(lk[i]<0)continue;
const pi=i<<2;cd[pi]=d[pi];cd[pi+1]=d[pi+1];cd[pi+2]=d[pi+2];cd[pi+3]=255;}
octx.putImageData(cur,0,0);}
// Rivers — traced from the flow network, drawn as smooth meandering ink
// (the raw D8 flow is 8-directional/blocky; tracing + curve smoothing
// turns it into natural winding rivers). Lakes break the trace: a river
// ends at the lake shore, and the lake's outflow is drawn as its own
// river from the outlet — so rivers visibly enter and leave lakes.
if(ter.rivers&&ter.rivers.flowDir){
const rmg=ter.rivers.riverMag,fd=ter.rivers.flowDir,RN=tw*th;
const DDX=[1,1,0,-1,-1,-1,0,1],DDY=[0,1,1,1,0,-1,-1,-1];
const isLk=(t)=>!!(lk&&lk[t]>=0);
const hasUp=new Uint8Array(RN),drawn=new Uint8Array(RN);
// Upstream flag ignores lake tiles, so a tile fed only by a lake's outlet
// counts as a river source — that becomes the lake's outflow head.
for(let ti=0;ti<RN;ti++){if(rmg[ti]<2||isLk(ti))continue;const d=fd[ti];if(d===255)continue;
const nx=((ti%tw)+DDX[d]+tw)%tw,ny=((ti/tw)|0)+DDY[d];if(ny<0||ny>=th)continue;hasUp[ny*tw+nx]=1;}
octx.lineCap="round";octx.lineJoin="round";octx.strokeStyle="rgba(42,58,78,0.92)";
const wOf=(m)=>m>=4?2.2:m>=3?1.5:0.95;
const drawSeg=(pts,a,b,lw)=>{if(b<=a)return;octx.lineWidth=lw;octx.beginPath();
octx.moveTo(pts[a].x,pts[a].y);
for(let k=a+1;k<b;k++)octx.quadraticCurveTo(pts[k].x,pts[k].y,(pts[k].x+pts[k+1].x)*0.5,(pts[k].y+pts[k+1].y)*0.5);
octx.lineTo(pts[b].x,pts[b].y);octx.stroke();};
for(let ti=0;ti<RN;ti++){
if(rmg[ti]<2||hasUp[ti]||isLk(ti))continue;
const pts=[];let ci=ti,guard=0;
// If this head is fed by a lake outlet, prepend that outlet tile so the
// river visibly emerges from the water rather than starting beside it.
if(lk){const sx=ti%tw,sy=(ti/tw)|0;
for(let d=0;d<8;d++){const lx=((sx+DDX[d])%tw+tw)%tw,ly=sy+DDY[d];
if(ly<0||ly>=th)continue;const lci=ly*tw+lx;
if(lk[lci]>=0&&fd[lci]!==255){
const ld=fd[lci],fx2=((lx+DDX[ld])%tw+tw)%tw,fy2=ly+DDY[ld];
if(fx2===sx&&fy2===sy){pts.push({x:lx,y:ly,m:rmg[ti]});break;}}}}
for(;;){if(guard++>6000)break;
drawn[ci]=1;pts.push({x:ci%tw,y:(ci/tw)|0,m:rmg[ci]});
const d=fd[ci];if(d===255)break;
const cx=ci%tw,cy=(ci/tw)|0,nx=((cx+DDX[d])%tw+tw)%tw,ny=cy+DDY[d];
if(ny<0||ny>=th)break;const nci=ny*tw+nx;
// Reaching a lake: end the river at the shore (the lake tile is the
// terminal point so the line just touches the water).
if(isLk(nci)){pts.push({x:nx,y:ny,m:pts[pts.length-1].m});break;}
if(rmg[nci]<2||drawn[nci]){pts.push({x:nx,y:ny,m:rmg[nci]>=2?rmg[nci]:pts[pts.length-1].m});break;}
ci=nci;}
const n=pts.length;if(n<2)continue;
// decimate to ~every 4th tile, then the quadratic curve smooths out the
// D8 stair-steps — the path already wanders (jittered flow in riverGen)
const dp=[pts[0]];
for(let k=4;k<n-1;k+=4)dp.push(pts[k]);
dp.push(pts[n-1]);
const dn=dp.length;
let a=0;
for(let k=1;k<dn;k++){if(wOf(dp[k].m)!==wOf(dp[a].m)){drawSeg(dp,a,k,wOf(dp[a].m));a=k;}}
drawSeg(dp,a,dn-1,wOf(dp[a].m));}
}
return octx.getImageData(0,0,CW,CH);
},[CH]);

// Composite render: terrain + tribe overlay into single canvas
const draw=useCallback((ter)=>{
if(!ter)return;const w=worldRef.current;if(!w)return;
if(import.meta.env.DEV&&typeof window!=='undefined'){window.__ter=ter;window.__world=w;}
const sl=0,vm=viewRef.current;
const isGlobe=showGlobeRef.current;
// Use onscreen canvas if available, otherwise create offscreen for globe
let ctx=canvasRef.current?canvasRef.current.getContext("2d"):null;
if(!ctx&&!isGlobe)return;
// ── Apply pan/zoom view transform (peopleSim views only — legacy views
// like globe/preview keep their own coordinate handling). Cleared first
// because at zoom<1 the transformed image doesn't cover the whole canvas
// and we'd otherwise see stale pixels around the edges. Hit-testing
// reverses this transform (see onCanvasMove / onCanvasClick).
const _pz=ctx&&!isGlobe;
if(_pz){
  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle="#000";ctx.fillRect(0,0,CW,CH);
  // Crisp upscale at zoom > 1 — match the `imageRendering: pixelated` style
  // on the <canvas>. Without this the base raster smooths into mush when
  // zoomed in.
  ctx.imageSmoothingEnabled=false;
  ctx.setTransform(viewZRef.current,0,0,viewZRef.current,viewXRef.current,viewYRef.current);
}
// FEATURE overlay context: fixed-resolution canvas for vector features (borders/roads/icons).
// Cleared each frame; the pan/zoom transform is the map's, scaled by k=FEAT_W/CW so the overlay
// registers exactly over the map (both canvases are CSS-scaled to the same box). Smoothing ON for
// crisp antialiased lines. featX/featY map sim-tile coords into the fixed FEAT canvas.
const _k=FEAT_W/CW;   // map-canvas px → fixed-overlay px; features render at FEAT resolution (crisp at any scale)
let fctx=null;
if(_pz&&featRef.current){
  fctx=featRef.current.getContext("2d");
  fctx.setTransform(1,0,0,1,0,0);
  fctx.clearRect(0,0,FEAT_W,FEAT_H);
  // Smooth only when DOWN-scaling (zoomed out): bilinear antialiases the shrink. When zoomed IN
  // (viewZ>1) it blurs the political tint BLOCKS into mush — draw those crisp (nearest) instead;
  // the borders/icons are already 1920-res so nearest keeps them sharp too.
  fctx.imageSmoothingEnabled=viewZRef.current<=1;
  fctx.setTransform(viewZRef.current,0,0,viewZRef.current,viewXRef.current*_k,viewYRef.current*_k);
}
if(!imgRef.current)imgRef.current=new ImageData(CW,CH);
const img=imgRef.current;const d=img.data;
// Lake lookup for rendering
const lk=ter.rivers&&ter.rivers.lake?ter.rivers.lake:null;
const N=CW*CH;
// Static-base cache: blit the cached terrain raster instead of rebuilding it
// per-pixel when nothing affecting it changed.
const _stepCacheV=STEP_CACHE_VIEWS.has(vm);
const _staticBase=(BASE_CACHE_VIEWS.has(vm)||_stepCacheV)&&!isGlobe;
// Dynamic data views fold a coarse sim-step bucket into the key so the cached
// raster refreshes as the world changes (and is stable/blitted while paused).
const _simStep=(peopleRef.current&&peopleRef.current.step)||0;
const _stepTag=_stepCacheV?('|s'+((_simStep/STEP_CACHE_REGEN)|0)):'';
const _baseKey=_staticBase?(vm+'|'+(w._seed)+'|'+CH+'|'+(showPlatesRef.current?1:0)+(showRiversRef.current?1:0)+(showStreamsRef.current?1:0)+(showLakesRef.current?1:0)+'|'+(depthFromSeaRef.current?1:0)+'|'+depthCeilRef.current+'|'+(activeResRef.current||'')+'|'+oceanLevelRef.current+_stepTag):null;
let _baseHit=false;
if(_staticBase&&ctx&&baseLayerRef.current&&baseLayerRef.current.width===CW&&baseLayerRef.current.height===CH&&baseLayerKey.current===_baseKey){ctx.drawImage(baseLayerRef.current,0,0);_baseHit=true;}
if(!_baseHit){
if(vm==="depth"){
// Depth/heightmap view — flat black-to-white gradient using actual data range
// Find actual min/max elevation
let eMin=Infinity,eMax=-Infinity;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const si=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)))*W+Math.min(W-1,tx*RES);
const e=w.elevation[si];if(e<eMin)eMin=e;if(e>eMax)eMax=e;}
const floor=depthFromSeaRef.current?0:eMin;
const fullRange=eMax-floor||1;
const ceil=depthCeilRef.current;
const range=fullRange*ceil||1;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];
const v=Math.min(255,Math.max(0,((e-floor)/range)*255))|0;
const pi4=ti<<2;d[pi4]=v;d[pi4+1]=v;d[pi4+2]=v;d[pi4+3]=255;}
}else if(vm==="wind"){
// Wind view — speed heatmap everywhere (land + ocean), like Windy.com
const wX=w.windX,wY=w.windY;
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const pi4=ti<<2;
const e=w.elevation[si];
const vx=wX?wX[si]:0,vy=wY?wY[si]:0;
const spd=Math.sqrt(vx*vx+vy*vy);
const t=Math.min(1,Math.pow(spd*1.0,0.5));
// Speed heatmap matched to Windy.com: navy→blue→teal→green→yellow→orange→red
let r,g,b;
if(t<0.08){const s=t/0.08;r=(3+s*5)|0;g=(4+s*15)|0;b=(40+s*60)|0;}
else if(t<0.18){const s=(t-0.08)/0.10;r=(8+s*12)|0;g=(19+s*55)|0;b=(100+s*80)|0;}
else if(t<0.30){const s=(t-0.18)/0.12;r=(20+s*5)|0;g=(74+s*80)|0;b=(180-s*40)|0;}
else if(t<0.42){const s=(t-0.30)/0.12;r=(25-s*5)|0;g=(154+s*50)|0;b=(140-s*90)|0;}
else if(t<0.55){const s=(t-0.42)/0.13;r=(20+s*130)|0;g=(204+s*46)|0;b=(50-s*20)|0;}
else if(t<0.68){const s=(t-0.55)/0.13;r=(150+s*95)|0;g=(250-s*30)|0;b=(30-s*15)|0;}
else if(t<0.82){const s=(t-0.68)/0.14;r=(245+s*10)|0;g=(220-s*100)|0;b=(15+s*10)|0;}
else{const s=(t-0.82)/0.18;r=255;g=(120-s*80)|0;b=(25+s*15)|0;}
// Blend with dim terrain on land for topographic context
if(e>sl){
const landDim=0.25;const heatW=0.65;
const tr=(tc[ti*3]*landDim)|0,tg=(tc[ti*3+1]*landDim)|0,tb=(tc[ti*3+2]*landDim)|0;
r=(r*heatW+tr*(1-heatW))|0;g=(g*heatW+tg*(1-heatW))|0;b=(b*heatW+tb*(1-heatW))|0;
}
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="crop"){
// Crop suitability overlay — agronomic potential, sharper than tFert.
// Same green→yellow→red gradient as fertility; differences vs fert
// are visible where it matters (Amazon goes deeper red, temperate
// hill country tones down to yellow).
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tCrop[ti]));
let r,g,b;
if(v>0.5){const t2=(v-0.5)*2;r=((1-t2)*255)|0;g=200;b=((t2)*40)|0;}
else{const t2=v*2;r=220;g=(t2*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="crossing"){
// Crossing difficulty overlay — green (easy) → yellow → red (brutal).
// Same scalar the sim uses for transport routing, so dark-red areas
// on this map ARE the places where farm placement and trade routes
// will refuse to cross.
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tCross[ti]));
let r,g,b;
if(v<0.5){const t2=v*2;r=(t2*220)|0;g=200;b=0;}
else{const t2=(v-0.5)*2;r=220;g=((1-t2)*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="roads"){
// Road network overlay — empty parchment background, then roads
// drawn coloured-by-network so disconnected systems pop visually.
// Settlements drawn as small grey dots so you can see which
// communities each network connects.
for(let ti=0;ti<N;ti++){const pi4=ti<<2;
d[pi4]=240;d[pi4+1]=230;d[pi4+2]=205;d[pi4+3]=255;}
}else if(vm==="money"||vm==="goodsflow"||vm==="tilecoin"){
// Money/goods-flow/coin-field overlay — dark slate backdrop so gold sources,
// flowing-coin particles, and per-tile farm-gate coin glow. Land tiles a touch
// lighter than sea so coastlines stay legible. Roads + sources + flow drawn in
// the peopleSim overlay pass below.
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),sx=Math.min(W-1,tx*RES),si=sy*W+sx;
const land=w.elevation[si]>sl;const pi4=ti<<2;
d[pi4]=land?28:16;d[pi4+1]=land?30:18;d[pi4+2]=land?36:26;d[pi4+3]=255;}
}else if(vm==="resources"){
// Resource overlay — blend all active resource layers per tile
const ar=activeResRef.current;
const activeList=RESOURCES.filter(r=>ar[r.id]);
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=6;d[pi4+1]=8;d[pi4+2]=16;d[pi4+3]=255;continue;}
let br=0,bg=0,bb=0,totalW=0;
if(ter.deposits){
for(const r of activeList){
const v=ter.deposits[r.id][ti];
if(v>0.05){const w2=v*v;br+=r.color[0]*w2;bg+=r.color[1]*w2;bb+=r.color[2]*w2;totalW+=w2;}}}
if(totalW>0.001){const inv=1/totalW;br=(br*inv)|0;bg=(bg*inv)|0;bb=(bb*inv)|0;
const alpha=Math.min(0.95,Math.sqrt(totalW)*0.8+0.15);const invA=1-alpha;
br=(12*invA+br*alpha)|0;bg=(11*invA+bg*alpha)|0;bb=(10*invA+bb*alpha)|0;
}else{br=12;bg=11;bb=10;}
d[pi4]=br;d[pi4+1]=bg;d[pi4+2]=bb;d[pi4+3]=255;}
}else if(vm==="moisture"){
// Moisture overlay — brown (dry) → yellow → green → teal → blue (wet)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){// Ocean: dim blue
d[pi4]=8;d[pi4+1]=15;d[pi4+2]=35;d[pi4+3]=255;continue;}
const m=ter.tMoist[ti];let r,g,b;
if(m<0.1){const s=m/0.1;r=(140+s*20)|0;g=(100+s*30)|0;b=(50+s*10)|0;}// brown (desert dry)
else if(m<0.25){const s=(m-0.1)/0.15;r=(160-s*50)|0;g=(130+s*50)|0;b=(60+s*10)|0;}// brown→olive
else if(m<0.4){const s=(m-0.25)/0.15;r=(110-s*60)|0;g=(180+s*20)|0;b=(70+s*20)|0;}// olive→green
else if(m<0.55){const s=(m-0.4)/0.15;r=(50-s*30)|0;g=(200-s*10)|0;b=(90+s*60)|0;}// green→teal
else if(m<0.7){const s=(m-0.55)/0.15;r=(20-s*10)|0;g=(190-s*40)|0;b=(150+s*50)|0;}// teal→blue-green
else if(m<0.85){const s=(m-0.7)/0.15;r=(10)|0;g=(150-s*80)|0;b=(200+s*30)|0;}// blue
else{const s=(m-0.85)/0.15;r=(10+s*20)|0;g=(70-s*30)|0;b=(230+s*25)|0;}// deep blue
// Darken with elevation for topographic context
const shade=1-Math.max(0,e-0.1)*0.4;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="temperature"){
// Temperature overlay — blue (cold) → cyan → green → yellow → orange → red (hot)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){// Ocean temp: cooler than land in tropics, warmer than land at poles (water moderates)
const t=w.temperature[si];
// Ocean temp already adjusted in world gen. Just small display tweak:
// Warm ocean slightly cooler than raw value, cold ocean slightly warmer (water moderates)
const shift=t>0.8?-0.03:t>0.5?0:t>0.3?0.02:0.05;// warm→cool, cold→warm
const ot=Math.max(0.52,Math.min(1,t+shift));// floor at ~-8°C (near sea ice)
let r,g,b;
if(ot<0.20){const s=ot/0.20;r=(230-s*130)|0;g=(225-s*185)|0;b=(240-s*40)|0;}
else if(ot<0.40){const s=(ot-0.20)/0.20;r=(100-s*70)|0;g=(40-s*10)|0;b=(200-s*10)|0;}
else if(ot<0.50){const s=(ot-0.40)/0.10;r=(30+s*10)|0;g=(30+s*20)|0;b=(190-s*40)|0;}
else if(ot<0.60){const s=(ot-0.50)/0.10;r=(40+s*60)|0;g=(50+s*130)|0;b=(150+s*50)|0;}
else if(ot<0.70){const s=(ot-0.60)/0.10;r=(100-s*30)|0;g=(180+s*40)|0;b=(200-s*150)|0;}
else if(ot<0.80){const s=(ot-0.70)/0.10;r=(70+s*160)|0;g=(220+s*30)|0;b=(50-s*30)|0;}
else if(ot<0.90){const s=(ot-0.80)/0.10;r=(230+s*25)|0;g=(250-s*100)|0;b=(20-s*10)|0;}
else{const s=(ot-0.90)/0.10;r=255;g=(150-s*110)|0;b=(10+s*5)|0;}
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;continue;}
const t=w.temperature[si];let r,g,b;
// Palette: white(-60°C) → purple(-20°C) → dark blue(-10°C) → light blue(0°C) → light green(10°C) → yellow(20°C) → orange(30°C) → red(40°C)
if(t<0.20){const s=t/0.20;r=(230-s*130)|0;g=(225-s*185)|0;b=(240-s*40)|0;}// white→purple (-60→-20°C)
else if(t<0.40){const s=(t-0.20)/0.20;r=(100-s*70)|0;g=(40-s*10)|0;b=(200-s*10)|0;}// purple→purple-blue (-20→-12°C) WIDER PURPLE
else if(t<0.50){const s=(t-0.40)/0.10;r=(30+s*10)|0;g=(30+s*20)|0;b=(190-s*40)|0;}// purple-blue→dark blue (-12→-10°C)
else if(t<0.60){const s=(t-0.50)/0.10;r=(40+s*60)|0;g=(50+s*130)|0;b=(150+s*50)|0;}// dark blue→light blue (-10→0°C)
else if(t<0.70){const s=(t-0.60)/0.10;r=(100-s*30)|0;g=(180+s*40)|0;b=(200-s*150)|0;}// light blue→light green (0→10°C)
else if(t<0.80){const s=(t-0.70)/0.10;r=(70+s*160)|0;g=(220+s*30)|0;b=(50-s*30)|0;}// light green→yellow (10→20°C)
else if(t<0.90){const s=(t-0.80)/0.10;r=(230+s*25)|0;g=(250-s*100)|0;b=(20-s*10)|0;}// yellow→orange (20→30°C)
else{const s=(t-0.90)/0.10;r=255;g=(150-s*110)|0;b=(10+s*5)|0;}// orange→red (30→40°C)
// Darken with elevation for topographic context
const shade=1-Math.max(0,e-0.1)*0.4;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else if(vm==="atlas"){
// Olde-map "Atlas" view — cached parchment render, rebuilt only when world/projection changes
if(!atlasCache.current||atlasCache.current.seed!==w._seed||atlasCache.current.ch!==CH){
atlasCache.current={img:buildAtlas(w,ter),seed:w._seed,ch:CH};}
d.set(atlasCache.current.img.data);
}else if(vm==="culture"||vm==="faith"||vm==="language"||vm==="ancestry"||vm==="loyalty"||vm==="population"){
// Neutral grey base for the people / faith / language / loyalty / population
// overlays — dark grey ocean, flat grey land — so the coloured regions read
// clearly without the terrain colours competing. Faint elevation keeps coasts legible.
// POPULATION gets a DARK land base: its heat ramp must be monotone in
// brightness (bright = more people), and over the light identity base the
// sub-1k haze DARKENED the land — empty desert out-glowed peopled scrub.
const popDark=vm==="population";
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const e=w.elevation[sy*W+sx];const pi4=ti<<2;
if(e<=sl){d[pi4]=20;d[pi4+1]=22;d[pi4+2]=27;}
else if(popDark){const v=(56-Math.max(0,e-0.1)*26)|0;d[pi4]=v;d[pi4+1]=v;d[pi4+2]=(v+5)|0;}
else{const v=(118-Math.max(0,e-0.1)*64)|0;d[pi4]=v;d[pi4+1]=v;d[pi4+2]=(v+6)|0;}
d[pi4+3]=255;}
}else{
// Base terrain (also the base layer under the political/economic overlays).
// (The old tribe-border tinting here read ter.owner — an array the tribe
// system's removal deleted — and crashed the first draw of every world.)
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){
const pi4=ti<<2,ti3=ti*3;
d[pi4]=tc[ti3];d[pi4+1]=tc[ti3+1];d[pi4+2]=tc[ti3+2];d[pi4+3]=255;}}
// Plate boundary overlay — domain-warped lookup for organic boundaries
if(showPlatesRef.current&&w.pixPlate&&vm!=="atlas"){
const plateAt=(px,py)=>{
const nx=px/W,ny=py/H;
// Same multi-scale warp as tectonicGen elevation sampling
const wx=px+fbm(nx*1.5+200,ny*1.5+200,4,2,0.5)*12+fbm(nx*4+300,ny*4+300,3,2,0.5)*4.8+fbm(nx*10+400,ny*10+400,2,2,0.5)*1.6;
const wy=py+fbm(nx*1.5+250,ny*1.5+250,4,2,0.5)*12+fbm(nx*4+350,ny*4+350,3,2,0.5)*4.8+fbm(nx*10+450,ny*10+450,2,2,0.5)*1.6;
const sx2=Math.max(0,Math.min(W-1,Math.round(wx))),sy2=Math.max(0,Math.min(H-1,Math.round(wy)));
return w.pixPlate[sy2*W+sx2];};
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const myP=plateAt(sx,sy);let boundary=false;
for(let dy=-RES;dy<=RES&&!boundary;dy+=RES)for(let dx=-RES;dx<=RES&&!boundary;dx+=RES){
if(!dx&&!dy)continue;
const nx2=(sx+dx+W)%W,ny2=sy+dy;if(ny2<0||ny2>=H)continue;
if(plateAt(nx2,ny2)!==myP)boundary=true;}
if(boundary){const pi4=ti<<2;d[pi4]=200;d[pi4+1]=60;d[pi4+2]=40;}}}
// Lake overlay
if(showLakesRef.current&&lk&&vm!=="atlas"){for(let ti=0;ti<N;ti++){if(lk[ti]<0)continue;
const pi4=ti<<2;d[pi4]=25;d[pi4+1]=60;d[pi4+2]=105;d[pi4+3]=255;}}
// River overlay — Rivers: tributary+. Streams: streams only.
if(ter.rivers&&vm!=="atlas"){const rm=ter.rivers.riverMag;
const rivers=showRiversRef.current,streams=showStreamsRef.current;
if(rivers||streams){
for(let ti=0;ti<N;ti++){const mag=rm[ti];if(mag<1)continue;
const pi4=ti<<2;
if(mag>=4&&rivers){d[pi4]=55;d[pi4+1]=150;d[pi4+2]=245;}
else if(mag>=3&&rivers){d[pi4]=45;d[pi4+1]=120;d[pi4+2]=220;}
else if(mag>=2&&rivers){d[pi4]=35;d[pi4+1]=95;d[pi4+2]=190;}
else if(mag===1&&streams){const a=0.45;d[pi4]=(d[pi4]*(1-a)+25*a)|0;d[pi4+1]=(d[pi4+1]*(1-a)+65*a)|0;d[pi4+2]=(d[pi4+2]*(1-a)+150*a)|0;}}}}
// Update globe texture from rendered canvas data (supports all view modes).
// The 25MB buffer is allocated ONCE and reused, and the rebuild is throttled
// to ~4Hz — building + re-uploading a 4096×2048 texture on every snapshot
// (30/s) churned ~750MB/s of allocations while the globe was open.
if(showGlobeRef.current){
const _gNow=performance.now();
if(_gNow-(globeStampRef.current||0)>=250){
globeStampRef.current=_gNow;
const gW=4096,gH=2048;
let buf=globeBufScratchRef.current;
if(!buf||buf.length!==gW*gH*3){buf=globeBufScratchRef.current=new Uint8Array(gW*gH*3);}
for(let gy=0;gy<gH;gy++){
const lat=Math.abs(gy/gH-0.5)*2;
const polarBlend=Math.max(0,Math.min(1,(lat-0.83)/0.17));
const sy=gy/gH*CH;
const sy0=Math.min(CH-2,sy|0),fy=sy-sy0;
for(let gx=0;gx<gW;gx++){
const sx=gx/gW*CW;
const sx0=Math.min(CW-2,sx|0),fx=sx-sx0;
// Bilinear sample from canvas ImageData
const p00=(sy0*CW+sx0)*4,p10=(sy0*CW+sx0+1)*4;
const p01=((sy0+1)*CW+sx0)*4,p11=((sy0+1)*CW+sx0+1)*4;
let r=(d[p00]*(1-fx)+d[p10]*fx)*(1-fy)+(d[p01]*(1-fx)+d[p11]*fx)*fy;
let g=(d[p00+1]*(1-fx)+d[p10+1]*fx)*(1-fy)+(d[p01+1]*(1-fx)+d[p11+1]*fx)*fy;
let b=(d[p00+2]*(1-fx)+d[p10+2]*fx)*(1-fy)+(d[p01+2]*(1-fx)+d[p11+2]*fx)*fy;
if(polarBlend>0){const pr=220,pg=225,pb=235;
r=r*(1-polarBlend)+pr*polarBlend;g=g*(1-polarBlend)+pg*polarBlend;b=b*(1-polarBlend)+pb*polarBlend;}
const ti3=(gy*gW+gx)*3;buf[ti3]=r|0;buf[ti3+1]=g|0;buf[ti3+2]=b|0;}}
setGlobeBuf(buf);setGlobeTexSize({w:gW,h:gH});setGlobeVer(v=>v+1);}
}
}
if(!ctx)return;
if(!_baseHit){
  if(_staticBase){
    // Stash the freshly-built base into the offscreen cache, then blit it.
    if(!baseLayerRef.current)baseLayerRef.current=document.createElement('canvas');
    const _bl=baseLayerRef.current;if(_bl.width!==CW||_bl.height!==CH){_bl.width=CW;_bl.height=CH;}
    _bl.getContext('2d').putImageData(img,0,0);ctx.drawImage(_bl,0,0);baseLayerKey.current=_baseKey;
  }else{
    // Non-cached views: route the image data through a temp canvas so the
    // pan/zoom transform (set on ctx above) applies to the blit. putImageData
    // ignores the active transform and would otherwise paint at literal 0,0.
    if(!baseLayerRef.current)baseLayerRef.current=document.createElement('canvas');
    const _bl=baseLayerRef.current;if(_bl.width!==CW||_bl.height!==CH){_bl.width=CW;_bl.height=CH;}
    _bl.getContext('2d').putImageData(img,0,0);ctx.drawImage(_bl,0,0);
  }
}
// Wind particles — animated white streaks that flow along wind vectors
if(vm==="wind"&&w.windX&&w.windY){
const NUM_PARTICLES=3000;const TRAIL_LEN=12;const MAX_AGE=80;
// Initialize particles if needed
if(!windParticlesRef.current||windParticlesRef.current.length!==NUM_PARTICLES){
windParticlesRef.current=[];
for(let i=0;i<NUM_PARTICLES;i++){
windParticlesRef.current.push({x:Math.random()*CW,y:Math.random()*CH,
age:Math.random()*MAX_AGE|0,trail:[]});}}
const particles=windParticlesRef.current;
const wX=w.windX,wY=w.windY;
// Step + draw each particle
ctx.lineCap="round";
for(let i=0;i<particles.length;i++){
const p=particles[i];
// Sample wind at particle position (screen → data via Mercator)
const sx=Math.min(W-1,(p.x*RES)|0),sy=Math.min(H-1,Math.round(screenYtoDataY(p.y,CH,H))),si=sy*W+sx;
const vx=wX[si]||0,vy=wY[si]||0;
const spd=Math.sqrt(vx*vx+vy*vy);
// Move particle along wind (speed scaled for visual effect)
const moveScale=5;
p.trail.push({x:p.x,y:p.y});
if(p.trail.length>TRAIL_LEN)p.trail.shift();
p.x+=vx*moveScale;p.y+=vy*moveScale;
p.age++;
// Respawn if out of bounds, too old, or in dead air
if(p.x<0||p.x>=CW||p.y<0||p.y>=CH||p.age>MAX_AGE||spd<0.002){
// Bias respawn toward faster wind areas: try a few random spots, keep the windiest
let bestX=Math.random()*CW,bestY=Math.random()*CH,bestSpd=0;
for(let t=0;t<3;t++){
const cx=Math.random()*CW,cy=Math.random()*CH;
const csx=Math.min(W-1,(cx*RES)|0),csy=Math.min(H-1,Math.round(screenYtoDataY(cy,CH,H)));
const cvx=wX[csy*W+csx]||0,cvy=wY[csy*W+csx]||0;
const cs=cvx*cvx+cvy*cvy;
if(cs>bestSpd){bestSpd=cs;bestX=cx;bestY=cy;}}
p.x=bestX;p.y=bestY;p.age=0;p.trail.length=0;continue;}
// Draw trail — fading white line
if(p.trail.length<2)continue;
const fadeIn=Math.min(1,p.age/8);const fadeOut=Math.max(0,1-(p.age-MAX_AGE+15)/15);
const brightness=fadeIn*fadeOut;
for(let j=1;j<p.trail.length;j++){
const segAlpha=(j/p.trail.length)*brightness*0.7;
if(segAlpha<0.02)continue;
const lw=0.4+(j/p.trail.length)*1.0;
ctx.strokeStyle=`rgba(255,255,255,${segAlpha.toFixed(2)})`;
ctx.lineWidth=lw;
ctx.beginPath();ctx.moveTo(p.trail[j-1].x,p.trail[j-1].y);ctx.lineTo(p.trail[j].x,p.trail[j].y);ctx.stroke();}
// Draw head dot
const headAlpha=brightness*0.9;
ctx.fillStyle=`rgba(255,255,255,${headAlpha.toFixed(2)})`;
ctx.beginPath();ctx.arc(p.x,p.y,0.8,0,Math.PI*2);ctx.fill();}
}
// ── peopleSim entity overlay ────────────────────────────────────────
// When vm === "roads", render ONLY the road network — no farmland,
// no settlement icons. Each disconnected network (closed graph of
// roads + settlements) is coloured distinctly so the player can
// see at a glance which settlements trade with each other.
// Otherwise: normal rendering of farmland + roads + settlement icons.
{
  const psw=peopleRef.current;
  const vmRoads = viewRef.current === "roads";
  const vmMoney = viewRef.current === "money";
  const vmCountry = viewRef.current === "country";
  const vmCulture = viewRef.current === "culture";
  const vmFaith = viewRef.current === "faith";
  const vmLanguage = viewRef.current === "language";
  const vmAncestry = viewRef.current === "ancestry";
  const vmSociety = viewRef.current === "society";
  const vmPrices = viewRef.current === "prices";
  const vmLoyalty = viewRef.current === "loyalty";
  const vmPopulation = viewRef.current === "population";
  const vmTechnique = viewRef.current === "technique";
  const vmTileCoin = viewRef.current === "tilecoin";
    if(psw&&ctx&&vmRoads){
    const TR=psw.tileRes;
    // ── Network components per tile ── world._tileComp is an Int32Array of
    // component-root ids. On the REAL world it's stamp-validated (only valid
    // where _tileCompSeen === _tileCompStampVal); the worker MIRROR ships a
    // pre-cleaned copy (-1 = no component). compAt() reads the root or -1.
    const tc=psw._tileComp,tcSeen=psw._tileCompSeen,tcStamp=psw._tileCompStampVal;
    const compAt = tc ? (tcSeen ? (ti)=>(tcSeen[ti]===tcStamp?tc[ti]:-1) : (ti)=>tc[ti]) : null;
    const find = (sid) => {
      const s = psw.settlements.find(o => o.id === sid);
      if (!s) return sid;
      const ti = (s.pos.y | 0) * psw.tw + (s.pos.x | 0);
      const c = compAt ? compAt(ti) : -1;
      return c >= 0 ? c : sid;
    };
    const compColour = (rootId) => {
      const h = ((rootId * 137) % 360 + 360) % 360;
      return `hsl(${h}, 65%, 45%)`;
    };
    // ── Tier filter (Layers panel): drop any component whose ONLY settlements
    // belong to hidden tiers, so only roads connecting the active tiers show.
    const _Lr=layersRef.current;
    const tierShowR=[_Lr.village,_Lr.town??_Lr.city,_Lr.city,_Lr.metropolis];   // tier 1 is a TOWN — it follows the town toggle (city fallback for old saved layer prefs)
    const allTiers=tierShowR.every(Boolean);
    let compVisible=null;
    if(!allTiers){
      compVisible=new Set();
      for(const s of psw.settlements){
        if(!s||s.mode!=="settled")continue;
        if(!tierShowR[s.tier|0])continue;
        const ti=(s.pos.y|0)*psw.tw+(s.pos.x|0);
        const c=compAt?compAt(ti):-1;
        compVisible.add(c>=0?c:s.id);
      }
    }
    const _showComp=c=>allTiers||compVisible.has(c);
    // ── Draw road tiles, coloured by their component (or a uniform colour
    // when component data isn't available yet) ──
    if(_Lr.roads&&psw.roadQuality){
      const rq=psw.roadQuality;
      for(let ti=0;ti<rq.length;ti++){
        if(rq[ti]>=1.0)continue;
        const comp=compAt?compAt(ti):-1;
        if(comp>=0&&!_showComp(comp))continue;
        const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
        const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
        ctx.fillStyle=comp>=0?compColour(comp):"rgba(150,110,60,0.9)";
        ctx.fillRect(sx,sy,TR,TR);
      }
    }
    // ── Settlement dots, also coloured by network ──
    // Smaller than the normal icons so the road shapes dominate;
    // every settlement shown so isolated ones (no roads) are
    // visible as their own coloured dot too.
    if(_Lr.icons)for(const s of psw.settlements){
      if(!s||s.mode!=="settled")continue;
      if(!tierShowR[s.tier|0])continue;
      const sx=s.pos.x*TR;
      const sy=dataYtoScreenY(s.pos.y*TR,H,CH);
      const root=find(s.id);
      ctx.beginPath();
      ctx.arc(sx,sy,3,0,Math.PI*2);
      ctx.fillStyle=compColour(root);
      ctx.fill();
      ctx.lineWidth=0.6;
      ctx.strokeStyle="rgba(0,0,0,0.5)";
      ctx.stroke();
    }
  }
  if(psw&&ctx&&viewRef.current==="goodsflow"){
    // ── Goods-flow overlay ── animated cargo streams colored by KIND.
    // Levy (grainL): surplus grain from worked TILES into their city.
    // Market (grainM): grain bought between settlements. Other kinds are
    // the goods-vector trades. Normalized PER KIND (grain units and goods
    // units are different scales — one global max would blank the smaller
    // book). Same particle scheme as the money view; 2-point entries
    // (field→city, sea hops without a path) draw a straight stream.
    const TR=psw.tileRes;
    const gsx=ti=>((ti%psw.tw)+0.5)*TR;
    const gsy=ti=>dataYtoScreenY(((ti/psw.tw|0)+0.5)*TR,H,CH);
    if(psw.roadQuality){
      const rq=psw.roadQuality;
      ctx.fillStyle="rgba(150,160,180,0.15)";
      for(let ti=0;ti<rq.length;ti++){
        if(rq[ti]>=1.0)continue;
        const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
        ctx.fillRect(px*TR,dataYtoScreenY(py*TR,H,CH),TR,TR);
      }
    }
    const gflows=psw._goodsFlows;
    if(gflows&&gflows.length){
      const ag=activeGoodsRef.current||{};
      const logMax={};
      for(const f of gflows){const m=logMax[f.kind];if(m===undefined||f.mag>m)logMax[f.kind]=f.mag;}
      for(const k in logMax)logMax[k]=Math.log1p(logMax[k]);
      const now=performance.now();
      const period=2600;
      let drawn=0;const CAPD=9000;
      for(const f of gflows){
        if(ag[f.kind]===false)continue;
        const col=GOODS_FLOW_KINDS[f.kind];if(!col)continue;
        const pts=f.pts;const np=pts?pts.length:0;if(np<2)continue;
        const lm=logMax[f.kind]||0;
        const busy=lm>0?Math.log1p(f.mag)/lm:0;
        const spacing=14-9*busy;
        let span=np;
        if(np===2){const ax=pts[0]%psw.tw,ay=(pts[0]/psw.tw)|0,bx=pts[1]%psw.tw,by=(pts[1]/psw.tw)|0;let ddx=Math.abs(ax-bx);if(ddx>psw.tw/2)ddx=psw.tw-ddx;span=Math.max(2,Math.hypot(ddx,ay-by));}
        let dots=Math.round(span/spacing);if(dots<1)dots=1;else if(dots>20)dots=20;
        const ph=(pts[0]*0.6180339887)%1;
        ctx.fillStyle=`rgba(${col[0]},${col[1]},${col[2]},${(0.45+0.5*busy).toFixed(2)})`;
        for(let j=0;j<dots;j++){
          let u=((now/period)+(j/dots)+ph)%1;
          if(!f.toEnd)u=1-u;
          const fi=u*(np-1);const i0=fi|0;const i1=Math.min(np-1,i0+1);const fr=fi-i0;
          const x0=gsx(pts[i0]),x1=gsx(pts[i1]);
          const y0=gsy(pts[i0]),y1=gsy(pts[i1]);
          if(Math.abs(x1-x0)>CW*0.5)continue;
          ctx.fillRect(x0+(x1-x0)*fr-1.2,y0+(y1-y0)*fr-1.2,2.4,2.4);
          if(++drawn>=CAPD)break;
        }
        if(drawn>=CAPD)break;
      }
    }
  }
  if(psw&&ctx&&vmMoney&&layersRef.current.moneyFlow){
    // ── Money-flow overlay ──────────────────────────────────────────
    // Maps the economy: where money is minted (mining), which way it
    // flows along roads, and which settlements are gaining vs losing it.
    const TR=psw.tileRes;
    const sx=ti=>((ti%psw.tw)+0.5)*TR;
    const sy=ti=>dataYtoScreenY(((ti/psw.tw|0)+0.5)*TR,H,CH);
    // 1) Faint road network, so the flow has visible channels.
    if(psw.roadQuality){
      const rq=psw.roadQuality;
      ctx.fillStyle="rgba(150,160,180,0.18)";
      for(let ti=0;ti<rq.length;ti++){
        if(rq[ti]>=1.0)continue;
        const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
        ctx.fillRect(px*TR,dataYtoScreenY(py*TR,H,CH),TR,TR);
      }
    }
    // 2) Animated coin particles streaming along trade links in the net-money
    // direction. EVERY active link gets a stream of coins at a roughly constant
    // spacing (busier links pack them tighter + brighter), so the whole live
    // trade network reads as "money in motion". (The old code shared one global
    // budget by sqrt(mag); with 1500+ links each link's share rounded to zero,
    // so only the busiest ~100 links ever showed a single dot — the map looked
    // empty despite a thriving economy.) Coins are binned into a few brightness
    // buckets and drawn in batches, so thousands of them cost ~4 fillStyle
    // changes instead of one per link.
    const flows=psw._moneyFlows;
    if(flows&&flows.length){
      let maxMag=0;for(const f of flows){if(f.mag>maxMag)maxMag=f.mag;}
      const logMax=Math.log1p(maxMag);
      const NB=4, CAPB=2600;                 // brightness buckets · per-bucket dot cap (perf safety)
      let mb=moneyDotsRef.current;
      if(!mb||mb.cap!==CAPB){mb={cap:CAPB,n:new Int32Array(NB),xy:Array.from({length:NB},()=>new Float32Array(CAPB*2))};moneyDotsRef.current=mb;}
      for(let b=0;b<NB;b++)mb.n[b]=0;
      const now=performance.now();
      const period=2600;                     // ms for a coin to traverse a link
      for(const f of flows){
        const pts=f.tiles;const np=pts.length;if(np<2)continue;
        // busyness 0..1 (log so a giant trunk doesn't flatten the rest); sets
        // both the brightness bucket and the coin spacing.
        const busy=logMax>0?Math.log1p(f.mag)/logMax:0;
        const b=Math.min(NB-1,(busy*NB)|0);
        if(mb.n[b]>=mb.cap)continue;          // bucket full (faintest links drop first; trunks live in higher buckets)
        const spacing=14-9*busy;             // tiles per coin: ~14 (faint) → ~5 (busiest)
        let dots=Math.round(np/spacing);if(dots<1)dots=1;else if(dots>20)dots=20;
        // Per-link phase from the start tile (golden-ratio hash) so the
        // thousands of single-coin links don't all pulse in lockstep.
        const ph=(pts[0]*0.6180339887)%1;
        const arr=mb.xy[b];let cnt=mb.n[b];
        for(let j=0;j<dots;j++){
          let u=((now/period)+(j/dots)+ph)%1;
          if(!f.toEnd)u=1-u;                 // reverse direction
          const fi=u*(np-1);const i0=fi|0;const i1=Math.min(np-1,i0+1);const fr=fi-i0;
          const x0=sx(pts[i0]),x1=sx(pts[i1]);
          const y0=sy(pts[i0]),y1=sy(pts[i1]);
          if(Math.abs(x1-x0)>CW*0.5)continue;   // skip segments that wrap the seam
          if(cnt>=mb.cap)break;
          arr[cnt*2]=x0+(x1-x0)*fr;arr[cnt*2+1]=y0+(y1-y0)*fr;cnt++;
        }
        mb.n[b]=cnt;
      }
      // Batched draw: one fillStyle per brightness bucket, cheap fillRect coins.
      const ALPHA=[0.42,0.60,0.77,0.95];
      for(let b=0;b<NB;b++){
        const cnt=mb.n[b];if(!cnt)continue;
        ctx.fillStyle=`rgba(255,205,70,${ALPHA[b]})`;
        const arr=mb.xy[b];
        for(let q=0;q<cnt;q++)ctx.fillRect(arr[q*2]-1.1,arr[q*2+1]-1.1,2.2,2.2);
      }
    }
    // 3) Per-settlement markers (the net-wealth node dots and the gold
    // mining-source glow) are intentionally NOT drawn — this view shows ONLY
    // the flowing money, so the trade itself is the whole picture.
  }
  if(psw&&ctx&&!vmRoads&&!vmMoney){
    const TR=psw.tileRes;
    // Vector features (borders, roads, settlement icons) are authored in MAP-canvas (CW) pixels but
    // rasterised onto the fixed FEAT_W overlay (see the octx _k scale below), so a width of `w*uiF`
    // becomes w*uiF*_k = w FEAT-px at EVERY map scale — one constant on-screen size, resolution-
    // agnostic. uiF = CW/1920 (no floor: the overlay's fixed resolution keeps thin lines crisp, so
    // the old 0.4 clamp — which made 0.5× features oversized — is no longer needed).
    const uiF=CW/1920;
    // ── Territory tint + borders + roads ── cached to an offscreen canvas
    // and regenerated only every PS_OVERLAY_REGEN sim-steps (it's a pure
    // function of owner[]/roadQuality[], which change slowly), then blitted.
    // This took ~460k per-tile fillRect+Map.get ops off EVERY frame.
    const PS_OVERLAY_REGEN=30;
    // The overlay is sized to the FIXED feature resolution (FEAT_W×FEAT_H), not the map canvas,
    // so borders/roads/tints rasterise crisply regardless of map scale; it's blitted onto the
    // feature canvas each frame. (meta.ch!==CH below still forces a rebuild on scale change.)
    let ov=psOverlayRef.current;
    if(!ov||ov.width!==FEAT_W||ov.height!==FEAT_H){
      ov=psOverlayRef.current=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(FEAT_W,FEAT_H):document.createElement('canvas'));
      ov.width=FEAT_W;ov.height=FEAT_H;psOverlayMeta.current.step=-1;
    }
    const meta=psOverlayMeta.current;
    const stepNow=psw.step||0;
    const L=layersRef.current;
    // Toggle key — when any of the rendered-into-overlay layers flips on/off
    // we must rebuild, otherwise the cached image stays stale.
    const layerKey=((L.tints?1:0)|(L.borders?2:0)|(L.roads?4:0)|(L.provinces?8:0)|(vmCountry?16:0)|(vmCulture?64:0)|(vmFaith?128:0)|(vmLanguage?256:0)|(vmAncestry?512:0)|(vmSociety?1024:0)|(vmLoyalty?2048:0)|(vmPopulation?4096:0)|(vmTechnique?16384:0)|(vmTileCoin?32768:0)|(vmPrices?8192+priceGoodRef.current:0))+"|"+selRealmRef.current;   // selection rides the key → highlight rebuilds on select
    // While the ancestry spread is replaying we rebuild the overlay every frame
    // (the revealed wavefront advances) instead of the lazy every-30-steps cache.
    const ancAnimating=vmAncestry&&ter&&ter.tArrival&&ancRevealRef.current.active;
    // Scrub invalidation: while the timeline is scrubbed the sim is paused, so
    // stepNow never advances and the lazy cache would keep blitting the LIVE
    // map under a moving year readout. Each arriving scrub frame bumps
    // _claimVer; fold it into the gate (live keeps the cheap 30-step cache —
    // scrubVer pins to -1 there, so live snapshots never thrash the overlay).
    const scrubVer=scrubRef.current?(psw._claimVer||0):-1;
    if(ancAnimating||meta.step<0||meta.ch!==CH||stepNow<meta.step||stepNow-meta.step>=PS_OVERLAY_REGEN||meta.layerKey!==layerKey||meta.scrubVer!==scrubVer){
      meta.layerKey=layerKey;meta.scrubVer=scrubVer;
      const octx=ov.getContext('2d');
      // Draw in MAP-canvas (CW×CH) coordinate units but rasterise onto the fixed FEAT_W×FEAT_H
      // overlay: a single uniform _k scale means every coordinate / width / dash below is reused
      // VERBATIM (w*uiF → w FEAT-px) yet renders at the fixed resolution — crisp at any map scale.
      octx.setTransform(1,0,0,1,0,0);
      octx.clearRect(0,0,FEAT_W,FEAT_H);
      octx.setTransform(_k,0,0,_k,0,0);
      // Sim-res tint buffer: the view fills below draw 1px per sim tile here (stctx) instead of a
      // block into ov, so the tints can be flood-filled + upscaled crisply to map resolution.
      const _tw=psw.tw,_th=psw.th;
      let stint=psTintSrcRef.current;
      if(!stint||stint.width!==_tw||stint.height!==_th){stint=psTintSrcRef.current=document.createElement('canvas');stint.width=_tw;stint.height=_th;}
      const stctx=stint.getContext('2d');stctx.setTransform(1,0,0,1,0,0);stctx.clearRect(0,0,_tw,_th);
      let _tintLastFs=null;
      // National territory tints + dotted borders. Prefer the SMOOTH national
      // CLAIM (countryId per tile, peopleSim/countryClaim.js) — country-centric
      // borders that follow terrain and enclose frontier hinterland; fall back
      // to the per-settlement owner map only until the first claim arrives.
      const owner=psw._territoryOwner, claimArr=psw._scrubClaim||psw._countryClaim;
      // ── Country view: BOLD opaque political map with thick borders + live,
      // maximally-distinct neighbour colours (assignCountryColors). ──
      // ── Culture / Faith views: who LIVES on each tile (dominant culture
      // or faith of the settlement whose territory it is) — peoples and
      // creeds, not states. Same machinery, different per-settlement key. ──
      if((vmCulture||vmFaith||vmLanguage||vmAncestry||vmSociety||vmPrices)&&psw.settlements){
        const tw=psw.tw,th=psw.th,N2=tw*th;
        // Resolve a settlement's overlay colour [h,s,l] + grouping KEY (borders
        // drawn where the key changes). Peoples → one hue each; Faiths → faith
        // hue (folk desaturated); Languages → the FAMILY hue with a per-tongue
        // lightness shade, so related languages read as one colour region with
        // daughter-language variation within it.
        // colour for ONE (faith/lang/culture) id under the active lens, or null
        const colFor=(fid,lid,cid)=>{
          if(vmFaith){const f=fid>=0&&psw.faiths?psw.faiths.get(fid):null;
            if(!f)return null;return{key:fid,h:f.hue|0,s:f.kind!=="organized"?40:58,l:52};}
          if(vmLanguage){
            // Languages key off the SPOKEN tongue, a distinct hue PER LANGUAGE so
            // each tongue reads as its own region; fall back to the people's own
            // tongue only until the language layer seeds.
            const lg=lid>=0&&psw.languages?psw.languages.get(lid):null;
            if(lg){const fh=(lg.hue!=null?lg.hue:((lg.id*2654435761)>>>0)%360)|0;return{key:lg.id,h:fh,s:58,l:50};}
            const c0=cid>=0&&psw.cultures?psw.cultures.get(cid):null;
            if(!c0)return null;const root0=c0.root??c0.id;const fh0=((root0*2654435761)>>>0)%360;return{key:cid,h:fh0,s:50,l:36+((c0.id*7)%6)*7};
          }
          const c=cid>=0&&psw.cultures?psw.cultures.get(cid):null;
          if(!c)return null;
          return{key:cid,h:c.hue|0,s:60,l:52};
        };
        // dominant colour + the SECONDARY (≥20% in this layer) if the unit is
        // genuinely mixed, so the fill can checkerboard a split town between its
        // top two colours. Works off the worker mirror (faithId2…) or, in the
        // main-thread fallback, the full mix arrays.
        const colorOf=(st)=>{
          const d=colFor(st.faithId??-1,st.langId??-1,st.cultureId??-1);
          if(!d)return null;
          const sec2=(packed,mix)=>st[packed]!=null?st[packed]:(st[mix]&&st[mix].length>1&&st[mix][1][1]>=0.2?st[mix][1][0]:-1);
          const s2=colFor(sec2("faithId2","faithMix"),sec2("langId2","langMix"),sec2("cultureId2","culMix"));
          if(s2&&s2.key!==d.key){d.key2=s2.key;d.h2=s2.h;d.s2=s2.s;d.l2=s2.l;}
          return d;
        };
        // ── Whole-area fill: assign EVERY land tile to its nearest settlement
        // (multi-source BFS over land, torus-wrapped), so peoples/faiths/tongues
        // paint continuous regions across the map instead of lighting up only
        // worked tiles. Cached (regions drift slowly) and recoloured each rebuild.
        // Land mask at the SIM tile resolution (the overlay grid, tw×th) by
        // sampling the higher-res territory elevation down — the sim runs at a
        // coarser tile grid than the terrain canvas, so we can't index tElev
        // directly.
        const TRr=ter&&ter.tw?Math.max(1,Math.round(ter.tw/tw)):1;
        const haveTer=ter&&ter.tElev&&ter.tw>0;
        const setts=[];for(const s of psw.settlements){if(s&&s.mode==="settled")setts.push(s);}
        const nfKey=tw+'x'+th+'|'+setts.length+'|'+Math.floor(stepNow/150);
        let nf=identityFillRef.current;
        if(haveTer&&(!nf||nf.key!==nfKey)){
          const land=new Uint8Array(N2);
          for(let y=0;y<th;y++){const py=Math.min(ter.th-1,y*TRr)*ter.tw;for(let x=0;x<tw;x++){const px=Math.min(ter.tw-1,x*TRr);land[y*tw+x]=ter.tElev[py+px]>0?1:0;}}
          // BOUNDED flood: each settlement colours only the land it actually
          // occupies — a disk sized by its importance (tier) — so the map shows
          // POPULATED land, not the whole partitioned world. Dense settlement
          // merges into continuous regions; deep wilderness stays grey.
          const nearest=new Int32Array(N2).fill(-1);
          const dist=new Uint16Array(N2);
          const q=new Int32Array(N2);let head=0,tail=0;
          const RAD=[6,10,15,20];   // village / town / city / metropolis reach (sim tiles)
          const radiusOf=new Map();
          for(const s of setts){const ti=(s.pos.y|0)*tw+(s.pos.x|0);if(ti>=0&&ti<N2&&land[ti]&&nearest[ti]<0){nearest[ti]=s.id;dist[ti]=0;radiusOf.set(s.id,RAD[Math.min(3,s.tier|0)]);q[tail++]=ti;}}
          while(head<tail){const ti=q[head++];const sid=nearest[ti];const dd=dist[ti]+1;if(dd>(radiusOf.get(sid)||6))continue;const y=(ti/tw)|0,x=ti-y*tw;
            const r=((x+1)%tw)+y*tw,l=((x-1+tw)%tw)+y*tw,u=y>0?ti-tw:-1,dn=y<th-1?ti+tw:-1;
            if(nearest[r]<0&&land[r]){nearest[r]=sid;dist[r]=dd;q[tail++]=r;}
            if(nearest[l]<0&&land[l]){nearest[l]=sid;dist[l]=dd;q[tail++]=l;}
            if(u>=0&&nearest[u]<0&&land[u]){nearest[u]=sid;dist[u]=dd;q[tail++]=u;}
            if(dn>=0&&nearest[dn]<0&&land[dn]){nearest[dn]=sid;dist[dn]=dd;q[tail++]=dn;}}
          nf=identityFillRef.current={nearest,key:nfKey};
        }
        if(nf&&(vmCulture||vmFaith||vmLanguage)){   // ancestry reuses the SAME fill but renders in its own block below
          const nearest=nf.nearest;
          const byId=psw._byId;const fcache=new Map(),kcache=new Map();
          // STAGE 1: colour from the per-tile identity FIELD where it covers a tile
          // (its territory catchment), and fall back to the settlement-point flood
          // only for the surrounding halo. The field is the grid substrate that
          // later stages let diffuse on its own; for now it mirrors the entities,
          // so owned tiles render identically — this just moves the SOURCE onto the
          // grid. Used only when the shipped field matches the active lens.
          const fld=((vmCulture&&psw._fieldLayer==="culture")||(vmFaith&&psw._fieldLayer==="faith")||(vmLanguage&&psw._fieldLayer==="language"))?psw._fieldDom:null;
          const fldSec=fld?psw._fieldSec:null;
          // colour for ONE id in the ACTIVE layer (the field carries that layer's id directly)
          const colForActive=(id)=>id<0?null:(vmFaith?colFor(id,-1,-1):vmLanguage?colFor(-1,id,-1):colFor(-1,-1,id));
          const idCol=new Map();   // active-layer id → {fs,key} (or null)
          const colById=(id)=>{if(id<0)return null;let e=idCol.get(id);if(e!==undefined)return e;
            const col=colForActive(id);e=col?{fs:`hsl(${col.h},${col.s}%,${col.l}%)`,key:col.key}:null;idCol.set(id,e);return e;};
          const fillFor=(sid)=>{let c=fcache.get(sid);if(c!==undefined)return c;
            const st=byId&&byId.get(sid);const col=st?colorOf(st):null;
            c=col?{c1:`hsl(${col.h},${col.s}%,${col.l}%)`,c2:col.key2!=null?`hsl(${col.h2},${col.s2}%,${col.l2}%)`:null}:null;
            fcache.set(sid,c);kcache.set(sid,col?col.key:-1);return c;};
          const keyOf=new Int32Array(N2);keyOf.fill(-2147483648);   // per-tile group key, for borders
          let lastFs=null;
          for(let ti=0;ti<N2;ti++){
            let c1,c2=null,key;
            if(fld){              // field present → counties are the ONLY source
              if(fld[ti]<0)continue;   // outside any county → leave grey (no per-settlement specks)
              const dc=colById(fld[ti]);if(!dc)continue;
              c1=dc.fs;key=dc.key;
              // Field tiles render their DOMINANT identity only — clean regions with
              // soft borders. (No top-two checkerboard: the diffusion makes most
              // border tiles a 2-mix, and checkerboarding them all reads as pixel
              // static. The gradient shows as the dominant shifting across the band.)
            }else{                 // field not shipped yet (or first frame) → nearest-settlement flood
              const sid=nearest[ti];if(sid<0)continue;const pr=fillFor(sid);if(!pr)continue;
              c1=pr.c1;c2=pr.c2;key=kcache.get(sid);
            }
            keyOf[ti]=key;
            const y=(ti/tw)|0,x=ti-y*tw;const sx=x*TR,sy=dataYtoScreenY(y*TR,H,CH);
            const fs=(c2&&((x+y)&1))?c2:c1;   // mixed unit → checkerboard top-two colours
            if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
            stctx.fillRect(x,y,1,1);}
          // soft borders where the dominant GROUP changes (legible but not segmented)
          octx.strokeStyle="rgba(10,10,14,0.34)";octx.lineWidth=uiF;octx.beginPath();
          for(let ti=0;ti<N2;ti++){const k=keyOf[ti];if(k===-2147483648)continue;
            const y=(ti/tw)|0,x=ti-y*tw;const sx=x*TR,sy=dataYtoScreenY(y*TR,H,CH);
            const rk=keyOf[((x+1)%tw)+y*tw];if(rk!==-2147483648&&rk!==k){const ex=(x+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
            if(y<th-1){const dk=keyOf[ti+tw];if(dk!==-2147483648&&dk!==k){const by=dataYtoScreenY((y+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}}
          octx.stroke();
        }
        // ── Society: coerced-labour heat ── muted parchment (free) → crimson (bound),
        // by each settlement's _coerce (slaves as a share of people + serfdom + cash-crop
        // plantation land). Shows the slave coast / plantation belt / serf periphery at a glance.
        if(nf&&vmSociety){
          const nearest=nf.nearest,byId=psw._byId,coCache=new Map();
          const coerceCol=(sid)=>{let c=coCache.get(sid);if(c!==undefined)return c;
            const st=byId&&byId.get(sid);const v=st?Math.min(1,st._coerce||0):0;
            c=v<0.05?"#5e626b":`hsl(${Math.round(30-26*v)},${Math.round(50+38*v)}%,${Math.round(50-16*v)}%)`;
            coCache.set(sid,c);return c;};
          let lastFs=null;
          for(let ti=0;ti<N2;ti++){const sid=nearest[ti];if(sid<0)continue;
            const fs=coerceCol(sid);const y=(ti/tw)|0,x=ti-y*tw;
            if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
            stctx.fillRect(x,y,1,1);}
        }
        // ── Prices: the local market price of ONE selected good, per catchment ──
        // green (glut, price → 0.25) → parchment (≈1) → red (scarce, → 4.0). This
        // is the spatial gradient the goods trade flows down — trade basins and
        // shortage fronts at a glance. Data: every settlement's _gPrice (worker).
        if(nf&&vmPrices){
          const nearest=nf.nearest,byId=psw._byId,g=priceGoodRef.current,prCache=new Map();
          const priceCol=(sid)=>{let c=prCache.get(sid);if(c!==undefined)return c;
            const st=byId&&byId.get(sid);const p=st&&st._gPrice?st._gPrice[g]:null;
            if(p==null)c="#5e626b";
            else{
              // log-scale around 1: t∈[-1,1] over price∈[0.25,4]
              const t=Math.max(-1,Math.min(1,Math.log2(p)/2));
              c=t<0?`hsl(${Math.round(95+25*t)},${Math.round(35-20*t)}%,${Math.round(46+8*t)}%)`
                   :`hsl(${Math.round(28-24*t)},${Math.round(45+40*t)}%,${Math.round(48-12*t)}%)`;
            }
            prCache.set(sid,c);return c;};
          let lastFs=null;
          for(let ti=0;ti<N2;ti++){const sid=nearest[ti];if(sid<0)continue;
            const fs=priceCol(sid);const y=(ti/tw)|0,x=ti-y*tw;
            if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
            stctx.fillRect(x,y,1,1);}
        }
      }
      // ── Loyalty: the attachment continuum + the ground's memory (ontology V2) ──
      // Heat per GOVERNED tile: ember (the people are detached) → amber → green
      // (attached) — the same hue ramp the inspect card's loyalty dot uses. Ground
      // that still REMEMBERS a fallen nation checkerboards with that nation's own
      // realm colour ((id·61)%360 — the sim's hue formula, so old Poland's ground
      // wears old Poland's colour) and is outlined, so irredenta read as regions.
      if(vmLoyalty&&psw._loyal){
        const tw=psw.tw,th=psw.th,N2=Math.min(tw*th,psw._loyal.length);
        const loyal=psw._loyal,home=psw._loyalHome;
        const homeFs=new Map();let lastFs=null;
        for(let ti=0;ti<N2;ti++){
          const v=loyal[ti];if(v===255)continue;   // ungoverned → base grey
          const y=(ti/tw)|0,x=ti-y*tw;
          let fs;
          const hm=home?home[ti]:-1;
          if(hm>=0&&((x+y)&1)){
            fs=homeFs.get(hm);
            if(!fs){fs=`hsl(${((hm*61)%360+360)%360},62%,46%)`;homeFs.set(hm,fs);}
          }else{
            const a=v/250;
            fs=`hsl(${(8+a*132)|0},${(64-a*18)|0}%,${(38+a*9)|0}%)`;
          }
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(x,y,1,1);
        }
        if(home){
          octx.strokeStyle="rgba(16,10,6,0.55)";octx.lineWidth=uiF;octx.beginPath();
          for(let ti=0;ti<N2;ti++){const k=home[ti];if(k<0)continue;
            const y=(ti/tw)|0,x=ti-y*tw;const sx=x*TR,sy=dataYtoScreenY(y*TR,H,CH);
            const rk=home[((x+1)%tw)+y*tw];if(rk!==k){const ex=(x+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
            if(y<th-1){const dk=home[ti+tw];if(dk!==k){const by=dataYtoScreenY((y+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}}
          octx.stroke();
        }
        // Dashed realm borders on top, so the heat reads as "inside WHOSE realm"
        // (the same dashed style the terrain view's border layer uses).
        const bArr=psw._scrubClaim||psw._countryClaim;
        if(bArr){
          octx.strokeStyle="rgba(15,15,15,0.8)";octx.lineWidth=uiF;octx.setLineDash([2*uiF,2*uiF]);octx.beginPath();
          for(let ti=0;ti<Math.min(N2,bArr.length);ti++){
            const cc=bArr[ti];if(cc<0)continue;
            const y=(ti/tw)|0,x=ti-y*tw;const sx=x*TR,sy=dataYtoScreenY(y*TR,H,CH);
            const ro=bArr[y*tw+(x===tw-1?0:x+1)];
            if(ro>=0&&ro!==cc){const ex=(x+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
            if(y<th-1){const dno=bArr[ti+tw];if(dno>=0&&dno!==cc){const by=dataYtoScreenY((y+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}}
          octx.stroke();octx.setLineDash([]);
        }
      }
      // ── Population: the people-on-land field (popField) on an ABSOLUTE log
      // ruler. The worker packs density against a FIXED span — log10 of the
      // census per reference tile, 0.1..1000 ≈ 100 → 1,000,000 real people,
      // one decade per quarter of the byte — never against the frame's own
      // maximum. (The old relative packing read as a uniform world-wide glow
      // that only brightened: at genesis the densest tile IS ordinary
      // farmland so everything sat at the top of the ramp, and log-vs-max
      // ratios compress toward 1 as the world grows.) On the fixed ruler a
      // thin dawn world LOOKS thin, growth is real change on screen, and the
      // same colour means the same density in any era: haze <1k · slate→blue
      // 1k-10k · blue→teal 10k-75k · teal→amber 75k-560k · white ≥560k. The
      // packed value already carries the decades, so t is LINEAR (no gamma —
      // a gamma here would re-crush the haze/blue decades the dawn lives in). ──
      if(vmPopulation&&psw._popDens){
        const tw=psw.tw,th=psw.th,N2=Math.min(tw*th,psw._popDens.length);
        const dens=psw._popDens;let lastFs=null;
        const fsCache=new Array(251);
        const colAt=(v)=>{let fs=fsCache[v];if(fs)return fs;
          const t=v/250;   // linear on the packed log: one decade per 0.25
          // Brightness is MONOTONE in density over the lens's dark land base
          // (~rgb(52,52,57)): haze lifts gently above it, each band starts
          // where the previous ended — bright always means more people.
          // Palette weight sits on the REAL regime boundary (measured, seed
          // 8817 @3k/6k steps): technique-reached land — overwhelmingly the
          // governed world — runs a median ~13k people/region, subsistence
          // wilderness ~0.7-2.2k (6× at equal fertility, 17× overall; the
          // devField wave is the mechanism). So the 1k-10k subsistence decade
          // stays a QUIET slate and saturation snaps in across 10k-20k —
          // civilization visibly burns, the wild stays a murmur. Same
          // absolute ruler; only the colours' emphasis moved.
          let r,g,b,a=1;
          if(t<0.25){a=0.25+t/0.25*0.55;r=56;g=66;b=96;}                                          // <1k: subsistence haze — a soft blue lift
          else if(t<0.50){const s2=(t-0.25)/0.25;r=(50-s2*2)|0;g=(60+s2*6)|0;b=(86+s2*22)|0;}     // 1k→10k: muted slate-blue — thinly peopled wild stays quiet
          else if(t<0.58){const s2=(t-0.50)/0.08;r=(48+s2*2)|0;g=(66+s2*74)|0;b=(108+s2*22)|0;}   // 10k→20k: the agrarian threshold — saturation snaps in
          else if(t<0.72){const s2=(t-0.58)/0.14;r=50;g=(140+s2*30)|0;b=130;}                     // 20k→75k: teal deepens across the farmed belts
          else if(t<0.90){const s2=(t-0.72)/0.18;r=(50+s2*190)|0;g=(170+s2*35)|0;b=(130-s2*70)|0;} // 75k→560k: teal → amber dense basins
          else{const s2=(t-0.90)/0.10;r=240;g=(205+s2*45)|0;b=(60+s2*165)|0;}                     // ≥560k: amber → white-hot urban cores
          fs=a<1?`rgba(${r},${g},${b},${a.toFixed(2)})`:`rgb(${r},${g},${b})`;fsCache[v]=fs;return fs;};
        for(let ti=0;ti<N2;ti++){
          const v=dens[ti];if(v<=0)continue;   // empty land / water → base
          const y=(ti/tw)|0,x=ti-y*tw;
          const fs=colAt(v);
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(x,y,1,1);
        }
      }
      // ── Technique: the idea field (devField) on an ABSOLUTE 0..1 ruler — the
      // field that sets carrying capacity, previously invisible in the app
      // (docs/design-idea-field.md: every defect in it was found by probe).
      // Land at devField ≡ 0 shows the BASE MAP: "no idea has ever reached this
      // ground" is the lens's headline reading (60% of all land), and it must
      // look like wilderness, not like a low value. The one snap sits on the
      // REAL regime boundary, NEOLITHIC_AGRI = 0.45 (crystallize.js) — the full
      // farming package: below it a quiet ochre haze (the wave's decayed edge —
      // contact, not cultivation), at the bar green arrives, and the ramp runs
      // to gold-white headroom for the advanced eras. Same idiom as the
      // population lens: brightness monotone over the dark base, saturation
      // snapping in at the boundary that means something. ──
      if(vmTechnique&&psw._devDens){
        const tw=psw.tw,th=psw.th,N2=Math.min(tw*th,psw._devDens.length);
        const dens=psw._devDens;let lastFs=null;
        const fsCache=new Array(251);
        const colAt=(v)=>{let fs=fsCache[v];if(fs)return fs;
          const t=v/250;   // linear on the absolute ruler: t IS the devField value
          let r,g,b,a=1;
          if(t<0.45){const s2=t/0.45;a=0.22+s2*0.58;r=(115+s2*25)|0;g=(92+s2*18)|0;b=48;}          // <0.45: ochre haze — the idea seeping, not arrived
          else if(t<0.60){const s2=(t-0.45)/0.15;r=(72+s2*20)|0;g=(142+s2*40)|0;b=(58+s2*12)|0;}   // 0.45: the farming package ARRIVES — green snaps in
          else if(t<0.85){const s2=(t-0.60)/0.25;r=(92+s2*110)|0;g=(182+s2*30)|0;b=(70+s2*20)|0;}  // 0.60→0.85: deepening technique, green → gold
          else{const s2=(t-0.85)/0.15;r=(202+s2*43)|0;g=(212+s2*33)|0;b=(90+s2*125)|0;}            // ≥0.85: advanced eras — gold → white
          fs=a<1?`rgba(${r},${g},${b},${a.toFixed(2)})`:`rgb(${r},${g},${b})`;fsCache[v]=fs;return fs;};
        for(let ti=0;ti<N2;ti++){
          const v=dens[ti];if(v<=0)continue;   // devField exactly 0 / water → base map
          const y=(ti/tw)|0,x=ti-y*tw;
          const fs=colAt(v);
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(x,y,1,1);
        }
      }
      // ── Coin field: farm-gate coin sitting on worked tiles (_tileWealth).
      // Gold on the dark slate base — bright means more coin piled at the gate;
      // empty hinterland stays dark. Absolute log ruler (0.01..10k coin/tile)
      // so the von Thünen gradient reads the same in every era. ──
      if(vmTileCoin&&psw._tileCoinDens){
        const tw=psw.tw,th=psw.th,N2=Math.min(tw*th,psw._tileCoinDens.length);
        const dens=psw._tileCoinDens;let lastFs=null;
        const fsCache=new Array(251);
        const colAt=(v)=>{let fs=fsCache[v];if(fs)return fs;
          const t=v/250;
          let r,g,b,a=1;
          if(t<0.25){a=0.18+t/0.25*0.42;r=88;g=72;b=48;}                                           // trace coin — warm shadow
          else if(t<0.50){const s2=(t-0.25)/0.25;r=(120+s2*60)|0;g=(90+s2*50)|0;b=(40+s2*10)|0;}  // farm belt — ochre
          else if(t<0.75){const s2=(t-0.50)/0.25;r=(180+s2*55)|0;g=(140+s2*50)|0;b=(50+s2*10)|0;} // market fringe — amber
          else{const s2=(t-0.75)/0.25;r=(235+s2*20)|0;g=(205+s2*45)|0;b=(70+s2*120)|0;}            // hot farm gates — gold → white
          fs=a<1?`rgba(${r},${g},${b},${a.toFixed(2)})`:`rgb(${r},${g},${b})`;fsCache[v]=fs;return fs;};
        for(let ti=0;ti<N2;ti++){
          const v=dens[ti];if(v<=0)continue;
          const y=(ti/tw)|0,x=ti-y*tw;
          const fs=colAt(v);
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(x,y,1,1);
        }
      }
      // ── Ancestry: the deep genetic substrate, a per-tile worldgen field over ALL
      // land (not just settled). Coloured per-ancestry; civ overlays sit on top of it. ──
      if(vmAncestry&&ter&&ter.tAncestry){
        const tw=psw.tw,th=psw.th,anc=ter.tAncestry,arr=ter.tArrival;
        const TRr=ter.tw?Math.max(1,Math.round(ter.tw/tw)):1;
        const idx=(px,py)=>Math.min(ter.th-1,py*TRr)*ter.tw+Math.min(ter.tw-1,px*TRr);
        const birth=ter.ancBirth,parent=ter.ancParent,hue=ter.ancHue,light=ter.ancLight;
        // Peopling replay: a tile lights up once the wavefront reaches it (arr ≤
        // prog) and then shows the LINEAGE alive there at that moment — walk up
        // the fission tree to the most recent ancestor already born by `prog`, so
        // long-settled lands visibly split into sub-lineages as the clock runs
        // while the just-reached frontier stays one broad founder colour.
        const ANC_REVEAL_MS=10000;
        const rv=ancRevealRef.current;
        const prog=(arr&&rv.active)?Math.min(1,(performance.now()-rv.start)/ANC_REVEAL_MS):1;
        const lineageAt=(a)=>{if(!birth)return a;while(a>=0&&birth[a]>prog&&parent[a]>=0)a=parent[a];return a;};
        // LIVE ancestry: once the replay has run, settled tiles show the dominant
        // (admixed) stock the SIM has carried there by migration — the substrate
        // shifts under colonisation while staying put under mere conquest; deep
        // wilderness keeps the worldgen bedrock. Reuses the identity flood above.
        const nfA=identityFillRef.current;
        const ancBySid=new Map();
        if(nfA&&psw.settlements)for(const s of psw.settlements){if(!s||s.mode!=="settled")continue;const a=s.ancId!=null?s.ancId:(s.ancMix&&s.ancMix.length?s.ancMix[0][0]:-1);if(a>=0)ancBySid.set(s.id,a);}
        const liveAt=(px,py)=>{if(!nfA)return -1;const sid=nfA.nearest[py*tw+px];if(sid<0)return -1;const a=ancBySid.get(sid);return a==null?-1:a;};
        const shown=(px,py)=>{const i=idx(px,py);const a=anc[i];if(a<0)return -1;if(arr&&arr[i]>prog)return -1;if(prog<1)return lineageAt(a);const lv=liveAt(px,py);return lv>=0?lv:a;};
        const fill=new Map();let lastFs=null;
        for(let py=0;py<th;py++)for(let px=0;px<tw;px++){
          const a=shown(px,py);if(a<0)continue;
          let fs=fill.get(a);if(fs===undefined){const h=hue?hue[a]|0:((a*2654435761)>>>0)%360;const l=light?light[a]|0:52;fs=`hsl(${h},53%,${l}%)`;fill.set(a,fs);}
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(px,py,1,1);
        }
        octx.strokeStyle="rgba(8,8,12,0.34)";octx.lineWidth=uiF;octx.beginPath();
        for(let py=0;py<th;py++)for(let px=0;px<tw;px++){
          const a=shown(px,py);if(a<0)continue;const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const ra=shown((px+1)%tw,py);if(ra>=0&&ra!==a){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const da=shown(px,py+1);if(da>=0&&da!==a){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        octx.stroke();
        // The cradle — a soft pulsing beacon at the genesis point while it plays
        // (prog<1 only, so the final cached frame is a clean map with no marker).
        if(arr&&rv.active&&prog<1&&ter.ancOriginFx!=null){
          const ox=ter.ancOriginFx*tw*TR, oy=dataYtoScreenY(ter.ancOriginFy*th*TR,H,CH);
          const ph=(performance.now()/700)%1, rr=TR*1.5+ph*TR*7;
          octx.strokeStyle=`rgba(255,244,210,${(0.75*(1-ph)).toFixed(3)})`;octx.lineWidth=1.4*uiF;
          octx.beginPath();octx.arc(ox,oy,rr,0,6.2832);octx.stroke();
          octx.fillStyle="rgba(255,248,224,0.95)";octx.beginPath();octx.arc(ox,oy,Math.max(1.6,TR*1.3),0,6.2832);octx.fill();
        }
        if(prog>=1)rv.active=false;   // spread complete — release the per-frame rebuild
      }
      // ── Selected-realm emphasis (plan §5.3): a bright wash + gold outline
      // around the realm the player has picked, drawn into the cached overlay
      // (selection id rides the rebuild key). One O(tiles) pass per rebuild.
      const emphasizeRealm=(arr,tw2,th2)=>{
        const sel=selRealmRef.current;if(sel<0||!arr)return;
        octx.save();
        octx.fillStyle="rgba(255,244,200,0.16)";
        octx.strokeStyle="rgba(255,206,84,0.95)";octx.lineWidth=2.6*uiF;octx.lineJoin="round";octx.lineCap="round";
        octx.beginPath();
        for(let ti=0;ti<arr.length;ti++){
          if(arr[ti]!==sel)continue;
          const py=(ti/tw2)|0,px=ti-py*tw2;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          octx.fillRect(sx,sy,TR,TR);
          const ro=arr[py*tw2+(px===tw2-1?0:px+1)],lo=arr[py*tw2+(px===0?tw2-1:px-1)];
          const uo=py>0?arr[ti-tw2]:-2,dn=py<th2-1?arr[ti+tw2]:-2;
          if(ro!==sel){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(lo!==sel){octx.moveTo(sx,sy);octx.lineTo(sx,sy+TR);}
          if(uo!==sel&&uo!==-2){octx.moveTo(sx,sy);octx.lineTo(sx+TR,sy);}
          if(dn!==sel&&dn!==-2){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}
        }
        octx.stroke();octx.restore();
      };
      // Suzerainty root: follow _overlord chains (vassal AND colony) with a
      // hop guard. An empire paints as ONE colour family — the atlas
      // convention (satrapies paint as Persia) — while internal boundaries
      // stay visible as province lines. Shared by the Politics lens AND the
      // terrain-view political wash so blocs paint and border identically.
      const rootCache=new Map();
      const rootOf=(id)=>{let r=rootCache.get(id);if(r!==undefined)return r;
        let cur=id,hops=0;
        while(hops++<12){const o=psw.countries&&psw.countries.get(cur);const ov=o&&o._overlord>=0&&o._overlord!==cur?o._overlord:-1;if(ov<0)break;cur=ov;}
        rootCache.set(id,cur);return cur;};
      if(vmCountry&&claimArr){
        const tw=psw.tw,th=psw.th;
        const hues=assignCountryColors(claimArr,tw,th,countryColorsRef.current,rootOf);
        countryColorsRef.current=hues;
        const fillByCountry=new Map(),colonyByCC=new Map();
        const colonyCells=[];   // sx,sy pairs of colony tiles → striped overlay below
        // opaque bold fills (cover the terrain so the colours read clean)
        let lastFs=null;
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          let fs=fillByCountry.get(cc);
          if(fs===undefined){
            // A COLONY is drawn in its metropole's exact colour + stripes (a
            // plantation of the empire). A submitted VASSAL wears the empire's
            // hue at a lighter shade — inside the colour family, visibly not
            // the metropole; its own border still separates it. A nation of
            // the land (no court in psw.countries — tribal fabric) is a PALE
            // wash: atlases colour states, peoples stay quiet. City-states
            // WITH a court keep full vibrancy.
            const cobj=psw.countries&&psw.countries.get(cc);
            const root=rootOf(cc);
            const isColony=!!(cobj&&cobj._overlord>=0&&cobj._depKind!=="vassal");
            const isVassal=!!(cobj&&cobj._overlord>=0&&cobj._depKind==="vassal");
            // Mute only ids the snapshot POSITIVELY knows as land nations — a
            // scrubbed frame carries ids of realms since dead, which have no
            // registry entry and must not read as tribal fabric.
            const isLandNation=!cobj&&psw._landNames&&psw._landNames.has(cc);
            colonyByCC.set(cc,isColony);
            const h=(hues.get(root)??((root*61)%360+360)%360)|0;
            fs=isLandNation?`hsl(${h},24%,56%)`:isVassal?`hsl(${h},52%,60%)`:`hsl(${h},60%,50%)`;
            fillByCountry.set(cc,fs);
          }
          if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
          stctx.fillRect(px,py,1,1);
          if(colonyByCC.get(cc)){colonyCells.push(sx,sy);}
        }
        // Black diagonal stripes over colonies (same colour as the metropole underneath).
        stripeCells(octx,colonyCells,TR,0.62);
        // Borders, atlas-style (owner 2026-08-20: "display a nation and their
        // tributary as 1 thing — the tributary a STATE/province"): an edge
        // between two members of the SAME suzerainty bloc is an internal
        // province line — thin, translucent — while a true national border
        // (different bloc roots) keeps the thick dark stroke. The register
        // keeps every polity; the atlas look is a paint convention.
        const natPath=new Path2D(),provPath=new Path2D();
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const ro=claimArr[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==cc){const ex=(px+1)*TR;const p=rootOf(ro)===rootOf(cc)?provPath:natPath;p.moveTo(ex,sy);p.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=claimArr[ti+tw];if(dno>=0&&dno!==cc){const by=dataYtoScreenY((py+1)*TR,H,CH);const p=rootOf(dno)===rootOf(cc)?provPath:natPath;p.moveTo(sx,by);p.lineTo(sx+TR,by);}}
        }
        octx.lineJoin="round";octx.lineCap="round";
        if(L.provinces){octx.strokeStyle="rgba(20,20,26,0.45)";octx.lineWidth=0.8*uiF;octx.stroke(provPath);}
        if(L.borders){octx.strokeStyle="rgba(8,8,12,0.92)";octx.lineWidth=2.2*uiF;octx.stroke(natPath);}
        emphasizeRealm(claimArr,tw,th);
      }
      if(!vmCountry&&!vmCulture&&!vmFaith&&!vmLanguage&&!vmAncestry&&!vmSociety&&!vmPrices&&!vmLoyalty&&!vmPopulation&&!vmTechnique&&!vmTileCoin&&(L.tints||L.borders||L.provinces)&&claimArr){
        const tw=psw.tw,th=psw.th,tintByCountry=new Map(),colonyByCC=new Map(),colonyCells=[];
        // Two pens, bloc-aware (same convention as the Politics lens): a seam
        // between two members of the SAME suzerainty bloc is a faint province
        // line (Layers → Province borders); a true national border keeps the
        // heavier dash (Layers → Borders).
        const natB=(L.borders||L.provinces)?new Path2D():null,provB=natB&&new Path2D();
        let lastFs=null;
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          if(L.tints){
            let fs=tintByCountry.get(cc);
            if(fs===undefined){
              // Same bloc convention as the Politics lens: tint by suzerainty
              // ROOT hue (vassals included), stripes still mark colonies.
              const co=psw.countries&&psw.countries.get(cc);
              const isColony=!!(co&&co._overlord>=0&&co._depKind!=="vassal");
              const root=rootOf(cc);
              colonyByCC.set(cc,isColony);
              const h=((root*61)%360+360)%360;
              fs=`hsla(${h},50%,50%,0.34)`;tintByCountry.set(cc,fs);}
            if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
            stctx.fillRect(px,py,1,1);
            if(colonyByCC.get(cc)){colonyCells.push(sx,sy);}
          }
          if(!natB)continue;
          const ro=claimArr[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==cc){const ex=(px+1)*TR;const p=rootOf(ro)===rootOf(cc)?provB:natB;p.moveTo(ex,sy);p.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=claimArr[ti+tw];
            if(dno>=0&&dno!==cc){const by=dataYtoScreenY((py+1)*TR,H,CH);const p=rootOf(dno)===rootOf(cc)?provB:natB;p.moveTo(sx,by);p.lineTo(sx+TR,by);}}
        }
        if(natB){
          if(L.provinces){octx.strokeStyle="rgba(25,25,30,0.55)";octx.lineWidth=0.7*uiF;octx.setLineDash([uiF,1.6*uiF]);octx.stroke(provB);}
          if(L.borders){octx.strokeStyle="rgba(15,15,15,0.8)";octx.lineWidth=uiF;octx.setLineDash([2*uiF,2*uiF]);octx.stroke(natB);}
          octx.setLineDash([]);
        }
        if(L.tints)stripeCells(octx,colonyCells,TR,0.5);
        emphasizeRealm(claimArr,tw,th);
      } else if(!vmCountry&&!vmCulture&&!vmFaith&&!vmLanguage&&!vmAncestry&&!vmSociety&&!vmPrices&&!vmLoyalty&&!vmPopulation&&!vmTechnique&&!vmTileCoin&&(L.tints||L.borders)&&owner){
        const tw=psw.tw,th=psw.th;
        let maxId=0; for(const s of psw.settlements){if(s&&s.mode==="settled"&&s.id>maxId)maxId=s.id;}
        const tintById=new Array(maxId+1); const ctryById=new Int32Array(maxId+1).fill(-1);
        const tintByCountry=new Map();
        for(const s of psw.settlements){if(s&&s.mode==="settled"){
          let t=tintByCountry.get(s.countryId);
          if(t===undefined){const h=((s.countryId*61)%360+360)%360;t=`hsla(${h},50%,50%,0.32)`;tintByCountry.set(s.countryId,t);}
          tintById[s.id]=t; ctryById[s.id]=s.countryId;
        }}
        if(L.borders){octx.strokeStyle="rgba(15,15,15,0.8)";octx.lineWidth=uiF;octx.setLineDash([2*uiF,2*uiF]);octx.beginPath();}
        let lastFs=null;
        for(let ti=0;ti<owner.length;ti++){
          const oid=owner[ti];if(oid<0)continue;
          const fs=tintById[oid];if(fs===undefined)continue;
          const py=(ti/tw)|0,px=ti-py*tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          if(L.tints){
            if(fs!==lastFs){stctx.fillStyle=fs;lastFs=fs;}
            stctx.fillRect(px,py,1,1);
          }
          if(!L.borders)continue;
          const co=ctryById[oid];
          const ro=owner[py*tw+(px===tw-1?0:px+1)];
          if(ro>=0&&ro!==oid&&ctryById[ro]!==co){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}
          if(py<th-1){const dno=owner[ti+tw];
            if(dno>=0&&dno!==oid&&ctryById[dno]!==co){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}
        }
        if(L.borders){octx.stroke();octx.setLineDash([]);}
      }
      // ── Farming-Region territory view: outline EACH settlement's economic
      // catchment (_territoryOwner — the food-producing land it administers).
      // With urban nodes releasing their land, these ARE the farming regions, so
      // you can see how much land each rural region holds (often a country's
      // de-facto core). Tint per region + a solid edge wherever the owner changes
      // (including against wilderness), so every region's territory is outlined.
      // ── Province borders (Layers → Provinces) ──
      // Internal administrative divisions. A province follows the SIM's own
      // territory, not a fresh geometric guess: every tile is taken by the
      // settlement that ADMINISTERS it (_territoryOwner — the transport-cost
      // catchment), and that settlement's province is:
      //   • a CAPTURED town → its _homeland (the nation it was conquered from),
      //     so an absorbed country stays ONE province bordered by its FORMER
      //     extent (the conquered-border lines), until it assimilates (~HOMELAND_
      //     MEMORY) and rejoins the core; and
      //   • a NATIVE town → its administrative seat (_provinceCity, the nearest
      //     CITY by the sim's reach), so the heartland splits into city regions.
      // Because the cells are unions of transport catchments they BEND with
      // terrain (no straight Euclidean bisectors). Captured-nation provinces use
      // negative keys so they never collide with a native city-seat id. Tiles
      // with no settlement catchment (gap-filled interior) fall back to nearest
      // city. Drawn lighter/dotted beneath the national border.
      if(L.provinces&&claimArr){
        const tw=psw.tw,th=psw.th,halfTw=tw/2;
        const provById=new Map();   // settlementId → province key (neg = captured nation)
        const cityList=new Map();   // countryId → [cities] (fallback for catchment-less tiles)
        for(const s of psw.settlements){if(!(s&&s.mode==="settled"&&s.countryId>=0))continue;
          const hl=s._homeland??-1; const captured=hl>=0&&hl!==s.countryId;   // ignore a stale self-home
          provById.set(s.id, captured ? -(hl+2) : ((s._provinceCity??-1)>=0 ? s._provinceCity : s.countryId));
          if((s.tier|0)>=2){let a=cityList.get(s.countryId);if(!a)cityList.set(s.countryId,a=[]);a.push(s);}}
        const nearestCity=(ti,cc)=>{const arr=cityList.get(cc);if(!arr)return cc;if(arr.length===1)return arr[0].id;
          const py=((ti/tw)|0)+0.5,px=(ti-((ti/tw)|0)*tw)+0.5;let best=cc,bd=Infinity;
          for(const c of arr){let dx=Math.abs(c.pos.x-px);if(dx>halfTw)dx=tw-dx;const dy=c.pos.y-py;const d=dx*dx+dy*dy;if(d<bd){bd=d;best=c.id;}}return best;};
        const prov=new Int32Array(claimArr.length).fill(-2147483648);   // sentinel = unset
        for(let ti=0;ti<claimArr.length;ti++){
          const cc=claimArr[ti];if(cc<0)continue;
          const sid=owner?owner[ti]:-1;
          let pv=sid>=0?provById.get(sid):undefined;
          prov[ti]=pv!==undefined?pv:nearestCity(ti,cc);   // catchment province, else nearest-city fallback
        }
        // Two pens. A border touching a CAPTURED-nation province (negative key) is
        // a former national frontier inside the realm — drawn heavier/longer-dashed
        // so a conquered country's old outline reads as historically significant;
        // ordinary city-seam borders in the heartland stay faint dots.
        const drawSeams=(heritage)=>{
          for(let ti=0;ti<claimArr.length;ti++){
            const cc=claimArr[ti];if(cc<0)continue;const pv=prov[ti];
            const py=(ti/tw)|0,px=ti-py*tw;const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
            const rti=py*tw+(px===tw-1?0:px+1);
            if(claimArr[rti]===cc){const qv=prov[rti];if(qv!==pv&&((pv<0||qv<0)===heritage)){const ex=(px+1)*TR;octx.moveTo(ex,sy);octx.lineTo(ex,sy+TR);}}
            if(py<th-1){const dti=ti+tw;if(claimArr[dti]===cc){const qv=prov[dti];if(qv!==pv&&((pv<0||qv<0)===heritage)){const by=dataYtoScreenY((py+1)*TR,H,CH);octx.moveTo(sx,by);octx.lineTo(sx+TR,by);}}}
          }
        };
        octx.strokeStyle="rgba(20,20,20,0.45)";octx.lineWidth=uiF;octx.setLineDash([uiF,2*uiF]);octx.beginPath();drawSeams(false);octx.stroke();
        octx.strokeStyle="rgba(15,15,15,0.75)";octx.lineWidth=uiF;octx.setLineDash([3*uiF,2*uiF]);octx.beginPath();drawSeams(true);octx.stroke();
        octx.setLineDash([]);
      }
      // ── War fronts (Layers → War fronts): arrows across the border from the
      // AGGRESSOR into the ATTACKED — one glance says who is invading whom.
      // Sampled worker-side along each warring pair's drawn border (so they
      // sit exactly on the lines above); direction = the war pass's own
      // offensive commitments, so a mutual war shows arrows both ways.
      // Live-state only: suppressed while scrubbing the timeline (arrows
      // describe TODAY's wars, not the year under the scrubber).
      if(L.warFronts&&psw._warArrows&&psw._warArrows.length&&!psw._scrubClaim&&
         (vmCountry||(!vmCulture&&!vmFaith&&!vmLanguage&&!vmAncestry&&!vmSociety&&!vmPrices&&!vmLoyalty&&!vmPopulation&&!vmTechnique&&!vmTileCoin))){
        const wa=psw._warArrows,tw=psw.tw;
        octx.lineJoin="round";octx.lineCap="round";
        for(let i=0;i<wa.length;i+=4){
          const ax=wa[i]*TR,ay=dataYtoScreenY(wa[i+1]*TR,H,CH);
          const bx=wa[i+2]*TR,by=dataYtoScreenY(wa[i+3]*TR,H,CH);
          if(Math.abs(bx-ax)>(tw/2)*TR)continue;   // wrap-seam pair — skip the cross-map streak
          const mx=(ax+bx)/2,my2=(ay+by)/2;
          const dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy)||1;
          const ux=dx/len,uy=dy/len;
          const tail=1.15*TR,hw=0.55*TR;
          const x0=mx-ux*tail,y0=my2-uy*tail,x1=mx+ux*tail,y1=my2+uy*tail;
          // dark under-stroke, then the red blade — reads on any terrain
          octx.strokeStyle="rgba(30,8,6,0.85)";octx.lineWidth=2.1*uiF;
          octx.beginPath();octx.moveTo(x0,y0);octx.lineTo(x1,y1);octx.stroke();
          octx.strokeStyle="rgba(212,44,32,0.95)";octx.lineWidth=1.1*uiF;
          octx.beginPath();octx.moveTo(x0,y0);octx.lineTo(x1,y1);octx.stroke();
          octx.fillStyle="rgba(212,44,32,0.95)";
          octx.beginPath();octx.moveTo(x1+ux*hw*0.9,y1+uy*hw*0.9);
          octx.lineTo(x1-ux*hw*1.4-uy*hw,y1-uy*hw*1.4+ux*hw);
          octx.lineTo(x1-ux*hw*1.4+uy*hw,y1-uy*hw*1.4-ux*hw);
          octx.closePath();octx.fill();
        }
      }
      // Roads — thickness + alpha from current flow, weight from SURFACE
      // quality: an engineered road (quality ≤ QUALITY_NEW 0.25) draws as a
      // full warm line; a path or hard-packed track (TRACK_FLOOR 0.30 and
      // above) draws thinner and fainter — the map shows kin paths becoming
      // trunk tracks becoming paved viae as the world actually earns them.
      // A pre-engineering surface is a DESIRE LINE: it exists where feet and
      // hooves actually pass, so a track carrying no meaningful traffic
      // (flow below ~a sustained trade trickle) is not drawn at all — no
      // phantom long lines between towns that never trade, no ghost paths
      // lingering through their multi-thousand-tick abandonment decay. A
      // built (engineered) road always draws: masonry persists.
      if(L.roads&&!vmCulture&&!vmFaith&&!vmLanguage&&!vmAncestry&&!vmSociety&&psw.roadQuality&&psw.roadFlow){
        const rq=psw.roadQuality,rf=psw.roadFlow,FLOW_FULL=50,TRACK_SHOW_FLOW=0.5;
        for(let ti=0;ti<rq.length;ti++){
          if(rq[ti]>=1.0)continue;
          const track=rq[ti]>0.28;   // between QUALITY_NEW 0.25 (engineered) and TRACK_FLOOR 0.30 — float32-safe band edge
          const flow=rf[ti]||0;
          if(track&&flow<TRACK_SHOW_FLOW)continue;
          const py=(ti/psw.tw)|0,px=ti-py*psw.tw;
          const sx=px*TR,sy=dataYtoScreenY(py*TR,H,CH);
          const intensity=Math.min(1,flow/FLOW_FULL);
          const w=((track?0.9:1.4)+intensity*1.6)*uiF,off=(TR-w)*0.5;
          octx.fillStyle=`rgba(120,80,40,${((track?0.30:0.55)+intensity*0.35).toFixed(2)})`;
          octx.fillRect(sx+off,sy+off,w,w);
        }
      }
      // ── Crisp coasts on a coarse overlay ── the political overlay is drawn at the HALF-res sim
      // grid (TILE_RES=2 → 2×2-pixel blocks), so a coastal block spills over ocean at full map
      // resolution. Clip the whole overlay to a FULL-resolution land mask (destination-in keeps
      // overlay pixels only where the world is land): the interior stays coarse/blocky, but the
      // coastline follows the map-resolution coast exactly — no political colour over the sea.
      {
        const mKey=(w._seed)+'|'+CW+'|'+CH+'|'+(_mercator?'m':'f');
        if(landMaskKey.current!==mKey||!landMaskRef.current){
          let mc=landMaskRef.current||(landMaskRef.current=document.createElement('canvas'));
          if(mc.width!==CW||mc.height!==CH){mc.width=CW;mc.height=CH;}
          const mctx=mc.getContext('2d');const mi=mctx.createImageData(CW,CH),md=mi.data,el=w.elevation;
          for(let cy=0;cy<CH;cy++){const sy=Math.min(H-1,Math.round(screenYtoDataY(cy,CH,H)))*W;
            for(let cx=0;cx<CW;cx++){if(el[sy+Math.min(W-1,cx)]>0)md[(cy*CW+cx)*4+3]=255;}}
          mctx.putImageData(mi,0,0);landMaskKey.current=mKey;
        }
        // The mask is at MAP resolution (elevation grid); the octx _k scale upsamples it onto the
        // FEAT overlay. Nearest-neighbour (smoothing off) keeps a hard 0/255 alpha edge so coasts
        // stay crisp at map resolution with no semi-transparent tint halo bleeding over the sea.
        const prevOp=octx.globalCompositeOperation, prevSm=octx.imageSmoothingEnabled;
        octx.globalCompositeOperation='destination-in';
        octx.imageSmoothingEnabled=false;
        octx.drawImage(landMaskRef.current,0,0);
        octx.globalCompositeOperation=prevOp;octx.imageSmoothingEnabled=prevSm;
      }
      // ── Political TINTS → MAP resolution ──────────────────────────────────────────────
      // stint holds one colour per sim tile — exactly the tiles the sim CLAIMS. The sim runs on a
      // COARSER grid than the map (each sim tile spans tileRes² map pixels), so the blocky claim
      // and the fine map coastline don't line up: a nation sitting AT the coast can have its shore
      // fall in the next sim tile over — a mostly-ocean coastal tile the sim never claimed — leaving
      // a bare sub-tile strip between the claim and the true coast. Close JUST that quantization gap
      // by dilating the claim outward over LAND, bounded to GAP_TILES sim tiles (≈ the sim→map tile
      // size — the widest the gap can be). This is NOT a fill-to-ocean flood: genuinely-unclaimed
      // frontier (many tiles from any claim) stays bare terrain; only the coastal seam is bridged.
      // Then upscale NEAREST and clip to the coast so the bridged tint stops exactly at the shore.
      {
        const N2=_tw*_th, sd=stctx.getImageData(0,0,_tw,_th), sp=sd.data;
        const el=w.elevation,_TR=psw.tileRes;
        // Classify each sim tile against the fine map grid it covers: does its tileRes² footprint
        // hold any LAND, and is it ALL land? A tile with land but also some ocean is a COASTAL tile —
        // the only place the coarse sim grid and the fine coastline disagree. Precompute once over
        // the elevation grid; the BFS below reads it O(1).
        const tileLand=new Uint8Array(N2), tileCoast=new Uint8Array(N2);
        for(let ty=0;ty<_th;ty++)for(let tx=0;tx<_tw;tx++){
          let land=0,sea=0;
          for(let dy=0;dy<_TR;dy++){const my=Math.min(H-1,ty*_TR+dy)*W;
            for(let dx=0;dx<_TR;dx++){if(el[my+Math.min(W-1,tx*_TR+dx)]>0)land=1;else sea=1;}}
          const i=ty*_tw+tx;tileLand[i]=land;tileCoast[i]=land&&sea?1:0;
        }
        // Close ONLY the coast quantization gap: dilate the claim into adjacent UNCLAIMED COASTAL
        // tiles (the mostly-ocean shore tiles the sim skipped), bounded to GAP_TILES sim tiles. It
        // never enters a fully-land tile, so genuinely-unclaimed INTERIOR frontier is untouched —
        // no ballooning, no fattened inland borders — only the blocky shore is pulled out to meet
        // the true coastline (the coast clip then trims each tile's ocean half). Bound is in sim
        // tiles, so it self-calibrates: a coarser sim needs the same 1–2 tiles to span its gap.
        const GAP_TILES=2;
        const owner=new Int32Array(N2).fill(-1), dist=new Int32Array(N2), q=new Int32Array(N2);
        let head=0,tail=0;
        for(let i=0;i<N2;i++)if(sp[i*4+3]>0){owner[i]=i;q[tail++]=i;}   // seed from every claimed tile
        while(head<tail){const i=q[head++];if(dist[i]>=GAP_TILES)continue;const y=(i/_tw)|0,x=i-y*_tw;
          const nb=[y>0?i-_tw:-1,y<_th-1?i+_tw:-1,x>0?i-1:-1,x<_tw-1?i+1:-1];
          for(let n=0;n<4;n++){const j=nb[n];if(j<0||owner[j]>=0)continue;
            if(tileCoast[j]!==1)continue;   // fill only coastal seam tiles, never interior frontier
            owner[j]=owner[i];dist[j]=dist[i]+1;q[tail++]=j;}}
        for(let i=0;i<N2;i++)if(owner[i]>=0&&sp[i*4+3]===0){const s=owner[i]*4;sp[i*4]=sp[s];sp[i*4+1]=sp[s+1];sp[i*4+2]=sp[s+2];sp[i*4+3]=sp[s+3];}
        stctx.putImageData(sd,0,0);
        let mt=psTintRef.current;
        if(!mt||mt.width!==CW||mt.height!==CH){mt=psTintRef.current=document.createElement('canvas');mt.width=CW;mt.height=CH;}
        const mtx=mt.getContext('2d');mtx.setTransform(1,0,0,1,0,0);mtx.clearRect(0,0,CW,CH);
        mtx.imageSmoothingEnabled=false;mtx.drawImage(stint,0,0,_tw,_th,0,0,CW,CH);   // nearest upscale → crisp
        mtx.globalCompositeOperation='destination-in';mtx.drawImage(landMaskRef.current,0,0);mtx.globalCompositeOperation='source-over';
      }
      meta.step=stepNow;meta.ch=CH;
    }
    // Map-resolution political tints go on the MAP canvas, over terrain (ctx carries the pan/zoom;
    // smoothing already off ⇒ crisp). Then the FEAT-resolution borders/roads blit onto the feature
    // canvas above them, and icons on top. Cached tint layer (rebuilt with the overlay).
    if(psTintRef.current)ctx.drawImage(psTintRef.current,0,0);
    if(fctx)fctx.drawImage(ov,0,0);
    else ctx.drawImage(ov,0,0,FEAT_W,FEAT_H,0,0,CW,CH);
    // ── Settlement glyphs ──
    // Compact single-glyph per settlement, much smaller than the old
    // building-cluster sprite. Tier picks the SHAPE (village=dot,
    // town=square, city=diamond, metropolis=larger diamond), the FILL is
    // wealth-tinted, and overlay marks layer on top to communicate:
    //   – garrison size (armoured outline)
    //   – active shock (red plague / amber famine outline)
    //   – capital (gold star above — kept from old code)
    //   – provincial seat (small ring above — kept)
    //   – selection (gold halo)
    // Sizing scales with √log(pop) so a metropolis is visibly bigger than a
    // hamlet, but the dynamic range is small — the visual distinction comes
    // from SHAPE + COLOUR + DECORATION, not raw size.
    // Icons live in canvas-pixel coordinates inside the view transform, so
    // they grow with zoom naturally (a metropolis at 8x zoom IS 8x bigger,
    // because that's the point of zooming in — more detail). iconScale is
    // kept as a knob for fine-tuning but stays at 1 here so the visible
    // size scales 1:1 with the user's zoom level.
    const iconScale=uiF;
    // Pop → "weight" 0..1 (log scale across the population range).
    let _popMax=1;
    for(const s of psw.settlements){if(s&&s.mode==="settled"&&s.people>_popMax)_popMax=s.people;}
    const _logMax=Math.log(Math.max(2,_popMax));
    const popWeight=p=>Math.max(0,Math.min(1,Math.log(Math.max(1,p))/_logMax));
    const selId=selectedSettlementIdRef.current;
    const capitalIds=new Set();
    if(psw.countries)for(const c of psw.countries.values())if(c.capital)capitalIds.add(c.capital.id);
    // Tier sizes (canvas pixels at zoom=1) — village dot, town square, city
    // diamond, metropolis bigger diamond.
    const tierBaseSize=[1.6,2.4,3.4,4.6];
    // Per-tier visibility (Layers panel). When all tiers are off the loop
    // does nothing — same as turning icons off entirely.
    const _L=layersRef.current;
    const _identity=vmCulture||vmFaith||vmLanguage||vmAncestry||vmSociety;
    // Identity overlays (peoples/faiths/languages) show WHOLE filled regions —
    // drop the village/town dot-speckle so the areas read clean; keep only the
    // major cities/metropolises as landmarks.
    const tierShow=_identity
      ?[false,false,_L.icons&&_L.city,_L.icons&&_L.metropolis]
      :[_L.icons&&_L.village,_L.icons&&(_L.town??_L.city),_L.icons&&_L.city,_L.icons&&_L.metropolis];
    // Glyphs render on the fixed-resolution feature canvas too (crisp, constant size at every map
    // scale). fctx's transform is the map's pan/zoom scaled by _k, so the map-canvas coordinates and
    // *iconScale sizes below are reused verbatim; `ctx` is shadowed to the feature context for the
    // loop only, leaving the sea-lanes/ships (which live over open water, under the transparent
    // overlay) on the map canvas below. Falls back to the map ctx when the feature layer is absent.
    const _ictx=fctx||ctx;
    if(fctx)fctx.setTransform(viewZRef.current*_k,0,0,viewZRef.current*_k,viewXRef.current*_k,viewYRef.current*_k);
    { const ctx=_ictx;
    for(const s of psw.settlements){
      if(!s||s.mode!=="settled")continue;
      if(!tierShow[s.tier|0])continue;
      const sx=s.pos.x*TR;
      const sy=dataYtoScreenY(s.pos.y*TR,H,CH);
      const tier=s.tier|0;
      const pw=popWeight(s.people);
      // Size: base by tier + small √pop boost within tier, scaled for zoom.
      const r=(tierBaseSize[tier]||2)*(0.85+pw*0.35)*iconScale;
      // Selection halo — bright gold ring behind the glyph.
      if(s.id===selId){
        ctx.beginPath();ctx.arc(sx,sy,r+3*iconScale,0,Math.PI*2);
        ctx.fillStyle="rgba(255,215,90,0.28)";ctx.fill();
        ctx.lineWidth=1.2*iconScale;ctx.strokeStyle="rgba(255,200,70,1)";ctx.stroke();
      }
      // Wealth-per-capita drives fill brightness (poor = dark earth, rich
      // = warm cream); kept in a narrow range so country tints still read.
      const wpc=(s.wealth||0)/Math.max(1,s.people);
      const richT=Math.min(1,wpc/80);
      const fr=Math.round(95+richT*105), fg=Math.round(75+richT*95), fb=Math.round(55+richT*55);
      ctx.fillStyle=`rgb(${fr},${fg},${fb})`;
      ctx.strokeStyle="rgba(20,15,5,0.95)";
      ctx.lineWidth=0.7*iconScale;
      // Tier glyph
      if(tier===0){          // farming region — dot
        ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      }else{                 // city / metropolis — diamond (tiers 1-3 are all "cities")
        ctx.beginPath();ctx.moveTo(sx,sy-r);ctx.lineTo(sx+r,sy);ctx.lineTo(sx,sy+r);ctx.lineTo(sx-r,sy);ctx.closePath();
        ctx.fill();ctx.stroke();
        // Metropolis gets a second concentric diamond for visual weight.
        if(tier>=3){
          const r2=r*0.5;
          ctx.beginPath();ctx.moveTo(sx,sy-r2);ctx.lineTo(sx+r2,sy);ctx.lineTo(sx,sy+r2);ctx.lineTo(sx-r2,sy);ctx.closePath();
          ctx.strokeStyle="rgba(40,30,10,0.8)";ctx.lineWidth=0.6*iconScale;ctx.stroke();
        }
      }
      // GARRISON ring — a settlement with an army > 5% of pop gets a thin
      // armoured outline; saturates at 15%. Lets defended towns be read
      // at a glance even when their tier glyph is small.
      const armyFrac=(s.army||0)/Math.max(1,s.people);
      if(armyFrac>0.05){
        const t=Math.min(1,(armyFrac-0.05)/0.10);
        ctx.beginPath();ctx.arc(sx,sy,r+1.4*iconScale,0,Math.PI*2);
        ctx.strokeStyle=`rgba(80,60,30,${0.5+t*0.4})`;ctx.lineWidth=(0.8+t*0.9)*iconScale;ctx.stroke();
      }
      // ACTIVE SHOCK ring — plague (purple) or famine (amber). Overrides the
      // garrison ring colour because a struck town is the more urgent signal.
      const shock=_L.shocks?(s._shock||0):0;
      if(shock){
        ctx.beginPath();ctx.arc(sx,sy,r+2.2*iconScale,0,Math.PI*2);
        ctx.strokeStyle=shock===2?"rgba(190,80,210,0.9)":"rgba(245,170,40,0.9)";
        ctx.lineWidth=1.3*iconScale;ctx.stroke();
      }
      // ── War marks (Layers → Sieges & sacks) ──
      // UNDER SIEGE: a red X struck across the glyph — an enemy camp stands at
      // these walls right now (the granary is draining; the storm may come).
      if(_L.sieges&&s._besieged){
        const xr=r+1.3*iconScale;
        ctx.lineCap="round";
        ctx.strokeStyle="rgba(25,6,4,0.9)";ctx.lineWidth=2.0*iconScale;
        ctx.beginPath();ctx.moveTo(sx-xr,sy-xr);ctx.lineTo(sx+xr,sy+xr);
        ctx.moveTo(sx+xr,sy-xr);ctx.lineTo(sx-xr,sy+xr);ctx.stroke();
        ctx.strokeStyle="rgba(224,42,30,0.95)";ctx.lineWidth=1.0*iconScale;
        ctx.beginPath();ctx.moveTo(sx-xr,sy-xr);ctx.lineTo(sx+xr,sy+xr);
        ctx.moveTo(sx+xr,sy-xr);ctx.lineTo(sx-xr,sy+xr);ctx.stroke();
        ctx.lineCap="butt";
      }
      // SACKED: an expanding, fading ember ring — the city just fell to storm.
      if(_L.sieges&&s._sackedAge!=null){
        const t=Math.min(1,s._sackedAge/500);
        ctx.beginPath();ctx.arc(sx,sy,r+(2.5+8*t)*iconScale,0,Math.PI*2);
        ctx.strokeStyle=`rgba(232,96,24,${(0.8*(1-t)).toFixed(3)})`;
        ctx.lineWidth=1.5*iconScale*(1-0.5*t);ctx.stroke();
      }
      // Adjust below rank-marker offset for the new (smaller) icon.
      const _markerR=r;
      // ── Rank marker ── a gold star above national capitals, a small open
      // ring above provincial seats (settlements that have vassals). Lets
      // the administrative hierarchy be read at a glance over the country
      // tint: stars = kingdoms' seats, rings = the regional centres beneath.
      if(capitalIds.has(s.id)){
        const my=sy-_markerR-3*iconScale;
        const starOuter=3.2*iconScale,starInner=1.4*iconScale;
        ctx.fillStyle="rgba(255,210,70,0.95)";ctx.strokeStyle="rgba(60,40,0,0.9)";ctx.lineWidth=0.6*iconScale;
        ctx.beginPath();
        for(let p=0;p<10;p++){const ang=-Math.PI/2+p*Math.PI/5;const rr=(p%2===0)?starOuter:starInner;
          const px=sx+Math.cos(ang)*rr,py=my+Math.sin(ang)*rr;p===0?ctx.moveTo(px,py):ctx.lineTo(px,py);}
        ctx.closePath();ctx.fill();ctx.stroke();
      }else if((s._vassalCount||0)>0){
        const my=sy-_markerR-2.5*iconScale;
        ctx.beginPath();ctx.arc(sx,my,1.9*iconScale,0,Math.PI*2);
        ctx.fillStyle="rgba(255,235,180,0.85)";ctx.fill();
        ctx.lineWidth=0.7*iconScale;ctx.strokeStyle="rgba(90,60,10,0.9)";ctx.stroke();
      }
    }
    }
    // ── Names on the map (plan §5.1) + heraldry (§5.2) ──
    // Realm names anchor at the claimed-territory centre (cached until a new
    // claim grid arrives); settlement names are tier-gated by zoom. Drawn
    // screen-space on the feature canvas so type renders crisp at any map
    // scale. Skipped on the identity/thematic lenses, where political names
    // over a faith/culture/price fill would mislabel what the colours mean.
    if(fctx&&_L.labels&&!_identity&&!vmLoyalty&&!vmPopulation&&!vmTechnique&&!vmTileCoin&&!vmPrices){
      labelAnchorsRef.current=realmLabelAnchors(psw,labelAnchorsRef.current);
      // Physical floor: on a small display the map-unit sizes drop below
      // legibility at world zoom; floor them at ~7 CSS px and let collision
      // thin the crowd (few names far out, all of them as you pinch in).
      // No-op on desktop, where map-unit sizes already exceed the floor.
      const _cssW=canvasRef.current?canvasRef.current.getBoundingClientRect().width:FEAT_W;
      const _minFs=7*(FEAT_W/Math.max(1,_cssW));
      const _seed=worldRef.current?worldRef.current.seed:0;
      const _emblemFor=_L.emblems?(id)=>{
        const c=psw.countries&&psw.countries.get(id);
        return c?realmEmblemImg(psw,c,ter,_seed):null;
      }:null;
      drawMapLabels(fctx,psw,labelAnchorsRef.current,
        {z:viewZRef.current,vx:viewXRef.current,vy:viewYRef.current,k:_k},
        {TR,toScreenY:(y)=>dataYtoScreenY(y,H,CH)},
        {showRealms:true,showSettlements:_L.icons,capitalIds,
         emblemFor:_emblemFor,selRealm:selRealmRef.current,
         selSettlement:selId,featW:FEAT_W,featH:FEAT_H,minFs:_minFs});
      if(fctx)fctx.setTransform(viewZRef.current*_k,0,0,viewZRef.current*_k,viewXRef.current*_k,viewYRef.current*_k);
    }
  }
  // ── Sea lanes ── faint dashed routes over open water connecting the
  // ports that trade by ship (sea.js). Drawn in every view except the
  // land-roads view, beneath the moving ships and armies.
  if(psw&&ctx&&!vmRoads&&psw._seaLanes&&psw._seaLanes.length&&layersRef.current.seaLanes){
    const TR=psw.tileRes,tw=psw.tw;
    ctx.save();
    ctx.strokeStyle="rgba(90,175,225,0.28)";
    ctx.lineWidth=0.8;
    ctx.setLineDash([3,3]);
    for(const lane of psw._seaLanes){
      const pts=lane.tiles;if(!pts||pts.length<2)continue;
      let started=false,px=0;
      for(let k=0;k<pts.length;k++){
        const ti=pts[k],ty=(ti/tw)|0,tx=ti-ty*tw;
        const X=(tx+0.5)*TR,Y=dataYtoScreenY((ty+0.5)*TR,H,CH);
        if(started&&Math.abs(X-px)>CW*0.5){ctx.stroke();started=false;}
        if(!started){ctx.beginPath();ctx.moveTo(X,Y);started=true;}else ctx.lineTo(X,Y);
        px=X;
      }
      if(started)ctx.stroke();
    }
    ctx.restore();
  }
  // ── Colony ships ── diamonds in the founding country's colour sailing
  // toward the shore they'll settle, with a faint line to that
  // destination. Drawn in every view (like armies).
  if(psw&&ctx&&psw.ships&&psw.ships.length&&layersRef.current.ships){
    const TR=psw.tileRes,tw=psw.tw;
    for(const sh of psw.ships){
      const sxp=sh.x*TR,syp=dataYtoScreenY(sh.y*TR,H,CH);
      const lt=sh.landTi,ly=(lt/tw)|0,lx=lt-ly*tw;
      const dxs=(lx+0.5)*TR,dys=dataYtoScreenY((ly+0.5)*TR,H,CH);
      if(Math.abs(dxs-sxp)<CW*0.5){
        ctx.strokeStyle="rgba(60,150,210,0.55)";ctx.lineWidth=0.7;
        ctx.beginPath();ctx.moveTo(sxp,syp);ctx.lineTo(dxs,dys);ctx.stroke();
      }
      const hue=((sh.countryId*61)%360+360)%360;
      ctx.save();ctx.translate(sxp,syp);ctx.rotate(Math.PI/4);
      ctx.fillStyle=`hsl(${hue},75%,55%)`;
      ctx.fillRect(-2.6,-2.6,5.2,5.2);
      ctx.lineWidth=1;ctx.strokeStyle="rgba(0,20,40,0.9)";ctx.strokeRect(-2.6,-2.6,5.2,5.2);
      ctx.restore();
    }
  }
}
},[updateTerrainCache,buildAtlas,CH]);

// Apply a snapshot from the sim worker into the mirror (peopleRef.current),
// shaped like the real world so draw()/the card read it unchanged, then draw.
const applySnapshot=useCallback((snap)=>{
  let psw=peopleRef.current;
  if(!psw||!psw._isMirror){psw=peopleRef.current={_isMirror:true};}
  psw.step=snap.step;psw.tw=snap.tw;psw.th=snap.th;psw.tileRes=snap.tileRes;psw.N=snap.N;
  // REACT PULSE ≤4Hz: the mirror/canvas consume every snapshot (refs, above
  // and below), but the React tree — panels, buttons, readouts — re-renders
  // only on this gated pulse. At 30 renders/s the whole codex re-diffed per
  // sim tick and every button felt sticky; at 4Hz the numbers still read as
  // live and clicks land between renders. Paused worlds pulse immediately so
  // selection/detail refreshes feel instant.
  let _pulsed=false;
  {const _now=performance.now();
   if(!playRef.current||_now-(uiPulseRef.current||0)>=250){uiPulseRef.current=_now;_pulsed=true;setLiveStep(snap.step);}}
  if(snap.eraAt)psw._eraAt=snap.eraAt;   // display-calendar timeline
  psw.globalP=snap.globalP;
  // Buffer-return pool (the 26.6k allocation wall — see the worker's pool note):
  // each slot swap below strands the DISPLACED array; nothing on this thread
  // holds it past the swap (draw() reads live refs; its caches key on versions
  // and hold canvases, never these arrays), so hand its buffer back to the
  // worker for the next snapshot instead of leaving multi-MB garbage 30×/sec.
  const _ret=[];
  const _drop=(old)=>{if(old&&old.buffer&&old.buffer.byteLength)_ret.push(old.buffer);};
  if(snap.owner){_drop(psw._territoryOwner);psw._territoryOwner=snap.owner;}
  if(snap.roadQuality){_drop(psw.roadQuality);psw.roadQuality=snap.roadQuality;}
  if(snap.roadFlow){_drop(psw.roadFlow);psw.roadFlow=snap.roadFlow;}
  if(snap.tileComp){_drop(psw._tileComp);psw._tileComp=snap.tileComp;}   // network-component map (roads view); keep last
  psw._tileCompSeen=undefined;                     // mirror's tileComp is already clean (-1 = none)
  if(snap.countryClaim){_drop(psw._countryClaim);psw._countryClaim=snap.countryClaim;if(!scrubRef.current)psw._claimVer=(psw._claimVer||0)+1;}  // national claim per tile; keep last (ver bumps only live so the scrubbed layer's caches hold)
  if(snap.timelineN!==undefined)psw._timelineN=snap.timelineN;
  if(snap.fastEpoch!==undefined)setFastEpoch(!!snap.fastEpoch);
  if(snap.quietAges!==undefined)setQuietAges(!!snap.quietAges);
  if(_pulsed&&snap.settTrace)setSettTrace(snap.settTrace);
  if(snap.landNations)psw._landNames=new Map(snap.landNations.map(r=>[r.id,r]));  // nations of the land: id → {ti,name} (static cadence; [] clears when the last one materialises)
  if(snap.wars)psw._wars=snap.wars;                 // active war pairs [att,def,...] (static cadence; [] clears at peace)
  if(snap.warArrows)psw._warArrows=snap.warArrows;  // aggressor→defender border arrows (small — GC'd, not pooled)
  // Per-tile identity field for the active people/faith/language lens. Sent only
  // on the static cadence and only while an identity lens is up; keyed by the
  // layer it was built for, so a stale field from a previous lens is ignored.
  if(snap.fieldDom){_drop(psw._fieldDom);_drop(psw._fieldSec);psw._fieldDom=snap.fieldDom;psw._fieldSec=snap.fieldSec;psw._fieldLayer=snap.fieldLayer;}
  if(snap.loyal){_drop(psw._loyal);_drop(psw._loyalHome);psw._loyal=snap.loyal;psw._loyalHome=snap.loyalHome||null;}   // loyalty lens: attachment heat + remembered nation (keep last)
  if(snap.popDens){_drop(psw._popDens);psw._popDens=snap.popDens;psw._popMax=snap.popMax||0;}      // population lens: log-packed people-on-land (keep last)
  if(snap.devDens){_drop(psw._devDens);psw._devDens=snap.devDens;}                                 // technique lens: the idea field (absolute 0..1 ruler ×250)
  if(snap.tileCoinMax!=null)psw._tileCoinMax=snap.tileCoinMax;
  if(snap.tileCoinDens){_drop(psw._tileCoinDens);psw._tileCoinDens=snap.tileCoinDens;}   // coin field: farm-gate coin on tiles
  psw._moneyFlows=snap.moneyFlows||null;           // animated coin flows (money view)
  psw._goodsFlows=snap.goodsFlows||null;           // animated cargo flows (goods-flow view)
  if(snap.seaLanes)psw._seaLanes=snap.seaLanes;   // null between static sends → keep last
  if(snap.cultures){const cm=new Map();for(const c of snap.cultures)cm.set(c.id,c);psw.cultures=cm;}
  if(snap.faiths){const fm=new Map();for(const f of snap.faiths)fm.set(f.id,f);psw.faiths=fm;}
  if(snap.languages){const lm=new Map();for(const l of snap.languages)lm.set(l.id,l);psw.languages=lm;}
  psw.ships=snap.ships;
  if(snap.chronicle!==undefined)psw._chronicle=snap.chronicle;   // full realm history; undefined = unchanged (keep), null = cleared
  if(snap.dynasty!==undefined)psw._dynasty=snap.dynasty;         // ruling family tree (only while the overlay is open)
  if(snap.feed&&snap.feed.length){const F=psw._feed||(psw._feed=[]);F.push(...snap.feed);if(F.length>250)F.splice(0,F.length-250);}
  const setts=snap.settlements||[];
  if(snap.selected){const sel=setts.find(x=>x.id===snap.selected.id);if(sel)Object.assign(sel,snap.selected);}
  psw.settlements=setts;
  const byId=new Map();for(const s of setts)byId.set(s.id,s);psw._byId=byId;
  const countries=new Map();
  for(const c of (snap.countries||[])){
    const members=c.memberIds.map(id=>byId.get(id)).filter(Boolean);
    const capital=byId.get(c.capitalId)||members[0]||null;
    countries.set(c.id,{id:c.id,members,capital,capitalId:c.capitalId,name:c.name,ruler:c.ruler,faithId:c.faithId,hue:c.hue,range:c.range,_capacity:c._capacity,_loadTotal:c._loadTotal,_momentum:c._momentum,_fronts:c._fronts,_capitalBesieged:c._capitalBesieged,_treasury:c._treasury,_govRevenue:c._govRevenue,_govSpend:c._govSpend,_solvency:c._solvency,_taxRate:c._taxRate,_priceLevel:c._priceLevel,personality:c.personality,_overlord:c._overlord,_depKind:c._depKind,_nomadic:c._nomadic});
  }
  psw.countries=countries;
  // HUD state updates re-render the whole component, so throttle them to ~5Hz
  // (the sim numbers don't need 30Hz); drawing still happens every snapshot.
  psw._snapN=(psw._snapN||0)+1;
  if(_pulsed&&snap.stats)setPsStats(snap.stats);
  // History sample for the charts/export (gated by sim-step, reset on new run).
  if(snap.stats){
    const H=psHistoryRef.current, st=snap.step, last=H[H.length-1];
    if(last&&st<last.step)H.length=0;                       // step jumped back → new world
    if(!H.length||st-H[H.length-1].step>=HISTORY_INTERVAL){
      const x=snap.stats;
      H.push({step:st,pop:x.totalPeople||0,gold:x.totalWealth||0,landPct:x.landPct||0,
              countries:x.countries||0,sett:x.settlements||0,villages:x.villages||0,
              towns:x.towns||0,cities:x.cities||0,metros:x.metropolises||0,
              largest:x.largestEmpire||0,army:x.totalArmy||0});
      if(H.length>5000)H.splice(0,H.length-5000);
    }
  }
  // Hand the displaced buffers home (transfer detaches them here — they are
  // already unreachable above). A failed post just leaves them to the GC.
  if(_ret.length&&simWorkerRef.current){try{simWorkerRef.current.postMessage({type:'bufret',bufs:_ret},_ret);}catch(e){/* fall back to GC */}}
  if(terRef.current){try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);}}
},[draw]);
useEffect(()=>{applySnapshotRef.current=applySnapshot;},[applySnapshot]);
useEffect(()=>{drawNowRef.current=()=>{if(terRef.current){try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message);}}};},[draw]);

// Forward play/pause + speed to the sim worker.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'control',playing,speed,autoEpoch});},[playing,speed,autoEpoch]);
// Tell the worker when the tab/window is hidden so it can keep pacing without
// setTimeout throttling (and skip painting snapshots nobody will see).
useEffect(()=>{
  const tell=()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'visibility',hidden:document.hidden});};
  tell();
  document.addEventListener('visibilitychange',tell);
  return()=>document.removeEventListener('visibilitychange',tell);
},[world]);
// Forward selection so the worker includes that settlement's full detail.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'select',id:selectedSettlementId});},[selectedSettlementId]);
// Close the per-realm overlays when the selection changes, so they don't
// auto-reopen (or show a stale realm) the next time a settlement is picked.
useEffect(()=>{setChronicleOpen(false);setTechTreeOpen(false);setDynastyOpen(false);},[selectedSettlementId]);
// Tell the worker to start/stop shipping the ruling-house tree as the overlay opens/closes.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"dynasty-open",open:dynastyOpen});},[dynastyOpen]);
useEffect(()=>{if(selectedSettlementId>=0)setPanelTab("inspect");},[selectedSettlementId]);
// Tell the worker the current view so it ships money-flow / road-component extras only when shown.
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'view',view:viewMode});},[viewMode]);
const minKm2Ref=useRef(20000);minKm2Ref.current=minKm2;
useEffect(()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'mapFilter',minKm2});},[minKm2]);
// Terminate both workers on unmount so they don't leak across hot-reloads / route changes.
useEffect(()=>()=>{try{simWorkerRef.current?.terminate();}catch{}try{workerRef.current?.terminate();}catch{}},[]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;depthCeilRef.current=depthCeil;showPlatesRef.current=showPlates;showRiversRef.current=showRivers;showStreamsRef.current=showStreams;showLakesRef.current=showLakes;showGlobeRef.current=showGlobe;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,depthCeil,showPlates,showRivers,showStreams,showLakes,showGlobe,activeRes,activeGoods,layers,priceGood]);

// Opening the Ancestry lens replays the peopling of the world: the wavefront
// spreads from the East-African cradle outward over ~10s (animLoop drives it).
useEffect(()=>{if(viewMode==="ancestry"&&terRef.current&&terRef.current.tArrival)ancRevealRef.current={start:performance.now(),active:true};},[viewMode]);

useEffect(()=>{let fid,acc=0,last=performance.now(),drawSkip=0,iv=null;
// Drive one sim/draw slice. Used by rAF while the tab is visible, and by a
// setInterval fallback while hidden (rAF suspends entirely in background tabs,
// which froze the main-thread-fallback sim whenever the window lost focus).
const slice=now=>{
if(!terRef.current||!worldRef.current){last=now;return;}
// PAUSED, main-thread-fallback mode: the world is still — the UI must not be
// (owner report: every panel/overlay froze without ticks). Repaint + pulse
// React at 4Hz so info windows, overlays and the scrubber stay live.
if(!playRef.current){
  if(!simWorkerRef.current&&now-(pausedDrawRef.current||0)>=250){pausedDrawRef.current=now;
    if(peopleRef.current){setLiveStep(peopleRef.current.step);try{setPsStats(peopleSimStats(peopleRef.current));}catch{}}
    try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);}}
  last=now;return;}
// Worker mode: the sim runs off-thread and drives drawing via snapshots, so
// this loop does nothing. Only the main-thread FALLBACK steps + draws here.
if(simWorkerRef.current){last=now;return;}
// speed = target ticks/sec (mirrors the worker). Step however many ticks the
// elapsed real time earned, via a fractional accumulator, so the pace matches
// the chosen speed regardless of frame rate; the Max sentinel just runs a
// budgeted batch each frame.
// Hidden tabs: allow several seconds of catch-up (rAF/interval may wake rarely);
// the per-slice budget still caps work so returning to the tab doesn't freeze.
const dt=Math.min(document.hidden?5000:250,now-last);last=now;
const tps=speedRef.current;
let sub;
if(tps>=100000){sub=64;}else{acc+=dt/1000*tps;sub=Math.floor(acc);acc-=sub;}
if(sub>0){
// Time-budgeted sim: stop stepping if we've used the slice budget
const _simStart=performance.now();
const _budget=document.hidden?50:8;
let ran=0;
for(;ran<sub;ran++){
// Legacy tribe sim DISABLED — peopleSim is the new entity-based model.
// runTribeStep call removed at user request ("completely erase the tribe system").
// The `ter` object is still kept around so UI panels that read tribeCenters
// etc. don't crash, but it is no longer mutated each tick.
try{if(peopleRef.current){stepPeopleSim(peopleRef.current,1);
if(peopleRef.current.step-fbKeyRef.current>=CAPTURE_IVL){fbKeyRef.current=peopleRef.current.step;captureFrame(fbTimelineRef.current,peopleRef.current);}}}
catch(e){console.error('[PEOPLESIM CRASH]',e.message,e.stack);playRef.current=false;return;}
if(performance.now()-_simStart>_budget)break;
}
// Keep unspent ticks when the budget cuts short (mirrors the worker).
if(tps<100000)acc+=sub-ran;
if(peopleRef.current)setLiveStep(peopleRef.current.step);   // 30Hz step display
// peopleSim stats — drives the HUD instead of legacy tribe metrics.
if(peopleRef.current&&peopleRef.current.step%5===0){
  setPsStats(peopleSimStats(peopleRef.current));
}
// Only redraw every 3rd sim frame to save 10-30ms/frame on CPU canvas rendering
// (skip draws entirely while hidden — nobody is watching).
if(!document.hidden){drawSkip++;
if(drawSkip>=3){drawSkip=0;
try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);playRef.current=false;}}}}
};
const loop=now=>{fid=requestAnimationFrame(loop);slice(now);};
const arm=()=>{
  if(document.hidden&&!simWorkerRef.current){
    if(fid){cancelAnimationFrame(fid);fid=null;}
    if(!iv)iv=setInterval(()=>slice(performance.now()),33);
  }else{
    if(iv){clearInterval(iv);iv=null;}
    if(!fid){last=performance.now();fid=requestAnimationFrame(loop);}
  }
};
arm();
document.addEventListener('visibilitychange',arm);
return()=>{cancelAnimationFrame(fid);if(iv)clearInterval(iv);document.removeEventListener('visibilitychange',arm);};
},[draw]);

// Animation loop for the views with per-frame motion (wind particle streaks,
// money-flow coins) — one shared rAF instead of one per view; it no-ops on
// every other view, and keeps animating while the sim is paused (so a frozen
// economy can still be studied).
useEffect(()=>{let afid;
const animLoop=()=>{afid=requestAnimationFrame(animLoop);
const v=viewRef.current;if(!worldRef.current||!terRef.current)return;
const ancA=v==="ancestry"&&ancRevealRef.current.active;   // peopling spread still painting on
if(v!=="wind"&&v!=="money"&&v!=="goodsflow"&&!ancA)return;
draw(terRef.current);};
afid=requestAnimationFrame(animLoop);
return()=>cancelAnimationFrame(afid);},[draw]);

const togglePlay=()=>{const on=!playRef.current;
  if(on&&scrubRef.current){  // unpausing returns to the present — a scrubbed past never plays forward
    setScrubStep(null);setScrubShown(null);scrubRef.current=false;
    const psw=peopleRef.current;if(psw){psw._scrubClaim=null;psw._claimVer=(psw._claimVer||0)+1;}}
  playRef.current=on;setPlaying(on);};
const handleImport=useCallback(async(e)=>{const file=e.target.files?.[0];if(!file)return;
e.target.value="";
setImportStatus("Loading...");
try{let w;
if(file.name.endsWith(".json")||file.name.endsWith(".map")){
const text=await file.text();const parsed=parseAzgaarJSON(text);
w=rasterizeAzgaar(parsed,genW,genH);
setImportStatus(`Azgaar map loaded (${parsed.n} cells, ${parsed.stateSet.size} states)`);
}else if(file.type.startsWith("image/")){
const img=await loadImageFile(file);
w=rasterizeHeightmap(img.data,img.width,img.height,genW,genH);
setImportStatus(`Heightmap loaded (${img.width}\u00d7${img.height})`);
}else{setImportStatus("Unsupported file type");return;}
const swamp=new Uint8Array(genW*genH);
for(let y=0;y<genH;y++)for(let x=0;x<genW;x++){const i=y*genW+x;
if(w.elevation[i]>0&&w.elevation[i]<0.025&&w.moisture[i]>0.45&&w.temperature[i]>0.35){
const nv=fbm(x/genW*20+300,y/genH*20+300,2,2,.5);if(nv>-0.1)swamp[i]=1;}}
w.swamp=swamp;
importedWorldRef.current=w;presetRef.current="import";setPreset("import");
setSeed(Math.floor(Math.random()*999999));
setTimeout(()=>setImportStatus(null),4000);
}catch(err){setImportStatus("Import failed: "+err.message);setTimeout(()=>setImportStatus(null),5000);}
},[seed,genW,genH]);
// Screen → canvas-pixel-space (reversing the pan/zoom transform). Returns
// {sx,sy} in the same coordinate system the existing hit-testing already uses.
const screenToCanvas=useCallback((ev)=>{
  const c=canvasRef.current;if(!c)return null;
  const r=c.getBoundingClientRect();
  const rawX=(ev.clientX-r.left)/r.width*CW;
  const rawY=(ev.clientY-r.top)/r.height*CH;
  const z=viewZRef.current;
  return {sx:(rawX-viewXRef.current)/z, sy:(rawY-viewYRef.current)/z, rawX, rawY};
},[CW,CH]);
const onCanvasMove=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!worldRef.current)return;
// Pan dragging — any button. Only PAN if the mouse has crossed the
// click/drag threshold; once it has, mark it so the subsequent click is
// suppressed (drag-to-pan + plain-click-to-select on the same button).
if(panDragRef.current){
  const pd=panDragRef.current;
  const dx=ev.clientX-pd.mx,dy=ev.clientY-pd.my;
  if(!pd.moved&&Math.hypot(dx,dy)<=3)return;   // below threshold; wait
  pd.moved=true;
  viewXRef.current=pd.vx+dx*(CW/c.getBoundingClientRect().width);
  viewYRef.current=pd.vy+dy*(CH/c.getBoundingClientRect().height);
  if(terRef.current)draw(terRef.current);
  return;
}
const _sc=screenToCanvas(ev);if(!_sc)return;
const sx=_sc.sx,sy=_sc.sy;
const wx=Math.floor(sx)*RES,wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const w=worldRef.current,i=wy*W+wx;
if(wx<0||wx>=W||wy<0||wy>=H){setHoverInfo(null);return;}
const elev=w.elevation[i]||0;
const temp=w.temperature[i]||0;
const terTi=terRef.current?Math.min(terRef.current.th-1,(wy/RES)|0)*terRef.current.tw+Math.min(terRef.current.tw-1,(wx/RES)|0):-1;
const moist=terTi>=0&&terRef.current?terRef.current.tMoist[terTi]:(w.moisture[i]||0);
const isFlood=terTi>=0&&terRef.current&&terRef.current.tFlood?terRef.current.tFlood[terTi]===1:false;
const biome=getBiomeD(elev,moist,temp,0,isFlood,w.dryFrac?w.dryFrac[i]:0,w.summerDry?w.summerDry[i]:0);
const biomeName=BN[biome]||"Ocean";
const elevM=elev<=0?Math.round(elev*4000):Math.round(elev*8000);
const tempC=Math.round(temp*100-60);// range: -60°C to +40°C
const lat=Math.abs(wy/H-0.5)*2;
const fertVal=elev>0?(terTi>=0&&terRef.current?terRef.current.tFert[terTi]:tileFert(temp,moist,elev)):0;
const wdx=w.windX?w.windX[i]:0,wdy=w.windY?w.windY[i]:0;
const wspd=Math.sqrt(wdx*wdx+wdy*wdy);
const wkmh=Math.round(wspd*100); // normalized → km/h (median ~18 km/h)
// +Y is south in screen coords, so negate wdy for compass direction
// Direction = where the wind is blowing TO
const wdeg=((Math.atan2(-wdy,wdx)*180/Math.PI)+360)%360;
const wdir=["E","NE","N","NW","W","SW","S","SE"][Math.round(wdeg/45)%8];
// Throttle: hovering re-renders the WHOLE (large) component via setHoverInfo,
// so only push a new card when the cursor moved to a different tile or ~90ms
// passed (the card position still tracks smoothly at that rate).
const _hv=hoverThrottleRef.current;
const _now=performance.now();
if(_hv.ti===terTi&&_now-_hv.t<90){_hv.x=ev.clientX;_hv.y=ev.clientY;return;}
_hv.ti=terTi;_hv.t=_now;
// Resource info at this tile
const tileRes=terTi>=0&&terRef.current&&terRef.current.deposits?tileResourceSummary(terRef.current.deposits,terTi):[];
const riverMag=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.riverMag[terTi]:0;
const riverAccum=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.flowAccum[terTi]:0;
const isLake=terTi>=0&&terRef.current&&terRef.current.rivers&&terRef.current.rivers.lake?terRef.current.rivers.lake[terTi]>=0:false;
const lakeSize=isLake?terRef.current.rivers.lakeInfo[terRef.current.rivers.lake[terTi]].size:0;
// Who lives here / whose realm: territory owner + national claim at this tile,
// plus the nearest settlement (identity card) — same radius the click uses.
let hovOwner=null,hovRealm=null,hovRealmId=-1,hovSett=null;
{const psw=peopleRef.current;
 if(psw&&terTi>=0){
   if(psw._territoryOwner&&psw._byId){const oid=psw._territoryOwner[terTi];if(oid>=0){const o=psw._byId.get(oid);if(o)hovOwner=o.name;}}
   if(psw._countryClaim&&psw.countries){
     const tw2=psw.tw;const stx=Math.min(tw2-1,((wx/RES)|0)/psw.tileRes|0),sty=Math.min(psw.th-1,((wy/RES)|0)/psw.tileRes|0);
     const cc=(psw._scrubClaim||psw._countryClaim)[sty*tw2+stx];
     if(cc>=0){const c=psw.countries.get(cc);if(c){hovRealm=c.name||(c.capital&&c.capital.name);hovRealmId=cc;}
       else if(psw._landNames&&psw._landNames.has(cc)){hovRealm=psw._landNames.get(cc).name||"a people of the land";hovRealmId=cc;}}}
   {const psTx=((wx/RES)|0)/psw.tileRes,psTy=((wy/RES)|0)/psw.tileRes;
    let best=null,bestD2=36;
    for(const s of psw.settlements){
      if(!s||s.mode!=="settled")continue;
      let dx=Math.abs(s.pos.x-psTx);if(dx>psw.tw/2)dx=psw.tw-dx;
      const dy=s.pos.y-psTy,d2=dx*dx+dy*dy;
      if(d2<bestD2){bestD2=d2;best=s;}}
    if(best)hovSett={name:best.name,tier:best.tier|0,people:best.people||0,urbanPop:best._urbanPop,
      isCap:(psw.countries&&psw.countries.get(best.countryId)&&psw.countries.get(best.countryId).capitalId===best.id)||false};}
 }}
setHoverInfo({x:ev.clientX,y:ev.clientY,elevM,tempC,moist,biome:biomeName,fert:fertVal,lat,wspd,wdir,wkmh,resources:tileRes,river:riverMag,riverAccum,isLake,lakeSize,owner:hovOwner,realm:hovRealm,realmId:hovRealmId,sett:hovSett});
},[CW,CH]);
const onCanvasLeave=useCallback(()=>setHoverInfo(null),[]);
const onCanvasClick=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!terRef.current)return;
// If the mouse-down → up was actually a drag (moved past threshold), the
// onCanvasMove pass already set pd.moved=true and panned. Swallow the click
// in that case so dragging never accidentally selects.
if(panDragRef.current){
  const wasDrag=panDragRef.current.moved===true;
  panDragRef.current=null;
  if(wasDrag)return;
}
const _sc=screenToCanvas(ev);if(!_sc)return;
const sx=_sc.sx,sy=_sc.sy;
const wx=Math.floor(sx),wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const ter=terRef.current;if(!ter)return;
const ttx=Math.min(ter.tw-1,(wx/RES)|0),tty=Math.min(ter.th-1,(wy/RES)|0);
// peopleSim mode: find the closest settlement to the click. Match
// against the peopleSim tile-space (tw=960, half of canvas width).
const psw=peopleRef.current;
if(psw){
  const psTx=ttx/psw.tileRes,psTy=tty/psw.tileRes;
  // Country editor: an armed click DROPS a seed capital here instead of selecting.
  if(editorArmedRef.current&&simWorkerRef.current){
    const p=edParamsRef.current;
    simWorkerRef.current.postMessage({type:'editor.placeCountry',x:psTx,y:psTy,
      tier:p.tier,people:p.people,knowledge:p.knowledge,personality:p.personality});
    return;
  }
  let best=null,bestD2=Infinity;
  for(const s of psw.settlements){
    if(!s||s.mode!=="settled")continue;
    let dx=Math.abs(s.pos.x-psTx);
    if(dx>psw.tw/2)dx=psw.tw-dx;
    const dy=s.pos.y-psTy;
    const d2=dx*dx+dy*dy;
    if(d2<bestD2){bestD2=d2;best=s;}
  }
  // Pick within ~6 tile radius (handles small icons and slop).
  // Sync the ref BEFORE the immediate redraw (the effect that mirrors the
  // state into the ref runs after render, so the halo used to lag one frame).
  // Map jumps are codex navigation too — push the previous location so Back works.
  navStackRef.current.push({tab:panelTabRef.current,realm:selRealmRef.current,sett:selectedSettlementIdRef.current});
  if(navStackRef.current.length>48)navStackRef.current.shift();
  if(best&&bestD2<36){
    selectedSettlementIdRef.current=best.id;
    setSelectedSettlementId(best.id);
    // a settlement click retargets the chronicle to ITS realm
    selRealmRef.current=-1;setRealmSel(-1);
    if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:-1});
    setPanelTab("inspect");
    if(narrowRef.current)setCodexOpen(true);   // phone: selection opens the codex drawer
  }else{
    selectedSettlementIdRef.current=-1;
    setSelectedSettlementId(-1);
    // Unified selection (plan §5.3): a click on claimed ground selects the
    // REALM — highlight on the map, its page in the codex. Water or
    // wilderness deselects everything.
    let hitRealm=-1;
    if(psw._countryClaim){
      const tx=Math.max(0,Math.min(psw.tw-1,psTx|0)),ty=Math.max(0,Math.min(psw.th-1,psTy|0));
      hitRealm=psw._countryClaim[ty*psw.tw+tx];
      if(!(hitRealm>=0&&psw.countries&&psw.countries.get(hitRealm)))hitRealm=-1;
    }
    selRealmRef.current=hitRealm;setRealmSel(hitRealm);
    if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:hitRealm});
    if(hitRealm>=0){setPanelTab("realms");if(narrowRef.current)setCodexOpen(true);}
  }
  draw(ter);
}
},[CW,CH,draw,viewMode]);
// ── Pan / zoom mouse handlers ────────────────────────────────────────
// Wheel: zoom around the cursor (Google-Maps style). Pan: middle-button or
// shift+left-button drag (left-only drag is reserved for settlement clicks).
// React's synthetic onWheel is registered as PASSIVE in most browsers, so
// ev.preventDefault() is a no-op (the page scrolls behind the canvas while
// we zoom). Attach a native non-passive listener directly to the element so
// preventDefault actually fires.
useEffect(()=>{
  const c=canvasRef.current;if(!c)return;
  const onWheel=(ev)=>{
    ev.preventDefault();
    const r=c.getBoundingClientRect();
    const rawX=(ev.clientX-r.left)/r.width*CW;
    const rawY=(ev.clientY-r.top)/r.height*CH;
    const zOld=viewZRef.current;
    const factor=ev.deltaY<0?1.15:1/1.15;
    const zNew=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,zOld*factor));
    if(zNew===zOld)return;
    const k=zNew/zOld;
    viewXRef.current=rawX-(rawX-viewXRef.current)*k;
    viewYRef.current=rawY-(rawY-viewYRef.current)*k;
    viewZRef.current=zNew;
    if(terRef.current)draw(terRef.current);
  };
  c.addEventListener("wheel",onWheel,{passive:false});
  return()=>c.removeEventListener("wheel",onWheel);
},[CW,CH,draw]);
// ── Touch: one finger pans, two fingers pinch-zoom around their midpoint,
// a tap selects (same path as a mouse click). The canvas declares
// touch-action:none so the browser never scrolls/zooms the page instead.
useEffect(()=>{
  const c=canvasRef.current;if(!c)return;
  const touches=new Map();let lastDist=0,lastMid=null;
  const put=(t)=>touches.set(t.identifier,{x:t.clientX,y:t.clientY});
  const onStart=(e)=>{
    for(const t of e.changedTouches)put(t);
    if(touches.size===1){
      const t0=[...touches.values()][0];
      panDragRef.current={mx:t0.x,my:t0.y,vx:viewXRef.current,vy:viewYRef.current,moved:false};
    }else if(touches.size===2){
      panDragRef.current=null;
      const[a,b]=[...touches.values()];
      lastDist=Math.hypot(a.x-b.x,a.y-b.y);
      lastMid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    }
    e.preventDefault();
  };
  const onTMove=(e)=>{
    for(const t of e.changedTouches)if(touches.has(t.identifier))put(t);
    const r=c.getBoundingClientRect();
    if(touches.size===1&&panDragRef.current){
      const t0=[...touches.values()][0];const pd=panDragRef.current;
      const dx=t0.x-pd.mx,dy=t0.y-pd.my;
      if(!pd.moved&&Math.hypot(dx,dy)<=5)return;
      pd.moved=true;
      viewXRef.current=pd.vx+dx*(CW/r.width);
      viewYRef.current=pd.vy+dy*(CH/r.height);
      if(terRef.current)draw(terRef.current);
    }else if(touches.size===2){
      const[a,b]=[...touches.values()];
      const dist=Math.hypot(a.x-b.x,a.y-b.y)||1;
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const rawX=(mid.x-r.left)/r.width*CW,rawY=(mid.y-r.top)/r.height*CH;
      const zOld=viewZRef.current;
      const zNew=Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,zOld*(dist/(lastDist||dist))));
      const kz=zNew/zOld;
      viewXRef.current=rawX-(rawX-viewXRef.current)*kz+(mid.x-lastMid.x)*(CW/r.width);
      viewYRef.current=rawY-(rawY-viewYRef.current)*kz+(mid.y-lastMid.y)*(CH/r.height);
      viewZRef.current=zNew;
      lastDist=dist;lastMid=mid;
      if(terRef.current)draw(terRef.current);
    }
    e.preventDefault();
  };
  const onEnd=(e)=>{
    for(const t of e.changedTouches){
      const wasSolo=touches.size===1;
      touches.delete(t.identifier);
      if(wasSolo&&touches.size===0){
        const pd=panDragRef.current;
        // preventDefault suppresses the browser's synthetic click, so a
        // clean tap routes through the click handler ourselves.
        if(pd&&!pd.moved)onCanvasClick({clientX:t.clientX,clientY:t.clientY});
        panDragRef.current=null;
      }
    }
    if(touches.size===1){
      const t0=[...touches.values()][0];
      panDragRef.current={mx:t0.x,my:t0.y,vx:viewXRef.current,vy:viewYRef.current,moved:false};
      lastDist=0;
    }
    e.preventDefault();
  };
  c.addEventListener("touchstart",onStart,{passive:false});
  c.addEventListener("touchmove",onTMove,{passive:false});
  c.addEventListener("touchend",onEnd,{passive:false});
  c.addEventListener("touchcancel",onEnd,{passive:false});
  return()=>{
    c.removeEventListener("touchstart",onStart);c.removeEventListener("touchmove",onTMove);
    c.removeEventListener("touchend",onEnd);c.removeEventListener("touchcancel",onEnd);
  };
},[CW,CH,draw,onCanvasClick]);
const onCanvasMouseDown=useCallback((ev)=>{
  // Any button (left, middle, right) can start a drag. onCanvasClick fires
  // only if the mouse hardly moved (see the moved>3 check there), so plain
  // left-click → still selects a settlement, but left-drag → pans.
  if(ev.button===0||ev.button===1||ev.button===2){
    panDragRef.current={mx:ev.clientX,my:ev.clientY,vx:viewXRef.current,vy:viewYRef.current,moved:false};
  }
},[]);
// Jump the camera to a map tile (event feed / chronicle click-throughs).
const jumpTo=useCallback((x,y)=>{
  if(x==null||y==null)return;
  const psw=peopleRef.current;const TRl=(psw&&psw.tileRes)||1;
  const z=Math.max(viewZRef.current,2.4);viewZRef.current=z;
  viewXRef.current=CW/2-(x*TRl)*z;
  viewYRef.current=CH/2-dataYtoScreenY(y*TRl,H,CH)*z;
  if(terRef.current)draw(terRef.current);
},[CW,CH,draw]);
// Reset view (double-click to recentre at zoom 1).
const resetView=useCallback(()=>{
  viewXRef.current=0;viewYRef.current=0;viewZRef.current=1;
  if(terRef.current)draw(terRef.current);
},[draw]);
const setPresetAndGo=(p)=>{presetRef.current=p;setPreset(p);setSeed(Math.floor(Math.random()*999999));};

// ── Lenses: grouped map views (sub-modes share one underlying viewMode) ──
const pickLens=(id)=>{
  setLens(id);
  const L=LENSES.find(x=>x.id===id);
  const v=subMemRef.current[id]||L.subs[0][0];
  setViewMode(v);viewRef.current=v;
};
// lensId is REQUIRED when the click comes from a flyout: React state updates
// from pickLens are async, so pickSub(v) alone still saw the PREVIOUS lens and
// wrote e.g. "money" into politics' memory — after which picking Politics
// restored Money and the dock felt stuck on Economy.
const pickSub=(v,lensId)=>{
  const id=lensId!=null?lensId:lens;
  subMemRef.current[id]=v;
  setLens(id);
  setViewMode(v);viewRef.current=v;
};

// ── Codex navigation (plan §7.1): one stack over {tab, realm, settlement} so
// every jump — tab click, chip click, leaderboard row, map click — is
// reversible with Back. The stack holds snapshots, not routes.
const navStackRef=useRef([]);
const navigate=useCallback((next)=>{
  navStackRef.current.push({tab:panelTab,realm:realmSel,sett:selectedSettlementId});
  if(navStackRef.current.length>48)navStackRef.current.shift();
  const applyRealm=(id)=>{setRealmSel(id);selRealmRef.current=id;
    if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id});};
  if(next.tab!==undefined)setPanelTab(next.tab);
  if(next.realm!==undefined)applyRealm(next.realm);
  if(next.sett!==undefined){setSelectedSettlementId(next.sett);selectedSettlementIdRef.current=next.sett;}
  if(terRef.current)draw(terRef.current);
},[panelTab,realmSel,selectedSettlementId,draw]);
const navBack=useCallback(()=>{
  const prev=navStackRef.current.pop();if(!prev)return;
  setPanelTab(prev.tab);
  setRealmSel(prev.realm);selRealmRef.current=prev.realm;
  if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:prev.realm});
  setSelectedSettlementId(prev.sett);selectedSettlementIdRef.current=prev.sett;
  if(terRef.current)draw(terRef.current);
},[draw]);
const emblemURLFor=(cid)=>{
  const psw=peopleRef.current;if(!psw||!psw.countries)return null;
  const c=psw.countries.get(cid);if(!c)return null;
  return realmEmblemURL(psw,c,terRef.current,worldRef.current?worldRef.current.seed:0);
};
// Keyboard: space = play/pause, 1-9 = lenses, F fit, G globe, L layers,
// ? help; Esc steps back OUT — overlays first, then selection (settlement →
// its realm → nothing). (Re-subscribed each render for fresh closures — cheap.)
useEffect(()=>{
  const onKey=(e)=>{
    const t=e.target;
    if(t&&(t.tagName==="INPUT"||t.tagName==="SELECT"||t.tagName==="TEXTAREA"))return;
    if(e.code==="Space"){e.preventDefault();togglePlay();}
    else if(e.key==="Escape"){
      // Step back OUT, one layer at a time: flyout → top floating surface →
      // settlement selection → realm selection.
      if(dockFly){setDockFly(null);return;}
      if(closeTopSurface())return;
      if(selectedSettlementId>=0){
        // walk up: from the settlement to its realm
        const psw=peopleRef.current;
        const s=psw&&psw.settlements&&psw.settlements.find(x=>x&&x.id===selectedSettlementId);
        const cid=s&&s.countryId>=0?s.countryId:-1;
        selectedSettlementIdRef.current=-1;setSelectedSettlementId(-1);
        selRealmRef.current=cid;setRealmSel(cid);
        if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:cid});
        if(cid>=0)setPanelTab("realms");
      }else if(realmSel>=0){
        selRealmRef.current=-1;setRealmSel(-1);
        if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:-1});
      }
      if(terRef.current)draw(terRef.current);
    }
    else if(e.key==="f"||e.key==="F")resetView();
    else if(e.key==="g"||e.key==="G")setShowGlobe(v=>!v);
    else if(e.key==="l"||e.key==="L")setLayersOpen(v=>!v);
    else if(e.key==="?")setHelpOpen(v=>!v);
    else{const n=+e.key;if(n>=1&&n<=LENSES.length)pickLens(LENSES[n-1].id);}
  };
  window.addEventListener("keydown",onKey);
  return()=>window.removeEventListener("keydown",onKey);
});

// ── Aggregate world stats for the chronicle ribbon ──
// The displayed year is the uniform linear display clock (calendar.js
// displayYear) — read-only, never an input. `yr(step)` formats any step.
const _eraAt=(peopleRef.current&&peopleRef.current._eraAt)||null;
const yr=(step)=>displayYearStr(step);
const _step=liveStep||(peopleRef.current&&peopleRef.current.step)||psStats.step||0;
const _ys=yr(_step);
// Leading era comes from the WORKER stats (the most advanced capital's tech
// era) — the old ribbon averaged the dead tribe arrays and so sat frozen on
// "Stone Age" forever.
const _era=ERAS[psStats.leadingEra||0]||ERAS[0];
// Emergent endgame: the leading civ has climbed the whole knowledge tree (reached
// the final, Modern era). Read-only flag derived from the era timeline — celebrated
// with a marker in the ribbon; nothing keys a mechanic off it.
const _arcComplete=(psStats.leadingEra||0)>=ERAS.length-1;
const _psw=peopleRef.current;
const _countryCount=(_psw&&_psw.countries)?_psw.countries.size:0;
// The atlas headline (owner 2026-08-20): NATIONS = sovereign suzerainty blocs
// (overlord chains followed to their root — same convention the political
// paint uses), while the register's full size rides beside it as "states".
// 1500-CE Earth held ~1,000+ polities but atlases draw ~hundreds of blocs.
const _nationCount=(()=>{const cs=_psw&&_psw.countries;if(!cs)return 0;
  const roots=new Set();
  for(const id of cs.keys()){let cur=id,hops=0;
    while(hops++<12){const o=cs.get(cur);const ov=o&&o._overlord>=0&&o._overlord!==cur?o._overlord:-1;if(ov<0)break;cur=ov;}
    roots.add(cur);}
  return roots.size;})();
// Active wars, as UNORDERED pairs (the snapshot's list is directional, so a
// mutual war arrives twice — count the rivalry once).
const _warCount=(()=>{const w=_psw&&_psw._wars;if(!w||!w.length)return 0;
  const seen=new Set();
  for(let i=0;i<w.length;i+=2){const a=w[i],b=w[i+1];seen.add(a<b?a+":"+b:b+":"+a);}
  return seen.size;})();


// ── World Panel panes (relocated leaderboard / charts / settlement card) ──
// Realm inspector: a polity as a first-class subject — identity, throne,
// faith, temperament, fisc, members — with its chronicle one click away.
const renderRealmDetail=()=>{
  const psw=peopleRef.current;
  const c=psw&&psw.countries?psw.countries.get(realmSel):null;
  const back=()=>{setRealmSel(-1);if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:-1});};
  if(!c)return(
    <div style={{padding:16,fontSize:11}}>
      <button onClick={back} className="au-btn au-flat" style={{fontSize:10,marginBottom:8}}>← realms</button>
      <div className="au-fade" style={{fontStyle:"italic"}}>This realm has fallen — its story survives in the chronicle of whoever conquered it.</div>
    </div>);
  const hue=((c.id*61)%360+360)%360;
  const pop=(c.members||[]).reduce((a,m)=>a+(m.people||0),0);
  const wealth=(c.members||[]).reduce((a,m)=>a+(m.wealth||0),0);
  const army=(c.members||[]).reduce((a,m)=>a+(m.army||0),0);
  const faith=psw.faiths&&c.faithId>=0?psw.faiths.get(c.faithId):null;
  const capCul=c.capital&&psw.cultures?psw.cultures.get(c.capital.cultureId):null;
  const pers=c.personality;
  const members=(c.members||[]).slice().sort((a,b)=>(b.people||0)-(a.people||0));
  const armsURL=realmEmblemURL(psw,c,terRef.current,worldRef.current?worldRef.current.seed:0);
  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"10px 12px",fontSize:12}}>
      <button onClick={back} className="au-btn au-flat" style={{fontSize:11,marginBottom:6}}>← all realms</button>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:2}}>
        {armsURL
          ?<img src={armsURL} alt="" title="The realm's arms" style={{height:34,flexShrink:0,filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.35))"}}/>
          :<span style={{width:12,height:12,borderRadius:2,background:`hsl(${hue},60%,50%)`,flexShrink:0}}/>}
        <span className="au-pico-title" style={{fontSize:16,textTransform:"capitalize"}}>{c.name||(c.capital?c.capital.name:"realm "+c.id)}</span>
        <div style={{flex:1}}/>
        {c.ruler&&<button onClick={()=>setDynastyOpen(true)} title="The ruling family tree"
          style={{background:"transparent",border:"none",cursor:"pointer",fontSize:15}}>🌳</button>}
        <button onClick={()=>setChronicleOpen(true)} title="The realm's chronicle"
          style={{background:"transparent",border:"none",cursor:"pointer",fontSize:15}}>📜</button>
      </div>
      <div className="au-fade" style={{fontSize:11,marginBottom:8}}>
        {c.members.length} settlements · {fmtPeople(pop)} catchment
        {capCul?<> · <Chip hue={capCul.hue} onClick={()=>navigate({tab:"peoples"})} title="Open the Peoples registry">{capCul.name}</Chip> people</>:null}
        {pers?` · ${pers.label}`:""}
      </div>
      {c.ruler&&<div onClick={()=>setDynastyOpen(true)} title="Open the ruling family tree"
        style={{fontSize:11,marginBottom:6,cursor:"pointer"}}>
        <span className="au-fade">{(c.ruler.title||(c.ruler.female?"Queen":"King"))+" "}</span>{c.ruler.name}
        <span className="au-fade"> of house </span>{c.ruler.house||"?"}
        <span className="au-fade"> · age {c.ruler.age}</span>
        {c.ruler.gov&&c.ruler.gov!=="monarchy"&&<span className="au-fade"> · {c.ruler.gov}</span>}
        {c.ruler.trait&&<span className="au-fade" style={{fontStyle:"italic"}}> · {c.ruler.trait}</span>}
      </div>}
      {faith&&<div style={{fontSize:11.5,marginBottom:6}}>
        <span className="au-fade">state faith </span>
        <Chip hue={faith.hue} cap={false} onClick={()=>navigate({tab:"faiths"})} title="Open the Faiths registry">{faith.name}</Chip>
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"2px 8px",fontSize:10,marginBottom:8}}>
        <span className="au-fade">Control</span><span>{(c._loadTotal||0).toFixed(1)}/{(c._capacity||0).toFixed(1)}{(c._loadTotal||0)>(c._capacity||0)?" · over-extended":""}</span>
        {(c._momentum||0)>=1&&<><span className="au-fade">Momentum</span><span>+{(c._momentum||0).toFixed(1)}</span></>}
        <span className="au-fade">Treasury</span><span>{fmtGoldKg(c._treasury||0)}{(c._solvency??1)<0.99?" · INSOLVENT":""}</span>
        <span className="au-fade">Tax rate</span><span>{Math.round((c._taxRate||0)*100)}%</span>
        <span className="au-fade">Army</span><span>{fmtPeople(army)}</span>
        <span className="au-fade">Wealth (all cities)</span><span>{fmtGoldKg(wealth)}</span>
        {(c._fronts||0)>0&&<><span className="au-fade">At war</span><span>{c._fronts} front{c._fronts>1?"s":""}{c._capitalBesieged?" · capital besieged":""}</span></>}
      </div>
      {pers&&<div style={{marginBottom:8}}>
        <div className="au-heading au-sc au-fade" style={{fontSize:10,marginBottom:2}}>Temperament — {pers.label}</div>
        {[["aggression",pers.aggression],["commerce",pers.commerce],["expansionism",pers.expansionism]].map(([k,v])=>(
          <div key={k} style={{display:"flex",alignItems:"center",gap:6,fontSize:9}}>
            <span className="au-fade" style={{width:74,textTransform:"capitalize"}}>{k}</span>
            <div style={{flex:1,height:4,background:"rgba(216,190,150,0.15)",borderRadius:2,position:"relative"}}>
              <div style={{position:"absolute",left:"50%",top:-1,bottom:-1,width:1,background:"rgba(216,190,150,0.4)"}}/>
              <div style={{position:"absolute",left:v>=0?"50%":`${50+v*50}%`,width:`${Math.abs(v)*50}%`,top:0,bottom:0,
                background:v>=0?"hsl(8,60%,45%)":"hsl(200,45%,45%)",borderRadius:2}}/>
            </div>
            <span style={{width:30,textAlign:"right"}}>{(v>=0?"+":"")+v.toFixed(2)}</span>
          </div>
        ))}
      </div>}
      <div className="au-heading au-sc au-fade" style={{fontSize:10,marginBottom:2}}>Settlements — {members.length}</div>
      {members.map(m=>(
        <div key={m.id} onClick={()=>navigate({tab:"inspect",sett:m.id})}
          title="Inspect this settlement"
          style={{display:"flex",gap:6,fontSize:11,padding:"2.5px 0",cursor:"pointer",borderBottom:"1px solid rgba(216,190,150,0.07)"}}>
          <span style={{textTransform:"capitalize"}}>{c.capitalId===m.id?"★ ":""}{m.name}</span>
          {c.capitalId===m.id&&<span className="au-fade">· capital</span>}
          {(m.tier|0)>=3&&<span className="au-fade">· metropolis</span>}
          <div style={{flex:1}}/>
          <span className="au-fade au-num">{fmtPeople(m.people||0)} catchment</span>
        </div>
      ))}
    </div>
  );
};

// Peoples / Faiths browsers: aggregated live from the mirror.
const renderPeoples=()=>{
  const psw=peopleRef.current;
  if(!psw||!psw.cultures||!psw.settlements)return <div className="au-fade" style={{padding:16,fontSize:11,fontStyle:"italic"}}>No peoples yet.</div>;
  const agg=new Map();
  for(const st of psw.settlements){
    if(!st||st.mode!=="settled")continue;
    const cid=st.cultureId??-1;if(cid<0)continue;
    let a=agg.get(cid);if(!a)agg.set(cid,a={setts:0,pop:0});
    a.setts++;a.pop+=st.people||0;
  }
  // Group peoples under their FAMILY (the cradle stock they branched from) —
  // people-within-family, the way real ethnography nests ethnic groups inside
  // language families.
  const fams=new Map();
  for(const c of psw.cultures.values()){
    const root=c.root??c.id;
    if(!fams.has(root))fams.set(root,{name:c.family||"?",rows:[],pop:0});
    const a=agg.get(c.id)||{setts:0,pop:0};
    const fe=fams.get(root);fe.rows.push({c,a});fe.pop+=a.pop;
    if(root===c.id)fe.name=c.family||fe.name;
  }
  const famList=[...fams.values()].sort((x,y)=>y.pop-x.pop);
  for(const f of famList)f.rows.sort((x,y)=>y.a.pop-x.a.pop);
  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"10px 12px",fontSize:11}}>
      <div className="au-fade" style={{fontSize:9,marginBottom:8,lineHeight:1.4}}>
        A <b>people</b> is an ethnic identity — names, descent and culture, carried by population (not genetics). Its <b>language</b> is a SEPARATE, faster-moving layer (the Languages lens): under a foreign crown a people keeps its name long after it adopts the ruler's tongue, so the two maps diverge. Peoples branch from a common <b>family</b> (their cradle stock), assimilate slowly under shared rule, and diverge in isolation. Population figures are <b>catchment</b> totals (city + countryside each settlement administers).
      </div>
      {famList.map((f,fi)=>(
        <div key={fi} style={{marginBottom:8}}>
          <div className="au-heading au-sc" style={{fontSize:11,marginBottom:2,color:"var(--au-ink)"}}>
            {f.name} <span className="au-fade" style={{fontSize:9}}>family · {f.rows.length} {f.rows.length===1?"people":"peoples"} · {fmtPeople(f.pop)} catchment</span>
          </div>
          {f.rows.map(({c,a})=>(
            <div key={c.id} style={{display:"flex",alignItems:"baseline",gap:7,padding:"3px 0 3px 8px",borderBottom:"1px solid rgba(216,190,150,0.08)"}}>
              <span style={{width:9,height:9,borderRadius:2,background:`hsl(${c.hue|0},58%,50%)`,flexShrink:0,alignSelf:"center"}}/>
              <span style={{fontWeight:600}}>{c.name}</span>
              {c.parent>=0&&psw.cultures.get(c.parent)&&<span className="au-fade" style={{fontSize:9}}>← {psw.cultures.get(c.parent).name}</span>}
              <div style={{flex:1}}/>
              <span className="au-fade">{a.setts} · {fmtPeople(a.pop)} catchment</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
const renderFaiths=()=>{
  const psw=peopleRef.current;
  if(!psw||!psw.faiths||!psw.settlements)return <div className="au-fade" style={{padding:16,fontSize:11,fontStyle:"italic"}}>No faiths yet.</div>;
  const agg=new Map();
  for(const st of psw.settlements){
    if(!st||st.mode!=="settled")continue;
    const fid=st.faithId??-1;if(fid<0)continue;
    let a=agg.get(fid);if(!a)agg.set(fid,a={setts:0,pop:0});
    a.setts++;a.pop+=st.people||0;
  }
  const rows=[...psw.faiths.values()].map(f=>({f,a:agg.get(f.id)||{setts:0,pop:0}}))
    .filter(({f,a})=>a.setts>0||f.kind==="organized")
    .sort((x,y)=>y.a.pop-x.a.pop);
  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"10px 12px",fontSize:11}}>
      {rows.map(({f,a})=>(
        <div key={f.id} style={{display:"flex",alignItems:"baseline",gap:7,padding:"4px 0",borderBottom:"1px solid rgba(216,190,150,0.10)"}}>
          <span style={{width:10,height:10,borderRadius:f.kind==="organized"?"50%":2,background:`hsl(${f.hue|0},55%,50%)`,flexShrink:0,alignSelf:"center"}}/>
          <span style={{fontWeight:600,fontSize:12}}>{f.name}</span>
          <span className="au-fade" style={{fontSize:9}}>{f.character||f.kind}{f.parent>=0&&psw.faiths.get(f.parent)?` ← ${psw.faiths.get(f.parent).name}`:""}</span>
          <div style={{flex:1}}/>
          <span className="au-fade">{a.setts>0?`${a.setts} · ${fmtPeople(a.pop)} catchment`:"faded"}</span>
        </div>
      ))}
      <div className="au-fade" style={{fontSize:9,marginTop:8,fontStyle:"italic"}}>
        Organized faiths spread along trade routes, convert courts, and schism across distance. The Faiths lens maps them. Population is catchment (city + countryside).</div>
    </div>
  );
};
const renderLanguages=()=>{
  const psw=peopleRef.current;
  if(!psw||!psw.languages||!psw.settlements)return <div className="au-fade" style={{padding:16,fontSize:11,fontStyle:"italic"}}>No languages yet.</div>;
  // who SPEAKS each tongue (dominant langId), aggregated by settlement + people
  const agg=new Map();
  for(const st of psw.settlements){
    if(!st||st.mode!=="settled")continue;
    const lid=st.langId??-1;if(lid<0)continue;
    let a=agg.get(lid);if(!a)agg.set(lid,a={setts:0,pop:0});
    a.setts++;a.pop+=st.people||0;
  }
  // nest tongues under their FAMILY (root tongue), like peoples under their stock
  const fams=new Map();
  for(const l of psw.languages.values()){
    const root=l.root??l.id;
    if(!fams.has(root))fams.set(root,{rootId:root,rows:[],pop:0});
    const a=agg.get(l.id)||{setts:0,pop:0};
    const fe=fams.get(root);fe.rows.push({l,a});fe.pop+=a.pop;
  }
  const live=(f)=>f.rows.filter(r=>r.a.setts>0);
  const famList=[...fams.values()].filter(f=>live(f).length>0).sort((x,y)=>y.pop-x.pop);
  for(const f of famList)f.rows.sort((x,y)=>y.a.pop-x.a.pop);
  const hueOf=(l)=>((l&&l.hue!=null?l.hue:((((l&&l.id)||0)*2654435761)>>>0)%360))|0;   // SAME likeness hue the Languages lens uses
  const famName=(f)=>{const r=psw.languages.get(f.rootId);return (r&&r.name)||"?";};
  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"10px 12px",fontSize:11}}>
      <div className="au-fade" style={{fontSize:9,marginBottom:8,lineHeight:1.4}}>
        A <b>language</b> is the spoken tongue — a SEPARATE, faster layer than the <i>people</i> who speak it. A conquering crown spreads its standard across subject peoples, so one tongue can blanket many peoples and the map STEPS at political borders, while a people keeps its name long after it changes speech. Tongues branch from a common <b>family</b> and drift apart in isolation. Population is catchment (city + countryside).
      </div>
      {famList.map((f,fi)=>{const ls=live(f);return(
        <div key={fi} style={{marginBottom:8}}>
          <div className="au-heading au-sc" style={{fontSize:11,marginBottom:2,color:"var(--au-ink)"}}>
            {famName(f)} <span className="au-fade" style={{fontSize:9}}>family · {ls.length} {ls.length===1?"tongue":"tongues"} · {fmtPeople(f.pop)} catchment</span>
          </div>
          {ls.map(({l,a})=>(
            <div key={l.id} style={{display:"flex",alignItems:"baseline",gap:7,padding:"3px 0 3px 8px",borderBottom:"1px solid rgba(216,190,150,0.08)"}}>
              <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hueOf(l)},58%,50%)`,flexShrink:0,alignSelf:"center"}}/>
              <span style={{fontWeight:600}}>{l.name||"(tongue)"}</span>
              <div style={{flex:1}}/>
              <span className="au-fade">{a.setts} · {fmtPeople(a.pop)} catchment</span>
            </div>
          ))}
        </div>
      );})}
    </div>
  );
};

const renderInspect=()=>{
  if(selectedSettlementId<0)return null;
  const psw=peopleRef.current;
  if(!psw)return null;
  const s=psw.settlements.find(x=>x&&x.id===selectedSettlementId&&x.mode==="settled");
  if(!s)return null;
  // Core ladder (T.CITY_CORE): the words are DEFINITIONS on the urban core —
  // tier 0 is a VILLAGE that promotes in place as its measured core grows, so
  // the panel prices progress on _coreMeasured against the TIER_CORE floors.
  const coreT=!!(SIM_T.CITY_CORE&&SIM_T.DISSOLVE_FARMS);
  // Legacy array historically said "city" for tier 1 while the hover card and
  // the chronicle said "town" — the owner caught the mismatch live. Tier 1 is
  // a town in every register.
  const tierName=(coreT?TIER_NAME_CORE:["farming region","town","city","metropolis"])[s.tier]||"settlement";
  // Legacy ladder: a farming region (tier 0) does NOT promote in place — it FOUNDS
  // a town nearby once it fills out (urban genesis). Only urban nodes climb, at the
  // sim's canonical TIER_THRESHOLD (town→city→metropolis); index [1] isn't a promotion
  // gate (towns are spawned, not grown from regions), so progress is urban-only.
  const isRegion=!coreT&&(s.tier|0)===0;
  // Live tier bars (Tier-B rank tiers): town→city reads the world's cached
  // cityBar (percentile-anchored, or the legacy relative bar), city→metro the
  // floating metro bar; falls back to the static THRESHOLD before first tick.
  const nextThr=coreT?
    ((s.tier|0)>=3?0:(s.tier|0)===2?Math.max(TIER_CORE[3],(psw._topUrban||0)*0.8):TIER_CORE[(s.tier|0)+1]):
    isRegion?0:
    s.tier===1?(psw._cityBar||TIER_THRESHOLD[2]):
    s.tier===2?Math.max(TIER_THRESHOLD[3],(psw._topUrban||0)*0.8):
    TIER_THRESHOLD[s.tier+1];
  const progress=nextThr?Math.min(1,(coreT?(s._coreMeasured??s._urbanPop??0):s.people)/nextThr):1;
  // s.people is the WHOLE PROVINCE (urban core + rural hinterland, summed over the
  // settlement's entire catchment). For an urban node, headline the CITY CORE
  // (_urbanPop) — the number a reader means by "the city" — and show the province
  // as context. Falls back to the province total if the core isn't serialized yet.
  const hasCore=!isRegion && ((s._coreMeasured!=null && s._coreMeasured>0) || (s._urbanPop!=null && s._urbanPop>0));
  const cityPop=s._coreMeasured!=null && s._coreMeasured>0 ? s._coreMeasured : s._urbanPop;
  const k=s.knowledge||{};
  const tech=techState(k);                 // Civ-like discovery layer derived from knowledge (tech.js)
  const techList=TECHS.filter((t,i)=>tech.have[i]===1);
  const techNext=nextTechs(k,tech.have,3);
  const r=s.localRes||{};
  const farm=s._terrTiles||0;
  const K=s._k||0;
  const foodK=s._foodK||0,houseK=s._houseK||0;
  const limitedBy=foodK<=houseK?"food":"housing";
  // Era label is driven by metallurgy KNOWLEDGE (which is monotonic —
  // you don't unlearn how to make steel) rather than current
  // resource access. A city that lost its iron mine still knows the
  // craft; it just can't make new iron until a trade route reopens.
  const m=k.metallurgy||0;
  let era="stone age";
  if(m>=0.88)era="steel age";
  else if(m>=0.68)era="iron age";
  else if(m>=0.42)era="bronze age";
  else if(m>=0.15)era="chalcolithic";
  // Local resources, sorted by richness, only show ones present.
  const RES_LABEL={timber:"Timber",stone:"Stone",copper:"Copper",tin:"Tin",iron:"Iron",coal:"Coal",horses:"Horses",salt:"Salt",precious:"Precious",gems:"Gems",spices:"Spices",furs:"Furs",incense:"Incense",dyes:"Dyes"};
  const presentRes=Object.entries(r).filter(([,v])=>v>0.10).sort((a,b)=>b[1]-a[1]);
  // Ore-access flags drive the metallurgy "(no ore)/(copper)/.../(steel)"
  // hint — it shows what's POSSIBLE from current local deposits, which
  // is independent of the era label above (driven by accumulated
  // knowledge).
  const cu=(r.copper||0)>0.10,sn=(r.tin||0)>0.10,fe=(r.iron||0)>0.10,co=(r.coal||0)>0.10;
  // Water-access label.
  const wa=s.waterAccess||0;
  const waterLabel=wa<=0?"landlocked":wa<0.3?"minor river":wa<0.6?"river":wa<0.85?"coastal":"port";
  // Food balance — shared helper mirrors the famine physics' rulers.
  const fl=foodLedgerInfo(s);
  const {supply,demand,importRate,landFood,surplus,ticksLeft,coreNeed,fedM,status,statusColor}=fl;
  const haulPool = s._haulFoodPool || 0;

  // Treasury + trade.
  const wealth=Math.round(s.wealth||0);
  const available=Math.max(0,wealth-Math.round(getWealthReserve(s)));
  const profile=s._tradeProfile||getTradeProfile(s,peopleRef.current);
  // Export composition (specific goods) — each good's value contribution to what
  // this settlement makes for sale. The "goods sold" coin is earned in
  // proportion to these shares, so we split that $/tick across the named goods.
  const _xb=getExportBreakdown(s);
  const _xbTot=_xb.reduce((t,b)=>t+b.value,0)||1;
  const produces=_xb.filter(b=>b.label!=="Baseline").slice(0,3).map(b=>b.label.toLowerCase());
  const _goodsRate=(s._mInRate&&s._mInRate[IN_GOODS])||0;
  // The crafts book on their own channels now (money.js IN_ORE..IN_WARES via
  // the per-good trade path), so they appear directly — honestly ranked — in
  // the Gold in/out list above. The export-share ESTIMATE below only renders
  // for the scalar-path world (no per-good channels carrying data), where the
  // bundled "goods sold" channel is all there is to decompose.
  const _craftRate=s._mInRate&&s._mInRate.length>IN_WARES
    ? (s._mInRate[IN_ORE]||0)+(s._mInRate[IN_METAL]||0)+(s._mInRate[IN_CLOTH]||0)+(s._mInRate[IN_WARES]||0)
    : 0;
  const goodsBreakdown=(_goodsRate>0.005&&_craftRate<=0.005)
    ? _xb.map(b=>[b.label==="Baseline"?"Basic produce":b.label, _goodsRate*b.value/_xbTot])
         .filter(x=>x[1]>0.005).sort((a,b)=>b[1]-a[1])
    : [];
  // Smoothed net wealth change rate from the sim (the categorised in/out
  // breakdown below comes from s._mInRate / s._mOutRate).
  const wealthDelta=s._wealthDelta||0;
  const moneyCol=v=>v>0.02?"#3a7":v<-0.02?"#c44":"#8a8f9c";
  const nextName=isRegion?null:(coreT?["town","city","metropolis"]:["larger city","larger city","metropolis"])[s.tier];

  return(
    <div className="au-scroll"
      style={{flex:1,minHeight:0,padding:"10px 12px",fontSize:11,overflowY:"auto",
        pointerEvents:"auto"/* au-pico sets pointer-events:none for the hover tooltip; this card is interactive */}}>

      {/* Full tech-tree overlay (fixed-position; escapes the panel) */}
      {techTreeOpen&&<TechTreeOverlay k={k} env={s._techEnv||null} title={s.name} z={_zOf("techtree")} onClose={()=>setTechTreeOpen(false)}/>}

      {/* ── Header ── (the chronicle opener lives here so it's always visible
          without scrolling the card — a long card can push a bottom section
          out of easy reach) */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div className="au-pico-title" style={{fontSize:14,textTransform:"capitalize"}}>{s.name}</div>
        <div style={{display:"flex",alignItems:"center",gap:1,flexShrink:0}}>
          {psw._chronicle&&psw._chronicle.countryId===s.countryId&&psw._chronicle.entries&&psw._chronicle.entries.length>0&&
            <button onClick={()=>setChronicleOpen(true)} title={`Open chronicle — ${psw._chronicle.entries.length} events`}
              style={{background:"transparent",border:"none",cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 3px"}}>📜</button>}
          <button onClick={()=>setSelectedSettlementId(-1)}
            style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:16,lineHeight:1,padding:"0 2px"}}>×</button>
        </div>
      </div>
      <div className="au-fade" style={{fontSize:10,textTransform:"capitalize",marginBottom:6}}>
        {tierName} · {era} · {waterLabel}
      </div>
      {(()=>{
        const rec=settTrace;
        const mine=rec.id===s.id;
        const live=rec.recording&&mine;
        const other=rec.recording&&rec.id>=0&&!mine;
        const n=mine||other?rec.n:0;
        const post=(cmd)=>simWorkerRef.current&&simWorkerRef.current.postMessage({type:"settTrace",cmd,id:s.id,every:settTraceEvery});
        return <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:4,marginBottom:8,padding:"5px 6px",
          background:"rgba(18,13,8,0.35)",border:"1px solid rgba(216,190,150,0.18)",borderRadius:3}}>
          <span className="au-fade" style={{fontSize:9,letterSpacing:"0.04em",textTransform:"uppercase"}}>Trace</span>
          <span className="au-fade" style={{fontSize:10}}>every</span>
          <input type="number" min={1} max={2000} value={settTraceEvery} disabled={!!rec.recording}
            onChange={e=>setSettTraceEvery(Math.max(1, e.target.value|0))}
            title="Sample this city's full live state every N ticks (1 tick = 0.5 years)"
            style={{width:52,padding:"1px 4px",fontSize:11}}/>
          <span className="au-fade" style={{fontSize:10}}>ticks</span>
          {!rec.recording
            ? <button className="au-btn au-flat" style={{fontSize:10,padding:"1px 7px"}}
                onClick={()=>post("start")} title="Record this settlement's exact data every N ticks">Record</button>
            : <button className="au-btn au-wax" style={{fontSize:10,padding:"1px 7px"}}
                onClick={()=>post("stop")} title="Stop recording (keep samples)">Stop</button>}
          <button className="au-btn au-flat" style={{fontSize:10,padding:"1px 7px"}}
            onClick={()=>post(n>0?"copy":"once")}
            title={n>0?"Copy the recorded log to the clipboard (download if too large)":"Copy this settlement's current state, exactly"}>
            {settTraceCopied?"Copied":(n>0?`Copy ${n}`:"Copy now")}</button>
          {n>0&&<button className="au-btn au-flat" style={{fontSize:10,padding:"1px 7px"}}
            onClick={()=>post("clear")} title="Discard recorded samples">Clear</button>}
          <span className="au-fade" style={{fontSize:10,marginLeft:"auto"}}>
            {live?`recording · ${n} sample${n===1?"":"s"}`:(other?`recording ${rec.name||"#"+rec.id} · ${n}`:(n?`${n} saved`:""))}
          </span>
        </div>;
      })()}
      {/* ── The three identity layers, each a row of chips into its registry:
            who they ARE (people), what they SPEAK, what they BELIEVE — three
            separate, differently-paced layers, cross-linked (plan §7.3). ── */}
      {(()=>{
        const mix=s.culMix&&s.culMix.length?s.culMix:(s.cultureId>=0?[[s.cultureId,1]]:null);
        if(!mix||!psw.cultures)return null;
        const parts=mix.filter(([,sh])=>sh>0.02).map(([cid,sh])=>{
          const cul=psw.cultures.get(cid);
          return cul?{key:cid,name:cul.name,hue:cul.hue,sh}:null;
        }).filter(Boolean);
        if(!parts.length)return null;
        return <div style={{fontSize:11,marginBottom:5}}>
          <span className="au-fade">people </span>
          {parts.map((p,i)=><Fragment key={p.key}>{i>0&&<span className="au-fade"> · </span>}
            <Chip hue={p.hue} cap={false} onClick={()=>navigate({tab:"peoples"})} title="Open the Peoples registry">{p.name}{p.sh<0.98?` ${Math.round(p.sh*100)}%`:""}</Chip></Fragment>)}
        </div>;
      })()}
      {(()=>{
        const mix=s.langMix;
        if(!mix||!mix.length||!psw.languages)return null;
        const parts=mix.filter(([,sh])=>sh>0.03).map(([lid,sh])=>{
          const lg=psw.languages.get(lid);
          if(!lg)return null;
          const h=(lg.hue!=null?lg.hue:((lid*2654435761)>>>0)%360)|0;
          return {key:lid,name:lg.name||"tongue",hue:h,sh};
        }).filter(Boolean);
        if(!parts.length)return null;
        return <div style={{fontSize:11,marginBottom:5}}>
          <span className="au-fade">speech </span>
          {parts.map((p,i)=><Fragment key={p.key}>{i>0&&<span className="au-fade"> · </span>}
            <Chip hue={p.hue} cap={false} onClick={()=>navigate({tab:"tongues"})} title="Open the Tongues registry">{p.name}{p.sh<0.97?` ${Math.round(p.sh*100)}%`:""}</Chip></Fragment>)}
        </div>;
      })()}
      {(()=>{
        const mix=s.faithMix;
        if(!mix||!mix.length||!psw.faiths)return null;
        const parts=mix.filter(([,sh])=>sh>0.03).map(([fid,sh])=>{
          const f=psw.faiths.get(fid);
          return f?{key:fid,name:`${f.name}${f.kind==="organized"?"":" (folk)"}`,hue:f.hue,sh}:null;
        }).filter(Boolean);
        if(!parts.length)return null;
        return <div style={{fontSize:11,marginBottom:5}}>
          <span className="au-fade">faith </span>
          {parts.map((p,i)=><Fragment key={p.key}>{i>0&&<span className="au-fade"> · </span>}
            <Chip hue={p.hue} cap={false} onClick={()=>navigate({tab:"faiths"})} title="Open the Faiths registry">{p.name}{p.sh<0.97?` ${Math.round(p.sh*100)}%`:""}</Chip></Fragment>)}
        </div>;
      })()}

      {/* ── Country / polity (with administrative lineage) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        const n=ctry?ctry.members.length:1;
        // A COLONIAL dependency takes its METROPOLE's hue (the map colours it as a shade of the
        // mother country), and is named as that country's colony rather than an independent state.
        // A submitted VASSAL keeps its own hue and reads as a tributary court — internal
        // sovereignty survives submission; only the suzerain line marks the bond.
        const overlord=(ctry&&ctry._overlord>=0)?ctry._overlord:-1;
        const vassal=overlord>=0&&ctry._depKind==="vassal";
        const overCtry=overlord>=0&&psw.countries?psw.countries.get(overlord):null;
        const overName=overlord>=0?((overCtry&&overCtry.name)||(vassal?"its suzerain":"its mother country")):null;
        const hue=((((overlord>=0&&!vassal?overlord:s.countryId))*61)%360+360)%360;
        const cap=ctry&&ctry.capital;
        const isCap=cap&&cap.id===s.id;
        const byId=psw._byId||(()=>{const m=new Map();for(const o of psw.settlements)m.set(o.id,o);return m;})();
        const liege=(!isCap&&s.liegeId>=0)?byId.get(s.liegeId):null;
        let label;
        if(vassal){
          label=(n<=1)?`tributary of ${overName}`:(isCap?`vassal capital · ${n} settlements · tributary of ${overName}`:`settlement · vassal realm of ${cap?cap.name:"?"}`);
        }
        else if(overlord>=0){
          label=(n<=1)?`colony of ${overName}`:(isCap?`colonial capital · ${n} settlements · answers to ${overName}`:`colonial settlement · realm of ${cap?cap.name:"?"}`);
        }
        else if(n<=1)label="independent city-state";
        else if(isCap)label=`${ctry&&ctry._nomadic?"horde capital":"national capital"} · ${n} settlements`;
        else{
          const role=(s._vassalCount>0)?"provincial seat":(tierName||"settlement");
          label=`${role} · answers to ${liege?liege.name:(cap?cap.name:"?")}`;
          if(liege&&cap&&liege.id!==cap.id)label+=` · realm of ${cap.name}`;
        }
        const arms=ctry?emblemURLFor(ctry.id):null;
        return(
          <div onClick={()=>{if(ctry)navigate({tab:"realms",realm:ctry.id});}}
            title={ctry?"Open the realm":undefined}
            style={{display:"flex",alignItems:"center",gap:6,fontSize:11,marginBottom:6,cursor:ctry?"pointer":"default"}}>
            {arms
              ?<img src={arms} alt="" style={{height:16,flexShrink:0,filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.25))"}}/>
              :<span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},55%,50%)`,flexShrink:0,
                backgroundImage:overlord>=0&&!vassal?"repeating-linear-gradient(45deg,rgba(0,0,0,0.65) 0 1.5px,transparent 1.5px 4px)":undefined}}/>}
            <span className="au-fade" style={{textTransform:"capitalize",textDecoration:ctry?"underline":"none",
              textDecorationColor:"rgba(160,120,50,0.4)",textUnderlineOffset:2}}>{label}</span>
          </div>
        );
      })()}

      {/* ── National temperament (personality) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        const p=ctry&&ctry.personality;
        if(!p)return null;
        // Hue per dominant temperament so the label reads at a glance.
        const labelHue={Warlike:8,Conqueror:340,"Raider-Republic":30,Mercantile:140,"Trading Empire":175,Expansionist:265,Insular:210,Balanced:45}[p.label]??45;
        // Compact CENTERED trait bars: traits are −1..1 (0=neutral), so the
        // fill grows rightward from the centre for a positive (trait-expressing)
        // value and leftward for a negative (mirror) one, against a centre tick.
        const bar=(v,h)=>{
          const c=Math.max(-1,Math.min(1,v||0));
          const half=Math.abs(c)*50;                 // % of the half-track filled
          const left=c>=0?50:50-half;                // start at centre (right) or back off (left)
          return(
          <span style={{display:"inline-block",width:22,height:5,borderRadius:2,background:"rgba(255,255,255,0.12)",position:"relative",overflow:"hidden"}}>
            <span style={{position:"absolute",left:"50%",top:0,bottom:0,width:1,background:"rgba(255,255,255,0.35)"}}/>
            <span style={{position:"absolute",left:`${left}%`,top:0,bottom:0,width:`${half}%`,background:`hsl(${h},60%,52%)`}}/>
          </span>
          );
        };
        return(
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:10,marginBottom:6,flexWrap:"wrap"}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${labelHue},60%,50%)`,flexShrink:0}}/>
            <span className="au-fade" style={{fontWeight:600}}>{p.label}</span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`aggression ${(p.aggression||0).toFixed(2)}`}>{bar(p.aggression,8)}<span className="au-fade" style={{opacity:0.5}}>war</span></span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`commerce ${(p.commerce||0).toFixed(2)}`}>{bar(p.commerce,140)}<span className="au-fade" style={{opacity:0.5}}>trade</span></span>
            <span style={{display:"inline-flex",alignItems:"center",gap:3}} title={`expansionism ${(p.expansionism||0).toFixed(2)}`}>{bar(p.expansionism,265)}<span className="au-fade" style={{opacity:0.5}}>expand</span></span>
          </div>
        );
      })()}

      {/* ── Loyalty / control budget (overextension) ── */}
      {(()=>{
        const ctry=psw.countries&&psw.countries.get(s.countryId);
        if(!ctry||ctry.members.length<=1)return null;   // city-states have no internal control problem
        const isCap=ctry.capital&&ctry.capital.id===s.id;
        if(isCap){
          // The realm's overall control budget: load drawn vs capacity available.
          const cap=ctry._capacity,load=ctry._loadTotal;
          if(cap==null||load==null)return null;
          const over=load>cap;
          const pct=cap>0?Math.round(load/cap*100):0;
          // Why the budget is squeezed (capacity already reflects this).
          let strain="";
          if(ctry._capitalBesieged)strain=" · capital besieged";
          else if((ctry._fronts||0)>1)strain=` · ${ctry._fronts}-front war`;

          return(
            <>
            <button onClick={()=>{setRealmSel(s.countryId);setPanelTab("realms");if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"selectRealm",id:s.countryId});}}
              className="au-btn au-flat" style={{fontSize:10,padding:"2px 8px",marginBottom:5}}>→ open realm</button>
            {ctry.ruler&&(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:"hsl(280,40%,52%)",flexShrink:0}}/>
                <span><span className="au-fade">{(ctry.ruler.title||(ctry.ruler.female?"Queen":"King"))+" "}</span>{ctry.ruler.name}
                  <span className="au-fade"> of house </span>{ctry.ruler.house||"?"}
                  <span className="au-fade"> · age {ctry.ruler.age}</span></span>
              </div>
            )}
            {(()=>{const f=psw.faiths&&ctry.faithId>=0?psw.faiths.get(ctry.faithId):null;if(!f)return null;return(
              <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
                <span style={{width:9,height:9,borderRadius:2,background:`hsl(${f.hue|0},55%,50%)`,flexShrink:0}}/>
                <span className="au-fade">state faith <span style={{color:"var(--au-ink)"}}>{f.name}</span></span>
              </div>
            );})()}
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:2,background:over?"hsl(8,70%,52%)":"hsl(140,45%,45%)",flexShrink:0}}/>
              <span className="au-fade">control {load.toFixed(1)}/{cap.toFixed(1)} ({pct}%){over?" · over-extended":""}{strain}</span>
            </div>
            </>
          );
        }
        const loy=s.loyalty;
        if(loy==null)return null;
        const pct=Math.round(loy*100);
        const amb=s._ambition||0;
        // An ambitious governor (scheming to break away with his vassals) is the
        // more telling signal — show it instead of loyalty when it's brewing.
        if(amb>0.15){
          return(
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
              <span style={{width:9,height:9,borderRadius:2,background:"hsl(28,75%,50%)",flexShrink:0}}/>
              <span className="au-fade">ambitious governor · scheming {Math.round(amb*100)}%{amb>0.6?" · on the brink of revolt":""}</span>
            </div>
          );
        }
        const hue=loy>0.66?140:loy>0.33?42:8;   // green / amber / red
        const load=s._adminLoad;
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},60%,48%)`,flexShrink:0}}/>
            <span className="au-fade">loyalty {pct}%{loy<0.34?" · restless":""}{load!=null?` · admin load ${load.toFixed(2)}`:""}</span>
          </div>
        );
      })()}

      {/* ── The people's attachment (loyalty field, ontology V2) — the county's
             slow popular stock, distinct from the seat's administrative loyalty
             above. Ground that remembers a fallen nation shows the yearning. ── */}
      {(()=>{
        const a=s._attach;
        if(a==null)return null;
        const hue=a>0.66?140:a>0.33?42:8;
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},52%,46%)`,flexShrink:0}}/>
            <span className="au-fade">the people's attachment {Math.round(a*100)}%
              {s._homelandName?<> · remembers <span style={{color:"var(--au-ink)"}}>{s._homelandName}</span></>:""}</span>
          </div>
        );
      })()}

      {/* ── Active shock (plague / famine / siege) ── */}
      {(()=>{
        const shock=foodShockLabel(s);
        if(!shock)return null;
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${shock.hue},${shock.hue===280?55:80}%,${shock.hue===280?52:48}%)`,flexShrink:0}}/>
            <span className="au-fade">{shock.text}</span>
          </div>
        );
      })()}

      {/* ── Popular unrest (separate stock from loyalty) ── */}
      {(()=>{
        const u=s.unrest||0;
        if(u<0.15)return null;
        const hue=u>0.66?8:u>0.33?28:42;   // red / orange / amber as it climbs
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:`hsl(${hue},75%,50%)`,flexShrink:0}}/>
            <span className="au-fade">unrest {Math.round(u*100)}%{s._unrestCause?` · ${s._unrestCause}`:""}{u>0.8?" · on the verge of revolt":""}</span>
          </div>
        );
      })()}

      {/* ── Maritime (ports / sea trade / colonies) ── */}
      {(()=>{
        const isPort=!!s._isPort;
        const seaPeers=s._seaReachSize??(s._seaReach?s._seaReach.size:0);
        const sent=s._coloniesSent||0;
        const isColony=!!s._isColony;
        if(!isPort&&seaPeers===0&&sent===0&&!isColony)return null;
        const bits=[];
        if(isPort)bits.push("port");
        if(seaPeers>0)bits.push(`${seaPeers} sea route${seaPeers>1?"s":""}`);
        if(sent>0)bits.push(`${sent} colon${sent>1?"ies":"y"} sent`);
        if(isColony)bits.push("founded as a colony");
        return(
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,marginBottom:6}}>
            <span style={{width:9,height:9,borderRadius:2,background:"hsl(205,60%,52%)",flexShrink:0}}/>
            <span className="au-fade" style={{textTransform:"capitalize"}}>{bits.join(" · ")}</span>
          </div>
        );
      })()}

      {/* ── At-a-glance summary (always visible) ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <div>
          {hasCore?(<>
            <span style={{fontSize:18,fontWeight:600}}>{fmtPeople(cityPop)}</span>
            <span className="au-fade" style={{fontSize:9,marginLeft:3}}>in the city</span>
            <span className="au-fade" style={{fontSize:10,marginLeft:6}}>· {fmtPeople(s.people)} province</span>
          </>):(<>
            <span style={{fontSize:18,fontWeight:600}}>{fmtPeople(s.people)}</span>
            {K?<span className="au-fade" style={{fontSize:10}}> / {fmtPeople(K)}</span>:null}
            <span className="au-fade" style={{fontSize:9,marginLeft:3}}>catchment</span>
          </>)}
        </div>
        <span style={{fontSize:9,fontWeight:600,color:"#fff",background:statusColor,borderRadius:8,padding:"1px 8px",textTransform:"uppercase",letterSpacing:0.3}}>{status}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginTop:3}}>
        <div>
          <span style={{fontSize:13}} className="au-gold-text">{fmtGoldKg(s.wealth||0)}</span>
          <span className="au-fade" style={{fontSize:9,marginLeft:3}}>gold treasury</span>
        </div>
        <span className="au-fade" style={{fontSize:9}}>
          {isRegion?"rural · founds cities":nextName?`${Math.round(progress*100)}% → ${nextName}`:"max tier"}
        </span>
      </div>

      {/* ── Population & food ── */}
      <PsSection id="food" title="Population & food" open={psCardOpen.food} onToggle={togglePsCard}
        right={<span style={{color:statusColor}}>{surplus>=0?"+":""}{fmtFood(surplus)}</span>}>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"2px 8px",fontSize:10}}>
          <span className="au-fade">Grain stored</span><span>{fmtFood(s.food)}</span>
          {demand>0&&isFinite(ticksLeft)&&<><span className="au-fade">Store runway</span><span>{ticksLeft>=500?"500+":Math.round(ticksLeft)} tick{Math.round(ticksLeft)===1?"":"s"}</span></>}
          <span className="au-fade">Supply /tick</span><span title="Harvest + trade this tick — the city GROWS to this. Stores hold the core through a dip (Core fed avg); they do not grow it.">{fmtFood(supply)}</span>
          {haulPool > 0.001 && haulPool > supply * 1.05 && (
            <><span className="au-fade">Haul reach pool</span>
            <span title="If this market claimed every tradeable surplus tile within spoilage-limited haul range, how much grain would arrive per tick after transport falloff, haul decay (distance, tech, climate), and countryside eat-first — not what competitors bid away this tick.">{fmtFood(haulPool)}</span></>)}
          {landFood>0.001&&landFood!==supply&&<><span className="au-fade">· local harvest</span><span className="au-fade">{fmtFood(landFood)}</span></>}
          {(s._fishYield||0)>0.01&&(<><span className="au-fade">· of which fish</span><span className="au-fade">{fmtFood(s._fishYield||0)}</span></>)}
          {(s._pastoral||0)>0.01&&(<><span className="au-fade">· of which herds</span><span className="au-fade">{fmtFood(s._pastoral||0)}</span></>)}
          {importRate>0.001&&(<><span className="au-fade">Imported /tick</span><span>+{fmtFood(importRate)}</span></>)}
          <span className="au-fade">Consumed /tick</span><span title="What the city itself eats this tick (urban core + garrison), not the whole province">{fmtFood(demand)}</span>
          {coreNeed>0&&coreNeed<demand*0.98&&<><span className="au-fade">· urban core</span><span className="au-fade">{fmtFood(coreNeed)}</span></>}
          {fedM!=null&&<><span className="au-fade">Core fed (avg)</span><span>{Math.round(fedM*100)}%</span></>}
          <span style={{color:statusColor}}>Flow balance</span>
          <span style={{color:statusColor}} title="Supply − city requirement this tick. The granary holds the core through a dip (it does not grow the city).">{surplus>=0?"+":""}{fmtFood(surplus)} ({status})</span>
          <span className="au-fade">Territory</span><span>{farm} tile{farm===1?"":"s"}</span>
          <span className="au-fade">Capacity</span>
          <span>{fmtPeople(K)} <span className="au-fade" style={{fontSize:9}}>({limitedBy}-limited)</span></span>
          {(s.infrastructure||0)>1&&(<><span className="au-fade">· housing</span><span className="au-fade">{fmtPeople(s.infrastructure||0)}</span></>)}
          {limitedBy==="housing"&&((s._developRate||0)>0.001
            ?<><span style={{color:"#caa24a"}}>· building</span><span style={{color:"#caa24a"}}>+{fmtPeople(s._developRate||0)}/tk</span></>
            :<><span className="au-fade">· can't grow</span><span style={{color:"#c84"}}>{s._devReason==="space"?"no room (built out)":s._devReason==="materials"?"no timber/stone":s._devReason==="coin"?"can't afford materials":"—"}</span></>)}
          {limitedBy==="food"&&houseK>foodK*1.05&&(<><span className="au-fade">· could house</span><span className="au-fade">{fmtPeople(houseK)} if fed</span></>)}
          {nextThr&&<><span className="au-fade">To next tier</span><span>{fmtPeople(cityPop??s.people)}/{fmtPeople(nextThr)}</span></>}
          {(s.army||0)>0.5&&(<>
            <span className="au-fade">Garrison</span>
            <span>{fmtPeople(s.army)} <span className="au-fade" style={{fontSize:9}}>({((s.army||0)/Math.max(1,s.people)*100).toFixed(1)}% of catchment · fed from food ledger)</span></span>
          </>)}
        </div>
      </PsSection>

      {/* ── Knowledge ── */}
      <PsSection id="knowledge" title="Knowledge" open={psCardOpen.knowledge} onToggle={togglePsCard}
        right={<span className="au-fade" style={{textTransform:"capitalize"}}>{era}</span>}>
        <>
          <PsKRow label="Agriculture"  val={k.agriculture||0}  colour="#7a5"/>
          <PsKRow label="Construction" val={k.construction||0} colour="#a85"/>
          <PsKRow label="Organization" val={k.organization||0} colour="#967"/>
          <PsKRow label="Metallurgy"   val={k.metallurgy||0}   colour="#86a"
                note={!cu&&!fe?"(no ore)":(fe&&co?"(steel)":fe?"(iron)":(cu&&sn?"(bronze)":"(copper)"))}/>
          <PsKRow label="Navigation"   val={k.navigation||0}   colour="#58a"
                note={wa<=0?"(no water)":null}/>
          <PsKRow label="Mobility"     val={k.mobility||0}     colour="#a76"
                note={(r.horses||0)<=0.10?"(no horses)":null}/>
        </>
      </PsSection>

      {/* ── Technologies (Civ-like discovery layer, derived from knowledge) ── */}
      <PsSection id="tech" title="Technologies" open={psCardOpen.tech} onToggle={togglePsCard}
        right={<span className="au-fade">{ERAS[tech.era]} · {tech.count}/{TECHS.length}</span>}>
        <div style={{fontSize:10}}>
          <button onClick={()=>setTechTreeOpen(true)}
            style={{width:"100%",marginBottom:6,padding:"4px 6px",cursor:"pointer",borderRadius:4,
              background:"rgba(214,178,118,0.13)",border:"1px solid rgba(214,178,118,0.3)",color:"var(--au-ink)",fontSize:10.5}}>
            ⛬ Open tech tree
          </button>
          <div style={{display:"flex",flexWrap:"wrap",gap:"3px 4px"}}>
            {techList.map(t=>(
              <span key={t.id} title={ERAS[t.era]}
                style={{padding:"1px 5px",borderRadius:3,background:ERA_BG[t.era]||"#b9b2a4",color:"#1a140c",whiteSpace:"nowrap",fontSize:9.5}}>
                {t.name}
              </span>
            ))}
          </div>
          {techNext.length>0&&(
            <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid rgba(216,190,150,0.18)"}}>
              <div className="au-fade" style={{marginBottom:3,fontSize:9.5}}>Researching</div>
              {techNext.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{flex:"0 0 100px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{t.name}</span>
                  <div style={{flex:1,height:5,background:"rgba(80,60,30,0.22)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${(t.prog*100)|0}%`,height:"100%",background:ERA_BG[t.era]||"#8a6"}}/>
                  </div>
                  <span className="au-fade" style={{flex:"0 0 26px",textAlign:"right"}}>{(t.prog*100)|0}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PsSection>

      {/* ── Resources ── */}
      <PsSection id="resources" title="Resources" open={psCardOpen.resources} onToggle={togglePsCard}
        right={presentRes.length>0?<span className="au-fade">{presentRes.length}</span>:null}>
        {presentRes.length>0
          ?<div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1px 8px",fontSize:10}}>
              {presentRes.map(([id,v])=>(
                <Fragment key={id}><span>{RES_LABEL[id]||id}</span><span>{(v*100|0)}%</span></Fragment>
              ))}
            </div>
          :<span className="au-fade" style={{fontSize:10,fontStyle:"italic"}}>No notable deposits in reach.</span>}
      </PsSection>

      {/* ── Trade & economy ── */}
      <PsSection id="trade" title="Trade & economy" open={psCardOpen.trade} onToggle={togglePsCard}
        right={<span style={{color:moneyCol(wealthDelta)}}>{wealthDelta>=0?"+":""}{fmtGoldKg(wealthDelta)}/tick</span>}>
        <>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"2px 8px",fontSize:10}}>
            <span className="au-fade">Exchange</span>
            <span style={{color:available>0?"#caa24a":"#8a8f9c"}}>{available>0?"gold economy":"barter"}</span>
            <span style={{color:moneyCol(wealthDelta)}}>Net wealth /tick</span>
            <span style={{color:moneyCol(wealthDelta)}}>{wealthDelta>=0?"+":""}{fmtGoldKg(wealthDelta)}</span>
            <span className="au-fade">Gold held</span>
            <span style={available<=0?{color:"#8a8f9c"}:undefined} className="au-gold-text">{fmtGoldKg(s.wealth||0)}</span>
          </div>
          {/* ── Where the money comes from / goes ── categorised $/tick from
              the sim (mining, selling food, buying lumber, tribute, …). */}
          {(()=>{
            const inR=s._mInRate, outR=s._mOutRate, EPS=0.005;
            const ins=[], outs=[];
            if(inR)for(let i=0;i<inR.length;i++)if(inR[i]>EPS)ins.push([IN_LABELS[i],inR[i]]);
            if(outR)for(let i=0;i<outR.length;i++)if(outR[i]>EPS)outs.push([OUT_LABELS[i],outR[i]]);
            ins.sort((a,b)=>b[1]-a[1]); outs.sort((a,b)=>b[1]-a[1]);
            const totIn=ins.reduce((t,x)=>t+x[1],0), totOut=outs.reduce((t,x)=>t+x[1],0);
            if(ins.length===0&&outs.length===0)
              return <div className="au-fade" style={{fontSize:9,fontStyle:"italic",marginTop:4}}>No coin moving (barter / self-sufficient).</div>;
            return(
              <div style={{marginTop:5}}>
                <div className="au-fade" style={{fontSize:9}}>Gold in / out (/tick)</div>
                <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                  {ins.map(([l,v])=>(
                    <Fragment key={"i"+l}>
                      <span style={{color:"#3a7"}}>in</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                      <span style={{color:"#3a7"}}>+{fmtGoldKg(v)}</span>
                    </Fragment>
                  ))}
                  {outs.map(([l,v])=>(
                    <Fragment key={"o"+l}>
                      <span style={{color:"#c44"}}>out</span>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                      <span style={{color:"#c44"}}>-{fmtGoldKg(v)}</span>
                    </Fragment>
                  ))}
                  <span className="au-fade" style={{borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}>net</span>
                  <span className="au-fade" style={{borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}></span>
                  <span style={{color:moneyCol(totIn-totOut),borderTop:"1px solid var(--au-line,#0002)",marginTop:1}}>{totIn-totOut>=0?"+":""}{fmtGoldKg(totIn-totOut)}</span>
                </div>
              </div>
            );
          })()}
          {goodsBreakdown.length>0?(
            <div style={{marginTop:4}}>
              <div className="au-fade" style={{fontSize:9}}>Goods sold — by good ($/tick)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                {goodsBreakdown.map(([l,v])=>(
                  <Fragment key={"g"+l}>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l}</span>
                    <span style={{color:"#3a7"}}>+{v.toFixed(2)}</span>
                  </Fragment>
                ))}
              </div>
            </div>
          ):produces.length>0&&(
            <div className="au-fade" style={{fontSize:9,marginTop:3}}>Produces: {produces.join(", ")}</div>
          )}
          {profile.length===0
            ?<div className="au-fade" style={{fontSize:10,fontStyle:"italic",marginTop:4}}>No active trade routes.</div>
            :<>
              <div className="au-fade" style={{fontSize:9,marginTop:4}}>Routes (coin $/tick, or ⇄ barter)</div>
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto",gap:"1px 6px",fontSize:10,marginTop:1}}>
                {profile.slice(0,10).map(p=>{
                  const money=Math.abs(p.netPerTick)>0.005;
                  const rl=id=>(RES_LABEL[id]||id).toLowerCase();
                  const barter=p.give&&p.get?`${rl(p.give)} ⇄ ${rl(p.get)}`:p.give?`gives ${rl(p.give)}`:p.get?`wants ${rl(p.get)}`:"barter";
                  return(
                  <Fragment key={p.partnerId}>
                    <span style={{color:money?(p.netPerTick>=0?"#3a7":"#c66"):"#8a8f9c"}}>{money?(p.netPerTick>=0?"in":"out"):"⇄"}</span>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {p.partner}
                      {!money&&<span className="au-fade" style={{marginLeft:4,fontSize:9}}>({barter})</span>}
                      {p.foodRole&&<span style={{marginLeft:4,fontSize:9,color:p.foodRole==="selling food"?"#3a7":"#c84"}}>· {p.foodRole}</span>}
                    </span>
                    <span style={{color:money?(p.netPerTick>=0?"#3a7":"#c44"):"#8a8f9c"}}>{money?`${p.netPerTick>=0?"+":""}${p.netPerTick.toFixed(2)}`:"barter"}</span>
                  </Fragment>
                  );
                })}
              </div>
            </>}
          {/* ── Society & labour: economic archetype, craft specialty, coerced labour ── */}
          {(()=>{
            // Archetypes ranked on ONE consistent basis: an income label fires only
            // when its channel is BOTH the top income channel AND carries a real
            // share of total income (ARCH_MIN_SHARE) — no channel gets first-check
            // privilege (the old chain tested the slave trade first with no
            // minimum, so any town whose thin top channel happened to be slaves
            // read "Slaver city" ahead of everything else). Labour-STRUCTURE
            // labels (plantation/latifundia/serfdom) are judged on their own
            // labour thresholds, after the income labels.
            const a=s._mInRate; let topIdx=-1,topV=0,totIn=0; if(a)for(let i=0;i<a.length;i++){totIn+=a[i];if(a[i]>topV){topV=a[i];topIdx=i;}}
            const unfree=Math.round(s._unfree||0),captives=Math.round(s._captives||0),serf=s._serf||0,cashFrac=s._cashFrac||0,estates=s._estates||0;
            const ARCH_MIN_SHARE=0.25;   // an archetype is an economy the city LIVES ON — the channel must carry a quarter of its income
            let archetype=null;
            if(totIn>0&&topV/totIn>=ARCH_MIN_SHARE){
              if(topIdx===IN_SLAVE_TRADE)archetype="Slaver city — sells captives";
              else if(topIdx===IN_PILGRIM)archetype="Holy city — lives on pilgrims";
              else if(topIdx===IN_CARRY)archetype="Entrepôt — the carrying trade";
              else if(topIdx===IN_FINANCE)archetype="Financier — lends to the crown";
              else if(topIdx===IN_MINING)archetype=unfree>200?"Slave-worked mines":"Mining town";
            }
            if(!archetype){
              if(unfree>200&&cashFrac>0.2)archetype="Plantation economy";
              else if(unfree>200&&estates>0.4)archetype="Latifundia — slave-gang estates";
              else if(serf>0.3)archetype="Serf estate";
            }
            const spec=(s._specKey&&(s._specStr||0)>0.1)?[s._specKey,Math.round((s._specStr||0)*100)]:null;
            if(!archetype&&!spec&&unfree<50&&captives<50&&serf<0.1&&estates<0.15)return null;
            return(
              <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid var(--au-line,#0002)"}}>
                <div className="au-fade" style={{fontSize:9}}>Society & labour</div>
                {archetype&&<div style={{fontSize:10,color:"#caa24a",marginTop:1}}>{archetype}</div>}
                {spec&&<div style={{fontSize:10,marginTop:1}}>Specialises in <b>{spec[0]}</b> <span className="au-fade">({spec[1]}% established)</span></div>}
                {unfree>50&&<div style={{fontSize:10,marginTop:1,color:"#b06a4a"}}>Unfree labour: {unfree.toLocaleString()} <span className="au-fade">({Math.round((s._unfreeRatio||0)*100)}% of the population)</span></div>}
                {cashFrac>0.1&&<div style={{fontSize:10,marginTop:1}}>Cash crops: {Math.round(cashFrac*100)}% of land <span className="au-fade">(grows for export, imports food)</span></div>}
                {captives>50&&<div style={{fontSize:10,marginTop:1,color:"#b06a4a"}}>Captives held: {captives.toLocaleString()} <span className="au-fade">for the slave market</span></div>}
                {estates>0.15&&<div style={{fontSize:10,marginTop:1}}>Latifundia: {Math.round(estates*100)}% <span className="au-fade">of the land in elite estates</span></div>}
                {serf>0.1&&<div style={{fontSize:10,marginTop:1}}>Serfdom: {Math.round(serf*100)}% <span className="au-fade">bound peasantry</span></div>}
              </div>
            );
          })()}

          {/* ── Local market (goods-vector levers, T.GOODS_PRICES+): per-good
              scarcity prices, net trade flows, and where craft labour leans.
              Renders only when the goods layer is on (worker mirrors _gPrice). ── */}
          {s._gPrice&&(()=>{
            const P=s._gPrice,N=s._gNet,L=s._gShare;
            const col=p=>p>=1.5?"#e08a62":p<=0.6?"#6db56d":"#b8a482";
            const flows=N?GOODS.map((g,i)=>[g,N[i]]).filter(([,v])=>Math.abs(v)>0.01)
              .sort((x,y)=>Math.abs(y[1])-Math.abs(x[1])).slice(0,3):[];
            let lean=null;
            if(L){let ti=0;for(let i=1;i<L.length;i++)if(L[i]>L[ti])ti=i;if(L[ti]>0.35)lean=[["ore","metalwork","cloth","wares","services"][ti],Math.round(L[ti]*100)];}
            return(
              <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid var(--au-line,#0002)"}}>
                <div className="au-fade" style={{fontSize:9}}>Local market <span style={{opacity:.7}}>(dear = scarce here)</span></div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"1px 6px",fontSize:9.5,marginTop:2}}>
                  {GOODS.map((g,i)=><span key={g} style={{color:col(P[i]),fontVariantNumeric:"tabular-nums"}}>{g} ×{P[i].toFixed(1)}</span>)}
                </div>
                {flows.length>0&&<div style={{fontSize:10,marginTop:2}}>{flows.map(([g,v])=>`${v>0?"imports":"exports"} ${g}`).join(", ")}</div>}
                {lean&&<div style={{fontSize:10,marginTop:1}}>Craft labour leans to <b>{lean[0]}</b> <span className="au-fade">({lean[1]}%)</span></div>}
              </div>
            );
          })()}
        </>
      </PsSection>

      {/* ── Chronicle (the realm's history: foundings, wars, conquests,
          plagues, famines, discoveries, growth & wealth milestones) ── */}
      {(()=>{
        const chron=psw._chronicle;
        if(!chron||chron.countryId!==s.countryId||!chron.entries||!chron.entries.length)return null;
        // The log itself opens in its own scrollable window (a long history
        // doesn't fit the card); the section here is just an opener + the latest
        // event as a teaser.
        const latest=chron.entries[chron.entries.length-1];
        return(
          <PsSection id="chronicle" title="Chronicle" open={psCardOpen.chronicle} onToggle={togglePsCard}
            right={<span className="au-fade">{chron.entries.length}</span>}>
            <div style={{fontSize:10}}>
              <button onClick={()=>setChronicleOpen(true)}
                style={{width:"100%",marginBottom:5,padding:"4px 6px",cursor:"pointer",borderRadius:4,
                  background:"rgba(214,178,118,0.13)",border:"1px solid rgba(214,178,118,0.3)",color:"var(--au-ink)",fontSize:10.5}}>
                📜 Open chronicle ({chron.entries.length} events)
              </button>
              <div style={{display:"flex",gap:6,lineHeight:1.3}}>
                <span className="au-fade" style={{flexShrink:0,fontVariantNumeric:"tabular-nums"}}>{yr(latest.step)}</span>
                <span style={{color:CHRON_COL[latest.type]||"#b8a482"}}>{latest.text}</span>
              </div>
            </div>
          </PsSection>
        );
      })()}
    </div>
  );
};

const renderBoard=()=>{
  // Leaderboard. Pulls live data from the mirror (peopleRef.current) — same
  // structure draw() reads — so the panel always reflects the current snapshot.
  const psw=peopleRef.current;
  if(!psw||!psw.settlements)return null;
  const setts=psw.settlements.filter(s=>s&&s.mode==="settled");
  const countries=psw.countries?Array.from(psw.countries.values()):[];

  // Sort keys per mode. Functions return a number (descending sort).
  const SETT_SORTS={
    population:[s=>s.people,"Catchment pop",fmtPeople],
    wealth:[s=>s.wealth||0,"Wealth",fmtGoldKg],
    army:[s=>s.army||0,"Garrison",fmtPeople],
    mining:[s=>s._minedRate||0,"Mining rate",fmtGoldKg],
    vassals:[s=>s._vassalCount||0,"Vassals"],
    income:[s=>s._wealthDelta||0,"Income (gold/tick)",fmtGoldKg],
  };
  const CNT_SORTS={
    size:[c=>c.members?c.members.length:0,"Size (settlements)"],
    population:[c=>(c.members||[]).reduce((a,m)=>a+(m.people||0),0),"Catchment pop",fmtPeople],
    wealth:[c=>(c.members||[]).reduce((a,m)=>a+(m.wealth||0),0),"Total wealth",fmtGoldKg],
    treasury:[c=>c._treasury||0,"State treasury",fmtGoldKg],
    army:[c=>(c.members||[]).reduce((a,m)=>a+(m.army||0),0),"Standing army",fmtPeople],
    capacity:[c=>c._capacity||0,"Control capacity"],
  };
  const sorts=boardMode==="settlements"?SETT_SORTS:CNT_SORTS;
  const sortKey=sorts[boardSort]?boardSort:Object.keys(sorts)[0];
  const [sortFn,sortLabel,sortFmt]=sorts[sortKey];
  const q=boardQuery.trim().toLowerCase();
  const nameOf=(r)=>boardMode==="settlements"?(r.name||""):(r.name||(r.capital&&r.capital.name)||"");
  const rows=(boardMode==="settlements"?setts:countries).slice()
    .filter(r=>!q||nameOf(r).toLowerCase().includes(q))
    .sort((a,b)=>sortFn(b)-sortFn(a)).slice(0,q?200:30);

  const fmt=v=>{
    if(!isFinite(v))return "-";
    const a=Math.abs(v);
    if(a>=1e6)return (v/1e6).toFixed(1)+"M";
    if(a>=1e3)return (v/1e3).toFixed(1)+"k";
    if(a>=10)return Math.round(v).toString();
    return v.toFixed(1);
  };

  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"8px 0"}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:6,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12.5}}>The realms of the world</span>
        <div style={{flex:1}} />
      </div>
      <div style={{display:"flex",gap:4,padding:"0 12px 6px"}}>
        {[["countries","Realms"],["settlements","Settlements"]].map(([m,l])=>(
          <button key={m} onClick={()=>setBoardMode(m)}
            className={"au-rail-tab"+(boardMode===m?" au-active":"")}
            style={{flex:1,fontSize:11}}>{l}</button>
        ))}
      </div>
      <div style={{padding:"0 12px 6px"}}>
        <input type="search" value={boardQuery} onChange={e=>setBoardQuery(e.target.value)}
          placeholder="search by name…" style={{width:"100%",fontSize:11.5,padding:"3px 8px",
            background:"rgba(0,0,0,0.28)",border:"1px solid rgba(216,190,150,0.25)",color:"var(--au-ink)",borderRadius:3}}/>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:3,padding:"0 12px 6px"}}>
        {Object.entries(sorts).map(([k,[,label]])=>(
          <button key={k} onClick={()=>setBoardSort(k)}
            className={"au-rail-tab"+(sortKey===k?" au-active":"")}
            style={{fontSize:10,padding:"3px 7px",textTransform:"none"}}>{label}</button>
        ))}
      </div>
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
        <thead>
          <tr style={{color:"var(--au-fade)",textAlign:"left"}}>
            <th style={{padding:"2px 6px 2px 12px",width:24}}>#</th>
            <th style={{padding:"2px 4px"}}>{boardMode==="settlements"?"Settlement":"Country"}</th>
            <th style={{padding:"2px 12px 2px 4px",textAlign:"right"}}>{sortLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r,i)=>{
            if(boardMode==="settlements"){
              const ctry=psw.countries&&psw.countries.get(r.countryId);
              const hue=((r.countryId*61)%360+360)%360;
              return(
                <tr key={r.id}
                  onClick={()=>navigate({tab:"inspect",sett:r.id})}
                  style={{cursor:"pointer",borderTop:"1px solid rgba(216,190,150,0.09)"}}>
                  <td style={{padding:"3px 6px 3px 12px",color:"var(--au-fade)"}}>{i+1}</td>
                  <td style={{padding:"3px 4px"}}>
                    <span style={{display:"inline-block",width:7,height:7,borderRadius:2,
                      background:`hsl(${hue},55%,50%)`,marginRight:6,verticalAlign:"middle"}}/>
                    <span style={{textTransform:"capitalize"}}>{r.name}</span>
                    {ctry&&ctry.capitalId===r.id&&<span style={{color:"var(--au-fade)",marginLeft:4}}>· capital</span>}
                  </td>
                  <td className="au-num" style={{padding:"3px 12px 3px 4px",textAlign:"right"}}>{(sortFmt||fmt)(sortFn(r))}</td>
                </tr>
              );
            }
            const cap=r.capital||(r.members&&r.members[0]);
            const arms=emblemURLFor(r.id);
            const hue=((r.id*61)%360+360)%360;
            return(
              <tr key={r.id}
                onClick={()=>navigate({tab:"realms",realm:r.id})}
                style={{cursor:"pointer",borderTop:"1px solid rgba(216,190,150,0.09)"}}>
                <td style={{padding:"3px 6px 3px 12px",color:"var(--au-fade)"}}>{i+1}</td>
                <td style={{padding:"3px 4px"}}>
                  {arms
                    ?<img src={arms} alt="" style={{height:15,verticalAlign:"middle",marginRight:6,filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.25))"}}/>
                    :<span style={{display:"inline-block",width:7,height:7,borderRadius:2,
                      background:`hsl(${hue},55%,50%)`,marginRight:6,verticalAlign:"middle"}}/>}
                  <span style={{textTransform:"capitalize"}}>{r.name||(cap?cap.name:"realm-"+r.id)}</span>
                </td>
                <td className="au-num" style={{padding:"3px 12px 3px 4px",textAlign:"right"}}>{(sortFmt||fmt)(sortFn(r))}</td>
              </tr>
            );
          })}
          {rows.length===0&&<tr><td colSpan={3} style={{padding:"10px 12px",color:"var(--au-fade)",fontStyle:"italic"}}>no data yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

const renderCharts=()=>{
  const H=psHistoryRef.current;
  const copy=()=>{ const t=buildHistoryExport(H);
    try{navigator.clipboard.writeText(t);}catch{/* clipboard blocked — ignore */}
    setStatsCopied(true); setTimeout(()=>setStatsCopied(false),1500); };
  const curStep=H.length?H[H.length-1].step:0;
  return(
    <div className="au-scroll" style={{flex:1,minHeight:0,overflowY:"auto",padding:"8px 0"}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:4,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12}}>History</span>
        <span className="au-fade" style={{fontSize:9,marginLeft:6}}>step {curStep}</span>
        <div style={{flex:1}} />
      </div>
      {(()=>{const F=peopleRef.current&&peopleRef.current._feed;if(!F||!F.length)return null;
        // The living feed (plan §8): category filter chips over the structured
        // event stream; click an entry to jump the camera to where it happened.
        // No inner scroll — the feed flows in the tab's single scroll.
        const active=feedCats;
        const tog=(id)=>setFeedCats(prev=>{const n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});
        const rows=[];
        for(let i=F.length-1;i>=0&&rows.length<40;i--){
          const e=F[i];const m=evMeta(e.type);
          if(active.size&&!active.has(m.cat))continue;
          rows.push({e,m,key:i});
        }
        return <div style={{padding:"0 10px 8px"}}>
          <div className="au-heading au-sc au-fade" style={{fontSize:10,marginBottom:4}}>The living feed</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:6}}>
            {EV_CATS.map(([id,label,col])=>(
              <button key={id} onClick={()=>tog(id)}
                className={"au-filter"+(active.has(id)?" au-active":"")}
                style={active.has(id)?{borderColor:col,color:col}:{borderColor:"rgba(216,190,150,0.3)",color:"var(--au-ink-faded)"}}
                title={active.size?"filtering — click to toggle":"click to filter to "+label}>{label}</button>
            ))}
            {active.size>0&&<button className="au-filter" style={{borderColor:"rgba(216,190,150,0.3)",color:"var(--au-ink-faded)"}}
              onClick={()=>setFeedCats(new Set())}>× all</button>}
          </div>
          {rows.map(({e,m,key})=>(
            <div key={key} onClick={()=>jumpTo(e.x,e.y)}
              style={{fontSize:11,padding:"2.5px 0",cursor:e.x!=null?"pointer":"default",borderBottom:"1px solid rgba(216,190,150,0.08)",lineHeight:1.4,display:"flex",gap:6}}
              title={e.x!=null?"Jump to where it happened":undefined}>
              <span style={{color:evCatColor(m.cat),flexShrink:0,width:12,textAlign:"center"}}>{m.icon}</span>
              <span style={{minWidth:0}}><span className="au-fade" style={{marginRight:5,fontVariantNumeric:"tabular-nums"}}>{yr(e.step)}</span>{e.text}</span>
            </div>))}
          {rows.length===0&&<div className="au-fade" style={{fontSize:11,fontStyle:"italic"}}>Nothing in these categories yet.</div>}
        </div>;})()}
      <MiniChart data={H} get={d=>d.pop}            label="Catchment population (Σ settlement catchments)" color="#c98a3a" fmtY={fmtPeople}/>
      <MiniChart data={H} get={d=>d.gold}           label="Gold by weight (coin + treasuries)" color="#d8b13a" fmtY={fmtGoldKg}/>
      <MiniChart data={H} get={d=>d.landPct*100}    label="Land claimed"             color="#5a9367" fmtY={v=>v.toFixed(0)+"%"}/>
      <MiniChart data={H} get={d=>d.countries}      label="Countries"                color="#7a6da8" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>(d.towns||0)+d.cities+d.metros} label="Cities + metropolises"   color="#b5562f" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>d.sett}           label="Settlements"              color="#8a8f9c" fmtY={v=>Math.round(v).toString()}/>
      <MiniChart data={H} get={d=>d.largest}        label="Largest empire (tiles)"   color="#4a78a8" fmtY={v=>Math.round(v).toLocaleString()}/>
      <div style={{padding:"6px 10px 2px",borderTop:"1px solid rgba(216,190,150,0.12)",marginTop:4}}>
        <button onClick={copy} className="au-rail-tab au-active" style={{width:"100%",fontSize:11,padding:"5px 0"}}>
          {statsCopied?"Copied ✓":"Copy stats rundown"}
        </button>
        <div className="au-fade" style={{fontSize:9,marginTop:3,lineHeight:1.35}}>
          Copies a markdown table of the run so far (~40 rows) — paste it back for a full breakdown over time.
        </div>
      </div>
    </div>
  );
};

return(
<div className="au-root" style={{width:"100vw",height:"100vh",
  background:"var(--au-table-dark)",overflow:"hidden",display:"flex",flexDirection:"column",position:"relative"}}>

{/* ══════════ TOP BAR (chrome — the player's controls) ══════════ */}
<header className="au-chrome au-glass" style={{display:"flex",alignItems:"center",gap:10,margin:"6px 6px 0",padding:"5px 12px",flexShrink:0,zIndex:45,position:"relative",minHeight:44}}>
  <button onClick={togglePlay} className={"au-btn"+(playing?" au-wax au-active":"")}
    style={{padding:"5px 15px",fontSize:14,fontFamily:"'Cinzel',Georgia,serif"}} title="Play / pause — Space">{playing?"❚❚":"▶"}</button>
  <div style={{display:"flex",gap:1}}>
    {/* speed = target ticks/sec. 30 ≈ one step per frame (the step counter ticks
        up one-by-one); lower watches it crawl, higher packs more per frame, Max
        runs flat-out. Narrow screens keep just the two useful stops. */}
    {(narrow?[[30,"1×"],[100000,"Max"]]:[[8,"¼×"],[30,"1×"],[120,"4×"],[480,"16×"],[100000,"Max"]]).map(([v,l])=>(
      <button key={v} onClick={()=>{setSpeed(v);speedRef.current=v;}}
        className={"au-btn au-flat au-num"+(speed===v?" au-active":"")} style={{padding:"3px 9px",fontSize:12}}
        title={v>=100000?"as fast as possible":`~${v} ticks/sec`}>{l}</button>
    ))}
  </div>
  <span className="au-vrule" style={{height:22}}/>
  {/* era ribbon — the one place time appears; a read-only label, never an input */}
  <span className="au-era" title="The ERA — derived from the most advanced court's actual knowledge. This is the honest anchor for comparing the map against real history." style={{fontSize:narrow?13:15,color:"var(--au-ch-gold)",whiteSpace:"nowrap"}}>{_era}</span>
  {_arcComplete&&<span className="au-era" title="The leading civilisation has climbed the whole knowledge tree — the developmental arc is complete." style={{fontSize:11,color:"var(--au-ch-gold)",fontWeight:700,letterSpacing:0.3}}>✦</span>}
  <span className="au-year au-num" title="The display calendar — a uniform clock, cosmetic only. The world develops at its own pace, so this year drifts from real-history development; trust the era, not the year." style={{fontSize:narrow?12:13.5,whiteSpace:"nowrap"}}>{_ys}</span>
  {/* Belt share — the atlas-gap wave's core ratio, live: the leading contact-
      connected belt of states vs all claimed land. History's Old World belt
      held 75-80% of state land until ~1800 (docs/atlas-gap-2026-08-14.md). */}
  {psStats.beltShare>0&&!narrow&&<span className="au-num au-fade" title={`The leading BELT of states (within ~1000 km contact of one another) holds ${Math.round(psStats.beltShare*100)}% of all claimed land, across ${psStats.beltCount} belt${psStats.beltCount===1?"":"s"} worldwide. History: the Old World belt held 75-80% of state land until ~1800.`}
    style={{fontSize:11,whiteSpace:"nowrap"}}>⚑{Math.round(psStats.beltShare*100)}%</span>}
  {/* Quiet-ages chip: the sim is fast-forwarding the pre-nation ages. */}
  {quietAges&&playing&&<span className="au-num" onClick={()=>setAutoEpoch(a=>!a)}
    title={fastEpoch?"The ages before the first NATION fly by — Max speed until a realm rises (first cities still mint on camera). Click to turn auto-speed off.":"Auto-speed for the pre-nation ages is OFF — the sim follows your speed dial. Click to re-enable fast-forward."}
    style={{fontSize:11,color:fastEpoch?"var(--au-ch-gold)":"inherit",opacity:fastEpoch?1:0.55,cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>⏩ prehistory</span>}
  {/* Stale-tab chip: this tab runs an older bundle than the one deployed. */}
  {staleBuild&&<span className="au-num" onClick={()=>{if(window.confirm("A newer build is deployed. Reload now?\n\nSAVE YOUR WORLD FIRST — reloading discards an unsaved world."))window.location.reload();}}
    title="A newer build of the app is deployed than the one this tab is running. Click to reload — SAVE YOUR WORLD FIRST (reloading discards an unsaved world). A long-lived tab keeps the code it loaded with; updates only arrive on reload."
    style={{fontSize:11,color:"var(--au-ch-gold)",cursor:"pointer",whiteSpace:"nowrap",fontWeight:700}}>⟳ update</span>}
  {/* World-physics chip: a LOADED world keeps the physics regime it was born
      under (the save guards pin its tuning) — otherwise new defaults look
      like updates that "didn't take". */}
  {psStats.saveV!=null&&psStats.saveV<SAVE_VERSION&&<span className="au-num au-fade"
    title={`This world was loaded from a save born under physics v${psStats.saveV}; the app ships v${SAVE_VERSION}. Loaded worlds KEEP the physics they were born under (swapping physics mid-run would corrupt the run) — generate a NEW world to play the current physics.`}
    style={{fontSize:11,whiteSpace:"nowrap"}}>physics v{psStats.saveV}</span>}
  <span className="au-vrule" style={{height:22}}/>
  {/* TIMELINE — scrub the political map through the run's keyframes (worker
      captures one every 500 steps). Drag = ask the worker for the nearest
      keyframe; LIVE returns to the present. */}
  {(()=>{const tlN=simWorkerRef.current?((peopleRef.current&&peopleRef.current._timelineN)||0):frameCount(fbTimelineRef.current);
    return <input type="range" min={0} max={Math.max(1,tlN-1)} step={1} value={scrubStep??Math.max(0,tlN-1)}
    onChange={(ev)=>{const idx=+ev.target.value;
      if(playRef.current){playRef.current=false;setPlaying(false);}  // scrubbing pauses history
      setScrubStep(idx);scrubRef.current=true;
      if(simWorkerRef.current){simWorkerRef.current.postMessage({type:"scrub",idx});}
      else{const psw=peopleRef.current;if(psw){const fr=frameAt(fbTimelineRef.current,idx,psw.N);
        if(fr){psw._scrubClaim=fr.claim;setScrubShown(fr.step);if(drawNowRef.current)drawNowRef.current();}}}}}
    style={{width:narrow?80:170,accentColor:"var(--au-ch-gold)"}}
    title="Timeline — one frame per ~year; drag to scrub the political map through history"/>;})()}
  {scrubStep!=null&&<>
    <span className="au-num" style={{fontSize:11,color:"var(--au-ch-gold)",whiteSpace:"nowrap"}}>{"t="+(scrubShown??scrubStep)}</span>
    <button className="au-btn au-flat" style={{padding:"2px 8px",fontSize:11}}
      title="Return to the live map"
      onClick={()=>{setScrubStep(null);setScrubShown(null);scrubRef.current=false;
        const psw=peopleRef.current;
        if(psw){psw._scrubClaim=null;psw._claimVer=(psw._claimVer||0)+1;}
        if(drawNowRef.current)drawNowRef.current();
        playRef.current=true;setPlaying(true);}}>LIVE ▶</button>
  </>}
  {!narrow&&<button className="au-btn au-flat" title="Download the run journal (text) — metrics every 250 steps + telemetry-funnel windows + seed/levers provenance. Paste it to Claude to let it observe this run."
    style={{padding:"2px 6px",fontSize:11}}
    onClick={()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'exportRunLog'});}}>⤓ log</button>}
  {!narrow&&<button className="au-btn au-flat" title="Download the full run report (HTML) — everything in the log PLUS a political-map image every ~1000 steps. One self-contained file for you and for Claude."
    style={{padding:"2px 6px",fontSize:11}}
    onClick={()=>{if(simWorkerRef.current)simWorkerRef.current.postMessage({type:'exportRunReport'});}}>⤓ report</button>}
  {!narrow&&<select className="au-btn au-flat au-num" value={minKm2} title="Atlas bar — hide nations smaller than this (nations with settlements always show)"
    onChange={(ev)=>setMinKm2(+ev.target.value)} style={{padding:"2px 4px",fontSize:11}}>
    <option value={0}>all nations</option>
    <option value={5000}>≥5k km²</option>
    <option value={20000}>≥20k km²</option>
    <option value={100000}>≥100k km²</option>
    <option value={500000}>≥500k km²</option>
  </select>}
  {!narrow&&<>
    <span className="au-cfade au-num" style={{fontSize:11}}>step {_step.toLocaleString()}</span>
    <span className="au-vrule" style={{height:22}}/>
    <span className="au-num" style={{fontSize:13}} title={`${_nationCount} sovereign nations (suzerainty blocs); the full register holds ${_countryCount} states incl. vassals & tributaries${_warCount?`; ${_warCount} wars being fought right now`:""}`}>{_nationCount} <span className="au-sc au-cfade" style={{fontSize:11}}>nations</span>{_countryCount>_nationCount&&<span className="au-cfade" style={{fontSize:11}}> · {_countryCount} states</span>}{_warCount>0&&<span style={{fontSize:11,color:"#c8442c"}}> · ⚔ {_warCount}</span>}</span>
    <span className="au-num" style={{fontSize:13}}>{Math.round((psStats.landPct||0)*100)}<span className="au-cfade">%</span> <span className="au-sc au-cfade" style={{fontSize:11}}>claimed</span></span>
    {lens==="economy"&&(()=>{
      const psw=peopleRef.current;
      const P=psw&&isFinite(psw.globalP)?psw.globalP:null;
      if(P==null)return null;
      const col=P>1.1?"var(--au-ch-bad)":P<0.9?"hsl(195,55%,60%)":"var(--au-ch-text)";
      return <span className="au-num" style={{fontSize:13}} title={`global price level ×${P.toFixed(2)}`}>
        <span className="au-sc au-cfade" style={{fontSize:11,marginRight:4}}>wheat</span>
        <span style={{color:col,fontWeight:700}}>{(5*P).toFixed(2)}</span></span>;
    })()}
  </>}
  <div style={{flex:1,minWidth:0}}/>
  {/* Build identity — RIGHT of the chrome, always visible (was mid-bar and easy
      to miss / clip). Bundle truth: SAVE_VERSION + __BUILD_SHA__. Click → builds picker. */}
  <a className="au-num" href="/Simman-/builds/"
    title={`This tab runs physics v${SAVE_VERSION}, bundle ${buildSha}${buildInfo&&buildInfo.branch?` · ${buildInfo.channel==="live"?"LIVE":"preview"} of ${buildInfo.branch}`:""}. Click for the builds picker. Mint-ready open needs v63+; invent-only foresight was v62.`}
    style={{fontSize:11,fontWeight:700,color:"var(--au-ch-gold)",border:"1px solid rgba(216,177,58,0.45)",borderRadius:3,padding:"2px 8px",cursor:"pointer",whiteSpace:"nowrap",textDecoration:"none",flexShrink:0,fontVariantNumeric:"tabular-nums",letterSpacing:0.2}}
    >build v{SAVE_VERSION} · {buildShort}</a>
  <TopBarBell feedRef={peopleRef} onOpenFeed={()=>{setPanelTab("world");setRealmSel(-1);if(narrowRef.current)setCodexOpen(true);}}/>
  {narrow&&<button onClick={()=>setCodexOpen(v=>!v)} className={"au-btn au-flat"+(codexOpen?" au-active":"")}
    style={{fontSize:13,padding:"3px 8px"}} title="The codex — realms, peoples, events">📖</button>}
  <button onClick={()=>setNewWorldOpen(true)} className="au-btn au-flat" style={{fontSize:12.5,padding:"3px 8px"}}
    title="New world — presets, seed, import">{narrow?"⊕":"⊕ World"}</button>
  {!narrow&&<button onClick={()=>{setEditorOpen(v=>!v);if(editorArmed)setEditorArmed(false);}} className={"au-btn au-flat"+(editorOpen?" au-active":"")}
    style={{fontSize:12.5,padding:"3px 8px"}} title="Country editor — place a seed capital with chosen tech & character">🏛 Editor</button>}
  <button onClick={()=>setMenuOpen(v=>!v)} className={"au-btn au-flat"+(menuOpen?" au-active":"")}
    style={{fontSize:14,padding:"3px 10px"}} title="Save / load / export / advanced">≡</button>
</header>
<input ref={saveFileRef} type="file" accept=".json" style={{display:"none"}}
        onChange={async(e)=>{
          const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;
          try{
            const json=await f.text();
            const meta=JSON.parse(json).meta;
            if(!meta)throw new Error("not a Simman save");
            pendingSaveRef.current=json;
            presetRef.current=meta.preset;setPreset(meta.preset);
            oceanLevelRef.current=meta.oceanLevel??0.78;
            // The DISPLAYED terrain must be rebuilt with the save's own wind
            // identity, not whatever the toggle happens to be — otherwise the
            // rendered map and the simulated terrain diverge tile-by-tile,
            // and the next save would be stamped with the wrong identity.
            const _rw=!!meta.realWind;
            if(useRealWindRef.current!==_rw){setUseRealWind(_rw);useRealWindRef.current=_rw;}
            if(meta.seed===seed)generate(seed);else setSeed(meta.seed);
          }catch(err){console.error("load failed:",err);alert("Could not load save: "+err.message);}
        }}/>

<div style={{flex:1,display:"flex",minHeight:0,position:"relative"}}>

{/* ══════════ LENS DOCK (56px icon rail; flyout carries sub-lenses) ══════════ */}
<aside className="au-chrome" style={{width:narrow?46:58,minWidth:narrow?46:58,margin:narrow?"4px 2px 4px 4px":"6px 3px 6px 6px",
  padding:"6px 0",display:"flex",flexDirection:"column",position:"relative",zIndex:"var(--z-docks)"}}
  onMouseLeave={()=>setDockFly(null)}>
  {LENSES.map((L,li)=>(
    <button key={L.id}
      onClick={()=>{pickLens(L.id);setDockFly(L.subs.length>1?L.id:null);}}
      onMouseEnter={()=>{if(dockFly!==null||L.subs.length>1)setDockFly(L.subs.length>1?L.id:null);}}
      className={"au-dock-btn"+(lens===L.id?" au-active":"")}
      title={`${L.label} — key ${li+1}`}>
      <span className="au-dock-ico">{L.icon}</span>
      <span className="au-dock-lbl">{L.label}</span>
    </button>
  ))}
  <div className="au-rule" style={{margin:"5px 8px"}}/>
  <button onClick={()=>{setLayersOpen(v=>!v);setDockFly(null);}}
    className={"au-dock-btn"+(layersOpen?" au-active":"")} title="Map layers — L">
    <span className="au-dock-ico">🗂</span><span className="au-dock-lbl">Layers</span></button>
  <button onClick={()=>setShowGlobe(!showGlobe)}
    className={"au-dock-btn"+(showGlobe?" au-active":"")} title="3D globe — G">
    <span className="au-dock-ico">🌍</span><span className="au-dock-lbl">Globe</span></button>
  <button onClick={()=>setHelpOpen(v=>!v)}
    className={"au-dock-btn"+(helpOpen?" au-active":"")} title="Keys & help — ?">
    <span className="au-dock-ico">✳</span><span className="au-dock-lbl">Help</span></button>
  <div style={{flex:1}}/>
  <a href="/Simman-/builds/" title={`build v${SAVE_VERSION} · ${buildSha} — click for builds picker`}
    style={{display:"block",textAlign:"center",textDecoration:"none",color:"var(--au-ch-gold)",fontSize:9,fontWeight:700,lineHeight:1.2,padding:"4px 2px",flexShrink:0}}>
    <span className="au-num" style={{display:"block"}}>v{SAVE_VERSION}</span>
    <span className="au-num" style={{display:"block",opacity:0.75,fontWeight:600}}>{buildShort}</span>
  </a>
  <span className="au-cfade au-num" style={{fontSize:9,textAlign:"center"}} title="World seed">{seed}</span>

  {/* flyout: the active-hovered lens's sub-lenses */}
  {dockFly&&(()=>{
    const L=LENSES.find(x=>x.id===dockFly);if(!L||L.subs.length<2)return null;
    const li=LENSES.indexOf(L);
    const psw=peopleRef.current;
    return(
      <div className="au-chrome au-glass" style={{position:"absolute",left:60,top:6+li*44,minWidth:128,
        padding:"5px 0",zIndex:"var(--z-popovers)"}}>
        <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"2px 12px 4px"}}>{L.label}</div>
        {L.subs.map(([v,l])=>{
          const lock=subLockReason(v,psw,psStats);
          return(
          <button key={v} onClick={()=>{if(lock)return;pickSub(v,L.id);}}
            className={"au-rail-tab"+(viewMode===v?" au-active":"")}
            style={{fontSize:12,opacity:lock?0.42:1,cursor:lock?"default":"pointer"}}
            title={lock||undefined}>{l}{lock?" ·🔒":""}</button>);
        })}
      </div>
    );
  })()}
</aside>

{/* ══════════ CENTER COLUMN ══════════ */}
<div style={{flex:1,display:"flex",flexDirection:"column",padding:"6px 3px",gap:6,minWidth:0}}>

{/* Map area */}
<div style={{flex:1,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",minHeight:0,overflow:"hidden"}}>

{showGlobe?
  <div style={{width:"100%",aspectRatio:"4/3",maxHeight:"100%"}}>
    <GlobeView terrainBuf={globeBuf} version={globeVer} world={world} CW={globeTexSize.w} CH={globeTexSize.h} />
  </div>:
  // The map canvas and the fixed-resolution feature canvas share one aspect-locked box so the
  // feature overlay covers the map EXACTLY (both fill it; identical aspect ratio ⇒ perfect
  // registration). The map is pixelated (coarse terrain upscales blocky); the feature overlay is
  // smooth (crisp lines). pointer-events on the overlay pass through to the map for hit-testing.
  // Mouse/touch mapping reads the CANVAS bounding rect, so the box may be clipped by a parent
  // without breaking hit-tests.
  //   Desktop: the box fits INSIDE the column (contain) — width:100% + aspect-ratio + max sizes.
  //   Narrow:  the box COVERS the column (height:100%, centred, parent clips) — a phone shows a
  //   screen-filling slice of the world and pans, instead of a letterboxed strip.
  <div style={narrow?{position:"relative",width:"100%",height:"100%",overflow:"hidden"}
    :{position:"relative",lineHeight:0,width:"100%",height:"auto",aspectRatio:`${CW}/${CH}`,
      maxWidth:"100%",maxHeight:"100%",boxShadow:"0 8px 36px rgba(0,0,0,0.7)",border:"1px solid var(--au-paper-deep)"}}>
  <div style={narrow?{position:"absolute",top:0,bottom:0,left:"50%",transform:"translateX(-50%)",
      height:"100%",aspectRatio:`${CW}/${CH}`,lineHeight:0}
    :{position:"absolute",inset:0,lineHeight:0}}>
  <canvas ref={canvasRef} width={CW} height={CH}
    onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave} onClick={onCanvasClick}
    onMouseDown={onCanvasMouseDown} onDoubleClick={resetView}
    style={{display:"block",imageRendering:"pixelated",width:"100%",height:"100%",touchAction:"none"}} />
  <canvas ref={featRef} width={FEAT_W} height={FEAT_H}
    style={{position:"absolute",left:0,top:0,width:"100%",height:"100%",pointerEvents:"none"}} />
  </div>
  </div>
}

{/* ─── Country editor panel ─── */}
{editorOpen&&<div className="au-chrome au-glass" style={{position:"absolute",top:48,left:8,width:232,
  maxHeight:"calc(100% - 64px)",overflowY:"auto",padding:"8px 10px",fontSize:12,zIndex:_zOf("editor"),borderColor:"var(--au-ch-wax)"}}>
  <div className="au-heading au-sc" style={{fontSize:11,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <span>Country Editor</span>
    <span onClick={()=>{setEditorOpen(false);setEditorArmed(false);}} style={{cursor:"pointer"}}>✕</span>
  </div>
  <button onClick={()=>setEditorArmed(v=>!v)} className={"au-rail-tab"+(editorArmed?" au-active":"")}
    style={{width:"100%",fontSize:11,padding:"5px 0",marginBottom:7}}>
    {editorArmed?"● Click a land tile to place":"Arm placement"}</button>
  <EdRow label="Capital size (people)" value={edParams.people} min={500} max={8000} step={50}
    onChange={v=>setEdParams(p=>({...p,people:v}))} fmt={v=>Math.round(v)}/>
  <div className="au-fade" style={{margin:"6px 0 2px",fontWeight:600,fontSize:10}}>Knowledge / tech</div>
  {ED_KFIELDS.map(([k,l])=><EdRow key={k} label={l} value={edParams.knowledge[k]} min={0} max={1} step={0.05}
    onChange={v=>setEdParams(p=>({...p,knowledge:{...p.knowledge,[k]:v}}))} fmt={v=>(v*100|0)+"%"}/>)}
  <div className="au-fade" style={{margin:"6px 0 2px",fontWeight:600,fontSize:10}}>Character (−1 … +1)</div>
  {ED_PFIELDS.map(([k,l])=><EdRow key={k} label={l} value={edParams.personality[k]} min={-1} max={1} step={0.05}
    onChange={v=>setEdParams(p=>({...p,personality:{...p.personality,[k]:v}}))} fmt={v=>v.toFixed(2)}/>)}
  <div className="au-fade" style={{fontSize:9,marginTop:7,fontStyle:"italic"}}>
    Arm, then click a land tile: a fully-formed realm appears, filled with cities out to the extent its tech allows it to hold. Drop several to compare. (Takes a moment to settle.)</div>
</div>}

{/* ─── Pico hover card — identity first, terrain second (plan §5.3) ─── */}
{hoverInfo&&<div className="au-parchment au-pico"
  style={{left:hoverInfo.x+14,top:hoverInfo.y-12}}>
  {(()=>{   // identity block: settlement › realm, with the realm's arms
    const psw=peopleRef.current;
    const ctry=hoverInfo.realmId>=0&&psw&&psw.countries?psw.countries.get(hoverInfo.realmId):null;
    const emblem=ctry?realmEmblemURL(psw,ctry,terRef.current,worldRef.current?worldRef.current.seed:0):null;
    if(!hoverInfo.sett&&!ctry)return null;
    const tierName=hoverInfo.sett?(SIM_T.CITY_CORE&&SIM_T.DISSOLVE_FARMS?TIER_NAME_CORE:["farming region","town","city","metropolis"])[hoverInfo.sett.tier]||"settlement":null;
    return(<div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4,paddingBottom:4,borderBottom:"1px solid rgba(216,190,150,0.18)"}}>
      {emblem&&<img src={emblem} alt="" style={{height:26,flexShrink:0,filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.3))"}}/>}
      <div style={{minWidth:0}}>
        {hoverInfo.sett&&<div className="au-pico-title" style={{textTransform:"capitalize"}}>
          {hoverInfo.sett.name}{hoverInfo.sett.isCap?" ★":""}</div>}
        {hoverInfo.sett&&<div className="au-fade" style={{fontSize:11,textTransform:"capitalize"}}>
          {tierName} · {fmtUrbanCatchment(hoverInfo.sett.urbanPop, hoverInfo.sett.people)}</div>}
        {ctry&&<div style={{fontSize:hoverInfo.sett?11:12.5,fontWeight:hoverInfo.sett?400:700}}>
          {!hoverInfo.sett&&<span className="au-fade" style={{fontWeight:400}}>realm of </span>}
          <span style={{textTransform:"capitalize"}}>{hoverInfo.realm}</span></div>}
      </div>
    </div>);
  })()}
  <div className="au-pico-title" style={{fontSize:12,
    color:hoverInfo.isLake?"var(--au-verdigris)":hoverInfo.elevM<=0?"var(--au-verdigris)":"var(--au-ink)"}}>
    {hoverInfo.isLake?`Lake (${hoverInfo.lakeSize}t)`:hoverInfo.biome}
  </div>
  <div className="au-fade" style={{fontSize:11}}>
    {hoverInfo.elevM}m · {hoverInfo.tempC}°C · {(hoverInfo.moist*100|0)}% moist
    {hoverInfo.fert>0.05&&<> · {(hoverInfo.fert*100|0)}% fertile</>}
  </div>
  {hoverInfo.resources&&hoverInfo.resources.length>0&&<div className="au-fade" style={{fontSize:10}}>
    {hoverInfo.resources.join(" · ")}
  </div>}
  {hoverInfo.river>0&&<div className="au-verde-text" style={{fontSize:11}}>
    {RIVER_NAMES[hoverInfo.river]}
  </div>}
  {hoverInfo.owner&&hoverInfo.owner!==(hoverInfo.sett&&hoverInfo.sett.name)&&<div className="au-fade" style={{fontSize:11}}>
    worked by <span style={{textTransform:"capitalize"}}>{hoverInfo.owner}</span>
  </div>}
  <div className="au-fade" style={{fontSize:10,marginTop:2,fontStyle:"italic"}}>
    {hoverInfo.sett?"click to inspect":hoverInfo.realmId>=0?"click to select the realm":""}</div>
</div>}



{/* ─── Bottom-left collapsible legend ─── */}
{(viewMode==="terrain"||viewMode==="atlas"||viewMode==="resources"||viewMode==="goodsflow")&&
<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:keyOpen?"6px 10px 8px":"4px 10px",fontSize:11,maxWidth:200,zIndex:20}}>
<div style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,
  borderBottom:keyOpen?"1px solid rgba(216,190,150,0.18)":"none",paddingBottom:keyOpen?3:0,marginBottom:keyOpen?4:0}}
  onClick={()=>setKeyOpen(v=>!v)}>
  <span className="au-heading au-sc" style={{fontSize:10,flex:1}}>{keyOpen?"▾":"▸"} Key</span>
</div>
{keyOpen&&<div className="au-key">
  {viewMode==="terrain"&&[4,5,6,7,8,9,10,15,11,12,14,13,16].map(bi=>(
    <div key={bi} className="au-key-row">
      <span className="au-key-swatch" style={{background:`rgb(${BC[bi][0]},${BC[bi][1]},${BC[bi][2]})`}} />
      <span>{BN[bi]}</span>
    </div>))}
  {viewMode==="atlas"&&[["#e6d8ad","Lowland"],["#e3bd83","Desert"],["#ede7e1","Snow / tundra"],["#586139","Forest"],["#cabd8f","Mountains"],["#1a0f04","Sea"]].map(([c,l])=>(
    <div key={l} className="au-key-row">
      <span className="au-key-swatch" style={{background:c}} />
      <span>{l}</span>
    </div>))}
  {viewMode==="resources"&&<div>
    {RESOURCES.map(r=>{const on=activeRes[r.id];return(
      <div key={r.id} className="au-key-row" style={{cursor:"pointer",opacity:on?1:0.4}}
        onClick={()=>setActiveRes(prev=>{const next={...prev};next[r.id]=!prev[r.id];return next;})}>
        <span className="au-key-swatch" style={{background:on?`rgb(${r.color.join(",")})`:"#888"}} />
        <span>{r.label}</span>
        <span className="au-fade" style={{fontSize:9,marginLeft:"auto"}}>{r.era}</span>
      </div>);})}
    <div className="au-rule" style={{margin:"4px 0"}} />
    <div style={{display:"flex",gap:8,fontSize:10}}>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=true;setActiveRes(s);}}>All</span>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=false;setActiveRes(s);}}>None</span>
    </div>
  </div>}
  {viewMode==="goodsflow"&&<div>
    {GOODS_FLOW_LABELS.map(([id,label])=>{const on=activeGoods[id]!==false;return(
      <div key={id} className="au-key-row" style={{cursor:"pointer",opacity:on?1:0.4}}
        onClick={()=>setActiveGoods(prev=>({...prev,[id]:prev[id]===false}))}>
        <span className="au-key-swatch" style={{background:on?`rgb(${GOODS_FLOW_KINDS[id].join(",")})`:"#888"}} />
        <span>{label}</span>
      </div>);})}
    <div className="au-rule" style={{margin:"4px 0"}} />
    <div style={{display:"flex",gap:8,fontSize:10}}>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const[id]of GOODS_FLOW_LABELS)s[id]=true;setActiveGoods(s);}}>All</span>
      <span style={{cursor:"pointer"}} className="au-fade"
        onClick={()=>{const s={};for(const[id]of GOODS_FLOW_LABELS)s[id]=false;setActiveGoods(s);}}>None</span>
    </div>
    <div className="au-fade" style={{fontSize:10,fontStyle:"italic",marginTop:5,lineHeight:1.45}}>
      Levy is grain the countryside sends to its city. Market is grain cities buy from each other. Coin on tiles (Coin field) is only the paid slice.
    </div>
  </div>}
</div>}
</div>}

{/* ─── Depth contextual controls ─── */}
{viewMode==="depth"&&<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:"6px 12px",fontSize:11,display:"flex",alignItems:"center",gap:10,zIndex:20}}>
<button onClick={()=>{setDepthFromSea(v=>!v);depthFromSeaRef.current=!depthFromSeaRef.current;}}
  className={"au-btn"+(depthFromSea?" au-active":"")}>{depthFromSea?"From Sea":"From Floor"}</button>
<span className="au-sc au-fade" style={{fontSize:10}}>Range</span>
<input type="range" min="0.05" max="1.0" step="0.05" value={depthCeil}
  onChange={e=>{const v=parseFloat(e.target.value);setDepthCeil(v);depthCeilRef.current=v;}}
  style={{width:90}} />
<span className="au-fade">{Math.round(depthCeil*100)}%</span>
</div>}

{/* ─── Unified legend (plan §6.3): every thematic lens declares its key as
     data; one card renders them all. Terrain/atlas/resources keep the
     data-driven Key card above; Depth keeps its dev controls. ─── */}
{LEGENDS[viewMode]&&<LegendCard spec={LEGENDS[viewMode]} open={keyOpen} onToggle={()=>setKeyOpen(v=>!v)}
  controls={viewMode==="prices"?(
    <select value={priceGood} onChange={(e)=>setPriceGood(+e.target.value)}
      style={{width:"100%",marginBottom:5,fontSize:11,padding:"2px 4px"}}>
      {GOODS.map((g,i)=><option key={g} value={i}>{g}</option>)}
    </select>):null}>
  {viewMode==="population"&&peopleRef.current&&peopleRef.current._popMax
    ?<div className="au-fade" style={{fontSize:10,marginTop:3}}>densest region ≈ {fmtPeople(peopleRef.current._popMax)} people</div>
    :null}
  {viewMode==="tilecoin"&&peopleRef.current&&(()=>{
    const psw=peopleRef.current;
    const max=psw._tileCoinMax;
    const tot=psStats.tileWealth;
    if(!max&&!tot)return <div className="au-fade" style={{fontSize:10,marginTop:3,lineHeight:1.45}}>
      Empty — no city is BUYING grain. Food arrives as in-kind levy (fields→city) and local harvest; those moves create no coin on the tile. Watch Goods → Levy for that flow, Money for city treasuries.
    </div>;
    return <div className="au-fade" style={{fontSize:10,marginTop:3,lineHeight:1.45}}>
      {max>0&&<>richest farm tile ≈ {max.toFixed(1)} coin<br/></>}
      {tot>0&&<>≈ {fmtGoldKg(tot)} on farm tiles · ≈ {fmtGoldKg(psStats.totalWealth||0)} in city & state purses</>}
      {!(tot>0)&&max>0&&<>trace coin only — most wealth sits in city treasuries (Money lens)</>}
    </div>;
  })()}
</LegendCard>}

{/* ─── World-forging indicator: regeneration keeps the old map on screen,
     so without this a res/seed/preset change looks like a dead control ─── */}
{genBusy&&<div className="au-chrome au-glass" style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",
  zIndex:25,padding:"7px 16px",fontSize:13,display:"flex",gap:9,alignItems:"center",whiteSpace:"nowrap"}}>
  <span style={{display:"inline-block",width:11,height:11,border:"2px solid var(--au-ch-gold)",borderTopColor:"transparent",
    borderRadius:"50%",animation:"au-spin 0.9s linear infinite"}}/>
  <span className="au-era" style={{fontSize:12,color:"var(--au-ch-gold)"}}>Forging a new world…</span>
</div>}

{/* Mint-ready genesis: sim worker is blocked gathering to the first city.
    Play/UI stay live but ticks won't advance until this completes (then a
    sudden jump to ~20-30k). */}
{!genBusy&&genesisProg&&genesisProg.phase!=="done"&&<div className="au-chrome au-glass" style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",
  zIndex:25,padding:"7px 16px",fontSize:13,display:"flex",gap:9,alignItems:"center",whiteSpace:"nowrap"}}>
  <span style={{display:"inline-block",width:11,height:11,border:"2px solid var(--au-ch-gold)",borderTopColor:"transparent",
    borderRadius:"50%",animation:"au-spin 0.9s linear infinite"}}/>
  <span className="au-era" style={{fontSize:12,color:"var(--au-ch-gold)"}}>
    {genesisProg.phase==="mint-ready"
      ?`Gathering to first city… step ${(genesisProg.step||0).toLocaleString()}${genesisProg.inventStep!=null?` (farming @ ${genesisProg.inventStep.toLocaleString()})`:""}`
      :"Starting civilization…"}
  </span>
</div>}

{/* ─── Epochal-event toasts (plan §8) ─── */}
<ToastHost feedRef={peopleRef} verbosity={toastVerbosity} onJump={jumpTo} stepNow={liveStep}/>

{/* ─── Simulation-error banner ─── */}
{/* A worker/step failure used to be console-only: the game froze at its last
    frame with no explanation ("shuts down at step N"). The world is still
    alive in the worker — say so, and point at the rescue (Save). Persistent
    (not a 7s toast) until dismissed; a snapshot-lane error means the sim is
    still running, a step error means it paused itself. */}
{simError&&(
  <div className="au-parchment" style={{position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",
    zIndex:"var(--z-toasts)",display:"flex",gap:10,alignItems:"flex-start",padding:"8px 12px",
    maxWidth:"min(640px,90%)",border:"1px solid rgba(180,60,40,0.85)",boxShadow:"0 4px 18px rgba(0,0,0,0.45)"}}>
    <span style={{fontSize:16,flexShrink:0,lineHeight:1.4}}>⚠</span>
    <span style={{fontSize:12.5,lineHeight:1.4,minWidth:0}}>
      {simError.where==='step'
        ?`The simulation hit an internal error at step ${simError.step??'?'} and paused itself. The world is intact — use Save to keep it, then report seed ${world&&world.seed!=null?world.seed:seed}.`
        :simError.where==='snapshot'
        ?`The map view failed to refresh at step ${simError.step??'?'} — the simulation itself is still running. Save works; the view may recover on its own.`
        :`The simulation worker reported an error${simError.step!=null?` at step ${simError.step}`:''}. The world is intact — use Save to keep it.`}
      <div style={{opacity:0.85,marginTop:4,fontFamily:"ui-monospace,Menlo,Consolas,monospace",fontSize:11,wordBreak:"break-word"}}>
        {simError.message}
      </div>
    </span>
    <button onClick={()=>{
      const text=`where=${simError.where} step=${simError.step} seed=${world&&world.seed!=null?world.seed:seed}\n${simError.message}${simError.stack?"\n"+simError.stack:""}`;
      try{navigator.clipboard.writeText(text);}catch{/* ignore */}
    }} title="Copy error details"
      style={{background:"transparent",border:"1px solid rgba(180,60,40,0.45)",cursor:"pointer",color:"var(--au-ink)",fontSize:11,padding:"2px 6px",flexShrink:0,borderRadius:3}}>Copy</button>
    <button onClick={()=>setSimError(null)} title="Dismiss"
      style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-ink-faded)",fontSize:16,padding:"0 2px",flexShrink:0}}>×</button>
  </div>
)}

</div>{/* end map area */}

</div>{/* end center column */}

{/* ══════════ THE CODEX (right dock — the atlas's book; plan §7) ══════════
     Desktop: an inline column. Narrow: a fixed slide-over drawer, toggled
     from the top bar and auto-opened by map selection. Same content. */}
<aside className="au-parchment" style={narrow?{
    position:"fixed",top:0,right:0,bottom:0,width:"min(340px, 92vw)",zIndex:46,
    display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden",overscrollBehavior:"contain",
    borderRadius:0,transform:codexOpen?"translateX(0)":"translateX(102%)",
    transition:"transform 0.22s ease-out",boxShadow:"-8px 0 30px rgba(0,0,0,0.55)"
  }:{width:312,minWidth:312,margin:"6px 6px 6px 3px",
    display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden",overscrollBehavior:"contain"}}>
  <div style={{display:"flex",flexShrink:0,borderBottom:"1px solid rgba(216,190,150,0.28)",alignItems:"stretch"}}>
    {[["world","World"],["realms","Realms"],["peoples","Peoples"],["faiths","Faiths"],["tongues","Tongues"],["inspect","Inspect"]].map(([k,l])=>(
      <button key={k} onClick={()=>navigate({tab:k})}
        className={"au-tab"+(panelTab===k?" au-active":"")} style={{flex:1,padding:"7px 0"}}>{l}</button>
    ))}
    {narrow&&<button onClick={()=>setCodexOpen(false)} title="Close"
      style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-ink-faded)",fontSize:17,padding:"0 9px"}}>×</button>}
  </div>
  {/* breadcrumb + back — every jump in the codex is reversible */}
  {(()=>{
    const psw=peopleRef.current;
    const crumbs=["Codex"];
    if(panelTab==="world")crumbs.push("World");
    else if(panelTab==="realms"){crumbs.push("Realms");
      const c=realmSel>=0&&psw&&psw.countries?psw.countries.get(realmSel):null;
      if(realmSel>=0)crumbs.push(c?(c.name||"realm "+realmSel):"…");}
    else if(panelTab==="inspect"){crumbs.push("Inspect");
      const s=selectedSettlementId>=0&&psw&&psw.settlements?psw.settlements.find(x=>x&&x.id===selectedSettlementId):null;
      if(s)crumbs.push(s.name);}
    else crumbs.push(panelTab.charAt(0).toUpperCase()+panelTab.slice(1));
    return(
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",flexShrink:0,
        borderBottom:"1px solid rgba(216,190,150,0.14)",fontSize:10.5}}>
        <button onClick={navBack} className="au-btn au-flat" title="Back"
          style={{padding:"0 6px",fontSize:12,opacity:navStackRef.current.length?1:0.35}}>◂</button>
        <span className="au-fade" style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textTransform:"capitalize"}}>
          {crumbs.join(" ▸ ")}</span>
      </div>);
  })()}
  {panelTab==="world"&&renderCharts()}
  {panelTab==="realms"&&(realmSel>=0?renderRealmDetail():renderBoard())}
  {panelTab==="peoples"&&renderPeoples()}
  {panelTab==="faiths"&&renderFaiths()}
  {panelTab==="tongues"&&renderLanguages()}
  {panelTab==="inspect"&&(renderInspect()||
    <div className="au-fade" style={{padding:16,fontSize:12,fontStyle:"italic"}}>Click a settlement on the map to inspect it — or click open territory to select its realm.</div>)}
</aside>

</div>{/* main row */}

{/* ══════════ PARAMS DRAWER ══════════ */}
{layersOpen&&(()=>{
  const tog=(k)=>setLayers(L=>({...L,[k]:!L[k]}));
  // `row` returns a PLAIN <button> element (not a component). Defining a component
  // inside this render (the old `<Row/>`) made it a NEW type every render, so React
  // remounted every layer button on each sim tick (WorldSim re-renders on every
  // snapshot). A click whose mousedown/mouseup straddled a remount fired no `click`
  // — the "have to press many times / related to the ticks" bug. As plain buttons at
  // fixed positions with stable keys they reconcile in place and never remount.
  const row=(k,label,indent)=>(
    <button key={k} onClick={()=>tog(k)}
      className={"au-rail-tab"+(layers[k]?" au-active":"")}
      style={{paddingLeft:14+(indent||0),width:"100%",textAlign:"left",fontSize:12}}>{label}</button>
  );
  // Terrain overlays live in separate state/refs (pre-date the layers map);
  // rendered here as the same kind of row so the popover is the ONE home of
  // every map overlay.
  const trow=(on,set,ref,label,indent)=>(
    <button key={label} onClick={()=>{set(v=>!v);ref.current=!ref.current;}}
      className={"au-rail-tab"+(on?" au-active":"")}
      style={{paddingLeft:14+(indent||0),width:"100%",textAlign:"left",fontSize:12}}>{label}</button>
  );
  return(
    <aside className="au-chrome au-glass au-scroll" style={{
      position:"absolute",left:66,top:8,width:224,maxHeight:"85vh",
      padding:"8px 0",overflowY:"auto",zIndex:_zOf("layers")}}>
      <div style={{display:"flex",alignItems:"baseline",marginBottom:4,padding:"0 12px"}}>
        <span className="au-heading au-sc" style={{fontSize:12.5}}>Map layers</span>
        <div style={{flex:1}} />
        <span onClick={()=>setLayersOpen(false)}
          style={{cursor:"pointer",fontSize:18,color:"var(--au-ch-text-dim)"}}>×</span>
      </div>
      <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"4px 14px 2px"}}>Politics & trade</div>
      {row("tints","Nation tints")}
      {row("borders","National borders")}
      {row("provinces","· Provinces & states",10)}
      {row("labels","Names on the map")}
      {row("emblems","Heraldry")}
      {row("roads","Roads")}
      {row("seaLanes","Sea lanes")}
      {row("moneyFlow","Money flow")}
      <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"8px 14px 2px"}}>War</div>
      {row("warFronts","Invasion arrows")}
      {row("sieges","Sieges & sacks")}
      <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"8px 14px 2px"}}>Terrain</div>
      {trow(showRivers,setShowRivers,showRiversRef,"Rivers")}
      {showRivers&&trow(showStreams,setShowStreams,showStreamsRef,"· Streams",10)}
      {trow(showLakes,setShowLakes,showLakesRef,"Lakes")}
      {world&&world.pixPlate&&trow(showPlates,setShowPlates,showPlatesRef,"Plates")}
      <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"8px 14px 2px"}}>Settlements</div>
      {row("icons","Icons (master)")}
      {row("village","· Farming Regions",10)}
      {row("city","· Cities",10)}
      {row("metropolis","· Metropolises",10)}
      {row("shocks","Plague / famine outlines")}
      <div className="au-heading au-sc au-cfade" style={{fontSize:10,padding:"8px 14px 2px"}}>Moving</div>
      {row("ships","Colony ships")}
    </aside>
  );
})()}



{rightPanel==="params"&&(preset==="earth"||preset==="earth_sim")&&
<aside className="au-chrome au-glass au-scroll" style={{
  position:"absolute",right:316,top:6,bottom:6,width:300,
  padding:"10px 12px",overflowY:"auto",zIndex:_zOf("wind")}}>
<div style={{display:"flex",alignItems:"baseline",marginBottom:6}}>
  <span className="au-heading au-sc" style={{fontSize:12}}>{preset==="tectonic"?"Parameters":"Wind & Moisture"}</span>
  <div style={{flex:1}} />
  <span onClick={()=>setRightPanel("")}
    style={{cursor:"pointer",fontSize:18,color:"var(--au-ink-light)"}}>×</span>
</div>
<ParamEditor params={{..._tecParams}}
  onChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  groups={preset==="earth"?["wind"]:preset==="earth_sim"?["wind","moisture"]:undefined} />
</aside>}

{/* ══════════ CHRONICLE OVERLAY (follows the inspected realm) ══════════ */}
{chronicleOpen&&peopleRef.current&&peopleRef.current._chronicle&&(
  <ChronicleOverlay z={_zOf("chronicle")} entries={peopleRef.current._chronicle.entries} name={peopleRef.current._chronicle.name}
    eraAt={peopleRef.current._eraAt}
    armsURL={peopleRef.current._chronicle.countryId>=0?emblemURLFor(peopleRef.current._chronicle.countryId):null}
    perspective={!!peopleRef.current._chronicle.perspective}
    onTogglePerspective={()=>{
      const next=!peopleRef.current._chronicle.perspective;
      if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"chronicle-mode",perspective:next});
    }}
    onClose={()=>setChronicleOpen(false)}/>)}

{/* ══════════ RULING FAMILY TREE OVERLAY (follows the inspected realm) ══════════ */}
{dynastyOpen&&(
  <DynastyOverlay z={_zOf("dynasty")} tree={peopleRef.current&&peopleRef.current._dynasty}
    onClose={()=>setDynastyOpen(false)}/>)}

{/* ══════════ NEW WORLD MODAL ══════════ */}
{newWorldOpen&&(
  <div onClick={()=>setNewWorldOpen(false)} style={{position:"fixed",inset:0,background:"rgba(10,8,6,0.7)",zIndex:_zOf("newworld"),display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div onClick={e=>e.stopPropagation()} className="au-parchment au-elev" style={{padding:"14px 18px",width:"min(420px,92vw)"}}>
      <div style={{display:"flex",alignItems:"center",marginBottom:10}}>
        <span className="au-pico-title" style={{fontSize:15}}>New World</span>
        <div style={{flex:1}}/>
        <button onClick={()=>setNewWorldOpen(false)} style={{background:"transparent",border:"none",cursor:"pointer",color:"var(--au-fade)",fontSize:18}}>×</button>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:8}}>
        <button onClick={()=>{setPresetAndGo("earth_sim");setNewWorldOpen(false);}}
          className={"au-btn"+(preset==="earth_sim"?" au-active":"")} style={{flex:1,padding:"10px 4px"}}>Earth (Sim)</button>
        <button onClick={()=>{setPresetAndGo("tectonic");setNewWorldOpen(false);}}
          className={"au-btn"+(preset==="tectonic"?" au-active":"")} style={{flex:1,padding:"10px 4px"}}>Tectonic</button>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
        <span className="au-fade" style={{fontSize:11,width:26}}>map</span>
        {[{f:1920,l:"2×"},{f:960,l:"1×"},{f:480,l:"0.5×"}].map(o=>(
          <button key={o.f} onClick={()=>setMapScale(o.f)}
            className={"au-btn au-flat"+(mapScale===o.f?" au-active":"")} style={{flex:1,fontSize:11,padding:"6px 4px"}}
            title={o.f===1920?"Finest coastlines & terrain":o.f===480?"Coarsest map — fastest to generate":"Balanced map detail"}>{o.l}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
        <span className="au-fade" style={{fontSize:11,width:26}}>sim</span>
        {[{d:1,l:"Full"},{d:2,l:"Half"},{d:4,l:"Quarter"}].map(o=>(
          <button key={o.d} onClick={()=>{simTileResRef.current=o.d;setSimDiv(o.d);generate(seed);}}
            className={"au-btn au-flat"+(simDiv===o.d?" au-active":"")} style={{flex:1,fontSize:11,padding:"6px 4px"}}
            title={o.d===1?"Sim tiles match the map — finest regions, but ~4× slower and seeds more (smaller) civilisations":o.d===4?"Coarsest sim — fastest; fewer, larger realms (the phone-friendly choice)":"Half the map resolution — the full political spectrum, small states included (default)"}>{o.l}</button>
        ))}
      </div>
      <div className="au-fade" style={{fontSize:9,fontStyle:"italic",marginBottom:6}}>
        Map = coastline/terrain detail. Sim = simulation granularity: finer runs slower, seeds more &amp; smaller realms, and yields a different emergent world. Both regenerate this seed.</div>
      {preset==="earth_sim"&&
        <label style={{fontSize:11,cursor:"pointer",display:"flex",alignItems:"center",gap:5,marginBottom:6}} className="au-fade">
          <input type="checkbox" checked={useRealWind}
            onChange={e=>{setUseRealWind(e.target.checked);useRealWindRef.current=e.target.checked;generate(seed);}}/>
          {realDataAvailable()?"Use real Earth climate (NCEP wind, rain & heat)":"Real Earth climate (data not available)"}
        </label>}
      {preset==="tectonic"&&<div style={{display:"flex",gap:5,marginBottom:6,alignItems:"center"}}>
        <span className="au-fade" style={{fontSize:10}}>preset</span>
        <select value={tecPresetName} style={{flex:1}} onChange={e=>{
          const name=e.target.value;setTecPresetName(name);
          if(name==="Default"){_tecParams={};generate(seed);}
          else{const ps=loadPresets();if(ps[name]){_tecParams=ps[name];generate(seed);}}
        }}>
          <option value="Default">Default</option>
          {Object.keys(loadPresets()).map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        {tecPresetName!=="Default"&&<button className="au-btn au-wax" style={{fontSize:10}}
          onClick={()=>{if(confirm("Delete '"+tecPresetName+"'?")){deletePreset(tecPresetName);setTecPresetName("Default");_tecParams={};generate(seed);}}}>✕</button>}
      </div>}
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
        <span className="au-fade" style={{fontSize:11}}>seed</span>
        <span style={{fontFamily:"'Courier New',monospace",fontSize:12}}>{seed}</span>
        <button onClick={()=>setSeed(Math.floor(Math.random()*999999))} className="au-btn au-flat" style={{fontSize:11}}>⚄ Roll &amp; generate</button>
        <div style={{flex:1}}/>
        <button onClick={()=>fileRef.current?.click()} className="au-btn au-flat" style={{fontSize:11}}>Import…</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,.map,.png,.jpg,.jpeg,.webp" style={{display:"none"}} onChange={handleImport}/>
      {importStatus&&<div className="au-fade" style={{fontSize:9,wordBreak:"break-all"}}>{importStatus}</div>}
      <div className="au-fade" style={{fontSize:9,fontStyle:"italic"}}>
        Picking a preset rolls a fresh seed and generates immediately. Import accepts Azgaar Full-JSON or grayscale heightmaps.</div>
    </div>
  </div>
)}

{/* ══════════ MENU POPOVER ══════════ */}
{menuOpen&&(
  <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:_zOf("menu")}}>
    <div onClick={e=>e.stopPropagation()} className="au-chrome au-glass" style={{position:"absolute",right:10,top:48,width:238,padding:"8px 0",display:"flex",flexDirection:"column",zIndex:"var(--z-popovers)"}}>
      <button className="au-rail-tab" onClick={()=>{
        downloadSaveRef.current=(json,step)=>{
          const blob=new Blob([json],{type:"application/json"});
          const a=document.createElement("a");a.href=URL.createObjectURL(blob);
          a.download=`simman-${presetRef.current}-s${seed}-t${step??""}.json`;a.click();
          setTimeout(()=>URL.revokeObjectURL(a.href),5000);
        };
        if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"save"});
        else if(peopleRef.current&&!peopleRef.current._isMirror){
          downloadSaveRef.current(serializeWorld(peopleRef.current,{oceanLevel:oceanLevelRef.current,tecParams:_tecParams}),peopleRef.current.step);
        }
        setMenuOpen(false);
      }}>💾 Save world</button>
      <button className="au-rail-tab" onClick={()=>{saveFileRef.current?.click();setMenuOpen(false);}}>📂 Load world…</button>

      <button className="au-rail-tab" onClick={()=>{
        if(simWorkerRef.current)simWorkerRef.current.postMessage({type:"export-history"});
        else if(peopleRef.current&&!peopleRef.current._isMirror){
          import("./sim/peopleSim/historiography.js").then(h=>{
            const json=JSON.stringify(h.exportHistory(peopleRef.current));
            const blob=new Blob([json],{type:"application/json"});
            const a=document.createElement("a");a.href=URL.createObjectURL(blob);
            a.download=`simman-history-t${peopleRef.current.step}.json`;a.click();
            setTimeout(()=>URL.revokeObjectURL(a.href),5000);
          });
        }
        setMenuOpen(false);
      }}>📜 Export history</button>
      <div className="au-rule"/>
      {preset==="earth_sim"&&<button className="au-rail-tab" onClick={()=>{setLeversOpen(v=>!v);setMenuOpen(false);}}>⚖ Sim levers</button>}
      {(preset==="earth"||preset==="earth_sim")&&<button className="au-rail-tab" onClick={()=>{setRightPanel(rightPanel==="params"?"":"params");setMenuOpen(false);}}>🌬 Wind &amp; moisture</button>}
      {preset==="tectonic"&&<button className="au-rail-tab" onClick={()=>{setShowTuning(true);setMenuOpen(false);}}>⚙ Worldgen tuning</button>}
      {!DEV&&<div className="au-fade" style={{fontSize:9,padding:"6px 14px 2px",fontStyle:"italic"}}>add ?dev to the URL for worldgen diagnostic lenses</div>}
    </div>
  </div>
)}

{/* ══════════ SIM LEVERS PANEL ══════════ */}
{leversOpen&&<SimLevers values={tuneVals} onChange={onLeverChange}
  onResetKey={onLeverResetKey} onResetAll={onLeverResetAll}
  onClose={()=>setLeversOpen(false)} />}

{/* ══════════ HELP / KEYS ══════════ */}
{helpOpen&&<HelpOverlay z={_zOf("help")} onClose={()=>setHelpOpen(false)}/>}

{/* ══════════ TUNING MODAL ══════════ */}
{showTuning&&<TuningPanel noiseFns={{initNoise,fbm,ridged,noise2D,worley}} seed={seed}
  params={{..._tecParams}}
  onParamsChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  onClose={()=>setShowTuning(false)} />}

</div>);}
