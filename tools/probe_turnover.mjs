// Minimal, FAST turnover probe: prints countries + the largest realm's identity
// over a long timeline so we can see whether empires RISE AND FALL (the largest
// realm's id changes) or persist forever (same id = immortal). No enclave
// analysis, so it runs to deep time quickly.
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "40000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.env.EARTH_W || "256", 10);
const H = parseInt(process.env.EARTH_H || "128", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W*H);
for (let i=0;i<W*H;i++){const t=w.temperature[i],m=w.moisture[i],e=w.elevation[i];tCrop[i]=e>0.45?0.01:Math.max(0.01,Math.min(1,t*1.5)*Math.exp(-((m-0.45)**2)/0.0968)*(1-Math.max(0,e-0.15)*3));}
w.rivers = computeRivers(W,H,w.elevation,w.moisture,w.temperature);
w.deposits = generateResources(W,H,w.elevation,w.temperature,w.moisture,w.coastal,w,SEED,w.rivers);
const world = initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});

function tiles(cid){ const o=world._territoryOwner; if(!o) return 0; const ids=new Set(world.countries.get(cid).members.map(m=>m.id)); let n=0; for(let i=0;i<o.length;i++) if(o[i]>=0&&ids.has(o[i]))n++; return n; }
let prevTop = null, topAge = 0;
function rep(step){
  if(!world.countries) return;
  const cs=[...world.countries.values()].filter(c=>c.members.length>0).map(c=>({c,t:tiles(c.id),m:c.members.length})).sort((a,b)=>b.t-a.t);
  const big=cs[0];
  const topId = big? big.c.id : -1;
  if (topId===prevTop) topAge += 1; else { topAge=0; prevTop=topId; }
  // size distribution
  const members = cs.map(x=>x.m);
  const big3 = cs.slice(0,3).map(x=>x.m+"m/"+x.t+"t").join(", ");
  console.log(`step ${String(step).padStart(6)} | nations=${String(world.countries.size).padStart(3)} | top3=[${big3}] | topRealmAge=${topAge} reports (${topAge>0?'SAME':'changed'})`);
}
const EVERY = parseInt(process.env.REPORT_EVERY||"3000",10);
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%EVERY===0) rep(s); }
