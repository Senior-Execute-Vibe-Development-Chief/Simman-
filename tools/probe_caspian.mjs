// Definitive Caspian diagnosis. Flood sub-sea WATER from the map edges (no bridge). Then:
//  (1) Is the Caspian (≈50E,42N) connected to the world ocean, or a closed inland sea?
//  (2) The longest river draining INTO the Caspian basin, and how far away its source is.
//  node tools/probe_caspian.mjs [seed] [W]
import { buildWorld } from "../src/sim/pipeline.js";
const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "1920", 10), H = W >> 1;
const { w } = buildWorld({ W, H, seed: SEED });
const elev = w.elevation, { riverMag, flowDir } = w.rivers, N = W * H;
const DX = [1,1,0,-1,-1,-1,0,1], DY = [0,1,1,1,0,-1,-1,-1];
const x2 = (lon) => Math.round((lon + 180) / 360 * W), y2 = (lat) => Math.round((0.5 - lat / 180) * H);
const KM = 40075 / W;

// (a) flood sub-sea water from edges → open ocean
const ocean = new Uint8Array(N); const q = [];
for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y*W+x; if (elev[i] <= 0) { ocean[i]=1; q.push(i); } }
for (let h = 0; h < q.length; h++) { const ti=q[h], tx=ti%W, ty=(ti/W)|0; for (let d=0;d<8;d++){ const ny=ty+DY[d]; if(ny<0||ny>=H)continue; const ni=ny*W+((tx+DX[d]+W)%W); if(elev[ni]<=0&&!ocean[ni]){ocean[ni]=1;q.push(ni);} } }

// (b) the Caspian basin = sub-sea component containing (50E,42N)
const cseed = y2(42)*W + x2(50);
const basin = new Uint8Array(N);
if (elev[cseed] <= 0) { const bq=[cseed]; basin[cseed]=1; for(let h=0;h<bq.length;h++){ const ti=bq[h],tx=ti%W,ty=(ti/W)|0; for(let d=0;d<8;d++){const ny=ty+DY[d];if(ny<0||ny>=H)continue;const ni=ny*W+((tx+DX[d]+W)%W);if(elev[ni]<=0&&!basin[ni]){basin[ni]=1;bq.push(ni);}} } }
let bsize=0; for(let i=0;i<N;i++) if(basin[i]) bsize++;
console.log(`Caspian seed tile (50E,42N): elev ${elev[cseed].toFixed(3)}, ${elev[cseed]<=0?"sub-sea":"LAND(!)"}`);
console.log(`Connected to world ocean? ${ocean[cseed] ? "YES — classified OCEAN (the bug: rivers into it are exorheic)" : "NO — closed inland sea (correct)"}`);
console.log(`Caspian basin size: ${bsize} tiles (~${(bsize*KM*KM/1e3).toFixed(0)}k km²)`);

// (c) longest river draining INTO the Caspian basin, by source straight-line distance to the basin
let worst=0, info=null;
for (let ti=0; ti<N; ti++){ if(riverMag[ti]<1||elev[ti]<=0||basin[ti])continue;
  let ci=ti,s=0; while(s++<8000){const d=flowDir[ci];if(d===255)break;const cx=ci%W,cy=(ci/W)|0,ny=cy+DY[d];if(ny<0||ny>=H)break;const ni=ny*W+((cx+DX[d]+W)%W);if(elev[ni]<=0){ci=ni;break;}ci=ni;}
  if(basin[ci]){ const sx=ti%W,sy=(ti/W)|0; let dx=Math.abs(sx-(ci%W));if(dx>W/2)dx=W-dx;const dy=sy-((ci/W)|0);const dist=Math.sqrt(dx*dx+dy*dy); if(dist>worst){worst=dist;info={mag:riverMag[ti],lon:(sx/W*360-180),lat:(90-sy/H*180)};} } }
console.log(`Longest river draining INTO the Caspian: source ${(worst*KM).toFixed(0)} km away` + (info?`, mag ${info.mag}, source lon${info.lon.toFixed(0)} lat${info.lat.toFixed(0)}`:""));
console.log(`  (the Volga is ~3500km & legit; a Himalaya source (lon~90,lat~30) would be the spurious corridor)`);
