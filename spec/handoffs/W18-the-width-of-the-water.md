# W18 — the width of the water

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W17
(`spec/handoffs/W17-the-harvest-window.md`). This wave adds ONE substrate
field and ONE line of arithmetic in the people neighbour builder. No Rust
changed; no constant was added; no metric was added.

## 1. The question that started it

The owner, reading the miss inventory: *"For the sub grid strait thing, we
have a few places where you just cut the strait in manually, for real world
accuracy instead of pure geographic accuracy?"*

Yes — `EARTH_STRAITS` in `v2/src/ported/worldgen/worldgen.js`. Five channels
narrower than a cell are carved open by hand so the raster holds them:
Gibraltar, the Turkish Straits, the Malacca/Singapore pinch, Messina, and
Magellan. Without Gibraltar the Mediterranean is a lake; without the Turkish
Straits the Black Sea is a terminal basin and the Danube is erased.

And that carve is **the cause of the Bosporus miss, not the cure.**

## 2. What was wrong, in one line

The carve opens a land cell into water. Everything downstream then measures
that water **on the cell lattice**, so a channel a kilometre wide is charged
as a whole cell edge of open sea.

`v2/src/sim/people/neighbors.ts` walks water cells in one of eight
directions, accumulating cell-centre-to-cell-centre distance, and refuses the
hop once the total passes `PEOPLE_COASTAL_HOP_KM` (100 km, W7 — Cyprus ~70,
Malta ~80, Corsica ~80). At the reference grid a cell is 167 km, and a single
intervening water cell costs **two** edges — 333 km. So:

- the Bosporus, 700 m of water, is priced at 333 km and refused;
- the Dardanelles, 1.2 km, likewise;
- and the Neolithic front, having reached northwest Anatolia, turns left and
  walks the long way round the Black Sea.

That is `arrival:balkans:solve:dev`, `arrival:rhine:solve:dev`,
`arrival:cardial-coast:solve:dev` and `europe-front-speed:solve:dev` — four
acknowledged misses with one shared cause, and the cause is a hand-carve
whose own deviation from the DEM the sim had thrown away.

## 3. The mechanism: record the deviation, charge the water

The carve is the only place in the codebase that KNOWS the raster is lying
about a piece of water. So it records what it knows.

```
worldgen: for every land cell the carve OPENS, write the channel's real width
people:   stepKm(from,to) = channel > 0 ? min(edge, channel) : edge
          where channel = max(width[from], width[to])
```

Three properties make this a mechanism and not a patch, and each is worth
stating because each is what stops it becoming one:

- **It is exactly the carve's own deviation from the DEM.** A cell the raster
  resolves as water by itself is never marked. The field is zero everywhere
  except the cells a human had to open, so the term cannot reach into a real
  sea — including the seas at the ends of these very channels.
- **It extinguishes itself as the grid gets finer.** A finer raster resolves
  more of each channel on its own and carves less; at a grid fine enough to
  hold the Bosporus, nothing is carved there and nothing is priced. The term
  is a correction for a known raster failure that shrinks with the failure.
  This is the third cardinal rule taken seriously rather than worked around.
- **It over-charges, so it can refuse a hop but never invent one.** A run of
  k carved cells is charged k+1 crossings of the channel, because the
  charge is per STEP and every step into or out of a carved cell pays. The
  one real crossing is charged several times over. And a step touching no
  carved cell keeps `edgeLengthKm` exactly, so genuine open water in the same
  hop is still priced at the lattice — which is why the Malacca hops below
  land at 94.5 km rather than at 5.6.

No place name appears in the mechanism. `neighbors.ts` asks "is this cell one
the carve opened, and how wide is the water there?" — never "is this the
Bosporus?".

## 4. The numbers that had to be looked up

Each row of `EARTH_STRAITS` gained a `widthKm`: the channel's **minimum**
width, because the narrows is where a crossing is actually made. Where a row
traces a CHAIN of channels it carries the **largest of their minima**, so the
figure bounds the crossing whichever channel on the chain is taken.

| Channel | `widthKm` | The narrows it names |
|---|---:|---|
| Gibraltar | 13 | Point Marroquí (Spain) to Point Cires (Morocco) |
| Dardanelles → Marmara → Bosporus | 1.2 | the Dardanelles abreast Çanakkale; the Bosporus narrows at Rumelihisarı/Anadoluhisarı is 0.7 km, and the chain carries the wider of the two so either route clears |
| Malacca → Singapore | 2.8 | the Phillip Channel, the narrowest point of the waterway |
| Messina | 3.1 | Punta del Faro (Sicily) to Punta Pezzo (Calabria) |
| Magellan | 3 | the Primera Angostura, the narrowest of the winding channel |

These are coastline data, of the same kind as the paths themselves, which is
why they live beside them in `worldgen.js` rather than in `constants.ts`.
`spec/09-constants-ledger.md` §W18 carries them with their sourcing rule.

## 5. What it did to the substrate — both grids, no history

`v2/tools/probe-w18.ts` (scratch, not committed) builds the substrate at both
grids, lists every carved cell, and walks all eight directions from every
land cell adjacent to one, reporting the hops that clear the 100 km bar
before and after pricing.

**dev, 240×120** (cell ~131 km E-W at 40°N, 166.7 km N-S) — 11 carved cells:
1.2 km ×4 (the Dardanelles/Marmara line at 39.8°N), 3 km ×4 (Magellan),
3.1 km ×1 (Messina), 2.8 km ×2 (Malacca). **Gibraltar is not carved at dev**
— at 131 km cells the raster already reads that mouth as water.

Hops clearing the bar through a carved channel: **0 before → 2 after.**

```
+ 41.3N 27.7E -> 38.3N 27.7E   333 km -> 2.4 km    Thrace <-> Anatolia
+ -53.3N -71.3E -> -56.3N -68.3E  385 km -> 6.0 km  Magellan
```

The first of those is precisely the four European misses' cause.

**target, 1800×900** (cell ~17.2 km E-W at 40°N, 22.2 km N-S) — 78 carved
cells (1.2 ×24, 3 ×37, 2.8 ×13, 3.1 ×3, 13 ×1 — Gibraltar, one cell).

Hops clearing the bar: **68 before → 86 after**, 18 new, all at the
Dardanelles/Marmara, Malacca and Magellan. Gibraltar gains none: that
crossing already cleared the bar at 17 km cells.

**No leakage into open ocean at either grid.** The Malacca rows are the
clearest evidence that the term stays inside its channel: `2.5N 102.3E ->
1.3N 102.3E` goes from 133 km to 94.5 km, not to 5.6 km — one carved cell
was re-priced and the several cells of genuine open water in the same hop
were charged in full, leaving it barely inside the bar.

## 6. What it did to history — dev W5 SOLVE arm

The gate's dev solve arm is CLAUDE.md's named exception to the never-run
directive; every figure below is from it.

**Three acknowledged misses cleared, and their manifest rows were DELETED**
(the gate asserts on stale rows, so clearing a miss requires removing it):

| row | before | after | window |
|---|---:|---:|---|
| `arrival:balkans:solve:dev` | −5080 | **−6634** | −7000 … −6000 |
| `arrival:rhine:solve:dev` | −3981 | **−5164** | −5600 … −4800 |
| `arrival:cardial-coast:solve:dev` | −4436 | **−5871** | −6500 … −5500 |

Central Europe went −4317 → −5528 (−6000 … −5000) and inland Europe
−4555 → −5857; both were already inside on the grace and are now inside on
the window itself.

**A fourth row cleared and was deleted too: `europe-front-speed:solve:dev`,
1.447 → 1.082 km/yr — inside the 0.6–1.3 band (Pinhasi, Fort & Ammerman
2005) at the reference grid for the first time.** The gate could not flag
this one stale on its own: it adds the id to `measured` only in the branch
that fails, so a row that starts passing is never compared. That is a gate
blind spot worth knowing about; the row was removed by hand.

The direction of that number is the part worth reading twice. **The front got
SLOWER while its arrivals got 1,200–1,550 years EARLIER.** That is not a
tension — it is the mechanism:

- Before, Europe was reached late, by a front that had walked all the way
  round the Black Sea, i.e. by an already-mature and dense farming
  population. Measured from the Balkans to the Rhine, such a front races:
  1.447 km/yr, above the radiocarbon band.
- Now, Europe is entered early and young, across the Dardanelles, and
  advances west at the diffusion speed the constants actually name. 1.082
  km/yr, inside the band.

The dev grid had been measuring a detour and calling it a speed.

**Everything else held still**, which is what a term confined to five
channels should do:

- Population −5000 98.7 → **116.7M**, −3000 773.1 → **805.2M**, −1000 1,391 →
  **1,391.6M**, 1 CE 1,503 → **1,503.0M**. The last two are unchanged: an
  earlier Europe changes WHEN the curve fills, not the M3b ceiling it fills
  to. −8000 stays in band at 13.2M.
- Density ordering river 24.09 → 24.08, rain-fed 14.53 → 14.52; ordering
  preserved.
- The staple table is unchanged at **8/10** (the Indus still millet, the Nile
  still sorghum), and every hearth row — including `hearth-outside:millet`,
  W17's addition — is unchanged.
- The Sahel is 14 years later (−4933 → −4919, two 84-month strides) and the
  Ganges 7 earlier (−5353 → −5360, one stride), on routes no carved channel
  touches. South India is unchanged at −4814.
- **Japan is still not reached at dev, and should not be.** The Korea Strait
  is not one of the five carved channels: it is two genuine open-water legs
  of ~50 km around Tsushima, an island smaller than a dev cell. What the dev
  grid loses there is the island, not a sub-pixel channel, so W18 has nothing
  to say about it. The shipped grid reaches Japan already (−3795, W15 arm).

## 7. The imprecision this build knows about and did NOT paper over

The Turkish Straits row traces a **chain**: Dardanelles → Sea of Marmara →
Bosporus. The Marmara falls below the enclosed-sea bar and reads as LAND at
every grid, so the carve opens it — and W18 therefore prices those Marmara
cells at the chain's 1.2 km as well.

The outcome is right: the Thrace↔Anatolia crossing this produces IS a real
1.2 km crossing, at either end of the chain. But a route that in reality
traverses ~70 km of open Marmara is charged the narrows instead.

The fix is not a constant and is deliberately not attempted here. It is for
the **enclosed-sea bar to admit the Marmara as the sea it is**; the carve
would then stop opening those cells and the term would stop applying to
them, with no change to W18 at all. Recorded as QUESTIONS #72.

## 8. Verification

Mechanical only, per the owner's 2026-09-03 directive. Nothing that
simulates history was run outside the dev W5 SOLVE arm the directive allows.

- `npx tsc --noEmit` — clean (three Substrate fixtures gained the new field).
- `npm run lint` — eslint + ledger-lint clean.
- `npm test` — smoke (both grids, save/load byte-identical), unit,
  kernel-parity: all green.
- **New unit test** (`tools/unit.test.ts`): one water cell between land, at
  dev geometry. Unpriced, all eight approaches are refused (333 km of lattice
  against a 100 km bar). Priced at 1.2 km, all eight cross at 2 × 1.2 km —
  the k+1 over-charge, asserted as such. And every other slot in the
  neighbour table, land edge and sea hop alike, is asserted **bit-identical**
  between the two worlds: the term moves nothing outside the cell the carve
  opened.
- `npm run gate` — travel and people, green after the manifest update.
- `npm run bench -- --check` — ratchet held.
- `npm run coverage` / `npm run monotone` are v1 root tools against v1's
  `collect()`, and are not triggered: W18 adds a static substrate INPUT
  derived from the DEM at worldgen, not evolving world state, and no metric.
- `npm run oracle` — `{"oracle":"ok"}`. `elevation` is **exact** (sample
  error 0) at all three arms, which is the claim W18 needs: the width is
  written inside the same `elevation[i] > 0` guard, so the carve itself is
  unchanged. The three rows reading `mismatch` — `resource.stone`,
  `resource.furs`, `resource.oil` — are the same three, at the same
  magnitudes, as the run before this wave. The oracle splices v2's
  strait block into v1; its regex was loosened to `carveStraits(elevation, W,
  H[^)]*)` so it matches both the 3-argument v1 form and v2's 4-argument one,
  and the new parameter defaults to `null` so the spliced block writes v1's
  exact elevation. A second assertion now requires the block to still carry
  `widthKm:`, so deleting the widths breaks the oracle rather than silently
  disabling the mechanism.

## 9. What is still open

- **The shipped-grid arm has not been run for W17 or W18.** Both are
  `v2-long` requests, not development-loop steps. W18's substrate probe says
  the target grid gains 18 crossings; what those do to `arrival:japan:solve:
  target`, the European rows and the population curve there is unmeasured.
- **The trajectory-arm European rows** (`arrival:balkans:dev` and friends,
  without `:solve:`) are measured only on the 3000-year trajectory arm, which
  does not run per-commit. Their reasons still cite the strait the grid could
  not resolve, and that cause is now gone at dev; they need a `v2-long` arm
  to re-measure and will very likely move.
- **The Marmara**, §7 / QUESTIONS #72.
- Unmoved by this wave and still open: M3b's missing mortality (every
  population row), P10 (today's climate under a Younger-Dryas-to-1 CE run —
  the Sahel and `climate-barrier`), P20 (harvests per year, W17's latitude
  asymmetry), the hearth placement family, and the Indus and Nile staples.
