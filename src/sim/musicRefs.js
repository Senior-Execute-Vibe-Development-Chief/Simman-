// ── Reference endowments ─────────────────────────────────────────────────
//
// The Language Lab pins three real tongues so the generator can be checked
// against something known (languageRefs.js). Music needs the same check, but
// pinning it the same way would break the second cardinal rule: writing down
// "this tradition uses a five-note non-octave scale" is fitting the outcome,
// and would prove nothing about the mechanism.
//
// So these pin the INPUTS instead — the conditions a tradition actually had.
// A delta people who cast bronze, keep fixed sets of tuned slabs, write, and
// have a court to pay for a large ensemble. A steppe people with herds, horn
// and hide, no metals worth casting, and no surplus for more than two or
// three players. What comes out is then genuinely derived, and if the
// mechanism is right the bronze-casters land somewhere alien from the
// harmonic-instrument peoples all on their own.
//
// Each entry is scenario data of exactly the kind the repo already sanctions
// (pinned inventories, the Earth hearth set): the world is fixed, the
// mechanism still runs.
export const REFERENCE_PEOPLES = {
  bronzeDelta: {
    label: "Bronze-casting delta",
    people: {
      biome: "delta", dev: 0.8,
      have: { copper: true, tin: true, bronze: true, clay: true, reed: true, timber: true, hide: true, gut: true, bamboo: true, silk: true, iron: false, stone: false },
      know: { metallurgy: 0.92, construction: 0.7, organization: 0.78, agriculture: 0.85, mobility: 0.4, navigation: 0.6 },
      soc: { surplus: 0.85, urban: 0.75, strat: 0.8, literacy: 0.7 },
      creed: { militancy: -0.2, exclusivity: 0.1, asceticism: -0.4 },
    },
    // an isolating, tone-bearing tongue: syllable-timed music follows
    langPin: { tone: 2, morph: "iso", sylC: 1 },
  },
  steppeHerd: {
    label: "Steppe herders",
    people: {
      biome: "steppe", dev: 0.32,
      have: { hide: true, horn: true, gut: true, timber: false, clay: true, stone: false, copper: false, tin: false, iron: false, bronze: false },
      know: { metallurgy: 0.12, construction: 0.2, organization: 0.3, agriculture: 0.2, mobility: 0.9, navigation: 0.1 },
      soc: { surplus: 0.22, urban: 0.1, strat: 0.25, literacy: 0.05 },
      creed: { militancy: 0.7, exclusivity: 0.2, asceticism: 0.3 },
    },
  },
  courtStrings: {
    label: "Literate river court",
    people: {
      biome: "temperate", dev: 0.86,
      have: { timber: true, silk: true, gut: true, hide: true, horn: true, clay: true, stone: true, copper: true, tin: true, bronze: true, iron: true },
      know: { metallurgy: 0.7, construction: 0.85, organization: 0.9, agriculture: 0.8, mobility: 0.5, navigation: 0.5 },
      soc: { surplus: 0.8, urban: 0.8, strat: 0.85, literacy: 0.9 },
      creed: { militancy: -0.1, exclusivity: -0.2, asceticism: -0.5 },
    },
  },
  forestPipes: {
    label: "Forest pipe-makers",
    people: {
      biome: "tropical", dev: 0.3,
      have: { bamboo: true, gourd: true, timber: true, hide: true, clay: true, reed: true, copper: false, tin: false, iron: false, bronze: false, stone: false },
      know: { metallurgy: 0.05, construction: 0.3, organization: 0.28, agriculture: 0.45, mobility: 0.3, navigation: 0.3 },
      soc: { surplus: 0.4, urban: 0.15, strat: 0.2, literacy: 0.05 },
      creed: { militancy: -0.3, exclusivity: -0.3, asceticism: 0.2 },
    },
  },
  highlandStone: {
    label: "Highland stone-cutters",
    people: {
      biome: "highland", dev: 0.55,
      have: { stone: true, timber: true, hide: true, horn: true, gut: true, clay: true, copper: true, tin: false, iron: true, bronze: false },
      know: { metallurgy: 0.45, construction: 0.72, organization: 0.5, agriculture: 0.4, mobility: 0.55, navigation: 0.1 },
      soc: { surplus: 0.45, urban: 0.3, strat: 0.45, literacy: 0.25 },
      creed: { militancy: 0.3, exclusivity: 0.5, asceticism: 0.6 },
    },
  },
  ironFrontier: {
    label: "Iron-working frontier",
    people: {
      biome: "savanna", dev: 0.48,
      have: { iron: true, timber: true, hide: true, horn: true, gourd: true, gut: true, clay: true, copper: false, tin: false, bronze: false, stone: false },
      know: { metallurgy: 0.68, construction: 0.4, organization: 0.42, agriculture: 0.5, mobility: 0.5, navigation: 0.2 },
      soc: { surplus: 0.5, urban: 0.32, strat: 0.4, literacy: 0.1 },
      creed: { militancy: 0.4, exclusivity: 0, asceticism: -0.1 },
    },
  },
  gamelanCourt: {
    label: "Bronze gamelan court",
    people: {
      biome: "tropical", dev: 0.82,
      have: { copper: true, tin: true, bronze: true, bamboo: true, timber: true, hide: true, clay: true, reed: true, silk: true, iron: false, stone: false },
      know: { metallurgy: 0.95, construction: 0.82, organization: 0.88, agriculture: 0.75, mobility: 0.35, navigation: 0.5 },
      soc: { surplus: 0.92, urban: 0.78, strat: 0.88, literacy: 0.55 },
      creed: { militancy: -0.3, exclusivity: 0.2, asceticism: -0.5 },
    },
    langPin: { tone: 1, morph: "iso", sylC: 1 },
  },
  maqamCaravan: {
    label: "Desert caravan court",
    people: {
      biome: "medit", dev: 0.72,
      have: { timber: true, hide: true, gut: true, clay: true, stone: true, copper: true, reed: true, horn: true, iron: true, tin: false, bronze: false },
      know: { metallurgy: 0.55, construction: 0.65, organization: 0.72, agriculture: 0.55, mobility: 0.75, navigation: 0.55 },
      soc: { surplus: 0.62, urban: 0.55, strat: 0.65, literacy: 0.35 },
      creed: { militancy: 0.2, exclusivity: 0.4, asceticism: 0.1 },
    },
  },
  steelBand: {
    label: "Industrial steel workshop",
    people: {
      biome: "delta", dev: 0.78,
      have: { iron: true, timber: true, hide: true, gourd: true, clay: true, copper: false, tin: false, bronze: false, stone: false },
      know: { metallurgy: 0.88, construction: 0.7, organization: 0.65, agriculture: 0.55, mobility: 0.55, navigation: 0.45 },
      soc: { surplus: 0.68, urban: 0.62, strat: 0.55, literacy: 0.55 },
      creed: { militancy: -0.1, exclusivity: -0.2, asceticism: -0.3 },
    },
  },
};
