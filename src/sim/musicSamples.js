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

import { SAMPLE_BANK } from "./musicSampleManifest.js";
import { MATERIALS, dampTime, radiatedLevel } from "./musicInstruments.js";

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
          entries.push({ hz: s.hz, buf });
        } catch { /* a family short one sample is still a family */ }
      })());
    }
  }
  await Promise.all(jobs);
  for (const b of Object.values(bank)) b.entries.sort((x, y) => x.hz - y.hz);
  A.samples = bank;
  A.sampleCount = Object.values(bank).reduce((n, b) => n + b.entries.length, 0);
  return bank;
}

/** Is there a recording for this body? */
export function sampledFor(A, inst) {
  const b = A.samples && A.samples[inst.fam];
  return b && b.entries.length ? b : null;
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
function pick(entries, f) {
  let best = entries[0], bestD = Infinity;
  for (const e of entries) {
    const d = Math.abs(Math.log2(f / e.hz));
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

/**
 * Play one note off a recording. Same signature and same handle as `playNote`,
 * so the caller does not know or care which path it got.
 */
export function playSampled(A, inst, freq, when, dur, vel, opts, dest, stroke) {
  const b = sampledFor(A, inst);
  if (!b) return null;
  const mat = MATERIALS[inst.mat] || MATERIALS.wood;
  const ctx = A.ctx;
  const one = b.unpitched
    ? b.entries[Math.abs(Math.round(freq)) % b.entries.length]
    : pick(b.entries, freq);
  if (!one || !one.buf) return null;

  const src = ctx.createBufferSource();
  src.buffer = one.buf;
  // an unpitched body is not transposed to the note — it is struck, and where
  // the stroke lands changes it a little, which is what the stroke does below
  const rate = b.unpitched ? 1 : freq / one.hz;
  src.playbackRate.value = Math.max(0.06, Math.min(16, rate * (stroke ? stroke.pitch : 1)))
    * (1 + inst.detune);

  // A DRIVEN BODY HOLDS THE NOTE. The bank ships a couple of seconds and the
  // music asks for ten, so a sustain loops inside its own steady state — after
  // the attack, before the release — and a struck or plucked one plays its own
  // decay out and stops, because that decay IS the instrument.
  const secs = one.buf.duration;
  if (b.kind === "sustain" && dur > secs * 0.55) {
    src.loop = true;
    src.loopStart = Math.min(secs * 0.45, secs - 0.35);
    src.loopEnd = Math.max(src.loopStart + 0.2, secs * 0.92);
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
  // itself clicking.
  const lvl = Math.max(0.0001, vel * radiatedLevel(inst) * (stroke ? stroke.vel ?? 1 : 1));
  gate.gain.setValueAtTime(0.0001, when);
  gate.gain.linearRampToValueAtTime(lvl, when + 0.003);

  // A STOPPED BODY STOPS. `dampTime` already knows how fast a hand can take
  // this element's mass away, so a damped note releases at the body's own rate
  // rather than at a fixed one — a hand kills a xylophone key and barely
  // troubles a gong, and that difference is audible here for free.
  const rel = Math.max(0.02, dampTime(inst) * (stroke ? stroke.damp ?? 1 : 1));
  if (opts.damped || src.loop) {
    gate.gain.setTargetAtTime(0.0001, when + dur, rel);
  }

  src.connect(tilt); tilt.connect(lp); lp.connect(gate); gate.connect(dest);
  src.start(when);
  src.stop(when + Math.min(src.loop ? dur + rel * 6 + 0.3 : secs + 0.1, 16));
  return {
    damp(at) {
      const t = Math.max(at, when + 0.02);
      gate.gain.cancelScheduledValues(t);
      gate.gain.setTargetAtTime(0.0001, t, Math.min(0.12, rel));
      try { src.stop(t + 0.35); } catch { /* already stopped */ }
    },
  };
}
