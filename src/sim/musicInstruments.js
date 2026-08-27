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

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
  // BONE COMES OFF THE SAME ANIMAL AS THE HIDE. That is not a convenience, it
  // is the fact the table was missing: `gut` already needs ["hide"] for exactly
  // this reason — you do not get a skin without the beast that wore it, and
  // that beast also leaves bone, sinew and horn. The engine knew four of those
  // five. The omission silenced every people whose endowment is an animal
  // rather than a forest: measured over four hundred peoples, 19% held hide and
  // could build no drum of any kind because no wood existed to hoop it, and 43%
  // held gut and could build no string because a soundbox had to be timber.
  // Those are not marginal peoples. The oldest instruments anyone has ever
  // found are bone — the Hohle Fels and Geissenklösterle flutes, swan and
  // vulture radius and mammoth ivory, made in a periglacial tundra forty
  // thousand years ago by people with hide, bone, antler and no forest at all.
  // Stiff (E ~ 18 GPa) and dense (~1.9 g/cm3) but internally lossy next to
  // metal: it rings a little longer than wood and nothing like stone, and it is
  // brighter than horn because it is far stiffer for its damping.
  bone:   { label: "bone",    decay: 1.7, bright: 0.76, B: 0,      dens: 0.74, needs: ["hide"] },
  // the hand: no ore, no timber, no craft, and everybody has two
  none:   { label: "hands",   decay: 0.09, bright: 0.55, B: 0,      dens: 0.40, needs: [] },
};

// ── body families: the physical model → its mode ratios ──────────────────
// `ratios(n, mat)` returns the first n mode frequencies as multiples of the
// fundamental. `cap` is how many distinct pitches one such instrument can
// physically sound — the constraint that decides how big a scale a people
// can even play (a six-hole pipe cannot play twelve notes).
export const FAMILIES = {
  // ── strings ──
  lyre: {                       // open strings, one per pitch, plucked
    label: "lyre-class", kind: "pluck", drive: "pluck", cap: 7, low: 175, beta: 0.34, wid: 16, vib: "string", poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood", "bone", "horn", "gourd", "hide"], needs: { construction: 0.15 },
  },
  luteNeck: {                   // stopped strings — the neck is the pitch machine
    label: "stopped-string", kind: "pluck", drive: "pluck", cap: 14, low: 110, beta: 0.12, wid: 2, vib: "string", poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood", "bone", "horn", "gourd", "hide"], needs: { construction: 0.42 },
  },
  bowed: {                      // sustained string — a bow keeps the mode driven
    label: "bowed-string", kind: "sustain", drive: "bow", cap: 14, low: 196, beta: 0.09, wid: 8, vib: "string", poly: 1,
    ratios: (n, m) => harmonicStiff(n, m.B),
    body: ["gut", "silk"], frame: ["wood", "bone", "horn", "gourd", "hide"], needs: { construction: 0.5, mobility: 0.3 },
  },
  // ── winds ──
  fluteOpen: {                  // open tube, edge-blown: full harmonic series
    label: "open flute", kind: "sustain", drive: "breath", cap: 6, low: 262, vib: "air", poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["bamboo", "reed", "wood", "clay", "bone"], needs: {},
  },
  pipeStopped: {                // stopped tube: ODD harmonics only — a hollow, clarinet-ish spectrum
    label: "stopped pipe", kind: "sustain", drive: "breath", cap: 5, low: 220, vib: "air", poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => 2 * i + 1),
    body: ["bamboo", "reed", "clay", "gourd", "bone"], needs: {},
  },
  reedPipe: {                   // conical reed: full series, loud and buzzing
    label: "reed pipe", kind: "sustain", drive: "reed", cap: 8, low: 175, vib: "air", poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["reed", "bamboo", "wood"], needs: { construction: 0.3 },
  },
  horn: {                       // lip-driven natural horn — plays the harmonic series ITSELF
    label: "natural horn", kind: "sustain", drive: "lip", cap: 6, low: 116, vib: "air", tune: "series", poly: 1,
    ratios: (n) => Array.from({ length: n }, (_, i) => i + 1),
    body: ["horn", "bronze", "iron", "clay", "bone"], needs: {},
  },
  // ── struck: where the spectra stop being harmonic ──
  barSet: {                     // tuned bars over resonators: free–free bar modes,
                                // pulled onto whole numbers by undercutting
    label: "tuned bars", kind: "struck", drive: "strike", cap: 7, low: 130, beta: 0.5, wid: 14, vib: "bar", poly: 2, reso: true,
    ratios: (n, m, K) => barRatios(n, ((K.construction ?? 0) - 0.25) / 0.6),
    body: ["wood", "bamboo", "stone", "bronze", "iron"], frame: ["bamboo", "wood", "gourd", "clay", "bone", "stone", "horn"],
    needs: { construction: 0.25 },
  },
  gong: {                       // flat cast plate — dense inharmonic plate modes
    label: "gong", kind: "struck", drive: "strike", cap: 3, low: 65, beta: 0.5, wid: 40, vib: "plate", poly: 1,
    ratios: (n) => PLATE.slice(0, n),
    body: ["bronze", "iron"], needs: { metallurgy: 0.45 },
  },
  bell: {                       // cast profile — the partials a founder can actually tune
    label: "bell", kind: "struck", drive: "strike", cap: 5, low: 98, beta: 0.78, wid: 26, vib: "plate", poly: 1,
    // tuning a bell means hearing ONE partial at a time and shaving for it —
    // a founder's craft on top of the metallurgy that let them cast at all
    ratios: (n, m, K) => bellRatios(n, ((K.metallurgy ?? 0) * 0.5 + (K.construction ?? 0) * 0.5 - 0.55) / 0.4, K.seed),
    body: ["bronze", "iron", "clay"], needs: { metallurgy: 0.55 },
  },
  lamella: {                    // plucked clamped tongue: violently inharmonic upper modes
    label: "plucked tongues", kind: "pluck", drive: "pluck", cap: 8, low: 147, beta: 0.9, wid: 3, vib: "tongue", poly: 2, reso: true,
    ratios: (n) => LAMELLA.slice(0, n),
    body: ["iron", "bronze", "bamboo"], frame: ["wood", "gourd", "bone"], needs: { metallurgy: 0.3 },
  },
  // ── membranes: pitch-vague, the time-keepers ──
  drum: {
    label: "drum", kind: "struck", drive: "strike", cap: 2, low: 80, beta: 0.5, wid: 45, vib: "membrane", poly: 1,
    ratios: (n, m, K) => (K.shell ? MEMBRANE_SHELL : MEMBRANE_OPEN).slice(0, n),
    // Radiation order decides which modes die first, and it is the reverse of
    // what a rolloff by frequency gives. The concentric (0,n) modes push air
    // out in every direction at once — monopoles, efficiently radiating, so
    // they lose their energy fast — while the (m,1) modes above them cancel
    // themselves and hang on. Measured on a timpano: the (0,1) is gone in
    // three tenths of a second while the (2,1) rings for nearly four.
    decays: (i, r, base, K) => base * (i === 0 ? (K.shell ? 0.16 : 0.5) : 1.5 / Math.pow(r, 0.7)),
    body: ["hide"], frame: ["wood", "clay", "gourd", "bone"], needs: {},
  },
  frameDrum: {
    label: "frame drum", kind: "struck", drive: "strike", cap: 1, low: 110, beta: 0.62, wid: 38, vib: "membrane", poly: 1,
    ratios: (n) => MEMBRANE_OPEN.slice(0, n),
    // open on both sides, so every mode demotes one radiation order and rings
    // longer than the same mode over a shell — which is most of the difference
    // between a bendir and a conga
    decays: (i, r, base) => base * (i === 0 ? 1.1 : 2.0 / Math.pow(r, 0.6)),
    body: ["hide"], frame: ["wood", "bone"], needs: {},
  },
  claps: {                      // hands, and the body they are attached to
    label: "hands", kind: "struck", drive: "strike", cap: 1, low: 200, beta: 0.5, wid: 60,
    vib: "membrane", poly: 1,
    ratios: (n) => MEMBRANE_OPEN.slice(0, n).map(r => r * 2.4),
    body: ["none"], needs: {},
  },
};

// standard mode series (physics, not parameters)
const BAR_FREE  = [1, 2.756, 5.404, 8.933, 13.34, 18.64];          // free–free bar, UNCUT
const BAR_ARCH  = [1, 3.00, 6.16, 10.29, 15.5, 21.6];              // arch-undercut (xylophone)
const BAR_DEEP  = [1, 3.92, 9.24, 16.27, 24.0, 33.0];              // deep-undercut (marimba)
const LAMELLA   = [1, 6.267, 17.55, 34.39];                        // clamped–free bar
// A DRUMHEAD IN AIR IS NOT AN IDEAL MEMBRANE. The textbook circular membrane
// runs 1 : 1.593 : 2.135 : 2.295 — ratios that agree with nothing, which would
// mean a drum has no pitch at all. It has one because the head has to drag the
// air with it, and that loading drops the low modes far more than the high
// ones: measured, the (1,1) falls by 518 cents and the (5,1) by about 50. What
// is left is close to whole numbers, and THAT is why a djembe or a bendir
// speaks a note. The series below is normalised to the (1,1) — the mode you
// hear as the pitch — with the (0,1) beneath it, which is what a bass stroke
// in the middle of the head excites and a rim stroke misses entirely.
const MEMBRANE_OPEN  = [0.55, 1, 1.47, 1.91, 2.36, 2.80];   // no kettle: a frame drum
const MEMBRANE_SHELL = [0.58, 1, 1.50, 1.97, 2.44, 2.89];   // a closed shell raises the
                                                            // concentric modes and pulls
                                                            // the rest onto 2:3:4:5
const PLATE     = [1, 2.08, 3.41, 3.89, 5.00, 6.71];               // flat circular plate
const BELL      = [0.5, 1, 1.2, 1.5, 2, 2.5, 3.0];                 // hum · prime · tierce · quint · nominal

// ── two things a maker DOES to a body, and the difference they make ───────
//
// Both of these were being given away free, and both are the reason a culture
// can or cannot build its music on struck metal or wood.
//
// UNDERCUTTING. A plain bar rings at 1 : 2.756 : 5.404 — partials that agree
// with nothing, which is why an uncut slab sounds clangy and half-pitched. A
// maker who thins the bar's underside pulls the second mode down onto a whole
// number: an arch cut lands 3:1 (the xylophone), a deeper cut 4:1 (the
// marimba), and at that point the body has a real pitch and can carry a tune.
// This is the entire acoustic difference between a noise-maker and a melodic
// instrument, and it is a matter of craft — so gate it on craft, and let the
// melodic promotion be EARNED rather than granted by family name.
function barRatios(n, cut) {
  const k = Math.max(0, Math.min(1, cut));
  // one continuous cut depth: uncut → arch → deep
  const a = k < 0.5 ? BAR_FREE : BAR_ARCH, b = k < 0.5 ? BAR_ARCH : BAR_DEEP;
  const f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
  return Array.from({ length: n }, (_, i) => (a[i] ?? a[a.length - 1]) + ((b[i] ?? b[b.length - 1]) - (a[i] ?? a[a.length - 1])) * f);
}

// BELL TUNING. The profile above — hum an octave under the prime, a clean
// tierce, quint and nominal — is not what a bell does when you cast one. It is
// what a bell does after someone has worked out that its partials can be
// isolated and moved independently by shaving the inside wall, which happened
// once, in the Low Countries, in the 1630s, and was then lost for a century
// and a half. A cast bell whose founder does not know that has partials that
// scatter, and scattered partials are exactly why its pitch is ambiguous and
// why almost no tradition on earth plays tunes on bells.
//
// So the tidy profile is the CEILING, reached only by a founder who can
// measure what they are moving; below that the partials wander, by an amount
// that shrinks as the craft improves, and the bell fails the melodic test on
// its own physics rather than by a rule with its name in it.
function bellRatios(n, tune, seed) {
  const k = Math.max(0, Math.min(1, tune));
  return BELL.slice(0, n).map((r, i) => {
    const h = hash32(seed >>> 0, "bell", i) / 4294967296 - 0.5;
    return r * (1 + h * 0.34 * (1 - k) * (i === 1 ? 0.2 : 1));   // the prime is what you cast TO
  });
}

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
// The envelope falls off with FREQUENCY, not with mode number. That
// distinction does nothing for a harmonic body — its modes sit at 1, 2, 3 …
// so the ordinal and the frequency ratio are the same thing — but it is
// everything for an inharmonic one, whose modes are few and far out. Index by
// ordinal and a plucked tongue's second mode, at more than six times the
// fundamental, comes out at ninety per cent of its amplitude: a shriek, not
// an instrument. Index by frequency and it lands where it belongs.
//
// The law is a power rolloff, a_r = r^−p: about −6 dB per octave for a
// plucked or blown body and steeper for a struck one, which is the standard
// idealization for these excitations. `p` also picks up the material's
// brightness, since a duller body loses its highs faster.
/**
 * The spectrum of one contact, normalised to 1 at zero frequency.
 *
 * A blow is not an impulse — it is a force that rises and falls over a
 * contact time τ, and the shape of that force is what decides which modes
 * hear it. A raised-cosine contact (the standard idealization for a mallet or
 * a fingertip leaving a string) rolls off from about 1/τ and falls away
 * steeply after, which is why a soft beater on a bar gives a hum and a hard
 * one gives a clack from the same body.
 */
export function contactSpectrum(f, tau) {
  const x = f * tau;
  if (x < 1e-6) return 1;
  if (Math.abs(x - 1) < 1e-3) return 0.5;              // the removable singularity
  const s = Math.sin(Math.PI * x) / (Math.PI * x);
  return Math.abs(s / (1 - x * x));
}

/**
 * The contact time of one blow, in seconds.
 *
 * Two things set it and both are physical. The striker's compliance: soft
 * things stay in contact longer. And the impact speed: a Hertzian contact
 * stiffens as it compresses, so a faster blow is a SHORTER one — which is the
 * entire mechanism behind velocity and brightness, and it needs no curve.
 */
export function contactTime(inst, vel, matIn) {
  const mat = matIn || MATERIALS[inst.mat] || MATERIALS.wood;
  // a striker is made of what the culture has to hand, and a body of hard
  // ringing material is played with a hard beater or there is no point to it
  const soft = 1 - 0.45 * mat.bright;
  const base = (inst.drive === "pluck" ? 0.0016 : 0.0032) * soft;
  return clamp(base * Math.pow(Math.max(0.05, vel), -0.22), 0.00018, 0.014);
}


// ── what the body radiates, as a spectrum ────────────────────────────────
// Not a fitted rolloff any more. A mode's share of a note is the excitation's
// own spectrum at that mode's frequency, times the mode's shape at the point
// of contact — which is the same calculation the renderer does, so the
// spectrum the tuning model derives a scale FROM is the spectrum the ear
// actually hears. The old `p0` table (one exponent per kind of driver, with
// no meaning outside this file) existed only because the excitation had
// nowhere to touch the modes; give it somewhere and the table goes.
function modeAmps(ratios, fam, mat, f0 = 220) {
  const tau = contactTime({ drive: fam.drive, mat: mat.label }, 0.6, mat);
  const beta = fam.beta ?? 0.4;
  const nCut = fam.wid ? (fam.vib === "string" ? 340 / fam.wid : 260 / fam.wid) : 40;
  const drivenHere = fam.kind === "sustain";
  return ratios.map((r, i) => {
    const n = i + 1;
    if (drivenHere) {
      // A held body is not excited once and left; it is driven continuously,
      // so its steady spectrum is set by the valve that drives it, not by a
      // contact. What it does share with a struck body is that the driver
      // touches it somewhere, and a driver over a node cannot feed that mode.
      return Math.abs(Math.sin(Math.PI * n * beta)) / Math.pow(n, 0.85);
    }
    return contactSpectrum(r * f0, tau)
      * Math.abs(Math.sin(Math.PI * n * beta))
      / Math.sqrt(1 + Math.pow(n / nCut, 2));
  });
}
// Higher modes die faster, and for a struck body they die MUCH faster: the
// damping mechanisms in a bar or plate (thermoelastic loss, radiation) climb
// steeply with frequency. This is why a tuned metal bar reads as a pitch at
// all — the fundamental rings for seconds while the inharmonic modes above it
// are gone in a fraction of one. Damping them as gently as a string's
// harmonics leaves every note trailing a four-second cloud that fights the
// next one.
function modeDecays(ratios, base, drive, fam, K) {
  // a family that knows how its own modes radiate says so; everything else
  // loses its highs to the standard damping climb with frequency
  if (fam && fam.decays) return ratios.map((r, i) => fam.decays(i, r, base, K || {}));
  const q = drive === "strike" ? 1.9 : drive === "pluck" ? 1.2 : 0.75;
  return ratios.map(r => base / Math.pow(Math.max(1, r), q));
}

/**
 * Build one instrument. Everything the synth and the tuning model need comes
 * out of the family's physics and the material's acoustics — nothing here
 * takes a musical decision.
 */
export function makeInstrument(famId, matId, frameId, seed, register = 0, know = {}) {
  const fam = FAMILIES[famId], mat = MATERIALS[matId];
  // what the maker knew, and who they were: a body is not just a shape, it is
  // a shape somebody was able to execute
  const K = { ...know, seed, shell: frameId === "clay" || frameId === "gourd" };
  // how many modes this body actually radiates with useful energy: a string
  // or air column supports a long series; a bar, plate or bell has only a few
  // strong modes — a fact about the geometry, and the reason their consonance
  // landscape is so much sparser.
  const nModes = MODE_COUNT[famId] ?? (fam.kind === "sustain" ? 12 : 10);
  const ratios = fam.ratios(nModes, mat, K);
  const amps = modeAmps(ratios, fam, mat);
  // a struck body rings for its material's time; a driven one is held, so its
  // "decay" is a release, not a ring-down
  // MATERIALS.decay is the body's T60 at a reference pitch. The old ×0.55 on
  // plucked bodies was a fudge in the wrong direction — a plucked string rings
  // longer than a struck wooden bar, not half as long.
  const ringBase = fam.kind === "sustain" ? 0.18 : mat.decay;
  const h = hash32(seed >>> 0, famId, matId) / 4294967296;
  const peak = Math.max(...amps) || 1;
  for (let i = 0; i < amps.length; i++) amps[i] /= peak;
  return {
    id: `${famId}:${matId}:${frameId || "-"}`, fam: famId, mat: matId, frame: frameId || null,
    label: fam.label, kind: fam.kind, drive: fam.drive, cap: fam.cap, poly: fam.poly,
    partials: (() => { const d = modeDecays(ratios, ringBase, fam.drive, fam, K);
      return ratios.map((r, i) => ({ r, a: amps[i], d: d[i] })); })(),
    // where it sits: struck metal and drums low, pipes and small strings high
    reg: register || (famId === "gong" || famId === "drum" ? -1 : famId === "fluteOpen" || famId === "lamella" ? 1 : 0),
    reso: !!fam.reso,
    // how well this was made: a driven body's voice depends on it (a small
    // hard reed speaks higher and more piercingly than a big soft one)
    craft: Math.max(0, Math.min(1, ((K.construction ?? 0.3) + (K.metallurgy ?? 0.3)) / 2)),
    // SYMPATHETIC STRINGS: a second set nobody plays, tuned to the scale and
    // left to answer whatever the played strings put into the bridge. They are
    // a refinement rather than a necessity — more wire, more pegs, more work,
    // and no use at all unless the tradition holds still enough pitches to be
    // worth tuning them to — so a maker builds them only where the craft is
    // there to spend.
    symp: fam.vib === "string" && fam.cap >= 10 && (know.construction ?? 0) > 0.62,
    // OMBAK. Two bars cast to the same nominal pitch are never the same bar,
    // and the difference between them is heard as a beat — slow, steady, and
    // the same number of hertz wherever they are played, so it shrinks in
    // cents as the pitch rises. How big the mismatch is, is a matter of craft;
    // whether a people keeps two of everything is a matter of what the surplus
    // will carry. A tradition that prizes the shimmer is downstream of having
    // it, which is exactly how it became an aesthetic rather than a fault.
    ombak: fam.vib === "bar" || fam.vib === "plate"
      ? 1 + 11 * (1 - Math.max(0, Math.min(1, ((know.construction ?? 0.3) + (know.metallurgy ?? 0.3)) / 2)))
      : 0,
    // A GONG BLOOMS. Struck hard, a plate is driven past the range where its
    // modes are independent: they start pumping each other, and energy climbs
    // out of the fundamental into partials that were silent at the strike. A
    // large tam-tam takes one to two seconds to reach full brilliance, and if
    // the blow is soft the brilliance never develops at all — the coupling is
    // quadratic, so what arrives up there goes as the SQUARE of how hard you
    // hit it. This is why a gong swells instead of decaying, and no amount of
    // filtering a decaying strike will imitate it.
    blooms: fam.vib === "plate",
    // and which way the pitch slides as it dies is set by the profile: a flat
    // plate stiffens as it flexes and falls as much as three semitones, a
    // curved shell softens and rises
    glide: fam.vib === "plate" ? (famId === "gong" ? -1 : 0.55) : 0,
    // a hand-made resonating tube is never exactly on pitch; better craft,
    // smaller error
    mistune: ((h - 0.5) * 0.02),
    // WHETHER A NOTE CAN BE STOPPED is a fact about the element's mass, not a
    // family name. A player's free hand lands on the key they are replacing and
    // lets everything else ring, which is why keyboards of small bars sound
    // full instead of muddy — and why nobody has ever done it to a hung gong.
    // A body is played damped when a hand can take it out of the way inside a
    // note; how fast that actually happens is dampTime(), so a wooden bar
    // stops dead and a bronze one takes a few tenths.
    damped: fam.kind !== "sustain" && mat.decay > 0.35 && dampTime({ fam: famId, mat: matId }) < 2,

    // a touch of maker-to-maker variance, seeded — two peoples' pipes differ
    detune: (h - 0.5) * 0.012,
    harmonic: isHarmonic(ratios),
  };
}

/**
 * THE VOICE. The one instrument every people has: it costs no ore, no timber
 * and no craft, which is why the overwhelming majority of the world's music is
 * sung and why a tradition can exist with no built instrument at all. A people
 * with nothing else is not an empty ensemble and it is not a drum made out of
 * timber they do not have — it is somebody singing, and somebody clapping.
 *
 * Acoustically it is a driven harmonic source, which is also why it belongs in
 * the tuning model: a culture's ear is calibrated on the spectrum it hears
 * most, and the spectrum it hears most is a human throat.
 */
export function makeVoice(seed = 0) {
  const n = 20;
  const ratios = Array.from({ length: n }, (_, i) => i + 1);
  // a glottal pulse falls off at roughly twelve decibels per octave
  const amps = ratios.map(r => Math.pow(r, -1.35));
  return {
    id: "voice", fam: "voice", mat: "voice", frame: null, label: "the voice",
    kind: "sustain", drive: "breath", cap: 24, poly: 1, low: 130,
    partials: ratios.map((r, i) => ({ r, a: amps[i], d: 0.22 })),
    reg: 0, reso: false, mistune: 0, damped: false, detune: 0, craft: 1,
    harmonic: true, weight: 1, raw: 1,
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

// ── what a body can be ASKED to do ───────────────────────────────────────
//
// The engine used to decide which instrument carried the melody by ranking
// pitch count and prestige, which is how cultures ended up playing tunes on
// bells and gongs. No human tradition does that, and the reason is not taste:
// it is four physical properties of the body, every one of them computable
// from the modal series this file already derives. So compute them and let
// the roles fall out. No family is named anywhere below.

/**
 * PITCH DEFINITENESS. How unambiguously does one stroke give one pitch?
 *
 * Every partial votes for a fundamental it could be a harmonic of, and the
 * pitch you hear is where the votes agree. Three things decide how strong
 * that agreement is, and they are exactly the three that separate a string
 * from a bell:
 *   · how much of the SUSTAINED energy supports it — modes that are gone in a
 *     fiftieth of a second colour the attack and leave the pitch alone;
 *   · how many partials confirm it — a lone sine has a pitch, but a weak one,
 *     and pitch strength climbs with the number of agreeing partials before
 *     it saturates;
 *   · whether anything sounds BELOW it. A partial under the fundamental is
 *     what makes a bell's octave arguable — listeners genuinely disagree
 *     about which octave a bell is in — and a melody nobody can place in an
 *     octave is not a melody.
 */
export function definiteness(partials) {
  if (!partials || !partials.length) return 0;
  const w = partials.map(p => p.a * Math.min(1, p.d / 0.12));
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  const lo = Math.min(...partials.map(p => p.r)) / 2;
  const hi = Math.max(...partials.map(p => p.r));
  let best = 0, bestF = 1, bestN = 0;
  const span = 1200 * Math.log2(hi / lo);
  for (let c = 0; c <= span; c += 3) {
    const f = lo * Math.pow(2, c / 1200);
    let sup = 0, n = 0;
    for (let i = 0; i < partials.length; i++) {
      const q = partials[i].r / f;
      if (q < 0.8) continue;
      const k = Math.max(1, Math.round(q));
      // a semitone-wide template window: wider and everything matches,
      // narrower and nothing real does
      const m = Math.exp(-Math.pow((1200 * Math.log2(q / k)) / 55, 2));
      sup += w[i] * m; n += m;
    }
    const sc = sup / tot;
    if (sc > best) { best = sc; bestF = f; bestN = n; }
  }
  let under = 0;
  for (let i = 0; i < partials.length; i++) if (partials[i].r < bestF * 0.94) under += w[i];
  const clear = 1 - Math.min(0.75, (under / tot) * 1.6);
  return Math.max(0, Math.min(1, best * (1 - Math.exp(-0.7 * bestN)) * clear));
}

/**
 * How fast the body stops when the player wants it to.
 *
 * Damping is contact with the VIBRATING ELEMENT, so what matters is that
 * element's mass, not the instrument's. And the masses differ by orders of
 * magnitude for one reason: whether the element has to radiate for itself.
 * A string is a thread and a drumhead a skin, because a soundboard or a shell
 * does the radiating; a tuned bar is a small slab because a tube under it
 * does; a gong or a bell IS its own radiator, so it has to carry enough metal
 * to couple to the air on its own. That is why a gamelan key weighs a kilo or
 * two and the great gong of the same set weighs sixty — a ratio far past what
 * their pitches alone would explain — and it is the whole reason a player can
 * stop one and not the other.
 */
// A clamped-free tongue is not a free-free bar. At the same pitch it is a
// fraction of the length — that is what its 1 : 6.27 series IS, a very stiff
// short cantilever — so it is a fraction of the mass, and a thumb stops it
// where it would not stop a marimba key.
export const ELEMENT = { string: 0.02, air: 0.01, membrane: 0.06, tongue: 0.15, bar: 1, plate: 9 };

/**
 * HOW LOUD THIS BODY IS, relative to the others in the room.
 *
 * The same element mass that decides whether a player can stop a body decides
 * how much air it moves, and for the same reason: an element is heavy exactly
 * when it has to radiate for ITSELF. A string is a thread that radiates
 * essentially nothing and lets a soundboard do the work; a gong carries sixty
 * kilos of bronze because nothing else is going to couple it to the air. So
 * the loudest things in a room are the ones that are their own radiators, and
 * that is not a preference about gongs, it is what the mass is FOR.
 *
 * Measured before this existed, at one written velocity, the engine spread its
 * bodies over 28.8 dB with the order INVERTED — a thumb piano at -19.9 dB was
 * the loudest thing it made and a gong at -35.6 among the quietest. A thumb
 * piano is one of the quietest instruments in the world.
 *
 * Log, not linear: 450x the element mass is not 450x the sound, because most
 * of that mass buys coupling rather than amplitude, and a real ensemble spans
 * something like twenty decibels from its quietest body to its loudest.
 */
export function radiatedLevel(inst) {
  const fam = FAMILIES[inst.fam] || {};
  // A DRIVEN BODY IS NOT LIMITED BY ITS ELEMENT. A struck body radiates the
  // energy one stroke put into it, so the element's mass is the whole story.
  // A blown or bowed one is being fed for as long as the note lasts, and what
  // it radiates is what the player is putting in — which is why a trumpet,
  // whose vibrating element is a column of air that weighs nothing, is among
  // the loudest things in an orchestra, and why reading its loudness off the
  // air's mass would put it under a thumb piano.
  if (inst.kind === "sustain") return 1;
  const e = ELEMENT[fam.vib] ?? 0.1;
  const REF = ELEMENT.membrane;                     // a drum: the middle of any room
  return Math.pow(e / REF, 0.28);
}
export function dampTime(inst) {
  const m = MATERIALS[inst.mat] || MATERIALS.wood;
  const fam = FAMILIES[inst.fam] || {};
  const f = fam.low || 200;
  // calibration: a hand on a small wooden key silences it in about a fifth of
  // a second, which is what hand-damping on a xylophone actually sounds like.
  // A tenth of a SECOND time-constant, the first guess, is a two-thirds-of-a-
  // second fade — far too slow to be damping at all, and it made every bronze
  // body come out un-stoppable.
  const REF = 0.55 / (400 * 400);
  return 0.03 * (ELEMENT[fam.vib] ?? 1) * (m.dens / (f * f)) / REF;
}

/**
 * MELODIC CAPACITY: can this body be the thing a listener follows?
 *
 * Definiteness first, and squared, because an ambiguous pitch cannot make a
 * line at all. Then reach — a melody needs five or six pitches out of one
 * player, and they have to be pitches the player can PUT somewhere: a body
 * whose notes are its own harmonic series has no say in where they land, which
 * is why natural horns make signals and fanfares rather than tunes. Then
 * whether the body can still be sounding for as long as THIS MUSIC'S notes
 * last, which is a match between the two and not a property of either — pass
 * `noteSecs` from the tradition's own grid. And last, whether one note can
 * clear before the next one arrives.
 */
export function melodicCapacity(inst, noteSecs = 0.5) {
  const fam = FAMILIES[inst.fam] || {};
  const def = definiteness(inst.partials);
  // pitches the player can place where the music wants them
  // Pitch REACH is not a threshold to clear. A five-hole pipe and a
  // fourteen-stop neck are not equally able to carry a line, and capping both
  // at one puts the pipe over the lute — which would rank the oud, the pipa
  // and the sitar, the archetypal melody instruments of three continents,
  // below any pipe at all.
  const reach = Math.min(1, (inst.cap * (fam.tune === "series" ? 0.5 : 1)) / 9);
  // CAN IT STILL BE SOUNDING WHEN THE NOTE IS MEANT TO BE SOUNDING? That is
  // the whole of it, and it is a MATCH between the body and the music rather
  // than a property of the body alone.
  //
  // What stood here was a flat preference for driven bodies — 1 for a bow, a
  // breath or a reed, 0.82 for a pluck — on the reasoning that a driven body
  // is under the player's hand for the whole note. The reasoning is true and
  // the conclusion does not follow. Measured, every string in the bench scored
  // `def² · reach` = 1.000 with its articulation rate saturated, so that one
  // constant WAS the entire lead decision: the kamanja outranked the oud, the
  // sarangi the sitar and the erhu the guqin, all three by 0.82 against 1.00.
  // A rule that quietly deletes the oud, the pipa, the sitar, the koto and the
  // guqin from the world's melody instruments is not modelling anything.
  //
  // Sustain past the end of the note buys NOTHING. A bowed string that could
  // hold a note for a minute is no better at a half-second tune than a plucked
  // one that rings for two seconds — both are still sounding when the next
  // note arrives, and that is all the music asked for. So the question is how
  // much of ITS OWN note this body can fill, which is why the same rule gives
  // fast dance music to plucked and struck bodies and long-breathed music to
  // bowed and blown ones, instead of giving everything to the bow.
  const holds = inst.kind === "sustain" ? 1
    : Math.min(1, (inst.partials[0] ? inst.partials[0].d : 0.2) / Math.max(0.05, noteSecs));
  return def * def * reach * holds * Math.min(1, articRate(inst) / 2.5);
}

/**
 * How many notes a second this body can play before it turns into a chord.
 * A note stops getting in the way once it is about twenty decibels under the
 * one after it — a third of the way through its T60 — and it gets there
 * either by dying or by being stopped, whichever comes first.
 */
export function articRate(inst) {
  // A DRIVEN body stops when the driver stops, so what limits it is not decay
  // at all — it is how fast a tongue, a bow arm or a pair of fingers can move,
  // and that is a fact about people rather than about the instrument. Ten
  // notes a second is about the ceiling of any human passagework.
  if (inst.kind === "sustain") return 10;
  const t60 = Math.min(inst.partials[0] ? inst.partials[0].d : 1, dampTime(inst) * 6.907755);
  // twenty decibels down is when a note stops getting in the way of the next —
  // and above about a dozen notes a second the limit stops being the
  // instrument and starts being the hands, for everybody
  return Math.min(12, 2 / Math.max(0.02, t60 / 3));
}
