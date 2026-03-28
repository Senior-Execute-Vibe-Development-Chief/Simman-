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
  // ═══ WEST NORTH AMERICA ═══
  {name:'W US (Vancouver BC)', lat:49.3, lon:-123.1, min:0.5, max:0.8},
  {name:'W US (Seattle)', lat:47.6, lon:-122.3, min:0.5, max:0.8},
  {name:'W US (Portland)', lat:45.5, lon:-122.7, min:0.5, max:0.8},
  {name:'W US (San Fran)', lat:37.8, lon:-122.4, min:0.3, max:0.5},
  {name:'W US (LA)', lat:34.0, lon:-118.2, min:0.15, max:0.35},
  {name:'W US (San Diego)', lat:32.7, lon:-117.2, min:0.1, max:0.3},
  {name:'W US (Denver)', lat:39.7, lon:-105.0, min:0.15, max:0.35},
  {name:'W US (Salt Lake)', lat:40.8, lon:-111.9, min:0.1, max:0.3},
  {name:'W US (Phoenix)', lat:33.4, lon:-112.0, min:0.05, max:0.2},
  {name:'W US (Las Vegas)', lat:36.2, lon:-115.1, min:0.05, max:0.15},
  {name:'W US (Boise)', lat:43.6, lon:-116.2, min:0.15, max:0.35},
  {name:'Alaska (Anchorage)', lat:61.2, lon:-150.0, min:0.2, max:0.5},
  {name:'Alaska (Juneau)', lat:58.3, lon:-134.4, min:0.5, max:0.8},

  // ═══ EAST NORTH AMERICA ═══
  {name:'E US (Miami)', lat:25.8, lon:-80.2, min:0.5, max:0.8},
  {name:'E US (New Orleans)', lat:30.0, lon:-90.0, min:0.5, max:0.8},
  {name:'E US (Houston)', lat:29.8, lon:-95.4, min:0.4, max:0.7},
  {name:'E US (Atlanta)', lat:33.7, lon:-84.4, min:0.4, max:0.7},
  {name:'E US (Charlotte)', lat:35.2, lon:-80.8, min:0.4, max:0.7},
  {name:'E US (Washington DC)', lat:38.9, lon:-77.0, min:0.4, max:0.7},
  {name:'E US (New York)', lat:40.7, lon:-74.0, min:0.4, max:0.7},
  {name:'E US (Boston)', lat:42.4, lon:-71.1, min:0.4, max:0.7},
  {name:'US Midwest (Chicago)', lat:41.9, lon:-87.6, min:0.3, max:0.6},
  {name:'US Midwest (Minneap)', lat:44.9, lon:-93.3, min:0.3, max:0.5},
  {name:'US Great Plains (KC)', lat:39.1, lon:-94.6, min:0.3, max:0.5},
  {name:'US Great Plains (OKC)', lat:35.5, lon:-97.5, min:0.3, max:0.5},
  {name:'US (Dallas)', lat:32.8, lon:-96.8, min:0.3, max:0.6},
  {name:'Canada (Toronto)', lat:43.7, lon:-79.4, min:0.3, max:0.6},
  {name:'Canada (Montreal)', lat:45.5, lon:-73.6, min:0.3, max:0.6},
  {name:'Canada (Winnipeg)', lat:49.9, lon:-97.1, min:0.2, max:0.45},

  // ═══ ANDES / WEST SOUTH AMERICA ═══
  {name:'Andes (Quito)', lat:-0.2, lon:-78.5, min:0.4, max:0.7},
  {name:'Andes (Bogota)', lat:4.7, lon:-74.1, min:0.4, max:0.7},
  {name:'Andes (Lima)', lat:-12.0, lon:-77.0, min:0.02, max:0.15},
  {name:'Andes (La Paz)', lat:-16.5, lon:-68.1, min:0.2, max:0.4},
  {name:'Andes (Santiago)', lat:-33.4, lon:-70.7, min:0.15, max:0.35},
  {name:'Atacama coast', lat:-24.0, lon:-70.0, min:0.0, max:0.08},
  {name:'Patagonia (dry E)', lat:-45.0, lon:-69.0, min:0.1, max:0.25},
  {name:'Patagonia (wet W)', lat:-45.0, lon:-72.0, min:0.5, max:0.8},

  // ═══ CENTRAL/EAST SOUTH AMERICA ═══
  {name:'Amazon (Manaus)', lat:-3.1, lon:-60.0, min:0.7, max:1.0},
  {name:'Amazon (Belem)', lat:-1.4, lon:-48.5, min:0.7, max:1.0},
  {name:'NE Brazil (Recife)', lat:-8.0, lon:-35.0, min:0.4, max:0.7},
  {name:'C Brazil (Brasilia)', lat:-15.8, lon:-47.9, min:0.4, max:0.7},
  {name:'SE Brazil (SP)', lat:-23.5, lon:-46.6, min:0.4, max:0.7},
  {name:'S Brazil (P.Alegre)', lat:-30.0, lon:-51.2, min:0.4, max:0.6},
  {name:'Paraguay', lat:-23.0, lon:-58.0, min:0.3, max:0.6},
  {name:'Bolivia lowlands', lat:-17.0, lon:-64.0, min:0.3, max:0.6},
  {name:'Uruguay (Montevideo)', lat:-34.9, lon:-56.2, min:0.3, max:0.6},
  {name:'Argentina (Pampas)', lat:-35.0, lon:-60.0, min:0.3, max:0.5},
  {name:'Argentina (Mendoza)', lat:-32.9, lon:-68.8, min:0.1, max:0.25},

  // ═══ CHINA ═══
  {name:'S China (Guangzhou)', lat:23.0, lon:113.0, min:0.5, max:0.8},
  {name:'SE China (Shanghai)', lat:31.2, lon:121.5, min:0.4, max:0.7},
  {name:'E China (Wuhan)', lat:30.6, lon:114.3, min:0.4, max:0.7},
  {name:'N China (Beijing)', lat:40.0, lon:116.0, min:0.3, max:0.5},
  {name:'NE China (Harbin)', lat:45.8, lon:126.7, min:0.25, max:0.45},
  {name:'C China (Chengdu)', lat:30.6, lon:104.1, min:0.4, max:0.7},
  {name:'NW China (Urumqi)', lat:43.8, lon:87.6, min:0.05, max:0.2},
  {name:'Tibet (Lhasa)', lat:29.6, lon:91.1, min:0.1, max:0.3},
  {name:'Inner Mongolia', lat:42.0, lon:112.0, min:0.1, max:0.25},

  // ═══ RUSSIA ═══
  {name:'Russia (St Petersbg)', lat:59.9, lon:30.3, min:0.3, max:0.55},
  {name:'Russia (Moscow)', lat:55.8, lon:37.6, min:0.25, max:0.5},
  {name:'Russia (Kazan)', lat:55.8, lon:49.1, min:0.2, max:0.45},
  {name:'Ukraine (Kyiv)', lat:50.5, lon:30.5, min:0.3, max:0.5},
  {name:'Russia (Volgograd)', lat:48.7, lon:44.5, min:0.2, max:0.4},
  {name:'Russia (Yekaterinbg)', lat:56.8, lon:60.6, min:0.2, max:0.4},
  {name:'W Siberia (Novosibi)', lat:55.0, lon:83.0, min:0.2, max:0.4},
  {name:'C Siberia (Krasnoy)', lat:56.0, lon:93.0, min:0.2, max:0.4},
  {name:'E Siberia (Yakutsk)', lat:62.0, lon:130.0, min:0.15, max:0.35},
  {name:'E Siberia (Irkutsk)', lat:52.3, lon:104.3, min:0.2, max:0.35},
  {name:'Far East (Vladivost)', lat:43.7, lon:131.4, min:0.3, max:0.6},
  {name:'Far East (Magadan)', lat:59.6, lon:150.0, min:0.15, max:0.35},

  // ═══ NORTH AFRICA (user says lower portion too wet) ═══
  {name:'Sahara (center)', lat:23.0, lon:10.0, min:0.0, max:0.08},
  {name:'Sahara (west)', lat:24.0, lon:-5.0, min:0.0, max:0.08},
  {name:'Sahara (east/Libya)', lat:25.0, lon:20.0, min:0.0, max:0.08},
  {name:'Sahara (south/Niger)', lat:17.0, lon:8.0, min:0.05, max:0.2},
  {name:'Sahel (Niamey)', lat:13.5, lon:2.1, min:0.2, max:0.45},
  {name:'Sahel (Khartoum)', lat:15.6, lon:32.5, min:0.05, max:0.2},
  {name:'N Africa (Tripoli)', lat:32.9, lon:13.2, min:0.1, max:0.3},
  {name:'N Africa (Cairo)', lat:30.0, lon:31.2, min:0.02, max:0.1},
  {name:'N Africa (Algiers)', lat:36.8, lon:3.1, min:0.2, max:0.4},
  {name:'W Africa (Dakar)', lat:14.7, lon:-17.5, min:0.2, max:0.5},
  {name:'W Africa (Lagos)', lat:6.5, lon:3.4, min:0.5, max:0.8},
  {name:'C Africa (Kinshasa)', lat:-4.3, lon:15.3, min:0.6, max:0.9},

  // ═══ MIDDLE EAST / ARABIA ═══
  {name:'Arabian (Riyadh)', lat:24.7, lon:46.7, min:0.0, max:0.08},
  {name:'Arabian (Empty Qtr)', lat:20.0, lon:50.0, min:0.0, max:0.08},
  {name:'Iran (Tehran)', lat:35.7, lon:51.4, min:0.1, max:0.25},
  {name:'Iraq (Baghdad)', lat:33.3, lon:44.4, min:0.05, max:0.15},

  // ═══ OTHER REFERENCE POINTS ═══
  {name:'Congo', lat:0.5, lon:21.0, min:0.7, max:1.0},
  {name:'Australia Outback', lat:-25.0, lon:135.0, min:0.0, max:0.15},
  {name:'India (Mumbai)', lat:19.0, lon:73.0, min:0.5, max:0.8},
  {name:'India (Delhi)', lat:28.6, lon:77.2, min:0.2, max:0.5},
  {name:'Japan (Honshu)', lat:38.1, lon:137.3, min:0.4, max:0.7},
  {name:'Korea (Seoul)', lat:37.6, lon:127.0, min:0.4, max:0.6},
  {name:'UK (London)', lat:51.5, lon:-0.1, min:0.4, max:0.7},
  {name:'France (Paris)', lat:48.8, lon:2.3, min:0.3, max:0.6},
  {name:'Germany (Berlin)', lat:52.5, lon:13.4, min:0.3, max:0.6},
  {name:'Spain (Madrid)', lat:40.4, lon:-3.7, min:0.2, max:0.4},
  {name:'Italy (Rome)', lat:41.9, lon:12.5, min:0.3, max:0.5},
  {name:'Turkey (Ankara)', lat:39.9, lon:32.9, min:0.2, max:0.4},
  {name:'Indonesia (Borneo)', lat:1.1, lon:113.8, min:0.7, max:1.0},
  {name:'SE Asia (Bangkok)', lat:13.8, lon:100.5, min:0.5, max:0.8},
  {name:'Antarctica', lat:-80.0, lon:0.0, min:0.0, max:0.05},
  {name:'Greenland (inland)', lat:72.0, lon:-40.0, min:0.0, max:0.1},
  {name:'Iceland', lat:64.1, lon:-22.0, min:0.35, max:0.6},
  {name:'Scandinavia (Oslo)', lat:59.9, lon:10.7, min:0.3, max:0.55},
  {name:'New Zealand', lat:-38.8, lon:172.7, min:0.5, max:0.8},
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
