import { buildSim } from "/home/user/Simman-/tools/_harness.mjs";
import { stepPeopleSim } from "/home/user/Simman-/src/sim/peopleSim/index.js";
const W=+(process.argv[2]||960), H=W>>1, STEPS=+(process.argv[3]||12000), SEED=+(process.argv[4]||8817), CK=+(process.argv[5]||2000);
const world=buildSim({W,H,seed:SEED});
let land=0; for(let i=0;i<world.elev.length;i++) if(world.elev[i]>0) land++;
const kkm2=(510e6*0.29)/land/1000;
console.log(`grid tw=${world.tw} land=${land} tiles  (~${Math.round(kkm2)}k km2/tile)`);
for(let t=CK;t<=STEPS;t+=CK){
  stepPeopleSim(world, CK);
  const co=world._countryOwner, m=new Map(); let cl=0;
  for(let i=0;i<co.length;i++){ if(!(world.elev[i]>0))continue; const c=co[i]; if(c>=0){cl++;m.set(c,(m.get(c)||0)+1);} }
  const s=[...m.values()].sort((a,b)=>b-a);
  let agri=0; for(const x of world.settlements) if(x.mode==="settled"&&x.knowledge) agri=Math.max(agri,x.knowledge.agriculture||0);
  console.log(`step ${String(t).padStart(6)}: realms=${String(s.length).padStart(3)} claimed=${(100*cl/land).toFixed(2)}% max=${String(s[0]||0).padStart(4)}t(${Math.round((s[0]||0)*kkm2)}k km2) med=${String(s[s.length>>1]||0).padStart(3)}t  leadAgri=${agri.toFixed(3)}`);
}
