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
