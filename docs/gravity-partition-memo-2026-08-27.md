# Decision memo — the gravity catchment (2026-08-27)

Owner's two questions after the catchment audit: what should ATTRACTION be, and should the
partition NEST? Seven-agent workflow (4 audits, 2 adversarial refutations, 1 synthesis); both
of my initial recommendations were REFUTED. Verbatim memo below.

---

All probes are in. Writing the memo.

# DECISION MEMO — the gravity catchment: what ATTRACTION should be, and whether to NEST

**Measured on tree `07359fd`** (= `2d6a829` + one log file; `git diff --stat 2d6a829 HEAD` = 1 log). Seed 8817. Throwaway probes under `/tmp/cq/`; **no source file was modified** (`git status --porcelain` empty).

| arm | grid | levers | horizon | n |
|---|---|---|---|---|
| **A** | W=960 → **tw=480** | harness pins + `LAND_KNOW=1` | 24k | 33 |
| **B** | tw=480 | harness pins (`LAND_KNOW=0`) | 24k | 37 |
| **C/E** | tw=480 | **the shipped genesis arm** `DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1` | 24k / 28k | 93 / **273** |
| **H2** | W=480 → **tw=240** | `LAND_KNOW=1` | 24k | 37 |
| **G2** | tw=480 | shipped genesis arm | 24k | 93 |

G2/H2 are static repartition counterfactuals that **reproduce the guaranteed core carve** (`territory.js:274-296`: Chebyshev square of `coreRadiusFor(s)`, first-claim-wins in settlement order) and apply the candidate law only beyond it. **Honest limits: Euclidean distance proxies the cost field; one seed; `SETT_STRIDE`/`TRADE_STRIDE` stay at the harness's 1/3 not the shipped 3/5; and there is NO tw=960 measurement anywhere in this memo.**

---

## 1. Q1 — ATTRACTION

### RECOMMENDATION: `s._coreMeasured` — the field-measured urban core, read by that name and never as `s._urbanPop`. And the number you asked for says the mechanism is INERT at the configuration that ships. Build it; ship it at 0; do not flip it until the core unpins.

**The number, three ways** (arm E, tw=480, shipped genesis arm, step 28000, n=273):

```
_coreMeasured   min 0.323  p10 7.161  p50 12.00  p90 12.00  max 598.6
                max/p50 = 49.88          <- the ratio you asked for
                p90/p10 =  1.68          <- the ratio that governs the map
                186 of 273 sit at EXACTLY 12.00
```

**Quoting max/median alone would be a lie here.** The distribution is not a spread, it is a **plateau plus one spike**: 68% of the register at one value, an interdecile band of 1.68×, and a single importer at 598. The behavioural measure agrees with the interdecile, not the max — **median bid-rent boundary displacement 0.00 tiles; 69% of the 562 touching catchment pairs move less than one tile; median Reilly displacement 0.000.**

**Why it is a plateau — the mechanism, not a phase.** `_coreHoldCapF = coreBarF * 1.2` (`crystallize.js:1751`) with `coreBarF = TIER_CORE[2] / bridge` (`crystallize.js:1417`) — a **world constant**. `TIER_CORE = [0, 2, 10, 40]` (`settlement.js:74`), so the stamp is `10 × 1.2 = 12.00` sim units = 12,000 people, exactly the mass point measured. Under `LAND_KNOW` (**ships 1**, `tuning.js:617`) with `coreR > 0`, `popField.js:2051-2058` reads

```js
const holdF = s._coreHoldCapF > 0 ? s._coreHoldCapF : Math.max(0, pf[ti]);
coreEff = Math.min(_coreF, holdF + kBeyond);
```

Measured at E/28k: **242 of 273 carry the stamp, 265 of 273 are clamp-bound, and `kBeyond > 0` for 10.** So `coreEff = the stamp` for the modal city. The raw disk underneath is *not* flat (`coreF` p10 2,132 / p50 21,740 / p90 50,980 / max 96,470, max/p50 = 4.44) — the read discards it.

This is the owner's own standing complaint, quoted in `tuning.js:116` — *"most cities STILL sit at 12k … but the only 3 metropolises ARE importing LOTS"* — arriving as the blocking input to a different lap.

### The candidate table, at the grid AND config that ship (E, tw=480, step 28000, n=273)

| candidate | p10 | p50 | p90 | max | **max/p50** | **p90/p10** | ρ(terrTiles) | pairs moved ≥1 tile |
|---|---|---|---|---|---|---|---|---|
| **`_coreMeasured`** | 7.16 | **12.00** | **12.00** | 598.6 | 49.88 | **1.68** | 0.104 | **31%** |
| `s.people` | 15.0 | 304.6 | 2118 | 8501 | 27.91 | 141.2 | 0.734 | 82% |
| `s._k` | 8.00 | **8.00** | 113.5 | 1022 | 127.8 | 14.19 | 0.401 | 60% |
| `_grainPrice` | 7.00 | 21.54 | 42.00 | 42.00 | 1.95 | 6.00 | −0.011 | 54% |
| `wealth` | 101.5 | 870 | 12,170 | 240,600 | 276.5 | 120.0 | 0.268 | 79% |
| `_exportValue` | 1.83 | 2.91 | 4.84 | 8.86 | 3.04 | 2.64 | 0.470 | — |
| `coreF` (raw disk) | 2,132 | 21,740 | 50,980 | 96,470 | 4.44 | 23.9 | — | 58% |
| tier belt `hinterlandRadiusFor` | 4 | 6 | 6 | 8 | **1.33** | 1.50 | −0.120 | 0% |
| **`reachBudget` (incumbent)** | 6.17 | 7.88 | 7.98 | 8.31 | **1.05** | 1.29 | 0.109 | 0% |

**The incumbent is worse than the audit said.** Touching-pair separation at the shipped register is **p50 = 4.5 tiles (375 km)**, so the nearest-wins bisector at ~2.2 tiles binds long before the 6-tile guaranteed belt ever does — the belt's *realised* size ratio is **1.33×, its Reilly displacement 0.000**, not the "2.7× radius ratio" the audit credits it with. Combined with `reachBudget`'s 1.05×, **the economic catchment at the register that ships has no live size term at all.** G2 confirms it end-to-end: a plain Euclidean Voronoi over the same land reproduces the live partition to lnσ 1.61 vs 1.59 and gini 0.732 vs 0.766, moving only 14.2% of tiles. **`_territoryOwner` is, today, a Voronoi diagram.**

### Why the other candidates lose

- **`s.people` — the honest runner-up, disqualified by identity.** `deriveOnePop` sums `popField` over `world._territoryOwner` **unweighted** (`popField.js:1836-1841`) and writes `s.people = max(1, f*scale)` (`:2004`). An annexed tile enters the attraction at weight exactly 1.0 whether it is the home tile or the last tile inside the budget. Contrast `_terrFertSum`, which accumulates `f * foodFalloff(cost/rn)` (`territory.js:481-482`, `foodFalloff(c)=1/(1+0.5c)`, `:100`). Weighting the partition by the census closes a loop with *no distance discount anywhere in it*. Measured ρ(people, terrTiles) = 0.734-0.897 across every arm — the highest of any candidate, and tautological rather than causal.
- **`s._k`** — p10 = p50 = **8.000** = `K_MIN_VIABLE` (`settlement.js:119`): half the register pinned at a floor. Circular through the harvest (`territory.js:470-481` → `settlement.js:2802` → `:3605`), and the jitteriest serious candidate.
- **`tier`** — a lagging 4-rung quantiser of `_coreMeasured` (`settlement.js:3902-3903` against `TIER_CORE`). 242 of 273 sit on rung 2. Reilly displacement **exactly 0.000**. Strictly worse than the quantity it is derived from.
- **trade/market volume (`_tvAll`)** — **independently reproduced the audit's phase-lock**: nonzero for 86/93 at step 24000, **zero at 8000 and 16000** — exactly 1 tick in 3 under `TRADE_STRIDE=3` (`roads.js:1484` books it, `settlement.js:2292-2296` zeroes it every tick, `roads.js:1096` fires it on stride). The territory pass reads step `288k−1`, which is never that tick. Under the shipped `TRADE_STRIDE=5` the phase merely rotates.
- **`coreF` (the raw disk)** — live where the clamped read is not (max/p50 4.44, 58% of pairs move), and tempting for exactly that reason. **Reject it:** it is field density near the site, so grading the partition by it means *the densest countryside gets the biggest market area* — the precise inverse of Christaller, whose whole k-hierarchy says dense countryside supports **more, smaller** market areas.
- **a composite** — two circular quantities blended by a weight with no independent physical meaning. That is the SECOND CARDINAL RULE's own tell. Reject on sight.

### The dawn/zero bootstrap, with no fitted constant

At `world.step === 1` `computeTerritory` (`index.js:163`) runs before any `updateSettlement` (`:181`) or `deriveOnePop` (`:202`), so **every** `_coreMeasured` is `undefined`. `mintCityAt` sets `people: opts.people ?? 25` (`settlement.js:350`) and `maybeCrystallize` (`index.js:221`) runs *after* the derive, so every newborn's first territory pass sees a bare seed too. Measured live at E/28k: **28 of 273 have `_coreMeasured == null` while only 1 has `_urbanPop == null`** — i.e. 10% of the register would feed the ratio heuristic `0.1000 × s.people` (`settlement.js:3753-3754`, `ruralShare` at `:1598-1600`) into a race of measured values.

**The rule: an unmeasured market makes no bid, and "no bid" is the pass's own geometric mean of the measured cores.** Because the race is an argmax over `A_i / cost^λ`, a *global* rescaling of A cancels exactly — so the geometric mean is the unique value that leaves an unmeasured settlement's boundaries **exactly where today's law puts them**. It is not a constant, it is a live statistic of this pass, recomputed each firing, with in-repo precedent: the density graveyard's `medDens` (`popField.js:1961-1966`, *"a mean-field congestion term, recomputed each tick, no persisted state and no fitted constant"*). At the world's first pass nothing is measured, the mean is undefined, every weight is 1, and **the dawn bootstrap is byte-identical**.

This is the same answer the tier ladder already gives — `if (coreLadder && s._coreMeasured == null) return;` (`settlement.js:3902`, *"the label just waits for the field"*) — and the science-minds term (`settlement.js:1956`). Reading `s._urbanPop` by name instead would repeat a documented, twice-caught bug.

---

## 2. Q2 — NESTING

### RECOMMENDATION: keep `world._territoryOwner` strictly EXCLUSIVE. Do not nest tiles. The nest the audit wants already exists one layer up, and the market-size pull belongs in *its* attachment rule, not in the land partition.

**What actually nests, and where each already lives:**

| | reality | in this codebase |
|---|---|---|
| **LAND** (which fields feed which market) | **exclusive.** A field is in one manor, one parish, one *contado*. Bracton's 6⅔-mile rule is a rule *enforcing exclusivity* — it outlawed a rival market, it did not subordinate one. | `world._territoryOwner`, one Int32 per tile (`territory.js:174`). **Keep exclusive.** |
| **GOODS** (Skinner's marketing hierarchy) | **nested.** Standard → intermediate → central market. | **Already built and already nested by construction**: `buildHierarchy` requires a liege of *strictly higher tier* (`conquest.js:855`), and grain flows up that tree in `aggregateFoodHierarchy` (`foodHierarchy.js:172+`). |
| **ADMINISTRATION** | **nested.** village → xian → prefecture → province. | `world._countryOwner` + the same liege tree. Its reach already scales with the urban core: `Math.sqrt(claimPop / ref)` (`countryTerritory.js:1592-1594`). |
| **SERVICE / consumer travel** | **overlapping, not nested** — the weekly local market and the twice-yearly city trip. This is what Huff actually models. | The trade graph (`roads.js`) — pairwise flows. Needs no partition at all. |

**Christaller's range hierarchy is already implemented here — on the goods layer.** `FOOD_RANGE_BY_TIER = [1.0, 1.0, 2.2, 3.6]` keyed on the **destination's** tier (`foodHierarchy.js:85, :123`) and `GRAIN_PRICE_BY_TIER = [2, 8, 14, 22]` (`:170, :238`), decaying as `Math.exp(-d/range)` with a physically-grounded, grid-honest e-folding `HAUL_LAND_KM = 340` (`:108, :155`). A higher-order centre both **pays more** and **reaches further**, exactly as Christaller says. **What is missing is not a nested tile partition — it is the market-pull term in the parent CHOICE, which is pure distance:**

```js
// conquest.js:857-861 — the one place Skinner belongs and is not
for (const m of members) {
  if (m === s || (m.tier | 0) <= st) continue;   // liege must be larger
  const d = dist(world, s.pos.x, s.pos.y, m.pos.x, m.pos.y);
  if (d < bestD) { bestD = d; best = m; }
}
```

That is a 3-line change, it cannot break any partition-of-unity, and it is **the cheap, safe test of the entire "market pull scales with centre size" thesis. Do that first.**

**Two reasons nesting the tiles is not merely risky but wrong:**

1. **It is unrepresentable at every grid this sim runs.** Skinner's standard marketing community is ~3-6 km radius, intermediate ~10-15 km, central ~25-30 km. One tile is **167 km** at tw=240, **83 km** at tw=480, **41.7 km** at tw=960. The entire three-level nest fits inside one tile at the finest grid that ships. Bracton's 6⅔ miles is 10.7 km — a quarter of a tw=960 tile. The audit's §5 already says this ("a real city's shed is 4-22% of a single tile"); it applies with full force to the hierarchy too.
2. **~46 references across 11 files assume one owner per tile.** Partition-of-unity reduces: the census (`popField.js:1836-1841`), the `FOOD_K` capacity ledger apportioning `s._k * landShare` by `cap[i]/W` (`popField.js:907-920`), the harvest (`territory.js:465+`), governed people `s._govPeople += pf[ti]` (`conquest.js:2711-2718`). Exclusivity *tests*: the urban concentration drain `if (owner[ti] !== sid) continue` (`popField.js:1690, 1698, 1774, 1806`), armies (`:485, :669`), identity (`identityField.js:75, :280`), loyalty (`loyaltyField.js:190, :223`). And the sharpest single breakage — `residualBasinMass` skips any tile with `to[ti] >= 0` (`crystallize.js:219-228`); under nesting every tile is under *some* higher-order centre, so it returns 0 everywhere. (Latent, not live: `MINT_RESIDUAL` and `MINT_REACH` both ship 0.) Overlap also inverts the audit's own headline invariant, Σ`s.people` ÷ field mass = 0.9032 **< 1**.

**One structural caveat that limits the whole thesis:** `CATCHMENT_CLIP` ships 1 (`tuning.js:201`), so a catchment may only cover its own country's ground (`territory.js:237-240`). **Market competition between centres is therefore intra-country only** — a metropolis can never outbid a rival across a border. Bracton's franchises were intra-kingdom too, so this is defensible; but the Hanseatic case is structurally impossible, and that should be a known limit rather than a surprise later.

---

## 3. WHAT THE REFUTERS KILLED OR NARROWED — explicitly

**KILLED — my own first preference for the *additive* form on extinction-safety grounds.** I initially read the unprotected counterfactual (arm F) as proving the bid-rent form evicts centres: 27 of 93 zero-catchment on `A=core`, **71 of 93** on `A=people`, against a 14/93 baseline. **That was a proxy artifact of my own probe**, which applied the law to *all* owned tiles including cores. Re-run with the guaranteed core carve modelled (G2), every law lands at 14-16 zero of 93. The additive form is *not* extinction-unsafe — **provided the guaranteed core stays outside the market law.** Retracted, and the constraint promoted into the build sketch.

**KILLED — the refuter's mechanism for `_urbanPop`'s shipped-grid collapse.** They claimed it "reduces to `pf[centre tile] × scale`, a quantity that scales as 1/rn²." Directionally right, mechanically wrong: `holdF` falls back to `pf[ti]` **only where there is no founding stamp**, and at the shipped mint lane **242 of 273 carry one**, so the read collapses to the world-constant 12.00, not to the centre tile. Their *conclusion* (inert at the shipped config) is **confirmed and now explained**; their *cause* is the minority case.

**KILLED — the refuter's "bit-identical to the `s.people` partition."** `deriveOnePop` is the last writer in the tick and the territory pass reads its value: `_urbanPop === _coreMeasured` for **233 of 245** at E/28k, 32/32 in arm A, 34/35 in arm B. But **NARROWED into a real, quantified hole**: 28 of 273 (10%) have `_coreMeasured == null` while `_urbanPop` carries the heuristic `0.1000 × people` exactly. That hole is the entire reason the law must read `_coreMeasured` and skip nulls.

**KILLED — the audit's closing hope that this lets `SEED_EXCLUSIVE` ship.** *"A small centre would hold a modest catchment BY RIGHT rather than by theft — which is what would finally let SEED_EXCLUSIVE ship without taking the small-state tier with it."* **On the mechanism this points the other way.** A market-pull partition moves land *from* small centres *to* big ones; it is a **second** squeeze on exactly the marginal foundings `SEED_EXCLUSIVE` was killed for squeezing. Nothing in either measurement supports the hope. Do not build this expecting it to unblock that lever.

**NARROWED — the Q1 audit's headline `_urbanPop max/p50 = 18.87`.** That is a **tw=240** number, and at tw=240 `urbanCoreR = max(0, round(rNormPop)-1) = 0` (`popField.js:1577`), so `LAND_KNOW`'s clamp — **which ships ON** — is structurally unreachable. My probe prints it: `tw=240 … coreR=0 LAND_KNOW=1`. **The reference grid literally cannot measure the quantity that ships.** Same statistic, same seed, same step, at the app grid under the shipped mint lane: **p90/p10 = 1.68.** This is the third cardinal rule in its purest observed form — and the sign flips with it: `Huff λ=2, A=core` takes catchment gini **0.398 → 0.497 at tw=240** (concentrating) and **0.766 → 0.724 at tw=480 shipped** (de-concentrating).

**NARROWED — "the only size term is the tier belt, 3→8 tiles, a 2.7× radius ratio at most."** Realised, it is **1.33×** with Reilly displacement **0.000**, because at 4.5-tile neighbour separation the belt cap never binds.

**CONFIRMED — the `_tvAll` phase-lock and the org convergence.** Independently reproduced (above), and `reachBudget` max/p50 = **1.02-1.05** at every arm and both grids.

**SURFACED, not in either audit — the guaranteed core is not guaranteed.** 14 of 93 settlements at C/24k hold **zero tiles**, and *all 14 are stateless* (`countryId = -1`): `CATCHMENT_CLIP` vetoes the core carve itself (`territory.js:291`) when every neighbouring tile is inside some realm's border. At E/28k it is 39 of 273. **The extinction floor is pre-existing and is ~15%.**

---

## 4. THE BUILD SKETCH

**Lever: `T.MARKET_PULL`, def 0.** Blast radius is confined: `_territoryCost`, `_territoryTrueCost` and `_terrClaimant` have **zero readers outside `territory.js`** (verified by grep), and `tallyTerritory` is handed `tcost` — the *true* haul cost (`territory.js:414`) — so the harvest kernel and the food falloff are untouched. Only **who owns the tile** changes.

**Form: the bid-rent race, not the Huff power law.** A tile's grain goes to the market paying most at the farm gate. The sim already models the haul as `Math.exp(-d / range)` (`foodHierarchy.js:155`), so in logs the race is additive:

```
claim tile ti to  argmin_i [ cost(i, ti)  −  haulTiles · ln A_i ]
haulTiles = HAUL_LAND_KM / (EARTH_KM / world.tw)     // foodHierarchy.js:108, :122
```

**Why additive over Huff, on the repo's own precedent.** Huff's loop gain is **scale-free**: a 2× bigger city always takes the same *fraction* more land, at every size — which is the same shape as the pathology **`SIZE_WORKED`** documents (`tuning.js:348` on this memo's tree `07359fd`; `:350` at `68b5676`, derived in code at `countryTerritory.js:891`: *"a pure proportional feedback with NO interior fixed point … a self-referential loop is bistable at EVERY setting of the constant"*). **[CORRECTED 2026-08-27, adversarial audit of `docs/food-system-design-2026-08-27.md`.]** This sentence originally named **`SIZE_BY_POP`**, which is the neighbouring key and a different lever — `SIZE_BY_POP` is the "minimum-Egypt" size floor; the quoted string has always been in `SIZE_WORKED`'s description. The line number was right for this tree, so the error was invisible to any check that only re-ran the number. It was then **inherited verbatim** into `docs/food-system-design-2026-08-27.md` §3.1 before an audit caught it in the derived document rather than here. Note also that the analogy is a shape-match, not an identity: `SIZE_WORKED`'s pathology is `target = k·h`, proportional feedback on **held tiles**, while Huff's scale-freeness is a property of the **attraction exponent**. What transfers is the cure — *"a term that does NOT move when the border moves"* — not the loop. The additive form's gain **falls with size**: a 2× bigger city always takes the same fixed extra *width*, whose share of an already-large cell shrinks. That is precisely the prescribed cure — *"a term that does NOT move when the border moves"* — and here that term is `HAUL_LAND_KM = 340 km`, a real distance from Diocletian's edict, **converted at the world's own km-per-tile with no `rNormPop`, grid-honest by construction** — the pattern the catchment audit's own §5 named as the one to copy. **It introduces no new constant and no exponent to pick.**

**Three insertion points, all one-liners:**

```js
// helper — geometric-mean normalised, so an unmeasured market's weight is exactly 1
function pullW(s, geoMean) {
  if (!(T.MARKET_PULL > 0)) return 0;
  const c = s._coreMeasured;                      // NOT s._urbanPop (settlement.js:3753)
  return (c > 0 && geoMean > 0) ? Math.log(c / geoMean) : 0;
}

// 1. territory.js:206  — budget shifts with the bid so the FRONTIER is unchanged
budget.set(s.id, reachBudget(s) * _rnB + haulTiles * w);

// 2. territory.js:326  — the guaranteed belt's nearest-wins becomes bid-rent-wins
const dw = Math.sqrt(d2) - haulTiles * w;
if (dw < hintDist[ti]) { hintDist[ti] = dw; owner[ti] = s.id; }

// 3. territory.js:288-290 — the Dijkstra source starts at its bid
if (elev[home] > 0) { const k = haulTiles * (wMax - w); cost[home] = k; tcost[home] = 0; heap.push(home, k); }
```

**Constraints that are load-bearing, not incidental:**
- **The core carve (`territory.js:274-296`) stays OUTSIDE the law.** Unprotected, the additive race extinguishes 27/93 on `A=core` and 71/93 on `A=people` (arm F). Protected, 16/93 against a 14/93 baseline (G2).
- **Attraction shifts the boundary; the budget still sets the frontier.** Insertion 1 shifts the budget by exactly the same amount as the source key, so the reach calibration in `territory.js:40-46` ("stone ~7 tiles, bronze ~17…") is preserved. Without it, a big city would also flood further into wilderness for free — a different and much larger change.
- **`_coreMeasured` MUST be added to `SETT_FIELDS` (`persist.js:77-108`).** It is not persisted today; `computeTerritory` at `index.js:163` runs *before* `deriveOnePop` at `:202`, so the first territory pass after a load would read `undefined` for every settlement and produce a different partition than an uninterrupted run. The precedent is three lines away: `_coreHoldCapF` is persisted precisely because *"dropping it would re-open the birth-crater capacity gap on every load."* Without this the save/load determinism smoke is a coin flip on whether the resume lands on a territory tick.

**What ships at 0, and why it must stay there for now.** At the register that ships, the law reshuffles 30-39% of tiles while leaving the size distribution alone — catchment **lnσ 1.63-1.65 against nearest-wins' 1.61**, **gini 0.719-0.733 against 0.732** (G2). That is churn without hierarchy. **The prerequisite lap is the 12k core pinning, not the partition.**

### THE MEASUREMENT THAT WOULD REFUTE IT

`SEED_EXCLUSIVE` passed three seeds, `resgate` at app/ref **0.96** (better than default), and a monotone urban ladder — and was killed by two numbers at tw=960. Run **those two first**:

1. **`tools/probe_shape.mjs 20000 1920 8817`, paired A/B at tw=960.** Refuted if **small states < 100k km² fall below ~20% of realms** (baseline 5 of 14 = 36%) or **size dispersion lnσ falls below 2.0** (baseline 2.68; history 2.0-2.6). These are the exact two that killed the seed box, and a market-pull partition pushes them in the *same direction* the seed fix did.
2. **Partition-specific, invisible to (1): zero-catchment count and catchment-area gini at tw=960.** Baseline at tw=480/shipped: **14 of 93 zero, gini 0.766, lnσ 1.59.** Refuted if zero-catchment rises materially above the pre-existing floor, or gini exceeds ~0.82 (the `A=people` signature in G2).
3. **THE ARMING CHECK — the one nobody would think to run.** *Share of touching catchment pairs whose boundary moves ≥1 tile from nearest-wins.* With `A = _coreMeasured` today that is **31%, median 0.00 tiles**. If flipping the lever does not move that number, **the lever is inert and must NOT be recorded as validated** — no matter how many gates it passes.
4. `npm run resgate`, `npm run validate`, `npm test`.

---

## 5. THE RISK THAT WORRIES ME MOST

**Not that the lever is wrong. That it will pass every gate BECAUSE its input is currently a constant — and then arm itself later, off-lever, when the core-unpinning lap lands.**

Every gate in the ladder measures the *world*. Nothing measures whether a mechanism's **input has spread**. With 186 of 273 cities at exactly 12.00 sim units, `MARKET_PULL=1` will read as safe on three seeds, hold every `resgate` band, and hold the urban ladder — because for two-thirds of the register it *is* nearest-wins. It will be recorded as measured, validated and shipped. Then the lap that lets a city grow past its founding stamp — the owner's own standing complaint, and the obvious next move — hands this dormant law a live, heavy-tailed attraction, and the political map reshapes with **nobody looking at this lever at all**, because it was validated months earlier.

That is the `SUCCESSOR_STATES` pattern with a delay fuse: *"validated in exactly the regime where it does nothing"* — except the regime here is not a grid you can switch to, it is **a stage of the world's development that has not happened yet**. The third cardinal rule tells you to run the other grid. There is no corresponding instruction to run the other *era*, and under the first cardinal rule you cannot fast-forward to it — you have to grow it.

Two things make this tractable, and I would do both regardless of the decision:

- **Make the arming a standing metric.** Emit the §4-(3) number — the share of catchment boundaries displaced from nearest-wins — through `collect()`. Then the day the core unpins, the arming shows up in `npm run observe` as a moving number instead of as a mysteriously redrawn map. This is cheap, and it is the only instrument that would have caught `deffdce` and `b859db7` *by class* rather than by luck.
- **Order the laps: core first, partition second.** The 12k plateau is not a nuisance blocking a nicer feature — it is the finding. **A world whose cities are all the same size has no market gravity, and it is correct for the law to be inert in it.** Reilly between two identical towns puts the boundary at the midpoint, which is nearest-wins. The partition is not what is broken; the city-size distribution is.

The runner-up worry, stated plainly so it is on the record: `s.people` is the only candidate that grades this map **today** (gini 0.732 → 0.808-0.821, lnσ 1.61 → 1.72, moving *fewer* tiles than `A=core` does). If the core-unpinning lap fails or is deferred, the pressure to reach for it will be strong and the demo will look good. It is the field mass over the very partition being computed, with **no distance discount anywhere in the loop**, and the circularity audit's own fixed-point iteration takes it to area-gini 0.768 with a catchment extinguished once the reach budget is removed. If it is ever used, it must be entered through the additive form with the budget retained — never as `A/cost^λ`.