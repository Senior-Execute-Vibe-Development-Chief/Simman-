# UI Overhaul — Master Plan

**Status:** approved direction, not yet started. This document is the blueprint.
**Scope:** every pixel of the app shell — chrome, map presentation, panels,
overlays, flows. The simulation itself is untouched; the only sim-side work is
*additive read-only snapshot fields* (§14).

---

## 0. The one-line diagnosis

The simulation under this UI is extraordinarily deep — structured events with
actors and places, per-realm chronicles with an honest/biased toggle, dynasties,
cultures/faiths/tongues as separate layers, a full heraldry generator — and the
UI shows almost none of it well. Everything legible is crammed into a 302-px
sidebar at 9–11 px, the map shows anonymous colored blobs (not one text label is
ever drawn on it — `WorldSim.jsx` contains **zero** `fillText` calls), and the
entire interface is one 4,658-line component with ~490 inline style objects.

The overhaul's job: **make the emergent history legible** — at a glance, on
hover, on click, and in depth — with an interface that looks like it was
designed rather than accreted.

---

## 1. Audit of the current UI (what exists, what hurts)

### 1.1 Structure today

| Piece | Where | State |
|---|---|---|
| App shell + map + all panels | `src/WorldSim.jsx` (4,658 lines, one component) | monolith; ~490 inline `style={{}}` blobs |
| Theme | `src/atlasUI.css` (280 lines) | parchment tokens + a handful of `au-*` classes |
| Top bar | `WorldSim.jsx:4111` | play/speed/era/year/step/realms/%claimed/ticker/globe/world/editor/menu all in one row |
| Lens rail | `WorldSim.jsx:4178` | 112-px rail: 7 lenses + sub-lenses + overlay toggles + "Layers…" |
| World Panel | `WorldSim.jsx:4444` | fixed 302 px, 6 tabs (World/Realms/Peoples/Faiths/Tongues/Inspect) |
| Legends | `WorldSim.jsx:4287–4437` | 7 hand-built bottom-left cards, one per viewMode |
| Overlays | Chronicle, Dynasty, TechTree, NewWorld, Menu, Levers, Tuning, Layers drawer, Wind params, Country editor | ten ad-hoc surfaces, z-indexes sprinkled (20/30/40/45/100/200/210/220) |
| Globe | `GlobeView.jsx` | replaces map wholesale; terrain texture only |
| Levers | `SimLevers.jsx` | flat slider list, own ad-hoc dark styling that clashes with parchment |

### 1.2 The specific failures

**The map is mute.** No realm names, no city names, no label at any zoom.
Settlements are 2–5 px dots/diamonds; realms are flat HSL tints
(`hue = id*61 % 360`) with no name, no emblem, no capital annotation beyond a
tiny star. You cannot answer "who is that big red empire?" without hovering
tile-by-tile or scrolling a leaderboard.

**The heraldry system is dark.** `emblemGenome.js` + `emblemRender.js` +
`heraldryCharges*.js` (plus `docs/emblems.md`, `docs/flag-design-principles.md`,
a whole credits file) generate culture-aware flags — and the app never renders
one. It's only reachable through the separate `langlab.html` dev page.

**Depth exists but has no ladder.** The hover card teases "click for full
info"; the click dumps a ~640-line-of-JSX wall (`renderInspect`,
`WorldSim.jsx:3316–3950`) of 10-px prose into the sidebar. There is no
intermediate reading, no cross-linking (a realm's faith name is plain text, not
a link to the faith), no back/forward, no way to pin two things and compare.

**Realm and settlement selection are different species.** Clicking the map
selects settlements only; realms are selected from the Realms tab only (two
separate states, `selectedSettlementId` and `realmSel`, with separate worker
messages). The chronicle "follows" whichever realm was last inspected — action
at a distance the user can't see.

**Events are a ticker.** The last event scrolls by in the top bar; the World
tab lists the last 28. No categories, no filters, no severity, no toasts for
epochal moments (an empire of 40 cities can fall while you watch a different
continent, and the UI whispers it in 10-px italic).

**Charts are fixed and tiny.** Seven `MiniChart`s, no hover readout, no
series toggling, no per-realm series, no era shading. The one power tool —
"Copy stats rundown" — is a developer artifact sitting in the main UI.

**Legends are ad-hoc.** Seven bespoke JSX cards; several lenses (politics,
culture, faith, language, ancestry) have *no* legend at all. Sub-lens controls
(the Prices good selector) live inside a legend card.

**Flows are modals-on-modals.** New World is one dense dialog mixing preset,
map scale, sim resolution, wind source, tectonic presets, seed, and import
with no preview and no plain-language guidance. Save/Load is two menu items
and a hidden `<input type=file>`; nothing in-browser, no autosave, no
metadata. The Layers drawer floats at an absolute offset over the map.

**The theme fights itself.** Parchment-on-parchment-on-parchment: chrome,
panels, buttons, and map legends are all the same paper, so nothing has
hierarchy. `IM Fell English` is charming at 15 px and illegible at the 9–10 px
this UI actually uses. Fonts load from Google at runtime — the "self-contained
single-file build" isn't (and is font-less offline).

**No input/a11y story.** Number keys switch lenses (undiscoverable, and wrong
once lens count changed), Esc closes everything, Space pauses. No shortcut
help, no focus management in modals, no ARIA, no reduced-motion, no
color-vision-safe alternatives for the political tint wheel.

**Performance-by-luck.** Every React re-render walks the whole monolith; the
panel re-renders on every snapshot tick. It survives because the canvas work is
ref-driven, but every UI addition pays the monolith tax. List rendering is
`slice(0, N)` truncation instead of virtualization ("… and 37 more").

### 1.3 What's genuinely good (keep it)

- The **canvas discipline**: refs + rAF for the hot path, React state only for
  panel data; base-layer caches (`BASE_CACHE_VIEWS`, `STEP_CACHE_VIEWS`).
- The **snapshot mirror protocol** (worker → read-only mirror) — the UI never
  touches sim state. The overhaul builds *on* this, never around it.
- The **atlas terrain art** (hand-drawn mountains/trees/stains) — it's the best
  looking thing in the app and the visual identity to grow from.
- The **structured event log** (`events.js`) — actors, places, types, per-entity
  index. Everything §8 needs already exists sim-side.
- Deterministic identity hues carried on entities (`c.hue`, faith/culture hues).
- The chronicle true-record/scribes' toggle — a unique feature to make loud.

---

## 2. Design principles

1. **The map is the hero.** Chrome recedes; the world fills the screen. Every
   panel is either glass over the map's edge or a document you deliberately
   open. Target: map occupies ≥ 78% of the viewport with the default layout
   (today: ~68% and visually fenced by parchment on all four sides).

2. **A ladder of depth, rung by rung.** Glance (map + labels + badges) →
   Hover (identity card) → Click (codex page in the side dock) → Deep dive
   (full-screen document: chronicle, dynasty, tech tree, atlas of charts).
   Every rung must answer more than the last, and every fact on a rung links
   to the rung below.

3. **Everything is a noun, every noun is a link.** Realm, settlement, people,
   faith, tongue, ruler, dynasty, war, event. Anywhere a noun's name appears —
   hover card, chronicle line, leaderboard row, feed entry — it is the *same
   clickable chip* that navigates the codex and highlights the map.

4. **The UI obeys the cardinal rules too.** It *reads* emergent state; it never
   drives mechanics, and it never gates on time. Panels and lenses appear when
   their phenomenon first *exists* (first coin minted → Money lens lights up),
   which is state-gating, and legal. The era ribbon stays a derived, read-only
   label. The UI never invents data: if the world has no organized faith yet,
   the Faiths page says so and explains what folk faith is doing meanwhile —
   it does not show an empty table.

5. **Legibility beats miniature.** Nothing interactive below 11 px; body text
   13–14 px; data in tabular numerals. If a panel needs 9-px text to fit, the
   panel is wrong, not the font.

6. **One system, not ten surfaces.** One overlay manager, one z-scale, one
   legend component, one tooltip system, one chip, one table. Ad-hoc panels are
   the current codebase's UI equivalent of "symptom patches" — banned.

---

## 3. Visual design system

### 3.1 Direction: *the map table*

Keep the cartographic identity — it's the product's soul — but stop wrapping
parchment in parchment. Two-surface system:

- **Chrome = the table.** Top bar, docks, drawers, feed: deep near-black
  umber/slate ("the dark wood the atlas lies on", today's `--au-table-dark`
  family), quiet 1-px hairlines, low-contrast text, translucent
  (`backdrop-filter: blur`) where it floats over the map. Chrome whispers.
- **Documents = the paper.** The map itself, legends, hover cards, and the
  full-screen documents (chronicle, dynasty, codex deep pages, tech tree) keep
  the parchment — upgraded, not discarded. Paper is for *content that belongs
  to the world*; dark chrome is for *controls that belong to the player*.

This instantly creates the hierarchy the current UI lacks: warm paper glows on
a dark table, and the eye goes to the world.

### 3.2 Tokens (single source: `src/ui/theme/tokens.css`)

- **Color:** `--ink-*` (chrome text ramp), `--paper-*` (document surfaces,
  today's values kept), `--accent-wax` (seal red, primary action),
  `--accent-gold` (highlights/selection), semantic ramps for
  good/bad/warn/info, and the *lens palettes* (§6.4) as named tokens.
- **Type:**
  - Display: **Cinzel** (kept — era ribbon, page titles, realm names).
  - Body/UI: a legible humanist face self-hosted as subset woff2 (candidates:
    *Alegreya Sans*, *Source Sans 3*; decide in P0 with a side-by-side).
    `IM Fell` survives only ≥ 14 px in documents (chronicle prose, quotes).
  - Data: same body face with `font-variant-numeric: tabular-nums` everywhere
    numbers align.
  - Scale: 11 / 12.5 / 14 (base) / 16 / 20 / 26. Nothing interactive below 11.
  - **Fonts ship in the bundle** (base64 in the singlefile build). The Google
    `@import` (`atlasUI.css:6`) is removed; offline builds get real fonts.
- **Space:** 4-px grid; radii 2 (chips) / 4 (cards) / 8 (floating surfaces).
- **Elevation/z:** one scale — `map(0) < map-badges(10) < docks(20) <
  drawers(30) < popovers(40) < toasts(50) < documents(60) < system-modals(70)`.
  All ten current hard-coded z-indexes migrate onto it.
- **Motion:** 120–200 ms ease-out for surfaces, 300 ms for documents; every
  animation honors `prefers-reduced-motion`.

### 3.3 Component kit (`src/ui/kit/`)

Built once, used everywhere; kills the 490 inline-style blobs.

`Surface` (chrome/paper variants) · `Btn` (primary/quiet/ghost/wax) · `IconBtn`
· `Tabs` · `SegmentedControl` · `Chip` (the entity link — swatch/emblem + name,
hover→preview, click→codex) · `StatRow` / `StatGrid` · `Meter` (centered ±
bars, replacing three hand-rolled implementations at `WorldSim.jsx:3164`,
`:3517`, `PsBar:690`) · `Sparkline` · `Table` (sortable, sticky header,
virtualized) · `Legend` (§6.3) · `Tooltip` (real component on a shared
singleton, replacing ~80 `title=` attributes) · `Drawer` · `Document`
(full-screen paper overlay with focus trap) · `Toast` · `EmptyState`
(explains *why* it's empty in world terms) · `SectionCard` (collapsible,
replacing `PsSection`).

---

## 4. Layout & information architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR   run · time · era ······················ alerts · world ≡  │  48px chrome
├───────┬──────────────────────────────────────────────────┬──────────┤
│ LENS  │                                                  │  CODEX   │
│ DOCK  │                 THE MAP                          │  DOCK    │
│ 56px  │            (fills everything)                    │  360px   │
│ icons │   floating: legend card (SW) · lens controls     │ collapsible│
│       │              toasts (NE) · hover card (cursor)   │          │
├───────┴──────────────────────────────────────────────────┴──────────┤
│ TIMELINE STRIP  charts ribbon · event ticks · era bands   (toggle)  │  84px, collapsible
└──────────────────────────────────────────────────────────────────────┘
```

- **Top bar** (48 px): left — play/pause + speed segmented control + sim-rate
  readout; center — era ribbon (Cinzel) + year + step (the one place time is
  displayed, still purely cosmetic); right — alert bell (event toasts land
  here), New World, Save, menu. The single-line ticker dies; §8's feed and
  toasts replace it.
- **Lens dock** (56 px icon rail): one icon per lens, tooltip + flyout with
  sub-lenses and that lens's overlay toggles (§6). Number keys preserved and
  *shown* in the flyout. Bottom of the rail: layers popover button, globe
  toggle, dev lenses (when `?dev`).
- **Codex dock** (360 px, collapsible to zero): the right panel reborn — §7.
- **Timeline strip** (bottom, toggleable, default on): §9.
- **Floating over the map:** the Legend card (SW, one component for all
  lenses), lens-specific controls (e.g. Prices good picker) docked *inside*
  the legend, hover card at cursor, toasts NE, camera controls SE
  (zoom / fit-world / follow-selection).

Wide-screen is primary; below ~1100 px the codex overlays the map instead of
docking beside it (the sim is not a phone product; graceful ≥ 1024 is the bar).

---

## 5. The map itself

The single highest-impact area. All work here is renderer-side polish over the
existing snapshot; zero sim changes.

### 5.1 Labels at last

- **Realm names** on the political/terrain lenses, LOD-tiered: top ~12 realms
  by claimed area at world zoom, more as you zoom in. Placement: largest
  inscribed region of the realm's tint mask (approximate pole-of-inaccessibility
  on the sim-res claim grid, cached per `claimVersion`), set in Cinzel
  small-caps with a paper-tone halo for contrast on any tint. Curved baseline
  where the region is long and thin (Egypt down the Nile) — straight otherwise.
  Fade in/out on zoom; never overlap (grid-based collision, greedy by realm
  size).
- **Settlement names** appear per-tier as zoom crosses thresholds (metropolis
  → city → region), small caps, offset from the icon, collision-culled.
- **Capital marking** stays (star), plus the realm label anchors to a shield
  at its start (§5.2).
- Labels draw into the existing `featRef` overlay canvas (`WorldSim.jsx:4236`)
  — it's already the crisp fixed-resolution layer, currently used only for
  icons.

### 5.2 Heraldry, surfaced everywhere

Give every polity its emblem, generated once on foundation (deterministic:
seeded by polity id + founding culture + faith + terrain, via the existing
`emblemGenome`/`emblemRender`), rendered to small offscreen sprites and cached.

- Shield at each realm's map label (zoom-gated size).
- Chip-sized emblem in every hover card, codex page, leaderboard row, feed
  entry, chronicle header.
- Banner-size on the realm codex page and full-screen documents.
- Emblems can *change* on emergent grounds only (new dynasty, state-faith
  conversion, reformation after a fall) and old arms stay in the chronicle —
  the log already records those moments.

This is the plan's delight centerpiece: the moment realms have names *and
arms*, the map reads as a world.

### 5.3 Selection & hover, unified

One selection model for **any entity**: `{kind: 'realm'|'settlement'|'culture'|
'faith'|'tongue', id}` in a single UI store (§13.2), driving map highlight +
codex page + chronicle follow together (no more split
`selectedSettlementId`/`realmSel` action-at-a-distance).

- **Click a settlement** → settlement selected (halo kept).
- **Click realm territory** (not on a settlement) → realm selected: territory
  brightens, borders thicken, everything else desaturates ~15%; label + shield
  glow. (Hit-test = read the claim grid the tint layer already renders from.)
- **Click water/unclaimed** → deselect. Esc = walk up (settlement → its realm
  → nothing).
- **Hover** (throttled as today): identity line (emblem + name + realm), 3–4
  vital stats for the *active lens* (politics: control/war state; economy:
  wealth/trade; peoples: culture mix bar…), plus terrain line. One component,
  data-driven per lens — replacing the single hard-coded pico card.
- **Follow mode:** button in the codex header pins camera to the selection
  (capital) as it moves through history.

### 5.4 Political map quality pass

- Border rendering: crisp 1-px inner-stroke at high zoom, simplified at world
  zoom (current single-pass looks ragged when zoomed).
- Tint quality: keep stable color assignment (`assignCountryColors`), add a
  colorblind-safe alternate palette toggle and an optional pattern layer for
  vassals/colonies (hatching already exists for colonies — systematize it in
  the legend).
- War fronts: animated dashed front-line on politics lens where `_fronts > 0`
  (data already in snapshot), with besieged capitals pulsing.

### 5.5 Globe

Short-term: keep as a view toggle but render the *current lens* texture (the
composed base+tint canvas is already a buffer — `globeBufScratchRef`), not
terrain-only. Long-term (post-P6): labels/billboards on the globe.

---

## 6. Lenses & overlays: one registry

### 6.1 The model

Today lens/sub-lens/overlay/legend/controls are five parallel ad-hoc
structures (`LENSES` at `WorldSim.jsx:262`, `layers` state at `:779`, seven
legend JSX blobs, per-lens `if`s in the draw loop). Replace with one
declarative registry:

```js
// src/ui/map/lensRegistry.js — data, not JSX
{
  id: "politics", icon: …, label: "Politics", hotkey: "2",
  subs: [{id:"country", label:"Realms"}, {id:"loyalty", label:"Loyalty"}],
  overlays: ["borders","provinces","warFronts","labels","emblems"], // defaults on
  legend: {…spec, built from tokens},          // §6.3
  controls: PricesGoodPicker | null,           // lens-specific widget
  available: (mirror) => true | {locked, why}, // §6.5 — emergent availability
}
```

The dock, flyouts, legend card, hover-card stats, and draw dispatch all read
this one table. Adding a lens becomes a registry entry + a draw function.

### 6.2 Lens set (reorganized, same underlying views)

1. **Terrain** (Map / Atlas)
2. **Politics** (Realms / Loyalty) — war fronts overlay lives here
3. **Peoples** (Cultures / Population / Ancestry) — ancestry folds in as a
   sub-lens (its own top-level entry with one sub was rail noise)
4. **Tongues** (Languages)
5. **Faiths**
6. **Economy** (Trade / Money / Prices / Labour / Resources / Cropland)
7. **Dev** (`?dev`: Depth/Wind/Moisture/Temp/Crossing) — unchanged content,
   now visually tagged as diagnostics.

Global overlays (rivers, lakes, streams, plates, roads, sea lanes, ships,
settlement tiers, shocks, money flow, labels, emblems) live in one Layers
popover, grouped, with per-lens defaults — e.g. Politics turns labels+borders
on by default; Terrain/Atlas defaults them off. The user's per-lens tweaks are
remembered (extending the existing `subMemRef` pattern) and persisted to
localStorage.

### 6.3 One Legend component

Every lens declares its legend as data: swatch ramps (loyalty, prices,
population), categorical keys (biomes, resource icons with era tags and
toggle-ability — the resources legend's toggle behavior is kept), pattern
samples (colony hatch, remembered-nation hatch), plus an optional one-paragraph
"how to read this" (the current legends' best feature — their explanatory
prose — is kept and edited, not deleted). Collapsible; remembers state;
docked SW.

### 6.4 Lens color discipline

Each thematic lens gets a named, documented ramp in tokens (sequential for
population/prices, diverging for loyalty, categorical-by-entity-hue for
politics/cultures/faiths/tongues). One pass with a color-vision simulator in
P2; where hue alone distinguishes (political tints), patterns/labels carry the
difference too.

### 6.5 Emergent availability (the "logical progression" the user asked for)

Lenses/panels *light up when their phenomenon exists* — pure state reads,
never step/year:

- **Money** lens: dimmed with tooltip "the world still barters — no coin has
  been minted" until the mirror reports minted money > 0.
- **Prices**: until the first market forms (`hasMarkets` flag).
- **Faiths**: fully available (folk faith exists from the start) but its codex
  explains folk vs organized until the first church organizes.
- **Labour**: until any coerced labour exists.
- **Tongues**: until the first divergence (before that, one tongue per cradle
  — say so).

Each lights up with a one-time toast ("The first coins are struck in …" —
which is *already an event in the log*; the toast is just the event surfaced,
§8). This turns the interface itself into a progression that mirrors the
world's development — state-gated, so it lands at the right moment on every
seed and pace, per the cardinal rule.

---

## 7. The Codex (right dock reborn)

One navigable browser of the world's nouns, replacing the six flat tabs.

### 7.1 Navigation model

- **Home**: the World page (overview: headline stats, top realms with
  emblems, live feed digest, biggest-movers sparklines).
- **Browse**: Realms · Settlements · Peoples · Faiths · Tongues (upgraded
  leaderboard tables: search box, sortable columns, virtualized full lists —
  no more top-15 truncation; emblem/swatch chips; the family-tree grouping of
  peoples/tongues kept).
- **Entity pages** with a shared shell: header (emblem/swatch, name, kind,
  parent links), stat band, tabbed sections, and a **related-entities strip**
  (its realm, its faith, its culture, its ruler — all Chips).
- **History stack**: back/forward buttons + breadcrumb (Codex ▸ Realms ▸
  Ashkar ▸ Qelet). Map clicks push onto the same stack. This is the single
  biggest usability fix in the panel: exploration becomes reversible.
- **Pinning**: pin up to ~4 entities as tabs along the dock top; pinned
  realms can open **Compare** (two-column stat/temperament/chronicle diff).

### 7.2 Realm page (per-section)

- Header: banner emblem, name, "N settlements · N souls · people · label".
- **Vitals**: control load/capacity as a Meter with over-extension warning,
  treasury + solvency, tax, army, wealth, war fronts — each with a sparkline
  (history per realm, §14) and a tooltip explaining the mechanic in world
  terms.
- **Temperament**: kept, restyled on `Meter`.
- **Court**: ruler card (portrait-less, trait chips), dynasty link → Dynasty
  document; succession risk surfaced (bare house = the crisis mechanic made
  visible *before* it fires).
- **Faith & peoples**: state faith chip + composition bars of member cultures
  /faiths (aggregate of member mixes — data already in snapshot).
- **Settlements**: full virtualized table (name, tier icon, pop, wealth,
  role), click-through.
- **Chronicle**: inline last-10 with the full Document one click away.
- **Diplomacy** (read-only): overlord/vassals/colonies from `_overlord` /
  `_depKind` links — today buried in prose inside Inspect.

### 7.3 Settlement page

The current Inspect content — genuinely deep — restructured into scannable
sections (Identity · Population & growth · Food (the excellent
supply/imports/status logic kept, shown as flows) · Economy (wealth, income
breakdown with the goods split, trade partners as chips with per-link flows)
· Knowledge (six tracks as meters + "next discoveries", tech-tree Document
link) · Resources (icon grid with richness) · Society (mixes as stacked
bars: people/speech/faith) · Chronicle of its realm). Every fact keeps its
explanatory tooltip; the 10-px inline-prose walls become structured rows.

### 7.4 People / Faith / Tongue pages

The family-nested browsers stay (they're good), each entry becoming a page:
distribution map-highlight button ("show on map" switches to the right lens
and highlights members), lineage tree (parent/daughters), holder realms, and
for faiths: see, schisms, conversion spread (all from existing event types).

---

## 8. Events: from ticker to nervous system

The structured log (`events.js` — typed, actor-indexed, placed) finally gets a
UI worthy of it.

- **Feed panel** (Codex home + expandable): every event as
  `[year] [icon] [prose]` with entity Chips inline; filter bar by category
  (war/politics/faith/culture/economy/disaster/discovery/dynasty — the
  existing `CHRON_COL` taxonomy, extended) and by "involving selection";
  click → camera jump + 2-s map pulse at the event's `x,y` (jump exists
  today; the pulse is new).
- **Severity tiers** derived from event data (e.g. polity end where members ≥
  N, schism of a faith with ≥ N followers, first-of-kind discoveries):
  - minor → feed only;
  - notable → feed + bell counter;
  - epochal → **toast** (NE, paper card, emblem, one line, click-to-jump,
    auto-dismiss; max 3 stacked, rest to the bell). First-of-kind moments
    (first writing, first coin, first metropolis, first ocean crossing —
    already logged as events) always toast, doubling as the §6.5 unlock
    notices.
- **Mute/verbosity** control on the bell (all / notable / epochal / silent).
- The top-bar single-line ticker is deleted.

---

## 9. Time: the timeline strip

A collapsible 84-px bottom strip — the recorded history made visible (display
only; the sim never rewinds, nothing here drives mechanics):

- Stacked mini-band charts from the history samples (population, realms,
  claimed %, cities…), with **era bands** shaded behind (derived era timeline
  `_eraAt` already exists) and epochal-event tick marks on top.
- Hover: vertical cursor with values readout + events near that step;
  click a tick → its event in the feed.
- The current seven-chart World-tab column moves into a **Charts document**
  (full-screen, big axes, series toggles, per-realm series where recorded,
  linear/log, export PNG/CSV — subsuming "Copy stats rundown" as CSV/MD
  export in its menu).

---

## 10. Full-screen documents (the deep-dive rung)

One `Document` component (paper, 60-z, focus-trapped, Esc-closes, printable
layout) hosting:

- **Chronicle** — kept conceptually (it's great), restyled: era-grouped
  sections with year margins, category icons, entity chips inline, filter
  chips, search; the **true record / scribes' version** toggle promoted to a
  prominent switch with a one-line explanation of *why* they differ (archive
  fires, horizons, court bias — the feature is a headline, not an easter egg).
  Add "jump to map" on placed entries.
- **Dynasty** — the family tree (already good) restyled to tokens; add reign
  timeline bar and succession-crisis annotations from events.
- **Tech tree** — restyled; each discovery shows its *emergent* unlock
  condition (knowledge thresholds, prerequisites) and which settlements have
  it; never "available at year X".
- **Charts** (§9).
- **World bible export** — the existing Export History JSON plus a readable
  in-app rendering (per-realm chronicle browser) — stretch, post-P6.

---

## 11. Flows

### 11.1 New World wizard

Three light steps replacing the dense dialog (`WorldSim.jsx:4540`):

1. **World**: visual cards — Earth (Sim) / Tectonic / Import — with
   thumbnail, one-sentence description; Earth: real-wind toggle with a plain
   explanation; Tectonic: preset picker + save/delete moved under Advanced;
   Import keeps Azgaar/heightmap with format hints and failure messages.
2. **Detail**: map resolution and sim granularity as radio cards with honest
   tradeoff copy (the existing tooltips, promoted to visible text) and a
   relative cost meter (no fake time estimates).
3. **Seed & begin**: seed field + roll + recent-seeds row; **live low-res
   preview** rendered by the existing worldgen worker at thumbnail scale on
   seed change (debounced) — the single most requested-feeling feature of
   world builders; generate proceeds behind a progress line (worker already
   reports stages).

### 11.2 Save / Load manager

- **Session manager document**: autosave to IndexedDB on an interval *and* on
  page-hide (serialize already exists; store the JSON + a map thumbnail +
  meta: name, seed, preset, step, era label, realms, population).
- Slot cards (thumb + meta) with load/duplicate/delete/export-to-file; import
  drag-and-drop; "resume last session" on boot (replacing silent cold start).
- File export/import stays (same format, versioned by `persist.js`).

### 11.3 Levers & tuning

- `SimLevers` restyled on the kit inside a standard Drawer: search, category
  jump list, changed-count badge with "review changes" diff view,
  reset-per-category; description text at legible size. Same schema-driven
  guts (`TUNING_SCHEMA` is already the right shape).
- Worldgen tuning panel (tectonic) gets the same treatment (P6, low priority).
- The country **Editor** panel becomes a proper tool drawer: same params,
  plus "drop N random rivals" convenience; visually marked as a sandbox tool
  (wax border) since it injects state.

### 11.4 First-run & help

- First boot: a 4-beat overlay on the live default world (not a tour of
  chrome): "This world is unscripted → lenses show its layers → click
  anything to read it → speed controls time." Dismiss forever; reachable
  from menu.
- **`?` shortcut overlay**: every key (space, digits, esc, arrows-pan, +/-
  zoom, F fit, G globe, L layers, T timeline) on one card.
- Glossary tooltips: every stat label everywhere gets the mechanic-in-world-
  terms hover (content largely exists as scattered `title=`/prose; it becomes
  a single `glossary.js` map).

---

## 12. Input & accessibility

- Keyboard: existing (space/digits/esc) + pan arrows, +/- zoom, F fit-world,
  G globe, L layers popover, T timeline, ? help; Esc unified on the overlay
  manager stack (§13.3).
- Focus: visible focus rings (tokens), focus trap + restore in Drawer/
  Document/modals, roving tab index in the lens dock.
- ARIA: tabs/menus/dialogs get roles/labels; toasts are polite live regions;
  the map canvas gets an SR summary line ("Politics lens: 34 realms, largest
  Ashkar, 12M souls") refreshed on lens/selection change.
- `prefers-reduced-motion`: disables pulses, toasts slide→fade, war-front
  animation becomes static dashes.
- Contrast: all chrome text ≥ 4.5:1; paper ink ≥ 7:1; lens ramps checked for
  CVD (§6.4).
- UI scale setting (90–125%) in the menu — pure CSS `font-size` root switch.

---

## 13. Technical architecture

### 13.1 File structure (the monolith dissolves)

```
src/ui/
  theme/tokens.css, fonts/                    (P0)
  kit/…                                       (P0, grows)
  shell/{TopBar,LensDock,CodexDock,TimelineStrip,OverlayHost}.jsx
  map/{MapView.jsx, draw/{base,tints,features,labels,emblems,fx}.js,
       lensRegistry.js, hitTest.js, camera.js}
  codex/{CodexRouter.jsx, pages/{World,Realm,Settlement,People,Faith,
         Tongue}.jsx, browsers/…, chips/…}
  documents/{Chronicle,Dynasty,TechTree,Charts,SaveManager}.jsx
  events/{FeedPanel,Toasts,severity.js,eventMeta.js}
  state/{uiStore.js, selectors.js, persistence.js}
  flows/{NewWorldWizard,Levers,Editor}.jsx
WorldSim.jsx → thin orchestrator (workers, snapshot plumbing, layout mount)
```

Rules: `src/sim/**` never imports `src/ui/**` (lint-enforced); draw modules
are plain functions over `(ctx, mirror, view)` — no React; extraction is
mechanical and behavior-preserving *before* redesign lands on each piece.

### 13.2 UI state

One store (React context + `useSyncExternalStore`, or Zustand if a dep is
acceptable — decide P0; no Redux): `{selection, navStack, pins, lens, subLens,
overlaysByLens, legendCollapsed, docOpen, feedFilters, toastQueue, settings}`.
Persisted slice (lens prefs, settings, pins) → localStorage. Snapshot mirror
stays a ref; panels subscribe via narrow memoized selectors on a
per-snapshot version counter instead of re-rendering the world on every tick.

### 13.3 Overlay manager

`OverlayHost` owns a stack; Esc pops the top; z comes from the scale (§3.2);
scrim + focus trap standardized. Chronicle/Dynasty/TechTree/wizard/menus all
mount through it. Ten ad-hoc surfaces become one code path.

### 13.4 Rendering & performance budget

- Keep: rAF loop, ref-driven hot path, base-layer caches, feature canvas.
- Add: label/emblem sprite caches invalidated by `claimVersion`/zoom-band;
  label placement recomputed at most 1/s and on lens/claim change.
- Panel updates: throttle codex refresh to ≤ 4 Hz at Max speed (numbers are
  unreadable faster anyway); snapshot→selector memoization.
- Budgets: 60 fps pan/zoom at 1920-map on a mid laptop; added main-thread
  work per frame from labels ≤ 1.5 ms; singlefile build growth ≤ +250 KB
  gz (fonts included); cold boot to interactive unchanged ±5%.
- Measure in CI-ish fashion: a `tools/` probe that runs the app headless in
  Playwright, pans/zooms, and reports frame times per phase.

### 13.5 Singlefile constraint

Everything (fonts, emblem sprites at runtime, wizard thumbnails as generated
canvases) must inline — no runtime fetches. Playwright is pre-installed for
verification; production build stays one HTML file.

---

## 14. Snapshot-protocol additions (read-only, additive)

The UI needs a few more read-only fields; all are recordings of existing
state, none alter mechanics. Each is additive to the worker snapshot and
save-format-neutral (derived, not persisted, except where noted):

1. **Per-realm history series** (sampled at the existing `HISTORY_INTERVAL`
   cadence, ring-buffered, top-K realms + selection): population, treasury,
   settlements, claimed tiles — powers realm sparklines and per-realm chart
   series.
2. **Emblem genome per polity** (persisted on the entity at foundation — it's
   identity, like the name; regenerating must be impossible once granted).
   Events already mark the emergent re-grant moments (§5.2).
3. **Feed events carry category + severity inputs** (members count at fall,
   follower count at schism…) — mostly present on the events already; the
   worker's `_feed` packer (`peopleSimWorker.js:356`) forwards them.
4. **Availability flags** for §6.5 (`hasCoin`, `hasMarkets`,
   `hasOrganizedFaith`, `hasCoercedLabour`, `tongueCount`) — one cheap
   aggregate object per snapshot.
5. **Claim grid already ships** for tints — hit-testing reuses it; no change.

Everything else in this plan runs on data the mirror already carries.

---

## 15. Phasing

Each phase lands green (`npm run lint`, `npm test`, `npm run validate`
untouched sim = unchanged results; Playwright smoke for UI flows from P1 on)
and leaves the app *fully usable* — no half-migrated purgatory. Order chosen
so visible value lands early and refactors precede redesigns of the same area.

- **P0 — Foundations (no visible redesign).** Tokens + self-hosted fonts;
  component kit core; overlay manager + z-scale; UI store with unified
  selection (behavior-identical); mechanical extraction of WorldSim into the
  §13.1 skeleton; inline styles → kit/classes as files move. *Accept:* pixel-
  near-identical app, monolith < 800 lines, no Google fonts request.
- **P1 — Shell.** New top bar, lens dock + flyouts + unified layers popover
  with per-lens defaults, codex dock shell with nav stack/breadcrumbs (old
  tab content transplanted), timeline strip v1 (bands + era shading), `?`
  help, keyboard set. *Accept:* every old capability reachable in ≤ as many
  clicks; nav back/forward works from map and panel alike.
- **P2 — The map speaks.** Realm labels + LOD, settlement labels, emblems
  (genome persistence + sprites + shields), unified selection incl.
  realm-click with highlight/desaturate, new hover card (per-lens vitals),
  unified Legend for *all* lenses, war-front overlay, CVD palette toggle.
  *Accept:* name any empire at a glance; select any realm from the map;
  every lens has a legend.
- **P3 — Codex depth.** Entity pages (realm/settlement first, then people/
  faith/tongue), chips everywhere, browsers → virtualized searchable tables,
  pins + compare, related-entity strips, glossary tooltip system.
  *Accept:* any noun on screen is clickable; realm page answers "who are
  they, how do they stand, what happened to them" in one screen.
- **P4 — Events & time.** Feed with filters, severity + toasts + bell,
  event→map pulse, emergent availability lighting (§6.5) with first-of-kind
  toasts, timeline event ticks + hover readout, Charts document (subsumes
  stats copy). *Accept:* an empire can fall while you watch elsewhere and
  you find out within 2 s, with a one-click jump to the ruins.
- **P5 — Flows.** New World wizard with live preview, Save manager +
  autosave/resume, Levers drawer redesign, Editor drawer, chronicle/dynasty/
  tech-tree Document restyles (chronicle filters/search/era grouping).
  *Accept:* cold boot → resume; a new user builds a chosen world without
  reading docs.
- **P6 — Polish.** A11y audit (focus/ARIA/contrast/reduced-motion), UI scale
  setting, globe lens texture, responsive ≥ 1024, perf audit vs budgets,
  first-run overlay, visual QA sweep across all lenses × zooms × themes of
  world (Earth/tectonic/import).

Rough effort weight: P0 ≈ P2 ≈ P3 > P1 ≈ P4 ≈ P5 > P6. P0–P2 are the
minimum coherent "overhaul shipped" bar; P3–P6 are where "deep info" and
"logical progressions" fully land.

---

## 16. Risks & mitigations

- **The monolith extraction regresses subtle canvas behavior** (projection
  math, cache keys, the remount-eats-clicks bug fixed at `WorldSim.jsx:4464`).
  → P0 is *mechanical only*, with before/after screenshot diffs per lens and
  the layer-toggle click test scripted in Playwright.
- **Label placement cost on big worlds.** → compute on the sim-res grid (¼
  resolution), cache by claim version, budget-capped greedy placement;
  feature-flag to plain centroid labels if needed.
- **Emblem persistence touches save format.** → versioned via `persist.js`'s
  existing migration path; absent genomes regenerate deterministically from
  the founding event's recorded seed inputs on load (id+culture+faith), so
  old saves stay loadable and stable.
- **Toast fatigue.** → severity thresholds tuned on validate-length runs;
  verbosity control defaulting to "epochal only" at Max speed.
- **Scope creep toward sim features** (diplomacy actions, rewind). → this
  plan is strictly read-only over the sim; anything interactive beyond the
  existing editor/levers is out of scope (§17).
- **Singlefile bloat.** → font subsetting, emblem sprites generated at
  runtime (no shipped images), budget in §13.4 checked per phase.

## 17. Non-goals

- No new simulation mechanics, no player "actions" beyond the existing
  sandbox editor and levers.
- No time-rewind of world state (the timeline scrubs *records*, not the sim).
- No mobile layout below 1024 px this cycle.
- No multiplayer/URL-sharing features.
- No theme marketplace — one theme, two surfaces, done well.

---

## 18. First implementation steps (when work begins)

1. P0 kickoff: `tokens.css` + font subsetting into the repo, kit primitives
   (`Surface/Btn/Tabs/Chip/StatRow/Tooltip`), `OverlayHost`, UI store with the
   unified selection shape mirroring current behavior.
2. Mechanical extraction order (lowest-risk first): legends → documents
   (Chronicle/Dynasty/TechTree) → codex tab renderers → top bar/rail → draw
   modules last (biggest, most entangled).
3. Then P1 per §15.

*Verification at every step:* `npm run lint`, `npm test`, `npm run validate`
(sim untouched ⇒ identical stylized-facts scores), Playwright UI smoke
(launch, switch every lens, toggle every layer, open every document, select
via map and via codex), screenshot grid per lens for eyeball diffing.
