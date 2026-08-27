# Build memo — the local-surplus urban claim (2026-08-27)

Owner's model: "cities eat ALL surplus in the hinterland? and then import food on top of that
when they can and want to?" Eight-agent workflow (4 measurement lanes, 3 adversarial lenses,
1 synthesis). ALL THREE lenses refuted the foodReach-gated form I proposed; the surviving form
is simpler. Verbatim memo below.

---

# BUILD MEMO — the local-surplus urban claim

**Measured on tree `37e1c3a`** (`git status --porcelain` empty; no source file modified). Seed 8817. My own probes at `/tmp/claude-0/-home-user-Simman-/34b0e084-1706-5303-b25e-c42ae2fa68e6/scratchpad/bm/probe_max.mjs` (+ `probe_max240.mjs`, `an.mjs`), raw dumps at `rows.json` / `rows240.json`.

| arm | grid | levers | climate | horizon | n |
|---|---|---|---|---|---|
| **SHIP** | W=960 → **tw=480**, `coreR=1` | shipped genesis `DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1` | real | 28k | **273** |
| **GATE** | W=480 → **tw=240**, `coreR=0` | harness defaults (`LAND_KNOW=0`), i.e. what `npm run validate` runs | synthetic | 24k | 39 |

Reproduces the gravity memo's arm E exactly (n=273, `_coreMeasured` p50 12.00, max 598.6, 242 stamped, `kBeyond>0` for **10**, 28 null cores, live urbanisation **2.07%**). **Honest limits stated once: one seed; `SETT_STRIDE`/`TRADE_STRIDE` at the harness's 1/3 not the shipped 3/5; the counterfactual is a static re-read of one checkpoint, not a re-run; and there is NO tw=960 arm anywhere in this memo.**

---

## 1. VERDICT

### BUILD IT. Lever `T.CORE_LOCAL`, def 0. In the **MAX** form, **ungated**, with **no new constant**. Throw away the extraction *rate*; keep the local *claim*.

The owner's model was "a city eats the surplus of its own hinterland, and imports on top." The refinement the brief proposed — *the share the centre can EXTRACT, at rate `foodReach`* — is the part that must be discarded, and my own measurement kills it (§2). What survives is the plain claim, and it is already half-implemented: `popField.js` computes the split, uses one half, and throws the other half away.

**Replaces `popField.js:2057-2058`:**

```js
// TODAY
const holdF = s._coreHoldCapF > 0 ? s._coreHoldCapF : Math.max(0, pf[ti]);
coreEff = Math.min(_coreF, holdF + kBeyond);

// PROPOSED — T.CORE_LOCAL
// The core's claim on its OWN hinterland. (1 - importShare) is landShare, the
// identical expression popField.js:921-922 already computes to spread
// s._k * landShare over the catchment; kBeyond (:1974) is its complement.
// The read now uses BOTH halves of a partition it already owns.
const kLocal = T.CORE_LOCAL ? ((s._k || 0) * (1 - importShare)) / scale : 0;
const holdF  = s._coreHoldCapF > 0 ? s._coreHoldCapF : Math.max(0, pf[ti]);
coreEff = Math.min(_coreF, Math.max(holdF, kLocal) + kBeyond);
```

**No new constants.** `T.CORE_LOCAL` is a 0/1 lever, not a rate. Every term already exists and already means something:

| term | what it means, independently |
|---|---|
| `holdF` = `_coreHoldCapF` | the site law's own founding hold — the pile the basin *gathered* before the entity existed (`crystallize.js:1751`, `= coreBarF*1.2 = TIER_CORE[2]/bridge*1.2` = 12 sim units). A **birth endowment**, not a size target; `STARVE_SHED` already melts it in the capacity spike (`popField.js:2110-2113`). |
| `_k · landShare` | the headcount the settlement's **own land and water** feed, at the core's own per-capita rate. `_k = (_foodSupply + _foodExported)/perCapita` (`settlement.js:3547`), `perCapita = 0.003 × urbanFactor` (`:3529`); `_foodSupply` is the catchment harvest **already net of farm-labour subsistence** (`:2802`, `FARM_FERT_FLOOR`, `tuning.js:604`) and already discounted by haul (`territory.js:480-482`, `foodFalloff`). |
| `kBeyond` = `_k · importShare` | unchanged. |
| `min(_coreF, ·)` | the disk ceiling, unchanged — an economy cannot claim urbanites the ground does not hold. |

**Why `Math.max` and not `+`.** It is strictly monotone: **no settlement's core can fall.** Therefore no tier can demote, no realm can lose a seat, and this change **cannot cause a single `DISSOLVE_CORE` dissolution** (`crystallize.js:1293,1301`: `coreThin = _urbanPop < TIER_CORE[2]`). That property is not cosmetic — it is what separates a buildable change from the one the refuters killed (§3).

**Why no extraction rate — four reasons, each a citation:**

1. **The supply side already has no rate.** `territory.js:465-482` credits the *whole* catchment harvest to the centre, discounted only by distance. `settlement.js:3308/3315/3318` books it. There is no institution anywhere between the field and the ledger.
2. **The feeding side already assumes a 100% claim.** Under `ONE_BOOK` (ships 1, `tuning.js:97`) `mouths = min(s.people, s._urbanPop)` (`settlement.js:3086`) and the famine gate compares the **whole** `_foodSupply` against `_coreNeed` (`:3111`, `:3655-3656`). The core is *already* fed by the whole hinterland with no rate. **The size read is the only book that disagrees — and a second book is exactly the defect `ONE_BOOK` exists to close.**
3. **The institution is already priced twice, elsewhere.** `foodReach` already gates the ledger's downward authority over this *same catchment* (`popField.js:949`), and `FARM_RENT = 0.4` already extracts 40% of `_landFood` per polity pass as fiscal revenue (`conquest.js:3525-3530`, `tuning.js:865`). A third pricing at the read would triple-count — and the first two would *fight*: `FOOD_REACH` **raises** rural capacity where org is low, while a foodReach-gated urban claim would **lower** the urban core in the same place. Double penalty on the same weak state.
4. **`URBAN_AGGLOM = 0.13` is already an extraction-like rate on the import path** (`tuning.js:180`: "the fraction of import-fed capacity that concentrates in the core"). A second rate on the local path is two constants for one institution — the SECOND CARDINAL RULE's own tell.

**What is deliberately NOT in this lap.** `uTarget` (`popField.js:1981-1987`) and `kCap` (`:2088`) stay keyed on `kBeyond`. Moving them would put the same `_k·landShare` into the core spike *and* into `ledgerK` at `:923`, breaking the partition-of-unity the comment at `:897-903` promises ("catchment + spike sum to the economy's own number — no double count"). Doing it correctly requires subtracting the centre's claim from `ledgerK` — a rural-capacity surgery with its own blast radius. **That is a second lap, and it is the lap that makes the field actually *move* people into cities. This one only fixes the READ.** Say that out loud in the commit message; do not let it be discovered later.

---

## 2. THE NUMBERS THAT DECIDE IT

**SHIP arm, tw=480, 28k, n=273, Σ`people` = 187,363 sim (= 187M people).** Core sizes in sim units; ×1000 for people. All forms carry both existing clamps.

| form | p10 | p50 | p90 | max | **urb %** | lnσ | tier hist (v/t/**c**/**M**) | <10 | moved |
|---|---|---|---|---|---|---|---|---|---|
| **T — today** | 7.82 | **12.00** | **12.00** | 598.6 | **2.26** | 0.68 | 8/30/**228**/**7** | 38 | — |
| A — `_k·landShare` **replaces** stamp | 8.00 | 8.00 | 86.4 | 1022 | 5.20 | 1.09 | —/—/102/46 | **171** | 258 |
| A2 — `landFood/pc` **replaces** stamp | 0.00 | 3.73 | 104.2 | 783 | 5.48 | 1.45 | —/—/119/60 | **154** | 272 |
| **M — `max(stamp, _k·landShare)`** | 9.62 | **12.00** | **93.1** | 1022 | **5.55** | **0.98** | 1/28/**198**/**46** | **29** | 102 |
| M2 — `max(stamp, landFood/pc)` | 10.49 | 12.00 | 104.2 | 783 | 6.32 | 1.06 | 2/25/186/60 | 27 | 116 |
| **B — foodReach-gated (the brief)** | 8.63 | 12.00 | **15.0** | 598.6 | **2.39** | 0.61 | 5/30/230/**8** | 35 | **20** |
| E — raw disk, unclamped | 10.80 | 153.1 | 750.1 | 1967 | **40.32** | 1.66 | —/—/249/**190** | 24 | 248 |

**The `foodReach` spread — the number the brief asked for, and it says the gate is inert.**

```
SHIP arm (tw=480):  p10 0.0000  p50 0.0950  p90 0.1163  MAX 0.1883   115 of 273 at EXACTLY 0
```

No settlement on Earth has an extraction rate above **19%** of nominal, 42% have none at all, and the interdecile among the nonzero is ~1.29× — inside the dead band the gravity memo used to disqualify `reachBudget` (1.05×) and the tier belt (1.33×, Reilly displacement 0.000). **I measured the consequence directly rather than arguing it: form B moves 20 of 273 settlements, adds +0.13pp of urbanisation, and takes the metropolis count from 7 to 8.** The gate the brief proposed is a no-op. *Say it plainly: `foodReach` is inert where it is on and lethal where it is off — the worst combination for a term deciding whether a city is a city.*

**The local-surplus headroom is a TAIL, not a level.**

```
_landFood / _coreNeed   p10 0.000   p50 0.101   p90 7.194   max 258.0     >=1 for 80 of 272
kLocal > 12 (the stamp)                                                    101 of 273  (37%)
_landFood == 0                                                             124 of 273  (45%)
```

The median city's own fields book **a tenth** of what its own 12k core eats. The top decile book **7×**. So the mechanism opens the ladder for a third of the register and leaves two thirds exactly where they are: **138 of 273 cores still read exactly 12.00 under M** (down from 212). It halves the plateau; it does not remove it.

**Against the gate and against history.**

- `npm run validate`'s urbanisation band is **agrarian 2-25%** (`tools/stylized.mjs:464`), read as Σ`_urbanPop` ÷ Σ`people` (`:451`).
- **M lands at 5.55%.** Today 2.26% (my reconstruction; live 2.07%, the 0.19pp being the census-side `ruralShare` heuristic that overwrites `_urbanPop` between derives, `settlement.js:3753-3754`).
- History's pre-industrial agrarian band is **5-15%**. **M lands on the bottom edge of it** — which is the right place for a world whose leading era is bronze/early iron. M2 gives 6.32%. Neither approaches the 25% ceiling; both are ~7× below the unclamped disk's 40.3%.
- Metropolis rung (`TIER_CORE[3]` = 40 sim = 40,000 urban people): **7 → 46 of 273**. Chandler's 1000 CE list holds ~70 cities over 40k. The largest core goes 598.6 → 1022 sim — Alexandria-scale to Rome-scale, a 1.7× stretch of an existing maximum, not a new anachronism in kind.

**And the ratio that decides which grid you may believe:**

| statistic (p50) | SHIP tw=480 | GATE tw=240 | ratio |
|---|---|---|---|
| `foodReach` | 0.095 | **0.596** | 6.3× |
| `_landFood / _coreNeed` | 0.101 | **8.202** | 81× |

**The same law reads two different worlds.** This independently reproduces, with a different probe, the audit's finding that the ledger books ~7% of the census's food at the shipped grid and ~130% at the reference grid.

---

## 3. WHAT THE REFUTERS KILLED OR NARROWED — explicitly

**KILLED — the `foodReach` gate.** Both refuters, and now my own measurement (form B: +0.13pp, 20 of 273 move). Also killed on SECOND-CARDINAL-RULE grounds: `LEVY_ORG_MIN = 0.35` is a bar on a dimensionless index calibrated for a *levy share*, and `settlement.js:802-811` states its contract as "ONE definition, two consumers" — both **transfers**. Promoting it to define an **identity** (is this a city) is a category change, and the first thing anyone would do on seeing the register move wrong is re-tune 0.35. **Retained from the refutation verbatim.**

**KILLED — the brief's own per-capita framing.** "Surplus = `_landFood` − ruralPop × per-capita" double-counts the farm-labour floor: `_landFood` is *already* net of it (`settlement.js:2802`; `tuning.js:604`: "the break-even fertility = this value"). Measured consequence: the second subtraction drives the surplus negative for 264 of 273. **The correction is load-bearing and I have verified it in source.**

**KILLED — the REPLACE form, and harder than the refuters could see.** Forms A and A2 leave **171** and **154** of 273 below the city bar. And here is the part every probe in this session — mine included — could not show: **`tools/_harness.mjs:74` pins `DISSOLVE_CORE: 0`, while the app ships it at `1` (`tuning.js:91`).** The dissolution law was disarmed in every measurement. At the configuration that ships, a form that drops 154-171 cores below `TIER_CORE[2]` fades them out of the register after `DISSOLVE_SUSTAIN = 1500` history-steps (`crystallize.js:1191,1304`). **The `max()` is therefore not a preference. It is a requirement.**

**NARROWED — "changing the read alone is a relabel."** Half right: no person moves on the field. But `_urbanPop` has ten behavioural consumers, and they are not labels: `settlement.js:3086` (ONE_BOOK mouths) · `:3111` (`_coreNeed`) · `:3659` (famine dependents) · `:3674-3678` and `:3712-3718` (demographic transition + urban graveyard) · `:1957` (science minds, `sqrt(_urbanPop)`) · `:3903` (the tier ladder) · `armies.js:328-329` (siege levée / walls) · `:540` (professional army cap) · `countryTerritory.js:1592` (administrative reach) · `crystallize.js:1301` (dissolution).

**NARROWED — the runaway algebra.** See §4; the refuter's gain calculation is wrong for the local branch and the error is identifiable.

**CONFIRMED and extended — the ledger/census divorce is the real constraint, not the 12k stamp.** `_landFood == 0` for 124 of 273; `_landFood/_coreNeed` p50 = 0.101. The plantability floor is the cause (`territory.js:480`, `_terrMinFert = 0.30 − 0.20·agriculture`, `:439`): land the field happily peoples books no harvest at all. **My form survives this only because `max()` uses the ledger as an upper-tail signal and never as the floor.** A biased-low ledger under a `max()` can fail to fire; it cannot over-fire. That asymmetry *is* the safety case.

---

## 4. THE RUNAWAY QUESTION

**Does it create or worsen the single-metropolis failure mode? No — and the measurement says the opposite.**

Under M the tier register goes `8/30/228/7` → `1/28/198/46`, lnσ 0.68 → 0.98, max 598.6 → 1022. That is **a distribution appearing**, not a primate city: the maximum grows 1.7× while the metropolis rung grows 6.6×. The actual failure mode is form E (the unclamped disk): p50 153, 190 metropolises, 40.3% urban in a bronze-age world. M is nowhere near it.

**The refuter's algebra is wrong for the local branch.** They wrote the loop gain as `fr·(1−is) + is → 1`, by treating `_k` as tracking `_urbanPop` at the provisioned fixed point. **Only the imported part of `_k` does that**, and that part is exactly `_k·importShare = kBeyond`. The local part is `_k·landShare ≈ (landFood + fish)/perCapita`, and `_landFood` comes from `_terrFertSum` (`territory.js:480-482`) — catchment fertility × climate × haul discount, minus a farmed-area labour charge. **None of those terms reads `_urbanPop`.** So `∂kLocal/∂_urbanPop ≈ 0` and **the loop gain of the changed read is unchanged at `importShare`.** Measured: `importShare > 0` for exactly **10 of 273**; p50 = p90 = 0.0000.

Two loops that do exist:

**(a) The import loop — same gain, more members.** A bigger core raises `mouths` (`settlement.js:3086`) → `demand` (`:3091`) → deficit → `GRAIN_PROVISION` buys → `_foodNet` ↑ → `importShare` ↑ → `kBeyond` ↑. Per-city gain is unchanged, but the change **enrols ~250 more cities into a loop currently open for 10.** That is a real amplification of the loop's *population*, and it is the honest residual risk. Brakes already present: seller offers (`max(0, pool − _foodDemand)` under ONE_BOOK), haul decay `exp(−d/range)`, granary cap, coin.

**(b) The spatial tier ratchet** — tier → `coreRadiusFor` / `hinterlandRadiusFor` (`territory.js:117-121, 128-133`) → owned tiles → `_terrFertSum` → `_k` → core → tier. Measured: **39 of 273 promote tier 2→3**, i.e. core carve 3→4 and belt 6→8. **Bounded by construction: `TIER_CORE` has four rungs and 40 is the last. A metropolis cannot ratchet again.** And the gravity memo already measured that at 4.5-tile median neighbour separation the 6-tile belt never binds (realised size ratio 1.33×, Reilly displacement 0.000), so most of those 39 promotions do not move a boundary at all.

### THE BRAKE — and it is not URBAN_GAMMA

The refuter's objection to `URBAN_GAMMA` is correct as far as it goes: `medDens` is a **median over importing cores only** (`popField.js:1944-1948, :1960`), today a 10-sample statistic, and a median-relative penalty cannot brake a shift in the median. **But that multiplier scales a base the refuter did not look at, and the base is absolute.** `settlement.js:3674-3678` and `:3712-3718`:

```js
const urbShare = (s._urbanPop || 0) / Math.max(1, s.people);
r    *= 1 - DEMO_TRANSITION * Math.min(1, urbShare / 0.5) * lit * fed;
s._rSink = SETT_GROWTH * URBAN_GRAVEYARD_W * diseaseLoad
         * Math.min(1, urbShare / 0.3) * (1 - healthRelief);
```

`popField.js:2125` then stamps that `_rSink` on the core tile. **So raising the read raises the death rate at the very tile it raised, absolutely, with no median in it.** Measured under M:

```
urbShare                       p50 0.042 -> 0.085
min(1, urbShare/0.3)  (sink)   p50 0.140 -> 0.284  (x2.03);  register mean 0.370 -> 0.441
```

**It saturates at urbShare = 0.30.** Under M, 71 of 273 already sit above it. So the brake is live throughout the 5-15% agrarian band this change lands in, and **gone above 30% urban**. That is the honest boundary of the safety argument.

**Second brake, measured live: the disk ceiling.** `min(_coreF, ·)` becomes the binding constraint for **46 of 273 under M against 25 today** — a live constraint on a sixth of the register, not decoration. But it is *weaker at the grid that ships* (§5).

---

## 5. THE MEASUREMENT THAT WOULD REFUTE IT

**First, the trap. `npm run validate` is structurally blind to this mechanism — I measured it, twice over.**

At the GATE arm (tw=240, harness defaults, seed 8817, 24k, n=39): `urbanCoreR` returns `max(0, round(rNormPop) − 1) = 0` (`popField.js:1576-1577`), so `_coreF = pf[centre tile]` — one 167-km tile — and the whole `LAND_KNOW` block at `:2030-2059` is skipped anyway because the harness pins `LAND_KNOW: 0` (`tools/_harness.mjs:74`). Two independent reasons the edited line does not execute. The consequence:

```
GATE arm:  live _urbanPop == M for 38 of 39,  == raw-disk E for 38 of 39
           live urbanisation 6.26%;  M gives 6.26%;  E gives 6.26%
           only 6 of 39 settlements move under M
```

**`T.CORE_LOCAL` is a literal no-op at `npm run validate`'s own configuration.** A green gate here is not evidence of anything. This is `SUCCESSOR_STATES` and `deffdce` again — validated in exactly the regime where it does nothing.

**So run these, in this order:**

**1. THE MILITARY BALANCE — run it FIRST, not last. Nobody would think to.**
`tuning.js:474` records that this exact split is knife-edge: walls and the paid core read `_urbanPop` (`armies.js:328-329` with `SIEGE_MOBILIZE = 0.20`; `:540`), the wartime conscript levy reads `_ruralPop` (`:555`). Measured under M: **urban mass ×2.45** (4,238 → 10,390 sim), **rural mass ×0.966**. Metric: `polity.shattered / ended / founded` per 4k steps, plus storms and sieges-lifted, paired A/B at **tw=480 and tw=960**. **Refuted if realm deaths collapse (the map ossifies) or explode.**
*Mitigating note I owe you honestly: `levyPop = min(s.people, _ruralPop / URBAN_BASE_RURAL)` with `URBAN_BASE_RURAL = 0.90` (`settlement.js:1591`) — at rural shares of 0.977 → 0.945 both sides of the change stay **clamped at `s.people`**, so the conscript half is likely untouched and only the defensive half moves. Likely, not measured. Measure it.*

**2. `tools/probe_shape.mjs 20000 1920 8817`, paired A/B at tw=960 — the two numbers that killed `SEED_EXCLUSIVE`.** Refuted if small states under 100k km² fall below ~20% of realms (baseline 5 of 14 = 36%) or size dispersion lnσ falls below 2.0 (baseline 2.68). The danger is concrete and I measured its driver: `countryTerritory.js:1592-1594` sets administrative reach at `full · min(1, sqrt(claimPop / 2500))` with `claimPop = _urbanPop`, and **the cap never binds** (`CLAIM_POP_REF = 1000`, `×2.5`; max `_urbanPop` under M is 1022). Measured multiplier `sqrt(M/T)`: **p50 1.000, p90 2.670, max 9.23.** The top decile of cities projects 2.7× further, plus 39 belts widening 6→8. **That is the same squeeze on marginal foundings the seed box died for.**

**3. The disk ceiling at the grid that ships.** `min(_coreF, ·)` binds for 46 of 273 at tw=480 (`coreR=1`, 3×3 disk). At tw=960 `coreR = 3` — a 7×7, 49-tile disk, ~292 km across — so the brake is far weaker. Metrics: coreF-clamp-bound share, and world urbanisation, at **tw=960**. **Refuted if tw=960 urbanisation exceeds ~15%** (history's agrarian ceiling), which would mean the disk has stopped holding it.

**4. The arming check.** `kLocal > holdF` for **101 of 273 (37%)** today at the shipped arm, **6 of 39 (15%)** at the gate arm. If flipping the lever does not move that number, the lever is inert and must not be recorded as validated. **Emit it through `collect()`** — same argument the gravity memo made for the boundary-displacement metric, same cheap instrument, and it would have caught both prior cases *by class*.

**5.** `npm run resgate`, `npm test`, `npm run monotone`, `npm run validate` — treating the last as a smoke test, not evidence, per the coreR=0 result above. No new state is added (the change reads only fields `popField.js:921` already reads), so `npm run coverage` is not triggered.

---

## 6. THE RISK THAT WORRIES ME MOST

**The military balance — because it is a 2.45× shift in a subsystem re-calibrated eight days ago, whose own tuning note says this split must be symmetric.**

`tuning.js:474` (WAR_FINISH, 2026-08-20/21): *"CITY WALLS AND PAID CORES ARE URBAN — homeMight's militia floor AND armyCapFrac's professional-core base both read s.people ... both now read the urban core (`_urbanPop`) ... while the wartime CONSCRIPT levy stays rural (`_ruralPop`)."* And: *"The first battery arm measured why the split must be symmetric: urban walls against catchment armies made every storm succeed (ended 96 + shattered 137 vs founded 36 per 4k steps, gini COMPRESSING to 0.39 — a boiling map that grinds instead of consolidating)."*

That battery calibrated the balance at `Σ_urbanPop / Σpeople = 2.07%`. **This change moves it to 5.55% in one flip.** WAR_FINISH deliberately weakened walls onto the urban core; this pushes 2.45× back the other way, world-wide, all at once, with no lever between them. The failure will not present as a bug in this mechanism — it will present as *"conquest stopped working,"* diagnosed weeks later in the war code by someone who never heard of `T.CORE_LOCAL`.

**Runner-up: the ledger, and what the next person does to it.** `_landFood == 0` for 124 of 273; `_landFood/_coreNeed` p50 = 0.101. My form is safe *only* because `max()` uses that number as an upper-tail signal. If someone later "improves" this by removing the plantability floor, or by scaling `kLocal` to lift the median off 12.00, the entire safety property evaporates in one commit. **Write the floor's load-bearing role into the code comment, not just into this memo.**

**Third: the export add-back.** `_k` includes `_foodExported` (`settlement.js:3547`), so an exporting settlement is credited for grain a buyer's `kBeyond` also counts. Small today. The exact fix if it bites is `(s._foodSupply/perCapita) · landShare` in place of `s._k · landShare` — which also drops the `K_MIN_VIABLE = 8` floor. That is form M2: 6.32% vs 5.55%, both in band.

---

## THE LOSING CASE, honestly

**1. It does not fix what the owner actually complained about.** 138 of 273 cores still read exactly 12.00 under M, because for 63% of the register the local ledger books less than the founding stamp. The plateau is halved (212 → 138), not removed. If the goal is "cities stop being all the same size," this delivers a **tail**, not a **mode**.

**2. It builds on a number the code cannot presently trust.** `_landFood/_coreNeed` p50 is **0.101 at the shipped grid and 8.202 at the reference grid** — an 81× regime difference in the same statistic. Building a city-size law on a ledger with that bias is precisely what the THIRD CARDINAL RULE warns about, and the disciplined alternative is to fix the ledger first and come back.

**3. The `max()` is a compromise, not a mechanism.** "A city holds the greater of its birth endowment and its economy" is not a law anyone would write from first principles. It is a law written around a broken denominator. It is defensible today — `STARVE_SHED` already melts the endowment, `DISSOLVE_CORE` already prices the floor at 10 and the endowment sits at 12 by explicit design — but it should be understood as **a marker for the ledger lap, not a finished design.**

**I judge (1) and (3) real but not disqualifying, and (2) mitigated by the very asymmetry that makes `max()` the right form: a biased-low ledger under a max can fail to fire; it cannot over-fire.** That is why I commit to building it — and why it ships at 0 until the war register has been run at both grids.