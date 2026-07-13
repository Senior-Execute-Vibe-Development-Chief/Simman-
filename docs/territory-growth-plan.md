# Territory growth redesign — capital-outward, settlements on the frontier

Status: **SHIPPED** (see §4b "Integration — SHIPPED" below; header was stale "plan /
pre-build" until audit 2026-07) — and since SUPERSEDED by the field-polity model
(docs/field-polity-spec.md), which replaced the mechanism this plan built. Goal agreed with owner: stop the "bag of
absorbed independent statelets" feel; make a country a realm that **grows
outward from its capital**, with **settlements appearing at advantageous
frontier sites**, while keeping all the war / conquest / secession machinery.
Food model chosen: **local slice per settlement** (each settlement keeps its
own catchment).

---

## 1. What already exists (so this is a rebalance, not a ground-up rewrite)

Reading the current code, most of the target machinery is already present:

- **Persistent per-settlement territory** — `territory.js > computeTerritory`.
  Every settlement owns a core (tier-sized) + hinterland belt + cost-reach
  domain; ownership persists, releases on death, walls around neighbours. No
  shimmer. A country's land is the **union** of its members' domains.
- **Food = local catchment** — `_terrFertSum` (distance-weighted fertility of a
  settlement's own claimed tiles). This **is** the "local slice per settlement"
  model; **no change needed**.
- **Internal colonisation** — `crystallize.js > maybeSendSettlers / sendSettlers`.
  A pressed, solvent town already sends a settler party that founds a daughter
  joining the parent's realm (`countryId = parent.countryId`, `parentSettlementId`
  set). This is exactly "capital grows outward" — it's just currently a minority
  source.
- **War / conquest / secession / capacity / loyalty / momentum** — `conquest.js`,
  `armies.js`. All operate today; they carry over unchanged.
- **Solid rendered borders** — `countryClaim.js` (persistent claim + crawl).
  Already makes a realm read as one contiguous region.

## 2. Measured current behaviour (real 1920×960 grid, seed 8817)

| step | setts | colony-origin % | countries | single-member | biggest realm |
|------|------:|----------------:|----------:|--------------:|--------------:|
| 1000 | 10    | 0%   | 10 | 10 | 1  |
| 3000 | 22    | 0%   | 20 | 18 | 2  |
| 6000 | 64    | 6%   | 48 | 37 | 4  |
| 9000 | 118   | 15%  | 62 | 39 | 7  |
| 12000| 184   | 23%  | 58 | 26 | 17 |

**Crystallisation dominates (77–100%).** New settlements overwhelmingly appear
as *independent* statelets scattered by the random sweep, and realms form
*slowly by absorbing them*. That bottom-up "settlements first, country emergent"
flow is the blob feel. Capital-driven colonisation never exceeds ~23%.

## 3. The change — Option A (recommended, low-risk rebalance)

Flip the dominant source. The country can stay a grouping; because growth
becomes capital-outward colonisation, the grouping is automatically coherent
and contiguous.

1. **Restrict crystallisation to genuine wilderness frontier.** A site on or
   adjacent to an existing realm's territory no longer spawns an *independent*
   statelet — it either (a) becomes a **colony of that realm** (extend the
   existing `inheritedCountry` path down below `ABSORB_ORG_MIN`, gated by the
   realm's spare capacity), or (b) is suppressed. Independent crystallisation
   fires only in **unclaimed, transport-distant** land → it *seeds new
   countries* in empty regions instead of infilling next to existing ones.
2. **Make internal colonisation the primary growth mode.** Raise the
   colonisation rate / relax the press gate so a healthy realm steadily pushes
   daughters outward (still bounded by `COLONY_HEADROOM` capacity + solvency).
3. **Frontier-bias the colony site pick.** `sendSettlers` should prefer sites
   toward the realm's *outer edge* (unclaimed land beyond current territory) +
   resource/river/coast quality, so realms visibly expand outward rather than
   infill.
4. **Dial absorption down.** With far fewer independent statelets spawning
   inside realms, `absorbWeakNeighbors` becomes the exception (real conquest of
   a genuine neighbour), not the main growth path.
5. **Keep war / conquest / secession unchanged.** New countries continue to
   arise from secession; together with wilderness crystallisation this sustains
   the country count.

**Why this gets the felt behaviour:** colonies founded outward from the capital,
each contributing its persistent core+hinterland+reach, make the realm's union
grow outward from the capital; `countryClaim.js` already renders that union as a
solid region. We keep the entire settlement economy and ~all of the balance.

## 4. Option B — true country-primary territory (CHOSEN)

A country owns a single contiguous tile-region grown from the capital by an
org/capacity budget; settlements are interior nodes drawing a local slice;
**the state holds land with or without a settlement on it**; conquest moves the
region boundary tile-by-tile; secession carves a sub-region. A real rewrite of
the territory/grouping/conquest substrate, re-tuned from scratch — but it
structurally eliminates the bag-of-blobs (territory is contiguous by
construction) and makes war about land.

### 4a. Validated prototype (standalone, real terrain — NOT the sim)

`/tmp/proto_b.mjs` implements the core substrate on the real world terrain +
`localEdgeCost`, with no economy, to check the substrate behaves. Algorithm:

- `owner[]` = country-id per tile (−1 wilderness/water), **persistent**.
- **Growth** (each tick): one multi-source cost-Dijkstra. Seeds = every
  country's settlement tiles at cost 0; cost propagates *freely through a
  country's own land* and *claims WILDERNESS within a per-country budget*
  `B = REACH_BASE + org·REACH_ORG`; another country's land is a wall (taken
  only by war). → land grows outward from the capital, and frontier colonies
  relay the budget further out.
- **Capacity** `cap = nSettlements·(PER_SETT_TILES + org·ORG_CAP)`. Over cap →
  shed the highest-cost (farthest frontier) non-settlement tiles. This is the
  size limit and the "pull back over-extension" pressure.
- **Settlement spawn**: a country with territorial room founds a town at the
  best **frontier** site (≥ SPAWN_MINDIST from its others) — extends future reach.
- **Wilderness genesis**: new independent countries seed in empty land far from
  any realm (keeps the count up).
- **War**: at each A│B border the stronger side (org·√tiles, jittered) flips a
  boundary tile; taking the capital collapses the loser. Tile-by-tile.
- **Secession**: a chronically over-cap realm sheds its farthest province
  (a settlement + the tiles nearer it than the capital) as a new country.

**Results** (sim grid 480×240, seed 8817, 160 ticks):

| tick | countries | settlements | coverage | max/med | CV |
|-----:|----------:|------------:|---------:|--------:|----:|
| 50   | 52        | 479         | 61%      | 2.6     | 0.59 |
| 100  | 47        | 609         | 70%      | 3.6     | 0.73 |
| 160  | 36        | 643         | 77%      | 5.2     | 0.84 |

Renders show clean, **contiguous**, outward-grown continental realms — a proper
political map. Count (36–52), coverage (~75%), and size variety (a few big
empires among many small states, CV≈0.8) are all in range, with consolidation
over time (the rise→fall arc). **Conclusion: the substrate is sound; proceed to
integrate.** Working levers: `REACH_*` (reach), `PER_SETT_TILES`/`ORG_CAP`
(size), `WILD_*` (count), `OVERCAP_SECEDE` (fragmentation).

## 4b. Integration — SHIPPED (B1, B2, B3 all done)

Re-rooted the sim onto a first-class `world._countryOwner` (country-id per tile)
while keeping the settlement economy. All three stages are committed on
`claude/nice-albattani-61FJF`:

- **B1 — substrate** ✓ (`countryTerritory.js`): `world._countryOwner` = settled
  core (from `owner[]`) + state-owned marches grown by a per-country
  org/capacity budget. Render crawls toward it; economy untouched.
- **B2 — capital-outward growth** ✓: a settlement founded on a state's land
  (core or march) JOINS that state (`crystallize.js`); only wilderness sites are
  born independent. Marches became the state's real territorial reach
  (org-scaled, capacity-capped). `MAX_CRADLES` 5→10. Food still flows from each
  settlement's local catchment = its slice of the realm (the chosen model).
- **B3 — war over land** ✓: `_countryOwner` is PERSISTENT (hybrid) — core
  refreshed from settlements (settled land taken by storming the city, via the
  existing conquest), marches persist + grow + are contestable. `marchWarfare()`
  lets a militarily stronger neighbour annex a weaker realm's march tiles tile-
  by-tile (war over the empty frontier). Capital-collapse + secession keep using
  the existing mechanisms; their territory follows automatically.

**Design note (B3 hybrid):** rather than the fully-inverted "territory
authoritative for everything, settlements adopt their tile" model — which would
have meant rewriting all of `conquest.js`'s tuned logic — settled land stays
settlement-defended (realistic: you take the city to take its land) and only the
unsettled marches are freely contested. This delivered "war is about land"
without gutting the economy.

**Validated** (full 960×480, seed 8817): rise→consolidate arc 15 → 53 → 50
countries, contiguous (no rash), borders shift visibly from war, population
~34k at step 10k (matching pre-B). Levers for further tuning: `MARCH_BASE/ORG`,
`CAP_TILES_BASE/ORG`, `WAR_DOMINANCE/WAR_FLIP_FRAC` (countryTerritory.js),
`MAX_CRADLES` (state.js).

Economy (food via local slice, trade, money, knowledge, roads) is unchanged
throughout; only the territory substrate, spawning, and frontier war changed.

## 5. Risks & mitigations

- **Country count collapses** if wilderness crystallisation is over-restricted →
  keep a moderate wilderness rate; **validate count stays ~40–60**.
- **Realms over-expand** if colonisation is unbounded → keep the
  capacity/solvency gates (`COLONY_HEADROOM`, `COLONY_MIN_SOLVENCY`).
- **Early game too empty/slow** → wilderness crystallisation must still seed
  enough initial capitals across the continents (cradles + early sweep).
- **Re-tuning** of size/count/fall-apart on the new source mix — expected; the
  levers (ORG_REACH, CAP_*, colonisation rate, wilderness rate) are all live.

## 6. Validation targets (before/with build)

- Colony-origin share becomes the **majority** (>60%) of living settlements.
- Country count holds **~40–60**; not a handful of mega-realms, not 200 specks.
- Realms render **contiguous and outward-grown** (hi-res claim render; LCF≈1).
- Population trajectory and the **rise → consolidate → fragment** arc preserved.

## 7. Staging

- **A1** — wilderness-only independent crystallisation + boosted colonisation;
  measure source share + country count.
- **A2** — frontier-biased colony site selection.
- **A3** — dial down absorption; re-tune size/count/fall-apart.
- **B** — only if A's feel is insufficient.

All stages are render/sim-tuning on the existing data model; the economy
(food, trade, money, knowledge, roads) is untouched.
