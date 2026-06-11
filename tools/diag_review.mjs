// Full-scale emergent-behaviour review. Steps the sim, SAMPLES country existence
// every SAMPLE ticks to track empire birth/death/peak (longevity), and prints a
// full report at each checkpoint: multitude, size, ocean-spanning shape, economy,
// personalities, longevity — plus a closing Hall of Fame ranked by a "Rome score".
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { techState, ERAS } from "../src/peopleSim/tech.js";

const W=+(process.argv[4]||768),H=W>>1,N=W*H;
const SEED=+(process.argv[2]||8817);
const CKPTS=(process.argv[3]||"15000,30000,45000").split(",").map(Number);
const SAMPLE=1500;
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});

const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:0;
const med=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
function gini(a){if(a.length<2)return 0;const s=[...a].sort((x,y)=>x-y);let c=0;for(let i=0;i<s.length;i++)c+=(2*(i+1)-s.length-1)*s[i];return c/(s.length*sum(s)||1);}
const land=ti=>world.elev[ti]>0;

let COMP=null;
function comps(){
  if(COMP)return COMP;
  const c=new Int32Array(N).fill(-1),st=[];
  for(let i=0;i<N;i++){if(c[i]>=0||!land(i))continue;st.length=0;st.push(i);c[i]=i;
    while(st.length){const ti=st.pop();const y=(ti/W)|0,x=ti-y*W;
      const ns=[y*W+((x+1)%W),y*W+((x-1+W)%W),y>0?ti-W:-1,y<H-1?ti+W:-1];
      for(const ni of ns){if(ni<0||c[ni]>=0||!land(ni))continue;c[ni]=i;st.push(ni);}}}
  return COMP=c;
}

// id -> {first,last,maxMembers,maxSize,peakPop,label,alive}
const track=new Map();
let prevIds=new Set(), bornTotal=0, diedTotal=0;

function scan(){                                     // size + fertility-sum per country (political claim)
  const co=world._countryOwner; const size=new Map(),fsum=new Map();
  if(!co)return{size,fsum};
  for(let ti=0;ti<N;ti++){const c=co[ti];if(c<0||!land(ti))continue;size.set(c,(size.get(c)||0)+1);fsum.set(c,(fsum.get(c)||0)+(world.fert?world.fert[ti]:0));}
  return{size,fsum};
}
function memberPop(){
  const members=new Map(),pop=new Map();
  for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;members.set(s.countryId,(members.get(s.countryId)||0)+1);pop.set(s.countryId,(pop.get(s.countryId)||0)+(s.people||0));}
  return{members,pop};
}

function report(step,size,fsum,members,pop){
  const co=world._countryOwner, comp=comps();
  const countries=world.countries||new Map();
  const totalClaimed=sum([...size.values()]);
  // landmass span per country
  const spanOf=new Map();
  if(co){const per=new Map();
    for(let ti=0;ti<N;ti++){const c=co[ti];if(c<0||!land(ti))continue;let m=per.get(c);if(!m){m=new Map();per.set(c,m);}m.set(comp[ti],(m.get(comp[ti])||0)+1);}
    for(const[c,m]of per)spanOf.set(c,[...m.values()].filter(v=>v>=3).length);}
  const rows=[];
  for(const[id,c]of countries){
    const sz=size.get(id)||0;
    const p=world.personalities&&world.personalities.get(id);
    rows.push({id,sz,mem:c.members?c.members.length:0,
      capOrg:(c.capital&&c.capital.knowledge&&c.capital.knowledge.organization)||0,
      mf:sz?(fsum.get(id)||0)/sz:0,pop:pop.get(id)||0,span:spanOf.get(id)||1,
      label:p?p._label:"?",exp:p?(p.expansionism||0):0,agg:p?(p.aggression||0):0,com:p?(p.commerce||0):0,
      age:step-((track.get(id)||{}).first??step)});
  }
  rows.sort((a,b)=>b.sz-a.sz);
  const sizes=rows.map(r=>r.sz),nC=rows.length;
  console.log(`\n${"=".repeat(72)}\nSTEP ${step}  —  ${nC} countries, ${world.settlements.filter(s=>s.mode==="settled").length} settlements`);
  // eras
  const eraH=[0,0,0,0,0,0,0];for(const s of world.settlements)if(s.mode==="settled"&&s.knowledge)eraH[techState(s.knowledge).era]++;
  console.log(`  eras    `+ERAS.map((n,i)=>`${n.split(" ")[0]}:${eraH[i]}`).join("  "));
  // multitude + size
  console.log(`  SIZE    claimed ${totalClaimed} (${(100*totalClaimed/N).toFixed(1)}% of map) | median ${med(sizes)} max ${sizes[0]||0} max/med ${(sizes[0]/Math.max(1,med(sizes))).toFixed(1)}x gini ${gini(sizes).toFixed(2)}`);
  // top empires (the Rome hunt)
  console.log(`  TOP EMPIRES (by claimed tiles):`);
  for(const r of rows.slice(0,6))
    console.log(`     #${r.id}  ${String(r.sz).padStart(5)} tiles  ${String(r.mem).padStart(3)} members  pop ${String(Math.round(r.pop)).padStart(6)}  org ${r.capOrg.toFixed(2)}  fert ${r.mf.toFixed(2)}  ${r.span>1?`${r.span} landmasses  `:""}age ${r.age}  [${r.label}]`);
  // shape / oceans
  const claimSpan=rows.filter(r=>r.span>=2).length, memSpanRows=rows.filter(r=>r.mem>1);
  let memSpan=0;{const memC=new Map();for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;const ti=(s.pos.y|0)*W+(s.pos.x|0);let st=memC.get(s.countryId);if(!st){st=new Set();memC.set(s.countryId,st);}st.add(comp[ti]);}for(const st of memC.values())if(st.size>=2)memSpan++;}
  console.log(`  OCEANS  claims spanning >=2 landmasses: ${claimSpan} | realms with members on >=2 landmasses: ${memSpan}`);
  // economy
  const totalPop=sum(world.settlements.filter(s=>s.mode==="settled").map(s=>s.people||0));
  let tradeFlow=0;if(world._linkMoney)for(const[,net]of world._linkMoney)tradeFlow+=Math.abs(net);
  let seaMag=0,allMag=0;if(world._moneyFlows)for(const f of world._moneyFlows){allMag+=f.mag;if(f.sea)seaMag+=f.mag;}
  const cities=world.settlements.filter(s=>s.mode==="settled"&&(s.tier|0)>=2).length;
  const metros=world.settlements.filter(s=>s.mode==="settled"&&(s.tier|0)>=3).length;
  console.log(`  ECON    pop ${Math.round(totalPop)} | trade-flow ${tradeFlow.toFixed(0)} | ${cities} cities, ${metros} metropolises${allMag>0?` | sea-trade share ${(100*seaMag/allMag).toFixed(0)}%`:""}`);
  // personalities
  const labelH=new Map();for(const r of rows)labelH.set(r.label,(labelH.get(r.label)||0)+1);
  const lh=[...labelH.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  ");
  console.log(`  PERSON  ${lh}`);
  const k=Math.max(1,nC>>3),big=rows.slice(0,k),small=rows.slice(-k);
  console.log(`          big-vs-small expansionism ${med(big.map(r=>r.exp)).toFixed(2)} vs ${med(small.map(r=>r.exp)).toFixed(2)} | aggression ${med(big.map(r=>r.agg)).toFixed(2)} vs ${med(small.map(r=>r.agg)).toFixed(2)}`);
  // longevity
  const dead=[...track.values()].filter(t=>!t.alive),lifes=dead.map(t=>t.last-t.first);
  const living=[...track.entries()].filter(([,t])=>t.alive).sort((a,b)=>(step-b[1].first)-(step-a[1].first));
  console.log(`  LIFE    born ${bornTotal} died ${diedTotal} so far | dead-empire lifespan median ${med(lifes)} max ${Math.max(0,...lifes)} | oldest living: ${living.slice(0,3).map(([id,t])=>`#${id}:${step-t.first}t(${t.maxMembers}m)`).join(" ")}`);
}

function hallOfFame(step){
  console.log(`\n${"#".repeat(72)}\nHALL OF FAME — top realms across the whole run (Rome score = peakMembers x log10(1+lifespan))`);
  const all=[...track.entries()].map(([id,t])=>{const life=t.alive?step-t.first:t.last-t.first;return{id,life,...t,score:t.maxMembers*Math.log10(1+life)};});
  all.sort((a,b)=>b.score-a.score);
  for(const r of all.slice(0,10))
    console.log(`   #${r.id}  peak ${String(r.maxMembers).padStart(3)} members / ${String(r.maxSize).padStart(5)} tiles  pop ${String(Math.round(r.peakPop)).padStart(6)}  lifespan ${String(r.life).padStart(6)}t  ${r.alive?"ALIVE":"fell "}  [${r.label}]`);
}

let step=0,cki=0;
const END=CKPTS[CKPTS.length-1];
while(step<END){
  const next=Math.min(step+SAMPLE,CKPTS[cki]??END);
  while(step<next){stepPeopleSim(world,1);step++;}
  const {size,fsum}=scan();const {members,pop}=memberPop();
  const ids=new Set((world.countries||new Map()).keys());
  for(const id of ids)if(!prevIds.has(id))bornTotal++;
  for(const id of prevIds)if(!ids.has(id)){diedTotal++;const t=track.get(id);if(t)t.alive=false;}
  for(const[id,c]of (world.countries||new Map())){
    let t=track.get(id);if(!t){t={first:step,last:step,maxMembers:0,maxSize:0,peakPop:0,label:"?",alive:true};track.set(id,t);}
    t.last=step;t.alive=true;
    t.maxMembers=Math.max(t.maxMembers,c.members?c.members.length:0);
    t.maxSize=Math.max(t.maxSize,size.get(id)||0);t.peakPop=Math.max(t.peakPop,pop.get(id)||0);
    const p=world.personalities&&world.personalities.get(id);if(p)t.label=p._label||"?";
  }
  prevIds=ids;
  if(step>=CKPTS[cki]){report(step,size,fsum,members,pop);cki++;}
}
hallOfFame(step);
