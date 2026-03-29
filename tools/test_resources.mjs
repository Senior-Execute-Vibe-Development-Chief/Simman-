// ── Resource Placement Calibration Test ──
// Runs Earth(Sim) pipeline and checks resource deposits at real-world locations.
// Usage: node tools/test_resources.mjs

import { readFileSync } from 'fs';

// ── Inline noise/earth functions ──
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
const{generateResources,RESOURCES}=await import('../src/resourceGen.js');

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

// Coastal detection
const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th);
const tCoast=new Uint8Array(tw*th);

for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES),i=py*W+px;
const ti=ty*tw+tx;tElev[ti]=elevation[i];tTemp[ti]=temperature[i];tMoist[ti]=moisture[i];}

for(let ty=1;ty<th-1;ty++)for(let tx=0;tx<tw;tx++){const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES);
if(elevation[py*W+px]>0){outer:for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
const wx=((tx+dx)%tw+tw)%tw,wy=ty+dy;if(wy<0||wy>=th)continue;
if(elevation[Math.min(H-1,wy*RES)*W+Math.min(W-1,wx*RES)]<=0){tCoast[ty*tw+tx]=1;break outer;}}}}

console.log('Generating resources...');
// No pixPlate for Earth mode (no tectonic data), so boundary-dependent resources won't fire
const world={width:W,height:H,pixPlate:null,_seed:42};
const deposits=generateResources(tw,th,tElev,tTemp,tMoist,tCoast,world,42);

// ── Global coverage stats ──
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' RESOURCE COVERAGE STATS');
console.log('═══════════════════════════════════════════════════════════════\n');

let landCount=0;
for(let ti=0;ti<tw*th;ti++)if(tElev[ti]>0)landCount++;

for(const r of RESOURCES){
let count=0,totalRich=0;
for(let ti=0;ti<tw*th;ti++){if(deposits[r.id][ti]>0.05){count++;totalRich+=deposits[r.id][ti];}}
const pct=(count/landCount*100).toFixed(1);
const avgRich=count>0?(totalRich/count*100).toFixed(0):'0';
console.log(`  ${r.label.padEnd(18)} ${pct.padStart(5)}% of land  (${count} tiles, avg richness ${avgRich}%)`);}

// ── Location sampling ──
function llToTile(lat,lon){
const x=Math.round(((lon+180)/360)*tw)%tw;
const y=Math.round(((90-lat)/180)*th);
return{x:Math.max(0,Math.min(tw-1,x)),y:Math.max(0,Math.min(th-1,y))};}

// Sample a wider area around a point (radius 8 tiles = ~16px), return average resources on land tiles
function sampleArea(lat,lon){
const{x,y}=llToTile(lat,lon);
const R=8;
const sums={};for(const r of RESOURCES)sums[r.id]={total:0,count:0,max:0};
let landTiles=0;
for(let dy=-R;dy<=R;dy++)for(let dx=-R;dx<=R;dx++){
const sx=(x+dx+tw)%tw,sy=Math.max(0,Math.min(th-1,y+dy));
const ti=sy*tw+sx;
if(tElev[ti]<=0)continue;
landTiles++;
for(const r of RESOURCES){const v=deposits[r.id][ti];if(v>0.05){sums[r.id].total+=v;sums[r.id].count++;sums[r.id].max=Math.max(sums[r.id].max,v);}}}
const result={};
for(const r of RESOURCES){const s=sums[r.id];
result[r.id]={avg:landTiles>0?s.total/landTiles:0,coverage:landTiles>0?s.count/landTiles:0,max:s.max};}
result._land=landTiles;
result._elev=0;result._temp=0;result._moist=0;
// Get center tile stats
const cti=y*tw+x;
result._elev=tElev[cti];result._temp=tTemp[cti];result._moist=tMoist[cti];
return result;}

function fmtRes(r){
if(r.coverage===0)return '  ---';
return `${(r.avg*100).toFixed(0).padStart(3)}% avg, ${(r.coverage*100).toFixed(0).padStart(3)}% cov, ${(r.max*100).toFixed(0)}% peak`;}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(' LOCATION RESOURCE SAMPLES (5x5 area averages)');
console.log('═══════════════════════════════════════════════════════════════\n');

const locations=[
// ═══ TIMBER ═══
{name:'Amazon Rainforest',      lat:-3.1,  lon:-60.0,  check:['timber'],  expect:'Timber: very high. Others: low'},
{name:'Siberian Taiga',         lat:60.0,  lon:90.0,   check:['timber'],  expect:'Timber: moderate. Cold.'},
{name:'Black Forest, Germany',  lat:48.0,  lon:8.0,    check:['timber'],  expect:'Timber: moderate-high'},
{name:'Sahara Desert',          lat:24.0,  lon:10.0,   check:['timber'],  expect:'Timber: NONE'},

// ═══ MINERALS ═══
{name:'Andes, Chile (copper)',  lat:-23.5, lon:-68.0,  check:['copper','iron'], expect:'Copper: high (real copper belt). Iron: some'},
{name:'Cornwall, England (tin)',lat:50.3,  lon:-5.0,   check:['tin','copper'],  expect:'Tin: should have some. Copper: some'},
{name:'Ural Mountains, Russia', lat:56.0,  lon:59.5,   check:['iron','copper'], expect:'Iron: high. Copper: some'},
{name:'Pilbara, Australia',     lat:-22.0, lon:118.0,  check:['iron'],          expect:'Iron: very high (BIF deposits)'},
{name:'Minnesota Iron Range',   lat:47.5,  lon:-92.5,  check:['iron'],          expect:'Iron: should have some'},

// ═══ SALT ═══
{name:'Dead Sea, Israel',       lat:31.5,  lon:35.5,   check:['salt'],   expect:'Salt: very high (evaporites)'},
{name:'Bonneville, Utah',       lat:40.7,  lon:-113.8,  check:['salt'],   expect:'Salt: high (salt flats)'},
{name:'Venice coast, Italy',    lat:45.4,  lon:12.3,   check:['salt'],   expect:'Salt: moderate (coastal)'},

// ═══ HORSES ═══
{name:'Mongolian Steppe',       lat:47.0,  lon:105.0,  check:['horses'], expect:'Horses: very high (steppe heartland)'},
{name:'Kazakhstan Steppe',      lat:48.0,  lon:68.0,   check:['horses'], expect:'Horses: very high'},
{name:'Great Plains, Nebraska', lat:41.0,  lon:-100.0, check:['horses'], expect:'Horses: high (grassland)'},
{name:'Congo Rainforest',       lat:0.5,   lon:21.0,   check:['horses'], expect:'Horses: NONE (wrong biome)'},

// ═══ PRECIOUS METALS ═══
{name:'Witwatersrand, S.Africa',lat:-26.2, lon:27.8,   check:['precious','gems'], expect:'Gold: high (biggest deposit on earth)'},
{name:'California Gold Country',lat:38.5,  lon:-120.5, check:['precious'],        expect:'Gold: some (alluvial)'},
{name:'Klondike, Yukon',        lat:64.0,  lon:-139.0, check:['precious'],        expect:'Gold: some'},

// ═══ COAL ═══
{name:'Wales, UK',              lat:51.7,  lon:-3.4,   check:['coal'],   expect:'Coal: high (coalfields)'},
{name:'Appalachia, West Virginia',lat:38.3,lon:-81.0,  check:['coal'],   expect:'Coal: high'},
{name:'Ruhr, Germany',          lat:51.5,  lon:7.3,    check:['coal'],   expect:'Coal: high'},
{name:'Shanxi, China',          lat:37.8,  lon:112.5,  check:['coal'],   expect:'Coal: high'},

// ═══ OIL ═══
{name:'Persian Gulf (Kuwait)',  lat:29.3,  lon:48.0,   check:['oil'],    expect:'Oil: very high (biggest reserves)'},
{name:'West Texas (Permian)',   lat:31.9,  lon:-102.0, check:['oil'],    expect:'Oil: high'},
{name:'Siberian Basin',         lat:61.0,  lon:73.0,   check:['oil'],    expect:'Oil: some'},
{name:'Niger Delta, Nigeria',   lat:5.0,   lon:6.5,    check:['oil'],    expect:'Oil: high (coastal sedimentary)'},
{name:'North Sea analog (Scotland coast)',lat:57.5,lon:-1.5, check:['oil'], expect:'Oil: some (coastal)'},

// ═══ GEMS ═══
{name:'Kimberley, S.Africa',    lat:-28.7, lon:24.8,   check:['gems'],   expect:'Gems: high (diamond pipes)'},
{name:'Myanmar (Mogok)',        lat:22.9,  lon:96.5,   check:['gems'],   expect:'Gems: high (rubies)'},
{name:'Colombia (Muzo)',        lat:5.5,   lon:-74.1,  check:['gems'],   expect:'Gems: some (emeralds)'},

// ═══ STONE ═══
{name:'Carrara, Italy (marble)',lat:44.1,  lon:10.1,   check:['stone'],  expect:'Stone: moderate-high'},
{name:'Egyptian Desert (quarries)',lat:26.0,lon:33.0,   check:['stone'],  expect:'Stone: high'},
];

for(const loc of locations){
const s=sampleArea(loc.lat,loc.lon);
console.log(`  ${loc.name}`);
console.log(`    [elev=${(s._elev*8000).toFixed(0)}m  temp=${(s._temp*50-10).toFixed(0)}°C  moist=${(s._moist*100).toFixed(0)}%  land=${s._land}]`);
for(const rid of loc.check){
const r=s[rid];
const rDef=RESOURCES.find(x=>x.id===rid);
console.log(`    ${rDef.label.padEnd(18)} ${fmtRes(r)}`);}
console.log(`    Expected: ${loc.expect}`);
console.log();}

console.log('Done.');
