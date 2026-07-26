// Cradle genesis-pulse probe: per-realm claimed-tile trajectories aligned by
// AGE, cradle-seeded vs naturally-founded realms — the instrument behind the
// 2026-07 endowment decomposition ("cradles balloon then shrink; naturals grow
// smoothly"). Reports each realm's peak claim, when it peaked, where it
// settled, the cradle-vs-natural overshoot aggregate, cradle deaths, the first
// natural state's founding step (world-ignition), and the era-arrival steps
// (the startup-pace check the CRADLE_ORG lever trades against).
//   node tools/probe_cradle_pulse.mjs [seed] [steps]
//   A/B: SIM_TUNE="CRADLE_ORG=0.1" vs default (0.28).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { politiesOf } from "../src/sim/peopleSim/entities.js";

const SEED = +(process.argv[2] || 8817);
const STEPS = +(process.argv[3] || 8000);
const SAMPLE = 250;
const world = buildSim({ W: 480, H: 240, seed: SEED });

const series = new Map();   // polityId -> [{age, tiles, people}]
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % SAMPLE) continue;
  const tiles = new Map();
  const co = world._countryOwner;
  if (co) for (let i = 0; i < co.length; i++) { const c = co[i]; if (c >= 0) tiles.set(c, (tiles.get(c) || 0) + 1); }
  const ppl = new Map();
  for (const st of world.settlements) if (st.mode === "settled" && st.countryId >= 0) ppl.set(st.countryId, (ppl.get(st.countryId) || 0) + (st.people || 0));
  for (const [cid, n] of tiles) {
    const p = politiesOf(world).get(cid);
    if (!p) continue;
    let arr = series.get(cid); if (!arr) series.set(cid, arr = []);
    arr.push({ age: s - p.foundedStep, tiles: n, people: Math.round(ppl.get(cid) || 0) });
  }
}
const reg = politiesOf(world);
const rows = [];
for (const [cid, arr] of series) {
  const p = reg.get(cid);
  if (!p || arr.length < 8) continue;
  const peak = Math.max(...arr.map((r) => r.tiles));
  const peakAt = arr.find((r) => r.tiles === peak)?.age;
  const end = arr[arr.length - 1];
  rows.push({ name: p.name || cid, kind: p.foundedStep <= 10 ? "CRADLE" : "natural", founded: p.foundedStep, peak, peakAt, endTiles: end.tiles, endAge: end.age, endPeople: end.people });
}
rows.sort((a, b) => a.founded - b.founded);
console.log("kind    founded  peakTiles @age   tiles@end (age)   people@end  name");
for (const r of rows.slice(0, 16)) {
  console.log(`${r.kind.padEnd(7)} ${String(r.founded).padStart(6)}  ${String(r.peak).padStart(8)} @${String(r.peakAt).padStart(5)}   ${String(r.endTiles).padStart(8)} (${r.endAge})   ${String(r.endPeople).padStart(9)}  ${r.name}`);
}
const agg = (kind) => {
  const g = rows.filter((r) => r.kind === kind && r.endAge > 2000);
  const ratio = g.map((r) => r.peak / Math.max(1, r.endTiles));
  return { n: g.length, meanPeak: Math.round(g.reduce((s, r) => s + r.peak, 0) / Math.max(1, g.length)), meanRatio: +(ratio.reduce((s, x) => s + x, 0) / Math.max(1, ratio.length)).toFixed(2) };
};
const cr = agg("CRADLE"), nat = agg("natural");
const died = rows.filter((r) => r.kind === "CRADLE" && (r.endPeople === 0 || r.endAge < STEPS - 2 * SAMPLE)).length;
console.log(`cradle: ${JSON.stringify(cr)} died=${died} | natural: ${JSON.stringify(nat)}`);
console.log(`firstNatural=${rows.find((r) => r.kind === "natural")?.founded ?? -1} eras: ${(world._eraAt || []).map((s2, i) => `${i}@${s2}`).join(" ")}`);
