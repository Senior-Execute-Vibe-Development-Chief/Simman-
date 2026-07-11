// Regional development field probe (T.DEV_FIELD, popField.js): does capacity
// reading the LOCAL technique — the Neolithic wave of advance — produce the
// civilized-core vs subsistence-frontier density contrast, without breaking
// the consumers that read the population field (national power, governed
// capacity, the nomad revival, the grievance reference)?
//   node tools/probe_devfield.mjs [steps] [W] [H] [seed]
//   SIM_TUNE="DEV_FIELD=0" node tools/probe_devfield.mjs      (the A/B)
// Ends with a lever-ON determinism + save/load round-trip check.
//
// FINDINGS (480×240, 15000 steps — appended after the calibration runs):

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { serializeWorld, loadWorld, hashWorld } from "../src/sim/persist.js";
import { popFieldTotal } from "../src/sim/peopleSim/popField.js";
import { T } from "../src/sim/peopleSim/tuning.js";

if (process.env.SIM_TUNE === undefined) T.DEV_FIELD = 1;

const STEPS = parseInt(process.argv[2] || "15000", 10);
const W = parseInt(process.argv[3] || "480", 10), H = parseInt(process.argv[4] || "240", 10);
const SEED = parseInt(process.argv[5] || "8817", 10);

const world = buildSim({ W, H, seed: SEED });
const fmt = (x, d = 2) => (+x).toFixed(d);

function checkpoint(step) {
  const st = peopleSimStats(world);
  const df = world.devField, co = world._countryOwner, pf = world.popField, elev = world.elev, fert = world.fert;
  // Density + technique, owned realm land vs the stateless wilderness — and
  // per unit of FERTILITY, so the contrast isn't just "states sit on good land".
  let oP = 0, oF = 0, oN = 0, wP = 0, wF = 0, wN = 0, oD = 0, wD = 0;
  if (pf && co) for (let i = 0; i < world.N; i++) {
    if (!(elev[i] > 0) || !(fert[i] > 0.03)) continue;
    if (co[i] >= 0) { oP += pf[i]; oF += fert[i]; oN++; if (df) oD += df[i]; }
    else { wP += pf[i]; wF += fert[i]; wN++; if (df) wD += df[i]; }
  }
  const perFo = oF > 0 ? oP / oF : 0, perFw = wF > 0 ? wP / wF : 0;
  let leadAgri = 0;
  for (const s of world.settlements) if (s.mode === "settled") { const a = (s.knowledge && s.knowledge.agriculture) || 0; if (a > leadAgri) leadAgri = a; }
  let nomads = 0;
  if (world.countries) for (const c of world.countries.values()) if (c._nomadic) nomads++;
  let seceded = 0;
  for (const ev of world.events) if (ev.type === "polity.seceded") seceded++;
  console.log(`step ${String(step).padStart(6)}: countries ${String(st.countries).padStart(3)} (nomadic ${nomads})  seceded ${seceded}` +
    `  fieldPop ${(popFieldTotal(world) / 1e6).toFixed(2)}M  density/fert owned ${fmt(perFo, 0)} vs wild ${fmt(perFw, 0)} (${fmt(perFw > 0 ? perFo / perFw : 0, 1)}x)` +
    (df ? `  technique owned ${fmt(oN ? oD / oN : 0)} / wild ${fmt(wN ? wD / wN : 0)} (lead ${fmt(leadAgri)})` : `  (global dev, lead ${fmt(leadAgri)})`));
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % 3000 === 0) checkpoint(s);
}

if (T.DEV_FIELD) {
  console.log("\n[roundtrip] lever-on determinism + save/load (320×160, 3000 steps)");
  const mk = () => { const w = buildSim({ W: 320, H: 160, seed: 31337 }); stepPeopleSim(w, 3000); return w; };
  const w1 = mk(), w2 = mk();
  const h1 = hashWorld(w1), h2 = hashWorld(w2);
  console.log(`  determinism: ${h1 === h2 ? "ok  " : "FAIL"} ${h1} vs ${h2}`);
  const w3 = loadWorld(serializeWorld(w1));
  const h3 = hashWorld(w3);
  console.log(`  save→load hash: ${h1 === h3 ? "ok  " : "FAIL"} ${h1} vs ${h3}`);
  stepPeopleSim(w1, 1000); stepPeopleSim(w3, 1000);
  const tot = (w) => { let p = 0, m = 0; for (const s of w.settlements) if (s.mode === "settled") { p += s.people || 0; m += s.wealth || 0; } return { p, m }; };
  const t1 = tot(w1), t3 = tot(w3);
  const dp = Math.abs(t1.p - t3.p) / Math.max(1, t1.p) * 100, dm = Math.abs(t1.m - t3.m) / Math.max(1, t1.m) * 100;
  console.log(`  +1000-step continuation: ${dp < 8 && dm < 8 ? "ok  " : "FAIL"} pop ${dp.toFixed(1)}%, wealth ${dm.toFixed(1)}% drift`);
}
