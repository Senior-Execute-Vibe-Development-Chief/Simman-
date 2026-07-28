# Tier B — the mechanism waves (2026-07-28)

Companion to `user-report-diagnosis-2026-07-28.md` (the diagnosis) and
`tier-a-fixes-2026-07-28.md` (the broken-as-built wave). Tier B built the
missing MECHANISMS. Process per wave: design agent → committed design doc →
worktree implementation against the design → smoke + stylized between every
landing → wave batteries. Designs: `design-successor-states.md`,
`design-size-target-regrounding.md`, `design-food-economy-wave.md`, and the
baseline `tier-b-baseline-2026-07-28.md`. All measurements 480×240 unless
noted; per-wave detail lives in each commit body.

## B5 — deliberately NOT built (the trigger was measured first)

The parked `ELITE_FRACTURE` blueprint (hegemon-ossification doc §6) carries
an explicit resume trigger. Re-measured on post-Tier-A HEAD: back-40% modal
share 49% (< the ~70% bar) and late-game polity mortality RISING ~10.6× —
the opposite of ossification. The measured problem was **successor
poverty**, not lock-in: every capital-storm shatter erased a 1–2-member
realm outright, zero fragment successors, zero secessions, restorations
only by id-collision accident. Per the blueprint's own rule, nothing was
built; B1 is the targeted answer.

## B1 — Successor states (`T.SUCCESSOR_STATES`, def 1)

Three pieces: (1) restoration from the ground — a wilderness founding whose
basin's homeland memory points ≥2/3-uncontested at an ENDED polity, whose
remembered mass alone clears the founding bar, and whose ground is still
peopled ≥1/2 by the old nation's culture-descendants, REOPENS that polity
(same id/name/hue/chronicle) instead of minting a fresh id; (2) secession
and fragmentation seat from the label-free provincial-seat concept
(`_provinceCity`) instead of the pinned city label, with a ≥2-member
anti-confetti fold; (3) the silent populated shed became witnessable
(`polity.receded`, `settlement.lapsed` events; `resolveOrphanedMarches`
gives an orphaned march its restoration/secession chance before wilderness).

Measured (12k, seed 8817): silent lapses 12 → **0**; restorations 1 → 4
(all verified continuity; contested-memory and wrong-people basins
correctly refused); realm trajectory unchanged (44 vs 43 — no confetti);
byte-identical at lever 0. Battery 3/3.

## B2 — The size target sheds the global median (`RURAL_BIND_DENS`)

`world._sizePopK` — the live planet-wide median tiles-per-person that made
every realm's territory target jump ×11.2 the window the leading civ
entered Bronze, and oscillate over a 20× band — is deleted. A realm's
population core is now `govPop × spanTechMul(own) / RURAL_BIND_DENS`
(8000 people per reference tile — a fixed physical density a pre-modern
state can bind, swept 5000/8000/12000 × 2 seeds; outcomes scale smoothly,
no cliff). Acceptance tests: **Bronze-jump PASS** (own-state-unchanged
realms max move ×1.03 vs 38 offenders up to ×8.76 before) and
**oscillation PASS** (Σtarget window ratio ≤×1.28 vs ×11.57; coverage
monotone with development, breathing gone). Save-compat: `sizePopK: 0`
written one format generation. Battery 3/3.

## B3 — The food economy coupled wave (maturity + fishing cost + bars)

- **Land-food maturity:** the fitted `_eraProd = 1 + 260·agri⁶·devGate`
  overlay is retired (`ERA_PROD_SCALE` 260→0; legacy arm byte-identical).
  Productivity is now BUILT: `(1 + LAND_WORKS × worked-land works mean) ×
  indCap` — the Boserupian works field wired into the food ledger, genesis-
  neutral, classical leading edge ~4.9× (inside the historical 3–6× band),
  industrial break where industrial tech lands.
- **Fishing costs:** fisher labor share (withdrawn from land work),
  depletable-renewable per-coast stocks (Schaefer form), per-capita catch
  re-anchored to the historical per-fisher yield; `FISH_RATE` retired.
  The Tier-A demand-gap gate stays as the effort throttle.
- **Bars:** `TIER_SCALE_REF` retired for percentile rank bars
  (town = max(60, P50), city = max(240, P85)).

Measured: fish at the 21k horizon **4.5%** (from 19.3% post-Tier-A and ~84%
pre-Tier-A), majority-fish population 4%; the 80–100%-fish port class gone;
real fishing towns persist as a class. THE REGIME CHANGE: 21k population is
~0.2× the pre-wave figure — the retired overlay was paying a ~20×
carrying-capacity anachronism by 21k; the honest pre-industrial world is
leaner until industry arrives. A/B arms reproduce the old world exactly at
every checkpoint. Battery: 3/5 seeds in soft budget, no hard failures
anywhere, exit 0 (majority rule); the two over-budget seeds trip
quiet-world bands — see "the leaner-world reckoning" below.

## B4a — The coffle pays the toll (`T.SLAVE_FREIGHT`, def 1)

Slave clearing is now pairwise over the real road+sea network THROUGH
`sellGoods` itself — freight, transit tolls, entrepôt brokerage, import
duty, ship-worthiness, at silk-class value density; greedy nearest-first
matching; unsold stock strands. The craft channels unbundle
(IN_ORE/METAL/CLOTH/WARES) at the booking site. Measured (12k): world
slave-income share 14.5% → **1.9%**; realms >10% slave income 9 → 1;
income-weighted seller→demand distance 5.0 → **1.5 ref-tiles** (92% of
slave income within 4); market scarcity p50 115 → 2.7, the price-cap pin
class gone. Byte-identical at lever 0.

## B4b — The charter: colonization as a state project

A realm with sea-capable ports, a chest that can fund an expedition and
still cover its working capital, admin headroom, and a live motive
(crowding ≥0.70 of its own capacity, or the spice-quest) SPONSORS its
best-positioned port across all its ports — treasury→ship→colony conserved.
Metropole death no longer mass-liberates: dependencies follow the recorded
succession chain (`colony.inherited`) or are chronicled free
(`metropole-fell`). Measured in vivo (24k, accelerated learning on both
arms): charters fire from great powers (founders' median 384 owned tiles /
14k treasury vs 183 opportunistic); rich-but-uncrowded realms correctly
stay home (the Ming pattern, emergent). Byte-identical while inert.

## B4c — Revolutions multiply; the fortress learns the age's scale

- **Tech power** (`T.MIL_REVOLUTIONS`, def 1): armament revolutions
  multiply (obsoleting the prior system is a ratio, not an increment);
  incremental techs still add. Equal-population force ratios, before →
  after: bronze→iron 1.31 → **1.84**; medieval→pike-and-shot 1.07 →
  **1.97**; musket→rifled 1.06 → **1.75**; full gunpowder over iron 1.16 →
  **2.72** (clears a defended river); iron→rifled 1.23 → **4.76**
  (Plassey-class only at 2+ revolutions). Gunpowder's one-shot wall debit
  becomes an era-spread channel: adopting guns is now net-positive (×1.18,
  was ×0.89 — the own-goal). Diffusion untouched: gaps express in the
  window they exist and across hard capability gates, which is historical.
  Emergent bonus: the steppe age ENDS — muskets finally out-fight the horde.
- **War scale** (`T.FORT_GARRISON_REF`, def 0 = scale-honest): the audit
  found the legacy fortress/basing absolutes (garrison-of-40, base-of-5)
  were DEAD LETTERS at the honest population scale (zero qualifying bases
  for the first ~9k steps). They now derive from the live garrison
  distribution (P85, with the legacy share preserved as the base ratio).
  Fortress lines and forward bases exist from antiquity on; on 8817 wars
  became fewer and weightier (fronts stall at manned works — designed).

## The leaner-world reckoning (open, assigned)

B3's honest scale exposed quiet-world reads on two seeds (4242, 777):
- **War-rate band (0.02 vs floor 0.05) on 4242 — root-caused, not a war
  constant:** `probe_warbars` attributes it to CANDIDATE STARVATION — 57
  realms holding ~240 claimed tiles have almost no shared borders, so war
  finds no pairs before ~6–9k. This is a **territory-fill pacing question
  in the post-B3 regime** (the EXPAND_RATE/POP_FILL/coverage constants
  deserve the same scale audit tiers and forts got) — the top recorded
  follow-up, deliberately not patched by cutting war bars.
- **Zipf's absolute "50-urban" city floor** and the **fallen-lifespan
  accounting** (restorations re-open records, thinning "fallen" below
  computability) are measurement-layer constants calibrated to the old
  scale — re-derive them WITH the territory-fill follow-up, against the
  same standing bands, documented; never quietly.

## Validation state at Tier-B close

Every wave: smoke green (determinism, invariants, save/load identity),
byte-identity lever proofs, stylized between landings. Wave batteries:
B1 3/3 · B2 3/3 · B3 3/5 (0 hard failures; majority rule; quiet-world
artifacts above) · B4 closing 5-seed battery recorded below.

Closing 5-seed battery (assembled Tier-B HEAD): **3/5 seeds within soft
budget, ZERO hard failures on any seed, exit 0** (the suite's majority
rule). Fish share 0.8–3.7% on all five seeds (from 84–92% at diagnosis).
8817/31337/12345 pass at 2/2/2 warnings; 4242 and 777 exceed budget on the
quiet-world classes alone (war-rate 0.02–0.03 vs floor 0.05; Zipf/lifespan
n/a) — the root-caused territory-fill follow-up above, not a war or food
defect. War rates on the passing seeds sit at 0.05–0.08 with weightier
wars (fronts stalling at manned fortress lines, as designed).
