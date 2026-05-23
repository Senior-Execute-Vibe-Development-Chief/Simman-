// ── Tribe model: consolidated view objects + registries ──
//
// The legacy code stored tribe state as parallel arrays on the
// `territory` object: ter.tribeSizes, ter.tribeBudget, ter.tribeKnowledge,
// etc. — every read had to know which array held which field, and adding
// a new per-tribe field meant a new top-level array.
//
// This module replaces that pattern with a `ter.tribes[]` array of view
// objects. Each view exposes getters/setters that proxy the legacy
// parallel arrays, so existing code keeps working while new code reads
// `ter.tribes[i].size`, `ter.tribes[i].budget`, etc.
//
// Why proxy via getters instead of duplicating into plain fields?
//   - the parallel arrays are still touched by many call sites; keeping
//     them canonical avoids sync bugs during the migration.
//   - new fields (relations, religion, language, culture, leader) live
//     directly on the view as plain data — there's no parallel array
//     because nothing in legacy code touches them.
//
// Once migration is complete, the parallel arrays become an implementation
// detail of this module (or get retired entirely).

// ── Per-step contract (the order every tick MUST run in) ──
//
//   1. EXPANSION    — only path that mutates owner[]. Uses canonical
//                     writers (claimTile/transferTile/abandonTile).
//                     Invariant after: tribe.size/strength/centers match
//                     the owner[] map.
//   2. POPULATION   — given final owner[], recompute bgPop/cityPop using
//                     carrying capacity from knowledge × biome × resources
//                     × transport. Famine shrinks BOTH bgPop and cityPop.
//                     Invariant: tribe.pop == Σ(bgPop+cityPop) over owned.
//   3. SETTLEMENTS  — promotion / decay process (not bucket reclassify).
//                     Centers persist across ticks; promotion is gated by
//                     sustained population over time.
//   4. TRADE        — each (i,j) pair processed exactly once. Atomic
//                     writes to both sides. No double-counting.
//   5. BUDGET       — tribe.budget adjusts from personality + pressures
//                     (famine, war, wealth, surplus).
//   6. KNOWLEDGE    — gain from pop + settlements + trade contact. Allows
//                     diffusion from neighbours. Allows decay if pop
//                     collapses (dark ages).
//   7. DIPLOMACY    — opinion deltas, war declarations, conquest events.
//                     Wars are discrete events with treaties, not just
//                     tile-by-tile erosion.
//   8. CULTURAL     — (future hook) religion / language / culture drift,
//                     schisms, conversions, per-tile assimilation.
//   9. CLEANUP      — alive→false when size==0. Registry holders pruned.
//                     Relations dropped from other tribes' maps.
//                     Slots kept for history.

// ── Units (declared once, enforced) ──
//   pop      — absolute count of people. NOT popK, NOT a surrogate.
//   food     — absolute units per tick. Symmetric demand/supply funcs.
//   wealth   — absolute "gold". Decay is per-YEAR (multiply by
//              yearsPerStep at usage site).
//   power    — derived from pop × military_tech × wealth_factor.
//              Single source: tribePower(tribe).
//   step     — a tick. Variable in years — go through yearsPerStep().

// ────────────────────────────────────────────────────────────────────
// View factory
// ────────────────────────────────────────────────────────────────────

// Each view is one tribe. Getters proxy the canonical parallel arrays
// on `ter`; new per-tribe fields are plain data attached to the view.
export function makeTribeView(ter, id) {
  const view = {
    id,
    birthStep: ter.stepCount || 0,
    parent: null,         // id of the tribe this one split off from
    lineage: id,          // root ancestor id (== id for non-split tribes)

    // ── Diplomacy: opinion-tracking relations (new structure) ──
    // { otherId: { rel: "fight"|"trade"|"friendly"|"neutral",
    //              opinion: -100..100, lastChange: step, history: [...] } }
    relations: {},

    // ── Cultural identity slots (future layers) ──
    // Hard one-religion-per-tribe model: a single id (or null) here.
    // Per-tile cultural memory lives in ter.tileCulture/Religion/Language.
    religion: null,
    language: null,
    culture: null,
    leader: null,         // reserved; characters layer not planned
  };

  // Define proxy properties for legacy parallel arrays
  Object.defineProperties(view, {
    size:        { get: () => ter.tribeSizes[id],        set: v => { ter.tribeSizes[id] = v; } },
    strength:    { get: () => ter.tribeStrength[id],     set: v => { ter.tribeStrength[id] = v; } },
    pop:         { get: () => ter.tribePopulation?.[id] || 0,
                   set: v => { if (ter.tribePopulation) ter.tribePopulation[id] = v; } },
    centers:     { get: () => ter.tribeCenters[id],      set: v => { ter.tribeCenters[id] = v; } },
    knowledge:   { get: () => ter.tribeKnowledge?.[id],  set: v => { if (ter.tribeKnowledge) ter.tribeKnowledge[id] = v; } },
    budget:      { get: () => ter.tribeBudget?.[id],     set: v => { if (ter.tribeBudget) ter.tribeBudget[id] = v; } },
    ports:       { get: () => ter.tribePorts?.[id] || [],
                   set: v => { if (ter.tribePorts) ter.tribePorts[id] = v; } },
    knownCoasts: { get: () => ter.tribeKnownCoasts?.[id] || [],
                   set: v => { if (ter.tribeKnownCoasts) ter.tribeKnownCoasts[id] = v; } },
    trade:       { get: () => ter.tradeData?.[id],       set: v => { if (ter.tradeData) ter.tradeData[id] = v; } },
    settleCounts:{ get: () => ter._settleCounts?.[id] || { villages: 0, towns: 0, cities: 0, large: 0 } },
    alive:       { get: () => (ter.tribeSizes[id] || 0) > 0 },
    personality: { get: () => ter.tribeBudget?.[id]?.personality || "" },
  });

  return view;
}

// Sync ter.tribes[] to have one view per tribe id present in the
// canonical arrays. Call this after createTerritory and after any
// newTribe() so callers can iterate `for (const t of ter.tribes)`.
export function ensureTribeViews(ter) {
  if (!ter.tribes) ter.tribes = [];
  const n = ter.tribeSizes ? ter.tribeSizes.length : 0;
  while (ter.tribes.length < n) {
    ter.tribes.push(makeTribeView(ter, ter.tribes.length));
  }
}

// ────────────────────────────────────────────────────────────────────
// Registries — things that outlive any single tribe
// ────────────────────────────────────────────────────────────────────
//
// holders are NOT stored as a Set on the entry — they're derived from
// the per-tile arrays (ter.tileReligion[t] === religion.id, etc.) so
// there's a single source of truth. A helper `holderCount(reg, ter)`
// can scan when needed.

export function makeReligionRegistry() {
  return {
    list: [],
    next: 0,
    // future: indices, lookup helpers
  };
}

export function makeLanguageRegistry() {
  return {
    list: [],
    next: 0,
  };
}

export function makeCultureRegistry() {
  return {
    list: [],
    next: 0,
  };
}

// Constructor for a new religion entry. Doctrine is the 7-aspect vector
// from the spec (all in [0,1]).
export function makeReligion({ id, name, founderTribe, founderStep, parent = null, doctrine }) {
  return {
    id, name, founderTribe, founderStep,
    parent,
    doctrine: doctrine || {
      violence: 0.4, acceptance: 0.5, hierarchy: 0.5,
      materialism: 0.5, universalism: 0.4, mysticism: 0.5,
      reformism: 0.3,
    },
    holySites: [],
    events: [{ step: founderStep, type: "founded", by: founderTribe }],
    extinct: false,
  };
}

export function makeLanguage({ id, name, family, founderTribe, founderStep, parent = null, phonology = null }) {
  return {
    id, name, family,
    parent, founderTribe, founderStep,
    phonology: phonology || { inventory: [], shifts: [] },
    lexicon: { words: {}, loanwords: {} },
    generation: 0,
    events: [{ step: founderStep, type: "split", from: parent }],
    extinct: false,
  };
}

export function makeCulture({ id, name, parent = null, founderTribe, founderStep, customs = null }) {
  return {
    id, name,
    parent, founderTribe, founderStep,
    customs: customs || {
      governance: 0.5, art: 0.5, marriage: 0.5,
      hospitality: 0.5, militarism: 0.5, food: 0.5,
    },
    affinities: {},
    events: [{ step: founderStep, type: "founded", by: founderTribe }],
    extinct: false,
  };
}

// Attach all registries to a fresh territory.
export function attachRegistries(ter) {
  if (!ter.religions) ter.religions = makeReligionRegistry();
  if (!ter.languages) ter.languages = makeLanguageRegistry();
  if (!ter.cultures)  ter.cultures  = makeCultureRegistry();
}
