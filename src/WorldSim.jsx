import { useState, useEffect, useRef, useCallback } from "react";
import { EARTH_ELEV, EARTH_MOIST, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "./earthData.js";

const PERM=new Uint8Array(512);const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed){const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){seed=(seed*16807)%2147483647;const j=seed%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)PERM[i]=p[i&255];}
function noise2D(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));return l1+v*(l2-l1);}
function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}
function mkRng(s){s=((s%2147483647)+2147483647)%2147483647||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}

const RES=2;

// Static climate: no ice ages or sea level changes
const CLIMATE={tempMod:0,seaLevel:0,wet:0.7};

function generateWorld(W,H,seed,preset){
initNoise(seed);const rng=mkRng(seed);
const rawElev=new Float32Array(W*H),elevation=new Float32Array(W*H),moisture=new Float32Array(W*H),temperature=new Float32Array(W*H);
if(preset==="earth"){
// ── Earth mode: use real heightmap data ──
const eData=decodeEarth(EARTH_ELEV),mData=decodeEarth(EARTH_MOIST);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(eData,EARTH_W,EARTH_H,x,y,W,H);// 0-255
// Convert heightmap byte to elevation: 0=ocean, >0=land
// Add subtle fbm noise for coastline variation and terrain detail
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){// Ocean
const depth=fbm(nx*8+50,ny*8+50,3,2,.5)*.04;
elevation[i]=-0.03-Math.max(0,(1-he/3))*0.12+depth;
}else{// Land: map 3-255 to ~0.005-0.6 elevation
let e=(he-3)/252*0.55+0.005+noise;
elevation[i]=Math.max(0.001,e);}
// Moisture from heightmap data
const hm=sampleEarth(mData,EARTH_W,EARTH_H,x,y,W,H)/255;// 0-1
const mNoise=fbm(nx*6+50,ny*6+50,3,2,.5)*.08;
moisture[i]=Math.max(0,Math.min(1,hm+mNoise));
// Temperature: latitude + elevation based
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,elevation[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));}
}else if(preset==="pangaea"){
// ── Pangaea mode: 100% land with mountains, valleys, climate ──
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
// Base elevation: always land, varied terrain from fbm
let e=0.08+fbm(nx*6+3.7,ny*6+3.7,5,2,.5)*.15
+Math.pow(Math.max(0,fbm(nx*3+20,ny*3+20,4,2.2,.5)),2)*.4// mountain ranges
+fbm(nx*14+7,ny*14+7,3,2,.4)*.06// fine detail
+Math.pow(1-Math.abs(fbm(nx*2.5+40,ny*2.5+40,3,2.1,.5)),4)*.25;// ridges
// Polar highlands
if(lat>.8)e+=Math.max(0,(lat-.8)*1.5);
// Valley systems (subtract to create lowlands)
e-=Math.pow(Math.max(0,fbm(nx*4+60,ny*4+60,3,2,.5)+.1),2)*.15;
elevation[i]=Math.max(0.005,e);
// Moisture: latitude + noise, valleys wetter, mountains drier
let m=fbm(nx*4+50,ny*4+50,4,2,.55)*.35+.4+(1-lat)*.15;
if(e<0.06)m+=.2;// valleys are wet
if(e>0.3)m-=.15;// mountains are drier
moisture[i]=Math.max(0.05,Math.min(1,m));
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
}else{
// ── Random world mode: procedural ellipse generation ──
const specs=[];
for(let i=0;i<5+Math.floor(rng()*4);i++)specs.push({cx:rng(),cy:.06+rng()*.88,rx:.09+rng()*.2,ry:.07+rng()*.15,rot:rng()*Math.PI,no:rng()*100,str:.75+rng()*.5});
for(let i=0;i<5+Math.floor(rng()*6);i++)specs.push({cx:rng(),cy:.1+rng()*.8,rx:.025+rng()*.05,ry:.015+rng()*.04,rot:rng()*Math.PI,no:rng()*100,str:.45+rng()*.35});
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const nx=x/W,ny=y/H;let e=0;
for(const c of specs){let dx=nx-c.cx;if(dx>.5)dx-=1;if(dx<-.5)dx+=1;let dy=ny-c.cy;
dx+=fbm(nx*5+c.no,ny*5+c.no,4,2,.5)*.045;dy+=fbm(nx*5+c.no+30,ny*5+c.no+30,4,2,.5)*.045;
const cs=Math.cos(c.rot),sn=Math.sin(c.rot);let dd=Math.sqrt(Math.pow((dx*cs+dy*sn)/c.rx,2)+Math.pow((-dx*sn+dy*cs)/c.ry,2));
dd+=fbm(nx*16+c.no+50,ny*16+c.no+50,3,2.3,.45)*.18;if(dd<1){const f2=1-dd;e+=f2*f2*c.str;}}
e+=fbm(nx*8+3.7,ny*8+3.7,5,2,.5)*.12+Math.pow(1-Math.abs(fbm(nx*4.5+30,ny*4.5+30,4,2.2,.5)),3)*.15+fbm(nx*22+7,ny*22+7,2,2,.4)*.04;
rawElev[y*W+x]=e;}
const sorted=Float32Array.from(rawElev).sort();const sl=sorted[Math.floor(W*H*.7)];
const isLandArr=new Uint8Array(W*H);for(let i=0;i<W*H;i++)isLandArr[i]=rawElev[i]>sl?1:0;
const DG=RES,dw=Math.ceil(W/DG),dh=Math.ceil(H/DG);const dtl=new Float32Array(dw*dh).fill(9999);
for(let dy=0;dy<dh;dy++)for(let dx=0;dx<dw;dx++){if(isLandArr[Math.min(H-1,dy*DG)*W+Math.min(W-1,dx*DG)])dtl[dy*dw+dx]=0;}
for(let p=0;p<2;p++){for(let dy=0;dy<dh;dy++)for(let dx=0;dx<dw;dx++){const i=dy*dw+dx;
if(dx>0)dtl[i]=Math.min(dtl[i],dtl[i-1]+1);if(dx===0)dtl[i]=Math.min(dtl[i],dtl[dy*dw+dw-1]+1);
if(dy>0)dtl[i]=Math.min(dtl[i],dtl[(dy-1)*dw+dx]+1);}
for(let dy=dh-1;dy>=0;dy--)for(let dx=dw-1;dx>=0;dx--){const i=dy*dw+dx;
if(dx<dw-1)dtl[i]=Math.min(dtl[i],dtl[i+1]+1);if(dx===dw-1)dtl[i]=Math.min(dtl[i],dtl[dy*dw]+1);
if(dy<dh-1)dtl[i]=Math.min(dtl[i],dtl[(dy+1)*dw+dx]+1);}}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
let e=rawElev[i]-sl;if(lat>.86)e=Math.max(e,(lat-.86)*2);
if(e<0){const dgx=Math.min(dw-1,Math.floor(x/DG)),dgy=Math.min(dh-1,Math.floor(y/DG)),dist=dtl[dgy*dw+dgx];
if(dist<=3)e=Math.max(e,-(dist/3)*0.025);
else{const dd=dist-3,df=Math.min(1,dd/12);let bd=-0.03-df*0.12;
const ridge=fbm(nx*3+seed*0.01,ny*3+seed*0.01,3,2.2,0.5);if(ridge>0.2)bd+=(ridge-0.2)*0.08;
e=Math.min(e,bd);}e+=fbm(nx*12+40,ny*12+40,2,2,.4)*0.008;}
elevation[i]=e;let m=fbm(nx*4+50,ny*4+50,4,2,.55)*.4+.35+(1-lat)*.2;if(e>-.05&&e<.03)m+=.15;
moisture[i]=Math.max(0,Math.min(1,m));temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}}
const ctw=Math.ceil(W/RES),cth=Math.ceil(H/RES);const coastal=new Uint8Array(ctw*cth);
for(let ty=1;ty<cth-1;ty++)for(let tx=0;tx<ctw;tx++){const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
if(elevation[py*W+px]>0){
outer:for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const wx=((tx+dx)%ctw+ctw)%ctw,wy=ty+dy;if(wy<0||wy>=cth)continue;
const npx=Math.min(W-1,wx*RES),npy=Math.min(H-1,wy*RES);
if(elevation[npy*W+npx]<=0){coastal[ty*ctw+tx]=1;break outer;}}}}
const rvr=generateRivers(elevation,moisture,W,H,mkRng(seed+777));
return{elevation,moisture,temperature,coastal,river:rvr.river,lake:rvr.lake,width:W,height:H,preset};}

// ── River & lake generation: trace flow downhill from wet highlands ──
function generateRivers(elev,moist,W,H,rng){
const flow=new Float32Array(W*H),lake=new Uint8Array(W*H);
const D8=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
// Collect source candidates: high elevation + wet
const cands=[];
for(let y=4;y<H-4;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elev[i]>0.1&&moist[i]>0.25)cands.push({x,y,score:elev[i]*0.6+moist[i]*0.4+rng()*0.15});}
cands.sort((a,b)=>b.score-a.score);
// Select spaced sources (min ~4% of width apart)
const sources=[],minSp=Math.round(W*0.043);
for(const c of cands){if(sources.length>=55)break;let ok=true;
for(const s of sources){let dx=Math.abs(c.x-s.x);if(dx>W/2)dx=W-dx;
if(dx*dx+(c.y-s.y)**2<minSp*minSp){ok=false;break;}}
if(ok)sources.push(c);}
// Trace each river downhill with meandering
for(const src of sources){let cx=src.x,cy=src.y,str=0.3+moist[src.y*W+src.x]*0.7;
const path=new Set();
for(let step=0;step<800;step++){const ci=cy*W+cx;if(path.has(ci))break;path.add(ci);
flow[ci]+=str;str+=0.03;if(elev[ci]<=0)break;
// Gather all downhill unvisited neighbors
const downs=[];let be=elev[ci];
for(const[dx,dy]of D8){const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;if(!path.has(ni)&&elev[ni]<elev[ci]){downs.push({x:nx,y:ny,e:elev[ni]});
if(elev[ni]<be)be=elev[ni];}}
if(downs.length>0){const slope=elev[ci]-be;
if(slope<0.006&&downs.length>1){
// Flat terrain: meander using noise to pick among downhill options
const nv=noise2D(cx*0.25+step*0.1,cy*0.25+step*0.1);
const idx=Math.floor(((nv+1)/2)*downs.length)%downs.length;
cx=downs[idx].x;cy=downs[idx].y;
}else{// Steep terrain: follow steepest descent
let bx=downs[0].x,by=downs[0].y;
for(const d of downs)if(d.e<elev[by*W+bx]){bx=d.x;by=d.y;}
cx=bx;cy=by;}continue;}
// Depression: scan outward for an outlet lower than current elevation
const ce=elev[ci];let found=false;
for(let r=2;r<=20&&!found;r++){let bestD=Infinity,ox=-1,oy=-1;
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;if(elev[ni]<ce&&!path.has(ni)){const d2=dx*dx+dy*dy;
if(d2<bestD){bestD=d2;ox=nx;oy=ny;}}}
if(ox>=0){// Mark depression area as lake
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
const nx=((cx+dx)%W+W)%W,ny=cy+dy;if(ny<0||ny>=H)continue;
if(dx*dx+dy*dy<=r*r&&elev[ny*W+nx]<=ce+0.008)lake[ny*W+nx]=1;}
cx=ox;cy=oy;found=true;}}
if(!found)break;}}
// Normalize flow and expand width based on flow strength
let mx=0;for(let i=0;i<W*H;i++)if(flow[i]>mx)mx=flow[i];
const base=new Uint8Array(W*H);
if(mx>0)for(let i=0;i<W*H;i++){if(flow[i]>0.2)base[i]=Math.min(255,Math.round(Math.sqrt(flow[i]/mx)*200)+55);}
// Width expansion: strong rivers get 2-3px wide
const river=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!base[i])continue;
const r=base[i]>180?2:base[i]>100?1:0;
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
const nx=((x+dx)%W+W)%W,ny=y+dy;if(ny<0||ny>=H)continue;
const ni=ny*W+nx;const d2=dx*dx+dy*dy;if(d2>r*r)continue;
if(elev[ni]>0){const fade=Math.round(base[i]*(1-Math.sqrt(d2)/(r+1)*0.4));
river[ni]=Math.max(river[ni],fade);}}}
return{river,lake};}

const BC=[[8,18,52],[18,40,88],[32,72,120],[198,186,142],[230,238,245],[210,218,228],[140,132,115],[55,78,52],[110,100,90],[130,126,104],[10,80,22],[166,156,66],[202,176,112],[30,98,36],[118,160,52],[38,62,42],[150,146,104]];
function getBiomeD(e,m,t,sl){if(e<=sl)return e<sl-.08?0:e<sl-.01?1:2;const a=e-sl;if(a<0.015)return 3;
if(t<.15)return 4;if(t<.25)return e>.35?5:6;if(t<.35)return e>.4?5:m>.45?7:6;if(e>.5)return 8;if(e>.38)return t>.55?9:8;
if(t>.7)return m>.5?10:m>.25?11:12;if(t>.5)return m>.45?13:m>.2?14:12;return m>.4?15:m>.15?14:16;}
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
// River/lake fertility boost: check pixels in this tile's block
if(w.river||w.lake){let hasWater=false;
for(let dy=0;dy<RES&&!hasWater;dy++)for(let dx=0;dx<RES&&!hasWater;dx++){
const wi=Math.min(w.height-1,py+dy)*w.width+Math.min(w.width-1,px+dx);
if((w.river[wi]>0||w.lake[wi])&&e>0)hasWater=true;}
if(hasWater){tMoist[ti]=Math.min(1,tMoist[ti]+0.2);tFert[ti]=Math.min(1,tFert[ti]+0.15);tRiver[ti]=1;}}}
// Find multiple spread-out seed locations for starting tribes
const NUM_TRIBES=w.preset==="earth"?8:6;const minSpacing=Math.round(tw*0.12);
// Score all habitable tiles
const scored=[];
for(let ty=2;ty<th-2;ty++)for(let tx=0;tx<tw;tx++){const ti=ty*tw+tx;if(tElev[ti]<=0)continue;
const s=tFert[ti]*2+tTemp[ti]+tMoist[ti]-tDiff[ti]*2;
scored.push({x:tx,y:ty,s});}
scored.sort((a,b)=>b.s-a.s);
// Pick well-spaced origins (greedy: best first, skip if too close to existing)
const origins=[];
if(w.preset==="earth"){// Seed East Africa first (cradle of mankind)
const etx=Math.round(tw*0.51),ety=Math.round(th*0.47);
let best=null,bs2=-999;
for(const c of scored){let dx=Math.abs(c.x-etx);if(dx>tw/2)dx=tw-dx;
if(dx*dx+(c.y-ety)**2<(tw*0.04)**2&&c.s>bs2){bs2=c.s;best=c;}}
if(best)origins.push(best);}
for(const c of scored){if(origins.length>=NUM_TRIBES)break;
let ok=true;for(const o of origins){let dx=Math.abs(c.x-o.x);if(dx>tw/2)dx=tw-dx;
if(dx*dx+(c.y-o.y)**2<minSpacing*minSpacing){ok=false;break;}}
if(ok)origins.push(c);}
const tenure=new Uint16Array(tw*th);const frontier=new Set();
for(let i=0;i<origins.length;i++){const{x,y}=origins[i],ti=y*tw+x;
owner[ti]=i;tribeSizes.push(1);tribeStrength.push(tFert[ti]);tenure[ti]=1;frontier.add(ti);
tribeCenters.push([{x,y,prestige:1.0,founded:0}]);}
let lc=0;for(let i=0;i<tw*th;i++)if(tElev[i]>0)lc++;
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tRiver,owner,tenure,tribeCenters,tribeSizes,tribeStrength,
frontier,landCount:lc,settled:origins.length,tribes:origins.length,origin:origins[0]||{x:0,y:0},stepCount:0};}

function tDistW(x1,y1,x2,y2,tw){let dx=Math.abs(x1-x2);if(dx>tw/2)dx=tw-dx;return Math.sqrt(dx*dx+Math.pow(y1-y2,2));}
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
const contribution=Math.exp(-d*d/280)*c.prestige;
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
const nf=new Set();
for(const fi of ter.frontier){if(tElev[fi]<=sl)continue;const ty=Math.floor(fi/tw),tx=fi%tw,ow=owner[fi];let room=false;const pDiff=tDiff[fi];
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
const reach=Math.exp(-distMin*distMin/280);// same gaussian as power projection
chance*=Math.max(0.05,reach);// 5% floor so frontier doesn't completely freeze
if(Math.random()<chance){let nw=ow;
// Count same-tribe neighbors: if tile is infill (≥3), never split
let sameN=0;for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny+dy2;
if(ay>=0&&ay<th&&owner[ay*tw+ax]===ow)sameN++;}
const sz=tribeSizes[ow],dens=sz>0?tribeStrength[ow]/sz:0;
let splitChance=0;
if(sameN<3){
// Overextension: large tribes are harder to hold together
const overext=sz>65?Math.min(0.3,(sz-65)*0.002):0;
// Geographic barrier: mountains/deserts between parent and frontier
const barrier=diff>0.5&&pDiff<0.3?0.3:0;
// Internal inequality: fertile frontier wants independence from poor core
const ineq=dens>0&&tFert[ni]>dens*1.8?0.25*(tFert[ni]/dens-1):0;
// Distance weakens central control (from nearest center, not just capital)
const distF=distMin>25?Math.min(0.25,(distMin-25)*0.005):0;
// Strong, dense tribes resist all splits
splitChance=Math.max(0,(overext+barrier+ineq+distF)*(1-Math.min(0.9,dens*1.2)));}
if(splitChance>0&&Math.random()<splitChance)nw=newTribe(ter,nx,ny);
// Found a new center if fertile tile is far from all existing centers
else if(tFert[ni]>0.4&&distMin>20&&centers&&centers.length<8)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);nf.add(ni);}else room=true;}
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
const overext=sz>65?Math.min(0.2,(sz-65)*0.0012):0;
if(distMin>26&&Math.random()<overext+(dens<0.3?0.15:0))nw=newTribe(ter,nx,ny);
else if(tFert[ni]>0.4&&distMin>20&&centers&&centers.length<8)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);nf.add(ni);}}}
if(room)nf.add(fi);}
ter.frontier=nf;
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
const lpA=localPower(ter,ow,tx2,ty2);// defender's projected power here
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
claimTile(ter,ti,to);nf.add(ti);}}
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
}else{// Low cohesion → split: secondary center becomes a new tribe
const sc=centers.splice(c,1)[0];const sid=newTribe(ter,sc.x,sc.y);
// Transfer tiles closer to the breakaway center than to any remaining center
for(let i=0;i<tw*th;i++){if(owner[i]!==st)continue;const iy=Math.floor(i/tw),ix=i%tw;
const dSec=tDistW(ix,iy,sc.x,sc.y,tw);
let dNearest=Infinity;for(const rc of centers)dNearest=Math.min(dNearest,tDistW(ix,iy,rc.x,rc.y,tw));
if(dSec<dNearest)transferTile(ter,i,sid);}}
break;// only one challenge per step per tribe
}}}
// ── Fragmentation: split disconnected tribe components (largest keeps original ID/color) ──
if(ter.stepCount%16===0){const mark=new Int32Array(tw*th);let gen=0;
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
for(const ci of comps[c])transferTile(ter,ci,sid);}}}
// ── Remnant absorption: tiny tribes (<5 tiles) absorbed by any larger touching neighbor ──
if(ter.stepCount%8===0){for(let st=0;st<tribeSizes.length;st++){if(tribeSizes[st]<=0||tribeSizes[st]>5)continue;
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
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),speedRef=useRef(5),viewRef=useRef("terrain");
const presetRef=useRef(null);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null);
const W=960,H=480;
const generate=useCallback(s=>{const w=generateWorld(W,H,s,presetRef.current);setWorld(w);worldRef.current=w;const t=createTerritory(w);terRef.current=t;
setCoverage(0);setTribeCount(t.tribes);setPlaying(false);playRef.current=false;
terrainCache.current=null;},[]);
useEffect(()=>{generate(seed)},[seed,generate]);

// Build terrain RGB cache - renders at RES×RES blocks to match territory tile scale
const updateTerrainCache=useCallback((w)=>{
const buf=new Uint8Array(W*H*3);const sl=0;
// Sample at tile centers, fill RES×RES blocks
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES);
const si=sy*W+sx;const e=w.elevation[si],m=w.moisture[si];
const t=w.temperature[si];let r,g,b;
if(e<=sl&&t<0.18){const lat=Math.abs(sy/H-0.5)*2;const iceStr=Math.min(1,(0.18-t)/0.18)*(0.3+lat*0.7);
const df=Math.min(1,Math.max(0,(sl-e)/0.15));const or2=8+df*2,og2=18+df*5,ob2=52+df*15;const blend=Math.min(1,iceStr*1.8);
r=Math.round(or2*(1-blend)+225*blend);g=Math.round(og2*(1-blend)+235*blend);b=Math.round(ob2*(1-blend)+248*blend);
}else if(e<=sl){const df=Math.min(1,Math.max(0,(sl-e)/0.15));
r=Math.round(32-df*24);g=Math.round(72-df*50);b=Math.round(120-df*60);
}else{const c=getColorD(e,m,t,sl);r=c[0];g=c[1];b=c[2];}
// Fill RES×RES block with per-pixel river/lake overlay
for(let dy=0;dy<RES;dy++){const py=ty*RES+dy;if(py>=H)continue;
for(let dx=0;dx<RES;dx++){const px=tx*RES+dx;if(px>=W)continue;
const pi=py*W+px;let pr=r,pg=g,pb=b;
if(e>sl){const wi=py*W+px;
if(w.lake&&w.lake[wi]){pr=28;pg=62;pb=112;}
else if(w.river&&w.river[wi]){const a=0.45+w.river[wi]/255*0.45;
pr=Math.round(r*(1-a)+22*a);pg=Math.round(g*(1-a)+52*a);pb=Math.round(b*(1-a)+132*a);}}
buf[pi*3]=pr;buf[pi*3+1]=pg;buf[pi*3+2]=pb;}}}
return buf;},[]);

// Composite render: terrain + tribe overlay into single canvas
const draw=useCallback((ter)=>{
if(!canvasRef.current||!ter)return;const w=worldRef.current;if(!w)return;
const sl=0,vm=viewRef.current;
const ctx=canvasRef.current.getContext("2d");const img=ctx.createImageData(W,H);const d=img.data;
if(vm==="depth"){
// Depth/heightmap view: elevation as grayscale with color tinting
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES),si=sy*W+sx;
const e=w.elevation[si];let r,g,b;
if(e<=sl){const depth=Math.min(1,Math.max(0,(sl-e)/0.2));r=Math.round(10-depth*8);g=Math.round(30+depth*10);b=Math.round(80+depth*60);}
else{const h=Math.min(1,(e-sl)/0.6);if(h<0.05){r=Math.round(160+h*200);g=Math.round(155+h*200);b=Math.round(120+h*200);}
else if(h<0.3){const t2=(h-0.05)/0.25;r=Math.round(60+t2*50);g=Math.round(100+t2*30);b=Math.round(40-t2*10);}
else if(h<0.6){const t2=(h-0.3)/0.3;r=Math.round(110+t2*40);g=Math.round(130-t2*30);b=Math.round(30-t2*10);}
else{const t2=(h-0.6)/0.4;r=Math.round(150+t2*80);g=Math.round(100-t2*40);b=Math.round(20+t2*10);}}
for(let dy2=0;dy2<RES;dy2++){const py=ty*RES+dy2;if(py>=H)continue;
for(let dx2=0;dx2<RES;dx2++){const px=tx*RES+dx2;if(px>=W)continue;
const pi=(py*W+px)*4;let pr=r,pg=g,pb=b;
if(e>sl){const wi=py*W+px;if(w.lake&&w.lake[wi]){pr=20;pg=45;pb=90;}
else if(w.river&&w.river[wi]){pr=25;pg=55;pb=120;}}
d[pi]=pr;d[pi+1]=pg;d[pi+2]=pb;d[pi+3]=255;}}}
}else if(vm==="power"){
// Power view: dark base with faint tribe tint, hatching provides the real info
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES),si=sy*W+sx;
const e=w.elevation[si],ti=ty*tw+tx,ow=ter.owner[ti];let r,g,b;
if(e<=sl){r=4;g=5;b=12;}
else if(ow>=0){const c=tribeRGB(ow);r=Math.round(c[0]*0.15+10);g=Math.round(c[1]*0.15+10);b=Math.round(c[2]*0.15+10);}
else{r=16;g=15;b=14;}
for(let dy2=0;dy2<RES;dy2++){const py=ty*RES+dy2;if(py>=H)continue;
for(let dx2=0;dx2<RES;dx2++){const px=tx*RES+dx2;if(px>=W)continue;
const pi=(py*W+px)*4;d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255;}}}
}else if(vm==="tribes"){
// Tribe-only view: solid tribe colors on land, dark water
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES),si=sy*W+sx;
const e=w.elevation[si],ti=ty*tw+tx,ow=ter.owner[ti];let r,g,b;
if(e<=sl){r=6;g=8;b=16;}
else if(ow>=0){const c=tribeRGB(ow);r=c[0];g=c[1];b=c[2];}
else{r=22;g=20;b=18;}
for(let dy2=0;dy2<RES;dy2++){const py=ty*RES+dy2;if(py>=H)continue;
for(let dx2=0;dx2<RES;dx2++){const px=tx*RES+dx2;if(px>=W)continue;
const pi=(py*W+px)*4;let pr=r,pg=g,pb=b;
if(e>sl){const wi=py*W+px;if(w.lake&&w.lake[wi]){pr=12;pg=20;pb=40;}
else if(w.river&&w.river[wi]){const a=0.5;pr=Math.round(r*(1-a)+12*a);pg=Math.round(g*(1-a)+20*a);pb=Math.round(b*(1-a)+45*a);}}
d[pi]=pr;d[pi+1]=pg;d[pi+2]=pb;d[pi+3]=255;}}}
}else{
// Default terrain view with tribe overlay
if(!terrainCache.current){terrainCache.current=updateTerrainCache(w);}
const tc=terrainCache.current;
for(let i=0;i<W*H;i++){
let r=tc[i*3],g=tc[i*3+1],b=tc[i*3+2];
const px=i%W,py=Math.floor(i/W);
const tx=Math.floor(px/RES),ty=Math.floor(py/RES);
if(tx<ter.tw&&ty<ter.th){
const ti=ty*ter.tw+tx,ow=ter.owner[ti];
if(ow>=0&&ter.tElev[ti]>sl){
const[tr2,tg,tb]=tribeRGB(ow);
const alpha=ter.frontier.has(ti)?0.55:0.32;
r=Math.round(r*(1-alpha)+tr2*alpha);
g=Math.round(g*(1-alpha)+tg*alpha);
b=Math.round(b*(1-alpha)+tb*alpha);}}
d[i*4]=r;d[i*4+1]=g;d[i*4+2]=b;d[i*4+3]=255;}}
ctx.putImageData(img,0,0);
// Draw all tribe centers
for(let st=0;st<ter.tribeCenters.length;st++){const centers=ter.tribeCenters[st];
if(!centers||ter.tribeSizes[st]<=0)continue;const[cr,cg,cb]=tribeRGB(st);
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x*RES+1,cy2=centers[ci].y*RES+1;
const isCapital=ci===0,r2=isCapital?4:3;
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=isCapital?`rgb(${cr},${cg},${cb})`:`rgba(${cr},${cg},${cb},0.7)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+2,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.8)":"rgba(255,255,255,0.3)";ctx.lineWidth=isCapital?2:1;ctx.stroke();}}
// Power projection view: shows center influence within each tribe's own territory
if(vm==="power"&&ter){const tw2=ter.tw,th2=ter.th;
for(let ty2=0;ty2<th2;ty2+=2)for(let tx2=0;tx2<tw2;tx2+=2){
const ti=ty2*tw2+tx2;const ow2=ter.owner[ti];
if(ow2<0||ter.tElev[ti]<=0)continue;
const pop=ter.tribeStrength[ow2];if(pop<0.01)continue;
// Normalize per-tribe: localPower/pop gives 0.03-1.0 regardless of tribe size
const lp=localPower(ter,ow2,tx2,ty2);
const ratio=lp/pop;// 0.03 (far from center) to ~1.0 (at center)
const intensity=(ratio-0.03)/0.97;// remap to 0-1
const[cr,cg,cb]=tribeRGB(ow2);
const px=tx2*RES,py=ty2*RES,sz=RES*2;
// Hatching in tribe color; denser lines = stronger center influence
const alpha=0.1+Math.pow(intensity,0.7)*0.85;// non-linear so centers pop
ctx.strokeStyle=`rgba(${cr},${cg},${cb},${alpha})`;ctx.lineWidth=0.6+intensity*0.6;
ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+sz,py+sz);ctx.stroke();
if(intensity>0.2){ctx.beginPath();ctx.moveTo(px+sz,py);ctx.lineTo(px,py+sz);ctx.stroke();}
if(intensity>0.45){ctx.lineWidth=0.8+intensity*0.4;ctx.beginPath();ctx.moveTo(px+sz/2,py);ctx.lineTo(px+sz/2,py+sz);ctx.stroke();}
if(intensity>0.7){ctx.beginPath();ctx.moveTo(px,py+sz/2);ctx.lineTo(px+sz,py+sz/2);ctx.stroke();}}
// Draw centers
for(let st=0;st<ter.tribeSizes.length;st++){if(ter.tribeSizes[st]<=0)continue;
const centers=ter.tribeCenters[st];if(!centers)continue;
const[cr,cg,cb]=tribeRGB(st);
for(let ci=0;ci<centers.length;ci++){const cx2=centers[ci].x*RES+1,cy2=centers[ci].y*RES+1;
const isCapital=ci===0,r2=isCapital?6:4;
ctx.beginPath();ctx.arc(cx2,cy2,r2+4,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.25)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2,0,Math.PI*2);
ctx.fillStyle=`rgba(${cr},${cg},${cb},0.95)`;ctx.fill();
ctx.beginPath();ctx.arc(cx2,cy2,r2+1,0,Math.PI*2);
ctx.strokeStyle=isCapital?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.4)";ctx.lineWidth=isCapital?2:1;ctx.stroke();
if(isCapital){ctx.fillStyle="rgba(255,255,255,0.9)";ctx.font="bold 8px sans-serif";
ctx.fillText("\u2605",cx2-4,cy2+3);}}}}
},[updateTerrainCache]);

useEffect(()=>{viewRef.current=viewMode;if(world&&terRef.current)draw(terRef.current);},[world,draw,viewMode]);

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
const bs={background:"rgba(201,184,122,0.08)",border:"1px solid rgba(201,184,122,0.18)",color:"#8a8474",
padding:"4px 10px",borderRadius:2,cursor:"pointer",fontSize:10,letterSpacing:1,fontFamily:"inherit"};
const bsA=(active,color)=>({...bs,background:active?`rgba(${color},0.2)`:bs.background,
border:`1px solid ${active?`rgba(${color},0.35)`:bs.border}`,color:active?`rgb(${color})`:"#8a8474"});
return(
<div style={{width:"100vw",height:"100vh",background:"#060810",overflow:"hidden",position:"relative"}}>
<canvas ref={canvasRef} width={W} height={H} style={{width:"100%",height:"100%",display:"block",imageRendering:"pixelated",objectFit:"contain"}} />
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
<div style={{width:1,height:16,background:"rgba(201,184,122,0.15)"}} />
{[["terrain","Ter"],["depth","Dep"],["tribes","Tri"],["power","Pow"]].map(([k,label])=>(
<button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}}
style={{...bs,background:viewMode===k?"rgba(201,184,122,0.2)":"transparent",border:"none",
color:viewMode===k?"#c9b87a":"#5a5448",padding:"3px 7px"}}>{label}</button>))}
</div></div>);}