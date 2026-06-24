# Design: Dissolving Farming Regions — Towns as the Atomic Unit, Identity as a Field

Status: **proposal / not started**. This is a design doc to decide against, not a commitment.

## 1. Motivation

The sim currently models the countryside as a swarm of tier-0 **Farming Region**
entities. With dense river-valley settlement (the floodplain work) this produces
*far too many* entities: a cluttered map, more save bulk, and per-settlement loops
that scale with the village count.

The proposal: **delete tier-0 farming-region entities entirely.** Towns (tier 1)
and up become the only settlement entities. The countryside becomes *worked land*
attributed to whichever town owns it, and the rural population + cultural identity
of that land becomes **per-tile field data**, not entity data.

Goal: fewer entities, a cleaner map, a faster sim, and — as a bonus — a *more*
realistic identity model (continuous dialect/faith gradients instead of blocky
per-village values).

## 2. What farming regions actually do today (and where it must go)

Survey result: only **three** things are truly bound to tier-0. Everything else
(culture, faith, language, tech, trade, conquest) is incidental — tier-0 carries
it only because it *holds the rural population*.

| Tier-0 role | Today | Re-homed to |
|---|---|---|
| **Food production** | only tier ≤ `FARM_MAX_TIER` farms; `_storableSupply` ships up the `liegeId` tree (`foodHierarchy.js`) | the owning **town's territory** is auto-farmed; food = Σ worked tiles in its catchment |
| **Rural population + urban transition** | tier-0 capped at `URBAN_CAP`; ~90% of carrying capacity locked rural, surplus migrates up (`urbanise()`) | a **rural-population number on the town** (split urban-core vs hinterland), or a per-tile density field |
| **Urban genesis** | a region births a town in its catchment (`maybeUrbanGenesis`) | a town spawns a **daughter town** when its hinterland is large/distant enough |
| culture / faith / language | `s.culMix/faithMix/langMix` top-`MIX_K` mixtures, drift + assimilate per settlement | **per-tile mixture fields** that diffuse (§4, §5) |
| tech / trade / conquest / state adoption | standard settlement behaviour | unchanged — lives on towns |

## 3. Target model in one paragraph

The world is a set of **town+ entities** (the registries — cultures, faiths,
dynasties, polities — are unchanged). Each town owns a cost-Voronoi **territory**
of land tiles (already computed in `territory.js`). Each *land tile* carries:
its worked fertility (already `world.fert`), a **rural population density**, and a
**top-k identity mixture** for culture, faith, and language. Food is the sum of a
town's worked tiles; population is the town's urban core plus the rural density in
its territory; identity is read/written as a field that **diffuses** over the grid,
anchored to the political owner and seeded by towns, cradles, and trade endpoints.

## 4. Data model

### 4.1 The registry / geography split

- **Registries stay as entities** (no change): `cultures.js`, `faiths.js`,
  languages, dynasties — the *named* things with phonology, lineage, founding,
  schism. A few hundred objects. This is the interesting identity logic and it is
  untouched.
- **Geography becomes per-tile fields.** What used to be `s.culMix` on each
  farming region becomes a field indexed by tile.

### 4.2 Per-tile identity fields

Keep the existing top-`k` mixture idea (`MIX_K = 4`) but store it column-wise in
typed arrays for cache-friendliness and compact saves. For each of the three
layers (culture, faith, language), for `N = tw*th` tiles and `K = 4`:

```
cultureId  : Int16Array(N*K)    // registry ids, -1 = empty slot, slot 0 = dominant
cultureShr : Uint8Array(N*K)    // share quantised to 0..255 (÷255 = fraction), Σ slot = 255
```

Memory: `N≈460k × K=4 × (2+1 bytes) × 3 layers ≈ 16 MB`. Fine. (Land-only packing
via an index map cuts it to ~5 MB if needed.)

Precedent in this codebase: `world.ancestry` is already a per-tile `Int16Array`
identity field; `_soilFatigue`, `_countryOwner`, `roadQuality` are per-tile fields
that *mutate on intervals*. Per-tile dynamic state is routine here.

### 4.3 Rural population

Two options; recommend **(A)** for the first cut, **(B)** if texture demands it:

- **(A) Town attribute.** Each town carries `urbanPop` and `ruralPop`. `ruralPop`
  is bounded by the carrying capacity of its territory (Σ worked-tile food, the
  old `_k` math but summed over the catchment). The urban/rural split + farm→city
  drift becomes a per-town update instead of an inter-entity migration — the
  `URBAN_CAP` / `ruralFrac` logic from `urbanise()` moves onto the town.
- **(B) Per-tile density field.** `ruralDensity : Float32Array(N)`. More texture
  (uneven countryside), needed only if (A)'s single rural number feels too smooth.
  Identity diffusion can weight by this (denser land carries more cultural inertia).

### 4.4 Food re-homing

`updateFood`'s land-food math is unchanged per tile; it's just **attributed to the
owning town**, not a region entity. Delete the `liegeId` hierarchy (`foodHierarchy.js`)
— there is no village→town shipping any more, because the town directly owns and
sums its hinterland. `_storableSupply`/`_foodNet` collapse into one per-town
`food` from its territory. (City-fed-by-hinterland is now *intrinsic*: the town IS
its hinterland.)

## 5. The passes that replace the per-entity dynamics

Each runs as an O(N·K) stencil over the grid on an interval (cheap — the shape of
the existing moisture/wind solvers), not heavy per-tick logic.

1. **Assimilation** (`cultures.js` ASSIM toward ruler): each tile relaxes its
   culture mix a step toward its political owner's state culture. Owner is
   `_countryOwner[tile]` (already there); rate scales by org × time, as today.
2. **Faith conversion** (`faiths.js`, spread along trade): diffuse faith mix to the
   4/8 neighbours **+ inject** at trade-link endpoints (the trade graph still
   exists between towns; its endpoints seed faith into their tiles, which then
   diffuses outward). Schism still fires at the registry level.
3. **Language drift / lingua franca**: diffuse toward the dominant local mix and the
   capital's prestige tongue (the `CONVERGE_RATE` logic as a field relaxation).
4. **Migration / colonisation / conquest carry identity**: when population moves
   (settler party founds a town, an army flips ownership), **deposit** the source
   tiles' mix into the destination tiles, weighted by the number moved.
5. **Genesis / divergence**: a cradle stamps a new culture/faith id onto its tiles;
   a tile-cluster that loses trade/▾political contact with its parent spawns a
   **daughter** registry entry (the existing colonial-divergence rule, keyed on a
   connected-component check over tiles instead of over settlements).

Truncation: diffusion creates many tiny shares; after each pass renormalise and
keep the top-`K` per tile (fold the tail into the dominant slot). This is the only
fiddly bit.

## 6. Staged migration (sim stays runnable at every step)

Do **not** big-bang this. Five stages, each independently shippable and testable:

- **Stage 0 — Field mirror (no behaviour change).** Allocate the per-tile identity
  fields. After each existing per-settlement identity pass, *write* each
  settlement's `culMix/faithMix/langMix` into its catchment tiles (a mirror). Add a
  smoke/validate check that the field matches the entities. Nothing reads the field
  yet. Risk: ~zero.
- **Stage 1 — Render from the field.** Switch the Peoples / Faiths / Language
  **lenses** to colour from the per-tile field instead of splatting per settlement.
  Visual-only; the field is still entity-derived. This proves the field is correct
  and gives the cleaner-looking map immediately.
- **Stage 2 — Field owns the dynamics.** Flip assimilation / conversion / language
  to run as the field diffusion passes (§5). Entities now *read* their dominant
  identity from the field under them (for naming a new town, a ruler's culture,
  etc.) instead of carrying their own mix. Delete the per-settlement mix arrays.
  Validate against the stylized-facts suite (faith spread, language families).
- **Stage 3 — Food + population off the hierarchy.** Move food to per-town
  territory sums; delete `foodHierarchy.js` and the `liegeId` tree. Add `ruralPop`
  to towns (option A). Re-home `URBAN_CAP`/`ruralFrac` and urban genesis onto towns.
  This is the heavy stage; gate it behind a lever so it can be A/B'd against the
  old model on the same seed.
- **Stage 4 — Delete tier-0.** Stop spawning farming-region entities entirely;
  crystallisation now spawns only towns (the floodplain sampling/spacing work still
  applies, just at town granularity). Remove tier-0 branches throughout. The map is
  now towns over a worked-land + identity field.

Each stage keeps `npm test` (determinism, invariants, save/load) and `npm run
validate` (stylized facts) green. If a stage regresses the history-shape, stop
there — the staging means you've already banked the cheaper wins (cleaner render).

## 7. Costs & risks (honest)

- **Save size** — the one real growth. The identity field is dynamic (not seed-
  regenerable), so it must serialise. ~5–16 MB raw; quantise shares to bytes + RLE
  the long single-culture runs (most of the map is one dominant culture) → likely
  back under ~1–2 MB. `persist.js` versioning + the save/load hash test cover it.
- **Determinism** — the diffusion is a seeded stencil; deterministic by construction.
  Keep it in its own RNG substream (`rng.js`) so it doesn't perturb other dice.
- **Top-k churn** — renormalise/truncate every pass; watch for share-thrashing at
  frontiers (a tile flipping dominant culture every pass). Hysteresis (only flip
  dominant past a margin) fixes it.
- **Loss of fine rural texture** — option (A)'s single `ruralPop` per town is
  smoother than per-village. If that reads too uniform, go to (B) (per-tile density)
  — but only if needed.
- **Refactor surface** — food, population, urban genesis, and every `tier === 0`
  branch. The staging contains this; stages 0–2 are low-risk and already worth it.

## 8. Recommendation

Stages **0–2 are worth doing regardless** of the full refactor: they give the
cleaner map and the better (field-based) identity model with near-zero risk, while
*keeping* the farming-region entities underneath. Run those first. Only commit to
stages **3–4** (the economic refactor that actually deletes tier-0) if, after
seeing 0–2, the entity model itself is still the objection — at which point the
field is already proven and the rest is mechanical.
