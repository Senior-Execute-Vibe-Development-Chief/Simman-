import { stepToYear } from "/home/user/Simman-/src/sim/calendar.js";
import { buildSim } from "/home/user/Simman-/tools/_harness.mjs";
import { stepPeopleSim } from "/home/user/Simman-/src/sim/peopleSim/index.js";
const W=+(process.argv[2]||960), H=W>>1, STEPS=+(process.argv[3]||20000), CK=+(process.argv[4]||1000);
const w=buildSim({W,H,seed:+(process.argv[5]||8817)});
let land=0; for(let i=0;i<w.elev.length;i++) if(w.elev[i]>0) land++;
const kkm2=(510e6*0.29)/land/1000;              // thousand km2 per tile
const yr=s=>{const y=Math.round(stepToYear(s)); return y<0?`${-y}BC`:`${y}AD`;};
console.log(`grid tw=${w.tw}  ${Math.round(kkm2)}k km2/tile`);
console.log("step\tyear\trealms\tclaim%\tmed(k km2)\tp90\tmax\tblob?");
let firstStates=null, phaseEnd=null;
const BLOB_MED = 250;                            // k km2 — below this the TYPICAL realm is not a state-sized polity
for(let t=CK;t<=STEPS;t+=CK){
  stepPeopleSim(w,CK);
  const co=w._countryOwner, m=new Map(); let cl=0;
  for(let i=0;i<co.length;i++){ if(!(w.elev[i]>0))continue; const c=co[i]; if(c>=0){cl++;m.set(c,(m.get(c)||0)+1);} }
  const s=[...m.values()].sort((a,b)=>a-b);
  const q=f=>(s[Math.floor(s.length*f)]||0)*kkm2;
  const med=q(0.5), p90=q(0.9), max=(s[s.length-1]||0)*kkm2, n=s.length;
  if(firstStates===null && n>=3) firstStates=t;
  const blob = n>=3 && med<BLOB_MED;
  if(firstStates!==null && phaseEnd===null && n>=3 && med>=BLOB_MED) phaseEnd=t;
  console.log(`${t}\t${yr(t)}\t${n}\t${(100*cl/land).toFixed(2)}\t${Math.round(med)}\t${Math.round(p90)}\t${Math.round(max)}\t${blob?"BLOB":""}`);
}
console.log(`\nSUMMARY firstStates=${firstStates} (${firstStates!==null?yr(firstStates):"-"})  phaseEnd=${phaseEnd===null?"NEVER within "+STEPS:phaseEnd+" ("+yr(phaseEnd)+")"}  blobPhase=${phaseEnd!==null&&firstStates!==null?(phaseEnd-firstStates)+" steps":">"+(STEPS-(firstStates||0))+" steps"}`);
