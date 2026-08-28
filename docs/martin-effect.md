# The Martin Effect — recognizable difference without scripting

**Status:** sim-wide design principle (2026-08). **Infrastructure:**
`src/sim/martin.js`. **First shipped domain:** music tuning (`src/sim/musicArchetypes.js`).
See also `docs/music-archetypes-plan.md` and `CLAUDE.md`.

---

## The problem

A simulation can be **emergent and correct** and still **unreadable**.

Free derivation from first principles produces outputs that are internally
consistent but **perceptually samey** — or so alien that nothing rhymes with
anything the player has ever learned. Both fail the same need: **tell peoples
and places apart by vibe before opening the codex.**

George R.R. Martin's move (the name the owner gave this) is not to copy history
event by event. It is to copy **life-shaped texture** closely enough that
lifelong priors fire — maritime north, river court, steppe herders — while the
map stays invented. You recognize **families** of real things; instances are
still emergent.

Simman applies this to **every human-facing cultural surface**:

| domain | archetype catalog (existing / planned) | selector status |
|---|---|---|
| **Music — tuning** | `musicArchetypes.js` (measured scales) | **shipped** |
| **Music — rhythm/texture** | emergent from language + society | emergent (Martin TBD) |
| **Language** | typology frames, `languageRefs` corners | partial — closest analog |
| **Emblems / flags** | partition pools, charge grammars (`emblemGenome.js`) | pools exist; audit reachability |
| **Names** | stratified onomastic generators | audit samey-ness |
| **Faith sigils** | procedural grammar (no bespoke icons) | spec'd |
| **Sim mechanics** | — | **never Martin** (claim costs, pop, trade) |

Pure mechanics stay unconstrained. Perceptual outputs score from catalogs.

---

## The principle

> **For human-facing cultural output, emergence runs over a catalog of
> recognizable archetypes — measured from real traditions, chosen by world
> state, never assigned by place name.**

### Shared machinery (`src/sim/martin.js`)

- `MARTIN_ON` — global kill-switch (`MARTIN=0` for probes)
- `MARTIN_DOMAINS` — registry of which subsystems use the effect
- `pickAmong(catalog, scoreFn, { seed, tag })` — deterministic tie-break
- `bandFit`, `stepSpread`, `etErr` — reusable scoring helpers

Each domain adds its own catalog module and scorer; none import bench tables
at runtime for derived output.

### Cardinal-rule safety

| Forbidden | Allowed |
|---|---|
| `if (biome === "delta") scale = Rast` | Score all maqām-frame archetypes; bronze court boosts that family |
| Free crawl → chromatic smear | Catalog of 17+ measured tunings; physics picks the family |
| One archetype per people forever | Contact weights drift; seeded pick among near-ties |

**Rule 1:** no calendar gates. **Rule 2:** build the **selector**, not the answer.

### Wild bucket

Keep a **minority alien class** (e.g. `wildInharmonic` tuning) for honest
physics outliers — rare, labeled in the Lab, not the default path.

---

## Music (first application)

### Chain

```
materials → bodies → spectra ──┬→ roughness curve (Lab debug)
                               └→ matchTuningArchetype() → degrees
                                        ↓
                               compose + quantize samples to degrees
```

- `musicOf()` calls `matchTuningArchetype()` when `MARTIN_ON` (default on)
- `playSampled()` quantizes through `quantizeToScaleHz()` before pitch shift
- Bench `musicTraditions.js` unchanged — known-answer tests only

### Catalog

`TUNING_ARCHETYPES` in `musicArchetypes.js` — pentatonic, maqām, raga, pélog,
slendro, diatonic, 12-TET, limited two-pitch, rare wild frame. Tags are
**properties** (harmonic, capacity band, ET tolerance), never culture names.

### Tests (`tools/music.test.mjs`)

- Every derived people gets `scale.martin.id`
- 100 seeds → ≥6 distinct families
- `tetErr` < 45¢ (sample-friendly)
- Bench traditions exact-match declared cents

---

## Rollout to other domains

### Language (next)

Typology frames already constrain generated languages. Formalize as Martin:
score frame from phoneme inventory + contact; pin corners stay in `languageRefs`.

### Emblems

Charge/partition pools **are** archetypes. Audit: derived genomes should land in
**named vexillological families** (quartered, triband, saltire…) not alien soup.
Mechanism: score partition grammar from society + faith + contact.

### Names

If 100 seeds produce orthographically indistinguishable strata, add Martin
name-shape catalogs (Celtic-style, Semitic triliteral, East Asian monosyllabic…)
scored from language phonology — not from biome name.

---

## Implementation phases (music — done / in progress)

| phase | deliverable | status |
|---|---|---|
| 0 | Principle in CLAUDE.md + this doc | done |
| 1 | `martin.js` + `musicArchetypes.js` | done |
| 2 | Wire `musicOf`, sample quantize, Lab label | done |
| 3 | CI gates | done |
| 4 | Language / emblem Martin selectors | planned |
| 5 | Sim ambient `culMix` archetype blend at borders | planned |

---

## One-sentence check

> Would a player who never opened the codex still tell two peoples apart by
> vibe — without us naming either people in the code?

If not: more archetype breadth or better scoring — not more free parameters.
