// Realm-level colonization (Tier-B4) probe: does the CHARTER make GREAT POWERS
// colonize — and does the metropole-fall resolution replace the mass-liberation
// cliff with succession where the registry records one?
//
// Measures, over one continuous run:
//   • colonies launched/founded, split charter vs opportunistic (ev.charter)
//   • WHO launches: founder realm's member count + treasury at launch (joined
//     from a rolling snapshot ≤ POLL steps stale)
//   • colony survival at the horizon + overlord-link durations
//   • metropole-death outcomes: inherited vs freed (how=metropole-fell) vs
//     classic earned independence
//   • charter-gate context at checkpoints: per-realm org / treasury / crowding
//     (popField vs capField over owned tiles) so the gate constants can be
//     judged against the real distributions, not assumed.
//
// Run BOTH arms with the same lever (the sanctioned acceleration the Tier-A
// sea agent used, so ocean-going navigation arrives inside the horizon):
//   SIM_TUNE="LEARN_BASE=0.00003" node tools/probe_charter.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "14000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const POLL = 100;
const world = buildSim({ W: 480, H: 240, seed: SEED });

// Realm "size" in THIS sim is owned land tiles + governed field people —
// member count is near-degenerate (cities-only entities: most realms are a
// 1-member city governing tile territory; see tier-b-baseline).
function tilesOf() {
  const co = world._countryOwner, t = new Map();
  if (co) for (let ti = 0; ti < world.N; ti++) { const o = co[ti]; if (o >= 0) t.set(o, (t.get(o) || 0) + 1); }
  return t;
}

const snap = new Map();       // cid -> { tiles, treasury } (rolling)
const launches = [];          // { step, port, polity, charter, tiles, treasury }
const foundings = new Map();  // colony polity id -> { step, from }
let evCursor = 0;
let indepEarned = 0, indepFell = 0, inherited = 0;
const indepAt = new Map();    // colony polity id -> step of independence

function poll() {
  const tl = tilesOf();
  if (world.countries) for (const [cid] of world.countries) {
    const pol = getPolity(world, cid);
    snap.set(cid, { tiles: tl.get(cid) || 0, treasury: pol ? Math.round(pol.treasury || 0) : 0 });
  }
  const evs = world.events || [];
  for (; evCursor < evs.length; evCursor++) {
    const ev = evs[evCursor];
    if (ev.type === "colony.departed") {
      const s = snap.get(ev.polity) || { tiles: -1, treasury: -1 };
      launches.push({ step: ev.step, port: ev.s, polity: ev.polity, charter: ev.charter ? 1 : 0, tiles: s.tiles, treasury: s.treasury });
    } else if (ev.type === "colony.founded") {
      foundings.set(ev.polity, { step: ev.step, from: ev.from });
    } else if (ev.type === "colony.independent") {
      if (ev.how === "metropole-fell") indepFell++; else indepEarned++;
      if (!indepAt.has(ev.polity)) indepAt.set(ev.polity, ev.step);
    } else if (ev.type === "colony.inherited") {
      inherited++;
    }
  }
}

function crowdCheckpoint(label) {
  const co = world._countryOwner, pf = world.popField, cf = world.capField;
  if (!co || !pf || !cf || !world.countries) return;
  const pop = new Map(), cap = new Map(), tl = new Map();
  for (let ti = 0; ti < world.N; ti++) {
    const o = co[ti]; if (o < 0) continue;
    pop.set(o, (pop.get(o) || 0) + pf[ti]);
    cap.set(o, (cap.get(o) || 0) + cf[ti]);
    tl.set(o, (tl.get(o) || 0) + 1);
  }
  const rows = [];
  for (const [cid, c] of world.countries) {
    const pol = getPolity(world, cid);
    const K = cap.get(cid) || 0;
    const ports = c.members.filter(m => m._isPort && (m.knowledge?.navigation || 0) >= 0.25).length;
    // The charter's solvency gate, recomputed for visibility (sea.js
    // charterAffordable): treasury - endow >= one outfitting cycle of the
    // realm's own per-pass spending EMA.
    const reserve = pol ? (1200 / Math.max(1, T.POLITY_INTERVAL)) * Math.max(0, pol._spend || 0) : 0;
    const afford = pol ? (pol.treasury || 0) - 5000 >= reserve : false;
    rows.push({ cid, mem: c.members.length, tiles: tl.get(cid) || 0, ports,
      org: +(c.capital?.knowledge?.organization || 0).toFixed(2),
      nav: +(c.capital?.knowledge?.navigation || 0).toFixed(2),
      treas: pol ? Math.round(pol.treasury || 0) : 0, afford,
      crowd: K > 1e-9 ? +((pop.get(cid) || 0) / K).toFixed(2) : 0,
      cap: c._capacity != null ? +c._capacity.toFixed(1) : null, load: c._loadTotal != null ? +c._loadTotal.toFixed(1) : null });
  }
  rows.sort((a, b) => b.tiles - a.tiles);
  console.log(`\n[${label}] realms: ${rows.length} — top by owned tiles (cid mem tiles navPorts org nav treasury crowd load/cap):`);
  for (const r of rows.slice(0, 12)) console.log(`  ${r.cid}\tmem=${r.mem}\ttiles=${r.tiles}\tnavPorts=${r.ports}\torg=${r.org}\tnav=${r.nav}\ttreas=${r.treas}${r.afford ? "*" : ""}\tcrowd=${r.crowd}\tload/cap=${r.load}/${r.cap}`);
  const crowds = rows.map(r => r.crowd).sort((a, b) => a - b);
  const q = (f) => crowds.length ? crowds[Math.min(crowds.length - 1, Math.floor(f * crowds.length))] : 0;
  console.log(`  crowd quartiles: ${q(0.25)} / ${q(0.5)} / ${q(0.75)}  can-afford-charter (treas*): ${rows.filter(r => r.afford).length}  org>=0.6: ${rows.filter(r => r.org >= 0.6).length}`);
}

const t0 = performance.now();
const CHECK = Math.max(1000, Math.round(STEPS / 4 / 500) * 500);
for (let i = 1; i <= STEPS; i++) {
  stepPeopleSim(world, 1);
  if (i % POLL === 0) poll();
  if (i % CHECK === 0 || i === STEPS) crowdCheckpoint(`step ${i}`);
}
poll();

console.log(`\n=== probe_charter seed ${SEED} steps ${STEPS} (${((performance.now() - t0) / 1000).toFixed(0)}s) ===`);
const ch = launches.filter(l => l.charter), op = launches.filter(l => !l.charter);
console.log(`launches: ${launches.length} total — charter ${ch.length}, opportunistic ${op.length}`);
const tileDist = (ls) => {
  const b = { "0-4": 0, "5-14": 0, "15-39": 0, "40+": 0, "?": 0 };
  for (const l of ls) { const m = l.tiles; if (m < 0) b["?"]++; else if (m <= 4) b["0-4"]++; else if (m <= 14) b["5-14"]++; else if (m <= 39) b["15-39"]++; else b["40+"]++; }
  return JSON.stringify(b);
};
console.log(`  founder realm OWNED TILES at launch — charter: ${tileDist(ch)}  opportunistic: ${tileDist(op)}`);
const tr = (ls) => ls.length ? Math.round(ls.reduce((a, l) => a + Math.max(0, l.treasury), 0) / ls.length) : 0;
const med = (ls, f) => { const a = ls.map(f).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
console.log(`  founder realm treasury at launch — charter mean ${tr(ch)} median ${med(ch, l => Math.max(0, l.treasury))}  opportunistic mean ${tr(op)} median ${med(op, l => Math.max(0, l.treasury))}`);
console.log(`  founder realm tiles median — charter ${med(ch, l => Math.max(0, l.tiles))}  opportunistic ${med(op, l => Math.max(0, l.tiles))}`);
if (ch.length) {
  const byRealm = new Map();
  for (const l of ch) byRealm.set(l.polity, (byRealm.get(l.polity) || 0) + 1);
  console.log(`  chartering realms: ${byRealm.size} — ` + [...byRealm].map(([c, n]) => `${c}:${n}`).join(" "));
}

console.log(`colonies founded (landed + wired): ${foundings.size}`);
let alive = 0, bound = 0, durSum = 0, durN = 0;
for (const [cid, f] of foundings) {
  const s = world._byId ? world._byId.get(cid) : null;
  const pol = getPolity(world, cid);
  const liveNow = s && s.mode === "settled";
  if (liveNow) alive++;
  const sever = indepAt.get(cid);
  if (pol && pol._overlord != null && (!pol.endedStep || pol.endedStep < 0)) { bound++; durSum += world.step - f.step; durN++; }
  else if (sever != null) { durSum += sever - f.step; durN++; }
}
console.log(`  alive at horizon: ${alive}/${foundings.size}  still bound to an overlord: ${bound}`);
console.log(`  overlord-link duration (to independence or horizon): mean ${durN ? Math.round(durSum / durN) : 0} steps over ${durN} links`);
console.log(`independence: earned ${indepEarned}, metropole-fell ${indepFell}; inherited by successor: ${inherited}`);

// Metropole deaths that HELD dependencies when they fell (context for the cliff).
let deadMetropoles = 0;
if (world.polities) {
  const deps = new Map();   // metropole id seen in colony.founded 'from'
  for (const f of foundings.values()) deps.set(f.from, (deps.get(f.from) || 0) + 1);
  for (const [id, n] of deps) { const p = getPolity(world, id); if (p && p.endedStep >= 0) { deadMetropoles++; console.log(`  metropole ${id} (${p.name}) died step ${p.endedStep} holding ${n} founded colonies; succId=${p.succId ?? "none"}`); } }
}
if (!deadMetropoles) console.log(`  (no colony-holding metropole died this run)`);
