// Drive a synthetic conquest front to SEE how relaxClaim advances: seed a country
// on the west edge of a big target band and crawl east. A flat vertical edge = the
// old "straight moving wall"; a ragged, terrain-following edge = the organic fix.
//   node tools/render_front.mjs [warmupSteps] [relaxCalls] [seed]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { relaxClaim } from "../src/peopleSim/countryClaim.js";
const WARM=+(process.argv[2]||6000), K=+(process.argv[3]||12), SEED=+(process.argv[4]||8817), W=480,H=240;
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=WARM;s++)stepPeopleSim(world,1);
const tw=world.tw,th=world.th,N=world.N,elev=world.elev;
// pick a country id present, build a big target band [x0,x1) all assigned to it
const co=world._countryOwner; const tc=new Map(); for(let i=0;i<N;i++)if(co[i]>=0)tc.set(co[i],(tc.get(co[i])||0)+1);
const C=[...tc.entries()].sort((a,b)=>b[1]-a[1])[0][0];
const x0=120,x1=300;   // a wide land band across Afro-Eurasia
const target=world._countryOwner; const claim=world._countryClaim;
world._claimPress=new Float32Array(N);
for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const ti=y*tw+x; if(x>=x0&&x<x1&&elev[ti]>0){target[ti]=C; claim[ti]=-1;}}
// seed: westmost land column of the band per row
for(let y=0;y<th;y++)for(let x=x0;x<x1;x++){const ti=y*tw+x; if(elev[ti]>0){claim[ti]=C; break;}}
for(let i=0;i<K;i++) relaxClaim(world);
// render the band
const SC=2,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);
for(let ti=0;ti<N;ti++){const py=(ti/tw)|0,px=ti-py*tw;let col;
  if(elev[ti]<=0)col=[18,32,64]; else if(claim[ti]===C)col=[210,90,70]; else if(px>=x0&&px<x1)col=[60,70,55]; else col=[120,115,100];
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
writeFileSync(`/tmp/front_k${K}.png`,png(OW,OH,rgb));console.log(`[png] /tmp/front_k${K}.png  (C=${C})`);
