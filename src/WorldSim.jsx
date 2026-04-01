import { useState, useEffect, useRef, useCallback } from "react";
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "./earthData.js";
import { generateTectonicWorld } from "./tectonicGen.js";
import { solveWind } from "./windSolver.js";
import { solveMoisture } from "./moistureSolver.js";
import { isRealWindAvailable, fillRealWind } from "./realWindData.js";
import GlobeView from "./GlobeView.jsx";
import TuningPanel, { ParamEditor, renderPreview } from "./TuningPanel.jsx";
import { PARAMS, loadPresets, savePreset, deletePreset } from "./paramDefs.js";
import { parseAzgaarJSON, rasterizeAzgaar, rasterizeHeightmap, loadImageFile } from "./mapImport.js";
import { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } from "./resourceGen.js";
import { computeRivers, riverName, RIVER_NAMES, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } from "./riverGen.js";

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
const{tw,th,owner,deposits,tCoast,tribeStrength}=ter;
const n=ter.tribeCenters.length;
const res=[];for(let i=0;i<n;i++)res.push({copper:0,tin:0,iron:0,coal:0,stone:0,timber:0,salt:0,horses:0,precious:0,oil:0,gems:0,coastTiles:0,riverTiles:0,resourceTypes:0});
for(let ti=0;ti<tw*th;ti++){const ow=owner[ti];if(ow<0)continue;const r=res[ow];
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
// Count distinct resource types per tribe
for(let i=0;i<n;i++){const r=res[i];let ct=0;
if(r.copper>0.5)ct++;if(r.tin>0.5)ct++;if(r.iron>0.5)ct++;if(r.coal>0.5)ct++;
if(r.stone>0.5)ct++;if(r.timber>0.5)ct++;if(r.salt>0.5)ct++;if(r.horses>0.5)ct++;
if(r.precious>0.5)ct++;if(r.oil>0.5)ct++;if(r.gems>0.5)ct++;r.resourceTypes=ct;}
return res;}

// Compute border contact: for each tribe, count tiles touching each neighbor tribe
function computeBorderContact(ter){
const{tw,th,owner,tribeSizes}=ter;const n=ter.tribeCenters.length;
// Map: tribeId → {neighborId: contactCount}
const contacts=[];for(let i=0;i<n;i++)contacts.push({});
for(let ti=0;ti<tw*th;ti++){const ow=owner[ti];if(ow<0)continue;
const tx=ti%tw,ty=(ti-tx)/tw;
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;
const no=owner[ny*tw+nx];if(no>=0&&no!==ow){contacts[ow][no]=(contacts[ow][no]||0)+1;}}}
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
function stepKnowledge(ter){
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
}

// Population step: logistic growth per tribe
function stepPopulation(ter){
const know=ter.tribeKnowledge;const pop=ter.tribePopulation;
const{tribeSizes,tribeStrength}=ter;
for(let i=0;i<pop.length;i++){if(tribeSizes[i]<=0){pop[i]=0;continue;}
// ── Population capacity: scales with era, matching real history ──
// Real world: ~14M at 3000BC, ~300M at 1AD, ~450M at 1500, ~1B at 1800, ~8B at 2024
// Capacity per tile scales with knowledge era, not just agriculture:
//   Stone/Copper age: ~5k per fertile tile (subsistence farming, low density)
//   Bronze/Iron age: ~15k (irrigation, crop rotation, cities)
//   Classical/Medieval: ~30k (advanced agriculture, infrastructure)
//   Early Modern: ~50k (new world crops, better farming)
//   Industrial+: ~200k+ (mechanized farming, medicine, sanitation)
const ag=know[i].agriculture,mt=know[i].metallurgy,cn=know[i].construction,og=know[i].organization;
// Era multiplier: slow climb until industrial revolution, then explosion
// eraMult: people (in thousands) supportable per unit of fertility
// Each tile is ~42km wide (~1750 km²). fert=0.3 tile at eraMult=40:
// capacity per tile = 0.3*40 = 12k people = ~7 ppl/km² (bronze age density)
// At eraMult=150 (classical): 0.3*150 = 45k = ~26 ppl/km² (Roman density)
// At eraMult=500+ (industrial): 0.3*500 = 150k = ~86 ppl/km²
// Calibrated to Earth: 235 km² per tile, fert 0.3 avg
// Bronze: ~0.7k/tile, Iron: ~1.3k, Classical: ~2.3k, Colonial: ~4.8k
// eraMult in thousands per unit strength. Scale factor 10 converts to meaningful pop numbers.
// Bronze: 0.5*10=5k/str, Iron: 0.8*10=8k, Classical: 1.1*10=11k
let eraMult=(0.2+ag*0.4+mt*0.25+cn*0.15+og*0.1)*10;
// Industrial revolution: when metallurgy+construction both high, population explodes
// (mechanized farming, medicine, sanitation, urbanization)
// Industrial bonus: needs BOTH high metallurgy AND high construction
// mt=0.85,cn=0.8: (0.85-0.75)*(0.8-0.65)*1800 = 0.10*0.15*1800 = 27 → total ~28
// mt=0.90,cn=0.90: (0.90-0.75)*(0.9-0.65)*1800 = 0.15*0.25*1800 = 67.5 → total ~69
const industrialBonus=(Math.max(0,mt-0.75))*(Math.max(0,cn-0.60))*2500;
eraMult+=industrialBonus;
// Resources that directly support population: salt preserves food, coal/oil power industry
const rv=resourceValues(know[i]);const rr=ter._resCache&&ter._resCache[i]?ter._resCache[i]:null;
if(rr){const resPop=rv.salt*(rr.salt||0)*0.02+rv.coal*(rr.coal||0)*0.05+rv.oil*(rr.oil||0)*0.08;
eraMult*=(1+Math.min(0.5,resPop));}// up to 50% pop boost from resources
// Food imports increase carrying capacity — Japan can import food for huge population
const foodImport=ter.tradeData&&ter.tradeData[i]?ter.tradeData[i].foodImports:0;
const capacity=(tribeStrength[i]+foodImport)*eraMult;
if(capacity<=0){pop[i]=Math.max(0,pop[i]*0.95);continue;}
const ratio=pop[i]/capacity;
// Growth rate: very slow pre-industrial (~0.1%/step), faster post-industrial
// IRL pre-1800 growth ≈ 0.04%/year. At 12yr/step early, that's ~0.5%/step.
// Post-industrial: ~1-2%/year = much faster.
const industrialFactor=Math.max(0,mt-0.6)*3+Math.max(0,cn-0.5)*2;// 0 until ~iron age, then ramps
const groB=ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i].growth:0.25;
const baseGrowth=(0.001+ag*0.001+industrialFactor*0.04)*(0.5+groB*2.0);// pre-industrial ~0.2%, industrial ~5%
// Logistic: growth slows as pop approaches capacity. Overshoots slightly for expansion pressure.
// Industrial civs can overshoot more (medicine, sanitation extend capacity dynamically)
const maxRatio=1.05+industrialFactor*0.15;// pre-industrial: 1.05, industrial: ~1.25
const growthRate=ratio<maxRatio?baseGrowth*(1-ratio/(maxRatio*1.1)):0;
pop[i]=Math.max(1,pop[i]+pop[i]*growthRate);
// Famine above 120%
if(ratio>1.2)pop[i]=Math.max(1,pop[i]*(0.97-Math.min(0.05,(ratio-1.2)*0.15)));
}}

// ── Background population: thin hunter-gatherer layer across all unowned habitable land ──
// Grows slowly. When local density crosses a threshold, a new tribe crystallizes.
// This means every continent gets tribes independently — agriculture can be independently
// invented in the Fertile Crescent, China, Mesoamerica, Andes, New Guinea, etc.
function stepBackgroundPop(ter){
const{tw,th,tElev,tTemp,tFert,tDiff,tCoast,owner,bgPop,tribeSizes}=ter;
if(!bgPop)return;
ter._dbgBgCalls=(ter._dbgBgCalls||0)+1;// count how many times this function runs
// Grow bgPop on ALL habitable tiles — including owned ones.
// bgPop represents general population density of the land, independent of political control.
// Owned tiles grow bgPop too (the farmers are there regardless of who rules them).
// Only UNOWNED tiles with high bgPop can crystallize into new tribes.
for(let ti=0;ti<tw*th;ti++){
if(tElev[ti]<=0||tTemp[ti]<0.05)continue;
const fert=tFert[ti];
// Owned tiles get capacity boost (organized farming is more productive)
const orgBoost=owner[ti]>=0?2.0:1.0;// organized land supports much more
// Cap must be above crystal threshold (0.20) for moderate land so new tribes can form there
const cap=fert*3.0*(1-tDiff[ti]*0.5)*orgBoost;// LINEAR not quadratic: fert 0.5→1.5, fert 0.3→0.9, fert 0.1→0.3 (unowned)
if(cap<=0.001)continue;
const ratio=bgPop[ti]/cap;
bgPop[ti]=Math.max(0,bgPop[ti]+bgPop[ti]*0.02*(1-ratio));// 2% growth
// Diffusion to adjacent tiles (including into owned territory)
if(bgPop[ti]>cap*0.6){const tx2=ti%tw,ty2=(ti-tx2)/tw;
for(const[dx,dy]of DIRS){const nx=((tx2+dx)%tw+tw)%tw,ny=ty2+dy;if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(tElev[ni]<=0)continue;
if(bgPop[ni]<bgPop[ti]*0.3){
const flow=bgPop[ti]*0.005*(1-tDiff[ni]);
bgPop[ti]-=flow;bgPop[ni]+=Math.max(0,flow);}}}}
// Debug: track max bgPop for diagnostics
let maxBg=0,bgAboveThresh=0;for(let ti=0;ti<tw*th;ti++){if(bgPop[ti]>maxBg)maxBg=bgPop[ti];if(owner[ti]<0&&bgPop[ti]>0.20)bgAboveThresh++;}
ter._dbgMaxBgPop=maxBg;ter._dbgBgAboveThresh=bgAboveThresh;
// ── Tribe crystallization ──
if(ter.stepCount%16!==0)return;// check every 16 steps
let alive=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)alive++;
if(alive>=80)return;
// Much higher bar: need real fertility concentration, not just any habitable tile
const CRYSTAL_THRESHOLD=0.12;// low enough for moderate fertility land to crystallize
const MIN_SPACING=Math.round(tw*0.02);// very close spacing allowed — tribes form in gaps between empires
// Find multiple crystallization candidates — spawn up to 3 per check
const crystalCandidates=[];
for(let ti=0;ti<tw*th;ti++){
if(bgPop[ti]<CRYSTAL_THRESHOLD)continue;
// Fertility requirement decreases over time as agriculture tech matures globally
const fertReq=Math.max(0.08,0.25-ter.stepCount*0.0003);// 0.25 at start, 0.10 by step 500
if(tFert[ti]<fertReq)continue;
const tx=ti%tw,ty=(ti-tx)/tw;
let tooClose=false;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0)continue;
for(const c of ter.tribeCenters[t]){const d=tDistW(tx,ty,c.x,c.y,tw);
if(d<MIN_SPACING){tooClose=true;break;}}if(tooClose)break;}
if(tooClose)continue;
// Don't spawn ON owned tiles, but allow spawning near them (removes the 4-tile buffer)
if(owner[ti]>=0)continue;
// Score by local population density + fertility (rivers/coasts naturally win)
let localPop=0,localFert=0;
for(let dy=-4;dy<=4;dy++){const ny=ty+dy;if(ny<0||ny>=th)continue;
for(let dx=-4;dx<=4;dx++){const nx=((tx+dx)%tw+tw)%tw;
const ni=ny*tw+nx;if(tElev[ni]>0){localPop+=bgPop[ni];localFert+=tFert[ni];}}}// count ALL tiles, not just unowned
if(localPop<1.0)continue;// lowered threshold
// Score: population × fertility + era-valuable resources at this site
// Compute regional knowledge average for resource valuation
let regionKnow=null;let rkCount=0;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0)continue;
for(const c of ter.tribeCenters[t]){if(tDistW(tx,ty,c.x,c.y,tw)<30){
if(!regionKnow)regionKnow={agriculture:0,metallurgy:0,navigation:0,construction:0,organization:0,trade:0};
const nk=ter.tribeKnowledge[t];for(const dom of KNOW_DOMAINS)regionKnow[dom]+=nk[dom];rkCount++;break;}}}
if(regionKnow&&rkCount>0)for(const dom of KNOW_DOMAINS)regionKnow[dom]/=rkCount;
const crRv=resourceValues(regionKnow);
// Resource value at this tile: valuable resources attract settlement
let resScore=0;if(ter.deposits){for(const rk of RES_KEYS){
const dep=ter.deposits[rk];if(dep&&dep[ti]>0.1)resScore+=crRv[rk]*dep[ti];}}
// Proximity to existing civilization affects KNOWLEDGE INHERITANCE, not crystallization.
// China, Egypt, Indus, Mesoamerica all developed independently — the best river valleys
// crystallize based on their OWN quality, not proximity to other civs.
// However, nearby civs DO make it slightly easier (cultural stimulation, trade contact).
let nearestCivDist=Infinity;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0)continue;
for(const c of ter.tribeCenters[t]){const d=tDistW(tx,ty,c.x,c.y,tw);
if(d<nearestCivDist)nearestCivDist=d;}}
// Mild proximity bonus: nearby civs give +50% score boost, not a hard gate.
// Distant locations still crystallize if their valley quality is high enough.
const proxBonus=nearestCivDist<80?1.5:nearestCivDist<200?1.2:1.0;
const score=(localPop*localFert*tFert[ti]+resScore*3)*proxBonus;
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
let nearKnow=null;let nearCount=0;
for(let t=0;t<ter.tribeCenters.length;t++){if(tribeSizes[t]<=0)continue;
for(const c of ter.tribeCenters[t]){const d=tDistW(tx,ty,c.x,c.y,tw);
if(d<25){// within cultural influence range
if(!nearKnow)nearKnow={agriculture:0,metallurgy:0,navigation:0,construction:0,organization:0,trade:0};
const nk=ter.tribeKnowledge[t];
for(const dom of KNOW_DOMAINS)nearKnow[dom]+=nk[dom];
nearCount++;break;}}}// only count each tribe once
const nid=newTribe(ter,tx,ty,-1);
// Override the zero knowledge with inherited knowledge from neighbors
const newK=ter.tribeKnowledge[nid];
if(nearKnow&&nearCount>0){// inherit 60% of neighbor average
for(const dom of KNOW_DOMAINS)newK[dom]=Math.min(0.9,(nearKnow[dom]/nearCount)*0.6);}
// Baseline: all new tribes get minimum agriculture (farming exists everywhere by 3000 BC)
// + slight metallurgy if near an existing bronze-age civ
newK.agriculture=Math.max(newK.agriculture,0.25+Math.random()*0.15);// 0.25-0.40 farming baseline
// Flood-fill from best tile: claim all connected tiles with significant bgPop
// Claim tiles: first unowned, then secede from neighbors if needed
// A new tribe forming inside an empire represents rebellion/secession
const visited=new Uint8Array(tw*th);
const stack=[bestTi];visited[bestTi]=1;
let claimed=0;const maxClaim=12;
while(stack.length>0&&claimed<maxClaim){
const ci=stack.pop();
if(tElev[ci]<=0)continue;
// Can claim unowned tiles freely, or SECEDE from another tribe's territory
// (represents local population organizing independently)
if(owner[ci]>=0&&owner[ci]!==nid){
// Only secede if we haven't claimed enough tiles yet (need minimum viable size)
if(claimed>=6)continue;// already big enough, stop taking from others
}
claimTile(ter,ci,nid);
if(!ter.frontier[ci]){ter.frontier[ci]=1;ter.frontierList.push(ci);}
claimed++;
const cx=ci%tw,cy2=(ci-cx)/tw;
for(const[ddx,ddy]of DIRS){const nnx=((cx+ddx)%tw+tw)%tw,nny=cy2+ddy;
if(nny<0||nny>=th)continue;const nni=nny*tw+nnx;
if(visited[nni])continue;visited[nni]=1;
if(tElev[nni]>0&&bgPop[nni]>=0.05){stack.push(nni);}}}
// Clear remaining bgPop in wider area (people absorbed or displaced)
for(let dy=-6;dy<=6;dy++){const ny=ty+dy;if(ny<0||ny>=th)continue;
for(let dx=-6;dx<=6;dx++){const nx=((tx+dx)%tw+tw)%tw;
bgPop[ny*tw+nx]*=0.3;}}// reduce, don't zero (some people remain)
alive++;if(alive>=80)break;
}}// end if(random) + for cc (candidates loop)
}// end stepBackgroundPop

// Port computation: find best coastal settlement tiles for a tribe
function computeTribePorts(ter,tribeId){
const{tw,th,owner,tFert,tCoast,tenure,rivers}=ter;
const ports=[];const orgLevel=ter.tribeKnowledge[tribeId]?ter.tribeKnowledge[tribeId].organization:0;
const maxPorts=Math.max(2,Math.floor(3+orgLevel*7));// 3-10 ports based on organization
for(let ti=0;ti<tw*th;ti++){if(owner[ti]!==tribeId||!tCoast[ti])continue;
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
tribeKnowledge.push(k);tribePopulation.push(tFert[ti]*5);
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
// bgPop persists on owned tiles — don't zero it. It represents general population density.
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,deposits,rivers,owner,tenure,tribeCenters,tribeSizes,tribeStrength,
tribeKnowledge,tribePopulation,tribeKnownCoasts,tribePorts:tribePorts2,tribeBudget:tribeBudgets,bgPop,
frontier,frontierList,landCount:lc,settled:tribeSizes.length,tribes:tribeSizes.length,origin:{x:tw/2,y:th/2},stepCount:0};}

function tDistW(x1,y1,x2,y2,tw){let dx=Math.abs(x1-x2);if(dx>tw/2)dx=tw-dx;return Math.sqrt(dx*dx+(y1-y2)*(y1-y2));}
// Precomputed exp(-d*d/280) lookup table — eliminates Math.exp in hot loops
const EXP_LUT_SIZE=80;const EXP_LUT=new Float32Array(EXP_LUT_SIZE+1);
for(let d=0;d<=EXP_LUT_SIZE;d++)EXP_LUT[d]=Math.exp(-d*d/280);
function expFalloff(d){const di=d<0?0:d>EXP_LUT_SIZE?EXP_LUT_SIZE:d;const lo=di|0;if(lo>=EXP_LUT_SIZE)return EXP_LUT[EXP_LUT_SIZE];const hi=lo+1;const f=di-lo;return EXP_LUT[lo]*(1-f)+EXP_LUT[hi]*f;}
// Distance from (x,y) to nearest center of a tribe; also returns the capital (index 0) distance
function nearestCenterDist(centers,x,y,tw){if(!centers||centers.length===0)return{min:0,cap:0};
let mn=Infinity;const cap=tDistW(x,y,centers[0].x,centers[0].y,tw);
for(const c of centers){mn=Math.min(mn,tDistW(x,y,c.x,c.y,tw));}return{min:mn,cap};}
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
// Local power projection at a border tile: nearest center projects its share of population
function localPower(ter,tribeId,tx,ty){
const pop=ter.tribeStrength[tribeId],sz=ter.tribeSizes[tribeId];if(sz<=0)return 0;
const centers=ter.tribeCenters[tribeId];if(!centers||centers.length===0)return pop*0.05;
// Sum contributions from ALL centers (not just nearest) — each radiates power
let total=0;
for(const c of centers){const d=tDistW(tx,ty,c.x,c.y,ter.tw);
// Gaussian falloff: halves at ~14 tiles, 10% at ~24, negligible beyond ~35
const contribution=expFalloff(d)*c.prestige;
total+=contribution;}
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
ter.tribes=id+1;return id;}
function claimTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert,tenure}=ter;const ow=owner[ti];
if(ow>=0){const owSzBefore=tribeSizes[ow];tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];
// Conquest: most population stays (they become subjects), small loss from war
if(ter.tribePopulation&&owSzBefore>0){
const tileShare=ter.tribePopulation[ow]/owSzBefore;
const warLoss=tileShare*0.15;// 15% die or flee from the fighting
ter.tribePopulation[ow]=Math.max(0,ter.tribePopulation[ow]-tileShare);// loser loses tile's pop
ter.tribePopulation[nw]+=tileShare-warLoss;// winner absorbs 85% of the population
}}else{ter.settled++;}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];tenure[ti]=1;
// Absorb background population into the tribe
if(ter.bgPop&&ter.bgPop[ti]>0){
// Absorb background population. Scale depends on the claiming tribe's tech level —
// advanced civs organize the local population more effectively.
// Absorb bgPop using the same eraMult as stepPopulation (consistent capacity)
const ck=ter.tribeKnowledge&&ter.tribeKnowledge[nw]?ter.tribeKnowledge[nw]:null;
const claimEra=ck?0.2+ck.agriculture*0.4+ck.metallurgy*0.25+ck.construction*0.15+ck.organization*0.1:0.2;
if(ter.tribePopulation)ter.tribePopulation[nw]+=ter.bgPop[ti]*claimEra*10;
// Don't zero bgPop — it persists and keeps growing independently of ownership
}}
// Transfer tile without resetting tenure (for splits/fragmentation — population stays, allegiance changes)
function transferTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert}=ter;const ow=owner[ti];
if(ow>=0){const owSzBefore=tribeSizes[ow];tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];
// Transfer proportional population
if(ter.tribePopulation&&owSzBefore>0){const popShare=ter.tribePopulation[ow]/owSzBefore;
ter.tribePopulation[ow]=Math.max(0,ter.tribePopulation[ow]-popShare);
ter.tribePopulation[nw]=(ter.tribePopulation[nw]||0)+popShare;}}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];}

function stepTerritory(ter,w){
const sl=0,wet=0.7;const{tw,th,tElev,tTemp,tCoast,tDiff,tFert,owner,tribeCenters,tribeSizes,tribeStrength}=ter;ter.stepCount++;
// ── Knowledge & population step (every 8 ticks) ──
if(ter.stepCount%8===0&&ter.tribeKnowledge){stepTrade(ter);stepBudget(ter);stepKnowledge(ter);stepPopulation(ter);stepBackgroundPop(ter);
// Recompute ports periodically
for(let i=0;i<tribeCenters.length;i++){if(tribeSizes[i]>0&&ter.tribeKnowledge[i].navigation>0.05)ter.tribePorts[i]=computeTribePorts(ter,i);}}
// ── Expansion into empty land (directional, pressure-driven) ──
const nf=new Uint8Array(tw*th);const nfl=[];
for(let fj=0;fj<ter.frontierList.length;fj++){const fi=ter.frontierList[fj];if(tElev[fi]<=sl)continue;const ty=Math.floor(fi/tw),tx=fi%tw,ow=owner[fi];let room=false;const pDiff=tDiff[fi];
const owSz=tribeSizes[ow],owDens=owSz>0?tribeStrength[ow]/owSz:0;
const owKnow=ter.tribeKnowledge&&ter.tribeKnowledge[ow]?ter.tribeKnowledge[ow]:null;
const agLevel=owKnow?owKnow.agriculture:0;
const agMult=1+agLevel*2.5;
const owPop=ter.tribePopulation?ter.tribePopulation[ow]:tribeStrength[ow]*10;
// Match stepPopulation capacity formula
const owOrg=owKnow?owKnow.organization:0,owMt=owKnow?owKnow.metallurgy:0,owCn=owKnow?owKnow.construction:0;
let owEraMult=(0.2+agLevel*0.4+owMt*0.25+owCn*0.15+owOrg*0.1)*10;
owEraMult+=(Math.max(0,owMt-0.75))*(Math.max(0,owCn-0.60))*2500;
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
const candidates=[];
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
if(owKnow&&ter.deposits){const owRv=resourceValues(owKnow);
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
candidates.push({ni,nx,ny:ny2,chance,score,diff,distMin});}
// Sort by score — best tiles first. Each subsequent candidate gets reduced chance
// so growth strongly follows fertile corridors, not uniform bubbles.
candidates.sort((a,b)=>b.score-a.score);
let claimedThisTile=0;
for(let ci2=0;ci2<candidates.length;ci2++){const cand=candidates[ci2];const{ni,nx,ny:ny2,chance,diff,distMin}=cand;
// Each subsequent candidate is 20% as likely (very steep — usually only best gets claimed)
const rankPenalty=Math.pow(0.2,claimedThisTile);
if(Math.random()<chance*rankPenalty){let nw=ow;claimedThisTile++;
// NO expansion splits. New civs come ONLY from:
// 1. Background population crystallization (stepBackgroundPop)
// 2. Center challenge splits (large empires with low cohesion)
// 3. Disconnected component fragmentation (structural)
// 4. Overseas colony splits (maritime voyages)
if(distMin>12&&agLevel>0.15&&tribeCenters[ow]&&tribeCenters[ow].length<12){
// Geographic center scoring: rivers, harbors, passes, resources attract settlements
let centerScore=tFert[ni]*2;
if(ter.rivers&&ter.rivers.riverMag[ni]>=3)centerScore+=0.6;// river confluence / major river
if(ter.rivers&&ter.rivers.riverMag[ni]>=2)centerScore+=0.3;
if(tCoast[ni])centerScore+=0.4;// natural harbor
if(tDiff[ni]>0.4&&tFert[ni]>0.2)centerScore+=0.3;// mountain pass exit
if(ter.deposits&&owKnow){const cRv=resourceValues(owKnow);let depScore=0;
for(const rk of RES_KEYS){const dep=ter.deposits[rk];if(dep&&dep[ni]>0.1)depScore+=cRv[rk]*dep[ni]*0.3;}
centerScore+=depScore;}// resource concentration
if(centerScore>0.5)tribeCenters[ow].push({x:nx,y:ny2,prestige:0.3,founded:ter.stepCount});}
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
// Establish beachhead center if far from home
if(tribeCenters[st].length<10){const{min:vD}=nearestCenterDist(tribeCenters[st],tgtX2,tgtY2,tw);
if(vD>25)tribeCenters[st].push({x:tgtX2,y:tgtY2,prestige:0.3,founded:ter.stepCount});}
}}}
if(owner[targetIdx]<0&&tFert[targetIdx]>0.03){
let nw3=st;const{min:vDist2}=nearestCenterDist(tribeCenters[st],tgtX2,tgtY2,tw);
if(vDist2>30&&Math.random()<0.3-stK.organization*0.3)nw3=newTribe(ter,tgtX2,tgtY2,st);
else if(vDist2>20&&tribeCenters[st].length<10)
tribeCenters[st].push({x:tgtX,y:tgtY,prestige:0.3,founded:ter.stepCount});
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
// Find worst tile (lowest fertility, highest difficulty)
let worstTi=-1,worstScore=Infinity;
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const sc=tFert[i]-tDiff[i]*0.5;if(sc<worstScore){worstScore=sc;worstTi=i;}}
if(worstTi>=0&&tribeSizes[st]>3){
// Abandon worst tile
owner[worstTi]=-1;tribeSizes[st]--;tribeStrength[st]-=tFert[worstTi];ter.tenure[worstTi]=0;ter.settled--;}}}
ter.frontier=nf;ter.frontierList=nfl;
// ── Age tenure + occupation cost: newly conquered tiles drain strength ──
if(ter.stepCount%4===0){const{tenure}=ter;for(let i=0;i<tw*th;i++){if(owner[i]<0)continue;
if(tenure[i]<200)tenure[i]++;
// Occupation cost: tiles with tenure < 20 drain tribe strength (garrisons, resistance)
if(tenure[i]<15){const drain=tFert[i]*0.015*(1-tenure[i]/15);// decays as tenure grows
tribeStrength[owner[i]]=Math.max(0.1,tribeStrength[owner[i]]-drain);}}}
// ── Border conflict: local power projection determines tile flips ──
if(ter.stepCount%4===0){const flips=[];const{tenure}=ter;
for(let i=0;i<tw*th;i++){const ow=owner[i];if(ow<0||tElev[i]<=sl||tribeSizes[ow]<1)continue;
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
// ── Center dynamics: prestige growth, validation, capital challenge ──
if(ter.stepCount%32===0){for(let st=0;st<tribeSizes.length;st++){
const centers=tribeCenters[st];if(!centers||centers.length<=0||tribeSizes[st]<=0)continue;
// Grow capital prestige (institutional inertia), decay secondary prestige slightly
centers[0].prestige=Math.min(3.0,centers[0].prestige+0.05);
for(let c=1;c<centers.length;c++)centers[c].prestige=Math.min(2.0,centers[c].prestige+0.02);
// Validate centers: remove those no longer in tribe territory or no longer fertile
for(let c=centers.length-1;c>=0;c--){const ci=centers[c].y*tw+centers[c].x;
if(owner[ci]!==st||tFert[ci]<0.1){if(c===0&&centers.length>1){centers.shift();centers[0].prestige=Math.max(centers[0].prestige,1.5);}
else if(c>0)centers.splice(c,1);}}
if(centers.length<2||tribeSizes[st]<40)continue;// need substantial polity for center challenges
// Compare each secondary center to capital
const R=8;const capPow=centerPower(ter,st,centers[0].x,centers[0].y,R)*centers[0].prestige;
for(let c=1;c<centers.length;c++){
const secPow=centerPower(ter,st,centers[c].x,centers[c].y,R);
if(secPow<=capPow*1.5)continue;// secondary must significantly exceed capital
// Cohesion check: sample terrain difficulty along straight line between centers
const dx=centers[c].x-centers[0].x,dy=centers[c].y-centers[0].y;
const steps=Math.max(4,Math.floor(Math.sqrt(dx*dx+dy*dy)/2));
let diffSum=0;for(let s=0;s<=steps;s++){const sx=((Math.round(centers[0].x+dx*s/steps)%tw)+tw)%tw;
const sy=Math.round(centers[0].y+dy*s/steps);if(sy>=0&&sy<th)diffSum+=tDiff[sy*tw+sx];}
const avgDiff=diffSum/steps;const dist=tDistW(centers[0].x,centers[0].y,centers[c].x,centers[c].y,tw);
// Cohesion: mountains STRONGLY fragment. Flat terrain holds together.
// Europe (avgDiff~0.3-0.5) fragments easily. Russian steppe (avgDiff~0.05) holds.
// Organization knowledge helps maintain cohesion across difficult terrain.
const orgCoh=ter.tribeKnowledge[st]?ter.tribeKnowledge[st].organization:0;
const cohesion=1/(1+dist*0.05+avgDiff*avgDiff*15-orgCoh*0.3);
if(cohesion>0.4){// High cohesion → capital relocates peacefully
const old=centers[0];centers[0]=centers[c];centers[0].prestige=Math.max(old.prestige,1.0);
centers.splice(c,1);centers.push({x:old.x,y:old.y,prestige:old.prestige*0.5,founded:old.founded});
}else{// Low cohesion → split: secondary center becomes a new tribe (if below cap)
let aliveT=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)aliveT++;
if(aliveT>=80){break;}// tribe cap reached
const sc=centers.splice(c,1)[0];const sid=newTribe(ter,sc.x,sc.y,st);
// Transfer tiles closer to the breakaway center than to any remaining center
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;const iy=Math.floor(i/tw),ix=i%tw;
const dSec=tDistW(ix,iy,sc.x,sc.y,tw);
let dNearest=Infinity;for(const rc of centers)dNearest=Math.min(dNearest,tDistW(ix,iy,rc.x,rc.y,tw));
if(dSec<dNearest)transferTile(ter,i,sid);}}
break;// only one challenge per step per tribe
}}}
// ── Terrain-based fragmentation: large tribes in rough terrain tend to split ──
if(ter.stepCount%32===0){
for(let st=0;st<tribeSizes.length;st++){
if(tribeSizes[st]<=40)continue;
const stK=ter.tribeKnowledge[st];const stOrg=stK?stK.organization:0;
let totalDiff2=0,tileCount2=0;
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;totalDiff2+=tDiff[i];tileCount2++;}
if(tileCount2<20)continue;
const avgTribeDiff=totalDiff2/tileCount2;
// Split pressure: high for mountainous (Europe), near-zero for flat (Russia)
const splitPressure=avgTribeDiff*avgTribeDiff*0.3-stOrg*0.05;
if(splitPressure>0&&Math.random()<splitPressure){
const cap=tribeCenters[st][0];
let worstTi=-1,worstScore=-1;
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const ix=i%tw,iy=(i-ix)/tw;
const score=tDistW(ix,iy,cap.x,cap.y,tw)*tDiff[i];
if(score>worstScore){worstScore=score;worstTi=i;}}
if(worstTi>=0){const wx=worstTi%tw,wy=(worstTi-wx)/tw;
let aliveT=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)aliveT++;
if(aliveT<80){const sid=newTribe(ter,wx,wy,st);
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;
const ix2=i%tw,iy2=(i-ix2)/tw;
if(tDistW(ix2,iy2,wx,wy,tw)<tDistW(ix2,iy2,cap.x,cap.y,tw))transferTile(ter,i,sid);}}}}}}
// ── Fragmentation: split disconnected tribe components (largest keeps original ID/color) ──
if(ter.stepCount%16===0){if(!ter._fragMark)ter._fragMark=new Int32Array(tw*th);const mark=ter._fragMark;let gen=ter._fragGen||0;
for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=1)continue;
const baseGen=gen;const comps=[];
for(let i=0;i<tw*th;i++){if(owner[i]!==st||mark[i]>baseGen)continue;gen++;
const stack=[i];mark[i]=gen;const comp=[];
while(stack.length>0){const ci=stack.pop();comp.push(ci);const cy=Math.floor(ci/tw),cx=ci%tw;
for(const[dx,dy]of DIRS){const nx2=((cx+dx)%tw+tw)%tw,ny2=cy+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
if(mark[ni]<=baseGen&&owner[ni]===st){mark[ni]=gen;stack.push(ni);}}}
comps.push(comp);}
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
let bn=-1,bs2=0;for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;const ty2=Math.floor(i/tw),tx2=i%tw;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===st||tElev[ni]<=sl)continue;if(tribeSizes[no]>bs2){bs2=tribeSizes[no];bn=no;}}}
if(bn>=0&&tribeSizes[bn]>tribeSizes[st]*3){for(let i=0;i<tw*th;i++)if(owner[i]===st)claimTile(ter,i,bn);}}}
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

// ── SINGLE CANVAS: terrain + overlay composited together ──
export default function WorldSim(){
const canvasRef=useRef(null);const[seed,setSeed]=useState(8817);const[world,setWorld]=useState(null);
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
const activeResRef=useRef(null);activeResRef.current=activeRes;
const extraCanvasRefs=useRef([]);
const extraWorldsRef=useRef([]);
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(5),viewRef=useRef("terrain");
const oceanLevelRef=useRef(0.78);const depthFromSeaRef=useRef(false);const depthCeilRef=useRef(1.0);const showPlatesRef=useRef(false);const showRiversRef=useRef(false);const showStreamsRef=useRef(false);const showLakesRef=useRef(false);const showGlobeRef=useRef(false);
const presetRef=useRef("tectonic");const fileRef=useRef(null);const importedWorldRef=useRef(null);
const useRealWindRef=useRef(false);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
// Reuse ImageData between frames to avoid 7.3MB allocation per draw
const imgRef=useRef(null);
// Wind particle animation state
const windParticlesRef=useRef(null);
const windAnimRef=useRef(null);
const W=1920,H=960,CW=CW_FLAT;
const generate=useCallback((s,ol)=>{
let w;
if(presetRef.current==="import"&&importedWorldRef.current){w=importedWorldRef.current;importedWorldRef.current=null;}
else{w=generateWorld(W,H,s,presetRef.current,ol!==undefined?ol:oceanLevelRef.current,true,useRealWindRef.current);}
setWorld(w);worldRef.current=w;const t=createTerritory(w);terRef.current=t;
setCoverage(0);setTribeCount(t.tribes);setPlaying(false);playRef.current=false;
terrainCache.current=null;imgRef.current=null;},[]);
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

// Composite render: terrain + tribe overlay into single canvas
const draw=useCallback((ter)=>{
if(!ter)return;const w=worldRef.current;if(!w)return;
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
if(showPlatesRef.current&&w.pixPlate){
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
if(showLakesRef.current&&lk){for(let ti=0;ti<N;ti++){if(lk[ti]<0)continue;
const pi4=ti<<2;d[pi4]=25;d[pi4+1]=60;d[pi4+2]=105;d[pi4+3]=255;}}
// River overlay — Rivers: tributary+. Streams: streams only.
if(ter.rivers){const rm=ter.rivers.riverMag;
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
// Draw all tribe centers (tile coords — canvas is CW×CH)
for(let st=0;st<ter.tribeCenters.length;st++){const centers=ter.tribeCenters[st];
if(!centers||ter.tribeSizes[st]<=0)continue;
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x+0.5,cy2=dataYtoScreenY(centers[ci].y*RES,H,CH)+0.5;
const isCapital=ci===0,r2=isCapital?3:1.5;
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=isCapital?"rgba(240,235,220,0.95)":"rgba(200,195,180,0.6)";ctx.fill();
if(isCapital){ctx.beginPath();ctx.arc(cx2,cy2,r2+1,0,Math.PI*2);
ctx.strokeStyle="rgba(60,55,45,0.6)";ctx.lineWidth=0.8;ctx.stroke();}}
// ── Info label at capital (skip in focused mode — too cluttered) ──
const focusedMode=ter._selectedTribe>=0&&ter.tribeSizes[ter._selectedTribe]>0&&vm==="tribes";
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
}}
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
},[updateTerrainCache,CH]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;depthCeilRef.current=depthCeil;showPlatesRef.current=showPlates;showRiversRef.current=showRivers;showStreamsRef.current=showStreams;showLakesRef.current=showLakes;showGlobeRef.current=showGlobe;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,depthCeil,showPlates,showRivers,showStreams,showLakes,showPower,showGlobe,activeRes]);

useEffect(()=>{let fid,acc=0,last=performance.now();
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
const sub=Math.max(1,Math.ceil(speedRef.current/3*eraFactor));
for(let s=0;s<sub;s++)terRef.current=stepTerritory(terRef.current,worldRef.current);
setCoverage(Math.round(terRef.current.settled/terRef.current.landCount*100));
let alive=0,bestId=-1,bestPow=0;const ter2=terRef.current;
for(let i=0;i<ter2.tribeSizes.length;i++){if(ter2.tribeSizes[i]<=0)continue;alive++;
const pw=tribePower(ter2,i);if(pw>bestPow){bestPow=pw;bestId=i;}}
setTribeCount(alive);setDominant(bestId>=0?{id:bestId,power:bestPow,size:ter2.tribeSizes[bestId],
strength:ter2.tribeStrength[bestId],density:ter2.tribeStrength[bestId]/ter2.tribeSizes[bestId]}:null);
draw(terRef.current);}};
fid=requestAnimationFrame(loop);return()=>cancelAnimationFrame(fid);},[draw]);

// Wind particle animation loop — redraws at ~30fps when in wind view
useEffect(()=>{let wfid;
const windLoop=()=>{wfid=requestAnimationFrame(windLoop);
if(viewRef.current!=="wind"||!worldRef.current||!terRef.current)return;
draw(terRef.current);};
wfid=requestAnimationFrame(windLoop);
return()=>cancelAnimationFrame(wfid);},[draw]);

const togglePlay=()=>{if(!playing&&terRef.current&&terRef.current.settled>=terRef.current.landCount){
const t=createTerritory(worldRef.current);terRef.current=t;setTribeCount(t.tribes);setCoverage(0);setDominant(null);setSelectedTribe(-1);terrainCache.current=null;draw(t);}
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
const bs={background:"rgba(201,184,122,0.08)",border:"1px solid rgba(201,184,122,0.18)",color:"#8a8474",
padding:"4px 10px",borderRadius:2,cursor:"pointer",fontSize:10,letterSpacing:1,fontFamily:"inherit"};
const bsA=(active,color)=>({...bs,background:active?`rgba(${color},0.2)`:bs.background,
border:`1px solid ${active?`rgba(${color},0.35)`:bs.border}`,color:active?`rgb(${color})`:"#8a8474"});
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
const centers2=ter.tribeCenters[ow2]?ter.tribeCenters[ow2].length:0;
const ports2=ter.tribePorts&&ter.tribePorts[ow2]?ter.tribePorts[ow2].length:0;
const kc2=ter.tribeKnownCoasts&&ter.tribeKnownCoasts[ow2]?ter.tribeKnownCoasts[ow2].length:0;
tribeInfo={id:ow2,size:ter.tribeSizes[ow2],pop:Math.round(pop2),
knowledge:k?{ag:k.agriculture,mt:k.metallurgy,nv:k.navigation,cn:k.construction,og:k.organization,tr:k.trade}:null,
personality:bud2?bud2.personality:"",budget:bud2?{mil:bud2.military,gro:bud2.growth,com:bud2.commerce,exp:bud2.exploration,sur:bud2.survival}:null,
relation,centers:centers2,ports:ports2,knownCoasts:kc2};}
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
const lbs={...bs,width:"100%",textAlign:"left",padding:"4px 10px"};
const sep=<div style={{height:1,background:"rgba(201,184,122,0.10)",margin:"2px 0"}} />;
const rpW=rightPanel?300:0;
const gridCols=mapCount<=1?1:mapCount<=4?2:mapCount<=6?3:mapCount<=9?3:5;

return(
<div style={{width:"100vw",height:"100vh",background:"#060810",overflow:"hidden",display:"flex"}}>

{/* ══ LEFT PANEL ══ */}
<div style={{width:140,minWidth:140,height:"100%",background:"rgba(6,8,16,0.92)",borderRight:"1px solid rgba(201,184,122,0.08)",
display:"flex",flexDirection:"column",gap:4,padding:"8px 6px",overflowY:"auto",fontSize:10}}>
<button onClick={togglePlay} style={{...lbs,color:playing?"#e0a090":"#c9b87a",
background:playing?"rgba(200,80,60,0.15)":"rgba(201,184,122,0.1)",padding:"6px 10px",fontSize:12,textAlign:"center"}}>
{playing?"❚❚  Pause":"▶  Play"}</button>
<div style={{display:"flex",alignItems:"center",gap:4}}>
<span style={{color:"#6a6458",fontSize:9}}>Speed</span>
<input type="range" min={1} max={10} value={speed} onChange={e=>{setSpeed(+e.target.value);speedRef.current=+e.target.value}}
style={{flex:1,accentColor:"#c9b87a"}} />
</div>
{sep}
<button onClick={()=>setPresetAndGo("earth_sim")} style={{...lbs,...(preset==="earth_sim"?{color:"rgb(80,180,200)",background:"rgba(80,180,200,0.15)"}:{})}}>Earth (Sim)</button>
{preset==="earth_sim"&&<label style={{fontSize:10,color:useRealWind?"#6be":"#6a6458",cursor:"pointer",display:"flex",alignItems:"center",gap:3,padding:"0 4px"}}>
<input type="checkbox" checked={useRealWind} onChange={e=>{setUseRealWind(e.target.checked);useRealWindRef.current=e.target.checked;generate(seed)}}
style={{accentColor:"#6be",width:12,height:12}} />{isRealWindAvailable()?"Real Winds":"Real Winds (no data)"}</label>}
<button onClick={()=>setPresetAndGo("tectonic")} style={{...lbs,...(preset==="tectonic"?{color:"rgb(180,120,100)",background:"rgba(180,120,100,0.15)"}:{})}}>Tectonic</button>
{sep}
{preset==="tectonic"&&<>
<select value={tecPresetName} onChange={e=>{
const name=e.target.value;setTecPresetName(name);
if(name==="Default"){_tecParams={};generate(seed);}
else{const presets=loadPresets();if(presets[name]){_tecParams=presets[name];generate(seed);}}
}} style={{background:"rgba(201,184,122,0.06)",border:"1px solid rgba(201,184,122,0.18)",
color:"#b8a060",padding:"3px 6px",borderRadius:2,fontSize:10,fontFamily:"inherit",cursor:"pointer",outline:"none",width:"100%"}}>
<option value="Default" style={{background:"#0a0c14"}}>Default</option>
{Object.keys(loadPresets()).map(name=><option key={name} value={name} style={{background:"#0a0c14"}}>{name}</option>)}
</select>
{tecPresetName!=="Default"&&<button onClick={()=>{if(confirm("Delete '"+tecPresetName+"'?")){
deletePreset(tecPresetName);setTecPresetName("Default");_tecParams={};generate(seed);}}}
style={{...lbs,color:"#a06060",fontSize:9,textAlign:"center"}}>Delete Preset</button>}
{sep}
</>}
<input ref={fileRef} type="file" accept=".json,.map,.png,.jpg,.jpeg,.webp" style={{display:"none"}} onChange={handleImport} />
<button onClick={()=>fileRef.current?.click()} style={{...lbs,...(preset==="import"?{color:"rgb(180,140,200)",background:"rgba(180,140,200,0.15)"}:{})}}>Import</button>
{importStatus&&<span style={{fontSize:8,color:"#a99ed0",wordBreak:"break-all"}}>{importStatus}</span>}
{sep}
<div style={{flex:1}} />
<span style={{color:"#4a4438",fontSize:8,textAlign:"center"}}>Seed: {seed}</span>
</div>

{/* ══ CENTER: MAP AREA ══ */}
<div style={{flex:1,position:"relative",display:"flex",flexDirection:"column"}}>

{/* Map grid */}
<div style={{flex:1,display:"grid",gridTemplateColumns:`repeat(${gridCols},1fr)`,gap:2,padding:2}}>
{Array.from({length:mapCount}).map((_,mi)=>{
const extraSeed=seed+mi;
return(
<div key={mi} style={{position:"relative",overflow:"hidden",background:"#060810",display:"flex",
alignItems:"center",justifyContent:"center",cursor:mi>0?"pointer":"default",
border:mi===0?"2px solid rgba(201,184,122,0.25)":"2px solid transparent",borderRadius:3}}
onClick={()=>{if(mi>0)setSeed(extraSeed);}}>
{mi===0?(showGlobe?<div style={{width:"100%",aspectRatio:"4/3",maxHeight:"100%"}}>
<GlobeView terrainBuf={globeBuf} world={world}
CW={globeTexSize.w} CH={globeTexSize.h} /></div>
:<canvas ref={canvasRef} width={CW} height={CH} onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave} onClick={onCanvasClick}
style={{display:"block",imageRendering:"pixelated",maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",
aspectRatio:`${CW}/${CH}`}} />)
:<canvas ref={el=>extraCanvasRefs.current[mi-1]=el} width={PW} height={PH}
style={{display:"block",imageRendering:"pixelated",maxWidth:"100%",maxHeight:"100%",
width:"auto",height:"auto",aspectRatio:`${PW}/${PH}`}} />}
{mi>0&&<div style={{position:"absolute",bottom:2,left:0,right:0,textAlign:"center",
color:"#6a6458",fontSize:9,pointerEvents:"none"}}>Seed: {extraSeed}</div>}
</div>);})}
</div>

{/* Hover tooltip */}
{hoverInfo&&<div style={{position:"fixed",left:hoverInfo.x+14,top:hoverInfo.y-60,
background:"rgba(6,8,16,0.92)",color:"#c9b87a",fontSize:10,padding:"6px 10px",
borderRadius:3,pointerEvents:"none",whiteSpace:"nowrap",zIndex:100,lineHeight:"15px",
border:"1px solid rgba(201,184,122,0.15)"}}>
<div style={{fontWeight:"bold",marginBottom:2,color:hoverInfo.isLake?"#4a8aaa":hoverInfo.elevM<=0?"#4a6a8a":"#c9b87a"}}>{hoverInfo.isLake?`Lake (${hoverInfo.lakeSize} tiles)`:hoverInfo.biome}</div>
<div><span style={{color:"#8a8474"}}>Elev:</span> {hoverInfo.elevM}m</div>
<div><span style={{color:"#8a8474"}}>Temp:</span> {hoverInfo.tempC}°C</div>
<div><span style={{color:"#8a8474"}}>Moist:</span> {(hoverInfo.moist*100).toFixed(0)}%</div>
<div><span style={{color:"#8a8474"}}>Fert:</span> {(hoverInfo.fert*100).toFixed(0)}%</div>
<div><span style={{color:"#8a8474"}}>Wind:</span> {hoverInfo.wkmh} km/h {hoverInfo.wdir}</div>
<div><span style={{color:"#8a8474"}}>Lat:</span> {(hoverInfo.lat*90).toFixed(1)}°</div>
{hoverInfo.river>0&&<div><span style={{color:"#8a8474"}}>River:</span> <span style={{color:"#6ab4e8"}}>{RIVER_NAMES[hoverInfo.river]}</span> <span style={{color:"#5a5448",fontSize:9}}>({hoverInfo.riverAccum.toFixed(1)})</span></div>}
{hoverInfo.tribeInfo&&<>
<div style={{height:1,background:"rgba(201,184,122,0.12)",margin:"3px 0"}} />
<div><span style={{color:"#8a8474"}}>Tribe #{hoverInfo.tribeInfo.id}</span>{hoverInfo.tribeInfo.personality&&<span style={{color:"#b0a070"}}> {hoverInfo.tribeInfo.personality}</span>} <span style={{color:"#c9b87a"}}>{hoverInfo.tribeInfo.size}t</span> <span style={{color:"#7a7464"}}>{hoverInfo.tribeInfo.pop>=10000?(hoverInfo.tribeInfo.pop/1000).toFixed(1)+'M':hoverInfo.tribeInfo.pop>=1000?(hoverInfo.tribeInfo.pop/1000|0)+'M':hoverInfo.tribeInfo.pop>=1?hoverInfo.tribeInfo.pop.toFixed(0)+'k':'<1k'}</span></div>
{hoverInfo.tribeInfo.budget&&<div style={{fontSize:8,color:"#6a6458"}}>
<span style={{color:"#c06050"}}>{(hoverInfo.tribeInfo.budget.mil*100|0)}mil</span>{" "}
<span style={{color:"#60a050"}}>{(hoverInfo.tribeInfo.budget.gro*100|0)}gro</span>{" "}
<span style={{color:"#5080c0"}}>{(hoverInfo.tribeInfo.budget.com*100|0)}com</span>{" "}
<span style={{color:"#c09030"}}>{(hoverInfo.tribeInfo.budget.exp*100|0)}exp</span>{" "}
<span style={{color:"#808080"}}>{(hoverInfo.tribeInfo.budget.sur*100|0)}sur</span>
</div>}
{hoverInfo.tribeInfo.knowledge&&<div style={{fontSize:9,color:"#7a7464",lineHeight:"12px"}}>
<span style={{color:hoverInfo.tribeInfo.knowledge.ag>0.3?"#8ab870":"#5a5448"}}>Ag {(hoverInfo.tribeInfo.knowledge.ag*100|0)}%</span>{" "}
<span style={{color:hoverInfo.tribeInfo.knowledge.mt>0.3?"#c8946a":"#5a5448"}}>Mt {(hoverInfo.tribeInfo.knowledge.mt*100|0)}%</span>{" "}
<span style={{color:hoverInfo.tribeInfo.knowledge.nv>0.3?"#6a9ec8":"#5a5448"}}>Nv {(hoverInfo.tribeInfo.knowledge.nv*100|0)}%</span><br/>
<span style={{color:hoverInfo.tribeInfo.knowledge.cn>0.3?"#a89878":"#5a5448"}}>Cn {(hoverInfo.tribeInfo.knowledge.cn*100|0)}%</span>{" "}
<span style={{color:hoverInfo.tribeInfo.knowledge.og>0.3?"#b88ac8":"#5a5448"}}>Og {(hoverInfo.tribeInfo.knowledge.og*100|0)}%</span>{" "}
<span style={{color:hoverInfo.tribeInfo.knowledge.tr>0.3?"#c8b84a":"#5a5448"}}>Tr {(hoverInfo.tribeInfo.knowledge.tr*100|0)}%</span>
</div>}
{(hoverInfo.tribeInfo.centers>0||hoverInfo.tribeInfo.ports>0)&&<div style={{fontSize:8,color:"#6a6458"}}>
{hoverInfo.tribeInfo.centers} cities {hoverInfo.tribeInfo.ports} ports {hoverInfo.tribeInfo.knownCoasts} discovered</div>}
{hoverInfo.tribeInfo.relation&&<div style={{fontSize:9,fontWeight:"bold",
color:hoverInfo.tribeInfo.relation==='fight'?'#e06050':hoverInfo.tribeInfo.relation==='trade'?'#d0b040':hoverInfo.tribeInfo.relation==='friendly'?'#60b060':'#8a8474'}}>
{hoverInfo.tribeInfo.relation==='fight'?'AT WAR with selected':hoverInfo.tribeInfo.relation==='trade'?'TRADING with selected':hoverInfo.tribeInfo.relation==='friendly'?'FRIENDLY with selected':''}
</div>}
</>}
{hoverInfo.resources&&hoverInfo.resources.length>0&&<>
<div style={{height:1,background:"rgba(201,184,122,0.12)",margin:"3px 0"}} />
{hoverInfo.resources.slice(0,4).map(r=>(
<div key={r.id} style={{display:"flex",alignItems:"center",gap:4}}>
<span style={{display:"inline-block",width:7,height:7,borderRadius:1,background:`rgb(${r.color.join(",")})`}} />
<span style={{color:`rgb(${r.color.map(c=>Math.min(255,c+40)).join(",")})`}}>{r.label}</span>
<span style={{color:"#6a6458",fontSize:9}}>{(r.richness*100).toFixed(0)}%</span>
</div>))}
</>}
</div>}

{/* Biome legend — BOTTOM LEFT */}
{viewMode==="terrain"&&<div style={{position:"absolute",bottom:52,left:6,background:"rgba(6,8,16,0.82)",
borderRadius:3,padding:"5px 8px",pointerEvents:"none",fontSize:9,lineHeight:"14px",color:"#b0a888"}}>
{[4,5,6,7,8,9,10,15,11,12,14,13,16].map(bi=>(
<div key={bi} style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
<span style={{display:"inline-block",width:10,height:8,borderRadius:1,flexShrink:0,
background:`rgb(${BC[bi][0]},${BC[bi][1]},${BC[bi][2]})`}} />
<span>{BN[bi]}</span></div>))}</div>}

{/* Era legend — BOTTOM LEFT (tribes view) */}
{viewMode==="tribes"&&<div style={{position:"absolute",bottom:52,left:6,background:"rgba(6,8,16,0.82)",
borderRadius:3,padding:"5px 8px",pointerEvents:"none",fontSize:9,lineHeight:"14px",color:"#b0a888"}}>
{[["Stone Age",[50,45,35]],["Neolithic",[70,75,40]],["Farming",[80,100,45]],["Copper Age",[160,100,50]],
["Bronze Age",[140,110,50]],["Iron Age",[90,90,100]],["Empire",[120,50,50]],["Industrial",[80,70,90]]].map(([name,col])=>(
<div key={name} style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
<span style={{display:"inline-block",width:10,height:8,borderRadius:1,flexShrink:0,
background:`rgb(${col[0]},${col[1]},${col[2]})`}} />
<span>{name}</span></div>))}</div>}

{/* Resource toggles — BOTTOM LEFT */}
{viewMode==="resources"&&<div style={{position:"absolute",bottom:52,left:6,background:"rgba(6,8,16,0.88)",
borderRadius:3,padding:"6px 8px",fontSize:9,lineHeight:"16px",color:"#b0a888",userSelect:"none"}}>
{RESOURCES.map(r=>{const on=activeRes[r.id];return(
<div key={r.id} onClick={()=>{setActiveRes(prev=>{const next={...prev};next[r.id]=!prev[r.id];return next;});}}
style={{display:"flex",alignItems:"center",gap:5,marginBottom:1,cursor:"pointer",
opacity:on?1:0.3,transition:"opacity 0.15s"}}>
<span style={{display:"inline-block",width:10,height:8,borderRadius:1,flexShrink:0,
background:on?`rgb(${r.color.join(",")})`:"#333"}} />
<span>{r.label}</span>
<span style={{color:"#5a5448",fontSize:8,marginLeft:2}}>{r.era}</span>
</div>);})}
<div style={{height:1,background:"rgba(201,184,122,0.10)",margin:"4px 0"}} />
<div style={{display:"flex",gap:6}}>
<span onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=true;setActiveRes(s);}}
style={{cursor:"pointer",color:"#8a8474",fontSize:8}}>All</span>
<span onClick={()=>{const s={};for(const r of RESOURCES)s[r.id]=false;setActiveRes(s);}}
style={{cursor:"pointer",color:"#8a8474",fontSize:8}}>None</span>
</div></div>}

{/* Stats — top right of map area */}
{(()=>{const ter=terRef.current;
const step=ter?ter.stepCount:0;
const year=stepToYear(step);
const ys=yearStr(step);
// Compute average knowledge across alive tribes for era label
let avgAg=0,avgMet=0,avgNav=0,avgOrg=0,aliveK=0;
if(ter&&ter.tribeKnowledge){for(let i=0;i<ter.tribeKnowledge.length;i++){
if(ter.tribeSizes[i]<=0)continue;aliveK++;const k=ter.tribeKnowledge[i];
avgAg+=k.agriculture;avgMet+=k.metallurgy;avgNav+=k.navigation;avgOrg+=k.organization;}
if(aliveK>0){avgAg/=aliveK;avgMet/=aliveK;avgNav/=aliveK;avgOrg/=aliveK;}}
return <div style={{position:"absolute",top:6,right:6,background:"rgba(6,8,16,0.88)",borderRadius:4,padding:"5px 12px",
display:"flex",gap:14,fontSize:11,color:"#c9b87a",pointerEvents:"none",alignItems:"center",
border:"1px solid rgba(201,184,122,0.1)"}}>
<span style={{fontWeight:"bold",fontSize:13,color:"#e0d4a8",letterSpacing:0.5}}>{ys}</span>
<span style={{color:"#8a8474"}}>Step {step}</span>
<span>{tribeCount} tribes</span>
<span>{coverage}% settled</span>
{dominant&&<span style={{display:"inline-flex",alignItems:"center",gap:3}}>
<span style={{width:8,height:8,borderRadius:2,background:`rgb(${tribeRGB(dominant.id).join(",")})`,display:"inline-block",border:"1px solid rgba(255,255,255,0.3)"}} />
<span style={{color:"#c9b87a"}}>{dominant.size}t</span></span>}
{aliveK>0&&<span style={{fontSize:9,color:"#6a6458"}}>
Ag {(avgAg*100|0)} Mt {(avgMet*100|0)} Nv {(avgNav*100|0)} Og {(avgOrg*100|0)}</span>}
{ter&&<span style={{fontSize:9,color:"#886644"}}>bg:{ter._dbgMaxBgPop?.toFixed(2)} call:{ter._dbgBgCalls||0} abv:{ter._dbgBgAboveThresh} cc:{ter._dbgCrystalCandidates} sp:{ter._dbgCrystalSpawned||0}</span>}
</div>;})()}

{/* ══ BOTTOM CENTER: VIEW/OVERLAY OPTIONS (larger) ══ */}
<div style={{position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",
background:"rgba(6,8,16,0.88)",borderRadius:4,padding:"6px 12px",
display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
{[["terrain","Terrain"],["depth","Depth"],["wind","Wind"],["moisture","Moisture"],["temperature","Temp"],["fertility","Fertility"],["resources","Resources"],["tribes","Tribes"]].map(([k,label])=>(
<button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}}
style={{...bs,background:viewMode===k?"rgba(201,184,122,0.2)":"transparent",border:"none",
color:viewMode===k?"#c9b87a":"#5a5448",padding:"6px 14px",fontSize:13}}>{label}</button>))}
{viewMode==="depth"&&<><button onClick={()=>{setDepthFromSea(v=>!v);depthFromSeaRef.current=!depthFromSeaRef.current;}}
style={{...bs,background:depthFromSea?"rgba(80,140,200,0.25)":"transparent",border:"none",
color:depthFromSea?"#6ab4e8":"#5a5448",padding:"6px 12px",fontSize:12}}>{depthFromSea?"Sea":"Floor"}</button>
<span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:"#8a8070",marginLeft:4}}>
<span>Range</span>
<input type="range" min="0.05" max="1.0" step="0.05" value={depthCeil}
onChange={e=>{const v=parseFloat(e.target.value);setDepthCeil(v);depthCeilRef.current=v;}}
style={{width:80,accentColor:"#8a8070"}}/>
<span>{Math.round(depthCeil*100)}%</span>
</span></>}
{viewMode==="tribes"&&<button onClick={()=>setShowPower(v=>!v)}
style={{...bs,background:showPower?"rgba(180,120,200,0.20)":"transparent",border:"none",
color:showPower?"#b090d0":"#5a5448",padding:"4px 8px",fontSize:10}}>Power</button>}
{world&&world.pixPlate&&<button onClick={()=>{setShowPlates(v=>!v);showPlatesRef.current=!showPlatesRef.current;}}
style={{...bs,background:showPlates?"rgba(200,80,60,0.25)":"transparent",border:"none",
color:showPlates?"#e07050":"#5a5448",padding:"6px 12px",fontSize:12}}>Plates</button>}
<button onClick={()=>{setShowRivers(v=>!v);showRiversRef.current=!showRiversRef.current;}}
style={{...bs,background:showRivers?"rgba(60,140,220,0.25)":"transparent",border:"none",
color:showRivers?"#6ab4e8":"#5a5448",padding:"6px 12px",fontSize:12}}>Rivers</button>
{showRivers&&<button onClick={()=>{setShowStreams(v=>!v);showStreamsRef.current=!showStreamsRef.current;}}
style={{...bs,background:showStreams?"rgba(60,120,180,0.20)":"transparent",border:"none",
color:showStreams?"#5a9aca":"#4a4a40",padding:"4px 8px",fontSize:10}}>Streams</button>}
<button onClick={()=>{setShowLakes(v=>!v);showLakesRef.current=!showLakesRef.current;}}
style={{...bs,background:showLakes?"rgba(40,80,140,0.25)":"transparent",border:"none",
color:showLakes?"#4a80b8":"#5a5448",padding:"6px 12px",fontSize:12}}>Lakes</button>
<button onClick={()=>setShowGlobe(!showGlobe)}
style={{...bs,background:showGlobe?"rgba(120,180,220,0.25)":"transparent",border:"none",
color:showGlobe?"#78b4dc":"#5a5448",padding:"6px 12px",fontSize:12}}>Globe</button>
{(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&<>
<div style={{width:1,height:20,background:"rgba(201,184,122,0.15)"}} />
<button onClick={()=>setRightPanel(rightPanel==="tribes"?"":"tribes")}
style={{...bs,color:rightPanel==="tribes"?"#c9b87a":"#5a5448",background:rightPanel==="tribes"?"rgba(201,184,122,0.15)":"transparent",
border:"none",padding:"6px 12px",fontSize:12}}>Tribes</button>
<button onClick={()=>setRightPanel(rightPanel==="params"?"":"params")}
style={{...bs,color:rightPanel==="params"?"#c9b87a":"#5a5448",background:rightPanel==="params"?"rgba(201,184,122,0.15)":"transparent",
border:"none",padding:"6px 12px",fontSize:12}}>Params</button>
{preset==="tectonic"&&<button onClick={()=>setShowTuning(true)}
style={{...bs,color:"#b8a060",border:"1px solid rgba(201,184,122,0.3)",padding:"6px 12px",fontSize:12}}>Tune</button>}
</>}
</div>

</div>{/* end center */}

{/* ══ RIGHT PANEL: Parameters ══ */}
{rightPanel==="params"&&(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&<div style={{width:rpW,minWidth:rpW,height:"100%",background:"rgba(6,8,16,0.92)",
borderLeft:"1px solid rgba(201,184,122,0.08)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{padding:"8px 10px",fontSize:11,color:"#c9b87a",borderBottom:"1px solid rgba(201,184,122,0.08)",
display:"flex",alignItems:"center"}}>
<span>{preset==="tectonic"?"Parameters":"Wind & Moisture"}</span>
<div style={{flex:1}} />
<span onClick={()=>setRightPanel("")} style={{cursor:"pointer",color:"#6a6458",fontSize:14}}>✕</span>
</div>
<div style={{flex:1,overflowY:"auto",padding:"6px 8px"}}>
<ParamEditor params={{..._tecParams}} onChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  groups={preset==="earth"?["wind"]:preset==="earth_sim"?["wind","moisture"]:undefined} />
</div>
</div>}

{/* ══ RIGHT PANEL: Tribes ══ */}
{rightPanel==="tribes"&&<div style={{width:rpW,minWidth:rpW,height:"100%",background:"rgba(6,8,16,0.92)",
borderLeft:"1px solid rgba(201,184,122,0.08)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
<div style={{padding:"8px 10px",fontSize:11,color:"#c9b87a",borderBottom:"1px solid rgba(201,184,122,0.08)",
display:"flex",alignItems:"center"}}>
<span style={{fontWeight:"bold"}}>Tribes</span>
<div style={{flex:1}} />
<span onClick={()=>setRightPanel("")} style={{cursor:"pointer",color:"#6a6458",fontSize:14}}>x</span>
</div>
<div style={{flex:1,overflowY:"auto",padding:"4px 0"}}>
{(()=>{const ter=terRef.current;if(!ter)return <div style={{color:"#5a5448",padding:10,fontSize:10}}>No simulation running</div>;
const step=ter.stepCount;
// Build sorted tribe list
const tribes=[];
for(let i=0;i<ter.tribeSizes.length;i++){if(ter.tribeSizes[i]<=0)continue;
const k=ter.tribeKnowledge&&ter.tribeKnowledge[i]?ter.tribeKnowledge[i]:null;
const pop=ter.tribePopulation?ter.tribePopulation[i]:0;
const ports=ter.tribePorts&&ter.tribePorts[i]?ter.tribePorts[i].length:0;
const centers=ter.tribeCenters[i]?ter.tribeCenters[i].length:0;
const knownCoasts=ter.tribeKnownCoasts&&ter.tribeKnownCoasts[i]?ter.tribeKnownCoasts[i].length:0;
const power=tribePower(ter,i);
const bud=ter.tribeBudget&&ter.tribeBudget[i]?ter.tribeBudget[i]:null;
tribes.push({id:i,size:ter.tribeSizes[i],pop:Math.round(pop),power,ports,centers,knownCoasts,k,
personality:bud?bud.personality:"",wealth:bud?bud.wealth:0,budget:bud?{mil:bud.military,gro:bud.growth,com:bud.commerce,exp:bud.exploration,sur:bud.survival}:null});}
tribes.sort((a,b)=>b.power-a.power);
// Selected tribe detail
const sel=selectedTribe>=0&&ter.tribeSizes[selectedTribe]>0?selectedTribe:-1;
const selData=sel>=0?tribes.find(t=>t.id===sel):null;
return <>
{/* Selected tribe detail */}
{selData&&<div style={{padding:"8px 10px",borderBottom:"1px solid rgba(201,184,122,0.12)",background:"rgba(201,184,122,0.04)"}}>
<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
<span style={{width:12,height:12,borderRadius:3,background:`rgb(${tribeRGB(selData.id).join(",")})`,display:"inline-block",border:"1px solid rgba(255,255,255,0.3)"}} />
<span style={{fontWeight:"bold",fontSize:13,color:"#e0d4a8"}}>Tribe #{selData.id}</span>
{selData.personality&&<span style={{color:"#b0a070",fontSize:10}}>{selData.personality}</span>}
<span style={{color:"#6a6458",fontSize:9,marginLeft:"auto"}} onClick={()=>{setSelectedTribe(-1);if(ter)ter._selectedTribe=-1;draw(ter);}}>(deselect)</span>
</div>
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 10px",fontSize:10,color:"#b0a888"}}>
<div><span style={{color:"#7a7464"}}>Territory:</span> {selData.size} tiles</div>
<div><span style={{color:"#7a7464"}}>Population:</span> {selData.pop>=10000?(selData.pop/1000).toFixed(1)+'M':selData.pop>=1000?(selData.pop/1000|0)+'M':selData.pop>=1?selData.pop.toFixed(0)+'k':'<1k'}</div>
<div><span style={{color:"#7a7464"}}>Power:</span> {selData.power.toFixed(1)}</div>
<div><span style={{color:"#d0b040"}}>Wealth:</span> <span style={{color:"#d0b040"}}>{selData.wealth>=1000?(selData.wealth/1000).toFixed(1)+'k':selData.wealth.toFixed(0)} gold</span></div>
<div><span style={{color:"#7a7464"}}>Centers:</span> {selData.centers}</div>
<div><span style={{color:"#7a7464"}}>Ports:</span> {selData.ports}</div>
<div><span style={{color:"#7a7464"}}>Known coasts:</span> {selData.knownCoasts}</div>
</div>
{selData.k&&<div style={{marginTop:6}}>
<div style={{fontSize:9,color:"#7a7464",marginBottom:3}}>Knowledge</div>
{[["agriculture","Ag","#8ab870"],["metallurgy","Mt","#c8946a"],["navigation","Nv","#6a9ec8"],
["construction","Cn","#a89878"],["organization","Og","#b88ac8"],["trade","Tr","#c8b84a"]].map(([key,label,col])=>{
const v=selData.k[key];return <div key={key} style={{display:"flex",alignItems:"center",gap:4,marginBottom:1}}>
<span style={{width:22,fontSize:9,color:v>0.2?col:"#4a4438"}}>{label}</span>
<div style={{flex:1,height:6,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
<div style={{width:`${v*100}%`,height:"100%",background:col,borderRadius:2,transition:"width 0.3s"}} /></div>
<span style={{width:28,fontSize:8,color:"#6a6458",textAlign:"right"}}>{(v*100|0)}%</span>
</div>;})}
</div>}
{/* Trade */}
{(()=>{const td=ter.tradeData&&ter.tradeData[sel]?ter.tradeData[sel]:null;
if(!td||td.partners===0)return null;
const fmtR=(v)=>v>=1?v.toFixed(1):v>=0.01?v.toFixed(2):'0';
return <div style={{marginTop:6}}>
<div style={{fontSize:9,color:"#7a7464",marginBottom:3}}>Trade ({td.partners} partners)</div>
{td.foodImports>0&&<div style={{fontSize:8,color:"#60a050"}}>Importing {fmtR(td.foodImports)} food</div>}
{td.foodExports>0&&<div style={{fontSize:8,color:"#c09030"}}>Exporting {fmtR(td.foodExports)} food</div>}
{RES_KEYS.filter(rk=>td.imports[rk]>0.01||td.exports[rk]>0.01).slice(0,6).map(rk=>
<div key={rk} style={{fontSize:8,color:"#8a8474"}}>
{td.imports[rk]>0.01&&<span style={{color:"#6a9ec8"}}>{rk}: +{fmtR(td.imports[rk])} </span>}
{td.exports[rk]>0.01&&<span style={{color:"#c09030"}}>{rk}: -{fmtR(td.exports[rk])} </span>}
</div>)}
{td.income>0.01&&<div style={{fontSize:8,color:"#d0b040",fontWeight:"bold"}}>Trade income: {fmtR(td.income)}</div>}
</div>;})()}
{/* Budget allocation */}
{selData.budget&&<div style={{marginTop:6}}>
<div style={{fontSize:9,color:"#7a7464",marginBottom:3}}>Budget</div>
<div style={{display:"flex",height:8,borderRadius:2,overflow:"hidden",background:"rgba(255,255,255,0.05)"}}>
<div style={{width:`${selData.budget.mil*100}%`,background:"#c06050"}} title={`Military ${(selData.budget.mil*100|0)}%`} />
<div style={{width:`${selData.budget.gro*100}%`,background:"#60a050"}} title={`Growth ${(selData.budget.gro*100|0)}%`} />
<div style={{width:`${selData.budget.com*100}%`,background:"#5080c0"}} title={`Commerce ${(selData.budget.com*100|0)}%`} />
<div style={{width:`${selData.budget.exp*100}%`,background:"#c09030"}} title={`Exploration ${(selData.budget.exp*100|0)}%`} />
<div style={{width:`${selData.budget.sur*100}%`,background:"#606060"}} title={`Survival ${(selData.budget.sur*100|0)}%`} />
</div>
<div style={{display:"flex",gap:6,fontSize:8,color:"#6a6458",marginTop:2}}>
<span style={{color:"#c06050"}}>{(selData.budget.mil*100|0)}%mil</span>
<span style={{color:"#60a050"}}>{(selData.budget.gro*100|0)}%gro</span>
<span style={{color:"#5080c0"}}>{(selData.budget.com*100|0)}%com</span>
<span style={{color:"#c09030"}}>{(selData.budget.exp*100|0)}%exp</span>
<span style={{color:"#808080"}}>{(selData.budget.sur*100|0)}%sur</span>
</div>
</div>}
{/* Relationships (neighbors + maritime contacts) */}
{(()=>{
// Gather all known tribes: border contacts + maritime
const allRelations=[];const seen=new Set();
if(ter._borderContacts&&ter._borderContacts[sel]){
for(const nid in ter._borderContacts[sel]){const n=parseInt(nid);
if(ter.tribeSizes[n]<=0)continue;seen.add(n);
allRelations.push({id:n,contact:ter._borderContacts[sel][nid],size:ter.tribeSizes[n],
rel:tribeRelation(ter,sel,n),via:'border'});}}
// Maritime contacts
if(ter.tribeKnownCoasts&&ter.tribeKnownCoasts[sel]){
for(const kc of ter.tribeKnownCoasts[sel]){
if(kc.owner>=0&&!seen.has(kc.owner)&&ter.tribeSizes[kc.owner]>0){
seen.add(kc.owner);
allRelations.push({id:kc.owner,contact:0,size:ter.tribeSizes[kc.owner],
rel:tribeRelation(ter,sel,kc.owner),via:'maritime'});}}}
allRelations.sort((a,b)=>b.size-a.size);
if(allRelations.length===0)return null;
const relCol={fight:'#e06050',trade:'#d0b040',friendly:'#60b060',neutral:'#8a8474'};
const relLabel={fight:'War',trade:'Trade',friendly:'Peace',neutral:''};
return <div style={{marginTop:6}}>
<div style={{fontSize:9,color:"#7a7464",marginBottom:3}}>Known Nations ({allRelations.length})</div>
{allRelations.slice(0,10).map(n=>{const pers=ter.tribeBudget&&ter.tribeBudget[n.id]?ter.tribeBudget[n.id].personality:'';
return <div key={n.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:9,marginBottom:2,cursor:"pointer",
padding:"1px 3px",borderRadius:2,background:n.rel==='fight'?'rgba(220,80,60,0.1)':n.rel==='trade'?'rgba(200,180,60,0.1)':'transparent'}}
onClick={()=>{setSelectedTribe(n.id);ter._selectedTribe=n.id;draw(ter);}}>
<span style={{width:6,height:6,borderRadius:6,background:relCol[n.rel],display:"inline-block",flexShrink:0}} />
<span style={{color:"#b0a888"}}>#{n.id}</span>
{pers&&<span style={{color:"#8a7a5a",fontSize:8}}>{pers}</span>}
<span style={{color:"#6a6458"}}>{ter.tribeSizes[n.id]}t</span>
{n.via==='maritime'&&<span style={{color:"#5a8aaa",fontSize:7}}>sea</span>}
{relLabel[n.rel]&&<span style={{color:relCol[n.rel],fontSize:8,fontWeight:"bold",marginLeft:"auto"}}>{relLabel[n.rel]}</span>}
</div>;})}
</div>;})()}
</div>}
{/* Tribe list */}
<div style={{padding:"4px 6px"}}>
<div style={{fontSize:9,color:"#6a6458",marginBottom:4,padding:"0 4px"}}>{tribes.length} tribes (by power)</div>
{tribes.map(t=>{const isSel=t.id===sel;
return <div key={t.id} onClick={()=>{setSelectedTribe(t.id);if(ter)ter._selectedTribe=t.id;draw(ter);}}
style={{display:"flex",alignItems:"center",gap:5,padding:"3px 6px",cursor:"pointer",
borderRadius:2,background:isSel?"rgba(201,184,122,0.12)":"transparent",
borderLeft:isSel?`2px solid rgb(${tribeRGB(t.id).join(",")})`:"2px solid transparent"}}>
<span style={{width:8,height:8,borderRadius:2,flexShrink:0,
background:`rgb(${tribeRGB(t.id).join(",")})`,display:"inline-block"}} />
<div style={{flex:1,minWidth:0}}>
<div style={{fontSize:10,color:isSel?"#e0d4a8":"#b0a888",display:"flex",gap:6}}>
<span>#{t.id}</span>
<span style={{color:"#7a7464"}}>{t.size}t</span>
<span style={{color:"#6a6458",fontSize:9}}>{t.pop>=10000?(t.pop/1000).toFixed(1)+'M':t.pop>=1000?(t.pop/1000|0)+'M':t.pop>=1?t.pop.toFixed(0)+'k':'<1k'}</span>
</div>
{t.k&&<div style={{fontSize:8,color:"#5a5448",display:"flex",gap:3,flexWrap:"wrap"}}>
{t.k.agriculture>0.05&&<span style={{color:"#6a8a50"}}>Ag{(t.k.agriculture*100|0)}</span>}
{t.k.metallurgy>0.05&&<span style={{color:"#a07050"}}>Mt{(t.k.metallurgy*100|0)}</span>}
{t.k.navigation>0.05&&<span style={{color:"#5080a0"}}>Nv{(t.k.navigation*100|0)}</span>}
{t.k.organization>0.05&&<span style={{color:"#9070a0"}}>Og{(t.k.organization*100|0)}</span>}
{t.k.trade>0.05&&<span style={{color:"#a09030"}}>Tr{(t.k.trade*100|0)}</span>}
</div>}
</div>
<span style={{fontSize:8,color:"#5a5448",flexShrink:0}}>{t.power.toFixed(0)}pw</span>
{t.wealth>1&&<span style={{fontSize:7,color:"#b09830",flexShrink:0}}>{t.wealth>=1000?(t.wealth/1000|0)+'k':t.wealth.toFixed(0)}g</span>}
</div>;})}
</div>
</>; })()}
</div>
</div>}

{/* ══ TUNING OVERLAY ══ */}
{showTuning&&<TuningPanel noiseFns={{initNoise,fbm,ridged,noise2D,worley}} seed={seed}
  params={{..._tecParams}}
  onParamsChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  onClose={()=>setShowTuning(false)} />}

</div>);}