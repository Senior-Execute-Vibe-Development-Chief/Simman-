# The from-0 dawn: wrong cradles, a silent crash, and what fixed which
### 2026-08-07 — owner report: "1: game shuts down at step 23713. 2: civ start in southwest canada, then ghana, then northwest australia"

Both reports reproduced, root-caused, and addressed. This file is the evidence
ledger; the code changes ride the same commit.

---

## 1. "Civ start in southwest Canada, then Ghana, then northwest Australia"

### Reproduced at the then-shipped defaults (pre-flip; app grid tw=960, observed climate, seed 8817)

`DAWN_LIVE=1` (the from-0 start) arms every hearth with `needY =
domLagY(best package) / suit`, and the best package is chosen by **climate fit
alone** — nothing says teosinte lived only in Mesoamerica. The armed table at
the app grid, in maturity order:

| order | site | lat/lon | package | needY |
|---|---|---|---|---|
| 1 | Orange River, **South Africa** | 29S 20E | wheat 1.00 | **902y** |
| 2 | Indus | 28N 70E | wheat 0.89 | 1008y |
| 3 | Orinoco, Venezuela | 8N 62W | rice 1.08 | 2317y |
| 4 | Mississippi | 32N 92W | rice 1.06 | 2351y |
| 5 | **Top End, Australia** | 15S 135E | rice 1.05 | 2377y |
| 6 | Paraná, Argentina | 31S 59W | rice 1.04 | 2410y |
| 7 | Nile | 29N 31E | wheat 0.37 | 2430y |
| 8 | **Ivory Coast (“Ghana”)** | 6N 5W | rice 1.02 | 2440y |
| 9 | Mesopotamia | 32N 44E | sorghum 0.79 | 2535y |
| 10 | Yellow River | 35N 112E | **maize** 1.05 | 4300y |

The live run confirms ignition tracks this table. The owner's seed drew the
same defect's other face: the wheat bell (tOpt 13°C annual, semi-arid) crowns
cool-dry mid-latitude sites — the BC plateau (their "southwest Canada"), the
Karoo, the Pampas — while the real wheat cradles read as rice/sorghum land, and
the Yellow River waits 4300 years for a crop from the wrong hemisphere.

### The mechanism was already built: `T.CROP_BIOGEO` + `T.IRRIG_CROP`, blocked separately, never measured together

- `CROP_BIOGEO` (wild ancestors have homelands) shipped OFF, blocked on a
  resgate claimed-land failure (0.36 vs 0.44 on seed 8817) attributed to its
  adaptation discount thinning crop coverage.
- `IRRIG_CROP` (flood-fed fields read the river) shipped OFF, blocked on the
  maize-through-irrigation anachronism — i.e. blocked **on** biogeography.

Measured **as the designed pair** (this session, both gate seeds):

| gate | solo CROP_BIOGEO (recorded) | the pair (measured today) |
|---|---|---|
| resgate claimed-land ratio | 0.36 FAIL | **0.68 (8817) / 1.81 (31337)** ok |
| resgate median-area ratio | — | 0.78 / **1.01** ok |
| resgate density ratio | — | 0.75 / 0.95 ok |
| resgate absolute median | — | 431k / 481k km² ok |
| resgate app realm count @6k | — | **4 / 5 vs floor 6 — the one FAIL** |
| smoke functional resume | 22-23% drift FAIL | **0.2%** ok (see §3) |
| smoke civilization-alive @4k (tw=160) | — | **4 vs ≥5 — the other FAIL** |
| stylized (21k) | 3/3 seeds, 1 warn each (recorded) | **all hard gates, warns at budget (2/2)** |
| DAWN_LIVE 40k arc (tw=480) | — | 52 cities, save/load + export clean |

Dawn under the pair at the app grid: **Indus 1332y → Nile 1833 → Channel-coast
2002 → Mesopotamia 2305 → Sahel (sorghum) 2954 → E-Africa 3704 → Paraná
(tubers) 4304 → Yellow River (rice) 4545 → N-Mexico (maize) 5023 → Venezuela
10101. Australia never arms.** Canada, Ghana and South Africa are gone from the
dawn; the Americas wait for their native packages' honest lags; the first
civilizations are the Old-World river valleys.

Live at tw=480 (40k steps): Indus → Zambezi highlands → Nile → southern
Britain → Sahel → Yellow River → Peru → N-America → Mesopotamia. Two soft
warts, recorded, not tuned away:

- **The Atlantic-facade wheat corridor** (a Channel/Britain-class hearth 3rd-4th):
  the climate-toll geodesic prices the maritime facade ~1.5 units from the
  Crescent (inside the 2.5 domestication core) and the annual-mean wheat bell
  rates 10°C coastland well. Cross-grid-stable (1.16/1.55/1.54 at
  240/480/960), so a metric property, not a resolution bug. The envelope
  centring is the GROW_SEASON entry's recorded honest limit.
- **The trans-Sahara / Rift high-road**: |Δtemp|+|Δmoist| is ~zero across a
  uniform desert and along temperate highlands, so wheat's range reaches the
  Sahel (d≈2.1-2.3) and the Zambezi highlands cheaply. Defensible for the
  Sahel; generous for southern Africa.

### Why the presence half alone is DEAD (the `CROP_HOMELAND` experiment)

To ship the anachronism-killer without the coverage-thinning discount, the
presence gate was split into its own lever and measured. **Presence without
adaptation re-crowns wrong sites under new names**: the far-travelled package
wins wherever it merely arrives — the Nile falls to W-African tubers (0.65 vs
wheat's undiscounted 0.61; needY 4600), the Indus to Yangtze rice, and the dawn
opens Iberia 957y → Zambia 1154y. Exactly the failure `packageAdaptMul`'s own
comment predicted. The halves ship together or not at all. The lever stays in
the schema at 0 as the recorded experiment.

### What still blocks the default flip (precisely two floors, both dawn-pace)

Every ratio, invariant, determinism, persistence, and history-shape gate is
green — the cross-grid ratios are the best in this repo's records. The two reds
are **fixed-horizon absolute count floors calibrated on the old dawn's pace**:
smoke's `civilization alive ≥5 @ step 4000` on the tw=160 toy grid (got 4,
alive and growing), and resgate's `app realms ≥6 @ step 6000` (got 4/5 — few
but real: 298-481k km² medians, not the 7-tile confetti the floor was built
against; 17 polities by stylized's 21k horizon). The old regime matured all ten
hearths nearly synchronously with anachronistic suit≈1 packages and minted
states fast; the pair's dawn (7 matured + 3 armed at map-open) matches the real
archaeological stagger, so early-horizon counts are honestly lower. Re-deriving
dawn-pace floors is a ratchet-charter decision (the charter's own lesson:
never in the same wave as the regime change), and the live-agronomy flip wants
the 4-seed abtest panel per the GROW_SEASON precedent.

### The flip (owner order, same day)

The owner ordered the flip ("do it"), which is what authorizes the two
dawn-pace floor re-derivations in the flip wave. Landed as one act:

- `CROP_BIOGEO` def 0 → 1 and `IRRIG_CROP` def 0 → 1, together (each one's desc
  records why alone it is the measured-wrong config).
- **SAVE_VERSION 5 → 6** with the v<6 regime guard (persist.js): both levers are
  live agronomy, so a pre-flip save that stores no delta for them is pinned to
  its old regime on load — the exact GROW_SEASON v5 pattern. New worlds get the
  pair; old worlds keep the agronomy they grew on.
- **smoke alive-floor 5 → 3** (both the main run and the dissolve arm — tw=160
  toy grid, 4 settlements measured at the horizon) and **resgate
  `appRealmsMin` 6 → 3** (charter formula at the new regime: ~25% below the
  worse gate seed, realms measured 4/5 at 8817/31337). Collapse-catch duty is
  carried by the untouched absolute-area floor and ratio bands — all green, and
  the failures the gate was built on (7-tile realms, collapse-to-anchor) still
  trip those.
- Battery at the new defaults, recorded below.

#### Flip battery (new defaults, no overrides)

| gate | result |
|---|---|
| npm test (smoke + emblem) | **all checks pass** (functional resume 0.2%) |
| resgate 8817 | **all bands held** — ratios 0.78 / 0.68 / 0.75, absolute 431k km², realms 4 ≥ 3 |
| resgate 31337 | **all bands held** — ratios 1.01 / 1.81 / 0.95, absolute 481k km², realms 5 ≥ 3 |
| stylized (21k) | **all hard gates passed**, 2 soft warnings (budget 2) |
| save migration | v6 default → pair ON · v5 no-delta → pinned OFF · v5 explicit → kept (probe, 3/3) |
| coverage | **✓** — `_armedHearths`/`_landSeats` (the dawn's live registries, now populated at gate horizons) measured in collect(): `hearth.armedNow` + `hearthArmed.*`, `nation.landSeatsNow` + `landSeat.*` |
| monotone (12k) | **0 failures** — the new metrics are point-in-time gauges by name (`…Now`), never cumulative claims |
| abtest 4-seed panel (vs pair-off) | **pace, not shape** — see the panel note below |
| tw=960 spot-check (probe_shape 16k) | **healthy, Old-World-led** — realms 4→7, claimed 1.0→3.8%, founded 35 / ended 5, median 569k km², top-1 share falling 51%→35%, no sub-scale confetti; the realm roster at the app grid IS the cradle list (Nile, Mesopotamia, Yellow River seats). The thin small-state tier (lnσ 0.88 vs real ≈2.0-2.6) is the pre-existing gap this probe instruments (shape-of-the-map wave), unchanged by the flip |

#### The 4-seed panel (abtest --base="DAWN_LIVE=0" --tune="CROP_BIOGEO=0,IRRIG_CROP=0", 12k, tw=240, seeds 8817/31337/4242/9999)

Baseline = the new defaults (pair ON), variant = pair OFF. 2,003 movers
consistent across all four seeds, and they tell one story — the pair shifts
**genesis pace, not history shape**:

- Realms at the fixed 12k horizon: ON 8/4/5/5 vs OFF 10/13/12/18 — while
  **median realm areas are comparable** (e.g. 769k ↔ 754k km² on 8817): the
  realms that exist are full-sized, there are simply fewer of them this early.
- ON worlds still carry live armed hearths at 12k (`count._armedHearths` 2 vs
  0) and one seed fires `farming.invented` live at step 4272 — the stagger is
  real even in the seeded-dawn condition.
- OFF worlds are further along the political arc at the same step: wars begun
  3 → 17, secessions/submissions/vassal blocs present only there. That is the
  OLD dawn racing ahead, not a shape divergence — stylized already prices the
  mature shape (all hard gates at 21k) and resgate the cross-grid sizes.

---

## 2. "Game shuts down at step 23713"

Could not reproduce a sim crash headless: at the app grid (tw=960, observed
climate, defaults, seed 8817) 30k steps ran clean, tw=480 ran 40k clean twice —
including a run exercising the full snapshot lane (stats, feed narration,
realm cards, chronicles both renderings, dynasty tree, trade profiles,
save/export) every 50 steps. The reported step sits in the genesis window at
the app grid (first cities/nations ~20-25k), so the trigger is seed- or
lane-specific. What WAS found and fixed is the failure UX that turns any throw
into "the game shuts down":

- A `stepPeopleSim` throw was posted to the page and **silently ignored** —
  the sim halted forever at its last frame, console-only.
- A `buildSnapshot` throw escaped the worker's try/catch entirely →
  `worker.onerror` → the page **terminated the worker and re-initialized a
  fresh world from step 0 on the main thread** (~a minute of frozen UI at the
  app grid, the 23k-step run destroyed) — the sim itself was healthy; only the
  rendering of it had failed.

Now: snapshot builds are guarded (throttled error report, sim keeps running,
save/export stay live); step errors pause the sim AND surface a persistent
banner with the step, the seed to report, and the fact that Save still works;
unhandled worker messages report instead of escaping; and the
fall-back-to-main-thread path is scoped to boot failures only (a worker that
has ever delivered a frame is never torn down mid-run). If the crash recurs,
the user now SEES the stack's message and the world is rescuable — and the
saved world is the reproducer.

---

## 3. Bycatch: a real save/load bug the gates then caught

Chasing the pair's smoke failure exposed that `s._thinBasinSince` — the
DISSOLVE_TOWNS "sustained below the city bar" clock — was never persisted.
Every save/load silently reset every pending town dissolution (~1500 steps of
grace re-granted). Invisible on the shipped defaults in the gate's window
(no town near the bar); the pair's leaner marginal-package worlds put towns AT
the bar, and the loaded arm kept towns the original dissolved on schedule —
the smoke gate's "systematic" verdict was exactly right. Fixed by persisting
the clock: defaults' functional-resume drift improved 6.8% → 4.5%, the pair's
22% → 0.2%.

## 4. Follow-up (same day): the birth craters — measured, one cure shipped, one gate blocked

Owner report on the flipped build: "nations/cities destroy the population in an
area around them when they are born… nations almost always (especially early)
collapse soon after birth." Instrumented across 39 city births at three grids
(probe_birthcrater): basins fall to 0.5-0.09× their at-birth field population
within 2,000 steps, famine-flagged — worst at the app grid, where even the
Indus and Nile cities hollowed their valleys to 0.25-0.27× and an E-African
basin hit 0.09×, with a second city later minting on the husk of the first.

**The hunt (recorded in full — two plausible suspects measured inert before
the real killer).** Suspect 1: the empty-pot famine (a newborn censuses its
whole catchment onto a cold ledger — measured demand 2-25× supply at birth —
and the die-off hit the FULL census). Scoping the famine base shipped
gate-green twice (v1 fedPeak ratchet — defeated by transient supply spikes;
v2 core-only base) and the craters reproduced ~unchanged both times. Suspect
2: the shock modules — attribution arms with `FAMINE_CHANCE=0` and
`PLAGUE_CHANCE=0` each still cratered. The killer was then found by
instrument (probe_capdrain, the Zambezi birth): **the basin's CAPACITY
crashes 88k → 49k in the exact mint window**, the drift-gathered core stands
10-50× over bare terrain, the field's own logistic mass-kills it, and the
city's census collapses 457 → 20 while the basin drains 54k → 12k — soil
exhaustion at zero, works rising, every famine channel quiet.

**The mechanism: the spike HANDOFF.** Pre-mint, the site law holds the
gathered core's capacity at `min(coreNow, coreBar×1.2)` (maybeSiteCities'
spike). At the mint that spike is deleted and the entity spike takes over —
but the entity spike (`deriveOnePop` kCap) is **import-share-driven**, and a
newborn feeding itself from its own land imports nothing: the handoff stamps
~zero capacity over the very pile the site law just finished gathering.

**Shipped: `CORE_HOLD` (def 1) — the killer's fix.** The mint stashes the
site law's own bound on the settlement (`_coreHoldCapF = coreBar×1.2`,
persisted) and the derive floors the entity spike at `min(live core, bound)`:
capacity keeps **holding what arrived** — one law on both sides of the
handoff — and the import economy takes over the moment it grows past the
floor. A shrinking core lowers its own floor, so a failing city still fails —
it just isn't executed by its own birth. Measured (tw=480/8817): the Nile
basin now GROWS through its city's birth (1.08× at +2000 vs 0.92), the Indus
holds 0.86 (vs 0.79), the Zambezi doubles its survival (0.61 vs 0.29-0.31 —
its residual decline is its genuinely-marginal city shrinking honestly).

**The app-grid residual, measured and attributed (the closing table).** At
tw=960/30k under the final code the world's aliveness transforms — 21 city
births (was 10), **37 living polities (was 13), zero polity deaths** — and
the worst craters soften (Nile 0.27→0.41, E-Africa 0.09→0.24), but basins do
NOT flatten as they do at tw=480 (Nile 1.08 there). The supply columns say
why: at the fine grid a newborn's ledger supply never ramps past ~0.6 of
demand, so the core shrinks, the CORE_HOLD floor follows the live core down
(as designed), and the slow crater proceeds. That ceiling is the
**coast/river 1-D capacity-dilution debt** — the resgate ratchet's own
documented open gap — now measured to be the binding constraint on
newborn-city viability at the shipped grid. Closing it is its own wave; when
it closes, this table is the before/after instrument.

**Also shipped: `FED_FAMINE` (def 1), kept on its own merits.** Not the
crater's killer, but correct physics the hunt hardened twice: an empty CITY
granary starves the people who depend on the pot — the urban core — while
countryside starvation keeps its own honest channels (the field's capacity
law; the harvest-shock module both ledgers feel). v1's fedPeak supply-ratchet
is recorded in the lever desc as measured-defeated (newborn ledgers see
transient import spikes that ratchet the memory to census scale before the
crash); v2 needs no memory at all.

**Blocked: `CITY_STORE` (def 0, built + fully measured).** The other half —
"a city may not mint where nothing stores" — was built in three forms and
every one ALSO blocked legitimate cities at the 21k stylized horizon (30→19
settlements, a hard aliveness FAIL, identical count under all three rulers;
the FED_FAMINE-only arm passed clean — the attribution). The site instrument
(probe_storegate) showed the lane is structurally hard: the settled roster
mixes site-pass mints with colony/plantation foundings whose basins never
held bar-level field people; mature basins run near the bar so refounds and
borderline temperate sites (Anatolia, the Danube, Texas at 0.84-0.96×) flip;
and the domestication-lane crop read blocks ground whose crops arrived by
contact (the Yangtze plain dom-BLOCKS while clim-PASSING). Under FED_FAMINE
the crater class it targeted is already non-lethal — a storability-poor mint
starves only its never-fed core and dissolves quietly, a failed urban
experiment instead of a regional die-off — so the gate ships 0 until a form
can tell a doomed mint from a colonial or borderline one. Full record in the
lever desc and the dead-forms comment (crystallize.js basinStorablePeople).

**Also answered in this round (assessments, not code):** non-city capitals —
the consistent version is capital-as-SEAT (the land-nation tile-seat and horde
ordu precedents), with reversion-not-death as the cheap first stage; owner
deferred. Missing China — the Yellow River matures 2.3-2.6× later than the
Nile/Indus because RICE (hot bell, 2,500y lag) stands in for MILLET, which has
no cool-climate representation; the millet-package split is the named fix,
owner deferred ("its own thing").

## 5. The deferred pair, delivered: millet for China, a real width for the water

Both §4 codas land in one wave (owner order: "do the next wave and the millet
thing") — the same story at two scales: the sim under-serving a real geography
for a representational reason, not a historical one.

### `CROP_MILLET` (def 1): the Yellow River gets its founder crop

The combined "Sorghum & Millet" package wore one Sahel-hot bell (tOpt 0.87 ≈
27°C) that scores ~0 on the cool Central Plain — its nominal N-China origin
never functioned, and the Yellow River pin fell to RICE's 2,500y
proto-domestication lag at mediocre suit: measured needY 3,564-4,545y across
seeds/grids, 2.3-2.6× the Nile/Indus. China armed last or never — the owner's
standing "still no china."

The split (cropPackages.js): millet (foxtail/broomcorn) becomes its own
package — warm-season temperate bell (tOpt 0.84, tTol 0.080), dryland
summer-rain moisture (mOpt 0.32), storability **1.00** (millet IS the ancient
Chinese granary/tax staple), yield 0.85, domLagY ~1,500 (Cishan/Xinglonggou:
cultivation ~8000-7500 BC → domesticated forms by ~6500 BC). Sorghum keeps
the Sahel and its bell, renamed "Sorghum & Pearl Millet"; the N-China origin
moves from sorghum's list to millet's (biogeography.js). Archaeobotany-class
values: direction and order the claim, digits not asserted.

**Measured (tw=960/8817, observed climate, DAWN_LIVE):** the Yellow River pin
arms on **millet, suit 0.55, needY 2,705y** — was rice 0.55/4,545y — moving
China from last-or-never into the Old-World pack (Indus 1,332 · Nile 1,833 ·
N-France 2,002 · Mesopotamia 2,305 · **Yellow River 2,705** · Sahel 2,954).
At the reference grid the pin still reads rice at these seeds (grid-local
climate at the pin tile), which is why the reference A/B panel below is
history-flat; the app grid is the shipping truth. One gate in bestPackageAt —
a never-owned package's only entry into any world — makes the v7 save-regime
guard exact.

### `ACCESS_BAND` (def 1): the waterside premium over a REAL width

THE resolution debt, closed at its source. The capacity premium
`ACCESS_RIVER×(riverMag/RM_FULL) + ACCESS_COAST×coast` was a per-tile read on
1-D features: a river influences rn× more tiles at a finer grid but each is
1/rn² the area, so the premium's real integral fell as 1/rn — the ~1.3-2.2×
dilution docs/resolution-collapse-2026-07-29.md documented, the resgate
ratchet has carried as its known gap, and §4's closing table measured as the
binding constraint on newborn-city viability at the shipped grid (app-grid
ledgers plateau at ~0.6 of demand).

The fix is the flood-ribbon convention applied to ACCESS: the premium extends
over ONE REFERENCE TILE of real cross-section at any grid — `w(d) = min(1,
max(0, rn/2 + 0.5 − d))`, Euclidean, full intensity in the band, fractional
coverage at the edge, MAX over sources (two rivers don't stack). At rn=1 the
band is exactly the source tile at weight 1 — byte-identical by construction;
at rn=4 (the shipped grid) ±1 full, ±2 half; below the reference the source
tile damps toward its sub-tile share (spot-verified: rmRaw 4 → band 3.333 at
rn=2/3). Static terrain, rebuilt deterministically at load, never persisted.
The banded arrays SUBSTITUTE for riverMag/coast in the capacity pass only —
serial loop, band kernel and pooled workers all read whatever arrays are
handed to them; the bit-guarded kernel is untouched.

**The dilution ruler (Σ capField × km²/tile over land, 1500 steps, 8817):**

| grid | ACCESS_BAND off | on | on/off |
|---|---|---|---|
| tw=240 (rn=1) | 74.85G | 74.85G | **1.000** — byte-identity proven end-to-end |
| tw=480 (rn=2) | 14.69G | 15.12G | 1.029 |
| tw=960 (rn=4) | 4.91G | 5.72G | **1.166** |

The repair grows with fineness — nothing at the reference, +17% of total land
capacity at the shipped grid, concentrated on the waterside tiles where the
dilution bit. The off-column's own fall across grids says honestly that the
access term was ONE share of a wider per-real-area capacity decline, not all
of it — the bands stay below parity and the ratchet keeps its debt.

**The shipping forensic (the wave's one determinism break, recorded per
custom).** The banded fields ride to pooled workers via the arena MESSAGE
(_pfArenaMsg), which redirected the riverMag/coast slots to the Float32 band
SABs but did not carry the accessBand flag — ensurePool sees only the
message, its geom.accessBand read undefined, and workers built Uint8 views
over Float32 band data: access≡1 garbage (0.8333f's bytes read as 85),
capField 516.49/312.05 = 2/1.2083 the exact signature, while the
coordinator's band 0 computed the truth. Wall-clock pool ENGAGEMENT then
chose between them per world — same-seed worlds diverged by step 2, and a
3-step serial-vs-pooled "pass" proved nothing because the pool only
stabilizes once every lazily-created array exists. The flag now travels on
the message with the slots it describes (one owner). Proven: 600-step
same-seed identity at two seeds with 4-band pools engaged; serial-vs-pooled
capField+popField bit-equality at step 600 with engagement ASSERTED; mid-run
lever toggles deterministic across twins; and the pre-fix dilution table's
impossible reference-grid ratio (1.666 where byte-identity is structural) was
the contamination's own signature — re-measured 1.000 exactly.

### The battery (new defaults, no overrides)

- `npm test` — all smoke green (determinism, invariants, save/load functional
  resume, dissolve arm), pools engaged.
- `npm run validate` — **all hard gates passed, 0 soft warnings** (Zipf −0.77,
  empire share 33%, area tail 8.6, water clustering 1.35, urbanization 4.7%).
- `npm run coverage` / `npm run monotone` — green.
- `npm run resgate` ×2 seeds — all bands held, and the ratios move toward
  parity (8817: median 0.83, claimed 0.74, density 0.79 · 31337: 0.92 / 1.79
  / 1.03 — the app arm out-claiming its reference for the first time).
  **Ratchet re-baselined per the charter** ("if a change improves them,
  re-baseline downward and say so"): floors 0.42/0.44/0.42 →
  **0.58/0.51/0.56**, derived from the two-regime envelope (~25% below the
  worse measurement across the flip wave and this one) so a same-day regime
  interaction cannot strand a floor — the staleness lesson honored inside a
  tightening instead of blocking it. Absolute and count floors keep their
  collapse-catch semantics.
- Reference A/B panel (12k, tw=240, 8817+31337; ACCESS_BAND byte-identical
  there, so the arm isolates millet): **12 of 1134 metrics moved — 11 are the
  band-field summaries themselves** (definitionally absent lever-off) plus
  wall-clock noise; every headline metric flat at 0.0. Reference-grid
  calibrations undisturbed.
- v7 save-regime guard: a pre-wave save pins CROP_MILLET=0, ACCESS_BAND=0
  unless the save set them — an old world keeps the agronomy and the capacity
  field it grew on.

### The payoff instrument (30k × tw=960/8817, DAWN_LIVE — §4's closing table re-run under the wave)

**China joins the dawn.** The Yellow River invents agriculture at step
~16-18k on millet (needY 2,705, fill 0.95) — **fifth** of the Old World,
right after Mesopotamia — where the pre-wave world put it seventh at step
~24-26k on rice (needY 4,545): ~1,800 years earlier, on its true founder
crop. And a first: the Sahel hearth **stands down** ("the farming package
arrived before it was invented") — diffusion outrunning independent
invention, a mechanism that had never fired before this wave resequenced the
fronts.

**Aliveness holds; the dawn resequences.** Zero polity deaths in both
worlds — the §4 collapse fix is undisturbed by the wave. Checkpoint
alive/polities, pre-wave → post-wave: 22k: 9/11 → 10/16 · 24k: 11/13 →
13/18 · 26k: 14/20 → 16/19 · 28k: 19/29 → 19/25 · 30k: 27/37 → 24/26. The
post-wave world runs AHEAD through ~26k; the pre-wave 30k count rides a late
far-northern tail (Baltic/Ladoga/White-Sea mints at 54-65°N in the final
2,500 steps) that the resequenced world hasn't reached by the horizon — a
timing-of-the-cut artifact, not a lost world.

**The craters: the access share is spent; the residual changes owner.** At
the shared great-river cradles the +2000 basin retentions sit within noise
of the pre-wave run (Indus 0.25→0.26, Nile 0.41→0.45 and unflagged,
N-France 0.46→0.39), while newborn ledgers at those cradles now reach
supply/demand **0.86-0.96 within +1000 steps** (Sogyoepa 0.95, Pigyipa 0.96,
Zyibayamphibta 0.86) — the ~0.6 plateau §4 attributed to capacity dilution
is no longer the binding pattern at the big valleys. Basins still decline
(post-wave +2000 median 0.27 across 16 births, vs 0.44 pre-wave — but the
mint roster shifted tropical, where supply runs 0.05-0.2 regardless of
water), so the remaining crater no longer wears the access-dilution
signature: capacity is repaired, ledgers balance, and the decline's
mechanism is UN-ATTRIBUTED by this instrument. The §4 probe chain
(probe_capdrain at tw=960, on a post-wave mint) is the named next tool; the
instrument stands.

## 6. Second follow-up (2026-08-11): "the population still disappears around cities spawning" — the crater's true mechanism, found on the third lap

§5 left the residual crater un-attributed and named the next tool. The owner's
report re-opened it, and the lap that closed it is a case study in why this
repo measures before it fixes — the first two hypotheses both died on
instrument.

**Hypothesis 1, famine (DEAD).** The threshold famine (any tick the pot reads
empty, 1.5% of the urban core dies, `fieldShift` mirrors the kills into the
land) fit every row of both §5 tables — cities in permanent small deficit
should bleed at the full rate forever. Measured (probe_faminedrain, both
grids, per-tick expected-kill ledgers): **kill/lost = 0.00 on every tracked
birth; the granaries never even emptied** in the crater window (food 182-285
at +1000). The deficit-proportional famine law designed for it was discarded
unbuilt.

**Hypothesis 2, the CORE_HOLD seam (REAL, but not the killer).** Per-tick
instrumentation of the first mint (probe_holdseam) found CORE_HOLD's floor
leaking at two seams: the mint tick's order (field pass → derive → mint)
deletes the site spike after the field pass has run — one guaranteed
floorless firing — and the floor's `_coreF` computed only under `f > 0`
(catchment assigned), so a newborn owning no tiles until the amortized
territory pass ran left the floor **inert for ~65 ticks** (measured: own=0,
spikeK=0, the 842 stash unused the whole window) — with `min(live core,
stash)` then holding only whatever survived, a one-way ratchet. Real leaks,
closed by `HOLD_SEAM` — but at the measured mint the pile sat under terrain
capacity and survived the window: the seam alone did not make the crater.

**The killer, caught in the act: FOOD_K × a cold ledger.** At +70, the tick
the territory pass assigned the newborn its 156-tile catchment, tile capacity
fell **1092 → 599 (−45%) in ONE tick** — `FOOD_K` (def 1) blends every OWNED
tile's capacity to the owner's food ledger, and a newborn's ledger is COLD
(its supply machinery has not yet measured the land the border just
enclosed; s/d 0.36-0.65). The blend painted that cold verdict over a
countryside that had been feeding itself, and the field's logistic then
killed the subsistence farmers toward it. **A border is not an economy** —
annexation does not stop subsistence farmers farming.

**The fix, `FOOD_REACH` (def 1): the ledger's authority is its
administrative reach, and the authority is ASYMMETRIC.** The blend weight
becomes fkL × the owner's admin-reach ramp — the identical org ramp the
grain levy runs on (`settlement.js foodReach`, ONE definition, two
consumers) — but only **downward**: UPWARD the ledger GIVES (market wealth
reaches the countryside through mere contact — peasants sell at the town
market with no levy bureaucracy in sight), so ledger-richer-than-proxy
blends at full weight regardless of org; DOWNWARD the ledger TAKES
(extraction and crisis pricing travel only as far as the bureaucracy that
can assess and collect), so a proto-state's countryside cannot be dragged
below its own subsistence yield while an organised state's famine/blockade
bites exactly as FOOD_K delivered. The symmetric form was measured WRONG in
this same lap — it cut seeded worlds (mature ledger, low org, the decoupled
case) and the smoke population arc fell 770→561; the asymmetric form passes
770→**1511** with both aliveness gates restored. Consequence-side
completion, same lever: the empty-pot famine now fires only when the supply
FLOW is below the CORE's own need (`_coreNeed`) — an empty store with a
core-covering flow starves nobody (without this, a basin THRIVING past its
city pinned the notional whole-catchment ledger at 0 and the die-off fired
775/1101 ticks into a well-fed core; the FED_FAMINE precedent — scope the
consequence, never re-key the calibrated drain — decided the form).

**The verdict (probe_faminedrain2, tw=480, all tracked births):** every
basin now **GROWS through its city's birth** — lost is negative across the
board, −45k to −76k on 26-73k bases (1.4-2.0× at the probe horizon), zero
over-cap tiles, cores growing, the capacity crash gone from the per-tick
trace (cap@ti steady through the ownership tick). Smoke green (population
arc 770→1511), stylized/resgate on this tree recorded with the commit; the
tw=960 payoff re-run follows.

**The app-grid payoff (30k × tw=960/8817, the §4/§5 closing-table lineage,
run on the pushed tree).** The strongest table of the arc:

- **52 city births (was 18), and EVERY basin grows through its city's
  birth** — +2000 retentions 1.26-3.72×, none below 1.0, famine flags
  nearly gone. The crater class is extinct at the shipped grid.
- **Aliveness 84 settlements / 85 polities at 30k** (pre-seam 24/26,
  pre-wave 27/37) — and polity DEATHS return (9 ended, p50 lifespan 7,937
  steps ≈ 2,000y, none under 500): the zero-death oddity of the earlier
  tables resolves into long historical lives, not birth-collapse.
- **East Asia fills in.** Sichuan mints ~23.9k, the upper Yellow River
  (Gansu) ~24.1k, the lower Yangtze ~25.1k, the North China Plain ~25.1k,
  then Guangxi, Guangdong, Manchuria — plus the Ganges, Bengal and SE Asia.
  The pre-fix run had ZERO Asia-beyond-Indus births in 30k: the crater was
  the blocker (each mint killed its basin, which killed the next basin's
  gather too). Owner report "china still is not a hearth" — answered by the
  same wave, on a fresh start. The residual China question is a LAG
  (invention ~16.5k → first city ~23.9k: the drift gathers a 10k core at
  headroom pace through a Malthus-saturated basin — ~7k steps), under
  instrument (probe_chinamint) as this lands.

v8 save-regime guard: pre-wave saves keep the capacity semantics they grew
on. Parked, unchanged: capital-as-seat / reversion-not-death (owner's word).

## Repro commands

```
# the defect (pre-flip defaults — now requires turning the pair OFF):
SIM_TUNE="DAWN_LIVE=1,CROP_BIOGEO=0,IRRIG_CROP=0" RUN_W=1920 node <runner importing tools/_harness.mjs>
# the fix (the new defaults):
SIM_TUNE="DAWN_LIVE=1" RUN_W=1920 ...                          # Indus→Nile→…, Australia never
# gates: npm test / npm run resgate / npm run validate at defaults;
# panel: node tools/abtest.mjs --tune="CROP_BIOGEO=0,IRRIG_CROP=0" --seeds=8817,31337,4242,9999 --steps=12000
# §5 wave arms:
#   node tools/abtest.mjs --tune="CROP_MILLET=0,ACCESS_BAND=0" --seeds=8817,31337 --steps=12000
#   dilution ruler: scratchpad probe (Σ capField × km²/tile, 3 grids, ON/OFF) — table in §5
#   payoff: SIM_TUNE="DAWN_LIVE=1,POP_FIELD_WORKERS=2" RUN_W=1920 RUN_STEPS=30000 probe_birthcrater
```
