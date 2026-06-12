// Probe the "settlement claimed before the country grows there" pathology.
// For every settled settlement flying a flag (countryId >= 0), compare its flag
// to the GROWN political territory under its home tile (world._countryClaim — the
// border the country has actually crawled over). A settlement whose flag doesn't
// match the land it stands on was claimed AHEAD of the visible border.
//   node tools/probe_claimlag.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
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

console.log(`claim-lag ${W}x${H} seed=${SEED}`);
console.log("step   ctry land%  flagged  onLand  ahead(-1)  foreign   ahead%");

function report(step){
  const st = peopleSimStats(world);
  const claim = world._countryClaim, tw = world.tw, elev = world.elev;
  let flagged=0, onLand=0, ahead=0, foreign=0;
  for(const s of world.settlements){
    if(s.mode!=="settled" || s.countryId<0) continue;
    flagged++;
    const ti=(s.pos.y|0)*tw+(s.pos.x|0);
    const c = claim ? claim[ti] : -1;
    if(c===s.countryId) onLand++;
    else if(c<0) ahead++;        // flag flying over land the border hasn't crawled to
    else foreign++;              // flag differs from the territory it stands on
  }
  const aheadPct = flagged>0 ? ((ahead+foreign)/flagged*100) : 0;
  console.log(`${String(step).padStart(5)}  ${String(st.countries).padStart(3)} ${(st.landPct*100).toFixed(0).padStart(3)}%   ${String(flagged).padStart(5)}   ${String(onLand).padStart(5)}    ${String(ahead).padStart(5)}    ${String(foreign).padStart(5)}   ${aheadPct.toFixed(1).padStart(5)}%`);
}

for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%INTERVAL===0) report(s); }
