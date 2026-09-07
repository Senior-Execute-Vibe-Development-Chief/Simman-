# W26 — the walk between two cells

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W25
(`spec/handoffs/W25-where-the-passes-are.md`). ONE new bake
(`tools/build-walks.mts`, 136 s on the 1-arc-minute raster, both grids), ONE
data module (`src/ported/worldgen/walkData.js`, 11.3 MB) replacing the W21
pass table (`passClimbData.js` and `tools/build-passheights.mts` are gone),
THREE substrate fields (`walkKm`, `walkAscent`, `walkDescent`) replacing
`passClimb`, the router's and the people table's land edge charged from
them, and routes drawn along the walk on the map. No constant of the sim
changed; no window or tolerance moved; no history was run beyond the gate's
dev solve arm.

## 1. The question that started it

Owner, after W25 put the passes where they are: *"can we make path finding
MORE realistic then?"* — *"build it"*.

## 2. What was wrong, in two lines

The router walked a chain of cell centres. Between two centres it charged
the straight distance, the rise between the two means, and (W21) twice the
height of the lowest crossing above them: three proxies for one walk. The
route it drew was the chain, and a road through the Alps was a straight
segment from one 22 km cell to the next.

## 3. The mechanism

### 3a. The rule (`tools/build-walks.mts`)

For every pair of adjacent LAND cells whose ground the crossing table joins
(the sim's own mask and W22 table, read from `buildSubstrate` at bake time,
so a walk exists exactly where the router may walk), search the 1-arc-minute
land samples inside the two cells' window (a diagonal's window holds its two
side cells, the router's no-corner-cutting rule) for the **cheapest walk**
from a's centre sample to b's under the sim's own foot law: every metre of
horizontal distance, plus vertical at the Naismith rate the ledger already
grounds — `TRAVEL_SLOPE_COST_FACTOR` days per `ELEVATION_METERS_PER_UNIT`
against `1 / TRAVEL_FOOT_KM_PER_DAY` days per km, one metre of vertical
worth ~8 m of horizontal. Water samples are not walked; ground below the
datum stands at the datum; a centre sample that is water starts from the
land sample nearest the centre. One walk serves both directions, so the
search weighs each metre of vertical at half the ascent rate, the mean of
what it costs one way (a climb) and the other (free).

Stored per edge, in the router's four directions per cell (E, SE, S, SW;
the other four are the neighbour's entry, as W21 and W22 laid it out):

- the walk's **length**, as its detour over the straight line between the
  centres in steps of `DETOUR_UNIT` = 0.002 (one byte: 1 = no detour, 255 =
  50.8% or more, 0 = no walk); the decoder multiplies this grid's own
  straight edge length back in, so the table is a shape, not a distance;
- its **ascent a→b** and its **ascent b→a**, the metres climbed along it in
  each direction, in steps of `VERTICAL_UNIT_M` = 4 m (their sum is the
  walk's total vertical, their difference the height between the two
  centre samples);
- its **waypoints**: the walk simplified (Douglas–Peucker) to at most
  `WAYPOINT_CAP` = 6 interior points that keep it within
  `WAYPOINT_TOLERANCE` = 8% of the straight length of the ground path, as
  window fractions (0–255). A drawing budget; the sim never reads them.

### 3b. Naismith the right way round

Before W26 a land edge cost `|Δmean| + 2 × climb` to whichever traveller:
the up AND the down of the hump, both ways, a symmetric proxy. Naismith's
rule, which is what `TRAVEL_SLOPE_COST_FACTOR` is grounded on, charges the
climb and not the descent. The edge is now directed, as the sail edges
already were: the router charges `walkKm` at the mode's days per km plus
the ascent IN THE DIRECTION OF TRAVEL at the slope factor (the stored
entry's ascent from the storing cell, its descent from the neighbour). A
route through a gorge that winds up 800 m and down 500 pays the winding and
800 m one way, 500 m the other. Where no walk is stored (an edge the search
could not reach, or a preset without a bake) the router falls back to the
straight geometry and `max(0, elevation[next] − elevation[cell])`, the same
convention on the means.

The people table (`src/sim/people/neighbors.ts`) reads the same walk for a
land step: `distanceKm` is the walk's length and `ascent` its climb in the
step's direction (a step west reads the western cell's eastward entry's
descent), with the same fallback; `landStepCost` and both kernels are
unchanged, so kernel parity holds to the bit.

### 3c. The drawn route (`src/shell/main.ts`)

A land leg is drawn along the edge's waypoints, mapped from window fractions
through the raster's own projection; a leg with no waypoints, a sea or river
leg, or a leg across the seam is the straight line as before. The road now
bends into the valley it takes.

## 4. What it found

| | dev 240×120 | target 1800×900 |
|---|---:|---:|
| land–land edges with ground | 34,912 | 2,181,466 |
| walked | 34,434 | 2,179,406 |
| unreachable → fallback | 478 | 2,060 |
| mean detour over the straight line | 1.011× | 1.008× |
| mean vertical (up + down) per edge | 1,672 m | 285 m |
| edges with waypoints | 970 (5 KB) | 65,867 (313 KB) |
| detours at the 50.8% cap | 60 | 1,305 |
| tables, raw | 148 KB | 7,797 KB |

The mean detour is small because most edges are flat and the straight line
is the walk; the mean vertical at dev is a 167 km edge's worth of ground.
The module is 11.3 MB (W21's pass table was 562 KB): two ascents and a
detour per edge on 2.2M edges. The bake takes 136 s, 97 of them building the
target substrate it reads its mask from.

**Routes** (`gate:travel`, both grids: pass, nothing stale, no band
widened). Every land route moves by a few percent, in days: dev
Rome–London 37.4 → 38.1, Rome–Paris 54.0 → 59.5, Alexandria–Antioch 39.4 →
40.7, Chang'an–Luoyang 12.8 → 14.2, Chang'an–Dunhuang 96.1 → 98.4,
Pataliputra–Taxila 57.1 → 57.6, London–Bordeaux 21.9 → 22.2; target
Rome–London 40.8 → 41.4, Rome–Paris 45.1 → 49.1, Alexandria–Antioch 34.6 →
36.3, Chang'an–Luoyang 13.0 → 13.0, Chang'an–Dunhuang 78.3 → 79.5,
Pataliputra–Taxila 52.8 → 53.0, and **Athens–Corinth 2.45 → 2.84 d against
ORBIS's 3** (error 18% → 5%: the walk over the isthmus is longer than the
straight line the grid drew). The sea rows move by ≤ 0.1% (the walk on a
port's land leg). No row changed status. A first draft that charged the
walk's total vertical both ways (the old symmetric convention on the new
measurement) put Chang'an–Luoyang at 15.5 d and failed its row at dev and
across grids; that was the convention being wrong, not the measurement, and
§3b is the fix — the manifest was not touched.

**People** (`gate:people`, dev solve arm: pass, nothing stale, every hearth
on its cell, every staple verdict the same). people −8000 13.18 → 13.18M,
−5000 110.8 → 110.4M, −3000 798.5 → 797.8M, −1000 1,376.2 → 1,375.8M, 1 CE
1,486.7 → 1,486.9M; the first caged basin −3064 → −3057; front speed 1.177
→ 1.171 km/yr; Nile −6613 → −6627, Indus −4429 → −4422, Mesoamerica −4212
→ −4205, south India −4793 → −4800, Balkans −6361 → −6354, central Europe
−5388 → −5367, Rhine −5010 → −4996, Cardial −5640 → −5633, inland Europe
−5703 → −5689 — every one inside its window.

## 5. Does it tell the truth?

The unit test decodes the dev table against the sim's own substrate: every
walked edge joins two land cells whose ground the crossing table links
(zero exceptions — an earlier draft that baked from its own majority mask
walked 1,679 edges onto sim water, which is why the bake now reads
`buildSubstrate`), every walk is at least the straight line and at most the
cap longer, both ascents are non-negative, an edge with no walk reads zero
on all three fields, and every waypoint list belongs to a walked edge and
holds 1–6 points. A fixture test sets one walk on one edge and checks that
the people table charges its length and its eastward ascent going east, its
westward ascent (the stored descent) going west, that a step onto a rise
with no walk charges the rise and a step off it nothing, and that every
other slot is bit-identical. The routing fixture carries zero tables, so
`npm test`'s routing hashes are unchanged, which is the fallback being the
pre-W26 rule exactly.

## 6. What this is NOT

- Not a new law: the foot law, the Naismith rate and the slope factor are
  the ledger's; the walk is those applied to the ground instead of to the
  means.
- Not a fitted outcome: no route, place or number is named to the bake; the
  gate rows above are readings, and the one that moved most moved toward
  its source without being asked.
- Not a time gate.
- Not a change to sea or river modes, to the people kernels, to the hash, to
  persistence, or to any window.

## 7. Verification

Lint, typecheck, unit (§5), `npm test` (smoke, unit, kernel-parity; routing
hashes dev 297213567 / target 2997680649 and world hashes dev
64e16935452e6c26 / target 217a88344bd3a6b1 unchanged), `gate:travel` both
grids, `gate:people` dev solve arm, oracle (exact where it was exact),
`bench --check`, chromium browser smoke, and a target-grid route screenshot
across the Alps: 7.7°E 45.1°N → 11.4°E 47.3°N reads 21.4 days over 24 cells by
pack, straight along the Po plain and bending leg by leg through the range
where the walks do.

## 8. What is still open

1. **Unreachable edges** (478 dev, 2,060 target) fall back to the straight
   geometry: two land cells the table joins whose centre samples' land is
   not connected inside the window (an islet, a lake shore). A wider window
   or the ground bit's own link would reach them.
2. **The cap.** 60 dev and 1,305 target detours are at 50.8% or more and are
   stored as 50.8%; the walk is longer than the router is charged.
3. **The corridor is still chosen at cell scale.** Each walk is the cheapest
   between two centres; the route is a chain of them and meets the centres
   with corners. A route that would leave a valley between centres cannot.
4. **The people table's coastal hop and the sea modes** are unchanged (W24
   §8.1 stands): only the land step reads the walk.
5. **The module is 11.3 MB**; it is read once at worldgen and not persisted,
   but it is the largest data module in the tree.
6. **The shipped-grid history arm** is a `v2-long` measurement: the walk
   term is a larger share of a 22 km step than of a 167 km one.
7. **W25 §8.4** (the pass list and the edge table are two readings) now has
   a third: an edge's waypoints show where its walk crosses, but the walk is
   not linked to the listed pass it threads.
8. W25 §8.1–8.3 stand; W24 §8.1–8.3 stand; W21 §8.2–8.6 stand.
