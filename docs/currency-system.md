# Money & Currency System — design spec

Status: **Phases 1-3 + the (b) nominal-inflation model implemented** (default-on);
Phase 4 (per-country currencies/FX) and Phase 5 (credit) not started. Goal agreed
with owner: replace the current
"money is dug out of the ground and regulated by nothing" model with a system
where money is **created by mines + statecraft**, **regulated by trade and
credit**, and **self-balancing across regions** — modelled on how real economies
actually worked. Hard constraints from the owner:

- **No barter.** Every exchange is coin-mediated; the food/goods economy never
  falls back to free grain.
- **No burn-sink.** The freight "money consumed in transit" sink (roads.js
  `sellGoods`) is wrong and must go — freight is a carrier's fee, not destroyed
  money.
- **Self-regulating.** The money supply must find equilibrium without a kludge
  sink — the way real specie economies did (trade-balance flows + finite metal +
  realistic slow drains).

---

## 1. What exists today (so this is an extension, not a rewrite)

- **M0 = mined specie.** `settlement.js > updateWealth` mints coin straight into
  `s.wealth` from precious/gems deposits (`world.depositReserve`, **finite**) at
  `T.MINING_RATE`. This is the *only* money-creation channel — `IN_MINING` is the
  only category that adds money; everything else moves existing coin.
- **State coffers.** `world.countries` hold a `_treasury` (`govOf(world, cid)`),
  fed by taxes (`TAX_MAX`, `FARM_RENT`), customs **tariffs** (cross-border trade
  → treasury), and spent on army wages / public works.
- **Tolls.** Intermediate settlements on a trade route skim `TOLL_RATE`.
- **Per-region price level.** `inflation.js > localP(world, s)` already runs a
  **quantity-theory** price level per trade-network *component* (money ÷ output).
  More coin in a region ⇒ higher local prices. **This is the half of Hume's
  mechanism we already have.**
- **Banking tech** exists in the tree but only grants a flat `wealthMult` — it
  does **not** create money.
- The money supply is **closed/conserved** today except for the freight burn.

So we already own the fiscal plumbing (treasuries, taxes, tariffs, tolls) and a
per-region price level. What's missing is: (a) money creation as a **state act**,
(b) a **cross-region regulator** so the supply self-balances, and (c) **credit**.

---

## 2. The model — three layers

```
  Layer 2  CREDIT          banks multiply spendable money where commerce is hot;
                           contracts in busts (the dark-age money crunch)
                ▲
  Layer 1  CIRCULATION     specie flows between regions with the trade balance;
                           local prices self-correct the flow (Hume)
                ▲
  Layer 0  SPECIE (M0)     mines yield BULLION → the state MINT coins it
                           (seigniorage → treasury; debasement = the supply lever)
```

### Layer 0 — Specie: bullion, the mint, seigniorage, debasement

- A mine no longer mints coin directly; it yields **bullion** (raw metal value),
  held as `s.bullion`.
- Each realm has a **mint** (its capital; later, any city with the Currency
  tech). On the polity pass it coins the bullion its settlements hold:
  - `face = bullion / fineness` — the **face value** struck. `fineness ∈ (0,1]`
    is the metal content per coin; `fineness = 1` is full metal.
  - `seigniorage = face × SEIGNIORAGE_RATE → treasury`; the remainder is credited
    as coin to the settlement that supplied the bullion (it *sold* its metal to
    the mint, less the state's cut).
- **Debasement** = the state lowering `fineness`. At `fineness 0.5`, one unit of
  metal strikes *two* face coins — instant revenue + money-supply expansion, paid
  for by (a) domestic **inflation** (more coin, same goods — `localP` rises
  automatically) and (b) **FX depreciation** (the coin is worth less metal
  abroad; Layer 1/§Phase 4). This is the classic war-finance lever (Rome's
  denarius, medieval recoinages).

### Layer 1 — Circulation: trade-balance flows + Hume self-correction

The gravity trade *already* moves coin buyer→seller across borders, so a trade
surplus already pulls specie toward the exporter. What's missing is the
**self-correction** that stops any region hoarding it forever:

- Give each trade leg a **competitiveness** factor from the two regions' price
  levels (`localP`). A cheap (specie-poor) region **undersells** and exports
  more; a dear (specie-rich) region's goods are pricey, so it exports less and
  imports more.
  - In `runGeneralTradeBetween`, scale the seller's `goodsValue` by
    `clamp((P_buyer / P_seller) ^ HUME_ELASTICITY, …)` — trade flows from cheap to
    dear, i.e. specie flows toward the cheaper region.
- **Result (Hume's price-specie-flow):** surplus region accumulates specie →
  its `localP` rises → its exports lose competitiveness → specie flows back out →
  prices fall. The *distribution* of money self-equilibrates with **no sink**.

This regulates *where* money sits. The *total* is bounded separately (below).

### Layer 2 — Credit: the multiplier (and the bust)

- A **banking** settlement (has the Banking tech, high trade volume, high
  organization) creates **credit money**: `s.credit = f(tradeFlow, banking, org)`,
  capped at a multiple of its specie (`CREDIT_MAX_MULT`). Effective spendable
  wealth = `s.wealth + s.credit`.
- Credit **expands** the effective supply where commerce is hot (Venice,
  Amsterdam get rich on paper, not metal) and **contracts** sharply when commerce
  collapses — a sacked capital, severed trade, plague depopulation drop the credit
  multiplier, shrinking the money supply (the historical dark-age crunch).
- This is the elastic, highest-risk layer — **built last**.

### Bounding the *total* supply (replacing the freight burn honestly)

Hume regulates distribution; three realistic forces bound the total:
1. **Finite metal.** `depositReserve` already depletes — minting tapers as mines
   run dry (Laurion, Potosí cycles). The supply plateaus instead of growing
   forever.
2. **A small realistic drain.** `COIN_LOSS_RATE` (~0.005–0.02 %/pass of
   circulating coin) — wear, shipwreck, buried hoards, coin melted to plate. Tiny,
   defensible, and gives mint-inflow an equilibrium to settle against. **This is
   the honest replacement for the freight burn.**
3. **Credit contraction** (Layer 2) removes money in busts.

---

## 3. Keeping the real economy robust under "no barter"

The earlier population crash (removing the freight sink doubled the supply →
inflation → coin-gated grain unaffordable → cities starved) is the thing this
section must prevent **without barter**. Root cause: costs scale with `localP`
but a spender's *coin stock* does not, and the new money pooled in producers, not
in the cities that buy grain. Fixes, all coin-mediated:

- **Money must circulate to producers, not pool.** Minting credits the mining
  settlement, trade credits sellers, **freight credits the carrier** — every
  actor that produces value earns coin, so incomes rise with the price level.
- **Price the whole ledger in one `localP`.** Grain price, wages, export value,
  tax takes and tariffs all already key off (or should key off) the same regional
  price level, so inflation is **nominal** — real affordability is invariant.
- **Stocks, not just flows, must keep pace.** A settlement's wealth *reserve*
  (`getWealthReserve`) and its food-buying budget should be expressed relative to
  `localP`, so a city's grain budget rises with grain prices instead of being a
  fixed coin number that inflation erodes.
- **Acceptance test:** with the freight sink removed and minting/seigniorage in,
  **population and city count must stay within noise of baseline** across ≥2
  seeds. Phase 1 does not ship until this holds.

---

## 4. Data model

```
country.currency = {
  fineness:    1.0,    // metal per face unit; debasement lowers it
  creditMult:  1.0,    // Layer 2: effective = specie × creditMult (banking hubs)
  // FX value of one unit abroad ≈ fineness × (relative price level); derived
}
country._treasury           // exists; gains seigniorage + tariffs + tax
settlement.wealth           // exists: coin, denominated in its realm's currency
settlement.bullion          // NEW: uncoined metal awaiting the mint (Layer 0)
settlement.credit           // NEW (Layer 2): bank-created money on top of wealth
world._mintByCountry        // cid → the minting settlement (capital / Currency city)
```

Cross-border value (Phase 4) converts at the currencies' relative `fineness ×
priceLevel` — a debased realm's coin buys less abroad.

---

## 5. Integration points (where the code changes)

| System | File | Change |
|---|---|---|
| Mining → bullion | `settlement.js updateWealth` | mint to `s.bullion`, not `s.wealth` |
| Coining + seigniorage | `conquest.js` polity pass / new `money.js` pass | bullion → coin, cut → `_treasury` |
| Freight no longer burned | `roads.js sellGoods` | credit `freight*scale` to the carrier (seller) |
| Hume competitiveness | `roads.js runGeneralTradeBetween` | scale volume by `localP` ratio |
| Coin-loss drain | new small pass | `wealth -= wealth * COIN_LOSS_RATE` |
| Credit | new `money.js` logic + `inflation.js` | `s.credit`, folded into effective wealth |
| FX on cross-border trade | `roads.js sellGoods` | convert by currency parity |
| Debasement decision | `conquest.js` (state fiscal AI) | lower `fineness` under deficit/war |

`inflation.js` already turns "more money in a region" into "higher prices," so
most of the feedback is *emergent* once money is created/moved correctly.

---

## 6. Phasing (each phase ships and is verified on its own)

**Phase 1 — State minting + honest drain; retire the freight burn. (THE UNBLOCK.)**
Mines → bullion → mint → coin, seigniorage → treasury. Replace the freight burn
with credit-to-carrier. Add `COIN_LOSS_RATE`. Re-express food budgets/reserves in
`localP` so inflation is neutral. *Ship gate:* population + city count stable vs
baseline across seeds 8817 & 4242 (the test the naive sink-removal failed).

**Phase 2 — Hume competitiveness. ✅ DONE** (`T.HUME_ELASTICITY`, default 0.5).
A region's export competitiveness scales with how cheap it is vs its partner
(reciprocal, so total trade volume is unchanged — only the balance shifts), so a
specie-rich/high-price region exports less and imports more and bleeds specie
until its prices fall. Verified (`probe_seatrade`, seeds 8817 & 4242): the
price-level spread TIGHTENS — max localP 2.03→1.36 and 1.88→1.09, CV 9.9%→7.1%
and 13.1%→10.2% — specie self-distributes, cities stable, population flat-to-up.

**§3 — RESOLVED via the (b) nominal-inflation model. ✅ DONE.** Two failed attempts
at *real* inflation-neutrality (scale trade income × localP; then also deflate
demand & reserve to real terms) both made population MORE money-sensitive, not
less. Investigation then showed the population-vs-money-supply variation is
**CHAOS, not an inflation non-neutrality** — the sim's population is butterfly-
sensitive to *any* parameter (it swings 35-73k for one seed across unrelated
config changes), so no inflation fix can flatten it. So we took option (b): the
sim's REAL decisions — grain price (foodHierarchy), building cost (settlement),
army wages & colony grants (conquest) — now use BASE prices, NOT × localP. localP
is kept ONLY for Hume competitiveness (relative, roads.js) and the display
ticker (`_inflRaw`). Effect: inflation no longer SQUEEZES the domestic economy
(the crash failure mode is gone — worst case across money levels is now ~48k, no
collapse), prices still visibly rise on the ticker, and money still self-
distributes (Hume). **This unblocks Phase 3:** debasement's bite now comes via FX
depreciation + seigniorage revenue (the international channel), not by starving a
realm's own cities. Verified healthy at the calibrated supply on seeds 8817 & 4242
(8 / 9 cities). Long-run money neutrality — a standard result — by design.

**Phase 3 — Debasement. ✅ DONE** (`T.DEBASE_AGGRO`, default 0.5). A state that
can't cover its army bill melts the coinage (`gov.fineness ↓`) for emergency
seigniorage. The seigniorage is ∝ the fineness DROP, so it **self-limits at the
floor** (no infinite minting). The cost lands ABROAD: a debased realm's weak coin
is distrusted, so its cross-border trade volume shrinks (`roads.js` reads
`gov.fineness`). Solvent realms restore the coin toward full fineness. Verified
(seeds 8817 & 4242): ~80% of realms debase over a run (mean fineness ~0.85, some
to the 0.35 floor — currencies genuinely diverge), the money supply grows ~46%
(realistic debasement inflation, absorbed by the (b) model — cities stay 7-8),
and `c._fineness` is exposed for the UI. The war-finance spiral, with the bite on
foreign commerce instead of the realm's own cities.

**Phase 4 — Per-country currencies + FX.** Each realm's `fineness × price level`
sets an exchange rate; cross-border trade converts at it; debasement depreciates
the currency and reprices foreign trade. This is the full "country-based
currency" vision.

**Phase 5 (advanced, optional) — Credit & banking.** Elastic credit money in
banking hubs; booms and busts; the dark-age contraction. Highest stability risk,
so last.

---

## 7. Tuning levers (all into `tuning.js T.*`)

```
SEIGNIORAGE_RATE   0.05    state's cut of minting → treasury
COIN_LOSS_RATE     0.0001  per-pass drain (wear/hoard/loss) — the honest micro-sink
MINT_RATE          1.0     fraction of held bullion coined per polity pass
HUME_ELASTICITY    0.5     how hard trade volume responds to relative prices
DEBASE_AGGRO       0–1     how readily a deficit realm debases (Phase 3)
CREDIT_MAX_MULT    3.0     cap on bank credit vs specie (Phase 5)
CREDIT_BUST_DROP   0.5     credit lost when a hub's commerce collapses
```

---

## 8. Risks & open questions

- **The coin-gated real economy is the calibration minefield** (it caused the
  crash). Phase 1's ship-gate (population stability) is the guardrail; do not
  advance past it on hope.
- **Elastic credit (Phase 5) is the hardest to stabilize** — booms/busts can
  oscillate. It is optional and last for that reason.
- **Per-country FX (Phase 4)** touches every cross-border transaction; keep the
  conversion in one helper so it can't drift.
- **Determinism / perf:** all new passes are O(settlements) or O(countries) on
  the existing polity/trade cadences; no new per-tick per-tile work.
- **Open:** should bullion physically *ship* to the mint (a real flow, tradeable,
  raidable — "the treasure fleet") or be coined in place? Shipping is richer and
  more raid-able but costs a logistics pass. Leaning: coin in place for Phase 1,
  revisit as a treasure-fleet feature later.
