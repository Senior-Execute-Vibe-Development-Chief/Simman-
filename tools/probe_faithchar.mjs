// Probe: faith personality ↔ people character.
//
// Confirms the bridge added to faiths.js / personality.js, with measurements
// that control for the confounds that wash out naive aggregates (faith AGE and
// late-game realm-type consolidation), POOLED across several seeds (these are
// population-level correlations, so any single world is a small, noisy sample):
//   (A) BORN IN THE FOUNDER'S IMAGE — correlation, captured AT FOUNDING, between
//       the founding realm's temperament and the new creed's doctrine.
//   (B+C) ALIGNMENT — per-axis correlation between a state faith's temperament and
//       the character of the realm that holds it (affinity in spread + the faith
//       reshaping its adherents both push these together).
//   (S) SELECTION — zeal vs LIFETIME PEAK followers (a creed's best reach over its
//       whole life — far less age-confounded than an instantaneous snapshot).
//
//   node tools/probe_faithchar.mjs

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getFaith, faithsOf, dominantFaith, doctrineLabel, faithTemperament } from "../src/sim/peopleSim/faiths.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";

const W = 320, H = 160, SEEDS = [4242, 99, 2024, 7];
const TARGET = 20000;

function corr(xs, ys) {
  const n = xs.length; if (n < 3) return NaN;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}
function townCounts(world) {
  const m = new Map();
  for (const s of world.settlements) { if (s.mode !== "settled") continue; const d = dominantFaith(s); if (d >= 0) m.set(d, (m.get(d) || 0) + 1); }
  return m;
}

// pooled across seeds
const born = [];                                              // foundings: {zeal,militancy,worldliness,exp,agg,com,peak}
const aE = [[], []], aA = [[], []], aC = [[], []];           // alignment pairs [faithAxis, realmAxis]
let lastWorld = null, lastSizes = null;

function runSeed(seed) {
  const world = buildSim({ W, H, seed, preset: "earth_sim" });
  const seen = new Set(), localBorn = [], peak = new Map();
  let at = 0;
  while (at < TARGET) {
    stepPeopleSim(world, 150); at += 150;
    for (const f of faithsOf(world).values()) {                 // (A) capture each new faith at founding
      if (f.kind !== "organized" || seen.has(f.id)) continue;
      seen.add(f.id);
      const origin = world._byId && world._byId.get(f.originSettlementId);
      const c = origin && origin.countryId >= 0 && world.countries ? world.countries.get(origin.countryId) : null;
      const pp = c && c.personality;
      if (!pp || !f.doctrine) continue;
      localBorn.push({ id: f.id, zeal: f.doctrine.zeal, militancy: f.doctrine.militancy, worldliness: f.doctrine.worldliness,
        exp: pp.expansionism, agg: pp.aggression, com: pp.commerce });
    }
    for (const [fid, n] of townCounts(world)) if (n > (peak.get(fid) || 0)) peak.set(fid, n);   // (S) lifetime peak
  }
  for (const b of localBorn) { b.peak = peak.get(b.id) || 0; born.push(b); }
  for (const c of world.countries.values()) {                   // (B+C) state-faith ↔ holder pairs
    const p = getPolity(world, c.id);
    if (!p || p.faithId < 0 || !c.personality) continue;
    const f = getFaith(world, p.faithId);
    if (!f || f.kind !== "organized" || !f.doctrine) continue;
    const ft = faithTemperament(f.doctrine);
    aE[0].push(ft.expansionism); aE[1].push(c.personality.expansionism);
    aA[0].push(ft.aggression);   aA[1].push(c.personality.aggression);
    aC[0].push(ft.commerce);     aC[1].push(c.personality.commerce);
  }
  lastWorld = world; lastSizes = townCounts(world);
}

for (const seed of SEEDS) runSeed(seed);

console.log(`[probe] faith personality ↔ people character — ${W}x${H}, ${SEEDS.length} seeds × ${TARGET} steps (pooled)\n`);

console.log(`  (A) born in the founder's image — correlation across ${born.length} foundings:`);
console.log(`        founder EXPANSIONISM → faith ZEAL (spreadability) : r = ${corr(born.map(b => b.exp), born.map(b => b.zeal)).toFixed(2)}`);
console.log(`        founder AGGRESSION   → faith MILITANCY            : r = ${corr(born.map(b => b.agg), born.map(b => b.militancy)).toFixed(2)}`);
console.log(`        founder COMMERCE     → faith WORLDLINESS          : r = ${corr(born.map(b => b.com), born.map(b => b.worldliness)).toFixed(2)}`);

console.log(`\n  (B+C) faith ↔ holder alignment — per-axis correlation across ${aE[0].length} state-faith realms:`);
console.log(`        faith EXPANSIONISM ↔ realm EXPANSIONISM : r = ${corr(aE[0], aE[1]).toFixed(2)}`);
console.log(`        faith AGGRESSION   ↔ realm AGGRESSION   : r = ${corr(aA[0], aA[1]).toFixed(2)}`);
console.log(`        faith COMMERCE     ↔ realm COMMERCE     : r = ${corr(aC[0], aC[1]).toFixed(2)}`);

console.log(`\n  (S) selection — zeal vs LIFETIME PEAK followers (${born.length} faiths):`);
console.log(`        faith ZEAL → peak towns : r = ${corr(born.map(b => b.zeal), born.map(b => b.peak)).toFixed(2)}   (+ ⇒ contagious creeds reach farther)`);

// examples from the last world
console.log("\n  prominent faiths (last seed) — character → the realms that carry it:");
const organized = [...faithsOf(lastWorld).values()].filter(f => f.kind === "organized" && f.endedStep < 0 && f.doctrine);
const byFol = organized.sort((a, b) => (lastSizes.get(b.id) || 0) - (lastSizes.get(a.id) || 0)).slice(0, 6);
for (const f of byFol) {
  const ft = faithTemperament(f.doctrine);
  const holders = [...lastWorld.countries.values()].filter(c => { const p = getPolity(lastWorld, c.id); return p && p.faithId === f.id && c.personality; });
  const labels = {};
  for (const c of holders) labels[c.personality._label] = (labels[c.personality._label] || 0) + 1;
  const top = Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l, n]) => `${l}×${n}`).join(", ");
  console.log(`    ${(f.name || "?").padEnd(11)} ${("[" + doctrineLabel(f) + "]").padEnd(23)} temp(agg ${ft.aggression.toFixed(2)}, com ${ft.commerce.toFixed(2)}, exp ${ft.expansionism.toFixed(2)})  ${lastSizes.get(f.id) || 0} towns · ${top || "—"}`);
}
