// ── The radiating body ───────────────────────────────────────────────────
//
// The stage this engine was missing entirely. A real instrument is a chain:
//
//     exciter  →  vibrating element  →  RADIATING BODY  →  room
//
// musicInstruments.js models the vibrating element well and the exciter
// crudely; the renderer then jumped straight to the room. Nothing between.
//
// The body is what makes an instrument sound like an instrument rather than
// like a tone generator, and the reason is one property: ITS RESONANCES DO
// NOT MOVE WITH THE NOTE. A string's spectrum scales with pitch; the box
// radiating it does not. Play a violin two octaves apart and the partials
// move while the air mode at ~275 Hz, the plate modes near 460 and 550, and
// the broad "bridge hill" around 2.3 kHz stay exactly where they are — so
// each note is filtered differently, and the ear reads that as one physical
// object being played rather than one recording transposed. A synth whose
// every filter tracks f0 is precisely the opposite, and it is the single
// most reliable tell that something is synthetic.
//
// Measured examples the numbers below are anchored to: violin A0 (Helmholtz
// air mode) 272-280 Hz, CBR ~407, B1− ~462, B1+ ~551, bridge hill ~2.3 kHz
// (Woodhouse, *Euphonics*); classical guitar 98/182/348 Hz or 103/205/286/436
// depending on the box, with a weaker hill near 1.7 kHz.
//
// Cardinal rule 2 applies here as everywhere: these are not per-family preset
// tables. A body is a box or a tube of a certain size, and its resonances are
// what that geometry gives. So the frequencies are DERIVED from the size the
// maker had to build to radiate this instrument's range, and the material
// decides how sharp and how strong they are.
import { MATERIALS } from "./musicInstruments.js";

// A body is built to radiate the instrument's own range, so its main air
// resonance sits just above the bottom of that range — a violin's 275 Hz air
// mode against its 196 Hz lowest string, a guitar's ~100 Hz Helmholtz against
// its 82 Hz low E. One ratio, applied to whatever register the family sits in.
const AIR_OVER_LOW = 1.38;

// Where each family's lowest note sits, in Hz. This is a fact about how big
// the thing has to be, not a musical choice: a lyre-class body is small and
// high, a bowed box larger and lower, a bar set lower still.
const LOW_HZ = {
  lyre: 175, luteNeck: 110, bowed: 196, fluteOpen: 262, pipeStopped: 220,
  reedPipe: 175, horn: 116, barSet: 130, gong: 65, bell: 98, lamella: 147,
  drum: 80, frameDrum: 110,
};

// How a body is built decides the SHAPE of its resonance set. A closed box
// has an air (Helmholtz) mode plus plate modes at these measured-typical
// ratios above it; an open tube has no air mode but standing waves; a solid
// bar over a tube resonator has just the tube. `hill` is the broad radiation
// peak every wooden box has — the violin's bridge hill and the guitar's
// weaker equivalent — which is fixed in absolute frequency and is most of
// what distinguishes one family's voice from another's.
const PLAN = {
  box:   { modes: [1, 1.48, 1.68, 2.0, 3.6], gains: [8, 4, 7, 9, 3], hill: [2300, 1.2, 10] },
  flat:  { modes: [1, 1.99, 2.78, 4.23],     gains: [9, 7, 4, 6],    hill: [1700, 1.5, 4] },
  tube:  { modes: [1, 2.0, 3.0],             gains: [7, 3, 2],       hill: [1500, 2.0, 3] },
  shell: { modes: [1, 2.4, 4.1],             gains: [6, 4, 3],       hill: [3000, 1.6, 2] },
  none:  { modes: [], gains: [], hill: null },
};
const BODY_KIND = {
  bowed: "box", luteNeck: "box", lyre: "flat", lamella: "flat",
  fluteOpen: "tube", pipeStopped: "tube", reedPipe: "tube", horn: "tube",
  barSet: "tube", drum: "shell", frameDrum: "shell",
  gong: "none", bell: "none",         // these ARE their own radiator
};

/**
 * The fixed resonances of this instrument's body, in absolute Hz. Same for
 * every note it ever plays — which is the whole point.
 */
export function bodyPlan(inst) {
  const kind = BODY_KIND[inst.fam] || "none";
  const P = PLAN[kind];
  if (!P.modes.length) return { peaks: [], kind };
  const low = LOW_HZ[inst.fam] || 200;
  const air = low * AIR_OVER_LOW;
  // The material the box is made of sets how sharp its resonances are. A
  // stiff, low-loss material rings its modes narrowly; a soft or damped one
  // smears them. Q follows the same decay figure the modal model already uses.
  const m = MATERIALS[inst.frame || inst.mat] || MATERIALS.wood;
  const Q = 6 + Math.min(18, m.decay * 2.2);
  const peaks = P.modes.map((r, i) => ({
    f: air * r,
    q: Q * (i === 0 ? 1 : 0.85),
    // a denser body couples less energy out per mode but rings longer
    db: P.gains[i] * (0.7 + 0.5 * (1 - m.dens)),
  }));
  if (P.hill) peaks.push({ f: P.hill[0], q: P.hill[1], db: P.hill[2] * (0.6 + 0.5 * m.bright) });
  return { peaks, kind, air };
}

/**
 * Build the body as a SERIES of peaking biquads. Series, not parallel: a
 * peaking filter is unity away from its own peak, so they compose without
 * any dry/wet balancing and without the phase cancellation a parallel bank
 * would introduce. Built once per instrument and shared by every voice.
 */
export function buildBody(ctx, inst) {
  const { peaks, kind } = bodyPlan(inst);
  const input = ctx.createGain();
  if (!peaks.length) return { input, output: input, kind };
  let node = input;
  for (const p of peaks) {
    const bq = ctx.createBiquadFilter();
    bq.type = "peaking";
    bq.frequency.value = Math.min(p.f, ctx.sampleRate * 0.45);
    bq.Q.value = p.q;
    bq.gain.value = p.db;
    node.connect(bq);
    node = bq;
  }
  // the body also rolls off the extreme top — no wooden box radiates 15 kHz
  const top = ctx.createBiquadFilter();
  top.type = "lowpass"; top.frequency.value = 11000; top.Q.value = 0.5;
  node.connect(top);
  return { input, output: top, kind };
}
