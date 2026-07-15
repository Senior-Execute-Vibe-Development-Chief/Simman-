# Vocalizer handoff — read this before touching the Lab's voice

**Status: the articulatory voice produces recognizable but artifact-laden
speech. The user is not happy with it yet. The most recent commit made it
WORSE by the user's ear — see "Start here."**

Branch: `claude/vocalizer-research-hab0si`. Published artifact (the "gen" the
user listens to): `https://claude.ai/code/artifact/b022cac6-131a-4ee5-8af8-eeff67d216e7`.

---

## Start here (the two things that matter most)

1. **The last commit regressed.** `b23c4b9` ("Fix the 'chops': continuous
   voicing across syllables + softer bursts") — the user's verdict after it was
   simply **"its worse."** The change is conceptually right (real speech flows
   across syllable boundaries instead of falling to silence at each seam), so
   it probably *exposed* something it used to mask (bad vowel→vowel
   coarticulation, or ringing that the inter-syllable silence used to reset).
   **First move: `git revert b23c4b9` (or `git checkout 0aa52ca -- src/sim/vocalTract.js`)
   to get back to the last state the user called "converging," then decide
   deliberately whether to redo continuous voicing more carefully.**

2. **This environment cannot play audio.** Every change so far was tuned
   BLIND — via Node measurements (`tools/voice.mjs`) and slow round-trips where
   the user listens and reports back. The measurements *repeatedly disagreed
   with perception*: sustained vowels measure clean (pure harmonics, correct
   formants) while the user hears "chops and squeaks"; formant scans reported
   "0 glitches" while the user heard glitches. **The single highest-leverage
   change you can make is to get an ear on the actual output** — run it locally
   (`npm run dev` → open `/langlab.html`, click the phoneme grid and word ▶
   buttons in the Sound card) and listen while you tune. If you also can't
   hear, expect the same slow, non-monotonic progress we had.

---

## What the voice is (architecture)

There are **two** synth engines behind an A/B toggle in the Lab's Sound card
(`S.voice`, radio buttons: "articulatory tract" = default, "formant sketch").

### Engine 1 — the articulatory vocal tract (default, the one under scrutiny)
`src/sim/vocalTract.js` (~590 lines). Pure, dependency-free, deterministic
(seeded noise), Node-importable. A Kelly–Lochbaum digital-waveguide vocal tract
(Pink-Trombone-style) rendered **offline into a buffer**, so the exact DSP runs
headless under Node.

- `makeGlottis(sr)` — LF (Liljencrants–Fant) glottal source. State: `freq`,
  `tenseness` (voice quality / open-quotient; higher = pressed, lower =
  breathy), `intensity` (0..1 voicing envelope), `loudness`. `g.step(noise)`
  returns one source sample.
- `makeTract()` — the tube. N=44 sections, glottis at 0, lips at 43, a nasal
  branch at section 17. **Passive pressure-junction scattering** (node pressure
  = area-weighted mean of incoming waves, `out = P − in`) — chosen because the
  Kelly one-multiply form blew up at the nasal 3-port. `shape(posture)` builds
  the area function from a tongue + constriction; `step(glottal, turb, lambda,
  noise, params, lipOut)` runs one tick (called **twice per output sample**);
  `commit()` swaps the area double-buffer. Stability layers (each was needed to
  stop a real blow-up/NaN, do not remove casually): per-section `wall` loss
  keyed to the **narrowest area in a ±2 neighbourhood** (damps the tiny high-Q
  cavity that forms beside a closure), a per-section one-pole **HF loss**
  (`DSP.hf`), and a **soft tanh clamp** at ±`MAXW`.
- `renderScore(score, sampleRate, seed)` — renders a `{dur, tracks}` score.
  **Renders at a fixed INTERNAL 44100 Hz then linearly resamples** to
  `sampleRate` (so formants don't pitch up ~9% on a 48 kHz browser). Output
  chain: DC-block → **compressor** (env-follower toward `TARGET`, with a smooth
  downward-expander "gate" to hush inter-segment silence) → **linear** in the
  normal range, soft-limit only true peaks → resample.
- **Gesture-scoring layer** (feature → time-varying tract controls): `scorePlan`,
  `scoreClause` build the score; `scoreWord` → `scoreCons` / `scoreVowel`;
  `vowelPosture(v)` maps vowel features → tongue index/diameter + constriction +
  lip + velum; `layF0` lays pitch. **Tracks** (all `{t,v}` breakpoint lists,
  linearly interpolated): `frequency, tenseness, intensity, tongueIndex,
  tongueDiameter, constrIndex, constrDiameter, fricative, aspiration, velum,
  lip`. This layer — not the DSP — is where "coarticulation," timing, bursts,
  and the chops live. **The regressing commit changed `scoreWord` here.**

### Engine 2 — the formant sketch (the OTHER toggle option; under-evaluated)
Lives in `src/langLab.js` (`speakPlanFormant` / `scheduleWord` / `vVoiced`). A
classic source–filter synth: an LF glottal-flow-derivative `PeriodicWave`
(replaced the old buzzy sawtooth — commit `cd91fde`) through three bandpass
formants, built with live Web-Audio nodes. **The user never clearly rated
this.** It has no waveguide instabilities by construction, so it may be cleaner.
It cannot be rendered offline in Node (it's live Web-Audio), so you can only
judge it in a browser.

### Wiring & tooling
- `src/langLab.js` — the Lab UI. Imports the tract module. `speakPlanTract` /
  `speakClauseTract` render offline → `AudioBuffer` → play. The Sound-card
  toggle dispatches on `S.voice`.
- `tools/voice.mjs` — Node harness. `node tools/voice.mjs` prints F0 + formants
  (decimate→LPC) and vowel-space checks; `node tools/voice.mjs --wav DIR` dumps
  demo WAVs. **Runs at 48 kHz to match browsers.**
- `tools/build_langlab.mjs` — bundles the whole Lab into one self-contained HTML
  with esbuild. `node tools/build_langlab.mjs --artifact OUT` emits the
  body-only form used to (re)publish the artifact.

---

## Current DSP settings (as of the regressing commit)
`src/sim/vocalTract.js`:
```
const DSP = { glottalRefl: 0.9, damp: 0.997, radiation: 0.8,
              wallLoss: 1.3, wallThresh: 0.03, hf: 0.92 };
const F0_BASE = 105;   // base pitch (Hz)
const MAXW = 24;       // soft-clamp ceiling
// compressor: TARGET 0.22, FLOOR 0.085, attack 4 ms, release 90 ms
```
Rough intuition from the sweeps we ran:
- `hf` (per-section HF loss) is the big timbre/stability lever. **Lower ≈ warmer
  + more stable + duller ("mushy"); higher ≈ brighter + more glitch-prone
  ("high").** 0.82 was "mushy," 1.0 (off) was "high/glitchy," 0.92 is the
  current compromise.
- `wallLoss`/`wallThresh` (neighbourhood closure damping) is what let us kill
  the velar/uvular ring-up glitches *locally* without dulling everything — keep
  it.
- `damp` mostly sets formant bandwidth; formant *positions* were stable across
  0.99–0.9996 in sweeps.

---

## User-feedback trajectory (verbatim, chronological)
1. first tract version → *"i just hear wet very high pitched noises, with some
   lower vibrations."*
2. + level-management/compressor + tamed bursts → *"still wet and high and
   weird, but slightly better, more understandable."*
3. + warmer/lower (F0 118→105, less aspiration, output LP) + rate-independent
   formants → *"sounds a bit better in the gen, but still a bit high at points
   and glitchy. the wavs you sent me sound fine."*  ← note: WAVs fine, gen not.
4. + frequency-dependent (HF) loss killing velar/nasal glitches → *"the whole
   thing sounds glitchy and off. can we maybe find an outsourced vocalizer?"*
5. showed eSpeak-ng samples → *"ours sounds more like what i want. can you maybe
   do a bit more work on it? take some inspiration from espeak."* ← **user
   prefers our synth over eSpeak; do not silently swap to eSpeak.**
6. + dropped pervasive tanh distortion, softer gate, cleaner source → *"its
   definitely THERE, just under layers of weird chops and medium toned squeak
   noises, like kicking a rubber shoe on a gym floor, but slightly lower."*
7. + continuous voicing across syllables + softer bursts (`b23c4b9`) → **"its
   worse."**

**Read the arc honestly:** each artifact had a findable cause and we fixed it,
but the perceptual result never crossed into "good," and step 7 went backwards.
The approach may be near its ceiling *without an ear in the loop*.

---

## The open problems, most to least understood
- **"medium toned squeak" (rubber-shoe-on-gym-floor, slightly lower)** — the
  headline unknown. NOT present in sustained vowels (they measure as clean pure
  harmonics — verified via FFT: all peaks land on F0 multiples, subharmonic
  <3%). So it lives in **connected speech / transitions / consonants**, exactly
  where offline single-phoneme analysis is weakest. Prime suspects to probe
  next: fast formant transitions between very different postures (a swept
  resonance = a chirp/squeak); the constriction resonances of `/u/ /o/`, glides,
  laterals, rhotics; voiced fricatives; and the linear **resampler** (44100→
  output) leaving imaging artifacts. Ask the user *when* it happens.
- **"chops"** — partly the syllable-seam silence (removed in the regressing
  commit, which then made things worse — investigate the coarticulation it
  exposed). Also: voiceless-stop closures create real silence gaps; if a word
  has several stops it will still have several gaps.
- **`/u/`,`/o/` are ~3–4× peakier** than open vowels (sharp resonant peaks from
  the velar constriction; the envelope compressor doesn't catch the fast peaks).
  Their formants are actually correct (FFT shows low F1/F2), but they read
  loud/peaky.
- **General synthetic/"off" quality** — inherent to procedural synthesis of
  arbitrary phoneme inventories to some degree; the bar is "recognizable,
  distinguishable, not-annoying," not natural TTS.

## Traps we already fell into (don't repeat)
- Trusting the LPC formant estimator too much — it flip-flops with seed, sample
  rate, and window, and reported `/u/` F2 as both 780 Hz and 3900 Hz. Use a
  direct FFT and look at where energy actually is.
- "0 glitches in the scan" ≠ "clean to a listener." Our scans key on
  high-frequency energy; the squeak and chops slipped right through.
- Adding a global fix (e.g. strong HF low-pass) to squash a *local* problem
  dulled everything ("mushy"). Prefer local/targeted damping.

---

## How to work on it (practical)
- **Measure / sanity:** `node tools/voice.mjs`
- **Dump WAVs:** `node tools/voice.mjs --wav /tmp/out` (vowels, syllables, mala,
  kitanu, a clause). To render *real generated words*, found a language and call
  `phoneticPlan(lang, nativeStemOf(lang, lex.KING))` → `renderScore(scorePlan(
  plan), 48000)` → write a WAV (see the throwaway scripts in git history /
  session, or `foundLanguage(world,{seed:8817})`; test words used: nipaba (king),
  wani (mountain), unna (river), ya (stone), ibi (mother), ti (water)).
- **Browser smoke test the bundle:** `playwright-core` is installed `--no-save`;
  Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Bundle with
  `node tools/build_langlab.mjs OUT.html`, load `file://OUT.html`, check for
  console/page errors and that `.spk` / `[data-p]` render and click cleanly.
- **Rebuild + republish the artifact:** `node tools/build_langlab.mjs --artifact
  /tmp/langlab-artifact.html`, then the `Artifact` tool with
  `url: https://claude.ai/code/artifact/b022cac6-131a-4ee5-8af8-eeff67d216e7`
  (same file path in one session redeploys; the URL param targets it from a new
  session). **Heads-up:** the Artifact publish tool frequently fails with
  "Tool permission stream closed" when the MCP connection is flapping — just
  retry; it goes through within a few attempts.
- **Get audio to the user:** `SendUserFile` with the WAVs.
- **Before pushing:** `npm run lint`, `npm test`, `npm run validate` (all pass
  currently; the voice code is Lab-only and not exercised by the sim tests, but
  don't break the build). `git push -u origin claude/vocalizer-research-hab0si`.

---

## Recommended options for the next session (ranked)
1. **Revert `b23c4b9` first** (it regressed), then get an ear on the output
   before changing anything else.
2. **A/B the formant-sketch engine** (Sound-card toggle) in a browser. It's
   simpler and glitch-free-by-construction; if it sounds cleaner to the user,
   make it the default and invest there instead of the waveguide. This is
   probably the fastest path to "acceptable."
3. **If staying on the waveguide:** localize the squeak with the user's help
   (ask *when* it occurs), then target it — likely transition/coarticulation
   smoothing or a specific consonant model, not another global filter. Consider
   a better resampler (windowed-sinc) if imaging is implicated.
4. **Fallbacks the user has already weighed:** eSpeak-ng is installed here
   (`espeak-ng`, works, robotic-but-clean — the user rejected its timbre but it
   drives from the phonology's IPA if accuracy ever outranks naturalness); the
   browser Web Speech API is natural but reads the romanization with a real
   language's rules (no tone/exotic phonemes). Both were shown to the user; they
   chose to keep our custom synth.

## Files
- `src/sim/vocalTract.js` — the articulatory engine (DSP + gesture scoring).
- `src/langLab.js` — the Lab; formant engine + tract wiring + A/B toggle
  (search `speakPlanTract`, `speakPlanFormant`, `glottalWave`, `S.voice`).
- `src/sim/languagePhonetics.js` — `phoneticPlan`, `ipaOf`, `ipaC`, `ipaV`,
  `TONE_SHAPES` (the feature bundles the synth is driven from; do not modify to
  chase audio — it's shared with the sim).
- `tools/voice.mjs`, `tools/build_langlab.mjs` — harness + bundler.
- This file: `docs/vocalizer-handoff.md`.
