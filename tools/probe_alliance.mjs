// Is the balance-of-power alliance system actually firing? Track, over a run:
//   - the largest empire's TERRITORY (tiles) vs the next-largest (is a hegemon
//     emerging, and does it STALL once neighbours coalesce against it?)
//   - how many realms balance against a threat (allianceTarget >= 0)
//   - how many ally pairs exist, and the biggest coalition arrayed against any hegemon
//     (blocMight / hegemonPower — the emergent "cap" on that hegemon).
//   node tools/probe_alliance.mjs [steps] [seed] [W] [H]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const world = buildSim({ W, H, seed: SEED });

function terrByCountry() {
  const cnt = new Map(); const co = world._countryOwner;
  if (co) for (let i = 0; i < co.length; i++) { const c = co[i]; if (c < 0) continue; cnt.set(c, (cnt.get(c) || 0) + 1); }
  return cnt;
}

console.log('step   setts cntry  #1terr #2terr #3terr  balancing  allyPairs  maxBloc/heg');
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  if (i % 1500 === 0 || i === 200) {
    const st = peopleSimStats(world);
    const terr = [...terrByCountry().entries()].sort((a, b) => b[1] - a[1]);
    const t1 = terr[0] ? terr[0][1] : 0, t2 = terr[1] ? terr[1][1] : 0, t3 = terr[2] ? terr[2][1] : 0;
    // alliance map state
    const at = world._allianceTarget, bloc = world._blocMight, pow = world._countryPow, allies = world._allies;
    let balancing = 0; if (at) for (const v of at.values()) if (v >= 0) balancing++;
    let allyPairs = 0; if (allies) for (const s of allies.values()) allyPairs += s.size; allyPairs = (allyPairs / 2) | 0;
    let maxRatio = 0; if (bloc && pow) for (const [heg, b] of bloc) { const r = b / Math.max(1, pow.get(heg) || 1); if (r > maxRatio) maxRatio = r; }
    console.log(`${String(i).padStart(5)}  ${String(st.settlements).padStart(4)}  ${String(st.countries).padStart(4)}  ${String(t1).padStart(6)} ${String(t2).padStart(6)} ${String(t3).padStart(6)}     ${String(balancing).padStart(3)}        ${String(allyPairs).padStart(3)}      ${maxRatio.toFixed(2)}`);
  }
}
