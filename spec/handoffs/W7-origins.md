# W7 — Where farming begins, and how it travels

Wave 7 of the v2 rebuild. Owner directive (2026-09-03, on the 4400 BCE
play-report of ten wheat hearths igniting in the same century from the Nile
to the Indus, and ten rice hearths from Bengal to Japan a millennium later):
**"we need the spread and starting block to be perfect, or at least
acceptable."** This wave is the origin of farming (the starting block) and
the two things that carry it (the spread): the boat hop and the pre-emption
of invention by arrival.

## The finding

The M3a hearth law accrues "peopled-basin years" on every cell of a
package's wild range and ignites at the package's domestication lag. Two
facts made that a calendar: the ranges were bounding boxes covering the
whole botanical distribution (wheat from the Nile to the Indus and the
Caspian; rice from the Ganges to Japan; sorghum across all of Africa south
of the Sahara), and a world that opens peopled fills every basin to its
forager capacity within a few centuries, so every cell of every box reached
the lag in the same century. The minimum-separation rule then cut each box
into hearths a thousand kilometres apart — ten for wheat, ten for rice,
twenty for sorghum, seventy-eight in all. A hearth fired because of WHEN it
was, not what its basin had become (first cardinal rule), and it fired in
places whose only claim was a box (second rule: the outcome was drawn, not
predicted).

Two more findings sit under the spread. The dev grid (167 km cells) cannot
represent the Bosporus, the Dardanelles or the Korea Strait: at that
spacing they are open sea wider than any boat hop, so the front walks round
the Black Sea (northwest Anatolia at −6242, Thrace at −4835) and never
reaches Korea or Japan. And the 40 km "foot-and-raft" hop was below the
crossings the Neolithic demonstrably made (Cyprus, Crete, Malta, Corsica).

## What changes

1. **The ranges are the dense-stand habitat, cited.** `crop-ranges.json`
   now carries, per package, the belts where the wild progenitor forms
   harvestable stands, with the sources that draw that distinction
   (Harlan & Zohary 1966 on "massive stands" against sporadic plants;
   Zohary, Hopf & Weiss 2012; Fuller 2011 and Fuller & Qin 2009 on the
   annual wild rice of the Yangtze margin; Matsuoka 2002 and Piperno 2009
   on the Balsas; Harlan 1971, Winchell 2017 and Manning 2011 on the
   Sahel; Lu 2009 and Zhao 2011 on the loess; Olsen & Schaal 1999 and
   Piperno & Pearsall 1998 on the lowland Neotropics; Harlan 1969 on
   Ethiopia; Denham 2003 on Kuk; Smith 2006 on the Eastern Agricultural
   Complex). Sporadic occurrences (einkorn in the Balkans and Crimea, wild
   barley across Iran and Central Asia, perennial wild rice through
   monsoon Asia and the Ganges, wild sorghum across eastern and southern
   Africa) are excluded on the sources' own reading; that those regions
   are then REACHED, in their windows, is the check on the reading. This
   is Earthness in data (R7): the biogeography of a plant, not the
   archaeology of a hearth.
2. **A basin that already farms stops domesticating.** The hearth clock
   accrues at the basin's fill times the share of the cell's own
   subsistence that is still the land's forager yield,
   `foragerCapacity / capField`. An unfarmed cell accrues at its fill; a
   cell the spread has reached lives on a capacity a hundredfold the
   forager yield and its clock all but stops. Spreading pre-empts inventing
   with no rule, threshold or constant for it: the Iranian plateau, western
   Anatolia and the Nile receive the package before any stand of theirs
   could mature one.
3. **The boat hop is the Neolithic's own.** `PEOPLE_COASTAL_HOP_KM` is
   re-grounded from 40 to 100 km on the longest sea crossings the Neolithic
   colonised from a mainland (Cyprus ~70 km by 8500 BCE, Malta ~80 km,
   Corsica ~80 km). At the dev grid nothing changes (a sea cell is 167 km);
   at the shipped grid the Aegean, the Marmara, the Adriatic and the Korea
   Strait become crossings.
4. **The sorghum lag is the Sudan's.** 2000 → 2500 years: from the
   wild-sorghum harvests of the Khartoum Mesolithic and Nabta Playa
   (~6000 BCE) to domesticated grain in the eastern Sudan (Winchell et al.
   2017, fourth millennium BCE).

Nothing else moves: no bell, no lag but sorghum's, no separation, no
adoption rate, no mobility, no growth. The Rust kernel is untouched — it
takes forager capacity and the neighbour stencil as inputs.

## What NOT to do

No hearth pins. No range drawn from where a hearth should be rather than
where the wild plant stands. No lag set to land an arrival. No
resolution-dependent hop (a hop across "one sea cell" is a grid-spacing
rule). No touching the wake trigger, whose own finding (the first caged
basin at the shipped grid) is recorded separately. No long-arm runs beyond
the solve regime the directive permits.

## Acceptance

- Hearth count and timing at dev: wheat in the Fertile Crescent arc only,
  within centuries of −8500; rice on the Yangtze only; millet on the loess;
  no hearth outside a cited belt.
- Nile, Indus, Yellow River, Mesoamerica and the Andes reached inside their
  windows by the spread.
- The European rows and Japan measured at the shipped grid (the dev grid
  cannot represent the straits); every remaining miss recorded with its
  cause in `known-misses-people.json`.
- Lint, unit (with a check on the clock term), smoke, parity, gate, bench.

## Status (implemented on the working branch, 2026-09-03)

**Dev solve arm (−9700 → 1 CE, 17.8 s).** 21 hearths (78 before): wheat 2
(northern Iraq −8083, Fars −8027); millet 2 (−7313, −7306); highland roots
1 (−6417); rice 1 (Han–Yangtze, −6200); eastern seeds 2 (−6200, −6193);
sorghum 5 across the Sahelo-Sudanian belt (−6186 to −6151); New Guinea 2;
lowland tubers 5 (−5486 to −5367); maize 1 (Balsas, −3946). Arrivals by
spread: Fertile Crescent −7971, Nile −6515, Yellow River −6298, Indus −5654,
Mesoamerica −3498, Andes −4478, south India −3750 — all inside their
windows; the Indus and south India rows leave the manifest. Population at
−5000 falls from 247M to 78.8M (band 5–60M); at 1 CE from 2.25B to 1.94B.
Europe front Balkans → Rhine 1.08 km/yr, unchanged. The first caged basin
moves from the Nile delta to Susiana (32.2°N, 48.8°E) at −5892.

**Remaining misses at dev, recorded with their causes.** Europe late
(Balkans −4632, central Europe −3596, Rhine −3155, Cardial −3785, inland
Europe −3904) and Korea/Japan never reached: the straits at 167 km cells.
The Sahel early (−6060) and eastern North America at −6200: a world caged
from the opening under today's climate, where the real belts filled as the
green Sahara dried and the mid-Holocene floodplains formed (P10). The
Ganges at −4254, now by spread from the Punjab, a millennium early.
Population: M3b.

**Shipped grid (target, 1800×900, solve arm to 1 CE, 1,069 s).** 28
hearths: wheat 2 — the Tigris (33.7°N, 44.3°E) at −8069 and the Taurus
north of Cilicia (38.5°N, 36.5°E) at −8048; millet 3 (Shandong, the Wei,
the loess edge, −7320 to −7299); rice 2 — the middle (30.7°N, 110.7°E,
−6221) and the lower Yangtze (30.5°N, 119.7°E, −6151); sorghum 9 across
the belt (−6179 to −6039); Ethiopia 2; eastern seeds 2; New Guinea 2;
lowland tubers 6; maize 1 (−3974). With the 100 km hop the straits link
(94 crossings of the Marmara including the Bosporus at 44 km, Cyprus at 89
km, the Cyclades chain, Tsushima at 92 km) and the shipped-grid spread
changes in kind: Balkans −5654, Cardial coast −4807, inland Europe −4387
(all inside their windows; −2854, −1657, −1846 with the 40 km hop), Crete
−5871, Cyprus −6851, Korea −4555, Kyushu −3883; the Nile −6235, the Yellow
River −7012, the Indus −3225, Mesoamerica −3435, the Andes −3995 inside
their windows. Population at −5000 is 53.0M, inside the band (5–60M) for
the first time (118M before the wave). The first caged basin is Cappadocia
(38.3°N, 36.9°E) at −5535.

**What is still late at the shipped grid, and why.** Central Europe −3722
and the Rhine −2980, with Balkans → Rhine at 0.59 km/yr, a hundredth
below the radiocarbon band. On a flat field the same law runs at 0.53
km/yr at the shipped grid (0.66 at dev, where the front moves one 167 km
cell every 252 years), and 0.53 is exactly 2·√(r·D) for the farmer
group's own growth (0.28 %/yr × 1.65 = 0.46 %/yr) and mobility (15
km²/yr). The ledger's 0.94 assumed adoption at full contact, which a
leading edge never has: the pulled front's speed is set by the farmers'
own rate. The Neolithic front ran at ~1 km/yr because a colonising
population grows at its uncrowded rate (Bocquet-Appel's Neolithic
demographic transition, ~1 %/yr; Ammerman & Cavalli-Sforza's own r), not
at the crowded long-run average M2 grounded `PEOPLE_R_GROWTH_PER_YEAR`
on; re-grounding it moves the population curve as well and is an owner
ruling (P15), not this wave's. Japan −3162 (millet through Korea, early
against a rice window), the Ganges −950 and south India unreached (the
Iranian leg slowed once the second wheat hearth condensed in the Taurus
rather than Fars), the Sahel −5864 (P10), population after −5000 (M3b):
recorded in the manifest's `:solve:target` rows.

