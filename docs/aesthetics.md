# Aesthetics — landscape, integration plan, and data requirements

Working notes recovered from the early aesthetics / identity strand and
consolidated here so the plan survives outside chat. Status snapshot at bottom
notes what has landed since.

The unifying pattern: a **heritable style vector**, expressed through what the
world allows, drifting with lineage, recombining on contact. The emblem genome
is the template; language already ships the same shape for tongues. Everything
else below is the roadmap for making civilizations *look and sound* like
themselves.

---

## 1. What exists and where

### Language generator

**Code:** `src/sim/language*.js` (~9,700 lines). Entry point: `language.js`
(header: *Languages v2*).

A language persists only **seeds + history**; the whole vocabulary derives on
demand through pure functions:

| Module | Role |
|--------|------|
| `languagePhonology.js` | Feature-bundle phonemes, sonority syllable grammar, tone/harmony/morphotype dials |
| `languageGrammar.js` | Syntax, inflection, clause rendering (~3,400 lines) |
| `languageChange.js` | Sound change as a replayed rule log (sister languages differ by regular correspondences) |
| `languageLexicon.js` | Shared concept graph — names are meaningful compounds with recoverable glosses |
| `languageScript.js` | Writing systems |
| `languagePhonetics.js` + `vocalTract.js` | Phonetics and tract scoring |
| `languageHistory.js` | Lab harness for areal history (not the sim's driver) |

**Lab:** `langlab.html` / `src/langLab.js` (`tools/build_langlab.mjs`).

**Sim integration — current and complete:**

- One module tree, no legacy copy — `cultures.js` and `faiths.js` import the
  same `language.js` the Lab uses.
- Every culture **founds/branches** its tongue; every settlement carries
  `langMix` standardizing toward the capital's prestige language.
- **Mechanical teeth:** linguistic mismatch is friction in `cohesion.js`
  (`layerMis` on `langMix`); identity layers in `identityField.js`
  (`culMix`, `langMix`, `faithMix`, `ancMix`).

**Deliberately not in the sim:** scripts as a live mechanic, text rendering on
the map, and everything **acoustic** — *the sim stays silent; the Lab owns the
speakers*. Voice / IPA / tract work is presentation-layer, not sim integration.

**Specs:** `docs/language-comprehensive-spec.md`,
`docs/language-typology-completion-spec.md`.

### Flag / emblem generator

**Code:** `src/sim/emblemGenome.js` (~1,580 lines) + `emblemRender.js` +
`heraldryChargesDetailed.js` (186 recoloured charge silhouettes).

Every banner is the expression of a **heritable ~26-gene design genome**:

- `foundGenome`, `mutateGenome`, `inheritGenome` (cadency),
  `crossGenome` (marshalling as genetic crossover) — all tested via
  `tools/emblem.test.mjs`.
- One genome space expresses European heraldry, Chinese-style silk, mon badges,
  aniconic calligraphy, steppe tamgas, geometric tilework, etc.
- Semantic **axes** from emergent realm state (maritime, martial, devout…) are
  soft biases inside the engine — never identity labels, never time gates.

**Also present:** `src/sim/heraldry.js` (~350 lines) — an older sim-integrated
armorial grammar (lineage + faith + canting on the realm name). **Superseded**
by the emblem engine for new work; fold canting into the genome path, then
retire `heraldry.js`.

**Lab:** `tools/emblem-genome-lab.html` (`tools/build_lab.mjs`).

**Docs:** `docs/emblems.md`, `docs/flag-design-principles.md`,
`docs/flag-reachability-handoff.md`, `docs/flag-realism-research.md`,
`docs/heraldry-symbol-library.md`.

**Sim integration — partial (v1 render only):**

- `docs/emblems.md` states the engine is *deliberately not wired into the
  simulation yet*.
- `src/ui/emblems.jsx` is **render-time v1**: genome derived per realm at draw
  time from `axesFor()` (capital terrain, ports, temperament, polity shape),
  session-cached, **zero sim state**, no evolution across succession/union.

### Music (sibling Lab — out of scope for this doc's core plan)

**Code:** `src/sim/music*.js`, `src/musicLab.js`. Same *Lab first, sim silent*
posture as emblems at inception. See `docs/music.md`. As of 2026-08 the
procedural synthesis path is under review for ambient use; treat music as a
separate thread from language/emblems integration below.

### UI shell

**Doc:** `docs/ui-overhaul-plan.md`. Parchment atlas + codex design system;
map labels and heraldry surfacing (§5.2). Partially landed in `WorldSim.jsx`
+ `atlasUI.css`.

---

## 2. The integration plan — the real gap is emblems

The repo already spec'd the fix in `docs/ui-overhaul-plan.md` §14 item 2 /
§5.2:

> **Emblem genome per polity** (persisted on the entity at foundation — it's
> identity, like the name; regenerating must be impossible once granted).
> Events already mark the emergent re-grant moments.

### Phase 1 — genome becomes polity state

**New file:** `src/sim/peopleSim/emblems.js` (does not exist yet).

- **Grant arms at polity foundation** — move `axesFor()` out of
  `src/ui/emblems.jsx` into sim-side code (its inputs are already all emergent).
- Seed from `entityRng`, persist + hash like persons/dynasties.
- Old saves: regenerate genomes **deterministically** from recorded founding
  inputs (same axes → same genome).

**Guardrail:** the pass is **write-only to `c.emblem`**, read-only of everything
else, so `npm run validate` stays bit-identical by construction.

### Phase 2 — evolution rides events that already fire

No per-tick drift — cadence stays emergent, never clock-gated.

| Event | Operator |
|-------|----------|
| `dynasty.founded` / `ruler.crowned` | `inheritGenome` (cadency mark) |
| `polity.united` / `dynasty.union` / won succession war | `crossGenome` (quarters accumulate — shield as record of absorption) |
| Secession | `inheritGenome` with drift |
| Genuine rupture (revolution, conversion) | `mutateGenome` scaled by rupture magnitude |

Each re-grant logs a **chronicle event**.

### Phase 3 — cross-link language and faith

- **Canting:** realm names have recoverable glosses (`languageLexicon` /
  `etymologyOf`) → bias motif genes toward a charge matching the name's
  meaning — one uniform mechanism over the lexicon, no special cases.
- **Later:** mottoes in the realm's script via `languageScript.writeName`;
  faith-seeded sacred sigils shared by co-religionist realms (engine already
  has procedural sigil grammar; no real religious iconography).

### Phase 4 — scripts enter the sim

- Adoption/invention as an **emergent event** (gated on administrative /
  knowledge state), spreading along the same contact edges `borrowFrom` uses.
- Persistence = adoption log only.
- Unblocks Phase 3 mottoes and written culture on the map.

### Explicitly not integrated

| Module | Reason |
|--------|--------|
| `languageHistory.js` | Lab harness — `cultures.js` drives real language history |
| `heraldry.js` wholesale | Superseded; fold canting, retire |

### Gates (unchanged project rules)

- New persisted state ⇒ `npm run coverage` must reach the genome from
  `collect()`.
- Re-grant counters named `…Ever` ⇒ `npm run monotone`.
- `npm test` grows: genome save/load + event-evolution determinism.
- `npm run validate` untouched; `npm run resgate` cheap insurance for anything
  touching territory/display blast radius.

---

## 3. The aesthetics landscape — everything else

The sim already tracks the **four population layers** any aesthetic rides on:

`culMix`, `langMix`, `faithMix`, `ancMix` — plus inherited realm temperament.

### Bodies / the ancestry look — **strongest starting point**

**Infrastructure exists today:**

- `world.ancestry` — per-tile deep-ancestry register
- `ancMix` admixture on settlements
- `cohesion.js` already reads ancestral distance

**Mechanism:**

- Continuous trait **clines**, never discrete types.
- Each deep-ancestry people gets phenotype values (skin tone, stature, build,
  hair form, facial proportions) from genesis homeland climate (UV → melanin,
  cold → Bergmann/Allen builds).
- Traits move only by **migration and admixture** — scientifically right
  (adaptation too slow for historical timescales; appearance is *carried*, not
  re-derived). Cardinal-rule clean.

**Firm constraint:** read-only cosmetic — **never a mechanic input**.

**Payoff:** procedural portraits where rulers and crowds visibly are their
region's population history.

**Priority (original recommendation): first** — all carriers exist, biggest
identity per unit effort.

### Dress and textiles

- Fibers from ecology/economy (wool / linen / silk / cotton / fur by place).
- Dye as trade good — costly colour as status; ties to emblems (murex-rich realm
  wears and flies saturated colour).
- Form from climate (tailored + trousered cold/mounted; draped hot).
- Stratification from inequality state (`_serf`, `_estates` → sumptuary
  difference).

Lives naturally inside portrait work (priority **third**).

### Architecture

- Material from geology + biome (timber / mudbrick / stone / reed).
- Form from climate (flat roofs + courtyards arid; steep pitch under snow;
  stilts wet).
- Fortification from war pressure; monumentality from surplus.
- Holy cities already accumulate offerings in `faiths.js` — temple monumentality
  is an economic flow the sim computes today, waiting to be drawn.

Priority **second** (architecture vignettes).

### Religious details

Deepest existing base: six creed axes, holy sees, schism/syncretism, procedural
sacred iconography in emblem gene-space.

Extensions (all state-driven):

- Ritual calendars keyed to **seasonality** (flood festivals — season is state,
  not clock).
- Burial customs; dietary taboos that **bite** (food is a real economy).
- **Iconoclasm axis:** exclusivity + asceticism already lean banners toward
  script and geometry — one-line cross-link from creed to emblem genes.

### Motif grammar, generalized

Emblem tilework / motif machinery should not live only on shields. Same style
genome stamps:

- Pottery borders
- Textile patterns
- Coin faces (`hasCoin` exists → emblem + script numerals)
- Document borders

One aesthetic, many substrates — free coherence; engine already written.

### Music and cuisine — the fun tail

- **Music:** vocal tract + language prosody → chant/anthem (Lab toy first;
  sim ambient is a separate product decision — see `docs/music.md`).
- **Cuisine:** crop / livestock / spice state; dishes named by language compound
  machinery.

---

## 4. Data requirements — can it derive from existing sim state?

**Almost entirely yes.** The sim already simulates the hard parts:

- Köppen-calibrated biome classifier (`biomeClass.js`)
- Per-tile canopy state
- Full deposit system: timber, stone, copper/tin/iron, salt, horses, gems, coal,
  plus climate-banded luxuries (spices, furs, incense, **dyes**) — wealthy
  settlements demand and trade them over roads
- Crops with homeland biogeography and diffusion

The causes of material culture — what exists where, who affords it, how it
travels — are **live mechanics today**.

### What's missing: a vocabulary layer, not new simulation

**`materialsOf(world, tile)`** — a pure derived function splitting coarse
classes into named species. Classification, not mechanism — the same
legitimacy argument `biomeClass.js` makes for itself (*the analogue of Köppen,
not of the wind solver*).

| Coarse signal | Named derivation |
|---------------|------------------|
| Dyes deposit, hot coast | Shellfish purple |
| Dyes deposit, arid scrub | Madder, ochre |
| Boreal furs | Sable, fox |
| Timber | Conifer / oak / tropical hardwood off biome |
| Stone | Marble / granite / limestone off tectonic history |

**Zero new state**, no save-format change, no coverage burden — unless a name
is persisted on an entity (then it enters `collect()` like anything else).

### Against the original shopping list

| Item | Status |
|------|--------|
| Dyes, tree types, stone | Already located and traded; need naming pass only |
| Local animals | **Real gap** — horses are the only named beast. Fix: derived `wildFauna(world, tile)` pure function of biome (lions dry savanna, bears/elk boreal, crocodiles tropical rivers) for totems, epithets, hunting culture |
| Fibers (flax/cotton/silk/wool) | Not distinct yet; derivable from crops + herding + climate; silk as rare luxury (existing luxury-trade machinery carries Silk Road effect) |
| Phenotype, architecture form, dress form, festivals, cuisine, music | Need nothing new in the sim — vocabulary + renderers |

**Design tension (fauna on emblems):** `docs/emblems.md` deliberately
decoupled charges from realm-kind (*no lion because you're warlike*).
Fauna-biased charges are defensible differently — peoples blazon beasts they
**know** — but must stay a **soft prior** (like canting), or decoupling erodes.

Note: `materialsOf(people)` already exists in `musicGenome.js` for the Music
Lab's endowment chain — a **sim-wide** `materialsOf(world, tile)` would be the
same idea at map resolution, shared by dress, architecture, and coinage.

---

## 5. Priority order (original recommendation)

1. **Emblem Phases 1+2** — self-contained; flags go from session decoration to
   heritable identity.
2. **Phenotype clines / portraits** — biggest aesthetic payoff; carriers exist.
3. **`materialsOf` vocabulary** — cheapest; pure derivation.
4. **Architecture vignettes** — reads strongly on the map.
5. **Dress** — inside portraits anyway.
6. **Generalized motif substrates, cuisine, music ambient** — tail.

---

## 6. Status snapshot — what has changed since this plan was written

| Area | Then | Now (2026-08-30) |
|------|------|---------------------|
| Emblem Phases 1–4 | Planned | **Not started** — no `peopleSim/emblems.js`; `ui/emblems.jsx` still render-only |
| Language sim integration | Complete | Still complete; voice/IPA/tract work landed in Lab (recorded phone bank, formant calibration, prosody+accent layer — e.g. PR #73 thread) |
| Map heraldry | Dark | **Partial** — emblems draw on map when layer enabled (`WorldSim.jsx` + `emblems.jsx`) |
| UI overhaul | Blueprint | **Partial** — labels, codex, lens dock, heraldry layer per README |
| Music | Lab-only procedural | Extensive Lab work (map click → culture, atmosphere tuning); **sim still silent**; procedural ambient under review |
| Deploy / Labs | Single channel | **Multi-channel Pages** picker (`pages-site` branch, `/builds/`) — Music Lab + sim per preview channel |
| `materialsOf` | Proposed for sim | Exists **only** in `musicGenome.js` (Music Lab), not sim-wide |
| Bodies / portraits / architecture / dress | Planned | **Not started** |

**Parked, ready-to-start chunks:** emblem Phases 1+2, phenotype clines,
sim-wide `materialsOf`.

---

## 7. Related docs

| Doc | Topic |
|-----|-------|
| `docs/emblems.md` | Emblem engine mechanism catalogue |
| `docs/ui-overhaul-plan.md` | Shell redesign + §14 snapshot additions |
| `docs/language-comprehensive-spec.md` | Language capability bar |
| `docs/heraldry-symbol-library.md` | Charge vocabulary tiers |
| `docs/music.md` | Music Lab chain (separate thread) |
| `CLAUDE.md` | Cardinal rules — emergent state, build mechanism not outcome |
