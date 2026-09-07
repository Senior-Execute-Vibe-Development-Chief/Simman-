# W22 — ground and water

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W21
(`spec/handoffs/W21-the-lowest-crossing.md`). ONE bake
(`tools/build-crossings.mts`), ONE generated data module
(`src/ported/worldgen/crossingData.js`), ONE substrate field (`crossings`,
which replaces W18's `straitWidthKm`), THREE constants (a unit and a layout),
and ONE rule in each of the three places the sim asks whether two adjacent
cells are joined: the router, the people neighbour table and the river
generator's ocean fill. The hand-carved strait list is deleted. No metric was
added; no people constant changed; no history was run beyond the gate's dev
solve arm.

## 1. The question that started it

After W21 the owner asked what was left: *"So what now? Island and strait
stuff?"* The standing direction was already set — make islands work, make the
Bosporus and Malacca emerge from the source rather than from a hand list — and
so was the constraint on how: *"2 will cut places like Malaysia in half
though"*, on the proposal to carve cells so a strait shows on the raster.
Nothing may be carved or drowned. The answer stated back was that a strait is
not a property of a cell at all but of the EDGE between two cells, and that
the 1-arc-minute source W19a–W21a already read could measure, for every edge,
whether ground joins the two cells and how wide the water between them is.

## 2. What was wrong, in one line

A cell's land bit is a majority vote over a few hundred km², and a vote has no
shape. Every consumer of adjacency inferred the edge from the two votes: two
land cells were joined by ground and never by water, and any edge touching a
water cell was open sea. So the Bosporus did not exist (two land cells),
Malacca did not exist (two land cells), and W18 patched exactly five of these
by name with a carve. Meanwhile a land cell that touched a water-majority cell
at one corner while holding no sea at all was a port, and a cell of Anjou was
sailed through from the Channel into Biscay — the same inference, wrong the
other way.

## 3. The mechanism: measure the edge, store the edge

`tools/build-crossings.mts` walks the fine samples of every pair of adjacent
sim cells, for both grids the app builds, and stores one byte per edge, four
directions per cell (E, SE, S, SW; the other four are the neighbour's opposite
entry):

- **Bit 7, ground.** Set when an 8-connected path of land samples joins the
  two cells' land SEATS. A seat is the sample nearest the cell centre inside
  the cell's LARGEST body of land, so an islet at the centre does not stand
  for a mainland cell.
- **Bits 0–6, water width.** The width in samples (`CROSSING_SAMPLE_KM`,
  1.853 km, one arc-minute of meridian) of the widest 4-connected water
  channel joining the two cells' water seats — the maximum over paths of the
  minimum distance-to-land along the path, as `2d − 1`. 0 is no water path;
  127 is open water. The water seat is the most open sample of the largest
  body of water.
- **Window**: the two cells' bounding box; a diagonal pair's box holds the two
  side cells, the router's own no-corner-cutting rule applied to the samples.
  Land takes 8-connectivity and water 4-connectivity, so a land path and a
  water path can never cross at a corner — an edge can carry both (a coast
  road beside a channel) but never by a topological accident.
- **No place is named.** The bake is blind by coordinate; the honesty check
  is a probe that looks up known straits and known land bridges afterwards.

Consumers:

- **Router** (`relax_neighbors`): a land mode crosses an edge only where
  ground joins; a sea mode only where the water width is nonzero; river mode
  reads neither. This subsumes M1's "an edge between two land cells is not
  sailable": two land-majority cells with a channel between them are two
  banks a ship passes along.
- **People** (`buildPeopleNeighborTable`): a land neighbour joined by ground
  is a land edge; a land neighbour NOT joined by ground but with a channel
  between is a coastal hop at `min(edge, width × CROSSING_SAMPLE_KM)` if that
  is within `PEOPLE_COASTAL_HOP_KM`; a water run is a hop only if every step
  has nonzero width. This is W18's `min(edge, channel)` rule on every edge
  the source measured instead of the five the list named.
- **Ocean fill** (`computeRivers` step 1c): the open-ocean flood crosses every
  edge whose width is nonzero, whatever the two majorities; a land cell it
  reaches is a conduit, never an ocean cell. Withheld under `rawRivers` (the
  oracle's v1-verbatim arm) with the rest of the baked river data.
- **Fallback**: a preset or grid with no bake gets exactly the old inference
  (ground between land cells, open water on any edge touching the sea), so
  the routing, gate and people fixtures are byte-identical to their pre-W22
  selves. `buildSubstrate` throws if a table's length disagrees with the grid.

## 4. Does the table tell the truth?

Looked up by coordinate at both grids, after the bake: Bosporus and
Dardanelles width 1 (~1.9 km), Messina 1, Magellan 1, Gibraltar 7 (~13 km),
Malacca 7 — the five the carve used to name — and straits the list never had:
Øresund 3, Kerch 7, Bonifacio 5, Torres 25 at dev / 29 at target, Bering 51 at
dev and open at target. Suez and Panama are not water-linked. Land is not
linked Thrace–Troad, Calabria–Sicily, Malaya–Sumatra, Spain–Morocco,
Jutland–Zealand; it is linked Kra–Johor, Egypt–Sinai, Costa Rica–Colombia.
Counts: dev 40,057 ground links and 77,925 water links, 7,122 narrower than a
cell; target 2,211,517 and 4,303,446, 79,046 narrower than a cell. 38 KB and
598 KB base64.

One physical consequence was measured with no history (substrate only, table
against fallback at dev): the **Baltic** turns from a terminal sea to an
exorheic one through the Øresund's 3-sample channel; the Caspian and the Aral
stay terminal; every other sea reads as before; 125 of 28,800 `drainsTerminal`
cells differ.

## 5. What it moved

**Routing.** Target: the 15 reality rows keep their status (Rome–London
37.5 → 40.4 d, still the M7 no-roads miss). **Dev: four sea rows now fail**,
and honestly so — the table refuses what the 165 km raster had been granting.
Rome–London 31.6 → 36.3 d now sails the Channel on a land-to-land edge with
50 km of water where it used to land-bridge it; Calicut–Aden 43.0 → 52.5 and
its monsoon row 27.8 → 38.3 because the gate's dev start cell is inland
(landFraction 1.000) and walks a cell to water; London–Bordeaux 10.9 → 21.8
rounds Brittany instead of crossing Anjou. Six rows added to
`known-misses.json`, three stale reasons rewritten; **no band was widened**,
and `gate:travel` passes at both grids.

**People (dev solve arm, the pre-W22 tree re-run for the baseline).** Pass,
54 rows acknowledged, none stale. The European front, which W18 had let across
the carved Aegean and Bosporus cells, now crosses on the measured channels and
arrives later west of them: Balkans −6627 → −6361, Rhine −5171 → −5010,
Cardial coast −5871 → −5647, every one still inside its window. Outside
Europe the arm is unmoved to within a decade; the first caged basin is −3071
on both; every hearth is on the same cell; every staple verdict is the same.

## 6. What this is NOT

- Not a carve: no cell's elevation, mask or landFraction changes, and Malaysia
  is not cut in half. The oracle's v1 copy drops its carve too so the two
  elevation fields still agree byte for byte.
- Not a per-cell strait field: `straitWidthKm` is gone; width lives on the
  edge it belongs to.
- Not a change to what a cell IS: a land-majority cell is still where land
  modes live, a water-majority cell where sea modes live (§8.2).
- Not current, depth, tide or ice: the width is geometric.
- Not a time gate and not a fitted outcome: nothing names a place, a year or
  a result; every byte is a measurement, and the tests that name straits are
  reading the answer, not writing it.

## 7. Verification

Mechanical only, per the owner's directive: `lint` (eslint + ledger-lint),
`unit` (a W22 people-table test and a router edge test that changes three
edges of the fixture and shows only those three routes move), `kernel-parity`,
`smoke` (routing hashes dev 297213567 / target 2997680649, changed as they
must), `gate:travel` at both grids (pass, manifest exact), `gate:people` at
dev (pass; the pre-W22 baseline above is the stashed tree run once),
`oracle` (ok after the crossings were withheld under `rawRivers`),
`bench --check` (pass with no re-baseline: target substrate 39 s against
the 52 s cap, query 1620 ms against 1800, distance map 1247 against 1900),
browser smoke on chromium (identical world hashes, the same routing hashes
as `smoke`), and `npm run coverage` at the repo root for the new substrate
state. That tool walks the v1 world, which has no `crossings` field; it
reads 274 of 274 properties, proves 171 by perturbation, and fails on ONE
v1 entity collection, `_goodsFlowsLevy` (102 leaves), which entered the v1
sim in commit `26bc0f3c` and is unrelated to W22. Recorded here as the v1
tool's standing residue; W22's own field is measured by nothing in
`collect()`, exactly as W19a–W21a's fields are (W21 §8.6).

## 8. What is still open

1. **One seat per cell.** A cell holding two disconnected bodies is stood for
   by its largest, so a land cell with the Channel on one side and Biscay on
   the other is a port on one of them only. That is the price of per-edge
   storage and exactly what stops the Anjou corridor.
2. **The shore inside a water-majority cell is unreachable on foot.** Land
   modes are available on land-majority cells only, so a traveller in a
   sea-less cell next to one cannot walk to that shore and embark, though the
   bake knows the ground joins (65,984 mixed-mask edges at target). Opening
   land modes on any cell with a land seat is a mode-mask and terrain-cost
   wave.
3. **Two majorities.** The bake's land majority is ETOPO's; the sim's mask is
   the coarse heightmap's. 73 dev and 1,401 target land cells hold no ground
   link at all (most are single-cell islands, which is right).
4. **The gate's `cellAt` rounding** places Calicut a cell inland at dev, which
   is most of the Calicut–Aden dev miss.
5. **Migration still reads the mean slope** (W21 §8.1) and the **roughness
   bake** (W21 §8.3) are unchanged.
6. **The crossing edges are not drawn.** The map shows the land plane; a
   channel narrower than a cell is invisible on it, though the table knows it.
7. Coverage for the W19b–W21 fields was recorded as not run in W21 §8.6; W22
   runs the tool for `crossings` and records what it says.
8. Shipped-grid history arms for W17–W22 remain `v2-long` on request; what
   the measured Aegean, Marmara and Korea Strait do to `arrival:japan` and the
   European rows at the shipped grid is the first thing that arm should read.
