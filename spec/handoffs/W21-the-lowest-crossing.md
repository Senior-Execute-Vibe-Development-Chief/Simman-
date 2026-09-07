# W21 — the lowest crossing

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W20a
(`spec/handoffs/W20-the-shape-of-the-land.md`). Two parts. **W21a** adds ONE
baked data module, ONE substrate field, ONE layout constant and ONE term in the
router's ascent cost: the pass height of every land edge, measured on the
1-arc-minute source. **W21b** adds ONE exact pruning to the router's search and
records, with arithmetic, why the partition overlay the router has labelled
since M1 is not built. No metric was added; no law outside the router changed;
no history was run.

## 1. The question that started it

After W20a the owner asked what else the 1-arc-minute source could give the
sim without touching its cell count, and named two things: the mountain the
router walks over as if it were its mean, and the speed of the router itself.
The answer stated back and approved was one bake that turns fine terrain into
coarse edge costs — "it fixes the mountain and it fixes the speed" — with the
water-passage table explicitly out of scope. **"Do it."**

## 2. What was wrong, in one line

A cell's elevation is the MEAN of its samples, and the router charged the
difference of two means as the climb between two cells. A mean is extensive; a
pass is extremal — the minimum over crossings of the maximum along each — and
two cells with the same mean can have a ridge between them or a valley through
one. The raster was averaging away exactly the quantity that decides whether a
route goes over or around.

## 3. The mechanism: the river bake's search, with one operator changed

`tools/build-riverdir.mts` already walks the fine samples to measure a river's
gradient by SUMMING along the channel. `tools/build-passheights.mts` runs the
same bounded search between two adjacent sim cells' centre samples and takes
the MAX along each crossing and the MIN over crossings — a bottleneck Dijkstra
inside the two cells' bounding box. The stored value is what the mean does not
already carry: `max(0, PASS − max(mean_a, mean_b))`, in 32 m steps, one byte
per land–land edge, four directions per cell (E, SE, S, SW — the other four are
the neighbour's opposite entry, so each edge is stored once). Rules:

- **Window**: the bounding box of both cells' samples; a diagonal edge's box
  includes the two side cells, which is the router's own no-corner-cutting rule
  applied to the fine grid. The neighbour's columns are unwrapped across the
  antimeridian so the box is one contiguous rectangle (the first bake got this
  wrong on the two wrap columns and every wrapped entry saturated at 8160 m —
  the bake now throws on an unreachable goal instead of clamping).
- **Endpoints excluded** from the max — the climb from a's centre is already
  paid by `|Δmean|`; the table carries only what rises ABOVE the higher cell.
- **Sea samples count as 0**, and only land–land edges (majority rule, the
  same as the three earlier bakes) are stored.
- **Cheap exact case**: if the straight segment between the two centres never
  rises above the floor, the minimax cannot either, and the entry is 0 without
  a search.
- **Per sim grid**, not a plane: a plane-level 4-direction table for 3600×1800
  measured ~4.7 MB and deriving the coarse edge from it at build time would
  add seconds to the substrate row at dev. One exact table per grid the app
  builds is 31 KB + 528 KB; any other grid is one command
  (`npx tsx tools/build-passheights.mts <etopo1.bin> WxH`).

Router side, in `relax_neighbors` for the land modes only:

```
slope = (|elev[next] − elev[cell]| + 2·climb) · slope_factor
```

Twice, because the crossing rises `climb` above the higher mean and comes back
down: 100 → 1000 → 300 m is 900 up + 700 down = `|200| + 2·700`. Sail and
river modes never see it. A grid or preset without a table reads zero, which
is byte-for-byte the cost the router charged before.

## 4. Does the table tell the truth?

Measured blind by coordinate on the decoded tables (`§W21a` in the ledger has
the full rows): the largest entry at dev is 2,240 m at 44.3°N 89.3°E heading
south — the Bogda Shan; at target 2,112 m at 60.7°N 140.5°W heading south —
the St Elias front. Innsbruck's dev cell reads 192 m over the Brenner side,
Santiago's 896 m east over the Andes, Tbilisi's 640 m south, the Khyber cell
384 m with 1,024 m arriving from its north-east neighbour; at target Andorra's
cell reads 448–480 m northward across the Pyrenean crest. Kathmandu reads 0 at
dev because a 167 km cell holds the whole range inside it and its neighbours'
means already carry it, which is the mean doing the table's job — and the
reason the share of edges with any extra climb FALLS from 33% at dev to 9.3%
at target: the table telescopes toward zero as the grid approaches the source.
No capped entry remains on either grid; the two wrap columns hold 19 and 38
ordinary values.

## 5. What it moved, and the speed

**Routes.** The 29 reality route rows move by at most 1.2% in days; no row
changed status; the known-miss manifest is neither stale nor exceeded;
`gate:travel` passes at both grids. 1 route at dev and 5 at target now take a
different path. Land-mode distance maps from the route origins: dev mean
+0.37%, max +6.4%; target mean +0.26%, max +8.3%, with 5,965 of 224,545
reached cells more than 1% farther. This is the honest size of the effect
under the existing Naismith constant: a 1,000 m pass costs 0.64 days, hours to
a day, which is what a pass costs a walker. The mechanism moves the cells the
mean lies about and the route choice around a ridge; it does not make a
mountain traverse slow per kilometre, which is the per-cell terrain factor's
job and is not this wave. The ORBIS routes are lowland routes and were never
going to feel it much; the table exists for the routes the gate does not have.

**Speed (W21b).** The router's `preprocess()` has labelled 16×16 partitions
since M1 that nothing reads. Before building the customizable-route-planning
overlay on them, the arithmetic: a 16×16 block has 60 boundary cells to 196
interior, so the overlay's whole benefit is the 4/B boundary ratio; a boundary
clique of (60 cells × modes)² entries per block over the ~2,200 land-bearing
blocks of the shipped grid is hundreds of megabytes per metric, and filling it
is an all-pairs search inside every block at every `customize` — tens of
seconds against the ~1 s customize costs today. And the sim never routes per
tick: `query` and `distanceMap` are called by the shell, the gate and the
bench only; people migration uses the per-cell terrain factor through the
kernel. An overlay that makes a 1 s query 100 ms at the cost of 20 s per
metric and hundreds of MB does not pay here. A* with the fastest-mode
great-circle bound is exact but ~7× slack on land (open sea at 168 km/day
with a following wind against foot at 25) and was not built either.

What was built is the one exact win the measurement found: the three land
modes share every per-edge factor and differ only by a constant speed, so a
mode another mode beats everywhere it exists can never carry a strictly
shorter path. `customize` now marks such modes dominated (available on every
cell the other is, no dearer on any, strictly cheaper somewhere; identical
pairs keep the lower index) and the search never opens their nodes. Under the
default metric pack dominates foot and cart, so the search opens one land node
per cell instead of three. Verified bit-identical against the unpruned module
in one process on one substrate: 10 distance maps under 5 metrics and 60
queries per grid — target 7,288,126 finite entries, dev 134,362 — 0 entries,
0 days, 0 paths differ. Target query 1,671 → 1,149 ms and distance map 1,695 →
1,175 ms in the same process; the bench rows are in §7.

## 6. What this is NOT

- Not a per-cell terrain change: `terrainFactor`, relief, cold and mud are
  untouched, and so is every people-kernel array.
- Not a water passage table: a strait's or a channel's real width on a sea
  edge is the same search on the other plane and is deliberately out of scope
  (the owner's framing; W18 carries the carved widths).
- Not a change to migration: the kernel's migration cost has no slope term
  at all and does not read the table. Adding it is a kernel-and-parity wave.
- Not a time gate and not a fitted outcome: nothing in the bake or the router
  names a place, a year or a result; every entry is a measurement.

## 7. Verification

Mechanical only, per the owner's directive: `lint` (eslint + ledger-lint),
`tsc --noEmit`, `unit` (routing arm included), `kernel-parity`, `smoke`,
`gate:travel` at both grids (pass, manifest exact), `bench --check`, `oracle`,
browser smoke on chromium. The routing hashes in `smoke` and `gate:travel`
changed with W21a, as they must — every edge with a nonzero entry costs more —
and did not change again with W21b, which is the pruning's proof. Bench rows
and re-baselining: see `bench-baselines.json` notes (W21) — query and
distance-map rows down by the measured ratio (target 2600 → 1800, 2700 →
1900; dev 60 → 45, 32 → 24), dev routingInitialize 20 → 40 on measured
identity (the row is one wasm read-and-instantiate, 35–50 ms on this runner
for the pre-W21 and W21 modules alike), target init/customize untouched.

The pass table crosses into the router as **f32**, not f64: the bytes are
32 m steps so single precision carries them exactly (the hashes prove it), and
at the shipped grid the f64 path cost a 52 MB `Float64Array.from` on the JS
side plus a 52 MB copy in wasm memory — ~300 ms of the first target
construction, measured against the pre-W21 module with the same probe. With
f32 the first construction at target is the same for both modules within the
runner's noise (1.2–2.0 s), and the table itself is 26 MB.

## 8. What is still open

1. **Migration does not see passes.** `fillMigrationDaysPerKm` and the kernel
   read `terrainFactor` per cell; the front walks over ridges at their mean.
   The table is on the substrate; the wave is the kernel's edge cost plus
   parity.
2. **Height, not dryness**, as in #73(c): samples below sea level count as 0.
3. **The per-cell terrain factor is still the mean's.** Slowness per km across
   broken ground (as opposed to the height of the one crossing) is a
   different statistic of the same samples — a roughness — and would be its
   own bake.
4. **`preprocess()` still labels partitions nothing reads.** Left as the M1
   phase marker it is; the overlay is recorded as not paying on this raster.
5. **Shipped-grid history arms** for W17–W21 remain `v2-long` on request.
6. W19a/W20a added substrate fields without running the v1 `npm run coverage`
   tool; W21a adds `passClimb` the same way (it is read by the router, which
   `collect()` does not measure). Recorded here rather than run.
