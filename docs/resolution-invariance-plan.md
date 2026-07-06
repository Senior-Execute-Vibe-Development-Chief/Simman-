# Resolution-invariant carrying capacity — design & scope

**Status:** SCOPED, not started. Owner review requested before implementation.

## The problem (measured)

The un-anchored population model is not resolution-invariant: the *same Earth* at a
finer grid supports more people. Measured, same seed (8817), **matched development**
(leading-org ≈ 0.62, so this is not a trajectory-timing artefact):

| grid | land tiles | total pop (sim-units) | pop / land tile |
|---|---|---|---|
| 480×240 | 9,616 | 202k | 21.0 |
| 960×480 | 38,741 (×4.0) | 432k (**×2.14**) | 11.2 |

A map is the same map at any pixel count, so the real population it can feed **must not
depend on grid resolution**. It does — ~2.1× per 2× resolution. Extrapolated to full
Earth (1920×960) this is the ~18-billion-at-Medieval over-population, and the runaway
settlement count is also what bogs a full-size run to ~3.6 steps/s.

Decomposition of the 2.14× (per 2× resolution): **×1.67 more settlements** (denser
packing) and **×1.28 bigger settlements** (per-settlement capacity). Both scale; the
spacing driver dominates.

**This is a discretisation artefact, not a missing population target.** The fix is to
make the spatial model resolution-consistent — NOT to reinstate the demographic anchor
(which pins population to a recorded historical curve; that *fits the outcome*, violating
cardinal rule 2, and merely masks this bug). At the calibrated 480×240 resolution the
un-anchored model is already ~historical (202k units ≈ 202M people at ~Medieval vs a real
~300M), which is exactly why the anchor is unnecessary once this is fixed.

## Root cause: a two-tier inconsistency

The engine ALREADY has a resolution-normalisation convention — `resScaleFor(tw) =
max(1, tw/240)` (countryTerritory.js) — and uses it so a realm claims the same *fraction*
of the world at any grid size. But it was applied to REACH and left off DENSITY:

- **Already resScale-scaled (resolution-invariant, correct):**
  - Territory/admin reach — `COUNTRY_REACH_BASE * resScale`, `holdReach = range * resScale` (conquest.js:644, countryTerritory.js:344/394).
  - Sea range + visit cap — `SEA_RANGE_BASE * resScale`, `MAX_SEA_VISITS * resScale²` (sea.js:219/299).
  - Knowledge diffusion decay — `exp(−td / (KNOWLEDGE_DECAY_SCALE * resScale))` (crystallize.js:484).
- **NOT scaled (fixed in tiles → resolution-dependent, the bug):**
  - **Settlement spacing** (crystallize.js): `HARD_FLOOR=4`, `SOFT_DIST=10`, `MIN_SETT_DIST=8`, `URBAN_SPACING=5`, `COLONY_MIN_RANGE=10`, `FRONTIER_EXTEND_DIST=28`, `COLONY_RANGE`. Fixed tile distances → finer grid packs settlements at half the real distance → ~4× density. **The dominant driver.**
  - **Farm catchment** (settlement.js): `SOIL_CATCH_R=3` (the farmed radius), `SPACE_RADIUS=14` (urban-footprint scan), `FOOD_RANGE_BY_TIER` (tier catchment multiplier). Fixed radii → a settlement farms a smaller *real* area at finer grid.
  - **Tile-count caps** (settlement.js): `arableScale/agScale = min(1, _terrTiles/120)` (lines 747/827/964) — a fixed 120-tile saturation. At finer grid the same real catchment has more tiles, so this cap is reached "too easily" and mis-scales food.

So reach says "same fraction of the world" while spacing says "same tile gap" — the two
disagree, and their ratio is the resolution error.

## The fix: reference everything to the calibrated resolution

**Reference = 480×240** (the stylized-validate resolution, where the calibration is
known-good and pop is ~historical). Define a pop-normalisation width `POP_REF_W = 480`
and `rNorm(tw) = tw / POP_REF_W` (a per-axis linear factor; **= 1 at 480, so 480 is
byte-identical**). Then, by dimensional category:

| quantity | current | resolution-invariant form | at 480 |
|---|---|---|---|
| **distances** (spacing, catchment radius, footprint scan) | fixed tiles | `× rNorm` (constant real distance) | ×1 |
| **area caps / tile counts** (`_terrTiles/120`) | fixed count | `× rNorm²` (constant real area) | ×1 |
| **per-tile yields** (land food per worked tile) | fixed per tile | `÷ rNorm²` (constant real per-area yield) | ×1 |

Why these three compose to invariance: catchment *radius* × rNorm → catchment *tile
count* × rNorm² → but per-tile *yield* ÷ rNorm² ⇒ **per-settlement food constant in real
terms**; and spacing × rNorm ⇒ **settlement density constant in real terms**. Constant
per-settlement food × constant settlement density = **constant total population**, at any
resolution. No fitted exponent — each factor is pure geometry (length, area), and 480 is
the fixed point so the validated calibration is preserved exactly.

## Implementation plan (behind `T.RES_INVARIANT_POP`, default off)

Phased so each step is measurable and independently revertible; default-off keeps every
current baseline byte-identical until we choose to flip.

1. **Spacing → real distance** (crystallize.js). Scale `HARD_FLOOR`, `SOFT_DIST`,
   `MIN_SETT_DIST`, `URBAN_SPACING`, `COLONY_MIN_RANGE`, `FRONTIER_EXTEND_DIST`,
   `COLONY_RANGE` by `rNorm`. Expect: settlement *density* becomes resolution-invariant;
   the ×1.67 settlement-count driver goes flat; the full-size slowdown eases (fewer
   settlements). Measure settlement count per land-tile across 320/480/960.
2. **Catchment → real area** (settlement.js). Scale `SOIL_CATCH_R`, `SPACE_RADIUS`,
   `FOOD_RANGE_BY_TIER` by `rNorm`; scale the `/120` caps by `rNorm²`. Perf note:
   `SOIL_CATCH_R × rNorm` at 1920 = radius 12 (a ~450-tile scan) — the catchment loop
   (settlement.js:1763) becomes O(rNorm²) heavier; may need an incremental/summed-area
   optimisation.
3. **Per-tile yield → per-area** (settlement.js updateFood). Divide the land-food
   contribution by `rNorm²` so a settlement's food tracks real catchment area, not tile
   count. This is the step that closes the residual ×1.28 per-settlement driver.
4. **Audit the long tail.** Migration pull distances, road/market kernels, `MIGRATE_*`,
   plague/agglomeration radii, `URBAN_ANTICIPATION`, fish `FISH_LAND_REF` — sweep for any
   remaining fixed-tile distance/area in the pop/economy path and categorise/scale each.

## Validation matrix

- **Resolution-invariance (the target):** same seed at **320 / 480 / 960 / 1920**, sampled
  at matched leading-org (0.4, 0.6, 0.8) → total pop and pop/land-tile equal within a few %.
  New probe `tools/probe_resinvariance.mjs`.
- **480 byte-identity:** because 480 is the reference (`rNorm=1`), the 480 stylized suite
  must be **unchanged**. NB the current byte-identity guards run at **320** (`probe_hashbase`,
  `probe_roundtrip_deep`, `rNorm=0.67`) — these WILL move when the lever is on; re-baseline
  them, or add 480 variants.
- **Stylized gates, 3 seeds, at 480:** unchanged (reference). Re-run to confirm.
- **Stylized gates at ≥1 non-reference resolution** (e.g. 960): must still pass — the pop-vs-
  development, clustering, and size gates should now hold at 960 too (they currently drift).
- **Map quality:** screenshot/border-length/land-share diff at 960 & 1920 vs the intended
  480-equivalent structure (fewer, correctly-spaced settlements — not a sparser or
  clumpier map).
- **Perf:** full-size (1920) steps/s should IMPROVE (fewer settlements) despite the larger
  catchment scan; confirm net win, add the summed-area catchment opt if step 2 regresses it.
- **Determinism + save/load:** smoke + `probe_roundtrip_deep` round-trip on the on-path.

## Risks & open questions

- **The calibration is entangled with 480.** Constants like the `/120` cap, `SOFT_DIST=10`,
  `SOIL_CATCH_R=3` were hand-tuned at ~480; making them real-distance is correct but every
  downstream tuning (urbanisation band, city-formation thresholds, fish-vs-farm) assumed the
  480 tile geometry. Step 4's audit is where hidden couplings surface.
- **rNorm below the reference (tw<480):** 320 and 240 get *tighter* spacing / *more* pop
  (they currently under-represent vs 480). That is the correct direction, but it changes the
  small-grid probes and any 320-tuned intuition.
- **Non-integer radii:** `SOIL_CATCH_R × rNorm` is fractional off-reference — round vs
  sub-tile weighting is a determinism decision (must be exact-reproducible).
- **Is 480 really the right reference,** or should the *anchor-validated* pop curve define
  it? Proposal: keep 480 as the geometric reference AND keep the demographic anchor as an
  off-by-default *validation overlay* to confirm the resolution-invariant curve still lands
  ~historical (the allowed "deliberate scenario", never a driver).
- **Default-flip criteria:** invariance holds across 4 resolutions within a few %; 480 gates
  unchanged; 960 gates pass; map-quality diff acceptable; full-size perf improves. Only then
  flip `RES_INVARIANT_POP` to default (re-baselining the 320 guards), and only then is the
  demographic anchor formally retired to overlay-only.

## Effort

Multi-session. Steps 1–2 are a session each (implement + the resolution-invariance probe +
measure). Step 3 + the step-4 audit + full re-validation is another. The catchment perf
optimisation may be a fifth. High-value (retires the last real reason to keep the anchor,
and makes full-Earth runs both historical and fast) but foundational — hence lever-gated
and staged.
