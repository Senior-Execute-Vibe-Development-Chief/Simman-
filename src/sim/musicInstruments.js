// ── Instruments: bodies, and the SPECTRA they actually radiate ────────────
//
// The first link in the music chain (docs/music.md). A people's instruments
// are not chosen from a list of named instruments — they are BUILT, out of
// whatever their land and crafts give them, and each body's physics decides
// what partials it radiates. That spectrum is the whole point: it is what
// musicTuning.js then feeds to the roughness model to DERIVE the scale, so
// the tuning a culture ends up with is a consequence of what it could make.
//
// Cardinal rule 2 in practice: nothing here says "this people plays a
// gamelan" or "this one plays a lute". It says bronze exists here, casting
// knowledge is high, so tuned bronze slabs are makeable — and a struck
// bronze bar's modal series (1 : 2.756 : 5.404 …) is inharmonic, which is a
// fact about bars, not about any culture. The musical consequences follow.
//
// The mode ratios below are the standard physics, not tuned values:
//   · ideal string / open pipe   f_n = n·f1                (full harmonic series)
//   · stopped pipe               f_n = (2n−1)·f1           (odd harmonics only)
//   · free–free bar              1 : 2.756 : 5.404 : 8.933  (xylophone, metallophone)
//   · clamped–free bar (lamella) 1 : 6.267 : 17.55          (thumb-piano tongue)
//   · circular membrane          1 : 1.593 : 2.135 : 2.295  (Bessel zeros, drumhead)
//   · flat circular plate/gong   1 : 2.08 : 3.41 : 3.89 : 5.00
//   · bell profile               0.5 : 1 : 1.2 : 1.5 : 2    (hum, prime, tierce, quint, nominal)
// Stiff strings are inharmonic by the standard stiffness law
// f_n = n·f1·√(1+B·n²); B is a property of the wire, so a thick bronze
// string is measurably more inharmonic than a thin gut one.
import { hash32 } from "./peopleSim/rng.js";

// ── materials ────────────────────────────────────────────────────────────
// Each is a real acoustic character: how long it rings (decay, in seconds
// at the fundamental), how much of the high modes survive (bright), and how
// stiff a string of it would be (B, the inharmonicity coefficient). These
// are physical properties of the substance — they do not know what music is.
export const MATERIALS = {
  bronze: { label: "bronze",  decay: 9.0, bright: 1.00, B: 4.0e-4, dens: 1.00, needs: ["copper", "tin"] },
  iron:   { label: "iron",    decay: 6.0, bright: 0.92, B: 3.0e-4, dens: 0.95, needs: ["iron"] },
  silver: { label: "silver",  decay: 7.0, bright: 0.96, B: 3.4e-4, dens: 0.98, needs: ["precious"] },
  stone:  { label: "stone",   decay: 3.4, bright: 0.80, B: 0,      dens: 1.05, needs: ["stone"] },
  wood:   { label: "wood",    decay: 1.1, bright: 0.52, B: 0,      dens: 0.55, needs: ["timber"] },
  bamboo: { label: "bamboo",  decay: 0.9, bright: 0.62, B: 0,      dens: 0.45, needs: ["bamboo"] },
  reed:   { label: "reed",    decay: 0.5, bright: 0.58, B: 0,      dens: 0.30, needs: ["reed"] },
  clay:   { label: "clay",    decay: 0.6, bright: 0.34, B: 0,      dens: 0.80, needs: ["clay"] },
  gourd:  { label: "gourd",   decay: 0.5, bright: 0.40, B: 0,      dens: 0.35, needs: ["gourd"] },
  hide:   { label: "hide",    decay: 0.7, bright: 0.44, B: 0,      dens: 0.40, needs: ["hide"] },
  gut:    { label: "gut",     decay: 2.4, bright: 0.66, B: 2.0e-5, dens: 0.50, needs: ["hide"] },
  silk:   { label: "silk",    decay: 2.8, bright: 0.60, B: 1.0e-5, dens: 0.45, needs: ["silk"] },
  horn:   { label: "horn",    decay: 0.8, bright: 0.70, B: 0,      dens: 0.60, needs: ["horn"] },
};

// ── body families: the physical model → its mode ratios ──────────────────
// `ratios(n, mat)` returns the first n mode frequencies as multiples of the
// fundamental. `cap` is how many distinct pitches one such instrument can
// physically sound — the constraint that decides how big a scale a people
// can even play (a six-hole pipe cannot play twelve notes).
export const FAMILIES = {
  // ── strings ──
  lyre: {                       // open strings, one per pitch, plucked
    label: "lyre-class", kind: "pluck", drive: "pluck", cap: 7, poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood"], needs: { construction: 0.15 },
  },
  luteNeck: {                   // stopped strings — the neck is the pitch machine
    label: "stopped-string", kind: "pluck", drive: "pluck", cap: 14, poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood"], needs: { construction: 0.42 },
  },
  bowed: {                      // sustained string — a bow keeps the mode driven
    label: "bowed-string", kind: "sustain", drive: "bow", cap: 14, poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood"], needs: { construction: 0.5, mobility: 0.3 },
  },
  // ── winds ──
  fluteOpen: {                  // open tube, edge-blown: full harmonic series
    label: "open flute", kind: "sustain", drive: "breath", cap: 6, poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["bamboo", "reed", "wood", "clay"], needs: {},
  },
  pipeStopped: {                // stopped tube: ODD harmonics only — a hollow, clarinet-ish spectrum
    label: "stopped pipe", kind: "sustain", drive: "breath", cap: 5, poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => 2 * i + 1),
    body: ["bamboo", "reed", "clay", "gourd"], needs: {},
  },
  reedPipe: {                   // conical reed: full series, loud and buzzing
    label: "reed pipe", kind: "sustain", drive: "reed", cap: 8, poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["reed", "bamboo", "wood"], needs: { construction: 0.3 },
  },
  horn: {                       // lip-driven natural horn — plays the harmonic series ITSELF
    label: "natural horn", kind: "sustain", drive: "lip", cap: 6, poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["horn", "bronze", "iron", "clay"], needs: {},
  },
  // ── struck: where the spectra stop being harmonic ──
  barSet: {                     // tuned bars over resonators: free–free bar modes
    label: "tuned bars", kind: "struck", drive: "strike", cap: 7, poly: 2,
    ratios: (n) => BAR_FREE.slice(0, n),
    body: ["wood", "bamboo", "stone", "bronze", "iron"], needs: { construction: 0.25 },
  },
  gong: {                       // flat cast plate — dense inharmonic plate modes
    label: "gong", kind: "struck", drive: "strike", cap: 3, poly: 1,
    ratios: (n) => PLATE.slice(0, n),
    body: ["bronze", "iron"], needs: { metallurgy: 0.45 },
  },
  bell: {                       // cast profile — the partials a founder can actually tune
    label: "bell", kind: "struck", drive: "strike", cap: 5, poly: 1,
    ratios: (n) => BELL.slice(0, n),
    body: ["bronze", "iron", "clay"], needs: { metallurgy: 0.55 },
  },
  lamella: {                    // plucked clamped tongue: violently inharmonic upper modes
    label: "plucked tongues", kind: "pluck", drive: "pluck", cap: 8, poly: 2,
    ratios: (n) => LAMELLA.slice(0, n),
    body: ["iron", "bronze", "bamboo"], frame: ["wood", "gourd"], needs: { metallurgy: 0.3 },
  },
  // ── membranes: pitch-vague, the time-keepers ──
  drum: {
    label: "drum", kind: "struck", drive: "strike", cap: 2, poly: 1,
    ratios: (n) => MEMBRANE.slice(0, n),
    body: ["hide"], frame: ["wood", "clay", "gourd"], needs: {},
  },
  frameDrum: {
    label: "frame drum", kind: "struck", drive: "strike", cap: 1, poly: 1,
    ratios: (n) => MEMBRANE.slice(0, n),
    body: ["hide"], frame: ["wood"], needs: {},
  },
};

// standard mode series (physics, not parameters)
const BAR_FREE  = [1, 2.756, 5.404, 8.933, 13.34, 18.64];          // free–free bar
const LAMELLA   = [1, 6.267, 17.55, 34.39];                        // clamped–free bar
const MEMBRANE  = [1, 1.593, 2.135, 2.295, 2.653, 2.917, 3.155];   // circular membrane
const PLATE     = [1, 2.08, 3.41, 3.89, 5.00, 6.71];               // flat circular plate
const BELL      = [0.5, 1, 1.2, 1.5, 2, 2.5, 3.0];                 // hum · prime · tierce · quint · nominal

// modes with useful radiated energy, by body geometry
const MODE_COUNT = {
  lyre: 14, luteNeck: 14, bowed: 16, fluteOpen: 10, pipeStopped: 8, reedPipe: 12, horn: 12,
  barSet: 5, gong: 6, bell: 7, lamella: 4, drum: 6, frameDrum: 5,
};

/** Stiff-string series: f_n = n·√(1 + B n²). B=0 gives the ideal harmonic series. */
function harmonicStiff(n, B = 0) {
  return Array.from({ length: n }, (_, i) => (i + 1) * Math.sqrt(1 + B * (i + 1) * (i + 1)));
}

// ── amplitude of each mode ───────────────────────────────────────────────
// The spectral envelope of a struck, plucked or blown body falls off roughly
// GEOMETRICALLY in partial index — a_n = g^(n−1) — which is the standard
// idealization and the one the roughness literature uses. `g` is set by how
// the body is driven (a bow keeps the upper modes fed; a mallet does not)
// and by the material's own brightness. This is one law for every body: no
// instrument gets its spectrum hand-shaped.
function modeAmps(ratios, drive, bright) {
  const g0 = drive === "strike" ? 0.72 : drive === "pluck" ? 0.86 : drive === "reed" ? 0.90 : drive === "lip" ? 0.88 : 0.84;
  const g = Math.min(0.94, g0 * (0.72 + 0.42 * bright));
  return ratios.map((_, i) => Math.pow(g, i));
}
// higher modes always die faster — the standard radiation/viscous law
function modeDecays(ratios, base) {
  return ratios.map(r => base / Math.pow(r, 0.75));
}

/**
 * Build one instrument. Everything the synth and the tuning model need comes
 * out of the family's physics and the material's acoustics — nothing here
 * takes a musical decision.
 */
export function makeInstrument(famId, matId, frameId, seed, register = 0) {
  const fam = FAMILIES[famId], mat = MATERIALS[matId];
  // how many modes this body actually radiates with useful energy: a string
  // or air column supports a long series; a bar, plate or bell has only a few
  // strong modes — a fact about the geometry, and the reason their consonance
  // landscape is so much sparser.
  const nModes = MODE_COUNT[famId] ?? (fam.kind === "sustain" ? 12 : 10);
  const ratios = fam.ratios(nModes, mat);
  const amps = modeAmps(ratios, fam.drive, mat.bright);
  // a struck body rings for its material's time; a driven one is held, so its
  // "decay" is a release, not a ring-down
  const ringBase = fam.kind === "sustain" ? 0.18 : mat.decay * (fam.kind === "pluck" ? 0.55 : 1);
  const h = hash32(seed >>> 0, famId, matId) / 4294967296;
  return {
    id: `${famId}:${matId}`, fam: famId, mat: matId, frame: frameId || null,
    label: fam.label, kind: fam.kind, drive: fam.drive, cap: fam.cap, poly: fam.poly,
    partials: ratios.map((r, i) => ({ r, a: amps[i], d: modeDecays(ratios, ringBase)[i] })),
    // where it sits: struck metal and drums low, pipes and small strings high
    reg: register || (famId === "gong" || famId === "drum" ? -1 : famId === "fluteOpen" || famId === "lamella" ? 1 : 0),
    // a touch of maker-to-maker variance, seeded — two peoples' pipes differ
    detune: (h - 0.5) * 0.012,
    harmonic: isHarmonic(ratios),
  };
}

/** Is this body's series (near-)harmonic? Decides synthesis path and, more
 *  importantly, whether its consonances land anywhere near just intervals. */
export function isHarmonic(ratios) {
  let err = 0;
  for (const r of ratios) err = Math.max(err, Math.abs(r - Math.round(r)) / Math.max(1, Math.round(r)));
  return err < 0.02;
}

/** What one instrument sounds like as a single struck/blown tone, for the
 *  roughness model: [{f, a}] at a reference fundamental. */
export function spectrumOf(inst, f0 = 220) {
  return inst.partials.filter(p => p.a > 0.01 && p.r * f0 < 11000).map(p => ({ f: p.r * f0, a: p.a }));
}
