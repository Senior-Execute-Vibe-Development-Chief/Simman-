# W28 — the works (2026-09-08)

The built land capital: v1's validated LAND_WORKS ported to both kernels as the
field kernel it is. Capacity is no longer a fixed property of terrain times the
farmed share; it is BUILT by a cell's own people under pressure, on the ground
water can be led onto or a climate wet enough to drain and level, and it rots
where the hands that kept it leave. Owner: *"so, simply, what's next"* →
*"go"*.

## 1. The question that started it

P21's review against the spec (QUESTIONS #84, the same day) found that the
slow state the factor split asked for — something that accumulates in a PLACE
over centuries, so two equal valleys are not equally dense forever — is not
new state. It is `works`: 02 box 2 ("built land capital (irrigation,
clearing; decays unfed)"), 04 §4.1's capacity factor, the M2 ruling-10 slot
parked inert until M3+, and v1's LAND_WORKS phase, validated there. M3's order
is the works slot first, then the harvest years (W29), then the granaries and
the food books (W30). This wave arms the slot. It builds the system and
measures what falls out; it dials nothing toward a population.

## 2. What was wrong, in two lines

Farmed capacity was `fertility × 12 × yield × fit × (1 + t·standingGain) ×
(0.45 + 1.65·t) × (1 + 1.4·access) × relief × landShare` with `t` the farmed
share — 1.00 everywhere by 1 CE — so every farmed cell sat at its mature
ceiling a few centuries after the front arrived, and nothing a people did to
their own ground could densify a place.

## 3. The mechanism

### 3a. The improvable share (static)

`irrigableShare(world, cell)` = clamp01(surface access + wet), zero on water,
where surface access is W13's own field (the routed stream, the floodplain,
the river at 0.35 × magnitude, the lake — water that can be LED onto fields)
and wet = max(0, (annual moisture − 0.55) / 0.45) × 0.6 — a climate wet enough
that its works are drainage, terracing and levelling, needing no water
brought. v1's `_ensureIrr` had the same two terms; the one difference is the
water term: v1 gave a great river 1.0 and a floodplain flag 0.85, here the
term is what W13 measures. Filled once in `fillStaticHabitability` into
`_irrigable`, scratch, rebuilt from the substrate.

### 3b. The law (`src/sim/people/works.ts`, `works_band` in the Rust kernel)

Per land cell, on the firing's committed people and derived capacity:

```
improvable = _irrigable[cell];  skip if improvable ≤ 0 and works ≤ 0
fill  = capacity > 0 ? people / capacity : 0
if improvable > 0 and fill > 0.5 and technique > 0.05:
    works += 0.0024 · (dt/12) · (fill − 0.5) · technique · improvable
staffed = fill > 0.25 ? 1 : fill / 0.25
if staffed < 1:  works −= 0.0018 · (dt/12) · (1 − staffed) · works
works = clamp01(works)
```

BUILD where the people press their ceiling (Boserup: intensification once
extensification is exhausted), at the skill of the farmed share, on the
improvable ground. ROT where the basin is under a quarter staffed, in
proportion to the missing hands: a die-off or an exodus leaves a scar that
must be rebuilt. Every constant is v1's with its unit converted
(`YEARS_PER_STEP = 0.5`), cited in the ledger §W28.

### 3c. The effect and its order

`packageCapacity = packageCapacityAt(…, technique) × (1 + 2·works)`, the last
factor in the chain in both kernels, bit-identical. `packageCapacityAt` — the
stand's capacity, a hearth's site quality, a first cultivator's question — sees
unimproved land. Self-limiting: building raises the ceiling, which lowers the
fill, which slows the building; the migration law then pulls people into the
built basin, which is the hotspot.

### 3d. The pass and the capacity

`people.works` is the seventh schedule entry, on the growth stride (solve: the
84-month reaction stride; awake: 12), after the commit epilogue, and the
capacity is derived again at once. The first cut left the capacity to the next
firing's derivation — v1's one-firing lag — and the smoke's continuation check
caught it: capacity is derived scratch, rebuilt on load, so a loaded world's
capacity carried the works one firing before the world it was saved from, and
the monthly migration reads that capacity. A present consequence of the state
is re-derived the moment the state moves.

### 3e. The state

`works` is a full-grid field in `FIELD_LIST`: allocated, defaulted, hashed,
persisted (save v9), `field.works.*` in `collect()`, a sixth snapshot plane,
the "Land works" lens (dark earth → the blue-green of a watered field). The
Rust kernel holds `works` and `irrigable`, exposes `works_ptr()`,
`begin_works(dt)`, `works_band(lo, hi)` and the threaded
`people_dispatch_works`; the coordinator's `buildWorks` is a seventh band
operation. The caging room (`wake.ts`) charges the same factor.

## 4. What it found

Dev solve arm, the per-commit people gate, against the pre-W28 tree run in a
worktree:

| | W27 | W28 |
|---|---|---|
| people −8000 / −5000 / −3000 / −1000 / 1 CE (M) | 13.16 / 110.7 / 799.4 / 1,376.0 / 1,486.8 | 13.16 / 114.1 / 896.8 / 1,849.7 / 2,108.0 |
| density ordering river / rain-fed / forager (persons/km²) | 24.0 / 14.3 / 0.087 | 34.4 / 20.3 / 0.087 |
| first caged basin | −3071, 17.3°N 99.8°E | −2763, 15.8°N 101.3°E |
| front speed (km/yr) | 1.183 | 1.189 |
| hearths, staples, farmed-cell counts | — | every one the same |
| arrivals moved (one 84-month stride each) | — | Sahel −4940 → −4947, south India −4793 → −4807, central Europe −5374 → −5367, Rhine −5010 → −5017 |
| the arm | 21.2 s | 23.1 s |

The 1 CE decomposition rerun with the works (`probe-factors2.mts`, the
session scratchpad; the columns of #84 plus population, the improvable share,
the works and their multiplier):

| region | pop (M) | improvable | works | ×works | cap unimproved → live (/km²) | area works > 0.5 |
|---|---:|---:|---:|---:|---|---:|
| Southeast Asia | 71 | 0.34 | 0.83 | 2.66 | 21.7 → 51.8 | 88 % |
| China proper | 167 | 0.24 | 0.73 | 2.46 | 19.6 → 45.2 | 75 % |
| Siberia, Central Asia, Mongolia | 158 | 0.18 | 0.53 | 2.06 | 5.7 → 13.0 | 49 % |
| Mesoamerica and Caribbean | 147 | 0.22 | 0.51 | 2.02 | 18.2 → 34.8 | 44 % |
| sub-Saharan Africa | 567 | 0.21 | 0.50 | 2.00 | 17.0 → 34.7 | 49 % |
| North America (north of 33°N) | 212 | 0.21 | 0.50 | 2.00 | 11.3 → 23.2 | 45 % |
| Japan | 5 | 0.13 | 0.50 | 1.99 | 6.1 → 12.8 | 33 % |
| Europe incl. European Russia | 170 | 0.17 | 0.47 | 1.94 | 16.0 → 30.9 | 44 % |
| South America | 377 | 0.34 | 0.40 | 1.80 | 21.4 → 36.9 | 31 % |
| Indian subcontinent | 100 | 0.23 | 0.39 | 1.78 | 20.6 → 35.5 | 25 % |
| Egypt | 5 | 0.08 | 0.31 | 1.62 | 1.2 → 2.3 | 23 % |
| Levant, Mesopotamia, Iran, Arabia | 18 | 0.06 | 0.23 | 1.47 | 1.7 → 3.0 | 16 % |
| WORLD | 2,108 | 0.20 | 0.46 | 1.92 | 13.3 → 26.1 | 41 % |

World: 150.3 Mkm² of land, 85 % improvable, 55.6 % carrying any works and
holding 97 % of the people; 16.05 Mkm² at works 0.9–1.0; farmed density 15.0
→ 21.4 persons/km².

Two findings.

**(a) The works build where the rain is.** At 165 km cells the improvable
share is the wet climate's: W13's strip is one cell wide and a river gives
0.35 × magnitude on its own cell, so the rain term (up to 0.6 of a cell above
moisture 0.55) is almost the whole share, and the works stand fullest in
monsoon Asia, the Congo–Guinea belt, Amazonia and the temperate forests and
least in the dry valleys the mechanism was written for — the Nile box at 0.31
on an improvable share of 0.08, Mesopotamia at 0.23 on 0.06. The mechanism is
right and the water term at this grid is thin; whether the shipped grid's
valley strips carry it is the `v2-long` arm, recorded as needing one. Nothing
is raised to make the Nile build.

**(b) It takes back none of the excess.** The ceiling is ×1.96 over the farmed
world and the 1 CE checkpoint 1,487 → 2,108M, fuller exactly where P21 says
the capacity is in the wrong places (sub-Saharan Africa 567M, South America
377M, North America 212M). The works multiply whatever capacity is there, at a
skill that is the farmed share (P21's technique-term ruling, open), and the
deaths are W29's. That is the honest answer to "how much of the excess does
the slow state take back": a multiplier on the ceiling cannot; the harvest
years and the land's own productivity must.

## 5. Does it tell the truth?

The mechanism is v1's, validated there with a development field for the
skill; the constants are v1's with their units converted and each has a
physical meaning of its own (a yield premium, a Boserup threshold, a staffing
floor, a build-out time of centuries, a rot half-life). The improvable share
is the honest W13 access plus v1's wet-climate term — no place is named, no
river is given a share it did not measure. The two-kernel field is
byte-identical over the whole dev substrate. What the measurement says — the
rain builds and the valleys do not, at this grid — is a finding about the
water term at 165 km, and it is recorded as one instead of being tuned away.

## 6. What this is NOT

- Not the harvest years or famine (W29): nothing here kills; the works only
  add.
- Not the granaries or the food books (W30): no stock, no flow, no community.
- Not soil fatigue or deforestation: the other ruling-10 stocks stay inert.
- Not a development state: the skill is the farmed share, so the works build
  at full rate from the front's arrival (P21's technique ruling).
- Not the paddy: the standing-water gain (W15) and the works overlap on
  flooded rice ground and multiply there; the wet-rice multiple is kept out of
  the gain for that reason.
- Not tuned: no constant was chosen against a population.

## 7. Verification

lint (eslint and the ledger lint: every W28 constant cited), typecheck
(no non-probe errors), unit (`works: ok`: the improvable share on the
fixture and its wet, floor and dry values exact; the law on a wheat cell
with a forced improvable share — the build exact, the capacity multiplied
exact, `packageCapacityAt` unchanged, the rot exact, the clamp at 1,
nothing on non-improvable ground; the schedule's seventh entry on the
growth stride; save, load and hash carrying the field; the two kernels'
works byte-identical over the dev substrate after one firing), `npm test`
(smoke on both grids, including the continuation across a save with the
works in it — the check that caught the capacity lag of §3d; unit; kernel
parity with the works pass in every cadence), gate:travel both grids (pass,
nothing stale, no route moved: the works are not in the travel cost),
gate:people dev (pass, §4; both 12-tick mechanical arms byte-identical in
their totals, the dawn's foragers having no skill to build with), `bench
--check` (pass, no re-baseline: dev tick 0.48 ms and solve year 0.91 ms
against baselines of 2 and 1.6; target tick 19.8 ms and solve year 123 ms
against 22 and 190; the target substrate 47.6 s against 52 — the works pass
and its capacity derivation sit inside the spread), oracle (`ok`; no
worldgen code changed), chromium browser smoke (`ok`, the world hashes
those of the smoke: dev be1a4d588b95bf77, target 31fe370fa94bde82), and
`npm run coverage` at the root (the v1 tool walks the v1 world and reports
the standing `_goodsFlowsLevy` residue, as at W27).

Not run, by the owner's directive of 2026-09-03: any arm that simulates
history at the shipped grid. The W28 shipped-grid solve arm — the one that
says whether a valley strip carries the improvable share (§4a) — is
recorded as needing `v2-long` (`GATE_PEOPLE_SOLVE_TARGET=1`).

## 8. What is still open

1. **The water term at 165 km cells** (§4a): the `v2-long` shipped-grid arm
   says whether a valley strip carries the improvable share a desert cell
   cannot.
2. **Skill = farmed share**: the technique-term ruling of P21, which now
   governs the works' build rate as well.
3. **The paddy–works overlap** on flooded rice ground: a ruling on the split.
4. **The reconstruction carries no works**: the seek before the wake shows
   unimproved land.
5. **The caging room reads capacity at fit 1** (`farmerRoom`: no crop fit, no
   standing gain, no land share — pre-existing, its comment predates W8). It
   overstates the free room where the fit is below one, so the wake is later
   than the capacity says; a wave of its own, since moving the wake moves
   every awake-regime measurement.
6. **The 385-year half-life** against v1's "~two-century" prose: the rate is
   v1's, the prose was per-year arithmetic on a per-tick constant.
7. W27 §8.1–8.7 stand.
