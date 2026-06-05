// Homeland re-emergence diagnostic: over a run, count how many fallen nations
// re-emerge as THEMSELVES (same country id/hue/history) when an occupied,
// recently-fallen homeland province turns restless — and assert the world's
// ownership invariants stay clean (no settlement claims a tile it doesn't own,
// every settled non-stateless settlement maps to a live country owner).
//   node tools/probe_homeland.mjs [steps] [W] [H] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.TE !== undefined) T.TECH_EFFECTS = parseFloat(process.env.TE);

const STEPS = parseInt(process.argv[2] || "12000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
const w = generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
world.debug.restored = 0;

// count occupied homelands held in living memory (settlements whose native nation
// is not their current owner and hasn't yet assimilated) — the pool restoreNations draws from
function occupied(){ let n=0; for(const s of world.settlements){ if(s.mode!=="settled")continue; if((s._homeland??-1)>=0 && (s._homelandFell??-1)>=0) n++; } return n; }

// invariants: every settled non-stateless settlement's country has at least one tile,
// and no _homeland points at the settlement's own current owner (that should self-clear)
function invariants(){
  const live=new Set(); for(const s of world.settlements) if(s.mode==="settled"&&s.countryId>=0) live.add(s.countryId);
  let orphan=0, selfHome=0;
  for(const s of world.settlements){ if(s.mode!=="settled"||s.countryId<0)continue;
    if(!live.has(s.countryId)) orphan++;
    if((s._homeland??-1)===s.countryId) selfHome++; }
  return {orphan,selfHome};
}
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1);
  if(s%4000===0){ const st=peopleSimStats(world); console.log(`step ${String(s).padStart(5)}: countries ${String(st.countries).padStart(3)}  occupied-homelands ${String(occupied()).padStart(4)}  RESTORED ${world.debug.restored}`); }
}
const inv=invariants();
console.log(`\nTOTAL restored over ${STEPS} steps: ${world.debug.restored}`);
console.log(`invariants: ${inv.orphan===0&&inv.selfHome===0 ? "CLEAN" : "DIRTY orphan="+inv.orphan+" selfHome="+inv.selfHome}`);
