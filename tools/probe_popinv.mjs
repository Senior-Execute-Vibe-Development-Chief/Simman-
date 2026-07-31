import { buildSim } from "/home/user/Simman-/tools/_harness.mjs";
import { stepPeopleSim } from "/home/user/Simman-/src/sim/peopleSim/index.js";
const W=+(process.argv[2]), H=W>>1, SEED=+(process.argv[4]||8817);
const cks=(process.argv[3]||"0,2000,6000").split(",").map(Number);
const world=buildSim({W,H,seed:SEED});
let land=0; for(let i=0;i<world.elev.length;i++) if(world.elev[i]>0) land++;
const sum=(a)=>{let s=0; if(!a)return 0; for(let i=0;i<world.elev.length;i++) if(world.elev[i]>0) s+=a[i]||0; return s;};
let prev=0;
for(const ck of cks){
  if(ck>prev){ stepPeopleSim(world, ck-prev); prev=ck; }
  const pop=sum(world.popField), cap=sum(world.capField), dev=sum(world.devField)/land;
  let cen=0,n=0; for(const s of world.settlements) if(s.mode==="settled"){cen+=s.people;n++;}
  console.log(`tw=${world.tw} land=${land} step=${ck}: Σpop=${(pop/1e6).toFixed(2)}M Σcap=${(cap/1e6).toFixed(2)}M pop/cap=${(pop/Math.max(1,cap)).toFixed(3)} meanDev=${dev.toFixed(3)} setts=${n} census=${Math.round(cen)}`);
}
