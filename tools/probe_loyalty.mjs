// Ontology V2 probe: the loyalty field + grievance ledger (loyaltyField.js).
// Measures what moving the populace's feelings onto the land actually changes:
//   • memory   — tiles remembering a fallen nation vs the roster's count;
//                assimilation flow (emergent completion vs the old flat timer)
//   • attach   — the attachment continuum's distribution: realm-core vs
//                fresh-conquest counties (the hysteresis structure V3 will
//                carve secession geometry from)
//   • cadence  — secessions, rebellions, restorations, polity lifespans,
//                country count/size (the soft gates POW_FIELD moved through)
//   • ledger   — size, biggest grievances, "old wounds" as an unrest cause
// Ends with a lever-ON determinism + save/load round-trip check (the smoke
// suite only covers defaults).
//   node tools/probe_loyalty.mjs [steps] [W] [H] [seed]
//   SIM_TUNE="LOYAL_FIELD=0,GRIEV_LEDGER=0" node tools/probe_loyalty.mjs   (the A/B)
//
// FINDINGS (480×240, 15000 steps — see git history for the calibration story):
//   (appended after the calibration runs)

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { serializeWorld, loadWorld, hashWorld } from "../src/sim/persist.js";
import { T } from "../src/sim/peopleSim/tuning.js";

// Levers default ON for this probe unless SIM_TUNE (via _harness) already set them.
if (process.env.SIM_TUNE === undefined) { T.LOYAL_FIELD = 1; T.GRIEV_LEDGER = 1; }

const STEPS = parseInt(process.argv[2] || "15000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);

const world = buildSim({ W, H, seed: SEED });
world.debug.restored = 0;

const fmt = (x, d = 2) => (x === undefined || Number.isNaN(x) ? "-" : (+x).toFixed(d));

function checkpoint(step) {
  const st = peopleSimStats(world);
  // Tile memory + attachment structure over governed land.
  const co = world._countryOwner, alg = world._allegiance, home = world._tileHomeland;
  let owned = 0, remembered = 0, aSum = 0;
  const attByAge = { fresh: [0, 0], old: [0, 0] };   // counties conquered <2500 steps ago vs the rest
  if (co && alg) {
    const capAt = world._tileCapturedAt;
    for (let ti = 0; ti < world.N; ti++) {
      if (co[ti] < 0) continue;
      owned++; aSum += alg[ti];
      if (home && home[ti] >= 0) remembered++;
      const fresh = capAt && Number.isFinite(capAt[ti]) && world.step - capAt[ti] < 2500;
      const b = fresh ? attByAge.fresh : attByAge.old;
      b[0] += alg[ti]; b[1]++;
    }
  }
  // Roster-side counts (comparable across A/B: the entity fields exist both ways).
  let occupied = 0, attachedSum = 0, attachedN = 0;
  const causes = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if ((s._homeland ?? -1) >= 0) occupied++;
    if (s._attach !== undefined) { attachedSum += s._attach; attachedN++; }
    if (s._unrestCause && (s.unrest || 0) > 0.3) causes.set(s._unrestCause, (causes.get(s._unrestCause) || 0) + 1);
  }
  // Event cadence (cumulative).
  let seceded = 0, shattered = 0;
  for (const ev of world.events) {
    if (ev.type === "polity.seceded") seceded++;
    else if (ev.type === "polity.shattered") shattered++;
  }
  // Fallen lifespans (dyn-years = steps / 4 at G=1).
  const spans = [];
  if (world.polities) for (const p of world.polities.values())
    if (p.endedStep >= 0 && p.foundedStep >= 0) spans.push((p.endedStep - p.foundedStep) / 4);
  spans.sort((a, b) => a - b);
  const g = world._natGriev;
  console.log(`step ${String(step).padStart(6)}: countries ${String(st.countries).padStart(3)}` +
    `  seceded ${String(seceded).padStart(3)}  shattered ${String(shattered).padStart(2)}  RESTORED ${world.debug.restored}` +
    `  occupied-homes ${String(occupied).padStart(3)}  remembered-tiles ${remembered}/${owned}` +
    `  attach mean ${fmt(owned ? aSum / owned : NaN)} (fresh ${fmt(attByAge.fresh[1] ? attByAge.fresh[0] / attByAge.fresh[1] : NaN)} n=${attByAge.fresh[1]}` +
    ` / old ${fmt(attByAge.old[1] ? attByAge.old[0] / attByAge.old[1] : NaN)})` +
    `  s._attach ${fmt(attachedN ? attachedSum / attachedN : NaN)}` +
    `  fallen-med ${spans.length ? fmt(spans[spans.length >> 1], 0) : "-"}dy (n=${spans.length})` +
    `  ledger ${g ? g.size : 0}`);
  if (causes.size) console.log(`         unrest>0.3 causes: ${[...causes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ":" + v).join("  ")}`);
  if (g && g.size) {
    const ref = 0.25 * Math.max(1, world._refRealmPop || 0);
    const top = [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} G=${fmt(v / (v + ref))}`);
    console.log(`         top grievances: ${top.join("  ")}  (refPop ${fmt(world._refRealmPop || 0, 0)})`);
  }
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % 3000 === 0) checkpoint(s);
}

// ── Lever-ON determinism + save/load round-trip (small grid, cheap) ────────
if (T.LOYAL_FIELD || T.GRIEV_LEDGER) {
  console.log("\n[roundtrip] lever-on determinism + save/load identity (320×160, 3000 steps)");
  const mk = () => { const w = buildSim({ W: 320, H: 160, seed: 31337 }); stepPeopleSim(w, 3000); return w; };
  const w1 = mk(), w2 = mk();
  const h1 = hashWorld(w1), h2 = hashWorld(w2);
  console.log(`  determinism: ${h1 === h2 ? "ok  " : "FAIL"} ${h1} vs ${h2}`);
  const json1 = serializeWorld(w1);
  const w3 = loadWorld(json1);
  const h3 = hashWorld(w3);
  console.log(`  save→load hash: ${h1 === h3 ? "ok  " : "FAIL"} ${h1} vs ${h3}`);
  // Continuation is TOLERANCE-gated, same contract as the smoke suite: the
  // load-warm rebuilds per-pass transients (computeTerritory reassigns
  // catchments), so a loaded world is the same world mid-breath, not a
  // frame-exact clone (persist.js header). Divergence must stay small.
  stepPeopleSim(w1, 1000); stepPeopleSim(w3, 1000);
  const tot = (w) => { let p = 0, m = 0; for (const s of w.settlements) if (s.mode === "settled") { p += s.people || 0; m += s.wealth || 0; } return { p, m }; };
  const t1 = tot(w1), t3 = tot(w3);
  const dp = Math.abs(t1.p - t3.p) / Math.max(1, t1.p) * 100, dm = Math.abs(t1.m - t3.m) / Math.max(1, t1.m) * 100;
  console.log(`  +1000-step continuation: ${dp < 8 && dm < 8 ? "ok  " : "FAIL"} pop ${dp.toFixed(1)}%, wealth ${dm.toFixed(1)}% drift`);
}
