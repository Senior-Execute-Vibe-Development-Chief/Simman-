// Is the FIELD abandoning land the SIM still owns? Bounded tracking fills a realm from its capital
// through its OWN land (blocked across other realms, dear across water), so a realm whose real
// _countryOwner territory is split into a lobe unreachable from its capital gets that lobe DROPPED
// by the field even though the sim owns it — "borders recede for no reason". This probe measures,
// over a window: real vs field claimed %, ABANDONED tiles (real-owned but field-wilderness), and
// the worst single realm's abandonment. A big/spiky abandoned share ⇒ the render (my field) is the
// culprit; if instead REAL claimed % itself drops (the sim sheds), the recession is the sim's own.
//   node tools/probe_ctrl_abandon.mjs [warm] [window] [sample] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

applyTuning({ CONTROL_FIELD: 1 });
const WARM = +(process.argv[2] || 9000);
const WIN  = +(process.argv[3] || 3000);
const SAMPLE = +(process.argv[4] || 150);
const SEED = +(process.argv[5] || 8817);
const W = +(process.argv[6] || 480), H = W >> 1;
const world = buildSim({ W, H, seed: SEED });
const N = world.N, elev = world.elev;

function measure() {
  const co = world._countryOwner, fo = world._ctrlOwner;
  let land = 0, real = 0, field = 0, abandoned = 0, mismatch = 0;
  const abById = new Map(), realById = new Map();
  for (let t = 0; t < N; t++) {
    if (elev[t] <= 0) continue; land++;
    const c = co ? co[t] : -1, f = fo ? fo[t] : -1;
    if (c >= 0) { real++; realById.set(c, (realById.get(c) || 0) + 1); }
    if (f >= 0) field++;
    if (c >= 0 && f < 0) { abandoned++; abById.set(c, (abById.get(c) || 0) + 1); }         // sim owns, field empty
    else if (c >= 0 && f >= 0 && f !== c) mismatch++;                                        // sim owns c, field draws f
  }
  // worst realm: highest fraction of its own real land abandoned by the field
  let worstFrac = 0, worstId = -1;
  for (const [cid, ab] of abById) { const rr = realById.get(cid) || 1; const fr = ab / rr; if (fr > worstFrac) { worstFrac = fr; worstId = cid; } }
  return { land, real, field, abandoned, mismatch, worstFrac, worstId, realOfWorst: realById.get(worstId) || 0 };
}

stepPeopleSim(world, WARM);
console.log(`\n  ${W}x${H}  warm ${WARM}, window ${WIN} @${SAMPLE}`);
console.log(`   step   real%  field%  abandoned(real→empty)  mismatch   worstRealm(%ownLandDropped)`);
let maxAband = 0, prevReal = null, maxRealDrop = 0;
for (let s = 0; s < WIN; s += SAMPLE) {
  stepPeopleSim(world, SAMPLE);
  const m = measure();
  const realPct = m.real / m.land, fieldPct = m.field / m.land;
  const abPct = m.abandoned / Math.max(1, m.real);
  maxAband = Math.max(maxAband, abPct);
  if (prevReal != null) maxRealDrop = Math.max(maxRealDrop, prevReal - realPct);
  prevReal = realPct;
  console.log(`   ${String(WARM+s+SAMPLE).padStart(5)}  ${(realPct*100).toFixed(1).padStart(5)}  ${(fieldPct*100).toFixed(1).padStart(5)}   ${String(m.abandoned).padStart(6)} (${(abPct*100).toFixed(1)}% of real)   ${String(m.mismatch).padStart(6)}    realm ${m.worstId}: ${(m.worstFrac*100).toFixed(0)}% of its ${m.realOfWorst}t`);
}
console.log(`\n  max abandoned share: ${(maxAband*100).toFixed(1)}% of real land drawn empty by the field`);
console.log(`  max REAL claimed drop between samples: ${(maxRealDrop*100).toFixed(2)}% (that part is the SIM sheding, not the field)`);
