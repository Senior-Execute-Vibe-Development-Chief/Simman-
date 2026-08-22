// Predation probe: WHY does the giant not ATTACK its small neighbours?
// (Owner 2026-08-21: "my problem wasnt they werent submitting, it was: why
// didnt the large empire attack them?")
// Per-pair war-bar attribution (armies.js mkWarDebug + the pred slice: attacker
// >=4x defender by _countryPow, and the watch/byAtt per-giant slice), the
// global attack tel funnel, ground-truth war.began events classified by pow
// ratio, and a top-3-giants dashboard with a NEIGHBOR CENSUS: every bordering
// realm with pow ratio, bloc bond, truce, war state — the "why not attack THIS
// one" table.
//   SIM_TUNE="<live stack>" node tools/probe_predation.mjs [steps] [W] [seed]
// Findings measured with it (docs/consolidation-2026-08-20.md addendum III):
// commandCapacity refused 61-65% of attack-capable moments while predatory
// pair-passes cleared the bar → SMALL_WAR; then the paper-coalition brake
// (10,697/window pred) → RELIEF_REACH. Cumulative: pred wars +25%, crush +30%.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { mkWarDebug, foldWarDebug } from "../src/sim/peopleSim/armies.js";

const STEPS = +(process.argv[2] || 28000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 4000;

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
if (!world.debug) world.debug = {};
const WD = world.debug.war = mkWarDebug();
WD.powOf = (cid) => (world._countryPow && world._countryPow.get(cid)) || 0;
WD.watch = new Set(); WD.byAtt = new Map();

const fmtTot = (t) => Object.entries(t).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join("  ");
let evSeen = -1;

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  foldWarDebug(WD);
  const pow = world._countryPow || new Map();
  let wars = 0, predWars = 0, crushWars = 0;
  for (const ev of world.events || []) {
    if (ev.id <= evSeen) continue;
    if (ev.type !== "war.began") continue;
    wars++;
    const ap = pow.get(ev.from) || 0, dp = pow.get(ev.to) || 0;
    if (ap >= 4 * dp && ap > 0) predWars++;
    if (ap >= 10 * dp && ap > 0) crushWars++;
  }
  { const evs = world.events || []; if (evs.length) evSeen = evs[evs.length - 1].id; }
  console.log(`\n=== step ${world.step}  realms=${world.countries ? world.countries.size : 0}  wars.began=${wars} (pred>=4x ${predWars}, crush>=10x ${crushWars})`);
  console.log(`    ALL : ${fmtTot(WD.tot)}`);
  console.log(`    PRED: ${fmtTot(WD.pred)}`);
  const tr = telReport(world);
  if (tr.attack) console.log(`    tel.attack: ` + Object.entries(tr.attack).map(([k, v]) => `${k}=${v}`).join("  "));
  telReset(world);

  const ranked = [...pow.entries()].filter(([id]) => world.countries && world.countries.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ov = world._overlordOf || new Map();
  const rootOf = (id) => { let cur = id, hops = 0; while (hops++ < 12) { const o = ov.get(cur); if (o == null || o < 0 || o === cur) break; cur = o; } return cur; };
  const nbrs = new Map(); for (const [gid] of ranked) nbrs.set(gid, new Map());
  const co = world._countryOwner;
  if (co) {
    const tw = world.tw, th = world.th;
    const touch = (a, b) => {
      if (a === b || a < 0 || b < 0) return;
      const ma = nbrs.get(a); if (ma) ma.set(b, (ma.get(b) || 0) + 1);
      const mb = nbrs.get(b); if (mb) mb.set(a, (mb.get(a) || 0) + 1);
    };
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const i = y * tw + x, a = co[i];
      touch(a, co[y * tw + ((x + 1) % tw)]);
      if (y + 1 < th) touch(a, co[(y + 1) * tw + x]);
    }
  }
  const truces = world._truces || new Map();
  const inTruce = (a, b) => truces.has(Math.min(a, b) + ":" + Math.max(a, b));
  for (const [cid, p] of ranked) {
    const c = world.countries.get(cid);
    const off = c && c._offEnemies ? c._offEnemies.size : 0;
    const exh = (world._warExhaust && world._warExhaust.get(cid)) || 0;
    const nm = c && c.capital ? (c.capital.name || cid) : cid;
    const at = WD.byAtt.get(cid);
    console.log(`    giant ${nm}(#${cid}) pow=${p.toFixed(0)} offensives=${off} exhaust=${exh.toFixed(2)} members=${c ? c.members.filter(m => m.mode === "settled").length : 0}${at ? `  bars[${fmtTot(at)}]` : ""}`);
    const m = nbrs.get(cid);
    if (m) {
      const rows = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([nid, tiles]) => {
        const np = pow.get(nid) || 0;
        const flags = [];
        if (rootOf(nid) === rootOf(cid)) flags.push(ov.get(nid) === cid || rootOf(nid) === cid ? "MYBLOC" : "bloc");
        if (inTruce(cid, nid)) flags.push("truce");
        if (c && c._offEnemies && c._offEnemies.has(nid)) flags.push("ATWAR");
        return `#${nid}(${tiles}t ${np > 0 ? (p / np).toFixed(1) : "inf"}x${flags.length ? " " + flags.join("+") : ""})`;
      });
      console.log(`      nbrs: ${rows.join("  ")}`);
    }
  }
  WD.watch = new Set(ranked.map(([id]) => id));
  WD.byAtt = new Map();
  WD.tot = Object.fromEntries(Object.keys(WD.tot).map(k => [k, 0]));
  WD.pred = Object.fromEntries(Object.keys(WD.pred).map(k => [k, 0]));
}
