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

Next instrument (one run): sample the 19 dead anchors' final 2,000 steps —
`_fedM`, `_coreNeed`, `_foodSupply`, `_terrTiles`/`_terrWorkTiles`,
`_famineUntil` windows, `_diseaseLoad`, catchment census — and decompose the
melt into those four terms. The fix is whichever term the decomposition
convicts; per the second cardinal rule, none of them gets a patch until then.

## Relation to the confetti thread

Same root, one level down. The confetti war fixed who *born cities* belong to
(BORN_OF_LAND), what a member *costs* (SEAT_ADMIN), where cities may *stand*
(FOREST_LOCK/CANOPY_CLASS). This measurement says the remaining churn is fed
from below the political layer entirely: the register mints faster than the
basin can feed, the surplus dies, and every polity built on that sand churns
with it — realms included, Egypt included. The two owner-visible complaints
("micro-nations flicker" and "the big realm never lasts") are the same
conveyor observed at two altitudes.
