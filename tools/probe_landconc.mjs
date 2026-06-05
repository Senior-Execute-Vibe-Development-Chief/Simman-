// Land-concentration diagnostic: over a run, WHERE does the map's land end up and
// HOW did it get there — conquest (armies storm) vs absorption (peaceful vacuum)
// vs frontier (claiming wilderness) — and is it a few realms swallowing the rest?
// Light debug counters in armies.js / conquest.js tag conquest vs absorb; founding
// & frontier-adoption are inferred from countryId transitions.
//   node tools/probe_landconc.mjs [steps] [W] [H] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
const w = generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
world.debug.land = { conquest:0, absorb:0, gain:new Map() };   // opt-in counters

const prev=new Map(); let found=0, adopt=0;
function classify(){ for(const s of world.settlements){ if(s.mode!=="settled")continue; const cur=s.countryId, was=prev.get(s.id);
  if(was!==undefined&&was!==cur){ if(was<0&&cur===s.id)found++; else if(was<0&&cur>=0)adopt++; } prev.set(s.id,cur); } }

function snapshot(s){
  const co=world._countryOwner; const tc=new Map();
  if(co) for(let i=0;i<co.length;i++){ const c=co[i]; if(c>=0) tc.set(c,(tc.get(c)||0)+1); }
  const sc=new Map();                                   // settlements per country
  for(const x of world.settlements){ if(x.mode==="settled"&&x.countryId>=0) sc.set(x.countryId,(sc.get(x.countryId)||0)+1); }
  const entries=[...tc.entries()].sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((a,e)=>a+e[1],0)||1;
  const share=n=>((entries.slice(0,n).reduce((a,e)=>a+e[1],0)/total)*100|0)+"%";
  const ld=world.debug.land;
  // largest realm: how big, how many settlements, tiles/settlement, and how it grew
  const [topCC,topTiles]=entries[0]||[-1,0];
  const topSetts=sc.get(topCC)||1;
  const topGain=ld.gain.get(topCC)||0;                  // settlements it took by conquest+absorb (cumulative)
  console.log(`step ${String(s).padStart(5)}: realms ${entries.length}  land top1/3/5 ${share(1)}/${share(3)}/${share(5)}  | moves: conquest ${ld.conquest} absorb ${ld.absorb} found ${found} adopt ${adopt}`);
  console.log(`            largest realm: ${topTiles}t  ${topSetts} setts  ${(topTiles/topSetts)|0} tiles/sett  took ${topGain} setts by force/absorb`);
}
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%50===0) classify(); if(s%3000===0) snapshot(s); }
console.log(`\nTOTALS: conquest ${world.debug.land.conquest}  absorb ${world.debug.land.absorb}  founded ${found}  adopted ${adopt}`);
console.log(`(conquest:absorb ratio = ${(world.debug.land.conquest/Math.max(1,world.debug.land.absorb)).toFixed(1)} — which mechanism moves the land?)`);
