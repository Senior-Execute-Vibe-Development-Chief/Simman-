// ── Worldgen: elevation + climate + coastline ────────────────────────
//
// Extracted from WorldSim.jsx so worldgen can run headlessly (Node tests,
// future tooling) without dragging React in. Pure function: same inputs
// → same world object the browser would produce.
//
// Branches by preset:
//   "earth"      — real heightmap, simple latitude/elevation climate
//   "earth_sim"  — real heightmap + full wind/moisture/temperature solver
//                  (this is the one the user runs as "Earth (Sim)" — the
//                  most physically grounded preset, matches real maps best)
//   "pangaea"    — single all-land continent
//   "tectonic"   — plate-based generation via tectonicGen.js
//   default      — random multi-stamp continents
//
// _tecParams is now an explicit parameter (was a module-level mutable in
// the React component); callers pass `{}` for defaults.

import { initNoise, mkRng, fbm, noise2D, warp, ridged, worley } from "./worldgenUtils.js";
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "./earthData.js";
import { generateTectonicWorld } from "./tectonicGen.js";
import { solveWind } from "./windSolver.js";
import { solveMoisture } from "./moistureSolver.js";

const RES = 1;

// Directional distance field, O(W·H) via a running sweep (replaces O(W·H·scan)
// per-tile scans — at 1920×960 those cost ~12s of worldgen). For each tile returns
// the pixel distance to the nearest `mask` tile in a direction, capped at `cap`+1:
//   dir>0 sweeps L→R → distance to the nearest mask tile to the WEST
//   dir<0 sweeps R→L → distance to the nearest mask tile to the EAST
// X wraps (toroidal): we sweep two laps and only record on the second.
function dirDist(mask, W, H, dir, cap) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let d = cap + 1;
    for (let s = 0; s < 2 * W; s++) {
      const xx = dir > 0 ? (s % W) : (W - 1 - (s % W));
      const i = row + xx;
      if (mask[i]) d = 0; else if (d <= cap) d++;
      if (s >= W) out[i] = Math.min(d, cap + 1);
    }
  }
  return out;
}

// `realWindFns` is INJECTED ({ isRealWindAvailable, fillRealWind } from
// realWindData.js) rather than imported: realWindData statically pulls the
// 2.3MB NCEP wind JSON into whichever bundle imports it, and worldgen also
// runs inside worldGenWorker — importing it here would inline that data into
// the worker bundle a second time. Callers that want real winds (the main
// thread's Earth-Sim checkbox) pass the functions in; everyone else omits
// them and the solver wind is used. `_legacyArg` keeps the old positional
// signature stable for the ~60 node probes in tools/.
export function generateWorld(W, H, seed, preset, oceanLevel, _legacyArg = true, realWind = false, _tecParams = {}, realWindFns = null) {
initNoise(seed);const rng=mkRng(seed);
const rawElev=new Float32Array(W*H),elevation=new Float32Array(W*H),moisture=new Float32Array(W*H),temperature=new Float32Array(W*H);
let tecPlates=null,tecWindX=null,tecWindY=null;
if(preset==="earth"){
// ── Earth mode: use real heightmap data ──
const eData=decodeEarth(EARTH_ELEV);
// Pass 1: elevation + temperature
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(eData,EARTH_W,EARTH_H,x,y,W,H);// 0-255
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){const depth=fbm(nx*8+50,ny*8+50,3,2,.5)*.04;
elevation[i]=Math.max(-0.04,-0.03-Math.max(0,(1-he/3))*0.12+depth);
}else{let e=(he-3)/252*0.55+0.005+noise;elevation[i]=Math.max(0.001,e);}
// Accurate annual-mean latitude→temperature (see tools/probe_temperature.mjs):
// +26°C at the equator, flattening to ~-23°C at the pole (the real Arctic mean,
// not the old -60°C). A small subtropical shoulder lifts the 10-20° band; the
// Greenland/Antarctica ice still comes from the lat-amplified elevation penalty.
// Softer elevation lapse penalty + southern-polar cooling (see earth_sim for the
// rationale): keeps Tibet/Andes from glaciating and makes all of Antarctica ice.
temperature[i]=Math.max(0,Math.min(1,0.85-0.66*lat*lat+0.18*lat*lat*lat*lat+Math.exp(-((lat-0.12)*(lat-0.12))/(2*0.14*0.14))*0.030-Math.max(0,elevation[i])*(.48+.12*lat)-Math.max(0,(ny-0.5)*2-0.53)*0.85+fbm(nx*3+80,ny*3+80,3,2,.5)*.03));}
// Pass 2: coast-distance BFS at tile resolution for continentality
const CDT=4,CDW=Math.ceil(W/CDT),CDH=Math.ceil(H/CDT);
const cdist=new Uint8Array(CDW*CDH);cdist.fill(255);
const cdQ=[];
for(let ty=0;ty<CDH;ty++)for(let tx=0;tx<CDW;tx++){
const px=Math.min(W-1,tx*CDT),py=Math.min(H-1,ty*CDT),ti=ty*CDW+tx;
if(elevation[py*W+px]<=0)continue;// ocean tile
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
const nx2=(tx+dx+CDW)%CDW,ny2=ty+dy;if(ny2<0||ny2>=CDH)continue;
const np=Math.min(W-1,nx2*CDT),npy=Math.min(H-1,ny2*CDT);
if(elevation[npy*W+np]<=0){cdist[ti]=0;cdQ.push(ti);break;}}}
for(let qi=0;qi<cdQ.length;qi++){const ci=cdQ[qi],cd=cdist[ci],cx=ci%CDW,cy=(ci-cx)/CDW;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;
const nx2=(cx+dx+CDW)%CDW,ny2=cy+dy;if(ny2<0||ny2>=CDH)continue;
const ni=ny2*CDW+nx2,nd=cd+1;if(nd<cdist[ni]&&elevation[Math.min(H-1,ny2*CDT)*W+Math.min(W-1,nx2*CDT)]>0){cdist[ni]=nd;cdQ.push(ni);}}}
// Pass 3: moisture using ITCZ, subtropical HP belt, continentality, westerlies
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
if(elevation[i]<=0){moisture[i]=0.5+fbm(nx*3+30,ny*3+30,2,2,.5)*.1;continue;}
const cd=cdist[Math.min(CDH-1,Math.floor(y/CDT))*CDW+Math.min(CDW-1,Math.floor(x/CDT))];
const coastProx=Math.max(0,1-cd/8);// 1 at coast, 0 inland
const tropWet=Math.max(0,1-lat*2.5);// ITCZ: wet equator
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.08*.08))*.35*(1-coastProx*.5);// subtropical HP, softened + widened for realism
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.22;// temperate westerlies
const tropF=Math.max(0,1-lat*3);// tropical moisture recycling factor
const contRate=.006+(1-tropF)*.014;// weak in tropics, stronger elsewhere
const cont=Math.min(.28,cd*contRate);
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.42+tropWet*.42-subtropDry+tempWet-cont-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.12
+fbm(nx*1.5+90,ny*1.5+90,3,2,.55)*.15;// continent-scale wet/dry to break banding
if(elevation[i]>.15)m-=Math.min(.2,(elevation[i]-.15)*1);
if(elevation[i]<.02)m+=.10;
moisture[i]=Math.max(.02,Math.min(1,m));}
// Run wind solver on Earth elevation data
const earthWind=solveWind(W,H,elevation,fbm,_tecParams,seed*0.0137);
tecWindX=earthWind.windX;tecWindY=earthWind.windY;
}else if(preset==="earth_sim"){
// ── Earth (Sim) mode: real heightmap + full wind-based climate simulation ──
// Uses same elevation as Earth mode but applies wind-advected moisture/temperature
const eData=decodeEarth(EARTH_ELEV);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H;
const he=sampleEarth(eData,EARTH_W,EARTH_H,x,y,W,H);
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){const depth=fbm(nx*8+50,ny*8+50,3,2,.5)*.04;
elevation[i]=Math.max(-0.04,-0.03-Math.max(0,(1-he/3))*0.12+depth);
}else{let e=(he-3)/252*0.55+0.005+noise;elevation[i]=Math.max(0.001,e);}}
// Coast distance BFS
const CDT=4,CDW=Math.ceil(W/CDT),CDH=Math.ceil(H/CDT);
const cdist=new Uint8Array(CDW*CDH);cdist.fill(255);const cdQ=[];
for(let ty=0;ty<CDH;ty++)for(let tx=0;tx<CDW;tx++){
const px=Math.min(W-1,tx*CDT),py=Math.min(H-1,ty*CDT),ti2=ty*CDW+tx;
if(elevation[py*W+px]<=0)continue;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
const nx2=(tx+dx+CDW)%CDW,ny2=ty+dy;if(ny2<0||ny2>=CDH)continue;
if(elevation[Math.min(H-1,ny2*CDT)*W+Math.min(W-1,nx2*CDT)]<=0){cdist[ti2]=0;cdQ.push(ti2);break;}}}
for(let qi=0;qi<cdQ.length;qi++){const ci=cdQ[qi],cd=cdist[ci],cx=ci%CDW,cy=(ci-cx)/CDW;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;
const nx2=(cx+dx+CDW)%CDW,ny2=cy+dy;if(ny2<0||ny2>=CDH)continue;
const ni=ny2*CDW+nx2,nd=cd+1;if(nd<cdist[ni]&&elevation[Math.min(H-1,ny2*CDT)*W+Math.min(W-1,nx2*CDT)]>0){cdist[ni]=nd;cdQ.push(ni);}}}
// Land/ocean masks + an "open ocean" mask (ocean that stays ocean ~7° further east,
// so narrow seas — Red Sea, Persian Gulf, Yellow Sea, Mediterranean — don't read as
// open basins). Shared by the windward-proximity and ocean-current fields below.
const degPx=360/W,openRun=Math.max(1,Math.round(W*7/360));
const oceanMask=new Uint8Array(W*H),landMask=new Uint8Array(W*H),openMask=new Uint8Array(W*H);
for(let i=0;i<W*H;i++){const o=elevation[i]<=0?1:0;oceanMask[i]=o;landMask[i]=o?0:1;}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(oceanMask[i]&&oceanMask[y*W+((x+openRun)%W)])openMask[i]=1;}
// East-coast (windward) ocean proximity — the single most important signal for
// where the subtropical deserts AREN'T. Humid subtropics (SE US, SE China, SE
// Brazil, E Australia, Natal) sit on the EAST side of continents: warm western-
// boundary currents + onshore summer flow keep them wet at the same latitude
// where the WEST sides and interiors (Sahara, Arabia, Atacama, Namib, W Australia,
// SW US) are bone-dry. eastWet→1 on an east coast (open ocean within ~18° east),
// →0 for interiors and west coasts; later it spares those coasts from the drying.
const eastScan=Math.max(1,Math.round(W*18/360));
const _eastDist=dirDist(openMask,W,H,-1,eastScan);// px east to the nearest OPEN ocean
const eastWet=new Float32Array(W*H);
for(let i=0;i<W*H;i++)eastWet[i]=landMask[i]&&_eastDist[i]<=eastScan?Math.max(0,1-(_eastDist[i]-1)/eastScan):0;
// ── Ocean currents (SST anomalies) ──────────────────────────────────────────
// The base sea-surface temperature was purely zonal — latitude bands, no basin
// structure. Real ocean climate is set by the gyres, modelled here as four limbs,
// each keyed on which way the nearest coast lies and how open the basin is on the
// far side (so enclosed seas — Yellow Sea, Mediterranean, Hudson Bay — don't get
// open-ocean currents):
//   WESTERN boundary (coast to the WEST, open ocean to the EAST):
//     • WARM subtropical (~30°): Gulf Stream, Kuroshio, Brazil, Agulhas, E Australian.
//     • COLD subpolar (~54°): Labrador, Oyashio, E Greenland — these are why
//       Newfoundland and NE Asia are far colder than NW Europe at the same latitude.
//   EASTERN boundary (coast to the EAST, open ocean to the WEST):
//     • COLD subtropical (~23°, upwelling): California, Canary, Humboldt, Benguela —
//       the chill behind the great west-coast deserts.
//     • WARM subpolar drift (~53°): North Atlantic Drift, Alaska, S Chile, NZ — this
//       is what keeps NW Europe (Bergen, Britain) mild far past its latitude.
// currentAnom is added to ocean SST below; coastCur spills it onto the shores the
// current bathes so the land feels it too.
const ocScan=Math.max(1,Math.round(W*70/360));
const _landDistW=dirDist(landMask,W,H,1,ocScan),_landDistE=dirDist(landMask,W,H,-1,ocScan);
const currentAnom=new Float32Array(W*H);
for(let y=0;y<H;y++){const aLat=Math.abs(y/H-0.5)*2*90;
const subtropW=Math.exp(-((aLat-30)*(aLat-30))/(2*9*9));  // warm western boundary, ~21-39°
const subpolarW=Math.exp(-((aLat-54)*(aLat-54))/(2*9*9)); // cold western boundary, ~45-63°
const subtropE=Math.exp(-((aLat-23)*(aLat-23))/(2*13*13));// cold eastern boundary,  ~10-36°
const driftE=Math.exp(-((aLat-53)*(aLat-53))/(2*11*11));  // warm eastern drift,     ~42-64°
for(let x=0;x<W;x++){const i=y*W+x;if(elevation[i]>0)continue;
const dwDeg=_landDistW[i]*degPx,deDeg=_landDistE[i]*degPx;
const nearW=Math.max(0,1-dwDeg/14),nearE=Math.max(0,1-deDeg/14);// within ~14° of that coast
// "open basin" needs a WIDE fetch (>~10°), so marginal seas — North Sea, Sea of
// Japan, Mediterranean — don't spawn Gulf-Stream/Labrador-scale boundary currents
// (that was wrongly chilling Britain via a fake cold current in the North Sea).
const openE=Math.min(1,Math.max(0,deDeg-10)/26),openW=Math.min(1,Math.max(0,dwDeg-10)/26);
const wbWarm=nearW*openE*subtropW*0.125;
const wbCold=nearW*openE*subpolarW*0.095;
const ebCold=nearE*openW*subtropE*0.080;
const ebWarm=nearE*openW*driftE*0.105;
currentAnom[i]=wbWarm-wbCold-ebCold+ebWarm;}}
// Spill the current onto land. At 30-65° the WESTERLIES carry marine air far
// eastward, so the warm North-Atlantic Drift penetrates deep into W Europe (mild
// Paris, Berlin, even Moscow) while cold mid-ocean water (Iceland) only warms its
// own shore. Modelled as an anisotropic max-spread: near-lossless toward the EAST
// in the westerly belt, ordinary decaying spread otherwise. Off the westerly belt
// (tropics, high Arctic) the current just hugs the coast.
const coastCur=new Float32Array(currentAnom);
const _ccPrev=new Float32Array(W*H);
// (a) Isotropic coastal spill (all latitudes) — carries each current, warm OR cold,
//     onto the shore it bathes (cold Labrador/Humboldt stay coast-trapped here).
for(let pass=0;pass<6;pass++){_ccPrev.set(coastCur);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(elevation[i]<=0)continue;
let v=_ccPrev[i];
for(let d=0;d<4;d++){const xx=(x+(d===0?1:d===1?-1:0)+W)%W,yy=y+(d===2?1:d===3?-1:0);if(yy<0||yy>=H)continue;
const nv=_ccPrev[yy*W+xx]*0.85;if(Math.abs(nv)>Math.abs(v))v=nv;}
coastCur[i]=v;}}
// (b) Eastward westerly advection of WARM marine air — one L→R running sweep per row
//     in the 30-65° belt, carrying a decaying reservoir refreshed over warm ocean.
//     This is what mildens W Europe deep inland (Paris, Berlin) without warming the
//     cold mid-ocean (Iceland) or bleeding cold upwelling over the lee ranges.
for(let y=0;y<H;y++){const aLat=Math.abs(y/H-0.5)*2;if(aLat<=0.33||aLat>=0.74)continue;
let carry=0;
// per-pixel decays derived from per-DEGREE rates so the reach is resolution-independent
const oceanKeep=Math.pow(0.96,360/W),landDecay=Math.pow(0.94,360/W);// ~4%/° over sea, ~6%/° over land
for(let s=0;s<W+W;s++){const xx=s%W,i=y*W+xx;
if(elevation[i]<=0){const c=currentAnom[i];if(c>carry)carry=c;carry*=oceanKeep;}// warm ocean refreshes
else{carry*=landDecay;if(carry>coastCur[i])coastCur[i]=carry;}}}// land: apply if warmer
// Westerly continentality: distance (°) west to the upwind open ocean. The 30-65°
// belt is driven by the westerlies, so a SHORT west-fetch (W Europe, Pacific NW,
// W Patagonia) bathes in mild marine air that reaches far inland, while a LONG
// fetch — deep interiors and the EAST coasts that sit downwind of a whole continent
// (Manchuria, interior Asia/Canada) — gives cold-winter continental climates with a
// markedly lower annual-mean temperature. This (not plain coast distance) is what
// separates mild W Europe from frigid Manchuria at the same latitude.
const wfScan=Math.max(1,Math.round(W*75/360));
const _oceanDistW=dirDist(oceanMask,W,H,1,wfScan);// px west to the upwind ocean
const westFetch=new Float32Array(W*H);
for(let i=0;i<W*H;i++)if(landMask[i])westFetch[i]=Math.min(_oceanDistW[i],wfScan)*degPx;
// ── Two-season climate: the monsoon needs a seasonal cycle ──────────────────────
// An annual-mean wind has NO monsoon — the summer onshore inflow and the winter
// offshore outflow cancel, starving India, SE Asia and East China (Earth's wettest
// monsoon lands) into desert. So solve a boreal-SUMMER (July) and boreal-WINTER
// (January) wind, advect moisture under each (with the rain belt shifted into the
// summer hemisphere), and let the WETTER half-year set each cell's moisture — rain
// falls in the wet season no matter how dry the other half is. Temperature stays the
// annual mean, advected by the season-averaged wind.
let sumWX,sumWY,winWX,winWY;
if(realWind&&realWindFns&&realWindFns.isRealWindAvailable()){
// Real NCEP winds are an annual climatology — use the one field for both half-years
// (the seasonal ITCZ shift in the moisture pass still recovers the monsoon rain belt).
const rwX=new Float32Array(W*H),rwY=new Float32Array(W*H);
realWindFns.fillRealWind(W,H,rwX,rwY);
sumWX=winWX=rwX;sumWY=winWY=rwY;
console.log("Earth (Sim): using real NCEP/NCAR wind data");
}else{
const sumWind=solveWind(W,H,elevation,fbm,{..._tecParams,season:1},seed*0.0137);
const winWind=solveWind(W,H,elevation,fbm,{..._tecParams,season:-1},seed*0.0137);
sumWX=sumWind.windX;sumWY=sumWind.windY;winWX=winWind.windX;winWY=winWind.windY;
}
// Annual wind = mean of the two seasons (the monsoon cancels, the persistent
// westerlies / trades / gyres survive) — drives temperature & ocean-current advection.
tecWindX=new Float32Array(W*H);tecWindY=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tecWindX[i]=(sumWX[i]+winWX[i])*0.5;tecWindY[i]=(sumWY[i]+winWY[i])*0.5;}
const fWX=tecWindX,fWY=tecWindY;
// Seasonal moisture (ITCZ + Hadley descent shifted ±13° with the sun), then keep the
// WETTER half-year (lightly blended so a bone-dry season still pulls a cell down).
const moistSum=solveMoisture(W,H,elevation,sumWX,sumWY,temperature,{..._tecParams,itczLat:13});
const moistWin=solveMoisture(W,H,elevation,winWX,winWY,temperature,{..._tecParams,itczLat:-13});
const windMoisture=new Float32Array(W*H);
for(let i=0;i<W*H;i++){const a=moistSum[i],b=moistWin[i];windMoisture[i]=Math.max(a,b)*0.82+Math.min(a,b)*0.18;}
// Wind-advected temperature
const mW2=Math.ceil(W/2),mH2=Math.ceil(H/2);
const windTemp=new Float32Array(W*H);
const tGrid=new Float32Array(mW2*mH2);
for(let my=0;my<mH2;my++)for(let mx=0;mx<mW2;mx++){
const px=Math.min(W-1,mx*2),py=Math.min(H-1,my*2);
const lt=Math.abs(py/H-0.5)*2,e2=elevation[py*W+px];
// Elevation penalty: lapse-rate cooling. The old (.45+.8*lt) ran ~2× too steep
// for low-latitude high terrain — it froze the Tibetan Plateau / Andes / Rockies
// into Greenland-style ICE sheets (~25% of all land was elevation-ice). A gentler,
// near-constant lapse-rate penalty (.48+.12*lt) keeps Tibet cold-but-not-glaciated
// (~−6°C alpine steppe) while Greenland (high AND polar) still freezes.
// Southern-hemisphere polar cooling: the base curve is hemisphere-symmetric, but
// real Antarctica is far colder than the Arctic at the same latitude (isolated
// continent, circumpolar current, no oceanic heat transport). Without this the
// low-elevation Antarctic coast/peninsula sat above the ice threshold → forest.
const shCool=Math.max(0,(py/H-0.5)*2-0.53)*0.85;
tGrid[my*mW2+mx]=Math.max(0,Math.min(1,0.85-0.66*lt*lt+0.18*lt*lt*lt*lt+Math.exp(-((lt-0.15)*(lt-0.15))/(2*0.10*0.10))*0.035-Math.max(0,e2)*(.48+.12*lt)-shCool));}
for(let step=0;step<60;step++){const prev=new Float32Array(tGrid);// 60 iterations for deep heat transport
for(let my=1;my<mH2-1;my++)for(let mx=0;mx<mW2;mx++){
const px=Math.min(W-1,mx*2),py=Math.min(H-1,my*2),fi=py*W+px;
const wx2=fWX[fi],wy2=fWY[fi];
// Wind vectors are small (max ~0.25) — amplify strongly for temperature transport
// Target: Gulf Stream should push warm water ~500 pixels over 25 iterations
const srcX=mx-wx2*60.0,srcY=my-wy2*60.0;
// Wrap X for toroidal map
const sx=((Math.floor(srcX)%mW2)+mW2)%mW2;
const syC=Math.min(mH2-2,Math.max(0,Math.floor(srcY)));
const fdx=Math.max(0,Math.min(1,srcX-Math.floor(srcX))),fdy=Math.max(0,Math.min(1,srcY-syC));
const sxr=(sx+1)%mW2;
let upT=(prev[syC*mW2+sx]*(1-fdx)+prev[syC*mW2+sxr]*fdx)*(1-fdy)
+(prev[Math.min(mH2-1,syC+1)*mW2+sx]*(1-fdx)+prev[Math.min(mH2-1,syC+1)*mW2+sxr]*fdx)*fdy;
// Prevent ocean tiles from pulling hot land temps (causes coast shearing)
// If this is ocean but the source sample is very different from local, dampen it
const e2=elevation[fi],lt=Math.abs(py/H-0.5)*2;
const locT=Math.max(0,Math.min(1,0.85-0.66*lt*lt+0.18*lt*lt*lt*lt+Math.exp(-((lt-0.15)*(lt-0.15))/(2*0.10*0.10))*0.035-Math.max(0,e2)*(.48+.12*lt)-Math.max(0,(py/H-0.5)*2-0.53)*0.85));
if(e2<=0&&Math.abs(upT-prev[my*mW2+mx])>0.15){
// Dampen extreme jumps at coast boundaries
upT=prev[my*mW2+mx]*0.7+upT*0.3;}
// Ocean base temp is cooler than land (water absorbs more solar energy as latent heat)
// Ocean: slightly cooler in tropics (water buffers heat), slightly warmer at poles
// Ocean is MUCH cooler in tropics (water has huge heat capacity), warmer at poles
const oceanAdj=e2<=0?(lt<0.3?0.78:lt<0.5?0.85:lt<0.7?0.95:1.1):1.0;
const adjLocT=locT*oceanAdj;
// Ocean: wind transport dominates — once ocean picks up warm/cold water, it persists
// Use PREVIOUS value (which already has transport) blended with new transport, not base temp
if(e2<=0){
// Blend previous temp (momentum) with wind-advected — base temp only pulls weakly
tGrid[my*mW2+mx]=prev[my*mW2+mx]*0.7+upT*0.25+adjLocT*0.05;}// 55% wind influence — strong ocean currents
else{const tb=Math.min(0.8,Math.max(0,e2-0.05)*3);
// Land: warm advection penetrates more (0.45 base), cold less (0.25)
const bi=(1-tb*0.5)*0.45,wb=upT>locT?1.4:0.7;
const wi=Math.min(0.60,bi*wb);
tGrid[my*mW2+mx]=locT*(1-wi)+upT*wi;}}
// Smooth pass: 3x3 box blur on ocean tiles to remove coast shearing artifacts
if(step%3===0){const sm=new Float32Array(tGrid);
for(let sy2=1;sy2<mH2-1;sy2++)for(let sx2=0;sx2<mW2;sx2++){
const si2=sy2*mW2+sx2;const e3=elevation[Math.min(H-1,sy2*2)*W+Math.min(W-1,sx2*2)];
if(e3>0)continue;// only smooth ocean
const l=(sx2-1+mW2)%mW2,r2=(sx2+1)%mW2;
tGrid[si2]=(sm[si2]*4+sm[si2-mW2]+sm[si2+mW2]+sm[sy2*mW2+l]+sm[sy2*mW2+r2])/8;}}
}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
const fx=x/2,fy=y/2,ix=Math.min(mW2-2,fx|0),iy=Math.min(mH2-2,fy|0);
const dx2=fx-ix,dy2=fy-iy;
windTemp[y*W+x]=(tGrid[iy*mW2+ix]*(1-dx2)+tGrid[iy*mW2+Math.min(mW2-1,ix+1)]*dx2)*(1-dy2)
+(tGrid[(iy+1)*mW2+ix]*(1-dx2)+tGrid[(iy+1)*mW2+Math.min(mW2-1,ix+1)]*dx2)*dy2;}
// Final temperature & moisture combination
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H;
const e=elevation[i];
const cd=cdist[Math.min(CDH-1,Math.floor(y/CDT))*CDW+Math.min(CDW-1,Math.floor(x/CDT))];
// Coast proximity in DEGREES, not pixels: cd is in CDT(=4px) units, so the raw
// cd/8 ramp reached 0 at 8° inland at 1440-wide but only 6° at the app's 1920-wide
// — making everything read as "more inland" and over-drying the interiors at the
// resolution the app actually runs. (cd·CDT·360/W)/8° is resolution-independent.
const cp=Math.max(0,1-cd*(CDT*360/W)/8);
const tLat=Math.abs(ny-0.5)*2;// equator at map center (standard equirectangular)
const shE=Math.exp(-((tLat-0.12)*(tLat-0.12))/(2*0.14*0.14))*0.030;// equatorial+subtropical lift (humid tropics sit ~27°C); fades out by ~40° so it doesn't warm mid-latitudes
// Accurate annual-mean latitude curve (see tools/probe_temperature.mjs): nearly
// flat near the equator, steep through mid-latitudes, FLATTENING toward the pole
// (-23°C at 90°, not the old -60°C). Greenland/Antarctica ice via the elev penalty.
// Elevation penalty (.48+.12*tLat, was .45+.8) ~ a real 6.5°C/km lapse rate, only faintly lat-scaled so high terrain at low/mid
// latitudes (Tibet, Andes, Rockies) is cold alpine steppe, not a fake ice cap;
// southern-polar cooling (shCool) makes all of Antarctica ice, not just its high
// interior. See the wind-temp grid above for the full rationale.
const shCool=Math.max(0,(ny-0.5)*2-0.53)*0.85;
const bt=0.85-0.66*tLat*tLat+0.18*tLat*tLat*tLat*tLat+shE-Math.max(0,e)*(.48+.12*tLat)-shCool+fbm(nx*3+80,ny*3+80,3,2,.5)*.02+fbm(nx*1.2+55,ny*1.2+55,3,2,.55)*.025;
const inland=Math.max(0,1-cp);
// Westerly continentality (see westFetch above): 0 = oceanic, 1 = deep continental.
const conti=Math.min(1,westFetch[i]/45);
// Oceanic high latitudes run MILD (marine air off the upwind ocean — W Europe,
// Pacific NW, S Chile, NZ); the ocean-current drift on top of this carries the
// extra Gulf-Stream warmth. Replaces the old blanket coast warming that wrongly
// also warmed the cold-current east coasts.
const maritimeWarm=e>0?(1-conti)*Math.max(0,tLat-0.33)*0.16:0;
const tropicalCool=tLat<0.3?cp*0.005:0;// faint coastal sea-breeze cooling — equatorial coasts sit right on the curve
// Continentality is SIGNED and moisture-gated (a plain latitude curve can't see
// this): DRY SUBTROPICAL interiors run HOT (deserts — Sahara, Sonoran, Arabian),
// HIGH-LATITUDE interiors run COLD (Siberia, interior Canada). Open ocean is
// maritime — no continental effect at all.
// Subtropical (Hadley-subsidence) aridity — this is what builds the great deserts.
// Descending air on the ~18-38° belt kills rainfall; the wind solver badly
// underplays it (deserts come out at moisture 0.3-0.55, indistinguishable from the
// monsoon belt), so it's applied explicitly here. Two corrections over the old
// inland^1.3 gate, which left every coast wet and made the deserts far too small:
//  • Only LIGHTLY inland-gated (0.45 + 0.55*inland) so the drying reaches the SEA —
//    the eastern Sahara, Arabia, Atacama and Namib are bone-dry right to the coast.
//  • SPARED where it shouldn't apply: on EAST coasts (eastWet → warm-current humid
//    subtropics: SE US, SE China, SE Brazil, E Australia) and equatorward of ~18°
//    (equatorGuard → the ITCZ/monsoon tropics: S India, Indochina, the Sahel).
// Without the spares a uniform belt would desertify the populated humid subtropics;
// without the reach the deserts stay puddles. Together they give east-wet/west-dry.
// The subtropical desert belt is a 20-32° feature (descending Hadley air). It must
// FADE OUT by ~34° — beyond that the westerlies/storm tracks make the mid-latitudes
// humid (the eastern US, E Europe are forest, not desert). The old wide belt reached
// 40°N and desertified the whole interior down to the 0.02 floor even though the
// solver gave it a sensible ~0.4; this tight Gaussian leaves the mid-latitudes to
// the solver + a gentle continentality nudge.
const beltLat=Math.exp(-((tLat-0.275)*(tLat-0.275))/(2*0.095*0.095));// subtropical-high belt, widened to ~16-36° so it also reaches the poleward deserts (US SW, N Iran, Patagonia) now that the monsoon spare protects the wet subtropics
// equatorGuard keeps the everwet ITCZ tropics (0-~9°: the Congo/Amazon/Borneo
// rainforests) out of the subtropical desert drying. It opens up by ~14° (was ~20°)
// because the great TRADE-WIND deserts reach the low teens — the Arabian peninsula
// is bone-dry down to ~13°N (Rub al Khali, Yemen interior), the Horn of Africa to
// the equator. The genuinely wet monsoon coasts at those latitudes (Guinea, the
// Indian west coast, Indochina) are held by monsoonSpare + their own high rainfall.
const equatorGuard=Math.max(0,Math.min(1,(tLat-0.10)/0.05));// 0 below ~9°, 1 above ~13.5°
// ── Monsoon strength, straight from the two-season solve ────────────────────────
// summerWet is the wet half-year's moisture (July for the N hemisphere, January for
// the S) — a DIRECT physical measure of whether a real monsoon waters this cell.
// India / SE Asia / E China / the US Southeast / the Gran Chaco get a drenching wet
// season (≳0.5); the trade-wind deserts (Sahara, Arabia, US SW, interior Australia,
// the Kalahari) stay dry in BOTH halves. It SPARES the explicit belt drying exactly
// where the monsoon earns it — so India (20°N, monsoon) stays wet while the US SW
// (33°N, no monsoon) dries to desert at the SAME belt strength. This one signal
// replaces the geographic hacks (east-coast spare, equatorward spillover, the Andes
// low-level jet) the annual-mean solve needed to fake seasonal rain it couldn't see.
const summerWet=ny<0.5?moistSum[i]:moistWin[i];
const lonDeg=nx*360-180,latS=(ny-0.5)*2;
// The monsoon spare is now the MAX of three signals:
//  (a) the genuine monsoon, straight from the two-season wet-season moisture;
//  (b) the WARM-CURRENT humid subtropics (SE US, SE China, SE Brazil, E Australia) —
//      east-coastal + poleward of ~22°, humid off the western-boundary currents even
//      where the monsoon proper is weak (this is what separates humid Atlanta from
//      desert Arizona at the same latitude, which wet-season moisture alone cannot);
//  (c) the Andes low-level jet — the Andes channel Amazon moisture south into the
//      Chaco/Paraná, a sub-grid feature the coarse summer monsoon can't resolve.
const humidSubtrop=Math.min(1,Math.max(0,(tLat-0.23)/0.05));
const llj=Math.exp(-((latS-0.30)*(latS-0.30))/(2*0.11*0.11))    // ~15-39°S (Chaco→Pampas)
  *Math.exp(-((lonDeg+60)*(lonDeg+60))/(2*7*7))                 // lee of the Andes, ~53-67°W
  *Math.max(0,1-Math.max(0,e-0.05)*7);                          // low ground only
const monsoon=Math.max(
  Math.max(0,Math.min(1,(summerWet-0.45)/0.22)),
  Math.max(llj, Math.min(1,Math.max(0,(eastWet[i]-0.5)/0.2))*humidSubtrop));
const subtropDry=e>0?beltLat*equatorGuard*(0.70+0.30*inland)*0.58*(1-0.9*monsoon):0;
// Continental interiors (rain-shadow + far from any ocean) dry into the mid-latitude
// steppes and prairies — the Great Plains, the Eurasian steppe, the Pampas,
// Patagonia. Focused on ~23-61° so it doesn't over-dry the equatorial tropics into
// false desert; spared on humid east coasts; faded out of the boreal north where
// cold, not dryness, sets the biome. (Tropical savanna — the Sahel, East Africa —
// stays under-represented: it needs wet/dry monsoon seasonality the annual-mean
// solver doesn't model, and widening the savanna biome band would ripple into the
// resource/agriculture sim, so the biome band was widened instead — together with
// the savanna-belt drying below.)
const contBand=Math.max(0,Math.min(1,(tLat-0.26)/0.08))*Math.max(0,Math.min(1,(0.68-tLat)/0.12));
const contDry=e>0?inland*inland*contBand*0.05*(1-0.85*monsoon):0;
// Tropical savanna belt (~9-22°): a long DRY SEASON the annual-mean solver can't
// see leaves the Sahel, Cerrado, Llanos, N-Australian and Sudanian savannas far too
// wet (rainforest). A moderate drying here — inland-gated (humid coasts spared),
// equatorward-tapered (the everwet ITCZ rainforest at 0-8° untouched) and east-coast
// spared — opens up the savanna belt between the rainforest and the deserts.
const savBelt=Math.exp(-((tLat-0.18)*(tLat-0.18))/(2*0.07*0.07))*Math.max(0,Math.min(1,(tLat-0.07)/0.05));
const savDry=e>0?savBelt*(0.25+0.75*inland)*0.20*(1-0.4*monsoon):0;
// ── Saharo-Arabian / Horn aridity ─────────────────────────────────────────────
// The annual-mean solver floods the warm seas ringing Arabia and the Horn (Red Sea,
// Persian Gulf, Arabian Sea) with evaporated moisture that never rains out in reality:
// the summer-monsoon flow runs PARALLEL to these coasts (the Somali jet), driving
// upwelling, so the peninsula stays hyperarid down to ~13°N despite water on three
// sides AND the wet Ethiopian highlands just to its south. No latitude/continentality
// rule separates this from the genuine monsoon coasts at the same latitude (the solver
// even reads Yemen wetter than the Sahel), so it is an explicit geographic correction
// over the Afro-Arabian desert — centred on the Empty Quarter (~46°E, ~21°N), tapering
// smoothly to nothing by the Nile to the west and the Indus to the east. Strengthened
// for the two-season solve because the shifted summer ITCZ now also reaches into Yemen.
const araLon=Math.exp(-((lonDeg-46)*(lonDeg-46))/(2*9*9));
const araLat=Math.exp(-((tLat-0.235)*(tLat-0.235))/(2*0.088*0.088));
const arabiaDry=e>0?araLon*araLat*0.78:0;
// ── Savanna seasonality ─────────────────────────────────────────────────────────
// A long DRY SEASON thins tropical forest into savanna/grassland, but the wet-season
// blend reads wet-summer/dry-winter savanna (N. Australia, East Africa, the Cerrado,
// the Indian Deccan) as rainforest. Penalise by the wet/dry CONTRAST the two-season
// solve actually resolves — thresholded, so the everwet rainforests (Amazon/Congo, a
// small contrast) and the wet monsoon coasts (Western Ghats, wet in BOTH halves) are
// left alone — within the warm latitudes where savanna forms.
const drySeason=ny<0.5?moistWin[i]:moistSum[i];
const savWarm=Math.max(0,Math.min(1,(0.34-tLat)/0.10));// warm tropics/subtropics only
// Moderate strength: enough to open the savanna belt (Deccan, Cerrado, N-Australian
// interior → dry-forest/savanna) without driving the very wet windward monsoon coasts
// (Western Ghats) below forest. The everwet rainforests are spared by the threshold
// (their wet/dry contrast is small).
const savSeasonDry=e>0?Math.max(0,(summerWet-drySeason)-0.16)*0.80*savWarm:0;
// ── Patagonian / Monte rain shadow ──────────────────────────────────────────────
// The real southern Andes (2-3 km) wring the westerlies into steppe-to-desert from
// ~35-52°S; but the heightmap renders that cordillera at barely 0.1 elevation, too low
// for the moisture solver's föhn drying to bite, so the lee comes out a temperate
// rainforest. Restore the shadow as a bounded drying in the lee, east of the true crest.
const patShadow=e>0?Math.exp(-((latS-0.49)*(latS-0.49))/(2*0.095*0.095))*Math.exp(-((lonDeg+66)*(lonDeg+66))/(2*3.2*3.2))*Math.max(0,1-Math.max(0,e-0.05)*4)*0.62:0;
// ── Combine the drying ──
// Subtropical subsidence + the Arabian/Patagonian terms build the true deserts (0.02).
// Continental + savanna drying only thin forest into steppe/savanna (grassland floor).
let mo=Math.max(0.02,windMoisture[i]-subtropDry-arabiaDry-patShadow);
const steppeDry=contDry+savDry+savSeasonDry,steppeFloor=0.15;
mo=mo>steppeFloor?Math.max(steppeFloor,mo-steppeDry):mo;
// Interior-Asia alpine/steppe lift. The high cold knot of inner Asia — the eastern
// Tibetan plateau, the Pamir/Tian Shan/Kunlun ranges, the Mongolian/Loess margins — is
// in the monsoon's RAIN SHADOW (the Himalaya wrings it out), so even the two-season
// solve leaves it bone-dry and it reads as one vast grey cold-desert. In reality the
// eastern plateau and the ranges still catch orographic and spillover moisture (alpine
// meadow, montane steppe). A bounded lift (lon ~60-110°E, lat ~30-48°N) thins that grey
// toward tundra/steppe; it tapers out before the Iranian deserts to the west.
const asiaLon=Math.exp(-((lonDeg-86)*(lonDeg-86))/(2*15*15));
const asiaLat=Math.exp(-((tLat-0.42)*(tLat-0.42))/(2*0.10*0.10));
mo=Math.min(1,mo+asiaLon*asiaLat*0.12);
const dry=Math.max(0,1-mo/0.35);// 1 = bone-dry, 0 = humid
const desertHeat=dry*0.09*Math.exp(-((tLat-0.22)*(tLat-0.22))/(2*0.13*0.13));// peaks on the 13-30° HOT-DESERT belt (Sahel, Sahara, Arabia — Earth's hottest annual means), not the 33° subtropics
// Continental winters depress the ANNUAL mean only where summers can't compensate,
// i.e. it ramps in quadratically with latitude (negligible at 40° — Beijing's hot
// summers balance its cold winters to near its zonal mean — but severe by 55-65°:
// interior Siberia/Canada). Scaled by WEST-FETCH (conti) so maritime west coasts at
// the same latitude are spared.
const interiorCold=Math.min(0.06,conti*Math.pow(Math.max(0,tLat-0.40),2)*1.8);
const continental=e>0?inland*desertHeat-interiorCold:0;
const mt=bt+maritimeWarm-tropicalCool+continental+Math.max(0,0.60-bt)*cp*0.05;// coastal moderation: warms COLD maritime coasts toward ~0°C, never cools warm ones
const wt=windTemp[i];
// The wind-advected field (wt) homogenises the latitude gradient over its 60
// iterations — useful for current-driven flavour (warm NW-Europe coasts) but it
// flattens the equator-to-pole spread if it dominates. So the accurate base
// latitude curve (mt) leads; wt only nudges (8% everywhere — an ocean-specific
// weighting was tried and abandoned; this is the calibrated blend).
// Ocean-current SST anomaly: full on open water, a decaying coastal fraction on
// the shores the current bathes (so e.g. NW Europe runs mild, the Namib/Atacama
// coasts run chilly) — see the current model up top.
const curAnom=e<=0?currentAnom[i]:coastCur[i]*0.7;
temperature[i]=Math.max(0,Math.min(1,mt*0.92+wt*0.08+curAnom));
moisture[i]=mo;}
}else if(preset==="pangaea"){
// ── Pangaea mode: 100% land with mountains, valleys, climate ──
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
// Base elevation: always land, varied terrain from fbm
let e=0.08+fbm(nx*6+3.7,ny*6+3.7,5,2,.5)*.15
+Math.pow(Math.max(0,fbm(nx*3+20,ny*3+20,4,2.2,.5)),2)*.4// mountain ranges
+fbm(nx*14+7,ny*14+7,3,2,.4)*.06// fine detail
+Math.pow(1-Math.abs(fbm(nx*2.5+40,ny*2.5+40,3,2.1,.5)),4)*.25;// ridges
// Polar tundra: slightly elevated but not dramatically
if(lat>.85)e=Math.max(0.01,e*0.5);
// Valley systems (subtract to create lowlands)
e-=Math.pow(Math.max(0,fbm(nx*4+60,ny*4+60,3,2,.5)+.1),2)*.15;
elevation[i]=Math.max(0.005,e);
// Moisture: climate zones + elevation effects
const tropWet=Math.max(0,1-lat*2.5);
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.08*.08))*.30;// subtropical HP belt, softened
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.20;
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.40+tropWet*.35-subtropDry+tempWet-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.15
+fbm(nx*1.5+90,ny*1.5+90,3,2,.55)*.15;// continent-scale wet/dry to break banding
if(e<0.06)m+=.15;// valleys are wet
if(e>0.3)m-=.15;// mountains are drier
moisture[i]=Math.max(.02,Math.min(1,m));
temperature[i]=Math.max(0,Math.min(1,0.92-Math.pow(lat,1.5)*0.50-Math.pow(lat,6)*0.80-Math.max(0,e)*(.4+.8*lat)+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
}else if(preset==="tectonic"){
// ── Tectonic plate mode: separate module ──
const tec=generateTectonicWorld(W,H,seed,{initNoise,fbm,ridged,noise2D,worley},_tecParams);
for(let i=0;i<W*H;i++){elevation[i]=tec.elevation[i];moisture[i]=tec.moisture[i];temperature[i]=tec.temperature[i];}
tecPlates=tec.pixPlate;tecWindX=tec.windX;tecWindY=tec.windY;
}else{
// ── Random world mode: multi-stamp composition with advanced coastline shaping ──
// [1] MULTI-STAMP COMPOSITION: 3-6 sub-ellipses per continent + negative stamps for bays
const continents=[];
const numCont=3+Math.floor(rng()*4);// 3-6 continents
for(let c=0;c<numCont;c++){
const cx=rng(),cy=.08+rng()*.84,no=rng()*100;
// Each continent: 2-5 overlapping stamps. First stamp is always the broad core (low aspect).
// Later stamps can be peninsulas (higher aspect) but spread wider from center.
const subs=[];const numSubs=2+Math.floor(rng()*4);
for(let s=0;s<numSubs;s++){
const ang=rng()*Math.PI*2;
// First stamp: centered core. Others: spread wider to avoid strip-piling
const dist=s===0?0:.06+rng()*.12;
// Aspect: core is broad (1-1.5), peninsulas are moderate (1-2.5), max one long one (up to 3)
const aspect=s===0?1+rng()*.5:s===1&&rng()<.3?1.5+rng()*1.5:1+rng()*1.5;
const baseR=s===0?.08+rng()*.1:.04+rng()*.08;
subs.push({cx:cx+Math.cos(ang)*dist,cy:cy+Math.sin(ang)*dist,
rx:baseR*aspect,ry:baseR/aspect,rot:rng()*Math.PI,str:s===0?.8+rng()*.4:.5+rng()*.4,no:no+s*17});}
// 0-2 negative stamps carve bays/gulfs
const negs=[];const numNegs=Math.floor(rng()*2.5);
for(let n=0;n<numNegs;n++){
const ang=rng()*Math.PI*2,dist=.02+rng()*.06;
negs.push({cx:cx+Math.cos(ang)*dist,cy:cy+Math.sin(ang)*dist,
rx:.02+rng()*.04,ry:.015+rng()*.03,rot:rng()*Math.PI,str:.25+rng()*.3,no:no+50+n*13});}
continents.push({subs,negs});}
const s1=rng()*100,s2=rng()*100,s3=rng()*100,s4=rng()*100,s5=rng()*100;
// Flatten all stamps into single arrays for faster iteration
const posStamps=[],negStamps=[];
for(const cont of continents){for(const c of cont.subs){c.cos=Math.cos(c.rot);c.sin=Math.sin(c.rot);posStamps.push(c);}
for(const c of cont.negs){c.cos=Math.cos(c.rot);c.sin=Math.sin(c.rot);negStamps.push(c);}}
// Step 1: Generate raw elevation with all techniques
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const nx=x/W,ny=y/H;let e=0;
// [7] ITERATIVE DOMAIN WARPING (double Quilez warp, reduced octaves for speed)
const w1x=fbm(nx*2.5+s1,ny*2.5+s1,2,2,.5)*.08,w1y=fbm(nx*2.5+s1+50,ny*2.5+s1+50,2,2,.5)*.08;
const wnx=nx+w1x+fbm((nx+w1x)*5+s2,(ny+w1y)*5+s2,2,2,.5)*.04;
const wny=ny+w1y+fbm((nx+w1x)*5+s2+30,(ny+w1y)*5+s2+30,2,2,.5)*.04;
// Positive stamps (landmass lobes + peninsulas + islands)
// Shared coastline noise (computed once, not per-stamp)
const cnA=noise2D(wnx*5+s1,wny*5+s1)*.04,cnB=noise2D(wnx*5+s1+30,wny*5+s1+30)*.04;
const coastRidge=noise2D(wnx*14+s2+50,wny*14+s2+50);
for(const c of posStamps){let dx=wnx-c.cx+cnA;if(dx>.5)dx-=1;if(dx<-.5)dx+=1;let dy=wny-c.cy+cnB;
let dd=Math.sqrt(Math.pow((dx*c.cos+dy*c.sin)/c.rx,2)+Math.pow((-dx*c.sin+dy*c.cos)/c.ry,2));
// [3] RIDGED NOISE AT COASTLINES — per-stamp offset varies the coastline noise
dd+=Math.abs(coastRidge+noise2D(wnx*7+c.no,wny*7+c.no)*.5)*.2;
if(dd>.7&&dd<1.3){const rn=1-Math.abs(noise2D(wnx*8+c.no+70,wny*8+c.no+70));dd+=rn*rn*.12;}
if(dd<1){const f2=1-dd;e+=f2*f2*c.str;}}
// Negative stamps (bays/gulfs — subtract from elevation)
for(const c of negStamps){let dx=wnx-c.cx+cnA;if(dx>.5)dx-=1;if(dx<-.5)dx+=1;let dy=wny-c.cy+cnB;
let dd=Math.sqrt(Math.pow((dx*c.cos+dy*c.sin)/c.rx,2)+Math.pow((-dx*c.sin+dy*c.cos)/c.ry,2));
dd+=Math.abs(coastRidge+noise2D(wnx*5+c.no,wny*5+c.no)*.5)*.18;
if(dd<1){const f2=1-dd;e-=f2*f2*c.str;}}
// [5] MULTI-THRESHOLD NOISE STACKING: peninsula/bay features (gentler, lower freq)
const penNoise=fbm(wnx*4+s3+90,wny*4+s3+90,3,2,.5);
if(penNoise>.4)e+=(penNoise-.4)*.2;// higher threshold, lower strength
const bayNoise=fbm(wnx*3.5+s4+120,wny*3.5+s4+120,3,2,.5);
if(bayNoise>.45)e-=(bayNoise-.45)*.18;
// [4] WORLEY F2-F1: only affects areas near existing land (not open ocean)
const[wf1,wf2]=worley(wnx*5+s5,wny*5+s5);
if(e>-.1)e+=(wf2-wf1)*.04-.02;// weaker, and only where there's already some elevation
// Domain-warped base terrain
e+=fbm(wnx*7+3.7,wny*7+3.7,4,2,.5)*.10;
// Fine detail
e+=fbm(nx*20+s3,ny*20+s3,2,2,.4)*.025;
rawElev[y*W+x]=e;}
// Step 2: Determine sea level at 70th percentile
const sorted=Float32Array.from(rawElev).sort();const sl=sorted[Math.floor(W*H*(oceanLevel||0.78))];
const isLandArr=new Uint8Array(W*H);for(let i=0;i<W*H;i++)isLandArr[i]=rawElev[i]>sl?1:0;
// Remove tiny isolated land clusters (< 20 pixels) via flood fill
const visited=new Uint8Array(W*H);
for(let i=0;i<W*H;i++){if(!isLandArr[i]||visited[i])continue;
const q=[i],cluster=[];visited[i]=1;
while(q.length){const ci=q.pop();cluster.push(ci);const cx2=ci%W,cy2=(ci-cx2)/W;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;
const nx2=(cx2+dx+W)%W,ny2=cy2+dy;if(ny2<0||ny2>=H)continue;
const ni=ny2*W+nx2;if(isLandArr[ni]&&!visited[ni]){visited[ni]=1;q.push(ni);}}}
if(cluster.length<20)for(const ci of cluster){isLandArr[ci]=0;rawElev[ci]=sl-.01;}}
// Coast-distance BFS for continentality
const DG=RES,dw=Math.ceil(W/DG),dh=Math.ceil(H/DG);
const cdist2=new Uint8Array(dw*dh);cdist2.fill(255);const cdQ2=[];
for(let ty=0;ty<dh;ty++)for(let tx=0;tx<dw;tx++){
const px=Math.min(W-1,tx*DG),py=Math.min(H-1,ty*DG),ti=ty*dw+tx;
if(!isLandArr[py*W+px])continue;
for(let ddy=-1;ddy<=1;ddy++)for(let ddx=-1;ddx<=1;ddx++){
const nx2=(tx+ddx+dw)%dw,ny2=ty+ddy;if(ny2<0||ny2>=dh)continue;
const np=Math.min(W-1,nx2*DG),npy=Math.min(H-1,ny2*DG);
if(!isLandArr[npy*W+np]){cdist2[ti]=0;cdQ2.push(ti);break;}}}
for(let qi=0;qi<cdQ2.length;qi++){const ci=cdQ2[qi],cd=cdist2[ci],cx2=ci%dw,cy2=(ci-cx2)/dw;
for(let ddy=-1;ddy<=1;ddy++)for(let ddx=-1;ddx<=1;ddx++){if(!ddx&&!ddy)continue;
const nx2=(cx2+ddx+dw)%dw,ny2=cy2+ddy;if(ny2<0||ny2>=dh)continue;
const ni=ny2*dw+nx2,nd=cd+1;const np=Math.min(W-1,nx2*DG),npy=Math.min(H-1,ny2*DG);
if(nd<cdist2[ni]&&isLandArr[npy*W+np]){cdist2[ni]=nd;cdQ2.push(ni);}}}
// Step 3: Final elevation — [2] SHALLOW COASTAL GRADIENTS + terrain shaping
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
let e=rawElev[i]-sl;
// Unified terrain — one continuous surface, no land/ocean split
e=e*0.3;
if(preset!=="continental"){// Default: continentality-based shaping (land only, ocean passes through)
if(e>0){const raw=e,domeH=Math.min(1,raw/0.15);
const cd=cdist2[Math.min(dh-1,Math.floor(y/DG))*dw+Math.min(dw-1,Math.floor(x/DG))];
const interior=Math.min(1,cd/15);
const[wmx,wmy]=warp(nx,ny,2,3,0.1,s4,s4+40);
e+=ridged(wmx*4+s5,wmy*4+s5,5,2.2,2.0,1.0)*interior*interior*domeH*0.45;
const[whx,why]=warp(nx,ny,4,3,0.05,s3+20,s3+70);
e+=Math.max(0,fbm(whx*6+s2,why*6+s2,4,2,.5))*.08*Math.sqrt(interior);
e-=Math.max(0,fbm(nx*5+s1+60,ny*5+s1+60,3,2,.5)+.15)*.06*interior;
e=Math.pow(Math.max(0,e),0.85)*1.2;e=Math.max(0.003,e);}
}else{// Continental: features scale by distance from sea level
// Stronger features deep in ocean or high on land, weaker near coastline
const featureStr=Math.min(1,Math.abs(e)*8);
const[wmx,wmy]=warp(nx,ny,2,3,0.1,s4,s4+40);
e+=(ridged(wmx*4+s5,wmy*4+s5,5,2.2,2.0,1.0)-0.45)*0.30*featureStr;
const[whx,why]=warp(nx,ny,4,3,0.05,s3+20,s3+70);
e+=fbm(whx*6+s2,why*6+s2,4,2,.5)*.06*featureStr;
e-=Math.max(0,fbm(nx*5+s1+60,ny*5+s1+60,3,2,.5)+.15)*.05*featureStr;}
elevation[i]=e;temperature[i]=Math.max(0,Math.min(1,0.92-Math.pow(lat,1.5)*0.50-Math.pow(lat,6)*0.80-Math.max(0,e)*(.4+.8*lat)+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
// Moisture with climate zones + continentality
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
if(elevation[i]<=0){moisture[i]=0.5+fbm(nx*3+30,ny*3+30,2,2,.5)*.1;continue;}
const cd=cdist2[Math.min(dh-1,Math.floor(y/DG))*dw+Math.min(dw-1,Math.floor(x/DG))];
const coastProx=Math.max(0,1-cd/8);
const tropWet=Math.max(0,1-lat*2.5);
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.08*.08))*.35*(1-coastProx*.5);
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.22;
const tropF=Math.max(0,1-lat*3);
const contRate=.006+(1-tropF)*.014;
const cont=Math.min(.28,cd*contRate);
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.42+tropWet*.42-subtropDry+tempWet-cont-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.12
+fbm(nx*1.5+90,ny*1.5+90,3,2,.55)*.15;// continent-scale wet/dry to break banding
if(elevation[i]>.15)m-=Math.min(.2,(elevation[i]-.15)*1);
if(elevation[i]<.02)m+=.10;
moisture[i]=Math.max(.02,Math.min(1,m));}}
const ctw=Math.ceil(W/RES),cth=Math.ceil(H/RES);const coastal=new Uint8Array(ctw*cth);
for(let ty=1;ty<cth-1;ty++)for(let tx=0;tx<ctw;tx++){const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
if(elevation[py*W+px]>0){
outer:for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const wx=((tx+dx)%ctw+ctw)%ctw,wy=ty+dy;if(wy<0||wy>=cth)continue;
const npx=Math.min(W-1,wx*RES),npy=Math.min(H-1,wy*RES);
if(elevation[npy*W+npx]<=0){coastal[ty*ctw+tx]=1;break outer;}}}}
// Swamps: low-lying wet warm terrain
const swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elevation[i]>0&&elevation[i]<0.025&&moisture[i]>0.45&&temperature[i]>0.35){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);
if(nv>-0.1)swamp[i]=1;}}
return{elevation,moisture,temperature,coastal,swamp,width:W,height:H,preset,pixPlate:tecPlates,windX:tecWindX||null,windY:tecWindY||null,_seed:seed};}
