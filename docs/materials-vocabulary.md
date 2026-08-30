# Materials vocabulary — minimal groundwork spec

Companion to `docs/aesthetics.md` §4. The sim already **places** timber,
stone, dyes, horses, spices, etc. on tiles (`resourceGen.js` →
`world.deposits`). This doc defines the **smallest** naming layer on top —
pure classification, no new simulation, no save-format change.

**One function target:** `tileMaterials(world, ti)` → `{ deposits, wood, stone,
dyes, fauna, fibre, crop, organics }` (all optional sub-arrays; empty if below
threshold).

Threshold default: deposit richness `≥ 0.12` (same as `pinFromWorldTile` in
`musicGenome.js`).

---

## Design rules

1. **Reuse existing ids** — the 14 tracked deposit names are the spine; never
   invent a parallel `oak_deposit` layer.
2. **Subtypes only where one deposit hides several real things** — timber →
   wood species; stone → lithology; dyes → vat family.
3. **One new derived axis** — `fauna` (wild game), because the sim only names
   horses today and uses timber as a forage proxy.
4. **Crops stay the six package ids** — `cropPackages.js` already names them.
5. **Settlement-only aliases stay out of tile query** — `bronze`, `silver`,
   `silk`, market `GOODS` categories are computed when a settlement/culture asks,
   not per tile.

---

## Tier 0 — deposit spine (14 types, zero new state)

Already on every tile as `world.deposits[id][ti]` ∈ [0,1]. PeopleSim tracks
these in `TRACKED_RES` (`state.js`).

| Id | Already placed by |
|----|-------------------|
| `timber` | Forest biomes + regional noise |
| `stone` | Mountains, highlands, desert exposures |
| `copper`, `tin`, `iron` | Scatter mines |
| `coal` | Temperate sedimentary basins |
| `salt` | Coastal pans, desert evaporites |
| `horses` | Steppe, savanna |
| `precious`, `gems` | Mines (finite reserve for specie wealth) |
| `spices` | Tropical / subtropical forest |
| `furs` | Taiga, boreal, tundra |
| `incense` | Desert, cold desert, shrubland |
| `dyes` | Coastal shellfish + warm wetlands (see Tier 2) |

**Exclude for now:** `oil` (worldgen only; no consumer).

**Implementation:** return `{ id, richness }` for each where richness ≥ τ. No
renaming.

---

## Tier 1 — wood types (3 names + 2 organics)

Split **`timber` deposit presence** + **biome** only. No new deposit layer.

| Type | When |
|------|------|
| `wood-conifer` | `timber ≥ τ` AND biome ∈ {taiga, boreal, tundra} |
| `wood-hardwood` | `timber ≥ τ` AND biome ∈ {temp forest, temp rain, subtrop, mediterranean} |
| `wood-tropical` | `timber ≥ τ` AND biome ∈ {trop rain, trop dry} |
| `bamboo` | biome ∈ {trop rain, trop dry} AND (timber ≥ τ OR moist > 0.6) — no separate deposit |
| `reed` | (`tFlood > 0.45` OR music-biome `delta`) AND moist > 0.5 |

**Do not add** (yet): oak/teak/mahogany as separate ids — three wood bands +
bamboo/reed cover dress, architecture, and emblem soft priors without a species
catalog.

---

## Tier 2 — stone types (3 names)

Split **`stone` deposit** + **elevation / biome**.

| Type | When |
|------|------|
| `stone-granite` | `stone ≥ τ` AND (elev > 0.35 OR relief high) |
| `stone-limestone` | `stone ≥ τ` AND (floodplain mask OR coast OR lowland moist) |
| `stone-sandstone` | `stone ≥ τ` AND biome ∈ {desert, shrubland, cold desert, savanna} |

Highland tiles with stone may return both granite and generic `stone` deposit —
granite is the *kind*, `stone` is the *economic signal*.

---

## Tier 3 — dye types (3 names)

Split the **single `dyes` deposit** using placement logic already in
`resourceGen.js` (lines 401–413): coastal shellfish vs wetland indigo.

| Type | When |
|------|------|
| `dye-tyrian` | `dyes ≥ τ` AND coast distance ≤ 4 tiles |
| `dye-indigo` | `dyes ≥ τ` AND wet biome (trop rain, subtrop, temp rain) AND moist > 0.5 |
| `dye-madder` | `dyes ≥ τ` AND NOT tyrian AND NOT indigo (warm land default — madder/kermes/ochre class) |

Maps cleanly onto emblem `DYE_VATS` families (madder, weld, indigo, Tyrian) for
cross-linking banner colour to local dyestuff **without** wiring vats to tiles
yet.

**Do not add** (yet): per-vat inventory (weld, saffron, woad as separate tile
types) — three bands are enough for trade flavour, dress, and status.

---

## Tier 4 — animal types (6 wild + 2 domestic)

### Domestic / economic (from existing signals)

| Type | When |
|------|------|
| `horses` | `deposits.horses ≥ τ` |
| `herd` | `livestockClimate(temp, moist) > 0.45` AND biome ∈ {steppe, savanna, grassland, mediterranean} |

`herd` = cattle/sheep/goats class — no separate species until herding mechanics
split them.

### Wild fauna (new derived classification — **only new vocabulary axis**)

Pure function of biome + coast + river + forest proxy. Does **not** affect food
mechanics initially (read-only for names, emblems, hunting flavour).

| Type | When |
|------|------|
| `fauna-steppe` | grassland, savanna, steppe |
| `fauna-forest` | temp forest, temp rain, boreal, taiga |
| `fauna-tundra` | tundra, ice margin |
| `fauna-river` | (trop/subtrop OR floodplain) AND riverMag ≥ 2 |
| `fauna-coast` | coast AND elev > 0 (fish/seal class) |
| `fauna-desert` | desert, cold desert, shrubland |

**Overlap rule:** return **all** that match (a Nile floodplain tile can be
`fauna-river` + `herd`). Emblem fauna-bias uses soft priors, not exclusivity.

**Do not add** (yet): lion vs leopard vs bison as separate ids — six buckets
match biome grammar already used elsewhere.

---

## Tier 5 — plant / crop types (6 + 2 fibre)

### Staple crops — use existing package ids

From `bestPackageAt(world, ti)` / `pkgSuitAt` when suitability > threshold:

`wheat` · `rice` · `maize` · `sorghum` · `millet` · `tubers`

No new plant names. Optional metadata: `{ crop: "rice", suit: 0.82 }`.

### Luxury plants — deposit ids (already Tier 0)

`spices` · `incense` — return as deposit spine, not renamed.

### Fibres — pure climate (from `craftLegs` logic)

| Type | When |
|------|------|
| `fibre-wool` | temp band ≈ craftLegs wool peak (|temp − 0.45| small) |
| `fibre-cotton` | warm + wet band ≈ craftLegs cotton |

**Defer:** `flax`, `silk`, `gourd` as tile types — gourd already under organics
if needed for tropics; silk needs sericulture (settlement/org gate, not tile).

---

## Tier 6 — explicitly NOT in tile vocabulary

Keep these at settlement/query time so tile function stays small:

| Name | Why not per-tile |
|------|------------------|
| `bronze`, `iron-worked`, `silver` | Need metallurgy + two deposits |
| `silk` | Sericulture / org gate, not mapped |
| `clay` | Biome inference only; no deposit (same as music BIOMES) |
| `GOODS[]` market categories | Settlement `gProd` / `gDem` — economy vector |
| `hide`, `horn`, `bone`, `gut` | Processed from `herd` / `fauna` + craft |

Music Lab's `MATERIALS` / `materialsOf(people)` stays a **consumer** of this
vocabulary, not a second catalog.

---

## Return shape (minimal API)

```js
// src/sim/tileMaterials.js (proposed)
export function tileMaterials(world, ti, { threshold = 0.12 } = {}) {
  return {
    deposits: [ /* { id, richness } × up to 14 */ ],
    wood:     [ /* 0–3 of conifer|hardwood|tropical */ ],
    stone:    [ /* 0–3 of granite|limestone|sandstone */ ],
    dyes:     [ /* 0–3 of tyrian|indigo|madder */ ],
    fauna:    [ /* 0–6 wild buckets + optional herd|horses */ ],
    fibre:    [ /* 0–2 wool|cotton */ ],
    crop:     { id, suit } | null,   // best package at tile
    organics: [ /* bamboo|reed if present */ ],
  };
}
```

Pure function. No writes. Safe to call from map click, emblem canting, codex
flavour text, future portrait dress — all read-only.

---

## Count summary

| Category | New type strings | New simulation |
|----------|------------------|----------------|
| Deposits | 0 (reuse 14 ids) | none |
| Wood | 3 + 2 organics | none |
| Stone | 3 | none |
| Dye | 3 | none |
| Fauna | 6 wild + 2 domestic | none (classification only) |
| Crop | 0 (reuse 6 ids) | none |
| Fibre | 2 | none |
| **Total distinct vocabulary** | **~29** | **0 new tile fields** |

---

## Implementation order (smallest steps)

1. **`tileMaterials.js`** — Tier 0 deposits + Tier 1–3 splits + Tier 5 crop/fibre.
2. **Tests** — deterministic fixtures: Nile floodplain tile, taiga tile, coastal
   desert tile → snapshot expected vocabulary arrays.
3. **Wire one consumer** — codex settlement inspect line ("Local materials: …")
   or Music Lab `pinFromWorldTile` refactor to import shared module.
4. **Tier 4 fauna** — add when emblem soft-prior or hunting flavour needs it.
5. **Do not** add new `resourceGen` layers, trade goods, or save state until a
   consumer requires persistence.

---

## Related

- `src/sim/resourceGen.js` — placement
- `src/sim/musicGenome.js` — `pinFromWorldTile` prior art
- `src/sim/emblemGenome.js` — `DYE_VATS` colour families
- `src/sim/cropPackages.js` — six staple ids
- `docs/aesthetics.md` — why this layer exists
