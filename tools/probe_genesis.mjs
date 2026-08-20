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
stepPeopleSim(world, STEPS);
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
