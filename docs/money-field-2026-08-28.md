# Spec — per-tile money field (farm-gate payments & rural sinks)

**Status:** Phase A+B+C+D built (`T.TILE_MONEY`, def 0) · **Date:** 2026-08-28 · **Companion:**
`docs/tier-ratchet-2026-08-27.md` §41 (owner proposal), §42 (farm-field rule),
`docs/food-system-design-2026-08-27.md` §1 (Mode M vs Mode C), PR #75 /
`MARKET_PULL` cross-border bidding (built).

**Prerequisite (done):** `MARKET_PULL=1` bid-sized catchments with cross-border
*trade* ( `_territoryOwner` ≠ `_countryOwner` allowed). Live-grid `fooddiag`
(960 / 28k, seed 8817): emergent arm 13.8% cross-border farmed tiles, mode pin
1.50 su (not 12k ratchet), heap 261 MB — no crash.

**This spec does not build compulsion** (liege overrides bid — owner deferred) or
the full goods-vector economy (`docs/economy-goods-vector-spec.md`). It closes the
*coin* side of Mode M at the farm gate.

---

## 1. Why now

Under the bid rule a farmed tile assigns its harvest to whichever market nets the
producer most **at the farm gate**:

```
winner(tile) = argmin over markets i of   [ carriage(i → tile)  −  range · ln(bid_i) ]
```

If nobody on the tile **receives** that payment, willingness-to-pay is an accounting
fiction — a bid with no payee, which is exactly the kind of quantity that becomes a
fitted constant later (second cardinal rule).

Three outputs that are missing today and should fall out once coin sits on the land:

| output | mechanism |
|--------|-----------|
| von Thünen rent gradient | two tiles, same crop, different carriage → different tile income |
| unserved surplus pulls a city | tiles accumulating coin with no capturing market = latent demand |
| rural people in the market | today `ONE_BOOK` bills only `_urbanPop`; countryside is outside the ledger |

**Sequencing:** bid rule first (done), money second — building both at once makes
attribution impossible (§20, §32.1 of the tier-ratchet lap).

---

## 2. Cardinal rules

- **Emergent gates only.** Tile sinks turn on when the *tile* (or its polity) has
  coined money (`techEff.market`), fiscal extraction (`organization`), market reach,
  faith presence, etc. — never step, year, or era.
- **Build the system, not the outcome.** Sinks are *demand curves* (tax rate ×
  monetization × subsistence flow; inelastic salt demand × local scarcity) not
  `if (rural) drain *= 0.3`.
- **Measure at the grid that ships.** Gate at `tw=480` / 24k; `npm run resgate` and
  spot `tw=960` for anything that moves territory or money totals.

---

## 3. What exists today (verified)

| piece | where | role |
|-------|-------|------|
| Settlement coin | `s.wealth`, `s._credit` | **the** conserved stock inflation sums (`inflation.js`: `M = Σ wealth`) |
| Provenance ledger | `money.js` `recordIn` / `recordOut` | display EMA only — does not conserve |
| Grain coin flow | `foodHierarchy.js` pass 3 | buyer `wealth -= pay`; seller `wealth += pay`; `IN_FOOD` / `OUT_FOOD` |
| Produce levy | `conquest.js` `FARM_RENT` | skims settlement `_landFood` → treasury (coin + in-kind via `MONETIZE`) |
| Field tribute | `entities.js` `TRIBUTE_OF_LAND` | in-kind from `popField` under borders → polity store; overflow sells at `_grainPrice` |
| Per-tile fields | `_tileValue`, `_cageField`, `_territoryOwner`, … | pattern for `Float32Array(N)` maps |
| Ruin hoards | `world._ruinHoards` | per-tile coin from dead settlements — **already a tile coin map**, but only for ruins |
| Rural population | `popField` + `_onePopScale` | people-on-land; not in settlement `wealth` |

**The gap:** ~20 per-tile fields exist; **none hold circulating money**. Rural people
do not spend coin because the model says they are not in the market.

**Double-count risk:** `IN_FOOD` already books grain sales to the *seller settlement*.
If the tile is paid *and* the settlement also books the sale, the same bushel is
counted twice. Reconciliation is the first design decision (§5).

---

## 4. The field

### 4.1 State

```js
world._tileWealth   // Float32Array(N), coin held on tile ti
world._tileWealthEpoch  // optional: invalidate caches when owner/bid changes
```

- **Unit:** same coin unit as `s.wealth` (sim coin, not real people).
- **Persist:** yes, when `T.TILE_MONEY > 0` (new lever, default **0** until measured).
- **Who "holds" it:** the rural population *standing on that tile* — not the buying
  city. Cities keep `s.wealth`; farmland keeps `_tileWealth[ti]`.

### 4.2 Aggregation (read paths)

| read | formula |
|------|---------|
| Tile rural coin intensity | `_tileWealth[ti] / max(ε, popField[ti] × bridge)` |
| Settlement rural coin (catchment) | Σ `_tileWealth` over worked tiles in catchment |
| Polity rural coin | Σ over tiles where `_countryOwner[ti]` = polity |
| Inflation `M` (when lever on) | `Σ s.wealth + Σ _tileWealth + Σ polity.treasury + …` (same closure as today) |

Extend `updateInflation` and any conservation watch to include `_tileWealth` when the
lever is on. Until then, tile coin is invisible to `localP` — intentional A/B.

### 4.3 Lever

```js
T.TILE_MONEY   // def 0 — per-tile circulating coin at the farm gate
```

Ship behind `SAVE_VERSION` guard like v51 food stack. Old saves: field absent, all
grain payments stay settlement-only (byte-compatible path).

---

## 5. Ledger reconciliation — one coin, one holder

**Rule:** for each farm-gate grain payment, **exactly one** balance sheet line
increases and one decreases.

### 5.1 Farm-gate sale (Mode M, post-bid assignment)

When tile `ti` ships quantity `q` grain to buyer settlement `B` at price `p`
(`_grainPrice` at seller's market, scarcity-only when `PRICE_GROSS`):

```
B.wealth           -= q × p
_tileWealth[ti]    += q × p
```

**Seller settlement `S` (territory owner / market seat):** does **not** gain wealth
from this leg. It already captured agrarian export value in `exportValue`; the
hierarchy pass currently credits the *child settlement* that offered the grain. Under
tile money, the **tile** is the seller at the gate.

**Provenance (reporting only):**

- `recordOut(B, OUT_FOOD, pay)`
- New channel or settlement aggregate: `IN_FOOD` booked on `S` as **market hub
  turnover** (volume through the market), *not* as wealth — or a dedicated
  `IN_FARM_GATE` display line fed from tile inflows. **Never** `S.wealth += pay`.

### 5.2 Hierarchy tree (child → liege, same country)

Today pass 3 pays the *child settlement*. With tile money:

- Levy (in-kind): no coin — unchanged.
- Coin purchase: debit buyer liege, credit **the worked tiles** that produced the
  offered grain, pro-rata by each tile's share of the child's `_landFood` or last
  harvest attribution.

### 5.3 `GRAIN_MARKET` (cross-border peer buy)

Debit buyer; credit seller's **tiles** (pro-rata on seller catchment), not seller
`wealth`.

### 5.4 Compulsion (future, not this build)

Mode C flows skip price at origin — grain to liege store, no tile payment. Spec
placeholder: compelled quantity never credits `_tileWealth`.

---

## 6. Money ENTERS rural tiles (sources)

Besides grain sales, tiles should gain coin only from mechanisms that historically
paid the *countryside*:

| source | gate | flow |
|--------|------|------|
| **Farm-gate grain sales** | `MARKET_PULL`, `techEff.market` on buyer | §5.1 — primary inflow |
| **Mining on tile** | deposit richness × org | specie dug *where the seam is* → `_tileWealth[ti]` first; settlement mine income becomes a *report* or a slow sweep upward |
| **Court / deposit crafts** | `CRAFTS_OF_LAND` | metal/prestige stocks today are in-kind; optional coin leg when `MONETIZE` high |
| **Ruin reclaim** | `reclaimRuins` | today → `s.wealth`; under tile money → `_tileWealth[ti]` on the ruin tile (then sinks drain it) |
| **State pay in countryside** | relief / dole targeting distressed *tiles* | `SPEND_RELIEF` weighted by local `capField` deficit — coin to tiles, not only capitals |

**Not tile sources:** banking credit conjuring (`IN_CREDIT`), entrepôt brokerage,
tribute *received* at capital — those stay urban.

---

## 7. Money LEAVES rural tiles (sinks) — **load-bearing**

If coin only arrives from grain sales, farmland becomes a hoard and city treasuries
starve — the opposite of history. Pre-industrial rural outflows are **why peasants
sold grain at all**. Sinks are not optional polish; they are half the mechanism.

Design principle: each sink is **pull × stock × gate**, never a fixed drain constant.

```
outflow_sink(ti) = demand_sink(ti) × _tileWealth[ti]   // or × flow, for flow-proportional levies
```

Sinks run on the **fisc cadence** (`POLITY_INTERVAL`) or a dedicated
`TILE_MONEY_INTERVAL` aligned with it — not every tick (performance + matches tax
seasons). Order within the pass matters: **tax and rent before discretionary
spending**, so a broke peasant still pays the crown before buying salt.

### 7.1 Land tax in coin — **primary sink**

> *Tax in coin is why peasants sold grain* — Roman land tax, China's Single Whip,
> European hearth taxes.

**Mechanism (reuse, relocate):**

```
take = popField[ti] × bridge × TRIB_FOOD_PER_POP × TRIBUTE_RATE × extract(polity)
     × monetization_tile(ti) × coinShare
_tileWealth[ti] -= take
polity.treasury += take
recordOut_tile → mapped to OUT_TRIBUTE on the polity capital for display
```

- `extract(polity)` — already `EXTRACT_CHIEF` / org blend in `updateTribute`.
- `monetization_tile(ti)` — **new read**, same shape as `monetization(s)` but:
  - `coinF` from local `_tileWealth` per capita vs subsistence reserve
  - `reachF` from nearest market's trade reach (fair / periodic market)
  - `instF` from polity capital's `techEff.market`
- `coinShare` — under `MONETIZE`, only the monetized fraction is coin; rest stays
  **in-kind** (`polity._inKind += …`) exactly as `conquest.js` does for settlements.

**Relationship to `TRIBUTE_OF_LAND`:** today the field tribute is **in-kind food**
from `popField`. With tile money, the **coin leg** of taxation moves here; the in-kind
leg can remain (Joseph's granary) or split by `MONETIZE`. Do not double-skim: total
extraction = one budget, two media.

### 7.2 Rent / tithe on harvest — **second sink**

`FARM_RENT` today debits **settlement** `wealth` against `_landFood`. Relocate to tile:

```
rentDue(ti) = tileHarvest(ti) × T.FARM_RENT × serfMul(ti) × taxMul(polity)
coinRent = min(_tileWealth[ti], rentDue × monetization_tile(ti))
_tileWealth[ti] -= coinRent
gov.treasury += coinRent
```

- `tileHarvest(ti)` — share of settlement `_landFood` attributed to `ti` (same
  attribution used for bid payment pro-rata).
- `serfMul` — `SERFDOM` / `_serf` on the owning settlement.
- In-kind remainder → `gov._inKind` (army feeds, court consumption).

This is the landlord/church share **at the farm**, before the wagon leaves.

### 7.3 Salt and iron — **necessity purchases**

> Every rural household must buy salt; few villages make their own. The *gabelle*
> taxed it because demand was inelastic.

**Mechanism:** per worked tile with rural pop, each fisc pass:

```
need = popField[ti] × bridge × SALT_PER_POP × localP(world, nearestMarket)
spend = min(_tileWealth[ti], need × scarcity_salt(market))
_tileWealth[ti] -= spend
seller.wealth += spend   // urban producer / entrepôt
recordOut_tile → OUT_GOODS; recordIn seller IN_GOODS or staple-specific
```

- `scarcity_salt` — from `goods.js` local staple/materials price or a dedicated salt
  leg (deposit-near tiles cheaper).
- **Iron/tools** — parallel leg with `METAL` / `wares`, gated on `metallurgy` (you buy
  iron when you can afford metal, not at dawn).
- Reach gate: no spend if no market within `mergeReach` / haul survival — the village
  cannot buy what no fair connects.

Elastic luxury demand (cloth, wares) is a **secondary** sink with wealth elasticity
`~ (_tileWealth / reserve)^ε` — poor tiles buy salt first; rich tiles also buy cloth.

### 7.4 Faith tithe — **third sink**

Reuse pilgrimage economics (`faiths.js`, `PILGRIM_W`) at rural intensity:

```
tithe = popField[ti] × bridge × titheRate(faith) × monetization_tile(ti)
_tileWealth[ti] -= tithe
holySee.wealth += tithe
recordOut OUT_PILGRIM / recordIn IN_PILGRIM
```

Distance decay (`PILGRIM_RANGE`) applies from tile to see — far parishes tithe less
(coin spent on the journey). Emergent: faiths with strong local presence extract more.

### 7.5 Coin loss — **micro-sink**

`COIN_LOSS_RATE` today erodes `s.wealth`. Apply the same rate to `_tileWealth[ti]`
(wear, hoard rot, buried jars) so tile stocks cannot infinite-accumulate when other
sinks are gated off (pre-coinage worlds).

### 7.6 Migration / brigade drain — **optional fourth sink**

Young people leave the parish with savings:

```
drain = popField[ti] × bridge × MIG_COIN_FRAC × urbanPull(ti)
_tileWealth[ti] -= drain
destinationCity.wealth += drain
```

`urbanPull` emergent from city wage/opportunity (import-fed capacity, price level) —
not a constant. **Defer** unless measurement shows coin piles without it.

### 7.7 What tile money does NOT buy

- **Grain for subsistence** — field / `capField` feeds people; coin is for **extras**
  and fiscal obligation. (Avoid closing the loop into food double-payment.)
- **Army pay** — rural coin pays tax; treasury pays soldiers (existing path).

### 7.8 Sink balance identity (per pass)

For each tile `ti`:

```
Δ_tileWealth(ti) = inflows − Σ sinks
```

Global:

```
Σ Δ_tileWealth + Σ Δ_s.wealth + Σ Δ_treasury + Σ Δ_ruinHoards = 0
   (modulo mining faucet and COIN_LOSS — same as today's closed system)
```

**Validation gate (new, soft):** after `POLITY_INTERVAL` passes with lever on,
`|Σ inflows − Σ outflows − ΔM| / M < ε` on a closed-money world past currency tech.

---

## 8. Emergent outputs (what to measure)

| metric | expectation |
|--------|-------------|
| `money.tile.meanWealth` | rises where carriage to dear markets is cheap |
| `money.tile.taxOut` / `saltOut` / `rentOut` | non-zero when `market` + `FARM_RENT` + fiscal org live |
| von Thünen slope | corr(`_tileWealth`, `territoryCost` to seat) negative on worked belt |
| unserved surplus | high `_tileWealth` tiles **outside** any market bid ring → founding pressure |
| `IN_FOOD` double-count | **zero** — settlement wealth unchanged on farm-gate credit |
| urban `wealth` | still drives inflation component; not drained by fake rural hoards |
| cross-border | Egyptian tiles paid by Roman buyer: coin leaves Rome, sits on Nile tiles, then tax/salt pull it to **Egyptian** treasury and **Roman** salt sellers |

**Probe:** `tools/probe_tilemoney.mjs` — arms: off / pay-only / pay+sinks, 480/24k +
live spot, report sink breakdown per channel.

---

## 9. Pass order (within a tick)

```
1. territory / bid assignment     (_territoryOwner, market choice)
2. harvest → _landFood attribution per tile
3. foodHierarchy grain movement   (physical grain, levy + coin stages)
4. TILE_MONEY farm-gate payments  (coin leg only — NEW)
5. fisc cadence:
     a. tile tax (§7.1)
     b. tile rent (§7.2)
     c. tile necessity buys (§7.3–7.4)
     d. settlement fiscal pass (conquest.js — adjusted to skip relocated legs)
6. trade / inflation / foldMoney
```

Grain moves before coin (historical: wagon arrives, then accounts settle).

---

## 10. Build phases

| phase | ships | validates |
|-------|-------|-----------|
| **A — pay only** | `_tileWealth`, farm-gate credit, inflation/conservation extended, `IN_FOOD` fix | no double-count; buyer poor → less tile income |
| **B — fiscal sinks** | §7.1–7.2 tax + rent on tiles; `MONETIZE` split | treasury still funds army; rural coin mean ↓ |
| **C — market sinks** | §7.3–7.4 salt/iron/faith | necessity outflows; entrepôt cities gain |
| **D — signals** | founding pull from high `_tileWealth` outside bid ring | new markets where unserved |
| **E — default flip** | `TILE_MONEY=1`, SAVE_VERSION bump | full battery + `resgate` |

Do **not** combine A and B in one merge — attribution.

---

## 11. Risks and mitigations

| risk | mitigation |
|------|------------|
| Double-count with `s.wealth` | §5 ledger rule; conservation test each phase |
| Tile field RAM | one `Float32Array(N)` ≈ same as `_tileValue`; 960 grid ~4 MB |
| Performance | sinks on fisc cadence, not per-tick; sweep only worked tiles + popField > 0 |
| Pre-coin worlds | `techEff.market` gate zeroes coin sinks; in-kind tribute remains |
| Industrial fiat | tile coin is specie; credit stays urban — do not conjure on tiles |
| Max-core tail | unrelated; watch separately |

---

## 12. Explicitly out of scope (this spec)

- **Compulsion** — grain without payment; separate lever (`COMPULSION` / Mode C).
- **Goods-vector trade** — per-good local prices moving physical crates (`economy-goods-vector-spec.md`).
- **Deleting `s.wealth`** — cities, treasuries, banks remain settlement-scoped.
- **Replacing `TRIBUTE_OF_LAND` in-kind store** — complements it with a coin leg.

---

## 13. One-line summary

> **Coin sits on the tile that sold the grain; it leaves through the same forces
> that made peasants sell — tax, rent, salt, tithe — gated on the world they live
> in, not the calendar.**

That closes the bid loop, makes von Thünen and unserved-surplus founding emergent,
and brings the countryside into the market without a second fitted wealth table.
