// The genesis-arc probe: where and WHEN does civilization start, under any
// dawn regime. The standing gates pin DAWN_LIVE=0 and STATE_RECORDS=0 (mature-
// regime measurement); this probe is the LIVE arm's instrument — run it with
// the app's shipped regime to verify what the player actually sees:
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1" node tools/probe_genesis.mjs [W] [steps] [seed]
// Prints farming inventions, the first settlements, the first polities and the
// era arrival steps, all with lon/lat, so "does the first state rise on the
// Nile, with the tablet, as the era turns Bronze?" is read straight off.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), STEPS = +(process.argv[3] || 16000), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const { tw, th } = world;
const geo = (x, y) => `(${(x / tw * 360 - 180).toFixed(1)}E ${(90 - y / th * 180).toFixed(1)}N)`;
// Checkpointed run: watch the LAND LEDGER arc (T.LAND_KNOW) climb toward the
// tallies/writing bars alongside the entity milestones, in eighths.
const CHUNKS = 8;
console.log(`--- arc (step | ledgers | lkOrg lkMet lkCon | settled realms):`);
for (let c = 0; c < CHUNKS; c++) {
  stepPeopleSim(world, Math.round(STEPS / CHUNKS));
  let recs = 0, mo = 0, mm = 0, mc = 0;
  if (world._landKnow) for (const r of world._landKnow.values()) {
    recs++;
    if (r.k.organization > mo) mo = r.k.organization;
    if (r.k.metallurgy > mm) mm = r.k.metallurgy;
    if (r.k.construction > mc) mc = r.k.construction;
  }
  const settled = world.settlements.filter((s) => s.mode === "settled").length;
  console.log(`   ${String(world.step).padStart(6)} | ${String(recs).padStart(4)} | ${mo.toFixed(3)} ${mm.toFixed(3)} ${mc.toFixed(3)} | ${settled} ${world.countries ? world.countries.size : 0}`);
}
const evs = world.events || [];
const byId = world._byId;
const posOf = (ev) => {
  if (ev.x != null) return geo(ev.x, ev.y);
  const s = ev.s != null && byId ? byId.get(ev.s) : null;
  return s ? geo(s.pos.x | 0, s.pos.y | 0) : "(?)";
};
console.log(`=== step ${world.step} tw=${tw} seed ${SEED}`);
console.log(`-- eraAt (era index -> step reached):`, JSON.stringify(world._eraAt || null));
for (const t of ["farming.invented", "settlement.founded"]) {
  const list = evs.filter((e) => e.type === t).slice(0, 12);
  console.log(`-- first ${list.length} ${t}:`);
  for (const e of list) console.log(`   step ${e.step}  ${e.sName || e.name || ""} ${posOf(e)}`);
}
// Polities split by kind: tribal land-nations are the (ungated) chiefdom
// fabric; COUNTRIES are the bordered, war-waging states the records bar gates.
for (const [label, pred] of [["tribal (chiefdom fabric)", (e) => e.how === "tribal"], ["STATES (countries)", (e) => e.how !== "tribal"]]) {
  const list = evs.filter((e) => e.type === "polity.founded" && pred(e)).slice(0, 10);
  console.log(`-- first ${list.length} polity.founded ${label}:`);
  for (const e of list) console.log(`   step ${e.step}  how=${e.how}  ${e.name || e.seatName || ""} ${posOf(e)}`);
}
// The land ledger's leaders (T.LAND_KNOW): where the countryside is learning
// fastest, and whether the material ladder (exchange-sphere ore → orgEraCap)
// is open at the cradles — the campaign's main stall risk.
if (world._landKnow && world._landKnow.size) {
  const rows = [...world._landKnow.values()].sort((a, b) => b.k.organization - a.k.organization).slice(0, 8);
  console.log(`-- land ledgers: ${world._landKnow.size} (top by organization):`);
  for (const r of rows) {
    const y = (r.ti / tw) | 0, x = r.ti - y * tw;
    const ore = r.ore || {};
    console.log(`   ${geo(x, y)} org=${r.k.organization.toFixed(3)} agri=${r.k.agriculture.toFixed(2)} con=${r.k.construction.toFixed(2)} met=${r.k.metallurgy.toFixed(2)} ore(cu=${(ore.copper || 0).toFixed(2)} sn=${(ore.tin || 0).toFixed(2)} fe=${(ore.iron || 0).toFixed(2)}) wa=${(r.wa || 0).toFixed(2)} born=${r.born}`);
  }
}
const realms = [...(world.countries ? world.countries.values() : [])].slice(0, 10);
console.log(`-- realms now: ${world.countries ? world.countries.size : 0}`);
// Per-realm anatomy: the polity record's founding kind, bordered-field tiles
// (_countryOwner), and land-nation ground (_landOwner) — distinguishes a
// STATE (bordered co field) from a chiefdom holding ground from a mislabel.
const coT = new Map(), loT = new Map();
if (world._countryOwner) for (let i = 0; i < world.N; i++) { const c = world._countryOwner[i]; if (c >= 0) coT.set(c, (coT.get(c) || 0) + 1); }
if (world._landOwner) for (let i = 0; i < world.N; i++) { const c = world._landOwner[i]; if (c >= 0) loT.set(c, (loT.get(c) || 0) + 1); }
for (const c of realms) {
  const seat = c.members && c.members[0];
  const pol = world.polities ? world.polities.get(c.id) : null;
  const how = pol && pol.foundedHow !== undefined ? pol.foundedHow : (pol && pol.how) || "?";
  if (seat) console.log(`   ${c.name || c.id} seat ${seat.name} ${geo(seat.pos.x | 0, seat.pos.y | 0)} members=${c.members.length} how=${how} coTiles=${coT.get(c.id) || 0} landTiles=${loT.get(c.id) || 0} seatOrg=${(((seat.knowledge || {}).organization) || 0).toFixed(2)}`);
}
