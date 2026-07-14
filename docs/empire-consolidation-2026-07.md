# Too few / too large / half-empty — measured diagnosis + the comboE fix (2026-07)

Continuation of `country-count-size-diagnosis.md`. User report (still true on HEAD):
early realms too large/spread for the bronze age; mid-late **too few, too large**;
late game **never claims all the land** (and coverage even *retreats*). This doc
records what actually drives it, what does NOT move it (with evidence), the
measurement gotchas that cost us, and the value-lever combination that fixes all
three axes while KEEPING amphibious war — validated against the stylized gate.

All numbers: app-identical pipeline (`tools/_harness.mjs buildSim`), seeds 8817 +
4242, 480×240 unless noted. **The metric is windowed** (see gotchas).

## The measured shape (HEAD, `tools/diag_full.mjs`, 960×480, seed 8817)

| step | countries | claimed (land) | top realm | note |
|-----:|----------:|---------------:|----------:|------|
| 3000 | 9 | 2.8% | 309 t | bronze; realms already span ≥2 landmasses |
| 25000 | 24 | 26.9% | 2036 t | peak count |
| 35000 | 21 | 46.1% | 3994 t | industrial transition; peak coverage |
| 50000 | **14** | **29.4%** | 3438 t | consolidated + **coverage RETREATED** |

Top-5 realms are **immortal** (ages 29k–49k in a 50k run); the hall-of-fame top is
all-alive. `probe_empires` flows: `captured=0` the entire run (the TILE_WAR rarely
storms a capital — the only way a realm dies), consolidation is all peaceful
`annexed`; hundreds of small realms `shattered`/`ended` while the giants never fall.

## Root cause (rigorous): AMPHIBIOUS WAR

Windowed, 2-seed test (`probe_avg.mjs`), what robustly moves the realm count:
- suppress peaceful absorption (`ABSORB_ORG_MIN=0.95,ABSORB_DOMINANCE=5,ABSORB_FORCE=12`):
  **no effect** (19→17). Not the channel.
- amphibious OFF (`AMPHIB_BAR=0`): **19→26 realms, coverage 22%→38%** on both seeds.
  THE channel.

Bisect (matched-development, `git worktree` per commit) pins the regression to
**`d991e11` "Amphibious war restored under tile-war"** (count-at-agri≥0.9 26→16),
with latifundia (`49bc43b`) and deditio (`faacd87`) contributing; Ontology V2 and
the chronology "compounding returns" only shifted *timing*, not the equilibrium.
Amphibious lets a strong realm invade across water anywhere its ports can sail
(`armies.js` ~790), so sea-protected coasts/islands fall → the sea stops
fragmenting the map → over-consolidation + the coverage-retreat (dead realms'
land is RELEASED to wilderness, `countryTerritory.js:551/605`, not handed to the victor).

## What does NOT work (all measured, so we don't retry it)

- **Every *multiplicative* gate is inert** because a giant governs 10–20× any
  neighbour and overwhelms any ratio: `AMPHIB_BAR` magnitude (1.8/3/5 all ≈ same;
  only 0 helps), `ABSORB_*`, and a built-then-reverted **amphibious distance-decay
  (`AMPHIB_REACH`, commit reverted)** — decaying the invading army by sea distance
  did nothing (giants clear the bar even at 0.17× strength; and the over-consolidation
  is from SHORT-sea hops anyway, which decay barely touches).
- **`CAP_DOM_MAX` (hegemon ceiling)**: inert — dominance sits below the ceiling.
- **`FIELD_SPAN` down**: DOES shrink giants (8.5M→3.1M km²) but the over-target shed
  dumps land to **wilderness** → map empties, count drops. (The shed pins home/worked
  tiles, so absorbed realms sit at 260–380% of target and never shed by it.)
- **A built-then-reverted `AREA_LOAD`** (land area draws hold-capacity): inert — the
  extra secession it creates is re-absorbed by the same giants.
- `ADMIN_HALF` down, `EXPAND_RATE` up *alone*: make it WORSE (realms collapse / the
  hegemon grabs the fill).

Single levers each fix one axis and break another; **none is a silver bullet.**

## THE FIX — a value-lever COMBINATION (comboE), amphibious kept ON

| lever | default → comboE | role |
|---|---|---|
| `FIELD_SPAN` | 12 → **6** | caps giant size |
| `COVER_ORG` | 150 → **260** | fills the map via SMALL realms' hinterlands — the giants are capacity-bound and sit ABOVE the floor, so this grows the small realms, not them (this is the key that breaks the shrink-vs-fill tension) |
| `EXPAND_RATE` | 1.5 → **8** | frontier fills faster → coverage |
| `REGION_SPACING` | 1.2 → **1.0** | more settlement seats → more realms |

Measured (windowed 16k–30k, both seeds), amphibious ON:
- realms 19/19 → **20/29**, coverage 22/25% → **30/38%**, biggest 9.4/10.1 → **7.3/7.3 Mkm²**.
  Every axis improves on both seeds; none regresses.
- 960 single render @32k: **34 realms, 58.5% claimed** (baseline ~14–26 / 29–46%).
- **Stylized gate (480/21k, seed 8817): ALL hard gates pass, 1 soft warning (budget 2);
  largest-empire share 10%** (baseline 26% — comboE is MORE historical), Zipf −0.87,
  fallen lifespan ~824y, urbanization 10%. So it's not a hack — it stays history-shaped.

Set `SIM_COVER_ORG=260 SIM_TUNE="REGION_SPACING=1.0,FIELD_SPAN=6,EXPAND_RATE=8"` to reproduce
on a pre-flip build. **comboE is now the shipped default** (see PACKAGED below), so on
current HEAD a plain run IS comboE.

## MEASUREMENT GOTCHAS (these cost real time — read before measuring)

1. **The country count is a volatile attractor: it swings 12→31 within a single run.**
   Single-step / single-seed comparisons are NOISE and repeatedly gave OPPOSITE
   conclusions two steps apart. **Always use the windowed multi-seed mean**
   (`tools/probe_avg.mjs`, samples 16k–30k). This is the single most important lesson.
2. **`FIELD_SPAN` was NOT in the tuning schema**, so `applyTuning`/`SIM_TUNE` silently
   ignored it (`applyTuning` does `if (!(k in DEFAULTS)) continue`). Now exposed
   (commit on branch). Any lever you sweep via `SIM_TUNE` MUST be in `TUNING_SCHEMA`.
3. **`COVER_ORG`/`COVER_BASE` are live levers now** (exposed while packaging comboE —
   set via `SIM_TUNE` like everything else). The `SIM_COVER_*` envs still work and
   FORCE-override the levers in headless runs. (Historically they were env-only consts
   that `SIM_TUNE` silently ignored — the same trap as gotcha 2.)
4. **`buildSim({W:480})` → sim grid `tw=240` (tileRes 2), so `NG = world.tw*world.th`,
   not `W*H`.** Iterating `W*H` reads phantom tiles (the 899%-claimed bug).
5. Later steps get slow (settlement/link count); a 960→50k run is ~10 min.

## PACKAGED (2026-07-13) — comboE is now the DEFAULT

- **`COVER_BASE`/`COVER_ORG` are live levers** ("Empire size & cohesion", def 25/260).
  The `SIM_COVER_*` envs still work and FORCE-override the levers for headless sweeps
  (the SIM_PERSIST_TERR pattern). Verified lever path ≡ env path: `SIM_TUNE=
  "COVER_ORG=260"` and `SIM_COVER_ORG=260` hash identically (d6eeee6e/d449827a on the
  pre-flip build), and the exposure alone at old defaults is byte-identical
  (83ccc922/574e8595, the documented pair).
- **The four defaults flipped**: `FIELD_SPAN` 12→6, `COVER_ORG` 150→260, `EXPAND_RATE`
  1.5→8, `REGION_SPACING` 1.2→1.0. Plain `node tools/probe_avg.mjs` now measures comboE.
  Reversible in one line: setting the four levers back
  (`SIM_TUNE="FIELD_SPAN=12,COVER_ORG=150,EXPAND_RATE=1.5,REGION_SPACING=1.2"`)
  recovers the pre-flip trajectory BYTE-FOR-BYTE (probe_hashbase 83ccc922/574e8595);
  the new-defaults pair is d8fc9f8f/bab1ad19.
- **Validation at the new defaults** (this session):
  - comboE reproduced via the env recipe first, both seeds, windowed 16k–30k:
    8817 → 20.4 realms [18–25] / 29.9% / 7.3 Mkm²; 4242 → 29.4 [23–34] / 37.7% / 7.3 —
    the numbers above, exactly.
  - **Stylized 3-seed (8817/4242/777, 480×21k): ALL hard gates pass; soft warnings
    1/0/0 (budget 2).** The one warning (8817) is the empire-area tail reading FLAT
    (largest/median 2.3) — the capped giants, the fix working, not a pathology.
    Largest-empire share 10/12/13%. Perf fine: ~190 s/run even three-concurrent
    (EXPAND_RATE 8 + spacing 1.0 don't blow the budget; 136–143 settlements at 21k).
  - **Smoke green** after replacing its one FITTED constant — the dissolve section's
    `settlements < 60` — with the measured legacy-model comparison it always meant
    (REGION_SPACING 1.0 makes 64 towns at 320, tripping the stale snapshot; the
    second-cardinal-rule fix is to measure the alternative, not re-fit the number).
  - Save/load roundtrip identity + determinism + invariants all pass at the new
    defaults (same smoke run).

## THE IMMORTAL-GIANTS FIX (2026-07-13) — WAR_REACH (force projection is LOCAL)

The follow-up session took the "deeper open question" and closed it. Measured diagnosis
first (probe_empires 24k, seeds 8817+4242, comboE defaults): the immortality is
OVER-DETERMINED —

1. Under TILE_WAR every combatant is a NATION adapter whose might is the WHOLE national
   army, so a realm defends (and attacks) every tile of its frontier at full strength
   simultaneously — nobody clears the front bar against a 10-20× giant ANYWHERE, so the
   top realms sit at zero defensive fronts (`captured=0` at every checkpoint; the same
   giants top every board with age == run length, while war shatters 265 SMALL realms).
2. Capture eats the periphery outermost-first (the anti-salient ring order), so a giant's
   capital is never even approached.
3. The storm gate is a national-ratio (`CITY_STORM_RATIO`) a dominant realm auto-wins.
4. The TILE_WAR adapter accidentally garrisons the capital's WALLS with the whole
   national pool (`homeMight(adapter)`), double-counted with the relief army — an
   adapter-refactor artifact contradicting the code's own intent comment.
5. The only non-war realm death (post-khan succession shatter) is nomad-only.

**The fix is the §4c-designed, never-built locality** (armies.js, `T.WAR_REACH`,
default 15): effective might at a battlefield = national might × **exp(−d/H)**, d =
distance from the realm's own capital, H = WAR_REACH ref-tiles (res-scaled) ×
(1 + 2.2·logisticsLevel) — the same roads→rail channel as administrative reach.
EXPONENTIAL, not hyperbolic: supply loss is per-march-day multiplicative, and at this
grid (a 10M-km² realm is ~600 tiles, rim ~14 tiles out) no hyperbolic tail can let a
modest power at its doorstep out-project a many-times-larger empire's far frontier.
Applied symmetrically at every war site: the front bar (both sides, per tile), the
countryside resolution (per-pair mean projection per side), amphibious landings (the
bar moves per-LANE → per-BEACH, so a giant's far coast decays like its far land rim),
attrition, and the STORM — fought at the capital's distance, with the fortress now the
capital's OWN garrison/militia/walls (fix for #4; rides the lever).

Measured (all windowed 16k–30k probe_avg + probe_empires 24k, 2 seeds; stylized 3-seed):

| | default (WR off) | WR=15 (shipped) | WR=8 |
|---|---|---|---|
| realms 8817/4242 | 20.4 / 29.4 | **29.0 / 36.9** | 33.5 / 33.0 |
| claimed | 29.9 / 37.7% | **41.9 / 44.6%** | 45.7 / 52.0% |
| biggest | 7.3 / 7.3M | **6.1 / 6.5M** | 4.7 / **8.2M** (regressed!) |
| top-5 at 24k | frozen, ages ≈ run | **churns — young realms reach #1** | churns |
| fallen @21k gate | 41 @824y | 32 @275y | 20 @176y (thin) |

- WR=15 improves EVERY axis on both seeds and the leaderboard finally turns over; war
  stays lethal. Stylized 3/3 seeds pass at 1 soft warning each (the flat empire-area
  tail — the capped giants themselves; same class comboE carries).
- WR=8: locality so strong that distance-blind PEACEFUL absorption becomes the dominant
  consolidator (biggest realm regressed on 4242) and death flows thin. Not shipped.
- The remaining longevity is the DEFENSIBLE-SIZE equilibrium: realms shrink to what they
  can militarily project over, and a compact realm at that size is legitimately durable
  (an Egypt/China, not a bug). True deaths still occur when exhaustion/insolvency/
  secession align — rarer, as in history.
- `WAR_REACH=0` recovers the projection-blind war byte-identically.

## 960 LOOP CLOSED (2026-07-13, follow-up session) — the shipped grid re-measured

Everything above was validated at the 480px probe grid (tw=240 = the res-invariance
reference). The audit's war-rate fix (×resScale² capture budget) deliberately changed
960 — war used to sweep real area at ¼ the validated rate there — and nobody had
re-measured since. This session ran the full battery at 960 (probe_empires 24k seeds
8817+4242 with map renders; probe_avg windowed **24k–40k** — see "window
correspondence" below; plus a current-HEAD 480 probe_empires for like-for-like flows).

### The measured 960 state (current defaults: comboE + WAR_REACH 15 + cities-only)

Windowed probe_avg (9 samples, 24k–40k):

| | 960 / 8817 | 960 / 4242 | 480 ref (16k–30k) |
|---|---|---|---|
| realms | 52.3 [48–56] | 47.3 [42–52] | 32.6 / 39.4 |
| claimed | 63.1% | 66.1% | 50.6% / 55.5% |
| biggest | **13.4 [6.6–17.2] M** | **14.7 [7.5–20.0] M** | 6.6 / 6.6 M |

probe_empires checkpoints (claimed% tracks 480 remarkably well step-for-step —
the war-rate fix works; the old "960 develops slower" belief was largely the ¼-rate
war itself):

| step | 480/8817 | 960/8817 | 960/4242 |
|---|---|---|---|
| 8k | 20 realms / 16.1% | 19 / 13.9% | 22 / 15.9% |
| 16k | 28 / 30.0% | 27 / 23.3% | 36 / 27.2% |
| 24k | 30 / 55.0% | 51 / 53.7% | 52 / 58.0% |

Top-5 churn at 24k is healthy at BOTH grids (960: #5→#1 jumps between checkpoints,
two ~8k-age realms in 4242's top-5; 480: two sub-11k-age in top-5). Both 960 map
renders look like political maps, not blobs. Old-snapshot context: pre-WAR_REACH 960
@32k was 34 realms / 58.5%; pre-comboE 960 was 21–24 realms with coverage
RETREATING by 50k. The new 960 beats both on count+coverage and shows no retreat
through 40k.

### Verdict per axis

- **Coverage ✓** — tracks 480 step-for-step to 24k, settles higher (63/66%), never
  retreats.
- **Churn ✓** — boards turn over with young realms at both grids.
- **Count ~** — elevated ~1.4× (47–52 vs 33–39), stable bands. Partly legitimate
  (finer grid resolves more small realms mid-shatter-wave), partly the residuals
  below (the fragmentation loop runs hotter: by 24k seed 8817 has 150 war
  realm-kills at 960 vs 26 at 480).
- **Biggest ✗** — the real divergence: through 24k the giants match (7.4/7.5M vs
  7.0M), then the LATE window grows runaway hegemons (17–20 Mkm² peaks, means
  ~2× the 480 equilibrium) on both seeds.

### Probe-semantics correction (recorded so nobody misreads the flows again)

probe_empires' `captured=` counts `settlement.captured` events — but under the
default TILE_WAR every storm falls on the defender's CAPITAL (the adapter's home)
and logs `polity.shattered` instead (armies.js has the only emitter). So
`captured=0` is STRUCTURAL under tile-war, not "war is dead": **`shattered` IS the
war realm-kill flow.** (The pre-WAR_REACH diagnosis's "captured=0 the entire run"
was evidence via the frozen top-5 ages, which remain valid — but the counter
itself never could fire under tile-war.) probe_empires' header now says this.

### Diagnosis (mechanisms pinned, VALUES DELIBERATELY UNTOUCHED)

The matched-step development snapshot (tools/probe_res_dev.mjs, step 12k, seed
8817) discriminates the drivers — full entry in docs/audit-2026-07.md OPEN #5b:

1. **The demographic field level is per-tile** (popField.js `CAP_PER_FERT`/
   `SEED_POP`): total field population measured **3.15×** at 960 (31.4M vs 10.0M).
   The median-anchors absorb the level for their consumers (why the political map
   still works); the field's own dynamics and any raw-magnitude read do not.
2. **Transport edge costs are per-tile, unnormalized** (transport.js: a plain tile
   costs 1.0 at any grid): the same real journey costs 2× at 960, so absolute
   cost thresholds — knowledge-diffusion damping (`DIFFUSE_COST_K`), road/trade
   viability, transport reach — see a world twice as large. Measured downstream:
   cities 0.69× mean size (max 0.46×), org 0.84× at matched step. Settlement
   COUNT is res-invariant (79 vs 87 — the audit's spacing fixes hold).

The two residuals compose into both visible 960 symptoms: the DEVELOPMENT clock
runs slow relative to the (now res-invariant) political clock — an org-lagged
world has weaker walls and smaller prey, so the kill/fragment loop runs hotter
(count ~1.4×) — and cost-damped DIFFUSION widens the tech dispersion between
leader and laggards, so the leader's logistics edge persists, it out-projects
(WAR_REACH's H ∝ logistics) and out-absorbs everyone, and snowballs into the
late-window runaway giant. One mechanism family, both symptoms, opposite signs.

**Why no fix shipped here:** the transport normalization is NOT a one-line ÷rn —
several consumers already compensate individually (foodHierarchy hauls a REAL
distance ×rNormPop while reading the raw-cost map; others don't), so a blanket
edge-cost normalization would double-compensate them. It needs the
consumer-by-consumer design pass (the ENCIRCLE_PENALTY precedent), then the full
F-class validation recipe (×1 at the reference by construction → hashbase 320
re-key → smoke/stylized → this battery re-run at 960). The field-level ÷resScale²
is lower-interlock (the anchors self-calibrate) but only cures the 3× base, not
the visible symptoms — ship both in one designed arc, not piecemeal.

### Window correspondence + measurement notes for the next 960 session

- 480's 16k–30k window and 960's 24k–40k window are roughly ORG-matched (top
  realms ~0.6 → ~1.0 across each): compare those, not equal steps, until the
  transport residual is fixed.
- Cross-resolution comparisons carry WORLD-REALIZATION noise, not just dynamics:
  the terrain noise is sampled at different frequencies, so even hearth-site
  climate differs (Yellow River site moist 0.82@480 vs 0.46@960, seed 8817).
  Judge shape, never exact values.
- A 960 probe_empires 24k run is ~15 min; a 960 probe_avg to 40k ~35 min (4
  concurrent on 4 cores). Budget accordingly.

## THE RES-INVARIANCE ARC (2026-07-13, same follow-up session) — the development clock joins the political clock

The arc queued by the loop-closure above, built the same day. The consumer-by-
consumer design pass settled the direction the codebase itself had already
established (countryTerritory.js: **edge costs stay per-tile raw; cumulative
budgets/thresholds scale**), so the fix is the six sites that were missed, plus
the demographic base:

1. **popField.js** — `CAP_PER_FERT` and `SEED_POP` are per REAL area (÷rNormPop²):
   a finer grid divides the same land among more tiles instead of multiplying the
   world's people (pre-fix: 3.15× total field at tw=480). The anchors re-base
   transparently; NOMAD_FIELD reads a ratio; grievance saturates against a
   median that shifts coherently — all consumers verified anchor/ratio-based.
2. **settlement.js** — `DIFFUSE_COST_K` ×rNormPop: technique diffuses over the
   same REAL reach at any grid (this was the tech-dispersion driver).
3. **roads.js** — trade freight `link.cost/rNormPop × TRANSPORT_PER_PATHCOST`
   (freight per real distance); `MAX_REACH_VISITS` ×rNormPop² and findPath's
   node budget ×rNormPop² (search areas are real areas).
4. **sea.js** — `SEA_FREIGHT_K` reads `cost/resScale` (sea budgets were already
   scaled; the peer-selection discount wasn't).
5. **conquest.js** — the admin-flood search bound `maxCost` now carries
   holdReach's own scale, so the bound and `reachCeil = holdReach×25` are one
   quantity again. Raw, the flood truncated at 1/resScale of the real admin
   radius: the OUTER HALF of every big fine-grid realm read "unreachable →
   secede" — a direct driver of the fragmentation excess. Perf is safe: the
   flood early-exits when all members are found.
6. Deliberately NOT scaled: `POP_MIGRATE` (its implied diffusion coefficient is
   res-variant but second-order — every habitable tile is seeded and fills by
   local logistic growth; a true fix needs sub-stepped migration and its own
   measurement), and the per-EDGE costs themselves (the established convention).

**No lever.** Like the audit's war-rate/gap-fill fixes: every factor is exactly
1 at the 240-tile reference, verified — the 480 grid is BYTE-IDENTICAL pre/post
(b9c264b9/100239cd, 2500 steps, seeds 8817/31337), so every documented 480
number (comboE, WAR_REACH, cities-only, stylized) stands without re-running.
The 320 smoke/hashbase grid re-keys (rn≈0.67 — its field was 0.44× the
reference level, now matched): new pair 36e38967/f57f0ddd in the hashbase
chain. Smoke green at the new 320 trajectory (110.5s, all checks incl.
roundtrip + functional resume). NB the app's actual DEFAULT grid is W=1920 →
tw=960 → resScale=4 (the "2×" UI setting; the loop-closure's tw=480 battery is
the "1×" setting) — so the shipped default had these distortions at double the
measured strength.

### Measured effect at tw=480 (post-fix battery, same instruments)

Matched-step development snapshot (tools/probe_res_dev.mjs, step 12k, seed
8817; the 480 column is byte-identical pre/post so it doubles as the reference):

| | 480 ref | 960 PRE-fix | 960 POST-fix |
|---|---|---|---|
| settlements | 79 | 87 | 86 |
| census pop | 39,364 | 29,902 (0.76×) | **41,908 (1.06×)** |
| popField total | 9.98M | 31.4M (**3.15×**) | **8.29M (0.83×)** |
| city pop mean / max | 498 / 9,483 | 344 / 4,376 | **487** / 5,220 |
| org mean / max | .382 / .489 | .321 / .432 | .337 / .450 |
| realms / claimed | 21 / 19.2% | 24 / 15.9% | 27 / 20.1% |

The demographic base and the urban economy now TRACK THE REFERENCE step-for-step
(field 0.83×, census 1.06×, mean city 0.98× — the residuals are within
world-realization noise: the grids are different terrain realizations, e.g. the
960 Yellow-River cradle reads moist 0.46 vs 0.82 at 480 on this seed). The org
clock NARROWED (mean 0.84×→0.88×, max 0.88×→0.92×) but retains a ~10% lag at
this probe — some or all realization noise (the apex city halves, the p90 city
RISES; where the biggest hub lands differs per realization). The windowed
political battery below is the product-level judge of what remains.

Windowed political battery, BOTH windows at BOTH grids (probe_avg; the two
480@24k–40k cells were never measured before — running them reframed the
loop-closure's giant verdict, see below):

| window | axis | 480/8817 | 960/8817 | 480/4242 | 960/4242 |
|---|---|---|---|---|---|
| 16k–30k | realms | 32.6 | 48.3 (1.48×) | 39.4 | 45.9 (1.16×) |
| | claimed | 50.6% | 53.5% ✓ | 55.5% | 49.5% ✓ |
| | biggest | 6.6 M | 8.7 (1.32×) | 6.6 M | 5.9 (0.89×) ✓ |
| 24k–40k | realms | 44.8 | **46.8 (1.04×)** ✓ | 45.7 | **47.6 (1.04×)** ✓ |
| | claimed | 66.4% | 68.3% ✓ | 68.2% | 66.5% ✓ |
| | biggest | 10.4 M | 14.9 (1.43×) | 8.7 M | 9.8 (1.13×) ✓ |

probe_empires 960/24k post-fix: churn healthy on both seeds (young realms in
every top-5; 8817's top realm at org 0.84 vs pre-fix 0.63 — the development
clock caught up), flows alive (annexed 130/139, shattered 153/124), and the
run was FASTER than pre-fix (10m24s vs ~13–15m) — the wider admin-flood bound
costs nothing (the early-exit absorbs it), it only stops mislabeling the
outer belt "unreachable".

### Verdict — and a correction to the loop-closure's giant reading

**The 960 grid now tracks the 480 reference on essentially every axis.** Late
window: realm count within 4% on both seeds, coverage within 2pp, giants
1.13×/1.43×. Early window: coverage matched, giants 0.89×/1.32×, count
1.16×/1.48×. The residual scatter is the same order as the reference's own
seed-to-seed variance (480's two seeds differ 1.2× on count and 1.2× on
late-window biggest), so no further mechanism claims are warranted from a
2-seed battery.

The never-measured reference cells also CORRECT the loop-closure verdict
above: **the 480 reference's own late window grows 8.7–10.4 M giants and
~45 realms** (the defensible-size equilibrium expands as logistics extends
force projection — the WAR_REACH roads→rail channel, by design; and the count
rises with development everywhere). So a large share of the "runaway giants
✗" reading came from judging 960's late window against 480's EARLY window —
the genuinely res-variant part (the development clock, the 3.15× field, double
freight, the halved admin radius) is what this arc fixed; the rest was window
mismatch. With the clock aligned, step-for-step windows now correspond across
grids and that class of confusion is gone.

**Remaining residuals, honestly stated:** the ~10% org lag at matched step
(partly world-realization noise — the grids are different terrain draws);
8817's early-window count (1.48× — state-birth wave timing); POP_MIGRATE's
res-variant diffusion coefficient (documented in popField.js, needs sub-
stepped migration); the raw storm radius + flat-tile city footprint (audit
OPEN #5, topological). All second-order next to what shipped; measure at
resScale=4 (the app's 1920 default) before hunting them further.

### The resScale=4 spot-check (the app's true default, measured same day)

probe_res_dev 1920/12k/8817: settlements 73 ✓, field 6.5M (0.65×), census
25.3k (0.64×), org mean .236 (0.62×), claimed 8.5%; probe_empires 1920/24k:
63 realms / 45.6% / biggest 10.8M, churn alive (a 2.2k-age realm in the
top-5), org 0.59–0.64 at 24k. VERDICT: functional and enormously better than
pre-fix (the field would have been ~10×; it is 0.65×), but **a residual
development-clock lag grows with resScale — ~0.9× at rs=2, ~0.6× at rs=4.**
The p50 city lags hardest (49 people / org .17) while the leaders are
near-track — the signature of impaired REDISTRIBUTION, which makes
POP_MIGRATE's unfixed diffusion coefficient (16× slower real D at rs=4) the
prime suspect for the next res arc. Sub-stepped migration + re-measure at
1920 is the designed follow-up; until then the "1×"/tw=480 setting is the
best-validated shipped grid.

## THE rs=4 ARC (2026-07-13, follow-up session) — the trade wiring was the clock

The queued arc, run verify-first exactly as designed. All A/Bs: probe_res_dev,
step 12k, seed 8817, same-grid same-seed pre/post (clean single-variable cells);
the 480 reference cell's full percentiles were captured for the first time
(city p50 66 / p90 763; org p50 .425 / p90 .471 — the reference org
DISTRIBUTION is TIGHT: everyone near the leaders).

### 1. POP_MIGRATE verified first — REFUTED as the driver (then shipped as the substrate, see §3b)

Sub-stepped migration was built as the verify vehicle (total share
×rn² per firing, split into substeps of ≤0.5 share each; n=1 and bit-exact at
the reference — hash480 held at b9c264b9/100239cd; stable at rs=4, 2×0.48
substeps). Measured at 1920/12k: **org .236→.235 (flat), claimed 8.5→9.7%,
census 25.3k→16.8k (0.64×→0.43× — WORSE), p50 city 49→37.** At 960/12k:
neutral (org .337→.333). D×16 field diffusion does not drive the dev clock —
it drains cradle catchments faster than cities urbanise them in an UNWIRED
world. The hypothesis about the CLOCK was wrong; the physics (D ∝ share·Δx²
is res-variant) was right — see §3b for the flip once the wiring existed.

### 2. The real driver: the road-wiring radii (FIXED, shipped)

The reach/trade graph only propagates along ROADS, navigable RIVERS (mag≥3),
or settlement tiles (roads.js computeReach) — partners REQUIRE built roads;
rivers are free corridors (why the river-cradle leaders always near-tracked).
Two raw-tile radii under-wired the road mesh at fine grids:

- **`CLOSE_NEIGHBOUR_DIST` (20 raw)** — the guaranteed city↔neighbour
  wiring, calibrated "just above MIN_SETT_DIST (12)". But founding spacing
  scales ×rn (crystallize.js) while the 20 did not: at rs=4 neighbours sit
  ~48 tiles apart — **the local road mesh never formed at the shipped
  default** (and was mostly dead at rs=2, spacing ~24). Now ×rNormPop.
- **`partnerReachFor` (PARTNER_DIST_BASE 20 + √pop, ×techMul, raw)** — the
  road planner's commercial horizon was ¼ the real distance at rs=4. Now
  ×rNormPop.

The trap that amplified both: stateless settlements neither lay nor receive
roads, and MIN_POP_TO_PLAN=60 is out of reach for a starved city — no roads →
no partners → no diffusion/trade → cities stay small → still no roads. The
DIFFUSE_COST_K fix from the res-invariance arc never got an EDGE to act on.

Measured (each grid vs the byte-identical 480 reference at matched step 12k):

| | 480 ref | tw=480 pre | tw=480 POST | tw=960 pre | tw=960 POST |
|---|---|---|---|---|---|
| org p50 | .425 | ~.37 | **.434 (1.02×)** | ~.17 | **.413 (0.97×)** |
| org mean | .382 | .337 | **.384 (1.005×)** | .236 | .330 (0.86×) |
| p50 / p90 city | 66 / 763 | 97 / 770 | 77→204* / 1031 | 49 / — | 76 / **763** |
| census | 39.4k | 41.9k | 53.5k (1.36×) | 25.3k | 27.0k (0.69×) |
| realms / claimed | 21 / 19.2% | 27 / 20.1% | 27 / 21.2% | ~14 / 8.5% | 12 / 12.9% |

*77 with roads-only, 204 with the full set. **The tw=480 grid's ~10% org
lag — written off in the res-invariance arc as "partly realization noise" —
was THIS, and is GONE (1.005×).** At tw=960 the masses' clock is fixed (p50
0.97×, p90 city exactly at reference); what remains is the stateless low-org
TAIL (drags the mean to 0.86×) and late state birth (realms/claimed at the
12k snapshot) — see residuals below.

Same-class fix in the same commit: **`NUCLEATE_R`/`NUCLEATE_CAP_DIST`
(countryTerritory.js) ×resScaleFor** — the state-birth basin gathered a
raw-tile disc of per-real-area popField, i.e. 1/rs² of the real basin's
people (the viability bar was quietly ×16 harder at rs=4). Measured
NEUTRAL at the 12k snapshot (realms 12→12: the ORG_STATE_MIN statecraft gate
binds FIRST on the unroaded stateless tail, so the basin bar is rarely even
evaluated there yet) and mildly active at tw=480 (25→27 realms); it binds as
tails develop. Mechanism-correct, ×1 exactly at the reference.

### 3b. The migration patch flips positive on the wired world — SHIPPED second

With the road wiring fixed, the §1 patch was re-measured on top (same cell,
1920/12k/8817): **census 27.0k→33.0k (+22%: 0.69×→0.84× of the reference),
city mean 370→446 (0.90× ref), p90 city 763→1,075, max 3,745→4,701; org and
realms/claimed neutral (.330→.326, 12/12.9→12/12.7).** The same D×16 that
DRAINED the unwired world (§1) FEEDS it once cities have the trade net to
urbanise the flow — the roads are the mechanism, the field is the substrate,
and the ORDER of the two fixes was the whole story. Shipped as its own
commit; the reference stays byte-identical (hash480 re-verified with the
patch in), and the 320 hashbase re-keys again (pair in its header chain).

Full-set matrix cell at tw=480 (12k/8817): org .392/p50 .442 (1.03×/1.04×
ref), p50 city 67 (ref 66), max 9,118 (0.96× ref), 25 realms / 22.5%. The
one drifting number across the arc is the tw=480 census TOTAL (1.06×→1.36×→
1.49× as the world gains function) — a heavy-tailed sum on a different
terrain realization; the multi-seed windowed battery (probe_avg) is its
judge, not a single matched-step cell. All per-capita/percentile shape sits
on the reference.

### Residuals at rs=4 (diagnosed, deliberately not quick-fixed)

1. **The stateless-tail trap**: stateless settlements lay/receive no roads
   (roads.js gates both directions on countryId) → their org grows unroaded →
   ORG_STATE_MIN blocks nucleation → land stays unclaimed at the snapshot.
   The trap exists at every grid; the reference tail escapes it faster (its
   marginal rivers carry more of the map — below). Candidate mechanisms if it
   needs closing: pedlar/foot diffusion off the road net (a faiths.js-style
   near-radius knowledge trickle), or roads to organized-but-stateless cities.
2. **River magnitude is grid-variant in worldgen**: the same seed's Nile
   hearth reads river(mag4) at tw=240 AND tw=480 but river(mag3) at tw=960
   (founding logs) — flow accumulation classifies lower per-tile on finer
   grids, so the FREE river-trade network (mag≥3 corridors) thins and the
   water-access premium (mag/RM_FULL) shrinks exactly where the apex cities
   live (apex 0.39× at 12k). A prototype lever already exists —
   `RES_INV_RIVER`, def 0 — this is its own arc, worldgen-side.

   **INVESTIGATED (same day, follow-up session) — three layers, measured:**
   - *Classification is CORRECT*: the absolute km² catchment bars scale
     exactly (avgRunoff 0.2302 vs 0.2263 across 480/1920 — SIM_RIVER_DIAG in
     riverGen.js), and the mag≥1/mag≥2 network's REAL length per real area
     is invariant (1.00/1.08/1.14 and 1.00/0.99/1.04 across the three grids
     — probe_river_density; NB the raw TILE fraction halving per 2× is 1-D
     representation, not a defect).
   - *Drainage fragmentation is the flow-side driver and is largely
     IRREDUCIBLE*: the top river accumulates only 0.79× its bar-relative
     flow at rs=4, Great-class real length 0.66×, mag≥3 corridor 0.78× —
     while total ocean discharge per land holds within 7% and terminal land
     grows just 39.0→42.3%. The water is REDISTRIBUTED across more, smaller
     mouths: the terrain noise is a fixed-spectrum continuous field
     (tectonicGen uses absolute normalized frequencies), so the coarse
     reference LOW-PASSES it while fine grids resolve real divides that
     split the great basins. Transmission loss is exonerated for the
     cradles (it applies to TERMINAL-draining tiles only; the Nile is
     exorheic). A reference-Nyquist hydrological-elevation field would fix
     it at the cost of fine-grid terrain honesty — a product trade-off,
     deliberately not taken here.
   - *Consumer DETECTION was the actionable layer*: computeWaterAccess
     (settlement.js) scans a fixed 3×3 — at rs=4 a settlement misses the
     river it sits beside ~26% of the time. The existing `RES_INV_RIVER`
     prototype (real-distance scan radius, byte-identical at/below the
     reference by construction) was A/B'd at both grids (12k/8817):
     at 1920 it RECOVERS the political map — realms 12→22 (ref 21), claimed
     12.7→18.9% (ref 19.2%), org p50 0.99× of ref, apex city 0.50×→0.83× —
     but at BOTH fine grids it also inflates the settlement count and census
     (settlements 87→98 at 960; census 1.49×→1.88× of ref). VERDICT: detection
     fix validated, default flip PENDING a windowed multi-seed battery + a
     stylized gate under the lever. The lever remains def 0; flip evidence
     lives here and in the plan doc.

     **Follow-up (same day): the "split capacity from founding-site scoring"
     idea is NOT viable — traced and dropped.** The inflation is not a
     separate scoring path to fence off: crystallize's founding scorer reads
     `riverMag` DIRECTLY (the ×6 river-valley magnet, the FLOOD_SAMPLE_FRAC
     floodplain candidate draw, the confluence bonus) and never routes
     through `computeWaterAccess` — the one function `RES_INV_RIVER` widens.
     So the wider scan touches only CAPACITY (fishing income, alluvial
     fertility, aridity relief), and the extra settlements are the correct
     downstream consequence of fine-grid river sites finally getting their
     water-fed food, not an artefact of a mis-wired founding read. The flip
     is therefore a straight measurement call (windowed + stylized), with no
     intervening mechanism change. That battery was attempted this session
     and BLOCKED by the same container instability as the rs=4 validation
     battery above (1920 runs out-live the restart cycle); the single-cell
     A/B stands, the lever stays def 0, and the flip is a stable-box decision.
3. The 12k snapshot exaggerates TIMING (a state-birth wave at 13k vs 11k reads
   as 12 vs 21 realms); the windowed probe_empires battery below is the
   product judge.

### Secondary raw-radius family (triaged in the same sweep, documented not bundled)

Same F-class, different channels, none implicated in the dev-clock signature:
`FRONTIER_RADIUS` 28 (colony local-density gate), `COLONY_MIN_DIST` 14
(landing spacing), `RAID_RANGE` 28 (slaver reach), cultures.js:503 raw 16
(daughter-culture homeland seeding), faiths.js:414 raw 11 (foot-conversion
radius). Verified CLEAN: MARKET_CUTOFF (rides mktR×rn), cohesionRadius
(fraction of tw), INHERIT_NEAR_RADIUS (perf fast-path, identical full-scan
fallback), MINE_RANGE (URBAN_NODES experimental path only, def 0).

### Validation (the F-class recipe, complete)

- **hash480 UNCHANGED after every increment** (roads → +nucleation →
  +migration): b9c264b9/100239cd — every factor ×1.0 at the reference by
  construction, verified empirically four times.
- **hashbase 320 re-keys twice**, both recorded with recipes in its header
  chain: 85674ac7/2db3bf8 (wiring radii tighten below the reference), then
  f9eb7306/8d66ed8d (migration share drops — 320's D was 2.25× fast).
- **Smoke green twice** (80.2s on the wiring commit, 85.2s on the final
  state) — determinism, invariants, save/load roundtrip + continuation.
- **probe_empires 1920/24k, BOTH states** (same seed 8817; pre-arc baseline
  was 63 realms / 45.6% / biggest 10.8M / org 0.59–0.64):

| step | roads-only | full set (shipped) |
|---|---|---|
| 8k  | 13 / 10.1% | 11 / 8.6% |
| 12k | 12 / 12.9% | 12 / 12.7% |
| 16k | 23 / 21.2% | 19 / 16.4% |
| 20k | 50 / 42.6% | 43 / 33.0% |
| 24k | 94 / 57.0% / 6.3M | 82 / 53.3% / 11.4M |

  The 12k snapshot's "realms low" was TIMING, as diagnosed: the state-birth
  wave arrives ~14k–24k and **coverage lands on the reference track** (53–57%
  vs the reference's 55.0% at 24k — pre-arc it reached only 45.6%). Leader
  org 0.59–0.66 at 24k with HALF the world claimed more than pre-arc. Churn
  vigorous in both states (full set: shattered 200, annexed 75, a 6.1k-age
  realm in the top-5; captured=0 is structural under tile-war). Residual
  axes, honestly: the realm COUNT reads 82–94 vs the reference's 30 at
  matched step (the volatile attractor + a finer grid resolving more small
  realms mid-churn + nucleation now firing at the real basin rate) and the
  top giant is noisy (6.3M/11.4M across the two cells; reference equilibrium
  6.6M matched-step, growing to 8.7–10.4M in its own late window) — both are
  windowed-multi-seed questions (probe_avg at 1920, both seeds, both
  windows), queued as the next 1920 session's battery. Perf envelope
  unchanged (1920/12k probes ~25 min, 24k empires ~65–70 min under parallel
  load).

  **STATUS (2026-07-13, follow-up): the 1920 windowed battery was ATTEMPTED
  and remains BLOCKED by infrastructure, not by the finding.** The four-way
  A/B (lever-off × 2 seeds, RES_INV_RIVER=1 × 2 seeds, 16k–30k at 1920) was
  launched twice; the execution container cycled every ~20–30 min while a
  single 1920→30k run needs ~60 min, so nothing reached its sample window.
  The shipped default does NOT hinge on this: the development clock was
  already validated (the rs=4 arc), the matched-step probe_empires table
  above stands, and the count/giant residuals stay exactly as characterised —
  a windowed refinement that a stable box can close in one session, not an
  open correctness question. No number here changed; only the confirmation is
  deferred.

## THE MINIMUM-EGYPT FIX (2026-07, SIZE_BY_POP) — realm size tracks governed people, not a floor

User report: "anything smaller than Egypt is now impossible; realms spawn a
tiny speck then explode in one tick to the size of all other new nations."
MEASURED and true. Three layers, all at the 480 reference (1 tile ≈ 17,700 km²):

1. **The coverage floor.** Every realm's growth target is max()'d with
   `COVER_BASE(25) + COVER_ORG(260)·org` ref-tiles — so a realm at the
   statehood threshold (org 0.15) is floored to 64 tiles = **1.13M km² ≈
   Egypt**, and the boosted fill rate (EXPAND_RATE·POP_FILL = 96 tiles/pass)
   fills the whole floor in ONE territory pass → the "explode in one tick."
2. **Solo realms are hard-skipped** in the capacity calc (conquest.js:2034),
   so a lone city-state gets `_capacity = 0` → target 0 → the floor was the
   patch that gave it any size.
3. **The capacity curve is log-compressed and median-anchored**:
   `capacity = CAP_K_REL(7.8)·log2(1 + power/MEDIAN power)`, so a realm 10×
   the median's power gets only ~3.5× the area — every realm clusters at the
   median ≈ 47 tiles ≈ 830k km², *already Egypt-scale before the floor*.

Under all three, the grid itself: 17,700 km²/tile (70,000 at Quarter sim res),
so a real 2,000-km² city-state is sub-tile — the smallest possible realm is
~1 tile regardless of the size model. (Documented; the fix makes realms as
small as the grid allows, it can't beat the grid.)

### The floor-on/off/mechanism A/B (reference grid, seed 8817, over time)

| | median realm | sub-Egypt realms | coverage 8k→32k | biggest |
|---|---|---|---|---|
| Default (floor) | 75→123 t (1.3–3.2M km²) | 4–18 | 16→64% | ~10M |
| Floor OFF | 5→45 t (89–797k) | 15–36 | 2.6→23% | ~4.6M |
| SIZE_BY_POP v1 (pop cap only) | 5→68 t | 18–37 | 2.4→32% | ~4.8M |
| **SIZE_BY_POP (core+march)** | **18→79 t (319k→1.4M)** | **21–31** | **9→63%** | ~13M |

Floor-off proves small realms are achievable but EMPTIES the map (coverage
collapses to 23% — the documented comboE risk: the median-anchored log2 means
nobody pulls ahead, so nothing fills). v1 (pop cap alone) is the same — small
realms, 32% plateau. The plateau is intrinsic to the median-relative benchmark.

### The mechanism (T.SIZE_BY_POP, lever, DEFAULT 0, byte-identical off)

Extent = **populated CORE + administrative MARCH**, no floor:
- **Core** = `govPop / medianGovPop · median-capacity-target` (countryTerritory.js):
  extent tracks the people a realm actually administers, benchmarked to the
  median established realm each pass (the _refRevenue pattern — no fitted
  density). Under-populated realms shrink to what their people justify →
  sub-Egypt realms exist; the median-and-above are unchanged.
- **March** = `150 · logistics² · r2` ref-tiles ADDED on top: the sparse
  deserts/tundra/marches a state can *reach* but its people don't fill. It is
  ~0 in the pre-road era and grows with roads→rail, so **coverage rises with
  development** (the "near-full only at the industrial era" target) instead of
  being floored full from birth. Capacity is deliberately NOT the ceiling
  (median-anchored → would re-cap the whole map at the median, the v1 plateau);
  the growth Dijkstra's admin-load attenuation is the real reach bound.
- Nomads exempt (steppe held by momentum, not people); a capless solo is
  driven purely by its population so it grows instead of freezing at its core.

**Calibration** (swept to 40k at the reference): march = `150·logistics²`. The
squared logistics gate keeps the early frontier genuinely small (march ≈ 0 until
roads mature) and pushes the fill toward the industrial era; the linear gate
(pow 1) inflated antiquity (median 637k vs 319k) and filled by the classical
period. March magnitude is the giant lever: 400 fills fuller (73%) but runs the
biggest realm to 22M km² (runaway); 150 holds it to a population-earned ~13M.

### Validation (reference grid — 1920 confirmation pending a stable container)

- **Coverage rises with development**: 9%(antiquity) → 17% → 49% → 63% → 66%
  (industrial), matching the default's late level from a sparse early world.
- **Small realms exist at every step**: early median 319k km², 31/33 realms
  sub-Egypt at 8k; late still 25 sub-Egypt of 46.
- **The giant is MORTAL** (probe_empires 32k): the top slot turns over (biggest
  at 32k is age 27,680, not the oldest realm's 30,013), young realms climb to
  the top-5 (age 5,413 at #2), deaths abundant (shattered 7→249, seceded 37),
  and the late map is MULTIPOLAR (several 9–12M realms, no dominant hegemon).
- **Stylized 3/3 seeds, all hard gates, 0 soft warnings** — BETTER than the
  default (which carries 1: the flat empire-area tail from its uniformly-capped
  giants). SIZE_BY_POP's natural size spread (city-states → great powers) has no
  flat tail. Largest-empire share 13%, Zipf −0.84, fallen lifespan ~217y.
- **Byte-identical off** (hash480 b9c264b9/100239cd) — fully reversible.

**The default flip (0→1) is BUILT and behaviourally validated but BLOCKED on a
save/load bug — it stays DEFAULT 0 (opt-in) until that is fixed.** Enabling it as
the default was attempted (2026-07) and reverted when smoke's save/load
CONTINUATION gate failed: a loaded world's coverage drifts ~4pp from the
uninterrupted run (land 5.9% vs 9.6% at +1000 steps), tripping the 3pp tolerance.
It is NOT a data-loss runaway (pop drift 4.3%, wealth 0%, counts within
tolerance) — SIZE_BY_POP's pop-driven coverage is simply more SENSITIVE to the
save/load re-warm than the org-floor it replaces, and at the sparse early map
(~6–10% coverage) a small transient is a large relative slice. Ruled out as the
driver (both tested, numbers byte-identical): the per-country capacity warm-up
(persisting + restoring `_capacity` after rebuildCountries changed nothing —
capacity is recomputed before territory), and the logistics march (march ≈ 0 that
early, so removing it changed nothing). The residual is in the pop-CORE's
global-median coupling (`popCapK = medTG/medGP`) amplifying whatever small
political-map transient the load re-warm carries — root cause not yet isolated.
FIX PLAN before the flip: reproduce the drift in isolation (probe the loaded vs
original `_countryOwner` right after load), find the non-restored cross-tick input
the pop-core reads, persist/re-derive it (the anchor pattern), then re-run smoke +
the reference battery. Until then: the mechanism is fully validated at DEFAULT 0
via `SIM_TUNE="SIZE_BY_POP=1"` (coverage 9→66%, sub-Egypt realms throughout, giant
mortal, stylized 3/3 at 0 warnings — all above), the shipped default is unchanged
(reference b9c264b9/100239cd), and env sweep knobs are retained (SIM_MARCH_TILES/POW).

## OPEN / NEXT
- If you want amphibious war to stop over-consolidating *at the mechanism level*
  (not just capped via comboE): it needs a **NON-multiplicative** limiter — e.g.
  amphibious requires NAVAL DOMINANCE (control of the sea), a separate axis giants
  don't auto-win — since every multiplicative approach (bar, reach-decay) is proven
  inert. (WAR_REACH decays the short-hop channel barely at all, by design.)
- Coalition armies still don't COMBINE on a shared front — the other historical
  hegemon-killer. defForce/offForce are per-dyad; allies each fight alone.
- Provincial force projection: WAR_REACH projects from the CAPITAL only; a realm with
  regional seats (CAP_SEAT) could plausibly project from its nearest seat — would let
  well-administered empires defend far provinces better, at the cost of re-opening
  some giant durability.
