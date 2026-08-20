# Knowledge on the land — the settlement-dependence inversion (2026-08-20)

## The owner's question, verbatim

> "and thats our problem: the sim still depends on settlements for statecraft,
> knowledge, people etc. why? is it realistic?"

…arriving as the escalation of a run of reports the same week: *"full nations,
metropolises, wars in the STONE age"* (answered by `STATE_RECORDS`, 2026-08-19),
then *"there should be NOTHING before bronze, surely? no 'taking their valley
as a nation', no cities, no roads, NOTHING."* The owner greenlit this campaign
with "i want to do this. go".

## The diagnosis

The sim was built entity-first; the project's whole recent history is a
migration off that:

| what | where it lives now | since |
|---|---|---|
| people | `popField` (entities are a derived census lens) | ONE_POP |
| farming technique | `devField` + `_hearthSeeds` (invents and spreads with **no settlement at all**) | DAWN_LIVE / INVENT_STAGGER |
| everything else — organization, construction, metallurgy, navigation, mobility | **settlement entities only** (`updateKnowledge`) | never moved |

The last row is why prehistory could not be empty: the world literally cannot
climb toward the writing bar unless proto-city entities exist to carry the
learning. `STATE_RECORDS` gated the *state*; the scaffolding *cities* still
minted in the Stone Age (the site pass mints on food/density alone), grew org
on the entity for millennia, and the owner watched the anachronism. Hiding
them in the renderer was the alternative considered and rejected: it would
look right and be a lie.

**Is settlement-dependence realistic?** Split verdict. For the mature world,
largely yes — administration, metallurgy practice, navigation genuinely
concentrated in cities and courts. For prehistory, no — the Neolithic ladder
(kinship organization, village craft, Chalcolithic smelting) accumulated
diffusely across the peopled countryside, exactly the tier this sim keeps
"implied in the land" rather than as entities.

## The mechanism (T.LAND_KNOW, def 1, v38)

`src/sim/peopleSim/landKnow.js` — the pre-urban knowledge **ledger**:

- **Carrier.** One record per market-cell basin, keyed to the static site
  lattice (`labelSiteLedger`). Planted the first time a basin qualifies as a
  *peopled, farming community* — the identical gates the city-eligibility and
  land-nation doors already sat (`peopledBasinAt` mass + `devP ≥
  NEOLITHIC_AGRI`). Never speculative, never per-tile: institutional knowledge
  is basin-scale, and the lattice is the sim's own notion of a basin.
- **Law.** A village-simplified `updateKnowledge`: same `T.LEARN_BASE`, same
  track shapes, same era ceiling (`orgEraCapOf`, now ONE exported definition
  in tech.js shared with settlement.js). Deliberate simplifications, each a
  physical claim, documented in the module header: agriculture is *read* from
  the devField (the wave IS village agronomy); ore is read over the ~500 km
  **Neolithic exchange sphere** (`EXCH_KM` — obsidian/copper networks; Sumer
  smelted with no ore of its own); winter aptitude reads the site's own
  selection target (residents of generations ≈ the climate's selection);
  organization compounds only under **pressure** — Carneiro's cage ×
  storable-ceiling (pristine lane) or an existing state's ground inside the
  cell (secondary lane), through the same `ORG_CONTACT` re-base as the
  settlement law. No trade reach, no rivals, no scribes, no rulers — those are
  urban things.
- **The bar.** New Stone-age tech **Tallies & Seals** (org ≥ 0.28, prereq
  mysticism): token accounting, the institution that ran Uruk's granaries
  before script. `URBAN_ORG` == its gate, load-time asserted (the
  `RECORDS_ORG` pattern). It deliberately does NOT join writing's prereq list
  — that edge would narrow writing's partial-credit window (org 0.18-0.28
  lends its reach/sci on-ramp today) and silently shift the calibrated mature
  regime; the lineage lives in the descs, and unlock order is right anyway
  (0.28 < 0.35 on one track).
- **Two doors, one bar.** A site city **mints** only past the tally bar (a
  gathered pre-tally core is Çatalhöyük — a proto-urban town, bounded by the
  site spike, not yet a city). A tribal land-nation **declares** only past the
  same bar (a border is an administrative claim; a people that cannot count
  holds its valley as culture, not as a polity). Both doors plant the ledger
  when the basin qualifies, so learning always precedes the exam.
- **The handoff.** The newborn city's knowledge = per-track max(inherit path,
  its own ledger) — the basin's learning is its birthright; the record freezes
  once its cell seats a settlement (the court carries knowledge from there).
- **Era over an empty map.** `chronicleTick` and the HUD `leadingEra` read the
  ledger's per-track max while no court exists, so the display calendar
  marches Stone → Copper → Bronze across an entity-free world. The quiet-ages
  fast-forward now stands down at the **first city** (no realm AND no settled
  settlement), the first visible beat.

The arc the owner sees at `tw=960`: empty land → farming invents (chronicle
beat) → *nothing on the map* while the ledgers learn (fast-forwarded) → the
first cities rise in the cradle belt at the Chalcolithic/Bronze threshold →
the tablet → the first states. No render gating anywhere: prehistory is empty
because nothing exists.

## Cardinal-rule audit

- **Rule 1 (no time gates):** the bar reads what a basin's people *know*;
  the ledger's inputs are terrain, deposits, density, cage, contact. No step,
  year, or era is ever read.
- **Rule 2 (build the system):** the scaffolding entities are *replaced by a
  mechanism*, not hidden; the one new constant with content (`EXCH_KM=500`)
  is a measured historical quantity (hand-to-hand exchange reach), and
  `URBAN_ORG` is an institution on the tree, not a fitted dial.
- **Rule 3 (measure at the shipping grid):** probe_genesis arcs at W=960
  (tw=480, the app arm) and a W=1920 (tw=960) spot-check are the wave's
  battery, below.

## Byte-identity at lever 0

All new code paths are behind `T.LAND_KNOW`; the harness pins it 0 alongside
DAWN_LIVE/STATE_RECORDS (same regime lesson). The one subtle hazard found and
avoided: the tallies tech itself is effect-free (no `TECH_FX` entry → skipped
by `techEffects` before partial credit) and era-0 (leadingEra unchanged), and
writing's prereqs are untouched (see above). `npm test` hashbase anchors are
the proof.

## Measurements

**Arc v1 (tw=480, 8817, 20k) — two defects found by the first run.** Ledger
org reached only 0.220 by 20k (the settlement law's sqrt-minds specialist
term had been dropped — worth ~2.4× for a basin holding a city-basin census —
so the climb ran at half the entity pace this ledger replaces), and the first
stone-age chiefdom paint leaked through the PEER_LATTICE **secondary** tribal
lane, which sits "the identical exam" to the primary but had not been given
the tally gate. Both fixed; the era fold was also a per-track chimera across
basins (one basin's org + another's seamanship rang Bronze via sailing) —
now the cached max over single records' tech eras (`world._lkEra`).

**Arc v2 (tw=480, 8817, 20k) — the arc is historically shaped:**

```
step   ledgers  lkOrg lkMet lkCon   settled realms
 7500     2     0.136 0.000 0.180     0  0     farming: Nile 7128
10000    18     0.177 0.049 0.229     0  0     (Indus 8136, Mesopotamia 11232)
12500    21     0.243 0.127 0.309     0  0
15000    21     0.281 0.218 0.402     2  0     FIRST CITY: the Nile, 13675
17500    34     0.281 0.325 0.546     4  3     first states 17280 (frontier)
20000    50     0.281 0.403 0.636    13  9
eraAt: Bronze 12300 (the land's copper working), Classical 16800, Medieval 19500
```

- **First city in the world: the Nile (28.5E 30.8N), step 13675** — then
  Upper Nile, the Indus, Mesopotamia; Anatolia's ledger carries met 0.40 on
  cu 0.69 (the real metallurgy heartland), the Tripolye belt (27E 48.8N) and
  an Altai metal province mint in the second rank. Zero settlements, zero
  roads, zero borders before 13675.
- **Tribal fabric now waits for the tally**: first declaration 14400 (was
  7500 in v1/the old regime) — after the first city, before the first state.
- **Top ledgers freeze at exactly ~0.280-0.281** — the bar binds, the mint
  follows, the record freezes as its cell seats the court. Mechanism
  confirmed end-to-end.
- **Cost** (probe_quietcost, tw=240, lever on): crystallize holds at 2% both
  windows; the field pass keeps its 90-92%. The ledger is free.
- **Gates**: npm test green; hashbase anchors fd90feea/7239c843 unchanged.

**Control arm (LAND_KNOW=0, same grid/seed/steps) — the verdict:**

| | control (old doors) | LAND_KNOW |
|---|---|---|
| first city | 7600 — 479 steps after farming, in Nubia/Chad | 13675 — the Nile |
| tribal paint from | 7500 | 14400 (after the first city, before the first state) |
| settled / realms at 20k | 87 / 71 — the everywhere-at-once bloom | 13 / 9 — the cradle belt |
| eraAt | [Stone, 13800, 15300, 18000] | [Stone, **12300**, 16800, 19500] |

Three verdicts fall out. (1) **The Bronze flip now precedes the first city**
(12300 < 13675, via the land's own copper working) — the map is empty until
the era turns, then cities arrive *in* the Bronze age, states just behind:
the owner's arc, verbatim, with no display gating anywhere. (2) **Post-mint
court racing is pre-existing**: the control's own courts hit seatOrg 0.72 by
20k and its era ribbon reaches Medieval at 18000 — LAND_KNOW is actually
*slower* through Classical/Medieval (fewer, later courts). That pace belongs
to the standing chronology campaign (SCI_COMPOUND), not this wave. (3) The
urban age unfolds at a similar tempo once it opens (control had ~8 realms
~1.5k steps after its first states; so does this arm) — the wave *stages*
history, it doesn't slow the whole clock. **VILLAGE_LEARN ships at 1.0 — no
knob was tuned to reach this.**

**tw=960 spot-check (the owner's grid, 8817, 22k) — the Third-Rule arm holds.**

```
step   ledgers  lkOrg lkMet lkCon   settled realms
 8250     8     0.129 0.019 0.194     0  0     farming: Nile 7104, Indus 8136
13750    24     0.262 0.213 0.406     0  0     (Mesopotamia 12768, Yellow R 13800)
16500    35     0.281 0.329 0.551     3  1     FIRST CITY: Upper Nile, 14300
22000    76     0.284 0.428 0.664    32 23     tribal from 15700; frontier state 17280
eraAt: Bronze 11700 (before any city), Classical 17100, Medieval 20400
```

Same KIND, same order, same neighborhood as the tw=480 arm — first city
+4.6% in step terms (13675 → 14300), tribal fabric after the first city at
both grids, the Bronze flip on an empty map at both. No resolution-collapse
class difference; the run also survived 22k at 1920 within memory (the
stall-fix allocation discipline holding). Geography at the fine grid: the
Nile valley births the first two cities (Upper Nile 14300, Lower Nile
15650); Anatolia (cu+sn, met 0.43) and Mesopotamia (cu 0.82) lead the
metallurgy ladder exactly where history's smiths were; the chernozem
steppe-forest belt (agri 0.72-0.73) grows a Trypillia-like early cluster —
its Dnieper seat takes the first *frontier* state door at 17280 (the Nile
realms materialize through tribal adoption, which the probe's
polity.founded list doesn't date). Watch items: that Dnieper first-mover,
and a Zambezi city (17040) off the southern wheat hearth — both
mechanism-driven, both worth re-reading after the next long app run.

Carried observations: an SE-Asian bronze polity (102.8E 17.3N, minted 16800)
rises before the Yellow River's late-farming basin — the technique wave
reached the Khorat plateau through India first (Ban Chiang is a defensible
echo; the Yellow River pin matured at 16392 on this seed/grid — re-measure
at tw=960). A West-African frontier state at 19872 rides the wave-arrived
package similarly. Pre-existing chronicle noise CONFIRMED in the control:
site mints log `settlement.founded` twice (makeSettlement + the mint
block's city:1 event) — cosmetic, both regimes, untouched for
byte-identity; a future cleanup should dedupe under its own measurement.

## Open follow-ups

- **Ledger agriculture is read-only** from the devField; village practice
  improvement stays with the hearth seeds. If peripheral basins prove
  agriculture-starved relative to their own people, records could stamp into
  the dev sources (the IDEA_FIELD pattern) — measure first.
- **Secondary contact is cell-resolution** (state ground inside the basin's
  own market cell). If the post-state frontier rolls too slowly at the ledger
  layer, widen to adjacency — measure first.
- **Mobility's saddle-life** (pastoral-share compounding) needs the food
  model and stays settlement-side; steppe ledgers learn riding at the
  owns-horses rate only.
