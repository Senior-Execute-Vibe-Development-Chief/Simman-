# Materials vocabulary — specific named catalog

Companion to `docs/aesthetics.md`. The sim already **places** deposits on tiles
(`resourceGen.js`). This layer answers: *what specifically grows, lives, and is
 dug here?* — oak not "hardwood", lions not "savanna fauna", Tyrian purple not
`dyes`.

Still **classification only**: no new deposit arrays, no save-format change.
Where several species fit one tile, a **seeded pick** chooses a primary (and
optional secondary) so the same tile is stable across reloads:

```js
pick(species[], world.seed, ti, tag)  // hash32 → index
```

Threshold: deposit richness `≥ 0.12` unless noted.

---

## API shape

```js
tileMaterials(world, ti) → {
  deposits:  [{ id, richness }],     // economic spine (14 ids)
  trees:     [{ id, richness }],     // named species
  stone:     [{ id, richness }],
  dyes:      [{ id, richness }],
  fibres:    [{ id, suit }],         // wool, cotton, flax, hemp, silk
  crops:     [{ id, suit }],          // up to 2 competitive packages
  spices:    [{ id, richness }],
  incense:   [{ id, richness }],
  furs:      [{ id, richness }],
  fauna:     [{ id, abundance }],     // 0–1, not a deposit
  gems:      [{ id, richness }],      // optional split of gems deposit
  metals:    [{ id, richness }],      // optional split of precious deposit
}
```

---

## Tier 0 — deposit spine (unchanged, 14 ids)

`timber` · `stone` · `copper` · `tin` · `iron` · `coal` · `salt` · `horses`
· `precious` · `gems` · `spices` · `furs` · `incense` · `dyes`

Skip `oil` until consumed. These remain the **trade/mining** signals; named
types below are the *flavour layer* players and aesthetics read.

---

## Trees (16 named species)

Requires `timber ≥ τ` for forest trees unless noted. Eligible set → `pick()`.

| Id | Eligible when |
|----|----------------|
| `pine` | taiga, boreal, cold highland |
| `spruce` | taiga, boreal |
| `larch` | taiga, cold continental |
| `birch` | boreal, tundra edge, temp forest (cold side) |
| `oak` | temp forest, temp rain, subtrop, mediterranean |
| `beech` | temp forest, temp rain (moist > 0.45) |
| `teak` | trop rain, trop dry (timber ≥ τ) |
| `mahogany` | trop rain (moist > 0.65, timber ≥ τ) |
| `palm` | trop dry, desert coast, savanna (moist > 0.25) |
| `olive` | mediterranean, dry subtrop shrubland |
| `acacia` | savanna, hot shrubland, desert fringe |
| `mulberry` | subtrop, temp rain, floodplain — **silk precursor** (see fibres) |
| `bamboo` | trop rain, trop dry, subtrop wet — no timber required |
| `reed` | floodplain / `tFlood > 0.45` / delta wet |
| `date-palm` | desert, cold desert — coast or riverMag ≥ 1 |
| `cedar` | mediterranean, highland leeward, temp dry |

**Return:** 1–2 trees: primary = `pick(eligible)`, secondary = second pick if
richness top quartile within biome.

---

## Stone (7 named lithologies)

Requires `stone ≥ τ` unless noted.

| Id | Eligible when |
|----|----------------|
| `granite` | elev > 0.30 OR high relief |
| `limestone` | lowland, coast, floodplain, moist > 0.4 |
| `marble` | granite-eligible AND temp > 0.65 AND moist 0.35–0.55 (metamorphic belt proxy) |
| `sandstone` | desert, shrubland, savanna, cold desert |
| `slate` | highland AND moist > 0.45 |
| `basalt` | plate boundary prox (`boundDist < 8`) AND elev > 0.08 |
| `flint` | chalk belt proxy: limestone-eligible AND temp 0.60–0.75 |

---

## Dyes (7 named vats)

Requires `dyes ≥ τ`. Split using `resourceGen` placement (coastal vs wetland vs
arid). Maps to emblem `DYE_VATS` families.

| Id | Eligible when |
|----|----------------|
| `tyrian` | coast dist ≤ 4 AND dyes ≥ τ |
| `indigo` | wet biome (trop rain, subtrop, temp rain) AND moist > 0.5 AND dyes ≥ τ |
| `madder` | temp grassland, mediterranean, dry subtrop AND dyes ≥ τ (not indigo) |
| `weld` | temperate AND moist 0.35–0.55 AND dyes ≥ τ |
| `ochre` | desert, shrubland, savanna — iron-rich ground (no dyes deposit required; weak abundance from stone/desert) |
| `cochineal` | trop dry, subtrop dry AND dyes ≥ τ |
| `kermes` | mediterranean, shrubland AND dyes ≥ τ |

---

## Fibres (5 named)

| Id | Eligible when |
|----|----------------|
| `wool` | temp band \|t − 0.45\| < 0.12 AND livestockClimate > 0.35 |
| `cotton` | t > 0.55 AND moist > 0.4 (craftLegs cotton band) |
| `flax` | temp 0.58–0.78 AND moist 0.35–0.65 |
| `hemp` | temp > 0.52 AND moist > 0.45 (river bonus if riverMag ≥ 1) |
| `silk` | **mulberry** tree eligible AND (subtrop OR temp rain) AND moist > 0.45 — sericulture belt; no new deposit |

`silk` is the main addition beyond deposits: it chains off **mulberry** tree
classification, not a `silk` deposit.

---

## Crops (6 named — existing ids)

From `bestPackageAt` / per-package `pkgSuitAt`. Return up to **two** with suit > 0.25:

`wheat` · `rice` · `maize` · `sorghum` · `millet` · `tubers`

---

## Spices (5 named)

Requires `spices ≥ τ`. Split by biome + noise pick:

| Id | Eligible when |
|----|----------------|
| `pepper` | trop rain, trop dry |
| `cinnamon` | trop rain (moist > 0.6) OR subtrop wet |
| `cloves` | trop rain, high moist |
| `nutmeg` | trop rain island proxy: coast ≤ 6 AND trop rain |
| `ginger` | subtrop, trop dry (monsoon fringe) |

---

## Incense (4 named)

Requires `incense ≥ τ`.

| Id | Eligible when |
|----|----------------|
| `frankincense` | desert, shrubland |
| `myrrh` | desert, hot shrubland (drier than frankincense band) |
| `sandalwood` | trop dry, subtrop (incense ≥ τ) |
| `olibanum` | cold desert, high desert |

---

## Furs (5 named)

Requires `furs ≥ τ`.

| Id | Eligible when |
|----|----------------|
| `sable` | taiga, boreal |
| `ermine` | tundra, cold boreal |
| `fox` | boreal, taiga, tundra edge |
| `beaver` | boreal, temp forest — riverMag ≥ 2 |
| `seal` | coast AND temp < 0.55 (cold coast; abundance from coast not furs deposit) |

---

## Fauna — specific animals (22 named)

**Not deposits.** Abundance 0–1 from biome + climate + river/coast. Return 2–4
species per tile (primary predator, primary herd, river/coast if applicable).

### Big game & predators

| Id | Eligible when |
|----|----------------|
| `lion` | savanna, grassland — temp > 0.70, moist 0.25–0.55 |
| `leopard` | savanna, shrubland, trop dry edge |
| `tiger` | trop rain, subtrop forest — moist > 0.55 |
| `bear` | boreal, taiga, temp forest — moist > 0.35 |
| `wolf` | boreal, steppe, temp forest edge — cold season proxy temp < 0.72 |
| `hyena` | savanna, dry shrubland |

### Herd & pastoral

| Id | Eligible when |
|----|----------------|
| `horse` | `horses` deposit ≥ τ OR steppe/grassland |
| `cattle` | grassland, savanna, mediterranean — livestockClimate > 0.45 |
| `bison` | grassland, cold steppe — temp 0.45–0.70 |
| `camel` | desert, cold desert, arid shrubland |
| `elephant` | savanna, trop dry — moist > 0.30 |
| `reindeer` | tundra, taiga edge — temp < 0.58 |

### Forest & steppe game

| Id | Eligible when |
|----|----------------|
| `deer` | temp forest, boreal, temp rain |
| `elk` | boreal, taiga, cold temp forest |
| `antelope` | steppe, grassland, savanna dry band |
| `boar` | temp forest, mediterranean, subtrop |

### River, coast, wetland

| Id | Eligible when |
|----|----------------|
| `crocodile` | trop/subtrop AND riverMag ≥ 2 OR floodplain |
| `hippo` | savanna/trop AND riverMag ≥ 3 AND moist > 0.45 |
| `fish` | coast OR riverMag ≥ 1 |
| `salmon` | coast OR river — temp 0.45–0.65 (anadromous proxy) |

**Emblem rule:** fauna names may **soft-bias** charge choice (like canting); never
hard-assign ("lion because warlike" stays forbidden).

---

## Gems & precious metals (optional splits)

When deposit ≥ τ, use hash pick among eligible:

**Gems:** `ruby`, `sapphire`, `emerald`, `diamond`, `pearl` (pearl: coast +
gems or coastal rich tile)

**Precious:** `gold`, `silver` — gold if riverMag ≥ 2 OR elev > 0.15; silver if
highland + precious without strong river (Altiplano proxy)

---

## Salt & coal (named when present)

| Id | When |
|----|------|
| `rock-salt` | salt ≥ τ, interior |
| `sea-salt` | salt ≥ τ, coast ≤ 3 |
| `coal` | coal ≥ τ (no subtypes needed) |

---

## Count summary

| Category | Named ids |
|----------|-----------|
| Deposits (spine) | 14 |
| Trees | 16 |
| Stone | 7 |
| Dyes | 7 |
| Fibres | 5 |
| Crops | 6 |
| Spices | 5 |
| Incense | 4 |
| Furs | 5 |
| Fauna | 22 |
| Gems | 5 |
| Metals | 2 |
| Salt | 2 |
| **Total named vocabulary** | **~100** |

Still **zero new simulation fields** — one pure function + deterministic picks.

---

## Example outputs

**Nile floodplain tile** (delta, flood, moist, dyes possible):
- trees: `mulberry`, `reed`
- stone: `limestone`
- dyes: `indigo`, `tyrian` (if coast near)
- fibres: `flax`, `cotton`, **`silk`**
- crops: `wheat`, `rice` (competitive suits)
- fauna: `crocodile`, `hippo`, `fish`, `cattle`

**Sahel savanna:**
- trees: `acacia`
- fauna: **`lion`**, `antelope`, `cattle`, `elephant`
- crops: `sorghum`, `millet`
- fibres: `cotton`

**Scandinavian boreal:**
- trees: `pine`, `spruce`
- furs: `sable`, `fox`
- fauna: `bear`, `elk`, `wolf`, `reindeer`
- fibres: `wool`

---

## Implementation notes

1. **`src/sim/tileMaterials.js`** — one module; import `classifyBiome`,
   `bioTemp`, deposit arrays, `livestockClimate`, crop helpers, `hash32`.
2. **Deterministic picks** — never `Math.random`; same seed + tile → same oak.
3. **Tests** — golden tiles: Nile, Sahel, boreal, Tyrian coast, mulberry/silk belt.
4. **Consumers** — codex inspect line, emblem soft priors, Language Lab place
   epithets, eventual portraits.
5. **Music Lab** — refactor `pinFromWorldTile` materials from shared module later.

---

## Related

- `docs/aesthetics.md` — why this layer exists
- `src/sim/resourceGen.js` — deposit placement comments (spices, dyes, furs)
- `src/sim/emblemGenome.js` — `DYE_VATS`
- `src/sim/musicGenome.js` — prior art for tile pinning
