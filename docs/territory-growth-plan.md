# Territory growth redesign — capital-outward, settlements on the frontier

Status: **plan / pre-build**. Goal agreed with owner: stop the "bag of
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

## 4. Option B (heavier — true country-primary territory)

A country owns a single contiguous tile-region grown from the capital by an
org/capacity budget; settlements are interior nodes drawing a local slice;
conquest moves the region boundary; secession carves a sub-region. More
literally "capital grows outward," but it's a real rewrite of
territory/grouping/conquest and re-tunes everything from scratch. **Recommend
only if Option A's feel proves insufficient.**

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
