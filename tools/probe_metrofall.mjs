// Staged verification of the metropole-fall resolution (Tier-B4): when a
// colony's metropole ENDS, the dependency must (a) PASS TO THE RECORDED
// SUCCESSOR where the registry has one (recordSuccessor at the shatter),
// (b) go INDEPENDENT (how=metropole-fell) when no living heir exists — and
// never be silently dropped by a transient absence from the live view.
//
// Organic colony-holding-metropole deaths are rare inside a probe horizon, so
// this STAGES the two deterministic scenarios on a real evolved world: run
// until a bound colony exists, then shatter its metropole via the real
// fragmentRealm — once with a surviving member (succession), once without
// (liberation) — and read the events the next polity passes produce.
//
//   SIM_TUNE="LEARN_BASE=0.00003" node tools/probe_metrofall.mjs [maxSteps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { fragmentRealm } from "../src/sim/peopleSim/conquest.js";

const MAX = parseInt(process.argv[2] || "14000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });

// 1. Run until at least TWO wired colony dependencies exist (or MAX).
const boundColonies = () => {
  const out = [];
  if (world.polities) for (const [id, p] of world.polities) {
    if (p.endedStep < 0 && p._overlord != null && p._depKind === "colony") out.push([id, p._overlord]);
  }
  return out;
};
let bc = [];
let step = 0;
for (; step < MAX; step++) {
  stepPeopleSim(world, 1);
  if (step % 200 === 0) { bc = boundColonies(); if (bc.length >= 2) break; }
}
bc = boundColonies();
console.log(`step ${world.step}: bound colonies ${bc.length} — ${bc.map(([c, o]) => `${c}→${o}`).join(" ")}`);
if (bc.length < 1) { console.log("NO bound colony evolved within the horizon — staged test not run"); process.exit(0); }

const evCount = { inherited: 0, fell: 0, other: 0 };
let evCursor = (world.events || []).length;
function drain(label) {
  const evs = world.events || [];
  for (; evCursor < evs.length; evCursor++) {
    const ev = evs[evCursor];
    if (ev.type === "colony.inherited") { evCount.inherited++; console.log(`  [${label}] colony.inherited: colony ${ev.polity} from ${ev.from} -> to ${ev.to}`); }
    else if (ev.type === "colony.independent") { if (ev.how === "metropole-fell") evCount.fell++; console.log(`  [${label}] colony.independent (${ev.how || "earned"}): colony ${ev.polity} from ${ev.from}`); }
  }
}
const runPasses = (n) => { for (let i = 0; i < n; i++) stepPeopleSim(world, 1); };

// 2. SCENARIO A — succession: give the metropole a second member, then storm it.
//    fragmentRealm's lone-survivor branch records succId; the colony must follow.
{
  const [colonyId, metroId] = bc[0];
  const metro = world.countries && world.countries.get(metroId);
  if (metro && metro.capital) {
    const K = metro.capital;
    let S2 = null;
    for (const s of world.settlements) {
      if (s.mode === "settled" && s.id !== K.id && s.id !== metroId && s.countryId !== metroId && s.countryId === s.id && s.id !== colonyId) { S2 = s; break; }
    }
    if (S2) {
      console.log(`\nSCENARIO A (succession): metropole ${metroId} (capital ${K.id}) of colony ${colonyId}; drafting ${S2.id} as second member, then shattering`);
      S2.countryId = metroId;              // a second member so the shatter leaves a survivor
      K.countryId = -1;                    // the stormed throne-city leaves the realm (as conquest does before calling)
      fragmentRealm(world, metroId, K.id, "succession");
      const dead = getPolity(world, metroId);
      console.log(`  registry: metropole endedStep=${dead ? dead.endedStep : "?"} succId=${dead ? dead.succId : "?"}`);
      runPasses(700);                      // > POLITY_INTERVAL passes: resolution + settling
      drain("A");
      const colPol = getPolity(world, colonyId);
      console.log(`  colony ${colonyId} overlord now: ${colPol ? colPol._overlord : "?"} (expected the successor ${dead ? dead.succId : "?"} — or a later resolution if the heir itself changed)`);
    } else console.log("SCENARIO A skipped: no draftable second member found");
  }
}

// 3. SCENARIO B — liberation: a metropole with no other member falls; no heir.
bc = boundColonies();
{
  const pair = bc.find(([, o]) => { const c = world.countries && world.countries.get(o); return c && c.members.length === 1; }) || bc[0];
  if (pair) {
    const [colonyId, metroId] = pair;
    const metro = world.countries && world.countries.get(metroId);
    if (metro && metro.capital) {
      const K = metro.capital;
      console.log(`\nSCENARIO B (liberation): metropole ${metroId} (members ${metro.members.length}) of colony ${colonyId}; capital lapses, realm shatters with no survivor`);
      for (const m of metro.members) m.countryId = -1;   // every member gone (sack + lapse) — no survivor, no heir
      fragmentRealm(world, metroId, K.id);
      const dead = getPolity(world, metroId);
      console.log(`  registry: metropole endedStep=${dead ? dead.endedStep : "?"} succId=${dead ? dead.succId : "?"}`);
      runPasses(700);
      drain("B");
      const colPol = getPolity(world, colonyId);
      console.log(`  colony ${colonyId} overlord now: ${colPol ? colPol._overlord : "?"} (expected undefined = independent, unless the ground restored the metropole — in which case the bond legitimately continues)`);
    }
  } else console.log("SCENARIO B skipped: no bound colony left");
}

console.log(`\nevents seen: inherited=${evCount.inherited} metropole-fell=${evCount.fell}`);
