# Music

A people's music, derived. Nothing on this page picks a scale, a metre or an
instrument: the land decides what can be built, the physics of those bodies
decides which intervals sound consonant, and the language they speak decides
how the rhythm moves. Same standing as the Language Lab and the emblem engine
— **the sim stays silent**; this derives on demand and the world never calls it.

Modules: `src/sim/musicInstruments.js`, `musicTuning.js`, `musicGenome.js`,
`musicCompose.js`, `musicSynth.js`, `musicRefs.js`. Lab: `src/musicLab.js`,
`musiclab.html`, `tools/build_musiclab.mjs`.

## The chain

```
biome + geology + crafts → MATERIALS  →  BODIES  →  SPECTRA  →  roughness minima  →  SCALE
language prosody         → RHYTHM
surplus + stratification → TEXTURE
literacy                 → FORM
world state right now    → OCCASION
```

### Tuning is the spine

The one piece that had to be right. No culture is handed a scale. Each is
handed instruments, and a scale is *discovered* in them: two tones sound rough
when their partials beat, so the intervals where roughness is least are what a
people finds consonant and builds from. The roughness model is Plomp &
Levelt's measured curve in Sethares' parametric form — its constants are fits
to **human listening data**, not to any musical outcome, which is exactly what
makes them legitimate here. They describe the ear, and the ear is the same
everywhere in this world.

The mode ratios are standard physics, not parameters:

| body | series |
|---|---|
| ideal string, open pipe | `n` — full harmonic series |
| stopped pipe | `2n−1` — odd harmonics only |
| free–free bar (xylophone, metallophone) | 1 : 2.756 : 5.404 : 8.933 |
| clamped–free bar (plucked tongue) | 1 : 6.267 : 17.55 |
| circular membrane (drum) | 1 : 1.593 : 2.135 : 2.295 |
| flat plate (gong) | 1 : 2.08 : 3.41 : 3.89 : 5.00 |
| bell profile | 0.5 : 1 : 1.2 : 1.5 : 2 |

Stiff strings follow `f_n = n·f1·√(1+B n²)`; `B` is a property of the wire.

What falls out, with nothing named anywhere in the code:

- Harmonic bodies (strings, pipes, voice) put partials at integer multiples,
  so roughness bottoms out at simple ratios. Such peoples derive **316¢, 387¢,
  499¢, 703¢, 884¢** — a minor third, major third, fourth, fifth and major
  sixth, within a cent or two of just intonation.
- A tradition whose tuning reference is struck metal has an **inharmonic**
  spectrum, so its minima are elsewhere and the interval it repeats at may not
  be an octave: measured frames of **1164¢, 1268¢, 870¢** turn up on their own.
- A **stopped pipe** has no even harmonics, so its octave is barely a dip at
  all — a real acoustic fact, and such a people's frame lands somewhere else.

Three mechanisms complete it:

1. **Capacity.** A six-hole pipe cannot play a twelve-note scale. Scale size
   is bounded by the widest-range body a people can build, which is what keeps
   simple-instrument cultures pentatonic without anyone deciding they should be.
2. **The tuning reference is one instrument.** An ensemble tunes to what
   *cannot* be adjusted mid-performance — a cast bar set, a founded bell.
   Flutes are lipped, strings stopped, voices follow. So the fixed-pitch core
   dominates what the tradition counts as consonant.
3. **Where timbre gives no guidance, makers measure.** A body whose modes are
   few and very high is close to a pure tone, and pure tones are equally smooth
   almost everywhere. A people in that position cannot hear its way to a scale,
   so it does the other thing makers do — divides its frame into even steps.
   Equidistant tunings are what turn up where timbre stops constraining; the
   Lab labels each degree *heard* or *measured*.

### Rhythm comes out of the language

A culture's music inherits the durational unevenness of its speech. This is a
measured cross-linguistic result, so the Lab **measures it back out** rather
than asserting it: nPVI is computed the same way on the language's own syllable
durations (exactly those the speech engine schedules) and on the generated
music. Across 80 generated peoples:

| speech rhythm | speech nPVI | music nPVI |
|---|---|---|
| syllable-timed | 5.1 | 38.8 |
| even | 4.8 | 34.9 |
| stress-timed | 34.0 | 78.0 |

### Everything else

- **Instrumentarium** — a body is buildable when its material is in reach and
  the craft gates pass. Material choice is by *role*: a tube's material barely
  changes its spectrum so pipes get made of whatever is nearest, while a struck
  idiophone is nothing but its material's ring, so metal is spent there and
  nowhere else. A stratified society spends on display, so the same cane pipe
  is silver at a court and cane in a village.
- **Tradition breadth** — being able to build a body is not keeping one. Every
  instrument type in living use needs makers and players, and both are
  specialists somebody has to feed, so breadth scales with surplus and town
  life. A tradition is a handful of instruments, not a museum.
- **Texture** — ensemble size is a surplus question before it is a musical one.
  Monophony → drone → heterophony → polyphony, the last needing literacy.
- **Form** — memory builds from formula and returns to it; notation buys long
  structure that can leave its opening idea and not come back.
- **Melody** — structural degrees are the ones the roughness curve itself
  ranked most consonant. Phrases descend because subglottal pressure falls
  across a breath (the same declination the speech engine applies to f0), and
  a breath bounds a phrase where a string does not. A tone language cannot set
  a syllable against its own lexical tone.
- **Occasion** — everyday, rite, war, mourning, festival, work. In the world
  sim these are all live state (war level, food balance, offerings at a holy
  see, a coronation), which is what would make an ambient layer quietly
  informative rather than merely atmospheric.

## Synthesis

Every voice is built from the **same partial list that decided the tuning**, so
the causal chain is audible. Near-harmonic bodies render as one PeriodicWave
oscillator carrying the measured partial amplitudes, with a falling lowpass for
the faster damping of high modes; inharmonic bodies render as a bank of sines,
one per mode, each with its own decay — there is no other honest way, since
their partials are not a series. Onset transients (mallet click, pluck, breath
chiff) carry most of the realism. The sung voice reuses the measured human
vowel formants the Language Lab's voice was calibrated against, so a people
sings in its own tongue with the same mouth the speech engine uses.

Nothing is sampled. The page carries no audio assets.

## Reference endowments

`musicRefs.js` pins six traditions — but pins their **inputs**, not their
music. Writing down "this tradition uses a five-note non-octave scale" would
be fitting the outcome and would prove nothing. Instead a bronze-casting delta
gets its metals, crafts, court and literacy; steppe herders get hide, horn, no
metals worth casting and no surplus for more than three players. What comes out
is genuinely derived, and the bronze-casters land somewhere alien from the
pipe-makers on their own. Scenario data of exactly the kind the repo already
sanctions (pinned inventories, the Earth hearth set): the world is fixed, the
mechanism still runs.

## If this were ever wired into the sim

It is not, and this document does not propose that it should be. If it were,
the shape is the emblem plan's: derive on demand from seeds, keep the pass
read-only over mechanics so `validate` stays bit-identical, and let instrument
adoption ride the same contact edges `borrowFrom` already walks. The ambient
layer would read the dominant culture of whatever is in view, blending by
`culMix` — so a border town's music is literally an admixture of two traditions,
which is what the Lab's border control already demonstrates.
