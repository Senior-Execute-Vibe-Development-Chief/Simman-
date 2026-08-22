// Consolidation verdict probe: funnel + realm-death ages + BLOC STATS — the
// owner-facing numbers (the atlas paints suzerainty blocs as single nations,
// so bloc count / bloc size / bloc area are what the screen shows).
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,WAR_FINISH=1,ABSORB_ORG_ERA=1,TRIBUTE_UP=0.33,ENGULF=8,FEAR_REACH=1,SMALL_WAR=8,RELIEF_REACH=1" \
//     node tools/probe_statefunnel.mjs [steps] [W] [seed]
// Ladder measured with it (tw=480/28k/8817, docs/consolidation-2026-08-20.md):
//   bala 529 painted / 26-realm 1.54Mkm2 bloc → engulf 448 / 13 → fear 492 / 34 /
//   1.73M → full predation stack 440 / 38 / 2.07M.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";

const STEPS = +(process.argv[2] || 28000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 4000;

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2 = (510e6 * 0.29) / landN;
let evSeen = -1;

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  const countries = world.countries || new Map();
  let cities = 0, stateless = 0;
  const census = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    cities++;
    if (s.countryId < 0) stateless++;
    census.push(s.people || 0);
  }
  // The 12k-pile measurement (owner: "its almost all those 12k people slop
  // cities"): how much of the register still sits at the birth bar?
  census.sort((a, b) => a - b);
  const cq = (p) => census.length ? census[Math.min(census.length - 1, Math.floor(p * census.length))] : 0;
  const birthBand = census.filter(v => v >= 9 && v <= 15).length;
  const memberN = [];
  let singles = 0;
  for (const c of countries.values()) {
    const n = c.members.filter(m => m.mode === "settled").length;
    if (!n) continue;
    memberN.push(n);
    if (n === 1) singles++;
  }
  const ov = world._overlordOf || new Map();
  const rootOf = (id) => { let cur = id, hops = 0; while (hops++ < 12) { const o = ov.get(cur); if (o == null || o < 0 || o === cur) break; cur = o; } return cur; };
  const blocRealms = new Map();
  for (const c of countries.values()) {
    if (!c.members.some(m => m.mode === "settled")) continue;
    const r = rootOf(c.id);
    blocRealms.set(r, (blocRealms.get(r) || 0) + 1);
  }
  const co = world._countryOwner;
  const blocTiles = new Map();
  if (co) for (let i = 0; i < co.length; i++) { const id = co[i]; if (id >= 0) { const r = rootOf(id); blocTiles.set(r, (blocTiles.get(r) || 0) + 1); } }
  const bSizes = [...blocRealms.values()].sort((a, b) => b - a);
  const bAreas = [...blocTiles.values()].map(t => t * km2).sort((a, b) => b - a);
  const totArea = bAreas.reduce((x, y) => x + y, 0);
  const deaths = { n: 0, young: 0 };
  for (const ev of world.events || []) {
    if (ev.id <= evSeen) continue;
    if (ev.type !== "polity.ended" && ev.type !== "polity.shattered") continue;
    deaths.n++;
    const pol = world.polities ? world.polities.get(ev.polity) : null;
    if (pol && ev.step - (pol.foundedStep || 0) < 500) deaths.young++;
  }
  { const evs = world.events || []; if (evs.length) evSeen = evs[evs.length - 1].id; }
  console.log(`\n=== step ${world.step}  cities=${cities} (stateless ${(100 * stateless / Math.max(1, cities)).toFixed(0)}%)  realms=${memberN.length} (singl ${(100 * singles / Math.max(1, memberN.length)).toFixed(0)}%)  bonds=${ov.size}  deaths=${deaths.n} (young ${deaths.young})`);
  console.log(`    census(sim-units): p10=${cq(0.1).toFixed(0)} p50=${cq(0.5).toFixed(0)} p90=${cq(0.9).toFixed(0)} max=${cq(1).toFixed(0)}  birthBand(9-15)=${(100 * birthBand / Math.max(1, cities)).toFixed(0)}%`);
  console.log(`    BLOCS: ${blocRealms.size} nations-as-painted  biggest: ${bSizes[0] || 0} realms / ${((bAreas[0] || 0) / 1e6).toFixed(2)}Mkm2 (${totArea > 0 ? (100 * (bAreas[0] || 0) / totArea).toFixed(0) : 0}% of claimed)  top5=${bSizes.slice(0, 5).join(",")}`);
  const tr = telReport(world);
  if (tr.submit) console.log(`    submit: ` + Object.entries(tr.submit).map(([k, v]) => `${k}=${v}`).join("  "));
  if (tr.integrate) console.log(`    integrate: ` + Object.entries(tr.integrate).map(([k, v]) => `${k}=${v}`).join("  ").slice(0, 220));
  // The STATEHOOD side (the 94%-stateless shipping-grid screenshot): why do
  // cities not acquire nations — birth lane, land-nation exam, peer seats.
  for (const ch of ["birthPolity", "landNation", "peerSeat", "siteCity", "fission"]) {
    if (tr[ch]) console.log(`    ${ch}: ` + Object.entries(tr[ch]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ").slice(0, 220));
  }
  telReset(world);
}
