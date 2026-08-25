# The Egypt autopsy — what actually kills the Nile realm (2026-08-24)

## The question

`probe_egypt` (32f10df, live arm, seed 8817, W=480/tw=240) measured the best
large-state result the sim has produced and its immediate loss: the realm
ruling the Nile core at 866,799 km² — 87% of modern Egypt — at step 17,500,
and **zero tiles by 20,000**, with the cradle anchor churning names at every
checkpoint. Three candidate deaths, three different fixes:

- **CONQUEST** — a rival stormed the valley (fix in war/peace terms)
- **DISSOLUTION** — the polity fell apart from inside (fix in the admin
  ledger or dissolve bars)
- **STARVATION** — the basin emptied and the flags followed (fix in the food
  economy; the political layer was never the story)

`tools/probe_egyptfate.mjs` re-ran the window in the identical regime
(seed 8817, W=480, full live SIM_TUNE) on the current tree (post
FOREST_LOCK/CANOPY_CLASS) and read the sim's own structured event log —
the death certificates — rather than inferring causes from side effects.
Full log: `docs/runs/2026-08-24/egyptfate_live_8817.log`.

## Verdict in one paragraph

The three-way question dissolves. **The coroner's word on most realm
certificates is "conquest" or "integrated", but every one of those deaths is
downstream of SEAT-DEATH, and seat-death is demographic-economic.** The
valley is a *mill*, not a state with a wound: 49 realms cycled through the
box in 10k steps; the settlement register beneath them turned over 385
entities for a ~50-seat valley (~70% of the register per 2k steps, and the
mint rate *accelerates* through the run); and the anchor cities themselves —
catchments of 1.2M–6.1M people — died on a conveyor, roughly one major
abandonment every ~350 steps. A realm whose seat abandons follows it within a
few hundred steps (measured twice directly: seat 416 abandoned @22,915 →
realm 416 integrated @23,137; seat 30 abandoned @22,517 → realm 30 dissolved
@23,437). "Egypt-persistence" is really **member-persistence**: no polity of
any size can outlive members with a 2–4k-step half-life.

The churn reproduced on the current tree — and the peak was *bigger* than the
original finding: realm 1 (Ňěňní) reached 46 world tiles ≈ **1.19M km²** with
31 members and lived 15,200→23,300 (ended: conquest); realm 416 (Xụ̀ftàlǐā)
reached ~1.0M km² with 27 members, 19,200→23,137 (integrated). Egypt forms
**repeatedly** at historical scale. Nothing keeps it.

## The measured findings

### 1. The polity mill (realm life table, complete)

49 realms ever owned a box tile. Ends: 16 conquest, 7 integrated, 11
dissolved, 2 shattered, rest alive-at-end or unrecorded. The two ~1M-km²
realms both died to a *transient peer* (realm 543, first seen 20,200) which
was itself integrated by yet another at 24,937. Lifespans of the big ones:
4–8k steps; of the specks (peak 2–6 box tiles, 0 members at peak): often
<2k. The top-box-owner identity flips every few hundred steps at the end of
the run.

### 2. The settlement conveyor (life table, complete — 385 entities)

| fate | n | mean peak | max peak | n(peak ≥ 200) |
|---|---|---|---|---|
| abandoned (census → <1.5) | 186 | 316 | 6,122 | **17** |
| dissolved(core) | 115 | 16 | 58 | 0 |
| withered | 34 | 116 | 2,055 | 2 |
| alive at end | 50 | 795 | 10,880 | 8 |

Two distinct populations:

- **Froth** (~316 speck-lives): `dissolved(core)` never exceeds peak 58 —
  these are register-hygiene culls of stillborn mints (DISSOLVE_CORE working
  as designed on entities that never approached a real city's catchment).
  Mass-cull waves are visible in the series (51 → 25 settled in ONE 100-step
  window at 20,100 — with box census FLAT, so the dead were all specks), and
  crystallize re-mints into the freed ground within ~1k steps. First-seen
  histogram: 18/50/54/61/**90**/74/38 per 2k window — the mill never stops,
  it speeds up.
- **The catastrophes** (19 real cities, peak 1,243–6,122 ≈ 1.2M–6.1M-person
  catchments): abandoned/withered on a steady conveyor from 17,836 to 24,625
  — one every ~350 steps — each ~2–4k steps after first-seen. These include
  sitting capitals (416, 30). This is the death the owner sees.

### 3. War exists but is not the engine

51 `war.began` in the printed window and 16 conquest-ends — yet **zero
`settlement.captured` events**: war here kills realms by storming capitals
(`polity.shattered`) or by whole-court `polity.submitted`, i.e. it too runs
through the seat. (Instrument note: the probe's `c._fronts` column read 0
almost throughout — it is stamped on a cadence the samples missed; realm-end
events are the ground truth, not that column.)

### 4. The economics under it

- Box settlement census is a roughly **fixed pie** (~13k census ≈ 13M people
  at peak, sagging to 8.5k by 25k) while the mint pours 60–90 new mouths per
  2k steps into it: mean census/settlement sits pinned near the city bar,
  which is exactly the regime where DISSOLVE_CORE and abandonment churn
  hardest.
- `famine.struck` hits the valley in synchronized waves (6 realms @15,400;
  14 @16,800 in the printed window) — famine seeding is vulnerability-
  weighted and deliberately allowed to re-draw onto fragile ground, so the
  valley's chronic fragility *attracts* the shocks.
- Endemic disease at the anchors runs 0.5–0.75 (the urban graveyard's fuel).
- `capField` fill sits at 50–75% — the LAND has headroom; the limit is the
  settlement food ledger and catchment-share competition, not carrying
  capacity.

### 5. Instrument corrections (recorded so nobody re-trips)

- The probe's first run printed `fed = _foodSupply/_foodDemand` ≈ 0.00 for
  every big settlement. That is the **notional whole-census ratio** —
  `_foodDemand` deliberately bills the entire ONE_POP catchment while the
  countryside feeds itself; the sim's own famine gate compares flow against
  `_coreNeed` (`_fedM` is its moving average). Wrong-column artifact; probe
  now reads `_fedM`. The 0.00 reads do NOT by themselves establish famine.
- The event dump's 500-line cap silently truncated the per-type tallies at
  ~step 18k (my first "foundings stop at 18k" read was this artifact — the
  life table shows the opposite). The probe now prints a complete type
  histogram before the capped listing, and the cap is 2000.

## What this rules out, and what it leaves

Ruled out as root cause: a missing conqueror-repellent (war is downstream),
the admin ledger (load spikes past capacity appear only *after* a transient
winner over-integrates — 46/153 at 22,300 — and the shed follows; the ledger
is a late amplifier, not the source), and geography levers of the
RIVER_REACH family (ghost levers anyway, 9488c9b).

The open mechanism question — now sharp enough to instrument: **what melts a
6,000-census anchor to nothing in ~2k steps?** Candidates, not exclusive:

1. **Chronic core starvation** (STARVE_SHED): `_fedM` low for generations
   melts the capacity floor holding the urban spike; the field people
   redistribute away; census follows. Read `_fedM`/`_coreNeed` on the dying.
2. **Famine shocks compounding** on vulnerability-weighted re-draws
   (`_harvestMul` waves) — episodic, but the re-draw law concentrates them.
3. **Catchment-share competition** from the accelerating mint: every re-mint
   wave slices the anchors' worked territory (`_terrTiles`) thinner.
4. **Urban graveyard** at disease 0.5–0.75 with no health tech.

That decomposition ran the same day (`probe_anchormelt`,
`docs/runs/2026-08-24/anchormelt_live_8817.log`) and convicted none of the
four as the executioner — it found a fifth. See the next section.

## The melt, decomposed — the executioner found

`probe_anchormelt` tracked every anchor-class settlement (people ≥ 200) in
the box and, at each death, its final-2,000-step trajectory — with the five
surviving anchors as control. The four suspects against the contrast:

| term | dead (19) | survivors (5) | verdict |
|---|---|---|---|
| chronic core solvency `_fedM` | mean ~0.10 | mean ~0.17 | background — the whole valley starves chronically; several dead beat several survivors |
| famine windows (share of final 2k) | mean ~34%; 13/19 ≥ 25% | **0% on all five** | real accelerant — but six big anchors died with 0% |
| endemic disease | ~0.28 | ~0.36 | **inverted** — survivors carry more; fuel, not trigger |
| siege | ~17% of steps | up to **75%** (fine) | **inverted** — siege demonstrably does not kill |
| worked territory `_terrTiles` | **→ 0 in every single death** | stable or growing | the executioner |

And the trajectories give the mechanism, with ordering:

- **Xụ̀ftà** (seat of realm 416): healthy and *improving* — fedM 0.29→0.58,
  ~4,000 census, 25-tile catchment, supply 1.6-1.9 — then in ONE 100-step
  window: **terr 25 → 5, supply → 0.0, census 3,954 → 39**. cid stayed 416
  the whole way down. No famine, no siege, no capture.
- **Īmpíü**: fedM 0.73, supply 2.3 — then **terr 12 → 0 while census was
  still 4,733**; the census drained over the following 300 steps. Tiles died
  FIRST; the people followed. (Under ONE_POP a 100× census drop in 100 steps
  is only possible by catchment-stripping — the field's people move smoothly
  — so the causality census←catchment is proven at this sampling.)

### The chain, each link read from code

1. **The political map anchors on capitals alone** (CORRECTED 2026-08-24,
   same day: the first draft cited controlField.js's CTRL_LIVE flood, which
   is DEAD CODE — pretty-mode short-circuits it whenever `_countryOwner`
   exists, and the authoring path was removed 2026-07. The real authority is
   countryTerritory.js `fieldPolityTerritory` under `T.TILE_POLITY`, and it
   is capital-only in the same way: under TILE_POLITY a non-capital city
   pins NOTHING — not its district, not even its home tile; only the
   capital anchors, seeds connectivity, and carries the worked-pin. The
   lever's own label: "settlements as pure dressing.")
2. **The ground around a member city is therefore strippable without war**:
   the realm's own over-capacity shed (step 6) or connectivity sever
   (step 3) releases the member's district to wilderness (the anti-cycle
   mask even forbids taking it straight back), a neighbour's growth infills
   the released ground, and it turns politically foreign.
3. **CATCHMENT_CLIP executes** (territory.js:239-251, 272, 305, 388): a
   settlement may work only its own country's ground — wilderness is exempt
   (CATCH_WILD=1, which cut the wild-confiscation loop territory.js:230
   documents) but FOREIGN ground is not. One border shift over a city's
   district releases its entire catchment in one pass: `terr 0, work 0`,
   supply exactly 0.0.
4. **ONE_POP finishes it**: census = worked-catchment share → drains to the
   abandonment bar in a few hundred steps → `settlement.abandoned`.
5. **The realm follows its members**: capacity ∝ members, so each execution
   weakens the flood, which recedes further, executing more members — the
   runaway territory.js:230 describes, with the political half still open.
   The certificates then read "conquest"/"integrated"/"dissolved".
6. Famine is a second entrance into the same funnel (weakens P → border
   recedes → clip), which is why 13/19 dead had famine windows and no
   survivor did.

Note the double inversion against history this produces: **sieges — the
actual historical instrument of taking cities — kill nothing** (survivors
sit at 75% besieged), while **bloodless border arithmetic kills a
metropolis in 100 steps**. Real history is the exact opposite: fields
changed hands when the city fell, and not before.

### The mechanism direction (not built — owner's call)

The physics the sim is missing: **a standing city IS political control of
its district; conquest transfers fields with their people rather than
evaporating them.** Two system-level candidates, per the second cardinal
rule (build the cause, no patches):

- **A — cities as control sources.** Member settlements pin/re-charge the
  control field over their district (capital-style, scaled by their own
  weight). Borders then cannot cross a standing city without taking it
  first — and the war machinery for that already exists (`_warFront`
  bulges, WAR_BONUS pushing toward the capital). Territorial change
  re-acquires its historical unit: the city.
- **B — no single-pass cliffs.** Symmetric to `_integratedAt`'s grow-in, a
  clipped catchment decays over generations instead of evaporating in one
  pass, giving the political layer time to resolve (capture, annexation,
  relief) before the economy is executed. Complementary to A, not a
  substitute — B alone leaves the field blind to cities.

## Relation to the confetti thread

Same root, one level down. The confetti war fixed who *born cities* belong to
(BORN_OF_LAND), what a member *costs* (SEAT_ADMIN), where cities may *stand*
(FOREST_LOCK/CANOPY_CLASS). This measurement says the remaining churn is fed
from below the political layer entirely: the register mints faster than the
basin can feed, the surplus dies, and every polity built on that sand churns
with it — realms included, Egypt included. The two owner-visible complaints
("micro-nations flicker" and "the big realm never lasts") are the same
conveyor observed at two altitudes.

## The fix arms, measured (same day) — both RED, and what they taught

`T.CITY_HOLD` (members anchor like capitals) and `T.CATCH_GRACE` (600-step
release grace) were built at the measured joints and run in the identical
live regime (480/8817, both probes):

| lens | control | CITY_HOLD only | CITY_HOLD + GRACE=600 |
|---|---|---|---|
| anchor deaths (peak ≥ 200) | 19 | **34** | **30** |
| realms through the box | 49 | **99** | **94** |

The owner ordered the flip; it was **held** on these numbers (SAVE_VERSION
stays 44; both levers ship 0). What the red arms established:

1. **The intended channel came alive**: under CITY_HOLD the late anchor
   deaths run 69–100% besieged — war genuinely storms and starves cities
   now, which is the historically correct instrument the control regime
   lacked entirely.
2. **But pinned cores cannot be shed**, so an over-capacity realm loses its
   ability to breathe at the margins: strain contracts the marches into
   core-confetti and dissolution roughly doubles. District-holding needs a
   partner mechanism — contraction at PROVINCE granularity (a city secedes
   or transfers WITH its district) rather than tile-ring strangulation —
   or it converts border breathing into realm death.
3. **The executioner rotates; the sentence stands.** Blunt the political
   sweep and famine + same-realm catchment competition + siege kill instead
   (the bloodless terr→0 class even survived the grace rail: Lāffí,
   7,194→2 census, 0% siege). The three arms triangulate the real base:
   **the valley overmints ~8× what its census pie can feed** (385 register
   entries for a ~50-seat valley, mint accelerating all run), so ~300
   settlements must die per 10k steps no matter which mechanism does it.
   The political layer only chose the victims.

## The re-ranked frontier

The persistence fix is upstream of everything measured here: **the mint.**
`cityBasinOkAt` (and the crystallize bars) measure each candidate's basin
GROSS — overlapping basins double-count the same countryside, so in a dense
valley every site passes while the shares starve. The system-shaped fix is
a RESIDUAL basin bar: a site mints only where the basin mass NOT already
claimed by standing cities' catchments still feeds a city. That cuts the
register at the source; every death channel downstream (famine draws on
fragile shares, dissolve-culls, political churn on dying members) shrinks
with it. CITY_HOLD/CATCH_GRACE stay built and documented for re-measure
AFTER the overmint is fixed — the siege-warfare channel they enable is the
right physics, and their red verdict here may be the overmint's fault, not
theirs.

## MINT_RESIDUAL, measured — near-inert as built, and the instrument that explains it

The residual arm (live regime, 480/8817): register turnover 385→342 (−11%),
abandonments 186→185, big-anchor deaths 19→21, realms 49→70. Effectively
inert — the session's own trap (mechanism-exists ≠ mechanism-binds), caught
by its arms.

`probe_residualbite` then measured the term itself and found the opposite of
the obvious guess: the exclusion is HUGE (claimed-share already 75% at step
16k, residual/gross p50 0.10) and it STILL doesn't matter — all 34 candidate
sites pass the city bar on one-tenth of their basin, because:

- **The mint disk is a subcontinent.** `TOWN_BASIN_R = 10` reference-tiles ≈
  a 1,670-km radius (~314 tiles) at any grid. The "market catchment" bar
  tests whether a small country's worth of people stand within 1,700 km —
  every cradle answers yes everywhere, so `cityBasinOkAt` constrains nothing
  until claimed-share reaches ~0.95+ (post-pulse, register already built).
- **The exclusive cells activate at a fossil floor.** The label cells (the
  machinery's true one-owner-per-villager partition) gate on TOWN_BASIN_MIN
  = 360 field units, which the code's own CROWD_FOUND note records as
  150–3,300× below real settled basins (p50 249×).

So the register's density is set by neither bar — only by the spacing
quantum — and it saturates at ~50–60 entries in the Egypt box where bronze
Egypt held 5–10 cities: **~6–10× history's city density on the same ground,
at zero margin**, which is the churn's fuel regardless of which mechanism
executes the victims.

### The next instruments (before the next mechanism)

1. **The cell-mass distribution**: what does a label cell actually hold, in
   field units and census, across the box and the world? (The mint's honest
   exclusive quantity — `labelBasinMass` — has never been characterized.)
2. **The LABEL_BAR ladder**: the activation bar already accepts an override
   (`T.LABEL_BAR > 0 ? T.LABEL_BAR : TOWN_BASIN_MIN`). Run the fate/melt
   arms at cell bars stepped from the fossil floor toward the CITY bar's
   field-unit scale and measure register count, anchor deaths, realm churn.
   The ship-shaped fix, if the ladder confirms, is dynamic: the cell
   activation bar IS the city bar via the census bridge (the same
   TIER_CORE[2]/URBAN_SHARE_REF/_onePopScale read cityBasinOkAt makes) —
   no new constant; the fossil floor retires.

MINT_RESIDUAL ships 0 (near-inert; harmless late-game bite), verdict in its
desc. CITY_HOLD/CATCH_GRACE re-measure AFTER the register is historical.

## The cell-mass verdict — the packing thesis (end of day 2026-08-24)

`probe_cellmass` (live regime) closed the mint ladder's last question and
killed the first-seat law before it was built:

- **The Egypt box holds THREE market cells** — cells are subcontinental
  horizons like the disk — each holding 3–44 city-bars of people. Every
  cradle cell passes any first-seat bar trivially: inert.
- **The register already sits BELOW the lattice's capacity law**: Σcapacity
  ≈ 68 vs 51 actual settled in the box at 20k (world: 334 vs 222). The
  system is self-consistent at its own definition: a 13k-census pie over the
  200-census city bar supports ~65 minimum-viable cities, and that is what
  it builds.

So the day's final diagnosis is not a broken bar but a missing preference:
**the sim packs a cradle to Malthusian-minimum city packing** (~65 at-bar
cities where bronze Egypt held 5–10 big ones plus towns-in-the-land),
because nothing prefers agglomerating growth INTO an existing center over
minting a new minimum-center beside it — peers mint at core-spacing (tiny)
while real market ranges are the economy's own catchments (~250–500 km,
8–27 tiles measured). Zero-margin packing is the churn's fuel; every
executioner measured today (border sweep, famine, siege, competition) is
downstream of it. A standing class of LANDLESS anchors (census > 200 with
terr 0 for thousands of steps — five in the control arm alone) is the
packing's visible surplus.

**Next lap, one joint**: the mint pre-test at the LOCAL competitive scale —
a new city only where its own would-be catchment (the economy's real market
range, not the 1,670-km disk and not the cell) holds the city bar
unmarketed. Instrument first: probe_anchormelt now prints each dead
anchor's BIRTH state (born landless vs born landed — the pre-test's
discriminating measurement, unreadable from the final-window prints that
existed today).

## MINT_REACH, measured — a saturation detector, and the day's true bottom

The reach arm: turnover 385→332, anchors 19→19. Two findings, one of them
the investigation's floor:

1. **The wiring leak** (fixed): site/peer eligibility is cached, so a
   qualification-time gate leaks — 275 late site-cities minted past a
   0/34-closed bar. The gate now sits in `mintCityAt` (the birth itself;
   the gathered pile waits, the tally gate's own semantics).
2. **The structural truth**: the local-residual bar is a SATURATION
   DETECTOR. Its closure is *defined* by the catchment partition covering
   the valley — 34/34 open before settlement, 0/34 at saturation — so it
   can only prevent above-saturation minting (which the peer capacity law
   already prevented) and can never cut below saturation, where unmarketed
   ground exists by definition. The register equilibrates at pie/bar ≈ 65
   with or without every mint lever built today.

**The day's bottom, stated once**: the register count is pie ÷ mean-city-
size. History's bronze Egypt: the same pie over 5–10 cities means the mean
city held 2–4× the minimum — urban growth CONCENTRATED into existing
centers (the Zipf/primacy structure every urban system on Earth shows).
This sim's cities equilibrate at exactly 1× the minimum, because the
proto-urban drift caps its piles AT the city bar ("the proto-urban stage
ends at city size") and the catchment partition splits shares near-equally
— there is no engine pulling growth preferentially into the bigger center.
The engine exists as shipped levers — URBAN_AGGLOM 0.13 / URBAN_GAMMA 0.5,
size-dependent agglomeration in the field migration — and the register's
flat size distribution says they are too weak to produce hierarchy at the
shipping strength.

**Next lap (measure first, as ever)**: the city-size distribution itself —
the sim's Zipf slope vs history's (~1 for integrated urban systems), per
region and era, on the existing logs plus one instrumented run. If it is
flat where history is steep, the mechanism lap is a strength/form pass on
URBAN_AGGLOM/URBAN_GAMMA — existing levers, no new machinery — with the
autopsy arms as the persistence referendum.

## The Zipf probe — the engine's tank is EMPTY (the day's last verdict)

`probe_zipf` (live regime, box + world, every 2,500 steps): **importShare =
0.00 at p50 AND p90, for every city, at every checkpoint** — no city on the
planet eats shipped food, ever. The pre-registered logic convicts the FUEL:
the agglomeration engine (URBAN_AGGLOM — "a grain-importing hub concentrates
what it ships in") cannot produce hierarchy because the import economy it
distributes by does not exist in the live regime.

The size structure carries the exact signature of a fuel-less engine:

- **The box is a CLIFF, not a hierarchy**: 2–3 real cores then dust (top
  urban 524/502/210, then 19/16/10/9/5) — slope −1.4→−3.1, far past Zipf's
  −1, because rank 4+ is specks.
- **Primacy 1.0–1.4 everywhere** — the top cities are clones (real systems:
  2–10×). Without imports a core is capped by its LOCAL land economy, which
  is roughly equal at every good site.
- **The world dilutes toward flat** (−1.72 → −0.33 as n runs 42 → 663):
  the global register floods with at-bar specks. mean/bar ≈ 0.8–1.5 — the
  zero-margin packing, confirmed at scale.

And the discriminating fact from the melt tables: settlements with 3–4×
food SURPLUS (sup/need up to 2.6/0.7) coexist with anchors starving at
0.1 — **the surplus exists; the movement of it does not.** The food
hierarchy/trade lane is structurally failing to move storable surplus to
deficit cores.

**This is the convergence point of the entire day.** One dead lane — food
movement — sits under: chronic anchor famine (fed ≈ 0.0–0.3), the urban
graveyard's bite, the vulnerability-weighted famine draws concentrating on
the valley, the clone-city cliff, the zero-margin register, the churn, the
confetti, and Egypt's non-persistence. The next lap is the FOOD-FLOW
FUNNEL: who has surplus, who has deficit, what the hierarchy/trade passes
actually move each tick, and where the flow dies (foodHierarchy.js, the
trade lane under TRADE_STRIDE=5, the storable/levy split). Measure the
funnel; fix where it dies; then re-read this probe — hierarchy, margins and
persistence should follow together.

## The food funnel — the lane dies at the POOL, and the root is TWO FOOD BOOKS

`probe_foodfunnel` (live regime) read the grain lane stage by stage:
topology is healthy (44–75% parented; stateless roots ≈ 0 — BORN_OF_LAND
working; the roots are legitimately capitals), haul survival is 0.98–0.99,
the levy ramps with org and coin is often plentiful. The collapse is the
POOL: **the Egypt valley — 13M people — produces a storable pool of ~5–9
food units/tick against a core need of ~13, with gross surplus ~2 spread
over 1–3 settlements.** The lane faithfully moves what exists; almost
nothing exists to move.

And the "almost nothing" is not real famine. It is **two disagreeing food
books**:

- The FIELD book (capField/popField — ONE_POP's demographic truth) carries
  the valley's 500k+ field people at 50–75% of capacity. The people are
  fine; they feed themselves.
- The SETTLEMENT book bills each city `demand = 0.003 × its WHOLE catchment
  census` while crediting only its worked-tile `landFood` — and reads
  production at 1/6–1/8 of demand, valley-wide, permanently.

Every pathology chain measured today runs off the second book: chronic
fed ≈ 0.1 at anchors (pseudo-famine), permanently empty granaries (the
`s.food += supply − demand` drain bills the full census → siege clocks,
famine buffers and TRIBUTE_OF_LAND all dead), scarcity prices pinned at the
max clamp everywhere (no price signal), famine-vulnerability draws
concentrating on the "fragile" valley, STARVE_SHED pressure, ZERO storable
surplus for the hierarchy to move, and therefore importShare = 0.00 and no
urban hierarchy. The codebase already knows the principle: T.FOOD_REACH
moved the famine GATE to `_coreNeed` ("the census counts subsistence people
the market neither feeds nor taxes") and expressly deferred the rest — "the
ledger's headline demand deliberately keeps billing the WHOLE census … 
re-keying the granary drain re-keys granary/trade balances world-wide."

**The fix, named (not built — a world-rekeying decision):** extend the
FOOD_REACH principle from the famine gate to the whole settlement book —
demand bills the MARKET-FED people (urban core + garrison + unfree), supply
credits the catchment's real yield, surplus = landFood − coreNeed becomes
the tradeable pool. Then granaries fill, prices differentiate, famine
becomes an event instead of a climate, the hierarchy has grain to move, the
agglomeration engine gets its fuel, cities grow past their local land,
margins appear, the register concentrates — and the persistence/confetti
complex gets its real trial. Scope: granary/trade/army/price balances
re-key world-wide; the full gate ladder (smoke, stylized 3 seeds, resgate,
tw=960 spot) is mandatory, and the FED_FAMINE scar says expect calibration
fallout. This is the day's terminus: one deferred debt under everything.

## ONE_BOOK referees — HALF-GREEN: the book balances, the pipe is still too thin

The re-key arms (live tune + ONE_BOOK=1) vs control:

- **Surplus exists now**: world gross surplus 85 units across 116 settlements
  (control: 30 across 31); box surplus ~2–3× control.
- **The market works**: liege spare coin crashed from hundreds to ~0 — lieges
  actually SPEND buying grain; imports peaked ~2× control mid-run.
- **Margins appeared where it matters**: box mean/bar 1.33–2.49 vs control's
  0.75–1.08 — the first real slack above the city bar all day.
- **But the top cores still import ≈ nothing** (importShare p50/p90 0.00;
  one 0.01 sighting), primacy stays 1.0–1.3, no hierarchy. What moves is
  spread thin among small capitals; anchors stay land-capped.

The remaining joint is THROUGHPUT: a member's offer = its pool × SHIP_FRAC
(0.2 at city tier) × haul — with member pools of ~0.1–0.2 units/tick that
is ~0.02–0.04/tick offered against anchor core needs of 1–3: two orders
short even with the book fixed. Candidates for the next lap, in scar order:
the tier ship-fractions (calibrated for the village world — the register is
all cities now, shipping 0.2 where villages shipped 0.8), TRADE_STRIDE=5 in
the live tune (does the stride divide flow?), and the surplus-vs-pool offer
basis (a settlement offers a fraction of its whole POOL, not of its
SURPLUS — under ONE_BOOK the surplus is now well-defined and offering it
whole is the honest form). Persistence arms (egyptfate/anchormelt) wait
until imports actually reach anchors — no point refereeing persistence on a
still-starved engine. ONE_BOOK ships 0 pending that lap + the full ladder.

## SHIP_SURPLUS referees — the pipe opens 6×; Egypt's packing starves it locally

Correction first: the funnel probe's "arriving imports" column multiplied
the smoothed `_foodImportRate` by 10, but the 0.9/0.1 fold converges to the
MEAN — all three funnel logs overstate arrivals 10× (comparisons between
arms valid, absolutes not; probe fixed). Real per-tick world imports:
control ~0.6 → ONE_BOOK ~1.2 → **SHIP_SURPLUS ~3.6** — a 6× opening, now
covering ~9% of the world's core deficit, concentrated on a few dozen
capitals.

The remaining limiter is UPTAKE, and it is legible and emergent: offers
reach ~12/tick but the levy is org-capped (foodReach p50 0.17→0.53 over the
run — the temple economy matures with statecraft) and buyers' spare coin
runs to zero (the market spends everything it has). No fix proposed — this
half looks like the system working: a bronze-age world SHOULD move a
fraction of its surplus, rising as organisation and money deepen.

Egypt is the other story: **imports 0.00 at every checkpoint under every
arm, because the valley produces no surplus under any book** — ~50 packed
cities on ~140 tiles hold 2–3-tile catchments each (pools 3–6 units vs core
deficit 11–17). The packing thesis confirmed from the supply side: a valley
of minimum-cities cannot feed itself into hierarchy no matter how well the
lane works. The cure remains fewer, bigger cities — and the now-working
book+lane stack is the environment in which the agglomeration dynamics
(URBAN_AGGLOM's import-driven cores) finally have physics to run on, once
anything in the valley can accumulate surplus.

## Where the day ends

Nine instruments, six levers (two measured red and shipped off with
verdicts, one inert-with-a-finding, ONE_BOOK half-green, SHIP_SURPLUS
opening the world's grain lane 6×), one autopsy document, and a causal
chain that now runs unbroken from "Egypt at 87% then zero" down to a
double-billed food ledger and a register packed to Malthusian minimum.
The stack that exists (ONE_BOOK + SHIP_SURPLUS, both def 0) makes the
world's food economy WORK for the first time; Egypt's remaining disease is
density, which is demographic-geographic, not a lane. Next candidates, for
the owner: (a) run the persistence referendum on the current stack anyway
(cheap, calibrates expectations), (b) the tw=960 play referendum with
ONE_BOOK+SHIP_SURPLUS in SIM_TUNE, (c) the flip ladder for both levers
(full gates), (d) the valley-density lap with the working economy
underneath (longer horizons — does agglomeration differentiate the packed
register given time?).

## LEAN_YEAR — the referendum and the gates (end of 2026-08-24, part 2)

The law: every city-founding basin bar × 1/FAMINE_SEVERITY (≈2.9) — found
only where the basin feeds the city through the famine year; dissolve stays
at 1×. Grounded, zero new constants.

**The live-regime referendum (the owner's arm, 480/8817, v45 physics +
LEAN_YEAR=1) was the day's decisive win** — with the v45 no-LEAN control
proving the economy flip alone did none of it:

| metric | v45 control | + LEAN_YEAR |
|---|---|---|
| register turnover (box) | 375 | **93** |
| big-anchor deaths | 16 | **7** |
| realms through the box | 86 | **20** |
| standing register | 52 | **14** (bronze-Egypt band) |
| valley rule at end | flipping | **one realm, 21.5k→25k unbroken** |
| Egypt mean size / bar | ~1.2 | **2.4–2.6** |
| world mean size / bar | ~1.3 | **3.7–4.2** |

The churn is gone in the regime the owner plays. Hierarchy (primacy ~1.1)
is deliberately deferred — the concentration engines now have margins and
surplus to work with.

**The gate ladder split**: smoke green; resgate ALL bands held (realms
BIGGER: largest 2.3M km² app); stylized 8817 all-hard + 1 warning in
budget; 4242 zero hard but 3 warnings (budget 2) — all three being
STABILITY read as anomaly by churn-era bands (616 living vs 24 fallen
states, few wars, flat deadliness); **777 ONE HARD FAILURE — civilization
alive: 10 settlements, pop 6,342.** On a marginal-geography seed in the
seeded-mature gate regime, the flat 2.9× bar strangles the world register
toward extinction. That is a real red: the law's grounding is right for
cradles and too blunt as a planetary constant.

**Disposition**: LEAN_YEAR ships def 0. The owner's play regime measured
spectacularly green — `LEAN_YEAR=1` in SIM_TUNE is safe and recommended for
live worlds now. Before any default flip, the named refinement: the margin
should breathe with LOCAL famine exposure instead of a flat planetary 2.9×
(a basin that famine rarely visits needs less granary margin — the same
vulnerability physics the famine seeder already computes), which should
keep the cradle result while releasing marginal seeds. Then re-run this
exact ladder.

## The harvest-years wave — bootstrap (probe_yieldcv, end of session)

The owner's design ratified: real year-to-year production swings, wrapped
into real output — famine proclivity = the local variance of actual yield,
famine events DERIVED from the tail, FAMINE_CHANCE/SEVERITY/RADIUS retired,
and LEAN_YEAR's margin re-grounded per-basin (which dissolves the 777
hard-fail by physics). Today's famine is scripted dice aimed by circumstance;
the existing climate.js layer is the CENTURY scale (global walk + volcanoes,
"cradles barely move") — the annual-regional floor is the missing system.

`probe_yieldcv` builds the candidate variance map from existing fields (the
irrigation stack's aridity ramp, dryFrac's single-season shape, floodplain-
grade river magnitude) and validates against literature yield-CV bands, the
Köppen-calibration discipline. Two iterations recorded in the probe: the
trade-premium water band pegged 1.00 planet-wide (England read "flood-fed");
the dry-month count read deserts as "seasonal". After both fixes: 6/12
region medians in band, with EVERY remaining miss attributable to a named
INPUT debt, not the formula:

- **Great-river resolution (tw=240)**: the Nile reads floodplain-grade 0.29
  and the Tigris-Euphrates 0.00, so both cradles read desert-margin rain
  farming (CV 0.45) instead of flood regime (~0.20). probe_irrfield's design
  note predicted exactly this; the tw=480 read is the next measurement.
- **The moisture-index calibration debt** (recorded since the forest wave):
  England margin 0.57 (Britain ≈ Mesopotamia on this index) and the
  solver-Sahel's cropland too wet (margin 0.09). One debt now mis-feeds two
  systems (forests then, variance now) — it has earned its own lap.

Wave order from here: (1) tw=480 variance-map read (does river resolution
fix the cradles?); (2) the moisture-calibration lap (blocks two systems);
(3) the mechanism — an annual regional index (spatially correlated,
year-persistent, composing with climate.js's century layer) multiplying
landFood, famine derived from its tail, granaries doing real work,
LEAN_YEAR per-basin — then the full ladder including LEAN_YEAR's re-run.
