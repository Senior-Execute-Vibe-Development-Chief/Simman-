// DOES SEAT_BONUS_CAP BIND? (owner 2026-08-23: "i think that 10 cap might be the problem")
//
// The delegated-seat term is the ONLY place a member pays administrative capacity
// back to its realm:
//
//     seatBonus += CAP_SEAT(0.3) · loyalty · min(2, log2(1 + people/SIZE_REF))
//     ... for members with tier >= 2 or holding vassals, TOTAL capped at 10 · instMul
//
// A member's COST is linear in distance; its PAYBACK is at most 0.6 and the sum is
// hard-capped. Linear cost against capped benefit is a ceiling on province count by
// construction — a real structural criticism of the ledger's SHAPE.
//
// But a ceiling only binds if something reaches it, and this sim's median realm has
// ONE member. Reaching a cap of 10 needs ~17 full-value city seats. So the honest
// question is not "is the cap too low" but:
//
//     DOES ANY REALM GET NEAR IT — or is the cap a limit nothing approaches because
//     a prior gate (the integration lane) keeps every realm small?
//
// If the second, fixing the cap changes nothing measurable, and the order of work is
// the other way round: open the lane first, THEN find out whether the ceiling bites.
//
// Reads the sim's own stamps (conquest.js c._seatRaw / _seatUsed / _seatCap) — the
// values the capacity formula itself used, never recomputed here.
//
//   node tools/probe_seatcap.mjs [steps] [W] [seed] [window]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const WIN = +(process.argv[5] || 2000);

const world = buildSim({ W, H, seed: SEED });
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

console.log(`\n=== SEAT_BONUS_CAP — a ceiling, or a ceiling nothing reaches?  ${W}x${H} (tw=${world.tw})  seed ${SEED} ===`);
console.log(`   step  realms | members p50/p90/max | seat-eligible p90/max | seatRaw p50/p90/max |  cap  | AT THE CAP | withheld share of capacity`);

for (let done = 0; done < STEPS; done += WIN) {
  stepPeopleSim(world, Math.min(WIN, STEPS - done));
  const cs = world.countries;
  if (!cs || !cs.size) continue;
  const mem = [], elig = [], raw = [], atCap = [];
  let withheldTot = 0, capTot = 0, capTotOfAtCap = 0;
  for (const c of cs.values()) {
    if (c._seatRaw == null) continue;
    const members = (c.members || []).filter(m => m.mode === "settled").length;
    let e = 0;
    for (const s of (c.members || [])) {
      if (s.id === c.capitalId || s.mode !== "settled") continue;
      if ((s.tier | 0) >= 2 || (s._vassalCount || 0) > 0) e++;
    }
    mem.push(members); elig.push(e); raw.push(c._seatRaw);
    const over = c._seatRaw - c._seatUsed;
    if (over > 1e-9) {
      atCap.push(c);
      withheldTot += over;
      capTotOfAtCap += c._capacity || 0;
    }
    capTot += c._capacity || 0;
  }
  if (!raw.length) continue;
  const capV = [...cs.values()].find(c => c._seatCap != null);
  console.log(
    `  ${String(world.step).padStart(6)} ${String(raw.length).padStart(6)} | ` +
    `${String(q(mem, .5)).padStart(3)}/${String(q(mem, .9)).padStart(3)}/${String(Math.max(...mem)).padStart(4)} | ` +
    `${String(q(elig, .9)).padStart(9)}/${String(Math.max(...elig)).padStart(4)} | ` +
    `${q(raw, .5).toFixed(2).padStart(6)}/${q(raw, .9).toFixed(2).padStart(5)}/${Math.max(...raw).toFixed(2).padStart(6)} | ` +
    `${(capV ? capV._seatCap : 0).toFixed(1).padStart(5)} | ` +
    `${String(atCap.length).padStart(4)} of ${String(raw.length).padEnd(5)} | ` +
    `${capTotOfAtCap > 0 ? (100 * withheldTot / capTotOfAtCap).toFixed(1) + "% of their capacity" : "-"}`);
}

// The verdict, in the terms the question was asked in
const cs = world.countries || new Map();
const rows = [...cs.values()].filter(c => c._seatRaw != null);
const atCap = rows.filter(c => c._seatRaw - c._seatUsed > 1e-9);
const near = rows.filter(c => c._seatCap > 0 && c._seatRaw >= 0.5 * c._seatCap);
console.log(`\n  at step ${world.step}:  ${rows.length} realms`);
console.log(`    AT the cap (seatRaw > ceiling):      ${atCap.length}  (${(100 * atCap.length / Math.max(1, rows.length)).toFixed(1)}%)`);
console.log(`    within HALF the cap (raw >= 0.5x):   ${near.length}  (${(100 * near.length / Math.max(1, rows.length)).toFixed(1)}%)`);
console.log(`    biggest seatRaw in the world:        ${rows.length ? Math.max(...rows.map(c => c._seatRaw)).toFixed(2) : 0}  against a ceiling of ${rows.length ? (rows[0]._seatCap || 0).toFixed(1) : 0}`);
const top = rows.sort((a, b) => b._seatRaw - a._seatRaw).slice(0, 8);
console.log(`\n  the 8 realms with the most delegated seats:`);
console.log(`     members  seat-eligible  seatRaw  seatUsed  capacity  load  name`);
for (const c of top) {
  let e = 0;
  for (const s of (c.members || [])) { if (s.id === c.capitalId || s.mode !== "settled") continue; if ((s.tier | 0) >= 2 || (s._vassalCount || 0) > 0) e++; }
  const p = world.polities && world.polities.get(c.id);
  console.log(`     ${String((c.members || []).length).padStart(7)}  ${String(e).padStart(13)}  ${c._seatRaw.toFixed(2).padStart(7)}  ${c._seatUsed.toFixed(2).padStart(8)}  ${(c._capacity || 0).toFixed(1).padStart(8)}  ${(c._loadTotal || 0).toFixed(1).padStart(4)}  ${(p && p.name) || "?"}`);
}
console.log("");
