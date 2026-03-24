import { useState, useEffect, useRef, useCallback } from "react";
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "./earthData.js";
import { generateTectonicWorld } from "./tectonicGen.js";
import { parseAzgaarJSON, rasterizeAzgaar, rasterizeHeightmap, loadImageFile } from "./mapImport.js";

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

const RES=2;

// Static climate: no ice ages or sea level changes
const CLIMATE={tempMod:0,seaLevel:0,wet:0.7};

function generateWorld(W,H,seed,preset,oceanLevel,enableRivers=true){
initNoise(seed);const rng=mkRng(seed);
const rawElev=new Float32Array(W*H),elevation=new Float32Array(W*H),moisture=new Float32Array(W*H),temperature=new Float32Array(W*H);
let tecPlates=null;
if(preset==="earth"){
// ── Earth mode: use real heightmap data ──
const eData=decodeEarth(EARTH_ELEV);
// Pass 1: elevation + temperature
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(eData,EARTH_W,EARTH_H,x,y,W,H);// 0-255
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){const depth=fbm(nx*8+50,ny*8+50,3,2,.5)*.04;
elevation[i]=-0.03-Math.max(0,(1-he/3))*0.12+depth;
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
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.06*.06))*.50*(1-coastProx*.5);// subtropical HP, weakened near coast (monsoon)
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.22;// temperate westerlies
const tropF=Math.max(0,1-lat*3);// tropical moisture recycling factor
const contRate=.006+(1-tropF)*.014;// weak in tropics, stronger elsewhere
const cont=Math.min(.28,cd*contRate);
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.42+tropWet*.42-subtropDry+tempWet-cont-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.12;
if(elevation[i]>.15)m-=Math.min(.2,(elevation[i]-.15)*1);
if(elevation[i]<.02)m+=.10;
moisture[i]=Math.max(.02,Math.min(1,m));}
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
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.06*.06))*.40;// subtropical HP belt
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.20;
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.40+tropWet*.35-subtropDry+tempWet-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.15;
if(e<0.06)m+=.15;// valleys are wet
if(e>0.3)m-=.15;// mountains are drier
moisture[i]=Math.max(.02,Math.min(1,m));
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
}else if(preset==="tectonic"){
// ── Tectonic plate mode: separate module ──
const tec=generateTectonicWorld(W,H,seed,{initNoise,fbm,ridged,noise2D,worley});
for(let i=0;i<W*H;i++){elevation[i]=tec.elevation[i];moisture[i]=tec.moisture[i];temperature[i]=tec.temperature[i];}
tecPlates=tec.pixPlate;
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
const subtropDry=Math.exp(-((lat-.28)*(lat-.28))/(2*.06*.06))*.50*(1-coastProx*.5);
const tempWet=Math.exp(-((lat-.55)*(lat-.55))/.025)*.22;
const tropF=Math.max(0,1-lat*3);
const contRate=.006+(1-tropF)*.014;
const cont=Math.min(.28,cd*contRate);
const polarDry=Math.max(0,(lat-.75))*.25;
let m=.42+tropWet*.42-subtropDry+tempWet-cont-polarDry+fbm(nx*4+50,ny*4+50,4,2,.55)*.12;
if(elevation[i]>.15)m-=Math.min(.2,(elevation[i]-.15)*1);
if(elevation[i]<.02)m+=.10;
moisture[i]=Math.max(.02,Math.min(1,m));}}
const ctw=Math.ceil(W/RES),cth=Math.ceil(H/RES);const coastal=new Uint8Array(ctw*cth);
for(let ty=1;ty<cth-1;ty++)for(let tx=0;tx<ctw;tx++){const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
if(elevation[py*W+px]>0){
outer:for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const wx=((tx+dx)%ctw+ctw)%ctw,wy=ty+dy;if(wy<0||wy>=cth)continue;
const npx=Math.min(W-1,wx*RES),npy=Math.min(H-1,wy*RES);
if(elevation[npy*W+npx]<=0){coastal[ty*ctw+tx]=1;break outer;}}}}
const emptyBuf=new Uint8Array(W*H);
const rvr=enableRivers?generateRivers(elevation,moisture,W,H,mkRng(seed+777)):{river:emptyBuf,lake:emptyBuf,floodplain:emptyBuf,delta:emptyBuf};
// Oases: small fertile pockets in deserts
const oasis=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elevation[i]>0&&elevation[i]<0.3&&temperature[i]>0.5&&moisture[i]<0.2){
const nv=fbm(x/W*50+200,y/H*50+200,3,2,.5);
if(nv>0.3){oasis[i]=1;moisture[i]=Math.min(1,moisture[i]+0.4);}}}
// Swamps: low-lying wet warm terrain
const swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elevation[i]>0&&elevation[i]<0.025&&moisture[i]>0.45&&temperature[i]>0.35&&!rvr.river[i]&&!rvr.lake[i]){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);
if(nv>-0.1)swamp[i]=1;}}
return{elevation,moisture,temperature,coastal,river:rvr.river,lake:rvr.lake,floodplain:rvr.floodplain,delta:rvr.delta,oasis,swamp,width:W,height:H,preset,pixPlate:tecPlates};}

// ── River & lake generation: trace flow downhill from wet highlands ──
function generateRivers(elev,moist,W,H,rng){
const flow=new Float32Array(W*H),lake=new Uint8Array(W*H),floodplain=new Uint8Array(W*H),delta=new Uint8Array(W*H);
const D8=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
// Collect source candidates: high elevation + wet
const cands=[];
for(let y=4;y<H-4;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elev[i]>0.1&&moist[i]>0.25)cands.push({x,y,score:elev[i]*0.6+moist[i]*0.4+rng()*0.15});}
cands.sort((a,b)=>b.score-a.score);
// Select spaced sources — denser network for larger maps
const sources=[],minSp=Math.round(W*0.03);
for(const c of cands){if(sources.length>=80)break;let ok=true;
for(const s of sources){let dx=Math.abs(c.x-s.x);if(dx>W/2)dx=W-dx;
if(dx*dx+(c.y-s.y)**2<minSp*minSp){ok=false;break;}}
if(ok)sources.push(c);}
// Trace each river downhill with natural meandering
for(const src of sources){let cx=src.x,cy=src.y,str=0.3+moist[src.y*W+src.x]*0.7;
let prevDx=0,prevDy=0;// momentum for smooth curves
const path=new Set();
for(let step=0;step<1200;step++){const ci=cy*W+cx;if(path.has(ci))break;path.add(ci);
flow[ci]+=str;str+=0.025;
if(elev[ci]<=0){// River reached ocean — create delta if strong enough
if(str>4){const dR=Math.min(12,Math.round(2+str*0.4));
for(let dy=-dR;dy<=dR;dy++)for(let dx=-dR;dx<=dR;dx++){
const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
const d2=dx*dx+dy*dy;if(d2>dR*dR)continue;
const ni=ny*W+nx;if(elev[ni]>-0.02&&elev[ni]<0.025)delta[ni]=1;}}
break;}
// Gather downhill unvisited neighbors
const downs=[];let be=elev[ci];
for(const[ddx,ddy]of D8){const nx=((cx+ddx)%W+W)%W,ny=cy+ddy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;if(!path.has(ni)&&elev[ni]<elev[ci]){downs.push({x:nx,y:ny,e:elev[ni],dx:ddx,dy:ddy});
if(elev[ni]<be)be=elev[ni];}}
if(downs.length>0){const slope=elev[ci]-be;
// Natural meandering: blend steepest descent with momentum and noise
const meanderStr=Math.min(1,0.012/(slope+0.003));
const nv=noise2D(cx*0.12+step*0.06,cy*0.12)*Math.PI;
let best=downs[0],bestScore=-Infinity;
for(const d of downs){const steep=elev[ci]-d.e;
const momScore=d.dx*prevDx+d.dy*prevDy;
const angle=Math.atan2(d.dy,d.dx);
const noiseScore=Math.cos(angle-nv)*meanderStr;
const score=steep*(1-meanderStr*0.4)+momScore*0.15*meanderStr+noiseScore*0.3;
if(score>bestScore){bestScore=score;best=d;}}
prevDx=best.dx;prevDy=best.dy;
cx=best.x;cy=best.y;continue;}
// Depression: scan outward for an outlet lower than current elevation
const ce=elev[ci];let found=false;
for(let r=2;r<=20&&!found;r++){let bestD=Infinity,ox=-1,oy=-1;
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;if(elev[ni]<ce&&!path.has(ni)){const d2=dx*dx+dy*dy;
if(d2<bestD){bestD=d2;ox=nx;oy=ny;}}}
if(ox>=0){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
if(dx*dx+dy*dy<=r*r&&elev[ny*W+nx]<=ce+0.008)lake[ny*W+nx]=1;}
cx=ox;cy=oy;found=true;}}
if(!found)break;}}
// Normalize flow and expand width based on flow strength
let mx=0;for(let i=0;i<W*H;i++)if(flow[i]>mx)mx=flow[i];
const base=new Uint8Array(W*H);
if(mx>0)for(let i=0;i<W*H;i++){if(flow[i]>0.2)base[i]=Math.min(255,Math.round(Math.sqrt(flow[i]/mx)*200)+55);}
// Width expansion: strong rivers get wider, gradual taper
const river=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!base[i])continue;
const r=base[i]>180?3:base[i]>120?2:base[i]>60?1:0;
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
const nx=((x+dx)%W+W)%W,ny=y+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;const d2=dx*dx+dy*dy;if(d2>r*r)continue;
if(elev[ni]>0){const fade=Math.round(base[i]*(1-Math.sqrt(d2)/(r+1)*0.4));
river[ni]=Math.max(river[ni],fade);}}}
// Floodplains: fertile bands adjacent to rivers
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!river[i]||elev[i]<=0)continue;
const fR=river[i]>150?5:river[i]>80?3:2;
for(let dy=-fR;dy<=fR;dy++)for(let dx=-fR;dx<=fR;dx++){
const nx=((x+dx)%W+W)%W,ny=y+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;const d2=dx*dx+dy*dy;if(d2>fR*fR)continue;
if(elev[ni]>0&&!river[ni]&&!lake[ni]&&Math.abs(elev[ni]-elev[i])<0.03)floodplain[ni]=1;}}
return{river,lake,floodplain,delta};}

const BC=[
[10,22,56],      // 0  Deep Ocean
[20,48,95],      // 1  Shallow Ocean
[36,78,125],     // 2  Coastal Water
[194,182,140],   // 3  Beach (unused)
[170,178,168],   // 4  Tundra
[232,238,245],   // 5  Snow / Ice
[68,98,68],      // 6  Taiga
[48,80,52],      // 7  Boreal Forest
[58,125,48],     // 8  Temperate Forest
[28,98,55],      // 9  Temperate Rainforest
[16,74,30],      // 10 Tropical Rainforest
[176,168,72],    // 11 Savanna
[142,162,58],    // 12 Grassland
[204,184,126],   // 13 Desert
[132,140,72],    // 14 Shrubland
[68,114,45],     // 15 Tropical Dry Forest
[146,140,130]    // 16 Barren / Alpine
];
const BN=['Deep Ocean','Shallow Ocean','Coastal Water','Beach','Tundra','Snow / Ice','Taiga',
'Boreal Forest','Temperate Forest','Temperate Rainforest','Tropical Rainforest','Savanna',
'Grassland','Desert','Shrubland','Tropical Dry Forest','Barren / Alpine'];
function getBiomeD(e,m,t,sl){
  if(e<=sl)return e<sl-.08?0:e<sl-.01?1:2;
  // Alpine / montane (elevation overrides)
  if(e>.55)return t<.3?5:16;
  if(e>.42)return t<.25?5:t<.4?(m>.35?7:4):m>.4?8:16;
  // Polar / subpolar
  if(t<.15)return 4;
  if(t<.25)return m>.35?6:4;
  if(t<.38)return m>.45?7:m>.25?6:4;
  // Temperate
  if(t<.55)return m>.55?9:m>.35?8:m>.15?12:13;
  // Warm
  if(t<.72)return m>.5?8:m>.3?15:m>.15?14:13;
  // Hot / tropical
  return m>.5?10:m>.3?15:m>.18?11:m>.08?12:13;
}
function getColorD(e,m,t,sl){const c=BC[getBiomeD(e,m,t,sl)],v=((e*37.7+m*17.3+t*53.1)%1+1)%1;
return[(c[0]+(v-.5)*10)|0,(c[1]+(v-.5)*10)|0,(c[2]+(v-.5)*8)|0];}
function tribeRGB(id){const h=((id*67+20)%360)/360,s=(60+((id*31)%25))/100,l=(45+((id*17)%25))/100;
const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const hr=(pp,qq,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return pp+(qq-pp)*6*t;if(t<1/2)return qq;if(t<2/3)return pp+(qq-pp)*(2/3-t)*6;return pp;};
return[Math.round(hr(p,q,h+1/3)*255),Math.round(hr(p,q,h)*255),Math.round(hr(p,q,h-1/3)*255)];}

function tileFert(t,m,e){if(e>0.45)return 0.05;const base=Math.min(1,t*1.2)*Math.min(1,m*1.3);return Math.max(0.05,base*(1-Math.max(0,e-0.15)*3));}

const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
const LEAPS=[];for(let r=5;r<=13;r++)for(let a=0;a<8;a++){const ang=a*Math.PI/4;LEAPS.push([Math.round(Math.cos(ang)*r),Math.round(Math.sin(ang)*r)]);}

function createTerritory(w){
const tw=Math.ceil(w.width/RES),th=Math.ceil(w.height/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th),tDiff=new Float32Array(tw*th),tRiver=new Uint8Array(tw*th),owner=new Int16Array(tw*th).fill(-1),tribeSizes=[],tribeStrength=[],tribeCenters=[];
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){const px=Math.min(w.width-1,tx*RES),py=Math.min(w.height-1,ty*RES),i=py*w.width+px;
const ti=ty*tw+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti];
const e=w.elevation[i],t=w.temperature[i],m=w.moisture[i];let diff=0;
if(e>0.35)diff=Math.max(diff,Math.min(1,(e-0.35)*3));if(t>0.5&&m<0.2)diff=Math.max(diff,Math.min(0.85,(0.2-m)*3*(t-0.3)));
if(t<0.2)diff=Math.max(diff,Math.min(0.9,(0.2-t)*4));tDiff[ti]=diff;tFert[ti]=tileFert(t,m,e);
// Feature scan: check pixels in this tile's block for rivers, floodplains, deltas, oases, swamps
{let hasWater=false,hasFlood=false,hasDelta=false,hasOasis=false,hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(w.height-1,py+dy)*w.width+Math.min(w.width-1,px+dx);
if(w.river&&w.river[wi]>0&&e>0)hasWater=true;
if(w.lake&&w.lake[wi]&&e>0)hasWater=true;
if(w.floodplain&&w.floodplain[wi])hasFlood=true;
if(w.delta&&w.delta[wi])hasDelta=true;
if(w.oasis&&w.oasis[wi])hasOasis=true;
if(w.swamp&&w.swamp[wi])hasSwamp=true;}
if(hasWater){tMoist[ti]=Math.min(1,tMoist[ti]+0.2);tFert[ti]=Math.min(1,tFert[ti]+0.15);tRiver[ti]=1;}
if(hasDelta){tFert[ti]=Math.min(1,tFert[ti]+0.35);tMoist[ti]=Math.min(1,tMoist[ti]+0.3);}
else if(hasFlood){tFert[ti]=Math.min(1,tFert[ti]+0.25);tMoist[ti]=Math.min(1,tMoist[ti]+0.15);}
if(hasOasis){tFert[ti]=Math.min(1,tFert[ti]+0.3);tDiff[ti]=Math.max(0,tDiff[ti]-0.3);}
if(hasSwamp){tFert[ti]=Math.min(1,tFert[ti]+0.2);tDiff[ti]=Math.min(1,tDiff[ti]+0.25);}}}
// Find multiple spread-out seed locations for starting tribes
const NUM_TRIBES=w.preset==="earth"?8:w.preset==="import"&&w.tribeSeeds&&w.tribeSeeds.length>0?w.tribeSeeds.length:6;const minSpacing=Math.round(tw*0.12);
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
else if(w.preset==="earth"){// Seed East Africa first (cradle of mankind)
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
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tRiver,owner,tenure,tribeCenters,tribeSizes,tribeStrength,
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
const sl=0,wet=0.7;const{tw,th,tElev,tTemp,tCoast,tDiff,tFert,tRiver,owner,tribeCenters,tribeSizes,tribeStrength}=ter;ter.stepCount++;
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
if(ter.stepCount%4===0){const flips=[];const{tenure,tRiver}=ter;
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
if(tRiver[i])def+=2;// rivers are very hard to cross
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===ow||tElev[ni]<=sl||tribeSizes[no]<16)continue;
// Avoid attacking tribes that are much larger (>3x your size)
const atkSz=tribeSizes[no],defSz=tribeSizes[ow];
if(defSz>0&&atkSz>0&&defSz/atkSz>3)continue;// don't poke the giant
// Small tribes are less aggressive; large tribes more so
const atkAggression=atkSz<25?0.4:atkSz>80?1.5:1.0;
// River between attacker and defender tiles: additional crossing penalty
let riverCross=0;if(tRiver[ni])riverCross+=1.5;
const lpB=localPower(ter,no,tx2,ty2);// attacker's projected power at this tile
const totalDef=def+riverCross;
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
const[showPlates,setShowPlates]=useState(false);
const[importStatus,setImportStatus]=useState(null);
const[showRivers,setShowRivers]=useState(true);
const[hoverInfo,setHoverInfo]=useState(null);
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(5),viewRef=useRef("terrain");
const oceanLevelRef=useRef(0.78);const depthFromSeaRef=useRef(false);const showPlatesRef=useRef(false);
const presetRef=useRef(null);const fileRef=useRef(null);const importedWorldRef=useRef(null);
const showRiversRef=useRef(true);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
// Reuse ImageData between frames to avoid 7.3MB allocation per draw
const imgRef=useRef(null);
const W=1920,H=960,CW=Math.ceil(W/RES),CH=Math.ceil(H/RES);
const generate=useCallback((s,ol)=>{
let w;
if(presetRef.current==="import"&&importedWorldRef.current){w=importedWorldRef.current;importedWorldRef.current=null;}
else{w=generateWorld(W,H,s,presetRef.current,ol!==undefined?ol:oceanLevelRef.current,showRiversRef.current);}
setWorld(w);worldRef.current=w;const t=createTerritory(w);terRef.current=t;
setCoverage(0);setTribeCount(t.tribes);setPlaying(false);playRef.current=false;
terrainCache.current=null;imgRef.current=null;},[]);
useEffect(()=>{generate(seed)},[seed,generate]);

// Build terrain RGB cache at tile resolution (one entry per tile)
const updateTerrainCache=useCallback((w)=>{
const buf=new Uint8Array(CW*CH*3);const sl=0;
for(let ty=0;ty<CH;ty++)for(let tx=0;tx<CW;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES);
const si=sy*W+sx;const e=w.elevation[si],m=w.moisture[si];
const t=w.temperature[si];let r,g,b;
if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl);r=c[0];g=c[1];b=c[2];}
// Scan tile block for most prominent feature overlay
let hasDelta=false,hasLake=false,maxRiv=0,hasSwamp=false,hasOasis=false,hasFlood=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(H-1,sy+dy)*W+Math.min(W-1,sx+dx);
if(w.delta&&w.delta[wi])hasDelta=true;
if(w.lake&&w.lake[wi]&&e>sl)hasLake=true;
if(w.river&&w.river[wi]&&e>sl&&w.river[wi]>maxRiv)maxRiv=w.river[wi];
if(w.swamp&&w.swamp[wi])hasSwamp=true;
if(w.oasis&&w.oasis[wi])hasOasis=true;
if(w.floodplain&&w.floodplain[wi])hasFlood=true;}
let pr=r,pg=g,pb=b;
if(hasDelta){pr=30;pg=85;pb=55;}
else if(hasLake){pr=28;pg=62;pb=112;}
else if(maxRiv>0){const a=0.45+maxRiv/255*0.45;
pr=(r*(1-a)+22*a+.5)|0;pg=(g*(1-a)+52*a+.5)|0;pb=(b*(1-a)+132*a+.5)|0;}
else if(e>sl){if(hasSwamp){pr=40;pg=58;pb=38;}
else if(hasOasis){pr=50;pg=120;pb=45;}
else if(hasFlood){const a=0.4;pr=(r*(1-a)+55*a+.5)|0;pg=(g*(1-a)+110*a+.5)|0;pb=(b*(1-a)+40*a+.5)|0;}}
const ti3=(ty*CW+tx)*3;buf[ti3]=pr;buf[ti3+1]=pg;buf[ti3+2]=pb;}
return buf;},[]);

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
const si=Math.min(H-1,ty*RES)*W+Math.min(W-1,tx*RES);
const e=w.elevation[si];if(e<eMin)eMin=e;if(e>eMax)eMax=e;}
// Sea mode: floor is 0 (sea level), all ocean = black
// Floor mode: floor is actual minimum, deepest trench = black
const floor=depthFromSeaRef.current?0:eMin;
const range=eMax-floor||1;
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES),si=sy*W+sx;
const e=w.elevation[si];
const v=Math.min(255,Math.max(0,((e-floor)/range)*255))|0;
const pi4=ti<<2;d[pi4]=v;d[pi4+1]=v;d[pi4+2]=v;d[pi4+3]=255;}
}else if(vm==="power"){
// Power view — one pixel per tile
for(let ti=0;ti<N;ti++){const tx=ti%CW,ty=(ti/CW)|0;
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES);
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
// River/lake tint on owned tiles
if(e>sl&&ter.tRiver[ti]){const a=0.4;r=(r*(1-a)+12*a+.5)|0;g=(g*(1-a)+20*a+.5)|0;b=(b*(1-a)+45*a+.5)|0;}
const pi4=ti<<2;d[pi4]=r;d[pi4+1]=g;d[pi4+2]=b;d[pi4+3]=255;}
}else{
// Default terrain view with tribe overlay — one pixel per tile
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w);}
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
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES);
const myP=plateAt(sx,sy);let boundary=false;
for(let dy=-RES;dy<=RES&&!boundary;dy+=RES)for(let dx=-RES;dx<=RES&&!boundary;dx+=RES){
if(!dx&&!dy)continue;
const nx2=(sx+dx+W)%W,ny2=sy+dy;if(ny2<0||ny2>=H)continue;
if(plateAt(nx2,ny2)!==myP)boundary=true;}
if(boundary){const pi4=ti<<2;d[pi4]=200;d[pi4+1]=60;d[pi4+2]=40;}}}
ctx.putImageData(img,0,0);
// Draw all tribe centers (tile coords — canvas is CW×CH)
for(let st=0;st<ter.tribeCenters.length;st++){const centers=ter.tribeCenters[st];
if(!centers||ter.tribeSizes[st]<=0)continue;const cr=tcR[st],cg=tcG[st],cb=tcB[st];
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x+0.5,cy2=centers[ci].y+0.5;
const isCapital=ci===0,r2=isCapital?2.5:1.5;
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=isCapital?`rgb(${cr},${cg},${cb})`:`rgba(${cr},${cg},${cb},0.7)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+1,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.8)":"rgba(255,255,255,0.3)";ctx.lineWidth=isCapital?1:0.5;ctx.stroke();}}
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
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x+0.5,cy2=centers[ci].y+0.5;
const isCapital=ci===0,r2=isCapital?3:2;
ctx.beginPath();ctx.arc(cx2,cy2,r2+2,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.25)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.95)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+0.5,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.4)";ctx.lineWidth=isCapital?1:0.5;ctx.stroke();
if(isCapital){ctx.fillStyle="rgba(255,255,255,0.9)";ctx.font="bold 5px sans-serif";
ctx.fillText("\u2605",cx2-2.5,cy2+1.5);}}}}
},[updateTerrainCache]);

useEffect(()=>{viewRef.current=viewMode;depthFromSeaRef.current=depthFromSea;showPlatesRef.current=showPlates;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode,depthFromSea,showPlates]);

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
const emptyArr=new Uint8Array(W*H);
const rvr=showRiversRef.current?generateRivers(w.elevation,w.moisture,W,H,mkRng(seed+777)):{river:emptyArr,lake:emptyArr,floodplain:emptyArr,delta:emptyArr};
w.river=rvr.river;w.lake=rvr.lake;w.floodplain=rvr.floodplain;w.delta=rvr.delta;
const oasis=new Uint8Array(W*H),swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(w.elevation[i]>0&&w.elevation[i]<0.3&&w.temperature[i]>0.5&&w.moisture[i]<0.2){
const nv=fbm(x/W*50+200,y/H*50+200,3,2,.5);if(nv>0.3){oasis[i]=1;w.moisture[i]=Math.min(1,w.moisture[i]+0.4);}}
if(w.elevation[i]>0&&w.elevation[i]<0.025&&w.moisture[i]>0.45&&w.temperature[i]>0.35&&!rvr.river[i]&&!rvr.lake[i]){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);if(nv>-0.1)swamp[i]=1;}}
w.oasis=oasis;w.swamp=swamp;
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
const wx=Math.floor(sx)*RES,wy=Math.floor(sy)*RES;
const w=worldRef.current,i=wy*1920+wx;
if(wx<0||wx>=1920||wy<0||wy>=960){setHoverInfo(null);return;}
const elev=w.elevation[i]||0;
const val=elev<=0?0:Math.round(elev*8000);
setHoverInfo({x:ev.clientX,y:ev.clientY,val});
},[CW,CH]);
const onCanvasLeave=useCallback(()=>setHoverInfo(null),[]);
return(
<div style={{width:"100vw",height:"100vh",background:"#060810",overflow:"hidden",position:"relative"}}>
<canvas ref={canvasRef} width={CW} height={CH} onMouseMove={onCanvasMove} onMouseLeave={onCanvasLeave}
style={{display:"block",imageRendering:"pixelated",maxWidth:"100%",maxHeight:"100%",width:"auto",height:"auto",aspectRatio:`${CW}/${CH}`,margin:"auto",position:"absolute",inset:0}} />
{hoverInfo&&<div style={{position:"fixed",left:hoverInfo.x+12,top:hoverInfo.y-8,
background:"rgba(6,8,16,0.85)",color:"#c9b87a",fontSize:10,padding:"1px 5px",
borderRadius:2,pointerEvents:"none",whiteSpace:"nowrap"}}>{hoverInfo.val}m</div>}
{/* Biome legend — left side, terrain view only */}
{viewMode==="terrain"&&<div style={{position:"absolute",top:6,left:6,background:"rgba(6,8,16,0.82)",
borderRadius:3,padding:"5px 8px",pointerEvents:"none",fontSize:9,lineHeight:"14px",color:"#b0a888"}}>
{[4,5,6,7,8,9,10,15,11,12,14,13,16].map(bi=>(
<div key={bi} style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
<span style={{display:"inline-block",width:10,height:8,borderRadius:1,flexShrink:0,
background:`rgb(${BC[bi][0]},${BC[bi][1]},${BC[bi][2]})`}} />
<span>{BN[bi]}</span></div>))}</div>}
{/* Stats overlay — top right */}
<div style={{position:"absolute",top:6,right:6,background:"rgba(6,8,16,0.85)",borderRadius:3,padding:"4px 10px",
display:"flex",gap:12,fontSize:11,color:"#c9b87a",pointerEvents:"none"}}>
<span>{tribeCount} tribes</span><span>{coverage}%</span>
{dominant&&<><span style={{display:"inline-flex",alignItems:"center",gap:3}}>
<span style={{width:7,height:7,borderRadius:1,background:`rgb(${tribeRGB(dominant.id).join(",")})`,display:"inline-block"}} />
{dominant.size}t</span></>}</div>
{/* Controls — bottom, overlaid on map */}
<div style={{position:"absolute",bottom:6,left:"50%",transform:"translateX(-50%)",
background:"rgba(6,8,16,0.85)",borderRadius:3,padding:"5px 8px",
display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
<button onClick={togglePlay} style={{...bs,color:playing?"#e0a090":"#c9b87a",
background:playing?"rgba(200,80,60,0.15)":"rgba(201,184,122,0.1)",padding:"4px 16px"}}>
{playing?"❚❚":"▶"}</button>
<input type="range" min={1} max={10} value={speed} onChange={e=>{setSpeed(+e.target.value);speedRef.current=+e.target.value}}
style={{width:50,accentColor:"#c9b87a"}} />
<button onClick={()=>{presetRef.current=null;setPreset(null);setSeed(Math.floor(Math.random()*999999));}} style={bs}>Random</button>
<button onClick={()=>{presetRef.current="earth";setPreset("earth");setSeed(Math.floor(Math.random()*999999));}}
style={bsA(preset==="earth","100,160,220")}>Earth</button>
<button onClick={()=>{presetRef.current="pangaea";setPreset("pangaea");setSeed(Math.floor(Math.random()*999999));}}
style={bsA(preset==="pangaea","120,180,100")}>Pangaea</button>
<button onClick={()=>{presetRef.current="tectonic";setPreset("tectonic");setSeed(Math.floor(Math.random()*999999));}}
style={bsA(preset==="tectonic","180,120,100")}>Tectonic</button>
<button onClick={()=>{presetRef.current="continental";setPreset("continental");setSeed(Math.floor(Math.random()*999999));}}
style={bsA(preset==="continental","140,180,160")}>Continental</button>
<div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
<input ref={fileRef} type="file" accept=".json,.map,.png,.jpg,.jpeg,.webp" style={{display:"none"}} onChange={handleImport} />
<button onClick={()=>fileRef.current?.click()} style={bsA(preset==="import","180,140,200")}
title="Import Azgaar JSON or heightmap image">Import</button>
{importStatus&&<span style={{fontSize:9,color:"#a99ed0",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{importStatus}</span>}
<div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
{[["terrain","Ter"],["depth","Dep"],["tribes","Tri"],["power","Pow"]].map(([k,label])=>(
<button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}}
style={{...bs,background:viewMode===k?"rgba(201,184,122,0.2)":"transparent",border:"none",
color:viewMode===k?"#c9b87a":"#5a5448",padding:"3px 7px"}}>{label}</button>))}
{viewMode==="depth"&&<><div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
<button onClick={()=>{setDepthFromSea(v=>!v);depthFromSeaRef.current=!depthFromSeaRef.current;}}
style={{...bs,background:depthFromSea?"rgba(80,140,200,0.25)":"transparent",border:"none",
color:depthFromSea?"#6ab4e8":"#5a5448",padding:"3px 7px",fontSize:"10px"}}>{depthFromSea?"Sea":"Floor"}</button></>}
{world&&world.pixPlate&&<><div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
<button onClick={()=>{setShowPlates(v=>!v);showPlatesRef.current=!showPlatesRef.current;}}
style={{...bs,background:showPlates?"rgba(200,80,60,0.25)":"transparent",border:"none",
color:showPlates?"#e07050":"#5a5448",padding:"3px 7px",fontSize:"10px"}}>Plates</button></>}
<div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
<span style={{color:"#8a8070",fontSize:"10px",marginRight:4}}>Sea</span>
<input type="range" min="50" max="90" value={oceanLevel*100}
onChange={e=>{const v=Number(e.target.value)/100;setOceanLevel(v);oceanLevelRef.current=v;}}
onMouseUp={()=>generate(seed)}
onTouchEnd={()=>generate(seed)}
style={{width:60,accentColor:"#6ab4e8"}} />
<div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
<button onClick={()=>{const nv=!showRiversRef.current;showRiversRef.current=nv;setShowRivers(nv);generate(seed);}}
style={{...bs,background:showRivers?"rgba(40,120,200,0.25)":"transparent",border:"none",
color:showRivers?"#6ab4e8":"#5a5448",padding:"3px 7px",fontSize:"10px"}}>Rivers</button>
</div></div>);}