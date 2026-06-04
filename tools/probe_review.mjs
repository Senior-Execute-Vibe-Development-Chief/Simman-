// Comprehensive long-run review of the live peopleSim at the REAL app scale.
//
//   node tools/probe_review.mjs [steps=20000] [seed=8817]
//
// Generates a 1920x960 world (the app's resolution); state.js downsamples by
// its fixed TILE_RES=2, so the sim runs at tw=960 x th=480 (~461k tiles) —
// exactly what WorldSim drives. Logs at checkpoints: settlements/tiers,
// country sizes, money + inflation, churn, speed; and at the end a deep review:
// per-pass profile, country SHAPES (contiguity/compactness/enclaves), money
// distribution, mining depletion, and invariant totals.
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = 1920, H = 960, TW = W, TH = H;   // app resolution → tw=960 x th=480

const T0 = performance.now();
console.log(`[gen] worldgen ${W}x${H} seed=${SEED} ...`);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers=computeRivers(TW,TH,tElev,tMoist,tTemp);w.rivers=rivers;
const deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers);w.deposits=deposits;
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,deposits});
world._checkInvariants=true;
world._dbgProfile=true;
console.log(`[gen] done in ${((performance.now()-T0)/1000).toFixed(1)}s  tw=${world.tw} th=${world.th} N=${world.N}`);

function gini(vals){ if(vals.length===0)return 0; const a=vals.slice().sort((x,y)=>x-y); let cum=0,wsum=0; const n=a.length; for(let i=0;i<n;i++){cum+=a[i];wsum+=cum;} const tot=cum; if(tot<=0)return 0; return (n+1-2*(wsum/tot))/n; }
function fmt(n){return n>=1e6?(n/1e6).toFixed(2)+"M":n>=1e3?(n/1e3).toFixed(1)+"k":(""+Math.round(n));}

// Per-country shape metrics from _countryOwner (the political Voronoi).
function shapeReport(world, topN){
  const co=world._countryOwner, {tw,th,N}=world;
  if(!co) return [];
  const tiles=new Map();
  for(let i=0;i<N;i++){const c=co[i]; if(c>=0){let a=tiles.get(c); if(!a)tiles.set(c,a=[]); a.push(i);}}
  const ranked=[...tiles.entries()].sort((a,b)=>b[1].length-a[1].length).slice(0,topN);
  const seen=new Int32Array(N); let stamp=0;
  const out=[];
  for(const [cid,arr] of ranked){
    stamp++;
    let comps=0, biggest=0, perim=0, minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
    const set=new Set(arr); const q=[];
    for(const start of arr){
      if(seen[start]===stamp) continue;
      comps++; let size=0; seen[start]=stamp; q.length=0; q.push(start);
      while(q.length){ const ti=q.pop(); size++;
        const ty=(ti/tw)|0, tx=ti-ty*tw;
        if(tx<minx)minx=tx; if(tx>maxx)maxx=tx; if(ty<miny)miny=ty; if(ty>maxy)maxy=ty;
        const xm=tx===0?tw-1:tx-1, xp=tx===tw-1?0:tx+1;
        const ns=[ty*tw+xm,ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];
        for(let k=0;k<4;k++){const ni=ns[k];
          if(ni<0){perim++;continue;}
          if(co[ni]!==cid || !set.has(ni)){perim++; continue;}
          if(seen[ni]!==stamp){seen[ni]=stamp; q.push(ni);}
        }
      }
      if(size>biggest)biggest=size;
    }
    const area=arr.length, bw=(maxx-minx+1), bh=(maxy-miny+1);
    out.push({cid,area,comps,biggestFrac:biggest/area,bw,bh,fill:area/Math.max(1,bw*bh),iso:perim*perim/(4*Math.PI*area)});
  }
  return out;
}

// Enclaves: connected single-country regions fully surrounded by ONE other
// country (no sea/edge) — the "bit stuck inside a neighbour" pathology.
function enclaveCount(world){
  const co=world._countryOwner,{tw,th,N,elev}=world; if(!co)return {enclaves:0,enclaveTiles:0};
  const seen=new Uint8Array(N); let enclaves=0,enclaveTiles=0; const q=[];
  for(let start=0;start<N;start++){
    if(seen[start])continue; const cid=co[start]; seen[start]=1;
    q.length=0; q.push(start); const region=[start]; let touchesEdge=false; const bound=new Set();
    const self=elev[start]<=0?-2:cid;
    while(q.length){ const ti=q.pop(); const ty=(ti/tw)|0,tx=ti-ty*tw;
      if(ty===0||ty===th-1)touchesEdge=true;
      const xm=tx===0?tw-1:tx-1,xp=tx===tw-1?0:tx+1;
      const ns=[ty*tw+xm,ty*tw+xp,ty>0?ti-tw:-1,ty<th-1?ti+tw:-1];
      for(let k=0;k<4;k++){const ni=ns[k]; if(ni<0)continue;
        const v=elev[ni]<=0?-2:co[ni];
        if(v===self){ if(!seen[ni]){seen[ni]=1;q.push(ni);region.push(ni);} }
        else if(v===-2){touchesEdge=true;} else {bound.add(v);}
      }
    }
    if(self<0||cid<0)continue; if(touchesEdge)continue; bound.delete(-1);
    if(bound.size===1){ enclaves++; enclaveTiles+=region.length; }
  }
  return {enclaves,enclaveTiles};
}

let prevCountryIds=new Set(); let lastT=performance.now(), lastStep=0;
const checkpoints=new Set([1000,2500,5000,7500,10000,12500,15000,17500,20000]);

function report(step){
  const now=performance.now(); const dms=(now-lastT)/Math.max(1,step-lastStep); lastT=now; lastStep=step;
  const st=peopleSimStats(world);
  const co=world._countryOwner; const tilesByC=new Map();
  if(co)for(let i=0;i<co.length;i++){const c=co[i]; if(c>=0)tilesByC.set(c,(tilesByC.get(c)||0)+1);}
  const csizes=[];
  if(world.countries)for(const c of world.countries.values())csizes.push(tilesByC.get(c.id)||0);
  csizes.sort((a,b)=>b-a);
  const ids=new Set(world.countries?[...world.countries.keys()]:[]);
  let born=0,died=0; for(const id of ids)if(!prevCountryIds.has(id))born++; for(const id of prevCountryIds)if(!ids.has(id))died++;
  prevCountryIds=ids;
  let coin=0,treasury=0,topW=0; for(const s of world.settlements){if(s.mode!=="settled")continue;coin+=Math.max(0,s.wealth||0); if((s.wealth||0)>topW)topW=s.wealth;}
  if(world.governments)for(const g of world.governments.values())treasury+=Math.max(0,g.treasury||0);
  let pmin=1e9,pmax=-1e9; if(world._inflRaw)for(const v of world._inflRaw.values()){if(v<pmin)pmin=v;if(v>pmax)pmax=v;}
  console.log(`\n── step ${step}  (${dms.toFixed(1)} ms/step) ───────────────────────────`);
  console.log(` setts ${st.settlements} (V${st.villages} T${st.towns} C${st.cities} M${st.metropolises})  pop ${fmt(st.totalPeople)}  claimed ${(st.landPct*100).toFixed(1)}%  largestEmpire ${fmt(st.largestEmpire)} tiles`);
  console.log(` countries ${st.countries} (Δ +${born}/-${died})  tiles top5 [${csizes.slice(0,5).map(fmt).join(",")}]  mean ${fmt(csizes.reduce((a,b)=>a+b,0)/Math.max(1,csizes.length))}  gini ${gini(csizes).toFixed(2)}`);
  console.log(` money: coin ${fmt(coin)}  treasury ${fmt(treasury)}  total ${fmt(coin+treasury)}  richestSett ${fmt(topW)}  priceLvl ${isFinite(pmin)?pmin.toFixed(2):"-"}..${isFinite(pmax)?pmax.toFixed(2):"-"}`);
  console.log(` army ${fmt(st.totalArmy)}  tickMs(last) ${st.tickMs}`);
  if(world.debug.invariantHits&&Object.keys(world.debug.invariantHits).length) console.log(` !! invariant hits ${JSON.stringify(world.debug.invariantHits)}`);
}

for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(checkpoints.has(s)) report(s); }

console.log(`\n================= FINAL @ ${STEPS} =================`);
const total=(performance.now()-T0)/1000;
console.log(`total wall ${total.toFixed(1)}s  avg ${((total*1000)/STEPS).toFixed(2)} ms/step (incl worldgen)`);
if(world.debug.pass){ console.log("per-pass (last tick, ms):"); for(const[k,v]of Object.entries(world.debug.pass).sort((a,b)=>b[1]-a[1]))console.log(`   ${k.padEnd(12)} ${v.toFixed(2)}`); }
const tiers=[0,0,0,0]; const pops=[]; let topSett=null;
for(const s of world.settlements){if(s.mode!=="settled")continue; tiers[s.tier|0]++; pops.push(s.people); if(!topSett||s.people>topSett.people)topSett=s;}
pops.sort((a,b)=>b-a);
console.log(`tiers V${tiers[0]} T${tiers[1]} C${tiers[2]} M${tiers[3]}  largest settlement ${topSett?topSett.name+" "+fmt(topSett.people)+" (tier "+topSett.tier+")":"-"}`);
console.log(`pop pyramid: top10 [${pops.slice(0,10).map(fmt).join(",")}]  median ${fmt(pops[pops.length>>1]||0)}`);
console.log("country SHAPES (top 8 by tiles): area comps biggest% bbox fill iso(1=disc,>1 ragged)");
for(const r of shapeReport(world,8)){
  const c=world.countries.get(r.cid); const k=(c&&c.capital&&c.capital.knowledge)||{};
  console.log(`  c${r.cid} area=${String(r.area).padStart(6)} comps=${String(r.comps).padStart(3)} big=${(r.biggestFrac*100).toFixed(0)}% bbox=${r.bw}x${r.bh} fill=${r.fill.toFixed(2)} iso=${r.iso.toFixed(2)}  org=${(k.organization||0).toFixed(2)} met=${(k.metallurgy||0).toFixed(2)} mem=${c?c.members.length:0}`);
}
const enc=enclaveCount(world); console.log(`enclaves: ${enc.enclaves} fully-surrounded regions, ${enc.enclaveTiles} tiles`);
const ev={}; for(const s of world.settlements){if(!s.history)continue; for(const h of s.history)ev[h.type]=(ev[h.type]||0)+1;}
console.log("history events on SURVIVING settlements:", JSON.stringify(ev));
let coin=0,treasury=0; const ws=[]; for(const s of world.settlements){if(s.mode!=="settled")continue; coin+=Math.max(0,s.wealth||0); ws.push(s.wealth||0);} ws.sort((a,b)=>b-a);
if(world.governments)for(const g of world.governments.values())treasury+=Math.max(0,g.treasury||0);
console.log(`money: settlement coin ${fmt(coin)}  treasuries ${fmt(treasury)}  total ${fmt(coin+treasury)}  wealth gini ${gini(ws).toFixed(2)}  richest [${ws.slice(0,5).map(fmt).join(",")}]`);
if(world.depositReserve){for(const id of Object.keys(world.depositReserve)){const arr=world.depositReserve[id];let left=0,n=0;for(let i=0;i<arr.length;i++){if(arr[i]>0){left+=arr[i];n++;}}console.log(`  mine ${id}: ${n} tiles still producing, ${fmt(left)} reserve left`);}}
const hits=world.debug.invariantHits||{}; const nHits=Object.values(hits).reduce((a,b)=>a+b,0);
console.log(`invariants: ${nHits===0?"CLEAN":JSON.stringify(hits)}   totals coin=${fmt(world.debug.totalCoin)} people=${fmt(world.debug.totalPeople)}`);
console.log("=================== END ===================");
