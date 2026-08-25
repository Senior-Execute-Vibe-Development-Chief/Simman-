# The harvest-years wave — 2026-08-25

The chain (handoff 2026-08-24): moisture-calibration lap → yield-variance map
validates → the harvest-years mechanism (annual swings into landFood, famine
from the tail, scripted levers retire) → LEAN_YEAR per-basin → the flip ladder.
This doc is the wave's record; run logs in `docs/runs/2026-08-25/`.

## Lap 1 — the moisture-index calibration (DONE, gates green)

### The finding: the index was fine — the LANGUAGE was wrong

`probe_moistcal.mjs` (new; solver + observed arms side by side against NCEP
truth) measured the recorded "Britain ≈ Mesopotamia" debt and dissolved it:
the moisture index is a PRECIPITATION-like quantity (worldgen's own contract:
"how much water this ground gets"), and every consumer that broke was reading
it as ARIDITY against a flat global threshold. Aridity is water vs evaporative
DEMAND. The codebase already owned the corrective layer — biomeClass.js's
calibrated Holdridge `demand(t)` (the language the Köppen classifier passed
79.4% with, and the same fix CANOPY_CLASS applied to the forest signal).
Effective moisture:

    em = moist / demand(temp)

| region (cropland) | raw m (solver) | em solver | em observed | real AI (MAP/PET) |
|---|---|---|---|---|
| England | 0.45 | 0.86 | 0.72 | 0.93 |
| Mesopotamia | 0.06 | 0.10 | 0.03 | 0.11 |
| Sahel | 0.59 | 0.73 | 0.32 | 0.13 |
| Ganges | 0.44 | 0.61 | 0.62 | 0.68 |

Britain–Mesopotamia separates ~25× in em in BOTH regimes. No index rewrite;
no per-region constants. The raw index stays precipitation-like for the
consumers that read it as water (fertility, rivers, biomes).

### What em alone could NOT do — the two missing real axes

- **Continentality.** England (em 0.72, CV band 0.08-0.16) and the Pontic/
  Kazakh steppe (em 0.66-0.75, band 0.25-0.42) are indistinguishable on any
  moisture axis — the steppe bands are WINTERKILL, not aridity. The real
  variable is the COOL-HALF mean temperature (t − tAmp), not amplitude alone:
  Mesopotamia's 9.6 °C amplitude is scorching summers over a +13 °C winter (no
  risk), Kazakhstan's 11.8 °C is a −8 °C winter (full risk).
- **Monsoon concentration.** N. China stacks wf≈0.88 of its rain in the warm
  half yet shows almost no Gaussen-arid months (cold winters demand no water)
  — the one-season signal needs `warmRainFrac`, amplitude-gated ≥4 °C because
  in the low-amplitude tropics "the warmest six months" are the pre-rain heat,
  not a season axis (the Sahel reads wf 0.32; its seasonality rides dryFrac).

Both fields existed (the growing-season work). state.js now carries
`_tAmp`/`_warmRainFrac` onto the sim world whenever worldgen provides them
(consumers keep their own lever gates).

### The solver tAmp refinement (behavioural change, full battery green)

The solver-regime tAmp was latitude-only — London = Astana = 11.7 °C, the
refinement its own comment had documented as missing. Now three real drivers,
calibrated per-region against NCEP amplitude (probe_moistcal table):
latitude insolation swing (26·lat^1.35 °C, the continental-limit ceiling) ×
ocean buffering along the WESTERLY fetch (dirDist west scan, belt-weighted
20→35°; a pangaea interior is fully continental on its own) + an aridity boost
(3.9 °C × (1−em), equator-faded — dry soil and clear skies swing harder;
Mesopotamia's amplitude is heat, not cold). Measured: England 11.7→4.6 (real
3.8-4.9), Pontic 10.2 (9.4), Nile 6.1 (6.6), Kazakh 7.8 (11.8 — the westward
scan resets at the below-sea-level Caspian Depression, which the heightmap
renders as sea; a named quirk, consistent with the sim's Caspian-as-sea
semantics). GROW_SEASON ships default 1, so this changes the default solver
world (hearth crop suitability): **full battery run and green** — smoke all
checks; stylized 8817/4242/777 all hard gates, warnings 0/1/1 (budget 2);
resgate all bands held (median-area 0.76, claimed 1.16, 9 realms, absolute
328k km²). Logs: `tamp_*.log`.

### The yield-variance formula (src/sim/peopleSim/harvest.js — shared code)

The formula moved OUT of the probe into `harvest.js` so the probe scores the
code the mechanism will run (the biomeClass one-copy scar). Four factors, each
a named mechanism: em rain margin (EM0 0.55, ramp 0.50) · one-season
concentration (Gaussen shape ∨ amplitude-gated warm-half concentration) ·
winter risk on the cool-half mean (6 °C onset, 13 °C ramp, +0.17 max) · flood
regime (CV 0.20) with THREE water signals — the tFlood arid-river floodplain
mask, the absolute channel band (mag 2→5), and rainMargin × waterAccess
(channel-in-reach ∨ coast × ALLUVIUM_COAST's own 0.5): **arid-land cropland is
water-fed by construction** — the capacity stack built that fert from water
access, so charging it rain-fed desert CV (~0.45) describes farms that cannot
exist (probe_nilebox: Nile bank tiles fert 0.93 / moist 0.02 / chan 3).

Probe verdicts are FERT-WEIGHTED medians (the max-pooled fert mask hangs
valley fert on point-sample-desert tiles; the mechanism multiplies landFood,
which lives where fert is). Sahel and Pontic boxes were redrawn to the belts
their literature bands actually describe (millet belt 13-17.5°N; steppe proper
≤49°N — the first boxes' medians sat in the Sudanian savanna and Kyiv-latitude
forest-steppe, whose real CVs are honestly below those bands).

### The verdict (probe_yieldcv, four arms)

| arm | agreement |
|---|---|
| observed (app regime), tw=240 | **11/12** |
| observed, tw=480 | **11/12** (grid-stable) |
| solver (gate regime), tw=240 | 4/12 |
| solver, tw=480 | 5/12 |

The observed arm is the calibration referee (near-true inputs — a miss is the
formula's). Its one miss at both grids: **Mesopotamia 0.35 vs 0.15-0.30** —
the sim's lower Tigris-Euphrates never exceeds riverMag 2 at any tested grid
and lays almost no tFlood (probe_floodmask: Fertile Crescent window census
0..5+ = 145/8/10/0/0/0 at tw=480), so the box farms as half-served Gulf-delta
alluvium. The missing-great-river debt, now pinned with numbers — riverGen/
heightmap territory, NOT a formula constant to bend. Every solver-arm miss
decomposes into the three named solver debts (em pattern too wet in the
Sahel/S.India/Iberia; dryFrac saturation in temperate lands — the fixed 0.55
dry-month threshold; weak seasonal phase → warmRainFrac misses the monsoon).
Those are probe_climate_truth's territory, not this wave's.

**The LEAN_YEAR bridge this buys** (margin = 1/p10-year): England 1.18×,
Nile 1.34×, Mesopotamia 1.44×, Sahel 2.05× — versus the flat 2.86× that
strangled seed 777. The per-basin law now has a validated map to read.

### Instruments added

`probe_moistcal.mjs` (regional climate axes vs NCEP truth, both regimes) ·
`probe_floodmask.mjs` (tFlood/channel census over the cradle boxes) ·
`probe_nilebox.mjs` (per-tile cropland dumps, Nile/Mesopotamia) ·
`probe_yieldcv.mjs` v2 (--real arm, fert-weighted verdicts, axis diagnostics).

## Lap 2 — the harvest-years mechanism (T.HARVEST_YEARS, built)

The annual layer under climate.js's century walk (harvest.js, second half).
Each harvest year (2 ticks = 1 yr, the `_ivl` convention): every ~12°
weather cell advances an AR(1) z (ρ=0.30 — drought runs), one 3×3 spatial
smooth (analytically re-normalized to unit variance); each settled
settlement's landFood multiplies by `1 + z·cv(seat)` clamped [0.15, 1.6],
with cv from the validated map. Pastoral stays the famine hedge (added after
the cut, the recorded design). Granaries/prices/relief/siege all respond
through the systems that already read landFood.

**Famine derives from the tail**: a year below the region's p10 (z < −1.28)
that also destroys >35% of the harvest (mul < 0.65 — the retired
FAMINE_SEVERITY's own loss bar, now met emergently) sets the SAME
`s._famineUntil` every consumer already reads (distress +0.5, faith crisis
+0.3) and logs `famine.struck` once per afflicted realm at onset. The
scripted spawner (the aimed die, flat severity, radius stamp) retires under
the lever; plague untouched.

Determinism/persistence: `world._harvestZ` persists (~450 floats); the
smoothed field, lean state and multipliers all re-derive from it;
`_harvestYearMul` joins BOTH the settlement whitelist and the determinism
hash (the `_thinBasinSince` lesson). probe_harvestresume: harvest state
round-trips EXACTLY (z, multipliers, famine events identical), pop drift
0.35% vs the 0.27% lever-off baseline — the codebase's known warm-up drift,
no new class.

**Referee (probe_harvest, 480/8817/6000 steps = 3000y)**: mean multiplier
1.001 over 19k settlement-years (no hidden tax or subsidy); amplitudes by CV
class p10/p90 = 0.84/1.16 (low) and 0.81/1.20 (mid); famine 58/1000y
world-wide across ~15 settlements (≈ once per generation-to-century per
region, emergently by class) vs the legacy dice's 1.3/1000y planet-wide.
Coverage GREEN with the lever on (the new state is reachable); stylized
8817 and 777 under the lever: all hard gates, 0 warnings each.

## Lap 3 — LEAN_YEAR per-basin (built)

`crystallize.js leanAt(world, ti)`: the founding margin becomes the basin's
own DEEP year — `1/(1 − 2.33·cv)` clamped ≤5×, the once-a-century harvest
from the same map — replacing the flat planetary `1/FAMINE_SEVERITY ≈ 2.86×`
whose referendum was decisively green in the owner's live regime but
hard-failed seed 777 (a flat 2.9× strangles marginal-geography worlds).
England-class ~1.4×, the Nile's flood regime ~1.9×, Mesopotamia ~2.3×, the
Sahel ~5×. All seven bar sites re-wired per-site (cityBasinOkAt,
labelBasinFree's peer capacity, the site lane's eligibility/storable/drift
bars via `barOf(k)`, maybePeerSeats' capacity + takes, the mint-time take).
Dissolve stays 1× — the stability band is now per-basin.

## Lap 4 — the flip ladder (measured)

Pre-flip ladder under `LEAN_YEAR=1,HARVEST_YEARS=1` (logs: `pair_*.log`):

| gate | verdict |
|---|---|
| stylized 8817 | all hard · **0 warnings** |
| stylized 4242 | all hard · 2 warnings (budget 2) — was 3-over under the flat law |
| stylized 777 | **0 HARD** — the flat law's civilization-death gate RELEASED by physics · 3 soft n/a-abstentions (see the re-baseline below) |
| smoke (defaults) | all checks passed |
| resgate | all app-grid bands held |
| monotone | no cumulative metric decreased |
| coverage (lever on) | every measurable property reached |

**The Egypt live-regime referendum** (probe_egyptfate 25k, the 2026-08-24 arm
+ the pair), against both recorded arms:

| metric (box) | v45 control | flat LEAN (2.86×) | pair (per-basin) |
|---|---|---|---|
| register turnover | 375 | 93 | 132 |
| big-anchor deaths (peak ≥ 2M) | 15 | 7 | **7** |
| realms through the box | 86 | 20 | 52* |
| standing register at end | 52 | 14 | 24 |

The per-basin law KEEPS the flat law's anchor persistence entirely (7 = 7
big-anchor deaths, half the control) — the extra turnover is small
proto-towns at the register's edge, not the cities that matter. Standing
register 24 at the Nile's honest ~1.9× margin (the flat 2.9× gave 14 but
kills marginal worlds — not shippable). *Realms-through-box carries the
recorded huge single-seed variance (70-99 across arms); 52 vs 20 is at the
edge of readability.

**The churn-era soft-band re-baseline** (the chain's authorized revisit):
777's three warnings were all n/a ABSTENTIONS punishing the very stability
the law creates — "only 10 cities > 10k" (slope unfittable), "4 fallen
polities" (too FEW deaths to study — the churn era's 'near-deathless map is
suspicious' assumption), "no cradle origins resolvable" (the dawn cohort's
origin settlements died — history, not a recording bug). Each n/a now
scores ok exactly when its record is demonstrably live (≥8 cities over the
bar / ≥1 fallen polity / ≥1 root culture) and keeps warning at zero —
the collapse-catch semantics stand, aliveness stays the hard gates'
business. **777 post-rebase: all hard gates, 0 soft warnings.**

## The play report (2026-08-25, post-flip) — diagnosis and the second lap

Owner, from the tw=960 observed-climate live world: carpeting considerably
down; India/Caspian/Black Sea "look GREAT"; but (1) "the vast majority of
cities are STILL stuck at the absolute population minimum, 12k, and starving
at all times", and (2) "not even a single CITY spawns in the egypt middle
east area" — even though the Nile shows the densest population on the globe.

### Measured (probe_foundbar / probe_mintfunnel / probe_register, obs regime)

- **The founding-margin surface at the app grid** (foundbar 1920): England
  1.3×, India ~2.0×, Caspian ~2.2×, Pontic ~2.6× — the exact list the owner
  calls great — while **Mesopotamia read p50 5.0× (59% of cropland at the
  clamp) and the Levant ~4×: priced out of civilization.** Root cause chain:
  the in-grid Tigris-Euphrates is honest-small (runoff-weighted discharge —
  its real basin is mostly arid), so the land reads rain-desert; the
  composite-cv deep year (1 − 2.33·cv) then treats half-irrigated land as a
  Gaussian catastrophe and the margin explodes through the clamp.
- **Egypt founds fine at reference grids** — the live funnel (tw=480-obs)
  has the Nile LEADING the world at 19k (12 settled) with its anchor seat on
  a flood tile at 1.87× — then **bleeding (12→7 by 28k) inside a pinned
  peer-capacity ceiling (~12 = floor(cellMass/1.87·bar)) while the world
  register explodes 157→528**. A colossal population pile stands at the seat
  (core/bar 84-127×) that nothing converts into city growth. The owner's
  empty-Egypt at tw=960 is this bleed further along, plus the fine-grid mass
  dilution (the resgate ratchet's open gap) cutting the capacity — a tw=960
  stepped arm (hours) or the owner's save would pin it exactly.
- **"Starving at all times", quantified** (register, cities-only, 24-27k):
  cities run **fed p50 ≈ 0.27 chronically**, a tenth with empty granaries,
  **6-11% wearing the literal UI-starving label at any instant** — a
  rotating cast, so play reads as constant starvation — while importShare is
  0.00 at every checkpoint through 30k. Cities nonetheless grow (core p90
  ~250-312; at-bar only 5-10% of true cities): the FIELD book feeds the
  people while the settlement LEDGER under-supplies the core — the residual
  two-books gap at the core-billed level, waiting on the import/uptake wave
  (the autopsy's throughput chapter). cv(hungry) = cv(fed): the hunger is
  structural, NOT harvest-swing-driven.

### Shipped this lap: T.ARID_SECURE (def 0) — and a four-round lesson

The Mideast fix is the PER-COMPONENT MIXTURE on construct-water land (the
flood mask, or channel/coast access where rainMargin ≳ 0.7 — rain farming
impossible, the cropland water-fed by construction): the rain share fails
to zero in the worst year while the watered share keeps the flood regime's
own deep year — which is why Sumer could exist, and what the composite
cv's Gaussian tail cannot see. Measured at the app grid with the pair:
Mesopotamia seats ~1.9×, Levant ~1.6-1.7×, Nile unchanged 1.87×, desert
bulk honestly ≥4×.

**It ships as a GATED PAIR, not a default** — the founding deep year AND
the annual draw must carry the same mixture, or the maps disagree. The
elimination that proved it (mixfix1-6 run logs, four battery rounds):
every unpaired variant — the deep lift alone, fert-MEAN smoothing,
richest-fert-MAX smoothing, water-term "tightening" inside the validated
cv — bled seed 777's register to 15-17 settlements (hard fail). The lift
alone tells the founding law "secure" while the annual draw still famines
the same tiles at composite amplitude: desert-coast mints become
doom-cities. Two of the variants failed with byte-identical numbers, which
is what isolated each cause in turn. The default path returned to the
exact SAVE_VERSION 46 flip physics (verified across the full board: 777
all-hard/0-warn, 8817 0-warn, 4242 in-budget, smoke, resgate all bands).

**The lever's own ladder verdict: still RED on the gate seed.** Paired,
777 reads 19 settlements vs the alive floor (unpaired variants: 15-17) —
the pairing damps the damage but the construct credit still net-harms
marginal geography. The remaining wrongness is capacity-shaped: the deep
margin says "secure" while the desert tile's actual watered CAPACITY still
cannot carry a city through real years — the credit likely must require
the basin's watered capacity, not channel presence. ARID_SECURE ships 0
with that named refinement; safe to hand-set for a Mideast-peopled Earth
in live play (the app-grid seats measure right).

Standing sub-lesson, now twice-paid in one wave: **the flip-validated cv
formula is one organism** — a change to any term while chasing a
different consumer moves every gate world.

### The next wave (measured, named, not this lap)

1. **Import uptake → core growth** — the 12k ceiling and the fed-0.27
   ledger are the same structural fact: cores can only eat local land, and
   the agglomeration size target rides import capacity, which is ~0. The
   autopsy's step-5 lap, now measured in the app's own regime.
2. **The Egypt bleed** — famine-correlated churn inside a pinned capacity;
   decompose the death causes at the obs grid (egyptfate's instrument, obs
   arm) after (1) gives the valley margins.
3. **The observed-regime register explosion** (world 157→528 over 10k steps
   at tw=480-obs) — carpeting pressure in the regime the owner plays,
   distinct from the solver-gate worlds the batteries watch.
4. The in-grid Tigris-Euphrates (riverGen/heightmap) remains the recorded
   hard debt under Mesopotamia's residual 3.5×.

## THE FLIP (2026-08-25, SAVE_VERSION 46)

`HARVEST_YEARS` and `LEAN_YEAR` default ON as one act; pre-v46 saves keep
scripted famine and good-year founding via the v<46 guard. Post-flip battery
at the new defaults: `flip46_*.log` (smoke, hashbase, coverage, stylized
8817). The chain of 2026-08-24 is executed end to end; what remains is the
autopsy's step 5 (urban hierarchy/primacy — the agglomeration engine now has
margins, surplus, imports and annual scarcity to work with), recorded in
docs/handoff-2026-08-25.md.

---

# THE IMPORT/UPTAKE WAVE (same day, the "go" lap) — THE OPEN GRAIN MARKET

The play-report's other half ("cities 12k-stuck and starving") executed:
measured, built, eliminated to shape, flipped. **SAVE_VERSION 47,
`T.GRAIN_MARKET` default ON.** Instrument: `tools/probe_uptake.mjs`
(stage-by-stage funnel: topology / surplus / haul / levy / coin / fuel, with
per-node levy-buy recording behind `world._tradeStats` and a hungry-leaf
market-stage classifier). Run logs: `docs/runs/2026-08-25/uptake_*`,
`gm*_stylized_*`, `chaos_*`, `gm5_resgate.log`.

## 1. The funnel (why no one was buying)

Worlds are pre-urban far longer than the old probe horizons assumed (first
cities ~15-20k steps); measured at 24k/30k/32k, three regimes:

- **The hungry register is LEAF-dominated everywhere.** The tree market
  moves grain child→liege only, inside one country. A leaf — 82-84% of every
  register — can neither buy (no children) **nor sell** (no parent → never
  offers). obs-240 30k baseline: hungry 449/535; of them LEAF 377,
  DRY-SURPLUS 71, CAPPED ≈ 0. The levy/coin stages the prior session
  suspected measured CLEAR once a tree exists (unbought ≈ 0).
- **The food exists.** Σland 441 vs ΣcoreNeed 207 (obs-240 30k) — the world
  grows 2.1× its cities' needs while 84% starve. A pure distribution
  failure: the surplus is structurally invisible to the market.
- fed(parent) p50 1.00 vs the starving leaf tail; importShare p90 0.00 —
  URBAN_AGGLOM (fuel = import-fed capacity) never fires at non-capitals:
  the 12k pin.

## 2. The mechanism (grainMarketPass, foodHierarchy.js)

After the tree sweep, a settlement whose ledger still runs short BUYS from
its trade peers — `mergeReach`, the same road+sea network goods use,
cross-border like goods trade, no war gate (SIEGE_STARVE and trade-peace own
those axes) — from each peer's live residual surplus, at the seller's
scarcity price, through `foodHaulArrive`'s spoilage physics, capped by spare
coin over the subsistence reserve. No cross-border levy: requisition is the
tree's sovereignty act; across borders grain moves only paid for. Zero new
constants.

## 3. The elimination (what the gate seed forced into the shape)

`gm1`: raw market. 8817 all-hard/0-warn; **777 hard-fails 15 alive** (its
recorded baseline: 40). Three rules, each measured in:

1. **The seed-corn rule** (`gm2`) — a seller offers only the surplus its own
   granary cannot absorb (`granaryCap` extracted to ONE definition, shared
   with the updateFood clamp). Without it the market drains exactly the flow
   that fills granaries, and under HARVEST_YEARS the sellers die at the next
   lean year. Necessary, not sufficient: 777 still 14.
2. **The chaos ensemble** (`chaos_eps*_777`) — before more building, the
   control experiment: float-epsilon perturbations (MINING_RATE +1e-7…)
   with ZERO mechanism land 777 at **20/21/22 alive** — the recorded 40 was
   a lucky draw, and the hard floor (20) has ~no margin for ANY
   economy-touching change on this seed. But the market cluster (15/14/14/14
   across three builds and an epsilon) sat tightly BELOW the band: a real
   depression, not noise. The 777 funnel pair isolated onset: divergence
   from step ~2000, medians cores 15.9 vs 42.2 by 14k, the first founding
   cascade missed (+1 vs +7 at 16-18k).
3. **The market institution gate** (`gm4`) — commercial buying needs
   `techEff.market` (coined money; the monetization() precedent). Dawn
   cradles were trading from birth (granaries start at cap; cold ledgers
   read need) — ahistorical (temple economies moved grain by administration;
   commercial grain trade at scale is classical) and measurably the
   flattener. Emergent, never a date: the market opens where a society
   mints coin.
4. **The export capacity add-back** (`gm5`, replacing gm3's floor) — last
   aggregation's peer sales add back into foodK's basis: the FOOD_REACH
   asymmetric-authority law extended to the market (selling cannot drag a
   catchment's carrying capacity below what its own land grows; imports
   still lift). NOT a max()-vs-production floor: the first implementation
   compared last-tick net against this-tick production and became a
   cross-tick ratchet muting every settlement's harvest-year capacity
   signal from tick 1 — trades or none (the gm3/gm4 15-alive residue, and a
   lag-discipline lesson for the file: same-lag quantities only).

`gm5`: **777 lands 20 alive, all-hard, 0 warnings — inside the
no-mechanism epsilon band.** With no trades the lever world is now
byte-identical to baseline by construction.

## 4. The flip battery (SAVE_VERSION 47)

- smoke green post-flip; stylized **777/8817/4242 all hard gates at
  0/0/0 warnings** (the v46 flip battery itself carried 0/2/0);
- resgate all bands (median realm app/ref 0.93);
- hashbase pair **unchanged** (ebfb8021/7fb32527): the institution gate
  makes the flip byte-transparent until coinage exists — late-game-only
  physics by construction; v<47 guard pins pre-flip saves;
- no new persisted state, no new metrics (coverage/monotone not triggered);
- the obs-240 referendum (final build): **importers 3→175, peer grain
  12.3/tick vs the tree's ~1.4, fed(leaf) p50 0.08→0.58, fedNOW p50 0.75,
  W-Europe 0.85 / Pontic 0.82 / India 0.70** (baseline 0.04-0.50),
  importShare p90 0.00→1.00. The obs-480 (tw=480) A/B on the pre-gate build
  read the same shape larger (importers 20→271, Egypt 0.84) — the app-grid
  landslide; a `probe_shape` tw=960 spot-check is the standing
  third-cardinal-rule arm (gm5_shape_1920.log).

## 5. Named residuals (measured, not this lap)

- **Egypt/Mideast fed p50 0.24** in the final referendum draw (3 importers
  of 19): its atomized bronze singletons hold neither coin (the institution
  gate) nor a levy tree (singleton polities). The un-gated market fed Egypt
  0.54 — through the same ahistorical dawn trade that broke 777. Egypt's
  cure is realm consolidation (the levy is BUILT for it) or its own
  monetization — the register-atomization wave.
- The stylized 777 alive-gate reads a chaotic quantity whose typical value
  (20-22) hugs its own floor (20) — any economy change on this seed is a
  near-coin-flip. Recorded here and in the lever desc for the next
  gate-grounding conversation; not re-based unilaterally this wave.
- Buyer-side granary provisioning (buying AHEAD to fill stores — the annona
  stockpile) is deliberately absent: buyers cover flow-need only. If
  import-fed cities measure siege/famine-fragile, that is its own lap.
- MKT-SHORT-idle in the classifier now mostly means "pre-coinage" — the
  classifier checks coin but not the institution; refine when next used.

### The tw=960 spot-check verdict (gm5_shape_1920.log, post-flip defaults)

probe_shape 24k at W=1920 (the grid that ships): realms 17, claimed 16.8%,
median realm 909k km² (healthy absolute scale — resgate's tw=480 floor is
60k), MAX 8.9M km² at top1share 36%, max/med 9.8, **lnσ 3.21**, small-state
(<100k km²) share **29%** — versus the shape-wave's recorded defect era
(lnσ 0.8-1.1, small share 2-14%) and history's bands (lnσ 2.0-2.6, small
share 47-80%). The post-v47 fine-grid world has a REAL size hierarchy and a
small-state tier; no kind-difference collapse from the grain market at the
app grid. (A sanity check against recorded baselines, not a same-build
lever-off A/B — that twin costs hours; this is the standing
third-cardinal-rule arm.) lnσ now sits slightly ABOVE the historical band —
driven by mem=0 relic micro-states (1-6k km²) coexisting with the hegemon —
a note for the consolidation wave, not this one.
