# How real flags became flags — research notes for the emblem engine

*Working notes behind the modern-flag realism rounds. Everything here is about
MECHANISMS to model, never specific flags to copy (cardinal rule 2: build the
system, not the outcome). Written before coding; each finding maps to an
engine mechanism at the end.*

## 1. The development chain

Real flag design is one unbroken evolutionary line, which is exactly why the
engine's banner→flag continuum has to stay walkable:

1. **Heraldic flags** (12th–15th c.): the pennon (personal lance flag), the
   banner of arms (the shield's field, square-ish, filling the whole cloth),
   the standard (livery colours + badges). A banner of arms IS the coat — the
   same design grammar on cloth. A few survive as national flags today
   (Austria, Switzerland — plain banners of arms).
2. **Naval ensigns** (17th–18th c.): sailing states required ships to fly
   nationality at distance. Distance legibility began stripping detail; the
   **canton system** emerged — a union device in the upper hoist quarter with a
   plain or striped fly (the British red/white/blue ensigns; the Dutch
   tricolour as the first "modern-looking" flag). Cantons carry: a star
   (Chile, Liberia, Togo), a cross (Greece), a sun (Uruguay, Taiwan), a
   crescent-and-star (Malaysia), a whole star-field (the US), or **another
   flag entire** (the ensign grammar proper: Australia, New Zealand, Fiji).
3. **Revolutionary tricolours** (1789→): the French tricolore (Paris cockade
   blue-red + Bourbon white) exported the *tierced band of plain colours* as
   the shape of a new nation; the Dutch, then Latin America, then half the
   world. Meaning moved from lineage (arms) to ideology (colours).
4. **Post-colonial and modern flags** (1918→, esp. 1957→): pan-African and
   pan-Arab colour families, simple devices (star, crescent, sun, leaf),
   occasionally a small state coat of arms as a central panel. Full-size
   heraldic beasts effectively vanish — a figure survives only as a lone,
   reduced device (Sri Lanka's lion, Bhutan's dragon, Uganda's crane) or
   inside the small arms panel (Mexico, Ecuador, Egypt).

## 2. Vexillological design principles (NAVA "Good Flag, Bad Flag", Ted Kaye)

The canonical five: **keep it simple** ("a child can draw it from memory");
**meaningful symbolism**; **two or three basic colours**; **no lettering or
seals**; **be distinctive or be related**. These are distance-legibility
economics, not taste: a flag is read at hundreds of yards, moving, half
furled. The same pressure that made ensigns simple.

## 3. Concrete geometry of real flags

- **Aspect ratios**: 2:3 (~88 of 195 states), 1:2 (~55), 3:5 (~17) dominate;
  the lineage is colonial (1:2 British, 2:3 French, 3:5 German). Squarer than
  2:3 is rare (Switzerland 1:1).
- **Stripe ratios**: tricolour bands are usually equal thirds; the **Spanish
  fess** (1:2:1 — the middle band doubled: Spain; Colombia runs 2:1:1) is the
  common variant. US stripes: 13 equal.
- **Nordic cross** (Dannebrog construction): arm thickness ≈ 1/7 of hoist
  (4/28), **equal for both arms**; crossing offset so the hoist-side fields
  are square (12:4:21 along the fly, 12:4:12 down the hoist).
- **Cantons**: up to a quarter of the flag's area; the US union is 7/13 of
  the hoist × 2/5 of the fly.
- **Fimbriation**: thin (Union Jack: cross 1/5 of hoist, fimbriation 1/15 —
  a 1:3 ratio of outline to band).

## 4. How flags arrange stars (the constellation grammar)

Multiple compact devices are never wallpaper-strewn on modern flags; they are
*organized*, and the count usually enumerates something (states, islands,
provinces):

- **Ring**: Cape Verde (10, ring offset toward the hoist), Micronesia (4),
  Federation of BiH 1996–2007 (10), the EU circle (12).
- **Arc**: Venezuela (8 in an arc across the middle band); China's four small
  stars arc around the large one; Tajikistan's 7 over the crown.
- **Rows**: the US algorithm — offset rows alternating a and a−1 stars
  (6/5 ×9 for 50); before 1912 the arrangement was unregulated and rings,
  rows and even scatters coexisted. Small counts sit in one row (Syria 2–3 in
  the middle band).
- **Diagonal band**: Bosnia-Herzegovina — 9 stars along the bend, cut by the
  edges (deliberately "infinite").
- **Constellation** (a literal sky map): the Southern Cross family (Australia,
  NZ, Samoa, PNG, Brazil — Brazil mirrored, 27 stars), Tuvalu's 9 stars
  placed as the islands actually lie. The scatter is *meaningful*, seeded by
  geography.
- **One big star** (Vietnam, Somalia, Chile's canton) and **crescent + star**
  (Turkey, Tunisia, Pakistan…) are the commonest single/dual arrangements.

## 5. What colours flags actually run

- Frequencies across national flags: **red 74%, white 71%, blue 50%,
  yellow 43%, green 42%**; black common as an accent. **Purple appears on ~2
  flags; brown effectively never** (Lesotho's shield, Dominica's parrot).
- Flags run **2–4 tinctures total** (NAVA says 2–3 basic); marks reuse the
  colours already flying rather than introducing new ones — cloth is sewn
  from the bolts on the table (bunting comes in standard saturated dye lots;
  the muddy overdye "stains" of heraldry — tawny, murrey, sanguine — are not
  bunting colours).

## 6. What devices modern flags carry

- **Stars**: ~70 states (the five-pointed overwhelmingly; Marshall Islands'
  24-point the outlier). **Suns**: ~20 (disc, rayed, or faced). **Crescents**:
  ~15. Simplified plants (maple leaf, cedar), weapons/tools rarely, wheels
  (India's chakra).
- **Small state arms / armorial panels**: a handful of states carry the full
  coat (≈7 with a true CoA; more with simplified emblems) — always *small*,
  centered or hoist-shifted, never filling the cloth.
- **Figurative animals at full size: effectively zero.** The exceptions are
  lone reduced figures (Sri Lanka, Bhutan, Wales, Uganda, Kiribati, PNG,
  Zimbabwe, Dominica — ~5% of flags), most inside a panel or arms. Compare
  armory, where beasts dominate the rolls. The engine's existing
  "figures step back" rule matches; the *frequency* of figures on flags
  should sit far below the armorial windows.

## 7. Findings → mechanisms (what the engine builds)

| finding | mechanism (never a copy) |
|---|---|
| stars are organized, counts enumerate | **array grammar**: on flag cloth a compact device's multiple-intent (three / in-pale / semé) expresses as ring / arc / rows / seeded constellation; count rides the count gene. Semé-as-wallpaper stays on silk & shields. |
| the star-field canton (US), canton devices (Chile…) | when a canton and a compact device coexist, the canton *houses* the device or the whole array — one device system, not two competing ones |
| ensign grammar (another flag in the canton) | a *marshalled* genome on flag cloth flies the senior quarter as a canton coat instead of quartering the cloth (shields keep true quartering) |
| small state-arms panel | the existing device panel gains an escutcheon shape — the charge on a small shield, the arms-in-panel of modern flags |
| aspect ratios 1:2 / 3:5 / 2:3 | the substrate gene's position *within* its banner window picks the cut — no new gene, smooth under mutation |
| Spanish fess | the stripes gene (already the thickness/diminutive gene) doubles the middle band of a tierced fess/pale |
| Nordic cross construction | equal absolute arm thickness, hoist-side crossing (square inner corner) |
| bunting palette | flag fields name only from the bunting bolts (the 7 fast single-vat tinctures); overdyed stains stay on shields/silk. Same genes, substrate-specific naming — the ermine/vair precedent |
| 2–4 tinctures, reuse | **sewing economy**: a new mark prefers a tincture already flying when it still reads (min OKLab dE ≥ the palette's own metal↔colour class gap); only derives a fresh bolt when nothing on the table reads |
| figures ~5% of flags vs ~45% of arms | a frequency window (the MOTIF_CATS idiom): flag cloth flies a figure only from a strongly figural tradition (high iconism); weaker figuration remaps to compact/non-living devices |

## Sources

- NAVA, *Good Flag, Bad Flag* (Ted Kaye): https://nava.org/good-flag-bad-flag ; https://portlandflag.org/good-flag-bad-flag/
- Flag history overview: https://en.wikipedia.org/wiki/Flags ; https://en.wikipedia.org/wiki/National_flag ; https://flagriser.com/flag-history
- French tricolour: https://worldcountryflags.com/flag-of-france/
- US flag & star rows: https://en.wikipedia.org/wiki/Flag_of_the_United_States ; https://www.britannica.com/topic/flag-of-the-United-States-of-America ; https://www.si.edu/spotlight/flag-day/flag-facts ; https://www.crwflags.com/fotw/flags/us_stars.html
- Star arrangements: https://en.wikipedia.org/wiki/Flag_of_Cape_Verde ; https://en.wikipedia.org/wiki/Flag_of_the_Federated_States_of_Micronesia ; https://en.wikipedia.org/wiki/Flag_of_Tuvalu ; https://en.wikipedia.org/wiki/Flag_of_Venezuela ; https://en.wikipedia.org/wiki/Flag_of_Bosnia_and_Herzegovina ; https://en.wikipedia.org/wiki/Flags_depicting_the_Southern_Cross
- Colour statistics: https://www.guinnessworldrecords.com/world-records/450711-most-commonly-used-colour-in-national-flags ; https://flagmakers.co.uk/blog/resources/what-is-the-rarest-colour-on-national-flags/ ; https://www.crwflags.com/fotw/flags/xf-csts.html
- Ratios & construction: https://en.wikipedia.org/wiki/List_of_aspect_ratios_of_national_flags ; https://en.wikipedia.org/wiki/Spanish_fess ; https://en.wikipedia.org/wiki/Flag_of_Colombia ; https://www.flaginstitute.org/wp/uk-flags/union-flag-specification/ ; https://en.wikipedia.org/wiki/Dannebrog ; https://en.wikipedia.org/wiki/Canton_(flag)
- Devices: https://worldpopulationreview.com/country-rankings/country-with-stars-on-flag ; https://www.worldatlas.com/articles/country-flags-with-stars.html ; https://worldflags.net/flags-with-suns ; https://en.wikipedia.org/wiki/Banner_of_arms ; https://worldflags.net/flags-with-coat-of-arms
