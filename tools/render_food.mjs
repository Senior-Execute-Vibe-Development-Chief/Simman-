// LAND food-viability overlay → PNG. PURELY the land — no settlements, no population.
// Per tile: crop output (fertility × FARM_YIELD, primitive/base tech) vs the food a
// reference farming density would need (FARMERS_PER_TILE × per-capita demand).
//   ratio = cropOutput / (FARMERS_PER_TILE × DEMAND)
//   <1 RED  = the land can't feed the people it'd take to farm it (sub-subsistence)
//    1 GREY = break-even
//   >1 GREEN= surplus (feeds more than its farmers — a true food source)
// NB: the sim itself has NO farm-labour requirement (food = fertility×yield, labour-free);
// FARMERS_PER_TILE is a chosen reference so we can ASK the question the model doesn't.
//   node tools/render_food.mjs [farmersPerTile=1] [seed]   → /tmp/land_food.png  (no sim run)
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { T } from "../src/peopleSim/tuning.js";

const FARMERS = +(process.argv[2] || 1), SEED = +(process.argv[3] || 857691);
const W = 960, H = 480, SCALE = 2, SURPLUS_REF = 5;     // ratio that saturates to full green
const DEMAND = 0.0030;                                   // per-capita food/tick (settlement.js civDemand)
const YIELD = T.FARM_YIELD_PER_FERT;                     // food per unit fertility (tuning, base tech = 1)
const THRESH = FARMERS * DEMAND;                         // food a tile must produce to feed its farmers

const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcTable[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(width,height,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const body=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(body),0);return Buffer.concat([l,body,c]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const stride=width*3+1,raw=Buffer.alloc(stride*height);for(let y=0;y<height;y++){raw[y*stride]=0;rgb.copy(raw,y*stride+1,y*width*3,(y+1)*width*3);}return Buffer.concat([sig,ch("IHDR",ihdr),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
const tileFert=(t,m,e)=>{if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));};
const lerp=(a,b,t)=>(a+(b-a)*t)|0;
function via(ratio){
  if(ratio<1){const t=Math.max(0,ratio);return[lerp(190,150,t),lerp(24,150,t),lerp(24,150,t)];}   // red → grey
  const t=Math.min(1,(ratio-1)/(SURPLUS_REF-1));return[lerp(150,28,t),lerp(150,185,t),lerp(150,44,t)]; // grey → green
}

const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const ow=W*SCALE, oh=H*SCALE, px=Buffer.alloc(ow*oh*3);
const set=(x,y,r,g,b)=>{const o=(y*ow+x)*3;px[o]=r;px[o+1]=g;px[o+2]=b;};
let land=0,def=0,be=0,sur=0;
for(let ty=0;ty<H;ty++)for(let tx=0;tx<W;tx++){
  const i=ty*W+tx; let r,g,b;
  if(w.elevation[i]<=0){r=16;g=28;b=48;}                                  // sea
  else{const fert=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);
    const ratio=(fert*YIELD)/THRESH; [r,g,b]=via(ratio);
    land++; if(ratio<0.9)def++; else if(ratio>1.5)sur++; else be++;}
  for(let yy=0;yy<SCALE;yy++)for(let xx=0;xx<SCALE;xx++)set(tx*SCALE+xx,ty*SCALE+yy,r,g,b);
}
writeFileSync("/tmp/land_food.png",png(ow,oh,px));
console.log(`[png] /tmp/land_food.png  (${ow}x${oh})  farmers/tile=${FARMERS}  break-even fert=${(THRESH/YIELD).toFixed(3)}`);
console.log(`land tiles ${land}: DEFICIT(<0.9) ${(100*def/land).toFixed(0)}%  break-even ${(100*be/land).toFixed(0)}%  SURPLUS(>1.5) ${(100*sur/land).toFixed(0)}%`);
