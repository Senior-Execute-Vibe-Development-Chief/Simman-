# Simman — working notes for future generations

This is a procedural world generator and **emergent** civilization simulator.
Nothing is scripted; every empire on the map is the output of local rules. Read
`README.md` for architecture, and `docs/` for design plans. Run `npm test`
(smoke: determinism, invariants, save/load) and `npm run validate` (stylized
facts: is the emergent history history-SHAPED?) before pushing.

---

## THE CARDINAL RULE — everything must be emergent

> **Never, ever gate a specific event, capability, transition, or behavior on a
> point in time — not ticks, not the calendar year, not a fixed "era" boundary.
> EVERYTHING has to emerge from the world's underlying STATE.**

A thing happens because of **what the world has become** (development, technology,
population, local conditions, accumulated history) — *never* because of **when it
is** (step N, year Y, era E). If you ever find yourself writing "after step X" or
"once it's the modern era" or "by year 1500", stop: that is a bug in waiting.

### Why this is absolute (learned the hard way)

- **It's the entire premise.** "Nothing is scripted." A time-gate *is* a script.
  It hard-codes a story instead of letting one emerge, and it produces
  anachronisms (a thing firing in a world that isn't ready for it).
- **The calendar decouples from development — the "two-clock" trap.** The displayed
  year advances on a fixed linear clock; the world's actual development advances at
  its own emergent pace. They drift apart by thousands of years. *Anything* keyed on
  the year then fires at the wrong development level. Real bugs this caused here:
  the demographic anchor inflating population toward billions because the linear
  clock had passed "1950" while the economy was still medieval; "frontier closes
  with the modern era" firing by calendar while tech was bronze.
- **Emergent gating self-calibrates.** Gate on tech/development/conditions and the
  behavior fires exactly when the world is ready for it — on any map, any seed, any
  pace, forever. No re-tuning when the clock or the map changes.

### Right vs wrong

```
WRONG:  if (world.step > 12000) openFrontier()
WRONG:  if (stepToYear(world.step) > 1500) allowGunpowder()
WRONG:  if (era === "modern") x()              // where "era" is a span of time
WRONG:  const target = realWorldPopSim(stepToYear(world.step))   // anchor on the clock

RIGHT:  if (capital.knowledge.logistics > 0.6) extendReach()
RIGHT:  if (settlement.people > THRESHOLD) urbanise()
RIGHT:  reach = base + logisticsLevel * SCALE    // ramps with emergent tech
RIGHT:  pressure ∝ unrest, fiscal balance, identity grievance   // emergent conditions
```

### Corollaries

- **The calendar/year is cosmetic** — a read-only label for the player, *never* an
  input to a mechanic. The same goes for the displayed "era": it must be *derived*
  from emergent development (e.g. the leading civilization's knowledge), and only
  ever *read*, never used to *drive* anything.
- **Per-tick intervals are fine** — `step % INTERVAL === 0` to amortize a pass over
  ticks is a performance cadence, not a content gate. The distinction: it controls
  *how often code runs*, never *whether a piece of history is allowed to happen yet*.
- When in doubt, ask: **"Does this fire because of WHEN it is, or because of WHAT
  the world has become?"** Only the latter is allowed.
