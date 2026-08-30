# Earth map — materials, fauna, geology, ocean, climate

The plan to get named resources **realistically placed** on the Earth preset.
Companion to `docs/materials-vocabulary.md` (the named catalog) and
`docs/aesthetics.md` (why this layer exists).

This is **Earth only** (`preset === "earth"` / `"earth_sim"`). Procedural maps
get climate analogues + a landmass lottery; they are out of scope here except
where the same code path is shared.

**Ideal state:** clicking a Nile tile, a Sahel tile, a Baltic coast, or a
Japanese arc reads *the right named things* — oak vs teak, lion vs tiger,
obsidian vs amber, olive vs date-palm, Tyrian vs indigo — from tile state, not
from a script that names the place.

---

## 0. The rule — what goes on the map

A map resource answers **"what grows, dwells, or sits HERE?"** from geology,
climate, and ecology.

| On the map | Not on the map (craft) |
|------------|------------------------|
| clay, limestone, mulberry, grapevine, elephant | brick, plaster, silk thread, wine |
| copper + tin deposits | bronze |
| flax plant, pastoral wool zone | linen, felt, broadcloth |
| sand, natron, kaolin | glass, porcelain |

Derived goods stay a later craft layer. This plan never adds them as deposits.

**Legitimacy (cardinal rules):** Earth pins are the same class as
`EARTH_HEARTH_SITES` and crop `PACKAGE_ORIGINS` — a **preset-gated diorama
input** (real-world fact), not an emergent target. No `if (Nile)`, no year
gates. Climate eligibility is always global; presence is what the Earth layer
restricts.

---

## 1. Where we are

| Already true on Earth | Missing |
|-----------------------|---------|
| Heightmap (`earthData.js`) | Named `tileMaterials(world, ti)` — spec only |
| Köppen-calibrated biomes (`biomeClass.js`, ~79% agreement) | Fauna/flora **endemism** (tiger in Amazon) |
| Deposits: 14 ids in `resourceGen.js` (timber, stone, metals, salt, horses, gems, spices, furs, incense, dyes) | Geology from **real plate boundaries** (Earth has no `pixPlate`) |
| Crop packages + optional homeland biogeography (`biogeography.js`) | Ocean / coastal **marine biomes** (reef vs muddy shelf vs deep) |
| `summerDry` field; **correct under Real Climate** (`fillRealClimate`) | Mediterranean biome **disabled** (`MED_ENABLED = false`) even when the field is good |
| Coast distance, `riverMag`, `tFlood`, `livestockClimate` | Altitude bands for tea/coffee/yak; coast subtype |
| Landmass labels (`landComp` / `landLabels`) | Unused for ecology |
| NCEP precip + airtemp (`data/global_*.json`) | Plate-boundary dataset (not in repo) |

The economic spine is live. The flavour layer — oak, lions, Tyrian, marble,
obsidian — is not classified yet, and several Earth-specific signals are
missing so classification would be **ecologically plausible and geographically
wrong**.

---

## 2. Ideal state (what “done” looks like)

A pure function:

```js
tileMaterials(world, ti) → {
  deposits, trees, stone, dyes, fibres, crops,
  spices, incense, furs, fauna, gems, metals,
  marine,        // coastal / shelf ids when in range
  geology,       // volcanic, evaporite, metamorphic flags + named minerals
}
```

On an Earth + Real Climate world:

- **Nile floodplain:** reed, papyrus, limestone, flax, wheat, crocodile, cattle
- **Sahel:** acacia, sorghum/millet, lion, elephant, cattle, cotton
- **Scandinavian boreal:** pine/spruce, sable, bear, elk, wolf, wool
- **Levant / Maghreb west coast:** olive, grapevine, kermes or madder, limestone
- **Moluccas:** nutmeg, cloves (not every trop-rain coast)
- **Andes volcanic arc:** obsidian, sulfur; **not** African savanna fauna
- **Baltic coast:** amber (not a plate product)
- **Persian Gulf / Dead Sea class basins:** evaporites, pearl on the warm shallow coast
- **Ring of Fire land:** obsidian/pumice; **Hawaii** via hotspot list, not plate edge

Same seed + tile → same names (`hash32`). Zero new save fields unless a name is
later persisted on an entity.

---

## 3. Workstreams

Five workstreams. 3–5 are Earth-data inputs; 1–2 are classification on top.
Do them in the order in §8.

### 3.1 Named classification — `src/sim/tileMaterials.js`

**What:** One module. Import `classifyBiome`, deposit arrays, `livestockClimate`,
`pkgSuitAt` / `bestPackageAt`, `hash32`. Return the API in §2.

**Rules:** Climate eligibility first; then presence (endemism, geology, marine);
then deterministic pick among eligible.

**Not:** New `Float32Array` deposits. Splits of existing 14 ids + derived fauna
abundance.

**Tests:** Golden tiles (fractional Earth coords, same class as hearth pins):
Nile, Sahel, Yellow River, Mesoamerica, Baltic, Tyrian Levant coast, Java arc,
Moluccas, Patagonia, Tibetan fringe.

---

### 3.2 Endemism — `src/sim/faunaBiogeography.js`

Mirror `peopleSim/biogeography.js`. Climate says *could live here*; presence
says *does*.

**Earth:** pinned origins as fractional `fx, fy` (+ optional radius / reach),
same admissibility as `PACKAGE_ORIGINS`. Multi-region species get multiple
seeds (elephant: Africa **and** South/SE Asia).

```js
faunaPresent(world, ti, speciesId)
climateEligible(world, ti, speciesId)
```

Build once, cache on world (distance field or landmass ∩ bbox). Query is O(1)
or a precomputed bitmask.

**Also for plants, not only animals:** tea, coffee, cocoa, vanilla, capsicum,
nutmeg/cloves, maize-at-dawn, mulberry/sericulture belt, frankincense/myrrh
core. Same module or a thin `floraBiogeography` sharing the distance helper.

**Do not:** flood-fill paint continents by hand. Use existing `landLabels` /
`landComp` plus origin reach. “Lions in Africa” = origin cluster + savanna
climate + Afro-Eurasia component, not a bitmap of Africa.

**Procedural (out of scope for this doc, one sentence):** landmass × archetype
lottery — which savanna continent gets lion vs leopard — so the function is
not Earth-only.

---

### 3.3 Geology from real plate boundaries

Earth currently has **no** `pixPlate`. `resourceGen.js` BFS for `boundDist`
never starts; copper/gems/young-soil get no tectonic nudge.

**Do this:**

1. **Download** a public plate dataset (Bird 2003 / PB2002, or USGS / MORVEL):
   polygons + **typed** boundary segments (subduction, collision, ridge/rift,
   transform).
2. Convert once (`tools/convert_plates.py` analogue of
   `tools/convert_climate_data.py`) → compact JSON, same lon/lat convention as
   NCEP (`realClimateData.js` Date Line offset).
3. Rasterize at worldgen onto the Earth grid → `pixPlate[]` + `boundKind[]`.
4. **Reuse** existing `boundDist` BFS. Geology is then a classification:

| Input | Output |
|-------|--------|
| Near **subduction** | volcanic arc → obsidian, pumice, sulfur, young soil |
| **Continent–continent** collision | metamorphic → marble, slate, jade-class proxy |
| **Land rift** | basalt, sulfur; arid closed basin → natron |
| **Transform** | weak / skip volcanism |
| Hotspot **points** (~20, not in the plate file) | Hawaii, Yellowstone, Afar, Iceland (partly) |

This is **simulation from observed plates**, not pinning “Andes = volcanoes.”
The heightmap stays the heightmap; plates do not rebuild mountains.

**Still not from plates (keep climate / coast / small pins):**

- evaporites (arid closed basin — mostly already modellable)
- amber (Baltic fossil coast)
- coal, oil, limestone (sedimentary history)
- quarry-specific marble names

**Hotspots** are a tiny extra list. They are not plate edges; skipping them
deletes Hawaii/Yellowstone volcanism.

---

### 3.4 Ocean and coastal biomes

Land biomes stop at the shore. Pearl, coral, Tyrian, whale, shelf fisheries
need **water classification**. Earth already has:

- ocean tiles (`elev ≤ 0`)
- shallow vs deeper negative elevation on the Earth heightmap
- coast distance, open-ocean mask, gyre SST anomalies in `worldgen.js`

**Do not** download a second global bathymetry unless the heightmap depth
proxy is too coarse after measurement.

**Do** classify:

```
land coast     →  rocky / estuary-mud / mangrove / dune
nearshore sea  →  shelf / reef (warm shallow) / upwelling / enclosed sea
open ocean     →  polar / temperate / tropical gyre / deep
```

Signals: `elev` (depth), `coastDist`, latitude, existing current/SST fields,
optionally Real Climate. Reef ≈ warm + shallow + open-enough coast; Tyrian ≈
warm enclosed/eastern Med class coast + dyes deposit; pearl ≈ warm shallow
shelf; whale ≈ cold productive (upwelling or high-lat).

Expose as `marine[]` on `tileMaterials` for coastal **land** tiles (and maybe
the first ring of ocean if anything ever queries it). Fish richness in
`settlement.js` can later read the same classifier instead of a separate shape.

---

### 3.5 Mediterranean climate

`B_MEDITERRANEAN` exists. It is **off**:

```119:119:src/sim/biomeClass.js
const MED_ENABLED = false;
```

Reason (already documented there): the **solver’s** `summerDry` is zonally
uniform — it cannot make west-coast Cs. Turning the branch on under the solver
paints fake Med all over the map.

**Earth + Real Climate** already writes a truthful `summerDry` from monthly
NCEP (`fillRealClimate`). The classifier path is wired.

**Do:** enable the Med branch when observed climate is active
(`world._realWindGen` / real-climate flag), not when the solver produced the
fields. Re-run `tools/probe_climate_truth.mjs` and check the MED column
against the ~0.9% land truth row (the comment in `biomeClass.js` is the gate).

Unlocks on Earth: olive, grapevine, cork-oak, cypress, kermes, saffron-class
belts — without waiting for a solver storm-track rewrite.

**Do not** (in this plan): fix the moisture solver’s seasonal west-coast high.
That is a separate climate project; it is what procedural maps need for real
Cs. Earth does not have to wait for it.

---

### 3.6 Smaller Earth signals (same pass as 3.1–3.4)

| Signal | Why | How |
|--------|-----|-----|
| **Altitude band** | tea, coffee, yak, ibex, cedar | `elev` + temp (lapse already in the temperature field) — explicit montane helper |
| **Coast subtype** | overlaps 3.4 | don’t invent a third coast field; marine classifier covers it |
| **Hemisphere / latitude** | palm vs reindeer sanity | tile `y` → lat; soft gate, not a script |
| **Growing season** | wheat vs maize at cradles | already designed in `docs/design-growing-season.md` — not duplicated here; materials should **read** crop packages, not re-derive them |

---

## 4. Map-placable catalog (Earth)

What `tileMaterials` should be able to name. In-spec today ≈ the current
`materials-vocabulary.md` (~100). Gaps are the expansion to ~180–200.
**Derived crafts are omitted.**

### 4.1 Deposits (spine — already placed)

timber · stone · copper · tin · iron · coal · salt · horses · precious · gems ·
spices · furs · incense · dyes · *(oil unused)*

**Named splits / extra minerals:** gold, silver, rock-salt, sea-salt, ruby,
sapphire, emerald, diamond, lead, cinnabar, sulfur, natron, alum, niter,
asphalt/bitumen, bog-iron (wet-lowland iron).

### 4.2 Stone and earth

**Lithology:** granite, limestone, marble, sandstone, slate, basalt, flint,
porphyry, alabaster, travertine, chalk, soapstone, serpentine.

**Raw earths (not brick/plaster):** clay, kaolin, gypsum, sand, peat,
lime-rich ground.

**Semiprecious / colour stone:** jade, lapis, turquoise, obsidian, pumice,
amber, malachite, carnelian, agate, jet, coral, pearl.

### 4.3 Trees and woody plants

**In spec:** pine, spruce, larch, birch, oak, beech, teak, mahogany, palm,
olive, acacia, mulberry, bamboo, reed, date-palm, cedar.

**Add:** ebony, cypress, cork-oak, walnut, chestnut, willow, juniper,
rubber, coconut-palm, grapevine, fig, pomegranate, papyrus, pitch-pine.

### 4.4 Dye and pigment *sources* (not dyed cloth)

**In spec:** tyrian, indigo, madder, weld, ochre, cochineal, kermes.

**Add:** saffron, woad, henna, logwood, brazilwood, gamboge, lac-insect.

### 4.5 Fibre *sources* (not cloth)

Flax plant, cotton plant, hemp plant, mulberry (sericulture *zone*), pastoral
wool band, cashmere-goat zone, alpaca zone.

Drop **silk thread** as a map id — it is craft from mulberry + climate +
endemism.

### 4.6 Food plants

**Packages already:** wheat, rice, maize, sorghum, millet, tubers.

**Add as climate envelopes + Earth presence:** barley, oats, rye, grape, olive
(crop + tree), dates, pulses, sugarcane, tea-bush, coffee-shrub, cocoa-tree,
banana, citrus, sesame, opium-poppy, tobacco.

### 4.7 Spices, resins, gums

**In spec:** pepper, cinnamon, cloves, nutmeg, ginger; frankincense, myrrh,
sandalwood, olibanum.

**Add:** cardamom, vanilla, turmeric, capsicum, agarwood, benzoin/styrax/copal,
gum-arabic.

### 4.8 Furs (habitat)

sable, ermine, fox, beaver, seal; **add** marten, lynx, otter.

### 4.9 Fauna (live animals)

**In spec (22):** lion, leopard, tiger, bear, wolf, hyena, horse, cattle, bison,
camel, elephant, reindeer, deer, elk, antelope, boar, crocodile, hippo, fish,
salmon.

**Add:** eagle, falcon, aurochs/bull, ram/ibex, peacock, serpent, whale, bee,
yak, llama, rhino, zebra, shellfish.

Ivory/horn are **harvest flags on fauna**, not separate geology.

### 4.10 Marine (new)

shelf-fish, reef, mangrove, tyrian-mollusk coast, pearl-oyster, coral, whale
ground, enclosed-sea.

---

## 5. Accuracy model

Three independent questions. Ideal Earth state means (1) and (2) are strong;
(3) is honest about remaining coarseness.

| Level | Question | After this plan |
|-------|----------|-----------------|
| Ecological | Would this climate support it? | ~85% — biome + temp + moist + elev + river/coast |
| Geographic | Right continent / range? | ~80% — endemism pins + landmass |
| Geological | Right province? | ~70% — real plates + hotspots; not quarry-scale |

**What stays coarse on purpose:** gem hue splits (ruby vs sapphire hash pick),
exact marble quarries, bee/shellfish (wide bands). Flavour, not geology PhD.

---

## 6. Explicitly out of scope (this doc)

- Procedural-world landmass lottery (design is one paragraph in §3.2)
- Moisture-solver west-coast Med fix (procedural Cs)
- Craft chain (wine, linen, bronze, glass, porcelain, paper)
- Heraldic symbols that are not local fauna (cross, crescent, fleur-de-lis) —
  emblem genome, not `tileMaterials`
- Persisting material names on polities (save format / `collect()`) — later,
  when emblems consume the layer
- Full abyssal ocean ecology

---

## 7. Files and data

| Add | Role |
|-----|------|
| `src/sim/tileMaterials.js` | Pure classification |
| `src/sim/faunaBiogeography.js` | Earth origins + `faunaPresent` / plant presence |
| `src/sim/earthPlates.js` (or `data/plates.json` + loader) | Rasterize PB2002 |
| `src/sim/marineClass.js` | Coast / shelf / reef / upwelling |
| `src/sim/geologyClass.js` | volcanic / metamorphic / evaporite from `boundKind` + climate |
| `tools/convert_plates.py` | One-shot dataset bake |
| `tools/tileMaterials.test.mjs` | Golden Earth tiles |
| `data/plates.json` (or compact bin) | Checked-in, like NCEP |

| Change | Role |
|--------|------|
| `biomeClass.js` | Med on when real climate |
| `worldgen.js` / `pipeline.js` | Attach `pixPlate` / `boundKind` on Earth; pass marine fields |
| `resourceGen.js` | Earth `boundDist` starts working; optional named mineral hooks |
| `docs/materials-vocabulary.md` | Tag each id `climate-only` / `needs-reach` / `needs-geology` / `needs-marine` |

Preset-gated: loaders no-op on tectonic/random worlds (those keep generated
plates).

---

## 8. Build order

1. **`tileMaterials.js` + tests** on *current* signals (biome, deposits, crops).
   Names will be geographically sloppy; the API and golden *climate* cases
   (boreal ≠ trop) must pass.
2. **Med under Real Climate** — one flag, probe the confusion matrix. Unlocks
   olive/vine/kermes on Earth immediately.
3. **Endemism** — fauna + the plant list in §3.2. Biggest visible fix
   (lion/tiger/elephant/maize/spices).
4. **Plate dataset + `boundDist` on Earth** — obsidian/sulfur/young soil.
   Hotspot list in the same PR if small.
5. **Marine classifier** — pearl, coral, Tyrian, whale, shelf fish.
6. **Catalog expansion** (gaps in §4) once the four signals exist, so new ids
   are not climate-only guesses.
7. **One consumer** — codex inspect line (“Local materials: …”) or soft emblem
   fauna prior. Proves the layer without a save-format change.

Do not expand to 200 names before steps 2–5. Extra names on a broken range
model just multiply Amazon tigers.

---

## 9. Tests and measurement

- **Golden tiles** (Earth fractional coords): Nile, Sahel, Yellow River,
  Mesoamerica, Levant Med coast (Real Climate), Java, Moluccas, Baltic,
  Iceland/Hawaii hotspot, Congo (no tiger), Amazon (no elephant).
- **`probe_climate_truth.mjs`:** Med class share and F1 after enabling the
  branch under observed climate — must not explode to several % of land.
- **Determinism:** same seed + `ti` → identical `tileMaterials` JSON.
- **No save-format change** in this plan — if tests hash world state, they
  stay byte-identical except where Real Climate / plates are explicitly on.

`npm test` after the module exists. `npm run coverage` only if a name is
stored on world/entity state (the exclusion list fails open).

---

## 10. Related

| Doc | Relation |
|-----|----------|
| `docs/materials-vocabulary.md` | Named ids and eligibility tables (living spec) |
| `docs/aesthetics.md` | Why materials exist (emblems, dress, architecture) |
| `docs/design-growing-season.md` | Crop season vs annual mean (read, don’t reimplement) |
| `src/sim/biomeClass.js` | Why Med is off; Holdridge/Köppen legitimacy |
| `src/sim/peopleSim/biogeography.js` | Pattern to copy for fauna/flora reach |
| `src/sim/resourceGen.js` | Deposit spine |
| `src/realClimateData.js` | Observed `summerDry` |
| `CLAUDE.md` | No time gates; Earth pins are scenario input, not fitted outcomes |
