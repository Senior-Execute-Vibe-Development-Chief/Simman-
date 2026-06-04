// Render earth_sim CROP suitability (climate core: tCrop temp×moisture bell from
// WorldSim.jsx, kept in sync) to PNG. tan=poor, green=prime farmland.
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
const SEED=+(process.argv[2]||"8817"), W=+(process.argv[3]||"960"), H=+(process.argv[4]||"480"), OUT=process.argv[5]||"/tmp/crop.png";
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=crcT[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
function png(w,h,rgb){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(b),0);return Buffer.concat([l,b,c]);};const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const st=w*3+1,raw=Buffer.alloc(st*h);for(let y=0;y<h;y++){raw[y*st]=0;rgb.copy(raw,y*st+1,y*w*3,(y+1)*w*3);}return Buffer.concat([sig,ch("IHDR",ih),ch("IDAT",zlib.deflateSync(raw,{level:6})),ch("IEND",Buffer.alloc(0))]);}
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
function crop(t,m,e){if(e<=0)return-1;if(e>0.45)return 0.02;const tB=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const mB=Math.exp(-((m-0.45)*(m-0.45))/(2*0.28*0.28));let c=tB*mB;if(e>0.30)c*=Math.max(0,1-(e-0.30)*2);return Math.max(0,Math.min(1,c));}
const rgb=Buffer.alloc(W*H*3);
for(let i=0;i<W*H;i++){const c=crop(w.temperature[i],w.moisture[i],w.elevation[i]);let r,g,b;if(c<0){r=18;g=32;b=64;}else{// tan(0)->yellow(.5)->green(1)
 const s=Math.max(0,Math.min(1,c));r=(200-s*150)|0;g=(170+s*30)|0;b=(110-s*80)|0;}rgb[i*3]=r;rgb[i*3+1]=g;rgb[i*3+2]=b;}
writeFileSync(OUT,png(W,H,rgb));console.log("[png]",OUT);
