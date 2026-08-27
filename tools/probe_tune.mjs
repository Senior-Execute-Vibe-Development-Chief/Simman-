// Measure the composed line against the quality criteria a melody has to meet:
// contour shape, leap discipline, motivic economy, rhythmic identity, cadence.
//
//   node tools/probe_tune.mjs           the table, five traditions + 60 peoples
//   node tools/probe_tune.mjs --dump    the actual phrases, so you can read them
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { phraseBank, formOrderOf, signatureOf, OCCASIONS } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
function build(seed, trad) {
  const w = W();
  const lang = foundLanguage(w, { seed: seed >>> 0 });
  const m = musicOf(foundPeople(seed >>> 0, lang, {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
}

function stats(degs) {
  const n = degs.length;
  if (n < 2) return null;
  const iv = [];
  for (let i = 1; i < n; i++) iv.push(degs[i] - degs[i - 1]);
  let peaks = 0;
  for (let i = 1; i < n - 1; i++) if (degs[i] > degs[i - 1] && degs[i] >= degs[i + 1]) peaks++;
  const hi = Math.max(...degs), lo = Math.min(...degs);
  const at = degs.indexOf(hi) / (n - 1);
  const leaps = iv.filter(d => Math.abs(d) > 3).length;
  const distinctAt = (k) => {
    if (iv.length < k) return null;
    const c = new Set();
    for (let i = 0; i + k <= iv.length; i++) c.add(iv.slice(i, i + k).join(","));
    return c.size / (iv.length - k + 1);
  };
  const econ = distinctAt(3) ?? distinctAt(2) ?? 1;
  const econ1 = distinctAt(1) ?? 1;
  const rep = new Set(degs).size / n;
  return { n, peaks, range: hi - lo, at, leaps, econ, econ1, rep, iv };
}

const rows = [];
const push = (tag, m) => {
  for (const occ of Object.keys(OCCASIONS)) {
    const bank = phraseBank(m, occ);
    const s0 = stats(bank[0].degs);
    if (!s0) continue;
    // rhythmic identity between statement and its answer
    const r0 = bank[0].pat.onsets.join(","), r1 = bank[1] ? bank[1].pat.onsets.join(",") : "";
    // WHAT A LISTENER ACTUALLY HEARS is not one phrase but the form: the
    // phrases in the order the tradition puts them, end to end.
    const order = formOrderOf(m);
    const line = [];
    for (const i of order) for (const d of (bank[i % bank.length] || bank[0]).degs) line.push(d);
    const sf = stats(line);
    rows.push({ tag, occ, ...s0, formIvs: sf ? sf.econ1 : 1, formCells: sf ? sf.econ : 1,
      sameRhythm: r0 === r1 ? 1 : 0,
      endsHome: ((bank[0].degs[s0.n - 1] % m.mode.size) + m.mode.size) % m.mode.size === 0 ? 1 : 0 });
  }
};
for (const k of Object.keys(TRADITIONS)) push(k, build(7, k));
for (let s = 1; s <= 60; s++) push("derived", build(s * 1013, null));

const agg = (tag) => {
  const R = rows.filter(r => r.tag === tag);
  if (!R.length) return null;
  const mean = (f) => R.reduce((a, r) => a + f(r), 0) / R.length;
  return {
    n: R.length,
    notes: mean(r => r.n).toFixed(1),
    peaks: mean(r => r.peaks).toFixed(2),
    range: mean(r => r.range).toFixed(1),
    peakAt: mean(r => r.at).toFixed(2),
    leaps: mean(r => r.leaps).toFixed(2),
    cells: mean(r => r.econ).toFixed(2),
    ivs: mean(r => r.econ1).toFixed(2),
    fIvs: mean(r => r.formIvs).toFixed(2),
    fCel: mean(r => r.formCells).toFixed(2),
    distinct: mean(r => r.rep).toFixed(2),
    sameRhy: (100 * mean(r => r.sameRhythm)).toFixed(0) + "%",
    home: (100 * mean(r => r.endsHome)).toFixed(0) + "%",
  };
};
const tags = [...Object.keys(TRADITIONS), "derived"];
console.log("tag".padEnd(11), "notes peaks range peakAt leaps cells  ivs fIvs fCel distinct sameRhy home");
for (const t of tags) {
  const a = agg(t); if (!a) continue;
  console.log(t.padEnd(11), a.notes.padStart(5), a.peaks.padStart(5), a.range.padStart(5),
    a.peakAt.padStart(6), a.leaps.padStart(5), a.cells.padStart(5), a.ivs.padStart(4), a.fIvs.padStart(4), a.fCel.padStart(4), a.distinct.padStart(8),
    a.sameRhy.padStart(7), a.home.padStart(5));
}

if (process.argv.includes("--dump")) {
  for (const k of Object.keys(TRADITIONS)) {
    const m = build(7, k), b = phraseBank(m, "peace");
    console.log("\n" + k, "| figure:", signatureOf(m).join(" "), "| form:", formOrderOf(m).join(""));
    for (const e of b) console.log("  " + e.label.padEnd(10), e.degs.join(" ").padEnd(46), "@", e.pat.onsets.join(","));
  }
}
