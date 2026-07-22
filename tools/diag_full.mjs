// Comprehensive full-run stats. Steps the sim, samples empire existence every
// SAMPLE ticks (longevity), and at each checkpoint records EVERYTHING accessible:
// demographics, territory (+ claim population-density, the artifact detector),
// ocean shape, economy/wealth, per-track technology, military, politics,
// personality, longevity. Prints readable sections AND writes a JSON record.
import fs from "fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techState, ERAS } from "../src/sim/peopleSim/tech.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W=+(process.argv[4]||960),H=W>>1,N=W*H;
const SEED=+(process.argv[2]||8817);
const CKPTS=(process.argv[3]||"15000,30000,45000").split(",").map(Number);
const OUT=process.argv[5]||`/tmp/full_${SEED}`;
const G=+(process.argv[6]||1); if(G>1){T.SIM_GRANULARITY=G;console.log(`[granularity G=${G}]`);}
const SAMPLE=1500;
// App-identical pipeline (river/lake moisture boosts + bDist feed tCrop) —
// the old hand-rolled version here measured a world the app never simulates.
const world=buildSim({W,H,seed:SEED});

const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:0;
const srt=a=>[...a].sort((x,y)=>x-y);
const med=a=>{if(!a.length)return 0;const s=srt(a);return s[s.length>>1];};
const pct=(a,p)=>{if(!a.length)return 0;const s=srt(a);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
const mx=a=>a.length?Math.max(...a):0;
function gini(a){if(a.length<2)return 0;const s=srt(a);let c=0;for(let i=0;i<s.length;i++)c+=(2*(i+1)-s.length-1)*s[i];return c/(s.length*sum(s)||1);}
const r2=x=>Math.round(x*100)/100;
const land=ti=>world.elev[ti]>0;
let NLAND=0;for(let i=0;i<N;i++)if(land(i))NLAND++;

let COMP=null;
function comps(){if(COMP)return COMP;const c=new Int32Array(N).fill(-1),st=[];
  for(let i=0;i<N;i++){if(c[i]>=0||!land(i))continue;st.length=0;st.push(i);c[i]=i;
    while(st.length){const ti=st.pop();const y=(ti/W)|0,x=ti-y*W;
      const ns=[y*W+((x+1)%W),y*W+((x-1+W)%W),y>0?ti-W:-1,y<H-1?ti+W:-1];
      for(const ni of ns){if(ni<0||c[ni]>=0||!land(ni))continue;c[ni]=i;st.push(ni);}}}
  return COMP=c;}

const KTRK=["agriculture","metallurgy","organization","navigation","mobility","construction"];
const track=new Map();   // id -> {first,last,maxMembers,maxSize,peakPop,maxWealth,label,alive}
let prevIds=new Set(), bornTotal=0, diedTotal=0;
const record={seed:SEED,W,checkpoints:[],hall:[]};

function scanSize(){const co=world._countryOwner;const size=new Map(),fsum=new Map();if(!co)return{size,fsum};
  for(let ti=0;ti<N;ti++){const c=co[ti];if(c<0||!land(ti))continue;size.set(c,(size.get(c)||0)+1);fsum.set(c,(fsum.get(c)||0)+(world.fert?world.fert[ti]:0));}
  return{size,fsum};}

function collect(step){
  const co=world._countryOwner, comp=comps(), countries=world.countries||new Map();
  const setts=world.settlements.filter(s=>s.mode==="settled");
  const {size,fsum}=scanSize();
  // per-country aggregates
  const members=new Map(),cpop=new Map(),cwealth=new Map(),carmy=new Map();
  for(const s of setts){if(s.countryId<0)continue;const c=s.countryId;
    members.set(c,(members.get(c)||0)+1);cpop.set(c,(cpop.get(c)||0)+(s.people||0));
    cwealth.set(c,(cwealth.get(c)||0)+(s.wealth||0));carmy.set(c,(carmy.get(c)||0)+(s.army||0));}
  // landmass span + member span
  const spanOf=new Map();{const per=new Map();
    for(let ti=0;ti<N;ti++){const c=co?co[ti]:-1;if(c<0||!land(ti))continue;let m=per.get(c);if(!m){m=new Map();per.set(c,m);}m.set(comp[ti],(m.get(comp[ti])||0)+1);}
    for(const[c,m]of per)spanOf.set(c,[...m.values()].filter(v=>v>=3).length);}
  let memSpan=0;{const mc=new Map();for(const s of setts){if(s.countryId<0)continue;const ti=(s.pos.y|0)*W+(s.pos.x|0);let st=mc.get(s.countryId);if(!st){st=new Set();mc.set(s.countryId,st);}st.add(comp[ti]);}for(const st of mc.values())if(st.size>=2)memSpan++;}
  // rows per country
  const rows=[];
  for(const[id,c]of countries){const sz=size.get(id)||0;const p=world.personalities&&world.personalities.get(id);
    rows.push({id,sz,mem:c.members?c.members.length:0,pop:cpop.get(id)||0,wealth:cwealth.get(id)||0,army:carmy.get(id)||0,
      org:(c.capital&&c.capital.knowledge&&c.capital.knowledge.organization)||0,mf:sz?(fsum.get(id)||0)/sz:0,
      dens:sz?(cpop.get(id)||0)/sz:0,span:spanOf.get(id)||1,
      label:p?p._label:"?",exp:p?(p.expansionism||0):0,agg:p?(p.aggression||0):0,com:p?(p.commerce||0):0,
      age:step-((track.get(id)||{}).first??step)});}
  rows.sort((a,b)=>b.sz-a.sz);
  const sizes=rows.map(r=>r.sz),nC=rows.length;
  // demographics
  const pops=setts.map(s=>s.people||0),totalPop=sum(pops);
  const tierC=[0,0,0,0],tierP=[0,0,0,0];for(const s of setts){const t=Math.min(3,s.tier|0);tierC[t]++;tierP[t]+=s.people||0;}
  // City size = the URBAN CORE, not the whole province: s.people bundles the
  // rural hinterland. True urbanization = people in cores / total people (mirror
  // stylized.mjs:305). The tier>=2 fallback serves the pre-province model.
  const hasRural=setts.some(s=>(s._ruralPop||0)>0);
  const cityPop=s=>hasRural?(s._urbanPop||0):((s.tier|0)>=2?(s.people||0):0);
  const topCities=setts.slice().sort((a,b)=>cityPop(b)-cityPop(a)).slice(0,5).map(s=>({pop:Math.round(cityPop(s)),tier:s.tier|0}));
  let urbanCore=0;for(const s of setts)urbanCore+=cityPop(s);
  const urban=totalPop?urbanCore/totalPop:0;
  // economy
  let tradeFlow=0;if(world._linkMoney)for(const[,n]of world._linkMoney)tradeFlow+=Math.abs(n);
  let seaMag=0,allMag=0;if(world._moneyFlows)for(const f of world._moneyFlows){allMag+=f.mag;if(f.sea)seaMag+=f.mag;}
  // Total gold = settlement coin + LIVE state treasuries (matches peopleSimStats,
  // index.js:424). diag_full previously omitted treasuries entirely.
  let treasury=0;if(world.polities)for(const p of world.polities.values())if(p.endedStep<0)treasury+=Math.max(0,p.treasury||0);
  const totalWealth=sum(setts.map(s=>s.wealth||0))+treasury;
  let roadTiles=0;if(world.roadQuality){const rq=world.roadQuality;for(let i=0;i<N;i++)if(rq[i]<1.0)roadTiles++;}
  const nLinks=world._linkMoney?world._linkMoney.size:0;
  // technology
  const eraH=[0,0,0,0,0,0,0];for(const s of setts)if(s.knowledge)eraH[techState(s.knowledge).era]++;
  const tech={};for(const t of KTRK){const v=setts.map(s=>(s.knowledge&&s.knowledge[t])||0);tech[t]={med:r2(med(v)),max:r2(mx(v))};}
  let oreN=0,navN=0;for(const s of setts){if((s._metalCap??0)>0)oreN++;if((s.knowledge&&s.knowledge.navigation||0)>=0.25)navN++;}
  // military
  let atWar=0,totalFronts=0;if(world._fronts&&world._fronts.byCountry){atWar=world._fronts.byCountry.size;for(const st of world._fronts.byCountry.values())totalFronts+=st.size;}
  const totalArmy=sum(setts.map(s=>s.army||0));
  let totalMP=0;if(world._manpower)for(const[,v]of world._manpower)totalMP+=v;
  const exh=world._warExhaust?[...world._warExhaust.values()]:[];
  // personality
  const labelH={};for(const r of rows)labelH[r.label]=(labelH[r.label]||0)+1;
  const k=Math.max(1,nC>>3),big=rows.slice(0,k),small=rows.slice(-k);
  // longevity
  const dead=[...track.values()].filter(t=>!t.alive),lifes=dead.map(t=>t.last-t.first);
  const living=[...track.entries()].filter(([,t])=>t.alive).sort((a,b)=>(b[1].maxMembers)-(a[1].maxMembers));
  // claim density artifact: big realms (top eighth) with low pop-density
  const lowDensBig=big.filter(r=>r.dens<2).length;
  const st={step,nCountries:nC,nSettlements:setts.length,
    claimedTiles:sum(sizes),claimedPctMap:r2(100*sum(sizes)/N),claimedPctLand:r2(100*sum(sizes)/NLAND),
    size:{median:med(sizes),mean:Math.round(mean(sizes)),max:sizes[0]||0,maxMed:r2(sizes[0]/Math.max(1,med(sizes))),gini:r2(gini(sizes)),p90:pct(sizes,0.9),top5:sizes.slice(0,5)},
    claimDensity:{median:r2(med(rows.map(r=>r.dens))),bigMedian:r2(med(big.map(r=>r.dens))),lowDensBigCount:lowDensBig},
    demographics:{totalPop:Math.round(totalPop),popGini:r2(gini(pops)),urbanizationPct:r2(100*urban),
      tierCounts:{FR:tierC[0],town:tierC[1],city:tierC[2],metro:tierC[3]},topCityPops:topCities.map(c=>c.pop)},
    oceans:{claimsSpanning:rows.filter(r=>r.span>=2).length,membersSpanning:memSpan,maxSpan:mx(rows.map(r=>r.span))},
    economy:{totalWealth:Math.round(totalWealth),tradeFlow:Math.round(tradeFlow),seaTradePct:allMag>0?r2(100*seaMag/allMag):null,nTradeLinks:nLinks,roadTiles,
      richestCountryWealth:Math.round(mx([...cwealth.values()]))},
    technology:{eras:Object.fromEntries(ERAS.map((n,i)=>[n.split(" ")[0],eraH[i]])),tracks:tech,oreAccess:oreN,seafaring:navN},
    military:{countriesAtWar:atWar,totalFronts,totalArmy:Math.round(totalArmy),totalManpower:Math.round(totalMP),warExhaustMed:r2(med(exh)),warExhaustMax:r2(mx(exh))},
    personality:{labels:labelH,
      bigExp:r2(med(big.map(r=>r.exp))),smallExp:r2(med(small.map(r=>r.exp))),
      bigAgg:r2(med(big.map(r=>r.agg))),smallAgg:r2(med(small.map(r=>r.agg))),
      bigCom:r2(med(big.map(r=>r.com))),smallCom:r2(med(small.map(r=>r.com)))},
    longevity:{born:bornTotal,died:diedTotal,deadLifespanMed:med(lifes),deadLifespanMax:mx(lifes),
      oldestLiving:living.slice(0,3).map(([id,t])=>({id,age:step-t.first,members:t.maxMembers}))},
    topEmpires:rows.slice(0,6).map(r=>({id:r.id,tiles:r.sz,members:r.mem,pop:Math.round(r.pop),wealth:Math.round(r.wealth),org:r2(r.org),fert:r2(r.mf),density:r2(r.dens),span:r.span,age:r.age,label:r.label}))};
  return st;
}

function printReport(s){
  const P=console.log;
  P(`\n${"=".repeat(76)}\nSTEP ${s.step}  —  seed ${SEED}, ${W}-wide`);
  P(`  OVERVIEW    ${s.nCountries} countries · ${s.nSettlements} settlements · claimed ${s.claimedPctMap}% of map (${s.claimedPctLand}% of land)`);
  const d=s.demographics;
  P(`  DEMOGRAPHY  pop ${d.totalPop} · urban ${d.urbanizationPct}% · gini ${d.popGini} · tiers FR:${d.tierCounts.FR} town:${d.tierCounts.town} city:${d.tierCounts.city} metro:${d.tierCounts.metro} · top cities ${d.topCityPops.join("/")}`);
  P(`  TERRITORY   size median ${s.size.median} mean ${s.size.mean} max ${s.size.max} (max/med ${s.size.maxMed}x) gini ${s.size.gini} · top5 ${s.size.top5.join(",")}`);
  P(`  CLAIM-DENS  median ${s.claimDensity.median} pop/tile · big-realm median ${s.claimDensity.bigMedian} · under-populated big realms (<2): ${s.claimDensity.lowDensBigCount}`);
  P(`  OCEANS      claims over >=2 landmasses ${s.oceans.claimsSpanning} · realms with members over water ${s.oceans.membersSpanning} · max span ${s.oceans.maxSpan}`);
  const e=s.economy;
  P(`  ECONOMY     wealth ${e.totalWealth} · trade-flow ${e.tradeFlow} · sea-trade ${e.seaTradePct??"n/a"}% · ${e.nTradeLinks} links · ${e.roadTiles} road tiles · richest realm ${e.richestCountryWealth}`);
  const t=s.technology;
  P(`  TECH        eras `+Object.entries(t.eras).map(([k,v])=>`${k}:${v}`).join(" ")+` · ore-access ${t.oreAccess} · seafarers ${t.seafaring}`);
  P(`              `+KTRK.map(k=>`${k.slice(0,4)} ${t.tracks[k].med}/${t.tracks[k].max}`).join("  ")+`  (median/max)`);
  const m=s.military;
  P(`  MILITARY    ${m.countriesAtWar} realms at war · ${m.totalFronts} fronts · army ${m.totalArmy} · manpower ${m.totalManpower} · war-exhaust med ${m.warExhaustMed}/max ${m.warExhaustMax}`);
  const pe=s.personality;
  P(`  PERSONALITY `+Object.entries(pe.labels).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(" "));
  P(`              big-vs-small  expansion ${pe.bigExp}/${pe.smallExp}  aggression ${pe.bigAgg}/${pe.smallAgg}  commerce ${pe.bigCom}/${pe.smallCom}`);
  const l=s.longevity;
  P(`  LONGEVITY   born ${l.born} died ${l.died} · dead lifespan med ${l.deadLifespanMed}/max ${l.deadLifespanMax} · oldest ${l.oldestLiving.map(o=>`#${o.id}(${o.age}t,${o.members}m)`).join(" ")}`);
  P(`  TOP EMPIRES (by tiles):`);
  for(const r of s.topEmpires)
    P(`     #${r.id}  ${String(r.tiles).padStart(5)}t ${String(r.members).padStart(3)}m  pop ${String(r.pop).padStart(6)} dens ${String(r.density).padStart(5)}  wealth ${String(r.wealth).padStart(6)}  org ${r.org} fert ${r.fert} ${r.span>1?r.span+"LM ":"   "}age ${r.age}  [${r.label}]`);
}

function hallOfFame(step){
  console.log(`\n${"#".repeat(76)}\nHALL OF FAME — seed ${SEED} (score = peakMembers x log10(1+lifespan))`);
  const all=[...track.entries()].map(([id,t])=>{const life=t.alive?step-t.first:t.last-t.first;return{id,life,...t,score:t.maxMembers*Math.log10(1+life)};});
  all.sort((a,b)=>b.score-a.score);
  record.hall=all.slice(0,12).map(r=>({id:r.id,peakMembers:r.maxMembers,peakTiles:r.maxSize,peakPop:Math.round(r.peakPop),peakWealth:Math.round(r.maxWealth),lifespan:r.life,alive:r.alive,label:r.label}));
  for(const r of record.hall)
    console.log(`   #${r.id}  peak ${String(r.peakMembers).padStart(3)}m / ${String(r.peakTiles).padStart(5)}t  pop ${String(r.peakPop).padStart(6)}  wealth ${String(r.peakWealth).padStart(6)}  lifespan ${String(r.lifespan).padStart(6)}t  ${r.alive?"ALIVE":"fell "}  [${r.label}]`);
  fs.writeFileSync(OUT+".json",JSON.stringify(record,null,1));
  console.log(`\nJSON record → ${OUT}.json`);
}

let step=0,cki=0;const END=CKPTS[CKPTS.length-1];
while(step<END){
  const next=Math.min(step+SAMPLE,CKPTS[cki]??END);
  while(step<next){stepPeopleSim(world,1);step++;}
  const {size}=scanSize();
  const cpop=new Map(),cwealth=new Map();
  for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;cpop.set(s.countryId,(cpop.get(s.countryId)||0)+(s.people||0));cwealth.set(s.countryId,(cwealth.get(s.countryId)||0)+(s.wealth||0));}
  const ids=new Set((world.countries||new Map()).keys());
  for(const id of ids)if(!prevIds.has(id))bornTotal++;
  for(const id of prevIds)if(!ids.has(id)){diedTotal++;const t=track.get(id);if(t)t.alive=false;}
  for(const[id,c]of (world.countries||new Map())){let t=track.get(id);if(!t){t={first:step,last:step,maxMembers:0,maxSize:0,peakPop:0,maxWealth:0,label:"?",alive:true};track.set(id,t);}
    t.last=step;t.alive=true;t.maxMembers=Math.max(t.maxMembers,c.members?c.members.length:0);t.maxSize=Math.max(t.maxSize,size.get(id)||0);
    t.peakPop=Math.max(t.peakPop,cpop.get(id)||0);t.maxWealth=Math.max(t.maxWealth,cwealth.get(id)||0);
    const p=world.personalities&&world.personalities.get(id);if(p)t.label=p._label||"?";}
  prevIds=ids;
  if(step>=CKPTS[cki]){const st=collect(step);record.checkpoints.push(st);fs.writeFileSync(OUT+".json",JSON.stringify(record,null,1));printReport(st);cki++;}
}
hallOfFame(step);
