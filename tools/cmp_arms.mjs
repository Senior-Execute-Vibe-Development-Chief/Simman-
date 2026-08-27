// PAIRED-ARM COMPARISON AGAINST A CHAOS BAND — the second half of the arming
// discipline. probe_milbalance.mjs proves an arm EXECUTED the mechanism;
// this proves the difference it produced is bigger than the difference the
// world produces on its own.
//
// WHY A BAND AND NOT A DIFFERENCE. This simulation is chaotic: two runs that
// differ by a float epsilon in an unrelated lever diverge into visibly different
// worlds, and one of the retracted findings of 2026-08-26 ("the cradle inversion
// is a LAND finding") died exactly here — a no-mechanism draw reproduced the
// whole effect. So the treated arm's difference from baseline is only evidence
// if it exceeds the spread among arms that contain NO mechanism at all.
//
// The no-mechanism draws are perturbations of an irrelevant lever at float
// epsilon (MINING_RATE = 5.0000001 against a default of 5.0). Every unordered
// pair among {base, chaos...} is a no-mechanism comparison, so three arms give
// three band samples, not one.
//
// Reads the MACHINE lines probe_milbalance.mjs emits per window:
//   MACHINE lo hi realms claimed% founded ended seceded shattered warBegan captured urbanSU ruralSU blockRan% bind%
//
//   node tools/cmp_arms.mjs treated=<log> base=<log> chaos=<log> [chaos=<log> ...]
import { readFileSync } from "node:fs";

const COLS = ["lo", "hi", "realms", "claimed", "founded", "ended", "seceded", "shattered", "warBegan", "captured", "urbanSU", "ruralSU", "blockRan", "bind"];
// Rates are per realm because the treated arm may simply HOLD more realms:
// a raw count would then manufacture "more churn" out of arithmetic alone.
const RATES = ["founded", "ended", "seceded", "shattered", "warBegan", "captured"];
const LEVELS = ["realms", "claimed", "urbanSU", "ruralSU"];

const args = process.argv.slice(2).map(a => { const i = a.indexOf("="); return [a.slice(0, i), a.slice(i + 1)]; });
const treatedPath = args.find(a => a[0] === "treated")?.[1];
const nomech = args.filter(a => a[0] === "base" || a[0] === "chaos");
if (!treatedPath || nomech.length < 2) {
  console.error("usage: node tools/cmp_arms.mjs treated=<log> base=<log> chaos=<log> [chaos=<log> ...]");
  process.exit(2);
}

function load(path) {
  const rows = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*MACHINE\s+(.*)$/);
    if (!m) continue;
    const v = m[1].trim().split(/\s+/).map(Number);
    const r = {}; COLS.forEach((c, i) => { r[c] = v[i]; });
    // Mean realms across the window, matching probe_milbalance's own
    // normalisation: the register grows fast enough here that the endpoint
    // alone would flatter or punish a window by which end you read it from.
    r._prevRealms = rows.length ? rows[rows.length - 1].realms : r.realms;
    r.meanRealms = Math.max(1, (r.realms + r._prevRealms) / 2);
    for (const k of RATES) r[k + "PerRealm"] = r[k] / r.meanRealms;
    rows.push(r);
  }
  return rows;
}

const treated = load(treatedPath);
const arms = nomech.map(([, p]) => ({ path: p, rows: load(p) }));
const label = (p) => p.split("/").pop().replace(/\.log$/, "");

// THE ARMING GUARD, ENFORCED HERE TOO. A comparison of arms that never ran the
// code is arithmetic on noise, and the point of printing blockRan is lost if the
// comparison tool ignores it.
const armed = treated.filter(r => r.blockRan > 0).length;
console.log(`[cmp] treated=${label(treatedPath)}  windows=${treated.length}  windows with the block executing: ${armed}/${treated.length}`);
const bindMax = Math.max(0, ...treated.map(r => r.bind));
console.log(`[cmp] treated peak bind%: ${bindMax.toFixed(1)}  (0 => the lever never changed an answer; not evidence of "no effect")`);
for (const a of arms) {
  const bm = Math.max(0, ...a.rows.map(r => r.bind));
  if (bm > 0) console.log(`[cmp] !! ${label(a.path)} is meant to contain NO mechanism but reports bind=${bm.toFixed(1)}% — check the arms.`);
}
if (!armed) { console.log(`[cmp] ABORT: the treated arm never executed the mechanism. Nothing below would mean anything.`); process.exit(3); }

const nWin = Math.min(treated.length, ...arms.map(a => a.rows.length));
console.log(`[cmp] comparing the first ${nWin} window(s) present in every arm\n`);

// THE MATURITY CONFOUND, and why a same-step comparison is not enough.
// A mechanism that makes states form EARLIER puts the treated arm further along
// the same arc at any given step: more realms, more claimed land, and — for free
// — more wars and more deaths, because there is simply more world to fight over.
// Read at matched STEP, that arrives as "CORE_LOCAL multiplies war", which would
// be the SECOND CARDINAL RULE's own failure mode wearing a measurement's clothes:
// naming an outcome the mechanism did not cause.
// So every rate is also read at MATCHED MATURITY — each no-mechanism arm's rate
// linearly interpolated to the treated window's own claimed-land fraction, which
// is monotone in every arm and is the closest thing this world has to an
// odometer. If an effect survives BOTH views it is about the mechanism; if it
// only survives the same-step view it is about the calendar.
function interpAt(rows, key, claimed) {
  const pts = rows.filter(r => Number.isFinite(r[key]) && r.claimed > 0).sort((a, b) => a.claimed - b.claimed);
  if (!pts.length) return null;
  if (claimed <= pts[0].claimed) return pts[0][key];
  if (claimed >= pts[pts.length - 1].claimed) return null;   // outside the span: refuse to extrapolate
  for (let i = 1; i < pts.length; i++) {
    if (claimed <= pts[i].claimed) {
      const a = pts[i - 1], b = pts[i];
      const f = (claimed - a.claimed) / Math.max(1e-12, b.claimed - a.claimed);
      return a[key] + f * (b[key] - a[key]);
    }
  }
  return null;
}

const METRICS = [...LEVELS, ...RATES.map(r => r + "PerRealm")];
for (let w = 0; w < nWin; w++) {
  const t = treated[w];
  console.log(`=== window ${t.lo}->${t.hi}`);
  console.log(`    ${"metric".padEnd(18)}${"treated".padStart(11)}${"no-mech mean".padStart(14)}${"chaos band".padStart(13)}${"effect".padStart(11)}   verdict`);
  for (const k of METRICS) {
    const vals = arms.map(a => a.rows[w][k]);
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    // The band is the LARGEST no-mechanism gap among the draws — the spread the
    // world produces with no mechanism in it at all.
    let band = 0;
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) band = Math.max(band, Math.abs(vals[i] - vals[j]));
    const eff = t[k] - mean;
    const outside = Math.abs(eff) > band;
    const f = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4));
    const ratio = band > 0 ? (Math.abs(eff) / band).toFixed(2) + "x band" : "band=0";
    console.log(`    ${k.padEnd(18)}${f(t[k]).padStart(11)}${f(mean).padStart(14)}${("+/-" + f(band)).padStart(13)}${(eff >= 0 ? "+" : "") + f(eff)}`.padEnd(67) + `   ${outside ? "OUTSIDE (" + ratio + ")" : "inside — no finding"}`);
  }
  console.log("");
}

// ── MATCHED-MATURITY VIEW ─────────────────────────────────────────────────────
console.log(`=== AT MATCHED MATURITY (no-mechanism arms interpolated to the treated window's own claimed-land %)`);
console.log(`    A row is dropped where the no-mechanism arms never reach that much claimed land — extrapolating`);
console.log(`    past the end of a run is how a confound becomes a finding.\n`);
for (let w = 0; w < treated.length; w++) {
  const t = treated[w];
  if (!(t.claimed > 0)) continue;
  console.log(`    window ${t.lo}->${t.hi}  treated claimed=${t.claimed.toFixed(2)}%  realms=${t.realms}`);
  console.log(`      ${"metric".padEnd(18)}${"treated".padStart(11)}${"no-mech @same".padStart(15)}${"chaos band".padStart(13)}${"effect".padStart(11)}   verdict`);
  for (const k of RATES.map(r => r + "PerRealm")) {
    const vals = arms.map(a => interpAt(a.rows, k, t.claimed)).filter(v => v !== null);
    if (vals.length < 2) { console.log(`      ${k.padEnd(18)}${"—".padStart(11)}   (no-mechanism arms never reach ${t.claimed.toFixed(2)}% claimed — not comparable)`); continue; }
    const mean = vals.reduce((x, y) => x + y, 0) / vals.length;
    let band = 0;
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) band = Math.max(band, Math.abs(vals[i] - vals[j]));
    const eff = t[k] - mean;
    const outside = Math.abs(eff) > band;
    const f = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4));
    const ratio = band > 0 ? (Math.abs(eff) / band).toFixed(2) + "x band" : "band=0";
    console.log(`      ${k.padEnd(18)}${f(t[k]).padStart(11)}${f(mean).padStart(15)}${("+/-" + f(band)).padStart(13)}${(eff >= 0 ? "+" : "") + f(eff)}`.padEnd(69) + `   ${outside ? "OUTSIDE (" + ratio + ")" : "inside — no finding"}`);
  }
  console.log("");
}
