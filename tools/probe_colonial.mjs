// The colonial arc instrument (atlas-gap cause III, maritime half): the whole
// pipeline is BUILT — sea.js mints self-governing dependencies, conquest.js
// wires the bond (colony.founded), grants power-ratio independence
// (colony.independent), and the atlas paints blocs through pol._overlord —
// but pre-SEA_DEMAND it was structurally dead (navigation stalled at 0.57,
// "flight before the compass"). This measures whether the arc FIRES now:
//   - navigation maturity (max, and port counts past the galleys/ocean gates)
//   - colonies: live _isColony settlements, split HOME-landmass vs OVERSEAS
//     (landmass = connected land component; overseas = a different one than
//     the metropole's capital — the one-color-spanning-an-ocean gestalt)
//   - live colonial bonds (polities with _depKind "colony") and the largest
//     colonial empire (metropole + dependency count)
//   - cumulative colony.founded / colony.independent / colony.inherited
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_colonial.mjs [steps] [W] [seed] [ivl]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";

const STEPS = +(process.argv[2] || 40000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const IVL = +(process.argv[5] || 5000);
const world = buildSim({ W, H, seed: SEED });
telEnable(world);   // arm the sea funnel (tel "sea" — sea.js expedition/charter decisions)

// Connected land components (4-neighbour, x-wrap) — the probe's landmass ids.
let landOf = null;
function landmass() {
  const { tw, th, N, elev } = world;
  const lm = new Int32Array(N).fill(-1);
  let next = 0;
  const q = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (lm[s0] >= 0 || !(elev[s0] > 0)) continue;
    const id = next++;
    let qh = 0, qn = 0; q[qn++] = s0; lm[s0] = id;
    while (qh < qn) {
      const ti = q[qh++];
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      for (const ni of ns) if (ni >= 0 && lm[ni] < 0 && elev[ni] > 0) { lm[ni] = id; q[qn++] = ni; }
    }
  }
  return lm;
}
const lmAt = (s) => landOf[(s.pos.y | 0) * world.tw + (s.pos.x | 0)];

let lastEv = -1;
const cum = { founded: 0, subjugated: 0, independent: 0, vassalFreed: 0, inherited: 0 };
function tallyEvents() {
  for (const e of world.events || []) {
    if (e.id <= lastEv) continue;
    lastEv = e.id;
    if (e.type === "colony.founded") cum.founded++;
    else if (e.type === "colony.subjugated") cum.subjugated++;
    else if (e.type === "colony.independent") {
      // kind rides the event (conquest.js): a freed COLONY is the decolonization
      // arc; a freed submitted vassal is ordinary suzerainty churn. Un-annotated
      // events (pre-fix logs) count as vassal churn — the colonial count stays honest.
      if (e.kind === "colony") cum.independent++; else cum.vassalFreed++;
    } else if (e.type === "colony.inherited") cum.inherited++;
  }
}

function report(step) {
  if (!landOf) landOf = landmass();
  tallyEvents();
  let navMax = 0, galleys = 0, ocean = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const nv = (s.knowledge && s.knowledge.navigation) || 0;
    if (nv > navMax) navMax = nv;
    if (nv >= 0.60) galleys++;
    if (nv >= 0.88) ocean++;
  }
  // capitals by country for landmass comparison
  const capOf = new Map();
  if (world.countries) for (const [cid, c] of world.countries) if (c.capital) capOf.set(cid, c.capital);
  let colLive = 0, colOverseas = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s._isColony) continue;
    colLive++;
    const pol = getPolity(world, s.countryId);
    const over = pol && pol._overlord != null ? pol._overlord : -1;
    const homeCap = over >= 0 ? capOf.get(over) : null;
    if (homeCap && lmAt(s) !== lmAt(homeCap)) colOverseas++;
  }
  // Colonial BONDS from the polity records (covers planted colonies AND
  // subjugated protectorates — the latter have no _isColony settlement).
  const bonds = new Map();   // metropole → {deps, overseas}
  if (world.countries) for (const [cid, c] of world.countries) {
    const pol = getPolity(world, cid);
    if (!pol || pol._overlord == null || pol._depKind !== "colony" || !c.capital) continue;
    const homeCap = capOf.get(pol._overlord);
    const overseas = homeCap ? lmAt(c.capital) !== lmAt(homeCap) : false;
    let e = bonds.get(pol._overlord); if (!e) bonds.set(pol._overlord, e = { deps: 0, overseas: 0 });
    e.deps++; if (overseas) e.overseas++;
  }
  let topM = -1, topD = 0, topO = 0;
  for (const [m, e] of bonds) if (e.deps > topD) { topD = e.deps; topO = e.overseas; topM = m; }
  console.log(`t=${step} navMax=${navMax.toFixed(2)} ports(galleys/ocean)=${galleys}/${ocean} ` +
    `colonies=${colLive}(overseas ${colOverseas}) metropoles=${bonds.size} top=#${topM}:${topD}dep(${topO}os) ` +
    `founded=${cum.founded} subjugated=${cum.subjugated} indep=${cum.independent} vassalFreed=${cum.vassalFreed} inherited=${cum.inherited}`);
  // The sea + protectorate funnels over THIS window (reset after print).
  const rep = telReport(world);
  for (const ch of ["sea", "protectorate"]) {
    const f = rep[ch] || {};
    console.log(`    ${ch}Funnel: ${Object.entries(f).map(([k, v]) => `${k}=${v}`).join(" ") || "(silent)"}`);
  }
  telReset(world);
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % 500 === 0) tallyEvents();          // outrun event-log compaction
  if (s % IVL === 0) report(s);
}
