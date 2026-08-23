# The confetti, ranked by leverage (2026-08-23)

Owner, after a session of measurement: *"so really, where we are now is SOMEWHAT
accurate, with the whole confetti thing, being a multitude of city states fighting
each other? what would you point to as the biggest leverage changes?"*

This is the standing map of the problem as measured this session. Everything below
is either a measurement with its arm named, or a reading of code labelled as such.
Nothing here is built.

## Is the confetti historical? Partly — and the three gaps ARE the diagnosis

City-state mosaics were real and common: Sumer (~30 states, 2900-2334 BCE), Greece
(~1,000 poleis), the north-Italian communes, the Maya lowlands, imperial Germany's
statelets. A fragmented map is not wrong in itself. What is wrong:

1. **It is global and simultaneous.** History's mosaics were regional and
   staggered — Sumer 2900 BCE, Greece 700 BCE, Italy 1100 CE. And while Sumer was
   thirty squabbling city-states, EGYPT NEXT DOOR WAS ONE KINGDOM. The
   contemporaneous contrast is the thing the sim cannot produce: it runs one
   political mode everywhere at once.
2. **It never resolves.** Sumer's mosaic lasted ~600 years, then Akkad ate it;
   Greece's ~350, then Macedon; Italy's ~400, then Spain and France. The sim holds
   ~80% singletons from first statehood to the end of the run. History's mosaics
   are PHASES; this one is a steady state.
3. **The units are the wrong size.** Lagash held ~1,600 km², Uruk perhaps
   3,000-5,000. The sim's median realm is ~30,000 km² with ONE city — too big to
   be a polis, too city-poor to be a kingdom.

## The leverage order

### 1. The urbanism contagion — attack the SUPPLY

`landKnow.js:247` iterates `world.settlements` — every settlement, court or not —
and grants each an institution-radiating sphere. Ledgers inside climb at
`contactMul = 1`; outside, `1/(1+ORG_CONTACT)` = one fifth. A ledger crosses
`URBAN_ORG` 0.28, mints a city, and that city radiates in turn. Chain reaction,
with no polity anywhere in it.

Statehood cannot keep pace by construction: a city needs 0.28 in a LEDGER (present
in every farmed basin), a state needs 0.35 in a CITY that must first exist and then
climb. The urban frontier propagates at the exchange radius; statehood trails by a
fixed climb, forever.

Highest leverage, and also the right FIRST move: the nation count is roughly
proportional to the city count, and measuring consolidation in a world with several
times too many cities says little about consolidation in a world with the right
number. Fix supply first and every downstream measurement becomes meaningful.

Candidate: the sphere becomes a property of a COURT (what the defending comment
actually argues from — "institutions radiated by a classical court", Han's road
grid, Yamato), not of any dot. Stateless cities keep the village horizon.
**Named risk:** `EXCH_WAVE` exists to un-freeze the missing classical cohorts (31
of 40 proto-cities beyond every sphere, org frozen at p50 0.12 — North China Plain,
Yangtze, north India). Restricting it could re-freeze exactly those, and the tw=240
arm already shows China empty until the Renaissance band. The A/B gate is the
register-vs-history table in `city-count-vs-age-2026-08-21.md`, not the map's look.

### 2. The capacity ledger — broken in two places at once

* `hasAbsorbHeadroom` never evaluates. `considerIntegrations` runs at
  `updatePolities:2743`; `_capacity` is stamped at 3027 and `_loadTotal` at 3309,
  onto a view rebuilt at 2325 — so the gate takes its `cap == null` escape and
  returns true. Measured: 0 rejections in ~10,000 candidates over four arms.
* A province PAYS 0.013 capacity (`CAP_SEAT · log2(1 + people/SIZE_REF)`, SIZE_REF
  = one million people) against a cost of ~1. Measured: biggest `seatRaw` in the
  world 0.26 against a ceiling of 17.2.

This same ledger feeds `holdReach`, which is what `beyondDirectRule` rejects on —
42% of integration candidates once the org bar is removed. Upstream of reach,
integration AND territory. **Riskiest:** with load measured at ~20x capacity, a
naively revived gate would reject nearly every integration and make the lane worse.

### 3. Encirclement should lower the submission BAR, not just speed the ROLL

`conquest.js:3856` rejects on `powH < powS * 5.0` and `continue`s; the encirclement
term enters at 3867, on the hazard roll — after the gate that already threw the
candidate out. Measured: of 20 specks sitting inside a bigger bloc, 11 are held by
exactly this bar (power ratio 1.4x-4.9x). Smallest, most surgical, highest
confidence; fixes the specific thing on the owner's screen.

Historically the bar is also simply too high: Rome absorbed Italian cities nowhere
near five times weaker — adjacency, encirclement, allylessness and an attractive
citizenship did it, not the power ratio.

### 4. The state-first route — the realism answer, and a wave not a lap

Every region runs cities-first because the city bar sits BELOW the state bar on the
same variable. Egypt's and Qin China's route — a territorial state first, planting
its administrative towns — is structurally unavailable. `STATE_OF_LAND` land nations
already form with no city and could supply it; `maybePlantTowns` is the channel and
measured near-dead early (zero plantations by step 8000).

This is the only item that would genuinely produce "cities spawn within nations",
and it is the owner's own standing directive from `state-birth-2026-08.md`.

### Not on the list, and why

* **`SEAT_BONUS_CAP`** — measured non-binding; nothing in the world reaches 2% of
  it. The owner's suspicion was productive (it led to the inert seat term) but the
  cap itself is a ceiling nothing approaches.
* **Re-grounding the org quantile alone** — removing it ENTIRELY only moves the
  integration pass rate 2.3% -> 5.3%; it is not the lane's real constraint.
* **Reviving the headroom gate before the ledger is sound** — see 2.

## The arms behind all of this

`docs/runs/2026-08-23/` — `absorbbar*` (four arms, both grids), `seatcap240`,
`specks240`, `wherecities*`. Instruments: `tools/probe_absorbbar.mjs`,
`probe_seatcap.mjs`, `probe_specks.mjs`, `probe_wherecities.mjs`. The birth-side
work that preceded them is `docs/nationless-cities-2026-08-22.md`.


---

# ARM VERDICTS (same day) — both levers FAIL, and the failure re-ranks the list

Built, byte-identical off, A/B'd at tw=240 against the pre-committed criteria in
`docs/runs/2026-08-23/README.md`. **Neither ships.** Both stay at 0.

## ENGULF_BAR: the lever fires, the population does not move

|  | control | ENGULF_BAR=8 |
|---|---|---|
| specks inside a bigger bloc | 20 | 19 |
| speck power ratio p50 | 4.9x | 2.5x |
| of specks, under the 5x bar | 11/20 | 16/19 |

The distribution shifted exactly as designed — the specks nearest the bar were
taken — and the standing count did not move. **The speck population is a STOCK
whose size is set by the INFLOW, not by the absorption outflow**, which is the
identical finding `state-birth-2026-08.md` recorded for stateless cities:
doubling and retiring the founding channel both left the standing count where it
was. Widening an outflow refills at the same level.

That is not a reason to discard the lever's diagnosis — encirclement genuinely
does not reach the bar, and 11 of 20 specks genuinely are held by it. It is a
reason to stop treating absorption as the lever for a supply problem.

## COURT_SPHERE: a redistribution that amplifies a different error

Cities per region at step 24,000:

| region | control | COURT_SPHERE | reading |
|---|---|---|---|
| Mesopotamia | 13 | **23** | toward history's 20-30 — pass |
| Steppe | 33 | **1** | history 0 — pass |
| China | 20 | **5** | the feared re-freeze — REGRESSION |
| Levant | 13 | **2** | history ~10 — regression |
| Europe temp | 44 | **65** | wrong direction |
| Americas | 44 | **63** | wrong direction |
| total | ~463 | ~444 | essentially flat |

Not a rate cut — a redistribution, so the mechanism does what it claims. But its
direction is set by **where states already are**, and this sim forms them in the
wrong places: China's hearth matures 1,300-1,700 years late, and the
Pontic-Caspian river basins out-compete Mesopotamia on rain-fed suitability
(`owner-review-2026-08-21.md` item 2). Mesopotamia and the steppe come right
because states are near or absent; Europe and the Americas get worse because
states arrived there early.

## The re-rank

**Item 1 cannot be fixed independently of where states form.** A court-gated
sphere inherits the statehood-geography error and multiplies it. The upstream
mechanism is already named in the owner review and is not built: **IRRIGATION** —
where river magnitude × aridity × flat land coincide, worked land's effective
fertility multiplies with organisation and construction. Without it the climate
model scores southern Mesopotamia as mediocre rain-fed farmland and the sim can
never see why Sumer is Sumer.

Revised order:

0. **Irrigation** (owner-review item 2) — upstream of everything above. Until the
   cradles score like cradles, every supply and consolidation fix inherits a map
   whose states are in the wrong places.
1. The capacity ledger (was item 2) — independent of state placement; the dead
   headroom gate and the 0.013-per-province seat term stand on their own.
2. COURT_SPHERE — re-measure AFTER irrigation, not before.
3. ENGULF_BAR — keep as a correct sub-mechanism, but it is not a lever on the
   standing count. Revisit once the inflow is right.
4. The state-first route — unchanged, still a wave.
