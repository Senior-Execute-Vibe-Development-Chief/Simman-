# Music tuning archetypes — implementation plan

Companion to the Martin Effect note in `CLAUDE.md`. Replaces free
roughness-crawled scales for derived peoples with scored selection from a
pre-approved catalog.

---

## Goal

Derived peoples should sound **different from each other** and **recognizable as
music** — pentatonic vs maqām vs metallophone vs diatonic — without assigning
scales by culture name.

Success criteria:

1. Mean sample pitch error < 50¢ against archetype degrees (was ~60¢+ off ET).
2. 100 random seeds → ≥8 distinct archetype families at ≥5% share each (tunable).
3. Player description test: “this one feels more Arabic / East Asian / Celtic”
   correlates with tag clusters, not random noise.
4. Bench `music.test.mjs` traditions still exact-match declared cents.

---

## Files

| file | action |
|---|---|
| `src/sim/musicArchetypes.js` | **new** — catalog + tag metadata |
| `src/sim/musicTuning.js` | add `matchArchetype()`, `scoreArchetype()`, keep `deriveScale` for Lab |
| `src/sim/musicGenome.js` | `musicOf`: call matcher when `MARTIN_TUNING` (default on after phase 4) |
| `src/sim/musicSamples.js` | `quantizeToScale(degCents, hz)` before pitch shift |
| `src/musicLab.js` | show `archetypeId`, fit score, “physics curve” debug panel |
| `tools/music.test.mjs` | archetype presence, distinctness, cent tolerance gates |
| `tools/probe_tune.mjs` | sweep report: archetype histogram, mean shift |

---

## Catalog v1 (seed list)

Start by **lifting** measured scales from `musicTraditions.js`:

- `pythagoreanPent` — Chinese bench
- `highlandPipe` — Celtic bench (measured, not just)
- `yaman` — Hindustani
- `maqamRast` — Arabic
- `slendro` / `pelog` — gamelan
- `westAfricanPent` — equidistant pentatonic
- `diatonicMajor` / `naturalMinor` — European bench
- `flamencoPhrygian` — flamenco
- `miyakoBushi` — Japanese
- `didgeridooYidaki` — single-pitch / limited (aboriginal)

**Add** families not on bench but needed for spread:

- `anhemitonicPent` (generic 0-200-400-700-900 class)
- `bluesMinor` (blue third)
- `wholeTone`
- `harmonicMinor` (central Asian / Balkan flavor)
- `pelogSlim` / `slendroWide` (measured variants)
- `twelveTet` (high literacy + keyboard pull)
- `wildInharmonic` (1–2 entries for honest non-octave metallophone frames — rare)

Each entry: degrees[], frame, tags{}, finalIdx, provenance string.

---

## Scoring weights (initial — measure, don’t tune by ear)

```js
const W = { phys: 0.45, cap: 0.20, pull: 0.15, tags: 0.15, contact: 0.05 };
```

- **phys:** negative L2 distance between normalized dissonance curves (spec vs
  template spectrum implied by archetype — precompute template spectra from
  representative bodies).
- **cap:** 0 inside band, quadratic penalty outside.
- **pull:** match archetype `equalPull` to `people.soc.literacy` and fixed-pitch
  instruments.
- **tags:** harmonic ensemble → boost harmonic archetypes; sustain-heavy → droneFriendly.
- **contact:** reserved 0 until sim hook; in Lab, border blend could average parent
  archetype weights.

Top-3 within 0.05 score → seeded pick.

---

## `musicOf` integration

```js
// musicGenome.js — after spec/cap/pull computed
const raw = deriveScale(spec, { cap, pull, frameSpec: radiated, power }); // keep for Lab
const { archetype, score, degrees } = matchArchetype({
  spec, radiated, cap, pull, power, people, seed: people.seed,
});
const scale = { ...raw, degrees, archetypeId: archetype.id, martinScore: score };
```

Mode derivation (`deriveMode`) runs on **archetype degrees**, not raw minima crawl.

Feature flag: `process.env.MARTIN_TUNING !== "0"` (env for probes; default `"1"` after validation).

---

## Playback quantize

In `musicSamples.js` when pitching a sample to `targetHz`:

```js
const degHz = nearestDegreeHz(targetHz, music.scale.degrees, rootHz);
// play sample at degHz, not continuous targetHz
```

Removes the “wobbly resample” failure mode for recorded bodies.

---

## Lab UX

- Header chip: **family** label derived from tags (`pentatonic`, `maqām-frame`, …).
- Tuning panel: two tabs — **Catalog match** (degrees list) / **Physics** (curve).
- A/B: toggle Martin off to hear old free-crawl (debug only).

---

## Rollout

1. Land catalog + matcher behind flag; no default change.
2. Probe 160 seeds — histogram + listening notes.
3. Enable default; update `docs/music.md` chain diagram.
4. Remove flag once gates green for two weeks.

---

## Non-goals (v1)

- Procedural **phrases** / stem libraries (Martin phase 2 if needed).
- Sim ambient wiring (still Lab-only).
- Per-archetype composition rule overrides (texture stays emergent).

See `CLAUDE.md` for the style rule; this doc is the work order.
