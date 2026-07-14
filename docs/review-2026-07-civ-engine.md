# Civilization-Engine Deep Review — July 2026

**How this was produced:** a 24-agent review fleet (14 subsystem deep-reads covering every
module in `src/sim/` + `tools/`, 7 cross-cutting sweeps — time-gates, outcome-fitting,
determinism, conservation, save/load, performance, integration/dead-code — and 3 empirical
agents that ran 30,000-step simulations across multiple seeds). Every major/critical bug
claim was then attacked by independent adversarial verifiers whose default stance was
"refuted." Result: **89 unique findings, 48 CONFIRMED, 2 plausible (split votes), 2 refuted,
37 unverified** (minor-severity claims whose verification was skipped to save budget — their
evidence is code-cited but unattacked).

**Legend:** `[C]` confirmed · `[P]` plausible · `[U]` unverified · **crit/maj/min** severity.

> **STALENESS WARNING (audit 2026-07-13):** this is a point-in-time snapshot with no
> resolved-annotations, and several of its CONFIRMED items have since been FIXED — spot-
> checked: the inflation `step >= 5000` gate (now org-gated, inflation.js), the
> `COVERAGE_RAMP` step-ramp (now a wave-of-advance tempo, crystallize.js), the
> Nile/Mesopotamia same-tile seat (now `HEARTH_MIN_SEP_FRAC`, state.js), and the
> `capE.logistics` dead read (now `logisticsLevel`, conquest.js). Check the
> code before re-opening OR trusting any item here.
>
> **Load-persistence re-verification (2026-07-13, follow-up session):** the flagged
> save/load family is FIXED on HEAD, verified against the code paths:
> **B19** — `reindexRoads()` (roads.js:266) rebuilds `_roadTiles`/`_flowTiles` from the
> loaded arrays and IS called on the load path (persist.js:395), so flow decay and road
> abandonment survive a load; **B42** — `reconcilePolities` (entities.js:130) recomputes
> the live id set from settlements mid-pass instead of trusting the pass-start view, so
> same-pass secessions are no longer closed "Dissolved" at birth; **B52/B75** —
> `_riverAcc`/`_confine`/`_rugged` are in the v2 SAVE_FIELDS whitelist (persist.js:68)
> and v1 saves re-derive them on load (`rederiveSiteStatics`, persist.js:356). The smoke
> gate also now includes a CONTINUATION-EQUIVALENCE check (load, step both worlds +1000,
> compare pop/wealth/settlements/countries within tolerances), not just hash identity —
> so persistence regressions of this family trip CI, they don't accumulate silently.
Full per-finding detail (descriptions, failure scenarios, suggested fixes) is in the
appendix: `docs/review-2026-07-appendix/`.

---

## Executive summary

The engine is in far better shape than most codebases this ambitious: the review
*confirmed* that the two cardinal rules are honored almost everywhere (the calendar is
genuinely cosmetic, the demographic-anchor scar is genuinely fixed, money genuinely
conserves in-run, determinism architecture is sound, `slavery.js` is fully wired, the event
log is append-only and bias never mutates truth). The serious problems cluster into five
themes:

1. **Save/load is systematically broken** — the biggest single finding. The persistence
   whitelist has drifted far behind the mechanisms. At least **ten classes of real
   cross-tick state are silently dropped** (soil fatigue, conquest tile-holds, truces,
   inflation baseline+price levels, reach ramps, credit, site statics, war memory, faith
   cooldowns, `world.countries`), and the smoke test's hash covers none of it, so CI
   passes while a loaded world **diverges massively** (verified: pop 6,689 vs 11,019 after
   1,440 post-load steps; a 42× road-flow blowup; loaded river cradles turn into
   "penalized desert").
2. **Three genuine cardinal-rule violations survive** in live defaults: the inflation
   baseline locks on `world.step >= 5000` (found independently by 8 of 24 agents); the
   settlement-spread tempo ramps on raw elapsed steps (`COVERAGE_RAMP=17000
   "~renaissance"`); and Earth cradles are hand-seated named coordinates with
   drift-fitted radii — which also produces a confirmed bug where **Nile and Mesopotamia
   seat on the identical tile** at CI resolutions.
3. **`SIM_GRANULARITY` is half-honored** — ~10 confirmed sites (dynasty clock, colony
   parties, slave raids, climate walk, soil fatigue, sack recovery, conscription windows…)
   don't scale by `_dt`, so the lever silently *changes* the history it promises to
   preserve.
4. **The emergent history has three shape-pathologies** (empirically measured): war
   saturates into permanent all-pairs conflict (~333 new wars/1000 steps late-game);
   the late-game hegemon ossifies (one cradle is #1 for 74% of a 30k run, polity
   mortality collapses 7×); and the mobility/cavalry branch of the tech tree is dead
   content on every seed tested (max 0.31 vs the 0.45 chariot gate). Relatedly, the
   polity lifecycle ledger is corrupted (every same-pass secession logged "Dissolved" at
   birth; silent resurrections), which is *also* why `validate`'s lifespan gate
   soft-warns — the heavy tail exists but lives in the censored alive set.
5. **The validation suite doesn't measure what it advertises** — every shape gate is
   soft (validate can only fail on survival), the Zipf gate ranks provinces not cities
   under the default model, the empire-tail statistic is near-vacuous, and thresholds
   are step-denominated (break under `SIM_GRANULARITY`) and fitted to pass one
   seed/resolution.

---

## 1. Confirmed bugs — critical

| # | Where | Finding |
|---|-------|---------|
| B19 `[C]` | `roads.js:255` | `_flowTiles` never rebuilt from loaded `roadFlow` → after any load, flow decay is dead: **42× unbounded flow growth, roads never abandon** (reproduced live). |
| B42 `[C]` | `entities.js:113` | `reconcilePolities` reconciles against the pass-START countries map, so **every same-pass secession is instantly logged "Dissolved"** (measured: 102 ended vs 0 restored/emerged in 15k steps; 19 *living* realms carry "Dissolved" chronicles). With B88, corrupts every lifespan statistic. |
| B52/B75 `[C]` | `persist.js:182`, `settlement.js:320` | `_riverAcc`/`_confine`/`_rugged` are computed only in `makeSettlement`, never saved nor recomputed on load → **every loaded settlement reads 0 forever**; river cradles become arid-penalized desert (verified 23/23 → 0/23). |

## 2. Confirmed bugs — major (grouped by theme)

### Save/load integrity (with §1 above, the top-priority cluster)
- B11/B56 `[C]` `inflation.js` / `persist.js:129` — `_inflRef` (permanent M/T baseline) and
  `_inflP` (sim-facing price levels) not persisted → **every load resets the entire price
  system** and re-bases it at whatever the post-load economy happens to be.
- B15 `[C]` `persist.js:40` — `_credit` not in `SETT_FIELDS` → with banking on, every
  save/load **re-mints a credit layer on top of credit-inflated wealth** (compounding faucet).
- B27 `[C]` `countryTerritory.js:389` — `_cBudgetRamp`/`_claimPress` unserialized → every
  loaded empire's reach snaps back to cradle base and re-ramps.
- B53/B67 `[C]` `settlement.js:1667` — `world._soilFatigue` ("the LAND remembers") not saved
  → millennia of salinisation erased by load (493 fatigued tiles → 0).
- B54 `[C]` `persist.js:161` — `world.countries` left empty after load for up to 150 ticks →
  `_civYear` reads −6000, identity weights snap ancient, alliances/dominance blind.
- B55 `[C]` `armies.js:377` — `_truces` and `_warSeenAt` not saved → wars restart early,
  duplicate `war.began` events after load.
- B68 `[C]` `persist.js:98` — save meta omits the real-wind flag / import raster →
  **loadWorld rebuilds different terrain under the saved civilization**.
- Unverified minors in the same class: B58 (climMod not rebuilt before territory warm),
  B59 (faith schism/syncretism cooldowns), B77 (`_lastBorrow`).
- **Root cause (I50/I78):** the manual `SETT_FIELDS`/tables whitelist structurally drifts
  behind new mechanisms. See recommendation R1.

### Cardinal-rule violations (live, default-on)
- I11 et al. (8 independent finders) `inflation.js:82` — baseline locks on
  `world.step >= 5000`: a content gate on wall-clock time, also granularity-blind.
  *Fix:* gate on monetary state (total minted coin per capita, ≥K monetised components,
  currency-era org) — the `M.size >= 3` clause already half-does this.
- I24/I63/I80 `crystallize.js:278` — `devFactor = f(world.step / COVERAGE_RAMP)`
  ("~renaissance") throttles ALL settlement spread + colonization on elapsed time.
  *Fix:* drive tempo from donor knowledge (agri/construction/org) × local population
  pressure `people/_k` (idea D21/D53) — ingredients already computed at the call sites.
- B28/B71 `[C]` `state.js:339-360` — `seedEarthHearths` has **no cross-hearth separation**:
  Nile and Mesopotamia verifiably seat on the identical tile (95,28) at smoke/validate-probe
  resolutions; the duplicate "Mesopotamia" holds 0 territory through t=3000. The hand-seated
  coordinates with per-site drift-fitted radii are rule-2 outcome-fitting (I27/I74/I85/I94);
  the honest fix is D78 (weight the *algorithmic* scorer by arid-alluvium/tFlood irrigation
  potential so the Crescent wins on merit), with the pinned list demoted to an explicit
  scenario toggle.
- I4/I65/I67 `cohesion.js` + `index.js:189` — identity-era salience (nationalism etc.) reads
  ONE global `_civYear` from the planet's single most advanced capital → uncontacted
  bronze-age continents get modern nationalist forces the moment anyone industrializes.
  *Fix:* per-realm salience from the realms-in-contact's own org (or a diffused "ideas"
  field mirroring `_diseaseLoad` — idea D54).
- I1/I2 `conquest.js` — the dominance tail (`CAP_DOM_P` comment: "top core needs ~6-8× to
  reach a Rome-scale share") and lopsided engulfment (`LOPSIDED_HEADROOM` licensed to break
  the capacity budget) are calibrated-to-outcome stabilizers; I0 counts **seven** stacked
  empire-size stabilizers. *Fix direction:* vassalage/tributary submission as the real
  mechanism (idea D2), then retire the engulfment override.

### SIM_GRANULARITY contract breaks (G>1 silently alters history)
`[C]` B2 (`CONSCRIPT_WINDOW` + sibling windows — conscription never fires at G≥4),
B12 (slave raids double-scale), B18 (sack recovery G× faster), B29 (colony parties/urban
genesis G× faster), B38 (dynasty clock — rulers age per-tick, not per-history; also stale
"display calendar" comments, I35), B8 (climate walk + soil exhaustion G× faster).
*Fix:* one mechanical audit pass applying the codebase's own `_ivl`/`_dt` convention;
add a G=4 vs G=1 equivalence check to smoke.

### Economy & conservation
- B86 `[U]` `index.js:350` — `peopleSimStats` sums stale `c._treasury` snapshots → the HUD
  world-wealth series **sawtooths −53% every polity pass** (empirically measured).
  Related design finding I93: treasuries hoard 22–78% of the entire money supply
  within each 150-tick window and dump it back in one tick — disburse continuously.
- B13 `[C]` `roads.js:1102` — tolls/brokerage paid to stale (dead) intermediate references
  leak coin out of the closed supply.
- B7 `[C]` `settlement.js:1970` — fishing ignores tech entirely: `fishFactor` computed,
  never read.
- B6 `[C]` `settlement.js:1737` — farm-labour floor charged on tiles the harvest sum
  excludes → **claiming worthless land actively destroys food**.
- B5 `[C]` `settlement.js:2253` — unclamped Euler logistic: a K-crash kills a large city in
  one tick (population can go negative), bypassing the granary/famine path.
- I12/I75 — `ravage()` burns looted coin against the currency spec's no-burn constraint
  (transfer it to the rebels instead); B72 `[U]` — dying settlements' hoards vanish
  (idea D61: ruin hoards); I76 — capitals exempt from import duties (stale artifact).
- I14 — debasement seigniorage minted ∝ army bill, not any coin stock (idea D10 fixes).
- B9 `[C]` `shocks.js:120` — virgin-soil sweep filters against the wrong side's disease
  load → immune mid-load settlements take 6× virgin mortality.

### Territory / political map (freshest code, PR #38)
- B23 `[C]` `countryTerritory.js:971` — adoption reads the stale RENDER claim with no
  liveness check → **resurrects dead countries** (~1 zombie adoption per territory pass) and
  rips towns out of live realms. Related: I21 — the claim crawl is documented "render-only"
  but is load-bearing for allegiance; give adoption its own administered-tile mechanism.
- B24 `[P]` `countryTerritory.js:633` — the persistent merge's land-only connectivity flood
  wipes **all** across-water reach claims (mare nostrum dead by default lever). Idea D17:
  water hops budgeted by navigation tech — mechanism, not patch.
- B25 `[C]` `territory.js:274` — catchment Dijkstra loses the claimant at water tiles →
  food catchments can never cross a strait (contradicts its own "navy reaches the far
  shore" comment).
- persist saves a **nonexistent `_capturedAt`** while the live `_tileCapturedAt` map is
  dropped → conquest tile-holds silently revert on load (confirmed within B27/B52 cluster).
- B26 `[U]` — post-merge smoothing recolours worked ledger land to rivals (only home tiles
  are pinned, contradicting its comment).
- Founding: `[C]` settler-born realms are stripped stateless by `adoptAndFound` at the next
  territory pass (probe: 25/27 stripped, ~288 ticks stateless, cut off from the realm food
  hierarchy) — same stale-claim root as B23.

### Culture / faith / dynasties
- B32 `[C]` `language.js:215` — same-parent language branches in one pass get identical
  seeds → **byte-identical clone languages** (node-repro'd), colliding names downstream.
- B33 `[C]` `faiths.js:241` — `MIX_FLOOR` pops every sub-5% conversion increment →
  conversion is secretly all-or-nothing; weak/clashing state churches convert nobody ever;
  low spread levers silently freeze religion.
- B35 `[C]` `dynasties.js:661` — `MAX_HOUSE` roster slice orphans living royals who then
  **never die** (one immortal aged 1,850 dyn-years observed).
- B36 `[C]` `dynasties.js:538` — elective realms draw candidates from every same-culture
  house worldwide, including sitting foreign monarchs (two realms share one ruler).
- B37 `[C]` — maternal hazard can kill *other realms'* sitting rulers outside their death
  handler; the recovery path founds a new house instead of running succession.
  Root cause I37: person mortality scattered across five sites — centralize `killPerson()`.
- B34 `[U]` — culture forks `seedCulture()` whole settlements, wiping minority peoples
  and language mixtures in one tick.
- B40 `[U]` — `world.dynasties` never pruned; founders pinned forever (slow leak,
  empirically visible: 780 dynasties / 673 memberless at 24k steps).

### Events / historiography
- B88 `[U]` `entities.js:41` — `ensurePolity` silently resurrects ended polities on any
  bookkeeping read (`govOf` on hot paths). With B42, corrupts lifespans + the event log.
  Fix per I39: split read-only `getOrCreateRecord` from explicit lifecycle mutators.
- B43 `[C]` `historiography.js:56` — coordinate-less events (`era.reached`, `polity.ended`)
  bypass the information horizon: 132/132 heard worldwide. `distTo` treats "unknown
  location" as distance 0; B47 makes long-dead realms *omniscient* once their capital is
  pruned (null capital → 0). Missing location must mean deaf, not omniscient.
- B46 `[U]` `events.js:46` — compaction reassigns event ids → every deterministic
  historiography roll re-randomizes and the worker's ticker freezes. Needs permanent ids.
- B45 `[U]` — `know` clamped before the rumor test → 35% of even adjacent events are mere
  rumor. B44 `[U]` — three event types narrate as raw type strings. B48 `[U]` — sacked
  secession-born realms get a founding myth alongside their intact true origin.

### Tech
- B49 `[C]` `settlement.js:1406` — construction learning still keys off raw province
  population, defeating the documented urban-core (`sciSqrt`) fix.
- I92/I100 (empirical, both seeds) — **the mobility track is dead content**: max 0.31 at
  leading-era Modern; chariots (0.45) and cavalry (0.70) are never invented by anyone.
  The whole horse/steppe branch, `OPEN_RIDE` discounts, and `RANGE_MOB` never fire.
  Fix: saturate the horse-richness factor the way metallurgy treats thin ore, plus D75
  (industrial mobility channel: rail/steam open a horse-independent term).
- I41/D37 — knowledge/ore/crops diffuse only over the ROAD graph; sea lanes carry trade,
  plague and language but **no knowledge**. Diffuse over `mergeReach` weighted by link cost.
- I42/I87 — dead tech outputs: `defenseLevel`, `wealthMult`, `fishFactor`, and all five
  ability flags are computed, tooltipped, and consumed by nothing. Wire the cheap ones
  (D70: walls into siege defence; fish×fishFactor) or strip them.
- I43/D36 — Industrial/Modern health techs have zero mechanical expression; plague
  mortality reads no tech at all (crowding only ever makes it worse).
- I44 — `orgEraCap` welds statecraft to ore access: an ore-less region can never
  independently develop writing (Mesoamerica falsifies this).

### Worldgen coupling
- B61 `[C]` `state.js:268` — riverMag is POINT-sampled onto the sim grid (fert/tFlood are
  correctly max-pooled) → **~64% of major/great river tiles dropped**, fragmenting the
  navigable spine that territory reach, roads, and transport all depend on. One-line
  max-pool fix with large downstream effects.
- I53 — the pipeline's river moisture boost never reaches the sim's moisture channel.

### Trade networks
- B20 `[C]` `sea.js:182` — `luxuryGoal` reads `_seaReach` right after `updateSea` nulls it →
  the spice-quest "sated"/"already reachable" guards are dead code; directed colonisation
  over-fires forever.
- B22 `[C]` `roads.js:879` — `linkMoney` fallback orientation books third-party fees as
  coin that reached the higher-id settlement (money-flow lens wrong).
- I16 — multi-hop sea relays pay no entrepôt cut: the Venice/Malacca mechanism only fires
  on land paths, though the sea design doc names it as motivation. Record relay ports as
  `link.inter` during the transitive closure; the existing toll machinery does the rest.
- I17 — per-tile costs price worn roads *below* river barges and near sea ships (inverse of
  history), patched by `*_TRADE_MULT` volume multipliers in a second channel — re-derive
  from one freight model, then shrink the patches. I18 — `SEA_WOBBLE` injects cosmetic
  noise into a real cost input (move to renderer). I19 — village foot-path pass is
  unreachable for the villages it was written for.

### Performance (all `[U]`, profiled on 480×240; shipped grid is 4×)
- B79 `[C]` — `updatePolities` is a ~0.7s monolith whose Dijkstra area grows ∝ range².
- B78 — `SEA_MAX_PEERS=64` defeats the 12-partner trade bound (trade pass becomes #2 cost).
- B80/B81 — `updateSea` full-ocean flood in one tick; `relaxClaim` full-map ring scans.
- B82 — `techEffects` memo has ~0% hit rate (full-precision float keys).
- I81 — all interval passes share phase 0 → 174→1,197ms spike ticks on multiples of 600;
  fix is a deterministic per-pass phase offset (pure scheduling, no content change).
- I82 — the per-settlement per-tick economics (~27% CPU) recompute climate-static terms
  every tick; split slow/fast parts on the existing KNOW_INTERVAL stagger (~3-5× cut).
- I83 — the territory stack still recomputes every full-map layer per pass even when
  nothing changed (the spec made the DATA sticky, not the COMPUTE).

### History-shape pathologies (empirical, 30k-step runs)
- I97 — war saturates: 4 → 333 new wars/1000 steps; late-game is permanent all-pairs war
  (~6 new interstate wars per simulated year). Peace needs to be a system-level state
  (interdependence/exhaustion congresses — D81), not a per-dyad cooldown.
- I98 — hegemon ossification: one cradle #1 for 74% of samples, unbroken 13,800→28,500;
  polity mortality collapses 7× late. Needs a counter-force that *grows* with maturity
  (succession crises that can fork whole mature realms; nomad shock — D80).
- I99 — knowledge tracks hit the hard 1.0 ceiling and history freezes into a
  perpetual-1960; construction races ahead (0.99 by 15k) compressing Bronze→Medieval.
- I101 — ethnogenesis never slows (constant ~5 cultures/3k steps even at dev-1950);
  91% of organized faiths are stillborn.
- Positive empirical results worth recording: zero invariant hits / NaN / leaks across
  3 seeds × 30k steps; population S-curve fully emergent with the anchor OFF; coin supply
  equilibrates; eras advance purely off knowledge; registries bounded (except dynasties).

### Validation honesty (`tools/`)
- B64 `[C]` — the Zipf gate ranks *province* populations (urban+rural) under the default
  DISSOLVE model while claiming to test city sizes (the urbanization gate 30 lines later
  already corrects for this). Add Gabaix–Ibragimov rank−1/2 correction; band ≈ [−1.25,−0.75].
- B63 `[C]` — `earthRun.mjs` hand-rolls init and drops `tFlood`/`tAncestry` → long-run
  reports measure a floodplain-less world the browser never simulates. Use `buildSim`.
- I54 — every shape gate is soft; validate literally cannot fail on shape. Add a
  soft-warning budget as a hard gate; promote corrected gates to hard.
- I55–I59 — Zipf band fitted-to-pass; empire-tail statistic near-vacuous (score land-share
  distribution instead); lifespan bounds couple to argv STEPS and count interregna as life
  (B66); war gates unnormalized (400×-wide band, 2% crisis bar); urbanization band
  unconditioned on development (60% urban bronze age passes).
- I60 — validate runs one seed/resolution/preset, and at gate resolutions the two cradles
  fuse (B28). Assert cradle distinctness in smoke; gate on medians over 2–3 seeds.
- I49/I62/I77/D58 — the roundtrip hash covers a thin slice; add serialize→load→serialize
  byte-identity plus a **continuation-equivalence** gate (save at N, run both M further,
  compare extended hashes) — this single gate would have caught the entire §Save/load
  cluster and structurally prevents recurrence.

### Refuted (for the record)
- B16 (`FARM_RENT` granularity under-collection) and B21 (river-corridor pairs get
  redundant parallel roads) — both killed by verifiers with code evidence; do not act on.

---

## 3. Recommended removals / dead code

| What | Where | Why |
|------|-------|-----|
| `T.CAP_BASE` lever | tuning.js / conquest.js:200 | Read by nothing since the capacity refactor (I6). |
| `T.WAR_DEF_SPLIT` lever | tuning.js:155 | The only lever of 213 with zero readers; superseded by conserved army allocation (I46/I86). Delete or rewire as the DEF_PRIORITY dial. |
| `T.CAPITAL_ANCHOR` ("Country compactness") | countryTerritory.js:449 | Dead in every browser configuration (`SIM_CAPITAL_ONLY` env-gated) (I22). |
| `OUT_MILITARY`, `localPByCountry` | money.js / inflation.js | Never recorded / never called; stale comments promise disabled wage inflation (I15/I88). |
| `OVERSEAS_INDEPENDENT_RATE` | crystallize.js:144 | Dead since the joinCountry gate; either delete or restore a true independent-genesis path (I26, ideas D20/D77). |
| Dead tech channels + ability flags | tech.js | `defenseLevel`/`wealthMult`/`fishFactor`/5 booleans consumed by nothing — wire or strip (I42/I87). |
| `SEA_WOBBLE` from the cost field | sea.js:257 | Cosmetic noise inside a sim input; move to renderer (I18). Note its seed reads `world._seed`, which doesn't exist (B60). |
| Smoke's DISSOLVE re-test block | smoke.mjs:157 | Re-tests the default config against a fitted constant (~⅓ of smoke runtime); repurpose to test the *legacy* model (I61). |
| Stale docs statuses | docs/*.md | coerced-labor, farming-region-dissolution, persistent-territory all say "proposal/not started" but are implemented and default-ON (I90). |

## 4. Recommended restructures (root-cause fixes, not patches)

- **R1 — Declarative persistence registry.** Every save/load bug above shares one root:
  state is created in mechanism files but must be remembered in persist.js. Let modules
  register their persistent fields/tables at definition site; persist.js iterates the
  registry. Pair with the continuation-equivalence smoke gate and a save-version
  `migrate()` ladder (currently any schema change bricks all saves — I51). (I50/I78/I69)
- **R2 — Polity lifecycle API.** One authority: `getOrCreateRecord` (read-only) vs explicit
  `foundPolity/endPolity/restorePolity` that always log. Kills B42/B88 and the dead
  reconcile branches, and un-corrupts every lifespan statistic. (I39)
- **R3 — Split render from rule.** `_countryClaim` is documented render-only but decides
  allegiance (B23, I21). Give adoption an "administered tile" test derived from the
  persistent owner map + a logistics-derived integration delay.
- **R4 — Person lifecycle.** Centralized `killPerson()` + a per-pass `sittingRulers` set;
  roster caps become breeding gates, never removal of the living. (I37; kills B35/B36/B37)
- **R5 — Consolidate empire stabilizers.** Two channels with physical meaning (coercive
  capacity; institutional hysteresis) instead of seven overlapping fitted ones; vassalage
  (D2) replaces lopsided engulfment. (I0/I1/I2)
- **R6 — Political-map pass order.** Stamp persistent worked-land cores FIRST, then run
  reach/recolor/gap passes only over marches; measure which corrective passes are still
  needed. (I20)
- **R7 — Granularity audit.** Mechanical `_dt`/`_ivl` sweep over the ~10 confirmed
  violations + a G-equivalence smoke check.

## 5. Ideas backlog (judged editorially against the cardinal rules)

**Tier 1 — high payoff, clean mechanisms, moderate cost:**
- D4 *Demographic transition* — growth rate bends with urbanization/org/food-security
  (fixes "Malthusian forever", I10). Complements the existing emergent-K escape.
- D2 *Vassalage/tributary submission* — the mechanism that retires lopsided engulfment.
- D0/D62/D72 *War pays and peace costs* — sack plunder, truce indemnities/tribute from the
  exhausted loser (conserved transfers; gives wars economic consequences; helps I97).
- D80/D76 *Pastoral nomad confederations* — the missing hegemon-killer and the natural
  consumer of the (currently dead) mobility/steppe branch; fires only where steppe + horses
  + wealth gradient co-occur.
- D17 *Naval contiguity by navigation tech* — fixes the mare-nostrum wipe as a mechanism.
- D21/D53 *Knowledge- and pressure-driven pioneering* — replaces the COVERAGE_RAMP clock.
- D23 *Migration carries identity* — population flows move culMix/faithMix/langMix shares
  (diasporas, creole ports; fixes colonies reborn folk-pagan, I32).
- D36/D57 *Health tech + sanitation-gated urban mortality* — cities as demographic sinks
  until public-health tech; gives Industrial/Modern tech real meaning (I43).
- D40 *Vulnerability-driven famine* — hazard ∝ pressure × climate downturn × soil fatigue ×
  granary depth, replacing the flat dice roll.
- D8 *Scarcity-responsive grain prices* + D5/D11 *in-kind levy → monetised tax arc* —
  fixes pre-coinage cities (I7) and gives states a historical fiscal evolution.
- D78 *Arid-floodplain cradle scoring* — the mechanistic fix that lets EARTH_HEARTHS
  default OFF (with D79's physical hearth separation).
- D58 *Continuation-equivalence CI gate* — cheap, prevents the whole §1 class forever.

**Tier 2 — worthwhile, larger or more speculative:**
- D1/D28/D29 dynastic politics with teeth (crisis casus belli, claimant contests, personal
  unions) — makes the kin graph politically live (I36).
- D3 supply-limited fronts (capture budget decays with attacker transport cost).
- D9/I13 slave market cleared over the actual trade network with distance pricing.
- D12 canals; D13 piracy/convoys; D15 desert caravans; D14 tech-extended navigability.
- D16 march upkeep (unadministered claims fade); D18 march warfare over empty frontier.
- D19/D41/D66 per-tile improvement capital (irrigation works as the positive twin of soil
  fatigue; conquering a developed valley worth more than wilderness).
- D32 news travels the trade network, not euclidean space; D33 archive capture on conquest;
  D34 literacy-gated record density; D35 rumor distorts content.
- D24 literate languages drift slower; D26 persecution-driven emigration; D27 court
  conversion as a contested event; D82 scriptural canon → faith survivability.
- D63 velocity-scaled coin wear (hoards decay, circulating coin doesn't); D43 insecurity
  hoards; D61 ruin hoards (closes the settlement-death drain).
- D47–D52 new validate gates: population-vs-development shape, price stability, trade share
  conditioned on transport tech, Richardson war-deadliness tail, culture-count scaling,
  settlement-clustering CV.
- D67–D69 performance: state-driven settlement LOD, active-front border crawl,
  change-driven maritime rebuild.
- D74 colonies inherit founder disease load; D75 industrial mobility channel.

**Tier 3 / long-horizon:**
- D77 *Emergent agricultural hearths* — remove cradle seeding entirely; farming is invented
  where wild-cereal floodplain + forager density + circumscription co-occur. The purest
  expression of the project's premise; large effort, do after D78 proves the scorer.
- D20 second-genesis hearths on isolated landmasses (bounded version of the same).
- D54 contact-diffused modernity field (the full fix for I4 beyond per-realm org).

## 6. Suggested implementation order

1. **Wave 1 — Truth and persistence (highest leverage, mostly mechanical):**
   B19, B52/B75, B11/56, B15, B27, B53, B54, B55, B68 + R1 registry + migrate() +
   continuation-equivalence gate (D58). Then R2 lifecycle (B42/B88) — this alone
   un-corrupts the history statistics everything else is tuned against.
2. **Wave 2 — Cardinal-rule cleanups:** inflation state-gate; COVERAGE_RAMP → D21;
   cradle separation + D78 scoring (+ smoke distinctness assert); per-realm identity
   salience; granularity audit R7.
3. **Wave 3 — Correctness in the hot systems:** B61 river max-pool; B23/B25/B24 + R3/R6
   territory; B5/B6/B7/B9 demography-food; B32/B33 + B35–37/R4 identity+dynasties;
   B43/B46/B47 historiography; B20/B22/B13 trade; dead-code removals (§3).
4. **Wave 4 — History shape:** war saturation (D81 + D0/D62), hegemon ossification
   (D80 nomads + mature-realm fracture), mobility revival (I92 fix + D75), demographic
   transition (D4), tech-ceiling behavior (I99).
5. **Wave 5 — Validation hardening + performance:** §Validation fixes, phase offsets
   (I81), economics fast/slow split (I82), dirty-flag territory (I83), sea/trade caps.

---

*Appendix (full finding detail): `docs/review-2026-07-appendix/bugs.txt`,
`issues.txt`, `ideas.txt`, `subsystem-summaries.txt`. Finding IDs there match the
B/I/D numbers used above.*
