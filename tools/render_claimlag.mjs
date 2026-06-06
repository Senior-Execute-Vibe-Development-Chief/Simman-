// Render the GROWN political map (world._countryClaim) at 480x240 with the
// settlement dots drawn ON TOP, so a settlement claimed AHEAD of the border is
// directly visible: a coloured dot sitting on grey wilderness, or on another
// country's colour. White-ringed dots = "claimed ahead" (flag != land under it).
//   node tools/render_claimlag.mjs [step] [seed] [out.png]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";

const STEP=+(process.argv[2]||8000), SEED=+(process.argv[3]||8817), OUT=process.argv[4]||"/tmp/claimlag.png", W=480,H=240;
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
function hsl(h,s,l){const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const hh=h/60;let r,g,b;if(hh<1)[r,g,b]=[c,x,0];else if(hh<2)[r,g,b]=[x,c,0];else if(hh<3)[r,g,b]=[0,c,x];else if(hh<4)[r,g,b]=[0,x,c];else if(hh<5)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return[(r+m)*255|0,(g+m)*255|0,(b+m)*255|0];}

const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H),tC=new Uint8Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);

const claim=world._countryClaim,tw=world.tw,th=world.th,elev=world.elev;
const SC=3,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);
const colByC=new Map();
const colOf=cc=>{let c=colByC.get(cc);if(!c){c=hsl(((cc*61)%360+360)%360,0.55,0.5);colByC.set(cc,c);}return c;};
// base: claim fill (grey wilderness, blue sea)
for(let ti=0;ti<claim.length;ti++){const py=(ti/tw)|0,px=ti-py*tw;const cc=claim[ti];let col;
  if(elev[ti]<=0)col=[20,34,66];else if(cc<0)col=[140,132,116];else col=colOf(cc);
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
// borders
for(let ti=0;ti<claim.length;ti++){const cc=claim[ti];if(cc<0)continue;const py=(ti/tw)|0,px=ti-py*tw;
  const ro=claim[py*tw+(px===tw-1?0:px+1)];if(ro!==cc){for(let dy=0;dy<SC;dy++){const ox=(px+1)*SC-1,oy=py*SC+dy;if(ox<OW&&oy<OH){const o=(oy*OW+ox)*3;rgb[o]=12;rgb[o+1]=12;rgb[o+2]=16;}}}
  if(py<th-1){const dno=claim[ti+tw];if(dno!==cc){for(let dx=0;dx<SC;dx++){const ox=px*SC+dx,oy=(py+1)*SC-1;if(ox<OW&&oy<OH){const o=(oy*OW+ox)*3;rgb[o]=12;rgb[o+1]=12;rgb[o+2]=16;}}}}}
// settlement dots: filled with their country colour; a WHITE ring if the flag
// disagrees with the land under it (claimed ahead of the border).
function disc(cx,cy,r,col,ring){for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(dx*dx+dy*dy>r*r)continue;const ox=cx+dx,oy=cy+dy;if(ox<0||oy<0||ox>=OW||oy>=OH)continue;const o=(oy*OW+ox)*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}
  if(ring)for(let a=0;a<360;a+=12){const ox=(cx+Math.cos(a*Math.PI/180)*(r+1))|0,oy=(cy+Math.sin(a*Math.PI/180)*(r+1))|0;if(ox<0||oy<0||ox>=OW||oy>=OH)continue;const o=(oy*OW+ox)*3;rgb[o]=255;rgb[o+1]=255;rgb[o+2]=255;}}
let flagged=0,ahead=0;
for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;flagged++;
  const ti=(s.pos.y|0)*tw+(s.pos.x|0);const under=claim[ti];const mism=under!==s.countryId;if(mism)ahead++;
  const cx=((s.pos.x*SC)|0),cy=((s.pos.y*SC)|0);const r=(s.tier|0)>=2?3:(s.tier|0)===1?2:1;
  disc(cx,cy,r,colOf(s.countryId),mism);}
writeFileSync(OUT,png(OW,OH,rgb));
console.log(`[${OUT}] step=${STEP} flagged=${flagged} claimed-ahead=${ahead} (${(ahead/Math.max(1,flagged)*100).toFixed(1)}%)  white-ringed dots = claimed ahead of the border`);
