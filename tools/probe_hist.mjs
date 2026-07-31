import { buildSim } from "/home/user/Simman-/tools/_harness.mjs";
import { stepPeopleSim } from "/home/user/Simman-/src/sim/peopleSim/index.js";
const W=480,H=240,STEPS=+(process.argv[2]||9000);
const w=buildSim({W,H,seed:8817});
let land=0; for(let i=0;i<w.elev.length;i++) if(w.elev[i]>0) land++;
const kkm2=(510e6*0.29)/land/1000;
stepPeopleSim(w,STEPS);
const co=w._countryOwner, m=new Map(); let cl=0;
for(let i=0;i<co.length;i++){ if(!(w.elev[i]>0))continue; const c=co[i]; if(c>=0){cl++;m.set(c,(m.get(c)||0)+1);} }
const s=[...m.values()].sort((a,b)=>b-a);
const med=s[s.length>>1]||0;
console.log(`RESULT realms=${s.length} claimed=${(100*cl/land).toFixed(2)}% med=${med}t(${Math.round(med*kkm2)}k km2) max=${s[0]||0}t(${Math.round((s[0]||0)*kkm2)}k km2)`);
