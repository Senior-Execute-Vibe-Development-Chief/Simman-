// ── Five real traditions, as a BENCH ──────────────────────────────────────
//
// `musicRefs.js` pins the INPUTS a tradition had and lets the engine derive
// the rest, which is the right way to check a generator against reality. This
// file does the opposite on purpose, and it is important to say why that is
// not a cardinal-rule violation.
//
// These are not the generator. Nothing here runs when a people is founded, no
// derived people can reach this table, and no constant in it feeds back into
// musicGenome, musicTuning or musicCompose. They are a KNOWN-ANSWER TEST: the
// tuning, the ensemble, the metre and the texture of five traditions that
// actually exist, written down from measurement, so that the synthesis and the
// composer can be heard playing something whose right answer is known.
//
// That makes fitting DETECTABLE rather than hiding it. If a maqam played on an
// oud through this engine does not sound like an oud playing a maqam, the
// fault is in the synthesis or the composer, and no amount of arguing about
// emergent scales will move it. If it does sound right, then a derived people
// that sounds wrong is wrong in its SCALE, not in its sound. Those are two
// different bugs and there was no way to tell them apart.
//
// Sources are measurement, not taste: the Chinese cycle-of-fifths tuning
// (三分損益法) is Pythagorean by construction; the Highland pipe scale is given
// as measured, flat seventh and all, rather than idealised; Hindustani Yaman is
// its just shruti reading; maqām Rast carries its neutral third and seventh;
// miyako-bushi is the in-scale as taught. Where a real instrument has no exact
// body in this engine, the nearest physical model is named and the difference
// is stated in `note` rather than papered over.

/** Cents → ratio, for building a pinned scale in the shape deriveScale returns. */
const R = (c) => Math.pow(2, c / 1200);

export const TRADITIONS = {
  chinese: {
    label: "Chinese court",
    gloss: "Pythagorean pentatonic (三分損益), silk and bamboo, heterophonic",
    // 三分損益法: the cycle of fifths, alternately taking and adding a third of
    // the string. That is Pythagorean by construction, so the thirds are wide
    // (408, not 386) and the whole scale is built out of 3:2s.
    frame: 1200,
    // 五聲, the five tones, and nothing else. The seven-tone 雅樂 scale used to
    // sit underneath this with 變徵 and 變宮 added — a real court extension, and
    // a tritone away from the tonic that no 五聲 melody ever touches. Keeping it
    // as the scale and the pentatonic as its mode was true to the theory and
    // wrong as a reference: what anyone recognises as Chinese is the five, and
    // the two extra degrees only ever appeared on the page.
    scale: [0, 204, 408, 702, 906],                 // 宮 商 角 徵 羽
    mode: [0, 204, 408, 702, 906],
    finalIdx: 0,
    insts: [
      { fam: "luteNeck", mat: "silk", frame: "wood", label: "guqin", cap: 14, weight: 1.0, role: "lead" },
      { fam: "luteNeck", mat: "silk", frame: "wood", label: "pipa", cap: 14, weight: 0.8 },
      { fam: "fluteOpen", mat: "bamboo", label: "dizi", cap: 6, weight: 0.75 },
      { fam: "bowed", mat: "silk", frame: "hide", label: "erhu", cap: 14, weight: 0.7 },
      { fam: "reedPipe", mat: "bamboo", label: "sheng", cap: 8, weight: 0.55 },
      { fam: "bell", mat: "bronze", label: "bianzhong", cap: 5, weight: 0.45 },
      { fam: "drum", mat: "hide", frame: "wood", label: "gu", cap: 2, weight: 0.4 },
    ],
    rhythm: { tempo: 76, meterKind: "duple", beats: 4, div: 2, density: 0.5, syncopation: 0.08, swing: 0 },
    texture: { kind: "heterophony", size: 5, ornament: 0.55, sustains: true, courtly: 0.85 },
    melody: { step: 0.6, arch: 0.42, descent: 0.6, breathBound: false, toneBound: true, reach: 7 },
    note: "The guqin is a stopped zither, so it takes the stopped-string model rather than a lyre's open strings; the erhu's body is a snakeskin membrane, which is why its frame is hide.",
  },

  celtic: {
    label: "Irish and Scottish — Mixolydian",
    gloss: "major with a flat seventh, pipes and fiddle over a drone",
    // THE FLAT SEVENTH IS THE WHOLE THING. Take a major scale, lower its
    // seventh, and you have the modal colour that most Irish and Scottish
    // dance music actually lives in — the one that lets a tune sit over a
    // single drone forever without ever wanting to resolve upward, which is
    // why a bagpipe can play it at all.
    //
    // Just, because a fiddle and a pipe chanter are tuned to each other by ear
    // and a drone is what they tune against: 9/8, 5/4, 4/3, 3/2, 5/3, 16/9.
    frame: 1200,
    scale: [0, 204, 386, 498, 702, 884, 996],
    mode: [0, 204, 386, 498, 702, 884, 996],
    finalIdx: 0,
    insts: [
      { fam: "reedPipe", mat: "reed", label: "chanter", cap: 9, weight: 1.0, role: "lead" },
      { fam: "reedPipe", mat: "reed", label: "drones", cap: 1, weight: 0.9, role: "drone" },
      { fam: "bowed", mat: "gut", frame: "wood", label: "fiddle", cap: 14, weight: 0.8 },
      { fam: "fluteOpen", mat: "wood", label: "whistle", cap: 8, weight: 0.6 },
      { fam: "frameDrum", mat: "hide", frame: "wood", label: "bodhrán", cap: 1, weight: 0.5 },
    ],
    rhythm: { tempo: 132, meterKind: "compound", beats: 2, div: 3, density: 0.9, syncopation: 0.12, swing: 0.15 },
    texture: { kind: "drone", size: 3, ornament: 0.9, sustains: true, courtly: 0.1 },
    melody: { step: 0.8, arch: 0.36, descent: 0.45, breathBound: true, toneBound: false, reach: 9 },
    note: "A bagpipe has no dynamics and cannot stop: everything expressive it does is ornament, which is why the chanter's grace-note vocabulary is the size it is.",
  },

  celticPipes: {
    label: "Highland pipes — as measured",
    gloss: "the real chanter scale, neutral third and all: not a mode anybody wrote down",
    // The Highland pipe scale as MEASURED off a chanter rather than as
    // idealised: a third at 341 cents that is neither major nor minor, a
    // seventh at 1010, and a fourth two cents flat. It is kept beside the
    // Mixolydian above for the same reason maqām Rast is kept beside
    // Ḥijāzkār — it is one of the bench's two genuinely neutral intervals,
    // and a reference bench that holds only the intervals a keyboard can play
    // is not testing anything.
    frame: 1200,
    scale: [0, 197, 341, 495, 700, 890, 1010],
    mode: [0, 197, 341, 495, 700, 890, 1010],
    finalIdx: 0,
    insts: [
      { fam: "reedPipe", mat: "reed", label: "chanter", cap: 9, weight: 1.0, role: "lead" },
      { fam: "reedPipe", mat: "reed", label: "drones", cap: 1, weight: 0.9, role: "drone" },
      { fam: "bowed", mat: "gut", frame: "wood", label: "fiddle", cap: 14, weight: 0.8 },
      { fam: "fluteOpen", mat: "wood", label: "whistle", cap: 8, weight: 0.6 },
      { fam: "frameDrum", mat: "hide", frame: "wood", label: "bodhrán", cap: 1, weight: 0.5 },
    ],
    rhythm: { tempo: 132, meterKind: "compound", beats: 2, div: 3, density: 0.9, syncopation: 0.12, swing: 0.15 },
    texture: { kind: "drone", size: 3, ornament: 0.9, sustains: true, courtly: 0.1 },
    melody: { step: 0.8, arch: 0.36, descent: 0.45, breathBound: true, toneBound: false, reach: 9 },
    note: "Given as measured, so the third sits between major and minor where a chanter really puts it — the interval that makes pipe music sound like nothing else and like nothing on a piano.",
  },

  hindustani: {
    label: "Hindustani — rāg Bhairavī",
    gloss: "every degree flattened but the fourth and fifth, sitār over a tānpūrā",
    // BHAIRAVĪ IS THE ONE EVERYBODY KNOWS. Komal re, ga, dha and ni — the
    // second, third, sixth and seventh all flat — which is Phrygian, and which
    // is the sound a listener anywhere in the world hears as Indian. It is
    // also the rāg a Hindustani concert traditionally ends on, so it is
    // canonical as well as recognisable, which is not always the same thing.
    //
    // Rāg Yaman stood here before, and Yaman is the rāg every student learns
    // first — but it is LYDIAN, a major scale with a raised fourth, and to an
    // ear that has not been taught it that reads as dreamy Western rather than
    // as Indian at all.
    //
    // Given as its shruti reading, which is just: 16/15, 6/5, 4/3, 3/2, 8/5,
    // 9/5. A sitār has movable frets and a tānpūrā under everything, so the
    // ratios are what the ear tunes to and not an approximation of them.
    frame: 1200,
    scale: [0, 112, 316, 498, 702, 814, 1018],
    mode: [0, 112, 316, 498, 702, 814, 1018],
    finalIdx: 0,
    insts: [
      { fam: "luteNeck", mat: "silk", frame: "gourd", label: "sitār", cap: 14, weight: 1.0, role: "lead", symp: true },
      { fam: "lyre", mat: "silk", frame: "gourd", label: "tānpūrā", cap: 4, weight: 0.9, role: "drone" },
      { fam: "drum", mat: "hide", frame: "wood", label: "tablā", cap: 3, weight: 0.8, role: "pulse" },
      { fam: "bowed", mat: "gut", frame: "hide", label: "sārangī", cap: 14, weight: 0.6, symp: true },
      { fam: "fluteOpen", mat: "bamboo", label: "bānsurī", cap: 7, weight: 0.55 },
    ],
    // tīntāl: sixteen beats in four groups of four
    rhythm: { tempo: 92, meterKind: "additive", beats: 16, div: 2, groups: [4, 4, 4, 4], density: 0.7, syncopation: 0.25, swing: 0 },
    texture: { kind: "drone", size: 4, ornament: 1.0, sustains: true, courtly: 0.6 },
    melody: { step: 0.78, arch: 0.5, descent: 0.55, breathBound: false, toneBound: false, reach: 11 },
    note: "The sitār's sympathetic strings are the engine's own `symp` halo, tuned to the rāg — the one place where a real instrument and this model already agreed.",
  },

  arabic: {
    label: "Arabic — maqām Ḥijāzkār",
    gloss: "two Ḥijāz tetrachords a tone apart, oud and qānūn, heterophonic",
    // ḤIJĀZKĀR IS BUILT TWICE. A maqām is assembled out of `ajnās` — tetrachords
    // — and this one is the same jins stated on the tonic and again on the
    // fifth: Ḥijāz on C is C D♭ E F, Ḥijāz on G is G A♭ B C, and the whole
    // scale is those two with a tone between them. The augmented second in the
    // middle of each is the sound everybody outside the tradition means when
    // they say "Arabic".
    //
    // Given as its JUST reading, the way rāg Yaman below is: 16/15, 5/4, 4/3,
    // 3/2, 8/5, 15/8. That is not a convenience — a jins is tuned by ear
    // against a drone and a fretless neck, and those are the ratios an ear
    // lands on. It also makes the symmetry exact: 112, 274, 112 | 204 | 112,
    // 274, 112, the same tetrachord twice.
    //
    // Ḥijāzkār has NO neutral degrees. Every note of it sits within fourteen
    // cents of a named pitch, which is why it survives being played on
    // anything — and it is why `arabicRast` below is kept as well: Rast's
    // neutral third and seventh are the case this bench exists to test, and
    // dropping the only quarter-tone tradition on it to gain a recognisable
    // one would have been trading a measurement for a preference.
    frame: 1200,
    scale: [0, 112, 386, 498, 702, 814, 1088],
    mode: [0, 112, 386, 498, 702, 814, 1088],
    finalIdx: 0,
    insts: [
      { fam: "luteNeck", mat: "gut", frame: "wood", label: "oud", cap: 16, weight: 1.0, role: "lead" },
      { fam: "lyre", mat: "gut", frame: "wood", label: "qānūn", cap: 14, weight: 0.85 },
      { fam: "fluteOpen", mat: "reed", label: "nāy", cap: 9, weight: 0.75 },
      { fam: "bowed", mat: "gut", frame: "wood", label: "kamānja", cap: 14, weight: 0.6 },
      { fam: "drum", mat: "clay", frame: "clay", label: "darbūka", cap: 3, weight: 0.55, role: "pulse" },
      { fam: "frameDrum", mat: "hide", frame: "wood", label: "riqq", cap: 1, weight: 0.45 },
    ],
    // maqsūm: dum - tak tak - dum - tak, four beats
    rhythm: { tempo: 104, meterKind: "duple", beats: 4, div: 4, density: 0.75, syncopation: 0.4, swing: 0 },
    texture: { kind: "heterophony", size: 5, ornament: 0.85, sustains: true, courtly: 0.5 },
    // a Ḥijāz melody LEAPS its augmented second on purpose rather than
    // stumbling over it, so it is less stepwise than Rast is
    melody: { step: 0.66, arch: 0.44, descent: 0.6, breathBound: false, toneBound: false, reach: 10 },
    note: "The oud is fretless, so its 16 pitches are a statement about the neck's length rather than about frets. Ḥijāzkār asks nothing of the qānūn's mandal levers, which is exactly the difference from Rast.",
  },

  arabicRast: {
    label: "Arabic — maqām Rast",
    gloss: "the mother maqām: a NEUTRAL third and seventh, playable on nothing with frets",
    // Rast: the third (355) and the seventh (1053) are NEUTRAL — neither major
    // nor minor, and not a quarter-tone grid either. They are the intervals
    // that make a maqām unplayable on a keyboard and are the whole sound.
    //
    // This is the bench's only quarter-tone tradition and it is here as a TEST
    // rather than as a demonstration: a recorded instrument bank is sampled at
    // equal-tempered pitches, so a scale built on neutral steps never lands on
    // one and every note of it is resampled. Ḥijāzkār above never is. Switching
    // between the two is the cleanest way to hear what that costs.
    frame: 1200,
    scale: [0, 204, 355, 498, 702, 906, 1053],
    mode: [0, 204, 355, 498, 702, 906, 1053],
    finalIdx: 0,
    insts: [
      { fam: "luteNeck", mat: "gut", frame: "wood", label: "oud", cap: 16, weight: 1.0, role: "lead" },
      { fam: "lyre", mat: "gut", frame: "wood", label: "qānūn", cap: 14, weight: 0.85 },
      { fam: "fluteOpen", mat: "reed", label: "nāy", cap: 9, weight: 0.75 },
      { fam: "bowed", mat: "gut", frame: "wood", label: "kamānja", cap: 14, weight: 0.6 },
      { fam: "drum", mat: "clay", frame: "clay", label: "darbūka", cap: 3, weight: 0.55, role: "pulse" },
      { fam: "frameDrum", mat: "hide", frame: "wood", label: "riqq", cap: 1, weight: 0.45 },
    ],
    rhythm: { tempo: 104, meterKind: "duple", beats: 4, div: 4, density: 0.75, syncopation: 0.4, swing: 0 },
    texture: { kind: "heterophony", size: 5, ornament: 0.85, sustains: true, courtly: 0.5 },
    melody: { step: 0.75, arch: 0.44, descent: 0.6, breathBound: false, toneBound: false, reach: 10 },
    note: "The qānūn's mandal levers are what let a fixed-pitch zither play a neutral third at all — and there is no lever anywhere in this engine's sample banks, which is the point of keeping this entry.",
  },

  japanese: {
    label: "Japanese — miyako-bushi",
    gloss: "the in-scale, koto and shakuhachi, and a great deal of silence",
    // 都節 (in-scale): the semitone above the final and above the fifth are
    // what make it sound Japanese and nothing else. Given in just readings
    // rather than in twelve-tone steps.
    frame: 1200,
    scale: [0, 90, 498, 702, 792],
    mode: [0, 90, 498, 702, 792],
    finalIdx: 0,
    insts: [
      { fam: "lyre", mat: "silk", frame: "wood", label: "koto", cap: 13, weight: 1.0, role: "lead" },
      { fam: "fluteOpen", mat: "bamboo", label: "shakuhachi", cap: 5, weight: 0.9 },
      { fam: "luteNeck", mat: "silk", frame: "hide", label: "shamisen", cap: 12, weight: 0.8 },
      { fam: "drum", mat: "hide", frame: "wood", label: "taiko", cap: 2, weight: 0.5 },
    ],
    // slow, and deliberately underfilled: MA is the point, so the density dial
    // sits where nothing else in the engine puts it
    rhythm: { tempo: 58, meterKind: "duple", beats: 4, div: 2, density: 0.28, syncopation: 0.05, swing: 0 },
    texture: { kind: "heterophony", size: 3, ornament: 0.5, sustains: true, courtly: 0.7 },
    melody: { step: 0.55, arch: 0.4, descent: 0.65, breathBound: true, toneBound: false, reach: 8 },
    note: "The shamisen's sawari buzz and the shakuhachi's breath noise are not modelled; the koto takes the open-string model because that is exactly what it is, thirteen strings and a movable bridge per string.",
  },
};

/**
 * How consonant each pinned degree is against the final — the same ranking
 * `deriveScale` gets from the roughness curve, computed here from the interval
 * itself because a pinned scale has no curve behind it. Used only to decide
 * which degrees a phrase treats as structural.
 */
const SERIES = [[0, 1], [702, 0.9], [498, 0.75], [386, 0.6], [316, 0.55], [884, 0.5], [204, 0.4], [1088, 0.3]];
function promOf(cents, frameCents) {
  let best = 0;
  const iv = ((cents % frameCents) + frameCents) % frameCents;
  for (const [t, w] of SERIES) {
    const d = Math.min(Math.abs(iv - t), Math.abs(iv - t + frameCents), Math.abs(iv - t - frameCents));
    if (d < 60) best = Math.max(best, w * (1 - d / 60));
  }
  return best;
}

/**
 * Rewrite a generated `music` record as one of the pinned traditions.
 *
 * Everything downstream — the composer, the strata, the synthesis, the voice —
 * runs completely unchanged. That is the whole point: this swaps the INPUTS a
 * tradition hands to the rest of the engine and changes nothing about how the
 * engine treats them, so what you hear is this codebase playing a real scale on
 * real bodies, and any remaining wrongness is the codebase's.
 */
export function applyTradition(m, key, deps) {
  const T = TRADITIONS[key];
  if (!T) return m;
  const { makeInstrument, finalsOf } = deps;

  // ── the bodies ──
  m.insts = T.insts.map((s, i) => {
    const inst = makeInstrument(s.fam, s.mat, s.frame || null, (m.people.seed >>> 0) + i * 7919, 0, m.people.know || {});
    inst.label = s.label;
    // AND THE BENCH MAY PLAY THE ACTUAL INSTRUMENT. This is the only place in
    // the codebase that sets `sampleName`, which is what keeps the named
    // recordings on the bench's side of the wall: a derived people's bodies
    // have no names, so they can never look one up and will always play the
    // family recording or the model. Naming it here is the same kind of pinned
    // INPUT as the scale and the metre — it is what a takht is made of — and
    // it is what lets a wrong-sounding bench prove the fault is the composer's
    // rather than the synthesis's.
    inst.sampleName = s.label;
    if (s.cap != null) inst.cap = s.cap;
    inst.weight = s.weight ?? 1;
    inst.raw = inst.weight;
    if (s.symp) inst.symp = true;
    inst.skill = 0.92;                       // a named tradition is played by people who know it
    inst.craft = 0.92;
    return inst;
  });

  // ── the tuning ──
  const frameC = T.frame;
  const degrees = T.scale.map(c => ({
    ratio: R(c), cents: c, prom: promOf(c, frameC), found: true,
  }));
  m.scale = {
    degrees,
    frame: { ratio: R(frameC), cents: frameC, prom: 1 },
    curve: m.scale && m.scale.curve ? m.scale.curve : { xs: new Float64Array(0), ys: new Float64Array(0) },
    minima: [], range: 1,
    derivedBy: "pinned",
    tetErr: degrees.reduce((s, d) => s + Math.abs(d.cents - Math.round(d.cents / 100) * 100), 0) / degrees.length,
  };

  // ── the mode ──
  const idx = T.mode.map(c => {
    let bi = 0, bd = Infinity;
    T.scale.forEach((sc, i) => { const d = Math.abs(sc - c); if (d < bd) { bd = d; bi = i; } });
    return bi;
  });
  const modeCents = idx.map(i => T.scale[i]);
  // A PINNED TRADITION'S HOME IS PART OF THE ANSWER.
  //
  // `finalsOf` ranks a mode's members by how much of the mode already lives in
  // each one's own harmonic series, and `finalFor` then hands a working day
  // the brightest of them and a rite the darkest. That is exactly right for a
  // DERIVED people — rotating the final is the lever real traditions use for
  // affect, and the pitches do not change.
  //
  // It is exactly wrong for a pinned one. A maqām rotated onto a different
  // degree is a different maqām; a rāg played from its fifth is a different
  // rāg. Every entry in this table has always declared a `finalIdx` and this
  // function has never read it, so the bench spent its whole life playing
  // Ḥijāzkār from wherever the roughness curve found brightest — measured just
  // now, five of the seven entries came out rotated, which is five of them
  // testing something other than what they say they are.
  const fi = Math.max(0, Math.min(idx.length - 1, T.finalIdx ?? 0));
  const ranked = finalsOf(modeCents, frameC);
  m.mode = {
    idx, cents: modeCents, size: idx.length,
    steps: modeCents.slice(1).map((c, i) => c - modeCents[i]).concat([frameC - modeCents[modeCents.length - 1]]),
    // one candidate, so every occasion resolves to it
    finals: [ranked.find(x => x.f === fi) || { f: fi, bright: 0 }],
  };

  // ── metre, texture, line ──
  Object.assign(m.rhythm, T.rhythm);
  Object.assign(m.texture, T.texture);
  Object.assign(m.melody, T.melody);
  // MODE INDICES, not objects — the same shape musicGenome builds, because
  // sectionsOf uses them directly as a step offset and an object silently
  // becomes NaN two calls later.
  m.melody.structural = idx
    .map((si, mi) => ({ mi, prom: degrees[si].prom }))
    .sort((a, b) => b.prom - a.prom)
    .slice(0, Math.max(2, Math.round(idx.length * 0.5)))
    .map(r => r.mi);
  m.cap = Math.max(...m.insts.map(i => i.cap));
  m.pull = 0;                                // a pinned tuning is not regularised toward anything
  m.tradition = { key, ...T };
  m.people.name = T.label;
  return m;
}
