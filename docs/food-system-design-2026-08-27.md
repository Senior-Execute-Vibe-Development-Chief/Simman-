# The food system — design record (2026-08-27)

**What this is.** A long design conversation with the owner about how food moves in
this world produced a two-mode model (§1), a set of claims about how the code works
today (§2), and a set of claims about history used to justify both (§4). The claims
were made at speed and largely from memory. **They have since been verified against
the tree and against the literature, and a third of them did not survive.** This
document is the record: the model, the mechanism, the gaps, and — kept deliberately
visible — the corrections.

**Tree.** All code citations verified against `68b5676` (`git status` clean; probes
under `/tmp`, no source file modified). Line numbers are that tree's.

**How to read the tags.** Every claim carried over from the conversation is tagged:

| tag | meaning |
|---|---|
| **[CONFIRMED]** | checked against source or literature and correct as stated |
| **[CORRECTED]** | the original claim was wrong or overstated; the text here is the corrected version, and the footnote says what the original said |
| **[CONTESTED]** | the underlying evidence is genuinely disputed; the disagreement is part of the finding |
| **[PROPOSAL]** | design intent, not a measurement — nothing here has been built |

**The one-line summary of the verification.** Of 13 code claims: 4 confirmed,
6 overstated, 3 wrong. Of 13 historical claims (19 entries once composites are split):
4 confirmed, 4 wrong, 9 overstated or contested-stated-as-settled, 2 unverifiable.
**The two most load-bearing errors were both in the same place — the description of
how a tile is assigned to a city.** It is not a cost-spread, and it is not
cheapest-wins.

---

## 1. THE TWO-MODE MODEL

### 1.1 The principle

> **Food moves for one of two reasons: someone PAID for it, or someone TOOK it.
> These are different mechanisms with different geometries, different distance
> limits, and different failure modes, and a food system that models only one of
> them will get the shape of history wrong.**

**Mode M — the market.** A price exists at both ends. The buyer bids, the seller
may refuse, and the haul is paid for out of the margin. Its distance limit is
economic: grain moves until the freight eats the spread. Its signature is
*price-responsive* — dearth pulls grain toward the dear market, and a route that
stops paying stops carrying.

**Mode C — compulsion.** No price at the origin. A levy, a tithe, a tribute, a
requisition; the cultivator's consent is not an input. Its distance limit is
administrative, not economic — the *annona* crossed the Mediterranean at a cost no
merchant would have borne, because the state was not trying to make a margin. Its
signature is *insensitive to price and sensitive to authority*: it flows while the
state can compel, and stops the day it cannot.

**The two are not variants of one thing.** A market shed and a tribute shed have
different shapes on the map, and the same city can sit at the centre of both at
once — Rome bought from Campania and levied from Egypt.

### 1.2 The tribute/rent split inside Mode C

Compulsion divides again, and the split matters because the two halves behave
differently under stress:

- **Rent / tithe** is taken from the *cultivator*, locally, by whoever holds the
  land right. It is a first claim on the harvest; the surplus reaching any market
  is what is left after it. It does not travel far as grain — it is typically
  consumed or sold near where it is taken.
- **Tribute** is taken from a *polity* by a superior polity and travels the length
  of the political hierarchy. It is the mechanism that puts grain in a capital
  that its own countryside could never feed.

A world with rent but no tribute has fed hinterlands and starved imperial capitals.
A world with tribute but no rent has capitals fed from nowhere in particular. **The
current code has both** (§2, flows 4-6) — the conversation initially claimed it had
neither, which was wrong.

### 1.3 The hybrid: staple rights **[CONFIRMED]**

The clean two-mode split has a historically important hybrid, and it is the case
that shows the modes are not exclusive. Under a **staple right** (*Stapelrecht*,
*droit d'étape*), a town holds a legal privilege compelling passing merchants to
unload their cargo and offer it for sale in that town for a fixed period before
continuing. **The routing is compelled; the transaction is a market.** Dordrecht,
Cologne, Bruges and the Calais wool staple all worked this way.

This matters for the design because it is the mechanism by which **law creates a
market centre where geography did not put one** — the same class of thing as
Bracton's 6⅔-mile franchise rule (§4.3), pointed the other way. Bracton's rule
*forbids* a rival; the staple right *compels* custom. Both are legal instruments
acting on the catchment, and neither is representable in a partition drawn by
distance alone.

### 1.4 What the two-mode model would replace

**Not the flows.** The flows already exist and are already split M/C (§2). What the
model would replace is narrower and more specific:

> **Today, the question "whose fields are whose" is answered by neither mode.
> It is answered by geometry — nearest-wins, plus a Dijkstra frontier bounded by an
> administrative reach budget — with no price anywhere in it and no authority
> anywhere in it.**

Measured: a plain Euclidean Voronoi over the same land reproduces the live partition
moving only **14.2% of tiles** (`docs/gravity-partition-memo-2026-08-27.md:65-67`);
ρ(`_grainPrice`, catchment tiles) = **−0.011**. **`world._territoryOwner` is, today,
a Voronoi diagram.**

So the model's claim on the code is: **the land partition should be an output of the
two modes, not a substitute for them.** A market centre should hold the land whose
grain it outbids rivals for (Mode M); a state should hold the land it can compel
(Mode C); and where the two disagree, the disagreement should be visible rather than
averaged into a distance rule.

**[PROPOSAL] — and it is important to say what it is not.** Nothing in §1 has been
built. The nearest concrete build sketch is `T.MARKET_PULL` (§3.1), which implements
only Mode M, only as a bid-rent boundary, and which measurement says would be
**inert at the register that ships**. The two-mode model is the frame the gaps in §3
are stated against; it is not a plan of record.

---

## 2. HOW THE FOOD SYSTEM WORKS TODAY

### 2.1 The flows — six, not three **[CORRECTED]**

> *The conversation claimed there were three food flows: a settlement eating its own
> catchment, the levy tree, and the peer market — with `FARM_RENT` explicitly not a
> fourth. The three named are real. The list is not exhaustive: at shipped defaults
> there are at least six, and the three missing ones are different in kind — they are
> the entire Mode C half of §1. `FARM_RENT` is correctly excluded, but for a reason
> worth stating precisely.*

| # | flow | mode | mechanism | ships |
|---|---|---|---|---|
| 1 | **Own catchment** | — | the harvest over the settlement's own tiles, distance-discounted | always |
| 2 | **Levy, child → liege** | **C** | in-kind requisition up the market tree, unpaid | always |
| 2b | **Purchase, child → liege** | **M** | the liege buys the remainder with coin | always |
| 3 | **Peer market** | **M** | a short city buys a peer's residual | `GRAIN_MARKET` = 1 |
| 4 | **Tribute of land** | **C** | polity skims grain off the *field people*, never off a settlement ledger | `TRIBUTE_OF_LAND` = 1 |
| 5 | **Tribute up the pyramid** | **C** | a dependency remits a share of (4) to its overlord — *across realms* | `TRIBUTE_UP` = 0.33 |
| 6 | **Court exchange** | **C→M hybrid** | courts barter grain for metal/prestige at fixed customary ratios | `CRAFTS_OF_LAND` = 1 |
| 6b | **Colony subsidy** | **C** | granary → granary, capital to young colony, and metropole to dependency | always |

**Flow 1 — the settlement eats its own catchment.** `_storableSupply = landFood`
(`settlement.js:3308`), `_foodSupply = netLand + fish` (`:3312`), where `landFood`
comes from `_terrFertSum`, the falloff-weighted harvest over the catchment
(`territory.js:481`). Fish is deliberately local — perishable, never exported.

**Flow 2 — the levy.** `foodHierarchy.js:306,312`: `levyShare = LEVY_MAX ×
foodReach(node)` with `LEVY_MAX = 0.7` (`:70`). A fully-organised state requisitions
up to 70% of a child's shippable offer **in kind, with no coin paid**; the remainder
(2b) it buys at the child's `_grainPrice` if it has spare coin. The gate is
`L.countryId === s.countryId` (`:251`) — **[CONFIRMED]**: the levy is strictly
intra-realm, and the comment states the intent (a stale `liegeId` after an absorption
must not ship grain across a border).

**Flow 3 — the peer market.** `foodHierarchy.js:411-520`. Three properties the
conversation got half-right (see §2.2).

**Flow 4 — tribute of land.** `entities.js:300-362`. **This is a parallel grain
economy that never touches a settlement's food ledger.** The polity skims
`TRIBUTE_RATE` = 0.10 of extraction from the *field people* under its borders into
`p.tribute`; overflow above the store cap is **sold into the capital's own market**
at the capital's live `_grainPrice`, with the coin coming out of that capital's
wealth so the money supply stays closed (`entities.js:377-397`); and a capital under
famine pressure draws the store down (`settlement.js:3332-3338`).

**Flow 5 — tribute up.** `entities.js:351-361`. `T.TRIBUTE_UP` (ships 0.33) remits
that share of a dependency polity's in-kind tribute to its overlord, one level per
pass. **This is compelled, in-kind, cross-realm food movement** — and it is the
counterexample to the otherwise-correct statement that compelled flow is intra-realm.

**Flow 6 — court exchange.** `entities.js:407-448`. Grain for metal or prestige
between courts at fixed customary ratios (`COURT_RATIO_METAL` 80,
`COURT_RATIO_PRESTIGE` 240) — a bronze-age gift/exchange economy, priced by custom
rather than by scarcity.

**`FARM_RENT` is not a food flow — precisely.** **[CONFIRMED, sharpened]**
`rentDue = s._landFood × FARM_RENT × serfMul × taxMul × POLITY_INTERVAL`
(`conquest.js:3525-3530`) is **priced off the harvest but paid from `s.wealth`**,
purse-capped, with the unmonetized remainder credited as `gov._inKind` that offsets
the army wage bill (`:3546-3557`, `:1828-1831`). **No food ledger, granary or
`_foodNet` is ever debited.** It is a fiscal flow with the harvest as its tax base —
which is exactly the rent half of §1.2 *modelled on the money side only*.

### 2.2 The peer market's seed-corn rule **[CORRECTED]**

> *Claimed: "any settlement whose granary is full sells the excess, with a seed-corn
> rule so it refills its own stores before exporting." The rule is exactly as
> described — in the peer market, and nowhere else.*

```js
const surplus  = Math.max(0, (p._foodNet||0) - (p._foodDemand||0));
const residual = Math.max(0, surplus - Math.max(0, granaryCap(p) - (p.food||0)));
```
`foodHierarchy.js:479-480`, with `granaryCap` the same clamp `updateFood` applies
(`settlement.js:3352-3355`). Three qualifications:

1. **It does not apply to the levy tree.** A child's offer is
   `max(0, pool − _foodDemand) × arrive` with **no granary term**
   (`foodHierarchy.js:348-350`), and its liege then requisitions up to 70% of that
   unpaid. **A settlement's stores are protected from its trade peers but not from
   its overlord** — which is the two-mode model falling out of the code by accident,
   and arguably correct.
2. **A settlement does not "sell" — it never initiates.** The pass is buyer-driven:
   only a buyer with `techEff().market`, spare coin above its wealth reserve, and the
   seller inside its `mergeReach` draws the residual down (`:411-436, :465-478`).
3. The whole pass is behind `T.GRAIN_MARKET` (ships 1).

### 2.3 The two decay laws — and the two distance metrics **[CONFIRMED, strengthened]**

There are two independent distance discounts in the food system, and they disagree
on both the law and the metric.

| | the catchment harvest | the market haul |
|---|---|---|
| **law** | hyperbolic `1/(1 + 0.5c)` | exponential `exp(−d/range)` |
| **where** | `territory.js:100`, applied at `:481` | `foodHierarchy.js:155` |
| **metric** | accumulated **transport cost** (resolution-normalised) | straight-line **Euclidean tile distance** |
| **terrain** | full cost field — rivers cheap, mountains dear | **none at all** |
| **grounding** | a tuned discount, no physical unit | real km: `HAUL_LAND_KM = 340`, `EARTH_KM = 40075`, `baseTiles = 340/(40075/tw)` |
| **tail** | never reaches zero | never reaches zero |

The 340 km e-folding is Diocletian's Price Edict (ox-wagon +55% per 148 km, so
148/ln 1.55), and water multiplies the range by 12 (the edict's land:water freight
ratio), blended by seamanship (`foodHierarchy.js:108-122`, `T.HAUL_PHYS` ships 1).

**The strengthening the conversation missed:** it is not only two decay *laws*, it is
two distance *metrics*. The catchment's distance is terrain-aware accumulated cost;
the haul's is a straight line across the map with no terrain in it whatsoever. **A
mountain range shrinks a city's fields and does nothing at all to its imports.**

### 2.4 How a tile is actually assigned **[CORRECTED — the most important correction in this document]**

> *Claimed: "the catchment is assigned by a cost-spreading search over the transport
> field, so distance is travel effort, not straight line; rivers cheap, mountains
> dear, better roads lower cost per step" and "a tile has no choice at all — it goes
> to whoever reaches it cheapest."*
>
> *Two of the three claim paths are pure straight-line geometry, ownership is
> persistent so first-claimer-wins beats cheapest-reach, the Dijkstra does not
> minimise cost, and roads are explicitly ignored.*

`computeTerritory` (`territory.js`) runs **three phases in order**, and the later
ones cannot take what the earlier ones locked:

**Phase 1 — the guaranteed core.** A **Chebyshev square** (`for dy… for dx…`, no
distance test) of radius `CORE_BY_TIER = [1,2,3,4]` by tier, first-claim-wins in
settlement order (`territory.js:284-296`). Pure geometry.

**Phase 2 — the guaranteed hinterland belt.** A **Euclidean nearest-wins disk** of
radius `HINTERLAND_BY_TIER = [3,4,6,8]` by tier: `if (d2 < hintDist[ti]) { … }`
(`:315-329`). **This is literally a Voronoi tessellation**, weighted only by the
4-rung tier ladder.

**Phase 3 — the Dijkstra frontier.** Multi-source over `localEdgeCost` (`:335-412`).
Rivers *are* cheap (`transport.js:281-284`, `params.river = max(0.15, 0.50 −
cons×0.30)`, banded by magnitude) and mountains *are* dear (`:287-303`, relief =
`e*5 + e²*14` plus slope and ridge terms). But:

- **Locked land is a wall, not a contest.** `const base = owner.slice()` snapshots
  phases 1-2 and every tile already owned; `if (lk >= 0 && lk !== oid) continue`
  (`:335, :374`). **A later settlement that could reach a tile far more cheaply never
  gets it.** The honest phrasing is *"a tile goes to whoever claimed it first, and
  among unclaimed tiles mostly to whoever is nearest, with cost-effort deciding only
  the residual frontier."*
- **Roads are explicitly ignored.** `localEdgeCost(world, ti, ni, kn, true, true)` —
  `ignoreRoads` **and** `noPortTax` (`:380`), skipping the road short-circuit at
  `transport.js:259-266`. Construction *tech* lowers per-step cost; road *tiles* do
  not, by design ("political reach follows TERRAIN, not roads").
- **The frontier does not minimise cost.** It minimises **value-discounted effort**:
  `eff = step / (1 + T.VALUE_PULL × val)`, `VALUE_PULL` def 0.3 (`:394`). The true
  haul cost is tracked separately in `tcost` (`:397, :414`) and is what feeds the
  food falloff — so the harvest is honest even though the ownership race is not.
- **`CATCHMENT_CLIP` (ships 1) vetoes any tile outside the settlement's own
  country** (`:237-241, :292, :325, :409`). Market competition between centres is
  therefore **intra-country only** — a metropolis can never outbid a rival across a
  border. The Hanseatic case is structurally impossible in this engine today.
- A newborn's pre-pass ledger uses **raw Euclidean distance** in place of cost
  (`:641-642`).

**What survives the correction:** the second half of the second claim. **There is no
price, wealth or market term anywhere in `territory.js`** (the only `wealth` hit is
ruin-hoard recovery, `:164`), and all four live uses of `_grainPrice` are in the food
market and the crown's tribute sale (`foodHierarchy.js:314, :413, :487`;
`entities.js:390`). That is gap §3.1.

### 2.5 The reach budget **[CORRECTED]**

> *Claimed: "organisation buys reach, other tech buys efficiency per step — and
> reachBudget is a pure function of organisation." The split is real and enforced.
> The "pure function of organisation" half is false at the shipped default.*

`reachBudget(s) = TERRITORY_BASE(5) + reach × T.ORG_REACH(7)` and nothing else
(`territory.js:48, :90-91`), scaled by `rNormPop` at the call site (`:206`). The
split is genuinely enforced: `_paramsFromKnowledge` reads **only** construction,
mobility and navigation, and the header states it — *"organization → does NOT enter
here; it controls reach budget"* (`transport.js:120-121, :161-164`).

But `reachLevel = lerp(org, lvl(ch.reach,'reach'), blend)` with `blend =
T.TECH_EFFECTS`, **which ships 1.0** (`tech.js:579`, `tuning.js:803`). The continuous
`knowledge.organization` term is fully lerped **out**; `reachLevel` is the normalised
sum of *discovered reach techs* — writing 0.35, code_of_laws 0.10, currency 0.08,
democracy 0.08, feudalism 0.06, industrialism 0.06, philosophy/printing/computing
0.05, university/sci_method/telegraph/paper 0.03-0.04, economics 0.05
(`tech.js:444-463`). `knowledge.organization` survives only as the pre-cache
fallback (`territory.js:90`).

**Noted because it is funny and also a real inconsistency:** `roads: {reach: 0.03}`
means **road tech buys reach, while road tiles are ignored by the reach cost
function** (§2.4).

### 2.6 Prices **[CORRECTED]**

> *Claimed: "grain prices are set by city tier — 2, 8, 14, 22." The array is exact;
> the tier value is only the base.*

`GRAIN_PRICE_BY_TIER = [2, 8, 14, 22]` (`foodHierarchy.js:170`), but the live price is

```js
scarcity = clamp((_foodDemand||1) / max(0.01, _foodSupply), 0.5, 3);
s._grainPrice = GRAIN_PRICE_BY_TIER[tier] * scarcity;      // :236-238
```

so realised prices span **1 to 66** and are as much scarcity as tier. Measured
register: p10 7.00 / p50 21.54 / p90 42.00 / max 42.00 — **half the register pinned
at the 3× clamp** (`docs/gravity-partition-memo-2026-08-27.md:65`). Say *"tier base ×
a real scarcity multiplier"*, and note that the clamp is binding for half the world.

**Footnote worth carrying:** there is a **second, unrelated grain price** — the goods
layer's `P[G_STAPLE]` scarcity price (`goods.js:145, :263-274`) — which never moves
grain (staple is excluded from `TRADABLE`, `goods.js:50-54`) and feeds only induced
innovation and a "dear goods" signal (`settlement.js:2095, :2311`). Two things named
"the grain price" in one codebase.

### 2.7 Rivers **[CONFIRMED]**

> *Claimed: rivers are real hydrology — D8 flow, pit-filling, flow accumulation,
> lakes, and the distinction between a river reaching the ocean and one dying in a
> terminal basin. Every element is present as a named stage.*

Priority-flood pit filling with a min-heap seeded from ocean and map edges
(`riverGen.js:83-153`); inland-sea detection separating true ocean from endorheic
water, with a single-bridge rule for 1-tile straits (`:155-202`); lake depressions
detected then validated against actual river inflow (`:204-244, :555+`); D8 flow
direction on the filled surface with a deterministic per-tile hash to break
dead-straight channels (`:246-278`, `D8_DX/D8_DY` exported at `:8-9` so the
market-site ledger cannot desynchronise); flow accumulation by topological sort
(`:279+`); endorheic termination (`:358+`).

**The ocean/terminal distinction is not cosmetic — it gates physics.**
`TRANS_LOSS = 0.30` per-tile transmission loss applies **only** to flow bound for a
terminal sink or inland sea, so the Nile/Tigris/Indus cross desert to the sea
untouched; `TERMINAL_STRICT = 2.5` requires a closed-basin river to carry 2.5× the
catchment to be drawn at all (`riverGen.js:34-47, :67`).

### 2.8 The shipped lever state (food-relevant)

| lever | def | what it does |
|---|---|---|
| `TRIBUTE_OF_LAND` | 1 | flow 4 |
| `TRIBUTE_UP` | 0.33 | flow 5 |
| `CRAFTS_OF_LAND` | 1 | flow 6 |
| `GRAIN_MARKET` | 1 | flow 3 |
| `GRAIN_PROVISION` | 1 | the annona: deficit + granary refill at the pace of the city's own mouths |
| `HAUL_PHYS` | **1** | the haul in real km (v50) |
| `GRAIN_FREIGHT` | **1** | the buyer pays at the farm gate (v50) |
| `GRAIN_BID` | **1** | scarce grain to the highest bidder, not the oldest city (v50) |
| `CATCHMENT_CLIP` | 1 | catchment clipped to own country's ground |
| `CROWD_FOUND` | 1 | founding rate × basin people |
| `FARM_RENT` | 0.4 | fiscal, not food (§2.1) |
| `MINT_RESIDUAL` | **0** | §3.4 |
| `MINT_REACH` | **0** | measured structurally inert |
| `SEED_EXCLUSIVE` | **0** | refuted, §5.3 |
| `CORE_LOCAL` | **0** | §5.2 |

---

## 3. THE GAPS

Five, each with its evidence and a proposed mechanism. **None of these is built.**

### 3.1 No price enters tile assignment

**Evidence.** No price, wealth or market term anywhere in `territory.js`
(§2.4); ρ(`_grainPrice`, catchment tiles) = **−0.011**; a plain Euclidean Voronoi
reproduces the live partition moving **14.2%** of tiles; the guaranteed belt's
*realised* size ratio is **1.33×** with median Reilly displacement **0.000**
(`docs/gravity-partition-memo-2026-08-27.md:65-67, :137`). The economic catchment at
the register that ships **has no live size term at all**.

**Why this is the two-mode model's sharpest gap.** Mode M's whole content is that the
market paying more takes the field. The code has prices, has scarcity, has a haul
curve — and none of it reaches the partition.

**[PROPOSAL] `T.MARKET_PULL`, def 0 — the bid-rent race, not the Huff power law.**
A tile's grain goes to the market paying most at the farm gate; because the haul is
already `exp(−d/range)`, in logs the race is additive:

```
claim ti to  argmin_i [ cost(i,ti) − haulTiles · ln A_i ],   haulTiles = 340/(40075/tw)
```

with `A = s._coreMeasured`, normalised by the **geometric mean of this pass's
measured cores** so an unmeasured settlement's weight is exactly 1 and the dawn
bootstrap is byte-identical. Full sketch, three insertion points and the persistence
requirement (`_coreMeasured` must join `SETT_FIELDS`, `persist.js:77-108`, or
save/load determinism becomes a coin flip): `docs/gravity-partition-memo-2026-08-27.md` §4.

**Why additive and not Huff.** Huff's loop gain is scale-free — a 2× bigger city
always takes the same *fraction* more land at every size, which is the documented
`SIZE_BY_POP` pathology (`tuning.js:348`: *"a pure proportional feedback with NO
interior fixed point"*). The additive form's gain falls with size, and its scale term
is `HAUL_LAND_KM`, a real distance that does not move when the border moves. **It
introduces no new constant and no exponent to pick.**

**What would refute it.** `probe_shape` paired A/B at tw=960: small states <100k km²
falling below ~20% of realms, or size dispersion lnσ below 2.0. **And the arming
check nobody would think to run:** the share of touching catchment pairs whose
boundary moves ≥1 tile from nearest-wins (31% today, median 0.00 tiles). *If flipping
the lever does not move that number, the lever is inert and must not be recorded as
validated, no matter how many gates it passes.*

**The standing warning attached to this proposal.** At the shipped register the law
reshuffles 30-39% of tiles while leaving the size distribution alone (catchment lnσ
1.63-1.65 against nearest-wins' 1.61). That is churn without hierarchy. **The
prerequisite lap is the 12k core pinning, not the partition** (§3.5).

### 3.2 Two inconsistent decay laws — and neither is von Thünen

**Evidence.** §2.3: hyperbolic over accumulated terrain cost for the harvest,
exponential over straight-line distance for the haul. Only one of the two is
physically grounded.

**[CONTESTED — and the conversation got the history backwards.]** The conversation
argued that von Thünen's rings *end* because real transport cost is linear per
ton-mile, so value surviving falls linearly and hits exactly zero at a definite
distance. **In the model this is right** — locational rent declines linearly and
reaches zero at the margin of cultivation, beyond which lies von Thünen's
wilderness. **In the world it is an assumption, not a measurement.** Linear
per-ton-mile cost is what von Thünen *assumed*. Real freight has a large fixed
terminal/handling component plus a line-haul rate that **tapers** with distance
(visible in modern rates — long-haul $0.55-1.10/mile against short-haul
$1.75-2.75/mile — and pre-modern as loading costs and per-town tolls).

**Why this matters here rather than being pedantry:** *linear cost gives a hard
catchment edge at a definite radius; a taper gives a soft, long, thin tail with no
exact zero.* That is a modelling choice to make deliberately. **The engine currently
has the taper** (both laws are asymptotic and neither ever reaches zero), which is
defensible — so the gap is **not** "we should adopt von Thünen's hard edge". The gap
is that **the two tails disagree with each other and use different metrics.**

**[PROPOSAL].** Unify the metric before unifying the law: the harvest's terrain-aware
cost is the better metric, and the haul's real-km grounding is the better law.
A single distance kernel — an exponential in **real km of accumulated transport
cost** — would serve both, and would make a mountain range shrink imports the way it
already shrinks fields. Blast radius is large (the harvest kernel is read by the
capacity ledger); this is its own lap, at both grids.

### 3.3 Organisation gates the farming catchment

**Evidence.** `reachBudget = TERRITORY_BASE + reachLevel × ORG_REACH` (§2.5) is an
**administrative** reach term, and it is the only budget bounding an **economic**
catchment. A city's fields extend because its realm discovered *writing*.

**Why it is a category error, in the two-mode frame.** The distance a cart can haul
grain and still leave a margin is Mode M physics — carts, roads, terrain,
perishability, the price spread. The distance a state can govern is Mode C. The code
uses the second to bound the first. The irony in §2.5 sharpens it: road *tech* buys
reach, road *tiles* do not.

**[PROPOSAL].** Bound the harvest catchment by haul economics — the distance at which
the falloff-discounted value of a tile stops covering the trip — and leave
`ORG_REACH` to `countryTerritory.js`, where administrative reach belongs and where it
already scales with the urban core (`countryTerritory.js:1592-1594`). **Caution:**
this is the largest-blast-radius item in §3 and it interacts with §3.1 and §3.2; it
should be specified after both, not before.

### 3.4 Founding reads a veto, not a pull **[CORRECTED]**

> *Claimed: "`MINT_RESIDUAL` was written as a veto (don't found where land is taken)
> rather than a pull (found where surplus is wasted), and a veto can only stop
> over-crowding, never draw a city toward empty rich land."*
>
> *Wrong on the code, defensible on the conclusion — for a different reason.*

`MINT_RESIDUAL` has **three** reads and one of them **is** exactly the pull the claim
says is absent: it re-points `CROWD_FOUND`'s founding-**rate** gradient at
`residualBasinMass`, so more unmarketed people means a proportionally higher founding
rate and *"saturated valleys damp toward 0 instead of pegging CROWD_CAP"*
(`crystallize.js:2801-2809`). The other two reads are bars — the shared city bar
`cityBasinOkAt` (`:1249-1252`) and site-lane eligibility (`:1454-1459`).

**Two further corrections.** (1) The lever **ships OFF** (`tuning.js:95`, def 0), so
today it is neither veto nor pull — it does nothing. (2) It measured **near-inert
even when on** (turnover 385→342, anchors 19→21, realms 49→70), because the exclusion
removes 90% of the mass and the subcontinental disk still clears the bar everywhere.

**The conclusion survives on different grounds, and this is the real gap:** the read
is **unmarketed PEOPLE, not unworked LAND**. It cannot pull a city toward land that
is rich but *unpeopled* — empty land has no field mass either way. Cities therefore
crystallise where people already are, never where the surplus *could* be.

**And the deeper defect underneath it** — measured, and worth more than the lever:
`townBasinMass` is a bare Euclidean disk sum with **no ownership test**, radius
`TOWN_BASIN_R × rNormPop` = **1,670 km** (~8.8M km², roughly Australia). 65.3% of
covered tiles sit under more than one disk, up to **8 cities share one tile**, and
summed basin mass is **3.58×** the people actually standing there
(`crystallize.js:169-181, :360-383`; `docs/catchment-audit-2026-08-27.md` §2).
**One constant serves six unrelated physical questions** — the mint bar, the dissolve
bar, the founding-rate reference, the hearth ignition basin, a harbour's shelter test,
and (via `CAGE_HORIZON_REF`) the exit ring of the caging field, the core drive of
state formation. No number can be all six, and because the disk is so permissive
every attempt to make it bind has measured inert.

**[PROPOSAL].** A residual-**capacity** read (unworked carrying capacity within haul
range) rather than a residual-**people** read, on a radius grounded the way
`HAUL_LAND_KM` is — a real distance converted at the world's own km-per-tile, no
`rNormPop`. Split `TOWN_BASIN_R` into the questions it actually answers first;
**measure the cage exit ring before touching it.**

### 3.5 The converged input — the inertness that hides everything above **[CORRECTED]**

> *Claimed: "organisation converges across the world to a spread of 0.001, so nobody
> out-reaches anybody and the catchment collapses to a plain nearest-wins carve-up."*
>
> *The 0.001 is real but it is not a world spread, and the statistic it comes from
> hides the tail. The conclusion survives on a better statistic.*

The 0.001 is the **p90−p50 spread of CAPITALS' `techEff.reachLevel`** as printed by
`tools/probe_consol.mjs:58,:74` (which labels it "org pack" while measuring
`reachLevel`), quoted from one arm into `docs/harvest-years-2026-08-25.md:538` and
thence into `tuning.js:116` and `docs/catchment-audit-2026-08-27.md:175`.

**Re-measured independently this session** (own probe, harness defaults, seed 8817):

| | tw=240 / 30k | tw=480 / 24k |
|---|---|---|
| capitals' `reachLevel` p50/p67/p90 | 0.7568 / 0.7568 / 0.7568 | — |
| p90 − p50 | **0.0000** | **0.0337** |
| full `reachLevel` range | 0.6194 – 0.7568 | 0.2008 – 0.7253 |
| `reachBudget` max/min | **1.103** | **1.574** |
| `reachBudget` **max/p50** | **1.000** | **1.032** |

So *"the world converges to 0.001"* is **false**; *"the upper half of the capital pack
is within 0.001-0.03"* is **true**. **Quote `reachBudget` max/p50 = 1.00-1.05** — it
matches the memo's independently measured 1.02-1.05 at every arm and both grids, and
it is the number that actually bears on the partition.

**The consequence stands and is separately measured.** The guaranteed belt *is*
literally nearest-wins (`territory.js:326`), its realised size ratio is 1.33× with
Reilly displacement 0.000, and a plain Euclidean Voronoi reproduces the live partition
moving 14.2% of tiles.

**Why this is a gap and not just a measurement.** The same flatness exists one layer
up: **186 of 273 urban cores sit at exactly 12.00 sim units**, the founding stamp
`_coreHoldCapF = TIER_CORE[2]/bridge × 1.2` (`crystallize.js:1751`,
`settlement.js:74`). A world whose cities are all the same size **has no market
gravity, and it is correct for a market-gravity law to be inert in it.** Reilly
between two identical towns puts the boundary at the midpoint — which is
nearest-wins.

**The risk this creates, stated as the thing most likely to bite months from now:**
a market-pull law shipped today would pass every gate **because its input is currently
a constant**, be recorded as validated, and then **arm itself later** when the
core-unpinning lap lands — reshaping the political map with nobody looking at the
lever, because it was validated months earlier. That is the `SUCCESSOR_STATES`
pattern (*"validated in exactly the regime where it does nothing"*) with a delay
fuse, except the regime is not a grid you can switch to — it is a stage of the
world's development that has not happened yet, and under the FIRST CARDINAL RULE you
cannot fast-forward to it. You have to grow it.

**Therefore, the ordering of laps is itself a finding: core first, partition
second.** And emit the arming number (§3.1) through `collect()` so the day the core
unpins, the arming shows up in `npm run observe` as a moving number instead of as a
mysteriously redrawn map.

---

## 4. HISTORICAL GROUNDING

**Read this section as a corrections list, not as a bibliography.** The historical
claims in the conversation were made from memory and at speed; the verification pass
covered 13 of them (19 entries once composites are split) and returned **4 confirmed,
4 wrong, 9 overstated or contested-stated-as-settled, 2 unverifiable**. Sixteen
entries are reproduced below. **Where a number is contested, the disagreement is
stated rather than resolved.**

*Three entries of the 19 are not reproduced here — including both UNVERIFIABLE
verdicts — because their text did not reach this record. They exist only in the
verification output. If a claim you remember from the conversation is absent below,
treat it as unverified rather than as verified-and-omitted.*

### 4.1 City sizes

| claim as made | verdict | corrected |
|---|---|---|
| ~50,000 is the practical ceiling for a premodern city without water transport or state grain administration | **OVERSTATED** | mechanism yes, number no — see below |
| typical medieval towns held 2-10k | **OVERSTATED** | the modal chartered market town is **500-2,000** |
| Ghent, Bruges, Cologne 40-60k | **CONFIRMED** | top edge contested |
| Florence, Venice ~100k | **CONFIRMED** | slightly low: 110-120k / 120-150k |
| Paris 200-250k by 1300, biggest in Latin Europe | **OVERSTATED** | "biggest" stands; the figure is contested and misdated |
| Constantinople, Baghdad, Kaifeng, Hangzhou, Edo near or at a million | **WRONG** | splits three ways |

**The 50,000 ceiling — the mechanism is documented, the number is not.**
The transport-cost asymmetry is real and standard: sea : river : land ≈ **1 : 5 : 28**,
and it was cheaper to ship grain the length of the Mediterranean than to cart it
~75 miles (Duncan-Jones, *The Economy of the Roman Empire*, 1982). But "50,000" is a
rule of thumb that has acquired a decimal point, and I could find no scholarship
behind it. Counterexamples survive the "or a state grain administration" escape only
awkwardly: **Teotihuacan** held 100,000-200,000 at peak (c.450-500 CE) with no draught
animals, no wheeled vehicles and no navigable water; Aleppo, Damascus, Fez and Isfahan
were all large, inland and non-navigable. **Madrid** fits the claim's logic best and
its number worst — ~150,000 by the 1630s on a non-navigable river, sustained by
exactly the state provisioning the claim posits, at enormous cost to Castile
(Ringrose, *Madrid and the Spanish Economy 1560-1850*, 1983).
**Safe form for the doc:** *"the ceiling is set by carting cost, and water carriage or
a state provisioning system is what raises it"* — with no specific figure, or an
order-of-magnitude band (10⁴-10⁵).

**Medieval town sizes.** 2-10k describes the tier **above** the modal market town. In
England the great majority of small towns held fewer than 2,000 (most above 300);
"true towns" ran 2,000-8,000, averaging toward 2,500-3,000. About 10% of England's
population lived in towns over 2,000 and a further 5% in small boroughs, some as small
as 300; England had roughly **760 market towns**, most at 200-500 families
(*Cambridge Urban History of Britain*, vol. I, "Small towns 1270-1540").
**This is the number that matters for this codebase**, because it is the register
`DISSOLVE_TOWNS` deliberately does not mint (see `CLAUDE.md`): the sim's entity
register is the *city* register, and the 500-2,000 tier lives in `popField`.

**Ghent/Bruges/Cologne.** Fair band, upper edge contested in both directions: Ghent is
usually placed at or above it (up to 64-65,000 within the walls by the 13th-14th c.,
though one line of estimate puts it at ~50,000 in 1300), conventionally the largest
city north of the Alps after Paris; Cologne is sometimes put at 50-55,000 by 1300,
falling to 35-40,000 by the sixteenth century. **[CONTESTED]** — treat 40-60k as a
band whose top edge is disputed, not as three cities that all sat inside it.

**Florence/Venice.** ~100k is a floor, not a centre. Florence c.1338 was about
**115,000-120,000**, falling to ~50,000 by 1351; Venice is estimated at
**120-150,000** pre-plague ("The population of Florence before the Black Death",
*Journal of Medieval History* 28:2, 2002). For the top of the Latin-European urban
hierarchy below Paris, **110-120k** beats 100k.

**Paris. [CONTESTED — and this is a live debate, not a settled figure.]** "Biggest in
Latin Europe" is the standard view and stands. The 210,000-270,000 range comes from
applying a 3.5-4.5 multiplier to the **61,098 hearths of the *État des paroisses et
des feux*** — which is **1328, not 1300**, and is a **fiscal** document. Whether a
*feu* is a household or a fiscal unit is exactly the contested point; readings that
treat it fiscally, and the much smaller taxpayer counts in the 1290s *taille* rolls,
put Paris nearer **80,000**. (Ferdinand Lot, "L'état des paroisses et des feux de
1328", *Bibliothèque de l'École des chartes* 90, 1929.) **Write it as "somewhere
between ~80,000 and ~250,000 depending on how the 1328 hearths are read", or pick a
figure and say it is contested.**

**The million-city list — splits three ways.**
- **Constantinople is simply wrong.** Modern estimates for the 6th-century peak run
  **300,000-500,000**, with half a million the conventional high point in 541. It was
  never near a million.
- **Baghdad is contested, not settled** — estimates run ~300k to 1.5M. The defensible
  statement is that Baghdad is one of several candidates (with Rome and Chang'an) for
  the first city to reach a million, not that it did.
- **Kaifeng, Hangzhou and Edo are fine** — each conventionally at or around a million,
  Edo best documented.

*Do not let Constantinople ride into a document on the coat-tails of Edo.*

### 4.2 The urban graveyard **[CONFIRMED]**

Pre-modern cities did not reproduce themselves; urban mortality exceeded urban
fertility and cities grew only by in-migration from the countryside. This is the
demographic reason a city's catchment is not optional — **a city is a standing drain
on its hinterland's people, not just on its grain**, and it is the correct mental
model for what `popField` → urban-core transfer is supposed to represent.

### 4.3 The legal instruments

**Bracton's 6⅔-mile rule. [CONFIRMED — rule, arithmetic, rationale and enforcement
all check out.]** *De Legibus* reasons that "every reasonable day's journey consists
of twenty miles", divided into three parts — morning to travel to market, midday to
buy and sell, the third to return home — so **6⅔ miles is the distance covered in one
third of a day**, and it must all be done by day, *"because of ambushes and the
attacks of robbers."*

Three precisions:
1. **Enforcement is real but softer than "a rule".** 6⅔ was a jurist's guideline in a
   treatise, not a statute. The operative legal test in charters and in *quo warranto*
   proceedings was ***nisi sit ad nocumentum aliorum*** — unless it be to the harm of
   others — with 6⅔ serving as the **measure of nuisance in litigation** rather than
   as an automatic bar.
2. **It is still live law.** Charnwood BC invoked Henry III's Loughborough charter to
   close a market at Sileby within 6⅔ miles.
3. **Authorship:** *De Legibus* was composed in stages from the 1220s to 1260s by
   Martin of Pattishall, William of Raleigh and Henry of Bratton; sole attribution to
   "Bracton" is traditional but erroneous (Paul Brand, "The Age of Bracton",
   *Proceedings of the British Academy* 89; Thorne's edition on authorship).
4. **"A legal switching barrier" is our own economic gloss, not a historical
   finding.** Label it as interpretation wherever it appears.

**Staple rights.** See §1.3 — the hybrid, and confirmed as described.

**Gascony's bastides. [WRONG — both the number and the region, plus the purpose.]**
- **Number/region:** Beresford counted **124 planted towns in Gascony** across the
  whole span of English rule, of which over seventy were founded 1263-1297, Edward I
  the most energetic patron. The **~500** figure (estimates range 200-700 depending on
  what counts as a bastide) belongs to the **entire southwest-French phenomenon** —
  Gascony *plus* Périgord, Quercy, Rouergue, Agenais and Languedoc — founded by the
  French crown, Alphonse de Poitiers, local lords and the English, conventionally
  bracketed by Cordes (1222) and La Bastide-d'Anjou (1373). So the count, the date
  bracket and the region were all wrong together.
- **Purpose:** stated far too narrowly as trade capture. The standard account is
  multi-causal — political and military consolidation on the Anglo-French frontier,
  agricultural colonisation and settler attraction through franchises (frequently by
  *paréage* contract between a lord and the crown), and revenue from markets and
  tolls. (Beresford, *New Towns of the Middle Ages*, 1967.)

*Design consequence: the bastides are still a good example of **planted** central
places — but they are an example of Mode C (a state building market centres for
political reasons) at least as much as of Mode M.*

### 4.4 The spatial models

**Reilly's law. [CONFIRMED — with two notes for anyone writing code from the
sentence.]** Reilly (1931): two cities attract trade from an intermediate town in
direct proportion to their **populations** and in inverse proportion to the **square**
of the distances. Setting the attractions equal, `(d₂/d₁)² = P₂/P₁`, so
`d₂/d₁ = √(P₂/P₁)`.
1. The closed-form breakpoint `BP = D/(1+√(P₂/P₁))` is **Converse's** (1949)
   transformation, not Reilly's own statement.
2. *"The breakpoint sits at distance proportional to the square root of the size
   ratio"* is loose. What equals √r is the **ratio of the two distances**. The
   breakpoint's absolute distance from a centre is `D·√r/(1+√r)`, which is **not**
   proportional to √r. Worth writing out before implementing.

**Von Thünen. [OVERSTATED — see §3.2 for the full treatment.]** The rings do end *in
the model*, because linear per-ton-mile cost is what the model **assumes**. Real
freight tapers. **Do not inherit "rings end" as physics.**

**Chayanov and vent-for-surplus. [CORRECTED — two different theories welded under one
name.]** The conversation ran together (a) the **labour-consumer balance** — a peasant
household works until its drudgery outweighs its consumption need, so it produces no
surplus beyond that point — which is **Chayanov**, and is among the *least* accepted
parts of him; and (b) **"a market partly creates the surplus"** — that output rises
when an outlet appears because idle land and labour are drawn into use — which is
**vent-for-surplus**, Adam Smith's, revived by **Hla Myint**. These are different
claims with different evidence and different implications: (a) says a market cannot
call forth much more output; (b) says it can. **Cite them separately, and if the sim
ever implements either, implement one of them on purpose.**

### 4.5 The grain trades

**Amsterdam's Baltic trade. [WRONG — the either/or inverts it.]** The claim was that
it was fundamentally a **storage** business (buy cheap at harvest, sell dear in
spring) rather than spatial arbitrage. **The spatial leg *was* the business.**
Amsterdam was the central entrepôt from which Baltic grain was distributed over the
Dutch hinterland and the rest of Europe; Danzig grain was shipped by Dutch merchants
**directly to Venice**; and the decisive episode is purely spatial — in the **1590s**
the Italian republics, cut off from Black Sea supply by Ottoman expansion, looked
north, and that crisis consolidated and extended the Baltic-Mediterranean route.
Holland was itself a structural grain-**deficit** region (high urbanisation, land in
dairy and industrial crops), so even the home-market share is spatial arbitrage.
Storage is genuinely part of the story — van Tielhof treats warehousing and local port
services (transhipment to lighters, carrying to warehouses, measuring, turning the
grain in store) as a real Amsterdam **cost advantage**, and Baltic navigation was
seasonal — but *"a storage business rather than spatial arbitrage"* is the wrong way
round: **it was spatial arbitrage that storage made cheaper and less risky.**
(Milja van Tielhof, *The "Mother of all Trades": The Baltic Grain Trade in Amsterdam
from the Late 16th to the Early 19th Century*, Brill.)

**Florence's grain. [WRONG — and the correction points at Mode C.]** The claim was
that Florence was fed largely from its own *contado* estates. Domenico Lenzi's *Libro
del Biadaiolo* (c.1320-35) records the *contado* feeding the city about **five months
a year**; the rest came from **Sicily, Sardinia, Apulia and the Pisan Maremma**,
through a **municipal provisioning apparatus** (the *Sei della Biada*, later the
*Abbondanza*) — i.e. through exactly the compelled/administered channel the original
claim demoted. **Florence is not an example of a city fed by its catchment. It is an
example of a city whose catchment fed it for five months and whose government fed it
for the other seven.**

**Hanseatic rye "with no state at all". [WRONG — and a strawman besides.]** The
**Teutonic Order was a landed state *and* a Hansa member**; the grain came off
**Polish noble estates**; and the route ran through the **Danish Sound and its toll**.
There is state at every stage. The claim was also set against the wrong contrast:
**Rome's grain went by sea, not by cart**, so the real comparison is not
state-vs-carts — it is *two different sea-borne grain systems, one run by a fisc and
one run by merchants under several states' tolls and privileges*. That comparison is
still interesting and is arguably the best single illustration of the two-mode model;
the version in the conversation was not.

---

## 5. WHAT WAS BUILT, AND WHAT IT MEASURED

### 5.1 The v50 grain fixes — SHIPPED

Three defects in the grain shed, each hidden by the one before it, all found in the
same lap and all now **default ON** at `SAVE_VERSION 50` (`0f3c091`), with a `v<50`
guard pinning old worlds to the old behaviour (*a pre-v50 world's urban geography IS
its old market's output*). Baseline before the lap (obs-240, seed 8817, 30k): median
market haul **965 km**, p90 1,867, max 4,126 — against history's 20-100 km overland
shed — with the top 3 importers taking **42%** of all landed grain.

| lever | defect | measured effect |
|---|---|---|
| **`GRAIN_FREIGHT`** | **the road was free** — the buyer paid the seller's farm-gate price for what *arrived*, so the haul's loss was borne by nobody and a far city bought at the same unit price as the seller's neighbour | concentration **42% → 31%**; distances **unchanged** — which exposed (b) |
| **`HAUL_PHYS`** | **the range was a tile constant** — `FOOD_HAUL_RANGE = 14` tiles × ~167 km = a **2,338 km** e-folding *before* tier (×3.6), tech (×2) and water (×3) multipliers pushed it past Earth's circumference; `arrive ≈ 1` between any two points on the planet | median **965 → 847 km**, barely moved — which exposed (c) |
| *(within `HAUL_PHYS`)* | **the water test was an endpoint test** — the corridor bonus asked only whether each *end* touched water, and ~100% of settlements are waterside, so a ×12 barge multiplier applied to entirely overland routes | now requires an actual water **route** (the sea-lane `mergeReach` link) |
| **`GRAIN_BID`** | **`grainMarketPass` walked `world.settlements` in array order — founding order** — each buyer drawing down live residuals as it went, so the world's oldest city was served in full before a younger one was offered a bushel; price, hunger and distance played no part in allocating scarcity | buyers now approach in descending order of their own emergent `_grainPrice` (ties on id for determinism) — the hungriest bid it away, and a real deficit outbids a granary top-up so `GRAIN_PROVISION`'s standing demand subordinates to hunger for free |

**Recorded limitation, not fixed:** river barge traffic (Thebes→Memphis) is not a sea
lane and takes the land curve. `transport.js` already prices river ground cheap for
the *route* but not for the *spoilage clock*. That is the next lap **if the cradles
measurably starve on it — never a widened constant.**

**Gate ladder at flip:** stylized 8817/4242/777 all hard gates passed, 0/0/1 soft
against budget 2; `resgate` all app-grid bands held at median realm area app/ref
**0.91**; defaults smoke green and the hashbase pair unchanged.

### 5.2 `CORE_LOCAL` — BUILT, def 0, passed the kill-shot that killed its predecessor

**The owner's model:** *"cities eat ALL surplus in the hinterland? and then import food
on top of that when they can and want to?"* — **yes, and the code did the opposite.**
`popField.js` computes the local/import split, uses one half and throws the other
away: `holdF = _coreHoldCapF` (the 12k founding stamp) or `pf[ti]`, then
`coreEff = min(_coreF, holdF + kBeyond)` where `kBeyond = _k · importShare`. **The
core was claimed against import-fed capacity only.** `CORE_LOCAL` replaces `holdF`
with `max(holdF, _k·(1−importShare)/scale)` — the same partition-of-unity the file
already computes at `:921-922`. **No new constant; a 0/1 lever, not a rate.**

`Math.max` rather than `+` is load-bearing: it is strictly monotone, so **no
settlement's core can fall**, no tier can demote, no realm can lose a seat, and the
change **cannot cause a single `DISSOLVE_CORE` dissolution**.

**The extraction *rate* the brief proposed was refuted by all three adversarial
lenses** and discarded, for four reasons each with a citation: the supply side already
has no rate (`territory.js:465-482` credits the whole catchment harvest, discounted
only by distance); the feeding side already assumes a 100% claim (under `ONE_BOOK`,
`mouths = min(s.people, s._urbanPop)` and the famine gate compares the whole
`_foodSupply`); the institution is already priced twice elsewhere (`foodReach` gates
the ledger's authority over the same catchment, `FARM_RENT` extracts 40% fiscally);
and `URBAN_AGGLOM = 0.13` is already an extraction-like rate on the import path.
**A third pricing would triple-count, and the first two would fight.**

**Static counterfactual** (SHIP arm, tw=480, shipped genesis arm, 28k, n=273):
urbanisation **2.26% → 5.55%**, core p90 12.00 → 93.1, lnσ 0.68 → 0.98, metropolis
tier 7 → 46, and only 102 of 273 cores move.

**Live paired A/B** (`1bcb845`, tw=480, 32k, identical settings): small states under
100k km² hold at **91% → 90%** — *the metric that went 36% → 0% and killed
`SEED_EXCLUSIVE`* — size dispersion lnσ 0.77 → 0.80, land claimed 19.5% → 23.4%,
realms 541 → 568 with mid-large realms 1 → 3. **The political map is not damaged; if
anything it thickens slightly.**

**Honest limits, recorded because this is not a flip:** (1) tw=480, not the tw=960 the
build memo asked for — at the 32k horizon the v49 genesis clock now requires, a 960 arm
is hours-scale; (2) `probe_shape` measures the **political** map and never looks at
city sizes, so this proves *no wreckage*, **not** the urbanisation gain — 2.26% → 5.55%
is still a static counterfactual, not a live run; (3) two of the memo's three
kill-shots are unrun, including the **military-balance** arm it said to run **first**,
because urban mass ×2.45 drives walls and the paid core while conscription reads the
rural half. **Promising, not proven; the lever stays def 0.**

**Deliberately not in this lap:** `uTarget` and `kCap` stay keyed on `kBeyond`. Moving
them would break the partition-of-unity at `popField.js:897-903`. **This lap only
fixes the READ; the lap that makes the field actually move people into cities is a
separate rural-capacity surgery.**

### 5.3 `SEED_EXCLUSIVE` — REFUTED, and the refutation is worth more than the fix

**The defect is real.** `seedLocalTerritory` (`territory.js:563+`), called at mint to
give a newborn its opening food/resource stats, walked a raw box with **no ownership
test** — so a city founded beside an established one booked that neighbour's fields as
its own until the amortized pass reassigned them. Measured: **44 episodes per 24k
steps, median 103 ticks each, median 49% (max 100%) of the box simultaneously owned
and harvested by another settlement, +9.8% world harvested area** — and **worse at
finer grids**, because the territory pass amortizes over more tiles (144 ticks at
tw=240, 288 at 480, **576 at the shipped 960**).

**Every tw=240 gate passed.** Three seeds all hard; `resgate` at app/ref **0.96**,
*better* than the default's 0.91; a monotone urban ladder (median city 8k → 15k → 20k,
floor mode 59% → 51% → 44%, the 120-300k tier 2 → 4 → 6).

**The paired tw=960 A/B killed it twice:**

| tw=960, step 20000 | baseline | v1 (veto owned tiles) | v2 (nearest-wins) |
|---|---|---|---|
| realms | 14 | 12 | 11 |
| **small states <100k km²** | **5 of 14 (36%)** | **0 (0%)** | **1 of 11 (9%)** |
| size dispersion lnσ | **2.68** (real ≈2.0-2.6) | 0.92 | 1.12 |
| P10 realm | 4k km² | 206k | 394k |

**THE FINDING IS BIGGER THAN THE FIX: the small-state tier RESTS ON THIS BUG.** A
newborn's temporary over-claim is the window in which a marginal founding establishes
itself. Remove the subsidy — bluntly (v1) or fairly (v2) — and **only uniform large
blobs survive**. Nothing else in the sim currently supports a small state. *That is a
fragile foundation and worth knowing.*

**So the honest repair is not to the seed box** — it is to what a small centre can
legitimately **hold**, which is §3.1. **And the gravity memo then killed the hope that
§3.1 would unblock it:** a market-pull partition moves land *from* small centres *to*
big ones. It is a **second** squeeze on exactly the marginal foundings
`SEED_EXCLUSIVE` was killed for squeezing. **Do not build the partition expecting it
to unblock the seed box.**

**Verdict: `SEED_EXCLUSIVE` stays at def 0.** The code and both measurements stay in
the tree as the record. **Do not re-tune the seed box.**

---

## 6. METHOD WARNINGS

These are the traps this wave actually fell into, each recorded with the commit that
caught it. **All five cost real measurements.**

### 6.1 The harness's defaults are NOT the game's defaults

`tools/_harness.mjs:74` pins, in **every tool run and every gate**:

```
POP_FIELD_WORKERS:-1, DAWN_LIVE:0, STATE_RECORDS:0, LAND_KNOW:0, PEER_SEATS:0,
FOUND_DRIFT:0, ABSORB_ORG_ERA:0, TRIBUTE_UP:0, ENGULF:0, FEAR_REACH:0, WAR_FINISH:0,
SMALL_WAR:0, RELIEF_REACH:0, EXCH_WAVE:0, TECH_USE:0, VASSAL_LEVY:0, DISSOLVE_CORE:0,
SETT_STRIDE:1, TRADE_STRIDE:3
```

The shipped live arm is
`DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1` with
`SETT_STRIDE=3, TRADE_STRIDE=5`.

**Food-specific consequence, and it is new here: `TRIBUTE_UP` is pinned to 0 in every
gate.** Flow 5 (§2.1) — compelled, in-kind, **cross-realm** grain movement, shipping
at 0.33 — **is invisible to `npm run validate`, `npm run resgate` and every probe that
uses the harness.** Anything asserted about cross-realm food flow from a gate run is
an assertion about a world in which that flow does not exist.

### 6.2 The regime divergence is measured, and it is a factor of ~25

`a3142f4`: live arm at tw=480/32k gives **541 realms, 235 vassals, 91% under 100k km²,
median 34k, lnσ 0.77, max/med 48.4** — hundreds of small realms plus one giant. The
stylized battery, on harness defaults at tw=240/24k, reports **13-25 polities**. The
same divergence appears in urbanisation: **2.07% ceiling at the shipped arm vs blowing
the 25% gate at the gate arm — "two regimes 20× apart."**

> **A green stylized battery is evidence about the GATE world, and the gate world is
> not the game.**

### 6.3 The no-op trap — a byte-identical A/B is the *only* symptom

`d8b57fa`: a tw=960 kill-shot came back **byte-identical on both arms** (14 realms,
5 small states, lnσ 2.68 both sides). Cause: the harness pins `LAND_KNOW=0`, and the
`CORE_LOCAL` read lives inside `if (T.LAND_KNOW && coreR > 0)` — so passing
`SIM_TUNE=CORE_LOCAL=1` **alone never executed the edited line**. This is exactly the
trap the build memo had documented one message earlier.

> **Any probe of a lever must carry the full live arm, not just the lever. And treat a
> perfectly identical A/B as a bug report about your own probe until proven otherwise —
> next time the collision may not be so visible.**

### 6.4 The empty-world trap — check that the world exists before comparing two of them

`6ea00d5`: the live-arm tw=960 baseline returns **0 realms at 20,000 steps** — the
world is still **pre-urban** there, because the v49 genesis flip moved first states to
~23,000. **Both paired arms were measuring an empty planet.** Worse, it meant an
earlier tw=960 refutation had silently run on the harness-default arm, where statehood
needs no writing bar — a regime that is not what ships.

> **Before reading a paired A/B, read the baseline's absolute counts. Two zeros are
> equal.** And the horizon is not a constant: **a genesis change moves every fixed
> horizon in the tool set with it.**

### 6.5 Instrument bugs outrank findings — two nearly published

From the grain-shed lap, both caught before publication:
1. **`yOf` inverts latitude**, so an area loop ran backwards and floored every region
   to the 0.05 Mkm² guard. The "8× density inversion" was the instrument's, not the
   sim's.
2. **A box mean cannot measure a ribbon.** Egypt's and Mesopotamia's boxes are mostly
   desert, so averaging capacity over the box **buries the Nile in the sand beside
   it** — scoring the very geometry that *makes* a cradle as poverty. Fixed with
   `cageField.js`'s own answer, the capacity-**weighted** mean (Σcap²/Σcap).

**And a third, from this verification pass:** `tools/probe_consol.mjs` prints
`org pack p50/p67/p90` while measuring **`techEff(capital).reachLevel`** — not
organisation, and not the world (§3.5). **A number quoted from a probe's label rather
than its expression is a number about something else.** That mislabel propagated into
a docs file, a `tuning.js` description and a design conversation before it was caught.

### 6.6 Chaos-bound before attributing anything to a mechanism

A float-epsilon draw (`MINING_RATE=5.0000001` — no mechanism, just a perturbation)
reproduced the cradle inversion, establishing it as a **robust feature of the atlas,
not a seed accident**. The corollary binds equally hard: **arm-to-arm swings inside
that band must not be read as mechanism** (Greece/Italy went 0 → 171k → 0 across arms
and means nothing). The same technique gave the 777 ensemble its verdict: 20/20/20
settlements across three draws, so 20 was the **typical** value under the fix, not an
unlucky tail.

### 6.7 The delayed-arming fuse

Restated from §3.5 because it is a method warning, not just a finding: **nothing in
the gate ladder measures whether a mechanism's INPUT has spread.** A law whose input
is currently a constant will pass every gate, be recorded as validated, and arm itself
later when the world develops. The third cardinal rule tells you to run the other
grid; **there is no corresponding instruction to run the other *era*, and under the
first cardinal rule you cannot fast-forward to one.** The only defence found so far is
to **emit the arming statistic as a standing metric** so the arming is visible when it
happens.

---

## 7. OPEN QUESTIONS

**On the model (§1)**
1. Should Mode C (tribute/levy) have its own **distance law** at all? Today the levy
   is bounded by the liege tree's topology and the haul curve; the *annona* argues that
   compelled flow's limit is administrative, not economic — which would mean it should
   read `reachLevel` (where §3.3 says the *market* catchment should not).
2. Where does **rent** belong? It is currently modelled entirely on the money side
   (`FARM_RENT`, §2.1). Should the in-kind half (`gov._inKind`) ever become grain in a
   granary, or is the fiscal abstraction correct?
3. **Staple rights and Bracton** are both legal instruments acting on the catchment.
   Is there a mechanism that produces both from one rule — *a market centre's chartered
   monopoly over a radius* — or does that violate the second cardinal rule by naming
   the outcome?

**On the code (§2-3)**
4. Which comes first: unifying the two decay metrics (§3.2), or the market-pull
   partition (§3.1)? They touch the same kernel and the partition's own memo says the
   prerequisite is neither — it is the **12k core unpinning** (§3.5, §5.2).
5. `CATCHMENT_CLIP` makes market competition **intra-country only**. Is that a
   defensible simplification (Bracton's franchises were intra-kingdom) or the reason
   the Hanseatic case is structurally impossible here?
6. `CORE_BY_TIER` / `HINTERLAND_BY_TIER` are **raw tiles, unscaled by `rNormPop`**,
   while every other radius in the path is scaled — a resolution-dependent constant,
   i.e. a bug by the third cardinal rule. But the one-line fix **quadruples the
   guaranteed hinterland's real area at tw=960** and moves `armies.js` assault
   distances with it: exactly the `deffdce` shape. Measure at both grids first.
7. `TOWN_BASIN_R` serves **six** unrelated physical questions (§3.4). Which of the six
   should keep the name, and what is the right grounded radius for each?
8. **Is the small-state tier's dependence on the seed-box bug (§5.3) survivable?**
   Nothing else in the sim currently supports a small state. What *should* support one?

**On the numbers (§4)**
9. The sim's entity register is the **city** register; the 500-2,000 market-town tier
   is carried implicitly in `popField`. Is the emergent city-size distribution
   comparable to any of §4.1's figures **at all**, or does the comparison need a
   stated conversion first? (This is the mistake `CLAUDE.md` says has been made most
   often in this codebase's history.)

**Housekeeping**
10. `tools/probe_orgspread{,2,3}_tmp.mjs` were committed at `68b5676` only to keep the
    tree clean during this verification and are **flagged for deletion**. They are the
    probes behind §3.5's re-measurement; if the numbers there are ever re-checked,
    check the probes still exist first.

---

## APPENDIX — the code-claim ledger

Every claim from the conversation about the code, its verdict, and where the corrected
version lives in this document.

| # | claim | verdict | treated in |
|---|---|---|---|
| 1 | catchment assigned by cost-spread over the transport field; roads lower cost | **OVERSTATED** | §2.4 |
| 2 | tile food discounted `1/(1+0.5c)`, differing from the haul's `exp(−d/range)` | **CONFIRMED** (strengthened: two *metrics*, not just two laws) | §2.3 |
| 3 | a tile goes to whoever reaches it cheapest; no price enters | **WRONG** on the first half, **CONFIRMED** on the second | §2.4, §3.1 |
| 4 | grain prices set by city tier, 2/8/14/22 | **OVERSTATED** — tier base **×** scarcity, half the register at the clamp | §2.6 |
| 5 | organisation buys reach, other tech buys efficiency; `reachBudget` a pure function of organisation | **OVERSTATED** — split real, "pure function of organisation" false at `TECH_EFFECTS=1` | §2.5 |
| 6 | organisation converges to a spread of 0.001 | **OVERSTATED** — capitals' p90−p50 of `reachLevel`, not a world spread; quote `reachBudget` max/p50 = 1.00-1.05 | §3.5 |
| 7 | founding rate scales with basin people, and the basin read is gross over overlapping disks | **CONFIRMED** | §3.4 |
| 8 | `MINT_RESIDUAL` is a veto, not a pull | **WRONG** on the code (one of its three reads *is* a rate gradient; and it ships OFF) — **conclusion survives** for a different reason | §3.4 |
| 9 | any full granary sells its excess, with a seed-corn rule | **OVERSTATED** — peer market only, buyer-driven, and the overlord is exempt | §2.2 |
| 10 | rivers are real hydrology (D8, pit-fill, accumulation, lakes, terminal basins) | **CONFIRMED** | §2.7 |
| 11 | the levy requires same-country, so compelled flow is intra-realm | **CONFIRMED** — with the caveat that `TRIBUTE_UP` is compelled cross-realm flow | §2.1 |
| 12 | there are three food flows, and `FARM_RENT` is not a fourth | **WRONG** — at least six; `FARM_RENT` correctly excluded, for a precise reason | §2.1 |
| 13 | the partition has 46 references assuming one owner per tile | **OVERSTATED** — the precision is borrowed and false; direct count is 63 occurrences / **42 code refs across 12 files**. Say "~40-50 call sites across roughly a dozen files", or cite the memo. The load-bearing reducers are the ones to name: the census (`popField.js:1836-1841`), the `FOOD_K` capacity ledger (`:907-920`), the harvest (`territory.js:465+`), governed people (`conquest.js:2711-2718`), and the sharpest single breakage under any nesting scheme — `residualBasinMass` skipping any tile with `to[ti] >= 0` (`crystallize.js:218-231`) | here |

**Prior records this document sits on top of:**
`docs/gravity-partition-memo-2026-08-27.md` (what attraction should be, and whether to
nest) · `docs/catchment-audit-2026-08-27.md` (radius and overlap) ·
`docs/urban-claim-memo-2026-08-27.md` (the local-surplus urban claim) ·
`docs/grain-shed-2026-08-26.md` (the three stacked haul defects) ·
`docs/harvest-years-2026-08-25.md` · `docs/shape-of-the-map-2026-08.md`.
