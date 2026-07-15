# Vocalizer review — a full audit of the Lab's voice, and why it sounds weird

**Scope.** The two speech engines behind the Language Lab's Sound card:
the articulatory waveguide (`src/sim/vocalTract.js`) and the formant sketch
(`src/langLab.js`), plus the harness (`tools/voice.mjs`) and bundler. This is
the review requested on branch `claude/vocalizer-handoff-review`; it supersedes
guesswork with measurement. Read `docs/vocalizer-handoff.md` first for the
feedback history — this doc explains the *cause* behind that history.

**Bottom line.** The architecture is sound and the physics port is faithful.
The voice sounds weird for one dominant reason that has nothing to do with the
knobs everyone has been tuning: **the output never applies the lip-radiation
characteristic**, so every vowel collapses into the same dull, low-frequency
hum. Fix that one mechanism and the biggest complaints (indistinct, muffled,
`/u/`/`/o/` too loud) move together. A second, deeper layer — weak formant Q —
remains after that, and is the real ceiling. The whole "measurements say clean,
ears say broken" paradox is also explained here: the analyzer compensates for
the exact defect the synth has.

> **Update — fixes landed on this branch.** The three top recommendations are
> now implemented in `src/sim/vocalTract.js`: **(1) lip radiation** (`DSP.radiation`,
> applied in `renderScore` — the +6 dB/oct that was missing); **(2) a
> self-calibrating leveller** — floor, gate window and target set relative to the
> utterance's own envelope peak (make-up gain capped at 2.5× so transients don't
> clip), plus a final peak-normalize, so it no longer breaks when an upstream
> stage changes the level; **(3) a reworked `vowelPosture`** that gives every
> peripheral vowel a co-located palatal/velar constriction, so F2 fronts and
> spreads instead of collapsing. Measured: vowel-to-vowel distinctness ~0.99 → 0.0–0.4,
> spectral centroid now orders monotonically front→back (`u` 725 Hz … `i` 3653 Hz),
> loudness spread 2.9× → 1.2×, consonants unclipped (peaks ≤ 0.9). §3.2's "deeper
> ceiling" is largely addressed — what remains is fine-tuning by ear (e.g. `/i/`
> may be too bright), not a missing mechanism. Iterate it live in the Voice Lab
> (`tools/voicelab.html`).

---

## 1. Verdict by subsystem

| Subsystem | State | Note |
|---|---|---|
| Architecture (offline render, pure, deterministic, A/B engines) | **Good** | Genuinely well-designed; keep it. |
| Pink Trombone / Kelly–Lochbaum port | **Faithful** | The DSP is a correct physical model. |
| **Lip radiation (source→output tilt)** | **Missing** | The dominant defect. See §3.1. |
| Vowel formant strength / contrast (Q) | **Weak** | The real ceiling once radiation is fixed. §3.2. |
| Level management (compressor/gate) | **Fragile + mis-tuned** | 3× vowel-loudness bug; magic-number thresholds. §3.3. |
| Connected-speech timing ("chops") | **Partly inherent, partly bug** | §3.4. |
| Measurement harness | **Blind to the real defect** | Pre-emphasizes; can't see the tilt problem. §4. |

Everything below is backed by FFT measurements of the *actual* rendered output
(not LPC, which the handoff correctly flags as unreliable). Repro in §7.

---

## 2. What's genuinely good (don't regress these)

- **The premise is right.** Modelling the tube and letting formants fall out of
  its shape is the audio form of the project's second cardinal rule. The exotica
  (clicks, ejectives, nasals) really do come from gestures, not per-phoneme
  tables. Keep this engine as the target.
- **Offline, pure, deterministic render.** `renderScore` produces the exact
  samples headless under Node, so the DSP is testable in CI and the sim stays
  silent. This is the reason this review could be done at all.
- **Rate-independent formants.** Rendering at a fixed internal 44.1 kHz then
  resampling (`renderScore`, `vocalTract.js:268`) is the correct fix for the
  "formants pitch up on a 48 kHz browser" trap.
- **Local, not global, glitch damping.** The neighbourhood wall-loss
  (`vocalTract.js:166`) that kills the closure ring-up locally, instead of a
  global low-pass that dulls everything, is the right instinct.
- **The LF glottal source.** A physiological pulse rather than a sawtooth
  (`makeGlottis`) is the correct source model.

---

## 3. Why it sounds weird — the diagnosis, in layers

### 3.1 THE DOMINANT DEFECT: no lip-radiation characteristic

**Mechanism.** In real speech, the sound that leaves the lips is approximately
the **time-derivative** of the volume-velocity at the lip opening — a +6 dB/oct
high-pass. The chain is: glottal source (steep −12 dB/oct tilt) × vocal tract
(formant resonances) × **lip radiation (+6 dB/oct)** = a balanced ~−6 dB/oct
speech spectrum with the formants standing proud.

This engine emits the raw tract pressure `R[N-1]` (`vocalTract.js:224`,
summed at `:307-310`) with **only a 28 Hz DC-blocker** afterward
(`:314-316`). The +6 dB/oct radiation stage is simply absent. So the source's
steep tilt is never compensated, and everything above the first formant is
buried.

**Measured consequence** (steady-state vowels, band energy in dB relative to
each vowel's total, real FFT):

```
              0–500 Hz   0.5–1.5k   1.5–3k    3–5k
  /i/  now     −0.1       −18.2     −36.8     −38.2     ← /i/'s defining F2 (~2.2 kHz) is 37 dB down = gone
  /a/  now     −0.8        −8.0     −22.6     −34.3
```

For `/i/`, the 1.5–3 kHz band that *is* the identity of `/i/` sits **37 dB below**
the fundamental — inaudible. So `/i/` is not a vowel, it's a hum.

**Vowel distinctness** (cosine similarity of the band envelope; 1.0 = literally
the same signal):

```
             /i/~/a/   /i/~/u/   /a/~/u/   /i/~/o/
  now         0.985     0.998     0.993     0.999    ← all vowels are the same sound
  +radiation  0.518     0.907     0.819     0.928    ← vowels become distinguishable
```

Adding the radiation high-pass raises `/i/`'s 1.5–3 kHz band by **+19 dB** and its
3–5 kHz band by **+24 dB**, and turns "every vowel identical" into "vowels are
different sounds." This is the single highest-leverage change in the whole system.

**The knob everyone tuned barely matters.** The handoff calls `DSP.hf` (the
per-section HF loss, `vocalTract.js:37,214`) "the big timbre/stability lever."
For *stability* (the >5 kHz closure ring-up) it is. For *timbre* it is nearly
inert: turning it from 0.92 fully **off** (1.0) moves `/i/`'s formant bands by
**< 0.3 dB**. All the agony over 0.82-"mushy" vs 1.0-"glitchy" was tuning a
parameter that does not touch the thing that is broken. Do not keep chasing it.

**Why the last commit (`b23c4b9`) made it worse.** It made voicing continuous
across syllables. With the real defect in place, the inter-syllable silences
were the only thing periodically interrupting an indistinct drone; removing them
just makes the mush continuous and its formant-less vowel-to-vowel transitions
more exposed. The commit is conceptually correct (real speech is continuous) —
it only regressed *because the vowels underneath it are broken*. Fix radiation
first; then continuous voicing becomes an asset, not a regression. **Do not
revert it as an end in itself** — it's treating a symptom.

### 3.2 THE DEEPER CEILING: formant Q is too low

Radiation is necessary but **not sufficient**. Even with it applied, two things
remain (from the same measurement):

- `/e/` (mid front) and `/o/` (mid back round) still measure **identical**
  (cosine 1.00) — the tract is not separating front/back for mid vowels at all.
- `/i/` still keeps **91%** of its energy below 500 Hz; its F2 is present but weak.

So the tube's resonances are too **broad and low-Q** to form the sharp, well-
separated formant peaks that carry vowel identity, and the feature→area mapping
(`vowelPosture`, `vocalTract.js:353`) does not swing F2 far enough between
front and back. Candidate mechanisms, in order of likelihood — to be
re-measured *after* radiation is in, not fitted blind:

1. **Cumulative losses lower Q.** The distributed per-section HF loss + wall
   loss + the passive pressure-junction scattering (chosen to tame the nasal
   3-port, `vocalTract.js:200-207`) together damp the resonances more than the
   classic Kelly one-multiply form would. Broad formants ⇒ weak contrast.
2. **Single-hump area function.** `shape()` builds one raised-cosine tongue hump;
   distinct front/back vowels want a genuine two-cavity (front vs back volume)
   split. The current hump compresses the F2 range.
3. **`/i/` gets no help.** `vowelPosture` only adds a co-located constriction for
   back/round vowels (`:369`); front high `/i/` relies on the hump alone, which
   isn't tight enough to push F2 up to ~2.2 kHz.

This layer is the difference between "recognisable" and "good." It's real
mechanism work, not a constant to dial.

### 3.3 THE `/u/`/`/o/` LOUDNESS BUG (the "squeak" spikes)

`/u/`, `/o/`, `/w/` and the trill come out **~3× louder and ~4× peakier** than open
vowels — measured RMS `/u/`=0.119, `/o/`=0.118 vs `/i/`=0.046, `/a/`=0.040 (peaks
0.53–0.55 vs 0.13). In connected speech this is violent: across the word
*kitanu*, the per-10 ms-frame loudness has a **max/median ratio of 9.3×**, with
the final `-nu` spiking while the vowels before it sit near the floor. That
lurching *is* a big part of the "rubber-shoe-on-a-gym-floor" percept.

**Two compounding mechanisms:**

1. **Raw gain varies by vowel.** The narrow constriction + rounding on back
   vowels boosts the low-frequency resonance, and since the un-radiated output
   is *already* all low-frequency, that boost dominates the RMS. (Radiation in
   §3.1 de-weights the lows and shrinks this gap on its own.)
2. **The compressor floor clamps the quiet vowels, not the loud ones.** In
   `renderScore` the make-up gain is `TARGET / max(env, FLOOR)` with
   `FLOOR = 0.085` (`vocalTract.js:325,332`). Open vowels are quiet enough that
   `env < FLOOR`, so their gain is capped at `0.22/0.085 ≈ 2.6×` and they never
   reach target — while `/u/`/`/o/` are loud enough to be normalised down to
   target. The floor meant to stop silence being amplified is set so high it
   throttles normal speech.

**Proof:** add radiation + drop `FLOOR` to 0.03 and the vowel-loudness spread
collapses from **2.9× → 1.1×** (all five vowels within 0.115–0.121 RMS), no
clipping, no NaNs. Listen to `fixed_kitanu.wav` vs `current_kitanu.wav`.

### 3.4 THE "CHOPS" — part physics, part exaggeration

Voiceless stops are *supposed* to be silent (a real closure is silence), so some
gapping is correct. But it's exaggerated here: in *kitanu* the `/t/` closure is
**80 ms of dead silence** mid-word, and with vowels only 150–190 ms long, a word
with two stops is mostly gaps. Contributors:

- Closure/burst timing in `scoreCons` (`vocalTract.js:477-499`) is generous;
  the silent closure + the gate hushing it reads as a hole.
- The gate itself (`:331`) is a downward expander whose threshold (`env` crossing
  0.03/0.006) can flutter during weak transitions, adding amplitude wobble on top
  of the real gaps.

This is lower priority than §3.1–3.3 and partly resolves once vowels are loud,
distinct and continuous.

---

## 4. Why every measurement disagreed with the user's ears

This is the mystery from the handoff, and it has a concrete answer.
`tools/voice.mjs` measures formants by **LPC on a pre-emphasized signal**:
`voice.mjs:53` applies `seg[i] -= 0.98·seg[i-1]` before the LPC fit. That
pre-emphasis is a +6 dB/oct high-pass — **it is the lip radiation, applied inside
the analyzer.** So the harness measures where the formants *would* be if the
output were radiated correctly, finds them in sane places, and reports "vowel
space OK / 0 glitches" — while the actual played output, lacking that same
+6 dB/oct, is the dull hum the user hears.

The analyzer silently compensates for the exact defect the synth has. That is
why "sustained vowels measure clean but sound wrong," and why the scans never
caught it. The harness needs to also measure **formant level relative to the
fundamental in the un-pre-emphasized signal** (an audibility/tilt check), and to
assert **inter-vowel spectral distinctness**, which is the property that was
actually failing (0.98–0.999 similarity would have screamed).

---

## 5. Implementation-level findings (ranked)

1. **Missing radiation stage** — `vocalTract.js` output chain (`:224`, `:307-316`).
   §3.1. The fix is ~2 lines (a pre-emphasis/first-difference on the output with
   make-up gain). Highest leverage in the codebase.
2. **Compressor thresholds are hard-coded absolute magic numbers** — `TARGET
   0.22`, `FLOOR 0.085`, gate `0.03/0.006` (`vocalTract.js:325,331`). They are
   calibrated to today's raw amplitude, so **any upstream change breaks the
   leveller** — I hit exactly this while testing (adding radiation dropped the
   level 30 dB and the whole gate collapsed to a constant tiny gain until I added
   make-up gain). This is a second-cardinal-rule smell: fitted constants with no
   independent meaning. Make detection **relative** (normalise by the signal's
   own running peak/RMS), so it self-calibrates.
3. **`FLOOR` throttles normal vowels** (§3.3) — proximate cause of the 3×
   loudness bug. Lower it, but the principled fix is #2 plus removing the raw
   per-vowel gain variation.
4. **`DSP.hf` is miscast as a timbre lever** (`:37`) — it's a stability lever with
   near-zero effect on the formant bands (§3.1). Documenting/renaming it would
   stop the next session burning time on it.
5. **Formant Q / area-function tuning** (§3.2) — the real quality ceiling; needs
   mechanism work (loss budget, two-cavity area function, `/i/` constriction).
6. **Harness is blind to the tilt defect** (`voice.mjs:53`) — §4. Add a formant-
   level/distinctness assertion; it would have caught this months ago.
7. **Minor / hygiene:** the `noise` param to `Tract.step` is dead (`:180,238`,
   `void noise`); `kMid` computed and voided in `scoreCons` (`:402,500`); the
   linear resampler (`:337-342`) is a real but *minor* imaging source next to the
   above — revisit only after §3.1–3.3.

---

## 6. The two-engine strategic question

The handoff's option 2 is "A/B the formant sketch; it may be cleaner." Now that
the tract's core defect is known and cheap to fix, my recommendation flips:
**invest in the waveguide.** Reasons:

- The waveguide's headline problem (§3.1) is a 2-line, well-understood physical
  omission, not a deep flaw. Its ceiling (§3.2) is higher than the formant
  sketch's by construction — it models the cause.
- The formant sketch (`langLab.js:154-183`) already *hard-codes* formant tables
  (`VOWEL_F`, `BURST_F`, `FRIC_F`), which is the very thing the project's second
  cardinal rule warns against — it paints the effect. It's a fine fallback and
  worth keeping behind the toggle, but it's a dead end for the exotic phoneme
  inventories the sim generates (it can't voice a click or an ejective from
  gestures; it needs a new table per trick).
- Keep the sketch as the glitch-free safety net and for A/B, but the target is
  the tract.

---

## 7. Recommended next steps (mechanism-first, in order)

1. **Add lip radiation** to the tract output (before the compressor), with an
   energy-preserving make-up gain. Re-measure vowel distinctness and formant-band
   levels. *(Proven here: distinctness 0.99→0.52–0.93, F2 band +19 dB.)*
2. **Make the leveller relative** (§5.2) so it survives #1 and future changes,
   and **lower/retire `FLOOR`** so open vowels reach target. *(Proven: loudness
   spread 2.9×→1.1×.)*
3. **Re-baseline with the user's ear** on words, not just vowels — the A/B WAVs
   sent alongside this review are the starting point. Only then judge §3.2.
4. **Attack formant Q** (§3.2): audit the loss budget for the vowel (non-closure)
   case, and widen the F2 swing in `vowelPosture` / the area function. This is
   the "recognisable → good" work.
5. **Fix the harness** (§4): assert formant-level-vs-F0 and inter-vowel
   distinctness on the *un*-pre-emphasized signal, so CI can see what the ear
   hears.
6. Only after the above: revisit the resampler, closure timing, and gate flutter.

**Guard-rails.** Do all of this as mechanisms, never as fitted outcomes: radiation
is real physics; a relative leveller self-calibrates; a wider F2 swing is a
posture change with acoustic meaning. Resist the temptation to add another magic
constant to "make `/u/` quieter" or "make `/i/` brighter" — that's how the
compressor got into this state. Before pushing any change: `npm run lint`,
`npm test`, `npm run validate`, and re-run `node tools/voice.mjs`.

---

## Ultra-review (round 2) — the deeper bugs, and the one that mattered most

The first review fixed the *muffle* (radiation) but the voice still "sounded
bad." A four-way parallel deep review (waveguide-DSP correctness, glottal source,
prosody/timing, system-level naturalness) plus fresh measurement found that the
earlier fixes had been **coping mechanisms layered on a broken core**. Fixes
below are landed on this branch, ranked by the impact they turned out to have.

### THE root cause — a non-passive waveguide (self-oscillation = the "squeak")
`vocalTract.js` `step()`. The pressure-junction port routed the **left-going
wave one section off**: the junction writes `jL[m]` as the wave entering section
`m`, but the update read `L[k] = jL[k+1]` (and the lip boundary wrote `jL[N]`,
leaving `jL[N-1]` a dead node). `R` was section-indexed, `L` junction-indexed —
inconsistent, so on any area gradient the tube **created energy** (pole at
|z|≈1.0067). It self-oscillated; the `tanh` clamp — which fired **260,752×** on a
single sustained `/i/` (the "normal speech never exceeds ~5" comment was flatly
false) — was the only thing preventing NaN, pinning the runaway into a buzzy
~3.7 kHz limit cycle. **That limit cycle is the "medium-toned squeak / rubber
shoe on a gym floor,"** and the same mechanism produced the `/u//o/` peakiness,
the loudness imbalance the leveller was fighting, the nasal/velar buzz, and much
of what §3.2 called the "formant ceiling." The fix is 4 lines (`L[k]=jL[k]`, lip
boundary → `jL[N-1]`, same for the nose branch). After it: clamp fires **0×**,
internal wave peak on `/i/` **12.4 → 0.6**, `voice.mjs` vowel-space **2/6 → 5/6**,
`/i/` becomes a real vowel (F2≈2.3 kHz, F1 present) instead of a whistle, vowel
loudness evens out, formants land at textbook quarter-wave positions.
Also: the wall-loss coefficient reached **−0.303** at closures (a sign-flipping
inverter, not a loss) → clamped to [0,1].

### The source was a perfect buzzer — no jitter/shimmer
`makeGlottis`. The LF pulse math is a faithful port, but the port dropped Pink
Trombone's per-cycle perturbation. Result: harmonics-to-noise ~**128 dB** (human
~15–20). A flawless harmonic stack *is* "buzzy/robotic," and no timbre/tilt knob
touches periodicity — which is why months of `tenseness`/`hf` tuning never
reached it. Added seeded per-cycle F0 jitter (~0.6%) + amplitude shimmer (~4.5%)
+ slow flutter (~1.6%), band-limited the aspiration (raw white breath became a
bright hiss after radiation), relaxed the pressed modal source (`tenseness`
0.72→0.65), gentled radiation (0.97→0.9). Deterministic (seeded).

### The vowel space had collapsed, and connected speech was robotic
Prosody/timing review, all measured: `/u/`~`/o/` rendered as the **same spectrum**
(binary lip rounding) — fixed with height-graded rounding + wider tongue-diameter
spread. Every vowel was the **same length at ~2× too slow** a tempo — cut base
durations and added intrinsic duration (open vowels longer). Every phrase
**plunged to ~64 Hz** (vocal fry) because the terminal tone multiplied an
already-declined value — made it a bounded floor, and gave stress a real
rise-fall accent. Voicing was driven to **silence at every word** — propagated
the syllable-continuity rule to word seams.

### The `/i/` whistle (a regression introduced mid-review)
The first-round vowel-geometry rework set `tongueDiameter` so small the tongue
hump pinched the tract to a near-closure, killing F1 → a 4 kHz whistle. Kept the
diameter in the vowel range and removed a co-located vowel constriction that was
**inert** anyway (the hump was always narrower, so `min()` ignored it).

### Still open (future work, lower payoff)
- `shape()` builds slightly unphysical area functions for high tongues (a mid
  closure + a 6× area spike); `/a/`'s F1 is a touch low. Clamp tongue diameter and
  give front-high vowels their F2 from a front-cavity length split.
- Leveller envelope still ripples ~9% at F0 (4 ms attack tracks the pitch period)
  — lengthen the attack or detect on a peak-hold envelope.
- Per-formant **bandwidth** control (the genuine waveguide ceiling, §3.2/§7) and
  place-shaped fricative spectra remain unaddressed.

---

## Appendix — how this was measured (repro)

The DSP is pure, so everything here was rendered and analysed headless under Node:

- `node tools/voice.mjs` — the built-in table (note its LPC caveat, §4).
- Real-FFT band-energy, crest, per-frame loudness, and vowel-distinctness were
  computed by importing `renderScore`/`scorePlan` directly and running an 8192-pt
  Hann FFT on the steady-state middle of each vowel; mechanism tests (HF-loss
  off, radiation on, floor lowered) were done by rendering **patched copies** of
  the module and comparing. Scripts and A/B WAVs live in the session scratchpad
  (`analyze.mjs`, `analyze2.mjs`, `analyze3.mjs`).
- All numbers are from seed 12345 at 48 kHz; they're deterministic and stable
  across seeds for the band/level results (formant *frequency* estimates are the
  only seed/rate-sensitive part, which is why this review keeps to band energy
  and distinctness, not LPC formant Hz).
