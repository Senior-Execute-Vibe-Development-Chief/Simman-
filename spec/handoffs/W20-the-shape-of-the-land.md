# W20a — the shape of the land

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W19a
(`spec/handoffs/W19-the-land-a-cell-has.md`). This wave adds ONE baked data
plane, FOUR substrate fields that are all one thing, ONE invariant, and ONE
rewritten render loop. **No constant, no metric, no law, and no mechanic reads
it.** Every hash in the repo is byte-identical across this change, and that
identity is the verification.

It **replaces W19b**, which W19a named and deferred. W19b would have let a cell
the raster calls ocean hold people at its true area — a topology change to the
land mask. The owner asked a different and better question, and this wave
answers that one instead. W19b stays unbuilt and is discussed in §8.

## 1. The question that started it

W19a scaled capacity by the cover of a cell. Reading that, the owner looked at
the map and asked why the sub-cell islands the cover plane had just measured
were nowhere to be seen:

> *"i am not seeing these islands on the map? would we show them as regular
> land pixels, that are just smaller"*

and then, having been told the map draws one pixel per sim cell:

> *"hold on our sim actually only has that many pixels? we are going to need
> icons and stuff that is finer than the grid at some point"*

> *"ok, IN THE SIM, can we make the pixel density higher, but keep the cell
> count the same? would that effect performance"*

> *"what parts of the sim could we make finer without deeply effecting
> performance? terrain detail for the path finding? we could obviously then do
> islands. it would need to be fine enough to have legible UI"*

That is the wave, and the authorised scope was stated back and approved:

> *make the map 2× finer, leave everything else alone. 3600×1800 gives ~11 km
> cells. People, climate and crops stay exactly where they are. Tick and solve
> budgets untouched. The work is the seam: every law crossing the two grids
> needs a defined way to sum up.*

## 2. What was wrong, in one line

**The map had exactly as many pixels as the sim had cells**, so the finest
thing the world could ever show was a whole cell — ~22 km on a side at the
shipped grid, ~166 km at the reference grid. Not because the geometry was
unknown (W19a had just baked a plane that knows it), and not because the sim
needs it that coarse, but because the frame buffer was declared
`new ImageData(substrate.width, substrate.height)` and everything downstream
inherited that.

So a coast was a staircase of cell-sized steps, an island smaller than a cell
was either a full cell of land or nothing at all, and any future glyph — a
city marker, a border, a unit — had no room to sit *inside* a cell.

The spec had already said the two are different things and the code had simply
never acted on it: *"width/height are SIMULATION CELLS, never render pixels"*
(QUESTIONS, review answer 1, 2026-08-31). This wave is that sentence made
true.

## 3. The mechanism: a third plane, and a seam that cannot slip

There are now **three planes and three questions**, and keeping them distinct
is the whole design:

| plane | question | resolution |
|---|---|---|
| `landMask` | does this cell hold ground? | the sim grid |
| `landFraction` (W19) | **how much** ground? | the sim grid, baked from 1 arcmin |
| `landShape` (W20) | **where** inside it? | its own, 3600×1800 |

The first two are per-cell fields. The third deliberately is **not** sampled
down to the sim grid, because sampling it down destroys the only thing it
carries. It keeps its own resolution, and the sim reads it through a block.

### The bake

`tools/build-landshape.mts` reads the same 1-arc-minute ETOPO1 grid that
`build-landfrac.mts` and `build-riverdata.mts` already take — **no new
download** — and applies one rule with no place name in it:

```
SHAPE[cell] = 1 when MORE THAN HALF the ~36 samples inside the cell
              stand above sea level (altitude > 0), else 0
```

`altitude > 0` is the same land test the elevation and cover bakes use, so all
three planes agree on what "above sea level" means; majority is the same rule
the elevation bake's own mask uses — a cell is what most of it is.

### Why 3600×1800 and not something else

Not because it looked right. Because of the seam:

```
3600 / 240  = 15   (the reference grid: block 15)
3600 / 1800 = 2    (the shipped grid: block 2)
1800 / 120  = 15
1800 /  900 = 2
```

The plane's dimensions are a **whole multiple of both sim grids on both axes**,
so every cell of either grid covers a *whole block* of plane cells and no plane
cell is ever split between two sim cells. That is what makes a sum over a block
exact rather than approximate, and it is asserted at substrate build:

```ts
const shapeBlock = world.landShapeWidth / width;
if (!Number.isInteger(shapeBlock) || world.landShapeHeight / height !== shapeBlock) {
  throw new Error("... a cell of it would straddle two cells of this one");
}
```

A grid preset whose width does not divide the plane does not silently produce a
slightly-wrong aggregate; it fails to build. **`landShapeBlock` is carried on
the substrate** so every future reader sums over the same block rather than
re-deriving it.

### What it costs

| | |
|---|---|
| plane | 3600×1800, ~79 km² mean cell, **~11.1 km** on a side at the equator |
| stored | **40,975 bytes** run-length encoded (53 KB base64 in the module) |
| the alternative | bit-packed would be **791 KB** — 20× worse |
| decoded | 6.48 MB `Uint8Array`, once per substrate build |
| per tick | **nothing.** No law, no kernel, no persisted field reads it |

RLE wins by 20× because the bit sequence is dominated by long runs — ocean
basins and continental interiors — which is a property of the data, not a
trick. The bake asserts the decoder reproduces the plane **byte for byte**
before it writes the module, so the run list provably *is* the plane.

## 4. The render rule

The map is now drawn on the plane, not on the grid. A sim cell is still **one
colour** — it is one place, and every lens value it has is a per-cell value —
but the plane decides, at ~11 km, where that colour stops and the sea begins.

Three rules were considered for the disagreements between the two:

1. **the plane wins** — draw land wherever the plane finds it. Rejected: it
   invents ground the sim does not stand on, and there is no colour to draw it
   in (the sim has no lens value for a cell it calls sea).
2. **the plane loses** — draw only inside sim land cells. Rejected: that is
   the staircase again, just at a finer pitch.
3. **sharpen inward only.** *The map draws the world the SIM has, at the
   plane's resolution; it never invents ground the sim does not stand on; and
   a sim land cell whose whole block the plane finds under water keeps its
   colour throughout, so nothing the sim holds is erased.*

Option 3 is what shipped, and it needs **no branch at draw time**. Two words
per sim cell are precomputed — the colour where the plane finds land, and the
colour where it does not — plus a `planeBlank` bit that is 1 where the plane
finds no land anywhere in the cell's block. A sim SEA cell's `pixelColor`
already returns the water tone, so both of its words are water automatically;
a blank land cell takes its own colour on both words and is drawn whole. The
inner loop is one indexed load and one store.

The third rule is not hypothetical. Measured on the built substrate:

| grid | block | sim cells holding plane land the mask calls sea | sim LAND cells whose block holds **no** plane land |
|---|---:|---:|---:|
| dev 240×120 | 15 | 1,915 | **9** |
| target 1800×900 | 2 | 5,849 | **4,172** |

4,172 is 0.75% of the shipped grid's land cells. Without rule 3 those cells
would vanish from the map — the sim would be administering, feeding and
settling ground the player cannot see. The count is large at the shipped grid
and tiny at the reference grid for a mechanical reason: a block of 4 is easily
all-sea, a block of 225 essentially never is.

### The rendering had to get faster to afford this

The frame is now 6.48M pixels instead of 28.8k (dev) or 1.62M (target). Drawn
the way the old code drew it — four byte writes per pixel — that measured
**234 ms resample + 103 ms frame fill**, a 2.5× regression at the shipped grid
and ~100× at the reference grid. Rather than accept it or quietly drop the
render half of the wave, the loops were re-measured on the hypothesis that they
are **overhead-bound, not bandwidth-bound**: rewritten as one 32-bit word per
pixel (with the machine's byte order detected at startup, not assumed), the
same work measures **32 ms resample + 34 ms frame fill** — ~7×, which brings
plane-resolution drawing to roughly what sim-resolution byte-wise drawing cost
before.

The projection table build stays ~898 ms, because it is
`projection.unproject` per pixel and unaffected by how the pixel is written.
It is paid once at startup and once per projection switch, never per frame.
**That is the honest cost of this wave and it is recorded, not hidden.**

Memory moves with the frame, and is worth stating plainly: the plane decodes
to 6.5 MB, the frame and the projected image are ~26 MB each, and the
projection table's `columnOf` is another ~26 MB — roughly 85 MB of buffers
where the shipped grid previously held ~22 MB. That is a browser-tab-sized
number, not a problem, but it is the reason a further doubling of the plane is
a decision and not a free win.

Two follow-on changes fall out of the frame changing size, and both are one
line: `toScreenXY` multiplies a sim cell's centre by the block, and
`cellFromPointer` divides the plane cell the table hands back by the block to
get the sim cell. The projection machinery itself needed **no** change —
`buildProjectionTable` was already parameterised on grid dimensions and
`gridToPixel` was already continuous math.

## 5. What this is NOT

- **No mechanic reads the plane.** Not routing, not capacity, not settlement,
  not the kernel. It is read-only geometry: drawn from, measured against,
  never stepped.
- **It does not subsume `landFraction`.** At the shipped grid a block is 4
  cells, so the plane can express 5 levels of cover against the cover plane's
  256. The cover plane's bake is untouched and it remains the field the
  capacity laws multiply by. The two agree where they can: at the shipped grid
  the plane's share summed over the world is **548,867** cells against the
  cover plane's **549,184** — 0.06% apart.
- **It does not change the land mask's topology.** No cell became land or sea.
  That was W19b and it is still unbuilt.
- **It is not a UI feature yet.** It makes the map finer; icons, borders and
  glyphs *inside* a cell are now possible and are not in this wave.

## 6. Does the plane tell the truth?

Three independent checks, because a bake that is subtly wrong fails silently:

- **Area.** Cos(latitude)-weighted, the plane holds **147.8 Mkm²**, 29.0% of
  the sphere, against Earth's 148.9 Mkm² / 29.2%. (The raw cell fraction is
  33.9% — that is *cells*, not *area*, and the two differ because cells shrink
  toward the poles where much of the land is. An earlier scratch measurement
  quoted 172.8 Mkm² by multiplying the land cell count by the mean cell area;
  it was wrong for exactly this reason and the cos-weighting was built into the
  bake's diagnostics because of it.)
- **Decode.** The count of land cells reached through `substrate.landShape`
  is **2,195,469** at both grids — exactly the bake's own figure, so nothing is
  lost between the bake, the module, the decode and the substrate.
- **Named islands, measured blind.** Iceland **100,800 km²** (real 103,000);
  Malta **400 km²** (real 316); Iki, at 138 km², is exactly **one cell** —
  which is the honest statement of the resolution limit rather than a claim to
  have beaten it.

`0.70 Mkm²` of the plane's land stands where the shipped 1920×960 elevation
bit says sea. That is the sub-cell island and coastal fringe the map could not
previously show at all.

## 7. Verification

**Every hash in the repo is byte-identical to `a3409cdb` (W19a), and that
identity is the verification.** No law, no kernel array and no persisted field
reads the plane, so anything that moved would be a bug — a plane that leaked
into a mechanic, or a substrate field that changed one it should not have.
Nothing did.

| | before (W19a) | after (W20a) |
|---|---|---|
| routing hash, dev | `297213567` | `297213567` |
| routing hash, target | `2997680649` | `2997680649` |
| solve hash | `7502f582a711201f` | `7502f582a711201f` |
| world hash, dev @500 | `64e16935452e6c26` | `64e16935452e6c26` |
| world hash, target @500 | `217a88344bd3a6b1` | `217a88344bd3a6b1` |
| unit solve people | `18727847.241071355` | `18727847.241071355` |
| unit awake people | `18729954.762478333` | `18729954.762478333` |

- `npm run lint` — eslint + `constants-ledger: ok`.
- `npm test` — smoke at both grids (`save/load byte-identical`), unit
  (`{"tests":"ok"}`, rng v1-byte-compatible, dmath golden, routing, runoff,
  orography `landMean 0.9961`, paddy, scheduler, solve), kernel parity
  (`{"parity":"ok"}`, worker counts 1/2/8, wasm dmath goldens 3).
- **No new unit test, deliberately.** There is no new law to assert against.
  The property that matters — *the plane divides both grids exactly* — is not
  a test, it is an invariant `buildSubstrate` throws on, so it is checked on
  every substrate build in every tool, gate and test rather than once in a
  fixture. The three synthetic `Substrate` fixtures (`travel/battery.ts`,
  `gate-travel.ts`, `unit.test.ts`) carry their own mask at a block of one,
  which is the smallest whole multiple there is.
- `npm run gate` — `{"gate":"pass"}` for travel (15 routes, both grids) and
  for people (12 mechanical steps plus the dev SOLVE arm), with zero
  unacknowledged failures and zero stale known-misses at both. Neither gate
  emits `pass` while either list is non-empty, so the verdict carries that.
  Both manifests are untouched by this wave — 22 travel rows and 54 people
  rows, byte-identical to `a3409cdb` — and none of them was re-measured,
  because nothing this wave changed can move one.
- `npm run bench -- --check` — the ratchet holds. The plane adds a decode and
  a 6.5 MB allocation to every substrate build, so `substrateMilliseconds` is
  the row that could move: 1844 ms at dev against a baseline of 2100, and
  52246 ms at target against 52000 — both inside the ratchet's 120% cap
  (2520 / 62400), and the dev row is *below* its baseline, so the decode is
  lost in the run-to-run spread of a 2-second build. Every other phase row is
  inside its cap unchanged.
- `BROWSER_SMOKE_BROWSERS=chromium npm run browser` — `{"browser":"ok"}`.
  This is the check the render rewrite actually needed: the smoke boots the
  shipped page, asserts the shell throws nothing while booting and reaches a
  ready worker, and only then runs the kernel checks. The rewritten
  `renderBase` runs on that boot. World hashes back from the browser are the
  same `64e16935452e6c26` / `217a88344bd3a6b1`, routing `297213567` /
  `2997680649`, 26 dmath goldens. (The Firefox and WebKit arms of the full
  matrix cannot run in this container — Playwright has no Firefox build
  installed — which is an environment limit, not a result; they belong to the
  long workflow, and the per-commit job is the Chromium arm above.)
- `npx tsc --noEmit` — clean over the committed set, which is what type-checks
  the rewritten `main.ts` and the four new `Substrate` fields. The only errors
  it reports are the implicit-`any` imports of the untracked scratch probes,
  which predate this wave and are not committed.
- `npm run oracle` — `{"oracle":"ok"}`, with `elevation` exact (sample error
  and relative error both 0) on all three arms: `dev-rawRivers`, `dev` and
  `target`.
  The shape plane is a second OUTPUT of worldgen and never an input to the
  elevation it sits beside, so the byte-exact arm is untouched by
  construction — the same argument W19a's cover plane made.
- `npm run coverage` / `npm run monotone` are not triggered. Both are v1 root
  tools against v1's `collect()`; W20a adds a static substrate INPUT derived
  from the DEM at worldgen, not evolving world state, and no metric.
  `"substrate"` is already in `tools/lib/collect.ts`'s pass-workspace list.
- **`npm run resgate` is not triggered either, and the third cardinal rule is
  the reason it is worth saying why.** Resgate exists because a mechanism can
  differ in KIND between the grids. This wave has no mechanism: the plane is
  the same 3600×1800 bits at both, read through a block of 15 or of 2, and
  every hash at both grids is unchanged. What DOES differ between the grids is
  the *seam*, and that is measured directly above — 9 blank land cells at dev
  against 4,172 at target, which is exactly the kind-not-degree difference the
  rule warns about, found by measuring both rather than by assuming.

## 8. What is still open

- **The plane is drawn from and nothing else.** No mechanic reads it, by
  design and by scope. The obvious next readers, in rough order of how much
  they would gain: a coast-following or strait-crossing cost that wants the
  real shoreline rather than the cell's bit; a settlement's placement *inside*
  its cell; anything that wants to know which side of a cell the water is on.
  Each is its own wave, and each has to answer the same question first — what
  does this law mean when summed over a block?
- **Nothing is drawn at sub-cell resolution except the coastline.** This wave
  makes the map fine enough for icons, borders, labels and unit markers to sit
  inside a cell — which is what the owner asked for — and builds none of them.
- **W19b remains named and unbuilt**: a cell the raster calls ocean but the
  fine grid finds partly dry should be able to hold people at its true area.
  It changes the land mask's topology and needs its own wave. The 5,849
  target cells (1,915 at dev) that hold plane land the mask calls sea are
  exactly its candidate set, now measured.
- **A finer plane is one constant and a re-run.** 7200×3600 is 137 KB base64
  and still nests in both grids (block 30 / block 4), but the frame becomes
  25.9M pixels — 3× a 4K display — so it buys detail nothing can show today.
  Revisit when something zooms.
- **The ~898 ms projection table build** is the one real cost and the obvious
  optimisation target if projection switching ever needs to feel instant. It
  is `unproject` per pixel and scales with the frame; the u32 rewrite cannot
  reach it.
- **The shipped-grid arm still has not been run** for W17, W18 or W19a. W20a
  does not need one — its hashes are identical at both grids — but it does not
  discharge the three that do.
- Unmoved by this wave and still open: the below-sea-level gap (QUESTIONS
  #73), M3b's missing mortality, P10, P20, the Marmara (QUESTIONS #72), the
  hearth placement family, and the Indus and Nile staples.
