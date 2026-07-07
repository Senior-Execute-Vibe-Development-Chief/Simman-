// Decomposition of the EARLY resolution-invariance undershoot (plan doc): at matched
// development, is the 960 world's population low because the founding WAVE covers less
// REAL area (settledArea low), or because settlements on the covered area are SMALLER
// (pop/area low)? settledArea = land tiles within 10·rn of any settlement, in
// reference-tile units (×1/rn²) — comparable across resolutions.
//   RES_INVARIANT_POP=1 node tools/probe_resdecomp.mjs <W> [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const STEPS = parseInt(process.argv[3] || "12000", 10);
const SEED = parseInt(process.argv[4] || "8817", 10);
T.RES_INVARIANT_POP = process.env.RES_INVARIANT_POP != null ? +process.env.RES_INVARIANT_POP : 1;
const MARKS = [0.2, 0.25, 0.3, 0.35];
const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, rn = tw / 240, invA = 1 / (rn * rn), R = Math.round(10 * rn);
function settledArea() {
  const seen = new Uint8Array(world.N); let area = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    for (let dy = -R; dy <= R; dy++) {
      const y = sy + dy; if (y < 0 || y >= th) continue;
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = ((sx + dx) % tw + tw) % tw, ti = y * tw + x;
        if (!seen[ti] && world.elev[ti] > 0) { seen[ti] = 1; area += invA; }
      }
    }
  }
  return area;
}
console.log(`── decomp · ${W}x${H} (tw=${tw}, rn=${rn.toFixed(2)}) · seed ${SEED} · lever=${T.RES_INVARIANT_POP} ──`);
console.log(`org    step   setts  pop      settledArea(ref-tiles)  pop/area  pop/sett`);
let next = 0;
for (let s = 0; s < STEPS && next < MARKS.length; s += 250) {
  stepPeopleSim(world, 250);
  let lead = 0;
  for (const c of (world.countries ? world.countries.values() : [])) {
    const k = c.capital && c.capital.knowledge; if (k && k.organization > lead) lead = k.organization;
  }
  while (next < MARKS.length && lead >= MARKS[next]) {
    const st = peopleSimStats(world), a = settledArea();
    console.log(`${MARKS[next].toFixed(2)}  ${String(world.step).padStart(6)}  ${String(st.settlements).padStart(4)}  ${String(Math.round(st.totalPeople)).padStart(8)}  ${a.toFixed(0).padStart(10)}  ${(st.totalPeople / Math.max(1, a)).toFixed(2).padStart(12)}  ${(st.totalPeople / Math.max(1, st.settlements)).toFixed(0).padStart(7)}`);
    next++;
  }
}
