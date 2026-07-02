# Spec — Make the political map TRACK the conquest ledger (live, variable nations)

Status: **implemented, default-on** (PR #38: mergePersistentTerritory in countryTerritory.js). See docs/review-2026-07-civ-engine.md for post-merge fixes (zombie adoption, naval contiguity, smoothing pins).

## TL;DR

Nations look samey and similar-sized regardless of how much they've actually conquered.
The cause is **not** a missing system — it's a **representation mismatch**. The sim already
has a rich, persistent, event-driven **conquest ledger** (`conquest.js`) that decides *who
holds which settlements*, with emergent hold-capacity and an intended power-law tail of a
few great powers. But the **political map** (`countryTerritory.js`) is a *separate*, stateless,
per-tick **reach-Voronoi** that only weakly translates "seats held" into "map area." So a
16-seat empire and a 2-seat statelet get similar-sized reach cells, and the history of who
conquered whom never shows on the map.

**Fix:** derive the political map from what each country actually *holds* (its settlements'
catchments + conquered/held land, persistent), and demote the reach-Voronoi to a soft
frontier-projection layer into the wilderness *between* holdings. Then heavy-tailed seat
counts become heavy-tailed **map area**, and history becomes path-dependent and visible.

## The two layers today

1. **Conquest ledger — WHO HOLDS WHAT** (`conquest.js`). Persistent, event-driven, emergent —
   already designed for exactly the outcome we want:
   - Hold-capacity (Tilly): `capacity = CAP_K·log2(1 + capPower/POW_REF) + seat bonuses`
     (`CAP_K=2.6`, `POW_REF=380`). A stronger capital holds more; war/insolvency sap it.
   - **Dominance tail**: `CAP_DOM_W=0.9`, `CAP_DOM_P=1.5` (convex, measured *relative to the
     era-mean* capital power, ceiling `CAP_DOM_MAX` from institutional development). Explicit
     intent: "a few great powers (Rome, the Caliphate, the Mongols, Britain) that tower over a
     fragmented pack instead of the log2 compressing everyone to one uniform ceiling."
   - **Lopsided engulfment**: a great power over-extends to swallow tiny states past its normal
     capacity headroom (`LOPSIDED_HEADROOM`).
   - **Secession** sheds over-extension (rise-and-fall). `npm run validate` confirms the
     "empire tail (largest/median members)" gate is already somewhat heavy-tailed in SEAT count.

2. **Territory map — WHAT COLOUR EACH TILE IS** (`countryTerritory.js`). Stateless, recomputed
   every pass (`_countryOwner.fill(-1)` then rebuild):
   - `_countryOwner` = cost-Voronoi seeded from a country's settlements, out to a reach budget
     `≈ (COUNTRY_REACH_BASE 4 + org × COUNTRY_REACH_ORG 14) × size/era/personality/aptitude`.
   - `_countryClaim` (`countryClaim.js relaxClaim`) = the crawled, animated render of
     `_countryOwner`. Currently "render-only; nothing in the sim reads it" (except adoption via
     `grownOwnerAt`).

## Root cause of the "samey map"

- The ledger yields heavy-tailed **seat counts**, but the Voronoi turns them into map **area**
  only weakly: reach ∝ organisation (which *converges* across a mature region as tech diffuses),
  and size-scaling is sub-linear (`REACH_SIZE_SUPER=0.7`, and per the code comment the
  super-linear tail "never fires" at the ~dozen-seat realms the log2 capacity produces). So a
  16-seat empire and a 2-seat statelet get similar reach cells → similar map area. **Conquest
  history doesn't translate into visible size.**
- Borders also ignore power: `CLAIM_POW=0` by default, so a dominant realm cannot push a
  frontier into a weaker neighbour short of conquering whole cities.

## The fix (representation, not a new spine)

Make the political map DERIVE from the ledger, persistently:

1. **Country map area = union of (its settlements' catchments) + (conquered/held land)**, and it
   PERSISTS — a tile stays the owner's until an *event* changes it. (Brick #1 shipped this
   session: the render now overlays each settlement's catchment onto the country claim — see
   commit `8849e5d`, `peopleSimWorker.js` buildSnapshot + `WorldSim.jsx` city-state muting.)
2. **Demote the reach-Voronoi** to the FRONTIER-PROJECTION layer only: a soft, crawling claim
   into the wilderness *between/around* holdings — not the authoritative area.
3. **Reach/logistics stay SOFT COSTS**, not the border. Distance-from-capital & logistics feed
   over-extension unrest / secession (already in `conquest.js`) — over-reach is possible but
   fragile (giants form, snowball, then shatter).
4. **Optional**: enable power-weighted frontiers (`CLAIM_POW > 0`) so a strong realm bulges into
   weak neighbours' marches without needing to storm every city.

## Incremental plan (behind a lever, A/B vs the current Voronoi)

1. **[DONE this session]** Colour territory by settlement catchments (worker overlay + muted
   city-states). Territory now reflects worked land.
2. **[DONE this session]** **Make `_countryOwner` PERSISTENT**, behind the lever
   `T.PERSISTENT_TERRITORY` (default 0 = off; headless A/B via `SIM_PERSIST_TERR=1`). When on, the
   reach-Voronoi is demoted to a FRONTIER-PROJECTION layer and the political map is derived from the
   ledger, persistently, in `countryTerritory.js mergePersistentTerritory`:
   - **CORE = worked land tracks the ledger.** Each tile in a settlement's food catchment
     (`_territoryOwner`) is coloured by that settlement's *country* — overriding the capital
     cost-bisector (`recolorByCapital`) that used to flip worked land between realms on relative
     strength alone. A settlement's `countryId` changes only by conquest/absorption/secession, so
     worked land is durable and path-dependent *by construction*; the union of a realm's catchments
     IS its persistent heartland. (Cities are cost-0 Voronoi sources → still change hands only by
     conquest, never by projection.)
   - **MARCH = sticky frontier.** A claimed tile with no settlement keeps the fresh reach projection
     but is re-asserted from last pass (`prev`) where the live reach receded, while its owner lives.
   - **Self-cleaning** (no monotonic map-fill): a march whose owner is dead, or no longer contiguous
     (through same-owner land) with a core/reached tile of that owner, is released to wilderness. No
     event-site hooks needed — territory follows `s.countryId` (already the persistent ledger).
   - `_coPrev` is scratch, rebuilt each pass from the already-saved `_countryOwner`, so **no new save
     state** (save/load identity holds — verified ON and OFF; "resume==straight" fails identically at
     baseline, a pre-existing unserialized-scratch property, not introduced here).
   - **Measured (seed 8817, 480×240, 20k steps):** claimed land 33%→**58%**; area max/median
     133→**18** and Gini 0.80→**0.62** — the OFF map is one giant over a sea of 1-tile specks; ON is a
     *graded* heavy-tailed hierarchy (top realms 1683·926·565·388·274…). All `npm run validate` gates
     stay green with the lever on (empire tail 13.0). Determinism holds.
   - **Still to verify visually (in-app A/B):** border read (catchment colouring is un-smoothed, may
     look bubblier than the capital-bisector map); tune whether marches should also re-smooth.
3. **Verify map AREA now tracks seat count** (heavy-tailed area, not just seat count) and that
   maps are **path-dependent** (different seeds → visibly different histories/borders).
4. **If great powers still aren't dominant enough**, tune the *emergent* dominance tail
   (`CAP_DOM_W`/`CAP_DOM_P`) and/or `CLAIM_POW`. Never a "make Rome big" constant.

## Key files / functions / constants

- `conquest.js` — the ledger. `rebuildCountries`; hold-capacity (`CAP_K`, `POW_REF`,
  `CAP_DOM_W`, `CAP_DOM_P`, `CAP_DOM_MAX`, `LOPSIDED_HEADROOM`); secession; `settlementPower`;
  `world._meanCapPower`; `world._overlordOf` (colonial deps).
- `countryTerritory.js` — the reach-Voronoi to demote. `computeCountryTerritory`;
  `COUNTRY_REACH_BASE=4`, `COUNTRY_REACH_ORG=14`, `REACH_SIZE_REF=16`, `REACH_SIZE_SUPER=0.7`;
  `T.CLAIM_POW` (power-weighted borders, default 0).
- `countryClaim.js` — `relaxClaim` (the border crawl, `RINGS_PER_RELAX`, res-scaled);
  `grownOwnerAt` (a spawning village ADOPTS the country of the tile it sits on — this is why a
  slow/absent claim leaves valley villages stateless).
- `territory.js` — `computeTerritory` → `_territoryOwner` (the food catchment = "worked land").
  This session added the two-field value model: `initTileValue` → `world._tileValue`
  (desirability), and the claim Dijkstra now divides effort by `(1+RIVER_REACH·river)(1+VALUE_PULL·value)`.
  Levers: `VALUE_PULL=0.3` (gentle, on), `RIVER_REACH=0` (off — over-concentrates). `reachBudget`.
- `foodHierarchy.js` — pools food up a COUNTRY's settlements to feed its cities. This is the
  granary/redistribution system; a unified river valley pooling its floodplain surplus into a
  capital is how "Egypt" should emerge. Only pools WITHIN a country → a fragmented valley never
  pools.
- `peopleSimWorker.js` `buildSnapshot` — ships `countryClaim` (now catchment-overlaid),
  `owner` (`_territoryOwner`), `countries`.
- `WorldSim.jsx` — renders `claimArr = psw._countryClaim`; `vmCountry` fill block; city-state
  muting; colony stripes (`stripeCells`, reads country `_overlord`).

## Cardinal rules (must hold — see CLAUDE.md)

1. **Everything emerges from STATE, never time/era/step.** No `if (year > X)`, no era gate.
2. **Build the SYSTEM, never fit the OUTCOME.** The heavy-tailed size distribution must fall out
   of institutions / logistics / coercive power / conquest — never a constant that names Rome or
   caps/forces a size. A surprising-but-mechanistic result beats a correct-but-fitted one.

## Validation

- `npm test` — determinism (same seed → same history), **save/load hash identity**, invariants.
  NOTE: `_countryOwner` is currently scratch (recomputed). If it becomes persistent STATE it must
  be added to the save (`persist.js`) or save/load will diverge — check the hash-identity test.
- `npm run validate` — stylized facts. Targets for this work: the empire-size distribution should
  be heavy-tailed in **map AREA** (today the "empire tail" gate measures seat count); maps should
  be path-dependent. Keep existing gates green (Zipf ≈ −1 to −1.5, wars/1000, civ alive,
  tech∼cradle-distance negative, urbanisation ~10%).
- Repro config: the APP runs the peopleSim at **960×480, seed 8817** (worldgen 1920×960 halved);
  `validate` uses 480×240. Test at the app resolution — several behaviours are resolution-sensitive.

## How we got here (this session's context)

- **Fish rebalance**: the arid river cradles were being fed by "fish", which made fish load-bearing.
  Fixed the mechanism instead: added the `ALLUVIUM` floodplain-grain term (cradles feed from their
  silt floodplain), and demoted fish to a marginal cold-coast supplement gated on land-poor × cold
  sea (world fish share ≈ 6%, cradles ~0% fish).
- **Two-field value/difficulty**: separated tile DESIRABILITY (`_tileValue`) from DIFFICULTY
  (transport cost); the catchment claim weighs value ÷ difficulty (`VALUE_PULL`). Also a river
  highway reach lever (`RIVER_REACH`, off). Both over-concentrate when strong and neither fixed the
  Nile — because the Nile's problem is not reach.
- **Nile diagnosis** (reproduced at 960×480 seed 8817): the arid thin floodplain feeds the cradle
  only ~modestly → it caps at pop ~256 → stays STATELESS → gets absorbed by a neighbour; it never
  becomes a state that POOLS the whole valley's surplus (foodHierarchy) into a capital. The Nile's
  real-world power came from a STATE pooling the valley via the river highway — the missing piece is
  valley consolidation into one polity, which is downstream of this spec (persistent ledger-driven
  territory + food pooling).
- **Catchment-as-territory colouring** (brick #1) shipped: a country now colours the land its
  settlements work, instead of leaving settlements as bare dots when their nascent realm projects ~0.

## Git / process

- Develop on `claude/ecstatic-keller-qy6100`. Commit trailers: `Co-Authored-By: Claude Opus 4.8
  <noreply@anthropic.com>` and `Claude-Session: <url>`. Do NOT open a PR unless asked. Do NOT put
  the model identifier in commits/code/artifacts. Run `npm test` + `npm run validate` before pushing.
