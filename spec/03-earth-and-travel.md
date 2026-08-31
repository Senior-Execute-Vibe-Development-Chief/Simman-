# 03 — The Earth substrate and the travel-time field  `[FULL DETAIL]`

Layer 1 (milestone M1). Two products: the world, and the cost of moving
through it. Everything above consumes these.

## 3.1 The Earth substrate

**Reuse v1's worldgen pipeline unchanged as the initial supplier.** It is
certified portable with zero runtime backward-coupling (research/05 §1):
Earth DEM (1920×960, carved straits), the earth_sim climate branch with
observed NCEP climate as the default (monthly — we will consume the
seasonality, which v1 mostly collapsed to annual), resolution-invariant
rivers (absolute-km² classification), floodplain ribbons in physical units,
biome classifier (Köppen-calibrated), crop packages with domestication lags
and wild ranges, resources, and the deep-ancestry peopling wavefront.

Port-with-cleanup items land opportunistically, not up front: the four
peopleSim imports extracted; remaining per-tile constants (lake cap, mine
scatter radii, ancestry hops) converted to km; the tectonic generator's
duplicated climate code unified (Phase 3 concern).

The earth_sim place-anchored corrections are kept as a labeled
"earth-corrections" data stage (R7) and excluded from procedural presets.

**Exogenous forcings (DECISIONS 2):** a volcanic/climate-excursion process
drawn from real hazard geography (eruption sources at real volcanic
provinces, magnitude-frequency from the record), producing bounded
multi-year climate multipliers — v1's `climMod` layer generalized, with an
optional historical-track replay toggle. Never writes the substrate; only
modulates yields.

## 3.2 The travel-time field — the spine

One cost model answers every "how far/how fast/how hard" question in the
sim. There are no other reach formulas anywhere (v1's named open problem —
two decay laws over two metrics — is closed by construction).

**Definition.** Per-edge traversal time (days) for a given *mode* and
*capability*:

- Modes: foot, pack animal, cart, river craft, coastal sail, open-sea sail.
- Edge time = distance ÷ mode speed × terrain factor (slope/relief, marsh,
  forest, desert) × seasonal factor (snow/pass closure, monsoon windows,
  mud seasons, sea ice — from the monthly climate) × infrastructure factor
  (road quality, ports; both emergent stocks that feed back here).
- Capability gates modes: pack animals need domesticates present; carts
  need wheels + draft; river craft need boats; open sea needs navigation
  technique. Gates are capability bars, never dates (R1).
- Freight cost (for economics) = time × mode cost-per-ton-day. Calibration
  anchors: land grain haul e-folds at **340 km** (Diocletian, v1-validated,
  [CONTESTED] flag carried); relative freight sea:river:land ≈ **1:5:28**
  (Duncan-Jones); the ORBIS dataset for route-level validation.
- Information travels on the same field at courier speeds (its own mode
  multiplier); armies at march speeds with supply costs per day (05, 06).

**Implementation.** v1's `transport.js` single edge-cost core is the seed
(port verbatim, then extend with the seasonal dimension). Consumers run
multi-source Dijkstra / distance-transform queries over it with per-pass
caching; the two-grid discipline of R3 applies to every derived reach.

**Seasonality contract.** Costs are functions of month; consumers either
integrate over the year (annualized trade) or read the month (campaign
seasons, sailing windows). This is new relative to v1 and is the cheap
door to campaign seasons, monsoon trade, and winter famine logistics.

**The danger premium (DECISIONS 12d).** Effective travel cost = physical
cost + a per-segment predation premium: high where authority weight (05)
is thin and displaced violence-men (demobilized levies, famine-displaced —
from the standing books) are plentiful, scaled by the value of the traffic;
suppressed where a strong authority patrols (protection is the lord's own
revenue defense — primitive 4). Trade reads effective cost; armies read
physical cost. Required emergent consequences: the internal peace dividend
of unified realms; Silk-Road-class overland routes lighting up only when
imperial spans collapse the summed premium, dying at fragmentation — and
thereby re-pricing the sea route (14.1's exploration trigger).

## 3.3 Reality table (gates M1)

| Quantity | Target | Source |
|---|---|---|
| Rome→Alexandria, Rome→London etc., by era/mode/season | match published model within ~25% | ORBIS |
| Land grain-haul viability | ~20–100 km shed pre-modern | grain-shed literature (research/01 §3) |
| Freight ratios | sea:river:land ≈ 1:5:28 | Duncan-Jones |
| A day's ride / foot day | ~30–40 km / ~20–30 km | standard literature |
| Monsoon sailing windows | seasonal asymmetry Indian Ocean routes | sailing-era records |
| Cross-grid | identical real-km answers at dev and target grids | R3 |
