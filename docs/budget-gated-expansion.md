# Budget-gated expansion — prototypes & measured negatives (2026-07)

User question behind this: *"How can realms GET overextended? Surely the budget
is critical when expanding — can I actually govern this area?"* This doc records
the mechanism audit, two prototype answers, and the measurements that rejected
their first designs — so the next attempt starts from evidence. All numbers:
480×240, seed 8817, 6 000 steps, harness pipeline, `polity.ended` cumulative.

## Where "can I govern this?" already lives — and where it doesn't

- **Territory growth is already capacity-priced** under the shipped model
  (`TILE_POLITY=1`): the reactive growth target is `max(floor, FIELD_SPAN ×
  capacity)` (countryTerritory.js — the capital-anchored path near the
  `else if (T.TILE_POLITY)` branch). When capacity crashes (war duress, siege,
  insolvency, momentum decay — conquest.js), the *target* crashes; that IS the
  dramatic shrink, by design.
- **Member acquisition is not load-priced anywhere.** adoptAndFound gates on
  ORGANISATION (statecraft symmetry) but never on the load/capacity ratio;
  conquest banks momentum instead (deliberate overshoot-and-shatter); member
  population growth raises load with no acquisition at all.
- The legacy cost-Voronoi budget loop (`COUNTRY_REACH_BASE/ORG`, size gates,
  BUDGET_RAMP) is **not the active authoring path** at defaults — reach edits
  there are dead code under TILE_POLITY=1. (Learned the slow way; see below.)

## Prototypes (kept, DEFAULT-OFF levers)

- `ADOPT_BUDGET` (def 0 = off): a court whose persisted strain
  (`gov._strain = load ÷ capacity`, stamped each polity pass — new telemetry,
  survives save/load) is ≥ the lever refuses NEW stateless subjects; refused
  communities stay independent (primary-state fuel). Conquest untouched.
- `REACH_STRAIN` (def 0 = off): legacy-path reach contraction ∝ strain.
  Inert at defaults (dead path) — kept only for A/B against `TILE_POLITY=0`.

## Measurements

Baseline (defaults, both levers 0) vs ADOPT_BUDGET=1 (the gate active):

| step | baseline: maxClaim / median / realms / ended | gated: maxClaim / median / realms / ended |
|---|---|---|
| 1000 | 324 / 43 / 24 / 3 | 302 / 52 / 26 / 2 |
| 1500 | 297 / 42 / 25 / 5 | **392** / 66 / 23 / 5 |
| 4000 | 185 / 28 / 41 / 6 | **86** / 20 / 50 / 8 |
| 6000 | 168 / 28 / 45 / 7 | 130 / 31 / 46 / **18** |

**The gate made the cycle worse**: a higher, later peak; a far deeper bust;
2.6× the polity deaths. Verified twice (REACH_STRAIN 0.6 and 0 produce
byte-identical runs → the entire delta is the adoption gate).

## Why (failure analysis)

1. **Refusing subjects refuses their taxes.** New members are revenue; a
   strained realm barred from absorbing productive communities is starved of
   exactly the income that would lift its solvency → fiscal-duress spiral →
   more deaths, deeper busts. Historically resonant (empires absorbed to pay
   for themselves) — and the reason a bare load-threshold refusal is the wrong
   mechanism.
2. **Freed land is a commons.** Whoever is *within* budget expands into what
   the strained majority cannot take — inequality of claims grows, the biggest
   blob peaks higher (392 > 324) before its own correction.
3. **Two controllers, one plant.** Strain-fed reach on top of the existing
   loyalty-shed correction (and, at defaults, on top of the capacity-priced
   growth target) oscillates — the classic over-tuned-knot the second cardinal
   rule warns about.

## What the next design must account for

- Price acquisition by **marginal revenue vs marginal load** — a court takes a
  subject whose expected tax yield covers its admin cost (distance, size,
  tongue), refuses one that doesn't. That's a real mechanism with independent
  meaning, not a threshold; it naturally lets rich near provinces in and
  refuses poor far ones, at any strain.
- Feed load into the **reactive growth target** (the TILE_POLITY site), not the
  legacy budget — and *instead of*, not on top of, one of the existing
  corrections.
- Validate as a campaign: this probe's cycle metrics + the stylized-facts
  gates (fallen-polity lifespans, empire tails, war rates) at 480 AND the
  shipped width — empire size is resolution-sensitive.

## Addendum: "remove the crystallisation wave and the core regions?"

Asked and answered with the levers we already have:

- **The core-region floor is already replaced** (SIZE_BY_POP=1, the 2026-07
  flip): extent is population-earned, coverage rises with development. Every
  pulse measurement above ran under that model — the pulse survives, because
  the birth grant is now the (real) 3000-BC initial population being BOOKED
  into org≈0.25 states, not a scripted hinterland. Removing "core regions"
  further = removing the world's people, i.e. the premise.
- **The crystallisation wave is emergent, not scripted** — the condensation of
  that initial population wherever density × fertility crosses threshold. It
  is a wave only because the cold start places every fertile valley NEAR the
  threshold at t0. De-synchronising it means initial conditions deeper in
  prehistory (a thinner, growing scatter), so valleys cross on their own
  clocks and the dawn rolls instead of pulsing. That re-anchors every
  downstream calibration (stylized gates run 15k steps from the current
  genesis) — full-campaign scope. Reality check: the real Holocene dawn was
  itself compressed (~1.5 millennia for all cradles); the sim compresses it
  ~10× further.
- **Ranked fixes**: (1) marginal-revenue adoption (above) — stops infants
  booking countryside they cannot afford; most contained. (2) deep-prehistory
  genesis — fixes universality. Together: a rolling dawn of small states,
  each overreaching and correcting on its own clock.

## Round 2 (2026-07): the two ranked fixes, built and measured

Both mechanisms were implemented and measured on the same pipeline
(480×240, seed 8817, 6 000 steps, defaults byte-identical to the baseline
above — re-verified checkpoint-for-checkpoint before the arms ran).

- **`FISC_ADOPT` (the fisc test, entities.js `fiscAdoptable`)** — the
  corrected marginal-revenue mechanism: a stateless community is adopted
  (crystallise born-join, adoptAndFound anchor + village branches) only if
  the capacity its people bring — the realm's own `_capacity ÷ Σ member
  people`, both stamped by the polity pass — covers `FISC_ADOPT ×` the
  admin load of governing it (the polity pass's own ruler: distance ÷
  holdRange × the SIZE_REF size term, at steady state). Emergent on both
  sides, per-subject (no global freeze — the ADOPT_BUDGET failure), exempts
  conquest / border shifts / colonies / member-region town spin-offs.
  Decision surface unit-checked: the measured 4-person, load-5.27 hamlet is
  refused; a newborn beside the capital, and every productive town, adopts.
- **`DAWN` (the long dawn, popField.js)** — deep-prehistory genesis as an
  initial condition: the genesis field seeds at `DAWN ×` its Malthusian
  equilibrium (residence-graded as before), and the census↔field bridge is
  calibrated at the EQUILIBRIUM reference (without that, mature census
  inflates by 1/DAWN and the staggering cancels out of the nucleation mass
  — found in design review, fixed before first run). Basins then cross the
  absolute state-viability bars on clocks set by their own richness.

| arm | peak (step) | trough | deaths @6k | realms @6k | ramp to ~22 realms | settled @6k |
|---|---|---|---|---|---|---|
| baseline            | 324 (1000) | 168        | 7  | 45 | 2 windows (250→1000)   | 75 |
| FISC=1              | 279 (1000) | **65** (4750) | 10 | 54 | 2 windows              | 69 |
| DAWN=0.35           | 302 (1750) | 197        | **4** (0 thru 1500) | 43 | **5+ windows (250→1500)** | 77 |
| FISC=1 + DAWN=0.35  | 264 (1000) | 99         | 10 | 54 | 5+ windows             | 75 |

**DAWN=0.35 is the genesis-pulse fix.** The dawn rolls (realm ramp
3→9→15→20→26 across 1250 steps), the early die-off disappears (0 deaths
through step 1500 vs 5; 4 by 6k vs 7; 0 abandonments vs 2), the median
realm runs ~25% larger through the peak era, the correction is a gentle
−33% deflation instead of the −48% mass shatter — and the world converges
to the same size by 6k (77 settled vs 75, 43 realms vs 45). Default
flipped to 0.35 (≈ the 3000 BC condition: a third of the agrarian ceiling
carried, most of the filling still ahead).

**FISC_ADOPT is a measured negative at every dose — the honest surprise.**
Alone at 1.0 it trims the early peak modestly but correlates with a deeper
mid-late deflation (trough 65 vs 168) and more deaths (10 vs 7); stacked
on the dawn it suppresses exactly the consolidation the dawn enables (max
110 vs 209, median 20 vs 32, deaths 10 vs 4). Halving it (0.5 + dawn)
reproduces the same signature, merely later: a fragmentation wave at
~3000-3500 (realms 25→51 in 1000 steps), max 74 / median 21 / 63 realms /
8 deaths at 6k. Monotonic dose-response, so this is the mechanism, not the
tuning. Reading: in this sim's fiscal loop CAPACITY COMES FROM SUBJECTS
(capacity-per-person is roughly flat at early development), so *any*
adoption-refusal — global (ADOPT_BUDGET) or marginal (this) — starves the
mid-game hinterland absorption that funds the next ring of consolidation;
the failure analysis above ("empires absorbed to pay for themselves")
applies to the marginal form too. Meanwhile the dawn removes the birth-
grant pathology on its own: infants born into a 35%-full world have
little countryside to over-book. Default stays 0; the lever, the shared
`fiscAdoptable` helper and its verified decision surface stay in the tree
for future re-pricing work (e.g. capacity-formation lag, where a subject's
capacity contribution arrives slower than its load).

**Shipped defaults from this round: `DAWN=0.35`, `FISC_ADOPT=0`,
`ADOPT_BUDGET=0`, `REACH_STRAIN=0`** — one mechanism fixed the cycle;
three levers document why the other three answers were wrong.

Gates at the shipped defaults: smoke fully green (determinism, zero
invariant violations, save/load hash identity, living civilization);
stylized 21k-step run all hard gates passed with the one pre-existing
soft Zipf warning (budget 2) — 80 polities, largest-empire share 5%,
fallen-lifespan median ~305y, wars 0.34/1k-steps/polity.

## Addendum 2 (2026-07-26): the endowment decomposition — org-cut measured, REJECTED

Owner hypothesis: the genesis balloon comes from the cradle seed's head start
(240 people, agriculture 0.55, organization 0.28). Tested with a new
instrument, `tools/probe_cradle_pulse.mjs` (age-aligned claimed-tile
trajectories, cradle-seeded vs natural realms, 480×240 × 8k).

**Baseline (3 seeds):** cradles peak at ~age 750–2250 at 33–64 tiles mean and
overshoot their settled extent ×1.32–1.57; naturals run ×1.04–1.36 — the
balloon is real and cradle-specific.

**Decomposition (8817 spot runs):** the FULL-natural seed (25 people, org
0.10, agri 0.50) eliminates the balloon entirely — cradles peak at age
5500–7000 like anyone else — but planetary ignition collapses (+5k steps to
the first natural state): the technique half (agri/metal/people) is the
diffusion source the whole world lights from. The org-only cut (0.28→0.10,
package kept) kept ignition on time and cut 8817's peak 38 % — the promising
read that motivated the battery.

**3-seed A/B of the org cut (`CRADLE_ORG=0.1`): NOT robust.** Peak down on
8817/4242 (64→40, 57→47) but UP on 31337 (33→69); the overshoot ratio is
WORSE on all three seeds (1.56→2.52, 1.32→9.16, 1.57→2.85) — a low-org
proto-cradle is FRAIL, and its later shatters/witherings dominate the
trajectory; ignition and era-1 arrival shift ±600–1000 steps with no
consistent sign. The single-seed promise was trajectory chaos — the same
standing lesson the G-equivalence and TRUCE_TOLL measurements taught.

**Verdict:** the statehood endowment is a minor, non-robust contributor. The
pulse's deeper causes stand as diagnosed above: the 3000-BC initial field
population being BOOKED instantly by any org-capable state, plus the
first-mover vacuum (member acquisition not load-priced). The ranked fixes
remain (1) marginal-revenue adoption — design two, after the measured failure
of the naive gate — and (2) deeper-prehistory genesis (campaign scope).
`T.CRADLE_ORG` briefly shipped as an explicit knob and was superseded the
same day by **`T.CRADLE_EVE`** (the owner chose removal of the whole head
start): 1 = the legacy eve-of-states package, byte-identical; 0 = cradles
seed as natural villages (25 people, frontier knowledge) and the first
kingdoms EMERGE — the balloon gone at its root, the dawn ~5k steps later,
`DISP_START` following the lever so the display label stays honest. Battery
and flip record in addendum 3 below.

## Addendum 3 (2026-07-26): the head start REMOVED — `CRADLE_EVE` default 0

Owner order after the addendum-2 verdict: remove the eve-of-states package
entirely. Built as `T.CRADLE_EVE` (1 = the legacy injected proto-urban town —
240 people, agri 0.55 / org 0.28 / constr 0.20 / copper — byte-identical,
hashbase pair verified; 0 = a cradle seeds as a NATURAL VILLAGE, 25 people at
the frontier knowledge floor) and **flipped to 0** on the battery below. Every
calendar epoch follows the lever (calendar.js: display −3000→−4300, dynasty
−3000→−4300, the 0.5y/tick clock −3000→−5600), so the map now opens in the
late neolithic and the first kingdoms still read ~3000 BC — the label follows
the world, per the cardinal rule, instead of the world being inflated to
match the label.

**Battery (3 seeds × 12k, probe_cradle_pulse):**
- The balloon is REMOVED at its root on 8817/4242 — cradles peak organically
  at age 5500–8000 (vs age ~1000 injected), ratios at natural levels; 31337
  keeps a MINIATURE early pulse (peaks age 500–1000 at ~33–36 tiles) from the
  deeper cause addendum 2 named: any org-capable polity still instantly books
  the pre-seeded 3000-BC field population around it. That residual is the
  marginal-revenue-adoption arc's problem, not the seed's.
- Ignition: first natural state +3.6–5.3k steps; era-1 arrival 9900–10800 vs
  4800–5100 (~+5.2k mean — the calendar shift above).
- Cradle statehood is now EARNED, hence non-guaranteed: 8 of 12 hearth
  villages reached lasting statehood; famous-cradle openings are a strong
  tendency, not a promise. (The pinned EARTH_HEARTH_SITES still place the
  villages and found the cultures; only instant kingship is gone.)

**Gates: the emergent-axis design paid off in full.** At the STANDARD 21k
horizon, on the slower world: smoke green (all checks, incl. save/load and
the dissolve gate), stylized **3/3 hard-green with 8817 = 0, 31337 = 0,
4242 = 1 soft warning** — the best warning profile of any configuration
measured this month ("a slow world traces the same curve later and still
passes" — the W6-A design premise, now demonstrated). No validate-horizon
extension was needed. Guard baselines re-anchored on the new defaults
(priors kept; `SIM_TUNE="CRADLE_EVE=1"` recovers the legacy pairs).

## Addendum 4 (2026-07-26): FOREST_LOCK built — capacity responds, the PAINT does not

The field-side half of LAND_CLEAR_METAL (T.FOREST_LOCK, popField.js): the
countryTerritory forest signal (moist 0.38–0.58 band × not-floodplain) locks
that share of a tile's CROP capacity until the administering settlement's own
metallurgy crosses LAND_CLEAR_METAL; pasture floors it; wild land has no
axes; the arid cradles carry no signal. Byte-identical at 0 (hashbase pair
4a956f14/2a8e6fce verified unchanged). Mechanically correct — and the A/B
(8817 × 16k, lock 0 vs 0.8) shows it is NOT the fix for the observed
stone-age sprawl: Europe pop −10 % at 16k (the moisture proxy reads mean
Europe as only ~40 % canopy, so the lock bites a third of capacity at most),
while CLAIMED Europe is unchanged (95 % vs 92 % at 12k) — because at 12k
Europe holds only ~11k people yet paints ~95 % claimed. **The "huge
stone-age nations" are not population-carried: they are the logistics-march
footprint of SPARSE realms.** The claim/march pacing at low technology —
how much paint a small-people, low-org realm may hold — is the actual
driver, and it is the next arc (countryTerritory growth target / march
component under SIZE_BY_POP), together with the known adoption-pricing
problem. Lever ships default-0: flipping it would claim a fix it does not
deliver. (If the canopy story is wanted for its own sake later, the forest
SIGNAL needs a real vegetation reading — temperate Europe at moist ~0.46 is
historically closed forest, not 40 % — but re-deriving a signal shared with
the state-formation bar is its own validated change.)

## Addendum 5 (2026-07-26): the sprawl's true site — the era-invariant span

Traced from addendum 4's finding (11k people painting 95 % of Europe at 12k).
Two compounding causes in the SIZE_BY_POP sizing stack (countryTerritory.js):
(1) the tiles-per-person anchor is CIRCULAR — `_sizePopK = median(spanEff ×
capacity × r2) ÷ median(governed people)`, i.e. calibrated from the capacity
target it is supposed to discipline, so a sparse young world's
capacity-generosity is laundered into a huge per-person ruler; and (2) the
deeper one: CAPACITY is deliberately era-RELATIVE (log of era-median-relative
power — correct for turnover), but the paint per capacity unit (`FIELD_SPAN`
= 6 tiles/unit) is era-INVARIANT — a stone-age chiefdom at org 0.15 gets the
same tiles-per-capacity as a rail empire. Absolute administrative technique
never enters the ruler, so the stone age tiles every biome with states.
**Fix (the cardinal rule's own RIGHT example — `reach = base + logistics ×
SCALE`): `T.SPAN_TECH` — spanEff ramps with the realm's ABSOLUTE admin tech
(capital organization/logistics): span = FIELD_SPAN × (SPAN_BASE +
(1−SPAN_BASE) × adminTech). A chiefdom paints its valley; the span grows to
the full 6 as statecraft matures; the industrial march/coverage arc above is
untouched.** Lever default 0 pending battery (Europe claimed% at 8–16k must
fall hard; late coverage must still rise with development; 3-seed stylized).

**Addendum 5 results (same day): SPAN_TECH BUILT, measured decisive on the
sprawl, default 0 — the flip is an OWNER call.** Byte-identical at 0
(hashbase 4a956f14/2a8e6fce verified). A/B (8817 × 16k): stone-age Europe
claimed 16→95→98 % (@8/12/16k) baseline vs **10→33→36 % at SPAN_TECH=0.85**
— two-thirds wilderness through the whole early game, filling as org grows,
with settlements/org/agri developing identically in both arms. THE fix for
"huge stone-age nations". But the stylized suite prices it: 3/3 hard-green
at BOTH doses, yet soft warnings rise 1→5 total (0.85: Zipf shallower on all
three seeds −0.52..−0.58, cradle-distance tech gradient washes out on two;
0.6 keeps only half the Europe win at the same warning count). This is a
genuine SHAPE TRADE, not a dose problem: smaller earned early realms
redistribute urban concentration and tech geography, and the suite encodes
the old shape. Per the ADOPT_ADMIN precedent (no flip with two seeds
at-budget and a new warning class), the default stays 0 until the owner
either accepts the new shape (and re-baselines the Zipf/cradle-gradient
facts to it) or asks for a narrower mechanism. SIM_TUNE="SPAN_TECH=0.85"
previews the earned-span world in any tool.
