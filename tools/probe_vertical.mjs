// WHAT ACTUALLY SOUNDS TOGETHER. The scale is a set of intervals a people
// COULD use; what a listener hears is the intervals that overlap in time. So
// take the rendered event stream and measure the real vertical intervals.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, degreeHz } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf, dissonance } from "../src/sim/musicTuning.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
function build(seed, trad) {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
}
const HARM = (() => {
  const s = Array.from({ length: 8 }, (_, i) => ({ f: 300 * (i + 1), a: Math.pow(0.85, i) }));
  const t = Math.sqrt(s.reduce((a, p) => a + p.a * p.a, 0));
  return s.map(p => ({ f: p.f, a: p.a / t }));
})();

function verticals(m, occ = "peace") {
  const p = composePiece(m, occ);
  const ev = (p.events || [])
    .filter(e => e.role !== "pulse" && e.role !== "mark" && e.deg != null)
    .map(e => ({ t: e.b, dur: e.dur || 0.5, hz: degreeHz(m, 220, e.deg, e.oct || 0), role: e.role }))
    .filter(e => e.hz > 0);
  ev.sort((a, b) => a.t - b.t);
  let pairs = 0, rough = 0, roughH = 0, unis = 0, semis = 0, neut = 0, poly = 0, n = 0;
  const hist = new Map(), rolePairs = new Map();
  for (let i = 0; i < ev.length; i++) {
    const a = ev[i], aEnd = a.t + Math.min(a.dur || 0.2, 1.2);
    let over = 0;
    for (let j = i + 1; j < ev.length && ev[j].t < aEnd; j++) {
      const b = ev[j];
      if (b.t + Math.min(b.dur, 4) <= a.t) continue;
      over++;
      let r = b.hz / a.hz; if (r < 1) r = 1 / r;
      if (r > 4.2) continue;
      // WEIGHT BY HOW LONG THEY ACTUALLY OVERLAP. A passing note a sixteenth
      // long and a held melody note are one "pair" each in a raw count, and a
      // listener does not hear them that way.
      const w = Math.max(0, Math.min(aEnd, b.t + Math.min(b.dur, 4)) - Math.max(a.t, b.t));
      if (!(w > 0)) continue;
      const c = Math.round(1200 * Math.log2(r));
      const oc = ((c % 1200) + 1200) % 1200;
      hist.set(Math.round(oc / 50) * 50, (hist.get(Math.round(oc / 50) * 50) || 0) + w);
      if (oc < 12 || oc > 1188) unis += w;
      if ((oc > 140 && oc <= 178) || (oc >= 1022 && oc < 1060)) neut += w;
      if ((oc >= 30 && oc <= 140) || (oc >= 1060 && oc <= 1170)) {
        semis += w;
        const key = [a.role, b.role].sort().join("+");
        rolePairs.set(key, (rolePairs.get(key) || 0) + w);
      }
      rough += w * dissonance(m.spec, r);
      roughH += w * dissonance(HARM, r);
      pairs += w;
    }
    poly += over; n++;
  }
  return { rolePairs, notes: ev.length, pairs, poly: n ? poly / n : 0,
    rough: pairs ? rough / pairs : 0, roughH: pairs ? roughH / pairs : 0,
    unis: pairs ? unis / pairs : 0, semis: pairs ? semis / pairs : 0,
    neut: pairs ? neut / pairs : 0, hist };
}

console.log("what             notes  pairs  simul | rough(own) rough(harm) | unison%  semitone  neutral-2nd");
const line = (tag, m) => {
  const v = verticals(m);
  console.log(tag.padEnd(16), String(v.notes).padStart(5), v.pairs.toFixed(0).padStart(6),
    v.poly.toFixed(2).padStart(6), "|", v.rough.toFixed(4).padStart(9), v.roughH.toFixed(4).padStart(11),
    "|", (100 * v.unis).toFixed(0).padStart(6) + "%", (100 * v.semis).toFixed(0).padStart(9) + "%",
    (100 * v.neut).toFixed(0).padStart(10) + "%");
  return v;
};
for (const k of Object.keys(TRADITIONS)) line(k, build(7, k));
console.log();
for (const s of [1035, 1000, 1234, 2222, 4242]) line("seed " + s, build(s, null));

if (process.argv.includes("--sweep")) {
  console.log("\ngroup                     n | rough(harm) | semitone-clash% | unison% | simul");
  console.log("harmonic share of ensemble");
  const rows = [];
  for (let i = 0; i < 160; i++) {
    const seed = 1000 + i * 7;
    let m; try { m = build(seed, null); } catch { continue; }
    const v = verticals(m);
    if (!v.pairs) continue;
    const h = m.insts.filter(x => x.harmonic).length / Math.max(1, m.insts.length);
    const st = m.mode.steps.filter(x => x > 0);
    const minStep = Math.min(...st), maxStep = Math.max(...st);
    rows.push({ seed, h, minStep, spread: maxStep / minStep,
      frameOff: Math.abs(m.scale.frame.cents - 1200), by: m.scale.derivedBy,
      tex: m.texture.kind, size: m.mode.size, ...v });
  }
  const show = (name, R) => {
    if (!R.length) return;
    const mean = (g) => R.reduce((a, r) => a + g(r), 0) / R.length;
    console.log(name.padEnd(24), String(R.length).padStart(4), "|",
      mean(r => r.roughH).toFixed(4).padStart(10), "|",
      (100 * mean(r => r.semis)).toFixed(1).padStart(14) + "%", "|",
      (100 * mean(r => r.unis)).toFixed(0).padStart(6) + "%", "|",
      mean(r => r.poly).toFixed(2).padStart(5));
  };
  show("all harmonic", rows.filter(r => r.h === 1));
  show(">= 3/4", rows.filter(r => r.h >= 0.75 && r.h < 1));
  show("1/2 - 3/4", rows.filter(r => r.h >= 0.5 && r.h < 0.75));
  show("1/4 - 1/2", rows.filter(r => r.h >= 0.25 && r.h < 0.5));
  show("< 1/4", rows.filter(r => r.h < 0.25));
  show("ALL", rows);
  console.log("\nsmallest step in the mode");
  show("< 120c (semitone)", rows.filter(r => r.minStep < 120));
  show("120-160c", rows.filter(r => r.minStep >= 120 && r.minStep < 160));
  show("160-200c", rows.filter(r => r.minStep >= 160 && r.minStep < 200));
  show(">= 200c (no small step)", rows.filter(r => r.minStep >= 200));
  console.log("\nstep spread (widest / narrowest step of the mode)");
  show("< 1.5x  (even)", rows.filter(r => r.spread < 1.5));
  show("1.5 - 2x", rows.filter(r => r.spread >= 1.5 && r.spread < 2));
  show("2 - 3x", rows.filter(r => r.spread >= 2 && r.spread < 3));
  show(">= 3x  (a hole in it)", rows.filter(r => r.spread >= 3));
  console.log("\nframe (is the repeat an octave?)");
  show("within 10c of 2:1", rows.filter(r => r.frameOff < 10));
  show("10-30c off", rows.filter(r => r.frameOff >= 10 && r.frameOff < 30));
  show(">= 30c off", rows.filter(r => r.frameOff >= 30));
  console.log("\nhow the scale was arrived at");
  for (const k of ["heard", "heard + measured", "measured"]) show("  " + k, rows.filter(r => r.by === k));
  console.log("\ntexture");
  for (const k of ["monophony", "heterophony", "polyphony", "drone", "ostinato"]) show("  " + k, rows.filter(r => r.tex === k));
  const agg = new Map();
  for (const r of rows) for (const [k, v] of r.rolePairs) agg.set(k, (agg.get(k) || 0) + v);
  const tot = [...agg.values()].reduce((a, b) => a + b, 0);
  console.log("\nwhere the semitone clashes come from:");
  for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log("  " + k.padEnd(16), String(v).padStart(6), (100 * v / tot).toFixed(1) + "%");
  }
}
