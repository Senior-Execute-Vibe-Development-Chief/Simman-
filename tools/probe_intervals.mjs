// WHICH INTERVALS ACTUALLY SOUND, and how rough each one is against a harmonic
// ear. The scale is a list of pitches; what a listener judges is the intervals
// between the ones that overlap in time.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, degreeHz } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf, dissonance, nearJust } from "../src/sim/musicTuning.js";
const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const build = (seed, trad) => {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
};
const HARM = (() => {
  const s = Array.from({ length: 10 }, (_, i) => ({ f: 260 * (i + 1), a: Math.pow(0.85, i) }));
  const t = Math.sqrt(s.reduce((a, p) => a + p.a * p.a, 0));
  return s.map(p => ({ f: p.f, a: p.a / t }));
})();
const JUSTC = [0, 112, 182, 204, 231, 316, 386, 408, 498, 583, 590, 702, 792, 814, 884, 906, 969, 1018, 1088, 1200];
const offJust = (c) => Math.min(...JUSTC.map(j => Math.abs(((c % 1200) + 1200) % 1200 - j)));

function report(tag, m) {
  const p = composePiece(m, "peace");
  const ev = (p.events || [])
    .filter(e => e.role !== "pulse" && e.role !== "mark" && e.deg != null)
    .map(e => ({ t: e.b, dur: e.dur || 0.5, hz: degreeHz(m, 220, e.deg, e.oct || 0) }))
    .filter(e => e.hz > 0).sort((a, b) => a.t - b.t);
  const hist = new Map();
  let tot = 0, rough = 0;
  for (let i = 0; i < ev.length; i++) {
    const a = ev[i], aEnd = a.t + Math.min(a.dur, 4);
    for (let j = i + 1; j < ev.length && ev[j].t < aEnd; j++) {
      const b = ev[j], w = Math.max(0, Math.min(aEnd, b.t + Math.min(b.dur, 4)) - Math.max(a.t, b.t));
      if (!(w > 0)) continue;
      let r = b.hz / a.hz; if (r < 1) r = 1 / r;
      if (r > 4.2) continue;
      const c = Math.round(((1200 * Math.log2(r)) % 1200 + 1200) % 1200 / 10) * 10;
      hist.set(c, (hist.get(c) || 0) + w);
      rough += w * dissonance(HARM, r); tot += w;
    }
  }
  const st = m.mode.steps.filter(x => x > 0);
  const mj = m.mode.cents.reduce((s2, c) => s2 + offJust(c), 0) / m.mode.cents.length;
  const mt = m.mode.cents.reduce((s2, c) => s2 + Math.abs(c - Math.round(c / 100) * 100), 0) / m.mode.cents.length;
  const top = [...hist].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([c, w]) => c + "c" + (nearJust(Math.pow(2, c / 1200), 18) ? "" : "*") + ":" + (100 * w / tot).toFixed(0) + "%");
  // how much of the sounding time is spent on an interval that is NOT near a
  // just ratio — the ones a harmonic ear has no template for
  let off = 0;
  for (const [c, w] of hist) if (offJust(c) > 20) off += w;
  console.log(tag.padEnd(11),
    "| off-just", (mj).toFixed(0).padStart(2) + "c", "off-12tet", mt.toFixed(0).padStart(2) + "c",
    "| rough", (rough / tot).toFixed(4),
    "| time on non-just intervals", (100 * off / tot).toFixed(0).padStart(3) + "%",
    "|", top.join(" "));
}
console.log("(* = the interval is not within 18 cents of any just ratio)");
for (const k of Object.keys(TRADITIONS)) report(k, build(7, k));
console.log();
for (const s of [1037, 1035, 2025, 1234]) report("seed " + s, build(s, null));
