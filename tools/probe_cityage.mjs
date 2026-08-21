// Register-vs-age probe: how many CITIES does the sim's world hold at each
// DEVELOPMENT age (never the calendar — the two-clock rule)? Compared against
// the real series (Modelski/Chandler/Bairoch, cities >=10k urban core):
//   dawn ~5-15 · early bronze ~30-60 · late bronze ~50-100 · iron ~100-200
//   classical ~400-600 · late-antique dip ~300-500 · high medieval ~800-1200
//   1500CE ~1000-1500 · 1800CE ~2000-3000
//   SIM_TUNE="<live stack>" node probe_cityage.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techState, ERAS } from "../src/sim/peopleSim/tech.js";
import { POP_SCALE } from "../src/sim/units.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { URBAN_ORG } from "../src/sim/peopleSim/landKnow.js";

const STEPS = +(process.argv[2] || 28000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 2000;

const world = buildSim({ W, H, seed: SEED });
telEnable(world);

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  const eraN = new Array(ERAS.length).fill(0);
  let cities = 0, urb10k = 0, lead = 0, popSim = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    cities++;
    popSim += s.people || 0;
    const u = s._urbanPop != null ? s._urbanPop : s.people || 0;
    if (u * POP_SCALE >= 10000) urb10k++;
    const e = techState(s.knowledge || {}).era;
    eraN[e]++;
    if (e > lead) lead = e;
  }
  const eras = eraN.map((n, e) => (n ? `${ERAS[e].slice(0, 4)}:${n}` : null)).filter(Boolean).join(" ");
  console.log(`step ${String(world.step).padStart(5)}  register=${cities}  cores>=10k=${urb10k}  leading=${ERAS[lead]}  [${eras}]  pop=${(popSim * POP_SCALE / 1e6).toFixed(0)}M`);
  // WHY does the register not grow faster? Under the live regime cities mint
  // through the SITE lane (gather -> core bar -> LAND_KNOW tally gate) and the
  // PEER-SEAT lane — print every creation-side funnel the sim exposes.
  const tr = telReport(world);
  for (const ch of Object.keys(tr).sort()) {
    if (!/site|seat|found|fission|birthPolity|dissolve|landNation|peerlat/i.test(ch)) continue;
    console.log(`    ${ch}: ` + Object.entries(tr[ch]).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ").slice(0, 200));
  }
  telReset(world);
  // The tally-waiting stock, split by state contact, with its org distribution:
  // in-contact + far-below-bar = the contact RATE is the gap; isolated = the
  // gradient working as designed; p50 hugging the bar = a last-mile asymptote.
  {
    const m = world._landKnow, eligA = world._siteCityElig, contact = world._lkContact;
    if (m && eligA) {
      const recByCell = new Map();
      for (const rec of m.values()) if (rec.cell >= 0) recByCell.set(rec.cell, rec);
      let waitC = 0, waitNC = 0;
      const orgs = [];
      for (let k2 = 0; k2 < eligA.length; k2++) {
        if (!eligA[k2]) continue;
        const rec = recByCell.get(k2);
        if (!rec) continue;
        const org = rec.k.organization || 0;
        if (org >= URBAN_ORG) continue;
        orgs.push(org);
        if (contact && contact.has(k2)) waitC++; else waitNC++;
      }
      orgs.sort((a, b) => a - b);
      const q = (p) => orgs.length ? orgs[Math.min(orgs.length - 1, Math.floor(p * orgs.length))] : 0;
      if (orgs.length) console.log(`    tallyWait: sites=${orgs.length} (stateContact ${waitC} / beyond ${waitNC})  org p10=${q(0.1).toFixed(2)} p50=${q(0.5).toFixed(2)} p90=${q(0.9).toFixed(2)}  bar=${URBAN_ORG}`);
    }
  }
}
