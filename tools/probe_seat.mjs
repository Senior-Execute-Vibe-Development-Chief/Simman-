// DOES THE CAPITAL TELEPORT? — evidence for/against a seat entity.
//
// `rebuildCountries` recomputes `c.capital` from scratch every polity pass as the
// highest-settlementPower member, preferring tier ≥ 1. Nothing anchors it: the
// only mechanism that ever MOVED a court deliberately (CAPITAL_COURT_MOVE, in
// maybeUrbanGenesis) returns immediately under the shipped T.DISSOLVE_FARMS = 1,
// so it is dead code in the shipped game.
//
// If that is true, a realm's capital is not an institution — it is a label that
// re-lands each pass on whoever happens to be biggest, and it moves for reasons
// that are not acts of state: a bigger city was conquered, a rival grew past the
// incumbent, a plague hit the wrong town. This probe measures it:
//
//   • capital CHANGES per realm per 1000 steps
//   • WHY each change happened, classified at the moment it happens:
//       seatDied        the old capital is gone (dead / left the realm) — legitimate
//       joinedBigger    the new capital was NOT a member last check — it arrived by
//                       conquest, absorption or founding, and outweighed the court
//       overtookInPlace both were members already; the new one simply grew past —
//                       the capital moved because of demography, not politics
//   • how far the court JUMPED (real km), since a seat that hops 1000 km because
//     a provincial city had a good century is the tell that it is not a seat
//   • the size gap at the moment of the flip: how decisively was it "bigger"?
//
//   node tools/probe_seat.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const POLL = 50;

const world = buildSim({ W, H: W / 2, seed: SEED });
const KM_PER_TILE = (40075 / world.tw);

const prevCap = new Map();      // realm id -> capital settlement id
const prevMembers = new Map();  // realm id -> Set of member ids
const changes = [];             // { step, realm, from, to, why, jumpKm, ratio }
let realmChecks = 0;            // realm-observations, the denominator

function poll() {
  if (!world.countries) return;
  for (const [cid, c] of world.countries) {
    if (!c.capital) continue;
    realmChecks++;
    const now = c.capitalId;
    const before = prevCap.get(cid);
    const membersBefore = prevMembers.get(cid);
    if (before !== undefined && before !== now) {
      const oldS = world._byId ? world._byId.get(before) : null;
      const alive = oldS && oldS.mode === "settled" && oldS.countryId === cid;
      const why = !alive ? "seatDied"
        : (membersBefore && !membersBefore.has(now)) ? "joinedBigger"
        : "overtookInPlace";
      let jumpKm = 0;
      if (oldS && c.capital) {
        let dx = Math.abs(oldS.pos.x - c.capital.pos.x);
        if (dx > world.tw / 2) dx = world.tw - dx;
        const dy = oldS.pos.y - c.capital.pos.y;
        jumpKm = Math.sqrt(dx * dx + dy * dy) * KM_PER_TILE;
      }
      const ratio = alive && oldS.people > 0 ? (c.capital.people || 0) / oldS.people : Infinity;
      changes.push({ step: world.step, realm: cid, why, jumpKm, ratio });
    }
    prevCap.set(cid, now);
    prevMembers.set(cid, new Set(c.members.map((m) => m.id)));
  }
}

const q = (arr, f) => {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(f * a.length))];
};

console.log(`# probe_seat  W=${W} seed=${SEED} steps=${STEPS}  DISSOLVE_FARMS=${T.DISSOLVE_FARMS} CAPITAL_COURT_MOVE=${T.CAPITAL_COURT_MOVE}`);
console.log(`# (CAPITAL_COURT_MOVE is inert while DISSOLVE_FARMS=1 — maybeUrbanGenesis returns at its first line)`);
const CHECKS = [4000, 8000, 12000, 25000, 50000].filter((c) => c <= STEPS);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % POLL === 0) poll();
  if (!CHECKS.includes(world.step)) continue;
  const by = {};
  for (const c of changes) by[c.why] = (by[c.why] || 0) + 1;
  const tot = changes.length;
  const notSeat = changes.filter((c) => c.why !== "seatDied");
  const jumps = notSeat.map((c) => c.jumpKm);
  const ratios = notSeat.filter((c) => isFinite(c.ratio)).map((c) => c.ratio);
  console.log(`\n=== step ${world.step}   realms ${world.countries.size}   capital changes so far ${tot} ===`);
  console.log(`  rate: ${(1000 * tot / Math.max(1, realmChecks * POLL)).toFixed(2)} changes per realm per 1000 steps`);
  console.log(`  why:  ` + Object.entries(by).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v} (${((100 * v) / Math.max(1, tot)).toFixed(0)}%)`).join("   "));
  console.log(`  court JUMP on a non-death move (km): p50 ${q(jumps, 0.5).toFixed(0)}  p90 ${q(jumps, 0.9).toFixed(0)}  max ${q(jumps, 1).toFixed(0)}`);
  console.log(`  new/old census ratio at the flip:    p10 ${q(ratios, 0.1).toFixed(2)}  p50 ${q(ratios, 0.5).toFixed(2)}   (1.00 = a dead heat decided the seat)`);
}
