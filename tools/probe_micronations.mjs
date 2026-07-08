// What are the persistent 2-pixel micro-nations? For every country, report its real territory
// (tiles from _countryOwner), population, whether it is COLONY-origin (capital has a parent), its
// age, and whether it is ISOLATED (no land-adjacent foreign realm that could absorb it). Then bin
// the tiny ones so we can see: are they colonies? are they isolated? do they persist (old)?
//   node tools/probe_micronations.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 12000);
const SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 480), H = W >> 1;
const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const N = world.N, tw = world.tw, th = world.th, co = world._countryOwner, elev = world.elev;
const area = new Map(), neighborForeign = new Map();
for (let t = 0; t < N; t++) {
  const o = co[t]; if (o < 0) continue;
  area.set(o, (area.get(o) || 0) + 1);
  const ty = (t / tw) | 0, tx = t - ty * tw;
  const ns = [ty*tw+(tx===0?tw-1:tx-1), ty*tw+(tx===tw-1?0:tx+1), ty>0?t-tw:-1, ty<th-1?t+tw:-1];
  for (const nn of ns) { if (nn < 0) continue; const no = co[nn]; if (no >= 0 && no !== o && elev[nn] > 0) { let s = neighborForeign.get(o); if (!s) neighborForeign.set(o, s = new Set()); s.add(no); } }
}

const rows = [];
for (const [cid, c] of world.countries) {
  const cap = c.capital; if (!cap) continue;
  const a = area.get(cid) || 0;
  let pop = 0; for (const m of c.members) pop += (m.people || 0);
  const isColony = cap.parentSettlementId >= 0;
  const age = world.step - (cap.foundedStep || 0);
  const foreignN = (neighborForeign.get(cid) || new Set()).size;
  const org = (cap.knowledge && cap.knowledge.organization) || 0;
  const tier = cap.tier | 0;
  const foodHead = ((cap._foodSupply || 0) - (cap._foodDemand || 0)) / Math.max(1, cap._foodDemand || 1);
  rows.push({ cid, a, pop: Math.round(pop), isColony, age, foreignN, members: c.members.length, org, tier, foodHead });
}
rows.sort((x, y) => x.a - y.a);

const TINY = 6;
const tiny = rows.filter(r => r.a <= TINY);
console.log(`\n  ${W}x${H}  step ${STEPS}   ${rows.length} countries total`);
console.log(`  TINY (≤${TINY} tiles): ${tiny.length}`);
const tinyColony = tiny.filter(r => r.isColony).length;
const tinyIsolated = tiny.filter(r => r.foreignN === 0).length;
const tinyOld = tiny.filter(r => r.age > 4000).length;
console.log(`    of which colony-origin: ${tinyColony}   isolated (no foreign neighbour): ${tinyIsolated}   older than support window (>4000): ${tinyOld}`);
const ORG_MIN = 0.15;
console.log(`    of which under state-org bar (org<${ORG_MIN}): ${tiny.filter(r=>r.org<ORG_MIN).length}   tier-0: ${tiny.filter(r=>r.tier===0).length}   no food headroom (<5%): ${tiny.filter(r=>r.foodHead<0.05).length}`);
console.log(`\n  smallest 15:`);
console.log(`   tiles  pop     colony  age    fNbr  memb  org    tier  foodHead`);
for (const r of rows.slice(0, 15)) {
  const col = (r.isColony ? "yes" : "no").padEnd(6);
  console.log(`   ${String(r.a).padStart(5)}  ${String(r.pop).padStart(6)}  ${col}  ${String(r.age).padStart(5)}  ${String(r.foreignN).padStart(4)}  ${String(r.members).padStart(4)}  ${r.org.toFixed(3)}  ${r.tier}     ${(r.foodHead*100).toFixed(0)}%`);
}
