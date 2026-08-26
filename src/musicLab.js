// ── Simman Music Lab ──────────────────────────────────────────────────────
// A standalone playground for the music system (docs/music.md). Dependency-
// free vanilla DOM, deliberately outside the React app, exactly like the
// Language Lab: served as /musiclab.html in dev, or bundled into one self-
// contained page. It does not touch the world sim — the sim stays silent.
//
// What the page is for: making the CAUSAL CHAIN audible and visible. Every
// card is one link. What the land gives → what can be built → what those
// bodies radiate → which intervals stop sounding rough → the scale. And, on
// the other side, what the people's own language does to their rhythm.

/* global __BUILD__ */
import { foundLanguage } from "./sim/language.js";
import { langWord, langWordForm, langRealmName } from "./sim/language.js";
import { phoneticPlan, prosodyOf } from "./sim/languagePhonetics.js";
import { GOD, SUN, RIVER, MOUNTAIN, KING, WATER, EARTH, SEA, MOON, GRAIN, HOUSE } from "./sim/languageLexicon.js";
import { MATERIALS } from "./sim/musicInstruments.js";
import { nearJust, cents as toCents } from "./sim/musicTuning.js";
import { foundPeople, musicOf, materialsOf } from "./sim/musicGenome.js";
import { OCCASIONS, ambientBar, composePiece, ensembleFor, degreeHz, speechNPVI, finalFor, modeDegree } from "./sim/musicCompose.js";
import { makeAudio, setDistance, playNote, playVoice } from "./sim/musicSynth.js";
import { REFERENCE_PEOPLES } from "./sim/musicRefs.js";

// ── state ────────────────────────────────────────────────────────────────
const S = {
  // Defaults chosen so the mechanism is legible on arrival, the way the
  // Language Lab opens on a legible tongue: 1035 is a bowed-and-plucked
  // people whose every scale degree is HEARD in its own timbre, and 2015 —
  // the blend partner — is an all-metal tradition whose frame is not an
  // octave at all, so sliding the border control is an audible argument.
  seed: 1035, ref: "random", occ: "peace", intimacy: 0.72, blend: 0,
  seedB: 2015, refB: "random", playing: false, piece: null, tonic: 196,
};
let world, A = null, P = null, PB = null;   // audio, primary music, blend partner

function newWorld() { return { seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 }; }
function build(seed, ref) {
  const lang = foundLanguage(world, { seed: seed >>> 0 });
  const pin = ref !== "random" ? REFERENCE_PEOPLES[ref] : {};
  const people = foundPeople(seed >>> 0, lang, pin.people || {});
  if (pin.langPin) Object.assign(people.lang.prof, pin.langPin);
  people.name = pin.label || langRealmName(lang, 1);
  const m = musicOf(people);
  m.refKey = ref === "random" ? null : ref;
  return m;
}
function regen() {
  world = newWorld();
  P = build(S.seed, S.ref);
  PB = build(S.seedB, S.refB);
  S.piece = null;
}

// ── audio plumbing ───────────────────────────────────────────────────────
function audio() {
  if (!A) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    A = makeAudio(new Ctx());
  }
  if (A.ctx.state === "suspended") A.ctx.resume();
  return A;
}
/** The tonic a people sings at: low for big struck metal, higher for pipes. */
function tonicOf(m) {
  // A melody wants to sit where a voice sits. Down at 150-200 Hz a line reads
  // as a bass part and its intervals blur; the singer's own range is where
  // pitch is heard most sharply, so the final lands there and the drone sits
  // a frame below it.
  const lead = m.insts[0];
  const base = lead && (lead.fam === "gong" || lead.fam === "bell" || lead.fam === "barSet") ? 262 : 294;
  return base * (m.melody.breathBound ? 1.12 : 1);
}
function noteFreq(m, ev) { return degreeHz(m, tonicOf(m), ev.deg, ev.oct); }

function fireEvent(m, ev, when, secPerBeat, gain, syls) {
  const A = audio();
  if (ev.role === "voice") {
    playVoice(A, ev.syl || (syls && syls[0]), noteFreq(m, ev), when, ev.dur * secPerBeat, ev.vel * gain);
    return;
  }
  const inst = m.insts[ev.inst] || m.insts[0];
  if (!inst) return;
  const f = noteFreq(m, ev);
  // Each melodic part is a VOICE CHANNEL: a player's free hand stops the note
  // they are replacing and leaves everything else ringing. A marker stroke
  // belongs to no channel — its ring is the point.
  playNote(A, inst, f, when, ev.dur * secPerBeat, ev.vel * gain, {
    role: ev.role === "het" ? "het" : ev.role || "lead",
    channel: ev.ring || ev.role === "pad" ? null : `${m.people.seed}:${ev.role}:${ev.inst}`,
  });
  // the ornament's pitch comes from the composer, already a MODE step and
  // already placed a subdivision ahead — the Lab never invents an interval
  if (ev.ornDeg != null) {
    const nb = degreeHz(m, tonicOf(m), ev.ornDeg, ev.oct);
    playNote(A, inst, nb, Math.max(0, when - ev.ornLead * secPerBeat), 0.08, ev.vel * gain * 0.5);
  }
}

// ── the ambient layer: a lookahead scheduler that never loops ─────────────
// One clock PER TRADITION. The first cut advanced a single clock by the
// longer of the two cycles, which inserted a ragged gap of silence after the
// shorter one every time round — enough on its own to destroy the pulse.
const SCHED = { lanes: [], timer: null };
function startAmbient() {
  const A = audio();
  setDistance(A, S.intimacy);
  const t0 = A.ctx.currentTime + 0.12;
  SCHED.lanes = [{ m: () => P, bar: 0, next: t0, w: () => 1 - S.blend },
                 { m: () => PB, bar: 0, next: t0, w: () => S.blend }];
  SCHED.timer = setInterval(pump, 110);
  S.playing = true; pump();
}
function stopAmbient() {
  if (SCHED.timer) clearInterval(SCHED.timer);
  SCHED.timer = null; S.playing = false;
}
function pump() {
  if (!A) return;
  const now = A.ctx.currentTime;
  // A border settlement's ambience IS an admixture: both peoples' music at
  // the population proportions, each keeping its own tempo and metre.
  for (const lane of SCHED.lanes) {
    const m = lane.m();
    if (!m) continue;
    while (lane.next < now + 0.8) {
      const plan = ambientBar(m, { occ: S.occ, intimacy: S.intimacy, bar: lane.bar, seed: m.people.seed });
      const spb = 60 / plan.tempo;
      const w = lane.w();
      if (w >= 0.02) for (const ev of plan.events) fireEvent(m, ev, lane.next + ev.b * spb, spb, w);
      lane.next += plan.beats * spb;      // exactly one cycle. No gap, ever.
      lane.bar++;
    }
  }
}

// ── playing one piece ────────────────────────────────────────────────────
function hymnSyllables(m, n = 8) {
  const lang = m.people.lang;
  const concepts = [GOD, SUN, RIVER, MOUNTAIN, WATER, EARTH, SEA, MOON, GRAIN, KING, HOUSE].filter(Boolean);
  const out = [], words = [];
  for (let i = 0; out.length < n && i < concepts.length; i++) {
    const c = concepts[i];
    try {
      const form = langWordForm(lang, c);
      const plan = phoneticPlan(lang, form);
      out.push(...plan.syls);
      words.push(langWord(lang, c));
    } catch { /* a concept the lexicon can't reach is simply skipped */ }
  }
  return { syls: out.slice(0, Math.max(4, n)), words };
}
function playPiece() {
  const A = audio();
  setDistance(A, 0.9);
  const hymn = hymnSyllables(P, 10);
  const piece = composePiece(P, S.occ, hymn.syls);
  S.piece = { ...piece, words: hymn.words };
  const spb = 60 / piece.tempo;
  const t0 = A.ctx.currentTime + 0.15;
  let i = 0;
  for (const ev of piece.events) {
    // syllables are handed out in order along the vocal line
    if (ev.role === "voice" && !ev.syl) ev.syl = hymn.syls[i++ % hymn.syls.length];
    fireEvent(P, ev, t0 + ev.b * spb, spb, 1, hymn.syls);
  }
  return piece;
}

// ── drawing ──────────────────────────────────────────────────────────────
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function fitCanvas(cv, h) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || 600;
  cv.width = w * dpr; cv.height = h * dpr;
  cv.style.height = h + "px";
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
/** The dissonance curve: the page's centrepiece, because it is the evidence.
 *  Every dip is an interval this ensemble's own partials stop fighting at. */
function drawCurve(cv, m) {
  const { g, w, h } = fitCanvas(cv, 190);
  const { xs, ys } = m.scale.curve;
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const X = (r) => ((toCents(r) - 0) / 1300) * (w - 46) + 38;
  const Y = (v) => h - 26 - ((v - lo) / (hi - lo || 1)) * (h - 46);
  g.clearRect(0, 0, w, h);
  // equal-tempered semitone grid, for reference only — this world's peoples
  // do not use it, and seeing how far the dips sit from it is the point
  g.strokeStyle = css("--line"); g.lineWidth = 1;
  for (let c = 0; c <= 1200; c += 100) {
    g.globalAlpha = c % 300 === 0 ? 0.8 : 0.4;
    g.beginPath(); g.moveTo(X(Math.pow(2, c / 1200)), 10); g.lineTo(X(Math.pow(2, c / 1200)), h - 24); g.stroke();
  }
  g.globalAlpha = 1;
  g.strokeStyle = css("--accent"); g.lineWidth = 2; g.beginPath();
  for (let i = 0; i < xs.length; i++) {
    const px = X(xs[i]), py = Y(ys[i]);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  // the degrees this people actually took
  g.font = "11px ui-monospace, monospace";
  for (const d of m.scale.degrees) {
    const px = X(d.ratio);
    g.fillStyle = css("--accent");
    // sit the dot on the curve itself: at a dip if this degree was heard, on
    // the slope if it was stepped off by measure — which is worth seeing
    let bi = 0, bd = Infinity;
    for (let i = 0; i < xs.length; i++) { const dd = Math.abs(xs[i] - d.ratio); if (dd < bd) { bd = dd; bi = i; } }
    g.beginPath(); g.arc(px, Y(ys[bi]), 3.5, 0, 7);
    if (d.found) g.fill(); else { g.lineWidth = 1.5; g.strokeStyle = css("--gloss"); g.stroke(); }
    g.strokeStyle = css("--accent"); g.globalAlpha = 0.5;
    g.beginPath(); g.moveTo(px, h - 24); g.lineTo(px, 10); g.stroke(); g.globalAlpha = 1;
  }
  // the frame — where the pattern repeats, which is not always the octave
  const fx = X(m.scale.frame.ratio);
  g.strokeStyle = css("--gloss"); g.lineWidth = 2; g.setLineDash([4, 3]);
  g.beginPath(); g.moveTo(fx, 6); g.lineTo(fx, h - 24); g.stroke(); g.setLineDash([]);
  g.fillStyle = css("--muted"); g.font = "10px ui-monospace, monospace";
  g.fillText("0¢", 30, h - 10);
  g.fillText("1200¢", X(2) - 16, h - 10);
  g.fillStyle = css("--gloss");
  g.fillText("frame " + m.scale.frame.cents.toFixed(0) + "¢", Math.min(w - 74, fx + 4), 16);
  g.save(); g.translate(11, h / 2); g.rotate(-Math.PI / 2);
  g.fillStyle = css("--muted"); g.textAlign = "center"; g.fillText("roughness", 0, 0); g.restore();
}
/** One instrument's radiated spectrum — the object that decided the tuning. */
function drawSpectrum(cv, inst) {
  const { g, w, h } = fitCanvas(cv, 54);
  g.clearRect(0, 0, w, h);
  const maxR = Math.max(6, inst.partials[inst.partials.length - 1].r);
  for (const p of inst.partials) {
    const x = 3 + (p.r / maxR) * (w - 8);
    const y = h - 8 - p.a * (h - 14);
    g.strokeStyle = inst.harmonic ? css("--accent") : css("--gloss");
    g.lineWidth = 2; g.beginPath(); g.moveTo(x, h - 8); g.lineTo(x, y); g.stroke();
  }
  g.strokeStyle = css("--line"); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h - 8); g.lineTo(w, h - 8); g.stroke();
  // integer-multiple ticks: a harmonic body's modes sit on them, an
  // inharmonic body's visibly do not
  g.fillStyle = css("--muted");
  for (let n = 1; n <= maxR; n++) {
    const x = 3 + (n / maxR) * (w - 8);
    g.fillRect(x, h - 7, 1, 3);
  }
}
function drawRhythm(cv, m) {
  const { g, w, h } = fitCanvas(cv, 44);
  g.clearRect(0, 0, w, h);
  const bar = ambientBar(m, { occ: S.occ, intimacy: 1, bar: 1, seed: m.people.seed });
  const B = m.rhythm.beats;
  g.strokeStyle = css("--line");
  for (let b = 0; b <= B; b++) {
    const x = 4 + (b / B) * (w - 8);
    g.globalAlpha = b === 0 ? 1 : 0.45;
    g.beginPath(); g.moveTo(x, 6); g.lineTo(x, h - 6); g.stroke();
  }
  g.globalAlpha = 1;
  for (const ev of bar.events) {
    const x = 4 + (ev.b / B) * (w - 8);
    const wd = Math.max(3, (ev.dur / B) * (w - 8) - 2);
    g.fillStyle = ev.role === "pulse" ? css("--muted") : ev.role === "drone" ? css("--line") : css("--accent");
    const y = ev.role === "pulse" ? h - 14 : ev.role === "drone" ? h - 9 : 10;
    g.fillRect(x, y, wd, ev.role === "lead" ? 9 : 5);
  }
}

// ── rendering the page ───────────────────────────────────────────────────
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const pct = (v) => Math.round(v * 100) + "%";
const bar01 = (v, label) =>
  `<div class="meter" title="${esc(label)}: ${pct(v)}"><span style="width:${Math.max(2, Math.min(100, v * 100))}%"></span></div>`;

function peopleHTML(m) {
  const p = m.people;
  const mats = materialsOf(p);
  const pros = prosodyOf(p.lang);
  const have = Object.entries(p.have).filter(([, v]) => v).map(([k]) => k);
  return `<div class="card">
    <h2>The people <span class="count">— what the music has to work with</span></h2>
    <p class="note">Every input below comes from somewhere the world sim already models: a biome, a
      geology roll, the same six knowledge axes, and a real generated language. Nothing about music
      is decided here — these are the causes.</p>
    <div class="grid2">
      <div>
        <h3>Place</h3>
        <p class="lede">${esc(p.biomeLabel)}</p>
        <h3>In reach</h3>
        <div class="chips">${have.map(h => `<span class="chip">${esc(h)}</span>`).join("")}</div>
        <h3>Materials a maker can use</h3>
        <div class="chips">${mats.map(x => `<span class="chip mat">${esc(MATERIALS[x].label)}</span>`).join("")}</div>
      </div>
      <div>
        <h3>Crafts</h3>
        ${["metallurgy", "construction", "organization"].map(k =>
          `<div class="row"><span class="k">${k}</span>${bar01(p.know[k], k)}</div>`).join("")}
        <h3>Society</h3>
        ${["surplus", "urban", "strat", "literacy"].map(k =>
          `<div class="row"><span class="k">${k === "strat" ? "stratification" : k}</span>${bar01(p.soc[k], k)}</div>`).join("")}
        <h3>Tongue</h3>
        <p class="note tight">${pros.rhythm}-timed · ${p.lang.prof.tone ? (p.lang.prof.tone === 2 ? "contour tone" : "register tone") : "no tone"} ·
          ${esc(p.lang.prof.morph)} · speech tempo ${pros.rate.toFixed(2)}×</p>
      </div>
    </div>
  </div>`;
}

function instrumentsHTML(m) {
  return `<div class="card">
    <h2>What they can build <span class="count">— ${m.insts.length} bodies</span></h2>
    <p class="note">Each body is made of what the land gives, gated by the crafts they have. The bars
      show the modes it actually radiates, against integer-multiple ticks: sit on the ticks and the
      body is <em>harmonic</em>; miss them and it is not — and that single fact is what decides the
      scale below. Click one to hear it.</p>
    <div class="instgrid">${m.insts.map((i, k) => `
      <button class="inst" data-inst="${k}" title="play">
        <div class="ihead"><span class="iname">${esc(i.label)}</span>
          <span class="itag ${i.harmonic ? "harm" : "inharm"}">${i.harmonic ? "harmonic" : "inharmonic"}</span></div>
        <div class="imat">${esc(MATERIALS[i.mat].label)}${i.frame ? " on " + esc(MATERIALS[i.frame].label) : ""}</div>
        <canvas class="spec" data-spec="${k}"></canvas>
        <div class="ifoot"><span>${i.cap} pitches</span><span>${esc(i.kind)}</span><span>weight ${pct(i.weight)}</span></div>
      </button>`).join("")}</div>
  </div>`;
}

function tuningHTML(m) {
  const d = m.scale.degrees;
  const fin = finalFor(m, S.occ);
  const inMode = new Set(m.mode.idx);
  const homeIdx = m.mode.idx[fin];
  const F = m.scale.frame.cents, L = m.mode.size;
  const fromHome = Array.from({ length: L }, (_, k) =>
    ((m.mode.cents[(fin + k) % L] - m.mode.cents[fin]) % F + F) % F).sort((a, b) => a - b);
  return `<div class="card">
    <h2>The scale they found <span class="count">— derived, not chosen</span></h2>
    <p class="note">Two tones sound rough when their partials beat against each other. This curve is
      that roughness, computed across every interval from the ensemble's own spectrum, using
      Plomp &amp; Levelt's measured listening data. <strong>The dips are where this people's
      instruments stop fighting</strong> — so those are the intervals they build a scale from. The
      faint grid is equal-tempered semitones, shown only so you can see how far the dips sit from it.</p>
    <canvas id="curve"></canvas>
    <div class="degrees">${d.map((x, i) => {
      const nj = nearJust(x.ratio);
      return `<button class="deg${x.found ? "" : " measured"}${inMode.has(i) ? " inmode" : ""}${i === homeIdx ? " home" : ""}" data-deg="${i}"
          title="${x.found ? "heard — a roughness minimum of their own instruments" : "measured — an even division of their frame, where the timbre gave no dip to find"}">
        <span class="dc">${x.cents.toFixed(0)}<i>¢</i></span>
        <span class="dr">${x.ratio.toFixed(3)}</span>
        <span class="dj">${nj ? esc(nj) : x.found ? "heard" : "measured"}</span></button>`;
    }).join("")}</div>
    <h3>What they actually sing out of it</h3>
    <p class="note tight">A scale is every interval that sits well against one note. A <strong>mode</strong>
      is the subset whose notes sit well against <em>each other</em> — a melody free to use all nine of
      these would crawl through seventy-cent steps and sound like nobody's music. And which member the
      music treats as <em>home</em> is its own choice: the same pitches read open or shaded depending on
      how much of the mode already lives inside that note's own harmonic series, which is why
      ${esc(OCCASIONS[S.occ].label)} takes the final it does.</p>
    <div class="moderow">
      ${fromHome.map((c, i) => `<span class="mstep${i === 0 ? " mhome" : ""}">${Math.round(c)}<i>¢</i></span>`).join('<span class="marrow">·</span>')}
      <span class="mframe">${Math.round(F)}<i>¢</i></span>
    </div>
    <p class="note tight">${m.mode.size} notes, measured from home &mdash; steps of
      ${fromHome.slice(1).map((c, i) => Math.round(c - fromHome[i])).concat([Math.round(F - fromHome[fromHome.length - 1])]).join(", ")}¢.</p>
    <div class="factrow">
      <div><span class="k">repeats at</span><b>${m.scale.frame.cents.toFixed(0)}¢</b>
        <span class="note tight">${Math.abs(m.scale.frame.cents - 1200) < 25 ? "an octave" : "not an octave"}</span></div>
      <div><span class="k">degrees</span><b>${d.length}</b>
        <span class="note tight">ceiling ${m.cap} — their widest-range body</span></div>
      <div><span class="k">off equal temperament</span><b>${m.scale.tetErr.toFixed(1)}¢</b>
        <span class="note tight">mean per degree</span></div>
      <div><span class="k">arrived at by</span><b class="small">${esc(m.scale.derivedBy)}</b>
        <span class="note tight">${m.scale.degrees.filter(d => d.found).length} heard in the timbre, ${m.scale.degrees.filter(d => !d.found).length} stepped off by measure</span></div>
      <div><span class="k">regularisation</span><b>${pct(m.pull)}</b>
        <span class="note tight">${m.pull > 0.35 ? "fixed sets + writing pull the steps even" : "oral tradition keeps the ratios it found"}</span></div>
    </div>
  </div>`;
}

function rhythmHTML(m) {
  const sp = speechNPVI(m), pc = composePiece(m, S.occ).nPVI;
  const R = m.rhythm;
  return `<div class="card">
    <h2>Rhythm, out of the language <span class="count">— ${R.cls}-timed</span></h2>
    <p class="note">A culture's music inherits the durational unevenness of its speech. This people's
      tongue is <strong>${R.cls}-timed</strong>, so its music is too — and the Lab measures both the
      same way (nPVI, the index the speech-rhythm literature compares languages with) rather than
      asserting the link.</p>
    <canvas id="rhy"></canvas>
    <div class="factrow">
      <div><span class="k">cycle</span><b>${R.beats}</b><span class="note tight">${esc(R.meterKind)}</span></div>
      <div><span class="k">tempo</span><b>${Math.round(R.tempo * OCCASIONS[S.occ].tempo)}</b><span class="note tight">beats/min, ${esc(OCCASIONS[S.occ].label)}</span></div>
      <div><span class="k">long–short</span><b>${pct(R.swing)}</b><span class="note tight">${R.swing > 0.2 ? "paired, uneven" : "level"}</span></div>
      <div><span class="k">against the beat</span><b>${pct(R.syncopation)}</b><span class="note tight">${R.syncopation > 0.3 ? "pushes" : "stays on"}</span></div>
    </div>
    <div class="npvi">
      <div class="npvirow"><span class="k">their speech</span>${bar01(sp / 100, "speech nPVI")}<b>${sp.toFixed(0)}</b></div>
      <div class="npvirow"><span class="k">their music</span>${bar01(pc / 100, "music nPVI")}<b>${pc.toFixed(0)}</b></div>
    </div>
  </div>`;
}

function textureHTML(m) {
  const T = m.texture, F = m.form, E = ensembleFor(m, S.occ, 1);
  const lead = m.insts[E.lead];
  return `<div class="card">
    <h2>How they play together</h2>
    <div class="grid2">
      <div>
        <h3>Texture</h3>
        <p class="lede">${esc(T.kind)}</p>
        <p class="note tight">${T.size} players — every one of them is somebody not farming, so the
          ensemble is a surplus question before it is a musical one.</p>
        <div class="row"><span class="k">ornament</span>${bar01(T.ornament, "ornament")}</div>
        <div class="row"><span class="k">court manner</span>${bar01(T.courtly, "stratification")}</div>
      </div>
      <div>
        <h3>Form</h3>
        <p class="lede">${F.literate ? "written" : "oral"} — ${F.sections} sections</p>
        <p class="note tight">${F.literate
          ? "Notation buys long structure: the piece can leave its opening idea and not come back the same."
          : "Memory builds from formula: the piece states an idea and returns to it."}</p>
        <div class="row"><span class="k">repetition</span>${bar01(F.repetition, "repetition")}</div>
        <div class="row"><span class="k">development</span>${bar01(F.development, "development")}</div>
      </div>
    </div>
    <h3>Who leads</h3>
    <p class="note tight">${esc(lead ? lead.label + " of " + MATERIALS[lead.mat].label : "the voice")} — ${
      m.melody.breathBound ? "a breath bounds the phrase" : "a string does not need to breathe, so phrases run longer"}${
      m.melody.toneBound ? "; the tongue has lexical tone, so a sung line cannot fight the word's own melody" : ""}.</p>
  </div>`;
}

function pieceHTML(m) {
  const pc = S.piece;
  return `<div class="card">
    <h2>A piece <span class="count">— ${esc(OCCASIONS[S.occ].label)}</span></h2>
    <p class="note">The ambient layer above never repeats and goes nowhere. This is the other renderer:
      a whole piece with sections, built on one motif, developed as far as their literacy allows —
      with a line sung in their own language.</p>
    <div class="controls">
      <button id="playPiece">Play the piece</button>
      ${pc ? `<span class="note tight">${pc.sections.length} sections · ${pc.totalBeats} beats · ${pc.tempo} bpm</span>` : ""}
    </div>
    ${pc ? `<div class="formline">${pc.sections.map(s =>
      `<div class="sec" style="flex:${s.beats}"><span>${esc(s.label)}</span></div>`).join("")}</div>
      <h3>Sung</h3>
      <p class="sung">${pc.words.map(w => `<span>${esc(w)}</span>`).join(" ")}</p>
      <p class="note tight">Their own words, from the same lexicon that names their rivers — sung on
        the scale their instruments derived.</p>` : ""}
  </div>`;
}

function chainHTML(m) {
  const steps = [
    ["the land", m.people.biomeLabel],
    ["materials", materialsOf(m.people).length + " workable"],
    ["bodies", m.insts.length + " instruments"],
    ["spectra", m.insts.filter(i => i.harmonic).length + " harmonic / " + m.insts.filter(i => !i.harmonic).length + " not"],
    ["roughness", m.scale.minima.length + " minima"],
    ["scale", m.scale.degrees.length + " degrees, frame " + m.scale.frame.cents.toFixed(0) + "¢"],
  ];
  return `<div class="card">
    <h2>The chain</h2>
    <div class="chain">${steps.map((s, i) => `<div class="link">
      <span class="lk">${esc(s[0])}</span><span class="lv">${esc(s[1])}</span>
      ${i < steps.length - 1 ? '<span class="arrow" aria-hidden="true">→</span>' : ""}</div>`).join("")}</div>
    <p class="note">And, from the other side: the people's language sets the rhythm, their surplus sets
      how many play, their literacy sets how long a piece can hold together, and what is happening to
      them right now sets the occasion. No step names a real tradition, and none of it is wired into
      the world sim — like the Language Lab and the emblem engine, this derives on demand and the
      simulation stays silent.</p>
  </div>`;
}

function controlsHTML() {
  const refs = Object.entries(REFERENCE_PEOPLES);
  return `<div class="card controls-card">
    <div class="controls">
      <label>Seed <input type="number" id="seed" value="${S.seed}" step="1" /></label>
      <label>Endowment
        <select id="ref">
          <option value="random"${S.ref === "random" ? " selected" : ""}>rolled from the world</option>
          ${refs.map(([k, v]) => `<option value="${k}"${S.ref === k ? " selected" : ""}>${esc(v.label)}</option>`).join("")}
        </select></label>
      <button id="roll">New people</button>
    </div>
    <p class="note tight">The pinned endowments are calibration targets: they fix the <em>inputs</em> a
      real tradition had — its metals, its crafts, its society — and let the mechanism derive the music.
      Nothing pins a scale or a rhythm.</p>
  </div>`;
}

function transportHTML() {
  return `<div class="transport">
    <button id="play" class="${S.playing ? "on" : ""}">${S.playing ? "◼ Stop" : "▶ Ambience"}</button>
    <label class="tl">Occasion
      <select id="occ">${Object.entries(OCCASIONS).map(([k, v]) =>
        `<option value="${k}"${S.occ === k ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
    <label class="tl sl">Distance
      <input type="range" id="intim" min="0" max="1" step="0.01" value="${S.intimacy}" />
      <span class="slv">${S.intimacy > 0.66 ? "in the city" : S.intimacy > 0.33 ? "nearby" : "far off"}</span></label>
    <label class="tl sl" title="A border settlement's ambience is an admixture: both traditions generated and sounded together, at the population proportions">Border
      <input type="range" id="blend" min="0" max="1" step="0.01" value="${S.blend}" />
      <span class="slv">${S.blend < 0.05 ? esc(P.people.name) : S.blend > 0.95 ? esc(PB.people.name) : Math.round((1 - S.blend) * 100) + "/" + Math.round(S.blend * 100)}</span></label>
  </div>`;
}

function render() {
  const m = P;
  document.getElementById("app").innerHTML = `
    <header>
      <h1>What a people <em>sounds</em> like</h1>
      <p class="tag">Give a culture a place, a set of crafts and a language, and its music follows.
        Nothing here picks a scale, a metre or an instrument: the land decides what can be built, the
        physics of those bodies decides which intervals sound consonant, and the tongue they speak
        decides how the rhythm moves.</p>
    </header>
    ${controlsHTML()}
    ${transportHTML()}
    <p class="nowplaying">${esc(m.people.name)} <span class="np2">of the ${esc(m.people.biomeLabel)}</span>${
      S.blend > 0.05 ? ` &nbsp;·&nbsp; blending with ${esc(PB.people.name)} <span class="np2">of the ${esc(PB.people.biomeLabel)}</span>` : ""}</p>
    ${tuningHTML(m)}
    ${instrumentsHTML(m)}
    ${rhythmHTML(m)}
    ${textureHTML(m)}
    ${pieceHTML(m)}
    ${peopleHTML(m)}
    ${chainHTML(m)}
    <footer class="foot">Simman Music Lab${typeof __BUILD__ !== "undefined" ? " · " + __BUILD__ : ""} —
      every sound on this page is synthesised from the instrument models; no audio is downloaded.</footer>`;
  wire();
  redraw();
}
function redraw() {
  const cv = document.getElementById("curve");
  if (cv) drawCurve(cv, P);
  const rc = document.getElementById("rhy");
  if (rc) drawRhythm(rc, P);
  document.querySelectorAll("canvas[data-spec]").forEach(c => drawSpectrum(c, P.insts[+c.dataset.spec]));
}

function wire() {
  const $ = (id) => document.getElementById(id);
  $("roll").onclick = () => { S.seed = (S.seed + 1) >>> 0; $("seed").value = S.seed; regen(); render(); };
  $("seed").onchange = (e) => { S.seed = (+e.target.value | 0) >>> 0; regen(); render(); };
  $("ref").onchange = (e) => { S.ref = e.target.value; regen(); render(); };
  $("play").onclick = () => { S.playing ? stopAmbient() : startAmbient(); render(); };
  $("occ").onchange = (e) => { S.occ = e.target.value; render(); };
  $("intim").oninput = (e) => {
    S.intimacy = +e.target.value;
    if (A) setDistance(A, S.intimacy);
    const sp = e.target.parentElement.querySelector(".slv");
    if (sp) sp.textContent = S.intimacy > 0.66 ? "in the city" : S.intimacy > 0.33 ? "nearby" : "far off";
  };
  $("blend").oninput = (e) => {
    S.blend = +e.target.value;
    const sp = e.target.parentElement.querySelector(".slv");
    if (sp) sp.textContent = S.blend < 0.05 ? P.people.name : S.blend > 0.95 ? PB.people.name : Math.round((1 - S.blend) * 100) + "/" + Math.round(S.blend * 100);
    document.querySelector(".nowplaying").innerHTML = `${esc(P.people.name)} <span class="np2">of the ${esc(P.people.biomeLabel)}</span>${
      S.blend > 0.05 ? ` &nbsp;·&nbsp; blending with ${esc(PB.people.name)} <span class="np2">of the ${esc(PB.people.biomeLabel)}</span>` : ""}`;
  };
  $("playPiece").onclick = () => { playPiece(); render(); };
  document.querySelectorAll("button[data-inst]").forEach(b => {
    b.onclick = () => {
      const inst = P.insts[+b.dataset.inst];
      const A = audio(); setDistance(A, 0.95);
      const t = A.ctx.currentTime + 0.05;
      // a short figure over their own scale, so you hear the body AND the tuning
      const fin = finalFor(P, S.occ);
      [0, 1, 2, 4, 2, 0].forEach((mi, i) =>
        playNote(A, inst, degreeHz(P, tonicOf(P), modeDegree(P, mi + fin), 0), t + i * 0.28, 0.36, 0.4));
    };
  });
  document.querySelectorAll("button[data-deg]").forEach(b => {
    b.onclick = () => {
      const A = audio(); setDistance(A, 0.95);
      const i = +b.dataset.deg;
      const lead = P.insts.find(x => x.cap >= 3) || P.insts[0];
      const t = A.ctx.currentTime + 0.04;
      const home = modeDegree(P, finalFor(P, S.occ));
      playNote(A, lead, degreeHz(P, tonicOf(P), home, 0), t, 0.7, 0.3);
      playNote(A, lead, degreeHz(P, tonicOf(P), i, 0), t + 0.02, 0.7, 0.38);
    };
  });
}

// ── styles ───────────────────────────────────────────────────────────────
// Sibling to the Language Lab's paper-and-ink chrome, with the accent moved
// to the metal these instruments are actually made of.
const CSS = `
:root{
  --paper:#f7f4ee; --ink:#231f19; --muted:#6f6857; --line:#dcd5c7;
  --card:#fffdf8; --accent:#8a5a2b; --accent-ink:#fff; --gloss:#2f6b6b; --chipbg:#eee8db;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#181614; --ink:#eae4d8; --muted:#9c9282; --line:#37312a;
  --card:#201d19; --accent:#d09a52; --accent-ink:#241a0e; --gloss:#6fb3ad; --chipbg:#282420;
}}
:root[data-theme="dark"]{
  --paper:#181614; --ink:#eae4d8; --muted:#9c9282; --line:#37312a;
  --card:#201d19; --accent:#d09a52; --accent-ink:#241a0e; --gloss:#6fb3ad; --chipbg:#282420;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.55 "Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;}
#app{max-width:60rem;margin:0 auto;padding:1.5rem 1.25rem 4rem;display:flex;flex-direction:column;gap:1.1rem}
header h1{font-size:2rem;margin:0;letter-spacing:.01em;text-wrap:balance}
header h1 em{color:var(--accent);font-style:italic}
.tag{color:var(--muted);margin:.4rem 0 0;max-width:44rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.2rem;
  display:flex;flex-direction:column;gap:.15rem}
.controls-card{padding:.8rem 1.2rem}
h2{font-size:1.15rem;margin:.1rem 0 .5rem}
h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:.8rem 0 .3rem}
.count{font-size:.85rem;color:var(--muted);font-weight:normal}
.note{color:var(--muted);font-size:.88rem;margin:.1rem 0 .7rem;max-width:46rem}
.note.tight{margin:.15rem 0}
.lede{font-size:1.05rem;margin:.1rem 0}
.k{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:1.4rem}
@media (max-width:700px){.grid2{grid-template-columns:1fr}}
.chips{display:flex;flex-wrap:wrap;gap:.3rem;margin:.2rem 0 .4rem}
.chip{background:var(--chipbg);border-radius:999px;padding:.1rem .55rem;font-size:.76rem}
.chip.mat{border:1px solid var(--line)}
.row{display:grid;grid-template-columns:8.5rem 1fr;align-items:center;gap:.6rem;margin:.22rem 0}
.meter{background:var(--chipbg);border-radius:3px;height:7px;overflow:hidden}
.meter span{display:block;height:100%;background:var(--accent)}
canvas{width:100%;display:block}
#curve{margin:.2rem 0 .5rem}
#rhy{margin:.3rem 0 .5rem}
.degrees{display:flex;flex-wrap:wrap;gap:.35rem;margin:.3rem 0 .7rem}
.deg{display:flex;flex-direction:column;align-items:flex-start;gap:.05rem;background:var(--chipbg);
  border:1px solid var(--line);border-radius:4px;padding:.3rem .55rem;cursor:pointer;color:var(--ink);font:inherit}
.deg:hover{border-color:var(--accent)}
.deg.measured{border-style:dashed;opacity:.82}
.deg{opacity:.45}
.deg.inmode{opacity:1;background:var(--card);border-color:var(--accent)}
.deg.home{box-shadow:inset 0 0 0 2px var(--accent)}
.moderow{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem;margin:.3rem 0 .1rem}
.mstep{font-family:ui-monospace,Menlo,monospace;font-size:.95rem;background:var(--chipbg);
  border:1px solid var(--line);border-radius:4px;padding:.15rem .5rem;font-variant-numeric:tabular-nums}
.mstep i{font-style:normal;font-size:.72em;opacity:.65}
.mstep.mhome{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.mframe{font-family:ui-monospace,Menlo,monospace;font-size:.95rem;color:var(--muted);
  border:1px dashed var(--line);border-radius:4px;padding:.15rem .5rem}
.marrow{color:var(--muted);font-size:.7rem}
.deg.measured .dc{color:var(--gloss)}
.factrow b.small{font-size:.95rem;line-height:1.5}
.dc{font-family:ui-monospace,Menlo,monospace;font-size:.95rem;color:var(--accent);font-variant-numeric:tabular-nums}
.dc i{font-style:normal;font-size:.7em;opacity:.7}
.dr{font-family:ui-monospace,Menlo,monospace;font-size:.72rem;color:var(--muted)}
.dj{font-size:.7rem;color:var(--gloss);font-style:italic}
.factrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.8rem;margin:.3rem 0 .2rem}
.factrow b{display:block;font-size:1.25rem;font-variant-numeric:tabular-nums;line-height:1.2}
.instgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(13.5rem,1fr));gap:.6rem}
.inst{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:5px;
  padding:.5rem .6rem;cursor:pointer;color:var(--ink);font:inherit;display:flex;flex-direction:column;gap:.15rem}
.inst:hover{border-color:var(--accent)}
.ihead{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}
.iname{font-size:.95rem}
.itag{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;padding:.05rem .35rem;border-radius:999px}
.itag.harm{background:var(--chipbg);color:var(--accent)}
.itag.inharm{background:var(--chipbg);color:var(--gloss)}
.imat{font-size:.76rem;color:var(--muted)}
.ifoot{display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);gap:.3rem}
.npvi{display:flex;flex-direction:column;gap:.25rem;margin-top:.3rem}
.npvirow{display:grid;grid-template-columns:7rem 1fr 2.4rem;align-items:center;gap:.6rem}
.npvirow b{font-variant-numeric:tabular-nums;text-align:right}
.transport{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:.7rem 1.1rem;align-items:center;
  background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.6rem .9rem}
.transport .tl{display:flex;align-items:center;gap:.4rem;font-size:.78rem;color:var(--muted);
  text-transform:uppercase;letter-spacing:.07em}
.transport .sl input{width:8rem;accent-color:var(--accent)}
.slv{color:var(--ink);text-transform:none;letter-spacing:0;font-size:.85rem;min-width:5.5rem}
.nowplaying{margin:0;font-size:1.05rem}
.np2{color:var(--muted);font-size:.85rem}
.controls{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center}
.controls label{display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--muted)}
select,input[type=number]{font:inherit;font-size:.9rem;color:var(--ink);background:var(--paper);
  border:1px solid var(--line);border-radius:4px;padding:.28rem .45rem}
input[type=number]{width:6.5rem}
button{font:inherit;font-size:.9rem;background:var(--accent);color:var(--accent-ink);
  border:none;border-radius:4px;padding:.4rem .9rem;cursor:pointer}
button:hover{filter:brightness(1.08)}
button.on{background:var(--gloss)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.formline{display:flex;gap:.25rem;margin:.5rem 0 .3rem}
.sec{background:var(--chipbg);border:1px solid var(--line);border-radius:4px;padding:.35rem .5rem;
  font-size:.75rem;color:var(--muted);text-align:center;overflow:hidden;white-space:nowrap}
.sung{font-size:1.15rem;letter-spacing:.02em;margin:.2rem 0}
.sung span{margin-right:.5rem}
.chain{display:flex;flex-wrap:wrap;gap:.4rem .2rem;align-items:center;margin:.3rem 0 .6rem}
.link{display:flex;align-items:center;gap:.5rem}
.lk{font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
.lv{font-size:.85rem;background:var(--chipbg);border-radius:4px;padding:.15rem .5rem}
.arrow{color:var(--accent);margin:0 .15rem}
.foot{color:var(--muted);font-size:.78rem;border-top:1px solid var(--line);padding-top:.7rem}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

// Test hook: the headless audio harness renders the very same graph the page
// plays, so measurements are of the real output and not of a parallel model.
function exposeForTests() {
  if (typeof window === "undefined") return;
  window.__LAB__ = { get music() { return P; }, get partner() { return PB; },
    makeAudio, setDistance, playNote, playVoice, ambientBar, composePiece, noteFreq, tonicOf, S };
}

export function mount() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  regen();
  render();
  exposeForTests();
  window.addEventListener("resize", () => redraw());
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
}
