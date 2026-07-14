# Charge art intake — drop detailed heraldic SVGs here

This folder is where **detailed, banner-quality charge art** goes (e.g. the
Sodacan-style lions and eagles from Wikimedia Commons). Files here **override**
the flat game-icons silhouettes per charge; anything not provided falls back to
game-icons, then to a procedural glyph.

## How to add a charge

1. **Get an SVG** of the charge. Good sources (detailed, and license-clean):
   - Wikimedia Commons — the PD subset
     ([SVG coat of arms elements](https://commons.wikimedia.org/wiki/Category:SVG_coat_of_arms_elements)),
     and **Sodacan**'s charges (usually **CC BY-SA 3.0** — commercial-OK with
     attribution + share-alike).
   - Prefer **public domain (CC0)** or **CC BY / CC BY-SA**. Avoid **NC**
     (non-commercial) art unless this project will never be commercial.

2. **Name it by the charge id** the grammar uses, e.g. `lion.svg`, `eagle.svg`,
   `dragon.svg`, `wolf.svg`, `boar.svg`, `bull.svg`, `horse.svg`, `bear.svg`,
   `griffin.svg`, `wyvern.svg`, `unicorn.svg`, `pegasus.svg`, `dolphin.svg`,
   `serpent.svg`, `rose.svg`, `garb.svg`, `tree.svg`, `oak.svg`, `tower.svg`,
   `castle.svg`, `crown.svg`, `key.svg`, `sword.svg`, `anchor.svg`, `ship.svg`,
   `scales.svg`, `harp.svg`, `escallop.svg`, `fleur.svg`, `thistle.svg` …
   (Full id list: the `CHARGES` object in `src/sim/heraldry.js`. A new id not
   there is fine — tell me and I'll add it to the vocabulary.)

3. **Note the source & licence** — add one line to `SOURCES.tsv`:
   `id  <TAB>  source-url  <TAB>  author  <TAB>  licence`
   (used to generate the attribution in `CREDITS-heraldry.md`).

4. **Build & preview**:
   ```
   node tools/build_charges.mjs      # → src/sim/heraldryChargesDetailed.js
   node tools/render_arms.mjs        # preview sheet (SVG)
   ```

## What the build does (so your files "just work")

`tools/build_charges.mjs` per file: strips a full-canvas background, removes
`<metadata>`, and picks a **recolour placeholder** — the DrawShield/Armoria
`#d7374a` if present, else the dominant non-black/white fill. At render time that
colour is swapped for the shield's tincture while `#000` linework and `#fff`
highlights are kept, so the charge takes the field's colour but keeps its detail.
If no placeholder is found, the charge renders **in its own tinctures** (fine for
art that already carries heraldic colours) — it's just placed on a contrasting
field.

Two things vary by source and may need a nudge, which I'll handle when I see your
files: the **viewBox tightness** (affects on-shield size) and whether a charge
should recolour or keep its own tinctures.

## What gets committed

The **generated module** `src/sim/heraldryChargesDetailed.js` is the committed
output. The raw SVGs in this folder are working files and are **git-ignored**
(see `.gitignore`) — their provenance and licence are recorded in `SOURCES.tsv`.
To vendor the raw sources as well, remove the `.gitignore`.

The current set was pulled from **DrawShield** (see `CREDITS-heraldry.md`).
