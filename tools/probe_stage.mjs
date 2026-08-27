// WHO ACTUALLY PLAYS. An ensemble is a list of bodies a people keeps; a piece
// is what any of them are given to do. Measure the gap.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, ensembleFor } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument, melodicCapacity, articRate } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";
const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
function build(seed, trad) {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
}
function stage(m, occ = "peace") {
  const p = composePiece(m, occ);
  const ev = p.events || [];
  const per = new Map();
  for (const e of ev) per.set(e.inst, (per.get(e.inst) || 0) + 1);
  return { per, n: ev.length, roles: new Set(ev.map(e => e.role)) };
}
const line = (tag, m) => {
  const s = stage(m);
  const E = ensembleFor(m, "peace", 1);
  const held = m.insts.length, played = s.per.size;
  const names = m.insts.map((i, k) => {
    const c = s.per.get(k) || 0;
    const nm = i.sampleName || i.fam;
    return (c ? nm + ":" + c : "(" + nm + ")");
  });
  console.log(tag.padEnd(11), played + "/" + held, "bodies |", String(s.n).padStart(4), "events |",
    names.join("  "));
  const silent = m.insts.map((i, k) => [i, k]).filter(([, k]) => !s.per.has(k));
  if (silent.length) {
    for (const [i, k] of silent) {
      console.log("    silent:", String(i.sampleName || i.fam).padEnd(11),
        "melodicCapacity", melodicCapacity(i).toFixed(3),
        "| artic", articRate(i).toFixed(1),
        "| weight", i.weight.toFixed(2),
        "| claimed as", Object.entries(E).filter(([, v]) => v === k || (Array.isArray(v) && v.includes(k))).map(([r]) => r).join(",") || "NOTHING");
    }
  }
};
console.log("what        played/held         events   per-instrument note counts");
for (const k of Object.keys(TRADITIONS)) line(k, build(7, k));
console.log();
for (const s of [1037, 2025, 1035, 1000]) line("seed " + s, build(s, null));
