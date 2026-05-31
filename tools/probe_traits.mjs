// Does temperament translate into outcomes? Bin every multi-member country
// by dominant label and report mean land / wealth / wars / conquests /
// colonies, so we can see whether warlike => more war, commercial => more
// gold, expansionist => more land actually holds in the sim.
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = +(process.env.EARTH_W || 960), H = +(process.env.EARTH_H || 480), TW = W, TH = H;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){ if(e>0.45)return 0.01; const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4); const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22)); return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3)); }
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(TW,TH,tElev,tMoist,tTemp);
w.deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});

for(let s=1;s<=STEPS;s++) stepPeopleSim(world,1);

// tiles per country
const owner=world._territoryOwner;
const tilesByCountry=new Map();
if(owner){ const byId=world._byId; for(let i=0;i<owner.length;i++){const o=owner[i];if(o<0)continue;const st=byId.get(o);if(!st)continue;tilesByCountry.set(st.countryId,(tilesByCountry.get(st.countryId)||0)+1);} }

// per-country lifetime event counts (sum over members' history)
function countEvents(c,type){ let n=0; for(const m of c.members){ if(!m.history)continue; for(const h of m.history) if(h.type===type) n++; } return n; }

const bins={}; // label -> aggregates
for(const c of world.countries.values()){
  if(c.members.length<=1) continue;
  const p=c.personality||{}; const label=p._label||"?";
  const land=tilesByCountry.get(c.id)||0;
  const wealth=c.members.reduce((s,m)=>s+(m.wealth||0),0);
  const wars=c._fronts||0;
  const conquests=countEvents(c,"conquered");      // settlements this realm's members lost+took show as conquered on the victim; proxy for war intensity in the region
  const colonies=countEvents(c,"colony-founded")+countEvents(c,"colony-launched");
  const b=bins[label]||(bins[label]={n:0,land:0,wealth:0,wars:0,conq:0,col:0,agg:0,com:0,exp:0});
  b.n++; b.land+=land; b.wealth+=wealth; b.wars+=wars; b.conq+=conquests; b.col+=colonies;
  b.agg+=p.aggression||0; b.com+=p.commerce||0; b.exp+=p.expansionism||0;
}

console.log(`\n=== outcomes by dominant temperament (seed ${SEED}, ${STEPS} steps) ===`);
console.log(`label         n   meanLand  meanWealth  activeWars/realm  colonies/realm   (mean a/c/x)`);
for(const [l,b] of Object.entries(bins).sort((a,b)=>b[1].n-a[1].n)){
  console.log(`  ${l.padEnd(12)} ${String(b.n).padStart(3)}  ${String(Math.round(b.land/b.n)).padStart(7)}  ${String(Math.round(b.wealth/b.n)).padStart(9)}  ${(b.wars/b.n).toFixed(2).padStart(10)}      ${(b.col/b.n).toFixed(2).padStart(8)}     ${(b.agg/b.n).toFixed(2)}/${(b.com/b.n).toFixed(2)}/${(b.exp/b.n).toFixed(2)}`);
}

// Also a direct continuous correlation: split high vs low on each trait.
function corr(traitKey, outcomeFn, outName){
  const rows=[];
  for(const c of world.countries.values()){ if(c.members.length<=1)continue; const p=c.personality||{}; rows.push([p[traitKey]||0, outcomeFn(c)]); }
  rows.sort((a,b)=>a[0]-b[0]); const half=Math.floor(rows.length/2);
  const lo=rows.slice(0,half), hi=rows.slice(rows.length-half);
  const mean=arr=>arr.reduce((s,r)=>s+r[1],0)/Math.max(1,arr.length);
  console.log(`  ${traitKey.padEnd(13)} low-half ${outName}=${mean(lo).toFixed(0)}   high-half ${outName}=${mean(hi).toFixed(0)}`);
}
console.log(`\n=== trait vs outcome (bottom-half vs top-half of each trait) ===`);
corr("aggression", c=>(c._fronts||0)*1000 + c.members.reduce((s,m)=>s+(m.history?m.history.filter(h=>h.type==="conquered").length:0),0), "warIdx");
corr("commerce",   c=>c.members.reduce((s,m)=>s+(m.wealth||0),0), "wealth");
corr("expansionism", c=>tilesByCountry.get(c.id)||0, "land");
