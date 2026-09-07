# W23 — what is water

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W22
(`spec/handoffs/W22-ground-and-water.md`). ONE shared rule
(`tools/lib/fine-water.mts`) that the four 1-arc-minute bakes now read
instead of each testing altitude on its own, FOUR regenerated data modules
(`landCoverData.js`, `landShapeData.js`, `passClimbData.js`,
`crossingData.js`), ONE rule in worldgen (a cell is land when at least half of
it is land by the fine cover) mirrored in the oracle's v1 copy, and one tone
removed from the sailing lens because the cells it painted no longer exist. No
metric was added; no state was added; no people constant changed; no history
was run beyond the gate's dev solve arm.

## 1. The question that started it

The sailing lens (W22d) kept one tone for the cells the two grids disagreed
on: land in the sim's coarse mask that the fine source found mostly under
water. The owner asked what the grey tiles were and, once told they were three
different things, ruled: *"i want the small islands and real water ones to
just become water tiles, and the dry ground below sea level to become land
tiles."* That is two fixes. The first is a definition — what the bakes call
water. The second is whose majority the sim's mask believes.

## 2. What was wrong, in two lines

1. **The bakes read `altitude ≤ 0` as water.** ETOPO1 carries no water mask,
   so the Qattara Depression, Lake Eyre, Death Valley, the Turfan floor, the
   Chott el Djerid and the Dead Sea's shore were water to every 1-arc-minute
   bake: no land seat, no ground link, no pass climb, impassable on foot and
   to migration. The coarse bake (`build-earthdata.mts`) had the right rule
   since 2026-09-01 — ocean by flood fill plus sea-sized enclosed bodies,
   smaller enclosed water returned to land — and the fine bakes did not.
2. **The sim's mask was the coarse heightmap's own majority**, a 6-arc-minute
   vote that seals every channel narrower than ~11 km and then, having sealed
   it, calls the bay behind it an enclosed pond and lands it: the Azov, the
   Marmara's north row, the head of the Gulf of California, Maracaibo, the
   channels of the Canadian Arctic archipelago. The fine bakes knew better
   (cover 0.02 over the Azov) and the router's ground bit knew better (no
   ground link to any neighbour), but the cell was land, so nothing could
   settle it and no ship could enter it from a land cell (§W22 handoff §8.10).

## 3. The mechanism

### 3a. One definition of water (`tools/lib/fine-water.mts`)

`buildFineLand(src, W, H)` returns a byte per source sample: 1 = land. A
body of standing water is the set of samples at or below ITS OWN SURFACE that
connect to that surface (4-connected, x wrapping, the +180 column folded onto
−180):

- The **ocean's** surface is the datum — altitude 0 is what "sea level"
  means — and it is entered from the two polar rows.
- An **enclosed body** (samples at or below the datum the ocean does not
  reach) of at least `ENCLOSED_SEA_MIN_KM2 = 100,000` km² is a sea, the same
  bar the coarse bake has used since the mask was regenerated (the Caspian,
  ~371k km², is the archetype; the Aral, ~68k km², is not). But its surface
  is NOT the datum. A landlocked sea stands at its own level, and the ground
  between that level and the datum is dry: the Caspian's surface lies ~28 m
  below the datum, and the depression round it — Astrakhan at −18 m, the
  Volga delta's apex at −24 m, the Volga's floodplain at −5 m up to
  Volgograd, the Kalmyk steppe — lies between the two. The first draft of
  this wave read all of that as sea (as the coarse bake still does), and the
  travel gate caught it: the Volga's mouth moved up to 48.6°N. A height grid
  shows a water surface as the one thing dry ground never is at this pitch:
  FLAT, a connected patch of samples at one altitude. So the sea's level is
  the altitude of its largest flat patch (ties to the higher), the sea is what
  lies at or below that level and connects to the patch, and it must still
  clear the bar once levelled. Measured: the Caspian's largest flat patch is
  12,349 samples at −28 m (the next, 5,325 at −29 m); 165,310 samples are
  sea and 119,415 (~280,000 km²) of dry rim return to land. Karagiye
  (−134 m, cut off from the surface) is land; Kara-Bogaz-Gol (−29 m,
  joined) is water.
- **Everything else is land**: dry floors below the datum, the dry rim of a
  landlocked sea, and lakes, whose water is the worldgen's own lake
  machinery's to find.

Area is summed per row at `cos(lat)` so the bar means the same thing at every
latitude. The four bakes call this once and read the byte; none of them tests
altitude any more. `readEtopo` parses the grid from the file name and checks
the byte length, so the four cannot disagree on the source either.

Measured on the source: 153,956,452 ocean samples; ONE enclosed sea kept, at
28 m below the datum; 18,305 enclosed bodies (240,306 samples, the Caspian's
rim included) returned to land. Blind by coordinate: Qattara,
Eyre, Death Valley, Turfan, the Dead Sea, the Chott, the Salton Sink, the
Aral, Superior, Baikal, Astrakhan and the Volga delta → LAND; the Caspian,
the Azov (via the Kerch Strait, 7 samples wide) and the Black Sea → water.

### 3b. Which cells are land (`src/ported/worldgen/coverMask.js`)

The coarse byte's land bit is a height-weighted vote; the cover plane says
how much of the cell is land by area; the crossing table (W22) says whether
the land in a cell is JOINED by ground to a neighbour's. The bit stands
except where the fine measurement contradicts it:

- a cell the byte calls LAND whose land is under half the cell AND joins no
  neighbour's land is water — an islet, or the water the coarse grid sealed
  and landed (the Azov). Land that joins a neighbour's is a shore of the
  body it belongs to, however little of the cell it fills (the Cyclades, a
  fjord coast, an island astride a cell edge), and stays land;
- a cell the byte calls SEA that is at least half land by the cover is land
  — a dry floor below the datum, a delta the byte rounded away. A sea cell
  holding a sliver of joined shore stays sea: that is the water a coast is
  sailed on, and the sliver is already charged as cover (W19a).

The elevation byte is untouched wherever the bit stands, so those cells keep
their elevation to the bit. A cell turning water takes the shelf byte (2, the
shallowest sea the raster has); a cell turning land takes the minimum land
byte (3, what the coarse bake gives polders). Both worldgen presets read the
one function; the oracle's v1 copy receives the same module over the same
cover plane and crossing table, and the elevation arm stays byte-exact.

Two drafts were measured and rejected on the way, and both are recorded
because each was a real finding. **Cover alone** (land iff at least half the
cell is land) turned 9,929 target cells to water, and 8,864 of them were
joined shore — the Greek islands among them (160 cells in the Aegean and
Ionian box), fjord coasts, every archipelago; the owner saw the Aegean go.
The first probe had reported none of them joined, because it called the
crossing helper with the wrong arguments; that claim was published and is
withdrawn here. **Cover or ground** (land iff mostly land OR joined to a
neighbour) turned the coast inside out the other way: every water-majority
coastal cell holding a sliver of joined shore became land, 14,999 cells at
target, and a ship loses the water it sails a coast on. The rule above is
the asymmetric one the two measurements force, and it is what the owner
asked for in the first place: the grey tiles become water, the dry floors
become land, and nothing else moves.

### 3c. What the lens shows

Land is land, sea is sea, straits are lines. The third tone is gone because
the set it painted — sim land with no ground link and cover under a half —
is exactly the set that is water now. And an islet the mask cannot hold is
still DRAWN: the plane's land inside a water cell used to take the cell's
own colour, which for a water cell is the sea's, so a one-cell island was
invisible on every lens; it now takes a land tone (the cell's lowland
terrain, muted where the lens mutes land, dark on the sailing lens).

## 4. What it moved (substrate only, no history)

**The cover plane** (1920×960): all-land 605,185 (32.8%), all-sea 1,189,677
(64.5%), mixed 48,338 (2.6%); the stored corrections fall 53,353 → 49,509
(100 KB raw). Against the first draft (the datum as every body's surface),
the Caspian's rim is the difference.

**The land plane** (3600×1800): 2,201,266 land cells (W20: 2,195,469),
148.3 Mkm² of land, 29.1% of the sphere (W20: 147.8, against Earth's 148.9);
0.98 Mkm² of it stands where the coarse bit says sea (W20: 0.70) — the
Caspian's rim, which the coarse bake still reads as sea, is most of the
rise.

**The mask.** Cells whose land/sea bit flips, against the coarse byte's own
test:

| grid | → water | → land | of the flipped-to-water, with a ground link |
|---|---:|---:|---:|
| dev 240×120 | 11 (all single) | 29 (20 clusters, 18 single) | 0 |
| target 1800×900 | 1,065 (574 clusters, 431 single) | 2,126 (920 clusters, 688 single) | 0 |

Every cell that turns water is a cell no walker could enter or leave (no
ground link to any neighbour), which is exactly what the W22d lens painted
grey; the Aegean and Ionian box loses 13 single cells, islets under half a
cell that touch no other land, and every joined island stays. The largest
clusters at target, blind by coordinate. To water: the Azov (85 cells), the
head of the Gulf of California (73), Queen Maud Gulf (34), the Laptev shore
(10, 8, 7). To land: the north Caspian depression — the Volga delta, Astrakhan,
the Kalmyk and Kazakh steppe — as one cluster of 729 cells, the Turkmen
shore (43), the Kura lowland (27), and single coastal fragments the byte
rounded away, and the dry floors: the Qattara, Eyre and Chott cells now
hold ground.

**Pass climbs** (target): 550,435 land cells, 2,157,747 land–land edges,
200,855 with extra climb (9.3%), max 2,112 m — the same figures as W21 to
within the new land. **Crossings** (target): 2,216,573 land links (W22:
2,211,517), 4,298,568 water links (4,303,446), 77,914 narrower than a cell
(79,046); majority-land edges without ground 5,168 (5,625); mixed edges
sharing ground 63,994 (65,984). Dev: 40,118 / 77,877 / 7,136 / 343 / 4,912.

## 5. Does it tell the truth?

The bar `ENCLOSED_SEA_MIN_KM2` is the coarse bake's own, unchanged; it has a
physical meaning (a basin that behaves as a sea for climate and navigation)
and one archetype either side of it. The level of a landlocked sea is read
off the data, not given: the largest flat patch is the source's own
representation of a water surface (it fills the shallow north of the
Caspian at its surface altitude, as it fills every lake without bathymetry),
and the rule has no constant of its own. No place is named in the rule, in
any bake or in any consumer. The rule cannot make water: it only returns
water to land, and the mask rule only moves a cell to whichever side the
measured cover already put it. Where the two readings agreed, nothing moved —
elevation is byte-exact there and the oracle proves it.

## 6. What this is NOT

- Not a re-bake of `EARTH_ELEV`. The coarse heightmap's bytes are untouched;
  only the sim's reading of the land/sea bit changed, and only where the fine
  cover disagreed. The climate solvers see the same elevations except on the
  flipped cells.
- Not a change to the router, the people table or the ocean fill. They read
  the same tables, regenerated.
- Not a fix for §W22 handoff §8.10 in the general case: sea modes on a LAND
  cell still follow the coarse coast flag. The Azov instance is moot because
  the Azov is water now.

## 7. Verification

**Travel gate, both grids: pass**, nothing stale, no band widened. The **Volga** row is the one that moved: the first draft (the datum as every body's surface) drowned the Volga's floodplain up to Volgograd and put the mouth at 48.6°N, outside the row's box; with the sea at its own level the mouth is at 45.9°N 47.7°E, the delta, after 140 cells. Every route row is unchanged from W22d to the tenth of a day (Rome–London 37.4 / 40.8 d, London–Bordeaux 21.9 / 17.7 d) and the cross-grid table is W22d's. Under the rejected cover-only draft the gate had read differently — two cross-grid rows cleared and rome-london's returned — because the dev cell that holds Rome (35% land, joined to its shore) had turned to sea and the gate's start had rounded a hop north-west; the corrected rule keeps that cell land and the manifest is W22d's again, with the two rows' reasons carrying their W23 re-measurement (alexandria-antioch 12.1%, rome-paris 16.5%).

**People gate, dev solve arm: pass** before and after (the pre-W23 tree re-run from a stash for the baseline), nothing stale, every hearth on the same cell, every staple verdict the same, no people constant changed. What moved: the north Caspian depression and the Volga delta are land and settle, and every enclosed depression holds ground; people −5000 109.7 → 110.9M, −3000 792.3 → 798.8M, −1000 1,372 → 1,376M, 1 CE 1,484 → 1,487M; the first caged basin −3071 both; the front speed 1.18 km/yr both; five hearths move by 7–140 years on their own cells (tubers −4121 → −3981 the largest); the European rows by a decade (central Europe −5381 → −5388, Rhine −5010 → −5017, Cardial −5647 → −5640, inland −5703 → −5696), Nile −6606 → −6613, Indus −4443 → −4429, Sahel −4933 → −4947, every one inside its window; Japan still unreached.

Mechanical: lint, typecheck, unit, kernel-parity, smoke (routing hashes dev 297213567 / target 2997680649, unchanged — the fixture has no cover plane), oracle (elevation, relief, coast exact on both grids with the v1 copy carrying the same mask rule over the same cover plane), `bench --check` (pass, no re-baseline), chromium browser smoke (pass, world hashes dev 64e16935452e6c26 / target 217a88344bd3a6b1 identical to the worker). No state and no metric were added, so `coverage` and `monotone` were not required; the v1 coverage residue (`_goodsFlowsLevy`) stands as recorded in W22.

## 8. What is still open

1. **Sea modes on a land cell still follow the coarse `coast` flag** (W22
   §8.10). A land cell with a nonzero water edge should be a port by the
   table. The cases that made it visible are water now; the rule is still the
   coarse one.
2. **The coarse `EARTH_ELEV` and the fine cover are two bakes of two
   sources** (6-arc-minute and 1-arc-minute ETOPO), and two rules: the coarse
   bake still reads the Caspian's dry rim as sea, so those cells carry sea
   bytes and take the minimum land byte through the mask rule. The mask
   follows the fine one; the elevation bytes still come from the coarse one.
   Re-baking the coarse raster from the 1-arc-minute source under the shared
   rule would make them one, at the cost of a global elevation change every
   climate field would feel — a `v2-long` measurement, not a per-commit one.
3. **A landlocked sea with full bathymetry** would show its deep floor as
   well as its surface; the largest flat patch is its surface only while the
   source fills shallow water at surface altitude, which ETOPO1 does. On
   Earth there is one such sea and the reading is right; another map is a
   measurement to make, not an assumption.
4. **Lakes.** Enclosed water under the bar is land to every bake; the
   worldgen's lake machinery decides which of it holds water. Whether it
   finds the Aral, Superior and Baikal is a measurement this wave did not
   make.
5. W22 §8.1–8.8 stand. (W21 §8.1, migration and passes, is closed by W24.)
