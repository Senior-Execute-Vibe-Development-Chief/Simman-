// ── Fertility Calibration Test ──
// Runs the full Earth(Sim) pipeline and checks fertility values
// at locations that should have distinct geological fertility.
//
// Usage: node tools/test_fertility.mjs

import { readFileSync } from 'fs';

// ── Inline noise/earth functions (same as test_moisture.mjs) ──
const PERM=new Uint8Array(512);const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(s){const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){s=(s*16807)%2147483647;const j=s%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)PERM[i]=p[i&255];}
function noise2D(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));return l1+v*(l2-l1);}
function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}

const earthSrc=readFileSync('src/earthData.js','utf8');
const b64Match=earthSrc.match(/export const EARTH_ELEV="([^"]+)"/);
const earthData=Buffer.from(b64Match[1],'base64');
const EARTH_W=720,EARTH_H=360;
function sampleEarth(data,sw,sh,x,y,tw,th){const fx=(x/tw)*sw,fy=(y/th)*sh;const x0=Math.floor(fx),y0=Math.floor(fy);const x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);const dx=fx-x0,dy=fy-y0;return data[y0*sw+(x0%sw)]*(1-dx)*(1-dy)+data[y0*sw+(x1%sw)]*dx*(1-dy)+data[y1*sw+(x0%sw)]*(1-dx)*dy+data[y1*sw+(x1%sw)]*dx*dy;}

const windData=JSON.parse(readFileSync('data/global_wind.json','utf8'));
function sampleWind(x,y,W,H){const lats=windData.lat,lons=windData.lon,nLat=lats.length,nLon=lons.length;const lat=90-(y/(H-1))*180,lon=((x/W)*360+180)%360;let latIdx0=0;for(let i=0;i<nLat-1;i++){if(lats[i]>=lat&&lats[i+1]<lat){latIdx0=i;break;}}const latIdx1=Math.min(nLat-1,latIdx0+1);const latRange=lats[latIdx1]-lats[latIdx0];const latFrac=latRange!==0?(lat-lats[latIdx0])/latRange:0;let lonIdx0=0;for(let i=0;i<nLon-1;i++){if(lons[i]<=lon&&lons[i+1]>lon){lonIdx0=i;break;}if(i===nLon-2)lonIdx0=i;}const lonIdx1=(lonIdx0+1)%nLon;const lonRange=lonIdx1>lonIdx0?lons[lonIdx1]-lons[lonIdx0]:(360-lons[lonIdx0]+lons[lonIdx1]);const lonFrac=lonRange!==0?((lon-lons[lonIdx0]+360)%360)/lonRange:0;let u00=0,u10=0,u01=0,u11=0,v00=0,v10=0,v01=0,v11=0;for(let m=0;m<12;m++){const md=windData[String(m)];u00+=md.u[latIdx0][lonIdx0];u10+=md.u[latIdx0][lonIdx1];u01+=md.u[latIdx1][lonIdx0];u11+=md.u[latIdx1][lonIdx1];v00+=md.v[latIdx0][lonIdx0];v10+=md.v[latIdx0][lonIdx1];v01+=md.v[latIdx1][lonIdx0];v11+=md.v[latIdx1][lonIdx1];}const inv12=1/12;u00*=inv12;u10*=inv12;u01*=inv12;u11*=inv12;v00*=inv12;v10*=inv12;v01*=inv12;v11*=inv12;const lf=Math.max(0,Math.min(1,latFrac)),xf=Math.max(0,Math.min(1,lonFrac));return{u:(u00*(1-xf)+u10*xf)*(1-lf)+(u01*(1-xf)+u11*xf)*lf,v:(v00*(1-xf)+v10*xf)*(1-lf)+(v01*(1-xf)+v11*xf)*lf};}

const{solveMoisture}=await import('../src/moistureSolver.js');

const W=1920,H=960,RES=2;
const elevation=new Float32Array(W*H),temperature=new Float32Array(W*H);
const windX=new Float32Array(W*H),windY=new Float32Array(W*H);
initNoise(42);

console.log('Building Earth...');
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(earthData,EARTH_W,EARTH_H,x,y,W,H);
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){elevation[i]=-0.03-Math.max(0,(1-he/3))*0.12+fbm(nx*8+50,ny*8+50,3,2,.5)*.04;}
else{elevation[i]=Math.max(0.001,(he-3)/252*0.55+0.005+noise);}
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,elevation[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));}

console.log('Wind + moisture...');
const SCALE=0.008;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const{u,v}=sampleWind(x,y,W,H);const i=y*W+x;windX[i]=u*SCALE;windY[i]=v*SCALE;}
const moisture=solveMoisture(W,H,elevation,windX,windY,temperature,{});

// Swamp generation
const swamp=new Uint8Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
if(elevation[i]>0&&elevation[i]<0.025&&moisture[i]>0.45&&temperature[i]>0.35){
const nv=fbm(x/W*20+300,y/H*20+300,2,2,.5);if(nv>-0.1)swamp[i]=1;}}

// Coastal detection
const ctw=Math.ceil(W/RES),cth=Math.ceil(H/RES);
const coastal=new Uint8Array(ctw*cth);
for(let ty=1;ty<cth-1;ty++)for(let tx=0;tx<ctw;tx++){const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
if(elevation[py*W+px]>0){outer:for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
const wx=((tx+dx)%ctw+ctw)%ctw,wy=ty+dy;if(wy<0||wy>=cth)continue;
if(elevation[Math.min(H-1,wy*RES)*W+Math.min(W-1,wx*RES)]<=0){coastal[ty*ctw+tx]=1;break outer;}}}}

// tileFert function
function tileFert(t,m,e){if(e>0.45)return 0.05;const base=Math.min(1,t*1.2)*Math.min(1,m*1.3);return Math.max(0.05,base*(1-Math.max(0,e-0.15)*3));}

// Build territory-like tile arrays
console.log('Computing fertility with geological modifiers...');
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th),tFert=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th);
const DIRS=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

// Pass 1: base
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES),i=py*W+px;
const ti=ty*tw+tx;tElev[ti]=elevation[i];tTemp[ti]=temperature[i];tMoist[ti]=moisture[i];tCoast[ti]=coastal[ti];
tFert[ti]=tileFert(temperature[i],moisture[i],elevation[i]);
// Swamp
let hasSwamp=false;
for(let dy=0;dy<RES;dy++)for(let dx=0;dx<RES;dx++){
const wi=Math.min(H-1,py+dy)*W+Math.min(W-1,px+dx);if(swamp[wi])hasSwamp=true;}
if(hasSwamp)tFert[ti]=Math.min(1,tFert[ti]+0.2);}

// Save pre-modifier fertility for comparison
const baseFert=new Float32Array(tFert);

// Pass 2: geological modifiers (same as WorldSim.jsx createTerritory)

// 2a: Tropical penalty
for(let ti=0;ti<tw*th;ti++){const t=tTemp[ti],m=tMoist[ti],e=tElev[ti];
if(e<=0)continue;
if(t>0.65&&m>0.50){const trop=Math.min(1,(t-0.65)/0.25)*Math.min(1,(m-0.50)/0.35);
tFert[ti]*=(1-trop*0.55);}}

// 2b: Alluvial lowland bonus
for(let ty=1;ty<th-1;ty++)for(let tx=0;tx<tw;tx++){const ti=ty*tw+tx;
const e=tElev[ti],m=tMoist[ti],t=tTemp[ti];
if(e<=0||e>0.08||m<0.30)continue;
let elevDiffSum=0,moistSum=0,cnt=0;
for(const[dx,dy]of DIRS){const nx=(tx+dx+tw)%tw,ny=ty+dy;if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;if(tElev[ni]<=0)continue;elevDiffSum+=Math.abs(tElev[ni]-e);moistSum+=tMoist[ni];cnt++;}
if(cnt<3)continue;
const flatness=Math.max(0,1-(elevDiffSum/cnt)*40);
const moistGrad=Math.max(0,m-moistSum/cnt);
const alluvial=flatness*Math.min(1,moistGrad*6)*Math.min(1,(0.08-e)*20);
const tempFit=t>0.30&&t<0.70?1.0:t>0.20&&t<0.80?0.6:0.3;
const bonus=alluvial*tempFit*0.8;
if(bonus>0.02)tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}

// 2c: Temperate grassland bonus
for(let ti=0;ti<tw*th;ti++){const e=tElev[ti],t=tTemp[ti],m=tMoist[ti];
if(e<=0||e>0.15)continue;
const tempFit=Math.exp(-((t-0.45)*(t-0.45))/(2*0.10*0.10));
const moistFit=Math.exp(-((m-0.28)*(m-0.28))/(2*0.10*0.10));
const bonus=tempFit*moistFit*0.30;
if(bonus>0.02)tFert[ti]=Math.min(1,tFert[ti]+tFert[ti]*bonus);}

// 2e: Coastal bonus
for(let ti=0;ti<tw*th;ti++){if(tCoast[ti]&&tElev[ti]>0)tFert[ti]=Math.min(1,tFert[ti]+0.06);}

// ── Sample locations ──
function llToTile(lat,lon){
const x=Math.round(((lon+180)/360)*tw)%tw;
const y=Math.round(((90-lat)/180)*th);
return{x:Math.max(0,Math.min(tw-1,x)),y:Math.max(0,Math.min(th-1,y))};}

function sample(lat,lon){
const{x,y}=llToTile(lat,lon);
for(let r=0;r<=6;r++){
for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
if(r>0&&Math.abs(dx)<r&&Math.abs(dy)<r)continue;
const sx=(x+dx+tw)%tw,sy=Math.max(0,Math.min(th-1,y+dy));
const ti=sy*tw+sx;
if(tElev[ti]>0)return{fert:tFert[ti],base:baseFert[ti],elev:tElev[ti],temp:tTemp[ti],moist:tMoist[ti]};}}
return null;}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' FERTILITY CALIBRATION TEST — GEOLOGICAL MODIFIERS');
console.log('═══════════════════════════════════════════════════════════════\n');

const locations=[
// ═══ SHOULD BE HIGH FERTILITY (alluvial/river valley analogs) ═══
{name:'Nile Delta, Egypt',      lat:30.5, lon:31.2,  expect:'HIGH (alluvial)'},
{name:'Mesopotamia (Baghdad)',  lat:33.3, lon:44.4,  expect:'HIGH (alluvial)'},
{name:'Ganges Plain, India',    lat:26.8, lon:81.0,  expect:'HIGH (alluvial)'},
{name:'Yangtze Delta, China',   lat:31.2, lon:121.5, expect:'HIGH (alluvial)'},
{name:'Mekong Delta, Vietnam',  lat:10.5, lon:106.0, expect:'HIGH (alluvial)'},
{name:'Po Valley, Italy',       lat:45.0, lon:11.0,  expect:'HIGH (alluvial)'},

// ═══ SHOULD BE HIGH (temperate grassland/chernozem) ═══
{name:'Ukraine (Kyiv)',         lat:50.4, lon:30.5,  expect:'HIGH (chernozem)'},
{name:'Great Plains, Kansas',   lat:38.5, lon:-98.0, expect:'HIGH (grassland)'},
{name:'Pampas, Argentina',      lat:-35.0,lon:-61.0, expect:'HIGH (grassland)'},

// ═══ SHOULD BE MODERATE-LOW (tropical penalty) ═══
{name:'Amazon (Manaus)',        lat:-3.1, lon:-60.0, expect:'LOW (laterite)'},
{name:'Congo Basin',           lat:0.5,  lon:21.0,  expect:'LOW (laterite)'},
{name:'Borneo Interior',       lat:1.0,  lon:113.8, expect:'LOW (laterite)'},

// ═══ SHOULD BE LOW (desert/cold) ═══
{name:'Sahara (central)',       lat:24.0, lon:10.0,  expect:'VERY LOW (desert)'},
{name:'Siberia (Yakutsk)',      lat:62.0, lon:129.7, expect:'VERY LOW (cold)'},
{name:'Greenland',              lat:72.0, lon:-40.0, expect:'VERY LOW (ice)'},

// ═══ REFERENCE: Mediterranean ═══
{name:'Southern France',        lat:43.6, lon:3.9,   expect:'MODERATE (Mediterranean)'},
{name:'Central England',        lat:52.0, lon:-1.5,  expect:'MODERATE (temperate)'},
];

for(const loc of locations){
const s=sample(loc.lat,loc.lon);
if(!s){console.log(`  ✗ ${loc.name}: no land found`);continue;}
const pct=Math.round(s.fert*100);
const basePct=Math.round(s.base*100);
const change=pct-basePct;
const arrow=change>2?`↑+${change}`:change<-2?`↓${change}`:'=';
console.log(`  ${loc.name}`);
console.log(`    Fertility: ${pct}% (was ${basePct}%) ${arrow}  |  elev=${(s.elev*8000).toFixed(0)}m  temp=${(s.temp*50-10).toFixed(0)}°C  moist=${(s.moist*100).toFixed(0)}%`);
console.log(`    Expected: ${loc.expect}`);
console.log();}

console.log('Done.');
