// Can DERIVED peoples land on BENCH signatures without pinning?
// Reports per-bench hits over a seed sweep — the diversity gate for emergence.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { REFERENCE_PEOPLES } from "../src/sim/musicRefs.js";
import { TRADITIONS } from "../src/sim/musicTraditions.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });

function build(seed, pin = {}) {
  return musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), pin));
}

/** Every bench degree sits near some derived scale degree (mod octave). */
function scaleMatch(m, benchCents, tol = 28) {
  const ds = m.scale.degrees.map(d => Math.round(d.cents));
  const frame = Math.round(m.scale.frame.cents);
  return benchCents.every(bc => {
    for (const o of [0, frame]) {
      for (const dc of ds) {
        const d = Math.abs((dc + o) - bc);
        if (d <= tol || Math.abs(d - frame) <= tol) return true;
      }
    }
    return false;
  });
}

function modeMatch(m, benchMode, tol = 28) {
  const mc = m.mode.cents.map(c => Math.round(c));
  return benchMode.every(bc => mc.some(dc => Math.abs(dc - bc) <= tol));
}

function benchProfile(key) {
  const T = TRADITIONS[key];
  return {
    key,
    label: T.label,
    scale: T.scale.map(c => Math.round(c)),
    mode: T.mode.map(c => Math.round(c)),
    frame: T.frame,
    tex: T.texture.kind,
    tempo: T.rhythm.tempo,
    meter: T.rhythm.meterKind,
    beats: T.rhythm.beats,
    fams: [...new Set(T.insts.map(i => i.fam))],
  };
}

function scoreHit(m, B) {
  const sc = scaleMatch(m, B.scale);
  const mo = modeMatch(m, B.mode);
  const tex = m.texture.kind === B.tex;
  const tempo = Math.abs(m.rhythm.tempo - B.tempo) <= Math.max(18, B.tempo * 0.28);
  const famHit = B.fams.filter(f => m.insts.some(i => i.fam === f)).length;
  const fam = famHit >= Math.min(2, B.fams.length);
  const pts = (sc ? 2 : 0) + (mo ? 2 : 0) + (tex ? 1 : 0) + (tempo ? 1 : 0) + (fam ? 1 : 0);
  return { sc, mo, tex, tempo, fam, famHit, pts, strong: sc && mo && pts >= 5 };
}

const BENCH = Object.keys(TRADITIONS).map(benchProfile);

function sweep(n, label, mk) {
  const hits = Object.fromEntries(BENCH.map(b => [b.key, { n: 0, strong: 0, best: null }]));
  for (let i = 0; i < n; i++) {
    const seed = 12000 + i * 19;
    let m;
    try { m = mk(seed); } catch { continue; }
    for (const B of BENCH) {
      const s = scoreHit(m, B);
      if (s.sc) {
        const h = hits[B.key];
        h.n++;
        if (s.strong) h.strong++;
        if (!h.best || s.pts > h.best.pts) h.best = { seed, ...s };
      }
    }
  }
  console.log(`\n=== ${label} (n=${n}) ===`);
  console.log("bench            scale%  strong%  best seed  pts");
  let covered = 0;
  for (const B of BENCH) {
    const h = hits[B.key];
    const pct = (100 * h.n / n).toFixed(1);
    const sp = (100 * h.strong / n).toFixed(1);
    if (h.n > 0) covered++;
    console.log(
      B.key.padEnd(16),
      (pct + "%").padStart(6),
      (sp + "%").padStart(7),
      String(h.best?.seed ?? "—").padStart(9),
      h.best ? String(h.best.pts) : "—",
    );
  }
  console.log(`covered ${covered}/${BENCH.length} benches (≥1 scale match)`);
  return { hits, covered, n };
}

console.log("Bench reachability — derived peoples vs pinned known-answer scales");
const random = sweep(800, "random endowment", (seed) => build(seed));
for (const [ref, R] of Object.entries(REFERENCE_PEOPLES)) {
  sweep(120, `endowment: ${ref}`, (seed) => build(seed, R.people));
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ covered: random.covered, total: BENCH.length }, null, 2));
}
