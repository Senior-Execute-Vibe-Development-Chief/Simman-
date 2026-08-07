// WHY is each realm the size it is? For every living realm at the end step:
//   held vs target (world.debug.fpPass — the territory pass's own ledger),
//   frontier state (does ANY of its border touch unclaimed land it could grow into),
//   seat hold (terrainHoldAt at the capital tile), age, members.
// Classifies each realm's binding constraint:
//   TARGET  — held ≥ ~95% of target: the size the capacity/pop ruler grants is the size it is
//   HEMMED  — under target but its land border touches no unclaimed land (neighbours/sea wall it)
//   GROWING — under target with open frontier (still on its way; a transient)
// The size-spectrum question is which class the SMALL realms sit in: a real small-state
// regime holds small realms in TARGET/HEMMED (structural); a transient-of-youth regime
// holds them in GROWING only.
//   node tools/probe_whysize.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { terrainHoldAt } from "../src/sim/peopleSim/transport.js";

const STEPS = +(process.argv[2] || 12000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const { N, tw, th, elev } = world;
let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
const km2 = (510e6 * 0.29) / landN;
const co = world._countryOwner;
const tiles = new Map(), openFrontier = new Map();
for (let ti = 0; ti < N; ti++) {
  const c = co[ti]; if (c < 0 || elev[ti] <= 0) continue;
  tiles.set(c, (tiles.get(c) || 0) + 1);
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  const ns = [ty * tw + ((tx + 1) % tw), ty * tw + ((tx - 1 + tw) % tw), ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
  for (const ni of ns) if (ni >= 0 && elev[ni] > 0 && co[ni] < 0) { openFrontier.set(c, (openFrontier.get(c) || 0) + 1); break; }
}
const ht = (world.debug && world.debug.fpPass && world.debug.fpPass.ht) || {};
const rows = [];
for (const [cid, t] of tiles) {
  const cc = world.countries && world.countries.get(cid);
  const cap = cc && cc.capital;
  const p = world.polities && world.polities.get(cid);
  const pair = ht[cid];
  const held = pair ? pair[0] : -1, target = pair ? pair[1] : -1;
  const open = openFrontier.get(cid) || 0;
  const cls = target > 0 && held >= 0.95 * target ? "TARGET" : open === 0 ? "HEMMED" : "GROWING";
  const capTi = cap ? (cap.pos.y | 0) * tw + (cap.pos.x | 0) : -1;
  rows.push({
    cid, t, km2: Math.round(t * km2 / 1000), held: Math.round(held), target: Math.round(target), open, cls,
    hold: capTi >= 0 ? terrainHoldAt(world, capTi, (cap.knowledge && cap.knowledge.construction) || 0) : 1,
    age: p ? world.step - p.foundedStep : -1, mem: (cc && cc.members.length) || 0,
  });
}
rows.sort((a, b) => a.t - b.t);
const by = { TARGET: 0, HEMMED: 0, GROWING: 0 };
for (const r of rows) by[r.cls]++;
console.log(`\n${W}x${H} seed ${SEED} step ${STEPS}: ${rows.length} realms — TARGET ${by.TARGET} · HEMMED ${by.HEMMED} · GROWING ${by.GROWING}`);
const small = rows.filter(r => r.km2 < 300);
console.log(`smallest third (<300k km2): ${small.length} — ${["TARGET", "HEMMED", "GROWING"].map(k => `${k} ${small.filter(r => r.cls === k).length}`).join(" · ")}`);
console.log(`\n   tiles   km2   held/target   openFr  class    hold  age    mem`);
for (const r of rows.slice(0, 20))
  console.log(`   ${String(r.t).padStart(5)}  ${String(r.km2).padStart(4)}k  ${String(r.held).padStart(5)}/${String(r.target).padEnd(6)}  ${String(r.open).padStart(5)}  ${r.cls.padEnd(8)} ${r.hold.toFixed(2)}  ${String(r.age).padStart(5)}  ${r.mem}`);
console.log(`   …top 5:`);
for (const r of rows.slice(-5))
  console.log(`   ${String(r.t).padStart(5)}  ${String(r.km2).padStart(4)}k  ${String(r.held).padStart(5)}/${String(r.target).padEnd(6)}  ${String(r.open).padStart(5)}  ${r.cls.padEnd(8)} ${r.hold.toFixed(2)}  ${String(r.age).padStart(5)}  ${r.mem}`);
