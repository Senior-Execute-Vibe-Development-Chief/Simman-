// Quick river diagnostic — check accumulation stats on Earth
import { readFileSync } from 'fs';

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
const{computeRivers,RIVER_NAMES}=await import('../src/riverGen.js');

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

const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES),i=py*W+px;
const ti=ty*tw+tx;tElev[ti]=elevation[i];tTemp[ti]=temperature[i];tMoist[ti]=moisture[i];}

console.log('Computing rivers...');
const t0=Date.now();
const rivers=computeRivers(tw,th,tElev,tMoist,tTemp);
console.log(`River computation: ${Date.now()-t0}ms`);
console.log(`Max accumulation: ${rivers.maxAccum.toFixed(1)}`);

// Stats
let landCount=0;
const counts=[0,0,0,0,0];
for(let ti=0;ti<tw*th;ti++){
if(tElev[ti]>0)landCount++;
counts[rivers.riverMag[ti]]++;}
console.log(`\nLand tiles: ${landCount}`);
console.log(`  None:       ${counts[0]}`);
console.log(`  Stream:     ${counts[1]}`);
console.log(`  Tributary:  ${counts[2]}`);
console.log(`  Major:      ${counts[3]}`);
console.log(`  Great:      ${counts[4]}`);

// Accumulation distribution
const accums=[];
for(let ti=0;ti<tw*th;ti++)if(tElev[ti]>0&&rivers.flowAccum[ti]>0.1)accums.push(rivers.flowAccum[ti]);
accums.sort((a,b)=>a-b);
console.log(`\nAccumulation percentiles (${accums.length} land tiles with flow):`);
for(const p of[50,90,95,99,99.5,99.9,99.95,99.99]){
const idx=Math.min(accums.length-1,Math.floor(accums.length*p/100));
console.log(`  ${p}%: ${accums[idx].toFixed(1)}`);}

// Sample known river locations
function llToTile(lat,lon){
const x=Math.round(((lon+180)/360)*tw)%tw;
const y=Math.round(((90-lat)/180)*th);
return Math.max(0,Math.min(th-1,y))*tw+Math.max(0,Math.min(tw-1,x));}

function sampleRiver(name,lat,lon){
const ti=llToTile(lat,lon);
// Search 5-tile radius for max accumulation
const tx0=ti%tw,ty0=(ti-tx0)/tw;
let maxA=0,maxMag=0;
for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
const nx=(tx0+dx+tw)%tw,ny=ty0+dy;
if(ny<0||ny>=th)continue;
const ni=ny*tw+nx;
if(rivers.flowAccum[ni]>maxA){maxA=rivers.flowAccum[ni];maxMag=rivers.riverMag[ni];}}
console.log(`  ${name.padEnd(25)} accum=${maxA.toFixed(1).padStart(8)}  mag=${RIVER_NAMES[maxMag]||'None'}`);}

console.log('\nRiver location samples (max in 5-tile radius):');
sampleRiver('Amazon mouth',        -1.5, -50.0);
sampleRiver('Amazon (Manaus)',      -3.1, -60.0);
sampleRiver('Nile Delta',          30.5, 31.2);
sampleRiver('Nile (Khartoum)',     15.6, 32.5);
sampleRiver('Congo mouth',         -6.0, 12.5);
sampleRiver('Mississippi mouth',   29.0, -89.5);
sampleRiver('Ganges Delta',        22.5, 89.0);
sampleRiver('Yangtze mouth',       31.5, 121.5);
sampleRiver('Danube Delta',        45.2, 29.5);
sampleRiver('Ob mouth',            66.5, 69.5);
sampleRiver('Mekong Delta',        10.5, 106.5);
sampleRiver('Rhine mouth',         52.0, 4.5);

console.log('\nDone.');
