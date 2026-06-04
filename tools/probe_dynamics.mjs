// Country-dynamics trajectory probe. Logs, every INTERVAL steps: country count,
// land claimed, the top empires (tiles), how many "substantial" vs "tiny" realms
// there are, and — for countries BORN since the last checkpoint — whether they
// came from secession (a snapClaim/secede/rebel/successor history event on the
// new capital) or were FOUNDED fresh (a stateless city minting its own country,
// the suspected "parasite spawning inside an empire"). Smaller scale by default
// so the explosion→decline arc is visible in ~2-3 min for fast iteration.
//   node tools/probe_dynamics.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "16000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const TW = W, TH = H, INTERVAL = 1000;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers=computeRivers(TW,TH,tElev,tMoist,tTemp); w.rivers=rivers;
const deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers); w.deposits=deposits;
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits});

const SECEDE_TYPES = new Set(["seceded","rebellion","declared-independence","successor","joined-secession","joined-rebellion","followed-lord"]);
let prev = new Set();
console.log(`dynamics ${W}x${H} seed=${SEED}  (substantial = >${(0.01*W*H/100*100|0)||300} tiles; tiny = <120 tiles)`);
console.log("step    cnt  land%  top3 empire tiles        subst tiny  cit/ctry multi maxC  born(f/s)  died");

function tilesByCountry(){ const co=world._countryOwner, m=new Map(); if(co)for(let i=0;i<co.length;i++){const c=co[i]; if(c>=0)m.set(c,(m.get(c)||0)+1);} return m; }
function capOf(cid){ const c=world.countries&&world.countries.get(cid); return c&&c.capital; }

function report(step){
  const st = peopleSimStats(world);
  const tbc = tilesByCountry();
  const sizes = [...tbc.values()].sort((a,b)=>b-a);
  const subst = sizes.filter(s=>s>300).length, tiny = sizes.filter(s=>s<120).length;
  const cur = new Set(world.countries ? world.countries.keys() : []);
  let born=0, died=0, foundBorn=0, secedeBorn=0;
  for(const id of cur) if(!prev.has(id)){ born++;
    const cap = capOf(id);
    const recent = cap && cap.history && cap.history.some(h=>SECEDE_TYPES.has(h.type) && step-h.step < INTERVAL+200);
    if(recent) secedeBorn++; else foundBorn++;
  }
  for(const id of prev) if(!cur.has(id)) died++;
  prev = cur;
  // cities-per-country: the province-enabler — a country needs >=2 cities to have provinces
  const cityBy=new Map();
  for(const s of world.settlements){if(s.mode==="settled"&&s.countryId>=0&&(s.tier|0)>=2)cityBy.set(s.countryId,(cityBy.get(s.countryId)||0)+1);}
  let multiCity=0,totCit=0,maxCit=0;for(const v of cityBy.values()){if(v>=2)multiCity++;totCit+=v;if(v>maxCit)maxCit=v;}
  const avgCit=(totCit/Math.max(1,st.countries)).toFixed(1);
  const top3 = sizes.slice(0,3).map(s=>String(s).padStart(5)).join(" ");
  console.log(`${String(step).padStart(5)}  ${String(st.countries).padStart(4)}  ${(st.landPct*100).toFixed(0).padStart(3)}%  ${top3.padEnd(20)}  ${String(subst).padStart(4)} ${String(tiny).padStart(4)}    ${avgCit.padStart(4)} ${String(multiCity).padStart(4)} ${String(maxCit).padStart(3)}  ${String(foundBorn).padStart(3)}/${String(secedeBorn).padStart(3)}   ${String(died).padStart(4)}`);
}

for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%INTERVAL===0) report(s); }
