// WHY — the funnels: why did the thing NOT happen?
//
// Outcomes cannot explain absences. This runs with src/sim/peopleSim/telemetry.js
// enabled and prints every pass's rejection funnel, tallied AT the rejecting line — so
// unlike an externally-replicated gate (tools/probe_fillaudit.mjs re-implements the
// whole size target and can silently drift from it) the funnel is the code's own.
//
//   node tools/why.mjs --steps=9000              # reference grid
//   node tools/why.mjs --steps=9000 --W=960      # the SHIPPED app grid
//   node tools/why.mjs --steps=9000 --every=3000 # funnels per window, not cumulative
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { provenance } from "./lib/simmetrics.mjs";
import { stepToYear } from "../src/sim/calendar.js";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const W = +arg("W", 480), STEPS = +arg("steps", 9000), SEED = +arg("seed", 8817), EVERY = +arg("every", 0);
const yr = (s) => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };

const w = buildSim({ W, H: W >> 1, seed: SEED });
telEnable(w);
const show = (label) => {
  const r = telReport(w);
  console.log(`\n━━ ${label} ${"━".repeat(Math.max(0, 56 - label.length))}`);
  if (!Object.keys(r).length) { console.log("    (no telemetry recorded — is any pass wired?)"); return; }
  for (const [ch, outs] of Object.entries(r)) {
    // CANDIDATE, where a pass emits it, is the DENOMINATOR — the population of things
    // that were considered — not an outcome. Counting it as one double-counts every
    // candidate and halves every percentage.
    const denom = outs.CANDIDATE ?? Object.entries(outs).filter(([k]) => k !== "CANDIDATE").reduce((a, [, v]) => a + v, 0);
    const passed = outs.PASSED;
    const head = passed !== undefined ? `${passed} passed (${(100 * passed / Math.max(1, denom)).toFixed(1)}%)` : "no explicit accept marker";
    console.log(`  ${ch}:  ${denom} considered · ${head}`);
    for (const [k, v] of Object.entries(outs)) {
      if (k === "CANDIDATE") continue;
      console.log(`      ${(k === "PASSED" ? "✓ PASSED" : k).padEnd(34)}${String(v).padStart(8)}  ${(100 * v / Math.max(1, denom)).toFixed(1)}%`);
    }
  }
};
if (EVERY > 0) {
  for (let t = EVERY; t <= STEPS; t += EVERY) { telReset(w); stepPeopleSim(w, EVERY); show(`window ending ${t} (${yr(t)})`); }
} else { stepPeopleSim(w, STEPS); show(`cumulative to step ${STEPS} (${yr(STEPS)})`); }
const pv = provenance(w);
console.log(`\n[why] commit ${pv.commit}  grid tw=${w.tw}  levers: ${Object.keys(pv.levers).length ? JSON.stringify(pv.levers) : "all at defaults"}`);
