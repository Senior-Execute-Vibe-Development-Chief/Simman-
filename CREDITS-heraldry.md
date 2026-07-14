# Heraldry charge art — attribution

The heraldry system draws ~185 charges (across beasts, insects, birds, mythic,
sea, plant, object, architecture, natural, celestial and geometric categories)
from two open collections, recoloured to each shield's tincture. The set is
deliberately free of real-world **religious iconography** (no crosses, crescent,
ankh, valknut, &c.). All field treatments (partitions, ordinaries, lines, semé),
the geometric tilework (rosettes, star lattices), the calligraphic bands, the
abstract brand glyph, and the **procedural sacred sigils** — our own emergent
religious iconography, composed from sacred primitives under symmetry, copying no
real faith — are drawn procedurally and are original to this project.

## Detailed charges — DrawShield

The detailed, banner-quality figures (`src/sim/heraldryChargesDetailed.js`, built
from `assets/charges-src/` by `tools/build_charges.mjs`) come from the
**DrawShield** project:

- **Source:** <https://drawshield.net> · repo
  [drawshield/Drawshield-Code](https://github.com/drawshield/Drawshield-Code)
  (`stable` branch, `svg/charges/`).
- **Author:** Karl Wilcox and DrawShield contributors.
- **Licence:** the repository is **GPLv3**; the charge artwork is a mix of
  public-domain and Creative Commons works (see drawshield.net for per-charge
  detail). The SVGs carry no per-file licence tag. **Not guaranteed
  commercial-safe** — retained here for a non-commercial/hobby project.
- **Modifications:** background stripped, Inkscape/Office metadata removed,
  `rgb()` normalised to hex, and **every** non-black/white fill, stroke and
  gradient stop folded into the shield's tincture (each rendered as a clean
  monochrome silhouette with its black linework preserved), coordinates rounded
  for size. Provenance per charge in `assets/charges-src/SOURCES.tsv`.

## Flat charges — game-icons.net (fallback)

Charges without a DrawShield entry fall back to **game-icons.net** silhouettes
(`src/sim/heraldryCharges.js`):

- **Authors:** Lorc, Delapouite. **Licence:** CC BY 3.0
  (<https://creativecommons.org/licenses/by/3.0/>). Background stripped and
  recoloured to the tincture.
