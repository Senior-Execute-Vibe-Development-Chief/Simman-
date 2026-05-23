import { useState, useEffect, useRef, useCallback } from "react";
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "./earthData.js";
import { generateTectonicWorld } from "./tectonicGen.js";
import { solveWind } from "./windSolver.js";
import { solveMoisture } from "./moistureSolver.js";
import { initGL, uploadTileData, renderGL } from "./glRenderer.js";
import { isRealWindAvailable, fillRealWind } from "./realWindData.js";
import GlobeView from "./GlobeView.jsx";
import TuningPanel, { ParamEditor, renderPreview } from "./TuningPanel.jsx";
import { PARAMS, loadPresets, savePreset, deletePreset } from "./paramDefs.js";
import { parseAzgaarJSON, rasterizeAzgaar, rasterizeHeightmap, loadImageFile } from "./mapImport.js";
import { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } from "./resourceGen.js";
import { computeRivers, riverName, RIVER_NAMES, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } from "./riverGen.js";
import { ensureTribeViews, attachRegistries } from "./tribeModel.js";
import WorldGenWorker from "./worldGenWorker.js?worker&inline";

const PERM=new Uint8Array(512);const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed){const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){seed=(seed*16807)%2147483647;const j=seed%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)PERM[i]=p[i&255];}
function noise2D(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));return l1+v*(l2-l1);}
function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}
// Domain warping: distort coordinates using noise for organic shapes (Inigo Quilez technique)
function warp(x,y,freq,oct,str,off1,off2){
const wx=x+fbm(x*freq+off1,y*freq+off1,oct,2,.5)*str;
const wy=y+fbm(x*freq+off2,y*freq+off2,oct,2,.5)*str;
return[wx,wy];}
// Ridged multifractal noise: sharp ridges at zero-crossings, feedback-weighted
function ridged(x,y,oct,lac,gain,off){
let v=0,a=1,f=1,w=1,m=0;
for(let i=0;i<oct;i++){let s=off-Math.abs(noise2D(x*f,y*f));s*=s;s*=w;w=Math.min(1,Math.max(0,s*gain));
v+=s*a;m+=a;a*=.5;f*=lac;}return v/m;}
// Worley (cellular) noise: returns [F1, F2] distances to nearest two seed points
function worley(x,y){
const ix=Math.floor(x),iy=Math.floor(y);let d1=9,d2=9;
for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
const cx=ix+dx,cy=iy+dy;
// Hash cell to get seed point position
const h1=PERM[(PERM[(cx&255)]+((cy&255)))&511],h2=PERM[(h1+73)&511];
const px=cx+(h1/255),py=cy+(h2/255);
const dd=(x-px)*(x-px)+(y-py)*(y-py);
if(dd<d1){d2=d1;d1=dd;}else if(dd<d2)d2=dd;}
return[Math.sqrt(d1),Math.sqrt(d2)];}
function mkRng(s){s=((s%2147483647)+2147483647)%2147483647||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}

const RES=1;
// ── Mercator projection helpers ──
const MAX_LAT_DEG = 78;
const MAX_LAT = MAX_LAT_DEG * Math.PI / 180;
const MERC_MAX = Math.log(Math.tan(Math.PI / 4 + MAX_LAT / 2));
const CW_FLAT = 1920, CH_FLAT = 960; // equirectangular canvas (matches world at RES=1)
// Mercator height: match equator pixel scale to flat mode, then add space for polar stretch
// Formula: CH = 2 * MERC_MAX * (CH_FLAT / π) — equator stays same size as flat mode
const CH_MERC = Math.round(2 * MERC_MAX * CH_FLAT / Math.PI); // ~688
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

// Static climate: no ice ages or sea level changes
const CLIMATE={tempMod:0,seaLevel:0,wet:0.7};

function generateWorld(W,H,seed,preset,oceanLevel,_unused=true,realWind=false){
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
// Steeper cold curve: lat² term makes high latitudes drop faster (Moscow at 56°N IS cold)
temperature[i]=Math.max(0,Math.min(1,1-Math.pow(lat,2.0)*1.15-lat*lat*lat*0.1-Math.max(0,elevation[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));}
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
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
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
// Wind: use real NCEP/NCAR data if available and toggled, otherwise solver
if(realWind&&isRealWindAvailable()){
tecWindX=new Float32Array(W*H);tecWindY=new Float32Array(W*H);
fillRealWind(W,H,tecWindX,tecWindY);
console.log("Earth (Sim): using real NCEP/NCAR wind data");
}else{
const esWind=solveWind(W,H,elevation,fbm,_tecParams,seed*0.0137);
tecWindX=esWind.windX;tecWindY=esWind.windY;
}
const fWX=tecWindX,fWY=tecWindY;
// Moisture solver — physically-grounded evaporation → transport → precipitation
const windMoisture=solveMoisture(W,H,elevation,fWX,fWY,temperature,_tecParams);
// Wind-advected temperature
const mW2=Math.ceil(W/2),mH2=Math.ceil(H/2);
const windTemp=new Float32Array(W*H);
const tGrid=new Float32Array(mW2*mH2);
for(let my=0;my<mH2;my++)for(let mx=0;mx<mW2;mx++){
const px=Math.min(W-1,mx*2),py=Math.min(H-1,my*2);
const lt=Math.abs(py/H-0.5)*2,e2=elevation[py*W+px];
tGrid[my*mW2+mx]=Math.max(0,Math.min(1,1-Math.pow(lt,2.0)*1.15-lt*lt*lt*0.1+Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06-Math.max(0,e2)*0.45));}
for(let step=0;step<60;step++){const prev=new Float32Array(tGrid);// 60 iterations for deep heat transport
for(let my=1;my<mH2-1;my++)for(let mx=0;mx<mW2;mx++){
const px=Math.min(W-1,mx*2),py=Math.min(H-1,my*2),fi=py*W+px;
const wx2=fWX[fi],wy2=fWY[fi];
// Wind vectors are small (max ~0.25) — amplify strongly for temperature transport
// Target: Gulf Stream should push warm water ~500 pixels over 25 iterations
const srcX=mx-wx2*60.0,srcY=my-wy2*60.0;
// Wrap X for toroidal map
const sx=((Math.floor(srcX)%mW2)+mW2)%mW2,sy=Math.min(mH2-2,Math.max(0,srcX|0));
const syC=Math.min(mH2-2,Math.max(0,Math.floor(srcY)));
const fdx=Math.max(0,Math.min(1,srcX-Math.floor(srcX))),fdy=Math.max(0,Math.min(1,srcY-syC));
const sxr=(sx+1)%mW2;
let upT=(prev[syC*mW2+sx]*(1-fdx)+prev[syC*mW2+sxr]*fdx)*(1-fdy)
+(prev[Math.min(mH2-1,syC+1)*mW2+sx]*(1-fdx)+prev[Math.min(mH2-1,syC+1)*mW2+sxr]*fdx)*fdy;
// Prevent ocean tiles from pulling hot land temps (causes coast shearing)
// If this is ocean but the source sample is very different from local, dampen it
const e2=elevation[fi],lt=Math.abs(py/H-0.5)*2;
const locT=Math.max(0,Math.min(1,1-Math.pow(lt,2.0)*1.15-lt*lt*lt*0.1+Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06-Math.max(0,e2)*0.45));
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
if(e2<=0){const wMix=lt<0.3?0.30:lt<0.6?0.50:0.60;
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
const cp=Math.max(0,1-cd/8);
const tLat=Math.abs(ny-0.5)*2;// equator at map center (standard equirectangular)
const shE=Math.exp(-((tLat-0.20)*(tLat-0.20))/(2*0.08*0.08))*0.06;
// Steeper curve: pow(2.0)*1.35 drops faster at mid-latitudes
const bt=1-Math.pow(tLat,2.0)*1.15-tLat*tLat*tLat*0.1+shE-Math.max(0,e)*0.45+fbm(nx*3+80,ny*3+80,3,2,.5)*.08+fbm(nx*1.2+55,ny*1.2+55,3,2,.55)*.10;
const inland=Math.max(0,1-cp);
// Maritime effect: coasts are WARMER at high latitudes (Gulf Stream, ocean heat release)
// and slightly COOLER in tropics (sea breeze). Inland is MORE extreme (hot summers, cold winters).
// At 40-65° lat: coastal areas up to +10°C warmer than inland (London vs Moscow)
const maritimeWarm=tLat>0.3?Math.min(0.12,((tLat-0.3)*0.4))*cp:0;// warming from ocean proximity at high lat
const tropicalCool=tLat<0.3?cp*0.05:0;// slight coastal cooling in tropics (sea breeze)
const continentality=inland*tLat*0.08;// inland areas are colder at high lat (Yakutsk vs Anchorage)
const mt=bt+maritimeWarm-tropicalCool-continentality+(0.45-bt)*cp*0.15;
const wt=windTemp[i];
// Ocean tiles get more wind influence (ocean currents = wind-driven)
const isOcean=e<=0;
temperature[i]=Math.max(0,Math.min(1,isOcean?mt*0.35+wt*0.65:mt*0.60+wt*0.40));
moisture[i]=windMoisture[i];}
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
temperature[i]=Math.max(0,Math.min(1,1-Math.pow(lat,2.0)*1.15-lat*lat*lat*0.1-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
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
elevation[i]=e;temperature[i]=Math.max(0,Math.min(1,1-Math.pow(lat,2.0)*1.15-lat*lat*lat*0.1-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
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
[140,135,78],    // 14 Shrubland — olive-brown chaparral
[78,118,48],     // 15 Tropical Dry Forest — muted olive-green
[152,145,135],   // 16 Barren / Alpine — gray-brown rock
[42,110,38],     // 17 Subtropical Forest — warm humid (SE US, S China, SE Brazil)
[195,190,180]    // 18 Cold Desert / Polar Desert — pale gray-tan
];
const BN=['Deep Ocean','Shallow Ocean','Coastal Water','Beach','Tundra','Snow / Ice','Taiga',
'Boreal Forest','Temperate Forest','Temperate Rainforest','Tropical Rainforest','Savanna',
'Grassland','Desert','Shrubland','Tropical Dry Forest','Barren / Alpine',
'Subtropical Forest','Cold Desert'];
function getBiomeD(e,m,t,sl){
  if(e<=sl)return e<sl-.08?0:e<sl-.01?1:2;
  // Effective moisture: cold regions retain moisture (low evaporation),
  // hot regions lose it to evaporation (Holdridge PET principle).
  const demand=.5+t*.5;
  const em=Math.min(1,m/demand);
  // Permanent ice: extremely cold → snow/ice (Arctic, Antarctic, glaciers)
  if(t<.08)return 5;
  // Polar / subpolar (low elevation only)
  // Cold desert only where it's cold but not freezing AND very dry
  if(t<.15)return em>.4?6:em>.08?4:18; // Taiga / Tundra / Cold Desert
  if(t<.25)return em>.35?6:em>.08?4:18;
  if(t<.38)return em>.45?7:em>.25?6:em>.08?4:18;
  // Temperate (cool-moderate)
  if(t<.55)return em>.55?9:em>.35?8:em>.15?12:13;
  // Warm / subtropical
  if(t<.72)return em>.5?17:em>.3?15:em>.18?11:em>.1?14:13;
  // Hot / tropical
  return em>.5?10:em>.3?15:em>.18?11:em>.1?12:13;
}
function getColorD(e,m,t,sl){const c=BC[getBiomeD(e,m,t,sl)],v=((e*37.7+m*17.3+t*53.1)%1+1)%1;
return[(c[0]+(v-.5)*10)|0,(c[1]+(v-.5)*10)|0,(c[2]+(v-.5)*8)|0];}
function tribeRGB(id){const h=((id*67+20)%360)/360,s=(60+((id*31)%25))/100,l=(45+((id*17)%25))/100;
const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const hr=(pp,qq,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return pp+(qq-pp)*6*t;if(t<1/2)return qq;if(t<2/3)return pp+(qq-pp)*(2/3-t)*6;return pp;};
return[Math.round(hr(p,q,h+1/3)*255),Math.round(hr(p,q,h)*255),Math.round(hr(p,q,h-1/3)*255)];}

// ── Atlas (olde-map) cartographic symbols — hand-drawn map iconography ──
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

// Base climate fertility: temperature fitness × moisture bell curve, penalized by elevation
// Agriculture needs adequate moisture (not maximum) — bell curve peaks at 0.45 (temperate optimum)
function tileFert(t,m,e){if(e>0.45)return 0.01;
const tFactor=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);
const mFactor=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));
const base=tFactor*mFactor;
return Math.max(0.01,base*(1-Math.max(0,e-0.15)*3));}

const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
// LEAPS kept as fallback geometry for voyage pathing
const LEAPS=[];for(let r=5;r<=13;r++)for(let a=0;a<8;a++){const ang=a*Math.PI/4;LEAPS.push([Math.round(Math.cos(ang)*r),Math.round(Math.sin(ang)*r)]);}

// ── Knowledge System: emergent technological development ──
// No artificial eras. Knowledge is a continuous fluid (0→1) that grows from local conditions
// and diffuses between neighbors. "Eras" emerge as an observation, not a programmed state.
const KNOW_DOMAINS=['agriculture','metallurgy','navigation','construction','organization','trade'];
function initKnowledge(){return{agriculture:0,metallurgy:0,navigation:0,construction:0,organization:0,trade:0};}
function cloneKnowledge(k){return{agriculture:k.agriculture,metallurgy:k.metallurgy,navigation:k.navigation,construction:k.construction,organization:k.organization,trade:k.trade};}

// ── Budget + Personality System ──
// Each tribe allocates capacity across military/growth/commerce/exploration/survival.
// Allocation is driven by geography + situation + a random temperament factor.
function initBudget(){
// Temperament: random biases that make each tribe unique (Sparta, Venice, Mongols)
// Range -0.8 to +0.8 per category. Large enough to create outliers (Sparta, Venice).
const r=()=>(Math.random()-0.5)*1.6;
return{military:0.2,growth:0.3,commerce:0.2,exploration:0.15,survival:0.15,
total:0,wealth:0,personality:"",
// Temperament: permanent random bias per tribe (cultural DNA)
tMil:r(),tGro:r(),tCom:r(),tExp:r()};}
function cloneBudget(b){return{military:b.military,growth:b.growth,commerce:b.commerce,wealth:b.wealth*0.3,// child tribes get 30% of parent's wealth
exploration:b.exploration,survival:b.survival,total:b.total,personality:b.personality,
tMil:b.tMil+(Math.random()-0.5)*0.4,// child tribes inherit with meaningful drift
tGro:b.tGro+(Math.random()-0.5)*0.4,
tCom:b.tCom+(Math.random()-0.5)*0.4,
tExp:b.tExp+(Math.random()-0.5)*0.4};}

// ── Resource Trade System ──
// Each tribe has production (from tiles), demand (from pop+knowledge), surplus/deficit.
// Surplus flows to trade partners. Trade generates income and enables interdependence.
function stepTrade(ter){
const{tribeSizes,tribeStrength,tribePopulation,tribeKnowledge,tribeCenters}=ter;
const n=tribeCenters.length;
if(!ter._resCache)return;
// Initialize trade data
if(!ter.tradeData)ter.tradeData=[];
while(ter.tradeData.length<n)ter.tradeData.push({imports:{},exports:{},income:0,foodImports:0,foodExports:0,partners:0});

for(let i=0;i<n;i++){
if(tribeSizes[i]<=0){ter.tradeData[i]={imports:{},exports:{},income:0,foodImports:0,foodExports:0,partners:0};continue;}
const k=tribeKnowledge[i];const r=ter._resCache[i];const pop=tribePopulation[i];
if(!r)continue;// resource cache not ready
const td=ter.tradeData[i];
// Reset
td.income=0;td.foodImports=0;td.foodExports=0;td.partners=0;
for(const rk of RES_KEYS){td.imports[rk]=0;td.exports[rk]=0;}

// ── Production: what this tribe's tiles generate ──
// Food production = tribeStrength (sum of tile fertility)
const foodProd=tribeStrength[i];
// Resource production = from _resCache (already aggregated)

// ── Demand: what this tribe's population+knowledge needs ──
const popK=pop/1000;// population in millions for scaling
const foodDemand=popK*0.8;// ~0.8 strength units per million people
const demand={};
demand.timber=popK*0.3+k.navigation*3;// building + ships
demand.stone=k.construction*popK*0.2;// construction scales with tech
demand.iron=k.metallurgy*popK*0.15;// weapons and tools
demand.salt=popK*0.2;// food preservation
demand.copper=k.metallurgy<0.5?k.metallurgy*popK*0.1:0;// early metallurgy
demand.tin=k.metallurgy>0.1&&k.metallurgy<0.6?k.metallurgy*popK*0.08:0;// bronze age
demand.coal=Math.max(0,k.metallurgy-0.6)*popK*0.5;// industrial
demand.oil=Math.max(0,k.metallurgy-0.8)*popK*0.3;// late industrial
demand.horses=k.organization*popK*0.05;// cavalry + logistics
demand.precious=k.trade*popK*0.1;// currency
demand.gems=k.trade*popK*0.03;// luxury

// ── Surplus/deficit per resource ──
const surplus={},deficit={};
for(const rk of RES_KEYS){
const prod=r[rk]||0;const dem=demand[rk]||0;
surplus[rk]=Math.max(0,prod-dem);
deficit[rk]=Math.max(0,dem-prod);}
// Food surplus/deficit
const foodSurplus=Math.max(0,foodProd-foodDemand);
const foodDeficit=Math.max(0,foodDemand-foodProd);

// ── Find trade partners and exchange ──
// Partners: border contacts + maritime contacts
const partners=new Set();
if(ter._borderContacts&&ter._borderContacts[i]){
for(const nid in ter._borderContacts[i]){const j=parseInt(nid);
if(tribeSizes[j]>0)partners.add(j);}}
// Maritime partners (long-distance trade!)
if(ter.tribeKnownCoasts&&ter.tribeKnownCoasts[i]){
for(const kc of ter.tribeKnownCoasts[i]){
if(kc.owner>=0&&kc.owner!==i&&tribeSizes[kc.owner]>0)partners.add(kc.owner);}}
td.partners=partners.size;

// ── Trade flow: surplus → deficit between partners ──
// Trade efficiency scales with both parties' trade knowledge + commerce budget
const myTrade=k.trade;
const myComB=ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i].commerce:0.2;
const myEff=myTrade*0.5+myComB*0.3+0.1;// base 10% + trade knowledge + commerce budget

for(const j of partners){
if(tribeSizes[j]<=0)continue;
const kj=tribeKnowledge[j];const rj=ter._resCache[j];
if(!rj)continue;
const theirTrade=kj?kj.trade:0;
const theirComB=ter.tribeBudget&&ter.tribeBudget[j]?ter.tribeBudget[j].commerce:0.2;
const theirEff=theirTrade*0.5+theirComB*0.3+0.1;
// Trade efficiency is the MINIMUM of both parties (weakest link)
const tradeEff=Math.min(myEff,theirEff);
// Check relationship — war kills trade
const rel=tribeRelation(ter,i,j);
if(rel==='fight')continue;// no trade during war
const relBonus=rel==='trade'?1.5:1.0;// established trade routes are more efficient

// Check their surplus/deficit
const theirFoodProd=tribeStrength[j];
const theirPopK=tribePopulation[j]/1000;
const theirFoodDemand=theirPopK*0.8;
const theirFoodSurplus=Math.max(0,theirFoodProd-theirFoodDemand);

// Food trade: if I have deficit and they have surplus (or vice versa)
if(foodDeficit>0&&theirFoodSurplus>0){
const flow=Math.min(foodDeficit*0.3,theirFoodSurplus*0.3)*tradeEff*relBonus;
td.foodImports+=flow;// I import food
if(ter.tradeData[j])ter.tradeData[j].foodExports+=flow;}
if(foodSurplus>0&&theirFoodDemand>theirFoodProd){
const flow2=Math.min(foodSurplus*0.3,(theirFoodDemand-theirFoodProd)*0.3)*tradeEff*relBonus;
td.foodExports+=flow2;td.income+=flow2*2;// exporting food generates income
}

// Resource trade: for each resource, flow surplus→deficit
for(const rk of RES_KEYS){
const theirDem=demand[rk]||0;// approximate their demand similarly
const theirProd=rj[rk]||0;
const theirSurp=Math.max(0,theirProd-theirDem);
const theirDef=Math.max(0,theirDem-theirProd);
// I buy their surplus to fill my deficit
if(deficit[rk]>0&&theirSurp>0){
const flow=Math.min(deficit[rk]*0.3,theirSurp*0.3)*tradeEff*relBonus;
td.imports[rk]+=flow;deficit[rk]-=flow;}
// I sell my surplus to fill their deficit
if(surplus[rk]>0&&theirDef>0){
const flow2=Math.min(surplus[rk]*0.3,theirDef*0.3)*tradeEff*relBonus;
td.exports[rk]+=flow2;
// Income from selling: value-weighted by era demand
const rv=resourceValues(k);
td.income+=flow2*rv[rk]*3;// valuable resources generate more income
}}}
}// end per-tribe loop
}

// Budget step: compute allocation for all tribes
function stepBudget(ter){
const{tribeSizes,tribeStrength,tribeCenters,tribePopulation,tribeKnowledge}=ter;
const budgets=ter.tribeBudget;if(!budgets)return;
const n=tribeCenters.length;
// Need border contacts and resource cache
if(!ter._borderContacts)return;
const contacts=ter._borderContacts;
if(!ter._resCache)return;
const res=ter._resCache;

for(let i=0;i<n;i++){if(tribeSizes[i]<=0)continue;
const b=budgets[i];const k=tribeKnowledge[i];const r=res[i];
const pop=tribePopulation[i];const sz=tribeSizes[i];
if(!r)continue;// resource cache not ready yet for this tribe
const rv=resourceValues(k);
let resWealth=0;for(const rk of RES_KEYS)resWealth+=rv[rk]*(r[rk]||0)*0.01;
// Budget = population base + resource wealth (additive, not just multiplier).
// A tiny tribe on gold can rival a large tribe with no resources (Phoenicia, Qatar).
const popBase=pop*(1+k.trade*0.3)*(0.5+k.organization*0.5);
const resBase=resWealth*pop*0.5;// resource wealth scales with pop but is ADDITIVE
// Budget = action capacity (what the tribe can DO per step)
b.total=popBase+resBase;

// Wealth = accumulated treasury in gold. Grows from:
// - Tax revenue (population × organization)
// - Trade income (selling surplus resources)
// - Resource value (precious metals directly add to treasury)
// Decays slightly each step (maintenance, corruption)
const taxRevenue=pop*(0.5+k.organization*0.5)*0.001;// organized states collect more tax
const tradeIncome=ter.tradeData&&ter.tradeData[i]?ter.tradeData[i].income:0;
const goldIncome=rv.precious*(r.precious||0)*0.01+rv.gems*(r.gems||0)*0.005;// gold/gems → direct wealth
const decay=b.wealth*0.02;// 2% decay (maintenance, corruption, waste)
b.wealth=Math.max(0,b.wealth+taxRevenue+tradeIncome+goldIncome-decay);

// ── Survival floor: mandatory, scales with threats ──
let borderThreat=0;const myContacts=contacts[i];
for(const nid in myContacts){const j=parseInt(nid);if(tribeSizes[j]<=0)continue;
const theirPop=tribePopulation[j];if(theirPop>pop*1.5)borderThreat+=0.2;
if(theirPop>pop*3)borderThreat+=0.3;}
const eraMult=15+k.agriculture*60+k.metallurgy*40+k.construction*30+k.organization*25;
const capacity=tribeStrength[i]*eraMult;
const faminePressure=capacity>0?Math.max(0,(pop/capacity)-1)*2:0;
const survivalFloor=Math.max(0.08,Math.min(0.55,borderThreat*0.3+faminePressure*0.3));
const available=1-survivalFloor;

// ── Score each category: resources + geography + situation + temperament ──
// Resources are the PRIMARY driver of personality, not just a modifier.
const neighborCount=Object.keys(myContacts).length;
let hasWeakNeighbor=false;
for(const nid in myContacts){const j=parseInt(nid);if(tribeSizes[j]<=0)continue;
if(tribePopulation[j]<pop*0.5&&tribeSizes[j]>10){hasWeakNeighbor=true;break;}}
const fertAvg=sz>0?tribeStrength[i]/sz:0;
let tradeWealth=0;for(const rk of RES_KEYS)tradeWealth+=rv[rk]*(r[rk]||0)*0.015;
const coastRatio=sz>0?(r.coastTiles||0)/sz:0;
const popRatio=capacity>0?pop/capacity:0;
const knownCoasts=ter.tribeKnownCoasts[i]?ter.tribeKnownCoasts[i].length:0;

let milScore=0.5+b.tMil;// lower base — resources/situation drive the score
let groScore=0.5+b.tGro;
let comScore=0.5+b.tCom;
let expScore=0.5+b.tExp;

// Military: HORSES are the main driver, plus threats and iron
milScore+=Math.min(3.0,(r.horses||0)*0.4);// horses: up to +3.0 (Mongols, cavalry empires)
milScore+=Math.min(1.5,(r.iron||0)*0.15);// iron weapons
milScore+=borderThreat*3;// under attack → military
milScore+=Math.min(0.5,neighborCount*0.1);// many borders
if(hasWeakNeighbor)milScore+=1.0;
if(k.metallurgy>0.3)milScore+=0.5;// armed and dangerous

// Growth: fertile land is the main driver
groScore+=fertAvg*5;// fertile territory → invest in farming (up to ~2.5)
groScore+=Math.min(1.5,(r.riverTiles||0)*0.08);// rivers → irrigation
if(capacity>0&&pop/capacity<0.7)groScore+=1.5;// underpopulated
if(k.agriculture<0.5)groScore+=0.5;
groScore+=Math.min(1.0,(r.salt||0)*0.1);// salt → food preservation → growth

// Commerce: GOLD and GEMS are the main driver, plus trade position
comScore+=Math.min(3.0,((r.precious||0)+(r.gems||0))*0.3);// gold/gems → trade empire
comScore+=Math.min(2.0,tradeWealth);// era-weighted resource wealth
comScore+=Math.min(0.8,neighborCount*0.15);// trade partners
if(r.coastTiles>sz*0.25&&sz<60)comScore+=1.5;// Phoenician
if(neighborCount>=4)comScore+=0.5;// crossroads
// Don't double-count coast in both commerce and exploration
comScore+=Math.min(0.5,r.coastTiles*0.01);// modest port bonus

// Exploration: coast + timber + population pressure
expScore+=coastRatio*3.0;// coastal → explore
expScore+=Math.min(1.0,(r.timber||0)*0.08);// shipbuilding
if(popRatio>0.9)expScore+=1.5;// overpopulated → must explore
if(knownCoasts>0)expScore+=0.5;
if(coastRatio>0.4&&sz<30)expScore+=2.0;// island survival

// Floor all scores at 0.1 (everyone does a little of everything)
milScore=Math.max(0.1,milScore);
groScore=Math.max(0.1,groScore);
comScore=Math.max(0.1,comScore);
expScore=Math.max(0.1,expScore);

// Normalize to fill available budget
const totalScore=milScore+groScore+comScore+expScore;
const targetMil=milScore/totalScore*available;
const targetGro=groScore/totalScore*available;
const targetCom=comScore/totalScore*available;
const targetExp=expScore/totalScore*available;

// Smooth blending (30% toward target per step — personality shifts gradually)
const blend=0.3;
b.military=b.military*(1-blend)+targetMil*blend;
b.growth=b.growth*(1-blend)+targetGro*blend;
b.commerce=b.commerce*(1-blend)+targetCom*blend;
b.exploration=b.exploration*(1-blend)+targetExp*blend;
b.survival=survivalFloor;

// ── Personality label from dominant allocation ──
const mil=b.military,gro=b.growth,com=b.commerce,exp=b.exploration,sur=b.survival;
// Find the dominant category
const maxCat=Math.max(mil,gro,com,exp);
if(sur>0.35)b.personality="Besieged";
else if(mil+exp>0.50&&mil>0.20&&exp>0.15)b.personality="Imperial";
else if(com+exp>0.45&&com>0.20&&exp>0.15)b.personality="Maritime";
else if(mil===maxCat&&mil>0.25)b.personality="Militant";
else if(com===maxCat&&com>0.22)b.personality="Mercantile";
else if(gro===maxCat&&gro>0.25)b.personality="Agricultural";
else if(exp===maxCat&&exp>0.22)b.personality="Expansionist";
else b.personality="Balanced";}
}
// ── Era-dependent resource values: what each resource is WORTH at this knowledge level ──
// Per-step cache: resourceValues only depends on tribe knowledge, which doesn't change within a step.
// Eliminates ~30K object allocations per step in the expansion loop.
let _resValCache=null;// Map<tribeId, values> cleared each step
function resourceValues(k){if(!k)return{timber:0.3,stone:0.1,copper:0,tin:0,iron:0,salt:0.3,horses:0,precious:0,coal:0,oil:0,gems:0};
const mt=k.metallurgy,ag=k.agriculture,nv=k.navigation,cn=k.construction,og=k.organization,tr=k.trade;
return{
timber:  Math.min(1,0.3+ag*0.2+nv*0.4+cn*0.1),
stone:   Math.min(1,0.1+cn*0.6+og*0.2),
copper:  Math.min(1,mt<0.5?mt*1.5:0.75-(mt-0.5)*0.5),
tin:     Math.min(1,mt>0.1&&mt<0.6?(mt-0.1)*2.0:mt>=0.6?0.3:0),
iron:    Math.min(1,Math.max(0,mt-0.2)*1.2),
salt:    Math.min(1,0.3+ag*0.3+og*0.2+nv*0.1),
horses:  Math.min(1,og*0.5+mt*0.3),
precious:Math.min(1,tr*0.8+og*0.2),
coal:    Math.min(1,Math.max(0,mt-0.5)*Math.max(0,cn-0.4)*4),
oil:     Math.min(1,Math.max(0,mt-0.7)*Math.max(0,cn-0.6)*5),
gems:    Math.min(1,tr*0.5+og*0.3)};}
const RES_KEYS=['copper','tin','iron','coal','stone','timber','salt','horses','precious','oil','gems'];

// BFS ocean pathfinder for short hops (within discovery range).
// Finds an actual ocean-tile path from coastal point A to coastal point B.
// Returns simplified waypoints. Step size 4 for speed. Max 5000 nodes.
function computeOceanRoute(ter,x1,y1,x2,y2,numPts){
const{tw,th,tElev}=ter;
let wrDx=x2-x1;if(Math.abs(wrDx)>tw/2)wrDx=wrDx>0?wrDx-tw:wrDx+tw;
const totalDist=Math.sqrt(wrDx*wrDx+(y2-y1)*(y2-y1));
if(totalDist<8)return[];
// BFS through ocean tiles
const STEP=3;// tile step size
const MAX=15000;
const visited=new Uint8Array(tw*th);// fast visited array
const queue=[];const parentOf=[];
// Seed: ocean tiles near source
for(let dy=-6;dy<=6;dy++){for(let dx=-6;dx<=6;dx++){
const nx=((x1+dx)%tw+tw)%tw,ny=Math.max(0,Math.min(th-1,y1+dy));
const ni=ny*tw+nx;
if(tElev[ni]<=0&&!visited[ni]){visited[ni]=1;queue.push(ni);parentOf.push(-1);}}}
let found=-1,qi=0;
while(qi<queue.length&&qi<MAX){
const ci=queue[qi];qi++;
const cx=ci%tw,cy=(ci-cx)/tw;
// Check target reached
let ddx2=Math.abs(cx-x2);if(ddx2>tw/2)ddx2=tw-ddx2;
if(ddx2<=6&&Math.abs(cy-y2)<=6){found=qi-1;break;}
// Expand 8 directions with STEP size
for(let ddir=0;ddir<8;ddir++){
const sdx=[0,STEP,STEP,STEP,0,-STEP,-STEP,-STEP][ddir];
const sdy=[-STEP,-STEP,0,STEP,STEP,STEP,0,-STEP][ddir];
const nx=((cx+sdx)%tw+tw)%tw,ny=cy+sdy;
if(ny<1||ny>=th-1)continue;
const ni=ny*tw+nx;
if(visited[ni]||tElev[ni]>0)continue;
visited[ni]=1;queue.push(ni);parentOf.push(qi-1);}}
if(found>=0){
// Trace back
const path=[];let idx=found;
while(idx>=0){const ti2=queue[idx];path.push({x:ti2%tw,y:(ti2-ti2%tw)/tw});idx=parentOf[idx];}
path.reverse();
// Simplify to numPts
if(path.length<=numPts)return path;
const step2=Math.floor(path.length/numPts);
const result=[];for(let i=0;i<path.length;i+=step2){if(result.length<numPts)result.push(path[i]);}
return result;}
return[];// no path found
}

// Compute relationship between two tribes: 'fight','trade','friendly','neutral'
function tribeRelation(ter,a,b){
if(a===b||!ter._borderContacts)return'neutral';
const key=Math.min(a,b)+','+Math.max(a,b);
if(ter._recentConflicts&&ter._recentConflicts[key]&&ter.stepCount-ter._recentConflicts[key]<50)return'fight';
const ka=ter.tribeKnowledge[a],kb=ter.tribeKnowledge[b];
const contactsA=ter._borderContacts[a];
const hasBorder=contactsA&&contactsA[b]>0;
let hasMaritimeLink=false;
if(ter.tribeKnownCoasts&&ter.tribeKnownCoasts[a]){for(const kc of ter.tribeKnownCoasts[a]){if(kc.owner===b){hasMaritimeLink=true;break;}}}
if((hasBorder||hasMaritimeLink)&&ka&&kb&&ka.trade>0.15&&kb.trade>0.15)return'trade';
if(hasBorder)return'friendly';
return'neutral';}

function computeTribeResources(ter){
const{tw,th,owner,deposits,tCoast,tribeStrength,tribeTiles}=ter;
const n=ter.tribeCenters.length;
const res=[];for(let i=0;i<n;i++)res.push({copper:0,tin:0,iron:0,coal:0,stone:0,timber:0,salt:0,horses:0,precious:0,oil:0,gems:0,coastTiles:0,riverTiles:0,resourceTypes:0});
// Accumulate resources per tile — shared logic for both paths
function accumTile(r,ti){
if(deposits){
if(deposits.copper[ti]>0.1)r.copper+=deposits.copper[ti];
if(deposits.tin[ti]>0.1)r.tin+=deposits.tin[ti];
if(deposits.iron[ti]>0.1)r.iron+=deposits.iron[ti];
if(deposits.coal[ti]>0.1)r.coal+=deposits.coal[ti];
if(deposits.stone[ti]>0.1)r.stone+=deposits.stone[ti];
if(deposits.timber[ti]>0.1)r.timber+=deposits.timber[ti];
if(deposits.salt[ti]>0.1)r.salt+=deposits.salt[ti];
if(deposits.horses[ti]>0.1)r.horses+=deposits.horses[ti];
if(deposits.precious[ti]>0.1)r.precious+=deposits.precious[ti];
if(deposits.oil[ti]>0.1)r.oil+=deposits.oil[ti];
if(deposits.gems[ti]>0.1)r.gems+=deposits.gems[ti];}
if(tCoast[ti])r.coastTiles++;
if(ter.rivers&&ter.rivers.riverMag[ti]>=2)r.riverTiles++;}
// Use per-tribe tile index (O(settled) vs O(tw*th))
if(tribeTiles){for(let tid=0;tid<n;tid++){if(ter.tribeSizes[tid]<=0||!tribeTiles[tid])continue;
const r=res[tid];for(const ti of tribeTiles[tid])accumTile(r,ti);}}
else{for(let ti=0;ti<tw*th;ti++){const ow=owner[ti];if(ow<0)continue;accumTile(res[ow],ti);}}
// Count distinct resource types per tribe
for(let i=0;i<n;i++){const r=res[i];let ct=0;
if(r.copper>0.5)ct++;if(r.tin>0.5)ct++;if(r.iron>0.5)ct++;if(r.coal>0.5)ct++;
if(r.stone>0.5)ct++;if(r.timber>0.5)ct++;if(r.salt>0.5)ct++;if(r.horses>0.5)ct++;
if(r.precious>0.5)ct++;if(r.oil>0.5)ct++;if(r.gems>0.5)ct++;r.resourceTypes=ct;}
return res;}

// Compute border contact: for each tribe, count tiles touching each neighbor tribe
// Optimized: only check frontier tiles (tiles on territory borders)
function computeBorderContact(ter){
const{tw,th,owner,tribeSizes,frontierList}=ter;const n=ter.tribeCenters.length;
// Map: tribeId → {neighborId: contactCount}
const contacts=[];for(let i=0;i<n;i++)contacts.push({});
// Frontier list contains all border tiles — only these can have cross-tribe neighbors
const list=frontierList&&frontierList.length>0?frontierList:null;
if(list){for(let fi=0;fi<list.length;fi++){const ti=list[fi];const ow=owner[ti];if(ow<0)continue;
const tx=ti%tw,ty=(ti-tx)/tw;
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;
const no=owner[ny*tw+nx];if(no>=0&&no!==ow){contacts[ow][no]=(contacts[ow][no]||0)+1;}}}}
else{for(let ti=0;ti<tw*th;ti++){const ow=owner[ti];if(ow<0)continue;
const tx=ti%tw,ty=(ti-tx)/tw;
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;
const no=owner[ny*tw+nx];if(no>=0&&no!==ow){contacts[ow][no]=(contacts[ow][no]||0)+1;}}}}
return contacts;}

// Ore access multiplier for metallurgy combat effect
function tribeOreAccess(tRes,metallurgy){
let access=0;
if(tRes.copper>0.5)access=Math.max(access,0.4);
if(tRes.copper>0.5&&tRes.tin>0.5)access=Math.max(access,0.8);
if(tRes.iron>0.5)access=Math.max(access,1.0);
if(tRes.iron>0.5&&tRes.coal>0.5)access=Math.max(access,1.3);
return access*metallurgy;}

// Main knowledge step: discovery + diffusion. Called every 8 sim steps.
function stepKnowledge(ter){try{
const{tw,th,owner,tribeCenters,tribeSizes,tribeStrength,tFert,tCoast,tenure}=ter;
const know=ter.tribeKnowledge;const n=tribeCenters.length;
if(!know||know.length===0)return;

// Recompute resource cache periodically
if(!ter._resCache||ter.stepCount%16===0)ter._resCache=computeTribeResources(ter);
const tRes=ter._resCache;

// ── Discovery: knowledge grows from local conditions ──
// Growth rates tuned so that with good conditions:
//   Agriculture: 0→0.3 in ~80 steps (~800yr), 0.3→0.7 in ~200 steps
//   Metallurgy: 0→0.3 in ~120 steps (with ore), 0.3→0.7 in ~300 steps
//   Others scale similarly. Diminishing returns (1-k) slow late-game naturally.
for(let i=0;i<n;i++){if(tribeSizes[i]<=0)continue;
const k=know[i],rRaw=tRes[i],sz=tribeSizes[i],pop=ter.tribePopulation[i];
if(!rRaw)continue;
// Effective resources: own production + imports from trade
const ti2=ter.tradeData&&ter.tradeData[i]?ter.tradeData[i].imports:{};
const r={};for(const rk of RES_KEYS)r[rk]=(rRaw[rk]||0)+(ti2[rk]||0)*0.5;// imports count at 50% (less efficient than owning)
r.coastTiles=rRaw.coastTiles||0;r.riverTiles=rRaw.riverTiles||0;r.resourceTypes=rRaw.resourceTypes;
const dens=sz>0?tribeStrength[i]/sz:0;

// Agriculture: fertility + rivers + density + sedentary time
{let score=0;
score+=dens*0.8;// fertile land drives experimentation
score+=Math.min(0.4,r.riverTiles*0.04);// river access (irrigation potential)
score+=Math.min(0.3,pop*0.003);// more minds = more innovation
const age=ter.stepCount-(tribeCenters[i][0]?tribeCenters[i][0].founded:0);
score+=Math.min(0.3,age*0.004);// sedentary bonus
score+=Math.random()*0.08;
// Fast early progress (pow 0.4), moderate late
const agDim=k.agriculture<0.5?Math.pow(1-k.agriculture,0.4):Math.sqrt(1-k.agriculture);
const growth=0.012*score*agDim;// ~5x faster than before
k.agriculture=Math.min(1,k.agriculture+Math.max(0,growth));}

// Metallurgy: era-weighted ore value + agriculture surplus + positive feedback
{let score=0;
const metRv=resourceValues(k);
// Having the RIGHT ores at the RIGHT time matters most (tin in bronze age, iron in iron age)
// Era-weighted: the RIGHT ore at the RIGHT time drives metallurgy hard
const oreRichness=Math.min(1,metRv.copper*(r.copper||0)*0.12+metRv.tin*(r.tin||0)*0.15+metRv.iron*(r.iron||0)*0.12+metRv.coal*(r.coal||0)*0.10);
score+=oreRichness*1.2;// ore is the primary driver
score+=k.agriculture*0.6;// surplus labor — agriculture alone enables SOME metalwork
score+=k.metallurgy*0.5;// positive feedback
// Without ore: slow but not zero. Agriculture alone should reach copper age (~0.15) eventually.
if(oreRichness<0.05)score*=0.25;// reduced penalty (was 0.15)
// Fast early, very slow late: (1-k)^0.3 for early, (1-k)^2 for late
// This makes bronze (0.3) fast but industrial (0.7+) very slow
// Fast to bronze, moderate to iron, slow to industrial — but always progressing
// Fast to bronze, moderate to iron, very slow to industrial
const dimRet=k.metallurgy<0.35?Math.pow(1-k.metallurgy,0.3):// fast early
k.metallurgy<0.50?Math.pow(1-k.metallurgy,1.0)*1.5:// moderate mid
k.metallurgy<0.70?Math.pow(1-k.metallurgy,1.5)*1.8:// slow late
Math.max(0.02,Math.pow(1-k.metallurgy,2.5)*3);// glacial industrial
const growth=0.012*score*dimRet;
k.metallurgy=Math.min(1,k.metallurgy+Math.max(0,growth));}

// Navigation: coast is the key driver — coastal tribes MUST develop sailing
{let score=0;
score+=Math.min(1.0,r.coastTiles*0.05);// much higher cap and rate
score+=Math.min(0.5,r.timber*0.05);// timber essential for ships
const coastRatio=sz>0?r.coastTiles/sz:0;
if(coastRatio>0.2)score+=0.8*Math.min(1,(coastRatio-0.2)/0.5);// strong island/coastal pressure
score+=k.trade*0.4;// trade drives maritime expansion
score+=k.agriculture*0.2;// food surplus enables sailors
const knownCount=ter.tribeKnownCoasts[i]?ter.tribeKnownCoasts[i].length:0;
score+=Math.min(0.3,knownCount*0.05);// discovery breeds more exploration
if(r.coastTiles<1)score*=0.03;// landlocked: near zero
// Slow early (boats are hard to invent), faster once basics are learned
const navDim=k.navigation<0.3?Math.pow(1-k.navigation,0.6):Math.sqrt(1-k.navigation);
const growth=0.008*score*navDim;
k.navigation=Math.min(1,k.navigation+Math.max(0,growth));}

// Construction: stone + density + agriculture + metallurgy
{let score=0;
score+=Math.min(0.4,r.stone*0.04);
score+=Math.min(0.3,pop*0.002);
score+=k.agriculture*0.35;
score+=k.metallurgy*0.15;// metal tools help build
const growth=0.009*score*Math.sqrt(1-k.construction);
k.construction=Math.min(1,k.construction+Math.max(0,growth));}

// Organization: population size + centers + construction + trade
{let score=0;
score+=Math.min(0.4,sz*0.005);// large groups need governance
const centerCount=tribeCenters[i]?tribeCenters[i].length:1;
score+=Math.min(0.3,centerCount*0.07);// multi-center polities
score+=k.construction*0.25;// infrastructure enables governance
score+=k.trade*0.15;// trade networks need admin
score+=Math.min(0.15,sz>40?(sz-40)*0.002:0);
const growth=0.009*score*Math.sqrt(1-k.organization);
k.organization=Math.min(1,k.organization+Math.max(0,growth));}

// Trade: contact with neighbors + resources + maritime access
{let score=0;
const contacts=ter._borderContacts;
let neighborCount=0;if(contacts&&contacts[i])neighborCount=Object.keys(contacts[i]).length;
score+=Math.min(0.8,neighborCount*0.15);// more neighbors = more trade (higher cap)
score+=Math.min(0.5,r.resourceTypes*0.07);// resource diversity
score+=Math.min(0.4,r.coastTiles*0.02);// ports
score+=k.navigation*0.4;// maritime trade
score+=k.organization*0.2;// organized states trade better
const growth=0.010*score*Math.sqrt(1-k.trade);// faster rate
k.trade=Math.min(1,k.trade+Math.max(0,growth));}}

// ── Diffusion: knowledge flows across borders from high to low ──
if(!ter._borderContacts||ter.stepCount%16===0)ter._borderContacts=computeBorderContact(ter);
const contacts=ter._borderContacts;
// Also diffuse via maritime trade routes (known ports)
for(let i=0;i<n;i++){if(tribeSizes[i]<=0)continue;
const ki=know[i];
// Land border diffusion
const myContacts=contacts[i];
for(const nid in myContacts){const j=parseInt(nid);if(tribeSizes[j]<=0)continue;
const kj=know[j];
const contactStrength=Math.min(1,myContacts[nid]*0.01);// normalized border contact
const tradeMult=1+ki.trade*2+kj.trade*2;// trade amplifies diffusion
// Commerce budget amplifies knowledge diffusion (Mercantile tribes are knowledge highways)
const comB=ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i].commerce:0.2;
const rate=0.005*contactStrength*tradeMult*(0.5+comB*2.5);// faster diffusion
for(const d of KNOW_DOMAINS){
if(kj[d]>ki[d]){ki[d]=Math.min(1,ki[d]+rate*(kj[d]-ki[d]));}}}
// Maritime diffusion: if tribe knows ports of another tribe, diffuse via trade
const knownCoasts=ter.tribeKnownCoasts[i];
if(knownCoasts){const seenTribes=new Set();
for(const kc of knownCoasts){if(kc.owner>=0&&kc.owner!==i&&tribeSizes[kc.owner]>0)seenTribes.add(kc.owner);}
for(const j of seenTribes){if(j===i)continue;const kj=know[j];
const maritimeRate=0.002*Math.min(ki.navigation,kj.navigation)*Math.min(ki.trade,kj.trade);
if(maritimeRate<0.0001)continue;
for(const d of KNOW_DOMAINS){
if(kj[d]>ki[d]){ki[d]=Math.min(1,ki[d]+maritimeRate*(kj[d]-ki[d]));}}}}}
}catch(e){console.error('[stepKnowledge CRASH]',e.message,'step:',ter.stepCount);throw e;}}

// ── Settlement tier thresholds (cityPop in thousands) ──
// Tech gates max city size; tier is just a reading of how many people are there
const SETTLE_TIERS=[
{name:'village',  min:0.05, icon:1},  //  50+ people gathering
{name:'town',     min:0.5,  icon:1.5},//  500+ people
{name:'small',    min:3,    icon:2},  //  3k+ (Ur, early Memphis)
{name:'medium',   min:20,   icon:2.5},//  20k+ (classical Athens)
{name:'large',    min:100,  icon:3},  //  100k+ (Rome, Chang'an)
{name:'mega',     min:500,  icon:3.5},//  500k+ (industrial London)
];
function settleTier(cityPop){
for(let i=SETTLE_TIERS.length-1;i>=0;i--)if(cityPop>=SETTLE_TIERS[i].min)return SETTLE_TIERS[i];
return null;}
// Max city population (thousands) gated by technology
function maxCityPop(k){if(!k)return 1;
const ag=k.agriculture,mt=k.metallurgy,cn=k.construction,og=k.organization;
// Neolithic village: ~2k. Bronze city: ~30k. Iron: ~100k. Classical: ~500k. Industrial: ~5M+
let cap=1+ag*5;// agriculture alone: up to ~6k (large village)
if(mt>0.15)cap+=15;// copper/early bronze: +15k
if(mt>0.3)cap+=30;// bronze: +30k (Ur, Memphis scale)
if(mt>0.5)cap+=60;// iron: +60k (Athens, Babylon)
if(cn>0.4)cap+=100;// construction: aqueducts, walls → +100k
if(og>0.4)cap+=200;// organization: bureaucracy → +200k (Rome)
if(cn>0.6&&og>0.5)cap+=500;// advanced infrastructure → +500k
// Industrial explosion
const indust=(Math.max(0,mt-0.75))*(Math.max(0,cn-0.60));
cap+=indust*20000;// mt=0.85,cn=0.7: 0.10*0.10*20000 = 200. mt=0.95,cn=0.9: 0.20*0.30*20000 = 1200
return cap;}
// Rural cap: dispersed countryside population per tile (before urbanizing).
// Intentionally LOW — represents the point at which people start concentrating
// into villages and towns rather than staying dispersed.
// At bronze (em~4): fert=0.3 → 0.3*4*0.25*0.97 = 0.29 (290 people then urbanize)
// At classical (em~11): fert=0.3 → 0.3*11*0.25*0.97 = 0.80
// Overflow above 80% of this cap flows into cityPop (settlement formation).
function ruralCap(fert,diff,em){return fert*em*0.25*(1-diff*0.3);}

// ── Era multiplier for tile carrying capacity (shared by population + bgPop systems) ──
// Returns people (in thousands) supportable per unit of tile fertility.
// Bronze: ~5k/str, Iron: ~8k, Classical: ~11k, Industrial: ~100k+
function tileEraMult(k){
const ag=k.agriculture,mt=k.metallurgy,cn=k.construction,og=k.organization;
let em=(0.2+ag*0.4+mt*0.25+cn*0.15+og*0.1)*10;
em+=(Math.max(0,mt-0.75))*(Math.max(0,cn-0.60))*2500;// industrial explosion
return em;}

// Population step: derive tribePopulation from per-tile bgPop sums.
// Population = bgPop (rural) + cityPop (urban) summed per tribe.
function stepPopulation(ter){
const pop=ter.tribePopulation;const{tribeSizes,bgPop,cityPop,owner,tw,th,tribeTiles}=ter;
if(!bgPop)return;
const n=pop.length;
for(let i=0;i<n;i++)pop[i]=0;
// Use per-tribe tile index when available (O(settled) vs O(tw*th))
if(tribeTiles){
for(let tid=0;tid<n;tid++){if(tribeSizes[tid]<=0||!tribeTiles[tid])continue;
let sum=0;for(const ti of tribeTiles[tid])sum+=bgPop[ti]+(cityPop?cityPop[ti]:0);
pop[tid]=sum;}}
else{for(let ti=0;ti<tw*th;ti++){
const ow=owner[ti];if(ow<0||ow>=n)continue;
pop[ow]+=bgPop[ti]+(cityPop?cityPop[ti]:0);}
for(let i=0;i<n;i++){if(tribeSizes[i]<=0)pop[i]=0;}}
}

// ── Transport / Communication Network ──
// Dijkstra from each tribe's cities outward through owned territory.
// Produces per-tile transport cost = cheapest path from nearest city.
// Rivers are highways (0.4 cost), coast is cheap (0.5), mountains expensive (8+).
// Used for: food catchment, cohesion, religion spread, trade efficiency.
function computeTransport(ter){
try{
const{tw,th,tElev,tDiff,tCoast,owner,tribeSizes,cityPop,bgPop}=ter;
if(!ter.transportCost)ter.transportCost=new Float32Array(tw*th);
if(!ter.transportOwner)ter.transportOwner=new Int16Array(tw*th);// which city feeds this tile
const cost=ter.transportCost;const tOwner=ter.transportOwner;
const riverMag=ter.rivers?ter.rivers.riverMag:null;
const n=ter.tribeCenters.length;
// Only reset owned tiles (not all 1.84M) — saves ~5ms of memset per call
for(let tid=0;tid<n;tid++){
if(tribeSizes[tid]<=0)continue;
const ts=ter.tribeTiles&&ter.tribeTiles[tid]?ter.tribeTiles[tid]:null;
if(!ts)continue;
for(const ti of ts){cost[ti]=999;tOwner[ti]=-1;}}

// Per-tribe transport tech: construction reduces cost, navigation enables sea routes
const tribeCn=new Float32Array(n);
const tribeNv=new Float32Array(n);
for(let i=0;i<n;i++){
if(tribeSizes[i]<=0)continue;
const k=ter.tribeKnowledge[i];if(!k)continue;
tribeCn[i]=k.construction;tribeNv[i]=k.navigation;}

// Tile movement cost (how hard it is to move goods THROUGH this tile)
// Returns cost for a tribe with given construction/navigation tech
function tileCost(ti,cn,nv,ow){
const e=tElev[ti];
// Ocean: cheap by sea, requires navigation
if(e<=0)return nv>0.1?0.5/(0.5+nv):50;// nv=0.3→0.6, nv=0.7→0.4, nv=0→impassable
const diff=tDiff[ti];
// River tiles: barges are cheap! The bigger the river, the cheaper.
if(riverMag){const rm=riverMag[ti];
if(rm>=4)return 0.3-cn*0.1;// great river (Nile): 0.3→0.2
if(rm>=3)return 0.4-cn*0.1;// major river: 0.4→0.3
if(rm>=2)return 0.7-cn*0.2;}// tributary: 0.7→0.5
// Coast: cheaper than inland (coastal shipping)
if(tCoast[ti])return 0.8-cn*0.2-nv*0.2;// 0.8→0.4 with tech
// Land: terrain difficulty drives cost. Construction (roads) reduces it.
// Plains (diff~0.05): 1.5→0.7 with roads
// Hills (diff~0.3): 3→1.5
// Mountains (diff~0.7): 8→3
const base=1.5+diff*diff*12;// quadratic difficulty penalty
const roadReduction=cn*0.5;// construction halves cost at max
const industrialReduction=Math.max(0,ter.tribeKnowledge[ow]?ter.tribeKnowledge[ow].metallurgy-0.75:0)*3;// rail
return Math.max(0.2,base*(1-roadReduction)-industrialReduction);}

// Priority queue (binary heap — reuse cached arrays)
if(!ter._heapTi){ter._heapTi=new Int32Array(tw*th);ter._heapCost=new Float32Array(tw*th);}
const heapTi=ter._heapTi;const heapCost=ter._heapCost;let heapSize=0;
const HEAP_MAX=heapTi.length;
function heapPush(ti2,c){
if(heapSize>=HEAP_MAX)return;// overflow guard
let i=heapSize++;heapTi[i]=ti2;heapCost[i]=c;
while(i>0){const p=(i-1)>>1;if(heapCost[p]<=heapCost[i])break;
const tt=heapTi[p],tc=heapCost[p];heapTi[p]=heapTi[i];heapCost[p]=heapCost[i];heapTi[i]=tt;heapCost[i]=tc;i=p;}}
function heapPop(){
const ti2=heapTi[0],c=heapCost[0];heapSize--;
if(heapSize>0){heapTi[0]=heapTi[heapSize];heapCost[0]=heapCost[heapSize];
let i=0;while(true){const l=2*i+1,r=2*i+2;let s=i;
if(l<heapSize&&heapCost[l]<heapCost[s])s=l;
if(r<heapSize&&heapCost[r]<heapCost[s])s=r;
if(s===i)break;
const tt=heapTi[s],tc=heapCost[s];heapTi[s]=heapTi[i];heapCost[s]=heapCost[i];heapTi[i]=tt;heapCost[i]=tc;i=s;}}
return{ti:ti2,cost:c};}

// Seed: use tribeTiles to find city/market tiles (not full grid scan)
for(let tid=0;tid<n;tid++){
if(tribeSizes[tid]<=0)continue;
const ts=ter.tribeTiles&&ter.tribeTiles[tid]?ter.tribeTiles[tid]:null;
if(!ts)continue;
for(const ti of ts){
if(cityPop&&cityPop[ti]>0.1){cost[ti]=0;tOwner[ti]=ti;heapPush(ti,0);}
else if(bgPop[ti]>0.2&&(tCoast[ti]||(riverMag&&riverMag[ti]>=2))){
if(cost[ti]>1){cost[ti]=1;tOwner[ti]=ti;heapPush(ti,1);}}}}

// Dijkstra: expand from cities through OWNED territory only
const DX4=[-1,1,0,0];const DY4=[0,0,-1,1];
while(heapSize>0){
const{ti:ci,cost:cc}=heapPop();
if(cc>cost[ci])continue;// stale entry
if(cc>100)continue;// don't explore beyond reasonable transport range
const cx=ci%tw,cy=(ci-cx)/tw;
const ow=owner[ci];
if(ow<0)continue;// skip unowned tiles entirely
const cn=tribeCn[ow];
const nv=tribeNv[ow];
for(let d=0;d<4;d++){
const nx=((cx+DX4[d])%tw+tw)%tw,ny=cy+DY4[d];
if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;
// Only traverse own territory (skip ocean, skip enemy territory)
const nOw=owner[ni];
if(nOw!==ow)continue;// only traverse own territory
const moveCost=tileCost(ni,cn,nv,ow);
const newCost=cc+moveCost;
if(newCost<cost[ni]){
cost[ni]=newCost;tOwner[ni]=tOwner[ci];// inherit source city
heapPush(ni,newCost);}}}

// ── Per-tribe transport stats ──
if(!ter._tribeTransport)ter._tribeTransport=[];
while(ter._tribeTransport.length<n)ter._tribeTransport.push({maxCost:0,avgCost:0,connected:0});
for(let i=0;i<n;i++){ter._tribeTransport[i].maxCost=0;ter._tribeTransport[i].avgCost=0;ter._tribeTransport[i].connected=0;}
// Stats: use tribeTiles instead of full grid scan
for(let tid=0;tid<n;tid++){
if(tribeSizes[tid]<=0)continue;
const ts2=ter.tribeTiles&&ter.tribeTiles[tid]?ter.tribeTiles[tid]:null;
if(!ts2)continue;const ts=ter._tribeTransport[tid];
for(const ti of ts2){const c=cost[ti];if(c>=999)continue;
ts.connected++;ts.avgCost+=c;if(c>ts.maxCost)ts.maxCost=c;}}
for(let i=0;i<n;i++){const ts=ter._tribeTransport[i];
if(ts.connected>0)ts.avgCost/=ts.connected;}
}catch(e){console.error('[computeTransport CRASH]',e.message,'step:',ter.stepCount,'n:',ter.tribeCenters.length,'tw:',ter.tw,'th:',ter.th,'cityPop?:',!!ter.cityPop,'settled:',ter.settled);throw e;}
}

// ── Per-tile population with FOOD ECONOMY ──
// Historical model:
//   - Farm tiles produce food. A farmer family consumes ~80% of output.
//   - The ~20% surplus feeds non-farmers (city dwellers).
//   - Pre-industrial: 8-12 farmers per 1 city dweller (5-10% urban)
//   - Industrial: 3:1 then 1:50 (33%→80% urban)
//   - Surplus kids go to nearest town (~50%), military (~15%), frontier (~15%)
//   - Cities were death traps until ~1800: constant need for rural migrants
//   - Most migration was SHORT range: under 30 miles
//
// Model:
//   bgPop = farmers. They grow logistically to fill available farmland.
//   Food output = bgPop * fert * (1 + agTech). Surplus = output - bgPop (self-consumption).
//   Tribal surplus pool (transport-weighted) feeds cities.
//   cityPop grows from tribal surplus, capped by transport access + tech.
//   Excess rural pop (above labor demand) migrates to nearest city tile or frontier.
function stepBackgroundPop(ter){
try{
const{tw,th,tElev,tTemp,tFert,tDiff,tCoast,owner,bgPop,tribeSizes}=ter;
if(!bgPop)return;
if(!ter.cityPop)ter.cityPop=new Float32Array(tw*th);
const cityPop=ter.cityPop;
const DX=[-1,1,0,0];const DY=[0,0,-1,1];

// ── Precompute per-tribe stats (cached arrays, grown as needed) ──
const n=ter.tribeCenters.length;
if(!ter._bgPopBufs||ter._bgPopBufs.n<n){
ter._bgPopBufs={n:Math.max(n,80),
maxCity:new Float32Array(Math.max(n,80)),growth:new Float32Array(Math.max(n,80)),
infra:new Float32Array(Math.max(n,80)),surplusFrac:new Float32Array(Math.max(n,80)),
foodProd:new Float32Array(Math.max(n,80)),foodSurplus:new Float32Array(Math.max(n,80)),
totalCity:new Float32Array(Math.max(n,80))};}
const b=ter._bgPopBufs;
const tribeMaxCity=b.maxCity;const tribeGrowth=b.growth;
const tribeInfra=b.infra;const tribeSurplusFrac=b.surplusFrac;
const tribeFoodProd=b.foodProd;const tribeFoodSurplus=b.foodSurplus;
const tribeTotalCity=b.totalCity;
// Zero the accumulators (only the used range)
for(let i=0;i<n;i++){tribeMaxCity[i]=0;tribeGrowth[i]=0;tribeInfra[i]=0;tribeSurplusFrac[i]=0;tribeFoodProd[i]=0;tribeFoodSurplus[i]=0;tribeTotalCity[i]=0;}
for(let i=0;i<n;i++){
if(tribeSizes[i]<=0)continue;
const k=ter.tribeKnowledge[i];if(!k)continue;
const ag=k.agriculture,mt=k.metallurgy,cn=k.construction,og=k.organization;
tribeMaxCity[i]=maxCityPop(k);
tribeInfra[i]=1+cn*1.5+og;
const industrialFactor=Math.max(0,mt-0.6)*3+Math.max(0,cn-0.5)*2;
const groB=ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i].growth:0.25;
tribeGrowth[i]=(0.01+ag*0.005+industrialFactor*0.015)*(0.5+groB*1.5);
// Surplus fraction: matches historical ratios
// Bronze (ag=0.3): 0.20 → 5 farmers:1 city → ~10% urban
// Classical (ag=0.5): 0.30 → 3:1 → ~15% urban
// Industrial: 0.95+ → 1:50 → ~80% urban
tribeSurplusFrac[i]=Math.min(0.98,0.05+ag*0.5+industrialFactor*0.4);}

const riverMag=ter.rivers?ter.rivers.riverMag:null;
const tCost=ter.transportCost;
const hasTrans=tCost&&tCost.length>=tw*th;

// ── PASS 1: Food production and surplus accounting ──
// Skip entirely if no tribes have settled (nothing to account)
const hasTribes=ter.settled>0;
if(hasTribes){
// Food accounting: iterate only owned tiles via tribeTiles
for(let tid=0;tid<n;tid++){
if(tribeSizes[tid]<=0)continue;
const ts1=ter.tribeTiles&&ter.tribeTiles[tid]?ter.tribeTiles[tid]:null;
if(!ts1)continue;
const ow=tid;
for(const ti of ts1){
const production=bgPop[ti]*tFert[ti]*(1+tribeSurplusFrac[ow]*3);
const selfConsumption=bgPop[ti];// farmers eat
const surplus=Math.max(0,production-selfConsumption);
tribeFoodProd[ow]+=production;
tribeFoodSurplus[ow]+=surplus;
tribeTotalCity[ow]+=cityPop[ti];}}
// Food imports add to surplus
for(let i=0;i<n;i++){
const fi=ter.tradeData&&ter.tradeData[i]?ter.tradeData[i].foodImports:0;
tribeFoodSurplus[i]+=fi;}

// Surplus ratio: how much surplus per unit of cityPop needed
// >1 means cities can grow. <1 means cities must shrink.
if(!ter._tribeFoodSurplus)ter._tribeFoodSurplus=new Float32Array(n);
for(let i=0;i<n;i++){
if(tribeSizes[i]<=0){ter._tribeFoodSurplus[i]=2.0;continue;}
// If no cities yet, surplus is infinite (plenty of food, just no cities)
if(tribeTotalCity[i]<0.01){ter._tribeFoodSurplus[i]=tribeFoodSurplus[i]>0.01?5.0:0.5;continue;}
ter._tribeFoodSurplus[i]=tribeFoodSurplus[i]/tribeTotalCity[i];}

} // end PASS 1 food accounting

// ── Debug counters ──
let maxBg=0,maxCity=0,settlementCount=0;

// ── PASS 2: Owned tiles ONLY — growth + urbanization + migration ──
// Iterates ONLY tiles owned by active tribes via tribeTiles index.
// Unowned tiles are NOT simulated — their population is implicit from terrain fertility
// and gets materialized when a tribe claims them (see claimTile).
// This makes sim cost O(settled) instead of O(all land) — 200-300x faster early game.
const n2=ter.tribeCenters.length;
for(let tid=0;tid<n2;tid++){
if(tribeSizes[tid]<=0)continue;
const tileSet=ter.tribeTiles&&ter.tribeTiles[tid]?ter.tribeTiles[tid]:null;
if(!tileSet||tileSet.size===0)continue;
for(const ti of tileSet){
const fert=tFert[ti];const ow=tid;
const bp=bgPop[ti];const cp=cityPop[ti];

// Farmer growth: logistic toward farmland capacity
{const farmCap=fert*(1+tribeSurplusFrac[ow]*3)*(1-tDiff[ti]*0.4);
if(farmCap>0.001&&bp<farmCap)bgPop[ti]=bp+bp*tribeGrowth[ow]*(1-bp/farmCap);}

// Urbanization: cities form for geographic reasons, grow from food surplus
const surplus=ter._tribeFoodSurplus[ow]||0;
const mxCity=tribeMaxCity[ow];
const tCostHere=hasTrans?tCost[ti]:10;
const transportFactor=1/(1+tCostHere*0.1);
const localMaxCity=mxCity*transportFactor;

// City seeding: river confluence, harbor, mine, defensive hill
if(cp<0.01){
let siteQuality=0;
if(riverMag){const rm=riverMag[ti];
if(rm>=4)siteQuality+=3.0;else if(rm>=3)siteQuality+=2.0;else if(rm>=2)siteQuality+=0.5;}
if(tCoast[ti])siteQuality+=1.5;
siteQuality+=transportFactor*0.4;
if(ter.deposits){for(let ri=0;ri<3;ri++){
const rk2=['copper','iron','salt'][ri];const dep=ter.deposits[rk2];
if(dep&&dep[ti]>0.2)siteQuality+=0.5;}}
if(tDiff[ti]>0.3&&fert>0.15)siteQuality+=0.3;
if(siteQuality>0.8&&bgPop[ti]>0.05)cityPop[ti]=0.01;}

// City growth/shrink from food surplus
if(cp>0){
const foodReaching=surplus>0.01?tribeFoodSurplus[ow]*transportFactor/(Math.max(1,tribeTotalCity[ow])+1):0;
const foodCap=Math.min(localMaxCity,foodReaching);
if(cp<foodCap&&surplus>1.0){cityPop[ti]+=Math.min(0.03,(foodCap-cp)*0.02);}
if(cp>foodCap*1.1&&foodCap>0){cityPop[ti]=Math.max(0.01,cp*0.97);}
if(surplus<0.7&&cp>0.01){cityPop[ti]=Math.max(0.01,cp*(0.96+surplus*0.02));}}

// Rural migration: 4-neighbor flow toward higher opportunity
if(bgPop[ti]>0.05){
const baseFlow=bgPop[ti]*0.003*tribeInfra[ow];
const myDensity=bgPop[ti]+cp;
let myValue=fert;
if(cp>0.1)myValue+=Math.sqrt(cp)*0.5;
if(riverMag){const rm=riverMag[ti];if(rm>=3)myValue+=0.5;else if(rm>=2)myValue+=0.2;}
if(tCoast[ti])myValue+=0.3;
const myOpp=myValue/(myDensity+0.3);
const tx2=ti%tw,ty2=(ti-tx2)/tw;
for(let d=0;d<4;d++){
const nx=((tx2+DX[d])%tw+tw)%tw,ny=ty2+DY[d];if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(tElev[ni]<=0||owner[ni]!==ow)continue;
let nValue=tFert[ni];
if(cityPop[ni]>0.1)nValue+=Math.sqrt(cityPop[ni])*0.5;
if(riverMag){const rm=riverMag[ni];if(rm>=3)nValue+=0.5;else if(rm>=2)nValue+=0.2;}
if(tCoast[ni])nValue+=0.3;
const nOpp=nValue/(bgPop[ni]+cityPop[ni]+0.3);
if(nOpp>myOpp){
const pull=(nOpp-myOpp)/(myOpp+0.05);
const flow=Math.min(bgPop[ti]*0.08,baseFlow*pull*(1-tDiff[ni]));
if(flow>0.001){bgPop[ti]-=flow;bgPop[ni]+=flow;}}}}

// Debug
if(bgPop[ti]>maxBg)maxBg=bgPop[ti];
if(cityPop[ti]>maxCity)maxCity=cityPop[ti];
if(cityPop[ti]>SETTLE_TIERS[0].min)settlementCount++;
}} // end per-tribe, per-tile loop

ter._dbgMaxBgPop=maxBg;ter._dbgMaxCity=maxCity;
ter._dbgSettlementCount=settlementCount;

// ── Rebuild tribeCenters from cityPop (towns+) ──
// Villages = tiles with bgPop > 0.3 (farmers, counted but not tracked as centers)
// Towns/cities = tiles with cityPop > 0.5 (urban, tracked as centers for power/cohesion)
// Staggered +16 from transport to spread per-frame load
if(ter.stepCount%32===16){
const tribeSett=[];for(let i=0;i<n;i++)tribeSett.push([]);
if(!ter._settleCounts)ter._settleCounts=[];
while(ter._settleCounts.length<n)ter._settleCounts.push({villages:0,towns:0,cities:0,large:0});
for(let i=0;i<n;i++){ter._settleCounts[i].villages=0;ter._settleCounts[i].towns=0;ter._settleCounts[i].cities=0;ter._settleCounts[i].large=0;}
// Use tribeTiles to iterate only owned tiles (not all 609K land tiles)
for(let tid2=0;tid2<n;tid2++){
if(tribeSizes[tid2]<=0)continue;
const ts2=ter.tribeTiles&&ter.tribeTiles[tid2]?ter.tribeTiles[tid2]:null;
if(!ts2)continue;const sc=ter._settleCounts[tid2];const ow2=tid2;
for(const ti of ts2){
// Villages = farming communities (bgPop-based, not cityPop)
if(bgPop[ti]>=0.3)sc.villages++;
// Towns/cities = urban (cityPop-based, become centers)
const cp=cityPop[ti];if(cp<SETTLE_TIERS[1].min)continue;// 0.5 = town threshold
const tier=settleTier(cp);
if(tier){
const MAX_SETT=200;// cap settlement tracking to avoid massive arrays
if(tier.name==='town'){sc.towns++;if(tribeSett[ow2].length<MAX_SETT)tribeSett[ow2].push({x:ti%tw,y:(ti-ti%tw)/tw,pop:cp});}
else if(tier.name==='small'||tier.name==='medium'){sc.cities++;tribeSett[ow2].push({x:ti%tw,y:(ti-ti%tw)/tw,pop:cp});}
else{sc.large++;tribeSett[ow2].push({x:ti%tw,y:(ti-ti%tw)/tw,pop:cp});}}}}
for(let st=0;st<n;st++){
if(tribeSizes[st]<=0)continue;
const sett=tribeSett[st];
if(sett.length===0)continue;
sett.sort((a,b)=>b.pop-a.pop);
// Cap centers per tribe to prevent unbounded growth (largest cities only)
const MAX_CENTERS=60;
const oldMap=new Map();
const old=ter.tribeCenters[st]||[];
for(const oc of old)oldMap.set(oc.x+','+oc.y,oc);
const nc=[];
const limit=Math.min(sett.length,MAX_CENTERS);
for(let si=0;si<limit;si++){
const s=sett[si];const key=s.x+','+s.y;
const oc=oldMap.get(key);
if(oc){oc.pop=s.pop;nc.push(oc);}
else nc.push({x:s.x,y:s.y,prestige:si===0?1.0:0.3,founded:ter.stepCount,pop:s.pop});}
ter.tribeCenters[st]=nc;
if(nc.length>0){
nc[0].prestige=Math.min(3.0,nc[0].prestige+0.05);
for(let c=1;c<nc.length;c++)nc[c].prestige=Math.min(2.0,nc[c].prestige+0.02);}}}
// ── Tribe crystallization ──
if(ter.stepCount%16!==0)return;// check every 16 steps
let alive=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)alive++;
if(alive>=80)return;
const CRYSTAL_THRESHOLD=0.12;
const MIN_SPACING=Math.round(tw*0.02);
// Sample a small random subset of unowned high-pop tiles instead of scanning all.
// By 1500 BC there can be 100K+ qualifying tiles — scanning all is O(n × tribes × centers) = freeze.
// Random sampling finds the best candidates probabilistically without exhaustive search.
const crystalCandidates=[];
const sampleSize=Math.min(500,tw*th);
// Fertility threshold decreases over time (tech matures → marginal land becomes viable)
const fertReq=Math.max(0.08,0.25-ter.stepCount*0.0003);
for(let si=0;si<sampleSize;si++){
const ti=Math.floor(Math.random()*tw*th);
// Score by terrain quality (fertility, no simulated bgPop needed)
if(owner[ti]>=0||tElev[ti]<=0||tFert[ti]<fertReq)continue;
const tx=ti%tw,ty=(ti-tx)/tw;
// Check spacing against tribe capitals only (not all centers — that's O(thousands))
let tooClose=false;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0||!ter.tribeCenters[t][0])continue;
const c=ter.tribeCenters[t][0];
if(tDistW(tx,ty,c.x,c.y,tw)<MIN_SPACING){tooClose=true;break;}}
if(tooClose)continue;
// Score by local fertility density (no bgPop simulation needed)
let localFert=0;
for(let dy=-3;dy<=3;dy++){const ny=ty+dy;if(ny<0||ny>=th)continue;
for(let dx=-3;dx<=3;dx++){const nx=((tx+dx)%tw+tw)%tw;
const ni=ny*tw+nx;if(tElev[ni]>0&&owner[ni]<0)localFert+=tFert[ni];}}
if(localFert<2.0)continue;// need meaningful fertile area
// River bonus: river tiles are prime crystallization sites
let riverBonus=0;
if(ter.rivers&&ter.rivers.riverMag){const rm=ter.rivers.riverMag[ti];
if(rm>=4)riverBonus=3;else if(rm>=3)riverBonus=2;else if(rm>=2)riverBonus=0.5;}
const score=localFert*tFert[ti]*(1+riverBonus);
if(score>0.5)crystalCandidates.push({ti,tx,ty,score});}
// Sort by score, spawn up to 3 per check
crystalCandidates.sort((a,b)=>b.score-a.score);
ter._dbgCrystalCandidates=crystalCandidates.length;// debug: how many candidates found
for(let cc=0;cc<Math.min(3,crystalCandidates.length);cc++){
const bestTi=crystalCandidates[cc].ti;
// Crystallize: claim the ENTIRE populated region at once.
// IRL Egypt didn't expand from tile #1 — hundreds of Nile villages unified into one polity.
// The tribe forms by absorbing all nearby background-populated tiles above a density threshold.
if(Math.random()<0.4){
ter._dbgCrystalSpawned=(ter._dbgCrystalSpawned||0)+1;
const tx=bestTi%tw,ty=(bestTi-tx)/tw;
// Before creating tribe, check nearby civs to inherit knowledge.
// A new civilization forming in 1500 AD near iron-age neighbors doesn't start from stone age.
// It inherits roughly 60% of the average knowledge of civs within range 20.
// Inherit knowledge from nearby tribes (check capitals only, not all centers)
let nearKnow=null;let nearCount=0;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0||!ter.tribeCenters[t][0])continue;
const c=ter.tribeCenters[t][0];// capital only
const d=tDistW(tx,ty,c.x,c.y,tw);
if(d<25){
if(!nearKnow)nearKnow={agriculture:0,metallurgy:0,navigation:0,construction:0,organization:0,trade:0};
const nk=ter.tribeKnowledge[t];for(const dom of KNOW_DOMAINS)nearKnow[dom]+=nk[dom];nearCount++;}}
const nid=newTribe(ter,tx,ty,-1);
const newK=ter.tribeKnowledge[nid];
if(nearKnow&&nearCount>0){for(const dom of KNOW_DOMAINS)newK[dom]=Math.min(0.9,(nearKnow[dom]/nearCount)*0.6);}
newK.agriculture=Math.max(newK.agriculture,0.25+Math.random()*0.15);
// Flood-fill to claim nearby populated tiles (reuse shared visited buffer)
if(!ter._crystalVisited)ter._crystalVisited=new Uint8Array(tw*th);
const visited=ter._crystalVisited;
// Clear only the tiles we visit (not the whole array)
const stack=[bestTi];visited[bestTi]=1;
const visitedTiles=[bestTi];// track for cleanup
let claimed=0;const maxClaim=12;
while(stack.length>0&&claimed<maxClaim){
const ci=stack.pop();
if(tElev[ci]<=0)continue;
if(owner[ci]>=0&&owner[ci]!==nid){
if(claimed>=6)continue;}
claimTile(ter,ci,nid);
if(!ter.frontier[ci]){ter.frontier[ci]=1;ter.frontierList.push(ci);}
claimed++;
const cx=ci%tw,cy2=(ci-cx)/tw;
for(const[ddx,ddy]of DIRS){const nnx=((cx+ddx)%tw+tw)%tw,nny=cy2+ddy;
if(nny<0||nny>=th)continue;const nni=nny*tw+nnx;
if(visited[nni])continue;visited[nni]=1;visitedTiles.push(nni);
if(tElev[nni]>0&&tFert[nni]>=0.05){stack.push(nni);}}}
// Clear visited buffer (only the tiles we touched, not the whole array)
for(const vt of visitedTiles)visited[vt]=0;
// Clear remaining bgPop in wider area (people absorbed or displaced)
for(let dy=-6;dy<=6;dy++){const ny=ty+dy;if(ny<0||ny>=th)continue;
for(let dx=-6;dx<=6;dx++){const nx=((tx+dx)%tw+tw)%tw;
bgPop[ny*tw+nx]*=0.3;}}// reduce, don't zero (some people remain)
alive++;if(alive>=80)break;
}}// end if(random) + for cc (candidates loop)
}catch(e){console.error('[stepBackgroundPop CRASH]',e.message,'step:',ter.stepCount,'tribes:',ter.tribeSizes.filter(s=>s>0).length,'settled:',ter.settled);throw e;}
}// end stepBackgroundPop

// Port computation: find best coastal settlement tiles for a tribe
function computeTribePorts(ter,tribeId){
const{tw,th,owner,tFert,tCoast,tenure,rivers,tribeTiles}=ter;
const ports=[];const orgLevel=ter.tribeKnowledge[tribeId]?ter.tribeKnowledge[tribeId].organization:0;
const maxPorts=Math.max(2,Math.floor(3+orgLevel*7));// 3-10 ports based on organization
// Use tribeTiles index to avoid full grid scan
const tiles=tribeTiles&&tribeTiles[tribeId]?tribeTiles[tribeId]:null;
const portSource=tiles||{[Symbol.iterator]:function*(){for(let ti=0;ti<tw*th;ti++)if(owner[ti]===tribeId)yield ti;}};
for(const ti of portSource){if(!tCoast[ti])continue;
if(tenure[ti]<10)continue;// must be established
let score=tFert[ti]*2;
// River mouth bonus
if(rivers&&rivers.riverMag[ti]>=2)score+=0.5;
if(rivers&&rivers.riverMag[ti]>=3)score+=0.5;
// Fertility in local area (settlement size proxy)
const tx=ti%tw,ty=(ti-tx)/tw;
let localFert=0;for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;
if(ny>=0&&ny<th&&owner[ny*tw+nx]===tribeId)localFert+=tFert[ny*tw+nx];}
score+=localFert*0.2;
ports.push({x:tx,y:ty,ti,score});}
ports.sort((a,b)=>b.score-a.score);
return ports.slice(0,maxPorts);}

// Voyage: trace path from port across ocean, find land within range
function launchVoyage(ter,tribeId,port,maxRange){
const{tw,th,tElev,tTemp,owner,tFert,tCoast}=ter;
const knownCoasts=ter.tribeKnownCoasts[tribeId];
// Choose direction: toward known unowned coast, or random exploration
let targetX=-1,targetY=-1;
// Check known coasts for unowned or enemy targets
if(knownCoasts&&knownCoasts.length>0&&Math.random()<0.6){
// Pick a known coast weighted by distance (prefer closer)
let best=null,bestScore=-1;
for(const kc of knownCoasts){
const d=tDistW(port.x,port.y,kc.x,kc.y,tw);
if(d>maxRange*1.3)continue;// too far
const isEnemy=kc.owner>=0&&kc.owner!==tribeId;
const score=(1/(1+d*0.05))*(isEnemy?0.5:1.0)+(Math.random()*0.3);
if(score>bestScore){bestScore=score;best=kc;}}
if(best){targetX=best.x;targetY=best.y;}}
// If no known target, pick a random ocean direction
if(targetX<0){const ang=Math.random()*Math.PI*2;
targetX=((port.x+Math.round(Math.cos(ang)*maxRange))%tw+tw)%tw;
targetY=Math.max(0,Math.min(th-1,port.y+Math.round(Math.sin(ang)*maxRange)));}
// Trace path from port toward target, tile by tile across ocean
const dx=targetX-port.x,dy=targetY-port.y;
let wrappedDx=dx;if(Math.abs(wrappedDx)>tw/2)wrappedDx=wrappedDx>0?wrappedDx-tw:wrappedDx+tw;
const dist=Math.sqrt(wrappedDx*wrappedDx+dy*dy);
if(dist<2)return null;
const stepX=wrappedDx/dist,stepY=dy/dist;
let cx=port.x+0.5,cy=port.y+0.5;
const maxSteps=Math.min(300,maxRange,Math.ceil(dist));// cap iterations for performance
for(let s=1;s<=maxSteps;s++){
cx+=stepX;cy+=stepY;
const tx=((Math.round(cx)%tw)+tw)%tw,ty=Math.round(cy);
if(ty<0||ty>=th)break;
const ti=ty*tw+tx;
const elev=tElev[ti];
if(elev<=0)continue;// still on ocean, keep going
// Hit land!
if(tTemp[ti]<0.05)return null;// frozen — can't land
// Record as known coast regardless of ownership
if(!knownCoasts)ter.tribeKnownCoasts[tribeId]=[];
const kc=ter.tribeKnownCoasts[tribeId];
let alreadyKnown=false;
for(const k of kc){if(Math.abs(k.x-tx)<=2&&Math.abs(k.y-ty)<=2){k.owner=owner[ti];k.lastSeen=ter.stepCount;alreadyKnown=true;break;}}
if(!alreadyKnown)kc.push({x:tx,y:ty,owner:owner[ti],lastSeen:ter.stepCount});
// Mutual awareness: the discovered tribe also learns about the voyager
if(owner[ti]>=0&&owner[ti]!==tribeId&&ter.tribeKnownCoasts[owner[ti]]){
const otherKc=ter.tribeKnownCoasts[owner[ti]];
let otherKnows=false;
for(const ok of otherKc){if(ok.owner===tribeId){otherKnows=true;break;}}
if(!otherKnows&&ter.tribePorts[tribeId]&&ter.tribePorts[tribeId].length>0){
const myPort=ter.tribePorts[tribeId][0];
otherKc.push({x:myPort.x,y:myPort.y,owner:tribeId,lastSeen:ter.stepCount});}}
// Can we land?
if(owner[ti]>=0){
// Owned coast — try invasion, otherwise skip past and keep looking for unowned land
const navV=ter.tribeKnowledge[tribeId].navigation;
const met=ter.tribeKnowledge[tribeId].metallurgy;
if(navV>0.5&&met>0.4&&owner[ti]!==tribeId){
const defPow=localPower(ter,owner[ti],tx,ty);
const atkPow=ter.tribePopulation[tribeId]*0.0002*met*navV;
if(atkPow>defPow*2)return{x:tx,y:ty,ti,type:'invade'};}
continue;}// skip past owned land — keep looking for unowned coast
// Check contested coast
let contested=false;
for(const[ddx,ddy]of DIRS){const nx=((tx+ddx)%tw+tw)%tw,ny2=ty+ddy;
if(ny2>=0&&ny2<th){const ao=owner[ny2*tw+nx];
if(ao>=0&&ao!==tribeId){contested=true;break;}}}
if(contested)return null;
return{x:tx,y:ty,ti,type:'land'};// successful landfall
}
return null;// ran out of range without finding land
}

function createTerritory(w){
const tw=Math.ceil(w.width/RES),th=Math.ceil(w.height/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th),tDiff=new Float32Array(tw*th),owner=new Int16Array(tw*th).fill(-1),tribeSizes=[],tribeStrength=[],tribeCenters=[];
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
if(w.pixPlate){const W=w.width,H=w.height;
// Build a plate-boundary distance map at tile resolution
const plateBound=new Uint8Array(tw*th);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
const myP=w.pixPlate[py*W+px];let isBoundary=false;
for(const[dx,dy]of DIRS){const nx2=Math.min(W-1,Math.max(0,px+dx*RES)),ny2=Math.min(H-1,Math.max(0,py+dy*RES));
if(w.pixPlate[ny2*W+nx2]!==myP){isBoundary=true;break;}}
if(isBoundary)plateBound[ty*tw+tx]=1;}
// Expand boundary influence: BFS to get distance from plate boundaries
const bDist=new Uint8Array(tw*th);bDist.fill(255);
const bdQ=[];
for(let i=0;i<tw*th;i++)if(plateBound[i]&&tElev[i]>0){bDist[i]=0;bdQ.push(i);}
for(let qi=0;qi<bdQ.length;qi++){const ci=bdQ[qi],cd=bDist[ci],cx=ci%tw,cy=(ci-cx)/tw;
if(cd>=6)continue;// max 6-tile influence radius (~12 pixels, ~100km at 1920px=40000km)
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
// ── Natural resource deposits ──
const deposits=generateResources(tw,th,tElev,tTemp,tMoist,tCoast,w,w._seed||0,rivers);
// ── 3000 BC START: seed civilizations at the world's best river valley locations ──
// Number of starting civs emerges from geography, not hardcoded.
// Principle: state-level organization appears wherever dense farming populations
// concentrate along major rivers in fertile lowlands. A world with one great
// river valley gets 1 civ. A world with five scattered fertile crescents gets 5.
const minSpacing=Math.round(tw*0.08);
// Pre-compute river valley density: how many river tiles + fertile tiles in radius 6.
// A single river tile in desert scores low. A 30-tile stretch of major river through
// fertile lowland scores high. This is what makes Nile/Euphrates/Indus stand out.
const R_VALLEY=6;
const valleyScore=new Float32Array(tw*th);
for(let ty2=R_VALLEY;ty2<th-R_VALLEY;ty2++)for(let tx=0;tx<tw;tx++){
const ti=ty2*tw+tx;if(tElev[ti]<=0)continue;
let riverCount=0,fertSum=0,majorRiver=0,lakeCount=0;
for(let dy=-R_VALLEY;dy<=R_VALLEY;dy++){const ny=ty2+dy;if(ny<0||ny>=th)continue;
for(let dx=-R_VALLEY;dx<=R_VALLEY;dx++){
if(dx*dx+dy*dy>R_VALLEY*R_VALLEY)continue;// circular area
const nx=((tx+dx)%tw+tw)%tw;const ni=ny*tw+nx;
if(tElev[ni]<=0)continue;
fertSum+=tFert[ni];
// Streams count slightly (small water source), tributaries+ full weight
if(rivers&&rivers.riverMag[ni]>=1)riverCount+=rivers.riverMag[ni]>=2?1:0.3;// streams=0.3, trib+=1.0
// Major/Great rivers are the real civ drivers (Nile, Euphrates scale)
if(rivers&&rivers.riverMag[ni]>=3)majorRiver++;
// Lakes count as water sources (Lake Chad, Sea of Galilee, Titicaca)
if(rivers&&rivers.lake&&rivers.lake[ni]>=0)lakeCount++;}}
// Water score: rivers + lakes. Both contribute to freshwater access.
const waterCount=riverCount+lakeCount*0.5;// lakes count at half weight (less transport value)
const majorWater=majorRiver+Math.min(3,lakeCount*0.3);// large lakes add some "major" score
// Valley score: water density × fertility density. Both must be present.
valleyScore[ti]=waterCount*majorWater*0.01*fertSum*0.02;}
// ── NO SEED CIVILIZATIONS ──
// All tribes emerge naturally via crystallization from background population.
// The first civs will crystallize at the highest-scoring river valley locations
// (Nile, Euphrates, etc.) within the first few simulation steps.
// Imported maps can still specify tribe seeds.
const tenure=new Uint16Array(tw*th);const frontier=new Uint8Array(tw*th);const frontierList=[];
const tribeKnowledge=[],tribePopulation=[];const tribeKnownCoasts=[];const tribePorts2=[];const tribeBudgets=[];
if(w.preset==="import"&&w.tribeSeeds&&w.tribeSeeds.length>0){
for(let i=0;i<w.tribeSeeds.length;i++){
const ts=w.tribeSeeds[i];
const tx=Math.min(tw-1,Math.max(0,Math.round(ts.x/RES))),ty2=Math.min(th-1,Math.max(0,Math.round(ts.y/RES)));
if(tElev[ty2*tw+tx]<=0)continue;
const ti=ty2*tw+tx;
tribeSizes.push(1);tribeStrength.push(tFert[ti]);
tribeCenters.push([{x:tx,y:ty2,prestige:1.0,founded:0}]);
owner[ti]=i;tenure[ti]=100;frontier[ti]=1;frontierList.push(ti);
const k=initKnowledge();k.agriculture=0.4;k.metallurgy=0.15;
tribeKnowledge.push(k);tribePopulation.push(0);// derived from bgPop on first step
tribeKnownCoasts.push([]);tribePorts2.push([]);tribeBudgets.push(initBudget());}}
let lc=0;for(let i=0;i<tw*th;i++)if(tElev[i]>0)lc++;
// ── Background population at 3000 BC: graduated by valley quality ──
// The best river valleys are already taken by starting civs. The NEXT best
// valleys start just below crystallization threshold and grow into it over
// 50-200 steps — matching the staggered appearance of real civilizations:
//   ~2600 BC (step ~30): Indus (next-best valley) crystallizes
//   ~2000 BC (step ~80): Minoan, early Hittites, Xia starting
//   ~1500 BC (step ~125): acceleration — Shang, Mycenaean, etc.
//
// bgPop is scaled relative to the best valley score so only the very top
// areas are near-threshold, and everything else needs time to grow.
const bgPop=new Float32Array(tw*th);
const bestValley=Math.max(0.01,...Array.from(valleyScore).filter(v=>v>0));
for(let ti=0;ti<tw*th;ti++){if(tElev[ti]<=0||tTemp[ti]<0.05)continue;
const fert=tFert[ti];const diff=tDiff[ti];
// Base pop from fertility (everyone farms by 3000 BC in good areas)
let bp=fert*fert*0.4*(1-diff);// lower base than before
// Valley bonus: areas with river valley clusters get extra pop, scaled to best
const vRatio=bestValley>0?valleyScore[ti]/bestValley:0;
// Top valleys (vRatio>0.5): start near crystallization threshold (~0.2-0.24)
// Medium valleys (0.2-0.5): start well below (~0.08-0.15), crystallize in 100-300 steps
// Low valleys (<0.2): barely populated, crystallize very late or never
bp+=vRatio*vRatio*0.18;// quadratic — only top valleys get meaningful boost
bgPop[ti]=Math.max(0,bp);}
// bgPop persists on owned tiles — don't zero it. It represents rural population density.
// cityPop: urban population stored in settlements (separate from bgPop)
const cityPop=new Float32Array(tw*th);
// Pre-build expensive indices during createTerritory (not lazily during sim)
const _landTiles_arr=[];const _coastalTiles_arr=[];
for(let ti=0;ti<tw*th;ti++){
if(tElev[ti]>0&&tTemp[ti]>=0.05)_landTiles_arr.push(ti);
if(tElev[ti]>0&&tCoast[ti])_coastalTiles_arr.push(ti);}
const _landTiles=new Int32Array(_landTiles_arr);
const _coastalTiles=_coastalTiles_arr;
const _nfBuf=new Uint8Array(tw*th);
// Per-tribe tile index: tribeTiles[id] = Set of tile indices owned by tribe id
const tribeTiles=[];
for(let i=0;i<tribeSizes.length;i++)tribeTiles.push(new Set());
for(let ti=0;ti<tw*th;ti++){if(owner[ti]>=0)tribeTiles[owner[ti]].add(ti);}
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,deposits,rivers,owner,tenure,tribeCenters,tribeSizes,tribeStrength,
tribeKnowledge,tribePopulation,tribeKnownCoasts,tribePorts:tribePorts2,tribeBudget:tribeBudgets,bgPop,cityPop,
tribeTiles,frontier,frontierList,_landTiles,_coastalTiles,_nfBuf,_youngTiles:[],
landCount:lc,settled:tribeSizes.length,tribeCount:tribeSizes.length,origin:{x:tw/2,y:th/2},stepCount:0};}

function tDistW(x1,y1,x2,y2,tw){let dx=Math.abs(x1-x2);if(dx>tw/2)dx=tw-dx;return Math.sqrt(dx*dx+(y1-y2)*(y1-y2));}
// Precomputed exp(-d*d/280) lookup table — eliminates Math.exp in hot loops
const EXP_LUT_SIZE=80;const EXP_LUT=new Float32Array(EXP_LUT_SIZE+1);
for(let d=0;d<=EXP_LUT_SIZE;d++)EXP_LUT[d]=Math.exp(-d*d/280);
function expFalloff(d){const di=d<0?0:d>EXP_LUT_SIZE?EXP_LUT_SIZE:d;const lo=di|0;if(lo>=EXP_LUT_SIZE)return EXP_LUT[EXP_LUT_SIZE];const hi=lo+1;const f=di-lo;return EXP_LUT[lo]*(1-f)+EXP_LUT[hi]*f;}
// Distance from (x,y) to nearest center of a tribe; also returns the capital (index 0) distance
function nearestCenterDist(centers,x,y,tw){if(!centers||centers.length===0)return{min:0,cap:0};
let mn=Infinity;const cap=tDistW(x,y,centers[0].x,centers[0].y,tw);
// Only check first 30 centers (sorted by pop, largest first) for perf
const limit=Math.min(centers.length,30);
for(let ci=0;ci<limit;ci++){mn=Math.min(mn,tDistW(x,y,centers[ci].x,centers[ci].y,tw));}
return{min:mn,cap};}

// ── Faster nearestCenterDist using squared distance (avoids sqrt) ──
// expFalloff uses d²/280 internally, so we can pass sqrt of squared dist.
// But the LUT expects actual distance, so we still need sqrt.
// Optimization: limit center check to 10 instead of 30 for expansion (most
// centers beyond ~20 tiles won't affect reach significantly).
// Full 30-center version kept for non-expansion callers.
// Sum of fertility within radius R of a point, for tiles owned by tribeId
function centerPower(ter,tribeId,cx,cy,R){const{tw,th,owner,tFert}=ter;let sum=0;
for(let dy=-R;dy<=R;dy++){const ny=cy+dy;if(ny<0||ny>=th)continue;
for(let dx=-R;dx<=R;dx++){const nx=((cx+dx)%tw+tw)%tw;const ni=ny*tw+nx;
if(owner[ni]===tribeId){const d=tDistW(cx,cy,nx,ny,tw);if(d<=R)sum+=tFert[ni];}}}return sum;}

function tribePower(ter,id){
// Power = population × military tech × organization × military investment × trade wealth
const sz=ter.tribeSizes[id];if(sz<=0)return 0;
const pop=ter.tribePopulation&&ter.tribePopulation[id]?ter.tribePopulation[id]:ter.tribeStrength[id]*10;
const k=ter.tribeKnowledge&&ter.tribeKnowledge[id]?ter.tribeKnowledge[id]:null;
const org=k?k.organization:0;
const logThreshold=40+org*260;
const logistics=1/(1+Math.max(0,sz-logThreshold)*0.015);
// Military tech from metallurgy + ore
let milTech=1;
if(k&&ter._resCache&&ter._resCache[id]){milTech=1+tribeOreAccess(ter._resCache[id],k.metallurgy)*1.5;}
// Budget: military investment amplifies power
const milB=ter.tribeBudget&&ter.tribeBudget[id]?ter.tribeBudget[id].military:0.2;
const milFocus=0.5+milB*2.5;
// Trade wealth adds soft power
const tradeWealth=k?1+k.trade*0.3:1;
// Wealth amplifies power (rich nations hire mercenaries, buy allies, fund wars)
const wealthBonus=ter.tribeBudget&&ter.tribeBudget[id]?1+Math.min(0.5,ter.tribeBudget[id].wealth*0.001):1;
return pop*0.01*milTech*logistics*milFocus*tradeWealth*wealthBonus;
}
// Local power projection at a border tile: sum contributions from nearby centers.
// Only considers centers within range 40 (beyond that, expFalloff is ~0).
function localPower(ter,tribeId,tx,ty){
const pop=ter.tribeStrength[tribeId],sz=ter.tribeSizes[tribeId];if(sz<=0)return 0;
const centers=ter.tribeCenters[tribeId];if(!centers||centers.length===0)return pop*0.05;
let total=0;
// Limit scan: first 30 centers (sorted by pop = largest cities) contribute most
const limit=Math.min(centers.length,30);
for(let ci=0;ci<limit;ci++){const c=centers[ci];
const d=tDistW(tx,ty,c.x,c.y,ter.tw);
if(d>40)continue;// beyond expFalloff range
total+=expFalloff(d)*c.prestige;}
// Base influence without centers is very low (3% of pop)
let base=pop*(0.03+0.97*Math.min(1,total));
// Metallurgy + ore access multiplies combat effectiveness
if(ter.tribeKnowledge&&ter.tribeKnowledge[tribeId]&&ter._resCache&&ter._resCache[tribeId]){
const met=ter.tribeKnowledge[tribeId].metallurgy;
const ore=tribeOreAccess(ter._resCache[tribeId],met);
base*=(1+ore*1.5);}
// Military budget multiplier: Sparta (mil=0.5) hits 50% harder than a balanced tribe
const milB=ter.tribeBudget&&ter.tribeBudget[tribeId]?ter.tribeBudget[tribeId].military:0.2;
base*=(0.5+milB*2.5);// mil=0.1→0.75x, mil=0.2→1.0x, mil=0.4→1.5x, mil=0.5→1.75x
return base;
}
function newTribe(ter,x,y,parentId){const id=ter.tribeCenters.length;ter.tribeCenters.push([{x,y,prestige:1.0,founded:ter.stepCount}]);ter.tribeSizes.push(0);ter.tribeStrength.push(0);
if(ter.tribeTiles)ter.tribeTiles.push(new Set());
// Inherit knowledge from parent tribe (splits carry culture); new independent tribes start at zero
const parentKnow=parentId>=0&&ter.tribeKnowledge[parentId]?ter.tribeKnowledge[parentId]:null;
ter.tribeKnowledge.push(parentKnow?cloneKnowledge(parentKnow):initKnowledge());
ter.tribePopulation.push(0);
// Inherit known coasts from parent (maritime memory carries over)
ter.tribeKnownCoasts.push(parentKnow&&ter.tribeKnownCoasts[parentId]?ter.tribeKnownCoasts[parentId].map(c=>({...c})):[]);
ter.tribePorts.push([]);
// Inherit budget personality from parent (with drift) or fresh random
const parentBudget=parentId>=0&&ter.tribeBudget&&ter.tribeBudget[parentId]?ter.tribeBudget[parentId]:null;
if(ter.tribeBudget)ter.tribeBudget.push(parentBudget?cloneBudget(parentBudget):initBudget());
ter.tribeCount=id+1;ensureTribeViews(ter);return id;}
function claimTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert,tenure,tribeTiles,tDiff}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];
if(tribeTiles&&tribeTiles[ow])tribeTiles[ow].delete(ti);
// Conquest: people stay. Small war loss (15% of rural + 10% of urban).
if(ter.bgPop&&ter.bgPop[ti]>0)ter.bgPop[ti]*=0.85;
if(ter.cityPop&&ter.cityPop[ti]>0)ter.cityPop[ti]*=0.90;
}else{
ter.settled++;
// Claiming unclaimed land: set bgPop based on fertility (people were already there)
// No need to have simulated their growth — it's implicit from the terrain quality
if(ter.bgPop&&ter.bgPop[ti]<0.01){
const f=tFert[ti];const d=tDiff?tDiff[ti]:0;
ter.bgPop[ti]=f*(1-d*0.5)*0.8;// ~80% of natural carrying capacity
}}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];tenure[ti]=1;
if(tribeTiles){while(tribeTiles.length<=nw)tribeTiles.push(new Set());tribeTiles[nw].add(ti);}
}
// Transfer tile without resetting tenure (for splits/fragmentation — population stays, allegiance changes)
function transferTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert,tribeTiles}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];if(tribeTiles&&tribeTiles[ow])tribeTiles[ow].delete(ti);}
// bgPop stays untouched — people remain, only political control changes
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];
if(tribeTiles){while(tribeTiles.length<=nw)tribeTiles.push(new Set());tribeTiles[nw].add(ti);}}

function stepTerritory(ter,w){
const sl=0,wet=0.7;const{tw,th,tElev,tTemp,tCoast,tDiff,tFert,owner,tribeCenters,tribeSizes,tribeStrength}=ter;ter.stepCount++;
// Clear per-step caches
if(!_resValCache)_resValCache=new Map();else _resValCache.clear();
// ── Per-step timing + size monitoring ──
const _stepT0=performance.now();
// Log sizes every 8 steps to catch runaway growth
if(ter.stepCount%8===0){
const nTribes=tribeSizes.filter(s=>s>0).length;
const fl=ter.frontierList?ter.frontierList.length:0;
const maxTribeSz=Math.max(...tribeSizes);
const totalCenters=tribeCenters.reduce((s,c)=>s+(c?c.length:0),0);
console.log(`[SIM ${ter.stepCount}] tribes:${nTribes} frontier:${fl} maxTribeSz:${maxTribeSz} totalCenters:${totalCenters} settled:${ter.settled}/${ter.landCount}`);}
const _prof=ter.stepCount%64===0;const _ts=_prof?[performance.now()]:null;
// ── Knowledge & population step (every 16 ticks — was 8, reduced for performance) ──
if(ter.stepCount%16===0&&ter.tribeKnowledge){
// Transport network: DISABLED — Dijkstra too expensive even on owned tiles
// (2.6s at step 128 with 8K tiles due to heap operations on 1.84M typed array)
// if(ter.stepCount%32===0&&ter.settled>0){...computeTransport...}
const _t0=performance.now();
stepBackgroundPop(ter);
const _t1=performance.now();
if(ter.settled>0){stepPopulation(ter);stepTrade(ter);stepBudget(ter);stepKnowledge(ter);}
const _t2=performance.now();
if(_t1-_t0>5)console.warn(`[BGPOP] ${(_t1-_t0).toFixed(1)}ms`);
if(_t2-_t1>5)console.warn(`[POP+TRADE+BUDGET+KNOW] ${(_t2-_t1).toFixed(1)}ms`);
ter._dbgTimeBgPop=(_t1-_t0).toFixed(1);ter._dbgTimeRest=(_t2-_t1).toFixed(1);
// Recompute ports periodically
// Recompute ports — staggered +8 from transport to spread load
if(ter.stepCount%32===8){for(let i=0;i<tribeCenters.length;i++){if(tribeSizes[i]>0&&ter.tribeKnowledge[i].navigation>0.05)ter.tribePorts[i]=computeTribePorts(ter,i);}}}
if(_prof)_ts.push(performance.now());// [1] after knowledge/pop block
const _tExpStart=performance.now();
// ── Expansion into empty land (directional, pressure-driven) ──
// Reuse frontier marker array across frames (avoids 1.8MB alloc per frame)
const nf=ter._nfBuf;const nfl=[];
// Clear only the tiles marked in the PREVIOUS frame's frontier list
const prevFL=ter.frontierList;for(let fi=0;fi<prevFL.length;fi++)nf[prevFL[fi]]=0;
// Reuse single candidates array across all frontier tiles (avoids 30K allocs/step)
const _candidates=[];
for(let fj=0;fj<ter.frontierList.length;fj++){const fi=ter.frontierList[fj];if(tElev[fi]<=sl)continue;const ty=Math.floor(fi/tw),tx=fi%tw,ow=owner[fi];let room=false;const pDiff=tDiff[fi];
const owSz=tribeSizes[ow],owDens=owSz>0?tribeStrength[ow]/owSz:0;
const owKnow=ter.tribeKnowledge&&ter.tribeKnowledge[ow]?ter.tribeKnowledge[ow]:null;
const agLevel=owKnow?owKnow.agriculture:0;
const agMult=1+agLevel*2.5;
const owPop=ter.tribePopulation?ter.tribePopulation[ow]:tribeStrength[ow]*10;
// Capacity from shared tileEraMult formula
const owOrg=owKnow?owKnow.organization:0,owMt=owKnow?owKnow.metallurgy:0,owCn=owKnow?owKnow.construction:0;
const owEraMult=owKnow?tileEraMult(owKnow):2;
const owCap=tribeStrength[ow]*owEraMult;
// No hard tile cap. Expansion is limited by real constraints:
// - Center distance falloff (power projection decays with distance)
// - Logistics penalty (tribePower scales with organization)
// - Terrain difficulty (mountains/desert/cold block low-tech civs)
// - Population pressure (need people to push outward)
// Hunter-gatherers stay small naturally: low pop growth, low pressure, no ag boost.
const popRatio=owCap>0?owPop/owCap:0;
// Agricultural civs expand proactively (they know they can farm new land).
// Hunter-gatherers need real pressure. Threshold: 30% for ag>0.3, 60% for ag=0
const pressureThreshold=0.6-agLevel*1.0;// ag=0→0.6, ag=0.3→0.3, ag=0.5+→clamped to 0.1
const effThreshold=Math.max(0.1,pressureThreshold);
const popPressure=Math.max(0,(popRatio-effThreshold)/(1-effThreshold));// 0→1 normalized
const smallBoost=owSz<5?1.5:1;
const largePrize=owSz>40?1+Math.min(1,(owSz-40)*0.008):1;
// Score and evaluate all candidate neighbor tiles
const agBoost=1+agLevel*2;// ag=0→1x, ag=0.5→2x
_candidates.length=0;
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny2=ty+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx;if(owner[ni]>=0)continue;
const elev=tElev[ni];if(elev<=sl){room=true;continue;}const effT=tTemp[ni];if(effT<0.02){room=true;continue;}
const diff=tDiff[ni];
// Knowledge reduces effective difficulty. Advanced civs conquer hard terrain:
// Construction: roads, terracing, tunnels (biggest impact on mountains)
// Organization: logistics to supply remote areas
// Agriculture: irrigation turns desert farmable
// Metallurgy: tools to clear forest, mine mountains
// Knowledge reduces difficulty — but only for HARD terrain. Easy terrain should stay easy.
// Scale: up to 0.3 reduction at max knowledge (was 0.6 — too strong, making everything trivial)
const knowledgeReduction=owKnow?(
owKnow.construction*0.12+// roads, terracing
owKnow.organization*0.08+// logistics
owKnow.agriculture*0.05+// irrigation
owKnow.metallurgy*0.05// tools
):0;// total up to 0.3 at max
const adjDiff=Math.max(0.02,Math.min(1,diff+(effT<0.15?0.3:0)-(wet>0.7?0.1:0)-knowledgeReduction));
const fert=tFert[ni];
// ── Directional score: what makes this tile VALUABLE to expand into ──
let score=fert*fert*agMult*3;// quadratic fertility × agriculture tech
// Resource pull: era-weighted. Bronze-age tribe → pulled to tin. Industrial → pulled to coal.
if(owKnow&&ter.deposits){let owRv=_resValCache.get(ow);if(!owRv){owRv=resourceValues(owKnow);_resValCache.set(ow,owRv);}
for(const rk of RES_KEYS){const dep=ter.deposits[rk];if(dep&&dep[ni]>0.1)score+=owRv[rk]*dep[ni]*2.0;}}
// Strategic knowledge-driven pull
if(owKnow){
if(owKnow.agriculture>0.1&&ter.rivers&&ter.rivers.riverMag[ni]>=2)score+=1.0*owKnow.agriculture;
if(owKnow.agriculture>0.1&&ter.rivers&&ter.rivers.riverMag[ni]>=3)score+=0.5*owKnow.agriculture;
if(owKnow.navigation>0.1&&tCoast[ni])score+=0.5*owKnow.navigation;
if(owKnow.organization>0.2&&tDiff[ni]>0.5)score+=0.4*owKnow.organization;// strategic chokepoints
if(owKnow.trade>0.1){// push toward neighbors (trade contact)
for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny2+dy2;
if(ay>=0&&ay<th){const ao=owner[ay*tw+ax];
if(ao>=0&&ao!==ow){score+=0.3*owKnow.trade;break;}}}}}
// ── Expansion chance: how EASY is it to take this tile ──
// Early civs should ONLY expand into prime land. Mediocre land should be
// almost impossible until population pressure is extreme or tech improves.
// IRL: Egypt stayed on the Nile for centuries. Sumer stayed in river valleys.
// They didn't casually expand into every adjacent grassland.
// Large tribes slow down but not as drastically (scaled for large maps)
// Size slowdown reduced by organization (well-governed empires maintain expansion)
const orgReduction=owKnow?owKnow.organization*0.5:0;// org reduces the penalty
const sizeSlowdown=owSz>200?1/(1+(owSz-200)*Math.max(0.0003,0.001-orgReduction*0.001)):1;
// Base chance rises with organization (modern nation-states expand bureaucratically)
const lateBoost=owKnow?1+owKnow.organization*0.5:1;// org=0.8→1.4x
let chance=0.22*wet*smallBoost*sizeSlowdown*lateBoost;
// Flat terrain bonus: steppe/grassland enables RAPID expansion (Mongol pattern)
// diff<0.05 (flat plains): 1.8x. diff=0.1 (gentle hills): 1.3x. diff>0.2: 1.0x
const flatBonus=adjDiff<0.05?1.8:adjDiff<0.1?1.3+0.5*(0.1-adjDiff)/0.05:1.0;
// Horses amplify flat-terrain expansion (cavalry covers ground fast)
const horseBoost=ter._resCache&&ter._resCache[ow]&&ter._resCache[ow].horses>1?1+Math.min(0.5,ter._resCache[ow].horses*0.05):1;
chance*=flatBonus*horseBoost;
// Difficulty: quadratic penalty with knowledge floor
const diffFloor=owKnow?(owKnow.construction*0.06+owKnow.organization*0.04):0;
chance*=Math.max(diffFloor+0.02,(1-adjDiff)*(1-adjDiff));
// Fertility: quadratic with tech floor. Prime land is easy, poor land is hard but not impossible.
const fertSq=fert*fert;
// Tech floor rises with knowledge — advanced civs can settle anywhere
// Tech floor: advanced civs can claim even barren land (sovereignty, not habitation)
// At max knowledge: floor=0.50 — enough to claim any land tile regardless of fertility
const techFloor=(agLevel*0.15+owMt*0.12+owCn*0.10+owOrg*0.08)+Math.min(0.05,ter.stepCount*0.00005);
chance*=Math.max(techFloor,fertSq*4)*largePrize;// fert 0.5→1.0, fert 0.3→0.36, fert 0.1→0.04
// Agriculture tech boost
chance*=agBoost;
// Budget: growth + exploration investment strongly drives expansion
const groB=ter.tribeBudget&&ter.tribeBudget[ow]?ter.tribeBudget[ow].growth:0.25;
const expB=ter.tribeBudget&&ter.tribeBudget[ow]?ter.tribeBudget[ow].exploration:0.15;
chance*=(0.4+groB*3.0+expB*2.5);// balanced→1.25x, growth-focused→2.0x, both high→3x
// Cold: brutal without tech
if(effT<0.15){const coldResist=owKnow?Math.min(0.7,owKnow.construction*0.4+owKnow.agriculture*0.3):0;
chance*=0.08+coldResist;}
// Population pressure: critical driver. Low pressure = barely expand.
chance*=Math.max(0.05,popPressure);
// High-value targets pursued more aggressively
chance*=1+Math.min(2.0,score*0.5);// stronger score feedback// score 0→1x, score 5→2.5x
// Center proximity — organization extends effective reach
// Base Gaussian exp(-d²/280) halves at ~14 tiles. Organization stretches this.
const orgReach=owKnow?1+owKnow.organization*1.5:1;// org=0→1x, org=0.5→1.75x, org=1→2.5x
const centers=tribeCenters[ow];
const{min:distMin}=nearestCenterDist(centers,nx,ny2,tw);
const reach=expFalloff(distMin/orgReach);// org stretches effective distance
chance*=Math.max(0.03,reach);
score+=Math.random()*0.1;
_candidates.push({ni,nx,ny:ny2,chance,score,diff,distMin});}
// Sort by score — best tiles first. Each subsequent candidate gets reduced chance
// so growth strongly follows fertile corridors, not uniform bubbles.
_candidates.sort((a,b)=>b.score-a.score);
let claimedThisTile=0;
for(let ci2=0;ci2<_candidates.length;ci2++){const cand=_candidates[ci2];const{ni,nx,ny:ny2,chance,diff,distMin}=cand;
// Each subsequent candidate is 20% as likely (very steep — usually only best gets claimed)
const rankPenalty=Math.pow(0.2,claimedThisTile);
if(Math.random()<chance*rankPenalty){let nw=ow;claimedThisTile++;
// Centers now spawn from population density peaks (stepBackgroundPop),
// not during expansion. Cities grow where people ARE, not where borders move.
claimTile(ter,ni,nw);if(!nf[ni]){nf[ni]=1;nfl.push(ni);}
// Hunter-gatherers: claim only best candidate. Agricultural civs: can claim multiple.
if(agLevel<0.2)break;}
else room=true;}
// Maritime discovery moved to separate per-tribe pass below
if(room&&!nf[fi]){nf[fi]=1;nfl.push(fi);}}
// ── Maritime discovery: hop-based exploration chains ──
// Discoveries expand from KNOWN coasts, not just home ports.
// Lisbon→W.Africa→Cape→E.Africa→India→Indonesia (each hop within range)
if(ter.stepCount%8===0){
if(!ter._coastalTiles){ter._coastalTiles=[];
for(let cti=0;cti<tw*th;cti++){if(tElev[cti]>0&&tCoast[cti])ter._coastalTiles.push(cti);}}
const coastList=ter._coastalTiles;
for(let st=0;st<tribeCenters.length;st++){
if(tribeSizes[st]<=0)continue;
const stK=ter.tribeKnowledge[st];if(!stK||stK.navigation<0.05)continue;// lower threshold
const stPorts=ter.tribePorts[st];if(!stPorts||stPorts.length===0)continue;
const nav2=stK.navigation;
const expB3=ter.tribeBudget&&ter.tribeBudget[st]?ter.tribeBudget[st].exploration:0.15;
// Hop range: how far a single voyage can go from any known point
// Hop range: short coastal hops early, ocean crossing at high nav
// nav=0.3→46 (Mediterranean), nav=0.5→100 (along Africa), nav=0.7→250 (Atlantic!), nav=0.9→420 (Pacific)
const hopRange=Math.floor(10+nav2*nav2*tw*0.25);
const discChance=0.3*nav2*(0.3+expB3*3);// nav=0.1→2%, nav=0.3→7%, nav=0.5→12%, nav=0.8→18%
if(Math.random()>discChance)continue;
ter._dbgDiscAttempts=(ter._dbgDiscAttempts||0)+1;
// Build list of ALL known points: own ports + all known coasts
// This is the "frontier of exploration" — discoveries hop from here
const knownPoints=[];
for(const p of stPorts)knownPoints.push({x:p.x,y:p.y});
const kcList=ter.tribeKnownCoasts[st];
for(const kc of kcList)knownPoints.push({x:kc.x,y:kc.y});
if(knownPoints.length===0)continue;
// Pick a random known point as the SOURCE of this voyage
const src=knownPoints[Math.floor(Math.random()*knownPoints.length)];
// Pick a random direction + distance within hopRange, then search nearby for coast
const attempts=3;
for(let att=0;att<attempts;att++){
const ang=Math.random()*Math.PI*2;
const dist3=hopRange*(0.2+Math.random()*0.8);// 20-100% of range
const tgtX=((src.x+Math.round(Math.cos(ang)*dist3))%tw+tw)%tw;
const tgtY=Math.max(2,Math.min(th-3,src.y+Math.round(Math.sin(ang)*dist3)));
// Search 11×11 area around target for any coastal tile
let targetIdx=-1;
for(let sdy=-10;sdy<=10&&targetIdx<0;sdy++){const sny=tgtY+sdy;if(sny<0||sny>=th)continue;
for(let sdx=-10;sdx<=10;sdx++){const snx=((tgtX+sdx)%tw+tw)%tw;
const sni=sny*tw+snx;if(tElev[sni]>0&&tCoast[sni]){targetIdx=sni;break;}}}
if(targetIdx<0)continue;// no coast found near target
const tgtX2=targetIdx%tw,tgtY2=(targetIdx-tgtX2)/tw;
// Check not already known
let already2=false;
for(const kc2 of kcList){if(Math.abs(kc2.x-tgtX2)<=3&&Math.abs(kc2.y-tgtY2)<=3){already2=true;break;}}
if(already2)continue;
// Compute cached ocean route from source to this discovery
const route=computeOceanRoute(ter,src.x,src.y,tgtX2,tgtY2,8);
kcList.push({x:tgtX2,y:tgtY2,owner:owner[targetIdx],lastSeen:ter.stepCount,fromX:src.x,fromY:src.y,route});
ter._dbgDiscSuccess=(ter._dbgDiscSuccess||0)+1;
if(owner[targetIdx]>=0&&owner[targetIdx]!==st){
// Discovered an inhabited coast — mutual awareness
if(ter.tribeKnownCoasts[owner[targetIdx]]){
const oKc=ter.tribeKnownCoasts[owner[targetIdx]];
let oKnows=false;for(const ok2 of oKc){if(ok2.owner===st){oKnows=true;break;}}
if(!oKnows){const sp=stPorts[0];oKc.push({x:sp.x,y:sp.y,owner:st,lastSeen:ter.stepCount,fromX:tgtX2,fromY:tgtY2});}}
// Naval invasion: if we're much stronger (tech advantage), try to take the coast
// Cortez vs Aztecs, British in India, Portuguese in East Africa
const defender=owner[targetIdx];
const myPow=tribePower(ter,st);
const theirPow=tribePower(ter,defender);
const techGap=(stK.metallurgy+stK.navigation)-(ter.tribeKnowledge[defender]?ter.tribeKnowledge[defender].metallurgy+ter.tribeKnowledge[defender].navigation:0);
// Need significant tech advantage AND military superiority to invade by sea
if(myPow>theirPow*0.5&&techGap>0.3&&stK.navigation>0.4){
const milB=ter.tribeBudget&&ter.tribeBudget[st]?ter.tribeBudget[st].military:0.2;
const invadeChance=0.1*milB*techGap;// ~3% for a militant power with big tech gap
if(Math.random()<invadeChance){
claimTile(ter,targetIdx,st);
if(!nf[targetIdx]){nf[targetIdx]=1;nfl.push(targetIdx);}
// Seed colonial settlement at beachhead
if(ter.cityPop)ter.cityPop[targetIdx]=Math.max(ter.cityPop[targetIdx],1.0);// small colonial town
}}}
if(owner[targetIdx]<0&&tFert[targetIdx]>0.03){
let nw3=st;const{min:vDist2}=nearestCenterDist(tribeCenters[st],tgtX2,tgtY2,tw);
if(vDist2>30&&Math.random()<0.3-stK.organization*0.3)nw3=newTribe(ter,tgtX2,tgtY2,st);
else if(vDist2>20&&ter.cityPop)
ter.cityPop[targetIdx]=Math.max(ter.cityPop[targetIdx],0.5);// seed a small colonial village
claimTile(ter,targetIdx,nw3);if(!nf[targetIdx]){nf[targetIdx]=1;nfl.push(targetIdx);}}
break;}}}
// ── Sovereignty expansion: advanced tribes claim adjacent unclaimed land automatically ──
// Modern nations claim deserts, tundra, mountains by drawing borders, not settling.
if(ter.stepCount%4===0){
for(let fj=0;fj<nfl.length;fj++){const fi=nfl[fj];const ow=owner[fi];if(ow<0)continue;
const owK=ter.tribeKnowledge&&ter.tribeKnowledge[ow]?ter.tribeKnowledge[ow]:null;
if(!owK||owK.organization<0.4)continue;// need meaningful organization
const sovChance=owK.organization*0.08;// org=0.5→4%, org=0.8→6.4%, org=1.0→8%
const ty4=Math.floor(fi/tw),tx4=fi%tw;
for(const[dx,dy]of DIRS){const nx=((tx4+dx)%tw+tw)%tw,ny=ty4+dy;if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(owner[ni]>=0||tElev[ni]<=0)continue;
if(Math.random()<sovChance){claimTile(ter,ni,ow);if(!nf[ni]){nf[ni]=1;nfl.push(ni);}break;}}}}
// ── Migration: small nomadic tribes abandon worst tiles, push toward best direction ──
if(ter.stepCount%8===0){
for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=0||tribeSizes[st]>15)continue;
const stKnow=ter.tribeKnowledge&&ter.tribeKnowledge[st]?ter.tribeKnowledge[st]:null;
if(stKnow&&stKnow.agriculture>0.3)continue;// settled agricultural tribes don't migrate
const stPop=ter.tribePopulation?ter.tribePopulation[st]:tribeStrength[st];
const stCap=tribeStrength[st]*(stKnow?1+stKnow.agriculture*2.5:1);
const pressure=stCap>0?stPop/stCap:0;
if(pressure<0.5)continue;// not enough pressure to migrate
// Find worst tile (lowest fertility, highest difficulty) — use tribeTiles index
let worstTi=-1,worstScore=Infinity;
const migTiles=ter.tribeTiles&&ter.tribeTiles[st]?ter.tribeTiles[st]:null;
if(migTiles){for(const i of migTiles){
const sc=tFert[i]-tDiff[i]*0.5;if(sc<worstScore){worstScore=sc;worstTi=i;}}}
else{for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const sc=tFert[i]-tDiff[i]*0.5;if(sc<worstScore){worstScore=sc;worstTi=i;}}}
if(worstTi>=0&&tribeSizes[st]>3){
// Abandon worst tile
owner[worstTi]=-1;tribeSizes[st]--;tribeStrength[st]-=tFert[worstTi];ter.tenure[worstTi]=0;ter.settled--;}}}
ter.frontier=nf;ter.frontierList=nfl;
// ── Age tenure + occupation cost: newly conquered tiles drain strength ──
if(ter.stepCount%4===0){const{tenure}=ter;
// Use frontier list for young tiles (tenure<200), skip settled interior
// Most tiles have tenure=200 and need no update — frontier list covers active zones
for(let fj=0;fj<nfl.length;fj++){const i=nfl[fj];if(owner[i]<0)continue;
if(tenure[i]<200)tenure[i]++;
if(tenure[i]<15){const drain=tFert[i]*0.015*(1-tenure[i]/15);
tribeStrength[owner[i]]=Math.max(0.1,tribeStrength[owner[i]]-drain);}}
// Bulk tenure aging for interior: only tiles with tenure<200 need incrementing
// Use a lazy counter — most tiles hit 200 quickly and stop being relevant
if(!ter._youngTiles)ter._youngTiles=[];// lazy init, populated as tiles are claimed
const young=ter._youngTiles;let j=0;
for(let k=0;k<young.length;k++){const i=young[k];if(owner[i]<0)continue;
if(tenure[i]<200){tenure[i]++;young[j++]=i;
if(tenure[i]<15){const drain=tFert[i]*0.015*(1-tenure[i]/15);
tribeStrength[owner[i]]=Math.max(0.1,tribeStrength[owner[i]]-drain);}}}
young.length=j;// compact: remove tiles that aged out or lost ownership
// Add newly claimed frontier tiles to young list
for(let fj=0;fj<nfl.length;fj++){const i=nfl[fj];if(owner[i]>=0&&tenure[i]<200)young.push(i);}}
// ── Border conflict: local power projection determines tile flips ──
// Only check frontier tiles (tiles with at least one unowned/enemy neighbor)
if(ter.stepCount%4===0){const flips=[];const{tenure}=ter;
for(let fj=0;fj<nfl.length;fj++){const i=nfl[fj];const ow=owner[i];if(ow<0||tElev[i]<=sl||tribeSizes[ow]<1)continue;
// New tribes get 80 steps of protection from border conflict (establishment period)
const owAge=ter.stepCount-(tribeCenters[ow][0]?tribeCenters[ow][0].founded:0);
if(owAge<80)continue;// can't lose tiles while establishing
const ty2=Math.floor(i/tw),tx2=i%tw;
// Quick border check: skip interior tiles with no enemy neighbors
let hasEnemy=false;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no>=0&&no!==ow&&tElev[ni]>sl&&tribeSizes[no]>=16){hasEnemy=true;break;}}
if(!hasEnemy)continue;
const lpA=localPower(ter,ow,tx2,ty2);// only computed for border tiles
// Defender advantage: 3x base + tenure + terrain + construction knowledge
const defConst=ter.tribeKnowledge&&ter.tribeKnowledge[ow]?ter.tribeKnowledge[ow].construction:0;
const defMilB=ter.tribeBudget&&ter.tribeBudget[ow]?ter.tribeBudget[ow].military:0.2;
// Mountains make defense MUCH stronger: diff=0.5→+3.75, diff=0.8→+9.6 (fortress)
// Combined with construction: a mountain kingdom with walls is nearly invincible
let def=3+Math.min(1.5,tenure[i]*0.008)+tDiff[i]*tDiff[i]*15+defConst*3.0+defMilB*2.0;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===ow||tElev[ni]<=sl||tribeSizes[no]<16)continue;
// Avoid attacking tribes that are much larger (>3x your size)
const atkSz=tribeSizes[no],defSz=tribeSizes[ow];
if(defSz>0&&atkSz>0&&defSz/atkSz>3)continue;// don't poke the giant
// Small tribes are less aggressive; large tribes more so
const atkMilB=ter.tribeBudget&&ter.tribeBudget[no]?ter.tribeBudget[no].military:0.2;
const atkAggression=(atkSz<25?0.4:atkSz>80?1.5:1.0)*(0.5+atkMilB*2.5);// militant tribes attack harder
// River between attacker and defender tiles: additional crossing penalty
const lpB=localPower(ter,no,tx2,ty2);// attacker's projected power at this tile
const totalDef=def;
// Recently flipped tiles (tenure < 5) can't flip again — prevents ping-pong
if(tenure[i]<5)continue;
if(lpB>lpA*totalDef){const diff=Math.max(tDiff[i],tDiff[ni]);const pressure=(lpB/(lpA*totalDef)-1)*0.2*atkAggression;
const prize=(0.5+tFert[i]*1.5)*(atkSz>60?1+Math.min(0.5,(atkSz-60)*0.005):1);
if(Math.random()<Math.max(0.005,pressure*prize*(1-diff*0.7))){flips.push([i,no]);break;}}
else if(lpB>lpA*totalDef*0.5&&Math.random()<0.1){
// Failed attack cost: only when attacker was a credible threat (>50% of needed power)
// and only 10% of the time, not every tick
const attemptCost=tFert[i]*0.04*atkAggression;
tribeStrength[no]=Math.max(0.1,tribeStrength[no]-attemptCost);}}}
// Apply flips with attack cost
// Track recent conflicts for relationship display
if(!ter._recentConflicts)ter._recentConflicts={};
for(const[ti,to]of flips){if(owner[ti]===to)continue;
const from=owner[ti];// who lost the tile
if(from>=0){const key=Math.min(from,to)+','+Math.max(from,to);
ter._recentConflicts[key]=ter.stepCount;}// record latest conflict step
const attackCost=tFert[ti]*0.3;
tribeStrength[to]=Math.max(0.1,tribeStrength[to]-attackCost);
claimTile(ter,ti,to);if(!nf[ti]){nf[ti]=1;nfl.push(ti);}}}
// ── City-based cohesion challenge: when a secondary city outgrows the capital ──
// Centers are derived from cityPop in stepBackgroundPop. Here we check if a
// rival city challenges the capital — potentially splitting the empire.
// Staggered +24 from transport
if(ter.stepCount%32===24){for(let st=0;st<tribeSizes.length;st++){
const centers=tribeCenters[st];if(!centers||centers.length<2||tribeSizes[st]<40)continue;
// Capital = centers[0] (largest city). Check if any secondary rivals it.
const capTi=centers[0].y*tw+centers[0].x;
const capCity=ter.cityPop?ter.cityPop[capTi]:0;
for(let c=1;c<centers.length;c++){
const secTi=centers[c].y*tw+centers[c].x;
const secCity=ter.cityPop?ter.cityPop[secTi]:0;
if(secCity<=capCity*1.3)continue;// secondary must significantly exceed capital
// Cohesion check: terrain difficulty between the two cities
const dx=centers[c].x-centers[0].x,dy=centers[c].y-centers[0].y;
const steps=Math.max(4,Math.floor(Math.sqrt(dx*dx+dy*dy)/2));
let diffSum=0;for(let s=0;s<=steps;s++){const sx=((Math.round(centers[0].x+dx*s/steps)%tw)+tw)%tw;
const sy=Math.round(centers[0].y+dy*s/steps);if(sy>=0&&sy<th)diffSum+=tDiff[sy*tw+sx];}
const avgDiff=diffSum/steps;const dist=tDistW(centers[0].x,centers[0].y,centers[c].x,centers[c].y,tw);
const orgCoh=ter.tribeKnowledge[st]?ter.tribeKnowledge[st].organization:0;
const cohesion=1/(1+dist*0.05+avgDiff*avgDiff*15-orgCoh*0.3);
if(cohesion>0.4)continue;// cohesive enough — no split
// Low cohesion + rival city → split
let aliveT=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)aliveT++;
if(aliveT>=80)break;
const sc=centers[c];const sid=newTribe(ter,sc.x,sc.y,st);
const cohTiles=ter.tribeTiles&&ter.tribeTiles[st]?[...ter.tribeTiles[st]]:null;
const cohSource=cohTiles||{[Symbol.iterator]:function*(){for(let i=0;i<tw*th;i++)if(owner[i]===st)yield i;}};
const toXfer=[];
for(const i of cohSource){const iy=Math.floor(i/tw),ix=i%tw;
const dSec=tDistW(ix,iy,sc.x,sc.y,tw);
let dNearest=Infinity;for(const rc of centers){if(rc===sc)continue;dNearest=Math.min(dNearest,tDistW(ix,iy,rc.x,rc.y,tw));}
if(dSec<dNearest)toXfer.push(i);}
for(const ti of toXfer)transferTile(ter,ti,sid);
break;}}}
// ── Terrain-based fragmentation: large tribes in rough terrain tend to split ──
// Staggered +8 from cohesion check
if(ter.stepCount%32===0){
for(let st=0;st<tribeSizes.length;st++){
if(tribeSizes[st]<=40)continue;
const stK=ter.tribeKnowledge[st];const stOrg=stK?stK.organization:0;
const stTiles=ter.tribeTiles&&ter.tribeTiles[st]?ter.tribeTiles[st]:null;
let totalDiff2=0,tileCount2=0;
if(stTiles){for(const i of stTiles){totalDiff2+=tDiff[i];tileCount2++;}}
else{for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;totalDiff2+=tDiff[i];tileCount2++;}}
if(tileCount2<20)continue;
const avgTribeDiff=totalDiff2/tileCount2;
// Split pressure: high for mountainous (Europe), near-zero for flat (Russia)
const splitPressure=avgTribeDiff*avgTribeDiff*0.3-stOrg*0.05;
if(splitPressure>0&&Math.random()<splitPressure){
const cap=tribeCenters[st][0];
let worstTi=-1,worstScore=-1;
if(stTiles){for(const i of stTiles){
const ix=i%tw,iy=(i-ix)/tw;
const score=tDistW(ix,iy,cap.x,cap.y,tw)*tDiff[i];
if(score>worstScore){worstScore=score;worstTi=i;}}}
else{for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const ix=i%tw,iy=(i-ix)/tw;
const score=tDistW(ix,iy,cap.x,cap.y,tw)*tDiff[i];
if(score>worstScore){worstScore=score;worstTi=i;}}}
if(worstTi>=0){const wx=worstTi%tw,wy=(worstTi-wx)/tw;
let aliveT=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)aliveT++;
if(aliveT<80){const sid=newTribe(ter,wx,wy,st);
const toTransfer=[];
if(stTiles){for(const i of stTiles){
const ix2=i%tw,iy2=(i-ix2)/tw;
if(tDistW(ix2,iy2,wx,wy,tw)<tDistW(ix2,iy2,cap.x,cap.y,tw))toTransfer.push(i);}}
else{for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const ix2=i%tw,iy2=(i-ix2)/tw;
if(tDistW(ix2,iy2,wx,wy,tw)<tDistW(ix2,iy2,cap.x,cap.y,tw))toTransfer.push(i);}}
for(const ti of toTransfer)transferTile(ter,ti,sid);}}}}
}
// ── Fragmentation: split disconnected tribe components (largest keeps original ID/color) ──
if(ter.stepCount%16===0){if(!ter._fragMark)ter._fragMark=new Int32Array(tw*th);const mark=ter._fragMark;let gen=ter._fragGen||0;
for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=1)continue;
const baseGen=gen;const comps=[];
// Use tribeTiles index to iterate only over this tribe's tiles (not full grid)
const stTiles=ter.tribeTiles&&ter.tribeTiles[st]?ter.tribeTiles[st]:null;
const tileSource=stTiles?stTiles:null;
if(tileSource){for(const i of tileSource){if(mark[i]>baseGen)continue;gen++;
const stack=[i];mark[i]=gen;const comp=[];
while(stack.length>0){const ci=stack.pop();comp.push(ci);const cy=Math.floor(ci/tw),cx=ci%tw;
for(const[dx,dy]of DIRS){const nx2=((cx+dx)%tw+tw)%tw,ny2=cy+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
if(mark[ni]<=baseGen&&owner[ni]===st){mark[ni]=gen;stack.push(ni);}}}
comps.push(comp);}}
else{for(let i=0;i<tw*th;i++){if(owner[i]!==st||mark[i]>baseGen)continue;gen++;
const stack=[i];mark[i]=gen;const comp=[];
while(stack.length>0){const ci=stack.pop();comp.push(ci);const cy=Math.floor(ci/tw),cx=ci%tw;
for(const[dx,dy]of DIRS){const nx2=((cx+dx)%tw+tw)%tw,ny2=cy+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
if(mark[ni]<=baseGen&&owner[ni]===st){mark[ni]=gen;stack.push(ni);}}}
comps.push(comp);}}
if(comps.length<=1)continue;
comps.sort((a,b)=>b.length-a.length);
for(let c=1;c<comps.length;c++){const sid=newTribe(ter,comps[c][0]%tw,Math.floor(comps[c][0]/tw),st);
for(const ci of comps[c])transferTile(ter,ci,sid);}}ter._fragGen=gen;}
// ── Remnant absorption: tiny fragments absorbed by larger neighbors ──
// Only absorb old tiny tribes — new tribes get 100 steps of immunity to establish themselves
if(ter.stepCount%8===0){for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=0||tribeSizes[st]>5)continue;
// Immunity: don't absorb tribes younger than 100 steps (let them grow)
const stAge=ter.stepCount-(tribeCenters[st][0]?tribeCenters[st][0].founded:0);
if(stAge<100)continue;
const stTiles=ter.tribeTiles&&ter.tribeTiles[st]?ter.tribeTiles[st]:null;
let bn=-1,bs2=0;
const iterTiles=stTiles?stTiles:{[Symbol.iterator]:function*(){for(let i=0;i<tw*th;i++)if(owner[i]===st)yield i;}};
for(const i of iterTiles){const ty2=Math.floor(i/tw),tx2=i%tw;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===st||tElev[ni]<=sl)continue;if(tribeSizes[no]>bs2){bs2=tribeSizes[no];bn=no;}}}
if(bn>=0&&tribeSizes[bn]>tribeSizes[st]*3){
const tilesToClaim=stTiles?[...stTiles]:[];
if(!stTiles){for(let i=0;i<tw*th;i++)if(owner[i]===st)tilesToClaim.push(i);}
for(const i of tilesToClaim)claimTile(ter,i,bn);}}}
ter._dbgTimeExpansion=(performance.now()-_tExpStart).toFixed(1);
const _stepTotal=performance.now()-_stepT0;
if(_stepTotal>5){// log any step that takes >5ms
console.warn(`[SLOW step ${ter.stepCount}] ${_stepTotal.toFixed(1)}ms frontier:${nfl.length} tribes:${tribeSizes.filter(s=>s>0).length} settled:${ter.settled}`);}
return ter;}

// ── Non-linear time: starts at 3000 BC, accelerates into modernity ──
// ~1000 steps spans 3000 BC → 2025 AD (5025 years)
// Early game (step 0-200): ~12 yr/step (3000 BC → 600 BC: Bronze → Iron Age)
// Mid game (step 200-500): ~5 yr/step (600 BC → 900 AD: Classical → Medieval)
// Late game (step 500-800): ~2.5 yr/step (900 AD → 1650 AD: Medieval → Early Modern)
// Modern (step 800-1000): ~1.9 yr/step (1650 → 2025 AD)
function stepToYear(step){
if(step<=200)return 3000-step*12;// 3000 BC → 600 BC
if(step<=500)return 600-(step-200)*5;// 600 BC → 900 AD (negative = AD)
if(step<=800)return -(900+(step-500)*2.5);// 900 AD → 1650 AD
return -(1650+(step-800)*1.875);// 1650 AD → 2025 AD
}
function yearStr(step){const y=stepToYear(step);
return y>0?`${Math.round(y)} BC`:`${Math.round(Math.abs(y))} AD`;}

// ── Cultural era derived from average tribe knowledge ──
function deriveEra(aAg,aMt,aNv,aOg){
  if(aMt>=0.65&&aOg>=0.55)return"Industrial Age";
  if(aMt>=0.50&&aOg>=0.42)return"Age of Empires";
  if(aMt>=0.38)return"Iron Age";
  if(aMt>=0.22)return"Bronze Age";
  if(aMt>=0.08)return"Copper Age";
  if(aAg>=0.30)return"Agrarian Age";
  if(aAg>=0.12)return"Neolithic";
  return"Stone Age";
}
function fmtPop(p){
  if(p>=1_000_000)return(p/1_000_000).toFixed(1)+"M";
  if(p>=1000)return(p/1000).toFixed(p>=10000?0:1)+"k";
  if(p>=1)return p.toFixed(0);
  return"<1";
}
function fmtGold(g){
  if(g>=10000)return(g/1000).toFixed(0)+"k";
  if(g>=1000)return(g/1000).toFixed(1)+"k";
  return g.toFixed(0);
}

// ── Hexagonal knowledge radar (SVG) ──
function KnowledgeRadar({k,size=140}){
  if(!k)return null;
  const axes=[
    ["agriculture","Ag"],["metallurgy","Mt"],["navigation","Nv"],
    ["construction","Cn"],["organization","Og"],["trade","Tr"]
  ];
  const cx=size/2,cy=size/2,R=size*0.36;
  const angleAt=(i)=>(-Math.PI/2)+(i/axes.length)*Math.PI*2;
  const pt=(i,r)=>{const a=angleAt(i);return[cx+Math.cos(a)*r,cy+Math.sin(a)*r];};
  const ringPath=(r)=>axes.map((_,i)=>{const[x,y]=pt(i,r);return(i?"L":"M")+x.toFixed(1)+","+y.toFixed(1);}).join(" ")+" Z";
  const valuePath=axes.map(([key],i)=>{const v=Math.max(0,Math.min(1,k[key]||0));const[x,y]=pt(i,R*v);return(i?"L":"M")+x.toFixed(1)+","+y.toFixed(1);}).join(" ")+" Z";
  return(
    <svg width={size} height={size} style={{flexShrink:0}}>
      {[0.25,0.5,0.75,1].map(t=>(<path key={t} d={ringPath(R*t)} className="au-radar-grid" />))}
      {axes.map((_,i)=>{const[x,y]=pt(i,R);return<line key={i} x1={cx} y1={cy} x2={x} y2={y} className="au-radar-axis" />;})}
      <path d={valuePath} className="au-radar-fill" />
      {axes.map(([key,label],i)=>{const[x,y]=pt(i,R+13);const v=k[key]||0;
        return<g key={key}><text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="au-radar-label">{label}</text><text x={x} y={y+11} textAnchor="middle" dominantBaseline="middle" className="au-radar-value">{(v*100|0)}</text></g>;
      })}
    </svg>
  );
}

// ── SINGLE CANVAS: terrain + overlay composited together ──
export default function WorldSim(){
const canvasRef=useRef(null);const glCanvasRef=useRef(null);const glStateRef=useRef(null);
const[seed,setSeed]=useState(8817);const[world,setWorld]=useState(null);
const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState(5);
const[coverage,setCoverage]=useState(0);const[tribeCount,setTribeCount]=useState(1);const[dominant,setDominant]=useState(null);
const[viewMode,setViewMode]=useState("terrain");const[preset,setPreset]=useState("tectonic");
const[oceanLevel,setOceanLevel]=useState(0.78);
const[depthFromSea,setDepthFromSea]=useState(false);
const[depthCeil,setDepthCeil]=useState(1.0);
const[showPlates,setShowPlates]=useState(false);
const[showRivers,setShowRivers]=useState(false);
const[showStreams,setShowStreams]=useState(false);
const[showLakes,setShowLakes]=useState(false);
const[showPower,setShowPower]=useState(false);
const[importStatus,setImportStatus]=useState(null);
const[hoverInfo,setHoverInfo]=useState(null);
const[tecPresetName,setTecPresetName]=useState("Default");
const[rightPanel,setRightPanel]=useState("");  // "" | "params" | "tribes"
const[showTuning,setShowTuning]=useState(false);
const[selectedTribe,setSelectedTribe]=useState(-1);
const[useRealWind,setUseRealWind]=useState(false);
const useMercator=false;
const[showGlobe,setShowGlobe]=useState(false);
const[globeBuf,setGlobeBuf]=useState(null);
const[globeTexSize,setGlobeTexSize]=useState({w:4096,h:2048});
const CH=useMercator?CH_MERC:CH_FLAT;
_mercator=useMercator;
const[mapCount,setMapCount]=useState(1);
const[activeRes,setActiveRes]=useState(()=>{const s={};for(const r of RESOURCES)s[r.id]=true;return s;});
const[tribeTab,setTribeTab]=useState("overview");
const[cardPos,setCardPos]=useState(()=>({
  x:typeof window!=="undefined"?Math.max(20,window.innerWidth-290-360):520,
  y:64
}));
const[keyOpen,setKeyOpen]=useState(true);
const[showTribeList,setShowTribeList]=useState(false);
const cardDragRef=useRef(null);
useEffect(()=>{
  const move=(e)=>{if(!cardDragRef.current)return;const d=cardDragRef.current;
    setCardPos({x:Math.max(4,d.x+(e.clientX-d.mx)),y:Math.max(4,d.y+(e.clientY-d.my))});};
  const up=()=>{cardDragRef.current=null;};
  window.addEventListener("mousemove",move);window.addEventListener("mouseup",up);
  return()=>{window.removeEventListener("mousemove",move);window.removeEventListener("mouseup",up);};
},[]);
const activeResRef=useRef(null);activeResRef.current=activeRes;
const extraCanvasRefs=useRef([]);
const extraWorldsRef=useRef([]);
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(5),viewRef=useRef("terrain");
const oceanLevelRef=useRef(0.78);const depthFromSeaRef=useRef(false);const depthCeilRef=useRef(1.0);const showPlatesRef=useRef(false);const showRiversRef=useRef(false);const showStreamsRef=useRef(false);const showLakesRef=useRef(false);const showGlobeRef=useRef(false);
const presetRef=useRef("tectonic");const fileRef=useRef(null);const importedWorldRef=useRef(null);
const useRealWindRef=useRef(false);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
const atlasCache=useRef(null);
// Reuse ImageData between frames to avoid 7.3MB allocation per draw
const imgRef=useRef(null);
// Wind particle animation state
const windParticlesRef=useRef(null);
const windAnimRef=useRef(null);
const W=1920,H=960,CW=CW_FLAT;
const workerRef=useRef(null);
// Helper: finalize a generated world (shared by worker + main thread paths)
const finalizeWorld=useCallback((w)=>{
setWorld(w);worldRef.current=w;const t=createTerritory(w);attachRegistries(t);ensureTribeViews(t);terRef.current=t;
setCoverage(0);setTribeCount(t.tribeCount);setPlaying(false);playRef.current=false;
terrainCache.current=null;atlasCache.current=null;imgRef.current=null;},[]);
const generate=useCallback((s,ol)=>{
// Import path
if(presetRef.current==="import"&&importedWorldRef.current){
const w=importedWorldRef.current;importedWorldRef.current=null;finalizeWorld(w);return;}
// Tectonic: use Web Worker for off-main-thread generation
if(presetRef.current==="tectonic"){
try{
if(workerRef.current)workerRef.current.terminate();
const worker=new WorldGenWorker();workerRef.current=worker;
worker.onmessage=(e)=>{
if(e.data.type==='result'){console.log(`[Worker] Done in ${e.data.time?.toFixed(0)}ms`);finalizeWorld(e.data.world);}
else{console.warn('[Worker]',e.data.type,e.data.message||'');
finalizeWorld(generateWorld(W,H,s,'tectonic',ol!==undefined?ol:oceanLevelRef.current,true,false));}};
worker.onerror=(err)=>{console.warn('[Worker] Error:',err.message);
finalizeWorld(generateWorld(W,H,s,'tectonic',ol!==undefined?ol:oceanLevelRef.current,true,false));};
worker.postMessage({type:'generate',W,H,seed:s,preset:'tectonic',oceanLevel:ol!==undefined?ol:oceanLevelRef.current,tecParams:_tecParams});
return;}catch(e){console.warn('[Worker] Init failed:',e);}}
// All other presets: main thread
finalizeWorld(generateWorld(W,H,s,presetRef.current,ol!==undefined?ol:oceanLevelRef.current,true,useRealWindRef.current));},[finalizeWorld]);
useEffect(()=>{generate(seed)},[seed,generate]);
// Build globe texture at 2048×1024 (GPU-friendly power-of-2) with polar blending
// Clear caches when globe toggled off (canvas remounts)
useEffect(()=>{if(!showGlobe){terrainCache.current=null;imgRef.current=null;windParticlesRef.current=null;}
},[showGlobe]);

// Generate extra seed preview maps (same params, different seeds)
const PW=480,PH=240;
const generateExtraMaps=useCallback(()=>{
if(mapCount<=1||presetRef.current!=="tectonic")return;
const nf={initNoise,fbm,ridged,noise2D,worley};
let idx=0;
const genNext=()=>{
if(idx>=mapCount-1)return;
const extraSeed=seed+idx+1;
const world=generateTectonicWorld(PW,PH,extraSeed,nf,_tecParams);
extraWorldsRef.current[idx]={seed:extraSeed,world};
const canvas=extraCanvasRefs.current[idx];
if(canvas)renderPreview(canvas,world,PW,PH);
idx++;requestAnimationFrame(genNext);};
requestAnimationFrame(genNext);
},[seed,mapCount]);
useEffect(()=>{generateExtraMaps();},[seed,mapCount,generateExtraMaps]);

// Build terrain RGB cache at tile resolution (one entry per tile)
const updateTerrainCache=useCallback((w,ter)=>{
const buf=new Uint8Array(CW*CH*3);const sl=0;
for(let ty=0;ty<CH;ty++){
const dataY=Math.round(screenYtoDataY(ty,CH,H));
for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,dataY);
const si=sy*W+sx;const e=w.elevation[si];
let m=w.moisture[si];
if(ter&&ter.tMoist){const tti=Math.min(ter.th-1,(sy/RES)|0)*ter.tw+Math.min(ter.tw-1,(sx/RES)|0);m=ter.tMoist[tti];}
const t=w.temperature[si];let r,g,b;
if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl);r=c[0];g=c[1];b=c[2];}
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
const rm=ter.rivers?ter.rivers.riverMag:null;
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
const m=w.moisture[si],t=w.temperature[si],biome=getBiomeD(e,m,t,0);
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
const m=w.moisture[si],biome=getBiomeD(e,m,w.temperature[si],0);
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
const biome=getBiomeD(e,w.moisture[si],w.temperature[si],0);
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
const bm=getBiomeD(e,w.moisture[si],w.temperature[si],0);
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
if(getBiomeD(e,dm,w.temperature[si],0)!==13)continue;
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
if(typeof window!=='undefined'){window.__ter=ter;window.__world=w;}
const sl=0,vm=viewRef.current;
const isGlobe=showGlobeRef.current;
// Use onscreen canvas if available, otherwise create offscreen for globe
let ctx=canvasRef.current?canvasRef.current.getContext("2d"):null;
if(!ctx&&!isGlobe)return;
if(!imgRef.current)imgRef.current=new ImageData(CW,CH);
const img=imgRef.current;const d=img.data;
// Lake lookup for rendering
const lk=ter.rivers&&ter.rivers.lake?ter.rivers.lake:null;
// Pre-cache tribe colors (avoids HSL→RGB trig per tile)
const maxT=ter.tribeCenters.length;const tcR=new Uint8Array(maxT),tcG=new Uint8Array(maxT),tcB=new Uint8Array(maxT);
for(let t2=0;t2<maxT;t2++){const c=tribeRGB(t2);tcR[t2]=c[0];tcG[t2]=c[1];tcB[t2]=c[2];}
const N=CW*CH;
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
}else if(vm==="population"){
// Population density heatmap: dark→blue→cyan→green→yellow→orange→red→white
// Uses bgPop + cityPop per tile. Log scale so villages and cities both visible.
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
const ptw=ter.tw,pth=ter.th;const pCityPop=ter.cityPop;
// Find max total pop for normalization (log scale)
let maxPop=1;for(let pti=0;pti<ptw*pth;pti++){
const tp=ter.bgPop[pti]+(pCityPop?pCityPop[pti]:0);if(tp>maxPop)maxPop=tp;}
const logMax=Math.log(maxPop+1);
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty2=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty2,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=4;d[pi4+1]=5;d[pi4+2]=12;d[pi4+3]=255;continue;}
// Map to tile coords
const ttx=Math.min(ptw-1,tx),tty=Math.min(pth-1,Math.round(screenYtoDataY(ty2,CH,H)/RES));
const tti=tty*ptw+ttx;
const pop=(ter.bgPop[tti]||0)+(pCityPop?pCityPop[tti]:0);
if(pop<0.01){// empty land — dim terrain
const tr2=(tc[ti*3]*0.2)|0,tg2=(tc[ti*3+1]*0.2)|0,tb2=(tc[ti*3+2]*0.2)|0;
d[pi4]=tr2;d[pi4+1]=tg2;d[pi4+2]=tb2;d[pi4+3]=255;continue;}
// Log-scale normalization: 0→1
const t=Math.min(1,Math.log(pop+1)/logMax);
let r,g,b;
// Dark navy → blue → cyan → green → yellow → orange → red → white
if(t<0.08){const s=t/0.08;r=(5+s*10)|0;g=(5+s*15)|0;b=(30+s*60)|0;}
else if(t<0.18){const s=(t-0.08)/0.10;r=(15)|0;g=(20+s*80)|0;b=(90+s*80)|0;}
else if(t<0.30){const s=(t-0.18)/0.12;r=(15-s*5)|0;g=(100+s*80)|0;b=(170-s*50)|0;}
else if(t<0.45){const s=(t-0.30)/0.15;r=(10+s*80)|0;g=(180+s*50)|0;b=(120-s*90)|0;}
else if(t<0.60){const s=(t-0.45)/0.15;r=(90+s*160)|0;g=(230+s*20)|0;b=(30-s*20)|0;}
else if(t<0.75){const s=(t-0.60)/0.15;r=(250)|0;g=(250-s*100)|0;b=(10+s*10)|0;}
else if(t<0.90){const s=(t-0.75)/0.15;r=(250)|0;g=(150-s*100)|0;b=(20+s*10)|0;}
else{const s=(t-0.90)/0.10;r=(250+s*5)|0;g=(50+s*150)|0;b=(30+s*180)|0;}// white-hot
// Slight terrain blend for topographic context
const landDim=0.15;const heatW=0.80;
const tr=(tc[ti*3]*landDim)|0,tg=(tc[ti*3+1]*landDim)|0,tb=(tc[ti*3+2]*landDim)|0;
r=(r*heatW+tr*(1-heatW))|0;g=(g*heatW+tg*(1-heatW))|0;b=(b*heatW+tb*(1-heatW))|0;
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="transport"){
// Transport cost heatmap: green(cheap/connected) → yellow → red(expensive) → black(unreachable)
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;const ptw=ter.tw,pth=ter.th;
const trc=ter.transportCost;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty2=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty2,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=0){d[pi4]=4;d[pi4+1]=5;d[pi4+2]=12;d[pi4+3]=255;continue;}
const ttx=Math.min(ptw-1,tx),tty=Math.min(pth-1,Math.round(screenYtoDataY(ty2,CH,H)/RES));
const tti=tty*ptw+ttx;
const cost2=trc?trc[tti]:999;
if(cost2>=999){// unreachable
d[pi4]=(tc[ti*3]*0.15)|0;d[pi4+1]=(tc[ti*3+1]*0.15)|0;d[pi4+2]=(tc[ti*3+2]*0.15)|0;d[pi4+3]=255;continue;}
// Normalize: 0→green, 10→yellow, 30→red, 50+→dark
const t=Math.min(1,cost2/50);let r,g,b;
if(t<0.2){const s=t/0.2;r=(20+s*30)|0;g=(180-s*20)|0;b=(40-s*20)|0;}
else if(t<0.5){const s=(t-0.2)/0.3;r=(50+s*180)|0;g=(160-s*60)|0;b=(20+s*10)|0;}
else if(t<0.8){const s=(t-0.5)/0.3;r=(230-s*80)|0;g=(100-s*70)|0;b=(30-s*10)|0;}
else{const s=(t-0.8)/0.2;r=(150-s*100)|0;g=(30-s*20)|0;b=(20-s*10)|0;}
const landDim=0.15;const heatW=0.80;
const tr2=(tc[ti*3]*landDim)|0,tg2=(tc[ti*3+1]*landDim)|0,tb2=(tc[ti*3+2]*landDim)|0;
r=(r*heatW+tr2*(1-heatW))|0;g=(g*heatW+tg2*(1-heatW))|0;b=(b*heatW+tb2*(1-heatW))|0;
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="tribes"){
const eraColor=(k)=>{if(!k)return[55,48,38];
const ag=k.agriculture,mt=k.metallurgy,org=k.organization;
if(mt>0.83&&org>0.55)return[90,75,100];
if(org>0.5&&mt>0.4)return[130,55,55];
if(mt>0.5)return[100,100,110];
if(mt>0.3)return[155,120,55];
if(mt>0.15)return[170,110,55];
if(ag>0.3)return[90,110,50];
if(ag>0.1)return[75,82,45];
return[55,48,38];};
const eraR=new Uint8Array(ter.tribeCenters.length),eraG=new Uint8Array(ter.tribeCenters.length),eraB=new Uint8Array(ter.tribeCenters.length);
for(let t2=0;t2<ter.tribeCenters.length;t2++){
const k2=ter.tribeKnowledge&&ter.tribeKnowledge[t2]?ter.tribeKnowledge[t2]:null;
const[er2,eg2,eb2]=eraColor(k2);eraR[t2]=er2;eraG[t2]=eg2;eraB[t2]=eb2;}
// ── FOCUSED TRIBE VIEW: when a tribe is selected ──
const sel=ter._selectedTribe;
const focused=sel>=0&&ter.tribeSizes[sel]>0;
// Pre-compute relationships and awareness for focused tribe
let knownTribes=null,relColors=null;
if(focused){
knownTribes=new Set();knownTribes.add(sel);relColors={};
// Known via border contact
if(ter._borderContacts&&ter._borderContacts[sel]){
for(const nid in ter._borderContacts[sel]){const j=parseInt(nid);
if(ter.tribeSizes[j]>0){knownTribes.add(j);relColors[j]=tribeRelation(ter,sel,j);}}}
// Known via maritime (known coasts)
if(ter.tribeKnownCoasts&&ter.tribeKnownCoasts[sel]){
for(const kc of ter.tribeKnownCoasts[sel]){
if(kc.owner>=0&&ter.tribeSizes[kc.owner]>0){knownTribes.add(kc.owner);
if(!relColors[kc.owner])relColors[kc.owner]=tribeRelation(ter,sel,kc.owner);}}}}
for(let ti=0;ti<N;ti++){
const e=ter.tElev[ti],ow=ter.owner[ti];let r,g,b;
if(e<=sl){r=6;g=8;b=16;}
else if(ow<0){r=focused?15:25;g=focused?14:23;b=focused?13:20;}// darker unowned in focused
else{
const tx3=ti%ter.tw,ty3=(ti-tx3)/ter.tw;let isBorder=false;let borderNeighbor=-1;
for(let di=0;di<4;di++){
const dnx=((tx3+DIRS[di][0])%ter.tw+ter.tw)%ter.tw,dny=ty3+DIRS[di][1];
if(dny<0||dny>=ter.th){isBorder=true;break;}
const nOwner=ter.owner[dny*ter.tw+dnx];
if(nOwner!==ow){isBorder=true;if(nOwner>=0)borderNeighbor=nOwner;break;}}
if(focused){
// FOCUSED VIEW: no era colors — pure relationship-based coloring
if(ow===sel){
// Selected tribe: light cream fill, white borders
if(isBorder){r=220;g=215;b=200;}
else{r=180;g=175;b=160;}
}else if(knownTribes&&knownTribes.has(ow)){
// Known tribe: FULL relationship color fill (not just borders)
const rel=relColors[ow]||'neutral';
if(rel==='fight'){// Red — at war
if(isBorder){r=200;g=50;b=40;}else{r=140;g=40;b=35;}}
else if(rel==='trade'){// Gold — trading
if(isBorder){r=200;g=180;b=50;}else{r=140;g=125;b=40;}}
else if(rel==='friendly'){// Green — friendly
if(isBorder){r=60;g=160;b=60;}else{r=45;g=110;b=45;}}
else{// Neutral (known but no relationship)
if(isBorder){r=120;g=115;b=105;}else{r=70;g=68;b=62;}}
}else{
// Unknown: fog of war
r=18;g=16;b=14;}}
else{// Normal (no focus): white borders, era fill
if(isBorder){r=200;g=195;b=185;}
else{r=eraR[ow];g=eraG[ow];b=eraB[ow];}}}
const pi4=ti<<2;d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="fertility"){
// Fertility overlay — green (high) → yellow → red (low)
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
const v=Math.max(0,Math.min(1,ter.tFert[ti]));
let r,g,b;
if(v>0.5){const t2=(v-0.5)*2;r=((1-t2)*255)|0;g=200;b=((t2)*40)|0;}
else{const t2=v*2;r=220;g=(t2*200)|0;b=0;}
const shade=1-Math.max(0,e-0.1)*0.5;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
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
}else{
// Default terrain view with white tribe borders
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){const ow=ter.owner[ti];
const pi4=ti<<2,ti3=ti*3;
const tr=tc[ti3],tg=tc[ti3+1],tb=tc[ti3+2];
if(ow>=0&&ter.tElev[ti]>sl){
const tx3=ti%ter.tw,ty3=(ti-tx3)/ter.tw;let isBorder=false;
for(let di=0;di<4;di++){
const dnx=((tx3+DIRS[di][0])%ter.tw+ter.tw)%ter.tw,dny=ty3+DIRS[di][1];
if(dny<0||dny>=ter.th){isBorder=true;break;}
if(ter.owner[dny*ter.tw+dnx]!==ow){isBorder=true;break;}}
if(isBorder){// White border over terrain
d[pi4]=(tr*0.4+200*0.6+.5)|0;d[pi4+1]=(tg*0.4+195*0.6+.5)|0;d[pi4+2]=(tb*0.4+185*0.6+.5)|0;
}else{d[pi4]=tr;d[pi4+1]=tg;d[pi4+2]=tb;}// pure terrain inside
}else{d[pi4]=tr;d[pi4+1]=tg;d[pi4+2]=tb;}
d[pi4+3]=255;}}
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
// Update globe texture from rendered canvas data (supports all view modes)
if(showGlobeRef.current){
const gW=4096,gH=2048;
const buf=new Uint8Array(gW*gH*3);
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
setGlobeBuf(buf);setGlobeTexSize({w:gW,h:gH});}
if(!ctx)return;
ctx.putImageData(img,0,0);
// Draw settlements — size scales continuously with log(population)
{const selSt=ter._selectedTribe;const hasSel=selSt>=0&&ter.tribeSizes[selSt]>0&&vm==="tribes";
for(let st=0;st<ter.tribeCenters.length;st++){const centers=ter.tribeCenters[st];
if(!centers||ter.tribeSizes[st]<=0)continue;
const isSelected=st===selSt;
const dimmed=hasSel&&!isSelected;
// Render top 100 centers max per tribe (sorted by pop, largest first)
const drawLimit=isSelected?200:(dimmed?20:100);
for(let ci=0;ci<Math.min(centers.length,drawLimit);ci++){const cx2=centers[ci].x+0.5,cy2=dataYtoScreenY(centers[ci].y*RES,H,CH)+0.5;
const isCapital=ci===0;
const cPop=centers[ci].pop||0;
// Radius: log scale. village(0.05)→0.7, town(0.5)→1.3, city(3)→1.8, large(100)→3.7
const r2=cPop>0?Math.max(0.5,Math.min(5,0.5+Math.log(cPop+1)*0.7)):0.5;
if(dimmed&&r2<1.0)continue;// skip tiny settlements of other tribes in focused mode
ctx.beginPath();ctx.arc(cx2,cy2,dimmed?r2*0.5:r2,0,Math.PI*2);
if(dimmed){ctx.fillStyle="rgba(120,115,105,0.2)";ctx.fill();}
else if(isSelected){
const tc2=tribeRGB(st);const bri=isCapital?1.3:1.0;
ctx.fillStyle=`rgba(${Math.min(255,tc2[0]*bri|0)},${Math.min(255,tc2[1]*bri|0)},${Math.min(255,tc2[2]*bri|0)},0.95)`;
ctx.fill();
if(r2>=0.8){ctx.beginPath();ctx.arc(cx2,cy2,r2+0.7,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.8)":"rgba(255,255,255,0.35)";ctx.lineWidth=isCapital?1:0.5;ctx.stroke();}
if(isCapital&&r2>=1){ctx.beginPath();ctx.arc(cx2,cy2,r2+1.8,0,Math.PI*2);
ctx.strokeStyle="rgba(255,255,220,0.3)";ctx.lineWidth=0.5;ctx.stroke();}
}else{
const tier=settleTier(cPop);const tn=tier?tier.name:'';
const alpha=isCapital?0.9:Math.max(0.25,Math.min(0.85,0.15+r2*0.18));
if(isCapital)ctx.fillStyle=`rgba(240,235,220,${alpha})`;
else if(tn==='large'||tn==='mega')ctx.fillStyle=`rgba(220,200,160,${alpha})`;
else if(tn==='medium'||tn==='small')ctx.fillStyle=`rgba(195,190,175,${alpha})`;
else ctx.fillStyle=`rgba(160,155,145,${alpha})`;
ctx.fill();
if(isCapital||r2>=1.8){ctx.beginPath();ctx.arc(cx2,cy2,r2+0.7,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(60,55,45,0.6)":"rgba(80,75,65,0.3)";ctx.lineWidth=isCapital?0.8:0.5;ctx.stroke();}
}}// end else, for(ci)
// ── Info label at capital (skip in focused mode — too cluttered) ──
const focusedMode=hasSel;
if(!focusedMode&&ter.tribeSizes[st]>=4){
const cap=centers[0];const cx2=cap.x+0.5,cy2=dataYtoScreenY(cap.y*RES,H,CH)+0.5;
const k=ter.tribeKnowledge&&ter.tribeKnowledge[st]?ter.tribeKnowledge[st]:null;
const pop=ter.tribePopulation?Math.round(ter.tribePopulation[st]):0;
const sz=ter.tribeSizes[st];
// Era label
let era="Stone";
if(k){if(k.metallurgy>0.85&&k.organization>0.6)era="Industrial";
else if(k.organization>0.5&&k.metallurgy>0.4)era="Empire";
else if(k.metallurgy>0.5)era="Iron";
else if(k.metallurgy>0.3)era="Bronze";
else if(k.metallurgy>0.15)era="Copper";
else if(k.agriculture>0.3)era="Farming";
else if(k.agriculture>0.1)era="Neolithic";}
// Format population nicely
// Pop is in thousands. Display as "800k" or "1.2M" or "12M"
const popStr=pop>=10000?(pop/1000).toFixed(1)+'M':pop>=1000?(pop/1000|0)+'M':pop>=1?pop.toFixed(0)+'k':'<1k';
// Two-line label: era + personality | pop + tiles
const pers=ter.tribeBudget&&ter.tribeBudget[st]?ter.tribeBudget[st].personality:"";
const line1=pers?`${era} ${pers}`:era;
const line2=`${popStr}  ${sz}t`;
ctx.font="bold 6px sans-serif";
const w1=ctx.measureText(line1).width;
ctx.font="5px sans-serif";
const w2=ctx.measureText(line2).width;
const boxW=Math.max(w1,w2)+6;
const boxH=15;
const bx=cx2-boxW/2,by=cy2+5;
// Background box
ctx.fillStyle="rgba(6,8,16,0.8)";
ctx.beginPath();
ctx.roundRect(bx,by,boxW,boxH,2);ctx.fill();
ctx.strokeStyle="rgba(200,195,185,0.3)";ctx.lineWidth=0.5;
ctx.beginPath();ctx.roundRect(bx,by,boxW,boxH,2);ctx.stroke();
// Era name (bold, white)
ctx.font="bold 6px sans-serif";
ctx.fillStyle="rgba(220,215,200,0.95)";
ctx.fillText(line1,cx2-w1/2,by+6.5);
// Stats line (smaller, dimmer)
ctx.font="5px sans-serif";
ctx.fillStyle="rgba(180,175,160,0.75)";
ctx.fillText(line2,cx2-w2/2,by+12.5);
}}// end if(!focusedMode), for(st)
}// end block scope for settlement drawing
// ── Draw ports (enhanced in focused mode) ──
{const focSel=ter._selectedTribe;const isFocused=focSel>=0&&ter.tribeSizes[focSel]>0&&vm==="tribes";
if(ter.tribePorts){
for(let st=0;st<ter.tribePorts.length;st++){
if(!ter.tribePorts[st]||ter.tribeSizes[st]<=0)continue;
// In focused mode: only show selected tribe's ports (large) and known tribe ports (small)
if(isFocused&&st!==focSel){
const fKnown=ter._borderContacts&&ter._borderContacts[focSel]&&ter._borderContacts[focSel][st];
const fMaritime=ter.tribeKnownCoasts&&ter.tribeKnownCoasts[focSel]&&ter.tribeKnownCoasts[focSel].some(kc=>kc.owner===st);
if(!fKnown&&!fMaritime)continue;}// skip unknown tribe's ports
const isSelected=st===focSel;
for(const port of ter.tribePorts[st]){
const px=port.x+0.5,py=dataYtoScreenY(port.y*RES,H,CH)+0.5;
const sz2=isSelected&&isFocused?2.5:1.2;// bigger ports for selected tribe
ctx.save();ctx.translate(px,py);ctx.rotate(Math.PI/4);
ctx.fillStyle=isSelected?"rgba(60,160,255,0.95)":"rgba(100,160,220,0.6)";
ctx.fillRect(-sz2,-sz2,sz2*2,sz2*2);
if(isSelected&&isFocused){ctx.strokeStyle="rgba(200,230,255,0.8)";ctx.lineWidth=0.6;
ctx.strokeRect(-sz2-0.5,-sz2-0.5,sz2*2+1,sz2*2+1);}
ctx.restore();}}}}
// ── Draw maritime discovery markers: dots at each known coast location ──
// No lines — just markers at discovered coastal locations. Each marker is on a real coast tile.
// The chain of markers shows the exploration route without any land-crossing artifacts.
{const focSel2=ter._selectedTribe;const isFocused2=focSel2>=0&&ter.tribeSizes[focSel2]>0&&vm==="tribes";
if(ter.tribeKnownCoasts){
for(let st=0;st<ter.tribeKnownCoasts.length;st++){
if(!ter.tribeKnownCoasts[st]||ter.tribeSizes[st]<=0)continue;
if(isFocused2&&st!==focSel2)continue;
const know=ter.tribeKnowledge&&ter.tribeKnowledge[st]?ter.tribeKnowledge[st]:null;
if(!know||know.navigation<0.1)continue;
for(const kc of ter.tribeKnownCoasts[st]){
const sx=kc.x+0.5,sy=dataYtoScreenY(kc.y*RES,H,CH)+0.5;
let col='100,160,220';let alpha=0.5;let dotR=0.8;
if(isFocused2){dotR=2.0;alpha=0.85;
if(kc.owner>=0&&kc.owner!==st){const rel=tribeRelation(ter,st,kc.owner);
col=rel==='fight'?'220,80,60':rel==='trade'?'220,200,80':rel==='friendly'?'80,180,80':'100,160,220';}
else if(kc.owner<0){col='180,230,255';alpha=0.7;}}// unowned — light blue
ctx.fillStyle=`rgba(${col},${alpha})`;
ctx.beginPath();ctx.arc(sx,sy,dotR,0,Math.PI*2);ctx.fill();
// In focused mode, draw a ring around the dot for visibility
if(isFocused2){ctx.strokeStyle=`rgba(${col},${alpha*0.5})`;ctx.lineWidth=0.5;
ctx.beginPath();ctx.arc(sx,sy,dotR+1,0,Math.PI*2);ctx.stroke();}}}}}
// ── Highlight selected tribe (only when NOT in focused tribes view — focused view handles it inline) ──
if(ter._selectedTribe>=0&&ter.tribeSizes[ter._selectedTribe]>0&&vm!=="tribes"){
const sel=ter._selectedTribe;
for(let ti=0;ti<N;ti++){if(ter.owner[ti]!==sel)continue;
const tx3=ti%ter.tw,ty3=(ti-tx3)/ter.tw;
for(const[dx,dy]of DIRS){const nx=((tx3+dx)%ter.tw+ter.tw)%ter.tw,ny3=ty3+dy;
if(ny3<0||ny3>=ter.th)continue;
if(ter.owner[ny3*ter.tw+nx]!==sel){
ctx.fillStyle="rgba(255,230,100,0.6)";ctx.fillRect(tx3,dataYtoScreenY(ty3*RES,H,CH),1,1);break;}}}}
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
// Power view removed — replaced by era-based rendering and focused view
// Power centers removed — centers already drawn in main center loop above}
},[updateTerrainCache,buildAtlas,CH]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;depthCeilRef.current=depthCeil;showPlatesRef.current=showPlates;showRiversRef.current=showRivers;showStreamsRef.current=showStreams;showLakesRef.current=showLakes;showGlobeRef.current=showGlobe;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,depthCeil,showPlates,showRivers,showStreams,showLakes,showPower,showGlobe,activeRes]);

useEffect(()=>{let fid,acc=0,last=performance.now(),drawSkip=0;
const loop=now=>{fid=requestAnimationFrame(loop);if(!playRef.current||!terRef.current||!worldRef.current){last=now;return;}
acc+=now-last;last=now;const iv=Math.max(16,100/speedRef.current);
if(acc>=iv){acc=0;
// Adaptive step rate: early history flies by, modern era slows down.
// Uses current step count to determine how many sim steps per frame.
const curStep=terRef.current.stepCount;
// Early game (<200 steps = pre-agriculture): fast. Late game (>800): slow.
// Scaled by user speed setting.
// Early Bronze Age runs faster, modern era slower
const eraFactor=curStep<100?3:curStep<200?2:curStep<500?1.5:1;
const sub=Math.min(3,Math.max(1,Math.ceil(speedRef.current/3*eraFactor)));// cap at 3 steps/frame to prevent freezing
// Time-budgeted sim: stop stepping if we've used >8ms this frame
const _simStart=performance.now();
for(let s=0;s<sub;s++){
try{terRef.current=stepTerritory(terRef.current,worldRef.current);}
catch(e){console.error('[SIM CRASH]',e.message,e.stack);playRef.current=false;return;}
if(performance.now()-_simStart>8)break;
}
setCoverage(Math.round(terRef.current.settled/terRef.current.landCount*100));
let alive=0,bestId=-1,bestPow=0;const ter2=terRef.current;
for(let i=0;i<ter2.tribeSizes.length;i++){if(ter2.tribeSizes[i]<=0)continue;alive++;
const pw=tribePower(ter2,i);if(pw>bestPow){bestPow=pw;bestId=i;}}
setTribeCount(alive);setDominant(bestId>=0?{id:bestId,power:bestPow,size:ter2.tribeSizes[bestId],
strength:ter2.tribeStrength[bestId],density:ter2.tribeStrength[bestId]/ter2.tribeSizes[bestId]}:null);
// Only redraw every 3rd sim frame to save 10-30ms/frame on CPU canvas rendering
drawSkip++;
if(drawSkip>=3){drawSkip=0;
try{draw(terRef.current);}catch(e){console.error('[DRAW CRASH]',e.message,e.stack);playRef.current=false;}}}};
fid=requestAnimationFrame(loop);return()=>cancelAnimationFrame(fid);},[draw]);

// Wind particle animation loop — redraws at ~30fps when in wind view
useEffect(()=>{let wfid;
const windLoop=()=>{wfid=requestAnimationFrame(windLoop);
if(viewRef.current!=="wind"||!worldRef.current||!terRef.current)return;
draw(terRef.current);};
wfid=requestAnimationFrame(windLoop);
return()=>cancelAnimationFrame(wfid);},[draw]);

const togglePlay=()=>{if(!playing&&terRef.current&&terRef.current.settled>=terRef.current.landCount){
const t=createTerritory(worldRef.current);attachRegistries(t);ensureTribeViews(t);terRef.current=t;setTribeCount(t.tribeCount);setCoverage(0);setDominant(null);setSelectedTribe(-1);terrainCache.current=null;atlasCache.current=null;draw(t);}
playRef.current=!playRef.current;setPlaying(p=>!p);};
const handleImport=useCallback(async(e)=>{const file=e.target.files?.[0];if(!file)return;
e.target.value="";
setImportStatus("Loading...");
try{let w;
if(file.name.endsWith(".json")||file.name.endsWith(".map")){
const text=await file.text();const parsed=parseAzgaarJSON(text);
w=rasterizeAzgaar(parsed,W,H);
setImportStatus(`Azgaar map loaded (${parsed.n} cells, ${parsed.stateSet.size} states)`);
}else if(file.type.startsWith("image/")){
const img=await loadImageFile(file);
w=rasterizeHeightmap(img.data,img.width,img.height,W,H);
setImportStatus(`Heightmap loaded (${img.width}\u00d7${img.height})`);
}else{setImportStatus("Unsupported file type");return;}
const swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(w.elevation[i]>0&&w.elevation[i]<0.025&&w.moisture[i]>0.45&&w.temperature[i]>0.35){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);if(nv>-0.1)swamp[i]=1;}}
w.swamp=swamp;
importedWorldRef.current=w;presetRef.current="import";setPreset("import");
setSeed(Math.floor(Math.random()*999999));
setTimeout(()=>setImportStatus(null),4000);
}catch(err){setImportStatus("Import failed: "+err.message);setTimeout(()=>setImportStatus(null),5000);}
},[seed]);
const onCanvasMove=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!worldRef.current)return;
const r=c.getBoundingClientRect();
const sx=(ev.clientX-r.left)/r.width*CW,sy=(ev.clientY-r.top)/r.height*CH;
const wx=Math.floor(sx)*RES,wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const w=worldRef.current,i=wy*1920+wx;
if(wx<0||wx>=1920||wy<0||wy>=960){setHoverInfo(null);return;}
const elev=w.elevation[i]||0;
const temp=w.temperature[i]||0;
const terTi=terRef.current?Math.min(terRef.current.th-1,(wy/RES)|0)*terRef.current.tw+Math.min(terRef.current.tw-1,(wx/RES)|0):-1;
const moist=terTi>=0&&terRef.current?terRef.current.tMoist[terTi]:(w.moisture[i]||0);
const biome=getBiomeD(elev,moist,temp,0);
const biomeName=BN[biome]||"Ocean";
const elevM=elev<=0?Math.round(elev*4000):Math.round(elev*8000);
const tempC=Math.round(temp*100-60);// range: -60°C to +40°C
const lat=Math.abs(wy/960-0.5)*2;
const fertVal=elev>0?(terTi>=0&&terRef.current?terRef.current.tFert[terTi]:tileFert(temp,moist,elev)):0;
const wdx=w.windX?w.windX[i]:0,wdy=w.windY?w.windY[i]:0;
const wspd=Math.sqrt(wdx*wdx+wdy*wdy);
const wkmh=Math.round(wspd*100); // normalized → km/h (median ~18 km/h)
// +Y is south in screen coords, so negate wdy for compass direction
// Direction = where the wind is blowing TO
const wdeg=((Math.atan2(-wdy,wdx)*180/Math.PI)+360)%360;
const wdir=["E","NE","N","NW","W","SW","S","SE"][Math.round(wdeg/45)%8];
// Resource info at this tile
const tileRes=terTi>=0&&terRef.current&&terRef.current.deposits?tileResourceSummary(terRef.current.deposits,terTi):[];
const riverMag=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.riverMag[terTi]:0;
const riverAccum=terTi>=0&&terRef.current&&terRef.current.rivers?terRef.current.rivers.flowAccum[terTi]:0;
const isLake=terTi>=0&&terRef.current&&terRef.current.rivers&&terRef.current.rivers.lake?terRef.current.rivers.lake[terTi]>=0:false;
const lakeSize=isLake?terRef.current.rivers.lakeInfo[terRef.current.rivers.lake[terTi]].size:0;
// Tribe info at this tile
const ter=terRef.current;
let tribeInfo=null;
if(ter&&terTi>=0&&ter.owner[terTi]>=0){
const ow2=ter.owner[terTi];
const k=ter.tribeKnowledge&&ter.tribeKnowledge[ow2]?ter.tribeKnowledge[ow2]:null;
const pop2=ter.tribePopulation?ter.tribePopulation[ow2]:0;
const bud2=ter.tribeBudget&&ter.tribeBudget[ow2]?ter.tribeBudget[ow2]:null;
// Compute relationship with selected tribe if any
const selT=selectedTribe;
let relation='';
if(selT>=0&&selT!==ow2&&ter.tribeSizes[selT]>0)relation=tribeRelation(ter,selT,ow2);
const stCounts2=ter._settleCounts&&ter._settleCounts[ow2]?ter._settleCounts[ow2]:{villages:0,towns:0,cities:0,large:0};
const ports2=ter.tribePorts&&ter.tribePorts[ow2]?ter.tribePorts[ow2].length:0;
const kc2=ter.tribeKnownCoasts&&ter.tribeKnownCoasts[ow2]?ter.tribeKnownCoasts[ow2].length:0;
tribeInfo={id:ow2,size:ter.tribeSizes[ow2],pop:Math.round(pop2),
knowledge:k?{ag:k.agriculture,mt:k.metallurgy,nv:k.navigation,cn:k.construction,og:k.organization,tr:k.trade}:null,
personality:bud2?bud2.personality:"",budget:bud2?{mil:bud2.military,gro:bud2.growth,com:bud2.commerce,exp:bud2.exploration,sur:bud2.survival}:null,
relation,settlements:stCounts2,ports:ports2,knownCoasts:kc2};}
setHoverInfo({x:ev.clientX,y:ev.clientY,elevM,tempC,moist,biome:biomeName,fert:fertVal,lat,wspd,wdir,wkmh,resources:tileRes,river:riverMag,riverAccum,isLake,lakeSize,tribeInfo});
},[CW,CH]);
const onCanvasLeave=useCallback(()=>setHoverInfo(null),[]);
const onCanvasClick=useCallback((ev)=>{
const c=canvasRef.current;if(!c||!terRef.current)return;
const r=c.getBoundingClientRect();
const sx=(ev.clientX-r.left)/r.width*CW,sy=(ev.clientY-r.top)/r.height*CH;
const wx=Math.floor(sx),wy=Math.round(screenYtoDataY(Math.floor(sy),CH,H));
const ter=terRef.current;if(!ter)return;
const ttx=Math.min(ter.tw-1,(wx/RES)|0),tty=Math.min(ter.th-1,(wy/RES)|0);
const tileOwner=ter.owner[tty*ter.tw+ttx];
if(tileOwner>=0&&ter.tribeSizes[tileOwner]>0){
setSelectedTribe(tileOwner);ter._selectedTribe=tileOwner;
setRightPanel("tribes");draw(ter);
}else{setSelectedTribe(-1);if(ter)ter._selectedTribe=-1;draw(ter);}
},[CW,CH,draw]);
const setPresetAndGo=(p)=>{presetRef.current=p;setPreset(p);setSeed(Math.floor(Math.random()*999999));};
const gridCols=mapCount<=1?1:mapCount<=4?2:mapCount<=6?3:mapCount<=9?3:5;

// ── Aggregate world stats for the chronicle ribbon ──
const _ter=terRef.current;
const _step=_ter?_ter.stepCount:0;
const _ys=yearStr(_step);
let _aAg=0,_aMt=0,_aNv=0,_aOg=0,_aliveK=0;
if(_ter&&_ter.tribeKnowledge){
  for(let i=0;i<_ter.tribeKnowledge.length;i++){
    if(_ter.tribeSizes[i]<=0)continue;_aliveK++;const _k=_ter.tribeKnowledge[i];
    _aAg+=_k.agriculture;_aMt+=_k.metallurgy;_aNv+=_k.navigation;_aOg+=_k.organization;}
  if(_aliveK>0){_aAg/=_aliveK;_aMt/=_aliveK;_aNv/=_aliveK;_aOg/=_aliveK;}}
const _era=deriveEra(_aAg,_aMt,_aNv,_aOg);

// View modes for the right rail
const VIEW_MODES=[
  ["terrain","Terrain"],["atlas","Atlas"],["depth","Depth"],["wind","Wind"],
  ["moisture","Moisture"],["temperature","Temp"],["fertility","Fertility"],
  ["resources","Resources"],["population","Pop"],["transport","Transport"],["tribes","Tribes"]
];

return(
<div className="au-root" style={{width:"100vw",height:"calc(100vh - 40px)",
  background:"var(--au-table-dark)",overflow:"hidden",display:"flex",position:"relative"}}>

{/* ══════════ LEFT SPINE ══════════ */}
<aside className="au-parchment au-scroll" style={{
  width:142,minWidth:142,margin:"6px 3px 6px 6px",padding:"10px 8px",
  display:"flex",flexDirection:"column",gap:5,overflowY:"auto"}}>

<button onClick={togglePlay}
  className={"au-btn au-block"+(playing?" au-wax au-active":"")}
  style={{padding:"8px 6px",fontSize:13,fontFamily:"'Cinzel',Georgia,serif",letterSpacing:"0.10em"}}>
  {playing?"❚❚  Pause":"▶  Play"}
</button>

<div style={{display:"flex",alignItems:"center",gap:6,padding:"2px 4px"}}>
  <span className="au-sc au-fade" style={{fontSize:10}}>Speed</span>
  <input type="range" min={1} max={10} value={speed}
    onChange={e=>{setSpeed(+e.target.value);speedRef.current=+e.target.value;}}
    style={{flex:1}} />
  <span className="au-mute" style={{fontSize:10,width:14,textAlign:"right"}}>{speed}</span>
</div>

<div className="au-rule" />
<div className="au-sc au-fade au-heading" style={{fontSize:10,padding:"2px 4px 0"}}>World</div>

<button onClick={()=>setPresetAndGo("earth_sim")}
  className={"au-btn au-block"+(preset==="earth_sim"?" au-active":"")}>Earth (Sim)</button>
{preset==="earth_sim"&&
  <label style={{fontSize:10,padding:"0 4px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}} className="au-fade">
    <input type="checkbox" checked={useRealWind}
      onChange={e=>{setUseRealWind(e.target.checked);useRealWindRef.current=e.target.checked;generate(seed);}}
      style={{width:11,height:11}} />
    {isRealWindAvailable()?"Real Winds":"Real Winds (n/a)"}
  </label>}

<button onClick={()=>setPresetAndGo("tectonic")}
  className={"au-btn au-block"+(preset==="tectonic"?" au-active":"")}>Tectonic</button>
{preset==="tectonic"&&<>
  <select value={tecPresetName} onChange={e=>{
    const name=e.target.value;setTecPresetName(name);
    if(name==="Default"){_tecParams={};generate(seed);}
    else{const presets=loadPresets();if(presets[name]){_tecParams=presets[name];generate(seed);}}
  }} style={{width:"100%",marginTop:2}}>
    <option value="Default">Default</option>
    {Object.keys(loadPresets()).map(name=><option key={name} value={name}>{name}</option>)}
  </select>
  {tecPresetName!=="Default"&&<button onClick={()=>{
    if(confirm("Delete '"+tecPresetName+"'?")){deletePreset(tecPresetName);setTecPresetName("Default");_tecParams={};generate(seed);}}}
    className="au-btn au-block au-wax" style={{fontSize:10}}>Delete Preset</button>}
</>}

<input ref={fileRef} type="file" accept=".json,.map,.png,.jpg,.jpeg,.webp"
  style={{display:"none"}} onChange={handleImport} />
<button onClick={()=>fileRef.current?.click()} className="au-btn au-block">Import</button>
{importStatus&&<span className="au-fade" style={{fontSize:9,wordBreak:"break-all",padding:"0 4px"}}>{importStatus}</span>}

<div style={{flex:1}} />
<div className="au-rule" />
<button onClick={()=>setSeed(Math.floor(Math.random()*999999))}
  className="au-btn au-block au-flat" style={{fontSize:11}} title="Roll new seed">⚄ Roll</button>
<span className="au-fade" style={{fontSize:9,textAlign:"center",fontFamily:"'Courier New',monospace"}}>Seed {seed}</span>
</aside>

{/* ══════════ CENTER COLUMN ══════════ */}
<div style={{flex:1,display:"flex",flexDirection:"column",padding:"6px 3px",gap:6,minWidth:0}}>

{/* Chronicle ribbon */}
<div className="au-parchment au-chronicle" style={{flexShrink:0}}>
  <span className="au-era">{_era}</span>
  <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
  <span className="au-year">{_ys}</span>
  <span className="au-fade" style={{fontSize:11}}>Step {_step.toLocaleString()}</span>
  <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
  <span style={{fontSize:13}}>{tribeCount} <span className="au-sc au-fade" style={{fontSize:11}}>nations</span></span>
  <span style={{fontSize:13}}>{coverage}<span className="au-fade">%</span> <span className="au-sc au-fade" style={{fontSize:11}}>claimed</span></span>
  {dominant&&<>
    <span className="au-vrule" style={{height:20,margin:"0 2px"}} />
    <span style={{display:"inline-flex",alignItems:"center",gap:6}}>
      <span className="au-wax-seal au-small"
        style={{background:`rgb(${tribeRGB(dominant.id).join(",")})`}}>{dominant.id}</span>
      <span className="au-sc au-fade" style={{fontSize:11}}>Dominant</span>
      <span>{dominant.size}t</span>
    </span>
  </>}
  <div style={{flex:1}} />
  {_aliveK>0&&<span className="au-fade" style={{fontSize:10,fontFamily:"'Courier New',monospace"}}>
    Ag {(_aAg*100|0)} · Mt {(_aMt*100|0)} · Nv {(_aNv*100|0)} · Og {(_aOg*100|0)}
  </span>}
</div>

{/* Map area */}
<div style={{flex:1,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",minHeight:0,overflow:"hidden"}}>

{mapCount<=1?(
  showGlobe?
    <div style={{width:"100%",aspectRatio:"4/3",maxHeight:"100%"}}>
      <GlobeView terrainBuf={globeBuf} world={world} CW={globeTexSize.w} CH={globeTexSize.h} />
    </div>:
    <canvas ref={canvasRef} width={CW} height={CH}
      onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave} onClick={onCanvasClick}
      style={{display:"block",imageRendering:"pixelated",
        maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",aspectRatio:`${CW}/${CH}`,
        boxShadow:"0 8px 36px rgba(0,0,0,0.7)",border:"1px solid var(--au-paper-deep)"}} />
):(
  <div style={{width:"100%",height:"100%",display:"grid",
    gridTemplateColumns:`repeat(${gridCols},1fr)`,gap:4,padding:2}}>
    {Array.from({length:mapCount}).map((_,mi)=>{
      const extraSeed=seed+mi;
      return(
        <div key={mi} style={{position:"relative",overflow:"hidden",display:"flex",
          alignItems:"center",justifyContent:"center",cursor:mi>0?"pointer":"default",
          border:mi===0?"1px solid var(--au-paper-deep)":"1px solid rgba(168,140,92,0.4)"}}
          onClick={()=>{if(mi>0)setSeed(extraSeed);}}>
          {mi===0?
            <canvas ref={canvasRef} width={CW} height={CH}
              onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave} onClick={onCanvasClick}
              style={{display:"block",imageRendering:"pixelated",maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",aspectRatio:`${CW}/${CH}`}} />:
            <canvas ref={el=>extraCanvasRefs.current[mi-1]=el} width={PW} height={PH}
              style={{display:"block",imageRendering:"pixelated",maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",aspectRatio:`${PW}/${PH}`}} />}
          {mi>0&&<div style={{position:"absolute",bottom:2,left:0,right:0,textAlign:"center",
            color:"var(--au-paper)",fontSize:10,textShadow:"0 1px 2px rgba(0,0,0,0.8)",pointerEvents:"none"}}>Seed {extraSeed}</div>}
        </div>);})}
  </div>
)}

{/* ─── Pico hover card ─── */}
{hoverInfo&&<div className="au-parchment au-pico"
  style={{left:hoverInfo.x+14,top:hoverInfo.y-12}}>
  <div className="au-pico-title" style={{
    color:hoverInfo.isLake?"var(--au-verdigris)":hoverInfo.elevM<=0?"var(--au-verdigris)":"var(--au-ink)"}}>
    {hoverInfo.isLake?`Lake (${hoverInfo.lakeSize}t)`:hoverInfo.biome}
  </div>
  <div className="au-fade" style={{fontSize:11}}>
    {hoverInfo.elevM}m · {hoverInfo.tempC}°C · {(hoverInfo.moist*100|0)}% moist
  </div>
  {hoverInfo.river>0&&<div className="au-verde-text" style={{fontSize:11}}>
    {RIVER_NAMES[hoverInfo.river]}
  </div>}
  {hoverInfo.tribeInfo&&<div style={{fontSize:11,marginTop:2,display:"flex",alignItems:"center",gap:5}}>
    <span className="au-wax-seal au-small" style={{background:`rgb(${tribeRGB(hoverInfo.tribeInfo.id).join(",")})`}} />
    <span>#{hoverInfo.tribeInfo.id} <span className="au-fade">{fmtPop(hoverInfo.tribeInfo.pop)}</span></span>
    {hoverInfo.tribeInfo.relation==='fight'&&<span style={{color:"var(--au-wax-red)",fontWeight:600,fontSize:10}}>⚔</span>}
    {hoverInfo.tribeInfo.relation==='trade'&&<span style={{color:"var(--au-gold)",fontWeight:600,fontSize:10}}>⚜</span>}
  </div>}
  <div className="au-fade" style={{fontSize:9,marginTop:2,fontStyle:"italic"}}>click for full info</div>
</div>}

{/* ─── Floating tribe card ─── */}
{(()=>{
  const ter=terRef.current;
  if(selectedTribe<0||!ter||ter.tribeSizes[selectedTribe]<=0)return null;
  const sel=selectedTribe;
  const size=ter.tribeSizes[sel];
  const pop=ter.tribePopulation?ter.tribePopulation[sel]:0;
  const power=tribePower(ter,sel);
  const bud=ter.tribeBudget&&ter.tribeBudget[sel]?ter.tribeBudget[sel]:null;
  const k=ter.tribeKnowledge&&ter.tribeKnowledge[sel]?ter.tribeKnowledge[sel]:null;
  const stC=ter._settleCounts&&ter._settleCounts[sel]?ter._settleCounts[sel]:{villages:0,towns:0,cities:0,large:0};
  const ports=ter.tribePorts&&ter.tribePorts[sel]?ter.tribePorts[sel].length:0;
  const knownCoasts=ter.tribeKnownCoasts&&ter.tribeKnownCoasts[sel]?ter.tribeKnownCoasts[sel].length:0;
  const td=ter.tradeData&&ter.tradeData[sel]?ter.tradeData[sel]:null;
  const [tr,tg,tb]=tribeRGB(sel);
  return(
    <div className="au-parchment au-elev au-tribe-card"
      style={{left:cardPos.x,top:cardPos.y}}>
      <div className="au-drag-handle"
        onMouseDown={(e)=>{cardDragRef.current={mx:e.clientX,my:e.clientY,x:cardPos.x,y:cardPos.y};e.preventDefault();}}
        style={{display:"flex",alignItems:"center",gap:8}}>
        <span className="au-wax-seal" style={{background:`rgb(${tr},${tg},${tb})`}}>{sel}</span>
        <div style={{flex:1,minWidth:0}}>
          <div className="au-tribename">Tribe&nbsp;№{sel}</div>
          {bud?.personality&&<div className="au-fade" style={{fontSize:11,fontStyle:"italic"}}>the {bud.personality.toLowerCase()}</div>}
        </div>
        <span className="au-x" onClick={()=>{setSelectedTribe(-1);if(ter)ter._selectedTribe=-1;draw(ter);}}>✕</span>
      </div>

      {/* Quick stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"2px 10px",margin:"4px 0 10px"}}>
        <div>
          <div className="au-sc au-fade" style={{fontSize:9}}>Territory</div>
          <div className="au-heading" style={{fontSize:14}}>{size.toLocaleString()}</div>
        </div>
        <div>
          <div className="au-sc au-fade" style={{fontSize:9}}>People</div>
          <div className="au-heading" style={{fontSize:14}}>{fmtPop(pop)}</div>
        </div>
        <div>
          <div className="au-sc au-fade" style={{fontSize:9}}>Power</div>
          <div className="au-heading" style={{fontSize:14}}>{power.toFixed(0)}</div>
        </div>
        <div>
          <div className="au-sc au-fade" style={{fontSize:9}}>Gold</div>
          <div className="au-heading au-gold-text" style={{fontSize:14}}>{fmtGold(bud?.wealth||0)}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",borderBottom:"1px solid rgba(58,38,20,0.30)",margin:"0 -6px"}}>
        {[["overview","Overview"],["knowledge","Knowledge"],["diplomacy","Diplomacy"],["trade","Trade"]].map(([id,label])=>(
          <button key={id} className={"au-tab"+(tribeTab===id?" au-active":"")}
            onClick={()=>setTribeTab(id)}>{label}</button>
        ))}
      </div>

      <div style={{padding:"10px 2px 2px",fontSize:12,minHeight:160}}>
      {tribeTab==="overview"&&<>
        <div className="au-sc au-fade" style={{fontSize:10,marginBottom:4}}>Settlements</div>
        {(stC.large+stC.cities+stC.towns+stC.villages)>0?
          <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:8,fontSize:12}}>
            {stC.large>0&&<span><span className="au-gold-text" style={{fontSize:14,fontFamily:"'Cinzel',serif"}}>{stC.large}</span> <span className="au-fade au-sc" style={{fontSize:10}}>capital{stC.large!==1?"s":""}</span></span>}
            {stC.cities>0&&<span><span style={{fontSize:14,fontFamily:"'Cinzel',serif"}}>{stC.cities}</span> <span className="au-fade au-sc" style={{fontSize:10}}>cit{stC.cities===1?"y":"ies"}</span></span>}
            {stC.towns>0&&<span><span style={{fontSize:14,fontFamily:"'Cinzel',serif"}}>{stC.towns}</span> <span className="au-fade au-sc" style={{fontSize:10}}>town{stC.towns!==1?"s":""}</span></span>}
            {stC.villages>0&&<span><span style={{fontSize:14,fontFamily:"'Cinzel',serif"}}>{stC.villages}</span> <span className="au-fade au-sc" style={{fontSize:10}}>village{stC.villages!==1?"s":""}</span></span>}
          </div>:
          <div className="au-fade" style={{fontStyle:"italic",fontSize:11,marginBottom:8}}>no permanent settlements yet</div>}
        {(ports>0||knownCoasts>0)&&<>
          <div className="au-sc au-fade" style={{fontSize:10,marginBottom:4}}>Sea</div>
          <div style={{fontSize:12,marginBottom:8}}>
            <span style={{fontFamily:"'Cinzel',serif"}}>{ports}</span> <span className="au-fade au-sc" style={{fontSize:10}}>port{ports!==1?"s":""}</span>
            {" · "}
            <span style={{fontFamily:"'Cinzel',serif"}}>{knownCoasts}</span> <span className="au-fade au-sc" style={{fontSize:10}}>known coasts</span>
          </div>
        </>}
        {bud&&<>
          <div className="au-sc au-fade" style={{fontSize:10,marginBottom:4}}>Priorities</div>
          <div style={{display:"flex",height:8,borderRadius:2,overflow:"hidden",
            border:"1px solid rgba(58,38,20,0.3)",marginBottom:4}}>
            <div style={{width:`${bud.military*100}%`,background:"#9a3030"}} title={`Military ${(bud.military*100|0)}%`} />
            <div style={{width:`${bud.growth*100}%`,background:"#5a8030"}} title={`Growth ${(bud.growth*100|0)}%`} />
            <div style={{width:`${bud.commerce*100}%`,background:"#3a6a98"}} title={`Commerce ${(bud.commerce*100|0)}%`} />
            <div style={{width:`${bud.exploration*100}%`,background:"#a07028"}} title={`Exploration ${(bud.exploration*100|0)}%`} />
            <div style={{width:`${bud.survival*100}%`,background:"#5a5448"}} title={`Survival ${(bud.survival*100|0)}%`} />
          </div>
          <div style={{display:"flex",justifyContent:"space-between",gap:4,fontSize:10}} className="au-sc">
            <span style={{color:"#9a3030"}}>{(bud.military*100|0)}mil</span>
            <span style={{color:"#5a8030"}}>{(bud.growth*100|0)}gro</span>
            <span style={{color:"#3a6a98"}}>{(bud.commerce*100|0)}com</span>
            <span style={{color:"#a07028"}}>{(bud.exploration*100|0)}exp</span>
            <span style={{color:"#5a5448"}}>{(bud.survival*100|0)}sur</span>
          </div>
        </>}
      </>}

      {tribeTab==="knowledge"&&k&&
        <div style={{display:"flex",gap:14,alignItems:"center",justifyContent:"flex-start"}}>
          <KnowledgeRadar k={k} size={155} />
          <div style={{fontSize:11,lineHeight:1.7,flex:1}}>
            {[["agriculture","Agriculture","#5a8030"],["metallurgy","Metallurgy","#a07028"],
              ["navigation","Navigation","#3a6a98"],["construction","Construction","#6b5b3c"],
              ["organization","Organization","#7a3878"],["trade","Trade","#a08828"]].map(([key,label,col])=>{
              const v=k[key]||0;
              return(
                <div key={key} style={{display:"flex",gap:5,alignItems:"baseline"}}>
                  <span style={{flex:1,color:v>0.15?"var(--au-ink)":"var(--au-ink-light)"}}>{label}</span>
                  <span className="au-heading" style={{fontSize:12,color:v>0.15?col:"var(--au-ink-light)"}}>{(v*100|0)}</span>
                </div>);})}
          </div>
        </div>}
      {tribeTab==="knowledge"&&!k&&<div className="au-fade" style={{textAlign:"center",fontStyle:"italic"}}>no knowledge data</div>}

      {tribeTab==="diplomacy"&&(()=>{
        const allRels=[];const seen=new Set();
        if(ter._borderContacts&&ter._borderContacts[sel]){
          for(const nid in ter._borderContacts[sel]){const n=parseInt(nid);
            if(ter.tribeSizes[n]<=0)continue;seen.add(n);
            allRels.push({id:n,size:ter.tribeSizes[n],rel:tribeRelation(ter,sel,n),via:'border'});}}
        if(ter.tribeKnownCoasts&&ter.tribeKnownCoasts[sel]){
          for(const kc of ter.tribeKnownCoasts[sel]){
            if(kc.owner>=0&&!seen.has(kc.owner)&&ter.tribeSizes[kc.owner]>0){
              seen.add(kc.owner);
              allRels.push({id:kc.owner,size:ter.tribeSizes[kc.owner],rel:tribeRelation(ter,sel,kc.owner),via:'maritime'});}}}
        allRels.sort((a,b)=>b.size-a.size);
        if(!allRels.length)return<div className="au-fade" style={{textAlign:"center",fontStyle:"italic",padding:"12px 0"}}>no known nations</div>;
        const relCol={fight:"#9a3030",trade:"#a07028",friendly:"#3a6a48",neutral:"#6b4f37"};
        const relLabel={fight:"At War",trade:"Trading",friendly:"Friendly",neutral:""};
        return<div>
          <div className="au-sc au-fade" style={{fontSize:10,marginBottom:4}}>{allRels.length} known nation{allRels.length===1?"":"s"}</div>
          <div style={{maxHeight:180,overflowY:"auto"}} className="au-scroll">
          {allRels.slice(0,14).map(n=>{
            const pers=ter.tribeBudget&&ter.tribeBudget[n.id]?ter.tribeBudget[n.id].personality:"";
            return<div key={n.id} style={{display:"flex",alignItems:"center",gap:7,padding:"3px 4px",fontSize:11,cursor:"pointer",
              background:n.rel==="fight"?"rgba(154,48,48,0.10)":n.rel==="trade"?"rgba(160,112,40,0.10)":"transparent",
              borderRadius:2,marginBottom:1}}
              onClick={()=>{setSelectedTribe(n.id);ter._selectedTribe=n.id;draw(ter);}}>
              <span className="au-wax-seal au-small" style={{background:`rgb(${tribeRGB(n.id).join(',')})`}} />
              <span>#{n.id}</span>
              {pers&&<span className="au-fade" style={{fontSize:10,fontStyle:"italic"}}>{pers}</span>}
              <span className="au-fade" style={{fontSize:10}}>{n.size}t</span>
              {n.via==="maritime"&&<span style={{fontSize:10}}>⛵</span>}
              <div style={{flex:1}} />
              {relLabel[n.rel]&&<span style={{fontSize:10,fontWeight:600,color:relCol[n.rel]}}>{relLabel[n.rel]}</span>}
            </div>;})}
          </div>
        </div>;
      })()}

      {tribeTab==="trade"&&(()=>{
        if(!td||!td.partners)return<div className="au-fade" style={{textAlign:"center",fontStyle:"italic",padding:"12px 0"}}>no trade established</div>;
        const fmt=(x)=>x>=1?x.toFixed(1):x.toFixed(2);
        return<div>
          <div style={{display:"flex",gap:20,marginBottom:8}}>
            <div><div className="au-sc au-fade" style={{fontSize:10}}>Partners</div>
              <div className="au-heading" style={{fontSize:15}}>{td.partners}</div></div>
            {td.income>0.01&&<div><div className="au-sc au-fade" style={{fontSize:10}}>Income</div>
              <div className="au-heading au-gold-text" style={{fontSize:15}}>{fmt(td.income)}</div></div>}
          </div>
          {(td.foodImports>0||td.foodExports>0)&&<div className="au-sc au-fade" style={{fontSize:10,marginBottom:3}}>Food</div>}
          {td.foodImports>0&&<div className="au-verde-text" style={{fontSize:11}}>↓ Importing {fmt(td.foodImports)}</div>}
          {td.foodExports>0&&<div className="au-gold-text" style={{fontSize:11}}>↑ Exporting {fmt(td.foodExports)}</div>}
          {td.imports&&Object.keys(td.imports).length>0&&<>
            <div className="au-sc au-fade" style={{fontSize:10,marginTop:6,marginBottom:3}}>Imports</div>
            {Object.entries(td.imports).slice(0,5).map(([rk,v])=><div key={rk} style={{fontSize:11}}>{rk} <span className="au-fade">{fmt(v)}</span></div>)}
          </>}
        </div>;
      })()}
      </div>

      {/* Footer: nation list toggle */}
      <div className="au-rule" style={{marginTop:8}} />
      <div style={{cursor:"pointer",padding:"3px 0",display:"flex",alignItems:"center",gap:6}}
        onClick={()=>setShowTribeList(v=>!v)}>
        <span className="au-sc au-fade" style={{fontSize:10,flex:1}}>{showTribeList?"▾":"▸"} All nations</span>
      </div>
      {showTribeList&&(()=>{
        const tribes=[];
        for(let i=0;i<ter.tribeSizes.length;i++){if(ter.tribeSizes[i]<=0)continue;
          tribes.push({id:i,size:ter.tribeSizes[i],power:tribePower(ter,i),
            pop:ter.tribePopulation?ter.tribePopulation[i]:0,
            personality:ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i].personality:""});}
        tribes.sort((a,b)=>b.power-a.power);
        return<div style={{maxHeight:130,overflowY:"auto",marginTop:2}} className="au-scroll">
          {tribes.map(t=>{const isSel=t.id===sel;
            return<div key={t.id} onClick={()=>{setSelectedTribe(t.id);if(ter)ter._selectedTribe=t.id;draw(ter);}}
              style={{display:"flex",alignItems:"center",gap:6,padding:"2px 4px",cursor:"pointer",
                background:isSel?"rgba(120,80,40,0.18)":"transparent",borderRadius:2}}>
              <span className="au-wax-seal au-small" style={{background:`rgb(${tribeRGB(t.id).join(",")})`}} />
              <span style={{fontSize:11}}>#{t.id}</span>
              {t.personality&&<span className="au-fade" style={{fontSize:9,fontStyle:"italic"}}>{t.personality}</span>}
              <div style={{flex:1}} />
              <span className="au-fade" style={{fontSize:10}}>{t.size}t</span>
              <span className="au-fade" style={{fontSize:10}}>{fmtPop(t.pop)}</span>
              <span style={{fontSize:10,width:32,textAlign:"right"}} className="au-fade">{t.power.toFixed(0)}pw</span>
            </div>;})}
        </div>;
      })()}
    </div>
  );
})()}

{/* ─── Bottom-left collapsible legend ─── */}
{(viewMode==="terrain"||viewMode==="atlas"||viewMode==="tribes"||viewMode==="resources")&&
<div className="au-parchment" style={{position:"absolute",bottom:8,left:8,
  padding:keyOpen?"6px 10px 8px":"4px 10px",fontSize:11,maxWidth:200,zIndex:20}}>
<div style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,
  borderBottom:keyOpen?"1px solid rgba(58,38,20,0.18)":"none",paddingBottom:keyOpen?3:0,marginBottom:keyOpen?4:0}}
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
  {viewMode==="tribes"&&[["Stone",[50,45,35]],["Neolithic",[70,75,40]],["Farming",[80,100,45]],["Copper",[160,100,50]],
    ["Bronze",[140,110,50]],["Iron",[90,90,100]],["Empire",[120,50,50]],["Industrial",[80,70,90]]].map(([name,col])=>(
    <div key={name} className="au-key-row">
      <span className="au-key-swatch" style={{background:`rgb(${col[0]},${col[1]},${col[2]})`}} />
      <span>{name}</span>
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

</div>{/* end map area */}

</div>{/* end center column */}

{/* ══════════ RIGHT RAIL ══════════ */}
<aside className="au-parchment au-scroll" style={{
  width:128,minWidth:128,margin:"6px 6px 6px 3px",padding:"10px 0",
  display:"flex",flexDirection:"column",gap:1,overflowY:"auto"}}>

<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"0 14px 4px"}}>View</div>
{VIEW_MODES.map(([k,label])=>(
  <button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}}
    className={"au-rail-tab"+(viewMode===k?" au-active":"")}>{label}</button>
))}

<div className="au-rule" />
<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"6px 14px 4px"}}>Overlay</div>
<button onClick={()=>{setShowRivers(v=>!v);showRiversRef.current=!showRiversRef.current;}}
  className={"au-rail-tab"+(showRivers?" au-active":"")}>Rivers</button>
{showRivers&&<button onClick={()=>{setShowStreams(v=>!v);showStreamsRef.current=!showStreamsRef.current;}}
  className={"au-rail-tab"+(showStreams?" au-active":"")} style={{paddingLeft:22,fontSize:11}}>· Streams</button>}
<button onClick={()=>{setShowLakes(v=>!v);showLakesRef.current=!showLakesRef.current;}}
  className={"au-rail-tab"+(showLakes?" au-active":"")}>Lakes</button>
{world&&world.pixPlate&&<button onClick={()=>{setShowPlates(v=>!v);showPlatesRef.current=!showPlatesRef.current;}}
  className={"au-rail-tab"+(showPlates?" au-active":"")}>Plates</button>}
<button onClick={()=>setShowGlobe(!showGlobe)}
  className={"au-rail-tab"+(showGlobe?" au-active":"")}>Globe</button>
{viewMode==="tribes"&&<button onClick={()=>setShowPower(v=>!v)}
  className={"au-rail-tab"+(showPower?" au-active":"")}>Power</button>}

{(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&<>
<div className="au-rule" />
<div className="au-heading au-sc au-fade" style={{fontSize:10,padding:"6px 14px 4px"}}>Tools</div>
<button onClick={()=>setRightPanel(rightPanel==="params"?"":"params")}
  className={"au-rail-tab"+(rightPanel==="params"?" au-active":"")}>Params</button>
{preset==="tectonic"&&<button onClick={()=>setShowTuning(true)}
  className="au-rail-tab">Tune</button>}
</>}
</aside>

{/* ══════════ PARAMS DRAWER ══════════ */}
{rightPanel==="params"&&(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&
<aside className="au-parchment au-scroll" style={{
  position:"absolute",right:142,top:6,bottom:6,width:300,
  padding:"10px 12px",overflowY:"auto",zIndex:30}}>
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

{/* ══════════ TUNING MODAL ══════════ */}
{showTuning&&<TuningPanel noiseFns={{initNoise,fbm,ridged,noise2D,worley}} seed={seed}
  params={{..._tecParams}}
  onParamsChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  onClose={()=>setShowTuning(false)} />}

</div>);}
