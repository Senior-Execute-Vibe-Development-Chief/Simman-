# W24 — passes on the map, biomes on the terrain, passes in migration

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W23
(`spec/handoffs/W23-what-is-water.md`). ONE mechanism (the people table's
land step is charged the climb the router charges, in the TypeScript
reference and the Rust kernel alike), TWO lenses (the sailing lens is now the
**crossings** lens and draws every pass beside every strait; the terrain lens
is the biome, white where the month's mean is below freezing). No data was
re-baked; no metric was added; no constant of the sim changed; no history was
run beyond the gate's dev solve arm.

## 1. The question that started it

Owner: *"show all passes on a map somewhere (maybe in what is now the
'sailing' map?), make the terrain show the biome colours, as well as if that
tile would have snow on it in this month, in white. also let migration see
passes."*

Three asks. The third is the one with a mechanism in it and is answered
first; the two lenses are the map showing what the sim already holds.

## 2. What was wrong, in two lines

W21 baked the lowest crossing of every land edge and the router charged it;
the people kernel never read it (W21 §8.1). The front walked over a ridge at
the ridge's mean height, and a mountain range cost a migrant nothing a plain
did not. The biome field has been on the substrate since M0 and no lens
showed it; the pass table has been on the substrate since W21 and no lens
showed it either.

## 3. The mechanism

### 3a. The people table's ascent (`src/sim/people/neighbors.ts`)

`buildPeopleNeighborTable` already gave every packed land cell eight slots:
a target, a distance in km, and a mode (0 a land step, 1 a coastal hop). It
now also gives each slot an **ascent**, in elevation units:

    ascent = |elevation(to) − elevation(from)| + 2 × passClimb(edge)

which is the router's W21 rule for the same edge: the rise between the two
means, and the pass above the higher of them, up and back down. The pass
table stores four directions per cell (E, SE, S, SW); a step in one of the
other four reads the neighbour's opposite entry, exactly as the router's
`passClimbOf` does. A coastal hop has ascent 0.

### 3b. The land step cost (TS `landStepCost`, Rust `edge_cost`)

    cost = daysPerKm(target) × km + ascent × TRAVEL_SLOPE_COST_FACTOR
    conductance = 1 / (1 + cost)

The first term is what W22 charged; the second is the router's Naismith term
(days per elevation unit, 3). The Rust kernel carries the constant as a
mirror and the parity harness holds the two kernels to the bit. The kernel
constructor takes one more array (`neighbor_ascent`), land-packed like its
siblings; the wasm glue passes `world._neighborAscent`.

Nothing else in the people kernel changed. The migration stride, the hop
bound, the mobility law and the pre-wake mean conductance read the same
conductance and follow.

### 3c. The crossings lens (`src/shell/main.ts`, `index.html`)

The sailing lens is renamed: it is where the map shows what the raster hides
on the EDGES, and there are now two such things. Straits (W22) are drawn as
before. **Passes** are every land–land edge whose stored climb is above zero,
drawn as a line between the two cell centres: amber and faint for a slight
climb, white-hot at 1,500 m — the great Alpine passes climb 1,000–2,000 m
above the valleys either side. They are batched into eight strokes by
brightness (a range is a few paths, not thousands of style changes) and
drawn only from six canvas pixels per cell, which is zoom 3 at the shipped
grid; below that the lattice of slight climbs is a wash over the land. The
legend names both.

### 3d. The terrain lens

`terrainColor` used to be a height-and-moisture tone. It is now the cell's
**biome** in one colour per classifier id (16 of the 17; alpine is never
returned), lakes and large rivers in their water tones, and **white where
the cell's mean temperature this month is below `RIVER_FREEZING_TEMPERATURE`**
— the same monthly-mean bar the river lens freezes at. Lying snow and river
ice are one condition on the one field the sim holds; a second bar for snow
would have been a second constant with nothing to ground it. The wind and
river lenses mute the same colours, and an islet inside a water cell takes
the same tone, so the map has one idea of what land looks like. The legend
lists the palette and the snow tone; it shows on the terrain lens only.

## 4. What it moved (dev solve arm, the per-commit people gate)

Gate pass before (`cc4c7029`) and after, nothing stale, no window moved,
every hearth on the same cell, every staple verdict the same. At the
reference grid a cell is 167 km and a step across it is ~8 days, so a 940 m
climb (0.1 unit, 0.3 d) is a few percent of a step and the trajectory moves
by less than that:

| | before | after |
|---|---:|---:|
| people −8000 | 13.18M | 13.18M |
| people −5000 | 110.9M | 110.8M |
| people −3000 | 798.8M | 798.5M |
| people −1000 | 1,376.4M | 1,376.2M |
| people 1 CE | 1,486.7M | 1,486.7M |
| first caged basin | −3071 | −3064 |
| front speed | 1.183 km/yr | 1.177 km/yr |
| rice hearth | −6053 | −6046 |
| tubers hearth | −3981 | −3974 |
| Rhine / inland Europe | −5017 / −5696 | −5010 / −5703 |
| Sahel / Ganges / south India | −4947 / −5346 / −4814 | −4940 / −5339 / −4793 |

At the shipped grid a step is 56 km and ~2.7 days, so the same climb is
proportionally three times heavier; how much the Alps, the Zagros and the
Himalaya then hold the front is a `v2-long` measurement, not one this wave
made.

## 5. Does it tell the truth?

The ascent is the router's term read from the router's table, so a walker
and a migrant now agree on what a land edge costs to climb. The unit test
sets one pass on one edge of a flat fixture and shows: the edge's ascent
from both sides is the rise plus twice the climb; `landStepCost` charges it
at the slope factor; every slot the pass does not touch is bit-identical.
Kernel parity proves the Rust kernel spells the same arithmetic.

The lenses draw the substrate's own arrays. The pass overlay reads the four
stored directions per cell so every edge is drawn exactly once. The snow tone
is a reading of the temperature field, not a new field.

## 6. What this is NOT

- Not a snowpack: no accumulation, no melt, no elevation inside the cell. A
  cell whose monthly mean is just above freezing shows bare biome.
- Not a change to the router, the bakes or any data module. The routing
  hashes are unchanged.
- Not a change to a coastal hop: it still costs its distance at the coastal
  rate and reads no wind or river factor (W22's rule).
- Not a time gate and not a fitted outcome: nothing names a place, a year or
  a result. The two drawing scales (1,500 m, 6 px per cell) are how the
  overlay is drawn, not how the sim behaves.

## 7. Verification

Lint, typecheck (`coverMask.d.ts` and the biome ids' declarations added —
the former had been missing since W23d), unit (the ascent test above),
kernel-parity, smoke (routing hashes dev 297213567 / target 2997680649,
unchanged), gate:travel both grids (every row W23's to the tenth of a day,
nothing stale, no band widened), gate:people dev (pass, §4), oracle (exact
where it was exact), `bench --check` (pass, no re-baseline), chromium
browser smoke (world hashes dev 64e16935452e6c26 / target 217a88344bd3a6b1
identical to the worker; the world hash does not read the table). Lens
screenshots at dev (the Alps on the crossings lens; January on the terrain
lens) rendered without page errors. `npm run coverage` at the repo root
walks the v1 world, which holds no people table; the pre-W22
`_goodsFlowsLevy` residue stands as recorded.

## 8. What is still open

1. **The mountain term at the shipped grid** is a `v2-long` measurement
   (§4): the same climb is three times the share of a step there.
2. **Snow is a monthly mean, not a pack** (§6). A snowpack would be its own
   state and its own wave, and would feed habitability before it fed a lens.
3. **Passes are drawn only on the crossings lens.** A faint overlay on the
   terrain lens was not asked for and would compete with the biome colours.
4. W23 §8.1–8.4 stand; W22 §8.1–8.8 stand; W21 §8.1 is closed by this wave.
