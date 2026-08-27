// ── The radiating body ───────────────────────────────────────────────────
//
//     exciter  →  vibrating element  →  RADIATING BODY  →  room
//
// The body is what makes an instrument sound like an instrument rather than
// like a tone generator, and the reason is one property: ITS RESONANCES DO
// NOT MOVE WITH THE NOTE. A string's spectrum scales with pitch; the box
// radiating it does not. Play a violin two octaves apart and the partials
// move while the air mode near 275 Hz, the plate modes near 460 and 550, and
// the broad radiation hill around 2.3 kHz stay exactly where they are — so
// every note is filtered differently, and the ear reads that as one physical
// object being played rather than one recording transposed.
//
// The first cut of this file got the idea right and the execution wrong, in a
// way that made it almost inaudible. It was a handful of PEAKING biquads in
// series, and a peaking filter only ever adds gain — so the composite response
// was zero decibels nearly everywhere with a few bumps on top. A real violin
// bridge admittance swings across forty to fifty decibels, and Mathews and
// Kohut's listening tests found players prefer a body with about TWELVE dB of
// peak-to-valley variation and resonances spaced IRREGULARLY against the
// harmonic series. Half of a body's character is its troughs, and this file
// had none.
//
// That mattered far more than it sounds, because of what a trough does to
// vibrato. Pitch vibrato sweeps every partial back and forth across a fixed
// response, so a body converts frequency modulation into AMPLITUDE modulation,
// differently for each partial. Gough's resynthesis experiments found that the
// realism of a vibrato tone lives almost entirely in that per-partial AM and
// hardly at all in the frequency modulation itself. Measured on the two
// designs: the old smooth biquad chain turns ±15 cents of vibrato into 0.1 to
// 1.3 dB of AM — at or under the threshold of hearing, which is why adding
// vibrato to this engine used to change nothing. A dense modal body turns the
// SAME vibrato into 1 to 8 dB, uncorrelated between partials.
//
// So the body is now built the way a body actually works: as a sum of modes,
// rendered to an impulse response and convolved.
//
// AND THE TROUGHS ARE NOT BUILT. This is the part worth stating plainly,
// because it is the second cardinal rule in acoustic form. An antiresonance in
// a real structure is not a filter — it is the frequency between two adjacent
// modes where their contributions CANCEL, because consecutive modes radiate in
// antiphase. Give the mode amplitudes alternating signs and every trough
// appears on its own, in the right place, at the right depth, with the right
// phase behaviour. Adding notch filters to carve them would be painting the
// effect; alternating the sign is the cause.
//
// Measured anchors: violin A0 (air) 272-280 Hz, CBR ~407, B1− ~462, B1+ ~551,
// radiation hill ~2.3 kHz roughly 20 dB over background, then about −12 dB per
// octave (Woodhouse, *Euphonics*; Gough, *Violin Acoustics*).
import { MATERIALS, FAMILIES } from "./musicInstruments.js";
import { hash32 } from "./peopleSim/rng.js";

// A body is built to radiate the instrument's own range, so its main air
// resonance sits just above the bottom of that range — a violin's 275 Hz air
// mode against its 196 Hz lowest string, a guitar's ~100 Hz against its 82 Hz
// low E.
const AIR_OVER_LOW = 1.38;

// ── what the body IS ─────────────────────────────────────────────────────
// Not a table per family: a body is a box, a bowl, a tube, or a stretched
// skin, and WHICH of those it is depends on what the maker had to build it
// out of. That is why the same bowed string is a violin over a wooden box and
// something much closer to an erhu or a rebab over a hide-covered bowl — and
// why those two instruments do not sound remotely alike despite identical
// strings. The radiator is the difference, not the string.
const SHELL = {
  // a closed wooden box: an air (Helmholtz) mode, then plate modes
  box:  { modes: [1, 1.48, 1.68, 2.00, 2.55, 3.10], q: [12, 16, 14, 12, 11, 10], a: [1, 0.35, 0.85, 1, 0.5, 0.45],
          hill: [2300, 1.8], top: 9000, dense: 1 },
  // a flat soundboard with no enclosed volume: fewer, broader, weaker lows
  flat: { modes: [1, 1.99, 2.78, 4.23], q: [9, 8, 7, 7], a: [0.9, 0.7, 0.45, 0.55],
          hill: [1700, 1.35], top: 8000, dense: 0.7 },
  // a stretched skin over a small cavity. Waltham's model of the erhu: the
  // radiation is dominated by PAIRS of coupled membrane-cavity resonances that
  // "resemble the formants of the human voice". So build it like a vowel, not
  // like a box — and give it almost no support underneath, which is exactly
  // why a skin fiddle sounds thin and nasal beside a violin.
  skin: { pairs: [[1.9, 0.09], [4.2, 0.07], [7.4, 0.06], [11.2, 0.05]], q: [34, 30, 26, 22],
          a: [1, 0.8, 0.75, 0.5], hill: null, top: 7500, dense: 0.5 },
  // a bowl or gourd: one strong cavity mode, heavily damped, short ring
  bowl: { modes: [1, 2.3, 3.6, 5.1], q: [7, 6, 6, 5], a: [1, 0.6, 0.45, 0.3],
          hill: [2000, 1.2], top: 7000, dense: 0.5 },
  // an open tube: standing waves, no air mode
  tube: { modes: [1, 2.0, 3.0, 4.0], q: [8, 6, 5, 4], a: [0.85, 0.5, 0.35, 0.25],
          hill: [1500, 1.15], top: 8500, dense: 0.5 },
  // nothing between the element and the air: it IS the radiator
  none: { modes: [], q: [], a: [], hill: null, top: 11000, dense: 0 },
};

/** Which shell this instrument has — read off what it is MADE of. */
export function shellOf(inst) {
  const fam = FAMILIES[inst.fam] || {};
  if (fam.vib === "plate") return "none";               // a gong or bell radiates for itself
  // A wind instrument has no fixed body at all, and this is the one place
  // where the rule this file exists to enforce runs the other way. A flute
  // changes pitch by changing the length of its own resonator, so its
  // resonances MOVE with the note — measured spectral envelopes for flutes and
  // clarinets vary with pitch, unlike oboes, bassoons and horns. Giving a
  // flute a body fixed in absolute hertz makes its timbre lurch from note to
  // note in a way no flute does: the same bug as before with its sign
  // reversed. What a reed or a lip instrument DOES have fixed — the reed's
  // closing time, the mouthpiece cup, the bell's flare — is a property of the
  // driver, and lives in musicDriven.js with the rest of the driver.
  if (fam.vib === "air") return "none";
  const f = inst.frame;
  if (fam.vib === "membrane") return f === "clay" || f === "gourd" ? "bowl" : "skin";
  if (f === "hide") return "skin";                      // a skin-bellied fiddle or lute
  if (f === "gourd" || f === "clay") return "bowl";
  if (fam.vib === "bar") return inst.reso ? "tube" : "flat";
  return fam.kind === "pluck" && fam.cap <= 8 ? "flat" : "box";
}

/**
 * The body's modes, in absolute Hz — the same for every note it ever plays,
 * which is the whole point. `s` is the radiation SIGN, strictly alternating:
 * that alternation is what puts an antiresonance between every adjacent pair.
 */
export function bodyModes(inst) {
  const kind = shellOf(inst);
  const P = SHELL[kind];
  const fam = FAMILIES[inst.fam] || {};
  const low = fam.low || 200;
  const air = low * AIR_OVER_LOW;
  // the BODY's material, never the vibrating element's — falling through to
  // the element gave a bronze bar's wooden resonator bronze's brightness and
  // its ring
  const m = MATERIALS[inst.frame] || MATERIALS.wood;
  const rnd = (i) => hash32(0, "body", inst.id + ":" + i) / 4294967296;
  const out = [];
  let s = 1;
  const push = (f, q, a) => { if (f > 20 && f < P.top) out.push({ f, q, a, s }); s = -s; };

  if (P.pairs) {
    // membrane formants: each is a CLOSE PAIR — one breathing mode that
    // radiates strongly and one that barely does — and the beating between
    // them is most of a skin instrument's nasal buzz
    P.pairs.forEach(([r, split], i) => {
      // measured-typical: the lowest membrane mode of an erhu box sits near
      // 2 kHz, far above anything a violin does, so the low end is simply
      // missing rather than merely quieter
      push(air * r, P.q[i], P.a[i]);
      push(air * r * (1 + split), P.q[i] * 0.8, P.a[i] * 0.55);
    });
  } else {
    P.modes.forEach((r, i) => {
      // Mathews and Kohut: a body is preferred when its resonances sit
      // IRREGULARLY against the harmonic series. A clean 2.00 would land on a
      // harmonic for every note; nudge it off, per instrument.
      push(air * r * (1 + (rnd(i) - 0.5) * 0.08), P.q[i], P.a[i]);
    });
  }

  // Above the signature modes the modal density climbs until individual modes
  // stop having identities and the response becomes a thicket. That thicket is
  // where vibrato lives: it is dense enough that a partial moving fifteen
  // cents crosses real structure.
  if (P.dense > 0) {
    const start = (P.pairs ? air * P.pairs[P.pairs.length - 1][0] : air * P.modes[P.modes.length - 1]) * 1.16;
    let f = start, i = 0;
    while (f < P.top && i < 70) {
      const q = 22 + 22 * rnd(100 + i);
      // flat to 3 kHz, then the −12 dB/octave radiation rolloff every wooden
      // box has; the hill is a broad lift over the region where the bridge
      // couples best
      let a = 0.55 * P.dense * (f <= 3000 ? 1 : Math.pow(3000 / f, 2));
      if (P.hill) { const [hf, hg] = P.hill; a *= 1 + (hg - 1) * Math.exp(-Math.pow(Math.log2(f / hf) / 0.55, 2)); }
      a *= 0.65 + 0.5 * m.bright;
      push(f, q, a);
      f *= 1 + 0.028 + 0.030 * rnd(200 + i);
      i++;
    }
  }
  return { modes: out, kind, air };
}

/**
 * Render the body to a stereo impulse response.
 *
 * The two channels differ above about a kilohertz, and that is not a stereo
 * effect: above that frequency a violin's modes radiate as multipoles, so the
 * sound genuinely varies with direction — Weinreich's "directional tone
 * colour". A real instrument's width comes from ITS OWN radiation being
 * different in different directions, which is why the two detuned oscillators
 * that used to supply width here were the wrong answer twice over: a string
 * has one period, and its width is not a pitch difference.
 */
export function bodyIR(ctx, inst) {
  const { modes, kind } = bodyModes(inst);
  if (!modes.length) return null;
  const SR = ctx.sampleRate;
  const n = Math.min(Math.floor(SR * 0.16), 8192);
  const buf = ctx.createBuffer(2, n, SR);
  const rnd = (i) => hash32(0, "ir", inst.id + ":" + i) / 4294967296;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    modes.forEach((md, k) => {
      // above a kilohertz the two directions disagree by a few dB and a little
      // phase; below it they do not
      const dir = md.f > 1000 ? 1 + (rnd(k * 2 + c) - 0.5) * 0.9 : 1;
      const ph = md.f > 1000 ? rnd(k * 2 + c + 500) * 2 * Math.PI : 0;
      const w = 2 * Math.PI * md.f / SR;
      const dec = Math.PI * md.f / (md.q * SR);
      const A = md.s * md.a * dir;
      for (let i = 0; i < n; i++) {
        const e = Math.exp(-dec * i);
        if (e < 1e-4) break;
        d[i] += A * e * Math.sin(w * i + ph);
      }
    });
    // Unity CONVOLUTION gain, so a body changes the colour and not the level.
    // Normalising the impulse response to unit RMS instead — the obvious thing,
    // and what this did at first — multiplies broadband power by the response's
    // LENGTH: eight thousand samples of it, about twenty decibels, on every
    // instrument at once. That put the whole mix hard against the limiter, so
    // a third of all samples came back flat-topped. What makes convolution
    // unity is the sum of the squares, not the mean of them.
    let e = 0; for (let i = 0; i < n; i++) e += d[i] * d[i];
    e = Math.sqrt(e) || 1;
    for (let i = 0; i < n; i++) d[i] /= e;
  }
  return { buf, kind };
}

/** The body as a node: one convolution, shared by every note it ever plays. */
export function buildBody(ctx, inst) {
  const input = ctx.createGain();
  const ir = bodyIR(ctx, inst);
  const top = ctx.createBiquadFilter();
  top.type = "lowpass";
  top.frequency.value = SHELL[shellOf(inst)].top;
  top.Q.value = 0.6;
  if (!ir) { input.connect(top); return { input, output: top, kind: shellOf(inst) }; }
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = ir.buf;
  // A little of the element reaches the ear without going through the body —
  // the string itself is audible, not only the box.
  const dry = ctx.createGain(); dry.gain.value = 0.22;
  input.connect(conv); conv.connect(top);
  input.connect(dry); dry.connect(top);
  return { input, output: top, kind: ir.kind };
}
