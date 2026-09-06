# W19a — the land a cell actually has

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W18
(`spec/handoffs/W18-the-width-of-the-water.md`). This wave adds ONE baked data
plane, ONE substrate field, ONE law, and ONE multiplication at each of the two
places a capacity density is produced. No constant was added; no metric was
added. The Rust kernel mirrors the farmed side and takes the share as a new
array.

## 1. The question that started it

W18 fixed a hop across a channel narrower than a cell. The owner, reading
that, asked the question behind it:

> *"so we need finer data, write straits and mini oceans on the coarser map
> from the fine data, and do the same for sub coarse pixel islands? have then
> be entities or something like that on the map, with their true size and
> such"*

Yes to the data. **No to the entities** — and that "no" is the design
decision this wave rests on. A named registry of straits and islets is fine
for DRAWING. The moment a mechanic asks *which feature is this*, the second
cardinal rule is broken: the code would be naming the answer instead of
building the cause. So the fine data lands as a **field on cells**, exactly
like the river magnitude and W18's channel width, and every law reads it
without ever knowing what it is looking at.

Two things follow from the field, and they are separable:

- **W19a (this wave): a cell that is part water should feed part of a cell.**
  Pure arithmetic on existing land cells; no topology changes.
- **W19b (named, NOT built): a cell the raster calls ocean but the fine grid
  finds partly dry should be able to hold people at its true area** — an
  island smaller than a cell appears. That is a topology change to the land
  mask and is deliberately deferred.

## 2. What was wrong, in one line

The shipped raster stores **one bit per cell** for geometry that is a few km
across. At 1920×960 a cell is ~21 km on a side and holds ~450 km² at mid
latitude; a coast, an island, a strait or a lake shore routinely cuts through
the middle of one. Thresholding that to land-or-sea both **erases** land (an
island smaller than a cell) and **invents** it — a cell that is 30% ground is
fed, taxed and settled as 100% ground by every law downstream.

The capacity laws are the ones that care, because each of them is a **density
per km² of LAND** and the area it is multiplied by to reach a headcount is the
**whole cell**.

## 3. The mechanism: measure the cover, charge the ground

```
bake:    LAND_FRAC[cell] = (1-arcmin samples with altitude > 0) / (samples in cell)
sim:     landShare(cell) = clamp01(landFraction[cell])
laws:    foragerTerrestrialCapacity *= landShare
         packageCapacityAt          *= landShare
```

`tools/build-landfrac.mts` reads the same 1-arc-minute ETOPO grid
`build-riverdata.mts` already takes — **no new download** — and bins every
sample into the shipped cell that contains it, ~126 samples per cell. The land
test is `altitude > 0`, verifiably the same test `tools/build-earthdata.mts`
uses for the elevation plane, so the two agree on what "above sea level"
means.

Four properties make this a mechanism rather than a patch:

- **It is a correction to the bit, and it stores only the correction.** Where
  the fine grid agrees with the land/sea bit the raster already implies
  (255 where the bit says land, 0 where it says sea) nothing is stored. That
  is 97.1% of the world left out: 53,353 cells remain, 107 KB raw / 143 KB
  base64 against 1,800 / 2,400 KB for the full plane. The bake asserts a
  byte-for-byte round-trip, so the correction list provably *is* the plane.
- **It shrinks as the grid improves**, like W18's channel width. A finer
  shipped raster resolves more coastline itself and needs less correction.
- **It names nothing.** The law asks how much ground is here, never which
  island this is.
- **A preset without a cover plane is bit-identical to pre-W19.** The default
  is `1`, which is not a fallback constant — it is what every law did before
  the plane existed.

### Where the multiply goes, and where it deliberately does not

**Two production sites, not three.** `initializeCropFields` builds the wild
stand FROM `packageCapacityAt`:

```ts
capacity[packed] = PEOPLE_WILD_STAND_SHARE * packageCapacityAt(...) * stand[packed]
```

so scaling `packageCapacityAt` thins the stand automatically. The stand *is*
the crop growing on that same ground; making it a third site would have been
a chance to get the ordering wrong for no gain.

**The aquatic term is NOT scaled.**
`PEOPLE_FORAGER_AQUATIC_CAPACITY_PER_KM2 * aquaticAccess * climate` prices the
**water's edge** — shore, river bank, lake margin, floodplain. Water standing
inside the cell *is* that edge; it does not take it away. Scaling it would
have said a coastal village fishes less because it is coastal.

**`cellAreaKm2` was NOT overloaded.** Folding cover into it would have been
one line instead of several, and it would have been wrong:
`migrationShareForArea` reads `cellAreaKm2[y * width]` as a **row** property —
geometric extent — so the overload would say people migrate faster out of a
half-water cell. `cellAreaKm2` keeps meaning extent.

**`_reliefMult` was NOT used as the carrier.**
`1/(1 + PEOPLE_RELIEF_PENALTY·relief)` is a penalty *response*, not a share.
Folding cover in would have made its name a lie, and the next reader would
have found a "relief" multiplier that changes with the tide line.

**The floor is NOT scaled.** `PEOPLE_CAPACITY_FLOOR_PER_KM2` (0.001) is a
numerical density floor compared directly in the migration room laws in both
languages. At ~356 km² per wholly-wet target cell it leaves ~0.36 people
there, ~58 across all 163 of them — below the resolution of any figure this
repo quotes.

### Why `world.people` being a DENSITY makes this exact

Headcount is `people[cell] × cellAreaKm2`. Scaling the capacity **density** by
the land share is therefore *exactly* "charge the living to the land the cell
has", with `cellAreaKm2` still meaning geometric extent. Every downstream
consumer — the growth logistic, migration room, `_basinCapacitySum` — follows
with no further change, and the **farm-vs-forage adoption test is untouched**,
because both sides of the comparison scale by the same share.

### The TS/Rust split

`_foragerCapacity` is handed to the Rust kernel as a data array, so the
forager side arrives already scaled and needed no Rust change. `package_capacity`
is independently recomputed in Rust, so it got the mirror multiply and a new
`land_share` array threaded through the constructor. `peopleKernel.ts` builds
that array by calling **the same `landShare()` law** the reference kernel uses,
so the two languages read identical numbers with no duplicated arithmetic —
and no new world state, so `collect()`/`coverage` need nothing (`"substrate"`
is already pass workspace, as it was for W18's `straitWidthKm`).

## 4. What it did to the substrate — both grids, no history

`v2/tools/probe-cover.ts` (scratch, not committed) builds the substrate at
both grids and sums land-masked area, water inside land-masked cells, and the
forager terrestrial headroom charged to that water.

| | dev 240×120 | target 1800×900 |
|---|---:|---:|
| land-masked area | 149.72 Mkm² | 150.46 Mkm² |
| of which water | **3.02 Mkm² (2.0%)** | **3.69 Mkm² (2.5%)** |
| land cells part water | 538 / 9,752 | 45,676 / 558,091 |
| wholly-wet cells | 7 (143 kkm²) | 163 (58 kkm²) |
| forager headroom charged to water | **2.2%** | **2.6%** |

By cover bucket at the target grid:

| cover | cells | area | headroom removed |
|---|---:|---:|---:|
| 0.00–0.25 | 3,180 | 931 kkm² | 44,700 |
| 0.25–0.50 | 7,244 | 2,074 kkm² | 76,663 |
| 0.50–0.75 | 9,992 | 2,793 kkm² | 60,871 |
| 0.75–1.00 | 25,260 | 7,206 kkm² | 34,090 |

**The headline: 10,424 cells covering ~3.0 Mkm² are MAJORITY WATER and were
being charged as fully dry land.** That is roughly an Australia of sea being
farmed.

And the third cardinal rule earns its place again: **the effect is LARGER at
the finer grid, not smaller** (2.6% against 2.2%), because more marginal
coastal cells survive the land mask there. A measurement taken only at dev
would have under-stated what ships.

## 5. What it did to history — dev W5 SOLVE arm

The gate's dev solve arm is CLAUDE.md's named exception to the never-run
directive; every figure below is from it. **No row changed status and nothing
became stale** — this is a wave that takes headroom away, uniformly, from the
coasts.

| | W18 | W19a |
|---|---:|---:|
| population −8000 | 13.2M (in band) | **13.06M** (in band) |
| population −5000 | 116.7M | **113.58M** |
| population −3000 | 805.2M | **792.74M** |
| population −1000 | 1,391.6M | **1,370.04M** |
| population 1 CE | 1,503.0M | **1,482.61M** |

≈1.4% lower at 1 CE against 2.2% of dev headroom removed, which is the shape
to expect: the curve saturates against an M3b ceiling it has not got the
mortality to be held off, so removing headroom moves the ceiling by less than
it removes.

European arrivals, **all five still in window**:

| row | W18 | W19a | window |
|---|---:|---:|---|
| `arrival:balkans` | −6634 | −6627 | −7000 … −6000 |
| `arrival:central-europe` | −5528 | −5542 | −6000 … −5000 |
| `arrival:rhine` | −5164 | −5171 | −5600 … −4800 |
| `arrival:cardial-coast` | −5871 | −5871 | −6500 … −5500 |
| `arrival:inland-europe` | −5857 | −5864 | −5800 … −4800 |

`europe-front-speed:solve:dev` 1.082 → **1.0922 km/yr**, still inside the
0.6–1.3 radiocarbon band (Pinhasi, Fort & Ammerman 2005). Density ordering
preserved: river 24.08 → 23.99, rain-fed 14.52 → 14.36, forager 0.0869.
Staples still **8/10**, the same two failing (Indus → millet, Nile →
sorghum). Every hearth row unchanged. The same four out-of-window arrivals
(sahel, ganges, south-india, japan) remain manifested; no known-miss row
needed adding or deleting.

## 6. The gap this build knows about and did NOT paper over

The plane measures **height against the sea, not dryness**. Ground that lies
below sea level but is dry therefore reads as water. Measured on the baked
plane: the Qattara Depression 0.000 at 29.5°N 27.0°E (0.164 as a ±0.5° box
mean), the Netherlands 0.051 at 52.3°N 5.0°E (0.284 box), the Salton Sink
0.000 (0.675 box), the Turfan Basin 0.090 (0.667 box).

**How much land this costs is not measured and is not claimed.** Separating
dry below-sea-level ground from actual water needs a hydrography layer the sim
does not carry, and no threshold on elevation alone can do it — that is the
whole difficulty. What can be said is the direction: the plane under-feeds
those basins and never over-feeds them, so nothing is being granted that it
should not have. Recorded as QUESTIONS #73.

## 7. Verification

Mechanical only, per the owner's 2026-09-03 directive. Nothing that simulates
history was run outside the dev W5 SOLVE arm the directive allows.

- `npx tsc --noEmit` — clean (three `Substrate` fixtures gained the new field;
  the wasm `.d.ts` was regenerated so the kernel's new argument typechecks).
- `npm run lint` — eslint + `constants-ledger: ok`.
- `npm test` — smoke (both grids, save/load byte-identical), unit,
  kernel-parity `{"parity":"ok"}`: all green. Parity is the load-bearing one
  here, because the farmed multiply exists in both languages.
- **New unit test** (`tools/unit.test.ts`): one fixture cell given a shore and
  a cover of 0.25 — a power of two, so the assertions are equalities and not
  tolerances. Three properties asserted: the ground-derived terms
  (`foragerTerrestrialCapacity`, `packageCapacityAt`) scale by the cover
  **exactly**; the aquatic term is **unchanged**, because water inside the
  cell is that edge; and exactly **one** cell's `_foragerCapacity` differs
  between the two worlds, so the share moves nothing outside the cell whose
  cover changed.
- `npm run gate` — travel (`{"gate":"pass"}`, no unexpected failures, no
  stale known-misses) and people (`{"gate":"pass"}`, §5 above).
- `npm run bench -- --check` — ratchet held.
- `npm run oracle` — `{"oracle":"ok"}`, `elevation` **exact** at all three
  arms. The cover plane is a second output of worldgen, never an input to the
  elevation it corrects, so the byte-exact arm is untouched by construction.
- `npm run coverage` / `npm run monotone` are v1 root tools against v1's
  `collect()` and are not triggered: W19a adds a static substrate INPUT
  derived from the DEM at worldgen, not evolving world state, and no metric.
  `"substrate"` is already in `tools/lib/collect.ts`'s pass-workspace list.

## 8. What is still open

- **W19b is named and not built**: a cell with `landFraction > 0` that the
  raster calls ocean should be able to hold people at its true area, at which
  point sub-cell islands exist at all. That changes the land mask's topology —
  routing, coasts, basins, the ancestry field — and wants its own wave and its
  own probe.
- **The shipped-grid arm has not been run for W17, W18 or W19a.** All three
  are `v2-long` requests, not development-loop steps. W19a's substrate probe
  says the target grid loses 2.6% of forager headroom, slightly more than dev;
  what that does to the target population curve and `arrival:japan:solve:target`
  is unmeasured.
- **The trajectory-arm rows** (`arrival:*:dev` without `:solve:`) are measured
  only on the 3000-year arm, which does not run per-commit; W18 moved their
  cause and W19a moves their capacity, so both want a `v2-long` re-measure.
- **The below-sea-level gap**, §6 / QUESTIONS #73.
- Unmoved by this wave and still open: M3b's missing mortality (every
  population row), P10, P20, the Marmara (QUESTIONS #72), the hearth placement
  family, and the Indus and Nile staples.
