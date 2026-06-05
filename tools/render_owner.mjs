// Render the RAW _countryOwner target (the cost-Voronoi partition, before the
// animated _countryClaim crawl smooths it) so we can SEE the fragmentation the
// frag-probe counts. Country colour = its id-hue (same convention as the sim).
//   node tools/render_owner.mjs [step] [seed] [W] [H]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
const STEP=+(process.argv[2]||6000), SEED=+(process.argv[3]||8817), W=+(process.argv[4]||480), H=+(process.argv[5]||240);
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
function hsl(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const hh=h/60;let r,g,b;if(hh<1)[r,g,b]=[c,x,0];else if(hh<2)[r,g,b]=[x,c,0];else if(hh<3)[r,g,b]=[0,c,x];else if(hh<4)[r,g,b]=[0,x,c];else if(hh<5)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return[(r+m)*255|0,(g+m)*255|0,(b+m)*255|0];}
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H);const tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);
const owner=world._countryOwner,tw=world.tw,th=world.th,elev=world.elev;
const SC=2,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);
const colByC=new Map();
for(let ti=0;ti<owner.length;ti++){const py=(ti/tw)|0,px=ti-py*tw;const cc=owner[ti];let col;
  if(elev[ti]<=0)col=[18,32,64];else if(cc<0)col=[150,140,120];else{col=colByC.get(cc);if(!col){col=hsl(((cc*61)%360+360)%360,0.62,0.5);colByC.set(cc,col);}}
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
const out=`/tmp/owner_${STEP}.png`;
writeFileSync(out,png(OW,OH,rgb));console.log("[png] "+out);
