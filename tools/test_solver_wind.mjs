// Test moisture with COMPUTED (solver) wind on Earth heightmap
import { readFileSync } from 'fs';

const PERM = new Uint8Array(512);
const GRAD = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(seed) {
  const p = new Uint8Array(256); for (let i=0;i<256;i++) p[i]=i;
  for (let i=255;i>0;i--) { seed=(seed*16807)%2147483647; const j=seed%(i+1); [p[i],p[j]]=[p[j],p[i]]; }
  for (let i=0;i<512;i++) PERM[i]=p[i&255];
}
function noise2D(x,y) {
  const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y);
  const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];
  const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;
  const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf));
  const l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));
  return l1+v*(l2-l1);
}
function fbm(x,y,o,l,g) { let v=0,a=1,f=1,m=0; for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;} return v/m; }

const earthSrc = readFileSync('src/earthData.js', 'utf8');
const b64Match = earthSrc.match(/export const EARTH_ELEV="([^"]+)"/);
const earthData = Buffer.from(b64Match[1], 'base64');
const EARTH_W = 720, EARTH_H = 360;
function sampleEarth(data, sw, sh, x, y, tw, th) {
  const fx = (x / tw) * sw, fy = (y / th) * sh;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(sw-1, x0+1), y1 = Math.min(sh-1, y0+1);
  const dx = fx-x0, dy = fy-y0;
  return data[y0*sw+(x0%sw)]*(1-dx)*(1-dy) + data[y0*sw+(x1%sw)]*dx*(1-dy) + data[y1*sw+(x0%sw)]*(1-dx)*dy + data[y1*sw+(x1%sw)]*dx*dy;
}

const W = 1920, H = 960;
const elevation = new Float32Array(W * H);
const temperature = new Float32Array(W * H);

initNoise(42);
console.log('Building elevation...');
for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
  const i=y*W+x, nx=x/W, ny=y/H;
  const he = sampleEarth(earthData, EARTH_W, EARTH_H, x, y, W, H);
  const noise = fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012 + fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
  if (he<3) { elevation[i] = -0.03-Math.max(0,(1-he/3))*0.12 + fbm(nx*8+50,ny*8+50,3,2,.5)*.04; }
  else { elevation[i] = Math.max(0.001,(he-3)/252*0.55+0.005+noise); }
}

console.log('Running wind solver...');
const { solveWind } = await import('../src/windSolver.js');
const wind = solveWind(W, H, elevation, fbm, {}, 42*0.0137);

console.log('Running moisture solver...');
const { solveMoisture } = await import('../src/moistureSolver.js');
const t0 = Date.now();
const moisture = solveMoisture(W, H, elevation, wind.windX, wind.windY, temperature, {});
console.log(`Done in ${Date.now()-t0}ms\n`);

function sample(lat, lon) {
  const x = Math.round(((lon+180)/360)*W) % W;
  const y = Math.max(0,Math.min(H-1, Math.round(((90-lat)/180)*H)));
  const i = y*W+x;
  return { m: moisture[i], e: elevation[i], wu: wind.windX[i], wv: wind.windY[i] };
}

const locs = [
  {name:'E US (Atlanta)', lat:33.7, lon:-84.4, min:0.4, max:0.7},
  {name:'E US (New York)', lat:40.7, lon:-74.0, min:0.4, max:0.7},
  {name:'US Midwest (Chicago)', lat:41.9, lon:-87.6, min:0.3, max:0.6},
  {name:'W US (Seattle)', lat:47.6, lon:-122.3, min:0.5, max:0.8},
  {name:'W US (San Fran)', lat:37.8, lon:-122.4, min:0.3, max:0.5},
  {name:'US Great Plains', lat:40, lon:-100, min:0.2, max:0.5},
  {name:'US SW (Phoenix)', lat:33.4, lon:-112, min:0.05, max:0.2},
  {name:'C S.Am (Paraguay)', lat:-23, lon:-58, min:0.3, max:0.6},
  {name:'C S.Am (Bolivia)', lat:-17, lon:-64, min:0.3, max:0.6},
  {name:'SE Brazil (SP)', lat:-23.5, lon:-46.6, min:0.4, max:0.7},
  {name:'Argentina (Pampas)', lat:-35, lon:-60, min:0.3, max:0.5},
  {name:'E China (Wuhan)', lat:30, lon:114, min:0.4, max:0.7},
  {name:'N China (Beijing)', lat:40, lon:116, min:0.3, max:0.5},
  {name:'S China (Guangzhou)', lat:23, lon:113, min:0.5, max:0.8},
  {name:'W Russia (Moscow)', lat:55.8, lon:37.6, min:0.25, max:0.5},
  {name:'Ukraine', lat:49, lon:32, min:0.3, max:0.5},
  {name:'S Russia (Volga)', lat:55, lon:50, min:0.2, max:0.45},
  {name:'W Siberia', lat:55, lon:83, min:0.2, max:0.4},
  {name:'Amazon (Manaus)', lat:-3.1, lon:-60, min:0.7, max:1.0},
  {name:'Congo', lat:0.5, lon:21, min:0.7, max:1.0},
  {name:'Sahara', lat:23, lon:10, min:0.0, max:0.08},
  {name:'Arabian', lat:23, lon:46, min:0.0, max:0.08},
  {name:'Australia Outback', lat:-25, lon:135, min:0.0, max:0.15},
];

console.log('SOLVER WIND — Moisture Check:');
console.log('='.repeat(85));
console.log(`${'Location'.padEnd(25)} ${'Moist'.padStart(6)} ${'Target'.padStart(12)} ${'Elev'.padStart(7)} ${'WndX'.padStart(8)} ${'WndY'.padStart(8)}`);
console.log('-'.repeat(85));
let good=0,close=0,bad=0;
for (const loc of locs) {
  const s = sample(loc.lat, loc.lon);
  const ok = s.m>=loc.min && s.m<=loc.max ? '✓' : (s.m>=loc.min-0.1 && s.m<=loc.max+0.1 ? '~' : '✗');
  if (ok==='✓') good++; else if (ok==='~') close++; else bad++;
  console.log(`${ok} ${loc.name.padEnd(23)} ${s.m.toFixed(3).padStart(6)}  ${(loc.min.toFixed(2)+'-'+loc.max.toFixed(2)).padStart(11)} ${s.e.toFixed(3).padStart(7)} ${s.wu.toFixed(4).padStart(8)} ${s.wv.toFixed(4).padStart(8)}`);
}
console.log('-'.repeat(85));
console.log(`Score: ${good}/${locs.length} in range, ${close} close, ${bad} wrong`);
let cnt=0, sum=0;
for (let i=0;i<W*H;i++) { if (elevation[i]>0) { cnt++; sum+=moisture[i]; } }
console.log(`Land mean: ${(sum/cnt).toFixed(3)}`);
