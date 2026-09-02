# HANDOFF — Substrate Wave W1 of Simman v2: honest water

**For:** the implementing agent.
**From:** the spec session of 2026-09-01 (branch
`claude/world-sim-rebuild-decision-1umpax`).
**Scope:** three substrate fixes, exactly — lakes from data, the measured
floodplain fraction, seasonal river flow. **Do not start M3** (no food
books, no yields, no irrigation techniques, no flood-regime consumer, no
soil dataset). This wave may run in parallel with M2; see ruling 6.

## Why now (context in four sentences)

Owner play-testing found two places the map still lies and one where it is
mute: lakes sit where v1's derived depressions put them, not where Earth's
lakes are; every river paints a crop-suitability ribbon — the great rivers
up to ~10 cells wide — through three legacy painters, one of whose
constants is annotated in its own comment "~2× generous vs Earth valleys
for map legibility" (the Nile's real floodplain is 5–25 km: ONE cell); and
rivers are the only monthly-varying part of the travel model that does not
vary by month. M2 calibrates population against this map, so the map gets
honest first — the DECISIONS 20 precedent (substrate defects are fixed
before consumers tune to them). The fix pattern is the one the rivers wave
proved: geometry from data, water from climate, procedural presets
v1-verbatim (R7, DECISIONS 21). Flood regime (Nile-gentle vs
Tigris-violent) is NOT in this wave; W3's output is its future input and
that is all.

## Required reading, in order

1. `spec/03-earth-and-travel.md` §3.1–3.2 — the seasonality contract
   ("costs are functions of month… sea ice, monsoon windows") is W3's
   mandate; §3.3's reality table is the gate style to extend.
2. `spec/DECISIONS.md` rounds 20–22 — round 22 is this wave's charter.
3. `v2/QUESTIONS.md` #18–#23 — binding rulings from the M1 play-test;
   #23 is the diagnosis this handoff turns into work.
4. `v2/tools/build-riverdata.mts` + `src/ported/worldgen/riverDirSample.js`
   — the bake/sampler pattern every item here extends (fine data grid →
   baked layer → integer resampling to any sim grid).
5. `src/ported/worldgen/pipeline.js` (the river-moisture ribbon block and
   the `tFlood` crop override) and `cropGen.js` `envGate` — the three
   painters W2 replaces.
6. `src/ported/worldgen/riverGen.js` lake block (candidate lakes from
   depressions) — what W1 supersedes on earth presets.
7. `tools/worldgen-oracle.ts` — the three arms (procedural exact,
   rawRivers exact, earth data-deviation) that must stay green.

## Ground rules (carried forward, non-negotiable)

- **R7 seam, exactly as rivers (DECISIONS 21):** GEOMETRY from data, WATER
  from climate. Every earth-preset deviation rides behind the same lever
  pattern as `bakedDir`; procedural presets keep the v1-verbatim derived
  path byte-identically. The oracle's procedural and rawRivers arms pass
  with ZERO new deviations; earth arms may only grow report-only
  data-deviation fields, each named in the file header.
- **R2:** no place names in code — places live in `data/reality/*`
  fixtures and the known-misses manifest, with physical reasons. Every new
  constant needs independent physical meaning and a
  `spec/09-constants-ledger.md` row under `## W1 — proposed (review
  pending)`.
- **R3:** everything here has territorial blast radius through fertility.
  The gate suite runs dev AND target grids; fixtures pin the shipped grid.
  Quote no number measured only at dev.
- **Branch:** `cursor/v2-w1` from `claude/world-sim-rebuild-decision-1umpax`
  if Cursor implements; the review session may instead execute this
  handoff directly on the main branch. Conventional commits.
- Where the spec is silent, do NOT decide: QUESTIONS.md entry plus the
  most conservative placeholder, marked `// W1-PLACEHOLDER`.
- Validation before any push: `npm run lint`, `npm test`, `npm run gate`,
  `npm run oracle`, `npm run browser` (all from `v2/`).

## Rulings new in this handoff (spec authority, pre-answered)

1. **Fertility and crop suitability are ANNUAL by design** (owner
   question, 2026-09-01). They are integrated land properties — "what can
   this land yield over the agricultural year" — like every real-world
   suitability product; the month slider must NOT change those lenses.
   The monthly signal reaches agriculture three ways, none of them in
   this wave: the growing-season climate bell already in
   `cropSuitabilityPkg` (tGrow/mGrow); M3's food economy consuming
   monthly climate at the one-month tick (M2 ruling 1); and the flood
   regime read (W4, deferred). Do not "fix" the static lenses.
2. **A lake is data geometry holding emergent water.** The baked mask
   says where a basin is; climate and rivers say whether it holds water.
   v1's inflow validation is kept as the water test; what dies on earth
   presets is candidate PLACEMENT from depressions of cell-average sim
   elevation (the wrong-places bug — 22 km averages invent basins and
   miss real ones).
3. **Floodplain is a per-cell FRACTION, never a mask or an override.**
   The measured share of a cell's fine samples lying within flood stage
   of the channel floor. All river fertility effects scale by it; no
   painter may write a full-cell value keyed on the channel's presence.
4. **The three painters are REPLACED, not tuned** (R2). Deleted on the
   data path: the `HW = FLOOD_W_KM·√(discharge-equivalent catchment)`
   ribbon width law (valley width is set by local bedrock confinement,
   not upstream catchment — the Nile is the proof: 3 M km² of catchment,
   a 5–25 km valley); the `tFlood ⇒ crop = max(crop, 0.92)` stamp; the
   full-cell channel alluvial pull. Their physical content survives as
   fraction-weighted terms.
5. **Flood regime is deferred to M3; no state ships for it.** W3's
   twelve monthly discharge values per cell are its complete future
   input (month-of-peak, amplitude, variance are reads, not state).
   Record the hook in QUESTIONS.md and stop.
6. **Parallel-with-M2 merge ruling.** Substrate caches key on data
   identity (M2 handoff ruling 12), so this wave regenerating the map
   mid-M2 is anticipated. Whichever of W1/M2 merges second re-runs the
   full gate suite and re-baselines any fertility-dependent M2 numbers
   before its merge is called done.

## Work item W1 — lakes from data

- **Source:** HydroLAKES v1.0 (lake polygons; same Lehner/WWF family and
  CC-BY licence as our HydroSHEDS rivers — carry the attribution header
  convention).
- **Bake** (extend the river bake or a sibling tool): rasterize polygons
  onto the 1920×960 data grid → `LAKE_MASK` emitted beside `RIVER_DIR`.
  The area bar is the raster itself, not a tuned constant: a lake ships
  iff it majority-fills ≥ 1 data pixel (~430 km² at the equator). That
  admits Victoria, Baikal, the Great Lakes, Ladoga, Balkhash, Titicaca,
  Chad; everything smaller stays sub-grid texture, exactly like villages.
- **Sea-class vs lake-class is decided by measurement, not assumption:**
  bodies already water in the EARTH_ELEV mask (the Caspian/Black/Baltic
  route, DECISIONS 20) stay sea-class and become NOTHING here;
  positive-elevation lakes (Superior at +183 m, Victoria at +1134 m) are
  the ones this item creates. Measure what the current mask actually
  holds before wiring anything.
- **Water stays emergent** (ruling 2): the v1 inflow/balance validation
  runs against the data basins on earth presets; a basin the emergent
  hydrology cannot fill stays dry land. Procedural presets keep the
  depression-derived candidates v1-verbatim.
- **Continuity:** rivers route THROUGH lakes — HydroSHEDS DIR already
  carries the channel under the lake surface; do not break the White
  Nile at Victoria or the Angara at Baikal.
- **Consumers already wired:** the `LAKE_MOISTURE_RADIUS_KM` boost now
  fires at true locations; lake cells are flat water for travel (river
  craft, boats gate); the rivers lens already colours lakes teal.
- **Gate:** `data/reality/lakes.json` — presence boxes + minimum shipped-
  grid area for the anchors above, plus one honesty band: total lake
  area over the bar within a stated tolerance of the dataset's own
  total. Misses go through known-misses with physical reasons.

## Work item W2 — the measured floodplain fraction

- **Bake** (extend `build-riverdata.mts`): along every fine channel, a
  lateral height-above-channel scan of the same 1.8-km ETOPO samples
  used for `RIVER_GRAD`: a sample is floodplain iff its elevation lies
  within `FLOOD_STAGE_M` of the local channel floor (running-min
  smoothed, as the gradients are) inside a physical search radius. Both
  constants get ledger rows with independent meaning — flood stage is
  the height a great river's flood crests above low water (order 8 m;
  the pre-dam Nile crested ~7–8 m at Aswan), the radius bounds how far a
  flood can physically spread (order 10² km, generous — the ΔH cut does
  the work). Emit `RIVER_FLOOD` per data pixel.
- **Sampler:** `sampleFloodplainFraction(tw, th)` → per-sim-cell share
  of its fine samples flagged. A fraction by construction,
  resolution-invariant by construction.
- **Replace the three painters on the data path** (ruling 4; procedural
  keeps every painter v1-verbatim):
  1. The moisture ribbon wets the MEASURED floodplain cells; how much
     water stays emergent — scale by the channel's emergent discharge so
     a fossil valley with no flow gets nothing.
  2. Crop suitability becomes the area-weighted mix
     `f·cropFlood + (1−f)·cropRainfed`, with `cropFlood` the irrigated-
     floodplain suitability, cold-gated exactly as today and
     discharge-gated (a dry data valley earns nothing). The 0.92 stamp
     dies.
  3. `envGate`'s channel alluvial pull and river youngSoil terms scale
     by `f` — a creek's +0.45 becomes the faint riparian trace its ~2%
     fraction implies. This kills the 1-cell bright lines worldwide.
- **Expected shape (measure, don't assume):** Upper Nile 1–2 cells of
  high-f with a wide delta fan; Mesopotamia genuinely broad (the twin
  rivers share a real plain — width there is a feature, not a bug);
  floodplain share of land back near the ~2.5% that pipeline.js's own
  scar comment records as sane (14.5% was the recorded failure). The
  rome-alexandria dev-raster known-misses were CAUSED by the over-wide
  ribbon and are expected to heal — remove their rows; the ratchet
  fails stale on purpose.
- **Gate:** `data/reality/floodplain.json` — corridor-width anchors
  (Nile mid-valley ≤ 2 cells of high-f; Mesopotamian plain wider than
  the Nile's corridor; Yangtze lower plain high-f) plus the global
  share band. Fertility feeds territory, so this item is the one that
  most needs the target-grid run before any number is quoted (R3).

## Work item W3 — seasonal flow

- **Compute:** twelve monthly accumulation passes over the FIXED baked
  channel geometry, each routing that month's emergent runoff with the
  same per-km transmission loss; store per-cell monthly scale relative
  to annual, compactly (no steady-state allocation in any tick path).
  Geometry never varies by month; only water does.
- **Consumers:** the travel river leg reads the month's scaled magnitude
  against `TRAVEL_RIVER_MIN_MAGNITUDE` — the Niger's low-water reach
  drops out of navigation in its dry months. Freeze closure: a river
  cell whose month temperature is below freezing closes the leg (§3.2's
  seasonality contract names sea ice; this is its river arm). Reach
  gradient stays static — it is geometry.
- **Lenses:** the rivers lens becomes month-aware through magnitude
  (its slider already exists). Fertility/crops lenses do NOT change
  (ruling 1).
- **Snowmelt:** a melt-driven regime (Volga, Indus) needs precip banked
  below freezing and released above — a minimal snow store. Implement it
  ONLY if the month-of-max gate fails without it; otherwise record the
  simplification in QUESTIONS.md. Do not build a hydrology model.
- **Gate:** `data/reality/river-seasons.json` — month-of-maximum-
  discharge anchors, ±2 months at the shipped grid: Nile at Cairo
  (Sep), Niger inland delta (Sep–Oct), Ganges (Aug), Yangtze (Jul),
  Volga (May–Jun — the snowmelt canary), Rhine (near-even: gate its
  max/min ratio low instead of a peak month). Misses → manifest with
  physical reasons.

## Work item W4 — flood regime hook (records only)

Nothing is consumed and nothing is stored. Write the QUESTIONS.md entry
stating that month-of-peak, amplitude, and interannual variance of W3's
monthly discharge are the M3 flood-regime inputs (the Nile-gentle vs
Tigris-violent asymmetry, salinization pressure, harvest-timing risk),
and that they are reads on existing output, not new state.

## Sequencing and definition of done

W1 → W2 → W3, because floodplain measurement must see real lakes (a
channel entering Victoria ends at a lake, not a valley), and seasonal
flow should route through both. Done means: all three oracle arms green
with zero new procedural deviations; `lint`, `test`, `gate` (dev and
target), `browser` green; the new fixtures passing at the shipped grid;
known-misses churn fully explained (healed rows removed, new rows
reasoned); ledger rows for every new constant; QUESTIONS.md entries for
every judgment call; and the regenerated map eyeballed in the shell at
target grid — the owner's play-test is the court this wave answers to.
