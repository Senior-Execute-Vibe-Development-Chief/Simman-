# W25 — where the passes are

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W24
(`spec/handoffs/W24-passes-and-biomes.md`). ONE new bake
(`tools/build-passes.mts`, 19 s on the 1-arc-minute raster), ONE data module
(`src/ported/worldgen/passData.js`, 30,497 passes, 397 KB), and the crossings
lens redrawn from it. Nothing in the sim changed: no substrate field, no
kernel, no gate, no hash.

## 1. The question that started it

Owner, on W24's overlay: *"Those passes look VERY large and geometric and
odd?"* Told that a per-edge table can only be drawn on the grid: *"is the
way we figure out WHERE they are isn't good? I don't see how it CAN be."*
Then: *"build it"*.

## 2. What was wrong, in two lines

W21's table is the COST of crossing each sim-grid edge — the height of the
lowest route between two cell centres — and the router and migration are
right to charge it. It is not a pass: it has no position, it exists on every
land edge whether a range is there or not, and drawn (W24) it can only sit
on the grid. A pass is a property of the terrain, not of the grid.

## 3. The mechanism

### 3a. What a pass is (`tools/build-passes.mts`)

A saddle of the height field: the lowest point on the ridge joining two
summits, and the highest point on the route between the ground either side.
Two bars, each a physical statement:

- **The ridge drops to it.** Sweep the 1-arc-minute samples above the datum
  from the highest down, joining each to its already-swept 8-neighbours.
  Every swept sample belongs to one summit, the highest ground it reaches
  without descending below the sweep. Where the sweep first joins two
  summits' ground, that sample is their col, and the lower summit's height
  above it is the col's **prominence** — the drop the ridge makes to the
  crossing, which the higher summit's side matches or exceeds. A col is a
  candidate at `PASS_MIN_PROMINENCE_M` = 300 m; below it the "summit" is a
  shoulder and the "col" a dip in a flank. This is the standard prominence
  sweep, read from the col's side: the great passes are the key cols of the
  massifs they separate.
- **A route climbs to it.** The col stands at least `PASS_MIN_CLIMB_M` =
  300 m above the lowest ground within `PASS_APPROACH_KM` = 25 km
  (`TRAVEL_FOOT_KM_PER_DAY`: the ground a traveller stands on the evening
  before). Without this bar the list is led by the lowland cols between
  continents: the Suez isthmus is the col between Africa's summits and
  Asia's, 5,666 m below Kilimanjaro and 11 m above the sea. 8,199 of 38,696
  saddles fail it.

Cols at or below the datum are not passes. Ties in height join without a
record. No place is named; no sim grid is in the rule or the data.

### 3b. The data (`passData.js`)

Ten bytes per pass, sorted by prominence descending: raster column and row
(row 0 the south pole), altitude, prominence, climb. Decoded once by the
shell. It is display geometry: not on the substrate, not in the world hash,
not persisted, not read by any gate.

### 3c. The crossings lens

The W24 edge ticks are gone. Each pass is a disc at its own longitude and
latitude through the projection, larger and brighter the more its ridge
drops to it (white-hot at 1,500 m, the drop the great Alpine passes make),
ringed dark so it reads on snow and sea. At zoom 1 only the eighteen passes
of prominence ≥ 3,000 m are drawn — the cols that divide whole ranges; each
doubling of the zoom halves the bar, and the whole list shows from zoom 10.

## 4. What it found

30,497 passes. By prominence: ≥300 m 19,674; ≥500 9,317; ≥1,000 1,170;
≥1,500 231; ≥2,000 87; ≥3,000 18. By altitude: under 500 m 2,330; 500–1,000
7,689; 1–2 km 11,612; 2–3 km 3,898; 3–4 km 1,697; 4–5 km 2,169; over 5 km
1,102.

Read at the coordinates the list carries, the Alps (45.5–47.6°N, 5.5–13.5°E)
hold 34 passes of prominence ≥900 m. Among them:

| lat, lon | altitude | prominence | which |
|---|---:|---:|---|
| 45.88°N 7.08°E | 2,446 m | 1,825 m | the Great St Bernard (2,469 m) |
| 46.22°N 8.02°E | 2,151 m | 1,642 m | the Simplon (2,005 m) |
| 46.97°N 11.48°E | 1,696 m | 1,631 m | the Brenner (1,370 m) |
| 45.67°N 6.88°E | 2,313 m | 1,272 m | the Little St Bernard (2,188 m) |
| 46.57°N 8.57°E | 2,211 m | 909 m | the Gotthard (2,106 m) |
| 47.17°N 12.50°E | 2,382 m | 925 m | the Hochtor (2,504 m) |

None of these is named to the bake. The altitudes are the raster's, which
smooths a narrow col upward (the Brenner most of all).

## 5. Does it tell the truth?

The unit test decodes the list and checks every entry: above the datum,
above both bars, on the raster, climbing no more than its altitude, sorted
largest first. The lens draws those coordinates through the same projection
as everything else. The screenshot of the Alps at dev shows the Alpine arc,
the Apennines, the Pyrenees, Corsica and the Dinaric ranges as themselves,
with the great cols white; the ruled lattice is gone.

## 6. What this is NOT

- Not a change to what anything costs. The edge table is the right number
  for crossing an edge and the router and migration keep it.
- Not a change to the substrate, the hash, persistence or any gate.
- Not a survey: positions are within a sample (1.85 km) and altitudes are
  the raster's.
- Not a time gate and not a fitted outcome: two bars with physical meaning,
  no place, no year, no result named.

## 7. Verification

Lint, typecheck, unit (§5), `npm test` (smoke and kernel-parity; nothing in
the sim changed), chromium browser smoke (world and routing hashes
unchanged), the dev screenshot of the Alps.

## 8. What is still open

1. **A wide flat col on a plateau** passes both bars if the ridge drops and
   a route climbs within a day's walk; the Tibetan and Andean passes at
   4–5 km are real, but so is the occasional saddle between two plateau
   summits with no valley on either side.
2. **The raster's altitudes** stand above surveyed ones at narrow cols.
3. **Island summits** whose key col is under the sea have no pass; their
   coastal cols appear only through smaller summits.
4. **The list and the edge table are not reconciled**: an edge whose
   minimax route threads a listed pass is not linked to it. Linking them
   would let the router name the pass a route takes.
5. W24 §8.1–8.3 stand; W24 §8.4 is closed by this wave.
