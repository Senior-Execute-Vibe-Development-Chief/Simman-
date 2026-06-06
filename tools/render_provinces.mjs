// Render the PROVINCES overlay exactly as WorldSim.jsx draws it: fill by country,
// solid national borders, and DOTTED province sub-borders = a nearest-CITY Voronoi
// (tier>=2 seats) inside each country's CLAIMED tiles. Because the overlay rides
// on the country claim, solidifying the territory (REALM_GAP_FILL) solidifies the
// province cells too. Pass the gap value to compare OFF vs ON.
//   node tools/render_provinces.mjs [step] [seed] [gap] [W] [H]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { T } from "/home/user/Simman-/src/peopleSim/tuning.js";
import { generateWorld } from "/home/user/Simman-/src/worldgen.js";
import { computeRivers } from "/home/user/Simman-/src/riverGen.js";
import { generateResources } from "/home/user/Simman-/src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "/home/user/Simman-/src/peopleSim/index.js";
const STEP=+(process.argv[2]||12000), SEED=+(process.argv[3]||8817), GAP=+(process.argv[4]??12), W=+(process.argv[5]||480), H=+(process.argv[6]||240);
T.REALM_GAP_FILL = GAP;
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
const claim=world._countryClaim,tw=world.tw,th=world.th,elev=world.elev,halfTw=tw/2;
// province id per tile = nearest CITY (tier>=2) of the tile's country (WorldSim.jsx)
// province key per settlement (mirrors WorldSim.jsx): captured town → -(homeland+2)
// (the nation it was conquered from), native town → its _provinceCity seat.
const owner=world._territoryOwner;
const provById=new Map(); const cityList=new Map();
for(const s of world.settlements){if(!(s&&s.mode==="settled"&&s.countryId>=0))continue;
  const hl=s._homeland??-1; const captured=hl>=0&&hl!==s.countryId;
  provById.set(s.id, captured ? -(hl+2) : ((s._provinceCity??-1)>=0 ? s._provinceCity : s.countryId));
  if((s.tier|0)>=2){let a=cityList.get(s.countryId);if(!a)cityList.set(s.countryId,a=[]);a.push(s);}}
function nearestCity(ti,cc){const arr=cityList.get(cc);if(!arr)return cc;if(arr.length===1)return arr[0].id;
  const py=((ti/tw)|0)+0.5,px=(ti-((ti/tw)|0)*tw)+0.5;let best=cc,bd=Infinity;
  for(const c of arr){let dx=Math.abs(c.pos.x-px);if(dx>halfTw)dx=tw-dx;const dy=c.pos.y-py;const d=dx*dx+dy*dy;if(d<bd){bd=d;best=c.id;}}return best;}
const prov=new Int32Array(claim.length).fill(-2147483648);
let captured=0;
for(let ti=0;ti<claim.length;ti++){const cc=claim[ti];if(cc<0)continue;const sid=owner?owner[ti]:-1;
  let pv=sid>=0?provById.get(sid):undefined; if(pv===undefined)pv=nearestCity(ti,cc);
  prov[ti]=pv; if(pv<0)captured++;}
console.log(`captured-province tiles: ${captured}`);
// raster: country hue, with each province a distinct lightness; captured-nation
// provinces (neg key) skew toward a colder shade so old borders stand out.
const SC=2,OW=tw*SC,OH=th*SC,rgb=Buffer.alloc(OW*OH*3);const colByC=new Map();
function shade(cc,pv){let base=colByC.get(cc);if(!base){base=hsl(((cc*61)%360+360)%360,0.55,0.5);colByC.set(cc,base);}
  // jitter lightness deterministically by province key so cells are visible
  let k=(pv*2654435761)>>>0;const j=((k%1000)/1000-0.5)*0.26;const cap=pv<0?-0.10:0;const f=1+j+cap;
  return [Math.max(0,Math.min(255,base[0]*f))|0,Math.max(0,Math.min(255,base[1]*f))|0,Math.max(0,Math.min(255,base[2]*f))|0];}
for(let ti=0;ti<claim.length;ti++){const py=(ti/tw)|0,px=ti-py*tw;const cc=claim[ti];let col;
  if(elev[ti]<=0)col=[18,32,64];else if(cc<0)col=[150,140,120];else col=shade(cc,prov[ti]);
  for(let dy=0;dy<SC;dy++)for(let dx=0;dx<SC;dx++){const o=((py*SC+dy)*OW+(px*SC+dx))*3;rgb[o]=col[0];rgb[o+1]=col[1];rgb[o+2]=col[2];}}
// province sub-borders (light dotted) then national borders (solid dark)
function setpx(ox,oy,c){if(ox<0||oy<0||ox>=OW||oy>=OH)return;const o=(oy*OW+ox)*3;rgb[o]=c[0];rgb[o+1]=c[1];rgb[o+2]=c[2];}
const pcol=[60,60,60],ncol=[8,8,12];
for(let ti=0;ti<claim.length;ti++){const cc=claim[ti];if(cc<0)continue;const py=(ti/tw)|0,px=ti-py*tw;const pv=prov[ti];
  const rti=py*tw+(px===tw-1?0:px+1),rcc=claim[rti];
  if(rcc>=0&&rcc!==cc){for(let dy=0;dy<SC;dy++){setpx((px+1)*SC-1,py*SC+dy,ncol);setpx((px+1)*SC,py*SC+dy,ncol);}}
  else if(rcc===cc&&prov[rti]!==pv){if(((py)&1)===0)setpx((px+1)*SC-1,py*SC,pcol);}
  if(py<th-1){const dti=ti+tw,dcc=claim[dti];
    if(dcc>=0&&dcc!==cc){for(let dx=0;dx<SC;dx++){setpx(px*SC+dx,(py+1)*SC-1,ncol);setpx(px*SC+dx,(py+1)*SC,ncol);}}
    else if(dcc===cc&&prov[dti]!==pv){if(((px)&1)===0)setpx(px*SC,(py+1)*SC-1,pcol);}}}
let outRgb=rgb,outW=OW,outH=OH,suffix="";
if(process.env.AUTOCROP){ // crop to the bbox of the realm holding the most captured (conquered-nation) tiles
  const capByC=new Map(),bb=new Map();
  for(let ti=0;ti<claim.length;ti++){const cc=claim[ti];if(cc<0||prov[ti]>=0)continue;const ty=(ti/tw)|0,tx=ti-ty*tw;
    capByC.set(cc,(capByC.get(cc)||0)+1);let b=bb.get(cc);if(!b)bb.set(cc,b=[tx,ty,tx,ty]);b[0]=Math.min(b[0],tx);b[1]=Math.min(b[1],ty);b[2]=Math.max(b[2],tx);b[3]=Math.max(b[3],ty);}
  let bestC=-1,bestN=0;for(const [c,n] of capByC)if(n>bestN){bestN=n;bestC=c;}
  if(bestC>=0){const b=bb.get(bestC);const pad=10;process.env.CROP=`${Math.max(0,b[0]-pad)},${Math.max(0,b[1]-pad)},${Math.min(tw,b[2]-b[0]+2*pad)},${Math.min(th,b[3]-b[1]+2*pad)}`;
    console.log(`autocrop → realm ${bestC} with ${bestN} captured tiles, bbox ${process.env.CROP}`);}}
if(process.env.CROP){const [cx,cy,cw,ch]=process.env.CROP.split(",").map(Number);const Z=+(process.env.ZOOM||6);
  outW=cw*Z;outH=ch*Z;outRgb=Buffer.alloc(outW*outH*3);
  for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){const sxp=(cx+x/Z)*SC|0,syp=(cy+y/Z)*SC|0;const si=(Math.min(OH-1,syp)*OW+Math.min(OW-1,sxp))*3,o=(y*outW+x)*3;outRgb[o]=rgb[si];outRgb[o+1]=rgb[si+1];outRgb[o+2]=rgb[si+2];}
  suffix=`_crop`;}
const out=`/tmp/prov_${GAP>0?"on":"off"}_${STEP}${suffix}.png`;
writeFileSync(out,png(outW,outH,outRgb));console.log("[png] "+out);
