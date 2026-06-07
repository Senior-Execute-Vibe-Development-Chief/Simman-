// Where does each TIER get its coin? Aggregates the per-settlement smoothed income
// rate (_mInRate, money.js) by tier × category, so we can see whether Farming Regions
// live off food, towns off the grain margin/trade, cities off luxury/industry, etc.
//   node tools/probe_wealth.mjs [step] [seed] [W] [H]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { IN_LABELS, OUT_LABELS } from "../src/peopleSim/money.js";
const STEP=+(process.argv[2]||10000), SEED=+(process.argv[3]||857691), W=+(process.argv[4]||1920), H=+(process.argv[5]||960);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
stepPeopleSim(world, STEP);

const TIERS=["Farming Region","Town","City","Metropolis"];
const NIN=IN_LABELS.length, NOUT=OUT_LABELS.length;
const inByTier=[0,1,2,3].map(()=>new Float64Array(NIN));
const outByTier=[0,1,2,3].map(()=>new Float64Array(NOUT));
const cnt=[0,0,0,0], pop=[0,0,0,0], wealth=[0,0,0,0];
for(const s of world.settlements){ if(s.mode!=="settled")continue; const t=Math.min(3,Math.max(0,s.tier|0));
  cnt[t]++; pop[t]+=s.people||0; wealth[t]+=s.wealth||0;
  const ri=s._mInRate; if(ri)for(let i=0;i<NIN;i++)inByTier[t][i]+=ri[i];
  const ro=s._mOutRate; if(ro)for(let i=0;i<NOUT;i++)outByTier[t][i]+=ro[i];
}
console.log(`\n=== income by tier @ step ${STEP} (sim ${world.tw}x${world.th}) ===`);
for(let t=0;t<4;t++){
  if(!cnt[t])continue;
  const tot=inByTier[t].reduce((a,b)=>a+b,0);
  const outTot=outByTier[t].reduce((a,b)=>a+b,0);
  console.log(`\n${TIERS[t]}  (n=${cnt[t]}, pop=${Math.round(pop[t])}, gold=${Math.round(wealth[t])})`);
  console.log(`  income ${tot.toFixed(1)}/tick  | spend ${outTot.toFixed(1)}/tick  | net ${(tot-outTot).toFixed(1)}/tick`);
  const inRank=IN_LABELS.map((l,i)=>[l,inByTier[t][i]]).filter(x=>x[1]>0.01).sort((a,b)=>b[1]-a[1]);
  console.log(`  IN : ${inRank.map(([l,v])=>`${l} ${(100*v/(tot||1)).toFixed(0)}%`).join("  ")}`);
  const outRank=OUT_LABELS.map((l,i)=>[l,outByTier[t][i]]).filter(x=>x[1]>0.01).sort((a,b)=>b[1]-a[1]);
  console.log(`  OUT: ${outRank.map(([l,v])=>`${l} ${(100*v/(outTot||1)).toFixed(0)}%`).join("  ")}`);
}
