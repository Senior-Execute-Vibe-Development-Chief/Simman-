// Render terrain fertility (green) with settlements sized/coloured by tier on
// top, so you can eyeball whether CITIES land on good farmland in the locality
// model. node tools/render_locality.mjs [step] [seed] [out.png]
//   SIM_LOCALITY=1 SIM_LOCALITY_SPACING=3 node tools/render_locality.mjs ...
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.SIM_LOCALITY) T.LOCALITY_MODE = +process.env.SIM_LOCALITY;
if (process.env.SIM_LOCALITY_SPACING) T.LOCALITY_SPACING = +process.env.SIM_LOCALITY_SPACING;
if (process.env.SIM_LAND_HUNGER) T.LAND_HUNGER = +process.env.SIM_LAND_HUNGER;

const STEP=+(process.argv[2]||10000), SEED=+(process.argv[3]||8817), OUT=process.argv[4]||"/tmp/locality.png", W=480,H=240;
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}

const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H),tC=new Uint8Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);

const tw=world.tw,th=world.th,elev=world.elev,fert=world.fert,rm=world.riverMag;
const SC=3,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);
// background: water blue, land green-by-fertility, rivers cyan
for(let ti=0;ti<tw*th;ti++){const py=(ti/tw)|0,px=ti-py*tw;let col;
  if(elev[ti]<=0)col=[24,38,70];
  else{const f=Math.max(0,Math.min(1,fert[ti]));col=[ (70-f*45)|0, (70+f*120)|0, (55-f*30)|0 ];
       if(rm&&rm[ti]>=2)col=[40,90,150];}
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
// settlements: tier → size+colour (village grey, town yellow, city orange, metro red)
function disc(cx,cy,r,col){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(dx*dx+dy*dy>r*r)continue;const ox=cx+dx,oy=cy+dy;if(ox<0||oy<0||ox>=OW||oy>=OH)continue;const o=(oy*OW+ox)*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
const TC=[[150,150,150],[235,215,70],[245,140,40],[230,40,40]];
const TR=[1,2,4,6];
let n=[0,0,0,0];
for(const s of world.settlements){if(s.mode!=="settled")continue;const t=Math.min(3,s.tier|0);n[t]++;
  disc((s.pos.x*SC)|0,(s.pos.y*SC)|0,TR[t],TC[t]);}
writeFileSync(OUT,png(OW,OH,rgb));
const st=peopleSimStats(world);
console.log(`[${OUT}] LOCALITY=${T.LOCALITY_MODE} step=${STEP} setts=${st.settlements} (vil ${n[0]}, twn ${n[1]}, cty ${n[2]}, metro ${n[3]})  pop=${st.totalPeople}  — green=fertile, blue=river, dots: grey=village yellow=town orange=city red=metro`);
