import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
const W=480,H=240,N=W*H;
const STEP=+(process.argv[2]||9720), SEED=+(process.argv[3]||8817);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});
const elev=world.elev,riverMag=world.riverMag,coast=world.coast,tw=world.tw,th=world.th;
function prom(tx,ty){const i=ty*tw+tx,e0=elev[i];if(e0<=0||e0>=0.6)return 0;let s=0,n=0;for(let dy=-1;dy<=1;dy++){const ny=ty+dy;if(ny<0||ny>=th)continue;for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=((tx+dx)%tw+tw)%tw;s+=elev[ny*tw+nx];n++;}}return e0-(n?s/n:e0);}
function feats(tx,ty){const i=ty*tw+tx;return{river:riverMag&&riverMag[i]>=2,coast:!!(coast&&coast[i]),hill:prom(tx,ty)>0.04};}
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);
const urban=world.settlements.filter(s=>s.mode==="settled"&&(s.tier|0)>=1);
let ur={river:0,coast:0,hill:0,any:0};
for(const s of urban){const f=feats(s.pos.x|0,s.pos.y|0);if(f.river)ur.river++;if(f.coast)ur.coast++;if(f.hill)ur.hill++;if(f.river||f.coast||f.hill)ur.any++;}
// land baseline: sample habitable tiles
let lr={river:0,coast:0,hill:0,any:0,n:0};
for(let ty=1;ty<th-1;ty+=2)for(let tx=0;tx<tw;tx+=2){const i=ty*tw+tx;if(elev[i]<=0||elev[i]>=0.6)continue;lr.n++;const f=feats(tx,ty);if(f.river)lr.river++;if(f.coast)lr.coast++;if(f.hill)lr.hill++;if(f.river||f.coast||f.hill)lr.any++;}
const pc=(a,b)=>`${(100*a/Math.max(1,b)).toFixed(0)}%`;
console.log(`step ${STEP} seed ${SEED}: ${urban.length} urban nodes (town+)`);
console.log(`  on RIVER: urban ${pc(ur.river,urban.length)} vs land ${pc(lr.river,lr.n)}`);
console.log(`  on COAST: urban ${pc(ur.coast,urban.length)} vs land ${pc(lr.coast,lr.n)}`);
console.log(`  on HILL : urban ${pc(ur.hill,urban.length)} vs land ${pc(lr.hill,lr.n)}`);
console.log(`  river|coast|hill: urban ${pc(ur.any,urban.length)} vs land ${pc(lr.any,lr.n)}`);
