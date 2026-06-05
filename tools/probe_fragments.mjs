// Political-map fragmentation diagnostic: a CLEAN map has ~one connected territory
// blob per country; "confetti" secession leaves countries in many disconnected
// pieces and strands parent ISLANDS inside a breakaway. Over a run we measure, from
// world._countryOwner (countryId per tile, 4-connectivity, x-wrap):
//   • frag  — mean connected components per country (1.0 = every realm is one blob)
//   • multi — how many countries are in >1 piece, and the worst offender
//   • islands — tiny stranded components (≤ISLE tiles): the confetti flecks
//   • enclaves — components fully surrounded by a SINGLE other country (A inside B)
//   node tools/probe_fragments.mjs [steps] [W] [H] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.TE !== undefined) T.TECH_EFFECTS = parseFloat(process.env.TE);

const STEPS = parseInt(process.argv[2] || "12000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);
const ISLE = 8;   // a component this small or smaller is a confetti fleck
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
const w = generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});

const tw=W, th=H, N=W*H;
// connected components of each country in _countryOwner (4-neigh, x wraps)
function frag(){
  const co=world._countryOwner; if(!co) return null;
  const comp=new Int32Array(N).fill(-1);
  const compCountry=[], compSize=[]; let nc=0;
  const stack=[];
  for(let s=0;s<N;s++){
    if(co[s]<0||comp[s]>=0) continue;
    const cc=co[s]; const id=nc++; compCountry.push(cc); compSize.push(0);
    comp[s]=id; stack.push(s);
    while(stack.length){ const ti=stack.pop(); compSize[id]++;
      const ty=(ti/tw)|0, tx=ti-ty*tw;
      const xm=tx===0?tw-1:tx-1, xp=tx===tw-1?0:tx+1;
      const ns=[ty*tw+xm,ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];
      for(const ni of ns){ if(ni<0||comp[ni]>=0||co[ni]!==cc) continue; comp[ni]=id; stack.push(ni); }
    }
  }
  // per-country component counts + which is the country's MAIN (largest) blob
  const perC=new Map();
  for(let id=0;id<nc;id++){ const cc=compCountry[id]; let a=perC.get(cc); if(!a) perC.set(cc,a=[]); a.push(id); }
  const mainComp=new Map();   // country -> its largest component id
  for(const [cc,ids] of perC){ let bi=ids[0]; for(const id of ids) if(compSize[id]>compSize[bi]) bi=id; mainComp.set(cc,bi); }
  let countries=0, multi=0, worst=0, worstC=-1, islands=0, totalComp=0;
  let mainShareSum=0;
  for(const [cc,ids] of perC){ countries++; totalComp+=ids.length;
    let tot=0,mx=0; for(const id of ids){ tot+=compSize[id]; if(compSize[id]>mx)mx=compSize[id]; }
    mainShareSum += mx/Math.max(1,tot);
    if(ids.length>1){ multi++; if(ids.length>worst){worst=ids.length; worstC=cc;} }
    for(const id of ids) if(compSize[id]<=ISLE) islands++;
  }
  // For every MINOR (non-main) component, classify what borders it most: a FOREIGN
  // country (true interleaving — parent/other land "in between") vs WILDERNESS/sea
  // (a natural archipelago gap, which is fine). Counts border-tile adjacencies.
  let minorForeign=0, minorWild=0;
  for(let ti=0;ti<N;ti++){ const id=comp[ti]; if(id<0) continue; const cc=compCountry[id];
    if(id===mainComp.get(cc)) continue;                      // only minor blobs
    const ty=(ti/tw)|0, tx=ti-ty*tw; const xm=tx===0?tw-1:tx-1, xp=tx===tw-1?0:tx+1;
    const ns=[ty*tw+xm,ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];
    for(const ni of ns){ if(ni<0) continue; const oc=world._countryOwner[ni];
      if(oc===cc) continue; if(oc<0) minorWild++; else minorForeign++; }
  }
  // enclaves: a component all of whose border tiles belong to ONE other country
  let enclaves=0;
  for(let id=0;id<nc;id++){
    const cc=compCountry[id]; if(compSize[id]>200) continue;   // only check smallish blobs (perf)
    let surround=-2, ok=true, touchedEdge=false;
    // re-scan tiles of this component
  }
  // (enclave scan folded into a second pass for tiles in small comps)
  const small=[]; for(let id=0;id<nc;id++) if(compSize[id]<=200) small.push(id);
  const smallSet=new Set(small);
  const encState=new Map();   // id -> surrounding country (or -2 mixed / -3 edge)
  for(let ti=0;ti<N;ti++){ const id=comp[ti]; if(id<0||!smallSet.has(id)) continue;
    const cc=compCountry[id]; const ty=(ti/tw)|0, tx=ti-ty*tw;
    const xm=tx===0?tw-1:tx-1, xp=tx===tw-1?0:tx+1;
    const ns=[ty*tw+xm,ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];
    for(const ni of ns){ if(ni<0){ encState.set(id,-3); continue; }
      const oc=world._countryOwner[ni]; if(oc===cc) continue;
      if(oc<0){ encState.set(id,-3); continue; }   // touches wilderness/sea → not an enclave
      const prev=encState.get(id);
      if(prev===undefined) encState.set(id,oc); else if(prev>=0&&prev!==oc) encState.set(id,-2);
    }
  }
  for(const [id,st] of encState) if(st>=0) enclaves++;
  const fPct = minorForeign/Math.max(1,minorForeign+minorWild);
  return { countries, totalComp, frag:(totalComp/Math.max(1,countries)), multi, worst, islands, enclaves,
           mainShare: mainShareSum/Math.max(1,countries), foreignBorderPct: fPct };
}

for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1);
  if(s%3000===0){ const f=frag(); const st=peopleSimStats(world);
    console.log(`step ${String(s).padStart(5)}: realms ${String(f.countries).padStart(3)}  frag ${f.frag.toFixed(2)}  multipiece ${f.multi} (worst ${f.worst})  flecks ${f.islands}  | mainBlob ${(f.mainShare*100|0)}% of realm  minor-edges foreign ${(f.foreignBorderPct*100|0)}% vs wild ${(100-(f.foreignBorderPct*100|0))}%`);
  }
}
