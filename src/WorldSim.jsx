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
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,elevation[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));}
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
const lt=Math.abs(py/H-0.42)*2,e2=elevation[py*W+px];
tGrid[my*mW2+mx]=Math.max(0,Math.min(1,1-Math.pow(lt,1.35)*1.15+Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06-Math.max(0,e2)*0.65));}
for(let step=0;step<25;step++){const prev=new Float32Array(tGrid);
for(let my=1;my<mH2-1;my++)for(let mx=0;mx<mW2;mx++){
const px=Math.min(W-1,mx*2),py=Math.min(H-1,my*2),fi=py*W+px;
const wx2=fWX[fi],wy2=fWY[fi];
const srcX=mx-wx2*2.0,srcY=my-wy2*2.0;
const sx=Math.min(mW2-2,Math.max(0,srcX|0)),sy=Math.min(mH2-2,Math.max(0,srcY|0));
const fdx=Math.max(0,Math.min(1,srcX-sx)),fdy=Math.max(0,Math.min(1,srcY-sy));
const sxr=Math.min(mW2-1,sx+1);
const upT=(prev[sy*mW2+sx]*(1-fdx)+prev[sy*mW2+sxr]*fdx)*(1-fdy)
+(prev[(sy+1)*mW2+sx]*(1-fdx)+prev[(sy+1)*mW2+sxr]*fdx)*fdy;
const e2=elevation[fi],lt=Math.abs(py/H-0.42)*2;
const locT=Math.max(0,Math.min(1,1-Math.pow(lt,1.35)*1.15+Math.exp(-((lt-0.20)*(lt-0.20))/(2*0.08*0.08))*0.06-Math.max(0,e2)*0.65));
if(e2<=0){tGrid[my*mW2+mx]=locT*0.88+upT*0.12;}
else{const tb=Math.min(0.8,Math.max(0,e2-0.05)*3);
const bi=(1-tb*0.5)*0.22,wb=upT>locT?1.3:0.8;
const wi=Math.min(0.35,bi*wb);
tGrid[my*mW2+mx]=locT*(1-wi)+upT*wi;}}}
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
const tLat=Math.abs(ny-0.42)*2;
const shE=Math.exp(-((tLat-0.20)*(tLat-0.20))/(2*0.08*0.08))*0.06;
const bt=1-Math.pow(tLat,1.35)*1.15+shE-Math.max(0,e)*0.65+fbm(nx*3+80,ny*3+80,3,2,.5)*.08+fbm(nx*1.2+55,ny*1.2+55,3,2,.55)*.10;
const inland=Math.max(0,1-cp);
const ch=tLat<0.5?inland*(0.5-tLat)*0.20:inland*(tLat-0.5)*-0.12;
const mt=bt+(0.45-bt)*cp*0.2+ch;
const wt=windTemp[i];
temperature[i]=Math.max(0,Math.min(1,mt*0.75+wt*0.25));
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
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
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
elevation[i]=e;temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
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
function tileFert(t,m,e){if(e>0.45)return 0.05;
const tFactor=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);
const mFactor=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));
const base=tFactor*mFactor;
return Math.max(0.05,base*(1-Math.max(0,e-0.15)*3));}

const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
const LEAPS=[];for(let r=5;r<=13;r++)for(let a=0;a<8;a++){const ang=a*Math.PI/4;LEAPS.push([Math.round(Math.cos(ang)*r),Math.round(Math.sin(ang)*r)]);}

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
const riverRadius=[0,0,3,4,6];// NONE,STREAM,TRIB,MAJOR,GREAT
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
// Find multiple spread-out seed locations for starting tribes
const NUM_TRIBES=(w.preset==="earth"||w.preset==="earth_sim")?8:w.preset==="import"&&w.tribeSeeds&&w.tribeSeeds.length>0?w.tribeSeeds.length:6;const minSpacing=Math.round(tw*0.12);
// Score all habitable tiles
const scored=[];
for(let ty=2;ty<th-2;ty++)for(let tx=0;tx<tw;tx++){const ti=ty*tw+tx;if(tElev[ti]<=0)continue;
const s=tFert[ti]*2+tTemp[ti]+tMoist[ti]-tDiff[ti]*2;
scored.push({x:tx,y:ty,s});}
scored.sort((a,b)=>b.s-a.s);
// Pick well-spaced origins (greedy: best first, skip if too close to existing)
const origins=[];
if(w.preset==="import"&&w.tribeSeeds&&w.tribeSeeds.length>0){// Imported map: use state positions as tribe seeds
for(const ts of w.tribeSeeds){const tx=Math.min(tw-1,Math.max(0,Math.round(ts.x/RES))),ty2=Math.min(th-1,Math.max(0,Math.round(ts.y/RES)));
if(tElev[ty2*tw+tx]>0)origins.push({x:tx,y:ty2,s:tFert[ty2*tw+tx]});}}
else if(w.preset==="earth"||w.preset==="earth_sim"){// Seed East Africa first (cradle of mankind)
const etx=Math.round(tw*0.51),ety=Math.round(th*0.47);
let best=null,bs2=-999;
for(const c of scored){let dx=Math.abs(c.x-etx);if(dx>tw/2)dx=tw-dx;
if(dx*dx+(c.y-ety)**2<(tw*0.04)**2&&c.s>bs2){bs2=c.s;best=c;}}
if(best)origins.push(best);}
for(const c of scored){if(origins.length>=NUM_TRIBES)break;
let ok=true;for(const o of origins){let dx=Math.abs(c.x-o.x);if(dx>tw/2)dx=tw-dx;
if(dx*dx+(c.y-o.y)**2<minSpacing*minSpacing){ok=false;break;}}
if(ok)origins.push(c);}
const tenure=new Uint16Array(tw*th);const frontier=new Uint8Array(tw*th);const frontierList=[];
for(let i=0;i<origins.length;i++){const{x,y}=origins[i],ti=y*tw+x;
owner[ti]=i;tribeSizes.push(1);tribeStrength.push(tFert[ti]);tenure[ti]=1;frontier[ti]=1;frontierList.push(ti);
tribeCenters.push([{x,y,prestige:1.0,founded:0}]);}
let lc=0;for(let i=0;i<tw*th;i++)if(tElev[i]>0)lc++;
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,deposits,rivers,owner,tenure,tribeCenters,tribeSizes,tribeStrength,
frontier,frontierList,landCount:lc,settled:origins.length,tribes:origins.length,origin:origins[0]||{x:0,y:0},stepCount:0};}

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
// Population = total fertility (what the land can sustain). Military = population.
// Large fertile empires are genuinely powerful. Logistics penalty keeps it bounded.
const sz=ter.tribeSizes[id],pop=ter.tribeStrength[id];if(sz<=0)return 0;
const logistics=1/(1+Math.max(0,sz-40)*0.015);// steep overextension: 100 tiles → 52%, 200 tiles → 29%
return pop*logistics;
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
return pop*(0.03+0.97*Math.min(1,total));
}
function newTribe(ter,x,y){const id=ter.tribeCenters.length;ter.tribeCenters.push([{x,y,prestige:1.0,founded:ter.stepCount}]);ter.tribeSizes.push(0);ter.tribeStrength.push(0);ter.tribes=id+1;return id;}
function claimTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert,tenure}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];}else{ter.settled++;}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];tenure[ti]=1;}
// Transfer tile without resetting tenure (for splits/fragmentation — population stays, allegiance changes)
function transferTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];}

function stepTerritory(ter,w){
const sl=0,wet=0.7;const{tw,th,tElev,tTemp,tCoast,tDiff,tFert,owner,tribeCenters,tribeSizes,tribeStrength}=ter;ter.stepCount++;
// ── Expansion into empty land ──
const nf=new Uint8Array(tw*th);const nfl=[];
for(let fj=0;fj<ter.frontierList.length;fj++){const fi=ter.frontierList[fj];if(tElev[fi]<=sl)continue;const ty=Math.floor(fi/tw),tx=fi%tw,ow=owner[fi];let room=false;const pDiff=tDiff[fi];
const owSz=tribeSizes[ow],owDens=owSz>0?tribeStrength[ow]/owSz:0;
// Small tribes prioritize grabbing available land; large tribes are pickier about fertile tiles
const smallBoost=owSz<30?1+((30-owSz)/30)*0.8:1;// up to +80% expansion for tiny tribes
const largePrize=owSz>60?1+Math.min(1,(owSz-60)*0.01):1;// large tribes weight fertility more
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;const ni=ny*tw+nx;if(owner[ni]>=0)continue;
const elev=tElev[ni];if(elev<=sl){room=true;continue;}const effT=tTemp[ni];if(effT<0.02){room=true;continue;}
const diff=tDiff[ni],adjDiff=Math.min(1,diff+(effT<0.15?0.3:0)-(wet>0.7?0.1:0));
let chance;if(elev<=0&&elev>sl)chance=0.7*wet;else if(tCoast[ni])chance=0.9*wet;else chance=0.45*(1-adjDiff)*wet;
if(effT<0.15)chance*=0.3;
chance*=(0.5+tFert[ni]*1.5*largePrize)*smallBoost;
// Center proximity: expansion slows dramatically far from centers
const centers=tribeCenters[ow];
const{min:distMin,cap:distCap}=nearestCenterDist(centers,nx,ny,tw);
const reach=expFalloff(distMin);// same gaussian as power projection
chance*=Math.max(0.05,reach);// 5% floor so frontier doesn't completely freeze
if(Math.random()<chance){let nw=ow;
// Count same-tribe neighbors: if tile is infill (≥3), never split
let sameN=0;for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny+dy2;
if(ay>=0&&ay<th&&owner[ay*tw+ax]===ow)sameN++;}
const sz=tribeSizes[ow],dens=sz>0?tribeStrength[ow]/sz:0;
let splitChance=0;
// Cap total tribes to prevent runaway proliferation (performance + gameplay)
const MAX_TRIBES=40;let alive=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)alive++;
if(sameN<3&&alive<MAX_TRIBES){
// Overextension: large tribes are harder to hold together
const overext=sz>80?Math.min(0.15,(sz-80)*0.001):0;
// Geographic barrier: mountains/deserts between parent and frontier
const barrier=diff>0.6&&pDiff<0.3?0.2:0;
// Internal inequality: fertile frontier wants independence from poor core
const ineq=dens>0&&tFert[ni]>dens*2.0?0.15*(tFert[ni]/dens-1):0;
// Distance weakens central control (from nearest center, not just capital)
const distF=distMin>30?Math.min(0.15,(distMin-30)*0.004):0;
// Strong, dense tribes resist all splits
splitChance=Math.max(0,(overext+barrier+ineq+distF)*(1-Math.min(0.9,dens*1.2)));}
if(splitChance>0&&Math.random()<splitChance)nw=newTribe(ter,nx,ny);
// Found a new center if fertile tile is far from all existing centers
else if(tFert[ni]>0.4&&distMin>20&&centers&&centers.length<8)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);if(!nf[ni]){nf[ni]=1;nfl.push(ni);}}else room=true;}
if((tCoast[fi]||(tElev[fi]<=0&&tElev[fi]>sl))&&wet>0.3){for(const[dx,dy]of LEAPS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;const ni=ny*tw+nx;
if(owner[ni]>=0||tElev[ni]<=sl||tTemp[ni]<0.05)continue;
// Don't land on contested coast: skip if any neighbor is owned by a different tribe
let contested=false;for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny+dy2;
if(ay>=0&&ay<th){const ao=owner[ay*tw+ax];if(ao>=0&&ao!==ow){contested=true;break;}}}
if(contested)continue;
// Low density tribes explore more aggressively (searching for better land)
const leapBoost=owDens<0.3?1+(0.3-owDens)*3:1;// up to 1.9x for poorest tribes
if(Math.random()<0.25*wet*leapBoost){let nw=ow;const centers=tribeCenters[ow];
const{min:distMin}=nearestCenterDist(centers,nx,ny,tw);
const sz=tribeSizes[ow],dens=sz>0?tribeStrength[ow]/sz:0;
const overext=sz>80?Math.min(0.1,(sz-80)*0.001):0;
if(distMin>30&&Math.random()<overext+(dens<0.3?0.08:0))nw=newTribe(ter,nx,ny);
else if(tFert[ni]>0.4&&distMin>20&&centers&&centers.length<8)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);if(!nf[ni]){nf[ni]=1;nfl.push(ni);}}}}
if(room&&!nf[fi]){nf[fi]=1;nfl.push(fi);}}
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
const ty2=Math.floor(i/tw),tx2=i%tw;
// Quick border check: skip interior tiles with no enemy neighbors
let hasEnemy=false;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no>=0&&no!==ow&&tElev[ni]>sl&&tribeSizes[no]>=16){hasEnemy=true;break;}}
if(!hasEnemy)continue;
const lpA=localPower(ter,ow,tx2,ty2);// only computed for border tiles
// Defender advantage: 3x base + tenure (up to +1.5x) + terrain (up to +1.4x) + river (up to +2x)
let def=3+Math.min(1.5,tenure[i]*0.008)+tDiff[i]*1.4;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===ow||tElev[ni]<=sl||tribeSizes[no]<16)continue;
// Avoid attacking tribes that are much larger (>3x your size)
const atkSz=tribeSizes[no],defSz=tribeSizes[ow];
if(defSz>0&&atkSz>0&&defSz/atkSz>3)continue;// don't poke the giant
// Small tribes are less aggressive; large tribes more so
const atkAggression=atkSz<25?0.4:atkSz>80?1.5:1.0;
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
for(const[ti,to]of flips){if(owner[ti]===to)continue;
const attackCost=tFert[ti]*0.3;// conquest cost
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
if(centers.length<2||tribeSizes[st]<15)continue;
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
// Cohesion: close + easy terrain = high, far + mountains = low
const cohesion=1/(1+dist*0.04+avgDiff*2);
if(cohesion>0.4){// High cohesion → capital relocates peacefully
const old=centers[0];centers[0]=centers[c];centers[0].prestige=Math.max(old.prestige,1.0);
centers.splice(c,1);centers.push({x:old.x,y:old.y,prestige:old.prestige*0.5,founded:old.founded});
}else{// Low cohesion → split: secondary center becomes a new tribe (if below cap)
let aliveT=0;for(let tt=0;tt<tribeSizes.length;tt++)if(tribeSizes[tt]>0)aliveT++;
if(aliveT>=40){break;}// tribe cap reached
const sc=centers.splice(c,1)[0];const sid=newTribe(ter,sc.x,sc.y);
// Transfer tiles closer to the breakaway center than to any remaining center
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;const iy=Math.floor(i/tw),ix=i%tw;
const dSec=tDistW(ix,iy,sc.x,sc.y,tw);
let dNearest=Infinity;for(const rc of centers)dNearest=Math.min(dNearest,tDistW(ix,iy,rc.x,rc.y,tw));
if(dSec<dNearest)transferTile(ter,i,sid);}}
break;// only one challenge per step per tribe
}}}
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
for(let c=1;c<comps.length;c++){const sid=newTribe(ter,comps[c][0]%tw,Math.floor(comps[c][0]/tw));
for(const ci of comps[c])transferTile(ter,ci,sid);}}ter._fragGen=gen;}
// ── Remnant absorption: tiny tribes (<5 tiles) absorbed by any larger touching neighbor ──
if(ter.stepCount%8===0){for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=0||tribeSizes[st]>10)continue;
let bn=-1,bs2=0;for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;const ty2=Math.floor(i/tw),tx2=i%tw;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===st||tElev[ni]<=sl)continue;if(tribeSizes[no]>bs2){bs2=tribeSizes[no];bn=no;}}}
if(bn>=0&&tribeSizes[bn]>tribeSizes[st]){for(let i=0;i<tw*th;i++)if(owner[i]===st)claimTile(ter,i,bn);}}}
return ter;}

// ── SINGLE CANVAS: terrain + overlay composited together ──
export default function WorldSim(){
const canvasRef=useRef(null);const[seed,setSeed]=useState(8817);const[world,setWorld]=useState(null);
const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState(5);
const[coverage,setCoverage]=useState(0);const[tribeCount,setTribeCount]=useState(1);const[dominant,setDominant]=useState(null);
const[viewMode,setViewMode]=useState("terrain");const[preset,setPreset]=useState(null);
const[oceanLevel,setOceanLevel]=useState(0.78);
const[depthFromSea,setDepthFromSea]=useState(false);
const[depthCeil,setDepthCeil]=useState(1.0);
const[showPlates,setShowPlates]=useState(false);
const[showRivers,setShowRivers]=useState(false);
const[showStreams,setShowStreams]=useState(false);
const[importStatus,setImportStatus]=useState(null);
const[hoverInfo,setHoverInfo]=useState(null);
const[tecPresetName,setTecPresetName]=useState("Default");
const[rightPanel,setRightPanel]=useState("");  // "" | "params"
const[showTuning,setShowTuning]=useState(false);
const[useRealWind,setUseRealWind]=useState(false);
const[useMercator,setUseMercator]=useState(false);
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
const oceanLevelRef=useRef(0.78);const depthFromSeaRef=useRef(false);const depthCeilRef=useRef(1.0);const showPlatesRef=useRef(false);const showRiversRef=useRef(false);const showStreamsRef=useRef(false);
const presetRef=useRef(null);const fileRef=useRef(null);const importedWorldRef=useRef(null);
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
useEffect(()=>{if(showGlobe&&worldRef.current){
const w=worldRef.current,sl=0,gW=4096,gH=2048;
const buf=new Uint8Array(gW*gH*3);
for(let ty=0;ty<gH;ty++){
const lat=Math.abs(ty/gH-0.5)*2;
const polarBlend=Math.max(0,Math.min(1,(lat-0.83)/0.17));
for(let tx=0;tx<gW;tx++){
// Bilinear sample from world data
const srcX=tx/gW*W,srcY=ty/gH*H;
const sx0=Math.min(W-2,srcX|0),sy0=Math.min(H-2,srcY|0);
const fx=srcX-sx0,fy=srcY-sy0;
const i00=sy0*W+sx0,i10=sy0*W+sx0+1,i01=(sy0+1)*W+sx0,i11=(sy0+1)*W+sx0+1;
const e=w.elevation[i00]*(1-fx)*(1-fy)+w.elevation[i10]*fx*(1-fy)+w.elevation[i01]*(1-fx)*fy+w.elevation[i11]*fx*fy;
const m=w.moisture[i00]*(1-fx)*(1-fy)+w.moisture[i10]*fx*(1-fy)+w.moisture[i01]*(1-fx)*fy+w.moisture[i11]*fx*fy;
const t=w.temperature[i00]*(1-fx)*(1-fy)+w.temperature[i10]*fx*(1-fy)+w.temperature[i01]*(1-fx)*fy+w.temperature[i11]*fx*fy;
let r,g,b;
if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl);r=c[0];g=c[1];b=c[2];}
// Swamp overlay on globe
if(e>sl&&w.swamp&&w.swamp[sy0*W+sx0]){r=40;g=58;b=38;}
if(polarBlend>0){const pr=e>0?230:20,pg=e>0?235:40,pb=e>0?240:80;
r=Math.round(r*(1-polarBlend)+pr*polarBlend);
g=Math.round(g*(1-polarBlend)+pg*polarBlend);
b=Math.round(b*(1-polarBlend)+pb*polarBlend);}
const ti3=(ty*gW+tx)*3;buf[ti3]=r;buf[ti3+1]=g;buf[ti3+2]=b;}}
setGlobeBuf(buf);setGlobeTexSize({w:gW,h:gH});
}},[showGlobe,world]);
// Re-render when projection changes or globe toggled off
useEffect(()=>{terrainCache.current=null;imgRef.current=null;windParticlesRef.current=null;
if(!showGlobe&&terRef.current) setTimeout(()=>draw(terRef.current),50);
},[useMercator,showGlobe]);

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
if(!canvasRef.current||!ter)return;const w=worldRef.current;if(!w)return;
const sl=0,vm=viewRef.current;
const ctx=canvasRef.current.getContext("2d");
if(!imgRef.current)imgRef.current=ctx.createImageData(CW,CH);
const img=imgRef.current;const d=img.data;
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
}else if(vm==="power"){
// Power view — one pixel per tile
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H)));
const e=w.elevation[sy*W+sx],ow=ter.owner[ti];let r,g,b;
if(e<=sl){r=4;g=5;b=12;}
else if(ow>=0){r=(tcR[ow]*0.15+10.5)|0;g=(tcG[ow]*0.15+10.5)|0;b=(tcB[ow]*0.15+10.5)|0;}
else{r=16;g=15;b=14;}
const pi4=ti<<2;d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="tribes"){
// Tribe-only view — one pixel per tile, feature tint from territory data
for(let ti=0;ti<N;ti++){
const e=ter.tElev[ti],ow=ter.owner[ti];let r,g,b;
if(e<=sl){r=6;g=8;b=16;}
else if(ow>=0){r=tcR[ow];g=tcG[ow];b=tcB[ow];}
else{r=22;g=20;b=18;}
const pi4=ti<<2;d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else if(vm==="value"){
// Tile value overlay — green (high value) → yellow → red (low value)
// Value = fertility + coast bonus + moderate elevation bonus
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,Math.round(screenYtoDataY(ty,CH,H))),si=sy*W+sx;
const e=w.elevation[si];const pi4=ti<<2;
if(e<=sl){d[pi4]=8;d[pi4+1]=12;d[pi4+2]=22;d[pi4+3]=255;continue;}
let v=ter.tFert[ti];
// Coast access bonus (trade, fishing)
if(ter.tCoast&&ter.tCoast[ti])v+=0.08;
// Moderate elevation sweet spot (defensible + habitable)
if(e>0.05&&e<0.2)v+=0.05;
// Extreme terrain penalty
if(e>0.4)v-=0.15;
v=Math.max(0,Math.min(1,v));
// Green(1.0) → Yellow(0.5) → Red(0.0)
let r,g,b;
if(v>0.5){const t2=(v-0.5)*2;r=((1-t2)*255)|0;g=200;b=((t2)*40)|0;}
else{const t2=v*2;r=220;g=(t2*200)|0;b=0;}
// Darken slightly with elevation for depth
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
if(e<=sl){// Ocean: show temperature with slight blue tint
const t=w.temperature[si];
const ot=Math.max(0,Math.min(1,t));
let r,g,b;
if(ot<0.2){const s=ot/0.2;r=(10+s*5)|0;g=(15+s*25)|0;b=(60+s*50)|0;}
else if(ot<0.5){const s=(ot-0.2)/0.3;r=(15+s*10)|0;g=(40+s*30)|0;b=(110-s*20)|0;}
else{const s=(ot-0.5)/0.5;r=(25+s*15)|0;g=(70-s*20)|0;b=(90-s*30)|0;}
d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;continue;}
const t=w.temperature[si];let r,g,b;
if(t<0.12){const s=t/0.12;r=(20+s*10)|0;g=(20+s*40)|0;b=(150+s*80)|0;}// deep blue (polar)
else if(t<0.25){const s=(t-0.12)/0.13;r=(30+s*10)|0;g=(60+s*80)|0;b=(230-s*30)|0;}// blue→cyan
else if(t<0.38){const s=(t-0.25)/0.13;r=(40-s*10)|0;g=(140+s*60)|0;b=(200-s*100)|0;}// cyan→green
else if(t<0.52){const s=(t-0.38)/0.14;r=(30+s*120)|0;g=(200+s*40)|0;b=(100-s*70)|0;}// green→yellow
else if(t<0.65){const s=(t-0.52)/0.13;r=(150+s*90)|0;g=(240-s*20)|0;b=(30-s*10)|0;}// yellow→orange
else if(t<0.78){const s=(t-0.65)/0.13;r=(240+s*15)|0;g=(220-s*80)|0;b=(20-s*10)|0;}// orange
else{const s=(t-0.78)/0.22;r=255;g=(140-s*100)|0;b=(10+s*5)|0;}// red (tropical)
// Darken with elevation for topographic context
const shade=1-Math.max(0,e-0.1)*0.4;
d[pi4]=(r*shade)|0;d[pi4+1]=(g*shade)|0;d[pi4+2]=(b*shade)|0;d[pi4+3]=255;}
}else{
// Default terrain view with tribe overlay — one pixel per tile
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w,ter);}
const tc=terrainCache.current;
for(let ti=0;ti<N;ti++){const ow=ter.owner[ti];
const pi4=ti<<2,ti3=ti*3;
if(ow>=0&&ter.tElev[ti]>sl){const alpha=ter.frontier[ti]?0.55:0.32,invA=1-alpha;
d[pi4]=(tc[ti3]*invA+tcR[ow]*alpha+.5)|0;d[pi4+1]=(tc[ti3+1]*invA+tcG[ow]*alpha+.5)|0;d[pi4+2]=(tc[ti3+2]*invA+tcB[ow]*alpha+.5)|0;
}else{d[pi4]=tc[ti3];d[pi4+1]=tc[ti3+1];d[pi4+2]=tc[ti3+2];}
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
// River overlay — Rivers: tributary+. Streams: streams only (separate toggle).
if(ter.rivers){const rm=ter.rivers.riverMag;
const rivers=showRiversRef.current,streams=showStreamsRef.current;
if(rivers||streams)for(let ti=0;ti<N;ti++){const mag=rm[ti];if(mag<1)continue;
const pi4=ti<<2;
if(mag>=4&&rivers){d[pi4]=55;d[pi4+1]=150;d[pi4+2]=245;}
else if(mag>=3&&rivers){d[pi4]=45;d[pi4+1]=120;d[pi4+2]=220;}
else if(mag>=2&&rivers){d[pi4]=35;d[pi4+1]=95;d[pi4+2]=190;}
else if(mag===1&&streams){const a=0.45;d[pi4]=(d[pi4]*(1-a)+25*a)|0;d[pi4+1]=(d[pi4+1]*(1-a)+65*a)|0;d[pi4+2]=(d[pi4+2]*(1-a)+150*a)|0;}}}
ctx.putImageData(img,0,0);
// Draw all tribe centers (tile coords — canvas is CW×CH)
for(let st=0;st<ter.tribeCenters.length;st++){const centers=ter.tribeCenters[st];
if(!centers||ter.tribeSizes[st]<=0)continue;const cr=tcR[st],cg=tcG[st],cb=tcB[st];
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x+0.5,cy2=dataYtoScreenY(centers[ci].y*RES,H,CH)+0.5;
const isCapital=ci===0,r2=isCapital?2.5:1.5;
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=isCapital?`rgb(${cr},${cg},${cb})`:`rgba(${cr},${cg},${cb},0.7)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+1,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.8)":"rgba(255,255,255,0.3)";ctx.lineWidth=isCapital?1:0.5;ctx.stroke();}}
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
// Power projection view hatching
if(vm==="power"&&ter){const tw2=ter.tw,th2=ter.th;
for(let ty2=0;ty2<th2;ty2+=2)for(let tx2=0;tx2<tw2;tx2+=2){
const ti=ty2*tw2+tx2;const ow2=ter.owner[ti];
if(ow2<0||ter.tElev[ti]<=0)continue;
const pop=ter.tribeStrength[ow2];if(pop<0.01)continue;
const lp=localPower(ter,ow2,tx2,ty2);
const ratio=lp/pop;const intensity=(ratio-0.03)/0.97;
const cr=tcR[ow2],cg=tcG[ow2],cb=tcB[ow2];
const alpha=0.1+Math.pow(intensity,0.7)*0.85;
ctx.strokeStyle=`rgba(${cr},${cg},${cb},${alpha})`;ctx.lineWidth=0.4+intensity*0.4;
ctx.beginPath();ctx.moveTo(tx2,ty2);ctx.lineTo(tx2+2,ty2+2);ctx.stroke();
if(intensity>0.3){ctx.beginPath();ctx.moveTo(tx2+2,ty2);ctx.lineTo(tx2,ty2+2);ctx.stroke();}}
// Draw power centers
for(let st=0;st<ter.tribeSizes.length;st++){if(ter.tribeSizes[st]<=0)continue;
const centers=ter.tribeCenters[st];if(!centers)continue;
const cr=tcR[st],cg=tcG[st],cb=tcB[st];
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x+0.5,cy2=dataYtoScreenY(centers[ci].y*RES,H,CH)+0.5;
const isCapital=ci===0,r2=isCapital?3:2;
ctx.beginPath();ctx.arc(cx2,cy2,r2+2,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.25)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.95)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+0.5,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.4)";ctx.lineWidth=isCapital?1:0.5;ctx.stroke();
if(isCapital){ctx.fillStyle="rgba(255,255,255,0.9)";ctx.font="bold 5px sans-serif";
ctx.fillText("\u2605",cx2-2.5,cy2+1.5);}}}}
},[updateTerrainCache,CH]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;depthCeilRef.current=depthCeil;showPlatesRef.current=showPlates;showRiversRef.current=showRivers;showStreamsRef.current=showStreams;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,depthCeil,showPlates,showRivers,showStreams,activeRes]);

useEffect(()=>{let fid,acc=0,last=performance.now();
const loop=now=>{fid=requestAnimationFrame(loop);if(!playRef.current||!terRef.current||!worldRef.current){last=now;return;}
acc+=now-last;last=now;const iv=Math.max(16,100/speedRef.current);
if(acc>=iv){acc=0;const sub=Math.max(1,Math.ceil(speedRef.current/3));
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
const t=createTerritory(worldRef.current);terRef.current=t;setTribeCount(t.tribes);setCoverage(0);setDominant(null);terrainCache.current=null;draw(t);}
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
const tempC=Math.round(temp*50-10);
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
setHoverInfo({x:ev.clientX,y:ev.clientY,elevM,tempC,moist,biome:biomeName,fert:fertVal,lat,wspd,wdir,wkmh,resources:tileRes,river:riverMag,riverAccum});
},[CW,CH]);
const onCanvasLeave=useCallback(()=>setHoverInfo(null),[]);
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
<button onClick={()=>setPresetAndGo(null)} style={{...lbs,color:preset===null?"#c9b87a":"#8a8474",
background:preset===null?"rgba(201,184,122,0.15)":"transparent"}}>Random</button>
<button onClick={()=>setPresetAndGo("earth")} style={{...lbs,...(preset==="earth"?{color:"rgb(100,160,220)",background:"rgba(100,160,220,0.15)"}:{})}}>Earth</button>
<button onClick={()=>setPresetAndGo("earth_sim")} style={{...lbs,...(preset==="earth_sim"?{color:"rgb(80,180,200)",background:"rgba(80,180,200,0.15)"}:{})}}>Earth (Sim)</button>
{preset==="earth_sim"&&<label style={{fontSize:10,color:useRealWind?"#6be":"#6a6458",cursor:"pointer",display:"flex",alignItems:"center",gap:3,padding:"0 4px"}}>
<input type="checkbox" checked={useRealWind} onChange={e=>{setUseRealWind(e.target.checked);useRealWindRef.current=e.target.checked;generate(seed)}}
style={{accentColor:"#6be",width:12,height:12}} />{isRealWindAvailable()?"Real Winds":"Real Winds (no data)"}</label>}
<button onClick={()=>setPresetAndGo("pangaea")} style={{...lbs,...(preset==="pangaea"?{color:"rgb(120,180,100)",background:"rgba(120,180,100,0.15)"}:{})}}>Pangaea</button>
<button onClick={()=>setPresetAndGo("tectonic")} style={{...lbs,...(preset==="tectonic"?{color:"rgb(180,120,100)",background:"rgba(180,120,100,0.15)"}:{})}}>Tectonic</button>
<button onClick={()=>setPresetAndGo("continental")} style={{...lbs,...(preset==="continental"?{color:"rgb(140,180,160)",background:"rgba(140,180,160,0.15)"}:{})}}>Continental</button>
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
<div style={{display:"flex",alignItems:"center",gap:4}}>
<span style={{color:"#6a6458",fontSize:9}}>Maps</span>
<input type="range" min={1} max={10} value={mapCount} onChange={e=>setMapCount(+e.target.value)}
style={{flex:1,accentColor:"#c9b87a"}} />
<span style={{color:"#8a8474",fontSize:9,minWidth:12,textAlign:"right"}}>{mapCount}</span>
</div>
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
:<canvas ref={canvasRef} width={CW} height={CH} onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave}
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
<div style={{fontWeight:"bold",marginBottom:2,color:hoverInfo.elevM<=0?"#4a6a8a":"#c9b87a"}}>{hoverInfo.biome}</div>
<div><span style={{color:"#8a8474"}}>Elev:</span> {hoverInfo.elevM}m</div>
<div><span style={{color:"#8a8474"}}>Temp:</span> {hoverInfo.tempC}°C</div>
<div><span style={{color:"#8a8474"}}>Moist:</span> {(hoverInfo.moist*100).toFixed(0)}%</div>
<div><span style={{color:"#8a8474"}}>Fert:</span> {(hoverInfo.fert*100).toFixed(0)}%</div>
<div><span style={{color:"#8a8474"}}>Wind:</span> {hoverInfo.wkmh} km/h {hoverInfo.wdir}</div>
<div><span style={{color:"#8a8474"}}>Lat:</span> {(hoverInfo.lat*90).toFixed(1)}°</div>
{hoverInfo.river>0&&<div><span style={{color:"#8a8474"}}>River:</span> <span style={{color:"#6ab4e8"}}>{RIVER_NAMES[hoverInfo.river]}</span> <span style={{color:"#5a5448",fontSize:9}}>({hoverInfo.riverAccum.toFixed(1)})</span></div>}
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
<div style={{position:"absolute",top:6,right:6,background:"rgba(6,8,16,0.85)",borderRadius:3,padding:"4px 10px",
display:"flex",gap:12,fontSize:11,color:"#c9b87a",pointerEvents:"none"}}>
<span>{tribeCount} tribes</span><span>{coverage}%</span>
{dominant&&<span style={{display:"inline-flex",alignItems:"center",gap:3}}>
<span style={{width:7,height:7,borderRadius:1,background:`rgb(${tribeRGB(dominant.id).join(",")})`,display:"inline-block"}} />
{dominant.size}t</span>}</div>

{/* ══ BOTTOM CENTER: VIEW/OVERLAY OPTIONS (larger) ══ */}
<div style={{position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",
background:"rgba(6,8,16,0.88)",borderRadius:4,padding:"6px 12px",
display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
{[["terrain","Terrain"],["depth","Depth"],["wind","Wind"],["moisture","Moisture"],["temperature","Temp"],["value","Value"],["resources","Resources"],["tribes","Tribes"],["power","Power"]].map(([k,label])=>(
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
{world&&world.pixPlate&&<button onClick={()=>{setShowPlates(v=>!v);showPlatesRef.current=!showPlatesRef.current;}}
style={{...bs,background:showPlates?"rgba(200,80,60,0.25)":"transparent",border:"none",
color:showPlates?"#e07050":"#5a5448",padding:"6px 12px",fontSize:12}}>Plates</button>}
<button onClick={()=>{setShowRivers(v=>!v);showRiversRef.current=!showRiversRef.current;}}
style={{...bs,background:showRivers?"rgba(60,140,220,0.25)":"transparent",border:"none",
color:showRivers?"#6ab4e8":"#5a5448",padding:"6px 12px",fontSize:12}}>Rivers</button>
<button onClick={()=>{setShowStreams(v=>!v);showStreamsRef.current=!showStreamsRef.current;}}
style={{...bs,background:showStreams?"rgba(60,120,180,0.25)":"transparent",border:"none",
color:showStreams?"#5a9aca":"#5a5448",padding:"6px 12px",fontSize:12}}>Streams</button>
<div style={{width:1,height:20,background:"rgba(201,184,122,0.15)"}} />
<span style={{color:"#8a8070",fontSize:11}}>Sea</span>
<input type="range" min="50" max="90" value={oceanLevel*100}
onChange={e=>{const v=Number(e.target.value)/100;setOceanLevel(v);oceanLevelRef.current=v;}}
onMouseUp={()=>generate(seed)} onTouchEnd={()=>generate(seed)}
style={{width:80,accentColor:"#6ab4e8"}} />
<button onClick={()=>setUseMercator(!useMercator)}
style={{...bs,background:useMercator?"rgba(180,160,100,0.25)":"transparent",border:"none",
color:useMercator?"#c9b87a":"#5a5448",padding:"6px 12px",fontSize:12}}>{useMercator?"Mercator":"Flat"}</button>
<button onClick={()=>setShowGlobe(!showGlobe)}
style={{...bs,background:showGlobe?"rgba(120,180,220,0.25)":"transparent",border:"none",
color:showGlobe?"#78b4dc":"#5a5448",padding:"6px 12px",fontSize:12}}>Globe</button>
{(preset==="tectonic"||preset==="earth"||preset==="earth_sim")&&<>
<div style={{width:1,height:20,background:"rgba(201,184,122,0.15)"}} />
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

{/* ══ TUNING OVERLAY ══ */}
{showTuning&&<TuningPanel noiseFns={{initNoise,fbm,ridged,noise2D,worley}} seed={seed}
  params={{..._tecParams}}
  onParamsChange={(p)=>{_tecParams=p;setTecPresetName("(unsaved)");generate(seed);}}
  onClose={()=>setShowTuning(false)} />}

</div>);}