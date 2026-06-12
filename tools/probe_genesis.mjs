// Country-genesis diagnostic: run the sim and watch HOW new countries are born —
// frontier FOUNDING (a stateless settlement adopts its own id) vs SECESSION/
// conquest (an existing-country settlement flips to a different new id) — plus
// how many stateless settlements sit at each tier (are there stateless CITIES
// that fail to found, or do frontier settlements never reach city tier?).
//   node tools/probe_genesis.mjs [steps] [W] [H] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
if (process.env.TE !== undefined) T.TECH_EFFECTS = parseFloat(process.env.TE);   // TE=0 → old construction² empire reach; TE=1 → logistics-gated

const STEPS = parseInt(process.argv[2] || "12000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
const w = generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});

const prev=new Map();              // settlement id → last countryId seen
let founded=0, seceded=0, adopted=0;
function classify(){
  for(const s of world.settlements){
    if(s.mode!=="settled"){continue;}
    const cur=s.countryId, was=prev.get(s.id);
    if(was!==undefined && was!==cur){
      if(was<0 && cur===s.id) founded++;            // stateless → founded its OWN state
      else if(was<0 && cur>=0) adopted++;           // stateless → joined an existing realm
      else if(was>=0 && cur!==was) seceded++;       // flipped between realms (secession / conquest)
    }
    prev.set(s.id,cur);
  }
}
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%50===0) classify();
  if(s%3000===0){
    // snapshot: stateless settlements by tier, and current country count
    let stTotal=0, stByTier=[0,0,0,0];
    for(const x of world.settlements){ if(x.mode!=="settled")continue; if(x.countryId<0){stTotal++; stByTier[Math.min(3,x.tier|0)]++;} }
    const st=peopleSimStats(world);
    let pop=0; for(const x of world.settlements) if(x.mode==="settled") pop+=x.people;
    const pf=n=>n>=1e3?(n/1e3).toFixed(0)+"k":String(n|0);
    // empire-size distribution from the country-owner map (tiles per realm)
    const tc=new Map(); const co=world._countryOwner;
    if(co) for(let i=0;i<co.length;i++){ const c=co[i]; if(c>=0) tc.set(c,(tc.get(c)||0)+1); }
    const sizes=[...tc.values()].sort((a,b)=>b-a);
    const top3=sizes.slice(0,3).join("/");
    const meanSz=sizes.length?(sizes.reduce((a,b)=>a+b,0)/sizes.length)|0:0;
    console.log(`step ${String(s).padStart(5)}: countries ${String(st.countries).padStart(3)} top3 ${top3.padEnd(14)} mean ${String(meanSz).padStart(4)}t pop ${pf(pop)} | founded ${founded} | stateless ${stTotal}`);
  }
}
console.log(`\nTOTAL over ${STEPS} steps: FOUNDED ${founded}  SECEDED/conquered ${seceded}  (stateless→adopted ${adopted})`);
console.log(founded===0 ? "→ ZERO frontier foundings: primary state formation is effectively dead." : `→ founding:secession ratio = ${(founded/Math.max(1,seceded)).toFixed(2)}`);
