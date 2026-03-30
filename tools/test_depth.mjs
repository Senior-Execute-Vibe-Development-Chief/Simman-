// ── Depth Map Comparison: Earth vs Tectonic ──
// Compares elevation distribution, depression stats, terrain roughness
// Usage: node tools/test_depth.mjs

import { readFileSync } from 'fs';

const PERM=new Uint8Array(512);const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
function initNoise(s){const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;for(let i=255;i>0;i--){s=(s*16807)%2147483647;const j=s%(i+1);[p[i],p[j]]=[p[j],p[i]];}for(let i=0;i<512;i++)PERM[i]=p[i&255];}
function noise2D(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));return l1+v*(l2-l1);}
function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}
function ridged(x,y,oct,lac,gain,off){let v=0,a=1,f=1,w=1,m=0;for(let i=0;i<oct;i++){let s=off-Math.abs(noise2D(x*f,y*f));s*=s;s*=w;w=Math.min(1,Math.max(0,s*gain));v+=s*a;m+=a;a*=.5;f*=lac;}return v/m;}
function worley(x,y){const ix=Math.floor(x),iy=Math.floor(y);let d1=9,d2=9;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const cx=ix+dx,cy=iy+dy;const h1=PERM[(PERM[(cx&255)]+((cy&255)))&511],h2=PERM[(h1+73)&511];const px=cx+(h1/255),py=cy+(h2/255);const dd=(x-px)*(x-px)+(y-py)*(y-py);if(dd<d1){d2=d1;d1=dd;}else if(dd<d2)d2=dd;}return[Math.sqrt(d1),Math.sqrt(d2)];}

const earthSrc=readFileSync('src/earthData.js','utf8');
const b64Match=earthSrc.match(/export const EARTH_ELEV="([^"]+)"/);
const earthData=Buffer.from(b64Match[1],'base64');
const EARTH_W=720,EARTH_H=360;
function sampleEarth(data,sw,sh,x,y,tw,th){const fx=(x/tw)*sw,fy=(y/th)*sh;const x0=Math.floor(fx),y0=Math.floor(fy);const x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);const dx=fx-x0,dy=fy-y0;return data[y0*sw+(x0%sw)]*(1-dx)*(1-dy)+data[y0*sw+(x1%sw)]*dx*(1-dy)+data[y1*sw+(x0%sw)]*(1-dx)*dy+data[y1*sw+(x1%sw)]*dx*dy;}

const{generateTectonicWorld}=await import('../src/tectonicGen.js');
const{computeRivers}=await import('../src/riverGen.js');

const W=1920,H=960;

// ── Build Earth elevation ──
console.log('Building Earth...');
initNoise(42);
const earthElev=new Float32Array(W*H);
const earthTemp=new Float32Array(W*H);
const earthMoist=new Float32Array(W*H);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,nx=x/W,ny=y/H,lat=Math.abs(ny-.5)*2;
const he=sampleEarth(earthData,EARTH_W,EARTH_H,x,y,W,H);
const noise=fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
if(he<3){earthElev[i]=-0.03-Math.max(0,(1-he/3))*0.12;}
else{earthElev[i]=Math.max(0.001,(he-3)/252*0.55+0.005+noise);}
earthTemp[i]=Math.max(0,Math.min(1,1-lat*1.05-Math.max(0,earthElev[i])*.4+fbm(nx*3+80,ny*3+80,3,2,.5)*.08));
earthMoist[i]=0.3;}

// ── Build Tectonic elevation ──
console.log('Building Tectonic (seed 42)...');
initNoise(42);
const nf={initNoise,fbm,ridged,noise2D,worley};
const tec=generateTectonicWorld(W,H,42,nf,{});
const tecElev=tec.elevation;
const tecTemp=tec.temperature;
const tecMoist=new Float32Array(W*H);for(let i=0;i<W*H;i++)tecMoist[i]=tec.moisture[i];

// ── Analysis function ──
function analyze(name, elev, temp, moist) {
  const N=W*H;
  let landCount=0, oceanCount=0;
  const landElevs=[];

  for(let i=0;i<N;i++){
    if(elev[i]>0){landCount++;landElevs.push(elev[i]);}
    else oceanCount++;
  }
  landElevs.sort((a,b)=>a-b);
  const pct=(arr,p)=>arr[Math.min(arr.length-1,Math.floor(arr.length*p/100))];

  console.log(`\n══ ${name} ══`);
  console.log(`  Land: ${landCount} (${(landCount/N*100).toFixed(1)}%)  Ocean: ${oceanCount}`);

  // Elevation distribution
  console.log(`  Elevation percentiles (land only, meters):`);
  for(const p of[5,10,25,50,75,90,95,99]){
    console.log(`    ${String(p).padStart(2)}%: ${(pct(landElevs,p)*8000).toFixed(0)}m`);}
  console.log(`    Max: ${(landElevs[landElevs.length-1]*8000).toFixed(0)}m`);

  // Terrain roughness: average absolute elevation difference between neighbors
  let roughSum=0, roughCount=0;
  for(let y=1;y<H-1;y++)for(let x=0;x<W;x++){
    const i=y*W+x;if(elev[i]<=0)continue;
    const r=x<W-1?x+1:0;const ni=y*W+r;
    const di=i+W; // south
    if(elev[ni]>0){roughSum+=Math.abs(elev[i]-elev[ni]);roughCount++;}
    if(elev[di]>0){roughSum+=Math.abs(elev[i]-elev[di]);roughCount++;}
  }
  const avgRough=roughCount>0?roughSum/roughCount:0;
  console.log(`  Avg roughness: ${(avgRough*8000).toFixed(1)}m per pixel`);

  // Depression analysis: how many land tiles are local minima?
  let localMins=0;
  for(let y=1;y<H-1;y++)for(let x=0;x<W;x++){
    const i=y*W+x;if(elev[i]<=0)continue;
    let isMin=true;
    for(let dy=-1;dy<=1&&isMin;dy++)for(let dx=-1;dx<=1&&isMin;dx++){
      if(!dx&&!dy)continue;
      const nx=(x+dx+W)%W,ny=y+dy;if(ny<0||ny>=H)continue;
      const ni=ny*W+nx;
      if(elev[ni]>0&&elev[ni]<elev[i])isMin=false;}
    if(isMin)localMins++;
  }
  console.log(`  Local minima: ${localMins} (${(localMins/landCount*100).toFixed(2)}% of land)`);

  // River + lake analysis
  console.log('  Computing rivers/lakes...');
  const tw=W,th=H;
  const tElev=new Float32Array(tw*th);
  const tTemp=new Float32Array(tw*th);
  const tMoist2=new Float32Array(tw*th);
  for(let i=0;i<N;i++){tElev[i]=elev[i];tTemp[i]=temp[i];tMoist2[i]=moist[i];}
  const rivers=computeRivers(tw,th,tElev,tMoist2,tTemp);

  const rivCounts=[0,0,0,0,0];
  for(let i=0;i<N;i++)rivCounts[rivers.riverMag[i]]++;
  console.log(`  Rivers: ${rivCounts[1]} stream, ${rivCounts[2]} trib, ${rivCounts[3]} major, ${rivCounts[4]} great`);

  let lakeTiles=0;
  for(const l of rivers.lakeInfo)lakeTiles+=l.size;
  console.log(`  Lakes: ${rivers.lakeInfo.length} lakes, ${lakeTiles} tiles (${(lakeTiles/landCount*100).toFixed(2)}% of land)`);

  if(rivers.lakeInfo.length>0){
    const sorted=[...rivers.lakeInfo].sort((a,b)=>b.size-a.size);
    console.log(`  Largest: ${sorted[0].size} tiles (~${(sorted[0].size*21*21).toLocaleString()} km²)`);
    if(sorted.length>1)console.log(`  2nd: ${sorted[1].size} tiles`);
    if(sorted.length>2)console.log(`  3rd: ${sorted[2].size} tiles`);
  }

  // Elevation histogram (8 bins)
  const bins=[0,0.01,0.02,0.05,0.10,0.20,0.35,0.50,1.0];
  const hist=new Array(bins.length-1).fill(0);
  for(const e of landElevs){
    for(let b=0;b<bins.length-1;b++){
      if(e>=bins[b]&&e<bins[b+1]){hist[b]++;break;}}}
  console.log(`  Elevation histogram:`);
  for(let b=0;b<hist.length;b++){
    const lo=(bins[b]*8000).toFixed(0),hi=(bins[b+1]*8000).toFixed(0);
    const bar='█'.repeat(Math.round(hist[b]/landCount*80));
    console.log(`    ${lo.padStart(5)}-${hi.padStart(5)}m: ${(hist[b]/landCount*100).toFixed(1).padStart(5)}% ${bar}`);}
}

analyze('EARTH', earthElev, earthTemp, earthMoist);
analyze('TECTONIC', tecElev, tecTemp, tecMoist);

console.log('\n\n══ KEY COMPARISONS ══');
console.log('Real Earth freshwater lakes: ~2.5% of land area');
console.log('Real Earth elevation: median ~340m, 50% below 400m');
console.log('Done.');
