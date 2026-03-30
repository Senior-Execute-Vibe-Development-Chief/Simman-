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

const{computeRivers}=await import('../src/riverGen.js');

const W=1920,H=960,RES=1;
const elevation=new Float32Array(W*H),temperature=new Float32Array(W*H),moisture=new Float32Array(W*H);
initNoise(42);

console.log('Building Earth...');
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(earthData,EARTH_W,EARTH_H,x,y,W,H);
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){elevation[i]=-0.03-Math.max(0,(1-he/3))*0.12+fbm(nx*8+50,ny*8+50,3,2,.5)*.04;}
else{elevation[i]=Math.max(0.001,(he-3)/252*0.55+0.005+noise);}
temperature[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,elevation[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));
moisture[i]=0.3;}

const tw=Math.ceil(W/RES),th=Math.ceil(H/RES);
const tElev=new Float32Array(tw*th),tTemp=new Float32Array(tw*th),tMoist=new Float32Array(tw*th);
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
const px=Math.min(W-1,tx*RES),py=Math.min(H-1,ty*RES),i=py*W+px;
const ti=ty*tw+tx;tElev[ti]=elevation[i];tTemp[ti]=temperature[i];tMoist[ti]=moisture[i];}

console.log('Computing rivers + lakes...');
const t0=Date.now();
const rivers=computeRivers(tw,th,tElev,tMoist,tTemp);
console.log(`Computation: ${Date.now()-t0}ms`);

let landCount=0;
for(let ti=0;ti<tw*th;ti++)if(tElev[ti]>0)landCount++;

let lakeTotal=0;
for(const li of rivers.lakeInfo)lakeTotal+=li.size;

console.log(`\nLand tiles: ${landCount}`);
console.log(`Lake count: ${rivers.lakeInfo.length}`);
console.log(`Lake tiles: ${lakeTotal} (${(lakeTotal/landCount*100).toFixed(2)}% of land)`);
console.log(`\nReal Earth: ~2.5% of land is freshwater lakes`);

console.log(`\nLargest 20 lakes:`);
const sorted=[...rivers.lakeInfo].sort((a,b)=>b.size-a.size);
for(const l of sorted.slice(0,20)){
console.log(`  #${l.id}: ${l.size} tiles (~${(l.size*21*21).toLocaleString()} km²), depth=${(l.depth*8000).toFixed(0)}m`);}
if(sorted.length>20)console.log(`  ... and ${sorted.length-20} more`);

const depths=sorted.map(l=>l.depth*8000);
console.log(`\nDepth range: ${Math.min(...depths).toFixed(0)}m - ${Math.max(...depths).toFixed(0)}m`);
console.log(`Median depth: ${depths[Math.floor(depths.length/2)]?.toFixed(0)||0}m`);

// Test different thresholds
console.log('\n── Threshold sensitivity ──');
for(const minDepth of [0.001, 0.003, 0.005, 0.008, 0.01, 0.015, 0.02]){
for(const minSize of [10, 20, 40]){
let c=0,t2=0;
for(const l of rivers.lakeInfo){if(l.depth>=minDepth&&l.size>=minSize){c++;t2+=l.size;}}
console.log(`  depth>=${(minDepth*8000).toFixed(0).padStart(4)}m, size>=${String(minSize).padStart(2)}: ${String(c).padStart(3)} lakes, ${String(t2).padStart(6)} tiles (${(t2/landCount*100).toFixed(2)}%)`);}}
