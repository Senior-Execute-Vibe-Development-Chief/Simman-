# Design — the fully zoomable map: detail by amplification (CONCEPT)

**Status: concept only.** Discussion notes, 2026-08-05. Nothing is built and no
code was touched. Companion to `docs/ui-overhaul-plan.md` (the approved UI
direction — this extends its map work past today's `ZOOM_MAX = 8`) and to
`docs/settlement-ontology.md`, whose rule this layer would finally make
*visible*.

The proposal under discussion: zoom in anywhere and see villages, towns,
cities, environments, marching armies — with everything below the city tier
**aesthetic only**, not part of the economy (in the spirit of Watabou's
fantasy-town generators), and sub-tile environment detail from noise.

---

## 0. The idea, and the one principle that makes it sound

Zooming must never *add people to the world* — it must **render harder the
people the world already has**. Call the technique what the graphics
literature calls it: **amplification**. Detail at every zoom is a *pure,
deterministic function of (world seed, coordinates, current sim state)* —
computed on demand, cached, thrown away freely, never stored in the world,
never fed back into the sim. The sim stays the single source of truth; the
detail layer is a better *reader* of it.

This is exactly the posture the codebase already takes. `src/sim/units.js`:
the village and hamlet tier "is not represented as entities at all — it is
IMPLIED IN THE LAND, carried by `popField`". And
`docs/settlement-ontology.md`: the nation's substance is "the LAND and its
PEOPLE (fields)". The fields already *are* the villages. A zoom-detail layer
is the first UI that would let a player see that — the implication made
visible, with its ontology unchanged.

So the user-facing promise "any human unit below city can be aesthetic,
doesn't need to be part of the economy" is not a compromise here. It is the
**existing design**, drawn instead of abstracted.

---

## 1. Inventory: this repo is unusually ready for this

Findings from a code sweep (file:line refs valid at 33ad2f1):

- **A full camera already exists.** Pan / wheel-zoom around cursor / pinch,
  transform-based, hit-testing inverts it (`WorldSim.jsx:510-519`,
  `:2813-2900`). `ZOOM_MIN=0.5, ZOOM_MAX=8` (`:519`). Reveal-by-zoom is
  already a working idiom: label tiers and heraldry gate on zoom
  (`src/ui/labels.js:155-198`).
- **A resolution-independent vector canvas already exists.** The feature
  overlay is a fixed 1920-px-wide canvas with its own screen-space scale
  (`WorldSim.jsx:494-496`, `:1109-1119`) — the natural home for any new
  vector detail pass.
- **The noise kit already exists, deterministic from seed.**
  `src/sim/worldgenUtils.js` exports `fbm`, `noise2D`, `warp`, `ridged`,
  `worley` — the whole "perlin at sub-earth scales" toolbox, already used at
  render time in one place (plate-boundary warp, `WorldSim.jsx:1332-1336`).
- **River polylines are proven machinery.** The Atlas view traces `flowDir`
  into decimated, quadratic-smoothed polylines (`WorldSim.jsx:1026-1077`).
  Today it's confined to one view; it generalizes.
- **Moving map entities have precedent.** Colony ships are worker-side
  objects with x/y, shipped in the snapshot and drawn every frame
  (`sea.js:725`, `peopleSimWorker.js:635`, `WorldSim.jsx:2468-2485`).
- **The main thread already holds the full-resolution terrain.**
  `worldRef.current` has `elevation/moisture/temperature` at 1920×960 — the
  conditioning data for detail synthesis is on the right side of the worker
  boundary already.
- **The identity layers can decorate for free.** Culture phonology
  (`names.js`) can name a synthesized village on hover; culture/faith
  mixtures per tile (`fieldDom`) can pick architectural flavour; heraldry
  exists for banners.

And the gaps, equally concrete:

- **Terrain is a flat raster.** 1920×960, `imageSmoothingEnabled=false`,
  CSS-`pixelated`; max zoom shows 8×8 flat blocks (`WorldSim.jsx:1102`).
  Zoom adds no information anywhere.
- **The UI never receives the population field.** Only a lens-gated,
  8-bit log-quantized `popDens` byte per sim tile, at 1/6 snapshot cadence
  (`peopleSimWorker.js:415, 481-495`). A countryside layer needs that (and
  `devDens`) shipped always — an *additive read-only snapshot field*, the
  exact posture `ui-overhaul-plan.md` §14 already reserves for UI needs.
- **There are no marching armies to draw — and there is a scar here.** The
  sim once had reinforcement columns; they were removed, and the renderer's
  marching-army overlay "could never fire" (`armies.js:284-287`). Armies
  today are per-settlement garrison scalars plus a tile-flip front process
  (`advanceFronts`, `_tileCapturedAt`). The lesson stands: never build
  renderer features for state the sim does not produce. §4.5 below stays on
  the right side of that line.

---

## 2. Scale arithmetic (shipped grid)

At the app grid (`W=1920`, `simDiv 4` → sim `tw=480`): one sim tile ≈ 62 km,
one render cell ≈ 15.5 km. "See villages" means features of ~100 m — three
orders of magnitude past `ZOOM_MAX`. That much range forces two conclusions:

1. **Zoom bands with their own renderers**, not one raster pushed harder.
2. **A quadtree of on-demand detail tiles** (slippy-map style), generated in
   a worker, LRU-cached — never a precomputed planet at village resolution
   (which would be ~10¹² cells; amplification exists precisely so that number
   never materializes).

| band | ~m/px | you see | drawn from |
|---|---|---|---|
| B0 atlas | ≥ 4000 | today's map, as is | existing renderer, unchanged |
| B1 chorography | 400–4000 | relief with texture, river meanders, road lines, town footprints | conditioned upsample of `elevation/moisture/temperature` + traced polylines |
| B2 countryside | 40–400 | **villages/hamlets**, field mosaics, woods, streams, pastures, camps | B1 + `popDens`/`devDens` + `tCrop` + culture/faith fields |
| B3 site | ~4–40 | street plans, walls, wards, harbours; village layouts | settlement entity properties + site terrain |

Band transitions cross-fade; each band's synthesis is *conditioned* on the
band above, so averaging B(n+1) recovers B(n) — no seams of kind, only of
sharpness.

---

## 3. The layers

### 3.1 Terrain relief (B1)

Detail elevation = bicubic(coarse elevation) + amplitude × `fbm(x, y)`,
where amplitude derives from local relief roughness (mountains stay jagged,
deltas stay flat) and the fbm is coordinate-hashed from the world seed. The
constraint that matters: the *mean* of synthesized detail over a coarse cell
must return the coarse value — detail may never contradict the field, only
elaborate it. Same treatment for moisture/temperature (with a lapse-rate
nudge from detail elevation, so treelines and snowlines wiggle honestly).
Biome palette/texture then reads the refined fields: forest stipple, steppe
grain, dune ridging (`worley`/`ridged` where they fit).

### 3.2 Hydrology and coasts (B1–B2)

Rivers: generalize the Atlas tracer — `flowDir` → polylines, then
displacement-noise meanders scaled by `riverMag`, and *carve the detail
heightfield along the polyline* so rivers sit in valleys they visibly own.
Minor streams: flow-route on the synthesized detail field, forced to
terminate into real rivers — invented capillaries, honest arteries.
Coastlines: displace the land-mask contour with matching noise (bays, skerries)
— the political coast-clip (`WorldSim.jsx:2218-2281`) follows the same
refined mask so tints stay snapped to the shore.

### 3.3 The countryside: villages out of the field (B2) — the heart of it

Two-part construction, and the split is what makes it stable:

- **Sites are geological (stable).** Candidate village sites = local maxima
  of a site-score computed from *terrain only* (water access, flatness,
  fertility) + hash jitter — a blue-noise-ish lattice fixed for the life of
  the seed. Sites never move, so the layer never shimmers under camera or
  time.
- **Occupation is demographic (live).** How many of a district's sites are
  *lit*, and how large each renders, is read off `popDens` (minus the urban
  footprints of real settlements) — sites light in fixed score order as the
  field fills, with hysteresis so a plague dims the marginal hamlets first
  and a boom re-lights them in the same order. Style (mud/timber/stone,
  field patterns vs pasture vs terrace) reads `devDens` and the local
  culture; cropland mosaics read `tCrop`; pastoral bands get camps, not
  villages.

Calibration is per real km², never per tile (÷`rNormPop²` discipline —
see §5, third rule): field-people per km² ÷ a mean-village-size constant
gives villages per km², whatever the grid. A fully settled temperate sim
tile (~3,900 km²) plausibly carries a few hundred villages — trivial for
canvas at the zooms where they're visible, cluster-glyphed at the band edge.

Hover honesty instead of clickable entities: a B2 hover card reports *field
facts* — "≈40 villages in this district, ≈28,000 people, technique 0.4, in
the catchment of X" — numbers straight off the fields via the documented
unit bridges. Names on demand from the local culture's phonology, generated
deterministically from site hash, never stored.

### 3.4 Towns and cities: plans for real settlements (B3)

Every real settlement entity gets a deterministic town plan seeded by its
stable id, in the Watabou fantasy-town-generator genre: wards, street graph,
walls, market, harbour. Every input is an existing property — `_urbanPop`
(footprint area), tier (`farming region / town / city / metropolis`,
`settlement.js:49`), culture (street texture + names), faith (temples),
garrison and war history (walls, citadel), port/river flags (harbour,
bridges), founding date from the entity record (old core, newer sprawl
rings). Tier-0 "farming regions" deliberately get *no* town plan — they are
by definition many villages, i.e. §3.3's job.

Note the bundle constraint: single-file build, no assets — so this is a
homegrown compact generator, not an embedded library. That is in-culture;
the repo already grew its own heraldry, languages, and scripts, all bigger
jobs than a ward-and-street sketcher.

### 3.5 War: fronts first, columns only if honest (B1–B2)

The honest set, drawable today from real state: animated front polylines
where territory is actively flipping (`ui-overhaul-plan.md` §5.4 already
wants this); recent-capture shading from a quantized `_tileCapturedAt`
recency; siege/storm markers from war events; garrison banners scaling with
`s.army`; muster camps near fronts while a realm is mobilised (the
conscription window is real state).

Marching columns — the theatrical set — are then an *illustration layered on
those facts*: a column glyph walking the road from a warring settlement
toward its active front, length ∝ garrison committed. Pure view fiction, but
fiction strictly *of* a real (settlement, front) pair — it can never show an
army where there is no war. This respects the `armies.js:284-287` scar:
we're not reviving a renderer for deleted sim state; we're dressing state
that demonstrably exists. If that still feels like a lie, ship the honest
set alone — it already reads as "marching armies" at B1.

(Ships are already real moving entities and just get sprites at closer
bands.)

---

## 4. Snapshot additions (the only sim-side work)

All additive, read-only, in the §14 spirit of the UI plan:

1. `popDens` + `devDens` shipped unconditionally (not lens-gated) — 2×N
   bytes ≈ 230 KB at `tw=480`, transferable; population moves slowly, so
   even 1-in-30 cadence would do.
2. A sparse active-front list: tile index, belligerent pair, recency byte.
3. Possibly a per-settlement `wallTier`/siege flag if not derivable from
   events already shipped.

Nothing else crosses the boundary. The sim never learns the detail layer
exists.

---

## 5. The house rules, applied to a view layer

They all still bind, and it's worth writing down how:

- **First cardinal rule (no time gates).** A village's architecture era, a
  town's walls, a field's pattern must key off `devDens`, knowledge tracks,
  culture — never the displayed year. The two-clock trap catches *pictures*
  too: style-by-calendar would draw stone castles on a bronze-age field the
  moment the linear year said "1200". Every visual gate asks the same
  question as every sim gate: what has this place *become*?
- **Second cardinal rule (system, not outcome).** No "make the Nile look
  busy." Village density falls out of the field; if the Nile is dense it
  *looks* dense, and if it isn't, the picture must say so — the detail layer
  inherits the sim's honesty exactly as long as every glyph is a function of
  state, and becomes a matte painting the moment one isn't. Corollary, the
  **honesty contract**: never draw what the fields contradict (no village at
  `popDens≈0`, no wheat mosaic where `tCrop` says none, no walls where no
  war has ever come).
- **Third cardinal rule (measure at the grid that ships).** Every synthesis
  constant is per real km², never per tile. Acceptance check: render the
  same real region at `tw=240` and `tw=480` — village counts, field mosaic
  fraction, stream density must match statistically. A per-tile constant
  here is the same bug resgate exists to catch, wearing paint.
- **Coverage / persistence.** The layer adds **zero world state** — nothing
  for `collect()`, nothing for `persist.js`, nothing for the coverage gate.
  Caches are UI-side and disposable. (The one tempting exception — ruins,
  which need a "was ever settled" high-water memory the fields don't carry —
  is explicitly out of scope for v1, and if ever done is UI-side view-state,
  not world state.)
- **Determinism.** Detail RNG is a *stateless coordinate hash* — pure
  function of (seed, band, x, y, salt) — never a sequential stream, and
  never, under any circumstances, a draw from the sim's `rng.js` substreams.
  Same world + same camera ⇒ same pixels, on any machine, in any visit
  order, with zero effect on sim dice.

---

## 6. Architecture sketch

- **A third worker** ("detail worker") alongside worldgen and peopleSim:
  owns synthesis, receives the terrain fields once and the small live fields
  per cadence, renders quadtree tiles to OffscreenCanvas/ImageBitmap.
- **Tile cache** keyed `(band, tx, ty, seed [, demographic-epoch])`.
  Terrain-only bands are immutable per seed — cache forever, LRU-evict.
  Demographic bands add an epoch = coarse hysteresis bucket of the
  district's `popDens`/`devDens`, so tiles re-render on *meaningful* change
  only and shimmer is structurally impossible.
- **Political tints, borders, labels stay separate passes** (they already
  are) — conquest recolours a district without invalidating its countryside.
- **Camera**: extend max zoom per band with the existing transform;
  world-coordinate precision wants per-band local origins by ~B3 (float32
  runs out three orders past today's range).
- **Budget** in the `ui-overhaul-plan.md` §13.4 spirit: pan/zoom stays
  60 fps; synthesis is async and pops in (a briefly soft tile is fine, a
  hitch is not).

---

## 7. Phasing (each independently shippable)

- **A — deep camera + terrain amplification.** B1: conditioned relief,
  refined rivers/coasts, road polylines. No new semantics; the world simply
  stops being made of blocks. (Biggest visible win per unit work.)
- **B — the countryside.** B2 villages/fields/woods from the fields +
  snapshot addition #1 + the district hover card. *This is the soul of the
  feature: popField becomes something you can see.*
- **C — town plans.** B3 generator for real settlements, culture-styled,
  history-scarred.
- **D — war and life.** Front lines, sieges, camps, columns-if-honest,
  ship sprites, pastoral camps.

---

## 8. Open questions

1. **popDens quantization** — is the 8-bit log ruler fine enough for village
   counts at B2, or does the detail path want a 16-bit linear field at the
   same cadence? (Cheap either way; decide by looking.)
2. **Where does B0→B1 hand off exactly** — fixed zoom, or screen-px-per-cell
   threshold (probably the latter, it's resolution-honest)?
3. **Columns or no columns** (§3.5) — taste call for the owner after the
   honest set is in.
4. **Ruins** — worth a UI-side memory later, or leave the past to the
   chronicle?
5. **Does B3 ever open for tier-0 regions** (a "typical village of this
   district" vignette), or is that over-promising entity-hood the ontology
   forbids? Leaning: no for v1.

The through-line, one last time: **the sim already knows where everyone
lives; the map just can't draw it yet.** Amplification closes that gap
without adding a single scripted thing — which is the only way a project
whose premise is "nothing is scripted" gets to have a beautiful map.
