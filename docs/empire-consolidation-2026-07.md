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

<!-- BATTERY_RESULTS -->

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
