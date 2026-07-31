// ── The full-record Earth run: the deepest diagnostic we have ────────────────
// Runs the real full pipeline at any size and records EVERYTHING the sim exposes,
// in four layers, so a whole world's history can be reviewed post-hoc:
//   A. FINE SERIES  (every SERIES steps → <out>.series.jsonl): ~40 aggregates —
//      population/tiers/urbanisation (people-share in cores), countries + top5 member counts, wealth/treasury/trade/
//      price-level/solvency, money+people conservation totals (invariants ON),
//      leader knowledge per track, era census, wars/fronts/army, plague/famine,
//      registry sizes (persons/dynasties/cultures/faiths), event count, steps/s, RSS.
//   B. DEEP CHECKPOINTS (every CKPT steps → <out>.json): per-country table
//      (tiles/members/pop/wealth/army/org/density/personality/age), demography,
//      tech tracks, military, longevity (births/deaths/lifespans), top empires.
//   C. THE COMPLETE EVENT LOG (<out>.events.jsonl): every structured event the
//      engine recorded (up to its 200k cap), plus per-type counts by 5k-step window.
//   D. HISTORY ARTIFACTS (<out>.history.json): era timeline with display years,
//      arc status, hall of fame, each top realm's king-list and narrated chronicle
//      tail, final registries, invariant-violation tally. Plus the full world save
//      (<out>.world.json) for post-hoc inspection in the app or tools.
//   RES_INVARIANT_POP etc. honoured via env (defaults apply otherwise).
//     node tools/earthFullRecord.mjs [steps=80000] [seed=8817] [W=1920] [out]
import fs from "fs";
import { buildSim, applyToolTuning } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { techState, ERAS } from "../src/sim/peopleSim/tech.js";
import { displayYear } from "../src/sim/calendar.js";
import { narrate, eventsOf } from "../src/sim/peopleSim/events.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { serializeWorld } from "../src/sim/persist.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS_ARG = +(process.argv[2] || 80000), SEED = +(process.argv[3] || 8817);
const W = +(process.argv[4] || 1920), H = W >> 1;
const OUT = process.argv[5] || `/tmp/fullrecord_${SEED}_${W}`;
const SERIES = 250, CKPT = 10000;
for (const k of ["RES_INVARIANT_POP", "CAP_MODEL", "ANCHOR_POP", "CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CREDIT_RATE"]) if (process.env[k] != null) { T[k] = +process.env[k]; console.log(`[rec] lever ${k}=${T[k]}`); }
const KTRK = ["agriculture", "metallurgy", "organization", "navigation", "mobility", "construction"];
const r2 = x => Math.round(x * 100) / 100;
const sum = a => a.reduce((x, y) => x + y, 0);
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

let t0 = performance.now();
// RESUME=path loads a checkpoint world snapshot (persist.js) instead of rebuilding —
// recording continues from its step; pass the SAME out prefix vars but a fresh suffix
// so series files don't interleave.
const RESUME = process.env.RESUME || null;
const world = RESUME
  ? (await import("../src/sim/persist.js")).loadWorld(fs.readFileSync(RESUME, "utf8"))
  : buildSim({ W, H, seed: SEED });
applyToolTuning();   // loadWorld restores the SAVE's tuning — resumed chunks keep the tool defaults (perf-only, trajectory-neutral)
world._checkInvariants = true;   // per-tick finiteness/range checks + conservation totals
world._dbgProfile = true;        // per-pass timing (world.debug.pass) — names the culprit when the pace cliffs
const STEPS = STEPS_ARG;   // absolute target step
console.log(`[rec] ${RESUME ? `RESUMED at step ${world.step}` : `built ${W}x${H}`} (tw=${world.tw}) seed=${SEED} in ${((performance.now() - t0) / 1000).toFixed(1)}s → recording to ${OUT}.* (target step ${STEPS})`);
// A RESUMED run APPENDS to the series — the resumable battery (battery_resumable.mjs)
// re-invokes this recorder per chunk with the same prefix, and truncating here wiped
// every prior chunk's rows (measured: a 24k battery arm left holding one chunk's
// series). Fresh runs still start clean.
if (!RESUME) fs.writeFileSync(OUT + ".series.jsonl", "");

// realm lifecycle tracker (hall of fame)
const track = new Map(); let prevIds = new Set(), born = 0, died = 0;
const record = { seed: SEED, W, tw: world.tw, steps: STEPS, levers: { RES_INVARIANT_POP: T.RES_INVARIANT_POP, CAP_MODEL: T.CAP_MODEL, ANCHOR_POP: T.ANCHOR_POP }, checkpoints: [] };

function series(dt) {
  const setts = world.settlements.filter(s => s.mode === "settled");
  const st = peopleSimStats(world);
  const tiers = [0, 0, 0, 0]; for (const s of setts) tiers[Math.min(3, s.tier | 0)]++;
  // True demographic urbanization = share of PEOPLE living in urban cores
  // (mirror tools/stylized.mjs:305) — NOT the share of settlements that are
  // tier>=2 (each settlement is a whole province; that count-share read ~62%
  // while the real people-in-cities share is ~8-13%).
  const hasRural = setts.some(s => (s._ruralPop || 0) > 0);
  let uPop = 0, tPop = 0;
  for (const s of setts) { tPop += s.people || 0; uPop += hasRural ? (s._urbanPop || 0) : ((s.tier | 0) >= 2 ? (s.people || 0) : 0); }
  // leader + era census
  let lead = null, leadOrg = 0; const eraH = new Array(ERAS.length).fill(0);
  for (const c of (world.countries || new Map()).values()) {
    const k = c.capital && c.capital.knowledge; if (!k) continue;
    eraH[techState(k).era]++;
    if (k.organization > leadOrg) { leadOrg = k.organization; lead = c.capital; }
  }
  const lk = lead ? lead.knowledge : {};
  // economy
  let tradeFlow = 0; if (world._linkMoney) for (const [, n] of world._linkMoney) tradeFlow += Math.abs(n);
  let treas = 0, inso = 0, minSv = 1, sizes = [];
  const memb = new Map(); for (const s of setts) if (s.countryId >= 0) memb.set(s.countryId, (memb.get(s.countryId) || 0) + 1);
  for (const [cid, c] of (world.countries || new Map())) {
    // LIVE polity treasury (matches peopleSimStats/HUD, index.js:411) — NOT the
    // per-pass c._treasury snapshot, which sawtooths ~50% because between passes
    // tariff/mint flows drain purses into the live treasury the snapshot misses.
    const pol = world.polities ? world.polities.get(cid) : null;
    if (pol && pol.endedStep < 0) treas += Math.max(0, pol.treasury || 0);
    const sv = c._solvency ?? 1;
    if (sv < 0.05) inso++; if (sv < minSv) minSv = sv;
    sizes.push(memb.get(cid) || 0);
  }
  sizes.sort((a, b) => b - a);
  let globalP = 1; if (world._inflRaw && world._networkComponents) { let num = 0, den = 0;
    for (const s of setts) { const root = world._networkComponents.has(s.id) ? world._networkComponents.get(s.id) : s.id;
      const p = world._inflRaw.get(root); if (p == null) continue; num += p * (s.people || 0); den += s.people || 0; }
    if (den > 0) globalP = num / den; }
  let fronts = 0, warring = 0; if (world._fronts && world._fronts.byCountry) { warring = world._fronts.byCountry.size; for (const v of world._fronts.byCountry.values()) fronts += v.size; }
  const row = {
    step: world.step, year: Math.round(displayYear(world.step)),
    leadEra: ERAS[Math.max(0, eraH.reduce((m, v, i) => v > 0 ? i : m, 0))], leadOrg: r2(leadOrg),
    lead: Object.fromEntries(KTRK.map(k => [k.slice(0, 4), r2(lk[k] || 0)])),
    eras: eraH.join(","),
    pop: Math.round(st.totalPeople), setts: setts.length, tiers: tiers.join(","), urbanPct: r2(tPop > 0 ? 100 * uPop / tPop : 0),
    countries: (world.countries || new Map()).size, top5Members: sizes.slice(0, 5).join(","),
    landPct: r2(100 * (st.landPct || 0)),   // claimed share of land — the res-invariance battery's windowed metric (backlog #12)
    wealth: Math.round(sum(setts.map(s => s.wealth || 0))), treasury: Math.round(treas), tradeFlow: Math.round(tradeFlow), links: world._linkMoney ? world._linkMoney.size : 0,
    P: r2(globalP), insolvent: inso, minSolv: r2(minSv),
    coin: Math.round(world.debug?.totalCoin || 0), people: Math.round(world.debug?.totalPeople || 0),   // conservation watch
    army: Math.round(sum(setts.map(s => s.army || 0))), warring, fronts,
    plagued: world._plagued ? world._plagued.size : 0,
    persons: world.persons ? world.persons.size : 0, dynasties: world.dynasties ? world.dynasties.size : 0,
    cultures: world.cultures ? world.cultures.size : 0, faiths: world.faiths ? world.faiths.size : 0,
    events: eventsOf(world).length, sps: r2(SERIES / Math.max(0.001, dt)), rssMB: Math.round(process.memoryUsage().rss / 1048576),
    slow: (() => { const p = world.debug && world.debug.pass; if (!p) return "";   // 3 slowest passes last tick (ms) — the perf-cliff fingerprint
      return Object.entries(p).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(" "); })(),
  };
  fs.appendFileSync(OUT + ".series.jsonl", JSON.stringify(row) + "\n");
  return row;
}

function deep() {
  const setts = world.settlements.filter(s => s.mode === "settled");
  const co = world._countryOwner; const size = new Map();
  if (co) for (let i = 0; i < world.N; i++) { const c = co[i]; if (c >= 0 && world.elev[i] > 0) size.set(c, (size.get(c) || 0) + 1); }
  const agg = new Map();
  for (const s of setts) { if (s.countryId < 0) continue; let a = agg.get(s.countryId); if (!a) { a = { mem: 0, pop: 0, wealth: 0, army: 0 }; agg.set(s.countryId, a); } a.mem++; a.pop += s.people || 0; a.wealth += s.wealth || 0; a.army += s.army || 0; }
  const rows = [];
  for (const [id, c] of (world.countries || new Map())) {
    const a = agg.get(id) || { mem: 0, pop: 0, wealth: 0, army: 0 };
    const pol = getPolity(world, id);
    const p = pol && pol.personality;   // temperament lives on the polity record (world.personalities is dead)
    rows.push({ id, name: pol ? pol.name : "?", tiles: size.get(id) || 0, mem: a.mem, pop: Math.round(a.pop), wealth: Math.round(a.wealth), army: Math.round(a.army),
      org: r2((c.capital && c.capital.knowledge && c.capital.knowledge.organization) || 0),
      solv: r2(c._solvency ?? 1), treas: Math.round(c._treasury || 0), fineness: r2(c._fineness ?? 1), dominance: r2(c._dominance || 1),
      label: p ? p._label : "?", age: world.step - ((track.get(id) || {}).first ?? world.step),
      gov: pol ? pol.gov : "?", faith: pol ? pol.faithId : -1, dyn: pol ? pol.dynastyId : -1 });
  }
  rows.sort((a, b) => b.tiles - a.tiles);
  const dead = [...track.values()].filter(t => !t.alive).map(t => t.last - t.first);
  record.checkpoints.push({ step: world.step, countries: rows.length, born, died, deadLifeMed: med(dead), rows: rows.slice(0, 15) });
  fs.writeFileSync(OUT + ".json", JSON.stringify(record, null, 1));
}

function trackRealms() {
  const ids = new Set((world.countries || new Map()).keys());
  for (const id of ids) if (!prevIds.has(id)) born++;
  for (const id of prevIds) if (!ids.has(id)) { died++; const t = track.get(id); if (t) t.alive = false; }
  for (const id of ids) { let t = track.get(id); if (!t) { t = { first: world.step, last: world.step, alive: true, peak: 0 }; track.set(id, t); } t.last = world.step; t.alive = true; const c = world.countries.get(id); t.peak = Math.max(t.peak, c && c.members ? c.members.length : 0); }
  prevIds = ids;
}

// ── run ──
t0 = performance.now();
for (let s = world.step; s < STEPS; s += SERIES) {
  const c0 = performance.now();
  stepPeopleSim(world, Math.min(SERIES, STEPS - s));
  trackRealms();
  const row = series((performance.now() - c0) / 1000);
  if (world.step % CKPT === 0 || s + SERIES >= STEPS) {
    deep(); console.log(`[rec] step ${world.step}  yr ${row.year}  era ${row.leadEra}  pop ${row.pop}  setts ${row.setts}  cnt ${row.countries}  ${row.sps} sps  rss ${row.rssMB}MB`);
    // FULL FLUSH — events, provisional history artifacts AND a resumable world
    // snapshot at every checkpoint, so a container restart costs at most CKPT steps
    // (the first full-size run died at step ~32k holding the event log in memory).
    // sync write: a buffered stream never flushed when the process was killed mid-run
    fs.writeFileSync(OUT + ".events.jsonl", eventsOf(world).map(e => JSON.stringify(e)).join("\n") + "\n");
    writeHistory();
    fs.writeFileSync(OUT + ".world.json", serializeWorld(world));
  }
}
console.log(`[rec] ${STEPS} steps in ${((performance.now() - t0) / 1000 / 60).toFixed(1)} min`);

// ── C+D final flush (same writer the checkpoints use) ──
function writeHistory() {
  const evs = eventsOf(world);
  const byWin = {};
  for (const e of evs) { const w0 = Math.floor((e.step || 0) / 5000) * 5000; (byWin[w0] = byWin[w0] || {})[e.type] = ((byWin[w0] || {})[e.type] || 0) + 1; }
  const eraAt = world._eraAt || [0];
  const hall = [...track.entries()].map(([id, t]) => ({ id, peak: t.peak, life: (t.alive ? world.step : t.last) - t.first, alive: t.alive }))
    .sort((a, b) => b.peak * Math.log10(1 + b.life) - a.peak * Math.log10(1 + a.life)).slice(0, 15);
  const topRealms = record.checkpoints.length ? record.checkpoints[record.checkpoints.length - 1].rows.slice(0, 6) : [];
  const chronicles = topRealms.map(r => {
    const pol = getPolity(world, r.id);
    const kings = pol && pol.rulers ? pol.rulers.slice(-12).map(k => `${k.fromY}–${k.toY < 0 ? "" : k.toY} ${k.title || ""} ${k.name}${k.house ? " of House " + k.house : ""} (${k.how})`) : [];
    const tail = evs.filter(e => e.polity === r.id || e.from === r.id || e.to === r.id).slice(-25).map(e => `[${e.step}] ${narrate(world, e, r.id) || e.type}`);
    return { id: r.id, name: r.name, kings, chronicle: tail };
  });
  fs.writeFileSync(OUT + ".history.json", JSON.stringify({
    step: world.step,
    eraTimeline: eraAt.map((s, i) => ({ era: ERAS[i], step: s, year: Math.round(displayYear(s)) })),
    arcComplete: eraAt.length > ERAS.length - 1, arcStep: eraAt[ERAS.length - 1] ?? null,
    invariantHits: world.debug?.invariantHits || {},
    eventTypeTotals: evs.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {}),
    eventWindows: byWin, hall, chronicles,
    registries: { persons: world.persons?.size, dynasties: world.dynasties?.size, cultures: world.cultures?.size, faiths: world.faiths?.size, polities: world.polities?.size, events: evs.length },
  }, null, 1));
}
writeHistory();
fs.writeFileSync(OUT + ".world.json", serializeWorld(world));
console.log(`[rec] artifacts: ${OUT}.series.jsonl / .json / .events.jsonl / .history.json / .world.json`);
