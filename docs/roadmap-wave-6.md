# Wave 6+ — design for everything the review left open

Status: **designed, not started.** Companion to `docs/review-2026-07-civ-engine.md`
(finding ids B/I/D-** refer to it). Every mechanism below states its EMERGENT
gate (what world-state fires it — never a step, year, or era) and what existing
machinery it reuses. Ordering is by dependency and payoff; each phase is a
mergeable unit with its own measurement.

Legend: effort S/M/L · every phase ends green on `npm test` + `npm run validate`.

---

## Phase W6-A — Instruments first (S)

New validate gates land BEFORE the mechanisms they will judge, so every later
phase is measured, not vibed. (D47–D52, B63, B65 residue)

1. **Population-vs-development shape** (D47): sample (leading agriculture,
   total pop) during the run; gate that pop is near-flat below mid agriculture
   and has its growth-rate maximum in the top development band. Emergent axes
   only — a slow world traces the same curve later and still passes.
2. **Price stability & market integration** (D48): population-weighted global
   price level stays in [0.4, 3.0] after the baseline locks; price DISPERSION
   across components falls as trade connectivity rises (within-run correlation).
3. **Trade share of economy** (D49): Σ|linkMoney| / total income, banded by the
   run's own median transport knowledge (low-transport worlds held only to the
   low band).
4. **Culture scaling** (D51): culture count sublinear in settled area;
   culture-population sizes heavy-tailed.
5. **Settlement clustering** (D52): promote earthRun's nearest-neighbour CV
   (≥ 0.5 = river/coast clusters, not uniform packing).
6. **War deadliness** (D50) — needs a small logging addition: accumulate front
   casualties per warring pair in armies.js and emit `war.ended {dead}` when a
   front dissolves or a truce signs; gate a heavy-tailed CCDF vs contemporaneous
   population. (This logging also feeds Phase D's indemnity scaling.)
7. **Multi-seed medians**: `STYLIZED_SEEDS=8817,4242` env — run gates per seed
   at reduced STEPS, score medians. CI default stays one seed; the cron/manual
   deep run uses three.
8. **earthRun parity** (B63): replace its hand-rolled init with `buildSim` so
   long-run reports measure the world the browser actually simulates.

## Phase W6-B — Cheap realism wins (S/M)

1. **Ideas travel by sea** (I41/D37, S): knowledge diffusion, ore-knowledge
   merging (`effectiveLocalRes`), and crop adoption iterate `mergeReach(s)`
   (roads already merges road+sea reach for trade) instead of `_tradeReach`,
   with per-partner pull × `exp(-linkCost/K)` so a hard crossing trickles and a
   busy strait floods. Self-calibrating: the channel exists only where the sea
   system already built a lane. *Expect:* island/coastal civilizations converge
   with the mainland; Japan-pattern catch-up becomes possible; the tech-gradient
   gate stays negative but shallower along coasts.
2. **Health technology is real** (D36 + D57, M):
   - Add `TECH_FX` relief entries for aqueducts / sanitation-line / germ_theory
     / medicine (they exist as techs with zero effects).
   - `shocks.js`: plague mortality and infection probability × (1 − relief);
     germ_theory additionally blunts the PLAGUE_URBAN crowding multiplier.
   - **Urban mortality ceiling** (D57): a chronic per-tick mortality drag
     ∝ endemic `_diseaseLoad` × log(urban core) × (1 − relief) in
     updatePopulation — big cities are demographic sinks fed by rural inflow
     until public health arrives, exactly when and where a society earns it.
   *Expect:* pre-modern metropolises cap themselves and need migration to grow;
   industrial-era cities finally boom. Watch the urbanization gate's industrial
   band.
3. **Venice gets paid** (I16, S): during the sea transitive closure, record the
   relay-port chain on each multi-hop link as `link.inter`; `sellGoods` already
   tolls/brokers intermediates. *Expect:* strait/junction ports grow rich on
   carrying trade — visible as wealthy chokepoint cities on the money lens.
4. **Walls are real** (D70/D39, S): defence side of a siege ×
   (1 + defenseLevel × WALL_W); the attacker's gunpowder already enters the
   channel as negative fx, so the castle age ENDS itself per-theatre when a
   neighbour's alchemy/metallurgy matures. *Expect:* walled city-states
   survive longer pre-gunpowder; siege durations stretch then collapse.
5. **Continuous disbursement** (I93, S): army wages accrue and pay on the
   MUSTER cadence rather than once per polity pass; works/dole stay per-pass.
   *Expect:* the civilian-coin sawtooth (22–78% of supply pulsing through
   treasuries) flattens; Hume flows and prices stop breathing at 150-tick
   period.
6. **Nothing vanishes** (D61 + B72 + B73/I48, S): a dying settlement banks its
   coin into a persisted per-tile RUIN HOARD; any settlement whose territory
   later covers the tile recovers it at a rate × its organization (excavation,
   squatters, stone-robbing). Ships in transit, captives, unfree, and hoards
   fold into the conservation watch — the closed supply is finally CLOSED.
   *Expect:* fallen-city sites become worth resettling; the invariant totals
   stop breathing when colony ships launch.

## Phase W6-C — Rise and fall, part 1: VASSALAGE (M) — D2, retires I2, feeds R5

The engulfment override (`LOPSIDED_*`) is deleted and replaced by the mechanism
it was papering over: a statelet facing hopeless odds SUBMITS.

- **Trigger (all live state):** during the threat/absorption pass, statelet S
  submits to dominant neighbour H when (a) `countryPower(H)/countryPower(S) ≥
  SUBMIT_RATIO` — the same power measure war uses; (b) no coalition protects S
  (`_allianceTarget`/bloc data already computed); (c) H can project there
  (capital transport cost within its hold reach — the admin field, reused);
  (d) willingness scales INVERSELY with `absorbResistance` (kin submit,
  foreigners resist longer). SUBMIT_RATIO ≈ 5: symmetric with the existing
  INDEP_POWER_RATIO — the ratio past which resistance is demonstrably hopeless.
- **What it means:** reuse the colonial-dependency plumbing wholesale —
  `pol._overlord`, tribute stream (existing TRIBUTE_FRAC), `bonded()` (no
  fronts inside the pair), bloc membership, overlord power projected in the
  vassal's defence (updateAlliances already excludes overlord links from
  balancing). The vassal keeps court, faith, personality — internal sovereignty.
- **Exits, all existing:** the independence line (power vs projected force)
  frees strong/distant vassals; overlord death frees all (rebuildOverlords
  already validates); full annexation only through the normal absorb path once
  generations of assimilation have lowered identity resistance.
- **Retire the patches:** delete LOPSIDED_ENGULF / ENGULF_PROB /
  LOPSIDED_HEADROOM; absorbWeakNeighbors respects capacity headroom at 1.0.
- **Map/UI:** vassals keep their colour; realm inspector shows suzerain
  (field already exists for colonies); optional border tint later.
- *Expect:* the late-game map organizes into suzerainty networks instead of
  the statelet-vacuuming engulfment; tribute pyramids appear (a vassal of a
  vassal); wars of independence become a story class. Measure: empire land-share
  gate unchanged or better; statelet count stops cliff-dropping late-game.
- **R5 follow-up — BUILT + DEFAULT-ON (`T.CAP_MODEL`).** The rank-relative dominance
  tail (`CAP_DOM_W/P` — the review's clearest fitted constant, a bare `^1.5` exponent)
  is replaced by a grounded derivation: a realm towers over its peers because it EXTRACTS
  more fiscal surplus than they do (last-pass revenue vs the peer median — Tilly) AND has
  the LOGISTICS to project it, the two COMPOUNDING (`dominance` carries a term ∝
  `CAP_LOG·logistics·fiscalSurplus²`). That compounding is where the increasing-returns
  CONVEXITY now comes from — a **mechanism, not an exponent** — and it predicts, correctly,
  that sprawling integrated mega-empires only emerge once the reach techs exist (bronze-age
  hegemons stay small; the rail age towers). The coefficients (`T.CAP_FISC=0.40`,
  `T.CAP_LOG=3.0`) are physical (capacity per unit fiscal surplus; logistics reach-
  compounding), calibrated against the size gates — not a shape dialled to one outcome.
  **Validated + flipped:** all 3 seeds (8817/31337/4242) hold at 1 soft warning with healthy
  size gates on every seed (Zipf in-envelope, heavy tails, positive market-integration). It
  shifts the distribution toward somewhat larger hegemons (8817 largest-empire share 23%→33%,
  well inside the gate — arguably more historically heavy-tailed). Fully reversible: `CAP_MODEL=0`
  recovers the fitted `CAP_DOM_W/P` byte-for-byte (round-trip `28abc46d`/`ef4fc665`). `gov._lastRevenue`
  rides the wholesale polity serialize, so save/load round-trips (default `f057635`/`d489b985`);
  `probe_hashbase` moved to `5045e8aa`/`ef8e169b` (the grounded model is the first change to
  touch the 2500-step guard, since states differentiate in capacity before dynasties form).

## Phase W6-D — Rise and fall, part 2: NOMAD CONFEDERATIONS (L) — D80/D76

The hegemon-killer, and the consumer of the now-living mobility branch. Not a
new entity type — a POLITY MODE derived from what its people actually are.

- **Classification (derived every polity pass, never stored as destiny):** a
  realm is `_nomadic` when the majority of its members sit on steppe tiles
  (OPEN_RIDE terrain class × fertility below the farming floor × horses
  reachable) AND its riding is real (mobility ≥ the chariot gate). No steppe,
  no horses, or no riding → never fires, on any map.
- **Stage 1 — the steppe advantage:** for nomadic realms, admin/hold cost over
  OPEN_RIDE terrain uses the ride-discounted transport params (already in
  transport.js) — the steppe is their sea. Military might already scales with
  mobility through the tech `military` channel (live since Wave 4).
- **Stage 2 — the raid/tribute economy:** nomads farm little (their land
  can't); instead, adjacent settled realms within horde reach face a periodic
  choice resolved by power ratio: pay TRIBUTE (conserved transfer, reuses the
  vassal stream — the Xiongnu treaty pattern) or suffer RAIDS (conserved
  plunder + captives via the existing slave-raid machinery, at horde scale).
  Intensity ∝ the wealth GRADIENT between steppe and sown — a poor rim breeds
  no hordes.
- **Stage 3 — surge and shatter:** momentum (bankMomentum) counts double for
  nomadic realms — confederations are charisma-glued winning streaks — so a
  successful raid season snowballs submissions (vassalage machinery from W6-C
  is the join path). And a nomadic realm in succession CRISIS fragments
  wholesale (fragmentRealm probability × crisis × nomadic) — the post-khan
  shatter. Sedentarization is free: conquer enough farmland and the
  majority-member test flips `_nomadic` off next pass (the Yuan arc).
- *Expect:* periodic steppe eruptions that stress mature empires exactly when
  they're rich; tribute lines on the money lens pointing from civilization to
  the steppe; short-lived continental hordes that fragment into successor
  khanates. Measure: late-game hegemon tenure (#1-holder share) drops further;
  fallen-polity heavy tail widens; war deadliness gate (W6-A) shows horde-scale
  spikes.
  > STATUS: stages 1-3 landed in earlier waves, but the classification was
  > measured DEAD — 0 hordes over 24k steps on 2 seeds (tools/probe_nomads.mjs):
  > the seat-tile test required the realm's strongest member to sit on saddle
  > ground with a horse DEPOSIT in its own catchment, a ~zero-probability
  > conjunction (courts seat in the sown; the deposit is a sparse trade
  > commodity, median fert 0.70, barely overlapping the ~40% of land that is
  > saddle-country). Fixed as T.NOMAD_FIELD (default on): nomadic = court rides
  > (chariot-gate mobility, itself horse-gated at the knowledge source) AND the
  > majority of GOVERNED PEOPLE (popField over held tiles — same substance as
  > POW_FIELD/CAP grounding) live on saddle-country. Measured revival: 1-4
  > hordes per world from ~t=15k, 28-29 raids by 24k (was 0 ever); shatter arm
  > awaits a crisis coincidence. Sedentarization still emergent (people-majority
  > flips off with conquest of the sown).

## Phase W6-E — The pre-coinage economy + prices + famine (M)

1. **In-kind levy → monetized taxation arc** (D5/D11, fixes I7):
   - foodHierarchy: a liege may REQUISITION `levyShare = f(liege organization)`
     of each child's grain offer without coin, capped by a peasant-retention
     floor (children always keep subsistence × RETAIN; over-levy feeds the
     existing unrest machinery). Coin purchase EXTENDS flow beyond the levy as
     money spreads — the temple-economy → market arc, gated purely on org and
     monetization.
   - Fiscal: the cash-tax share of a settlement's contribution scales with its
     own monetization (coin stock vs reserve, trade connectivity); unmonetized
     provinces contribute grain (feeds granaries/armies), not coin. Early
     states can eat but not hire; standing armies await coinage.
   - *Expect:* pre-coinage cities finally exist (they were impossible —
     "no coin, no grain"); the tribute-empire vs cash-empire distinction
     emerges; debasement pressure arrives WITH monetization.
2. **Scarcity prices** (D8, S): grain price × clamp(regional demand/supply,
   0.5, 3) from the pools foodHierarchy already computes. Conserved — prices
   redistribute coin toward breadbaskets in dearth. *Expect:* famines enrich
   grain sellers, sieges spike local prices, the wheat ticker means something
   locally.
3. **Famine as vulnerability** (D40, S): per-settlement hazard ∝ (people/K
   pressure) × climate downturn × (1 + soil fatigue) × granary emptiness,
   replacing the flat dice roll (base rate recalibrated so a reference-condition
   world matches today's frequency — the DISTRIBUTION moves, not the mean).
   *Expect:* famines strike the over-extended and exhausted, cluster in bad
   climate epochs, and chronicle causes read true.

## Phase W6-F — Dynastic politics with teeth (M/L) — D1/D28/D29/D30/D31, I36

The kin graph finally does politics. All triggers are house state.

1. **Claimant wars** (D28+D1): on succession crisis or contested accession,
   enumerate living claimants through the existing tree (passed-over cadets,
   women's sons under agnatic law, foreign rulers married into the line). The
   strongest EXTERNAL claimant's realm gains a succession casus belli — a
   war.began annotated `succession` with a real attack-bar reduction for a
   bounded window — and victory CROWNS the claimant in the defender's realm
   rather than annexing it.
2. **Personal unions** (D29): when one person legitimately holds two thrones
   (claimant victory, or an heir inheriting both), the realms bond (no fronts,
   shared bloc — the overlord-bond plumbing, symmetric). On the union monarch's
   death: split to separate heirs, or MERGE if legitimacy ran high in both for
   a generation (the Castile-Aragon arc). 
3. **Regencies** (D30): a minor on the throne zeroes the ruler-trait weights,
   dents legitimacy, and reads as weakness to neighbours' war appetite.
4. **Remarriage** (D31): widowed monarchs remarry with probability ∝ measured
   heir scarcity — crises stay common enough to matter, rarer than mortality
   alone implies.
- *Expect:* wars OF succession, not just wars DURING succession; unions and
  inheritance empires; the validate crisis-war gate rises from ~7% toward
  historical prominence. R4 lands here too: one `killPerson()` for every death
  site (closes B41's double-breeding while touching the same code).

> **Session-5 status.** killPerson/B41, remarriage (D31) and regencies (D30) are
> DONE + reviewed. **Claimant wars + personal unions (D28/D1/D29) are BLOCKED on an
> unstated precondition** and were implemented-then-reverted after a probe showed the
> mechanism is inert. Root cause (measured, seed 8817, ~12k steps): the sim's dynasties
> are **realm-siloed** — every realm has its own house, **no house ever rules more than
> one realm**, and a sitting ruler almost never has a *housed* foreign consort (foreign
> matches overwhelmingly generate a house-LESS in-law via `makeAdult({foreign:true})`,
> not a real foreign-heir marriage). So the cross-realm blood/marriage kin a dynastic
> claim needs (a cadet branch reigning elsewhere; a foreign king wed to the disputed
> line's princess) essentially never exists at the moment of a contested succession →
> **zero claims fire** even after broadening the trigger and raising `FOREIGN_MATCH` to
> 0.6. PREREQUISITE: enrich the royal marriage market so foreign matches routinely wed a
> REAL foreign-house heir (retaining their birth `dynastyId`) instead of a houseless
> generated consort — that is what seeds the cross-realm kin graph the whole feature
> stands on. Only once housed cross-realm ties are common should claimant wars be rebuilt
> (the reverted design — realm→realm `_succClaims` claim keyed on a contested succession,
> an `claimBarOf` succession casus belli in the armies.js attack-bar product, a submit-
> pass-style power-gated resolution that `crownForeign()`s the claimant into a personal
> union via the `_overlord` no-fronts bond, union split on the monarch's death / merge via
> the normal absorb path — was sound; it just had nothing to fire on). Lever it behind
> `T.CLAIMANT_WARS` per the size-distribution caution below.
>
> **DEFERRED (owner decision).** Claimant wars / personal unions are consciously parked, not
> abandoned: the prerequisite is a real subsystem change (the royal marriage market), not a
> tweak, and it is the right next *feature* effort — but it is being sequenced AFTER the
> remaining W6-G structural work. The full prerequisite + rebuild design lives in
> `docs/marriage-market-cross-realm.md` (three fix directions, an acceptance probe, and the
> reverted claimant-wars machinery to restore on top). The hashWorld hardening this session
> (C1/C1b — persons + dynasties now hashed and round-trip-verified via
> `tools/probe_roundtrip_deep.mjs`) was done deliberately FIRST, so that when the marriage
> market is built a dynastic determinism or persistence regression is caught immediately.
> **Resume trigger:** when dynastic content is prioritized over structure — start by re-running
> the dynasty probe to re-confirm the "0 houses rule >1 realm" baseline, then fix direction 1
> (widen `world._royalCourt` to living house members across realms) and re-measure.
>
> **Session-6 status — the marriage market is BUILT behind `T.CROSS_REALM_HEIRS` (default off).**
> Baseline re-confirmed (`tools/probe_marriage.mjs`: 0 houses ruling >1 realm, ~0–1 live housed
> consorts). Two enrichments under one lever: **(1)** widen the court pool to every eligible member
> of every *reigning* house (not just the monarch's children); **(2) heir-reach** — the reigning
> monarch's DIRECT children marry abroad like the monarch (cross-court couples bred once, husband's
> side — B41). **Off = byte-identical** (hashbase `6df86092`/`82c7f3f`, deep round-trip
> `d69f113`/`9c5ecf94`, validate 8817=1/31337=2 — all baseline); the **on-path itself** is
> deterministic, round-trips, zero invariant violations. **On** takes the cross-court marriage flow
> to ≈**3× baseline** (8817 46→150, 31337 35→143 `dynasty.union` events) and live cross-realm
> consorts to ≥1-present ~half the time (mean ~0.6–0.8; ≥2 "multiple" 15–24%). TWO findings persist:
> (a) the live stock plateaus (bounded by consort mortality) rather than climbing with the flow —
> but the *descent* kin each of ~150 marriages plants seeds the graph a claim enumerates over;
> (b) `houses ruling >1 realm` stays 0 by construction — no succession path seats an existing house
> on a second throne, that is the `crownForeign()` half of claimant wars, not a marriage-market
> output. **Default stays off**: the richer flow trips 31337's fragile size-tail/market-integration
> gates past budget (chaos — it *fixes* 31337 clustering; 8817 unaffected); flip only after the
> gates hold on 3 seeds (same rule as `T.CLAIMANT_WARS`). Full measurements in
> `docs/marriage-market-cross-realm.md`. **NEXT: claimant wars** — the reverted `_succClaims` /
> `claimBarOf` / `crownForeign` design (below) now has a seeded kin graph to fire on; build it behind
> `T.CLAIMANT_WARS` (default off), gate on kin + who sits which throne, and it is what finally makes
> `houses ruling >1 realm` non-zero (the personal-union output).
>
> **Session-6 status — CLAIMANT WARS + PERSONAL UNIONS BUILT behind `T.CLAIMANT_WARS` (default off).**
> Four parts (all byte-identical off; deterministic / round-tripping / zero invariant violations on):
> (1) shared-house infra — `primaryRealmOf`/`rulerPrimaryRealm` so a house or a shared monarch on two
> thrones is bred/reaped/buried ONCE (from the primary realm), maintenance guards, and an `eligible()`
> bar so ordinary succession never makes an accidental union; (2) inherited thrones (D29) on a full
> extinction; (3) the succession casus belli (D28) — `world._succClaims` + `armies.js` `claimBarOf`
> cuts the claimant's attack bar, `war.began` annotated `claim`; (4) personal unions + the CONTESTED-
> ACCESSION takeover (the driver) — a sitting sovereign can inherit (a union that splits on death) and
> a strong foreign blood-claim can win a faltering local succession, with `crown()` preserving a
> reigning monarch's accession year and the union splitting naturally when the primary pass buries the
> shared monarch. **Measured:** `houses ruling >1 realm` present ~39 % of the run on 8817 (mean 0.55,
> peak 3). **Stylized with BOTH levers on held on 3 seeds** (8817/31337/4242): all hard gates pass,
> 1 soft warning each — a NET IMPROVEMENT over baseline on 31337 (2→1) and 4242 (2→1) — so per the
> 3-seed rule **both defaults were FLIPPED to 1** (cross-realm dynasties now ship in every history;
> `tools/stylized.mjs` honours the `CROSS_REALM_HEIRS`/`CLAIMANT_WARS` env for measuring the off-path).
> Fully reversible (levers = 0 → the throne-siloed round-trip `d69f113`/`9c5ecf94`); `probe_hashbase`
> is unaffected (pre-dynasty at 2500), `probe_roundtrip_deep` re-baselined to `8500addf`/`67de64f6`.
> **Tier-1 completion (done):** neighbour-preferred royal marriages (`MARRY_REACH_FRAC`) cluster the
> kin where war can reach — lifting the **crisis-war gate** (8817 7.7 %→12 %, 31337 4.8 %→9.2 %) and
> houses ruling >1 realm (39 %→55 %) — and `crownForeign` now resolves a besieged succession war into
> a personal union (off `world._fronts` + capital `_siegeAt`, byte-identical when it doesn't fire).
> All 3 seeds still within budget. **Power-gated `crownForeign` (`CLAIM_POWER_WIN`, default on)** then
> replaced the "remaining nice-to-have": a decisively-winning claimant (live claim + serious front +
> Σ`settlementPower` ≥ `T.ABSORB_DOMINANCE`× the defender, read off `world._countryPow` — no new
> constant) installs the union WITHOUT a full capital siege, ≈2×-ing the war-driven-union flow
> (claimant wars won 2→4 on 8817 at 480×240). It does NOT raise the crisis-war gate — faster union
> resolution leaves fewer independent realms to have crises — so that metric is flat/slightly lower;
> the gain is the union flow (the honest measured finding). Default-off sub-lever until the 3-seed
> validation held (all pass every hard gate at 1 soft warning), then flipped; fully gated (inert with
> `CLAIMANT_WARS=0`), and byte-identical at the byte-identity-gate scales (`probe_hashbase`
> `6df86092`/`82c7f3f`, default `probe_roundtrip_deep` `28abc46d`/`ef4fc665`, the power path dormant
> there). Full detail in `docs/marriage-market-cross-realm.md`.

## Phase W6-G — Structure & performance (M/L)

1. **Declarative persistence** (R1): modules register their state once
   (`persistField("settlement","_credit")`, `persistWorldMap("_truces")`,
   `persistTypedArray("_soilFatigue", Float32Array, {sparse: 0})`); persist.js
   and hashWorld iterate the registry. Same JSON schema (v2) — a refactor, not
   a migration.
2. **Political-map consolidation** (R6/I20): stamp persistent worked-land cores
   FIRST, run reach/recolor/gap passes only over marches, then measure which
   corrective passes (fillEnclosedWaste / closeRealmGaps / re-smoothing) still
   fire and delete the dead ones. Success = same map quality (border length,
   land share, screenshot diff) with fewer passes.
   > **MEASURED 2026-07-25 — no dead passes; the prune target does not exist.**
   > Changed-tile tallies now live in the passes themselves (world.debug.carto,
   > counters only) and `tools/probe_carto.mjs` reads them per window. At 480,
   > seeds 8817 + 31337, 8k steps: ALL three live passes do real work that
   > GROWS with map maturity — smooth ~480-495 tiles/1k steps mature (the
   > workhorse; 1955-2113 total), gaps near-zero pre-maturity then 75-170/1k
   > once realms actually border each other (252-334 total — it looked dead
   > only while there were no neighbours to partition), waste 30-100/1k late
   > (176-218 total). `smoothPinned` measured 0 — but its only caller is the
   > legacy lever-off path (the A/B contract), not deletable dead weight.
   > Verdict: R6's prune half CLOSES as "measured alive, keep all three";
   > the counters stay, so any future cartography change re-measures in one
   > probe run. Perf effort goes to the tile-bound passes (B80/B81) instead.
3. **Adoption off the render layer** (the deeper fix behind grownLiveOwnerAt):
   a tile is "administered" once it has been inside `_countryOwner` for a
   logistics-derived integration delay; adoption reads that, and the claim
   crawl goes back to being pure paint.
4. **Perf, in order of measured value:** ~~settlement economics fast/slow split
   (I82)~~ **— MEASURED and largely dead byte-identically; see the I82 verdict
   below.** The remaining reducible passes are tile-bound and do NOT touch the
   emergent economic trajectory: incremental sea flood (B80 — budgeted heap pops
   across ticks, publish lanes on completion); frontier-set border crawl (B81);
   sea trade top-K peers (B78 — keep 64 lanes for topology, trade the best ~16 by
   value). Prefer these over I82.
   > **RE-MEASURED 2026-07-25 (the 1920/30k battery's own per-pass profiler,
   > mature era ≥24k, both arms): the B80/B81/B78 premise is STALE.** Top
   > passes when sampled in the top-3: settlements ~82 ms/tick (I82 — closed),
   > **armies 43–59 ms**, **roads 11–23 ms**; territory ≤3.3, trade ≤2.2 —
   > and the claim crawl (B81) and sea flood (B80) never enter the top-3 at
   > all. The next perf arc, if wanted, is ARMIES then ROADS, each behind its
   > own byte-identity proof (or an honestly-gated trajectory change) — not
   > the B-list. Fingerprints live in every battery's series rows (`slow:`).
   >
   > **DEEPER 2026-07-25 (function-level `--cpu-prof`, two 600-tick windows on
   > the 30k 1920 snapshots): the pass labels above are themselves
   > MIS-ATTRIBUTION.** Both windows had ZERO active fronts yet read
   > `armies:101–126ms` — the armies/roads EMA labels hold spikes and swallow
   > unbracketed neighbours; no armies function appears in the top-25 samples.
   > The real mature-era rocks per tick: **stepPopField ~43–45 ms** (the field
   > substrate — strided already, I82-class), the **edge-cost family ~42–53 ms**
   > (`_edgeCost`+`localEdgeCost`+`_paramsFor`+`_tileMode`, spread across the
   > catchment Voronoi, `capitalTransportCosts` ≤13 ms, and `findPath`), and
   > **computeTerritory 7–31 ms**. Named open question: `findPath` (roads.js)
   > samples ~4.5–7.5 ms/tick in windows whose `roads` pass-label reads
   > ~0.1–1.2 ms — it is being called from OUTSIDE the roads bracket; find the
   > caller before optimizing anything.
   >
   > **NEGATIVE RESULT, measured and reverted (same day): per-tile
   > static-terrain caching of `_edgeCost` is a REGRESSION.** Precomputing
   > mode/relief-polynomial/climate-penalty/ridge-excess/river-mult into
   > Float64 arrays (byte-identity held: hashbase `4dbe3ec3`/`fe5627fe`
   > unchanged) made the family SLOWER — self-time 31.9s→40.3s (+26%), wall
   > 126.2→138.9s (+10%) on the identical window — scattered cold Float64
   > loads lose to recomputing from the already-hot Float32 terrain arrays,
   > and the per-edge cache fetch itself sampled at 5.2s. `_edgeCost` is
   > compute-lean and memory-tight as written. The honest reduction path is
   > FEWER CALLS (caller cadence and reuse), not per-call micro-caching.
   >
   > **RESOLVED 2026-07-25 — the findPath "mystery caller" does not exist; the
   > measurement method was the lie.** Static: `findPath` is reachable ONLY via
   > `maybeBuildRoads` → `tryAddRoad` (≤2 new + ≤1 shortcut probes per planned
   > settlement) and `linkCloseNeighbours` (one probe per unconnected/Gabriel
   > close peer). The call-tree walk (`tools/prof_aggregate.mjs
   > --callers=findPath`, 600 ticks on a fresh 30k/1920 snapshot — seed 8817,
   > Renaissance, 155 setts) confirms exactly two ancestors: tryAddRoad 3.62 s
   > and the forEachNear visitor (= linkCloseNeighbours' callback) 1.01 s
   > self+desc = 7.7 ms/tick, ALL inside the roads bracket. The paradox was the
   > SAMPLER: `world.debug.pass` holds ONE tick and the battery's `slow:` field
   > samples it once per 250-step series row, while road planning is expensive
   > only while the plan queue drains (1 settlement/tick, PLAN_INTERVAL 240,
   > backoff ≤8×) — every-tick bracket stats (`tools/profile_window.mjs`, new)
   > read roads mean 8.9 ms / median 0.5 / p95 71: the sampled label sees the
   > median, a function profile sees the mean, and both are true. (The armies
   > bracket also spans the wealth-delta loop + pruneDead, so its label
   > inherits the same ambiguity.) Any future bracket claim goes through
   > profile_window, not the series `slow:` field.
   >
   > **SHIPPED same day (byte-identical): the noWater A*'s static
   > land-connectivity oracle (roads.js `landComp8`).** findPath(noWater) fails
   > two ways: node-budget exhaustion (knowledge-dependent → NOT cacheable) or
   > NO LAND ROUTE — permanent geography: elevation never changes, noWater
   > skips every water tile, land/river edges are always finite, so an
   > off-component goal can never be stamped and the A* provably returns null
   > either way (only unhashed scratch differs — that is the whole
   > byte-identity proof). Candidates are offered by EUCLIDEAN radius
   > (partnerReachFor / the close-neighbour scan), so island↔mainland and
   > strait pairs are ranked forever, each doomed probe re-burning up to the
   > full budget (12000·rn² = 192k pops at 1920) every plan cycle. One
   > 8-NEIGHBOUR flood per world — deliberately distinct from countryClaim's
   > 4-neighbour `_landComp`: a diagonal isthmus joins components for the A*
   > that the crawl correctly splits, so reusing that map would wrongly null
   > real routes. Measured (30k/1920, 600-tick windows, quiet machine):
   > classify pass found 28/495 calls topological (5.7%) at ~33 ms each =
   > 917 ms = 19.4% of all findPath time; A/B on identical windows: findPath
   > subtree 4.63 → 3.67 s (−20.7%), roads bracket mean 8.9 → 7.2 ms/tick
   > (−19%), the flood itself 7.9 ms once per world. Hashbase held
   > (4dbe3ec3/fe5627fe — re-anchored on pristine HEAD in this container
   > first); smoke + validate green.
   >
   > **AUDITED 2026-07-25 (recompute cadences of the edge-cost family's big
   > customers — honest negatives, the I82/edge-cost-cache precedent): neither
   > computeTerritory nor capitalTransportCosts admits a byte-identical
   > recompute skip.** Their inputs GENUINELY drift between firings: the
   > per-edge params read the live settlement/capital knowledge objects
   > (construction/mobility/navigation are written unconditionally every tick —
   > the I82 finding; only the reach-BUDGET side, `_techEff.reachLevel`, is
   > KNOW_INTERVAL-staggered), computeTerritory additionally re-tallies under
   > the climate fert overlay (refreshed every 20 ticks) and clips to
   > `_countryOwner` (redrawn by its own pass), and capitalTransportCosts reads
   > `_countryOwner` for the contiguity toll plus the drifting `c.range` search
   > bound. An exact-input skip can never hit; a stale-tolerant one is a
   > TRAJECTORY change — a product decision gated on full re-validation, not a
   > perf refactor. Measured at 30k/1920 (two independent 600-tick windows
   > agree): capitalTransportCosts ≈ 2.4 s per polity firing (world.debug.pol
   > transport 9.5 s over 4 firings ≈ 49% of the pass; worst single tick
   > 2.68 s; #5 self-time in the whole profile at 3.6 s), territory's one
   > firing 583 ms bracket. Cadences are already emergent-safe (interval ×
   > rNorm clamps, byte-identical at probe grids). The honest reduction paths
   > remain: the B80-style budgeted incremental flood for territory (designed
   > above), fewer A* calls (the oracle, shipped), and — the #1 sim function at
   > 19.7 ms/tick self in this window — worker-parallel stepPopField.
   > **DECIDED same day: 960×480 IS the product resolution** (owner,
   > 2026-07-25), so the stepPopField arc is approved; the full design —
   > measured phase split (migration 39.5% / FOOD_K 23.3% serial-on-principle /
   > capacity 21.2%), the index-ordered-gather migration lemma that makes
   > banding bit-identical BY CONSTRUCTION, the SAB/worker execution model,
   > lever + staged rollout + proof battery — lives in
   > docs/popfield-parallel.md. Constraints unchanged: bit-identical at any
   > worker count, no GPU floats, lever default 0 until the battery passes.
5. **G-equivalence closure — MEASURED (`tools/probe_gequiv.mjs`).** Built the probe
   (samples aggregate state at matched HISTORY-time `h = step/G` for G=1 vs G=4).
   **Verdict: G-equivalence holds for the SHAPE of history, not the exact
   magnitudes.** Development (`leadOrg`, the smooth self-averaging signal) tracks
   within ≤ 4 % (mostly ≤ 1 %) on seeds 8817/31337/4242 — because the growth/decay
   mechanics are already exact-exponential (`Math.exp(rate·dt)`, settlement.js:2399;
   famine `pow(0.985, dt)`), which is cadence-invariant for a fixed rate. But
   pop/wealth/polity-count wander **20–40 %, with the SIGN flipping by seed** (8817
   pop +22 %, 31337/4242 −35 %). A systematic unscaled rate would bias ONE direction
   on every seed; the flip ⇒ this is **trajectory chaos** — changing G perturbs the
   RNG stream (G× more draws per history-unit) and the chaotic system amplifies it
   like a *seed* change. So the index.js "the SAME emergent history unfolds" comment
   is right about the development ARC and overstated about the exact figures (at
   higher G you get a seed-like *variant* with the same statistical character).
   **Gate:** `probe_gequiv.mjs` exits non-zero only if DEVELOPMENT diverges (a real
   unscaled-rate alarm); magnitudes are informational. Kept as an on-demand probe
   rather than wired into smoke — a G-diff needs a 2× (G=1 + G=4) run, too costly for
   the 25–35 s fast gate. *Open (not chased): a faint 2-of-3-seeds-lower lean could
   be a small residual bias under the chaos; a ~10-seed mean of the G=4−G1 pop delta
   would separate bias from noise — deferred as low-value vs the marriage market.*

> **W6-G status / scoping.** **R1 is DONE for world maps** — the 12 uniform world
> `Map`s are registered once in `persist.js` `WORLD_MAPS` and save/load/hashWorld iterate
> it (adding a world map is now one line; hash covers all 12). R1's typed-array/tile maps
> (`roadQuality`, `_countryOwner`, `_soilFatigue`…) were deliberately NOT folded in — they
> are heterogeneous (dense b64 vs sparse, four Ctors, per-array custom hashing), so a
> registry would *add* metadata complexity, not remove it; leave them hand-coded.
>
> **I82 VERDICT — the byte-identical 3–5× is a MIRAGE; MEASURED, not guessed.** I built
> the split, proved it byte-identical, measured it, and reverted it. The premise ("~27% is
> redundant slow-factor recompute") is FALSE. Findings, for whoever revisits:
>
> - **Where the time is (sub-profile of the settlement pass, 960×480, `probe_perf_passes`
>   + a throwaway per-updater hook):** `updateKnowledge` ≈ 31 %, `updateFood` ≈ 29 %,
>   then wealth 11 / pop 10 / dev 9 / coerce 8 / tier 2. So know + food ≈ **60 %** of the
>   pass — and that 60 % is per-tick *integration arithmetic*, not cacheable slow factors.
> - **The only byte-identical target — the static climate fns — is < 1 % and unmeasurable.**
>   `s._climTemp`/`_climMoist`/`_riverAcc` are static, so `seasonalSelect`/`livestockClimate`/
>   `malariaSignal`/`aridSignal` (recomputed every tick at ~5 sites, my earlier scoping was
>   WRONG that `_livestock`/`_wetTropic`/`_aridity` were "already cached" — they are
>   reassigned every tick) memoise byte-identically. I did exactly that (4 memo helpers,
>   lever-keyed for `T.TSETSE`; hash held at `11ad8765`/`27063acb`, 2500 steps, seeds
>   8817/31337 — see `tools/probe_hashbase.mjs`). A/B on the `settlements` pass: baseline
>   0.941/0.949 ms vs cached 0.976/1.008 ms — **within noise, no win.** Reason: `malaria`/
>   `arid` short-circuit to ~0 for the temperate majority (`tropicalWarmth`/`dry` gate first),
>   so only `seasonalSelect`'s 2 `exp`×2 calls are consistently paid ≈ 1 %. Reverted — 5 new
>   settlement fields in the hottest file for < 1 % is unearned complexity (cardinal-rule-2
>   scar tissue).
> - **Why the 60 % can't be staggered byte-identically — the real blocker.** Knowledge
>   *mutates every tick*: `k.construction`/`k.agriculture`/… are written unconditionally at
>   `settlement.js:~1440`, NOT inside a `% KNOW_INTERVAL` guard (only the reach-WALKING —
>   `_effRes`, diffusion, `_techEff`, crop-axis — is staggered). So every economic term that
>   reads knowledge *fresh* (`irrigation`/`alluvium`'s `farmTech`, pastoral `agriK`,
>   `_eraProd`'s `agri^POW`, and `updateKnowledge`'s own `sciMul` + the six KTRACK writes)
>   changes every tick. Folding them into a KNOW_INTERVAL-refreshed base reads knowledge up to
>   8 ticks stale between refreshes → the value differs → **the emergent trajectory shifts.**
>   That is not a byte-identical refactor; it is a deliberate change to the emergent history —
>   which *is* the product (cardinal rule 1's corollary). And it is RISKY: 31337's clustering
>   fact already flickers at its 0.5 gate boundary, so even a small perturbation can trip
>   `SOFT_BUDGET` and force re-validation/re-tuning.
>
> **Recommendation.** Treat I82 as **closed — not worth it byte-identically.** If the
> settlement pass ever must shrink, the honest lever is a *trajectory-shifting* stagger of the
> knowledge-driven economic terms (precedented: `_techEff` is already KNOW_INTERVAL-staggered
> and the baseline bakes in its staleness) — but that is a **history-changing product
> decision**, gated on re-passing validate + both stylized seeds, NOT a "perf refactor." Spend
> perf effort on the tile-bound passes instead (B80/B81/B78), which don't touch the economy's
> emergent output. `tools/probe_hashbase.mjs` stays as the byte-identity guard for any future
> attempt.

## Phase W6-H — The minor-bug batch (S, one commit)

B10 (agri-ceiling cache vs live levers) · B14 (Hume volume neutrality) ·
B17 (credit booked as goods income) · B41 (cross-court double breeding — falls
out of killPerson if W6-F lands first) · B50 (_rivalN stale) · B51 (fresh
_techEff skips metalCap) · B69 (plague set mutated during iteration) ·
B70 (agglomeration hash omits world seed) · I34 (dead tongues drift forever)
· I40 (world bible excludes great fallen empires — rank by event count).

## Owner decisions (needed before/while building)

1. **EARTH_HEARTHS default** (W6-B/C adjacent): build D78 (arid-floodplain
   weighting in the algorithmic cradle scorer) and A/B it on the Earth map. If
   the Crescent/Nile/Huang He win on merit, flip the default to algorithmic and
   keep the pinned list as a labelled scenario. Decision: purity vs guaranteed
   familiar openings.
   > **DECIDED: keep hand-picked on the Earth map.** The pinned `EARTH_HEARTH_SITES`
   > (state.js) stay for the Earth preset — familiar openings there; the algorithmic
   > cradle scorer already handles every other map. It's a deliberate, labelled
   > scenario (which the cardinal rule explicitly permits), so no action / no D78 needed.
2. **Tech ceiling / endgame semantics** (I99): (a) open-ended log-scale tracks
   above 1.0 with flattening effects ("modern" keeps inching), or (b) declared
   arc-complete state that validate reports and the UI celebrates. Decision
   shapes what "winning the tech race" means.
   > **DECIDED (b) + BUILT — the EMERGENT endgame.** The arc is COMPLETE when the
   > LEADING civilisation first reaches the final (Modern) era — the top of the
   > knowledge tree — NOT when the calendar hits a date (pinning the endgame to
   > "year 2100" would be the two-clock violation the cardinal rule bans). chronicle.js
   > fires a one-shot `arc.complete` event the moment `_eraAt` extends to the Modern
   > era (derivable anywhere as `_eraAt.length > ERAS.length-1`; persists via `_eraAt`,
   > so a reload never re-fires it); the ribbon shows a ✦ Arc Complete marker and the
   > event feed celebrates it; earthRun reports it. The DISPLAY calendar's Modern
   > frontier now eases toward **2100** (`ERA_MODERN_CAP`, calendar.js) — so a typical
   > run's arc-complete READS ~2100 as a consequence, never as the trigger. Measured:
   > reachable (~step 22.5k on 8817 at 320×160, development then plateaus at maxed
   > knowledge); byte-identical for every validated run (they top out ~Medieval, so
   > `arc.complete` never fires — hashbase / roundtrip / 3-seed validate all unchanged).
   > Chose (b) over (a): development genuinely tops out (all tracks → 1.0 and freeze),
   > so a declared terminal state is truer than pretending "modern keeps inching."
3. **ANCHOR_POP retirement**: the un-anchored S-curve is healthy through
   civYear ~1960; propose deleting the anchor entirely once W6-B2 (health tech)
   and W6-E have bedded in, keeping it only as a validation overlay.
4. **Credit default** (Phase-5 banking, currently OFF): revisit after W6-E,
   when monetization is layered — credit-on makes most sense once the cash
   economy is itself emergent.
   > DONE (post-W6-E): CREDIT_RATE default 0→0.01, re-gated on the discrete
   > banking tech's `credit` ability (institution, not raw org), depth grows
   > with org past the banking gate × trade breadth, contraction runs at
   > CREDIT_CRUNCH=4× build-up (runs are faster than deposit growth), dt-scaled.
   > CREDIT_RATE=0 recovers the specie-only baseline byte-identically.

## Suggested session plan

| Session | Contents | Risk |
|---|---|---|
| 1 | W6-A instruments + W6-B wins 1–6 | low |
| 2 | W6-C vassalage (+ CAP_MODEL experiment) | medium |
| 3 | W6-D nomads (stages 1–3) | high — measure between stages |
| 4 | W6-E economy arc | medium |
| 5 | W6-F dynastic politics + W6-H minors | medium |
| 6 | W6-G structure/perf | low-medium |

Every phase: implement → `npm test` → `npm run validate` (multi-seed once W6-A
lands) → the 30k-step shape probe → commit. Mechanisms that could destabilize
the size distribution (W6-C/D, CAP_MODEL) go in behind levers first and flip
default only after the gates hold on 3 seeds.
