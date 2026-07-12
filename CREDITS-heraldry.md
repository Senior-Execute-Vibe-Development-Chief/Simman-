# Heraldry charge art — attribution

The heraldry system draws charges from two open collections, recoloured to each
shield's tincture. Geometric/celestial charges (mullet, estoile, crescent, sun,
roundel, annulet, lozenge, cross, crosslet, escallop) and all field treatments
(partitions, ordinaries, lines, semé) are drawn procedurally and are original to
this project.

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
- **Modifications:** background stripped, Inkscape metadata removed, DrawShield
  tincture-slot colours (`#ffff00` etc.) recoloured to the shield's tincture,
  coordinates rounded for size. Provenance per charge in
  `assets/charges-src/SOURCES.tsv`.

## Flat charges — game-icons.net (fallback)

Charges without a DrawShield entry fall back to **game-icons.net** silhouettes
(`src/sim/heraldryCharges.js`):

- **Authors:** Lorc, Delapouite. **Licence:** CC BY 3.0
  (<https://creativecommons.org/licenses/by/3.0/>). Background stripped and
  recoloured to the tincture.
