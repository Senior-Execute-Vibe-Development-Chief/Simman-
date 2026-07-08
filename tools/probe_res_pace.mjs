// Is DEVELOPMENT resolution-invariant? Run the same seed at a given grid width and report, at
// step checkpoints, INTRINSIC (resolution-independent-in-meaning) development indicators:
//   claimed% (fraction of land under any state), realm count, #settlements, and the LEADING
//   civilisation's tech (agriculture, organization) — tech is a 0..1 level, so if it differs by
//   resolution at the same step, development pace itself is resolution-dependent.
//   node tools/probe_res_pace.mjs [W] [seed] [maxstep]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const MAX = +(process.argv[4] || 12000);
const world = buildSim({ W, H, seed: SEED });
const N = world.N, elev = world.elev;
const CKPTS = [3000, 6000, 9000, 12000].filter(c => c <= MAX);

function lead(getter) { let m = 0; for (const s of world.settlements) { if (s.mode !== "settled" || !s.knowledge) continue; const v = getter(s) || 0; if (v > m) m = v; } return m; }
function report(step) {
  const co = world._countryOwner;
  let land = 0, claimed = 0; const realms = new Set();
  for (let t = 0; t < N; t++) { if (elev[t] <= 0) continue; land++; if (co && co[t] >= 0) { claimed++; realms.add(co[t]); } }
  let nsett = 0, totPop = 0; for (const s of world.settlements) if (s.mode === "settled") { nsett++; totPop += s.people || 0; }
  const agri = lead(s => s.knowledge.agriculture), org = lead(s => s.knowledge.organization);
  const logi = lead(s => (s._techEff ? s._techEff.logisticsLevel : 0));
  console.log(`  ${W}w  step ${String(step).padStart(5)}:  claimed ${(100*claimed/land).toFixed(1).padStart(5)}%  realms ${String(realms.size).padStart(3)}  setts ${String(nsett).padStart(4)}  leadAgri ${agri.toFixed(3)}  leadOrg ${org.toFixed(3)}  leadLogi ${logi.toFixed(3)}`);
}

let at = 0;
for (const ck of CKPTS) { stepPeopleSim(world, ck - at); at = ck; report(ck); }
