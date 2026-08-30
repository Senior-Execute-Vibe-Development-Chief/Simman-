// WHAT DOES THE SINGER ACTUALLY DO?
//
// The sung part used to be the lead's notes, on the lead's attacks, in the
// lead's octave — a chorus effect rather than a second person. Measure the
// three things that make it a person: how many notes it takes of the line,
// how far off the player's attack it sits, and where it sits in pitch against
// a real human range.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, degreeHz } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";
import { prosodyOf } from "../src/sim/languagePhonetics.js";
import { voiceRange } from "../src/sim/vocalTract.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
function build(seed, trad) {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
}
function look(m) {
  const p = composePiece(m, "peace");
  const ev = p.events || [];
  const voice = ev.filter(e => e.role === "voice");
  const lead = ev.filter(e => e.role === "lead");
  if (!voice.length || !lead.length) return null;
  // how many of the line's notes the singer takes
  const share = voice.length / lead.length;
  const mel = voice.filter(e => e.melisma).length / voice.length;
  // how often a sung attack lands on exactly a played attack
  const at = new Set(lead.map(e => e.b.toFixed(4)));
  const onTop = voice.filter(e => at.has(e.b.toFixed(4))).length / voice.length;
  // and where the singer sings, against a real range — measured the way it is
  // HEARD: the renderer moves each breath group by whole frames to sit it in
  // the compass, so a note is only out of range if that shift cannot save it.
  const vr = voiceRange(prosodyOf(m.people.lang));
  const frame = m.scale.frame.ratio, mid = Math.sqrt(vr.low * vr.top);
  const groups = [];
  voice.sort((a, b) => a.b - b.b);
  let cur = [];
  voice.forEach((e, i) => {
    cur.push(e);
    const nx = voice[i + 1];
    if (!nx || nx.b - (e.b + e.dur) > 0.9) { groups.push(cur); cur = []; }
  });
  const hz = [];
  for (const g of groups) {
    const raw = g.map(e => degreeHz(m, 294, e.deg, e.oct || 0)).filter(f => f > 0);
    if (!raw.length) continue;
    let best = raw, bo = Infinity, bf = Infinity;
    for (let k = -3; k <= 3; k++) {
      const v = raw.map(r => r * Math.pow(frame, k));
      const out = v.filter(x => x < vr.low || x > vr.top).length;
      const off = Math.abs(v.reduce((a, x) => a + Math.log2(x / mid), 0) / v.length);
      if (out < bo || (out === bo && off < bf)) { bo = out; bf = off; best = v; }
    }
    hz.push(...best);
  }
  const inRange = hz.filter(f => f >= vr.low * 0.94 && f <= vr.top).length / hz.length;
  return { share, mel, onTop, inRange,
    lo: Math.min(...hz), hi: Math.max(...hz), vlo: vr.low, vhi: vr.top };
}
const rows = [];
const add = (name, m) => { const r = look(m); if (r) rows.push([name, r]); };
for (const k of Object.keys(TRADITIONS)) add(k, build(7, k));
for (const s of [1035, 1037, 1000, 1234, 2222, 2025, 4242]) add("seed " + s, build(s));
console.log("what          notes/lead  melisma  on the player's attack | sung Hz      voice Hz     in range");
for (const [name, r] of rows) {
  console.log(name.padEnd(13),
    r.share.toFixed(2).padStart(6), "  ", (100 * r.mel).toFixed(0).padStart(3) + "%",
    "  ", (100 * r.onTop).toFixed(0).padStart(3) + "%",
    "                |", `${r.lo.toFixed(0)}-${r.hi.toFixed(0)}`.padEnd(12),
    `${r.vlo.toFixed(0)}-${r.vhi.toFixed(0)}`.padEnd(12), (100 * r.inRange).toFixed(0) + "%");
}
const mean = (g) => rows.reduce((a, r) => a + g(r[1]), 0) / rows.length;
console.log(`\nmean: takes ${mean(r => r.share).toFixed(2)} of the line, ${(100*mean(r=>r.mel)).toFixed(0)}% melismatic, ` +
  `${(100*mean(r=>r.onTop)).toFixed(0)}% on the player's attack, ${(100*mean(r=>r.inRange)).toFixed(0)}% inside a human range`);
