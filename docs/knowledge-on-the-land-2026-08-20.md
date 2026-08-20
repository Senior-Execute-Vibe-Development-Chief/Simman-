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

*(filled in as the battery lands — arc tables from probe_genesis at 960/1920,
probe_quietcost cost check, VILLAGE_LEARN calibration notes, gate results.)*

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
