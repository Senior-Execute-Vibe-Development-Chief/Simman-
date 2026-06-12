// Diagnostic: how big do empires get, and at WHAT tech era?
// Reuses the earthRun pipeline but focuses on era-vs-size of top countries.
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.env.EARTH_W || "960", 10);
const H = parseInt(process.env.EARTH_H || "480", 10);
const TW = W, TH = H;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev = new Float32Array(TW*TH), tTemp = new Float32Array(TW*TH);
const tMoist = new Float32Array(TW*TH), tCoast = new Uint8Array(TW*TH);
const tCrop = new Float32Array(TW*TH);
function tileFert(t,m,e){ if(e>0.45)return 0.01; const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4); const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22)); return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3)); }
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx; tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers = computeRivers(TW,TH,tElev,tMoist,tTemp); w.rivers = rivers;
const deposits = generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers); w.deposits = deposits;
const world = initPeopleSim(w, { seed: w._seed||SEED, tCrop, tileRes: 1, deposits });

function eraOf(k){ const s=(k.metallurgy||0)+(k.organization||0)+(k.agriculture||0);
  return s<0.3?"paleo":s<0.8?"neolithic":s<1.5?"CHALCOLITHIC":s<2.2?"bronze":s<3.0?"iron":"classical"; }

function tileCount(world, cid){ const o=world._territoryOwner; if(!o)return 0; const ids=new Set(); for(const m of world.countries.get(cid).members) ids.add(m.id); let n=0; for(let i=0;i<o.length;i++) if(o[i]>=0&&ids.has(o[i]))n++; return n; }

function report(label){
  if(!world.countries)return;
  const cs=[...world.countries.values()].filter(c=>c.members.length>1).sort((a,b)=>b.members.length-a.members.length).slice(0,8);
  console.log(`\n=== ${label} ===`);
  for(const c of cs){
    const k=c.capital.knowledge||{};
    const tiles=tileCount(world,c.id);
    console.log(`  ${(c.capital.name||"?").padEnd(16)} members=${String(c.members.length).padStart(3)} tiles=${String(tiles).padStart(4)} era=${eraOf(k).padEnd(12)} org=${(k.organization||0).toFixed(2)} met=${(k.metallurgy||0).toFixed(2)} agr=${(k.agriculture||0).toFixed(2)} cap=${(c._capacity??0).toFixed(1)} load=${(c._loadTotal??0).toFixed(1)} solv=${(c._solvency??1).toFixed(2)}`);
  }
}

for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%5000===0) report(`step ${s}`); }
