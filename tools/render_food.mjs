// Food-VIABILITY overlay → PNG. Colours each settlement's territory by whether its LOCAL
// farm output can feed its own population: ratio = _landFood / _civFoodDemand.
//   <1 = DEFICIT (red): the land can't feed the people on it — they live on imported grain.
//    1 = break-even (yellow).   >1 = SURPLUS (green): a food exporter.
// Purpose: debug how nations survive on marginal land (e.g. Siberia) — red land under a
// thriving settlement = it's propped up by the food hierarchy, not self-sufficient.
//   node tools/render_food.mjs [step] [seed]   → /tmp/food_<step>.png
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";

const STEP = +(process.argv[2] || 9000), SEED = +(process.argv[3] || 857691);
const W = 960, H = 480, SCALE = 2, SURPLUS_REF = 3;   // ratio that saturates to full green

const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcTable[(c^b[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(width,height,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const body=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(body),0);return Buffer.concat([l,body,c]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const stride=width*3+1,raw=Buffer.alloc(stride*height);for(let y=0;y<height;y++){raw[y*stride]=0;rgb.copy(raw,y*stride+1,y*width*3,(y+1)*width*3);}return Buffer.concat([sig,ch("IHDR",ihdr),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}

const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tElev=new Float32Array(W*H),tTemp=new Float32Array(W*H),tMoist=new Float32Array(W*H),tCoast=new Uint8Array(W*H),tCrop=new Float32Array(W*H);
const tileFert=(t,m,e)=>{if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));};
for(let i=0;i<W*H;i++){tElev[i]=w.elevation[i];tTemp[i]=w.temperature[i];tMoist[i]=w.moisture[i];tCoast[i]=w.coastal[i]||0;tCrop[i]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tElev,tMoist,tTemp); w.deposits=generateResources(W,H,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);

// ratio → colour: red (deficit) → yellow (break-even, 1) → green (surplus)
function via(ratio){
  if(ratio<=0.02)return[120,8,8];                              // ~no local production (cities; barren land) → deep red
  if(ratio<1){const t=ratio;return[225,(40+t*180)|0,20];}      // deficit: red → yellow
  const t=Math.min(1,(ratio-1)/(SURPLUS_REF-1));return[((1-t)*225)|0,200,(20+t*40)|0]; // surplus: yellow → green
}

const {tw,th,elev}=world, owner=world._territoryOwner, byId=world._byId;
const ow=tw*SCALE, oh=th*SCALE, px=Buffer.alloc(ow*oh*3);
const set=(x,y,r,g,b)=>{const o=(y*ow+x)*3;px[o]=r;px[o+1]=g;px[o+2]=b;};
let nDef=0,nSur=0,nTot=0;
for(let ty=0;ty<th;ty++)for(let tx=0;tx<tw;tx++){
  const ti=ty*tw+tx; let r,g,b;
  if(elev[ti]<=0){r=16;g=28;b=48;}                             // sea
  else{const o=owner?owner[ti]:-1; const s=o>=0&&byId?byId.get(o):null;
    if(!s||s.mode!=="settled"){r=46;g=50;b=46;}                // unclaimed land
    else{const lf=s._landFood||0, cd=s._civFoodDemand||0; const ratio=cd>1e-9?lf/cd:(lf>0?SURPLUS_REF:0);
      [r,g,b]=via(ratio); nTot++; if(ratio<0.95)nDef++; else if(ratio>1.5)nSur++;}}
  for(let yy=0;yy<SCALE;yy++)for(let xx=0;xx<SCALE;xx++)set(tx*SCALE+xx,ty*SCALE+yy,r,g,b);
}
// settlements: cities white, towns light, farming regions faint dot — to see WHO sits on red land
for(const s of world.settlements){ if(s.mode!=="settled")continue; const t=s.tier|0;
  const cx=(s.pos.x|0)*SCALE,cy=(s.pos.y|0)*SCALE; const col=t>=2?[255,255,255]:t>=1?[235,235,235]:[180,180,180]; const rad=t>=2?2:t>=1?1:0;
  for(let dy=-rad;dy<=rad;dy++)for(let dx=-rad;dx<=rad;dx++){const x=cx+dx,y=cy+dy;if(x>=0&&x<ow&&y>=0&&y<oh)set(x,y,...col);}}
const file=`/tmp/food_${STEP}.png`; writeFileSync(file,png(ow,oh,px));
console.log(`[png] ${file}  (${ow}x${oh})  territory tiles: ${nTot}, deficit(<0.95) ${(100*nDef/Math.max(1,nTot)).toFixed(0)}%, surplus(>1.5) ${(100*nSur/Math.max(1,nTot)).toFixed(0)}%`);
