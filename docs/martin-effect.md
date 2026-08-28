# The Martin Effect — recognizable difference without scripting

**Status:** design principle (2026-08). **First application:** music tuning
archetypes (`docs/music-archetypes-plan.md`). May extend to other perceptual
systems once the pattern is proven.

---

## The problem

A simulation can be **emergent and correct** and still **unreadable**.

Free derivation from first principles — roughness minima for tuning, unconstrained
phoneme inventories, arbitrary heraldic gene pools — produces outputs that are
internally consistent but **perceptually samey**. Every derived people lands on a
slightly different chromatic smear; the ear cannot tell them apart. A fully alien
secondary world has the opposite failure: nothing rhymes with anything the player
has ever learned, so every culture blurs into “weird noise.”

Both fail the same player need: **tell peoples and places apart by vibe.**

George R.R. Martin’s trick (the name the owner gave this) is not to copy history
event by event. It is to copy **life-shaped texture** closely enough that your
lifelong priors fire — “that’s a cold maritime north,” “that’s a river-bureaucracy
court,” “that’s steppe pastoralists” — while the map underneath remains invented.
You recognize **families** of real things; the instances are still emergent. That
is how Westeros feels *distinct* without being Earth.

Simman needs the same contract for anything a human **hears, reads, or sees at
a glance**: music, language texture, flags, names, settlement rhythm. Not
“generate anything physics allows.” Not “if Nile then Egypt.” **Select among
archetypes the world’s state can support, scored by mechanism.**

---

## The principle

> **For human-facing cultural output, emergence runs over a catalog of
> recognizable archetypes — measured from real traditions, chosen by world state,
> never assigned by place name. The player should feel peoples apart before they
> read the codex.**

### What this is

- A **library of proven forms** (scales, metres, charge grammars, naming strata…)
  each with independent tags the mechanism can read.
- A **scoring pass** that asks: given this people’s materials, spectra, society,
  and contact history, which archetypes are *plausible* and which fit *best*?
- **Seeded selection** among near-ties so history and contact can drift a lineage
  without scripting outcomes.
- **Variation inside the archetype** — register, ornament, occasion, blend at
  borders — so two pentatonic peoples still sound like two peoples.

### What this is not (cardinal-rule safe)

| Forbidden (scripting) | Allowed (Martin) |
|---|---|
| `if (biome === "delta") scale = Rast` | Score all maqām-frame archetypes; delta bronze-court society boosts one family |
| `people.name === "China"` → pentatonic | Harmonic strings + low capacity + high `pull` → pentatonic *family* wins |
| Paste a historical tune | Compose *within* the winning degree set |
| One archetype per people forever | Contact `borrowFrom` drifts weights; daughter cultures inherit skewed scores |

**Rule 1** still holds: no calendar gates. **Rule 2** still holds: you build the
*selector*, not the *answer*. The archetype catalog is not a cheat code — it is
the **hypothesis space** perceptual systems must search, for the same reason
grammar frameworks constrain language typology without hard-coding Latin.

### When to apply it

Use the Martin Effect when **all** of these are true:

1. A human consumes the output directly (audio, glyph, flag, prose).
2. Free generation is measurably **unmusical / illegible / samey** (music today).
3. Real cultures cluster into **families** experts can name (pentatonic, maqām,
   slendro, heraldic quartering…).
4. You can score families from **world state** without naming the people.

Do **not** use it for sim mechanics that never meet the player’s eye (tile
claim costs, population accounting). Those stay pure mechanism.

### When to leave wild physics on

Keep a **minority wild bucket** for edge cases: inharmonic metallophone cultures
whose honest roughness curve implies a non-octave frame. They should be **rare**,
**labeled** in the Lab (“this people heard their way to an alien frame”), and
**not** the default derived path. Martin’s Westeros still has ice spiders; it
does not build the economy out of them.

---

## The listenability chain (music)

Current chain (broken for derived peoples):

```
materials → bodies → spectra → roughness minima → arbitrary degrees → compose
                                      ↓
                            often unmusical / off-sample
```

Martin chain (planned):

```
materials → bodies → spectra ──┬→ roughness curve (Lab / debug only)
                               │
                               └→ score TUNING_ARCHETYPES
                                        ↓
                               winning degree set + frame + tags
                                        ↓
                               compose + quantize samples to degrees
```

**Bench traditions** (`musicTraditions.js`) stay as known-answer tests — they
*pin* archetypes for calibration. **Derived peoples** use the same catalog
through `matchArchetype()`; they never read the bench table directly.

---

## Archetype catalog — what each entry carries

Extract and extend from `musicTraditions.js` plus a small set of gaps. Target
**25–40 entries** in v1; grow only with measurement, not taste.

Each archetype:

| field | purpose |
|---|---|
| `id` | stable key (`pythagoreanPent`, `slendro`, `maqamRast`, …) |
| `degrees` | cents within frame, measured not idealised |
| `frame` | repeat interval (1200, ~700, …) |
| `tags.harmonic` | boolean — harmonic partials vs inharmonic |
| `tags.equalPull` | how well it tolerates literacy/keyboard pull |
| `tags.minCap` / `maxCap` | melodic capacity band |
| `tags.density` | sparse pentatonic ↔ dense chromatic |
| `tags.droneFriendly` | pairs with drone texture |
| `tags.sampleEt` | how close to equal-tempered samples (playback hint) |
| `finalIdx` | default cadence degree |
| `provenance` | one-line source (“measured Highland pipe”, “三分損益 construction”) |

No culture names in tags. Scoring uses tags + spectrum shape + society dials.

---

## Scoring logic (v1 sketch)

Inputs from `musicOf` today: `spec`, `radiated`, `cap`, `pull`, `power`,
`people.soc.*`, `people.know.*`, optional contact vector.

For each archetype `A`:

```
fit_phys   = similarity(dissonanceCurve(spec), templateCurve(A))
             // Plomp–Levelt still matters — it picks the family
fit_cap    = penalty if cap outside [A.minCap, A.maxCap]
fit_pull   = penalty if |spread(degrees) - spread(equalDivision)| mismatches pull
fit_tags   = boost if harmonic tag matches harmonic ensemble (etc.)
fit_wild   = small boost for alien archetypes ONLY if inharmonic + no harmonic body
contact    = blend weights from borrowFrom edges (future sim hook)
score      = w1*fit_phys + w2*fit_cap + w3*fit_pull + w4*fit_tags + contact
```

Selection:

1. Sort by `score`.
2. Take top `k` within ε of the leader.
3. `hash32(seed, "tuning", peopleId)` picks among them — deterministic, driftable.

Output replaces `scale.degrees` for derived peoples; store `archetypeId` and
`fitScore` on the music object for the Lab to show (“nearest family: slendro-like,
score 0.82”).

---

## Composition & playback follow the winner

Once degrees are fixed:

- **Compose** only on mode steps from that set (already mostly true).
- **Samples:** quantize target pitch to nearest archetype degree before playback
  (fixes off-pitch recorded bank).
- **Synth:** unchanged — partials already matched tuning.
- **Lab UI:** show archetype family + raw physics curve side by side (“heard” vs
  “catalog match”).

Texture, rhythm, form stay emergent from society + language; only the **pitch
vocabulary** is Martin-selected.

---

## Tests & gates

Add to `tools/music.test.mjs`:

- Every derived people in a sweep gets `music.archetypeId`.
- No derived people with >3 semitone mean distance from nearest archetype degree.
- Distinct peoples (different seeds) produce ≥N distinct archetype ids in a 100-seed
  sweep (recognizable *difference*).
- Bench traditions unchanged — still exact cent match to declared scale.
- Optional: “ET tolerance” — if `tags.sampleEt` high, max pitch-shift cents bounded.

---

## Implementation phases

| phase | deliverable |
|---|---|
| **0** | This doc + CLAUDE.md principle (done when merged) |
| **1** | `src/sim/musicArchetypes.js` — extract from `TRADITIONS` + 5–10 gap fillers |
| **2** | `matchArchetype()` in `musicTuning.js`; wire into `musicOf` behind `MARTIN_TUNING=1` |
| **3** | Sample quantize in `musicSamples.js`; Lab labels |
| **4** | Flip default on; keep `deriveScale` path for debug toggle |
| **5** | CI distinctness + tolerance gates; probe sweep in `tools/probe_tune.mjs` |

---

## Relation to other systems

| system | Martin already? | next step |
|---|---|---|
| **Music** | bench only | archetype selector (this plan) |
| **Language** | typology frames + `languageRefs` corners | already closest analog |
| **Emblems** | charge/partition pools | pools *are* archetypes; ensure reachability not alien soup |
| **Names** | stratified generators | audit samey-ness across seeds |
| **Faiths** | sacred sigil grammar | keep procedural; avoid bespoke icons (already spec’d) |

The Martin Effect is the **unifying name** for “catalog + mechanistic selection”
across perceptual outputs. Music is first because it failed loudest.

---

## One-sentence check

Before merging any perceptual change, ask:

> **Would a player who never opened the codex still tell two peoples apart by
> vibe — without us naming either people in the code?**

If not, you need more archetype breadth or better scoring — not more free-form
parameters.
