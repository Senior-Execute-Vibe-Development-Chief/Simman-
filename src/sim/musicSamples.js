// ── PLAYING A RECORDED BODY ───────────────────────────────────────────────
//
// The engine's own synthesis derives a body from what a people had to build
// with, and models it. This is the other path: one REAL recording per family,
// pitched and shaped by everything the engine derived, so the timbre is a
// microphone's rather than a filter bank's.
//
// WHAT IS AND IS NOT KEPT. The sample supplies the raw sound of the vibrating
// element — the pluck noise, the bow's bite, the breath chiff, the mallet
// click — which is the part physical modelling is worst at and the part an ear
// checks first. Everything else still comes from the derivation: which family
// this people built, what pitches its scale asks for, how long the note is,
// how hard it is struck, whether the body is stopped or left to ring, and how
// much air the thing moves relative to the rest of the room.
//
// AND WHAT IS LOST, stated plainly because it is the real cost of this path:
// material and frame stop being separate sounds. A bronze bar set on a stone
// frame and a wooden one on gourds both begin as the same recorded balafon,
// tilted apart by brightness rather than resynthesised. That is why the
// synthesis path stays switchable — so the cost is audible instead of
// arguable — and it is also why the mapping below is by FAMILY. There is no
// "oud" here on purpose: a people in this world invents bodies that have no
// name and no recording, and a bank of named instruments could never play for
// them.

import { SAMPLE_BANK, NAMED_BANK } from "./musicSampleManifest.js";
import { MATERIALS, FAMILIES, dampTime, radiatedLevel, slideSecs } from "./musicInstruments.js";
import { quantizeToScaleHz } from "./musicArchetypes.js";

/**
 * ONE LEVEL CONVENTION FOR EVERY RECORDING, measured here rather than assumed.
 *
 * The two banks arrive with different histories — the CC0 family samples are
 * peak-normalised when they are encoded, the named ones are taken as raw bytes
 * out of a soundfont and are not — and mixing those two conventions is exactly
 * the bug that put a thumb piano above a gong in the first place. Measured, the
 * Japanese bench dropped 14 dB the moment it started playing named
 * instruments, for no reason but this.
 *
 * So neither bank is trusted: every buffer is measured on arrival and given the
 * gain that brings it to the same peak. What a body's level then IS comes from
 * `radiatedLevel` and the velocity the composer wrote, which is where it
 * belongs — a recording engineer's gain staging is not a fact about the
 * instrument.
 */
function levelOf(buf) {
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0, n = 0;
  // every 7th frame: an estimate does not need every sample, and three hundred
  // buffers are decoded while somebody is waiting
  for (let i = 0; i < d.length; i += 7) {
    const v = d[i], a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v; n++;
  }
  const rms = n ? Math.sqrt(sum / n) : 0;
  if (rms < 1e-5) return 1;
  // ENERGY, NOT PEAK. Normalising to peak is the wrong comparison between a
  // sustained body and a decaying one, and it is what made the recorded path
  // loud and squashed: a plucked note's peak is its attack and its energy sits
  // some twenty decibels under that, while a bagpipe drone sits three decibels
  // under its peak for the whole note. Levelled by peak, every sustained body
  // therefore arrived far louder than every struck one — measured, the Celtic
  // bench lost eight decibels of crest factor against the modelled path (12.8
  // against 20.6) and ran fourteen decibels hotter, which is the limiter
  // working rather than the music being loud.
  //
  // A listener hears energy, so energy is what is matched. The peak guard is
  // only to stop a very transient body — a clave, a clap — from being pushed
  // into the ceiling by an RMS that its own decay makes meaningless.
  return Math.min(0.15 / rms, 0.99 / Math.max(peak, 1e-4));
}

/**
 * Decode the bank into AudioBuffers.
 *
 * `resolve(file)` hands back either a URL or an ArrayBuffer — the Lab passes a
 * data: URI when the bank has been inlined into a single-file build and a
 * plain path when it has not, and neither case is this module's business.
 * Missing or undecodable entries are skipped rather than thrown: a family with
 * no sample simply falls back to synthesis, which is a working instrument.
 */
export async function loadSamples(A, resolve) {
  if (A.samples) return A.samples;
  const bank = {};
  const jobs = [];
  for (const [fam, spec] of Object.entries(SAMPLE_BANK)) {
    const entries = [];
    bank[fam] = { kind: spec.kind, unpitched: !!spec.unpitched, src: spec.src, entries };
    for (const s of spec.samples) {
      jobs.push((async () => {
        try {
          const got = await resolve(s.file);
          const raw = got instanceof ArrayBuffer ? got : await (await fetch(got)).arrayBuffer();
          const buf = await A.ctx.decodeAudioData(raw);
          entries.push({ hz: s.hz, buf, gain: levelOf(buf) });
        } catch { /* a family short one sample is still a family */ }
      })());
    }
  }
  // and the bench's own named instruments, which only a pinned tradition can
  // ever ask for
  const named = {};
  for (const [label, spec] of Object.entries(NAMED_BANK || {})) {
    const entries = [];
    // A NAMED BODY CARRIES ITS OWN KIND AND ITS OWN SOURCE. Both used to be
    // assumed: every named recording was treated as plucked, so a bowed or
    // blown one was played as a note that simply stops instead of looping its
    // steady state, and its source was read off the General MIDI program name
    // — which is null for a recording that came from a folder of WAVs rather
    // than from a soundfont, so two such bodies deduplicated onto each other
    // in the shared pool below.
    named[label] = { kind: spec.kind || "pluck", unpitched: false, src: spec.src, entries };
    for (const s of spec.samples) {
      jobs.push((async () => {
        try {
          const got = await resolve(s.file);
          const raw = got instanceof ArrayBuffer ? got : await (await fetch(got)).arrayBuffer();
          const buf = await A.ctx.decodeAudioData(raw);
          entries.push({ hz: s.hz, buf, gain: levelOf(buf) });
        } catch { /* falls back to the family recording, then to the model */ }
      })());
    }
  }
  await Promise.all(jobs);
  for (const b of Object.values(bank)) b.entries.sort((x, y) => x.hz - y.hz);
  for (const b of Object.values(named)) b.entries.sort((x, y) => x.hz - y.hz);
  // EVERY RECORDING THERE IS, BY FAMILY. The named bodies join this pool as
  // materials rather than as instruments — a derived people can reach the
  // sound of silk on hide without ever reaching the word "shamisen".
  const pool = {};
  for (const [f, b] of Object.entries(bank)) {
    if (b.entries.length) (pool[f] ||= []).push({
      ...b, mat: SAMPLE_BANK[f].mat || "wood",
      voiceKind: f === "voice" ? "choir-male" : undefined,
    });
  }
  for (const [label, b] of Object.entries(named)) {
    const spec = NAMED_BANK[label];
    if (!spec || !spec.fam || !b.entries.length) continue;
    const p = (pool[spec.fam] ||= []);
    // one entry per RECORDING, not per name: several traditions point at the
    // same body and it should sit in the pool once
    const key = spec.voiceKind || spec.src;
    if (!p.some(x => x.src === b.src && (x.voiceKind || x.src) === key)) {
      p.push({ kind: (bank[spec.fam] || {}).kind || "pluck", unpitched: false,
        src: b.src, mat: spec.mat || "wood", voiceKind: spec.voiceKind || undefined,
        entries: b.entries });
    }
  }
  A.pool = pool;
  A.samples = bank;
  A.named = named;
  A.sampleCount = Object.values(bank).reduce((n, b) => n + b.entries.length, 0)
    + Object.values(named).reduce((n, b) => n + b.entries.length, 0);
  return bank;
}

/**
 * How far apart two materials sound, in the only two things a RECORDING can
 * carry about them: how bright it is and how long it rings. Density and
 * stiffness matter, but they act THROUGH those two — a dense stiff bar is
 * bright and long-ringing BECAUSE it is dense and stiff — so scoring them
 * separately would count the same fact twice.
 */
function matDist(a, b) {
  const X = MATERIALS[a], Y = MATERIALS[b];
  if (!X || !Y) return 9;
  const db = X.bright - Y.bright;
  const dd = Math.log((X.decay + 0.2) / (Y.decay + 0.2)) / 3;
  return Math.sqrt(db * db + dd * dd);
}

/**
 * Which recording plays this body — and this is where the two banks stop being
 * separate things.
 *
 * A NAMED BODY IS THE BENCH'S. Only `musicTraditions.js` gives an instrument a
 * name, so a pinned tradition gets the instrument it actually uses and a
 * derived people never can: its bodies have no names to look up.
 *
 * A DERIVED BODY GETS THE NEAREST REAL MATERIAL IN ITS FAMILY, out of every
 * recording there is, from either bank. That is the owner's question answered
 * the only way that is not a script: the engine already goes region -> what
 * grows and can be mined there -> what can be built -> family and material, and
 * this is the last step of that same chain. A people that built a gut-strung
 * lute on a wooden box gets a recording of a gut-strung lute; one that built a
 * silk-strung one gets a shamisen; one that strung it with iron gets the steel
 * strumstick — and none of that asks where anybody is.
 *
 * The difference from "a people in a desert plays an oud" is the whole of the
 * second cardinal rule: that would name the answer, this measures the body.
 * Which is also why the pool is keyed by material and not by instrument — the
 * recording is a MEASUREMENT of what nylon on a wooden box sounds like, and
 * what it happens to be called is not part of it.
 *
 * A named body still keeps its family's KIND — whether it sustains, whether it
 * is plucked — because that is a fact about the thing, not about the recording.
 */
/** The median gap between a recording's pitches, in cents — how far the player
 *  has to drag a note, on average, to find one that was actually recorded. */
function gapOf(c) {
  if (c._gap != null) return c._gap;
  const hz = c.entries.map(e => e.hz).filter(x => x > 0).sort((a, b) => a - b);
  if (hz.length < 2) return (c._gap = 1200);
  const gaps = [];
  for (let i = 1; i < hz.length; i++) gaps.push(1200 * Math.log2(hz[i] / hz[i - 1]));
  gaps.sort((a, b) => a - b);
  return (c._gap = gaps[Math.floor(gaps.length / 2)]);
}

/**
 * How much of this body's compass the recording actually covers — without an
 * octave fold. A glockenspiel and a steel pan can both be iron with the same
 * sample density; only the pan covers a bar set's low end. Scoring material
 * alone left iron bars on the glockenspiel, and 57% of their notes were then
 * folded up an octave — which is what "oddly shifted" sounds like.
 */
function rangeMiss(inst, c) {
  const fam = FAMILIES[inst.fam] || {};
  const low = fam.low || 100;
  const top = low * Math.pow(2, fam.span != null ? fam.span : Math.max(0.7, (inst.cap || 7) / 7));
  const hz = c.entries.map(e => e.hz).filter(x => x > 0).sort((a, b) => a - b);
  if (hz.length < 2) return 1;
  const blo = hz[0], bhi = hz[hz.length - 1];
  const coverLo = Math.max(low, blo), coverHi = Math.min(top, bhi);
  const bodySpan = Math.log2(top / low) || 1;
  const cover = coverHi > coverLo ? Math.log2(coverHi / coverLo) / bodySpan : 0;
  return 1 - Math.max(0, Math.min(1, cover));
}

/** Solo female shares the brighter choir recording — one sample, two roles. */
const VOICE_ALIAS = { "solo-female": "choir-female" };

export function sampledFor(A, inst) {
  const fam = A.samples && A.samples[inst.fam];
  const nm = inst.sampleName && A.named && A.named[inst.sampleName];
  if (nm && nm.entries.length) {
    return { kind: fam ? fam.kind : "pluck", unpitched: false, src: nm.src, entries: nm.entries };
  }
  if (inst.fam === "voice" && inst.voiceKind) {
    const pool = A.pool && A.pool.voice;
    if (pool && pool.length) {
      const want = VOICE_ALIAS[inst.voiceKind] || inst.voiceKind;
      const hit = pool.find(c => c.voiceKind === want);
      if (hit) return hit;
    }
  }
  const pool = A.pool && A.pool[inst.fam];
  if (pool && pool.length > 1) {
    // THE RIGHT MATERIAL, ENOUGH OF IT, AND IN THE RIGHT REGISTER.
    //
    // Material alone decided this, and on a tie the first entry won — which is
    // always the family recording, because that is the one pushed first. So a
    // wooden bar set kept choosing the CC0 balafon, which has six recorded
    // pitches with a 700-cent hole in the middle, over a marimba of the same
    // material sampled every two semitones across five octaves. Measured, that
    // put a gamelan's saron a mean 177 cents from anything ever recorded and a
    // steel pan 161 — which is what a stretched sample sounds like, and what
    // gets described as a mosquito.
    //
    // A recording is only itself near the pitches it was made at, so how DENSE
    // it is decides how often it can be itself. And a recording that only
    // covers the top of the body's compass forces octave folds for everything
    // below — scored here as `rangeMiss`. Material + density + register.
    let best = pool[0], bestD = Infinity;
    for (const c of pool) {
      const d = matDist(inst.mat, c.mat) + gapOf(c) / 1200 + rangeMiss(inst, c) * 1.4;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  return fam && fam.entries.length ? fam : null;
}

/**
 * The nearest recorded pitch, so the shift stays small.
 *
 * Every semitone of shift drags the body's resonances along with the note,
 * which is what makes a stretched sample sound like a cartoon, so the bank is
 * dense enough that nothing moves more than a couple of semitones — and when
 * the music asks for a pitch outside what was recorded, the shift is taken in
 * whole OCTAVES first, because an octave-shifted body is at least a plausible
 * bigger or smaller instrument of the same kind.
 */
/**
 * …AND THE OCTAVES ARE TAKEN FIRST, which the comment above has always said
 * and the code never did: `pick` returned the nearest recording and left the
 * caller to resample by whatever was left over. Where a bank is narrower than
 * the range the engine writes for a body — which is most of them, because the
 * range comes from the family's own physics and the bank from whatever
 * somebody happened to record — that meant dragging one sample across the
 * whole compass. Measured over the bench: a bānsurī resampled by an average of
 * 1569 cents, a bell by 1196, one note by 1904. A sixteenth of stretch is not
 * the instrument transposed, it is a different instrument.
 *
 * A note the recording covers is left exactly where the music put it. Only a
 * note outside what was ever recorded is moved, and it is moved by whole
 * octaves — which is what a player does when the instrument they have does not
 * reach: they play it in the octave they have.
 */
function pick(entries, f) {
  const lo = entries[0].hz, hi = entries[entries.length - 1].hz;
  let hz = f;
  while (hz > hi && hz / 2 >= lo) hz /= 2;
  while (hz < lo && hz * 2 <= hi) hz *= 2;
  let best = entries[0], bestD = Infinity;
  for (const e of entries) {
    const d = Math.abs(Math.log2(hz / e.hz));
    if (d < bestD) { bestD = d; best = e; }
  }
  return { e: best, hz };
}

/**
 * Play one note off a recording. Same signature and same handle as `playNote`,
 * so the caller does not know or care which path it got.
 */
export function playSampled(A, inst, freq, when, dur, vel, opts, dest, stroke, from = 0) {
  const b = sampledFor(A, inst);
  if (!b) return null;
  const isVoice = inst.fam === "voice";
  const mat = MATERIALS[inst.mat] || MATERIALS.wood;
  const ctx = A.ctx;
  const tonic = opts?.tonicHz || A.tonicHz || 220;
  const music = opts?.music || A.music;
  const qFreq = (music && !b.unpitched) ? quantizeToScaleHz(freq, music, tonic) : freq;
  const got = b.unpitched
    ? { e: b.entries[Math.abs(Math.round(qFreq)) % b.entries.length], hz: qFreq }
    : pick(b.entries, qFreq);
  const one = got && got.e;
  if (!one || !one.buf) return null;

  const src = ctx.createBufferSource();
  src.buffer = one.buf;
  // an unpitched body is not transposed to the note — it is struck, and where
  // the stroke lands changes it a little, which is what the stroke does below
  const rate = b.unpitched ? 1 : got.hz / one.hz;
  const target = Math.max(0.06, Math.min(16, rate * (stroke ? stroke.pitch : 1))) * (1 + inst.detune);
  src.playbackRate.value = target;
  // TRAVELLING TO THE NOTE. `from` is where this player's hand already was —
  // see `slidesTo`, which decides whether the contact was ever broken. Sliding
  // a recording means sliding the whole body with it, which is exactly what a
  // real slide does: the resonances move too, because the string is being
  // shortened rather than a different string being sounded.
  const legato = isVoice && from > 0;
  // SAMPLE-RATE SLIDES ARE TAPE SPEED, not a finger on a string. Dragging
  // playbackRate moves every formant with the pitch, which is why a recorded
  // flute "sliding" into the next note sounds oddly shifted rather than bent.
  // The voice path still slides (one throat holding a line); every other body
  // jumps — a real slide on a sampled instrument would need formant-locked
  // pitch shifting this engine does not have.
  if (legato && !b.unpitched) {
    const startRate = Math.max(0.06, Math.min(16, target * (from / freq)));
    const secs = Math.min(slideSecs(from, freq), Math.max(0.02, dur * 0.5));
    src.playbackRate.setValueAtTime(startRate, when);
    src.playbackRate.exponentialRampToValueAtTime(target, when + secs);
  }

  // A DRIVEN BODY HOLDS THE NOTE. The bank ships a couple of seconds and the
  // music asks for ten, so a sustain loops inside its own steady state — after
  // the attack, before the release — and a struck or plucked one plays its own
  // decay out and stops, because that decay IS the instrument.
  const secs = one.buf.duration;
  if (b.kind === "sustain" && dur > secs * 0.55) {
    src.loop = true;
    if (isVoice) {
      // Loop only the open vowel — not the attack — or every note sounds like
      // a fresh choir stab rather than one throat holding a line.
      src.loopStart = Math.min(secs * 0.22, secs - 0.5);
      src.loopEnd = Math.max(src.loopStart + 0.15, secs * 0.88);
    } else {
      src.loopStart = Math.min(secs * 0.45, secs - 0.35);
      src.loopEnd = Math.max(src.loopStart + 0.2, secs * 0.92);
    }
  }

  // MATERIAL, as a tilt rather than a resynthesis. The recording is one
  // material; what the people actually built may be brighter or duller, and a
  // shelf is the honest amount of that difference a sample can carry.
  const tilt = ctx.createBiquadFilter();
  tilt.type = "highshelf";
  tilt.frequency.value = 1800;
  // and WHERE THE HAND LANDS is part of the material's answer, not separate
  // from it: a stroke near the rim excites the high modes a centre stroke
  // misses, which on a recording is the difference between the strokes.
  const edge = stroke ? (stroke.beta ?? 0.5) - 0.5 : 0;
  tilt.gain.value = Math.max(-14, Math.min(12, (mat.bright - 0.58) * 22 + edge * 14));
  // and a duller material also loses the very top
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.max(1400, Math.min(16000, 2200 + 15000 * Math.pow(mat.bright, 2.2)));
  lp.Q.value = 0.7;

  const gate = ctx.createGain();
  // no attack is added: the recording has its own, and that onset is most of
  // why this path exists at all. Three milliseconds only to stop the splice
  // itself clicking — unless this is a legato re-entry on the same vowel, in
  // which case skip the choir's attack entirely.
  const lvl = Math.max(0.0001,
    vel * radiatedLevel(inst) * (one.gain ?? 1) * (stroke ? stroke.vel ?? 1 : 1));
  gate.gain.setValueAtTime(legato ? lvl * 0.9 : 0.0001, when);
  if (legato) gate.gain.setValueAtTime(lvl, when + 0.012);
  else gate.gain.linearRampToValueAtTime(lvl, when + 0.003);

  // A STOPPED BODY STOPS. `dampTime` already knows how fast a hand can take
  // this element's mass away, so a damped note releases at the body's own rate
  // rather than at a fixed one — a hand kills a xylophone key and barely
  // troubles a gong, and that difference is audible here for free.
  const rel = Math.max(0.02, dampTime(inst) * (stroke ? stroke.damp ?? 1 : 1));
  if (opts.damped || src.loop) {
    gate.gain.setTargetAtTime(0.0001, when + dur, rel);
  }

  src.connect(tilt); tilt.connect(lp); lp.connect(gate); gate.connect(dest);
  const offset = isVoice ? (legato ? Math.min(secs * 0.28, secs - 0.08) : 0) : 0;
  src.start(when, offset);
  src.stop(when + Math.min(src.loop ? dur + rel * 6 + 0.3 : secs + 0.1, 16));
  return {
    damp(at, dOpts = {}) {
      const t = Math.max(at, when + 0.02);
      gate.gain.cancelScheduledValues(t);
      gate.gain.setTargetAtTime(0.0001, t, dOpts.soft ?? Math.min(0.12, rel));
      try { src.stop(t + (dOpts.soft ? dOpts.soft * 4 : 0.35)); } catch { /* already stopped */ }
    },
  };
}
