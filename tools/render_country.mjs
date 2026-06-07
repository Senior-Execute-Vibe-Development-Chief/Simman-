// Render the Country-view political map to PNG (mirrors WorldSim.jsx: bold
// distinct colours via assignCountryColors + thick borders) and report the
// neighbour-distinctness metric. node tools/render_country.mjs [step] [seed]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.SIM_CAPITAL_ANCHOR) T.CAPITAL_ANCHOR = +process.env.SIM_CAPITAL_ANCHOR;   // A/B territory compactness
if (process.env.SIM_GAP_FILL !== undefined) T.REALM_GAP_FILL = +process.env.SIM_GAP_FILL;   // A/B the no-man's-land gap fill
const STEP=+(process.argv[2]||12000), SEED=+(process.argv[3]||8817), W=+(process.argv[4]||1920),H=+(process.argv[5]||960);
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
function hsl(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const hh=h/60;let r,g,b;if(hh<1)[r,g,b]=[c,x,0];else if(hh<2)[r,g,b]=[x,c,0];else if(hh<3)[r,g,b]=[0,c,x];else if(hh<4)[r,g,b]=[0,x,c];else if(hh<5)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return[(r+m)*255|0,(g+m)*255|0,(b+m)*255|0];}
// ── replica of WorldSim.jsx assignCountryColors ──
function assignCountryColors(claimArr,tw,th,prev){const adj=new Map(),present=[],seen=new Set();const link=(a,b)=>{let s=adj.get(a);if(!s)adj.set(a,s=new Set());s.add(b);let t=adj.get(b);if(!t)adj.set(b,t=new Set());t.add(a);};for(let ti=0;ti<claimArr.length;ti++){const cc=claimArr[ti];if(cc<0)continue;if(!seen.has(cc)){seen.add(cc);present.push(cc);}const py=(ti/tw)|0,px=ti-py*tw;const ro=claimArr[py*tw+(px===tw-1?0:px+1)];if(ro>=0&&ro!==cc)link(cc,ro);if(py<th-1){const dno=claimArr[ti+tw];if(dno>=0&&dno!==cc)link(cc,dno);}}const hue=new Map();for(const c of present)hue.set(c,prev.has(c)?prev.get(c):((c*61)%360+360)%360);for(let it=0;it<60;it++){const nudge=[];for(const c of present){const ns=adj.get(c);if(!ns||ns.size===0){nudge.push(0);continue;}const hc=hue.get(c);let f=0;for(const n of ns){let d=((hc-hue.get(n)+540)%360)-180;if(d>-0.5&&d<0.5)d=d>=0?0.5:-0.5;f+=Math.sign(d)*(180-Math.abs(d))/ns.size;}nudge.push(f);}let i=0;for(const c of present)hue.set(c,((hue.get(c)+nudge[i++]*0.06)%360+360)%360);}return {hue,adj};}
// world + sim
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H);const tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);
{ const st=peopleSimStats(world); console.log(`stats: anchor=${T.CAPITAL_ANCHOR}  countries=${st.countries}  land=${(st.landPct*100).toFixed(0)}%  pop=${st.totalPeople}`); }
const claim=world._countryClaim,tw=world.tw,th=world.th,elev=world.elev;
const {hue,adj}=assignCountryColors(claim,tw,th,new Map());
// distinctness metric
let sum=0,n=0,mn=999;for(const[c,ns]of adj){for(const v of ns){let d=Math.abs(((hue.get(c)-hue.get(v)+540)%360)-180);sum+=d;n++;if(d<mn)mn=d;}}
console.log(`countries=${hue.size}  border-pairs=${n/2|0}  avg neighbour hue gap=${(sum/n).toFixed(0)}°  min=${mn.toFixed(0)}°`);
// render
const SC=2,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);
const colByC=new Map();
for(let ti=0;ti<claim.length;ti++){const py=(ti/tw)|0,px=ti-py*tw;const cc=claim[ti];let col;
  if(elev[ti]<=0)col=[18,32,64];else if(cc<0)col=[150,140,120];else{col=colByC.get(cc);if(!col){col=hsl(hue.get(cc)||0,0.6,0.5);colByC.set(cc,col);}}
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
// thick borders: darken boundary pixels (2px)
const dark=[8,8,12];
for(let ti=0;ti<claim.length;ti++){const cc=claim[ti];if(cc<0)continue;const py=(ti/tw)|0,px=ti-py*tw;
  const ro=claim[py*tw+(px===tw-1?0:px+1)];if(ro>=0&&ro!==cc){for(let dy=0;dy<SC;dy++)for(let k=-1;k<=0;k++){const ox=(px+1)*SC+k,oy=py*SC+dy;if(ox<OW&&oy<OH){const o=(oy*OW+ox)*3;rgb[o]=dark[0];rgb[o+1]=dark[1];rgb[o+2]=dark[2];}}}
  if(py<th-1){const dno=claim[ti+tw];if(dno>=0&&dno!==cc){for(let dx=0;dx<SC;dx++)for(let k=-1;k<=0;k++){const ox=px*SC+dx,oy=(py+1)*SC+k;if(ox<OW&&oy<OH){const o=(oy*OW+ox)*3;rgb[o]=dark[0];rgb[o+1]=dark[1];rgb[o+2]=dark[2];}}}}}
const OUT=process.argv[6]||"/tmp/country_view.png";writeFileSync(OUT,png(OW,OH,rgb));console.log("[png] "+OUT);
