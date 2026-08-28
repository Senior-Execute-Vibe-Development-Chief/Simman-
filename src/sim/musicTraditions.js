// ── Eleven real traditions, as a BENCH ────────────────────────────────────
//
// `musicRefs.js` pins the INPUTS a tradition had and lets the engine derive
// the rest, which is the right way to check a generator against reality. This
// file does the opposite on purpose, and it is important to say why that is
// not a cardinal-rule violation.
//
// These are not the generator. Nothing here runs when a people is founded, no
// derived people can reach this table, and no constant in it feeds back into
// musicGenome, musicTuning or musicCompose. They are a KNOWN-ANSWER TEST: the
// tuning, the ensemble, the metre and the texture of traditions that actually
// exist, written down from measurement, so that the synthesis and the composer
// can be heard playing something whose right answer is known.
//
// AND EACH ONE HAS TO TEST SOMETHING THE OTHERS DO NOT. A bench of five
// melodic string-and-pipe traditions is a bench with a hole in it, and this one
// had one: the code cites gamelan, slendro, pelog, colotomic form and ombak
// twenty times, and West African drumming, claves and timelines ninety-seven
// times, as the reasons its mechanisms work the way they do — with no entry for
// either. Those two are now here, and with them the cases nothing covered: an
// equal temperament with functional harmony over it, a twelve-beat compás, an
// ensemble carrying essentially ONE pitch, and tuned steel.
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
    label: "Highland pipes",
    gloss: "the measured pipe scale — neither just nor equal — over a fixed drone",
    // TWO CELTIC ENTRIES WERE ONE TRADITION TWICE. The other held an idealised
    // just Mixolydian on the identical five instruments, and with a common
    // practice entry now in the table the plain diatonic is covered. What only
    // this one has is a REAL MEASURED TUNING that is neither just nor equal:
    // the Highland chanter's third sits at 341 cents and its seventh at 1010,
    // both far enough off the twelve-tone grid (41 cents at the worst) to be
    // audibly its own thing rather than a rounding of anybody else's.
    frame: 1200,
    scale: [0, 197, 341, 495, 700, 890, 1010],
    mode: [0, 197, 341, 495, 700, 890, 1010],
    finalIdx: 0,
    insts: [
      { fam: "reedPipe", mat: "reed", label: "chanter", cap: 9, weight: 1.0, role: "lead" },
      { fam: "reedPipe", mat: "reed", label: "drones", cap: 1, weight: 0.9, role: "drone" },
      { fam: "bowed", mat: "gut", frame: "wood", label: "fiddle", cap: 14, weight: 0.8 },
      { fam: "fluteOpen", mat: "iron", label: "whistle", cap: 8, weight: 0.6 },
      { fam: "frameDrum", mat: "hide", frame: "wood", label: "bodhrán", cap: 1, weight: 0.4, role: "pulse" },
    ],
    rhythm: { tempo: 116, meterKind: "duple", beats: 4, div: 2, density: 0.72, syncopation: 0.2, swing: 0.12 },
    texture: { kind: "drone", size: 4, ornament: 0.85, sustains: true, courtly: 0.15 },
    melody: { step: 0.8, arch: 0.36, descent: 0.45, breathBound: true, toneBound: false, reach: 9 },
    note: "A bagpipe cannot be stopped, tongued or dynamically shaded: every note is the same loudness and the line is articulated by grace notes alone, which is why the ornament figure is the highest on the bench. The chanter reed is modelled as a conical reed pipe, which it is.",
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

  gamelan: {
    label: "Javanese gamelan — pélog",
    gloss: "tuned bronze, a scale that is nobody else's, and a cycle marked by gongs",
    // THE ENTRY THIS ENGINE MOST NEEDED. Its comments cite slendro, pélog,
    // colotomic form and ombak as the reasons half its mechanisms exist — the
    // inharmonic tuning path, the non-octave frame, the nested `marks` — and
    // there was nothing to check any of it against.
    //
    // Pélog is the case no derived people and no other bench entry produces: a
    // seven-tone scale whose degrees sit BETWEEN the cracks of every grid, up
    // to 88 cents off equal temperament, and which differs audibly from one
    // gamelan to the next because each set is tuned as a set and to itself.
    // These are near the Central Javanese averages. Nothing about them is just,
    // and that is not an error to be corrected — it is what a scale looks like
    // when it is derived from bronze bars whose partials are 1 : 2.756 : 5.404.
    frame: 1200,
    scale: [0, 120, 258, 539, 675, 785, 1088],
    // a pathet uses five of the seven; the other two are there and are avoided
    mode: [0, 120, 539, 675, 785],
    finalIdx: 0,
    insts: [
      { fam: "barSet", mat: "bronze", frame: "wood", label: "saron", cap: 7, weight: 1.0, role: "lead" },
      { fam: "bell", mat: "bronze", frame: "wood", label: "bonang", cap: 10, weight: 0.85 },
      { fam: "barSet", mat: "bronze", frame: "wood", label: "gendèr", cap: 13, weight: 0.8 },
      { fam: "gong", mat: "bronze", frame: "wood", label: "gong ageng", cap: 1, weight: 0.7, role: "mark" },
      { fam: "barSet", mat: "wood", frame: "wood", label: "gambang", cap: 17, weight: 0.5 },
      { fam: "drum", mat: "hide", frame: "wood", label: "kendang", cap: 3, weight: 0.6, role: "pulse" },
      { fam: "fluteOpen", mat: "bamboo", label: "suling", cap: 6, weight: 0.4 },
    ],
    rhythm: { tempo: 68, meterKind: "duple", beats: 8, div: 2, density: 0.5, syncopation: 0.05, swing: 0 },
    texture: { kind: "heterophony", size: 6, ornament: 0.4, sustains: true, courtly: 0.85 },
    melody: { step: 0.7, arch: 0.38, descent: 0.5, breathBound: false, toneBound: false, reach: 10 },
    note: "The bonang is a rack of kettle gongs, taken here as a tuned bell set because that is the nearer physical model — a kettle is a plate closed into a shell, not a bar. Ombak, the beating between deliberately mistuned pairs, is in the synthesis but not in this table: it is a property of how a set is tuned, not of the scale.",
  },

  westAfrican: {
    label: "West African ensemble",
    gloss: "an iron bell holds the cycle, everything else interlocks against it",
    // THE OTHER ENTRY THIS ENGINE KEPT CITING AND NEVER HAD. `drumEnsemble`,
    // the clave and timeline machinery and the comment naming "the organising
    // principle of West African drumming" were all written with nothing to
    // check them against.
    //
    // What it tests that nothing else does: a composite where no single player
    // is playing the pattern you hear, a metre that is felt in 12 against 4,
    // and an ensemble whose fixed reference is a BELL rather than a melody
    // instrument — the timeline everybody else counts from.
    //
    // The tuning is the Mande balafon's, which is close to an equal division of
    // the octave into seven. That is a genuinely different answer from every
    // other scale here: no just ratios, no semitones, seven steps of about 171
    // cents each, and it comes from the same place pélog does — bars, tuned as
    // a set, by ear, to themselves.
    frame: 1200,
    scale: [0, 171, 343, 514, 686, 857, 1029],
    mode: [0, 171, 343, 514, 686, 857, 1029],
    finalIdx: 0,
    insts: [
      { fam: "barSet", mat: "wood", frame: "gourd", label: "balafon", cap: 18, weight: 1.0, role: "lead" },
      { fam: "lamella", mat: "iron", frame: "gourd", label: "kalimba", cap: 9, weight: 0.7 },
      { fam: "clappers", mat: "iron", label: "gankogui", cap: 2, weight: 0.9, role: "pulse" },
      { fam: "drum", mat: "hide", frame: "wood", label: "djembe", cap: 3, weight: 0.85 },
      { fam: "drum", mat: "hide", frame: "wood", label: "dundun", cap: 2, weight: 0.7 },
      { fam: "rattle", mat: "gourd", label: "shekere", cap: 1, weight: 0.5 },
    ],
    // twelve pulses felt as four — the compound metre the engine's timelines
    // were written for and have never been asked to carry
    rhythm: { tempo: 108, meterKind: "compound", beats: 4, div: 3, density: 0.9, syncopation: 0.72, swing: 0 },
    texture: { kind: "polyphony", size: 6, ornament: 0.35, sustains: false, courtly: 0.05 },
    melody: { step: 0.62, arch: 0.34, descent: 0.5, breathBound: false, toneBound: false, reach: 12 },
    note: "A kora would be the melodic body of a Mande ensemble and there is no harp-lute in this engine; the balafon leads instead, which is the other one. The gankogui is a double iron bell taken as clappers — two struck iron bodies of different pitch, which is what it is.",
  },

  european: {
    label: "European common practice",
    gloss: "equal temperament, and the one texture this engine does not write",
    // THE ENTRY THAT IS EXPECTED TO FAIL, and is here for that reason.
    //
    // Everything else on this bench is heterophonic or monophonic — one line,
    // however many versions of it. Common practice is neither: it is
    // FUNCTIONAL HARMONY, independent voices moving so that their vertical
    // intervals resolve, and `ensembleFor` says in as many words that
    // independent lines are beyond what this composer writes. So this entry
    // will come out as a heterophonic quintet on a diatonic scale, which is
    // Palestrina played by a gamelan.
    //
    // That is worth having written down. A bench exists to make a missing
    // mechanism audible rather than arguable, and the missing one here is
    // voice-leading. It also supplies the only equal temperament in the table,
    // which is the reference every other tuning is measured against.
    frame: 1200,
    scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    mode: [0, 200, 400, 500, 700, 900, 1100],
    finalIdx: 0,
    insts: [
      { fam: "bowed", mat: "gut", frame: "wood", label: "violin", cap: 16, weight: 1.0, role: "lead" },
      { fam: "bowed", mat: "gut", frame: "wood", label: "cello", cap: 14, weight: 0.8 },
      { fam: "fluteOpen", mat: "iron", label: "flute", cap: 12, weight: 0.7 },
      { fam: "reedPipe", mat: "reed", label: "oboe", cap: 12, weight: 0.65 },
      { fam: "horn", mat: "bronze", label: "horn", cap: 8, weight: 0.6 },
      { fam: "struckString", mat: "iron", frame: "wood", label: "harpsichord", cap: 24, weight: 0.75 },
    ],
    rhythm: { tempo: 96, meterKind: "duple", beats: 4, div: 2, density: 0.7, syncopation: 0.12, swing: 0 },
    texture: { kind: "polyphony", size: 5, ornament: 0.3, sustains: true, courtly: 1.0 },
    melody: { step: 0.72, arch: 0.5, descent: 0.5, breathBound: false, toneBound: false, reach: 12 },
    note: "Equal temperament is given as the twelve, with a major mode drawn from it, because that is what the instruments are built to and what the repertoire modulates through. The failure to expect is vertical: this engine writes one line in several versions, and common practice is several lines in one harmony.",
  },

  flamenco: {
    label: "Flamenco",
    gloss: "the Andalusian cadence, a twelve-beat compás, and hands",
    // Phrygian dominant, which shares its lower half with Ḥijāzkār and parts
    // from it at the seventh — a flat one here against a leading tone there.
    // That is deliberate: the two entries sound related because they ARE, and
    // what separates them on this bench is not the scale but everything else.
    // A takht is six built bodies playing a slow modal line; this is one
    // guitar, two pairs of hands and a box, at speed, over a metre nothing else
    // in the table has.
    frame: 1200,
    scale: [0, 112, 386, 498, 702, 814, 996],
    mode: [0, 112, 386, 498, 702, 814, 996],
    finalIdx: 0,
    insts: [
      { fam: "luteNeck", mat: "gut", frame: "wood", label: "guitarra", cap: 20, weight: 1.0, role: "lead" },
      { fam: "claps", mat: "none", label: "palmas", cap: 1, weight: 0.8, role: "pulse" },
      { fam: "drum", mat: "wood", frame: "wood", label: "cajón", cap: 2, weight: 0.7 },
      { fam: "clappers", mat: "wood", label: "zapateado", cap: 1, weight: 0.5 },
    ],
    // COMPÁS: twelve beats accented 3 6 8 10 12, which is neither a duple nor a
    // compound metre but an additive one. The engine has no additive metre, so
    // this is given as twelve in three and the accent pattern is what the
    // syncopation figure has to carry — another gap this entry makes audible.
    rhythm: { tempo: 132, meterKind: "compound", beats: 4, div: 3, density: 0.82, syncopation: 0.68, swing: 0.06 },
    texture: { kind: "heterophony", size: 3, ornament: 0.8, sustains: false, courtly: 0.1 },
    melody: { step: 0.7, arch: 0.42, descent: 0.7, breathBound: false, toneBound: false, reach: 11 },
    note: "Palmas are two pairs of hands playing different patterns, not one; the engine's percussion section gives them separate parts, which is the right shape. Rasgueado, golpe and the guitar's percussive use of its own top are not modelled — this is the nylon-strung lute playing notes.",
  },

  aboriginal: {
    label: "Aboriginal Australian",
    gloss: "one pitch, and everything else in timbre and rhythm",
    // THE EXTREME CASE, and the reason to have it is that the engine has
    // almost nothing to do. A didgeridoo is a lip-driven natural tube: it
    // sounds its fundamental continuously and can be overblown to one "toot"
    // roughly a tenth above, and that is the whole pitch inventory. Everything
    // a listener follows is articulation — the tongue, the cheeks, the voice
    // hummed through the drone, the breath cycled in through the nose — over
    // clapsticks keeping a fixed pulse.
    //
    // So this entry asks what happens to a melodic engine when there is no
    // melody. If it produces a line, the line is invented; if it produces a
    // drone with rhythm on it, the mechanisms are honest about their inputs.
    frame: 1200,
    scale: [0, 386],
    mode: [0, 386],
    finalIdx: 0,
    insts: [
      { fam: "horn", mat: "wood", label: "didgeridoo", cap: 2, weight: 1.0, role: "drone" },
      { fam: "clappers", mat: "wood", label: "clapsticks", cap: 1, weight: 0.9, role: "pulse" },
    ],
    rhythm: { tempo: 104, meterKind: "duple", beats: 4, div: 2, density: 0.95, syncopation: 0.35, swing: 0 },
    texture: { kind: "drone", size: 2, ornament: 0.9, sustains: true, courtly: 0 },
    melody: { step: 0.95, arch: 0.2, descent: 0.4, breathBound: false, toneBound: false, reach: 2 },
    note: "Circular breathing means the drone never stops, and the engine has no way to say that — a sustained body here still articulates note by note. The vocalised overtones and the formant work that carry the music are not modelled at all. This entry is a measurement of what is missing more than a rendering of the tradition.",
  },

  caribbean: {
    label: "Trinidadian steel band",
    gloss: "tuned oil drum, in equal temperament, over an iron",
    // Tuned steel: a pan note is an area of a stretched steel dish, hammered so
    // that its octave and twelfth are tuned INTO it. That makes it the one body
    // on this bench whose partials were deliberately put in harmonic relation
    // by a maker rather than being a property of the shape — the opposite
    // procedure to a gamelan's, on the same material, and it is why a pan reads
    // as pitched where a gong does not.
    //
    // It also plays equal temperament, so the pair with `european` isolates
    // exactly one variable: same tuning, entirely different bodies and metre.
    frame: 1200,
    scale: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
    mode: [0, 200, 400, 500, 700, 900, 1000],
    finalIdx: 0,
    insts: [
      { fam: "barSet", mat: "iron", frame: "iron", label: "tenor pan", cap: 29, weight: 1.0, role: "lead" },
      { fam: "barSet", mat: "iron", frame: "iron", label: "double second", cap: 22, weight: 0.85 },
      { fam: "barSet", mat: "iron", frame: "iron", label: "cello pan", cap: 12, weight: 0.7 },
      { fam: "clappers", mat: "iron", label: "iron", cap: 1, weight: 0.8, role: "pulse" },
      { fam: "drum", mat: "hide", frame: "wood", label: "congas", cap: 3, weight: 0.6 },
      { fam: "rattle", mat: "iron", label: "shak-shak", cap: 1, weight: 0.4 },
    ],
    rhythm: { tempo: 124, meterKind: "duple", beats: 4, div: 2, density: 0.85, syncopation: 0.6, swing: 0.05 },
    texture: { kind: "heterophony", size: 5, ornament: 0.3, sustains: false, courtly: 0.1 },
    melody: { step: 0.68, arch: 0.44, descent: 0.5, breathBound: false, toneBound: false, reach: 14 },
    note: "A pan is taken as a struck bar set in iron, which gets the material and the definite pitch right and the geometry wrong: a bar is free at both ends and a pan note is a region of a dish under tension from every side. The flat seventh in the mode is the calypso one, not a modal accident.",
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

  // A PINNED TRADITION NAMES ITS OWN LEAD, through the weights in its table,
  // and the reference-leads rule must not second-guess it: Chinese court music
  // really does tune to bells and play the melody on silk, and that split is
  // the answer rather than a fault to be corrected.
  m.tuneRef = null;

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
  // ANYTHING MEMOISED ON THIS PEOPLE WAS COMPUTED FROM THE MODE THEY HAD
  // BEFORE, and this function has just replaced it. `affectOf` reads the mode's
  // steps, `occasionFor` reads `affectOf`, `phraseBank` reads both, and
  // `signatureOf` reads the mode — every one of them caches on the object. A
  // tradition applied after any of those had run would be played with the
  // derived people's character on the pinned people's scale.
  for (const k of Object.keys(m)) {
    if (k === "_affect" || k === "_sig" || k.startsWith("_occ:") || k.startsWith("_bank:")) delete m[k];
  }
  return m;
}
