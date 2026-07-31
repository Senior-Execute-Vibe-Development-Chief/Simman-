# Long-run report — Tier-A + Tier-B at depth (2026-07-28)

Companion to `user-report-diagnosis-2026-07-28.md` (the twelve complaints),
`tier-a-fixes-2026-07-28.md`, and `tier-b-waves-2026-07-28.md`. Those waves were
validated at 480/21–24k; this pass measures the assembled build (HEAD `22a3735`)
at the horizons and grid where the original regressions hid — a 50,000-step run
at the app-like grid plus three 24k mechanism probes — and reads the results
against each complaint, each wave's claim, and the "leaner-world reckoning"
residuals. Analysis only; no sim behavior changed.

## 1. The run

| instrument | grid (worldgen → sim tiles) | steps | seed | checkpoints | output |
|---|---|---|---|---|---|
| `tools/diag_full.mjs` | 960×480 → tw **480×240** (resScale 2) | 50,000 | 8817 | 10k/20k/30k/40k/50k | `longrun_960_8817.log` + JSON record |
| `tools/probe_empires.mjs` | 480×240 → tw 240×120 (resScale 1) | 24,000 | 8817 | 8k/12k/16k/20k/24k | `longrun_empires.log` |
| `tools/probe_successors.mjs` | 480×240 → tw 240×120 | 24,000 | 8817 | every 3k | `longrun_successors.log` |
| `tools/probe_hegemon.mjs` | 480×240 → tw 240×120 | 24,000 | 8817 | report 2k / sample 250 | `longrun_hegemon.log` (437 s wall) |

The 960 run sits between the calibration grid (tw=240) and the shipped app
(worldgen 1920 → tw=960): the closest look at app conditions any full-length
measurement has taken. The JSON record parsed cleanly — 5 checkpoints, 12
hall-of-fame rows, **zero** NaN/null/non-finite values.

Instrument caveats found while reading (kept in mind below):

- `diag_full` longevity is presence-sampled every 1,500 ticks: sub-sample
  lifetimes are invisible (dead-lifespan medians quantize to 1500), and a
  restoration counts as a fresh birth after a death. Its `oldestLiving` line is
  actually sorted by **peak members**, not age (the genuinely oldest living
  realms at 50k are #6 at 42,500 and #80 at 38,500 ticks, not the three shown).
- `probe_hegemon` prints the #1's share **of claimed land** as "% land".
- `probe_empires`' own header defines the counters: under default tile-war,
  capital falls log `polity.shattered`, not `settlement.captured` —
  `captured=0` does **not** mean war is dead; `shattered` is the realm-kill
  counter. `annexed` is peaceful member absorption.
- `diag_full` carries **no** food-composition, slave-income, colony/charter, or
  capture/annex channel — so complaints #2, #3, #7 and the flow question could
  not be re-measured at 50k with this instrument (gaps listed in §5/§6).

## 2. Per-complaint verdicts

Primary evidence 960/50k; 480/24k noted where it differs.

| # | complaint | verdict at depth |
|---|---|---|
| 1 | shrink leaves nothing behind | **IMPROVED.** Recede/lapse fully witnessed at depth (44 `polity.receded` + 44 `settlement.lapsed` at 480/24k, 0 silent — events ≥ net diffs at every checkpoint); 17 restorations, 12 of them in the back 40%. Residual: violent death still yields no successor — 19 shatters → **0** fragment successors, 0 secessions (victims are 1–3-member realms; R1). |
| 2 | fish dominates food | **FIXED at the measured horizon** (0.8–3.7% world share across 5 seeds at 21k, from 84–92%); **not re-measured at depth** — no food channel in `diag_full` (§6 gap). |
| 3 | slave trade top-3 everywhere | **FIXED at the measured horizon** (B4a: world slave-income share 14.5%→1.9%, >10%-realms 9→1, seller→demand distance 5.0→1.5 ref-tiles at 12k); **not re-measured at depth** (§6 gap). |
| 4 | not enough countries, esp. late | **IMPROVED, with number.** 960: 17→46→62→**96**→91 realms across checkpoints; births keep firing at depth (99 foundings in the 40–50k window). 480/24k: 65 and rising (pre-fix plateau was ~55). Residual: the entity atom still caps the ceiling — 195 settlements planet-wide at 50k, and entity supply does not scale with map area (§5 W4). |
| 5 | SE Asia / Caspian / N-Africa empty | **Mechanisms fixed (Tier-A), depth-unverified.** The run records no regional breakdown; with only 28.4% of land claimed at 50k, regional emptiness is currently dominated by the global fill residual (§4). Needs a regional channel in the deep instrument. |
| 6 | eternal, ever-growing nations | **IMPROVED — the headline depth result.** Pre-fix 960/50k: top-5 ages 29k–49k, same board every checkpoint, captured=0. Now: 5 of 6 top-board seats turn over between 40k and 50k; top-5 ages at 50k are 14k/15.5k/20k/38.5k/8.5k; cumulative deaths 180 (max dead lifespan 37,500 — a great power died); the 40–50k window is the run's first with deaths > births (104 vs 99). Residual: 480 back-40% tenure is borderline (§4). |
| 7 | colonies rare, short-lived, stateless | **REBUILT; depth signal positive, attribution open.** 960: realms with members spanning ≥2 landmasses 0→0→1→4→**9**, max span 7, seafarers 186/195, sea trade 10–19% of flow — overseas expansion arrives as navigation matures (30–50k). But at 480/24k colonization now produces **zero** events (post-Tier-A baseline had 3 `colony.independent`): the honest-pace world pushed colonization past that horizon entirely, and charter firing at honest learning rates is still unproven (B4b's in-vivo proof used accelerated learning). §5 W8. |
| 8 | spawn small → standard size → collapse | **IMPROVED.** No standard-size attractor at depth: 50k size spectrum median 66 / p90 284 / max 525, gini 0.52, max/med 7.95 (peaked 10.94 at 40k) — a continuous spread, and growth tracks own development (B2). Dead-lifespan median 1500–4500 says the realms that die are infants, not the growers. |
| 9 | Bronze leader ⇒ everyone grows | **FIXED.** `_sizePopK` deleted (B2); at depth, claimed land is strictly monotone at all 10 checkpoints across both grids (960: 0.05→0.64→3.61→14.18→28.41% of land; 480: 0.6→1.6→3.3→5.7→8.9%) — no cohort jump, no breathing, size gini stable 0.41–0.54. |
| 10 | strangely shaped countries | **Fixed per Tier-A's own measurements; depth-unverified** (no shape metrics in the deep instrument). Indirect: multi-landmass *claim* spans fall 86→81 in 40–50k while *member* spans rise 4→9 — claims consolidate around real presence; nothing contradicts A2. |
| 11 | roads too long too early | **FIXED per A6** (walked-length cap; longest early path 17.6 ref-tiles). Depth: the road stock grows with development (1,327→4,035 tiles by 40k, then −2% in the war window) with no early continental spike in the aggregate; `maxBuildPathLen` is not in the deep record (gap). |
| 12 | no power gap between techs | **BUILT (B4c); expression at depth is real but unattributed.** A mixed-era world exists to express it (40k: Bronze 44 / Classical 62 / Medieval 51 settlements), and realm deaths surge exactly in the widest-spread window (76→180 over 40–50k). But no instrument records war outcomes by era gap, and every track's med≈max at every checkpoint (e.g. metallurgy 0.75/0.78 at 50k) confirms diffusion still homogenizes *connected* neighbours — gaps live at contact frontiers between separated blocs, as designed. |

## 3. Deep-horizon findings

### 3.1 The industrial transition does NOT arrive by 50k

Era composition of settlements (960):

| step | Stone | Bronze | Classical | Medieval | Renaissance | Industrial |
|---|---|---|---|---|---|---|
| 10k | 53 | 24 | 0 | 0 | 0 | 0 |
| 20k | 6 | 80 | 0 | 0 | 0 | 0 |
| 30k | 3 | 82 | 12 | 0 | 0 | 0 |
| 40k | 3 | 44 | 62 | 51 | 0 | 0 |
| 50k | 0 | 4 | 14 | 87 | **90** | **0** |

The leading edge lands one era per ~10k steps after Bronze; Renaissance arrives
in the 40–50k window. The binding gates at 50k are **metallurgy** (max 0.78 vs
0.85 for steam power, 0.92 for steel) and **organization** (max 0.69 vs 0.85
for scientific method, 0.88 for industrialism) — construction is already 0.97,
past every Industrial construction gate. At the last-window pace (+0.13–0.14
per 10k on those tracks) the Industrial leading edge extrapolates to roughly
**55–65k steps**. Extrapolation, not measurement — but the direction is
unambiguous: at the app-like grid, a 50k run is still a pre-industrial world.

### 3.2 The honest-lean population: no catch-up test possible, and growth is decelerating

| step | pop | ×prev | urban % | wealth | wealth/head |
|---|---|---|---|---|---|
| 10k | 4,135 | — | 17.99 | 285,350 | 69.0 |
| 20k | 6,161 | 1.49 | 40.40 | 319,502 | 51.9 |
| 30k | 19,061 | 3.09 | 26.78 | 407,627 | 21.4 |
| 40k | 61,338 | 3.22 | 14.02 | 680,359 | 11.1 |
| 50k | 117,084 | **1.91** | 10.84 | 1,081,672 | **9.2** |

B3's claim was "the honest pre-industrial world is leaner until industry
arrives." Industry never arrives (§3.1), so the catch-up is untestable inside
this horizon — and the growth-ratio series peaks in 20–40k then **decelerates**
to ×1.91 exactly as construction saturates (0.95) with fertilizers/mechanized
farming still locked: the pre-industrial ceiling visibly re-binding, which is
the Malthusian shape the wave intended. Urbanization ends at 10.84% — the
historically sane pre-industrial figure (its 40% spike at 20k is a
small-denominator artifact, §5 W9). The wealth column is a finding of its own
(§5 W3).

### 3.3 Late-game consolidation begins — and the leaderboard turns over

Per-window flows (960): born 40/25/87/99, died 11/9/53/**104** across the four
windows — death accelerates ~10× from the 20–30k window to 40–50k, and the last
window is the run's first with net realm loss (96→91) while claimed land
doubles (14.18→28.41%) and mean realm size goes 57→121 tiles. Top-6 board
persistence between checkpoints: 1/6 (20k→30k), 3/6 (30k→40k), **1/6**
(40k→50k) — the 30–40k #1 (#35, age 25,500) is off the board at 50k. Eleven of
the twelve hall-of-fame realms are alive at 50k, but their ages (8.5k–42.5k,
median ~18k) are a living churn, not the frozen 29k–49k gerontocracy of the
pre-fix run. B2's promise — coverage rising with development, no breathing —
holds at every checkpoint on both grids, and the hollow-realm detector reads 0
under-populated big realms at all five checkpoints (big-realm claim density
10.6–15.0 pop/tile).

### 3.4 The successor economy keeps firing at depth (480/24k)

- **Witnessing holds:** 44 `polity.receded` + 44 `settlement.lapsed` events
  against 16 net per-tick lapse diffs — events ≥ diffs at every checkpoint
  (the surplus is same-pass lapse-and-readoption, invisible to the diff). The
  B1 acceptance direction (no silent lapse) survives 24k steps.
- **Restorations keep firing:** 17 over the run, 12 in the back 40%, all with
  verified name/id continuity (2 n/a), all via the **ground/reconcile**
  channel. The shed economy stays busy: 762 tiles released over 166 passes
  carrying 4.62M popField person-units, 7 with towns standing.
- Two designed channels are silent at depth: the **nucleation-restoration
  gate never passes** — all 24 memory-bearing frontier foundings log
  `viable=false` with `domW·f2c` (1–40) one to three orders below the bar
  (222–1288) — and **fragmentation/secession never fire** (19 shatters → empty
  successor table; 0 secessions). §5 W5–W7.

### 3.5 Fish, slavery, charters at depth: instrument gaps

None of the three is measurable in these inputs. Nearest evidence: fish 0.8–3.7%
at 21k (closing battery), slave income 1.9% at 12k (B4a), charters proven only
under accelerated learning (B4b). The deep run *cannot* confirm these hold at
50k — extending `diag_full` with those channels is follow-up #5 (§6).

## 4. The territory-fill residual, quantified

The claimed-land trajectory at both grids:

| | 8k | 10k | 12k | 16k | 20k | 24k | 30k | 40k | 50k |
|---|---|---|---|---|---|---|---|---|---|
| 480/24k (% land) | 0.6 | — | 1.6 | 3.3 | 5.7 | 8.9 | — | — | — |
| 960/50k (% land) | — | 0.05 | — | — | 0.64 | — | 3.61 | 14.18 | 28.41 |

- **Same step, 9× apart:** at 20k the 480 grid has claimed 5.7% of land, the
  960 grid 0.64%. At 10k the 960 planet holds **20 claimed tiles total**
  (median realm = 1 tile) — the app-like early game is a world of dots for
  ~10k+ steps.
- **Same development, still ~2.5× apart:** at comparable organization
  (med ~0.33 at 960/30k ≈ capital org 0.32–0.37 at 480/24k) the shares are
  3.61% vs 8.9%. Fill lags development harder as resolution rises — the
  EXPAND_RATE/POP_FILL scale audit the reckoning already assigned is confirmed
  as resolution-sensitive, not just pace-sensitive.
- **The no-contact phase:** 960 shows **zero realms at war at both the 10k and
  20k checkpoints**; war only arrives with fill (4 realms/8 fronts at 30k → 9
  realms/10 fronts at 50k, exhaust max 0.48). At 480 the same phase ends
  sooner and then compounds: `war.began` per 3k window runs 9/7/15/22/42/**74**
  — war candidate supply is a function of claimed density, exactly the B3
  reckoning's root-cause (this run adds: growth is super-linear once contact
  exists). Late claim growth at 960 still doubles per 10k window
  (×12.35/×5.66/×3.93/×2.00), leaving **71.6% of land stateless at 50k**.
- **The flow deadness, read correctly:** at 480/24k, `captured=0` and
  `annexed=0` across all five checkpoints, and every top-5 realm shows
  `gained: war=0 absorb=0`. Per the probe's own header, `captured=0` is
  expected under tile-war (capital falls log `shattered`, which reads 19 —
  war DOES kill realms). What is genuinely dead is **member transfer between
  living realms**: no settlement ever changes hands by capture or peaceful
  absorption in 24k steps. Conquest at this grid is purely lethal-or-nothing.
  (The successors probe still counts 35 realm→realm member flips — all via
  ground re-derivation or polity-level events, none witnessed by a
  settlement-level event; §5 W7.) The 960 run has no flow instrument — running
  `probe_empires` at 960/30k+ is follow-up #4.

**The hegemon reading, honestly.** Back-40% tenure at 480/24k: modal holder
Sasfesučeef **69%** of samples, longest unbroken hold 3,500 steps = **36.5%**
of the window, 3 changes. Against the B5 resume trigger ("back-40% modal share
≳ 70% **with** an unbroken hold ≳ ⅓ of the window, **or** a falling late-game
mortality gradient"): the hold arm passes, the modal arm misses by one point,
so the conjunction fails — borderline, and markedly closer than the post-Tier-A
baseline (49%/49.5%). The mortality arm, however, must be read from events, not
the probe's registry scan: the printed "flat 0.25/0.25 deaths/1k" is an
**artifact** — `mortality()` scans live `endedStep`, and 12 back-window
restorations re-open records, erasing their deaths retroactively. The
append-only event tally says 11 endings in the front 60% vs 14 in the back 40%
(0.76 → 1.46 deaths/1k): **rising ~1.9×**, not flat — the opposite of the
ossification signature. And the causal read is unchanged from the baseline: the
#1 realm has 1–3 members and **zero provinces** at every sample
(maxProv/throne 0.00, ambition 0.00), holds only 7.5–17.5% of *claimed* land ≈
≤1.6% of actual land, and reigns because contact starvation means no rival can
take anything from it. `ELITE_FRACTURE` would have no material to act on; the
correct lever is territory fill/contact, and the trigger's own protocol (re-run
`probe_hegemon` at 960/30k+) has still not been executed — the deep run used
`diag_full`, which does not measure tenure. Do that before any B5 decision.

## 5. Watch items (new — nothing below is recorded in any prior doc)

1. **`world.personalities` has no writers — a live sim input and the deep
   instrument both read a dead field.** The entities refactor moved
   temperament onto polity records (`pol.personality`), but
   `countryTerritory.js:1083` still reads `world.personalities` for the
   claim-budget multiplier — so `persMul ≡ 1` and `CLAIM_PERS_SPAN = 0.25`
   (±25% claim pace at the expansionism poles) is a **dead lever in the live
   sim**. `tools/diag_full.mjs:66,182` read the same ghost: every PERSONALITY
   line in the 50k run is `?:N` with all big-vs-small traits 0/0. One-line fix
   each (`personalityOf`), high value: personality currently has no effect on
   territorial expansion at all.
2. **Restoration-blind mortality accounting.** `probe_hegemon.mortality()`
   (and any `endedStep`-scan) undercounts deaths in a restoration-rich regime;
   this run caught it contradicting its own event tally (0.25/0.25 printed vs
   0.76→1.46/1k by events). The leaner-world reckoning flagged the
   fallen-lifespan/Zipf class; this extends it to the **B5 trigger's mortality
   clause itself**. Death/lifespan series must come from append-only events.
3. **Per-capita wealth falls ×7.5 across 40k steps of development** (69.0 →
   9.2, §3.2 table) — anti-historical in direction. Early Stone-age hamlets of
   17–33 people hold 16.5–21.7k coin (richest realm 21,742 at 10k, ~1,000
   coin/head); at 50k one 4-member realm (#6, the run's oldest at 42.5k ticks)
   holds 193,484 — **18% of world wealth**. Plausibly a Venice; but the
   monotone per-head decline suggests early accumulation without sinks and/or
   production that fails to scale with population. Deserves a conservation
   audit.
4. **Entity supply does not scale with map area.** ~90 settlements at step 24k
   on both the 240-tile and 480-tile grids — the same entity count on 4× the
   area; 195 by 50k. Every entity-quantized density (realms, seats, road
   endpoints) is ~4× sparser at the app-like grid, and the shipped grid is 4×
   larger again. This is R1's atom acquiring a resolution dimension no prior
   doc quantifies — likely crystallize pacing, and probably the deepest lever
   behind §4.
5. **Restoration ping-pong.** 17 restorations cover only 10 polities; "Hu" is
   restored **5×** (re-dying after 4 of them) inside ~5k steps; 7/17 events are
   re-restorations of the same marginal statelet. The mechanism is correct
   (names/ids/chronicles verified) but oscillates at the viability margin —
   wants hysteresis or a re-founding cost.
6. **The B1 nucleation-restoration gate is dead in practice** (§3.4): 24/24
   memory-bearing foundings fail `viable` by 1–3 orders of magnitude. Either
   the `f2c` scaling makes the designed clause unreachable, or the clause is
   redundant with ground/reconcile — decide which, and either fix the scale or
   delete the dead gate.
7. **Member transfers remain unwitnessed.** 35 realm→realm member flips at
   480/24k with zero `settlement.captured`/`annexed` events (post-Tier-A
   baseline: 15). No event class covers a settlement changing realm by ground
   re-derivation — the last silent transition class left after B1.
8. **Colonization at 480/24k went 3 → 0 events post-B4b.** Consistent with
   honest-nav pacing plus the leaner world (COLONY_MIN_POP vs leaner ports),
   but it means the standard validation horizon now exercises the colonial
   machinery **zero** times — it is only testable at 960/30k+ or under
   accelerated learning. A stylized gate on "colonies eventually exist" would
   currently pass on silence.
9. **Urbanization spike artifact:** 40.4% urban at 20k in a 6,161-pop world,
   settling monotonically to a historically sane 10.84% at 50k. Real pattern +
   small-denominator spike; worth knowing when reading the app panel early.
10. Mild late-window declines — road tiles 4,035→3,951, sea-trade share
    19.3→13.4%, multi-landmass claim spans 86→81 (40k→50k) — all plausibly
    war/consolidation effects. Watch, not alarm. Also: hall entry **#140**
    (peak 6 members / **1 tile** / lifespan 3,000, born ~30k with 6 members and
    age 0) — evidence a multi-member successor can be minted effectively
    landless and die young; find the minting channel.

## 6. Verdict and follow-ups

**Verdict.** The build survives depth. Of the twelve complaints: 4 fixed
outright at their measured horizons (#2, #3, #9, #11), 5 improved with the
deep run adding the decisive evidence (#1, #4, #6, #8, #12 — above all #6: the
immortal-empire regime at 960/50k is measurably broken, with full top-board
turnover and the run's first deaths-over-births window), and 3 mechanically
rebuilt but depth-unverified for lack of instrument channels (#5, #7, #10).
No wave's claim reversed at depth; B2's coverage-monotone promise holds at all
ten checkpoints on both grids. The two structural residuals both trace to one
root pair: **territory fill lags development (and lags harder as resolution
rises)**, and **the entity atom does not scale with area** — together they
produce the no-contact early era, the member-flow deadness, the borderline
hegemon tenure, and the still-sparse app-scale map. The deep run also caught
two instrument defects (dead personality reads; restoration-blind mortality)
that were silently shaping conclusions.

Prioritized follow-ups:

1. **Territory-fill pacing audit in the post-B3 regime** (already the
   reckoning's top item; now with cross-grid numbers: 2.5× behind at equal
   development, 9× at equal step, 71.6% of land stateless at 50k). Scale-audit
   EXPAND_RATE/POP_FILL/coverage the way tiers and forts were audited.
2. **Rewire the dead `world.personalities` reads** (countryTerritory.js:1083 +
   diag_full) through `personalityOf` — restores a designed emergent input
   (expansionist realms claiming faster) and un-blinds the instrument. (W1)
3. **Event-based death/lifespan accounting** everywhere (probes + stylized
   measurement constants), replacing `endedStep` scans; then re-derive the
   Zipf/fallen-lifespan bands as already assigned, and re-read the B5 mortality
   clause from the honest series. (W2)
4. **Run `probe_hegemon` + `probe_empires` at 960/30k+** — the B5 trigger's own
   protocol, still unexecuted. No ELITE_FRACTURE decision before this; the 480
   reading (69%/36.5%, rising event-mortality, zero provinces on the #1) says
   the tenure length is contact starvation, not suppressed fracture.
5. **Extend `diag_full`** with food composition, slave-income share,
   colony/charter tallies, and capture/annex flows so the next deep run covers
   #2/#3/#7 and the flow question at depth instead of inheriting 21k verdicts.
6. **Entity-supply-vs-area audit** (W4): why does a 4×-area world crystallize
   the same ~90 settlements by 24k? This bounds every other density at the
   shipped grid.
7. **B1 polish batch:** nucleation-gate reachability or deletion (W6),
   restoration hysteresis (W5), landless-successor guard (#140, W10),
   a witness event for ground-re-derivation member transfers (W7).
8. **A continuation run past the industrial threshold** (~55–65k projected):
   continuous, not resumed (resume is not trajectory-identical per the Tier-B
   baseline), to test the leaner world's population release when industry
   lands — the one B3 claim no existing horizon can reach.
