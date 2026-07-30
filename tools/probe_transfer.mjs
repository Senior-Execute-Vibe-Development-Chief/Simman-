import { buildSim } from "/home/user/Simman-/tools/_harness.mjs";
import { stepPeopleSim } from "/home/user/Simman-/src/sim/peopleSim/index.js";
const W=+(process.argv[2]), H=W>>1, STEPS=+(process.argv[3]||12000), CK=+(process.argv[4]||1000);
const w=buildSim({W,H,seed:8817});
let prev=new Map(), transfers=0, toWild=0, fromWild=0;
const snap=()=>{const m=new Map(); for(const s of w.settlements) if(s.mode==="settled") m.set(s.id, s.countryId); return m;};
prev=snap();
for(let t=CK;t<=STEPS;t+=CK){
  stepPeopleSim(w,CK);
  const cur=snap(); let tr=0;
  const live=new Set(w.countries?[...w.countries.keys()]:[]);
  for(const [id,c] of cur){ const p=prev.get(id); if(p===undefined) continue; if(p!==c){ if(p>=0&&c>=0) {tr++; transfers++;} else if(c<0) toWild++; else fromWild++; } }
  prev=cur;
  if(t%3000===0) console.log(`step ${String(t).padStart(5)}: settlementsChangingFlag(realm->realm)=${tr} cumulative=${transfers} (lost-to-stateless=${toWild} gained-from-stateless=${fromWild}) realms=${live.size}`);
}
