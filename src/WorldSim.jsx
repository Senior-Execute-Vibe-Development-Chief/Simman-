import { useState, useEffect, useRef, useCallback } from "react";

const PERM=new Uint8Array(512);const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed){const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){seed=(seed*16807)%2147483647;const j=seed%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)PERM[i]=p[i&255];}
function noise2D(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));return l1+v*(l2-l1);}
function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}
function mkRng(s){s=((s%2147483647)+2147483647)%2147483647||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}

const RES=2;

function getClimate(simTime){
const yearsBP=300000*(1-simTime);
let f=Math.sin(yearsBP/100000*Math.PI*2)*.4+Math.sin(yearsBP/41000*Math.PI*2)*.3+Math.sin(yearsBP/23000*Math.PI*2)*.2;
f+=-1.2*Math.exp(-Math.pow((yearsBP-20000)/80000,2)*6);
f+=-0.6*Math.exp(-Math.pow((yearsBP-140000)/80000,2)*6);
if(yearsBP<15000)f+=(15000-yearsBP)/15000*0.8;
f+=-0.2+0.05*simTime;
const tempMod=Math.max(-0.35,Math.min(0.05,f*0.18)),seaLevel=tempMod*0.1;
const wet=Math.max(0,Math.min(1,0.5+tempMod*2+Math.sin(yearsBP/21000*Math.PI*2)*0.3+0.15*simTime));
let eraName="",eraDesc="";
if(yearsBP>250000){eraName="Origin";eraDesc="Modern humans emerge in equatorial Africa";}
else if(yearsBP>180000){eraName="Early Dispersal";eraDesc="Small bands explore - constrained by climate";}
else if(yearsBP>125000){eraName="Interglacial Pulse";eraDesc=wet>0.6?"Green corridors open":"Arid conditions limit movement";}
else if(yearsBP>75000){eraName="Pre-Exodus";eraDesc=wet>0.5?"Conditions favor dispersal":"Drought constrains populations";}
else if(yearsBP>55000){eraName="Out of Africa";eraDesc="The great coastal migration begins";}
else if(yearsBP>40000){eraName="Coastal Sprint";eraDesc="Rapid coastal expansion - ~1 km/year";}
else if(yearsBP>25000){eraName="Settling Eurasia";eraDesc="Europe and East Asia colonized";}
else if(yearsBP>18000){eraName="Last Glacial Maximum";eraDesc="Ice at maximum - land bridges exposed";}
else if(yearsBP>12000){eraName="Crossing to Americas";eraDesc="Humans enter the New World";}
else if(yearsBP>8000){eraName="Rapid Thaw";eraDesc="Ice retreats - explosive recolonization";}
else if(yearsBP>3000){eraName="Holocene";eraDesc="Agriculture - populations merge and densify";}
else{eraName="Modern Era";eraDesc="Humanity spans the globe";}
return{tempMod,seaLevel,wet,yearsBP,eraName,eraDesc};}

// Earth preset: hand-placed continent ellipses approximating real geography
// Coordinates are normalized 0-1 (x wraps, y: 0=north pole, 1=south pole)
function earthSpecs(rng){const s=[];const n=()=>rng()*100;
// ── North America ──
s.push({cx:.14,cy:.22,rx:.08,ry:.08,rot:-.2,no:n(),str:1.0});// Canada core
s.push({cx:.10,cy:.28,rx:.06,ry:.10,rot:-.3,no:n(),str:.95});// West coast / Rockies
s.push({cx:.17,cy:.32,rx:.05,ry:.07,rot:-.1,no:n(),str:.85});// Eastern seaboard
s.push({cx:.12,cy:.38,rx:.04,ry:.03,rot:.2,no:n(),str:.80});// Gulf coast / Mexico
s.push({cx:.08,cy:.20,rx:.05,ry:.04,rot:-.4,no:n(),str:.75});// Alaska
s.push({cx:.14,cy:.42,rx:.025,ry:.025,rot:.3,no:n(),str:.65});// Central America
// ── South America ──
s.push({cx:.21,cy:.55,rx:.04,ry:.10,rot:.15,no:n(),str:.95});// Brazil / Amazon
s.push({cx:.19,cy:.65,rx:.03,ry:.08,rot:.1,no:n(),str:.85});// Andes / west
s.push({cx:.22,cy:.48,rx:.03,ry:.04,rot:-.1,no:n(),str:.75});// Venezuela/Colombia
s.push({cx:.19,cy:.75,rx:.02,ry:.04,rot:.05,no:n(),str:.70});// Patagonia
// ── Europe ──
s.push({cx:.47,cy:.22,rx:.04,ry:.04,rot:.2,no:n(),str:.80});// Western Europe
s.push({cx:.50,cy:.18,rx:.03,ry:.03,rot:.4,no:n(),str:.70});// Scandinavia
s.push({cx:.44,cy:.26,rx:.03,ry:.02,rot:-.2,no:n(),str:.65});// Iberia/Italy
s.push({cx:.52,cy:.23,rx:.03,ry:.03,rot:.1,no:n(),str:.70});// Eastern Europe
// ── Africa ──
s.push({cx:.49,cy:.42,rx:.05,ry:.10,rot:.05,no:n(),str:1.0});// Core Africa
s.push({cx:.47,cy:.35,rx:.04,ry:.04,rot:-.1,no:n(),str:.85});// North Africa / Sahara
s.push({cx:.51,cy:.52,rx:.03,ry:.06,rot:.15,no:n(),str:.80});// East Africa
s.push({cx:.46,cy:.55,rx:.03,ry:.04,rot:-.1,no:n(),str:.70});// Congo basin
s.push({cx:.50,cy:.62,rx:.02,ry:.03,rot:.0,no:n(),str:.65});// Southern Africa
// ── Asia ──
s.push({cx:.60,cy:.20,rx:.08,ry:.06,rot:.1,no:n(),str:1.0});// Siberia/Central
s.push({cx:.68,cy:.30,rx:.06,ry:.06,rot:-.15,no:n(),str:.95});// China/East Asia
s.push({cx:.55,cy:.30,rx:.05,ry:.05,rot:.2,no:n(),str:.85});// Middle East/India approach
s.push({cx:.62,cy:.36,rx:.04,ry:.04,rot:.3,no:n(),str:.80});// India/SE Asia
s.push({cx:.72,cy:.22,rx:.04,ry:.04,rot:-.1,no:n(),str:.75});// Japan/Korea area
s.push({cx:.66,cy:.40,rx:.04,ry:.03,rot:.4,no:n(),str:.70});// SE Asia / Indonesia
s.push({cx:.56,cy:.36,rx:.03,ry:.04,rot:.1,no:n(),str:.80});// Indian subcontinent
// ── Australia ──
s.push({cx:.78,cy:.60,rx:.05,ry:.04,rot:.1,no:n(),str:.90});// Australia main
s.push({cx:.80,cy:.57,rx:.03,ry:.02,rot:-.2,no:n(),str:.65});// Northern Aus
// ── Greenland ──
s.push({cx:.30,cy:.12,rx:.03,ry:.04,rot:.1,no:n(),str:.75});
// ── Antarctica (ring of blobs at south) ──
s.push({cx:.50,cy:.92,rx:.12,ry:.04,rot:.0,no:n(),str:.80});
s.push({cx:.30,cy:.93,rx:.08,ry:.03,rot:.2,no:n(),str:.70});
s.push({cx:.70,cy:.93,rx:.08,ry:.03,rot:-.2,no:n(),str:.70});
// ── Small island groups ──
s.push({cx:.73,cy:.45,rx:.015,ry:.02,rot:.3,no:n(),str:.50});// Philippines
s.push({cx:.76,cy:.50,rx:.02,ry:.015,rot:.5,no:n(),str:.45});// Indonesia east
s.push({cx:.85,cy:.68,rx:.015,ry:.02,rot:.2,no:n(),str:.50});// New Zealand
s.push({cx:.42,cy:.26,rx:.015,ry:.01,rot:.0,no:n(),str:.45});// British Isles
s.push({cx:.60,cy:.44,rx:.02,ry:.01,rot:.5,no:n(),str:.45});// Sri Lanka
return s;}

function generateWorld(W,H,seed,preset){
initNoise(seed);const rng=mkRng(seed);
const rawElev=new Float32Array(W*H),elevation=new Float32Array(W*H),moisture=new Float32Array(W*H),temperature=new Float32Array(W*H);
const specs=[];
if(preset==="earth"){specs.push(...earthSpecs(rng));}
else{
for(let i=0;i<5+Math.floor(rng()*4);i++)specs.push({cx:rng(),cy:.06+rng()*.88,rx:.09+rng()*.2,ry:.07+rng()*.15,rot:rng()*Math.PI,no:rng()*100,str:.75+rng()*.5});
for(let i=0;i<5+Math.floor(rng()*6);i++)specs.push({cx:rng(),cy:.1+rng()*.8,rx:.025+rng()*.05,ry:.015+rng()*.04,rot:rng()*Math.PI,no:rng()*100,str:.45+rng()*.35});}
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
if(preset==="earth"&&e>0){// Earth moisture: desert belts at ~20-30° latitude, wet tropics, monsoon
const tropdist=Math.abs(ny-.45);// tropics near equator
m+=tropdist<.08?.15:0;// wet tropics
// Sahara/Arabian desert band (north Africa ~y=0.33-0.40, x=0.42-0.58)
const sahDx=Math.min(Math.abs(nx-.50),1-Math.abs(nx-.50)),sahDy=Math.abs(ny-.36);
if(sahDx<.10&&sahDy<.05)m-=.35*(1-sahDx/.10)*(1-sahDy/.05);
// Australian interior (x~0.78, y~0.60)
const auDx=Math.min(Math.abs(nx-.78),1-Math.abs(nx-.78)),auDy=Math.abs(ny-.60);
if(auDx<.04&&auDy<.03)m-=.25*(1-auDx/.04)*(1-auDy/.03);
// Central Asian steppe (x~0.60, y~0.27)
const caDx=Math.min(Math.abs(nx-.60),1-Math.abs(nx-.60)),caDy=Math.abs(ny-.27);
if(caDx<.06&&caDy<.03)m-=.20*(1-caDx/.06)*(1-caDy/.03);
// Amazon basin boost (x~0.21, y~0.52)
const amDx=Math.min(Math.abs(nx-.21),1-Math.abs(nx-.21)),amDy=Math.abs(ny-.54);
if(amDx<.05&&amDy<.06)m+=.20*(1-amDx/.05)*(1-amDy/.06);
// Congo basin boost
const coDx=Math.min(Math.abs(nx-.48),1-Math.abs(nx-.48)),coDy=Math.abs(ny-.48);
if(coDx<.04&&coDy<.05)m+=.15*(1-coDx/.04)*(1-coDy/.05);
// SE Asia monsoon boost
const seDx=Math.min(Math.abs(nx-.66),1-Math.abs(nx-.66)),seDy=Math.abs(ny-.38);
if(seDx<.06&&seDy<.04)m+=.15*(1-seDx/.06)*(1-seDy/.04);}
moisture[i]=Math.max(0,Math.min(1,m));temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,e)*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.1));}
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
// Select spaced sources (min 25px apart)
const sources=[];
for(const c of cands){if(sources.length>=35)break;let ok=true;
for(const s of sources){let dx=Math.abs(c.x-s.x);if(dx>W/2)dx=W-dx;
if(dx*dx+(c.y-s.y)**2<25*25){ok=false;break;}}
if(ok)sources.push(c);}
// Trace each river downhill with meandering
for(const src of sources){let cx=src.x,cy=src.y,str=0.3+moist[src.y*W+src.x]*0.7;
const path=new Set();
for(let step=0;step<500;step++){const ci=cy*W+cx;if(path.has(ci))break;path.add(ci);
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
for(let r=2;r<=12&&!found;r++){let bestD=Infinity,ox=-1,oy=-1;
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
const LEAPS=[];for(let r=3;r<=8;r++)for(let a=0;a<8;a++){const ang=a*Math.PI/4;LEAPS.push([Math.round(Math.cos(ang)*r),Math.round(Math.sin(ang)*r)]);}

function createTerritory(w){
const tw=Math.ceil(w.width/RES),th=Math.ceil(w.height/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th),tDiff=new Float32Array(tw*th),owner=new Int16Array(tw*th).fill(-1),tribeSizes=[],tribeStrength=[];
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
if(hasWater){tMoist[ti]=Math.min(1,tMoist[ti]+0.2);tFert[ti]=Math.min(1,tFert[ti]+0.15);}}}
let bx=0,by=0,bs=-999;
if(w.preset==="earth"){// Cradle of mankind: East African Rift Valley (~x=0.51, y=0.47)
const etx=Math.round(tw*0.51),ety=Math.round(th*0.47),R=Math.round(tw*0.04);
for(let ty=Math.max(0,ety-R);ty<=Math.min(th-1,ety+R);ty++)for(let tx=etx-R;tx<=etx+R;tx++){
const wx=((tx%tw)+tw)%tw,ti=ty*tw+wx;if(tElev[ti]<=0)continue;
const d=Math.sqrt((tx-etx)**2+(ty-ety)**2);
const s=tFert[ti]*2+tTemp[ti]-d*0.3-tDiff[ti];if(s>bs){bs=s;bx=wx;by=ty;}}
}else{
for(let ty=Math.floor(th*.3);ty<Math.floor(th*.7);ty++)for(let tx=0;tx<tw;tx++){const ti=ty*tw+tx;if(tElev[ti]<=0)continue;
const s=tTemp[ti]*2+tMoist[ti]+(1-Math.abs(tElev[ti]-.12))-tDiff[ti]*2;if(s>bs){bs=s;bx=tx;by=ty;}}}
const oi=by*tw+bx;owner[oi]=0;tribeSizes.push(1);tribeStrength.push(tFert[oi]);
const tenure=new Uint16Array(tw*th);tenure[oi]=1;
let lc=0;for(let i=0;i<tw*th;i++)if(tElev[i]>0)lc++;
return{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,owner,tenure,tribeCenters:[[{x:bx,y:by,prestige:1.0,founded:0}]],tribeSizes,tribeStrength,
frontier:new Set([oi]),landCount:lc,settled:1,tribes:1,origin:{x:bx,y:by},prevSeaLevel:0,stepCount:0};}

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
const logistics=1/(1+Math.max(0,sz-30)*0.012);// overextension penalty: 200 tiles → 67% loss
return pop*logistics;
}
// Local power projection at a border tile: nearest center projects its share of population
function localPower(ter,tribeId,tx,ty){
const pop=ter.tribeStrength[tribeId],sz=ter.tribeSizes[tribeId];if(sz<=0)return 0;
const centers=ter.tribeCenters[tribeId];if(!centers||centers.length===0)return pop;
// Each center projects pop/numCenters (approximate Voronoi share), nearest center used
let bestDist=Infinity;
for(const c of centers){const d=tDistW(tx,ty,c.x,c.y,ter.tw);if(d<bestDist)bestDist=d;}
const projection=Math.max(0.2,1-bestDist*0.02);
const share=pop/centers.length;
return share*projection;
}
function newTribe(ter,x,y){const id=ter.tribeCenters.length;ter.tribeCenters.push([{x,y,prestige:1.0,founded:ter.stepCount}]);ter.tribeSizes.push(0);ter.tribeStrength.push(0);ter.tribes=id+1;return id;}
function claimTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert,tenure}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];}else{ter.settled++;}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];tenure[ti]=1;}
// Transfer tile without resetting tenure (for splits/fragmentation — population stays, allegiance changes)
function transferTile(ter,ti,nw){const{owner,tribeSizes,tribeStrength,tFert}=ter;const ow=owner[ti];
if(ow>=0){tribeSizes[ow]--;tribeStrength[ow]-=tFert[ti];}
owner[ti]=nw;tribeSizes[nw]++;tribeStrength[nw]+=tFert[ti];}

function stepTerritory(ter,w,climate){
const{tempMod:tm,seaLevel:sl,wet}=climate;const{tw,th,tElev,tTemp,tCoast,tDiff,tFert,owner,tribeCenters,tribeSizes,tribeStrength}=ter;ter.stepCount++;
// ── Sea level flooding ──
if(sl!==ter.prevSeaLevel){
// Flood tiles that went underwater
for(let i=0;i<tw*th;i++){if(owner[i]>=0&&tElev[i]<=sl){
tribeSizes[owner[i]]--;tribeStrength[owner[i]]-=tFert[i];owner[i]=-1;ter.tenure[i]=0;ter.settled--;ter.frontier.delete(i);}}
// Re-add owned tiles adjacent to newly-changed coastline to frontier
for(let i=0;i<tw*th;i++){if(owner[i]<0||tElev[i]<=sl)continue;
const ty2=Math.floor(i/tw),tx2=i%tw;
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;
if(owner[ny2*tw+nx2]<0){ter.frontier.add(i);break;}}}}
ter.prevSeaLevel=sl;
// ── Expansion into empty land ──
const nf=new Set();
for(const fi of ter.frontier){if(tElev[fi]<=sl)continue;const ty=Math.floor(fi/tw),tx=fi%tw,ow=owner[fi];let room=false;const pDiff=tDiff[fi];
for(const[dx,dy]of DIRS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;const ni=ny*tw+nx;if(owner[ni]>=0)continue;
const elev=tElev[ni];if(elev<=sl){room=true;continue;}const effT=tTemp[ni]+tm;if(effT<0.02){room=true;continue;}
const diff=tDiff[ni],adjDiff=Math.min(1,diff+(effT<0.15?0.3:0)-(wet>0.7?0.1:0));
let chance;if(elev<=0&&elev>sl)chance=0.7*wet;else if(tCoast[ni])chance=0.9*wet;else chance=0.45*(1-adjDiff)*wet;
if(effT<0.15)chance*=0.3;
chance*=0.5+tFert[ni]*1.5;// fertile tiles attract expansion (0.5x desert → 2x river valley)
if(Math.random()<chance){let nw=ow;const centers=tribeCenters[ow];
const{min:distMin,cap:distCap}=nearestCenterDist(centers,nx,ny,tw);
// Count same-tribe neighbors: if tile is infill (≥3), never split
let sameN=0;for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny+dy2;
if(ay>=0&&ay<th&&owner[ay*tw+ax]===ow)sameN++;}
const sz=tribeSizes[ow],dens=sz>0?tribeStrength[ow]/sz:0;
let splitChance=0;
if(sameN<3){
// Overextension: large tribes are harder to hold together
const overext=sz>40?Math.min(0.3,(sz-40)*0.003):0;
// Geographic barrier: mountains/deserts between parent and frontier
const barrier=diff>0.5&&pDiff<0.3?0.3:0;
// Internal inequality: fertile frontier wants independence from poor core
const ineq=dens>0&&tFert[ni]>dens*1.8?0.25*(tFert[ni]/dens-1):0;
// Distance weakens central control (from nearest center, not just capital)
const distF=distMin>15?Math.min(0.25,(distMin-15)*0.008):0;
// Strong, dense tribes resist all splits
splitChance=Math.max(0,(overext+barrier+ineq+distF)*(1-Math.min(0.9,dens*1.2)));}
if(splitChance>0&&Math.random()<splitChance)nw=newTribe(ter,nx,ny);
// Found a new center if fertile tile is far from all existing centers
else if(tFert[ni]>0.4&&distMin>12&&centers&&centers.length<6)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);nf.add(ni);}else room=true;}
if((tCoast[fi]||(tElev[fi]<=0&&tElev[fi]>sl))&&wet>0.3){for(const[dx,dy]of LEAPS){const nx=((tx+dx)%tw+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;const ni=ny*tw+nx;
if(owner[ni]>=0||tElev[ni]<=sl||tTemp[ni]+tm<0.05)continue;
// Don't land on contested coast: skip if any neighbor is owned by a different tribe
let contested=false;for(const[dx2,dy2]of DIRS){const ax=((nx+dx2)%tw+tw)%tw,ay=ny+dy2;
if(ay>=0&&ay<th){const ao=owner[ay*tw+ax];if(ao>=0&&ao!==ow){contested=true;break;}}}
if(contested)continue;
if(Math.random()<0.25*wet){let nw=ow;const centers=tribeCenters[ow];
const{min:distMin}=nearestCenterDist(centers,nx,ny,tw);
const sz=tribeSizes[ow],dens=sz>0?tribeStrength[ow]/sz:0;
const overext=sz>40?Math.min(0.2,(sz-40)*0.002):0;
if(distMin>16&&Math.random()<overext+(dens<0.3?0.15:0))nw=newTribe(ter,nx,ny);
else if(tFert[ni]>0.4&&distMin>12&&centers&&centers.length<6)
centers.push({x:nx,y:ny,prestige:0.3,founded:ter.stepCount});
claimTile(ter,ni,nw);nf.add(ni);}}}
if(room)nf.add(fi);}
ter.frontier=nf;
// ── Age tenure for all owned tiles (cap at 200) ──
if(ter.stepCount%4===0){const{tenure}=ter;for(let i=0;i<tw*th;i++)if(owner[i]>=0&&tenure[i]<200)tenure[i]++;}
// ── Border conflict: local power projection determines tile flips ──
if(ter.stepCount%4===0){const flips=[];const{tenure}=ter;
for(let i=0;i<tw*th;i++){const ow=owner[i];if(ow<0||tElev[i]<=sl||tribeSizes[ow]<1)continue;
const ty2=Math.floor(i/tw),tx2=i%tw;
const lpA=localPower(ter,ow,tx2,ty2);// defender's projected power here
const def=1+Math.min(0.8,tenure[i]*0.004)+tDiff[i]*0.7;// tenure + terrain defense (mountains/snow/desert)
for(const[dx,dy]of DIRS){const nx2=((tx2+dx)%tw+tw)%tw,ny2=ty2+dy;if(ny2<0||ny2>=th)continue;const ni=ny2*tw+nx2;
const no=owner[ni];if(no<0||no===ow||tElev[ni]<=sl||tribeSizes[no]<10)continue;
const lpB=localPower(ter,no,tx2,ty2);// attacker's projected power at this tile
if(lpB>lpA*def){const diff=Math.max(tDiff[i],tDiff[ni]);const pressure=(lpB/(lpA*def)-1)*0.3;
const prize=0.5+tFert[i]*1.5;
if(Math.random()<Math.max(0.01,pressure*prize*(1-diff*0.7))){flips.push([i,no]);break;}}}}
for(const[ti,to]of flips){if(owner[ti]===to)continue;claimTile(ter,ti,to);nf.add(ti);}}
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
const[playing,setPlaying]=useState(false);const[speed,setSpeed]=useState(5);const[simTime,setSimTime]=useState(0);
const[climate,setClimate]=useState(()=>getClimate(0));const[coverage,setCoverage]=useState(0);const[tribeCount,setTribeCount]=useState(1);const[dominant,setDominant]=useState(null);
const[viewMode,setViewMode]=useState("terrain");const[preset,setPreset]=useState(null);
const playRef=useRef(false),worldRef=useRef(null),terRef=useRef(null),simTimeRef=useRef(0),speedRef=useRef(5),viewRef=useRef("terrain");
const presetRef=useRef(null);
// Cache terrain RGB to avoid recomputing every frame
const terrainCache=useRef(null),lastCacheTm=useRef(null),lastCacheSl=useRef(null);
const W=580,H=320;
const generate=useCallback(s=>{const w=generateWorld(W,H,s,presetRef.current);setWorld(w);worldRef.current=w;const t=createTerritory(w);terRef.current=t;
simTimeRef.current=0;setSimTime(0);setClimate(getClimate(0));setCoverage(0);setTribeCount(1);setPlaying(false);playRef.current=false;
terrainCache.current=null;lastCacheTm.current=null;lastCacheSl.current=null;},[]);
useEffect(()=>{generate(seed)},[seed,generate]);

// Build terrain RGB cache - renders at RES×RES blocks to match territory tile scale
const updateTerrainCache=useCallback((w,cl)=>{
const buf=new Uint8Array(W*H*3);const tm=cl.tempMod,sl=cl.seaLevel;
// Sample at tile centers, fill RES×RES blocks
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const sx=Math.min(W-1,tx*RES),sy=Math.min(H-1,ty*RES);
const si=sy*W+sx;const e=w.elevation[si],m=w.moisture[si];
const t=Math.max(0,Math.min(1,w.temperature[si]+tm));let r,g,b;
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
const draw=useCallback((ter,cl)=>{
if(!canvasRef.current||!ter)return;const w=worldRef.current;if(!w)return;
const tm=cl.tempMod,sl=cl.seaLevel,vm=viewRef.current;
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
if(!terrainCache.current||lastCacheTm.current===null||Math.abs(tm-lastCacheTm.current)>0.006||Math.abs(sl-lastCacheSl.current)>0.0008){
terrainCache.current=updateTerrainCache(w,cl);lastCacheTm.current=tm;lastCacheSl.current=sl;}
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
// Origin marker
const ox=ter.origin.x*RES+1,oy=ter.origin.y*RES+1;
ctx.beginPath();ctx.arc(ox,oy,4,0,Math.PI*2);ctx.fillStyle="rgba(255,255,200,0.9)";ctx.fill();
ctx.beginPath();ctx.arc(ox,oy,6,0,Math.PI*2);ctx.strokeStyle="rgba(255,200,80,0.5)";ctx.lineWidth=1.5;ctx.stroke();
},[updateTerrainCache]);

useEffect(()=>{viewRef.current=viewMode;if(world&&terRef.current)draw(terRef.current,climate);},[world,climate,draw,viewMode]);

useEffect(()=>{let fid,acc=0,last=performance.now();
const loop=now=>{fid=requestAnimationFrame(loop);if(!playRef.current||!terRef.current||!worldRef.current){last=now;return;}
acc+=now-last;last=now;const iv=Math.max(16,100/speedRef.current);
if(acc>=iv){acc=0;const dt=0.003*speedRef.current/5;simTimeRef.current=Math.min(1,simTimeRef.current+dt);
const cl=getClimate(simTimeRef.current);const sub=Math.max(1,Math.ceil(speedRef.current/3));
for(let s=0;s<sub;s++)terRef.current=stepTerritory(terRef.current,worldRef.current,cl);
setSimTime(simTimeRef.current);setClimate(cl);setCoverage(Math.round(terRef.current.settled/terRef.current.landCount*100));
let alive=0,bestId=-1,bestPow=0;const ter2=terRef.current;
for(let i=0;i<ter2.tribeSizes.length;i++){if(ter2.tribeSizes[i]<=0)continue;alive++;
const pw=tribePower(ter2,i);if(pw>bestPow){bestPow=pw;bestId=i;}}
setTribeCount(alive);setDominant(bestId>=0?{id:bestId,power:bestPow,size:ter2.tribeSizes[bestId],
strength:ter2.tribeStrength[bestId],density:ter2.tribeStrength[bestId]/ter2.tribeSizes[bestId]}:null);
draw(terRef.current,cl);
if(simTimeRef.current>=1){playRef.current=false;setPlaying(false);}}};
fid=requestAnimationFrame(loop);return()=>cancelAnimationFrame(fid);},[draw]);

const togglePlay=()=>{if(simTime>=1){const t=createTerritory(worldRef.current);terRef.current=t;simTimeRef.current=0;setSimTime(0);
const cl=getClimate(0);setClimate(cl);setTribeCount(1);setCoverage(0);setDominant(null);terrainCache.current=null;draw(t,cl);}
playRef.current=!playRef.current;setPlaying(p=>!p);};
const yearStr=climate.yearsBP>1000?`${Math.round(climate.yearsBP/1000)}k BCE`:climate.yearsBP>0?`${Math.round(climate.yearsBP)} BCE`:"Present";
const wetColor=climate.wet>0.7?"#6ae87a":climate.wet>0.4?"#b8b080":"#e8956a";const seaPct=Math.round(Math.abs(climate.seaLevel)*5000);
return(
<div style={{minHeight:"100vh",background:"linear-gradient(180deg,#060810 0%,#0a0e18 50%,#080a12 100%)",
fontFamily:"'Palatino Linotype','Book Antiqua',Palatino,serif",color:"#ccc5b8",display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 12px"}}>
<div style={{textAlign:"center",marginBottom:14}}>
<h1 style={{fontSize:26,fontWeight:400,letterSpacing:8,textTransform:"uppercase",color:"#c9b87a",margin:0,textShadow:"0 0 40px rgba(201,184,122,0.15)"}}>Terra Genesis</h1>
<p style={{fontSize:10,letterSpacing:4,color:"#5a5448",margin:"4px 0 0",textTransform:"uppercase"}}>~69 km/pixel · Milankovitch Climate · Wrapping Globe</p></div>
<div style={{position:"relative",border:"1px solid rgba(201,184,122,0.12)",boxShadow:"0 4px 80px rgba(0,0,0,0.6),inset 0 0 30px rgba(0,0,0,0.4)",borderRadius:4,overflow:"hidden",width:Math.min(W*1.65,960),maxWidth:"97vw"}}>
<canvas ref={canvasRef} width={W} height={H} style={{width:"100%",display:"block",imageRendering:"pixelated"}} />
<div style={{position:"absolute",top:0,left:0,bottom:14,width:2,background:"linear-gradient(180deg,transparent,rgba(201,184,122,0.12),transparent)",pointerEvents:"none"}} />
<div style={{position:"absolute",top:0,right:0,bottom:14,width:2,background:"linear-gradient(180deg,transparent,rgba(201,184,122,0.12),transparent)",pointerEvents:"none"}} />
<div style={{position:"absolute",top:8,left:8,background:"rgba(6,8,16,0.92)",border:"1px solid rgba(201,184,122,0.1)",borderRadius:3,padding:"8px 14px",maxWidth:260}}>
<div style={{display:"flex",alignItems:"baseline",gap:8}}><span style={{fontSize:14,color:"#c9b87a",fontWeight:600,letterSpacing:1}}>{climate.eraName}</span>
<span style={{fontSize:10,color:"#7a7468"}}>{yearStr}</span></div>
<div style={{fontSize:10,color:"#6a6358",marginTop:3,lineHeight:1.5,fontStyle:"italic"}}>{climate.eraDesc}</div></div>
<div style={{position:"absolute",top:8,right:8,background:"rgba(6,8,16,0.92)",border:"1px solid rgba(201,184,122,0.1)",borderRadius:3,padding:"8px 12px",display:"flex",gap:14,textAlign:"right"}}>
<div><div style={{fontSize:8,color:"#5a5448",letterSpacing:1.5,textTransform:"uppercase"}}>Peoples</div><div style={{fontSize:20,color:"#c9b87a",fontWeight:300,lineHeight:1.2}}>{tribeCount}</div></div>
<div><div style={{fontSize:8,color:"#5a5448",letterSpacing:1.5,textTransform:"uppercase"}}>Land Settled</div><div style={{fontSize:20,color:"#c9b87a",fontWeight:300,lineHeight:1.2}}>{coverage}%</div></div>
{dominant&&<div><div style={{fontSize:8,color:"#5a5448",letterSpacing:1.5,textTransform:"uppercase"}}>Dominant</div>
<div style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:8,height:8,borderRadius:1,background:`rgb(${tribeRGB(dominant.id).join(",")})`}} />
<span style={{fontSize:11,color:"#c9b87a"}}>{dominant.size}t</span>
<span style={{fontSize:9,color:"#6a6358"}}>Pop:{dominant.strength.toFixed(1)}</span>
<span style={{fontSize:9,color:"#6a6358"}}>Mil:{dominant.power.toFixed(1)}</span></div></div>}</div>
<div style={{position:"absolute",bottom:22,left:8,background:"rgba(6,8,16,0.82)",borderRadius:3,padding:"4px 10px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
<div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:7,color:"#5a5448",letterSpacing:1,textTransform:"uppercase"}}>Temp</span>
<div style={{width:36,height:5,background:"rgba(255,255,255,0.06)",borderRadius:3,position:"relative"}}>
<div style={{position:"absolute",top:-1,width:5,height:7,left:`${Math.max(2,Math.min(94,50+climate.tempMod*140))}%`,
background:climate.tempMod<-.1?"#6ab0e8":climate.tempMod>0?"#e8956a":"#b8b080",borderRadius:2,transform:"translateX(-50%)",transition:"left 0.3s"}} /></div></div>
<div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:7,color:"#5a5448",letterSpacing:1,textTransform:"uppercase"}}>Sea</span>
<span style={{fontSize:8,color:climate.seaLevel<-.01?"#a8d4f0":"#7a8a9a"}}>{climate.seaLevel<-.005?`−${seaPct}m`:"Normal"}</span></div>
<div style={{display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:7,color:"#5a5448",letterSpacing:1,textTransform:"uppercase"}}>Corridors</span>
<div style={{width:32,height:5,background:"rgba(255,255,255,0.06)",borderRadius:3,overflow:"hidden"}}>
<div style={{height:"100%",width:`${climate.wet*100}%`,background:wetColor,borderRadius:3,transition:"width 0.3s"}} /></div></div></div>
<div style={{position:"absolute",bottom:0,left:0,right:0,height:14,background:"rgba(6,8,16,0.85)",display:"flex",alignItems:"center",padding:"0 4px"}}>
<div style={{flex:1,height:4,background:"rgba(255,255,255,0.04)",borderRadius:2,position:"relative",overflow:"hidden"}}>
<div style={{position:"absolute",top:0,left:0,bottom:0,width:`${simTime*100}%`,background:"linear-gradient(90deg,rgba(201,184,122,0.3),rgba(201,184,122,0.7))",borderRadius:2}} />
<div style={{position:"absolute",top:-1,width:6,height:6,borderRadius:3,left:`${simTime*100}%`,transform:"translateX(-50%)",background:"#c9b87a",boxShadow:"0 0 6px rgba(201,184,122,0.6)"}} /></div></div></div>
<div style={{display:"flex",gap:10,marginTop:14,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
<button onClick={togglePlay} style={{background:playing?"rgba(200,80,60,0.18)":"rgba(201,184,122,0.1)",border:`1px solid ${playing?"rgba(200,80,60,0.3)":"rgba(201,184,122,0.22)"}`,
color:playing?"#e0a090":"#c9b87a",padding:"8px 28px",borderRadius:3,cursor:"pointer",fontSize:12,letterSpacing:2,textTransform:"uppercase",fontFamily:"inherit"}}>
{playing?"❚❚ Pause":simTime>=1?"↺ Restart":"▶ Simulate"}</button>
<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:9,color:"#5a5448",letterSpacing:1,textTransform:"uppercase"}}>Speed</span>
<input type="range" min={1} max={10} value={speed} onChange={e=>{setSpeed(+e.target.value);speedRef.current=+e.target.value}} style={{width:70,accentColor:"#c9b87a"}} /></div>
<button onClick={()=>{presetRef.current=null;setPreset(null);setSeed(Math.floor(Math.random()*999999));}} style={{background:"rgba(201,184,122,0.05)",border:"1px solid rgba(201,184,122,0.15)",
color:"#8a8474",padding:"8px 18px",borderRadius:3,cursor:"pointer",fontSize:11,letterSpacing:1,fontFamily:"inherit"}}>🌍 New World</button>
<button onClick={()=>{presetRef.current="earth";setPreset("earth");setSeed(Math.floor(Math.random()*999999));}} style={{background:preset==="earth"?"rgba(100,160,220,0.18)":"rgba(201,184,122,0.05)",border:`1px solid ${preset==="earth"?"rgba(100,160,220,0.3)":"rgba(201,184,122,0.15)"}`,
color:preset==="earth"?"#7ab8e0":"#8a8474",padding:"8px 18px",borderRadius:3,cursor:"pointer",fontSize:11,letterSpacing:1,fontFamily:"inherit"}}>🌎 Earth</button>
<div style={{display:"flex",gap:2,background:"rgba(255,255,255,0.03)",borderRadius:3,padding:2,border:"1px solid rgba(201,184,122,0.1)"}}>
{[["terrain","Terrain"],["depth","Depth"],["tribes","Tribes"]].map(([k,label])=>(
<button key={k} onClick={()=>{setViewMode(k);viewRef.current=k;}} style={{background:viewMode===k?"rgba(201,184,122,0.18)":"transparent",
border:"none",color:viewMode===k?"#c9b87a":"#5a5448",padding:"5px 10px",borderRadius:2,cursor:"pointer",fontSize:9,letterSpacing:1,
textTransform:"uppercase",fontFamily:"inherit",transition:"all 0.2s"}}>{label}</button>))}</div>
<span style={{fontSize:9,color:"#3a3530",fontFamily:"monospace"}}>seed:{seed}</span></div>
<div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap",justifyContent:"center"}}>
{[["Deep ocean",[8,18,52]],["Shelf",[32,72,120]],["Sea ice",[225,235,248]],["Beach",[198,186,142]],["Tundra",[140,132,115]],
["Desert",[202,176,112]],["Grassland",[118,160,52]],["Forest",[30,98,36]],["Ice sheet",[230,238,245]],["Mountain",[110,100,90]]].map(([n,c])=>(
<div key={n} style={{display:"flex",alignItems:"center",gap:3}}>
<div style={{width:8,height:8,borderRadius:1,background:`rgb(${c})`,border:"1px solid rgba(255,255,255,0.04)"}} />
<span style={{fontSize:9,color:"#4a4438"}}>{n}</span></div>))}
<div style={{display:"flex",alignItems:"center",gap:3}}><div style={{width:14,height:8,borderRadius:1,background:"linear-gradient(90deg,hsl(20,60%,48%),hsl(120,55%,48%),hsl(220,60%,48%))",opacity:.75}} />
<span style={{fontSize:9,color:"#4a4438"}}>Peoples</span></div></div>
<div style={{maxWidth:560,marginTop:14,fontSize:10,color:"#2e2a24",lineHeight:1.7,fontStyle:"italic",textAlign:"center"}}>
Single-canvas compositing: terrain and tribe colors are blended per-pixel into one image.
No scale mismatch possible. Terrain is cached and only recomputed when climate shifts.
Beaches dynamically follow the current coastline as seas rise and fall.
</div></div>);}