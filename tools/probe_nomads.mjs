// Nomad-confederation probe (W6-D): do hordes actually ARISE — and if not, which
// classification gate kills them? Per checkpoint, walks every realm through BOTH
// classifyNomads funnels (conquest.js): the legacy SEAT test (mobility ≥ chariot
// gate → herds at the seat → seat on saddle-country) and the FIELD test
// (T.NOMAD_FIELD: mobility gate → majority of governed popField on saddle-country).
// Also counts the SUBSTRATE (settlements on saddle-country) and the horde activity
// that should follow (horde.raid events, nomad realm-passes, shatters).
//   node tools/probe_nomads.mjs [seed] [steps] [W] [H]
// Reference (480×240, 24k steps): the seat test is DEAD on both probe seeds —
// 0 hordes ever (saddle-seat never fires: courts always seat in the sown, and the
// sparse horse DEPOSIT — median fert 0.70, 162 tiles world-wide — barely overlaps
// the ~40% of land that is saddle-country). The field test fires from ~t=15k
// (mobility reaching the chariot gate): 8817 → 3-4 hordes (shares to 0.88),
// 29 raids by 24k; 31337 → 1 steady horde (0.61-0.80), 28 raids. Intermittent
// early (shares hovering at the majority line), steady once mobility matures.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { tileOpenness } from "../src/sim/peopleSim/transport.js";
import { eventsOf } from "../src/sim/peopleSim/events.js";

const seed = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "24000", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const CHECK = 3000;
const CHARIOT_MOB = 0.45, HORSES_MIN = 0.05, OPEN_MIN = 0.5, FERT_MAX = 0.35;

const world = buildSim({ W, H, seed });
let nomadPasses = 0;
const nomadIds = new Set();

function report(step) {
  const { tw, fert } = world;
  let total = 0, mob = 0, horses = 0, open = 0, nomadic = 0;
  let bestMob = 0, bestHorses = 0;
  if (world.countries) for (const [, c] of world.countries) {
    const cap = c.capital; if (!cap) continue;
    total++;
    const m = (cap.knowledge && cap.knowledge.mobility) || 0;
    if (m > bestMob) bestMob = m;
    if (m < CHARIOT_MOB) continue; mob++;
    const h = (cap.localRes && cap.localRes.horses) || 0;
    if (h > bestHorses) bestHorses = h;
    if (h < HORSES_MIN) continue; horses++;
    const ti = (cap.pos.y | 0) * tw + (cap.pos.x | 0);
    if (tileOpenness(world, ti) < OPEN_MIN) continue; open++;
    if ((fert[ti] || 0) >= FERT_MAX) continue;
    nomadic++;
    if (c._nomadic) { nomadIds.add(c.id); }
  }
  // Substrate: settled places on saddle-country at all (any tier, any realm).
  let saddleSett = 0, saddleWithHorses = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (tileOpenness(world, ti) >= OPEN_MIN && (fert[ti] || 0) < FERT_MAX) {
      saddleSett++;
      if (((s.localRes && s.localRes.horses) || 0) >= HORSES_MIN) saddleWithHorses++;
    }
  }
  // FIELD funnel (T.NOMAD_FIELD): saddle-people share per mobility-qualified realm.
  let fieldNomads = 0, bestShare = 0;
  if (world.popField && world._countryOwner && world.countries) {
    const pf = world.popField, co = world._countryOwner, elev = world.elev, N = world.N;
    const tot = new Map(), sad = new Map();
    for (let ti = 0; ti < N; ti++) {
      const cc = co[ti]; if (cc < 0 || elev[ti] <= 0) continue;
      const p = pf[ti]; if (!(p > 0)) continue;
      tot.set(cc, (tot.get(cc) || 0) + p);
      if (tileOpenness(world, ti) >= OPEN_MIN && (fert[ti] || 0) < FERT_MAX) sad.set(cc, (sad.get(cc) || 0) + p);
    }
    for (const [, c] of world.countries) {
      const cap = c.capital; if (!cap) continue;
      if (((cap.knowledge && cap.knowledge.mobility) || 0) < CHARIOT_MOB) continue;
      const t = tot.get(c.id) || 0, share = t > 0 ? (sad.get(c.id) || 0) / t : 0;
      if (share > bestShare) bestShare = share;
      if (t > 0 && share > 0.5) fieldNomads++;
    }
  }
  let raids = 0, shatters = 0;
  for (const ev of eventsOf(world)) {
    if (ev.type === "horde.raid") raids++;
    else if (ev.type === "polity.seceded" && ev.why === "succession") shatters++;
  }
  console.log(`t=${step}: realms=${total} | seat-funnel mob≥.45: ${mob} → horses: ${horses} → saddle-seat: ${nomadic} | FIELD: saddle-people majority=${fieldNomads} bestShare=${bestShare.toFixed(2)} | live _nomadic passes=${nomadPasses} distinct=${nomadIds.size} | bestMob=${bestMob.toFixed(2)} | substrate: ${saddleSett} saddle settlements (${saddleWithHorses} w/ herds) | raids=${raids} shatters=${shatters}`);
}

for (let s = 0; s < STEPS; s += CHECK) {
  stepPeopleSim(world, Math.min(CHECK, STEPS - s));
  if (world.countries) for (const [, c] of world.countries) if (c._nomadic) { nomadPasses++; nomadIds.add(c.id); }
  report(Math.min(s + CHECK, STEPS));
}
