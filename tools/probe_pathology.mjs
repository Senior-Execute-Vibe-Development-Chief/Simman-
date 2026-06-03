// Diagnostic for the three reported pathologies in the country sim:
//   1. Countries too LARGE EARLY (big tile-count while still low-tech)
//   2. Border FLICKER / instant back-and-forth claiming (country churn/pass)
//   3. ENCLAVES / EXCLAVES (bits of countries stuck inside other countries)
//
// Reuses the earthRun world pipeline.
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.env.EARTH_W || "480", 10);
const H = parseInt(process.env.EARTH_H || "240", 10);
const TW = W, TH = H;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(TW*TH);
function tileFert(t,m,e){ if(e>0.45)return 0.01; const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4); const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22)); return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3)); }
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx; tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers = computeRivers(TW,TH,w.elevation,w.moisture,w.temperature); w.rivers = rivers;
const deposits = generateResources(TW,TH,w.elevation,w.temperature,w.moisture,w.coastal,w,w._seed||SEED,rivers); w.deposits = deposits;
const world = initPeopleSim(w, { seed: w._seed||SEED, tCrop, tileRes: 1, deposits });

function eraOf(k){ const s=(k.metallurgy||0)+(k.organization||0)+(k.agriculture||0);
  return s<0.3?"paleo":s<0.8?"neolithic":s<1.5?"chalco":s<2.2?"bronze":s<3.0?"iron":"classical"; }

// country id of a tile's owner, or -1 wild, -2 sea
function tileCC(world, ti){
  if (world.elev[ti] <= 0) return -2;
  const oid = world._territoryOwner[ti];
  if (oid < 0) return -1;
  const s = world._byId && world._byId.get(oid);
  return s ? s.countryId : -1;
}

// Snapshot the per-tile country map (land only); returns Int32Array.
function ccSnapshot(world){
  const N = world.N, out = new Int32Array(N);
  for (let ti=0; ti<N; ti++) out[ti] = tileCC(world, ti);
  return out;
}

// Flicker: count LAND tiles whose owning-country changed between two snaps,
// ignoring tiles that went to/from wild/sea (those are growth, not flicker).
function churn(a, b){
  let flips=0, landA=0;
  for (let i=0;i<a.length;i++){
    if (a[i] >= 0) landA++;
    if (a[i] >= 0 && b[i] >= 0 && a[i] !== b[i]) flips++;
  }
  return { flips, landA, frac: landA? flips/landA : 0 };
}

// Enclave / exclave detection.
//   exclaveSetts: settlements whose home tile's country-region (flood over
//     same-country land tiles) does NOT contain their own capital — i.e. a
//     disconnected piece of the realm.
//   enclosedSetts: settlements all of whose territory-border neighbours are a
//     SINGLE foreign country (fully surrounded island in someone else).
function analyzeEnclaves(world){
  const { N, tw, th } = world;
  const owner = world._territoryOwner;
  const byId = world._byId;
  // Build country -> capital tile
  const capTile = new Map();
  for (const c of world.countries.values()) capTile.set(c.id, (c.capital.pos.y|0)*tw + (c.capital.pos.x|0));

  // Flood country-connected components over land tiles.
  const comp = new Int32Array(N).fill(-1);
  let nComp = 0;
  const compCC = [];        // countryId of each component
  const compHasCap = [];    // does the component contain its country's capital tile?
  const q = [];
  for (let start=0; start<N; start++){
    if (comp[start] !== -1) continue;
    const cc = tileCC(world, start);
    if (cc < 0) { comp[start] = -2; continue; }   // wild/sea: skip
    const id = nComp++;
    compCC.push(cc); compHasCap.push(false);
    comp[start] = id; q.length=0; q.push(start);
    while(q.length){
      const ti = q.pop();
      const ty=(ti/tw)|0, tx=ti-ty*tw;
      const xm = tx===0?tw-1:tx-1, xp = tx===tw-1?0:tx+1;
      const ns=[ty*tw+xm, ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];
      for(let k=0;k<4;k++){ const ni=ns[k]; if(ni<0||comp[ni]!==-1) continue;
        if (tileCC(world, ni) === cc){ comp[ni]=id; q.push(ni); } }
    }
  }
  // Mark which components hold their capital.
  for (const [cid, ct] of capTile){ const id = comp[ct]; if (id>=0 && compCC[id]===cid) compHasCap[id]=true; }

  // Per-country: total components, and components NOT holding the capital = exclaves.
  const byCountry = new Map();
  for (let id=0; id<nComp; id++){
    const cc = compCC[id];
    let r = byCountry.get(cc); if(!r){ r={comps:0, exclaves:0}; byCountry.set(cc,r); }
    r.comps++; if(!compHasCap[id]) r.exclaves++;
  }
  let multiComp=0, totalExclaves=0;
  for (const [,r] of byCountry){ if(r.comps>1) multiComp++; totalExclaves += r.exclaves; }

  // Enclosed settlements: a settled town all of whose territory's foreign
  // neighbour tiles belong to ONE country (and it touches no sea/edge/wild).
  let enclosed=0;
  for (const s of world.settlements){
    if (s.mode!=="settled") continue;
    // gather this settlement's tiles' foreign borders
    const foreign = new Set(); let touchOpen=false, has=false;
    for (let ti=0; ti<N; ti++){
      if (owner[ti] !== s.id) continue; has=true;
      const ty=(ti/tw)|0, tx=ti-ty*tw;
      if (ty===0||ty===th-1) touchOpen=true;
      const xm=tx===0?tw-1:tx-1, xp=tx===tw-1?0:tx+1;
      const ns=[ty*tw+xm,ty*tw+xp,ty>0?ti-tw:-1,ty<th-1?ti+tw:-1];
      for(let k=0;k<4;k++){ const ni=ns[k]; if(ni<0){continue;}
        const ncc=tileCC(world,ni);
        if(ncc===-2||ncc===-1){ touchOpen=true; }
        else if(ncc!==s.countryId){ foreign.add(ncc); } }
    }
    if (has && !touchOpen && foreign.size===1) enclosed++;
  }
  return { multiComp, totalExclaves, enclosed, nComp };
}

function topCountries(n=6){
  return [...world.countries.values()].filter(c=>c.members.length>0)
    .map(c=>{ const o=world._territoryOwner; const ids=new Set(c.members.map(m=>m.id)); let t=0; for(let i=0;i<o.length;i++) if(o[i]>=0&&ids.has(o[i]))t++; return {c, tiles:t}; })
    .sort((a,b)=>b.tiles-a.tiles).slice(0,n);
}

let prevSnap = null;
function report(step){
  const snap = ccSnapshot(world);
  let ch = null;
  if (prevSnap) ch = churn(prevSnap, snap);
  prevSnap = snap;
  const enc = analyzeEnclaves(world);
  const tops = topCountries(6);
  const big = tops[0];
  const era = big? eraOf(big.c.capital.knowledge||{}) : "-";
  let nSett=0; for(const s of world.settlements) if(s.mode==="settled") nSett++;
  console.log(`\n=== step ${step} ===  setts=${nSett} countries=${world.countries.size}`);
  console.log(`  largest: ${(big?big.c.capital.name:"-").padEnd(14)} tiles=${big?big.tiles:0} members=${big?big.c.members.length:0} era=${era} org=${big?(big.c.capital.knowledge.organization||0).toFixed(2):"-"}`);
  console.log(`  top-tiles: ${tops.map(t=>t.tiles).join(", ")}`);
  console.log(`  CHURN: ${ch?`${ch.flips} land tiles changed country (${(ch.frac*100).toFixed(1)}% of land) since last report`:"(first)"}`);
  console.log(`  ENCLAVES: multiComponentCountries=${enc.multiComp} exclavePieces=${enc.totalExclaves} fullyEnclosedSetts=${enc.enclosed} (total land components=${enc.nComp})`);
}

const REPORT_EVERY = parseInt(process.env.REPORT_EVERY || "2500",10);
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%REPORT_EVERY===0) report(s); }
