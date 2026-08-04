# THE GROWING SEASON — evaluate each crop on the season it grows in

Owner (2026-08-03): *"i am using our NCEP and other real earth climate stuff."*
Which is the whole point — the fix is not a model to invent, it is a signal
already in the data files that the crop model reads and discards.

This is the measured foundation and the design. It is **not yet built**: it
plumbs a new per-tile quantity through worldgen → pipeline → peopleSim, and the
build is measured against the observation below rather than argued into place.

---

## 0. The defect, in one line of shipped code

`src/realClimateData.js` `deriveGrids()` reads all twelve NCEP/NCAR monthly
2 m air-temperature values per cell and collapses them:

```js
for (let m = 0; m < 12; m++) { const tm = airtemp.months[m][j][i]; mat += tm; … }
T[j * NLON + i] = mat / 12;     // ← the seasonal signal, discarded here
```

The crop-package model (`cropPackages.js` / `agriculture.js`, shipped on by
default as `T.CROP_AXIS`) then evaluates every package's climate bell against
that annual mean. Wheat's optimum (`tOpt 0.73` = 13 °C) is a **growing-season**
figure; fed the **annual mean**, every Old-World cereal cradle reads as too warm
for its own founder crop and is assigned maize. That is the measured cause of
the wrong-hearth-crop bias `T.CRADLE_PACKAGE` exposed (`docs/design-idea-field.md`).

## 1. The measured foundation (`tools/probe_season.mjs`, NCEP 1991-2020)

### 1a. Annual mean vs cool quarter — the temperature half of the story

```
site            annual (model uses)   coolest quarter
Nile            21.4 °C → maize       10.5 °C → wheat
Mesopotamia     22.4 °C → maize        9.2 °C → wheat
Indus           24.3 °C → rice        12.8 °C → wheat   (0.2 °C off wheat's optimum)
Yellow River    12.7 °C               −1.5 °C → too cold for winter wheat
Mexico (maize)  15.9 °C               13.0 °C, warm quarter 18.6 °C
New Guinea      22.9 °C               22.8 °C — no cool season at all
```

### 1b. The moisture coupling — why temperature alone is not enough

The cool-quarter reading alone would send the Yellow River to wheat and miss its
real founder crop. The full signal is **which season carries the water**:

```
site            warm season          cool season        founder-crop reading
Mesopotamia     31 °C    6 mm         13 °C   57 mm       COOL-season cereal (wheat/barley)
Indus           32 °C  188 mm         17 °C   15 mm       WARM-season (monsoon)
Yellow River    22 °C  674 mm          4 °C   67 mm       WARM-season cereal → MILLET
Mexico (maize)  18 °C 1162 mm         14 °C  577 mm       warm-wet → maize
New Guinea      23 °C 1389 mm         23 °C 1445 mm       no season → tubers only
Nile            28 °C    2 mm         15 °C    5 mm        arid → river-irrigated
```

Read together these recover the real founder crops from observation, with **no
constant changed**: Mesopotamia is cool-wet (Mediterranean winter rain) →
**wheat**; the Yellow River is warm-wet / cold-dry-winter → **millet**, a
summer crop, which is historically correct and which the temperature-only
reading gets *wrong*; the Nile is arid in both seasons → **river irrigation**
(already handled by the floodplain/`tFlood` machinery, not the rain bell); New
Guinea has no season and no dry spell → **tubers** (already capped by
storability). The discriminator is not annual climate — it is whether the tile
has a *season* matching each crop's temperature **and** wet enough to grow it.

## 2. The law — `T.GROW_SEASON` (proposed, default 0, byte-identical off)

Each crop is evaluated on **the season it grows in**, not on the annual mean:

- a crop with a **cool** optimum (wheat, `tOpt 0.73`) grows in the tile's
  **cool half** — read its temperature and its rainfall;
- a crop with a **warm** optimum (maize/rice/sorghum) grows in the tile's
  **warm half** — read those;
- the season is chosen per crop by which half-year temperature is nearer the
  crop's own `tOpt`, so **no per-crop season label is added** — it falls out of
  the `tOpt` the package already declares;
- tubers keep their storability cap; the arid-cradle path keeps using the
  river/floodplain fertility that already bypasses the rain bell.

`pkgClimateBell(pkg, t, m)` changes from reading the tile's annual `(t, m)` to
reading `(tGrow, mGrow)` — the temperature and moisture of the half-year whose
temperature is nearer `pkg.tOpt`. One substitution, evaluated on data the world
already carries once the fields below exist. **No new constant.**

## 3. The fields to plumb, and where they come from

Two new per-tile quantities, both **already derivable from shipped inputs**:

| field | NCEP / Earth-Sim source | procedural-map source |
|---|---|---|
| `tAmp` (seasonal temperature amplitude) | warm-half minus cool-half mean of the 12 months, in `deriveGrids()` | latitude × continentality — the physical drivers of annual temperature range (small at the equator and on coasts, large at high latitude and in continental interiors); the same inputs the temperature curve already uses |
| `mWarm` / `mCool` split | warm-half vs cool-half monthly precip sum | the two-solstice moisture solve worldgen **already runs** for the monsoon (`summerDry` is its phase); the magnitude split is the same solve, not a new one |

Derived, per tile, at evaluation: `tCool = temp − tAmp`, `tWarm = temp + tAmp`;
`mCool`/`mWarm` from the split. `tGrow`/`mGrow` = the pair whose temperature is
nearer the crop's `tOpt`.

Plumbing path (the mechanical part): `worldgen.js` return object → `pipeline.js`
→ `createWorld`'s tile downsample in `state.js` (the same max-pool/sample the
other terrain fields use) → read in `agriculture.js` `pkgSuitAt`. Off-lever the
fields need not exist; `pkgClimateBell` falls back to annual `(t, m)`,
byte-identical.

## 4. Cardinal-rule audit

- **First rule (no time gate):** a seasonal *climate* field is not a clock; it
  is a property of place, read every evaluation. Nothing keys on step/year/era.
- **Second rule (build the cause):** this is the cause, not the effect. It adds
  no "make the Nile wheat" constant — it feeds the existing bell the season the
  crop actually grows in, and the founder crops fall out because the real
  climate has those seasons. The `tOpt` values are **not** re-tuned to land a
  crop; if a cradle comes out wrong after the seasonal read, that is a finding
  about the bell, not license to move an optimum.
- **Third rule (measure at the ship grid):** the seasonal fields are per-tile
  climate, downsampled like `temp`/`fert`; `resgate` runs before any flip, and
  the amplitude's downsample must be checked for the same max-pool-vs-sample
  resolution behaviour the fertility field needed.

## 5. Acceptance battery (before any flip)

1. **Byte-identical off** — hash-equal with the lever at 0, both grids.
2. **The cradles get the right crop** — `probe_season` + a placement probe:
   Mesopotamia/Nile/Indus → wheat/barley, the Yellow River → a warm-season
   cereal (millet-class), Mesoamerica → maize, New Guinea → tubers. Reported per
   site against observation, not against a target list.
3. **`CRADLE_PACKAGE` bias clears** — the maize-tail that took 7 of 10 hearths
   must fall to a realistic spread once wheat country reads as wheat country.
4. **The axis survives** — `probe_crop_axis`: wheat must still race east-west
   and stall at the tropics; the seasonal read must not flatten the continental
   axis `CROP_AXIS` exists to produce.
5. **Standing gates** — smoke, `validate`, `resgate`, `coverage` (new state),
   plus the multi-seed A/B: this rides `CROP_AXIS`, on by default, so it changes
   agronomy in **every** world and must pass the seed panel at defaults before
   any default change, existing saves included.

## 6. Risks

- **Procedural seasonal amplitude is new worldgen code** — the NCEP arm reads
  real data, but a procedural map needs `tAmp` from latitude × continentality,
  and that model must be built and measured on its own, not assumed to match the
  reanalysis. The two arms are separately gated.
- **Downsample resolution** — the amplitude is a difference of two fields;
  differences are noisier under downsampling than levels. `resgate` is not
  optional.
- **It touches the food economy through `CROP_AXIS`** — the widest blast radius
  of anything in this lane. Ship off; flip only after the seed panel.

---

## IMPLEMENTATION ADDENDUM — built behind `T.GROW_SEASON`, ships OFF

The seasonal plumbing is built end to end and **byte-identical off** (hash
`ed030d9` = HEAD, both the flip re-verification and this). `tAmp` and
`warmRainFrac` flow `realClimateData.deriveGrids` (twelve NCEP months, free in
the existing loop) → `fillRealClimate` → `worldgen` (real path) or a
latitude/`summerDry` fallback (procedural) → `state.js` downsample (gated on
the lever) → `agriculture.js pkgSuitAt`. The bell reads the growing season;
`envGate` stays annual. `coverage` passes with the lever ON (the new state is
reached through `cropCeil` → capacity).

**Two things the build taught, that the design did not foresee:**

1. **"No new constant" was wrong.** The naive "grow in the nearer half-season"
   rule mis-assigns a warm crop to the cool half whenever its optimum sits
   between the two half-temperatures (maize at 0.82 in a `[0.74, 0.92]` tile
   picks 0.74) — so maize escapes the summer drought it should die in. The fix
   is a real one: classify each crop as warm- or cool-season by its own
   optimum (boundary `tOpt 0.80` ≈ 18 °C, the botanical cool/warm-season crop
   division), and it grows in that half or not at all. That is **one new
   agronomic constant**, defensible on its own terms, not derivable away.

2. **The moisture split overshot, and moisture calibration is the residual.**
   `m × 2 × frac` pushed cool-season moisture to 0.82 and read wheat as *too
   wet*; softened to `m × (0.6 + 0.8·frac)`. Even then, measured (real NCEP,
   480/8817):

   ```
   Mesopotamia   wheat 0.23 → 0.48   but sorghum 0.77 wins (hot-dry cereal)
   Yellow River  → warm-season cereal (millet-class, its real founder)
   Mexico        → maize (was wheat)
   ```

   The maize blanket over the Old-World cradles **breaks** — every cradle now
   reads as a cereal, not maize. But Mesopotamia's raw winner is *sorghum*, not
   *wheat*, because the sim's moisture index reads semi-arid Mesopotamia at
   `m ≈ 0.45` — nearer maize/sorghum's optima than wheat's dry 0.36. That is a
   **worldgen moisture-calibration** gap (the ~200 mm/yr real Fertile Crescent
   should map drier than 0.45), separate from and downstream of this lever.

**Status:** the growing-season *temperature* mechanism works and the anachronism
(cereal cradles reading as maize) is fixed; the exact historical founder crop at
each cradle waits on the moisture calibration. Ships **off**; the full battery
(smoke green, byte-identical, coverage-on green so far) and the seed panel are
owed before any flip, because it rides `CROP_AXIS`.

## COMPACT VERDICT

The crop model is fed annual-mean temperature and moisture; every Old-World
cereal cradle therefore reads as maize country, which is the measured cause of
the wrong-hearth-crop bias. The right number — growing-season temperature, and
the rainfall of that season — is not a model to invent: it is twelve months of
NCEP data the loader already reads and discards on one line, and (for procedural
maps) the two-solstice solve worldgen already runs. Evaluating each crop on the
season it grows in recovers the real founder crops from observation with no
constant changed. The build plumbs one seasonal quantity through three layers;
this document is the measured foundation and the law, ships nothing, and gates
the build behind the full battery because it rides `CROP_AXIS`.
