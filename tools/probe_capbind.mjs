// Which anti-runaway caps actually BIND in the post-balance world? A cap that
// never clamps isn't the operative constraint — the balance-of-power brake is.
// Reports, at late game: the dominance distribution vs CAP_DOM_MAX, how many
// realms sit at/near the dominance ceiling, and the top realms' members/territory.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });
for (let i = 1; i <= STEPS; i++) stepPeopleSim(world, 1);

const doms = [];
for (const c of world.countries.values()) {
  if (!c.members || c.members.length <= 1) continue;
  doms.push({ id: c.id, dom: c._dominance || 1, cap: c._capacity || 0, load: c._loadTotal || 0,
              mem: c.members.filter(s => s.mode === "settled" && s.countryId === c.id).length });
}
doms.sort((a, b) => b.dom - a.dom);
console.log(`CAP_DOM_MAX=${T.CAP_DOM_MAX}  (dominance ceiling)`);
const atCeil = doms.filter(d => d.dom >= T.CAP_DOM_MAX * 0.98).length;
console.log(`realms at/near dominance ceiling: ${atCeil}/${doms.length}`);
console.log('\ntop realms by dominance:  dom    cap   loadTotal  load/cap  members');
for (const d of doms.slice(0, 8)) {
  console.log(`  cid ${String(d.id).padStart(3)}   ${d.dom.toFixed(2).padStart(6)}  ${d.cap.toFixed(1).padStart(6)}  ${d.load.toFixed(1).padStart(7)}    ${(d.load/Math.max(1,d.cap)).toFixed(2)}     ${d.mem}`);
}
console.log('\nload/cap ~1 means the realm sits right at its administrative budget (over-extension is the active brake).');
console.log('dom << CAP_DOM_MAX everywhere means the dominance ceiling is NOT binding (safe-ish to widen/remove).');
