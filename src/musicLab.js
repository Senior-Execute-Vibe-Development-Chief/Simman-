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
import { phoneticPlan, prosodyOf, vocablesOf } from "./sim/languagePhonetics.js";
import { GOD, SUN, RIVER, MOUNTAIN, KING, WATER, EARTH, SEA, MOON, GRAIN, HOUSE } from "./sim/languageLexicon.js";
import { MATERIALS, FAMILIES, rangeOf, makeVoice } from "./sim/musicInstruments.js";
import { nearJust, cents as toCents } from "./sim/musicTuning.js";
import { foundPeople, musicOf, materialsOf } from "./sim/musicGenome.js";
import { OCCASIONS, ambientBar, composePiece, ensembleFor, degreeHz, speechNPVI, finalFor, modeDegree, formOrderOf, phraseBank, phraseSkeleton } from "./sim/musicCompose.js";
import { makeAudio, setDistance, playNote, sungLine, playSung, silence } from "./sim/musicSynth.js";
import { loadSamples, sampledFor } from "./sim/musicSamples.js";
import { slidesTo } from "./sim/musicInstruments.js";
import { SAMPLE_BANK, SAMPLE_CREDIT, NAMED_BANK } from "./sim/musicSampleManifest.js";
import { voiceRange } from "./sim/vocalTract.js";
import { REFERENCE_PEOPLES } from "./sim/musicRefs.js";
import { TRADITIONS, applyTradition } from "./sim/musicTraditions.js";
import { makeInstrument } from "./sim/musicInstruments.js";
import { finalsOf } from "./sim/musicTuning.js";
import { buildMidiFile, buildMidiCsv, buildRollForAi } from "./sim/musicMidi.js";

// ── state ────────────────────────────────────────────────────────────────
const S = {
  // Defaults chosen so the mechanism is legible on arrival, the way the
  // Language Lab opens on a legible tongue: 1035 is a bowed-and-plucked
  // people whose every scale degree is HEARD in its own timbre, and 2015 —
  // the blend partner — is an all-metal tradition whose frame is not an
  // octave at all, so sliding the border control is an audible argument.
  seed: 1035, ref: "random", trad: "", occ: "peace", intimacy: 0.72, blend: 0,
  // WHICH BODY YOU HEAR. `recorded` plays one real instrument per family out of
  // two CC0 sample libraries; `modelled` synthesises the body this people
  // actually built, from its materials. The recording sounds like an
  // instrument and the model sounds like this people's instrument, and those
  // are not the same virtue — so it is a switch, and the bench exists to make
  // the difference audible rather than arguable.
  sampled: true,
  // FORM LISTEN: strip samples/models to plain oscillators and keep only the
  // structural roles (skeleton, lead, bass, punctuation). Form is a pitch/time
  // question; timbre was eating the debugging budget.
  formListen: false,
  // How much voice is in the mix. The synthesis path is calibrated so a
  // singer and a player agree on what a velocity means (musicSynth), but how
  // much SINGING you want over an ensemble is a listener's call and not a
  // physical fact — and an articulatory tract at a sung pitch is the least
  // convincing thing this engine makes. So it is a control, and it starts
  // where the voice is present without fronting the band.
  voice: 0.18,
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
/** The primary people, as a pinned real tradition if one is selected. */
function buildWithTradition(seed, ref, trad) {
  const m = build(seed, ref);
  return trad && TRADITIONS[trad] ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
}
function regen() {
  world = newWorld();
  P = buildWithTradition(S.seed, S.ref, S.trad);
  PB = build(S.seedB, S.refB);
  S.piece = null;
  ROLL.previewKey = "";
  if (!ROLL.live) ROLL.notes = [];
}

// ── audio plumbing ───────────────────────────────────────────────────────
// The recorded bank arrives either inlined into a single-file build or as
// files next to the page. Neither is this module's business beyond finding it,
// and a bank that fails to arrive is not an error: every family falls back to
// the synthesis it already had.
function sampleSource(file) {
  const inline = typeof window !== "undefined" && window.__SAMPLE_DATA__;
  const b64 = inline && inline[file];
  if (b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  return "assets/instr-audio/" + file;
}

function audio() {
  if (!A) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    A = makeAudio(new Ctx());
    loadSamples(A, sampleSource).then(() => {
      const n = A.sampleCount || 0;
      const el = document.getElementById("bankstate");
      if (el) el.textContent = n ? `${n} recorded samples loaded` : "no bank — synthesis only";
    }).catch(() => { /* synthesis is a working instrument */ });
  }
  A.sampled = S.sampled && !S.formListen;
  A.formPlain = !!S.formListen;
  if (P) { A.music = P; A.tonicHz = tonicOf(P); }
  if (A.ctx.state === "suspended") A.ctx.resume();
  return A;
}
/** The tonic a people sings at: low for big struck metal, higher for pipes. */
function tonicOf(m, occ) {
  // A melody wants to sit where a voice sits: the singer's own range is where
  // pitch is heard most sharply.
  //
  // But WHICH pitch goes there has to be the mode's own home, and it was
  // scale degree zero — so a people whose final is the fifth degree of its
  // mode sang its home a seventh above the reference, and its whole line sat
  // jammed against the top of the frame with nowhere to rise. Measured, only
  // a third of lines even began on their own final. Divide the reference by
  // the final's own ratio and every people, whatever degree it calls home,
  // sings that degree at the same comfortable pitch.
  const base = 294 * (m.melody.breathBound ? 1.12 : 1);
  const fin = finalFor(m, occ || S.occ);
  const d = m.scale.degrees[((modeDegree(m, fin) % m.scale.degrees.length) + m.scale.degrees.length) % m.scale.degrees.length];
  return base / (d ? d.ratio : 1);
}
/**
 * A part is placed where its own body can actually sound it. Nearly a quarter
 * of all notes used to be written below the lowest note their instrument has —
 * a bass part was out of range four times in five, and a flute asked to play
 * the bass line sat a median of fifteen semitones under its own bottom note,
 * because the octave came from a literal in the composer rather than from the
 * body. Move it by whole frames until it fits: a player who cannot reach a
 * note plays it in the octave they can.
 */
/** The pitches a set of sympathetic strings would be tuned to: this people's
 *  own mode, across the range the played strings cover. */
const SYMP = new Map();
function sympPitches(m) {
  const key = m.people.seed + ":" + m.mode.idx.join(",");
  let hz = SYMP.get(key);
  if (hz) return hz;
  const t = tonicOf(m);
  hz = [];
  for (let o = -1; o <= 1; o++) for (let d = 0; d < m.mode.idx.length; d++) {
    hz.push(degreeHz(m, t, modeDegree(m, d), o));
  }
  SYMP.set(key, hz);
  return hz;
}
function noteFreq(m, ev) {
  let f = degreeHz(m, tonicOf(m), ev.deg, ev.oct);
  const frame = m.scale.frame.ratio;
  const inst = m.insts[ev.inst];
  let low = 0, top = 0;
  if (inst && FAMILIES[inst.fam] && FAMILIES[inst.fam].low) {
    // how much instrument there actually IS above the bottom note — see
    // `rangeOf`, which asks what the player can do to the vibrating element
    // rather than counting the pitches they can place
    ({ low, top } = rangeOf(inst, m.mode ? m.mode.size : 7));
  } else if (ev.role === "voice") {
    // A VOICE HAS A BODY TOO — and it was the one part with no range at all.
    // A sung event carries `inst: -1`, so `m.insts[ev.inst]` is undefined and
    // this clamp, the thing that keeps every instrument inside what it can
    // actually play, was skipped for the singer alone. The voice was simply
    // handed whatever octave the lead's body happened to sit in: a horn-led
    // people's singer was sent up where a horn sits, a bell-led one's up where
    // a bell sits, and the tract obligingly tried. Measured over sixty
    // peoples, THIRTY-SIX were being asked for notes outside 70-500 Hz, the
    // highest for 1318 Hz — E6, a coloratura's top note, out of a tract
    // modelled on a 105 Hz speaking voice. Clamped, the same sixty sing
    // between 109 and 353 Hz.
    ({ low, top } = voiceRange(prosodyOf(m.people.lang)));
  }
  if (!low) return f;
  // FOLD INTO THE BODY, and if the body is narrower than a frame, sit AT it.
  // A drum has about two thirds of an octave and a tanpura has four strings;
  // folding a note into a window narrower than the fold step just ping-ponged
  // it — up over the top, down under the bottom, forever — and the guard
  // counter then left it wherever it happened to stop. Measured, every one of
  // a darbuka's 130 strokes came out at 74 Hz against a family floor of 80.
  let guard = 0;
  while (f < low * 0.94 && guard++ < 5) f *= frame;
  while (f > top && guard++ < 9) f /= frame;
  if (f < low * 0.94) f = low;
  else if (f > top) f = top;
  return f;
}

/**
 * The sung part is not scheduled note by note: the vocal tract renders a whole
 * PHRASE offline, because a line of singing is one continuous gesture of one
 * air column and the joins between its notes are half of what makes it sound
 * sung. So voice events are gathered into breath-groups first — a gap wider
 * than a beat is where a singer takes a breath — and each group is rendered
 * and scheduled as one buffer.
 */
/**
 * A SINGER TRANSPOSES THE PHRASE, NOT THE NOTE.
 *
 * `noteFreq` folds each note into its body's compass on its own, and for an
 * instrument that is right — a flute has no lower octave, so a note below its
 * range simply comes out an octave up and nobody is surprised. A voice is not
 * like that. It carries a LINE, and folding one note of a line by a whole
 * frame in the middle of a breath is an octave jump no singer makes and
 * nothing in the melody prepared. Measured over 120 peoples, 40.3% of sung
 * notes were being displaced by the compass and 8.9% of breath groups had a
 * fold inside them — a fault I introduced with the singer's range itself.
 *
 * So the group moves together, by the one whole number of frames that leaves
 * least of it outside the singer's compass; where several fit, the one that
 * sits the phrase most centrally in the voice. Two rules, no weights.
 */
function phraseFreqs(m, g) {
  const raw = g.map(e => degreeHz(m, tonicOf(m), e.deg, e.oct));
  const { low, top } = voiceRange(prosodyOf(m.people.lang));
  const frame = m.scale.frame.ratio;
  const mid = Math.sqrt(low * top);
  let best = raw, bestOut = Infinity, bestOff = Infinity;
  for (let k = -3; k <= 3; k++) {
    const f = Math.pow(frame, k);
    const v = raw.map(r => r * f);
    const out = v.filter(x => x < low || x > top).length;
    const off = Math.abs(v.reduce((a, x) => a + Math.log2(x / mid), 0) / v.length);
    if (out < bestOut || (out === bestOut && off < bestOff)) { bestOut = out; bestOff = off; best = v; }
  }
return best;
}
/**
 * THE SUNG LINE, ON A RECORDED CHOIR.
 *
 * This used to render each breath group through the vocal tract — a
 * Kelly-Lochbaum waveguide of the real air column, singing the people's OWN
 * WORDS, one syllable a note, in their own language. As an idea that is the
 * best thing in this engine and it is not going anywhere: it is still what
 * langLab speaks with, and it is the only reason a generated tongue can be
 * heard at all rather than read.
 *
 * It is the wrong thing HERE, for two reasons that point the same way.
 *
 * The first is honest and unflattering: a physical model of a throat next to
 * recorded oud, koto and violin announces itself as a synthesiser the moment
 * it opens its mouth. Every other body in this ensemble is a real recording of
 * a real instrument, and the one part a listener has a lifetime of practice
 * judging was the one part that was modelled.
 *
 * The second is that the music does not need the words. What makes speech
 * intelligible is the consonants, and they are the quiet part — brief, well
 * under the vowels they surround, and in the band air absorbs fastest. Across
 * a settlement you hear that people are singing and not a syllable of what.
 * So a sung line heard as music is a wordless one whatever synthesises it, and
 * a recorded choir on an open vowel is both the better sound and the truer one.
 *
 * The words stay on the page, where they are still theirs and still legible.
 */
const VOICE_BODY = new Map();
function voiceBody(m) {
  let v = VOICE_BODY.get(m.people.seed);
  if (!v) VOICE_BODY.set(m.people.seed, v = makeVoice(m.people.seed, { people: m.people, texture: m.texture }));
  return v;
}
function fireVoiceLine(m, evs, when0, spb, gain, _voc, Aud) {
  if (!evs.length || S.formListen) return;
  const A = Aud || audio();
  const V = voiceBody(m);
  const sorted = [...evs].sort((a, b) => a.b - b.b);
  // A BREATH GROUP MOVES TOGETHER. `phraseFreqs` picks the one octave that
  // sits the whole group in the singer's compass, so the split has to happen
  // before the pitches are chosen — a fold in the middle of a breath is an
  // octave jump no singer makes.
  const groups = [];
  let cur = [];
  for (let i = 0; i < sorted.length; i++) {
    cur.push(sorted[i]);
    const nx = sorted[i + 1];
    if (!nx || nx.b - (sorted[i].b + sorted[i].dur) > 0.9) { groups.push(cur); cur = []; }
  }
  for (const g of groups) {
    const line = phraseFreqs(m, g);
    g.forEach((e, i) => {
      // the note lasts until the next one starts: a singer joins them
      const dur = ((g[i + 1] ? g[i + 1].b : e.b + e.dur) - e.b) * spb;
      // ONE THROAT. A voice channel is one singer, so starting a note releases
      // the one being left — the same rule `fireEvent` applies to every player
      // with one pair of hands, and what used to need a `THROAT` map of its own.
      playNote(A, V, line[i], when0 + e.b * spb, Math.max(0.12, dur), e.vel * gain * S.voice,
        { role: "voice", channel: `${m.people.seed}:voice`, damped: false,
          music: m, tonicHz: tonicOf(m) });
    });
  }
}
const FORM_ROLES = new Set(["skeleton", "lead", "bass", "mark", "pulse"]);

function fireEvent(m, ev, when, secPerBeat, gain, Aud) {
  if (S.formListen && !FORM_ROLES.has(ev.role)) return;
  const A = Aud || audio();
  const inst = m.insts[ev.inst] || m.insts[0];
  if (!inst && !S.formListen) return;
  const f = noteFreq(m, ev);
  // Each melodic part is a VOICE CHANNEL: a player's free hand stops the note
  // they are replacing and leaves everything else ringing. A marker stroke
  // belongs to no channel — its ring is the point.
  playNote(A, inst || { detune: 0 }, f, when, ev.dur * secPerBeat, ev.vel * gain, {
    music: m,
    tonicHz: tonicOf(m),
    symp: inst && inst.symp ? sympPitches(m) : null,
    role: ev.role === "het" ? "het" : ev.role || "lead",
    stroke: ev.stroke,
    damped: ev.damped != null ? ev.damped : !!(inst && inst.damped),
    channel: ev.ring || ev.role === "pad" || ev.role === "pulse" ? null
      : `${m.people.seed}:${ev.role}:${ev.inst}${ev.voice != null ? ":" + ev.voice : ""}`,
  });
  // the ornament's pitch comes from the composer, already a MODE step and
  // already placed a subdivision ahead — the Lab never invents an interval
  // An ornament belongs to the part it decorates: same player, same hand, so
  // the same role and the same voice channel. Played with no options at all it
  // went out on the lead bus whatever it was decorating, was never damped, and
  // on a body that rings for nine seconds an eighty-millisecond grace note rang
  // for nine of them.
  if (ev.ornDeg != null && !S.formListen) {
    const nb = degreeHz(m, tonicOf(m), ev.ornDeg, ev.oct);
    playNote(A, inst, nb, Math.max(0, when - ev.ornLead * secPerBeat), 0.08, ev.vel * gain * 0.5, {
      music: m,
      tonicHz: tonicOf(m),
      role: ev.role === "het" ? "het" : ev.role || "lead",
      damped: true,
      channel: `${m.people.seed}:${ev.role}:${ev.inst}:orn`,
    });
  }
}

// WHAT THE AMBIENT LAYER SINGS. The piece is a hymn and names its god, so it
// sings words. The ambient layer is the sound of a people going about their
// day, and a day's singing runs on VOCABLES — the syllables the tongue can
// hold a pitch through, derived from its own inventory. (Until now this layer
// had no syllables at all: the lanes were built without them, so the voice —
// the one instrument every people has — was silent in the ambience.)
const VOC = new WeakMap();
function vocOf(m) {
  let v = VOC.get(m);
  if (!v) { v = vocablesOf(m.people.lang); VOC.set(m, v); }
  return v;
}

// ── piano roll: the composition as pitch × time, coloured by role ────────
//
// Form is hard to hear under samples. The roll makes the layers visible:
// skeleton trunk, lead surface, bass, punctuation, elaboration. Idle = a
// preview of the current piece plan; Ambience/Play feed live notes and a
// playhead. Layer chips mute rows on the roll only (sound unchanged).
const ROLL_COLORS = {
  skeleton: "#8b6914", core: "#8b6914", lead: "#b4532a", voice: "#c45c26",
  bass: "#2f5d50", ost: "#3d6b5a", pad: "#7a8f9c", elab: "#a67c52",
  het: "#9a7b4f", mark: "#5c6b4a", pulse: "#6b7280",
};
const ROLL_LABELS = {
  skeleton: "skeleton", core: "core", lead: "lead", voice: "voice",
  bass: "bass", ost: "ostinato", pad: "drone", elab: "elaboration",
  het: "heterophony", mark: "punctuation", pulse: "percussion",
};
const ROLL = {
  notes: [], live: false, t0: 0, spb: 0.5, totalBeats: 0, viewBeats: 16,
  hidden: new Set(), raf: 0, previewKey: "",
};
function rollReset(opts = {}) {
  ROLL.notes = [];
  ROLL.live = !!opts.live;
  ROLL.t0 = opts.t0 != null ? opts.t0 : 0;
  ROLL.spb = opts.spb != null ? opts.spb : ROLL.spb;
  ROLL.totalBeats = opts.totalBeats != null ? opts.totalBeats : 0;
  if (opts.viewBeats != null) ROLL.viewBeats = opts.viewBeats;
}
function feedRoll(m, events, beat0 = 0) {
  for (const ev of events || []) {
    if (S.formListen && !FORM_ROLES.has(ev.role)) continue;
    let hz = 0;
    try {
      if (ev.role === "pulse" && (ev.deg == null || ev.deg === 0) && !ev.oct) hz = 0;
      else hz = noteFreq(m, ev) || 0;
    } catch { hz = 0; }
    ROLL.notes.push({
      b: beat0 + (ev.b || 0),
      dur: Math.max(0.08, ev.dur || 0.25),
      hz, role: ev.role || "lead",
      vel: ev.vel || 0.3,
    });
  }
  // Ambient can run forever — keep a trailing window so the canvas stays light.
  if (ROLL.live && ROLL.notes.length > 2400) {
    const cut = Math.max(0, ROLL.totalBeats - ROLL.viewBeats * 3);
    ROLL.notes = ROLL.notes.filter(n => n.b + n.dur >= cut);
  }
}
function seedRollPreview(m) {
  if (ROLL.live) return;
  const key = `${m.people.seed}|${S.occ}|${S.intimacy.toFixed(2)}|${S.formListen ? 1 : 0}|${m.form.process || ""}`;
  if (ROLL.previewKey === key && ROLL.notes.length) return;
  ROLL.previewKey = key;
  let piece;
  try { piece = composePiece(m, S.occ, null, S.intimacy); }
  catch { rollReset({ live: false, totalBeats: 0 }); return; }
  rollReset({
    live: false, t0: 0,
    spb: 60 / piece.tempo,
    totalBeats: piece.totalBeats,
    viewBeats: Math.min(24, Math.max(8, piece.totalBeats)),
  });
  feedRoll(m, piece.events, 0);
}
function rollPlayheadBeat() {
  if (!ROLL.live || !A) return -1;
  return Math.max(0, (A.ctx.currentTime - ROLL.t0) / Math.max(1e-6, ROLL.spb));
}
function startRollAnim() {
  if (ROLL.raf) cancelAnimationFrame(ROLL.raf);
  const tick = () => {
    const cv = document.getElementById("pianoroll");
    if (cv && P) drawPianoRoll(cv, P);
    if (ROLL.live) ROLL.raf = requestAnimationFrame(tick);
    else ROLL.raf = 0;
  };
  ROLL.raf = requestAnimationFrame(tick);
}
function drawPianoRoll(cv, m) {
  if (!ROLL.live) seedRollPreview(m);
  const { g, w, h } = fitCanvas(cv, 220);
  g.clearRect(0, 0, w, h);
  const padL = 44, padR = 8, padT = 10, padB = 22;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const head = rollPlayheadBeat();
  let t0 = 0, t1 = Math.max(ROLL.viewBeats, ROLL.totalBeats || ROLL.viewBeats);
  if (ROLL.live && head >= 0) {
    const half = ROLL.viewBeats * 0.35;
    t0 = Math.max(0, head - half);
    t1 = t0 + ROLL.viewBeats;
  } else if (!ROLL.live && ROLL.totalBeats > 0) {
    t1 = ROLL.totalBeats;
    t0 = 0;
  }
  const span = Math.max(0.01, t1 - t0);
  const X = (b) => padL + ((b - t0) / span) * innerW;

  const pitched = ROLL.notes.filter(n => n.hz > 30 && n.b < t1 && n.b + n.dur > t0
    && !ROLL.hidden.has(n.role));
  const unpitched = ROLL.notes.filter(n => !(n.hz > 30) && n.b < t1 && n.b + n.dur > t0
    && !ROLL.hidden.has(n.role));
  let lo = Infinity, hi = -Infinity;
  for (const n of pitched) {
    if (n.hz < lo) lo = n.hz;
    if (n.hz > hi) hi = n.hz;
  }
  if (!(hi > lo)) { lo = 110; hi = 440; }
  // pad a musical sixth so notes aren't flush with the edges
  lo *= 0.89; hi *= 1.12;
  const Y = (hz) => {
    if (!(hz > 30)) return padT + innerH - 6;
    const u = Math.log(hz / lo) / Math.log(hi / lo);
    return padT + innerH - u * (innerH - 10);
  };
  const rowH = Math.max(3, Math.min(10, innerH / 28));

  // beat grid
  g.strokeStyle = css("--line");
  g.lineWidth = 1;
  const beatStep = span > 20 ? 2 : 1;
  for (let b = Math.ceil(t0); b <= t1; b += beatStep) {
    const x = X(b);
    g.globalAlpha = b % (m.rhythm.beats || 4) === 0 ? 0.85 : 0.35;
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + innerH); g.stroke();
  }
  g.globalAlpha = 1;

  // unpitched strip (percussion) along the floor
  for (const n of unpitched) {
    const x = X(n.b), wd = Math.max(2, X(n.b + n.dur) - x - 0.5);
    g.globalAlpha = 0.35 + 0.45 * Math.min(1, n.vel);
    g.fillStyle = ROLL_COLORS[n.role] || css("--muted");
    g.fillRect(x, padT + innerH - 5, wd, 4);
  }
  g.globalAlpha = 1;

  // pitched notes — draw quieter layers first so lead/skeleton sit on top
  const z = (r) => ({ pulse: 0, pad: 1, ost: 2, bass: 3, elab: 4, het: 5, mark: 6,
    skeleton: 7, core: 7, voice: 8, lead: 9 }[r] || 5);
  const ordered = pitched.slice().sort((a, b) => z(a.role) - z(b.role));
  for (const n of ordered) {
    const x = X(n.b);
    const wd = Math.max(2.5, X(n.b + n.dur) - x - 0.4);
    const y = Y(n.hz) - rowH / 2;
    const active = ROLL.live && head >= n.b && head < n.b + n.dur;
    g.globalAlpha = active ? 1 : 0.55 + 0.4 * Math.min(1, n.vel);
    g.fillStyle = ROLL_COLORS[n.role] || css("--accent");
    g.fillRect(x, y, wd, rowH);
    if (active) {
      g.strokeStyle = css("--ink");
      g.lineWidth = 1;
      g.strokeRect(x, y, wd, rowH);
    }
  }
  g.globalAlpha = 1;

  // playhead
  if (ROLL.live && head >= t0 && head <= t1) {
    const x = X(head);
    g.strokeStyle = css("--gloss");
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + innerH); g.stroke();
  }

  // axis labels
  g.fillStyle = css("--muted");
  g.font = "10px ui-monospace, monospace";
  g.textAlign = "right";
  g.fillText(Math.round(hi) + " Hz", padL - 4, padT + 9);
  g.fillText(Math.round(lo) + " Hz", padL - 4, padT + innerH);
  g.textAlign = "left";
  g.fillText(ROLL.live ? "live" : "preview", padL, h - 6);
  g.textAlign = "right";
  g.fillText(`${t0.toFixed(0)}–${t1.toFixed(0)} beats`, w - padR, h - 6);
}

// ── export the roll as Standard MIDI (SMF) ───────────────────────────────
//
// MIDI is the interchange format every DAW's piano roll imports. Derived
// scales snap to nearest 12-TET in the .mid; the CSV keeps Hz and cents.
// Hidden layers are omitted. See `musicMidi.js`.
function rollVisibleNotes() {
  return ROLL.notes.filter(n => !ROLL.hidden.has(n.role));
}
function rollExportOpts(m) {
  return {
    bpm: Math.round(60 / Math.max(1e-6, ROLL.spb)),
    beatsPerBar: (m.rhythm && m.rhythm.beats) || 4,
    name: (m.people && m.people.name) || "simman",
    seed: m.people && m.people.seed,
    occ: S.occ,
    formProcess: m.form && m.form.process,
    roleLabels: ROLL_LABELS,
  };
}
function downloadBytes(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function rollExportName(m, ext) {
  const who = String((m.people && m.people.name) || "people").replace(/[^\w\-]+/g, "_").slice(0, 40);
  return `${who}_${S.occ}_${m.people.seed}.${ext}`;
}
async function exportRollMidi(m) {
  if (!ROLL.live) seedRollPreview(m);
  const notes = rollVisibleNotes();
  if (!notes.length) { flashRollExport("nothing to export — show at least one layer"); return; }
  const bytes = buildMidiFile(notes, rollExportOpts(m));
  downloadBytes(rollExportName(m, "mid"), bytes, "audio/midi");
  flashRollExport(`downloaded ${rollExportName(m, "mid")}`);
}
/** Primary copy: self-describing JSON+legend for pasting into an AI. */
async function copyRollForAi(m) {
  if (!ROLL.live) seedRollPreview(m);
  const notes = rollVisibleNotes();
  if (!notes.length) { flashRollExport("nothing to copy — show at least one layer"); return; }
  const { text } = buildRollForAi(notes, rollExportOpts(m));
  try {
    await navigator.clipboard.writeText(text);
    flashRollExport(`copied AI roll (${notes.length} notes) — paste into a chat`);
  } catch {
    downloadBytes(rollExportName(m, "json.txt"), new TextEncoder().encode(text), "text/plain");
    flashRollExport("clipboard blocked — downloaded .json.txt instead");
  }
}
async function copyRollCsv(m) {
  if (!ROLL.live) seedRollPreview(m);
  const notes = rollVisibleNotes();
  if (!notes.length) { flashRollExport("nothing to copy — show at least one layer"); return; }
  const csv = buildMidiCsv(notes, rollExportOpts(m));
  try {
    await navigator.clipboard.writeText(csv);
    flashRollExport("copied CSV note table");
  } catch {
    downloadBytes(rollExportName(m, "csv"), new TextEncoder().encode(csv), "text/csv");
    flashRollExport("clipboard blocked — downloaded .csv instead");
  }
}
function flashRollExport(msg) {
  const el = document.getElementById("rollexportmsg");
  if (!el) return;
  el.textContent = msg;
  el.dataset.on = "1";
  clearTimeout(flashRollExport._t);
  flashRollExport._t = setTimeout(() => { el.textContent = ""; el.dataset.on = ""; }, 4200);
}

function rollHTML(m) {
  seedRollPreview(m);
  const present = new Set(ROLL.notes.map(n => n.role));
  // Always offer the form-critical layers even if this preview is thin.
  for (const r of ["skeleton", "lead", "bass", "mark", "pulse"]) present.add(r);
  const roles = [...present].sort((a, b) => (ROLL_LABELS[a] || a).localeCompare(ROLL_LABELS[b] || b));
  return `<div class="card">
    <h2>Piano roll <span class="count">— layers in time</span></h2>
    <p class="note">Pitch up the page, time across. Colour is the part: skeleton is the trunk,
      lead the surface, bass and punctuation the ground. Idle shows the current piece plan;
      Ambience and Play the piece scroll a live playhead. Chips hide a layer on the roll only —
      and what is visible is what gets exported.</p>
    <canvas id="pianoroll"></canvas>
    <div class="rolllegs" id="rolllegs">${roles.map(r => {
      const on = !ROLL.hidden.has(r);
      return `<button type="button" class="rollchip${on ? " on" : ""}" data-roll="${esc(r)}"
        style="--rc:${ROLL_COLORS[r] || css("--accent")}">${esc(ROLL_LABELS[r] || r)}</button>`;
    }).join("")}</div>
    <div class="rollexport">
      <button type="button" id="rollcopyai">Copy for AI</button>
      <button type="button" id="rollmid" class="ghost">Download MIDI</button>
      <button type="button" id="rollcopycsv" class="ghost">Copy CSV</button>
      <span class="note tight" id="rollexportmsg"></span>
    </div>
    <p class="note tight"><b>Copy for AI</b> puts a self-describing JSON document on the clipboard
      (legend + layers + notes with beats, Hz, nearest ET name). Paste it into a chat.
      <b>Download MIDI</b> is for DAWs (12-TET snap). Hidden layers are omitted.</p>
  </div>`;
}

// ── the ambient layer: a lookahead scheduler that never loops ─────────────
// One clock PER TRADITION. The first cut advanced a single clock by the
// longer of the two cycles, which inserted a ragged gap of silence after the
// shorter one every time round — enough on its own to destroy the pulse.
const SCHED = { lanes: [], timer: null };
function stopAmbient() {
  // CLEARING THE TIMER ONLY STOPS WHAT HAS NOT BEEN SCHEDULED YET. The
  // scheduler runs a couple of seconds ahead and the bodies ring for as long as
  // they ring — a gong for eighteen seconds, a bell for eight — so this used to
  // leave the room sounding well after the button said it had stopped.
  if (SCHED.timer) clearInterval(SCHED.timer);
  SCHED.timer = null; S.playing = false;
  if (A) silence(A);
  ROLL.live = false;
}
function startAmbient() {
  const A = audio();
  setDistance(A, S.intimacy, P.texture.courtly);
  const t0 = A.ctx.currentTime + 0.12;
  SCHED.lanes = [{ m: () => P, bar: 0, next: t0, w: () => 1 - S.blend, beatAt: 0 },
                 { m: () => PB, bar: 0, next: t0, w: () => S.blend, beatAt: 0 }];
  // LIVE ROLL: clear and follow the primary lane's clock. The blend partner
  // still sounds, but the roll is the people you're listening as.
  rollReset({ live: true, t0, spb: 60 / Math.max(40, P.rhythm.tempo * OCCASIONS[S.occ].tempo),
    totalBeats: 0, windowBeats: 12 });
  SCHED.timer = setInterval(pump, 110);
  S.playing = true; pump();
  startRollAnim();
}
function pump() {
  if (!A) return;
  const now = A.ctx.currentTime;
  // A border settlement's ambience IS an admixture: both peoples' music at
  // the population proportions, each keeping its own tempo and metre.
  for (const lane of SCHED.lanes) {
    const m = lane.m();
    if (!m) continue;
    // A backgrounded tab throttles this timer to once a second or worse, and
    // the lane clock has no idea. Without resyncing, a thirty-second stall
    // schedules three hundred notes in one pass, nearly all of them dated in
    // the past — and Web Audio fires a past-dated start immediately, so they
    // all land at once as a crash and the lane runs behind for ever after.
    if (lane.next < now - 0.05) lane.next = now + 0.05;
    while (lane.next < now + 0.8) {
      const plan = ambientBar(m, { occ: S.occ, intimacy: S.intimacy, bar: lane.bar, seed: m.people.seed });
      const spb = 60 / plan.tempo;
      const w = lane.w();
      if (w >= 0.02) {
        for (const ev of plan.events) if (ev.role !== "voice") fireEvent(m, ev, lane.next + ev.b * spb, spb, w);
        const sung = plan.events.filter(e => e.role === "voice");
        if (sung.length) fireVoiceLine(m, sung, lane.next, spb, w, vocOf(m));
      }
      // Primary lane feeds the piano roll (beat clock, not wall clock).
      if (lane === SCHED.lanes[0] && w >= 0.02) {
        ROLL.spb = spb;
        feedRoll(m, plan.events, lane.beatAt || 0);
        lane.beatAt = (lane.beatAt || 0) + plan.beats;
        ROLL.totalBeats = Math.max(ROLL.totalBeats, lane.beatAt);
      }
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
  let acc = null;
  for (let i = 0; out.length < n && i < concepts.length; i++) {
    const c = concepts[i];
    try {
      const form = langWordForm(lang, c);
      const plan = phoneticPlan(lang, form);
      out.push(...plan.syls);
      acc = acc || plan.acc;
      words.push(langWord(lang, c));
    } catch { /* a concept the lexicon can't reach is simply skipped */ }
  }
  return { syls: out.slice(0, Math.max(4, n)), words, acc };
}
function playPiece() {
  const A = audio();
  // one clock at a time: the piece and the ambience share a people, so they
  // also share voice channels, and each was damping the other's notes mid-note
  if (S.playing) stopAmbient();
  // AND A SECOND PRESS REPLACES THE FIRST. A piece is scheduled all at once,
  // so pressing play again simply laid another whole performance over the one
  // still running — two tempi, two ensembles, the same people.
  silence(A);
  // WHERE THE LISTENER IS STANDING GOVERNS THE PIECE TOO. This forced 0.9 —
  // the front row — whatever the distance control said, and then asked the
  // composer for a piece written for the front row as well. So the one thing
  // the control could never show you was the thing it is for: what this
  // people's music sounds like from across their settlement, which is the
  // music a listener in the world actually hears. Same slider, both ends.
  setDistance(A, S.intimacy, P.texture.courtly);
  const hymn = hymnSyllables(P, 10);
  const piece = composePiece(P, S.occ, hymn.syls, S.intimacy);
  S.piece = { ...piece, words: hymn.words };
  const spb = 60 / piece.tempo;
  const t0 = A.ctx.currentTime + 0.15;
  rollReset({ live: true, t0, spb, totalBeats: piece.totalBeats,
    viewBeats: Math.min(24, Math.max(10, piece.totalBeats)) });
  ROLL.previewKey = "";
  feedRoll(P, piece.events, 0);
  startRollAnim();
  for (const ev of piece.events) {
    if (ev.role === "voice") continue;
    fireEvent(P, ev, t0 + ev.b * spb, spb, 1);
  }
  fireVoiceLine(P, piece.events.filter(e => e.role === "voice"), t0, spb, 1,
    { syls: hymn.syls, acc: hymn.acc, rotate: true });
  // When the piece ends, freeze the roll on the full score.
  const endAt = (piece.totalBeats * spb + 0.2) * 1000;
  setTimeout(() => { if (ROLL.t0 === t0) ROLL.live = false; }, endAt);
  return piece;
}

// ── the listening test ───────────────────────────────────────────────────
//
// WHICH PART SOUNDS WRONG? Rating whole pieces only ever gives a correlation,
// and this engine has already had two of those turn out to be the wrong
// variable — "the narrow steps are the problem" (they are not: a just diatonic
// semitone measures rougher than the step that was blamed) and "the bumpy
// curves are the problem" (curve depth separated none of the five peoples
// judged by ear). What settles a question like that is an ABLATION: play the
// same people with one layer changed at a time, and the layer whose change
// moves the rating is the layer at fault.
//
// The decisive pair is `full` against `tuned12`. Both are the same composition,
// the same bodies, the same rhythm, the same everything — rendered once through
// this people's own derived scale and once through equal temperament. If the
// tempered one is rated better, the tuning is the fault. If they rate the same,
// the tuning is exonerated no matter how the dissonance curve looks, and the
// fault is in the line, the texture or the synthesis. `melody` and `backing`
// then split those.
//
// Trials are BLIND — the condition is hidden until after the rating — and drawn
// at random, so stopping at any point leaves a balanced sample rather than a
// truncated sweep.
const TRIALS = [
  { key: "full",     what: "the piece exactly as the engine makes it — the control" },
  { key: "tuned12",  what: "the same piece, same tune, same bodies, every scale degree snapped to equal temperament" },
  { key: "justdia",  what: "the same piece again, every degree snapped to the nearest simple whole-number ratio" },
  { key: "modelled", what: "the same piece on bodies synthesised from this people's own materials, instead of the recordings" },
  { key: "plain",    what: "the same piece with the heterophony and the ornaments out — one line and its accompaniment" },
  { key: "novoice",  what: "the same piece with the singers out — instruments only" },
];
const OCC_KEYS = Object.keys(OCCASIONS);
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 7 / 5, 3 / 2, 8 / 5, 5 / 3, 7 / 4, 9 / 5, 15 / 8, 2];

/** Re-pitch a people's scale without touching anything else about them, so the
 *  SAME composition can be rendered through a different tuning. The mode's
 *  indices, the instruments, the rhythm and every event are untouched — only
 *  where the degrees sit moves. */
function retune(m, how) {
  if (how === "full") return m;
  const F = m.scale.frame.cents;
  const degrees = m.scale.degrees.map((d) => {
    let cents = d.cents;
    if (how === "tuned12") cents = Math.round(d.cents / 100) * 100;
    else if (how === "justdia") {
      let best = d.cents, bd = Infinity;
      for (const r of JUST_RATIOS) {
        const c = 1200 * Math.log2(r);
        if (Math.abs(c - d.cents) < bd) { bd = Math.abs(c - d.cents); best = c; }
      }
      cents = best;
    }
    return { ...d, cents, ratio: Math.pow(2, cents / 1200) };
  });
  const frame = how === "tuned12"
    ? { ...m.scale.frame, cents: Math.round(F / 100) * 100, ratio: Math.pow(2, Math.round(F / 100) * 100 / 1200) }
    : m.scale.frame;
  return { ...m, scale: { ...m.scale, degrees, frame } };
}

const LT = { trial: null, log: [], on: false, last: null, skipped: 0 };
function ltLoad() {
  try { LT.log = JSON.parse(localStorage.getItem("musiclab.listen") || "[]"); } catch { LT.log = []; }
  if (!Array.isArray(LT.log)) LT.log = [];
}
function ltSave() {
  try { localStorage.setItem("musiclab.listen", JSON.stringify(LT.log)); } catch { /* private window */ }
}
/**
 * Draw the next trial: a people at random, a condition at random.
 *
 * DRAWN FROM THE WHOLE CORPUS, NOT A HAND-PICKED DOZEN. A fixed shortlist is a
 * thumb on the scale — whichever peoples I chose would decide the answer — so
 * the seed is random over a wide range and the sample is of the generator
 * rather than of my taste.
 *
 * AND IT HAS TO BE A SONG. Some peoples come out degenerate: seed 1040 has five
 * bodies of which two are melodic, a three-degree scale, and NO body that
 * clears the bar to carry a line, so its piece is 44 events over 18 seconds
 * with no lead part in it — a bass, an inner voice and a wordless choir. That
 * is not quiet, it is nearly empty, and rating it says nothing about tuning or
 * arrangement because there is no tune and barely an arrangement. It is a real
 * fault and it belongs in the thinness problem, not in this test's data.
 *
 * So a draw is admissible if the piece has a lead part and enough notes to be
 * one — four a second across the whole ensemble, which is the sparsest thing
 * anyone would call a performance. Rejections are counted and shown, because
 * how OFTEN the generator produces something unratable is itself a number worth
 * having.
 */
function ltNext() {
  for (let tries = 0; tries < 24; tries++) {
    const seed = 1000 + Math.floor(Math.random() * 4000);
    let piece;
    try { piece = composePiece(build(seed, "random"), "peace", null, 0.85); } catch { continue; }
    const secs = piece.totalBeats * 60 / piece.tempo;
    const hasLead = piece.events.some(e => e.role === "lead");
    if (!hasLead || piece.events.length < secs * 4) { LT.skipped++; continue; }
    const cond = TRIALS[Math.floor(Math.random() * TRIALS.length)];
    // AND AN OCCASION. Every trial used to be `peace`, so the test could only
    // ever report on the everyday repertoire — which is also the one occasion
    // that had a systematic brightness bias in it. Drawing the occasion too
    // means a rite and a lament get judged as well, and the log says which.
    const occ = OCC_KEYS[Math.floor(Math.random() * OCC_KEYS.length)];
    LT.trial = { seed, cond: cond.key, occ, played: false, secs: Math.round(secs) };
    return LT.trial;
  }
  LT.trial = null;
  return null;
}
function ltPlay() {
  const t = LT.trial;
  if (!t) return;
  const A = audio();
  if (S.playing) stopAmbient();
  // a trial replaces the trial before it — "play again" must not stack
  silence(A);
  const base = build(t.seed, "random");
  setDistance(A, 0.85, base.texture.courtly);
  const m = retune(base, t.cond);
  const t0 = A.ctx.currentTime + 0.15;
  const hymn = hymnSyllables(m, 10);
  const piece = composePiece(m, t.occ || "peace", hymn.syls, 0.85);
  const prevMusic = A.music, prevTonic = A.tonicHz;
  A.music = m;
  A.tonicHz = tonicOf(m, t.occ);
  t.secs = Math.round(piece.totalBeats * 60 / piece.tempo);
  // EVERY CONDITION IS A WHOLE PIECE. The first cut of this test muted layers —
  // the tune on its own, the accompaniment on its own — and a muted arrangement
  // is not something anyone can rate: it sounds incomplete because it IS
  // incomplete, which tells you nothing about whether the music is any good. So
  // each condition changes one layer and leaves a finished piece behind.
  const wasSampled = A.sampled;
  if (t.cond === "modelled") A.sampled = false;
  const played = piece.events.filter((ev) => {
    if (ev.role === "voice") return t.cond !== "novoice";
    // `plain` keeps a complete ensemble — a line, its accompaniment and its
    // percussion — and drops only the doublings and the decoration, which is
    // what a listener means by "too much going on"
    return !(t.cond === "plain" && ev.role === "het");
  });
  // LEVEL-MATCHED, because loudness is the strongest confound in any listening
  // test and two of these conditions take players out. Measured, `plain` peaked
  // at 0.24 against `full`'s 0.59 — a listener would rate it worse for being
  // quiet, whatever they thought of the music, and the test would report that
  // the arrangement is at fault.
  //
  // The correction depends on WHAT was removed, because that decides how the
  // sources were summing in the first place.
  //
  // `novoice` takes out an independent line. Independent sources sum
  // incoherently — N of them are sqrt(N) louder than one — so the cost is the
  // square root of the fraction kept.
  //
  // `plain` takes out the HETEROPHONY, which is not independent: those parts
  // are the same line played at small offsets, so they sum much closer to
  // coherently, and the cost is nearer the fraction itself. Using the square
  // root for both left `plain` 2.4 dB down where `tuned12` was dead level.
  //
  // Either way it is also what a real smaller ensemble does: five players do
  // not each play softer because there are not eight of them.
  const share = piece.events.length / Math.max(1, played.length);
  const gain = Math.min(1.8, t.cond === "plain" ? share : Math.sqrt(share));
  const spb = spbOf(piece);
  for (const ev of played) {
    if (ev.role === "voice") continue;
    const e = t.cond === "plain" && ev.ornDeg != null ? { ...ev, ornDeg: undefined } : ev;
    fireEvent(m, e, t0 + e.b * spb, spb, gain);
  }
  if (t.cond !== "novoice") {
    fireVoiceLine(m, piece.events.filter(e => e.role === "voice"), t0, spb, gain,
      { syls: hymn.syls, acc: hymn.acc, rotate: true });
  }
  A.sampled = wasSampled;
  A.music = prevMusic;
  A.tonicHz = prevTonic;
  t.played = true;
}
const spbOf = (piece) => 60 / piece.tempo;
function ltRate(score) {
  const t = LT.trial;
  if (!t || !t.played) return;
  LT.log.push({ seed: t.seed, cond: t.cond, occ: t.occ || "peace", score, at: Date.now() });
  // the judgement is made, so the sound stops — nothing carries into the next
  // trial, which would contaminate it
  if (A) silence(A);
  ltSave();
  // REVEALED ONLY NOW. Blind while you are judging it, named the moment you
  // have, because a pattern you notice yourself is worth as much as one that
  // falls out of the table.
  LT.last = { ...t, score };
  ltNext();
  render();
}
/** What the ratings say so far, per condition — shown live, because a pattern
 *  you can see after twenty trials is worth more than one you confirm after a
 *  hundred. */
function ltSummary() {
  const by = new Map();
  for (const r of LT.log) {
    const b = by.get(r.cond) || { n: 0, sum: 0, bad: 0 };
    b.n++; b.sum += r.score; if (r.score === 0) b.bad++;
    by.set(r.cond, b);
  }
  return TRIALS.map(c => {
    const b = by.get(c.key) || { n: 0, sum: 0, bad: 0 };
    return { key: c.key, what: c.what, n: b.n, mean: b.n ? b.sum / b.n : null, badPct: b.n ? b.bad / b.n : null };
  });
}
function listenHTML() {
  const t = LT.trial;
  const rows = ltSummary();
  const done = LT.log.length;
  const bar = (v) => {
    if (v == null) return `<span class="ltnone">—</span>`;
    const pc = Math.round(v / 2 * 100);
    return `<span class="ltbar"><i style="width:${pc}%"></i></span><span class="ltnum">${v.toFixed(2)}</span>`;
  };
  return `<div class="card">
    <h2>Listening test <span class="count">— ${done} rated</span></h2>
    <p class="note">Rating pieces in the abstract gives a correlation, and two of those have already
      turned out to be the wrong variable here. This is an <b>ablation</b>: the same people, one layer
      changed at a time — but <b>every condition is a whole piece</b>, twenty to fifty seconds, because
      a muted arrangement sounds incomplete for reasons that have nothing to do with whether the music
      is any good. The decisive pair is <b>full</b> against <b>equal temperament</b>: identical
      composition, identical bodies, only the tuning moved. If tempered rates better, the scale is the
      fault; if they rate the same, the scale is cleared however the curve looks, and
      <b>modelled</b>, <b>plain</b> and <b>novoice</b> divide the rest between the synthesis, the
      arrangement and the singers. <b>You are not told which you are hearing until after you rate
      it</b> — and you can rate as soon as you have decided, which stops the piece.</p>
    ${!LT.on
      ? `<div class="controls"><button id="ltstart">Start the test</button>
         ${done ? `<button id="ltclear" class="ghost">Clear ${done} ratings</button>` : ""}</div>`
      : `<div class="ltnow">
          <div class="controls">
            <button id="ltplay">${t && t.played ? "↻ From the top" : "▶ Play"}</button>
            <span class="note tight">${t && t.played
              ? `Playing${t.secs ? ` — about ${t.secs}s` : ""}. Rate it whenever you have decided; that stops it.`
              : "A whole piece. Listen as long as you need, then rate it."}</span>
          </div>
          <div class="controls ltrate ${t && t.played ? "" : "off"}">
            <button id="ltbad" class="ltb bad">Bad</button>
            <button id="ltok" class="ltb ok">OK</button>
            <button id="ltgood" class="ltb good">Good</button>
            <button id="ltstop" class="ghost">Stop</button>
          </div>
          ${LT.last ? `<p class="note tight ltlast">last one was <b>${esc(LT.last.cond)}</b>,
            ${esc(OCCASIONS[LT.last.occ || "peace"].label)}, on seed ${LT.last.seed} — you called it
            ${["bad", "ok", "good"][LT.last.score]}.</p>` : ""}
        </div>`}
    ${LT.skipped ? `<p class="note tight">${LT.skipped} draw${LT.skipped === 1 ? "" : "s"} skipped as
      unratable — no part carrying a line, or fewer than four notes a second across the whole
      ensemble. That count is a measurement in its own right.</p>` : ""}
    <table class="lt">
      <tr><th>what was changed</th><th>n</th><th>mean (bad 0 · good 2)</th><th>rated bad</th></tr>
      ${rows.map(r => `<tr><td><b>${esc(r.key)}</b><span class="ltwhat">${esc(r.what)}</span></td>
        <td class="ltn">${r.n || ""}</td><td>${bar(r.mean)}</td>
        <td class="ltn">${r.badPct == null ? "" : Math.round(r.badPct * 100) + "%"}</td></tr>`).join("")}
    </table>
    ${(() => {
      const by = new Map();
      for (const r of LT.log) {
        const k = r.occ || "peace";
        const b = by.get(k) || { n: 0, sum: 0 };
        b.n++; b.sum += r.score; by.set(k, b);
      }
      if (by.size < 2) return "";
      return `<table class="lt"><tr><th>occasion</th><th>n</th><th>mean</th></tr>${
        [...by].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map(([k, b]) =>
          `<tr><td><b>${esc((OCCASIONS[k] || {}).label || k)}</b></td><td class="ltn">${b.n}</td>
           <td><span class="ltbar"><i style="width:${Math.round(b.sum / b.n / 2 * 100)}%"></i></span>
           <span class="ltnum">${(b.sum / b.n).toFixed(2)}</span></td></tr>`).join("")}</table>`;
    })()}
    ${done >= 6 ? `<p class="note tight">Paste this back to have it read:</p>
      <textarea class="ltjson" readonly rows="3">${esc(JSON.stringify(LT.log))}</textarea>` : ""}
  </div>`;
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

/** Which recording the Lab would play for this body (recorded path), by the
 *  same material + density + register score `sampledFor` uses. */
function recordingOf(inst) {
  if (inst.sampleName && NAMED_BANK[inst.sampleName]) return NAMED_BANK[inst.sampleName].src;
  const pool = [];
  const fam = SAMPLE_BANK[inst.fam];
  if (fam && !fam.unpitched) pool.push({ src: fam.src, mat: fam.mat || "wood", samples: fam.samples });
  for (const spec of Object.values(NAMED_BANK || {})) {
    if (spec.fam !== inst.fam || !spec.samples?.length) continue;
    if (!pool.some(p => p.src === spec.src)) pool.push({ src: spec.src, mat: spec.mat || "wood", samples: spec.samples });
  }
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0].src;
  const gap = (samples) => {
    const hz = samples.map(s => s.hz).filter(x => x > 0).sort((a, b) => a - b);
    if (hz.length < 2) return 1200;
    const g = [];
    for (let i = 1; i < hz.length; i++) g.push(1200 * Math.log2(hz[i] / hz[i - 1]));
    g.sort((a, b) => a - b);
    return g[Math.floor(g.length / 2)];
  };
  const matD = (a, b) => {
    const X = MATERIALS[a], Y = MATERIALS[b];
    if (!X || !Y) return 9;
    const db = X.bright - Y.bright, dd = Math.log((X.decay + 0.2) / (Y.decay + 0.2)) / 3;
    return Math.sqrt(db * db + dd * dd);
  };
  const rangeMiss = (c) => {
    const famDef = FAMILIES[inst.fam] || {};
    const low = famDef.low || 100;
    const top = low * Math.pow(2, famDef.span != null ? famDef.span : Math.max(0.7, (inst.cap || 7) / 7));
    const hz = c.samples.map(s => s.hz).filter(x => x > 0).sort((a, b) => a - b);
    if (hz.length < 2) return 1;
    const coverLo = Math.max(low, hz[0]), coverHi = Math.min(top, hz[hz.length - 1]);
    const bodySpan = Math.log2(top / low) || 1;
    const cover = coverHi > coverLo ? Math.log2(coverHi / coverLo) / bodySpan : 0;
    return 1 - Math.max(0, Math.min(1, cover));
  };
  let best = pool[0], bestD = Infinity;
  for (const c of pool) {
    const d = matD(inst.mat, c.mat) + gap(c.samples) / 1200 + rangeMiss(c) * 1.4;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best.src;
}

function instrumentsHTML(m) {
  const E = ensembleFor(m, S.occ, S.intimacy);
  const sounding = new Set();
  // One ambient bar is what the player is hearing — roles in the ensemble that
  // do not fire this bar still belong to the tradition, they just are not on.
  const bar = ambientBar(m, { occ: S.occ, intimacy: S.intimacy, bar: 0, seed: m.people.seed });
  for (const ev of bar.events) if (ev.inst >= 0) sounding.add(ev.inst);
  const roster = [];
  for (const v of Object.values(E)) {
    if (typeof v === "number" && v >= 0) roster.push(v);
    else if (Array.isArray(v)) for (const k of v) if (typeof k === "number" && k >= 0) roster.push(k);
  }
  const inEnsemble = new Set(roster);
  return `<div class="card">
    <h2>What they can build <span class="count">— ${m.insts.length} instruments</span></h2>
    <p class="note">A tradition keeps a handful of bodies, not every family the land would allow —
      makers and players are specialists surplus has to feed. Click one to hear it.</p>
    ${m.tuneRef != null && m.insts[m.tuneRef] ? `<p class="note tight">Everyone tunes to the
      <strong>${esc(m.insts[m.tuneRef].label)}</strong> — the most central body that cannot be
      retuned mid-performance.</p>` : ""}
    <ul class="instlist">${m.insts.map((i, k) => {
      const mat = MATERIALS[i.mat]?.label || i.mat;
      const frame = i.frame ? MATERIALS[i.frame]?.label : null;
      const rec = S.sampled ? recordingOf(i) : null;
      const on = sounding.has(k);
      const seat = inEnsemble.has(k);
      return `<li>
        <button class="instrow" data-inst="${k}" title="play">
          <span class="iname">${esc(i.label)}</span>
          <span class="imat">${esc(mat)}${frame ? " on " + esc(frame) : ""}</span>
          ${rec ? `<span class="iheard">heard as ${esc(rec)}</span>` : ""}
          <span class="istatus">${on ? "playing now" : seat ? "in the ensemble" : "in the tradition"}</span>
        </button>
      </li>`;
    }).join("")}</ul>
    <p class="note tight">${sounding.size
      ? `This bar sounds <strong>${[...sounding].map(k => esc(m.insts[k].label)).join(" · ")}</strong>${
          m.insts.length > sounding.size ? " — the rest sit out until a later bar or a denser occasion." : "."}`
      : "Nothing pitched is sounding in this bar."}</p>
  </div>`;
}

/**
 * WHAT NOTE IS THIS, ACTUALLY?
 *
 * Everything in the scale card is stated in cents, which is exact and which
 * nobody hears in. What a listener hears is a pitch — so name it, at the
 * frequency it really sounds at when this people plays.
 *
 * The naming is honest about its own limits. A twelve-tone name plus a cent
 * deviation is a true description of any pitch, but a degree sitting a QUARTER
 * TONE from both of its neighbours has no letter of its own in that system:
 * maqām Rast's third is neither E nor E-flat, and calling it either and
 * shrugging about the fifty cents is how it stops being Rast. Those are marked
 * as sitting between the names rather than dressed up as one of them.
 */
// SPELLING, not just naming. A pitch class has two names and only one of them
// is right in context: E Mixolydian goes E F♯ G♯ A B C♯ D, never E G♭ A♭ A B
// D♭ D — same sounds, and the second one is unreadable because it uses A and D
// twice and never uses F, G or C. So the scale is spelled the way a musician
// would: each degree takes the next letter of the alphabet, and the accidental
// is however far that letter has to move. Ḥijāzkār comes out D E♭ F♯ G A B♭ C♯,
// mixing flats and sharps, which is exactly how the double harmonic is written.
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL = { "-2": "\ud834\udd2b", "-1": "\u266d", 0: "", 1: "\u266f", 2: "\ud834\udd2a" };
const PITCH_NAMES = ["C", "C\u266f", "D", "E\u266d", "E", "F", "F\u266f", "G", "A\u266d", "A", "B\u266d", "B"];
/** Spell a run of pitches as a scale: letters in order, smallest accidentals. */
function spell(midis) {
  const out = [];
  let li = -1;
  const used = new Set();
  for (let k = 0; k < midis.length; k++) {
    const pc = ((Math.round(midis[k]) % 12) + 12) % 12;
    const off = (cand) => {
      let d = pc - LETTER_PC[cand];
      while (d > 6) d -= 12;
      while (d < -6) d += 12;
      return d;
    };
    let best = null;
    if (k === 0) {
      // the tonic takes whichever letter needs the smallest accidental
      for (let c = 0; c < 7; c++) {
        const d = off(c);
        if (best === null || Math.abs(d) < Math.abs(best.d)) best = { c, d };
      }
    } else {
      // …and every degree after it takes the next letter FORWARD that can
      // reach the pitch without an outlandish accidental. Forcing literally
      // the next letter is what a seven-note scale wants and what a
      // PENTATONIC does not: five notes skip letters, and insisting they do
      // not spelled the 宮 pentatonic as D E F♯ G𝄪 A𝄪 instead of D E F♯ A B.
      for (const tol of [1, 2]) {
        for (let step = 1; step <= 7 && !best; step++) {
          const c = (li + step) % 7;
          if (used.has(c)) continue;
          const d = off(c);
          if (Math.abs(d) <= tol) best = { c, d };
        }
        if (best) break;
      }
    }
    if (!best) { out.push(null); continue; }
    li = best.c; used.add(best.c);
    out.push(LETTERS[best.c] + ACCIDENTAL[String(best.d)]);
  }
  return out;
}
function noteName(hz, spelled) {
  if (!(hz > 0)) return null;
  const midi = 69 + 12 * Math.log2(hz / 440);
  const near = Math.round(midi);
  const cents = Math.round((midi - near) * 100);
  const letter = spelled || PITCH_NAMES[((near % 12) + 12) % 12];
  return {
    name: letter + (Math.floor(near / 12) - 1),
    cents, hz,
    // 35 cents is where a deviation stops reading as an out-of-tune version of
    // the named note and starts reading as a pitch of its own — the boundary
    // the quarter-tone accidentals exist for
    between: Math.abs(cents) >= 35,
  };
}
const signed = (c) => (c > 0 ? "+" : c < 0 ? "\u2212" : "\u00b1") + Math.abs(c);

function tuningHTML(m) {
  const d = m.scale.degrees;
  const fin = finalFor(m, S.occ);
  const inMode = new Set(m.mode.idx);
  const homeIdx = m.mode.idx[fin];
  const F = m.scale.frame.cents, L = m.mode.size;
  const fromHome = Array.from({ length: L }, (_, k) =>
    ((m.mode.cents[(fin + k) % L] - m.mode.cents[fin]) % F + F) % F).sort((a, b) => a - b);
  // the pitch this people's home actually sounds at, so every name below is
  // the note you hear rather than a note relative to an imaginary C
  const tonic = tonicOf(m, S.occ);
  const midiOfHz = (h) => 69 + 12 * Math.log2(h / 440);
  const modeSpell = spell(fromHome.map(c => midiOfHz(tonic * Math.pow(2, c / 1200))));
  const sung = fromHome.map((c, i) => noteName(tonic * Math.pow(2, c / 1200), modeSpell[i]));
  const degSpell = spell(d.map((x, i) => midiOfHz(degreeHz(m, tonic, i, 0))));
  const tween = sung.filter(n => n.between).length;
  const arch = m.scale.archetype;
  return `<div class="card">
    <h2>The scale they play <span class="count">— ${arch
      ? `${esc(arch.label)} (${esc(arch.family)})`
      : "derived, not chosen"}</span></h2>
    ${arch ? `<p class="note tight">Tuning family matched from measured catalogs (fit ${(arch.score * 100).toFixed(0)}%). ${esc(arch.provenance)}. The curve below is still the physics; the degrees are the catalog match.</p>` : ""}
    <p class="note">Two tones sound rough when their partials beat against each other. This curve is
      that roughness, computed across every interval from the ensemble's own spectrum, using
      Plomp &amp; Levelt's measured listening data. <strong>The dips are where this people's
      instruments stop fighting</strong> — so those are the intervals they build a scale from. The
      faint grid is equal-tempered semitones, shown only so you can see how far the dips sit from it.</p>
    <canvas id="curve"></canvas>
    <div class="degrees">${d.map((x, i) => {
      const nj = nearJust(x.ratio);
      const nn = noteName(degreeHz(m, tonic, i, 0), degSpell[i]);
      return `<button class="deg${x.found ? "" : " measured"}${inMode.has(i) ? " inmode" : ""}${i === homeIdx ? " home" : ""}" data-deg="${i}"
          title="${x.found ? "heard — a roughness minimum of their own instruments" : "measured — an even division of their frame, where the timbre gave no dip to find"}">
        <span class="dc">${x.cents.toFixed(0)}<i>¢</i></span>
        <span class="dr">${x.ratio.toFixed(3)}</span>
        <span class="dj">${nj ? esc(nj) : x.found ? "heard" : "measured"}</span>
        <span class="dn${nn.between ? " tween" : ""}">${esc(nn.name)}<i>${signed(nn.cents)}</i></span></button>`;
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
    <h3>The notes you are hearing</h3>
    <div class="noterow">${sung.map((n, i) => `<span class="pn${i === 0 ? " phome" : ""}${n.between ? " ptween" : ""}">
      <b>${esc(n.name)}</b><i>${signed(n.cents)}¢</i><small>${n.hz.toFixed(0)} Hz</small></span>`).join("")}</div>
    <p class="note tight">Named against equal temperament at the pitch this people's home actually
      sounds, and the deviation is part of the name, not an error in it.
      ${tween
        ? `<strong>${tween} of these ${tween === 1 ? "sits" : "sit"} between the names</strong> — a
           quarter tone from both neighbours, so no letter describes ${tween === 1 ? "it" : "them"}.
           That is a real feature of the mode, and it is also why a recorded instrument, which was
           sampled at equal-tempered pitches, never lands on ${tween === 1 ? "that note" : "those notes"}
           without being resampled.`
        : "Every one of them sits within a third of a semitone of a named pitch, so a recorded body can play some of this scale at the pitch it was actually recorded at."}</p>
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
        <p class="lede">${F.literate ? "written" : "oral"} · ${esc(F.process || "arch")} — ${F.sections} sections</p>
        <p class="note tight">${F.process === "cyclic"
          ? "Memory keeps a short vocabulary and returns early: the piece is always approaching its beginning."
          : F.process === "progressive"
            ? "Notation buys long departures: the piece can leave its opening idea and come back late, or not as the same statement."
            : "The piece establishes, expands, then returns — climb and landing without a scripted section recipe."}</p>
        <div class="row"><span class="k">repetition</span>${bar01(F.repetition, "repetition")}</div>
        <div class="row"><span class="k">development</span>${bar01(F.development, "development")}</div>
      </div>
    </div>
    <h3>Who leads</h3>
    <p class="note tight">${esc(lead ? lead.label + " of " + MATERIALS[lead.mat].label : "the voice")} — ${
      m.melody.breathBound ? "a breath bounds the phrase" : "a string does not need to breathe, so phrases run longer"}${
      m.melody.toneBound ? "; the tongue has lexical tone, so a sung line cannot fight the word's own melody" : ""}.</p>
    <h3>Who sings</h3>
    <p class="lede">${esc(voiceBody(m).label)}</p>
    <p class="note tight">Solo or choir from how many players surplus can spare; register from the
      tongue's own pitch frame — not a style dial.</p>
    <h3>What they sing on</h3>
    <p class="sung">${esc(vocOf(m).rom)}</p>
    <p class="note tight">Not words — <b>vocables</b>, the nonsense every singing tradition carries its
      tune on. A word is a run of obstructions and each one is a hole in the note, so a people converges
      on the few syllables its own inventory can hold a pitch through: the loudest sonorant it has, on
      the most open vowel it has. There is no vocable list in this codebase — <i>la</i> wins wherever it
      wins because <i>l</i> lets nearly the whole voice out while it is being made.</p>
  </div>`;
}

function pieceHTML(m) {
  const pc = S.piece;
  const order = formOrderOf(m);
  const bank = phraseBank(m, S.occ);
  const labels = order.map(i => (bank[i] && bank[i].label) || "?");
  const sk = phraseSkeleton(m, bank[0]);
  return `<div class="card">
    <h2>A piece <span class="count">— ${esc(OCCASIONS[S.occ].label)}</span></h2>
    <p class="note">The ambient layer walks this same form forever. A piece is the section plan once through —
      one motif, developed as far as their literacy allows, with a line sung over it.
      Bodies → <b>form (plain tones)</b> hears only skeleton, lead, bass and punctuation.</p>
    <p class="note tight">Phrase order (${esc(m.form.process || "arch")}): ${labels.map(esc).join(" → ")}
      · skeleton ${sk.length} trunk tones on the statement</p>
    <div class="controls">
      <button id="playPiece">Play the piece</button>
      <button id="stopPiece" class="ghost">◼ Stop</button>
      ${pc ? `<span class="note tight">${pc.sections.length} sections · ${pc.totalBeats} beats · ${pc.tempo} bpm</span>` : ""}
    </div>
    ${pc ? `<div class="formline">${pc.sections.map(s =>
      `<div class="sec" style="flex:${s.beats}"><span>${esc(s.label)}</span></div>`).join("")}</div>
      <h3>The words</h3>
      <p class="sung">${pc.words.map(w => `<span>${esc(w)}</span>`).join(" ")}</p>
      <p class="note tight">Their own words, from the same lexicon that names their rivers, set to the
        line the voice is singing. You will not hear them: what carries any distance at all is the
        vowel, never the consonants that make speech intelligible, so the sung part is a wordless
        one — a recorded choir rather than the vocal tract langLab speaks with.</p>` : ""}
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
      <label>Bench
        <select id="trad">
          <option value=""${S.trad ? "" : " selected"}>— derived, not pinned —</option>
          ${Object.entries(TRADITIONS).map(([k, v]) =>
            `<option value="${k}"${S.trad === k ? " selected" : ""}>${esc(v.label)}</option>`).join("")}
        </select></label>
    </div>
    <p class="note tight">The pinned endowments are calibration targets: they fix the <em>inputs</em> a
      real tradition had — its metals, its crafts, its society — and let the mechanism derive the music.
      Nothing pins a scale or a rhythm.</p>
    ${S.trad && TRADITIONS[S.trad] ? `<div class="bench">
      <h3>Bench: ${esc(TRADITIONS[S.trad].label)}</h3>
      <p class="note tight">${esc(TRADITIONS[S.trad].gloss)}. This is the other kind of check, and the
      opposite of the one above: the tuning, the ensemble and the metre are <b>written down from
      measurement</b>, and everything after them — the composer, the strata, the synthesis, the voice —
      runs untouched. Nothing here can reach a derived people. What it buys is the ability to tell two
      bugs apart: if a maqām on an oud sounds wrong <em>here</em>, the fault is the sound engine; if it
      sounds right here and a rolled people still sounds wrong, the fault is in the scale that people
      derived.</p>
      <div class="row"><span class="k">tuning</span><span class="v">${TRADITIONS[S.trad].scale.map(c => c.toFixed(0)).join(" · ")} ¢ over ${TRADITIONS[S.trad].frame}¢</span></div>
      <div class="row"><span class="k">ensemble</span><span class="v">${TRADITIONS[S.trad].insts.map(i => esc(i.label)).join(" · ")}</span></div>
      <p class="note tight">${esc(TRADITIONS[S.trad].note)}</p>
    </div>` : ""}
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
    <label class="tl sl" title="How much singing sits over the players. The two synthesis paths are calibrated to agree on what a velocity means; how much voice you want above that is yours.">Voice
      <input type="range" id="voice" min="0" max="1" step="0.01" value="${S.voice}" />
      <span class="slv">${S.voice < 0.02 ? "silent" : S.voice < 0.25 ? "behind" : S.voice < 0.6 ? "in the band" : "out front"}</span></label>
    <label class="tl" title="Recorded: one real instrument per family from CC0 libraries. Modelled: synthesised from this people's materials. Form: plain oscillators on skeleton / lead / bass / punctuation only — so form is audible without sample colour.">Bodies
      <select id="sampled">
        <option value="1"${!S.formListen && S.sampled ? " selected" : ""}>recorded</option>
        <option value="0"${!S.formListen && !S.sampled ? " selected" : ""}>modelled</option>
        <option value="form"${S.formListen ? " selected" : ""}>form (plain tones)</option>
      </select></label>
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
    ${rollHTML(m)}
    ${listenHTML()}
    ${peopleHTML(m)}
    ${chainHTML(m)}
    <footer class="foot">Simman Music Lab${typeof __BUILD__ !== "undefined" ? " · " + __BUILD__ : ""} —
      every scale, metre, ensemble and phrase on this page is derived from the people. The bodies are
      either synthesised from the materials that people had, or played from one real recording per
      instrument family — <span id="bankstate">loading the recorded bank…</span>.
      <br />${esc(SAMPLE_CREDIT)}</footer>`;
  wire();
  redraw();
}
function redraw() {
  const cv = document.getElementById("curve");
  if (cv) drawCurve(cv, P);
  const rc = document.getElementById("rhy");
  if (rc) drawRhythm(rc, P);
  const roll = document.getElementById("pianoroll");
  if (roll) drawPianoRoll(roll, P);
  if (ROLL.live) startRollAnim();
}

function wire() {
  const $ = (id) => document.getElementById(id);
  $("roll").onclick = () => { if (A) silence(A); S.seed = (S.seed + 1) >>> 0; $("seed").value = S.seed; regen(); render(); };
  $("seed").onchange = (e) => { if (A) silence(A); S.seed = (+e.target.value | 0) >>> 0; regen(); render(); };
  $("ref").onchange = (e) => { if (A) silence(A); S.ref = e.target.value; regen(); render(); };
  $("trad").onchange = (e) => { S.trad = e.target.value; if (S.playing) stopAmbient(); regen(); render(); };
  $("voice").oninput = (e) => {
    S.voice = +e.target.value;
    const sp = e.target.parentElement.querySelector(".slv");
    if (sp) sp.textContent = S.voice < 0.02 ? "silent" : S.voice < 0.25 ? "behind" : S.voice < 0.6 ? "in the band" : "out front";
  };
  $("play").onclick = () => { S.playing ? stopAmbient() : startAmbient(); render(); };
  // the listening test
  if ($("ltstart")) $("ltstart").onclick = () => { LT.on = true; ltNext(); render(); };
  if ($("ltclear")) $("ltclear").onclick = () => { LT.log = []; ltSave(); render(); };
  if ($("ltstop")) $("ltstop").onclick = () => { if (A) silence(A); LT.on = false; LT.trial = null; render(); };
  if ($("ltplay")) $("ltplay").onclick = () => { ltPlay(); render(); };
  if ($("ltbad")) $("ltbad").onclick = () => ltRate(0);
  if ($("ltok")) $("ltok").onclick = () => ltRate(1);
  if ($("ltgood")) $("ltgood").onclick = () => ltRate(2);
  $("occ").onchange = (e) => { S.occ = e.target.value; render(); };
  $("intim").oninput = (e) => {
    S.intimacy = +e.target.value;
    if (A) setDistance(A, S.intimacy, P.texture.courtly);
    const sp = e.target.parentElement.querySelector(".slv");
    if (sp) sp.textContent = S.intimacy > 0.66 ? "in the city" : S.intimacy > 0.33 ? "nearby" : "far off";
  };
  $("sampled").onchange = (e) => {
    const v = e.target.value;
    S.formListen = v === "form";
    if (!S.formListen) S.sampled = v === "1";
    if (A) { A.sampled = S.sampled && !S.formListen; A.formPlain = !!S.formListen; }
    ROLL.previewKey = "";
    if (!ROLL.live) { seedRollPreview(P); render(); }
  };
  $("blend").oninput = (e) => {
    S.blend = +e.target.value;
    const sp = e.target.parentElement.querySelector(".slv");
    if (sp) sp.textContent = S.blend < 0.05 ? P.people.name : S.blend > 0.95 ? PB.people.name : Math.round((1 - S.blend) * 100) + "/" + Math.round(S.blend * 100);
    document.querySelector(".nowplaying").innerHTML = `${esc(P.people.name)} <span class="np2">of the ${esc(P.people.biomeLabel)}</span>${
      S.blend > 0.05 ? ` &nbsp;·&nbsp; blending with ${esc(PB.people.name)} <span class="np2">of the ${esc(PB.people.biomeLabel)}</span>` : ""}`;
  };
  $("playPiece").onclick = () => { playPiece(); render(); };
  if ($("stopPiece")) $("stopPiece").onclick = () => {
    if (A) silence(A);
    ROLL.live = false;
    if (ROLL.raf) { cancelAnimationFrame(ROLL.raf); ROLL.raf = 0; }
    const roll = document.getElementById("pianoroll");
    if (roll && P) drawPianoRoll(roll, P);
  };
  document.querySelectorAll("[data-roll]").forEach(b => {
    b.onclick = () => {
      const r = b.dataset.roll;
      if (ROLL.hidden.has(r)) ROLL.hidden.delete(r); else ROLL.hidden.add(r);
      b.classList.toggle("on", !ROLL.hidden.has(r));
      const roll = document.getElementById("pianoroll");
      if (roll && P) drawPianoRoll(roll, P);
    };
  });
  if ($("rollmid")) $("rollmid").onclick = () => { exportRollMidi(P); };
  if ($("rollcopyai")) $("rollcopyai").onclick = () => { copyRollForAi(P); };
  if ($("rollcopycsv")) $("rollcopycsv").onclick = () => { copyRollCsv(P); };
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
#pianoroll{margin:.3rem 0 .55rem;background:var(--chipbg);border-radius:4px;border:1px solid var(--line)}
.rolllegs{display:flex;flex-wrap:wrap;gap:.35rem;margin:.15rem 0 .2rem}
.rollchip{font:inherit;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;
  background:var(--card);color:var(--muted);border:1px solid var(--line);border-radius:999px;
  padding:.18rem .55rem;cursor:pointer;opacity:.45}
.rollchip.on{opacity:1;color:var(--ink);border-color:var(--rc,var(--accent));
  box-shadow:inset 3px 0 0 var(--rc,var(--accent))}
.rollchip:hover{filter:brightness(1.05)}
.rollexport{display:flex;flex-wrap:wrap;gap:.5rem .7rem;align-items:center;margin:.45rem 0 .1rem}
.rollexport .ghost{background:transparent;color:var(--ink);border:1px solid var(--line);padding:.35rem .7rem}
.rollexport .ghost:hover{border-color:var(--accent);color:var(--accent)}
#rollexportmsg[data-on="1"]{color:var(--gloss)}
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
.dn{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;color:var(--ink);
  font-variant-numeric:tabular-nums;letter-spacing:.02em}
.dn i{font-style:normal;opacity:.55;margin-left:.25em}
.dn.tween{color:var(--gloss);font-weight:600}
.noterow{display:flex;flex-wrap:wrap;gap:.35rem;margin:.35rem 0 .5rem}
.pn{display:flex;flex-direction:column;align-items:flex-start;gap:.02rem;
  background:var(--chipbg);border:1px solid var(--line);border-radius:4px;padding:.28rem .5rem;
  font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.pn b{font-size:1rem;font-weight:600;color:var(--ink)}
.pn i{font-style:normal;font-size:.72rem;color:var(--muted)}
.pn small{font-size:.68rem;color:var(--muted);opacity:.75}
.pn.phome{background:var(--accent);border-color:var(--accent)}
.pn.phome b,.pn.phome i,.pn.phome small{color:var(--accent-ink)}
.pn.ptween{border-color:var(--gloss);border-style:dashed}
.pn.ptween b{color:var(--gloss)}
.factrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.8rem;margin:.3rem 0 .2rem}
.factrow b{display:block;font-size:1.25rem;font-variant-numeric:tabular-nums;line-height:1.2}
.instlist{list-style:none;margin:.4rem 0 .2rem;padding:0;display:flex;flex-direction:column;gap:.35rem}
.instrow{width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:5px;
  padding:.45rem .7rem;cursor:pointer;color:var(--ink);font:inherit;display:grid;
  grid-template-columns:minmax(8rem,1.1fr) minmax(6rem,.9fr) minmax(7rem,1fr) auto;gap:.35rem .8rem;align-items:baseline}
.instrow:hover{border-color:var(--accent)}
.iname{font-size:.95rem}
.imat{font-size:.78rem;color:var(--muted)}
.iheard{font-size:.76rem;color:var(--accent)}
.istatus{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);justify-self:end}
@media (max-width:720px){
  .instrow{grid-template-columns:1fr 1fr;grid-template-rows:auto auto}
  .istatus{justify-self:start}
}
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
.bench{margin-top:.9rem;padding:.75rem .85rem;border:1px solid var(--accent);border-radius:6px;background:color-mix(in srgb,var(--accent) 7%,transparent)}
.bench h3{margin:0 0 .35rem}
.bench .v{font-family:ui-monospace,monospace;font-size:.8rem}
.sung{font-size:1.15rem;letter-spacing:.02em;margin:.2rem 0}
/* the listening test */
.lt{width:100%;border-collapse:collapse;margin:.7rem 0 .2rem;font-size:.86rem}
.lt th{text-align:left;font-weight:400;opacity:.6;padding:.25rem .5rem .35rem 0;border-bottom:1px solid var(--line)}
.lt td{padding:.4rem .5rem .4rem 0;border-bottom:1px solid var(--line);vertical-align:top}
.lt td b{font-family:var(--mono);color:var(--accent)}
.ltwhat{display:block;opacity:.55;font-size:.8rem;max-width:34rem;margin-top:.1rem}
.ltn{font-family:var(--mono);opacity:.75;white-space:nowrap}
.ltbar{display:inline-block;width:7rem;height:.55rem;background:var(--chipbg);border-radius:3px;
  overflow:hidden;vertical-align:middle;margin-right:.5rem}
.ltbar i{display:block;height:100%;background:var(--accent)}
.ltnum{font-family:var(--mono);opacity:.8}
.ltnone{opacity:.35}
.ltnow{margin:.6rem 0 .2rem}
.ltrate{margin-top:.45rem;transition:opacity .15s}
.ltrate.off{opacity:.32;pointer-events:none}
.ltb{min-width:5.2rem}
.ltb.bad{border-color:#a4553c}
.ltb.ok{border-color:#8a7a4a}
.ltb.good{border-color:#4f8a72}
.ltlast{margin:.45rem 0 0;opacity:.7}
.ltlast b{font-family:var(--mono);color:var(--accent)}
.ltjson{width:100%;font-family:var(--mono);font-size:.7rem;background:var(--chipbg);
  color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:.4rem;resize:vertical}
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
    makeAudio, setDistance, playNote, sungLine, playSung, ambientBar, composePiece, noteFreq, tonicOf,
    loadSamples, sampleSource, sampledFor, SAMPLE_BANK, slidesTo, FAMILIES, FAMILIES,
    fireEvent, fireVoiceLine, hymnSyllables, vocOf, build, degreeHz, phraseFreqs, retune, TRIALS, LT,
    buildTrad: (k) => buildWithTradition(S.seed, S.ref, k), S,
    audio, silence, stopAmbient, startAmbient, playPiece };
}

export function mount() {
  ltLoad();
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
