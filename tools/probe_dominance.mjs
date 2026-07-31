// THE ROME-SHAPED HOLE — is there no great power, or can the model not SEE one?
//
// probe_warbars attributes 41% of war rejections to "parity" (nobody out-mights the
// local bar) and records that the great-power discounts DOM_ATTACK_P / DOM_CAPTURE_P
// NEVER fire, because conquest.js `_dominance` sits at 1.0-1.9 all run. Dominance is
// built from fiscal surplus measured AGAINST THE PEER MEDIAN — the code says what that
// implies at conquest.js ②c: "when every realm industrialises together no one gains
// surplus and the modern realm gets NO extra reach". A relative measure cannot express
// a hegemon in an era of institutionally similar peers.
//
// But that is a hypothesis with two possible answers, and they need opposite fixes:
//
//   A) The POWER distribution is genuinely wide (top realm 5-20x the median) and
//      `_dominance` fails to express it. Then dominance is the bug — an absolute term
//      belongs beside the relative one (the INDUSTRIAL_REACH argument, generalised).
//   B) The POWER distribution is itself flat (top ~2x median). Then there IS no great
//      power to detect, dominance is reporting honestly, and the defect is upstream:
//      nothing in the world lets one realm compound away from its peers.
//
// This measures both distributions side by side so the answer is not assumed.
//
//   node tools/probe_dominance.mjs [W=480] [steps=21000] [ck=3000] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { govOf, settlementPower } from "../src/sim/peopleSim/conquest.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 21000), CK = +(process.argv[4] || 3000);
const SEED = +(process.argv[5] || 8817);

const w = buildSim({ W, H, seed: SEED });
const q = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const r2 = (x) => x.toFixed(2);

console.log(`tw=${w.tw} seed=${SEED}`);
console.log("step\trealms\tdom med/p90/max\t\tPOWER med/max\tmax/med\tAREA max/med\tgovPop max/med");
for (let t = CK; t <= STEPS; t += CK) {
  stepPeopleSim(w, CK);
  const doms = [], pows = [], areas = [], gpops = [];
  const co = w._countryOwner, held = new Map();
  for (let i = 0; i < w.N; i++) { if (!(w.elev[i] > 0)) continue; const c = co[i]; if (c >= 0) held.set(c, (held.get(c) || 0) + 1); }
  const cpow = w._countryPow;
  if (w.countries) for (const [cid, c] of w.countries) {
    if (!c.capital || c.capital.mode !== "settled") continue;
    doms.push(c._dominance || 1);
    // national coercive weight — the same measure war balances on
    const p = cpow ? (cpow.get(cid) || 0) : 0;
    if (p > 0) pows.push(p);
    areas.push(held.get(cid) || 0);
    let gp = 0; for (const m of c.members || []) gp += Math.max(0, m.people || 0);
    if (gp > 0) gpops.push(gp);
  }
  const ratio = (a) => { const m = q(a, 0.5), x = q(a, 1); return m > 0 ? x / m : 0; };
  // WHICH AVAILABLE SIGNAL TRACKS THE GAP? The live CAP_MODEL branch reads revenue
  // PER MEMBER against the peer per-member median — "or the tail rewards sheer SIZE".
  // Compare it against the two candidates that CAN express scale.
  const revTot = [], revPer = [], capPw = [];
  if (w.countries) for (const [cid, c] of w.countries) {
    if (!c.capital || c.capital.mode !== "settled") continue;
    const rev = Math.max(0, (govOf(w, cid) || {})._lastRevenue || 0);
    if (rev > 0) { revTot.push(rev); revPer.push(rev / Math.max(1, (c.members || []).length)); }
    capPw.push(Math.max(0, settlementPower(c.capital) || 0));
  }
  console.log([t, doms.length,
    `${r2(q(doms, 0.5))}/${r2(q(doms, 0.9))}/${r2(q(doms, 1))}`,
    `${q(pows, 0.5).toFixed(1)}/${q(pows, 1).toFixed(1)}`,
    r2(ratio(pows)), r2(ratio(areas)), r2(ratio(gpops)),
    `| revTot ${r2(ratio(revTot))}  revPerMember ${r2(ratio(revPer))}  capPow ${r2(ratio(capPw))}`].join("\t"));
}
console.log(`\nREAD: if POWER max/med is large while dom max is ~1-2, the hegemon EXISTS and`);
console.log(`      _dominance cannot see it (case A). If POWER max/med is also ~2, there is no`);
console.log(`      hegemon to see and the defect is upstream of dominance entirely (case B).`);
