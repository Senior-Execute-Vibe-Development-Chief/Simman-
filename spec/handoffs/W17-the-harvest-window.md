# W17 — the harvest window

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W16
(`spec/handoffs/W16-the-taxon-we-name.md`). This wave changes ONE
normalisation in `v2/src/sim/people/crop.ts` and adds one sourced field to
`v2/data/reality/crop-packages.json`. No Rust changed; no world state was
added; no metric was added.

## 1. The question that started it

The owner, on the staple misses, in plain words: *"millet shouldn't be able
to outcompete rice in south China, same with sorghum to wheat."* QUESTIONS
#70 dug into the two suspects and cleared one and convicted the other:
switching works, and the sim was grading a farm by **how much of the year is
good** when it should grade it by **how good the months the crop is actually
in the ground are**. The fix was recorded as DECISIONS P19 and deliberately
NOT built, because it needed a number — how long a crop occupies the
ground — that this repo did not have, and picking that number to make Egypt
come out wheat is the second cardinal rule's forbidden move.

Then: **"ok, look it up and implement then."** So: look it up, then build the
mechanism the number implies, and report whatever map falls out.

## 2. What was wrong, in one line

`crop.ts` computed twelve monthly grades, summed them, divided by twelve, and
handed that ONE number to two consumers that want opposite normalisations.

- The **wild stand** is grazed continuously. Eight good months feed more
  gatherers than five, so the share of the YEAR is exactly right — that is
  W10's own finding, and the reason the `/12` was put there.
- A **harvest** is one crop cycle. A farmer sows once and reaps once; the
  months outside the cycle are not part of the yield. Dividing by twelve
  rewards a long season over a good one, which is precisely the Nile
  complaint: an excellent five-month Egyptian winter graded below a merely
  adequate twelve-month Sudanese year.

## 3. The mechanism: a best planting date, not a division by the season

```
harvestFit = ( Σ monthFit over the best consecutive W-month run, wrapping
               the year ) / W          where W = min(cycleDays / 30.44, 12)
             the run taken being the one that maximises Σ (monthFit + monthGain)
standFit   = Σ monthFit / 12                                    (unchanged)
```

A month the crop cannot use contributes 0 to any run containing it. The run
wraps the turn of the year, because a winter cereal is sown in one year and
reaped in the next. The last month is weighted by the fraction of it the
cycle covers, so a 3.94-month cycle takes its fourth month at 0.94 and there
is no cliff at a whole number of months. The paddy gain (W15) is summed over
the SAME run and divided by the same fit, so the two still divide out and
capacity at the full technique regime is exactly what the flooded months
earn.

**The run is chosen by the whole harvest, not by the fit, and that is load
bearing.** W15 deliberately keeps a wetland crop's positive response OUT of
the fit — a paddy is husbandry, paid out with the cultivator's technique — so
rice's monthly FIT is identical wet and dry. Search the twelve start months on
fit alone and every run ties on flat ground: the first one wins, the flooded
months fall outside it, and the paddy is gone. The mechanism would have been
switched off by its own normalisation. Selecting on `fit + gain` is not a
patch for that case but the honest objective — a planting date is chosen for
what the worked field yields — and it is inert for every upland crop, whose
gain is zero in every month. Only a wetland crop moves its date onto the
flood, which is what a paddy is. On the dev substrate the difference is
1,828.6M against 1,829.8M of world best-package capacity (+0.07 %), small
only because a monsoon flood already falls inside the season rice would have
picked anyway; the unit fixture, where it does not, measures the full loss.

**The shape is not decoration — each of its three properties dissolves one of
the three blockers P19 recorded as unsolved, and dissolves it by construction
rather than by an exception.**

1. **Perennials.** `W = 12` for anything that stands in the ground for a year
   or more, so its window IS the year and its grade reduces EXACTLY to
   `Σ/12`. Enset's four-to-eight-year cycle needs no root-crop special case;
   the clamp is the mechanism. (Measured: highland-roots' fit is bit-for-bit
   unchanged in every box.)
2. **Short seasons.** Five favourable months under a six-month cycle now
   score five sixths of their quality. `/season` gave that case 0.0000 and
   made the whole result violently sensitive to the cycle length — the thing
   that made choosing a length feel like choosing an answer. The cliff was an
   artifact of `/season`, not of the idea.
3. **W10.** The stand keeps `Σ/12`, so millet's best stand is the cell it
   always was and every stand-side row in the manifest is unmoved. This is
   the W15 pattern again: what physiology takes is in the fit, what the
   reader wants is normalised at the reader.

A fourth property came free, and it is a change to W14 rather than to W8: a
crop is now sown AROUND a flood it cannot drain wherever the season leaves
room for it, so the drowning loss is charged only where it cannot be avoided.
That is most of why the Nile's wheat doubles in §5 — the valley's winter is
wheat's own season, and the flood is not in it. The unit test pins both
halves: the same three-month flood costs wheat nothing on a cell whose other
nine months are warm, and costs it the full drowning on a cell whose only
five favourable months are the flooded ones.

## 4. The number that had to be looked up

`cycleDays` per package, in `data/reality/crop-packages.json`, with the
citations in `spec/09-constants-ledger.md` §W17:

| package | days | source |
|---|---|---|
| wheat | 120 | FAO-56 Table 11, Barley/Oats/Wheat, Central India, Nov |
| rice | 150 | FAO-56 Table 11, Rice, tropics & Mediterranean |
| maize | 125 | FAO-56 Table 11, Maize (grain), Nigeria humid / India dry-cool |
| sorghum | 130 | FAO-56 Table 11, Sorghum, USA / Pakistan / Mediterranean |
| millet | 105 | FAO-56 Table 11, Millet, Pakistan, June |
| tubers | 210 | FAO-56 Table 11, Cassava year 1, rainy tropical |
| highland-roots | 1460 | enset, 4–8 y to harvest maturity (Brandt et al. 1997) |
| new-guinea-roots | 210 | greater yam 7–10 mo, dryland taro 7–9 (Bourke & Harwood 2009) |
| eastern-seeds | 90 | FAO-56 Table 11, Squash/Zucchini, Mediterranean & Europe |

**The rule is the SHORTEST listed total growing period for the crops the
package IS, and it is structural, not chosen for an outcome.** The fit's
month-admission test (W13) already drops the months a crop cannot use, so a
longer REGIONAL period — long precisely because the crop overwinters or lies
dormant — would put those same months back into the window as zeros and
charge the crop twice for them.

**The alternative was measured, and it cuts the way that would embarrass a
fitted choice.** Read wheat at FAO-56's Winter Wheat 240 d instead: every
rice figure on the dev substrate is bit-for-bit identical, and only wheat
moves, downward everywhere — Nile 0.384 → 0.284, Central Europe 0.616 →
0.513, Indus 0.414 → 0.343, Ganges 0.362 → 0.217, south China 0.777 → 0.607;
the Nile box drops wheat 2nd → 3rd and Central Europe's ties. So the reading
that was taken is the wheat-friendly one, it was taken on the rule above
rather than on that fact, and the alternative's whole map is on the record in
the ledger. `cycleDays` is NOT `seasonMinimumMonths`, which is a growing
season MINIMUM by its own ledger entry — reusing it would repeat W16's lesson
that a name is not the thing it resolves to.

## 5. What it did to the map

Dev substrate, no history. Centre cell, `yield × fit × (1+gain)` at technique
1, before → after.

| box | real staple | before | after |
|---|---|---|---|
| south-china | rice | new-guinea-roots 0.728 | **rice 0.990** |
| lower-yangtze | rice | new-guinea-roots 0.480 | **rice 0.787** |
| ganges | rice | tubers 0.453 | **rice 0.576** |
| central-europe | wheat | highland-roots 0.376 | **wheat 0.616** |
| sahel | sorghum | **sorghum 0.384** | **sorghum 0.678** |
| loess | millet | highland-roots 0.414 | maize 0.691 |
| indus | wheat | new-guinea-roots 0.355 | sorghum 0.588 |
| nile | wheat | new-guinea-roots 0.320 | rice 0.426 (wheat 2nd, 0.384) |
| mesoamerica | maize | wheat 0.790 | wheat 0.871 |
| amazon-margin | tubers | rice 1.071 | rice 1.093 |

**Blast radius: 2,828 of 6,529 farmable cells change best package (43.3 %)**;
1,619 of 6,121 counting annuals alone (26.4 %). World best-package capacity
at technique 1 rises ×1.260. The package that loses the top slot most often
is **highland-roots (1,749 cells)** — the perennial is the only package whose
grade cannot move, so everything else rising demotes it. That is the
mechanism working, not a defect.

## 6. What it did to history — dev W5 SOLVE arm

The gate's dev solve arm is CLAUDE.md's named exception to the never-run
directive; every figure below is from it.

**Four acknowledged misses cleared, and their manifest rows were DELETED**
(the gate asserts on stale rows, so clearing a miss requires removing it):

- `arrival:nile:solve:dev` — −3099 and out of window, the only LATE row on
  the arm → **−6620, in window**.
- `staple:mesoamerica:solve:dev` — eastern-seeds → **maize**.
- `staple:south-china:solve:dev` — millet → **rice**, by switching.
- `staple:lower-yangtze:solve:dev` — millet → **rice**, by switching.

The staple table goes **5/10 to 8/10** at dev. South China and the lower
Yangtze are the two rows QUESTIONS #70 predicted the split would move, and
they moved by the mechanism it named: rice arrives and outcompetes, on ground
whose grade now reflects the months rice is in it.

**One miss was ADDED, not tuned away.** `hearth-outside:millet:solve:dev`:
millet lights at 45.8°N 77.3°E in −4625 — the Balkhash steppe, inside its
wild native range and outside the 8° north-China box. The stand field is
bit-for-bit unchanged by W17, so this is farmed capacity behind the front,
not a richer steppe stand; it is the same spread-not-rank problem the shipped
grid has carried since 2026-09-05 (`hearth-outside:millet:solve:target`), now
reachable at dev because the world carries more people.

Still failing, with their reasons refreshed: the Indus swaps incumbent (rice
→ **millet**, 16 farmed cells) and the Nile stays **sorghum** on a near-tie
(box sums sorghum 0.47M, wheat 0.45M, millet 0.41M) — §7. Every M3b
population row worsens against its band (−5000 69.1 → 98.7M; −3000 602.5 →
773.1M; −1000 1,074 → 1,391M; 1 CE 1,160 → 1,503M), because the ceiling that
curve saturates against IS farmed capacity and W17 raised it; −8000 stays in
band at 13.2M. The front speeds up 1.420 → 1.447 km/yr and the European
arrivals move 49–70 years earlier, because the country behind the front is
denser (rain-fed density 11.62 → 14.53 persons/km²); the straits the dev grid
cannot resolve are unchanged, so those rows stay misses for the reason they
always had. The Sichuan millet hearth moves −6228 → −6585 and the Sahel's
second sorghum hearth −5640 → −5682; the lower-Yangtze millet hearth is
unchanged at −7327, so the Yangtze rice box still loses its ignition race.

## 7. The finding this build produced, and did NOT fix

The gain is **strongly latitude-dependent**:

| \|lat\| | before | after | ratio | mean season of best package |
|---|---|---|---|---|
| 0–15° | 694.9M | 754.5M | ×1.086 | 11.8 mo |
| 15–30° | 400.0M | 500.1M | ×1.250 | 11.2 mo |
| 30–45° | 227.2M | 353.5M | ×1.556 | 8.5 mo |
| 45–60° | 118.7M | 199.6M | ×1.682 | 7.5 mo |
| 60–90° | 11.1M | 22.1M | ×1.997 | 5.4 mo |

The window credits a short season with one whole harvest, which is right, and
credits a year-round season with one harvest too, which is not. Read
honestly, **`Σ/12` was an uncapped multi-cropping model with every cycle
implicitly twelve months, and W17 is exactly one harvest everywhere.** Both
are wrong in the same term, in opposite directions. The truth is
`min(season / cycle, C)` where C is what one field can actually carry in a
year — fallow, soil nitrogen, labour at sowing and harvest, and the fact that
a second crop on the same ground is not a second crop of the same yield.

**C is a datum this repo does not have, so it is P20, Proposed and unbuilt.**
It is also exactly the term that would decide the two staple rows still
missing: the Nile's and the Indus's real years take a winter crop AND a
summer one, which is why they grew wheat and barley in a valley whose summer
belongs to sorghum. Choosing C now, with those two rows in view, is the
fitted outcome the second cardinal rule forbids — the same discipline that
kept `cycleDays` unbuilt until it was looked up. The asymmetry is on the
record instead of dialed out of it.

## 8. Verification

No history was simulated to obtain any figure in §5 or §7 — they are
substrate probes. §6 is the dev W5 SOLVE arm, CLAUDE.md's named exception.

```
npm run lint          eslint + constants-ledger: ok
npm test              wasm build · smoke · unit · kernel parity ·
                      byte-identical save/load
npm run gate:people   "gate":"pass"  (solveGrids ["dev"], corrected manifest)
npm run bench -- --check
npm run oracle
```

**The bench ratchet is measured on an idle runner, and one contended reading
was not taken at face value.** Run back-to-back after `gate:people` the
target tick read 27.04 ms against the ratchet's 26.4 (baseline 22.0 × 1.2)
and the check failed. Re-run alone it reads 24.14 ms and passes. The
attribution was not left to that argument: the four runtime files were
reverted to HEAD and benched on the same idle runner, which gives **24.27 ms
pre-W17 against 23.44 ms with W17** — W17 is inside the run-to-run spread and
if anything on the faster side, which is what the mechanism implies. The
window search is `O(12 × cycle)` per package per land cell and runs ONCE, in
`initializeCropFields`; nothing in the tick loop changed. `solveYearMilliseconds`
reads 166.7–180.5 against a cap of 228, spanning the same spread. What the
contended reading does record is that this runner sits ~10 % above the
carried baseline before any of this wave's code runs, which is the drift the
baselines' own note has tracked since W3; it is not re-baselined here on one
wave's evidence.

**No Rust change was needed, and parity is structural rather than lucky:**
`_cropFit`, `_cropGain` and `_cropCanGrow` are precomputed TS-side inputs the
kernel READS at `package_capacity`; it derives none of them. `npm run
coverage` and `npm run monotone` are not triggered — no world state was
added, no metric was added.

**No shipped-grid arm was run.** A 43 % re-grading of the farmed map is
exactly the blast radius the third cardinal rule most wants measured at the
grid that ships, and the same numbers that make dev's staple table 8/10 could
land differently at 42 km cells, where the arrival races this wave did not
touch resolve differently. That arm is `v2-long`, on request, and it is
recorded as needed rather than assumed.

## 9. What is still open

- **P20**, the harvests-per-year term — §7. The largest known gap in the
  farmed grade, and the one that would decide the Nile and the Indus.
- **The shipped-grid arm for W17**, §8.
- **The Indus and the Nile** remain misses on a mechanism that is now right
  in kind and short one term; neither was dialed toward.
- **W16's own shipped-grid arm** (the tubers range lost eleven twelfths of
  its cells) is still outstanding.
