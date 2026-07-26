// Hegemon-ossification probe (backlog #2 / review I98). Measures, on HEAD:
//   1. #1-holder TENURE — which realm (suzerainty ROOT: vassal land folds into
//      its overlord's bloc) holds the most claimed land, sampled every SAMPLE
//      steps; final table = share of samples held, longest unbroken run, and
//      the same restricted to the BACK 40% of the run (the lock-in window).
//   2. Polity MORTALITY — founded/ended per report window from the registry
//      (the review measured a 7× late-game mortality collapse).
//   3. WHY the top realm doesn't break — the internal state the fracture
//      mechanisms read: province structure vs the overmighty-governor bars
//      (ratio ≥ 0.55 of the THRONE province, far ≥ 0.5×holdRange — far is not
//      recomputable here, so we report ambition stocks, which integrate both),
//      admin strain (load/capacity), dynastic crisis, estates, unrest, hegF.
// Read-only: no sim state is written; pure observation between steps.
//   node tools/probe_hegemon.mjs [steps] [seed] [W] [H]
//   SAMPLE=250 REPORT=2000 env overrides.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { settlementPower } from "../src/sim/peopleSim/conquest.js";
import { politiesOf, getPolity } from "../src/sim/peopleSim/entities.js";
import { inCrisis } from "../src/sim/peopleSim/dynasties.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS  = parseInt(process.argv[2] || "24000", 10);
const SEED   = parseInt(process.argv[3] || "8817", 10);
const W      = parseInt(process.argv[4] || "480", 10);
const H      = parseInt(process.argv[5] || "240", 10);
const SAMPLE = parseInt(process.env.SAMPLE || "250", 10);
const REPORT = parseInt(process.env.REPORT || "2000", 10);

const world = buildSim({ W, H, seed: SEED });
console.log(`hegemon probe ${W}x${H} seed=${SEED} steps=${STEPS} (sample ${SAMPLE}, report ${REPORT})`);

const nameOf = (cid) => getPolity(world, cid)?.name || `#${cid}`;
const rootOf = (cid) => {
  const ov = world._overlordOf;
  let c = cid, hops = 0;
  while (ov && ov.has(c) && hops++ < 64) c = ov.get(c);
  return c;
};

function landByCountry() {
  const co = world._countryOwner, m = new Map();
  if (co) for (let i = 0; i < co.length; i++) { const c = co[i]; if (c >= 0) m.set(c, (m.get(c) || 0) + 1); }
  return m;
}

// One sample: fold each realm's claimed tiles into its suzerainty root.
function sampleTop() {
  const tbc = landByCountry();
  let claimed = 0;
  const byRoot = new Map();
  for (const [cid, n] of tbc) {
    claimed += n;
    const r = rootOf(cid);
    byRoot.set(r, (byRoot.get(r) || 0) + n);
  }
  let topRoot = -1, topN = 0, topRaw = -1, topRawN = 0;
  for (const [r, n] of byRoot) if (n > topN) { topN = n; topRoot = r; }
  for (const [c, n] of tbc) if (n > topRawN) { topRawN = n; topRaw = c; }
  return { topRoot, topShare: claimed ? topN / claimed : 0, topRaw, rawShare: claimed ? topRawN / claimed : 0, claimed };
}

// Internal-complexity readout of the current #1 root realm (its DIRECT realm,
// not the whole bloc — the governor pass runs per realm). euclFar is a LOWER
// bound of the governor pass's blended `far` (blended = (eucl + terrain excess
// + river toll)/holdRange ≥ eucl/holdRange), so euclFar ≥ 0.5 proves the
// distance gate passes, while euclFar < 0.5 leaves it undecided-but-likely-blocking.
function topInternals(cid) {
  const c = world.countries && world.countries.get(cid);
  if (!c || !c.members || !c.members.length) return null;
  const cap = world._byId ? world._byId.get(c.capitalId) : null;
  const holdRange = Math.max(1, c.holdReach || c.range || 1);
  const provPower = new Map();
  for (const m of c.members) {
    if (m.countryId !== c.id) continue;
    const seatId = m._provinceCity ?? c.capitalId;
    provPower.set(seatId, (provPower.get(seatId) || 0) + settlementPower(m));
  }
  const throne = provPower.get(c.capitalId) || 1;
  let provN = 0, maxRatio = 0, over55 = 0;
  const provRows = [];
  for (const [sid, p] of provPower) {
    if (sid === c.capitalId) continue;
    provN++;
    const r = p / throne;
    if (r > maxRatio) maxRatio = r;
    if (r >= 0.55) over55++;
    const seatS = world._byId ? world._byId.get(sid) : null;
    if (seatS && cap) {
      const dx = Math.abs(seatS.pos.x - cap.pos.x), dyr = Math.abs(seatS.pos.y - cap.pos.y);
      const ddx = Math.min(dx, world.tw - dx);   // wrapped x, same as dist()
      const eucl = Math.hypot(ddx, dyr);
      const pacified = world.step - (seatS._conqueredAt ?? -Infinity) < T.CONQUEST_GRACE;
      provRows.push({ r, euclFar: eucl / holdRange, amb: seatS._ambition || 0, pacified });
    }
  }
  provRows.sort((a, b) => b.r - a.r);
  let ambMax = 0, ambN = 0, estSum = 0, unrestSum = 0, n = 0;
  for (const m of c.members) {
    if (m.countryId !== c.id) continue;
    n++;
    estSum += m._estates || 0; unrestSum += m.unrest || 0;
    if (m.id === c.capitalId) continue;
    const a = m._ambition || 0;
    if (a > ambMax) ambMax = a;
    if (a > 0.1) ambN++;
  }
  const pol = getPolity(world, c.id);
  let vassals = 0;
  if (world._overlordOf) for (const [, over] of world._overlordOf) if (over === c.id) vassals++;
  return {
    members: n, provN, maxRatio, over55, ambMax, ambN,
    strain: pol?._strain ?? -1, crisis: inCrisis(world, c.id),
    estates: n ? estSum / n : 0, unrest: n ? unrestSum / n : 0,
    hegF: cap?._hegF ?? 0, peerPeak: cap?._peerPeak ?? 0, vassals,
    provTop: provRows.slice(0, 3),
  };
}

function mortality(sinceStep, uptoStep) {
  let born = 0, died = 0;
  for (const p of politiesOf(world).values()) {
    if (p.foundedStep > sinceStep && p.foundedStep <= uptoStep) born++;
    if (p.endedStep > sinceStep && p.endedStep <= uptoStep) died++;
  }
  return { born, died };
}

const samples = [];   // { step, root, share }
let lastReport = 0;
const t0 = Date.now();

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % SAMPLE === 0) {
    const t = sampleTop();
    samples.push({ step: s, root: t.topRoot, share: t.topShare, raw: t.topRaw, rawShare: t.rawShare });
  }
  if (s % REPORT === 0) {
    const t = samples[samples.length - 1];
    const m = mortality(lastReport, s);
    const ti = t && t.root >= 0 ? topInternals(t.root) : null;
    // tenure so far: consecutive trailing samples with this root
    let run = 0;
    for (let i = samples.length - 1; i >= 0 && samples[i].root === t.root; i--) run++;
    const provStr = ti && ti.provTop.length
      ? " top:[" + ti.provTop.map((p) => `${p.r.toFixed(2)}@${p.euclFar.toFixed(2)}${p.pacified ? "p" : ""}${p.amb > 0.01 ? ` a${p.amb.toFixed(2)}` : ""}`).join(" ") + "]"
      : "";
    const iStr = ti
      ? `mem=${ti.members} prov=${ti.provN} maxProv/throne=${ti.maxRatio.toFixed(2)} ≥.55:${ti.over55} ambMax=${ti.ambMax.toFixed(2)} amb>.1:${ti.ambN} strain=${ti.strain.toFixed(2)} est=${ti.estates.toFixed(2)} unrest=${ti.unrest.toFixed(2)} hegF=${ti.hegF.toFixed(2)} vas=${ti.vassals}${ti.crisis ? " CRISIS" : ""}${provStr}`
      : "";
    console.log(`step ${String(s).padStart(6)} | ctry=${String(world.countries ? world.countries.size : 0).padStart(3)} | #1 ${nameOf(t.root)} (${(t.share * 100).toFixed(1)}% land, ${run * SAMPLE} steps) | born/died ${m.born}/${m.died} | ${iStr}`);
    lastReport = s;
  }
}

// ── Final tenure verdict ────────────────────────────────────────────────
function tenureStats(from) {
  const win = samples.filter((x) => x.step > from);
  if (!win.length) return null;
  const hold = new Map();
  let changes = 0, longest = 0, longRoot = -1, cur = 0, curRoot = -2;
  for (const x of win) {
    hold.set(x.root, (hold.get(x.root) || 0) + 1);
    if (x.root === curRoot) cur++;
    else { if (x.root !== -2 && curRoot !== -2) changes++; cur = 1; curRoot = x.root; }
    if (cur > longest) { longest = cur; longRoot = curRoot; }
  }
  const top = [...hold.entries()].sort((a, b) => b[1] - a[1]);
  return { n: win.length, changes, longest, longRoot, top };
}

console.log("\n== tenure (suzerainty-root #1 by claimed land) ==");
for (const [label, from] of [["full run", 0], ["back 40%", STEPS * 0.6]]) {
  const st = tenureStats(from);
  if (!st) continue;
  const rows = st.top.slice(0, 3).map(([r, k]) => `${nameOf(r)} ${(100 * k / st.n).toFixed(0)}%`).join(", ");
  console.log(`${label}: ${st.changes} changes over ${st.n} samples; longest hold ${nameOf(st.longRoot)} ${st.longest * SAMPLE} steps; holders: ${rows}`);
}
{
  // mortality collapse check: deaths per 1k steps, first vs last third
  const third = Math.floor(STEPS / 3);
  const a = mortality(0, third), b = mortality(STEPS - third, STEPS);
  console.log(`mortality: first third ${(a.died / third * 1000).toFixed(2)} deaths/1k, last third ${(b.died / third * 1000).toFixed(2)} deaths/1k`);
}
{
  // attribution: what kills/births polities — polity.* events by type(+how),
  // full run vs the back 40% (the ossification window).
  const tally = new Map(), tallyLate = new Map();
  const lateFrom = STEPS * 0.6;
  for (const ev of world.events || []) {
    if (!ev.type || !ev.type.startsWith("polity.")) continue;
    const key = ev.type + (ev.how ? `(${ev.how})` : "");
    tally.set(key, (tally.get(key) || 0) + 1);
    if (ev.step > lateFrom) tallyLate.set(key, (tallyLate.get(key) || 0) + 1);
  }
  const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" ");
  console.log(`events full: ${fmt(tally)}`);
  console.log(`events back40%: ${fmt(tallyLate)}`);
}
console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`);
