// ── Runtime gameplay tuning ──────────────────────────────────────────
//
// A single live registry of the gameplay "levers" exposed in the in-game
// Tuning menu. Every sim module imports { T } from here and reads T.KEY at
// USE TIME (inside its passes), so dragging a slider mutates T and the next
// pass picks it up — no restart. Defaults below reproduce the hand-tuned
// behaviour exactly, so an untouched world is byte-identical to before.
//
// To add a lever: add one entry to TUNING_SCHEMA (key/label/desc/min/max/
// step/def), then read T.KEY where the old const used to live. That's it.
//
// NOTE: a few keys are NEW multipliers (default 1.0) layered on existing
// formulas — they didn't exist as constants before (ARMY_SIZE_MULT, the
// *_COST_MULT movement dials) — so the sim can be steered without rewriting
// the underlying tech-discount maths.

export const TUNING_SCHEMA = [
  {
    category: "Pacing",
    blurb: "How often the heavy systems tick. Lower = the system acts more often (snappier, more CPU).",
    params: [
      { key: "CONQUEST_INTERVAL", label: "War pass interval", def: 50, min: 10, max: 200, step: 5,
        desc: "Ticks between war-front advances. Lower = fronts move faster and more smoothly." },
      { key: "POLITY_INTERVAL", label: "Politics pass interval", def: 150, min: 30, max: 400, step: 10,
        desc: "Ticks between polity passes (tax, loyalty, secession, control budget). The empire-politics clock." },
      { key: "TERRITORY_INTERVAL", label: "Territory recompute interval", def: 144, min: 24, max: 400, step: 12,
        desc: "Ticks between full territory (Voronoi) recomputes. Lower = borders track changes more closely." },
    ],
  },
  {
    category: "Empire size & cohesion",
    blurb: "How large an empire one capital can hold together before the frontier rebels. Max empire size is dynamic, not a fixed radius.",
    params: [
      { key: "CAP_BASE", label: "Capital base reach", def: 4.5, min: 1, max: 30, step: 0.5,
        desc: "Reach-units a lone capital can administer. THE master dial for empire size — up = bigger empires hold." },
      { key: "ABSORB_ORG_MIN", label: "Absorption tech gate", def: 0.48, min: 0.1, max: 0.95, step: 0.02,
        desc: "Organization tech a city needs before it can peacefully vacuum neighbouring village/town statelets into its realm. UP = small city-states survive far longer; the map stays fragmented through the early/classical era." },
      { key: "ABSORB_PROB_MAX", label: "Absorption max rate", def: 0.06, min: 0.01, max: 0.3, step: 0.01,
        desc: "Cap on a bordering statelet's per-pass chance of defecting into a strong neighbour. Down = slower, more gradual erosion of small states (less snowballing)." },
      { key: "ABSORB_RATE", label: "Absorption pressure", def: 0.025, min: 0.005, max: 0.1, step: 0.005,
        desc: "How sharply a power imbalance translates into defection pressure. Down = even much-stronger neighbours absorb their small rivals only slowly." },
      { key: "CAP_POP", label: "Big-capital bonus", def: 2, min: 0, max: 8, step: 0.25,
        desc: "Extra control capacity a large capital projects (scales with its population). Down = a giant metropolis can't administer a giant empire, so conquests over-extend and shed." },
      { key: "CAP_SEAT", label: "Regional seat capacity", def: 1.2, min: 0, max: 4, step: 0.1,
        desc: "Extra control each loyal regional city adds (sub-administration). Up = sprawling federations stay glued." },
      { key: "MOMENTUM_CAP", label: "Conquest snowball cap", def: 8, min: 0, max: 30, step: 1,
        desc: "Max bonus capacity a winning war-streak grants (lets a conqueror temporarily over-hold). Down = freshly conquered empires fragment sooner once the conquering pauses — more rise-and-fall." },
      { key: "SIZE_LOAD", label: "Big-province burden", def: 0.4, min: 0, max: 1.5, step: 0.05,
        desc: "How much harder a populous province is to govern. Down = easy to swallow large cities whole." },
      { key: "ORG_REACH", label: "Reach per organization tech", def: 40, min: 5, max: 120, step: 5,
        desc: "Tiles of land-claim & admin reach gained per point of organization knowledge. Scales empire size with the era." },
      { key: "LOYAL_DECAY", label: "Disloyalty speed", def: 0.14, min: 0.01, max: 0.5, step: 0.01,
        desc: "How fast an over-extended (uncovered) province bleeds loyalty toward revolt. Up = fragile frontiers, empires shed land and rise/fall faster." },
      { key: "RECENCY_TICKS", label: "Conquest digestion time", def: 4000, min: 500, max: 12000, step: 250,
        desc: "How long a freshly-conquered province stays extra-costly to hold. Up = blitz conquest destabilises longer." },
    ],
  },
  {
    category: "Military & conquest",
    blurb: "Aggression, war speed, sieges, and how stable the political map is.",
    params: [
      { key: "ATTACK_MIN_RATIO", label: "Attack threshold", def: 1.176, min: 1.0, max: 3.0, step: 0.02,
        desc: "Power advantage needed to push a front. Up = wars stalemate; down = relentless aggression." },
      { key: "MAX_CAPTURE", label: "Max tiles per pass", def: 24, min: 1, max: 120, step: 1,
        desc: "Hard cap on tiles a front grabs per war pass. The raw conquest-speed knob." },
      { key: "CITY_STORM_RATIO", label: "City siege threshold", def: 1.6, min: 1.0, max: 4.0, step: 0.1,
        desc: "Power ratio needed to besiege a city core. Up = cities hold out far longer." },
      { key: "ATTRITION", label: "War attrition", def: 0.035, min: 0, max: 0.2, step: 0.005,
        desc: "Army drained per warring front per pass. Up = offensives burn out fast (short, indecisive wars)." },
      { key: "ARMY_SIZE_MULT", label: "Army size multiplier", def: 1.0, min: 0.25, max: 4.0, step: 0.05,
        desc: "Global scale on every garrison's population cap. Up = bigger armies everywhere (more decisive war)." },
      { key: "ARMY_GROW", label: "Recruitment speed", def: 0.05, min: 0.01, max: 0.4, step: 0.01,
        desc: "How fast a fed garrison grows toward its cap each muster. Up = realms re-arm quickly after a war." },
      { key: "CONQUEST_GRACE", label: "City pacification", def: 800, min: 0, max: 4000, step: 100,
        desc: "Ticks a stormed city is locked (can't be re-stormed or secede). The single biggest political-map stabiliser." },
      { key: "TILE_CAPTURE_GRACE", label: "Tile hold time", def: 400, min: 0, max: 2000, step: 50,
        desc: "Ticks a captured countryside tile is held before it can flip back. Up = less border flicker, stickier fronts." },
      { key: "HOME_MILITIA_FRAC", label: "Home militia defence", def: 0.035, min: 0, max: 0.15, step: 0.005,
        desc: "Fraction of a city's people who defend their own walls even when the paid garrison has deserted (bankruptcy), scaled by the city's morale. The brake on the boiling map: 0 = a bankrupt city is free to storm (over-extension → insolvency → defenceless cities → the whole map churns). UP = cities are hard nuts once solvency fails, so empires fragment less and consolidate slower." },
    ],
  },
  {
    category: "Movement & water crossing",
    blurb: "Per-tile travel cost by terrain. These gate reach, march speed, trade range and where fronts snap. Apply at the next transport refresh (~480 ticks).",
    params: [
      { key: "WATER_COST_MULT", label: "Open-water cost", def: 1.0, min: 0.2, max: 4.0, step: 0.1,
        desc: "Multiplier on open-ocean crossing cost. DOWN = faster water crossing / easier overseas reach (your 'water crossing speed')." },
      { key: "LAND_COST_MULT", label: "Land travel cost", def: 1.0, min: 0.3, max: 3.0, step: 0.1,
        desc: "Multiplier on all overland movement cost. Down = faster armies, wider trade and reach." },
      { key: "MOUNTAIN_COST_MULT", label: "Mountain/slope cost", def: 1.0, min: 0.2, max: 4.0, step: 0.1,
        desc: "Multiplier on the mountain + steep-slope penalty. Up = ranges become hard walls fronts snap to." },
      { key: "NAV_EMBARK_THRESH", label: "Seafaring tech gate", def: 0.10, min: 0.0, max: 0.5, step: 0.01,
        desc: "Navigation knowledge below which water is impassable. Down = civilizations take to the sea earlier." },
      { key: "SHIP_SPEED", label: "Ship speed", def: 0.7, min: 0.2, max: 2.5, step: 0.1,
        desc: "Base path-tiles a colony/relief ship sails per tick (×(1+navigation)). Up = faster fleets." },
    ],
  },
  {
    category: "Sea & colonisation",
    blurb: "How far navies project and how readily empires settle across water.",
    params: [
      { key: "SEA_RANGE_NAV", label: "Naval reach per nav tech", def: 160, min: 20, max: 400, step: 10,
        desc: "Extra sea-lane reach per point of navigation. Up = blue-water empires linking distant ports." },
      { key: "SEA_MIN_POP", label: "Min port population", def: 40, min: 10, max: 400, step: 10,
        desc: "Population a port needs before it projects sea lanes. Down = even hamlets fish & trade by sea." },
      { key: "COLONY_MIN_POP", label: "Min colonising city size", def: 400, min: 100, max: 2000, step: 50,
        desc: "People a city needs before it launches an overseas colony expedition. Down = eager colonisation." },
    ],
  },
  {
    category: "Settlements & demographics",
    blurb: "Population growth, food, density and the resource economy of a town.",
    params: [
      { key: "SETT_GROWTH", label: "Population growth rate", def: 0.0018, min: 0.0002, max: 0.01, step: 0.0002,
        desc: "Base per-tick population growth. The master demographics-speed dial — up = the world fills fast." },
      { key: "FARM_YIELD_PER_FERT", label: "Farm yield", def: 0.02, min: 0.005, max: 0.08, step: 0.005,
        desc: "Food produced per unit of land fertility → carrying capacity. Up = denser, larger inland cities." },
      { key: "HINTERLAND_MULT", label: "Farmland hinterland", def: 1.0, min: 0.3, max: 2.5, step: 0.1,
        desc: "Scales the guaranteed farmland belt every settlement holds beyond its core. Up = each town owns more countryside (and carries more land when it secedes); down = territory hugs the cores." },
      { key: "FISH_RATE", label: "Coastal fishing yield", def: 11.0, min: 0, max: 40, step: 1,
        desc: "Food a water-adjacent settlement lands. Up = thriving maritime cities; 0 = no fishing economy." },
      { key: "DENSITY_PER_CONSTR", label: "Urban density per construction", def: 5, min: 0, max: 20, step: 1,
        desc: "Extra residents per buildable tile per point of construction tech. Up = sky-high megacities late game." },
      { key: "MINING_RATE", label: "Specie mining rate", def: 5.0, min: 0, max: 20, step: 0.5,
        desc: "Precious-metal extraction multiplier → hard-currency wealth. Up = gold-rush economies." },
      { key: "SACK_PRODUCTION_FLOOR", label: "Sacked-city output floor", def: 0.3, min: 0, max: 1.0, step: 0.05,
        desc: "Fraction of normal output a freshly-sacked town keeps. Down = conquest wrecks economies harder." },
    ],
  },
  {
    category: "Knowledge & tech",
    blurb: "How fast the tech timeline advances and spreads.",
    params: [
      { key: "LEARN_BASE", label: "Tech learning speed", def: 0.000040, min: 0.000005, max: 0.0002, step: 0.000005,
        desc: "Master scaling on all knowledge growth. Up = the whole bronze→industrial arc plays out faster." },
      { key: "DIFFUSE_RATE", label: "Tech diffusion rate", def: 0.0006, min: 0, max: 0.005, step: 0.0002,
        desc: "How fast tech spreads between trading neighbours. Up = no lasting tech gaps; 0 = isolated innovators pull ahead." },
    ],
  },
  {
    category: "Economy & state",
    blurb: "Trade volume, taxation, military upkeep and civil unrest.",
    params: [
      { key: "TRADE_RATE", label: "Trade volume", def: 0.025, min: 0.005, max: 0.1, step: 0.005,
        desc: "Scaling on goods traded between linked settlements. Up = richer, more interdependent economies." },
      { key: "TARIFF_RATE", label: "Customs tariff", def: 0.10, min: 0, max: 0.5, step: 0.02,
        desc: "Duty a capital skims on cross-border trade through it. Up = lucrative gateway states, costlier foreign trade." },
      { key: "TAX_MAX", label: "Max tax rate", def: 0.22, min: 0.05, max: 0.6, step: 0.02,
        desc: "Hard ceiling on how much wealth a state can tax per pass. Up = states fund bigger wars but stoke unrest." },
      { key: "ARMY_WAGE", label: "Soldier wage", def: 60, min: 0, max: 200, step: 5,
        desc: "Treasury coin per soldier per polity pass. Up = militaries bankrupt their states (fiscal-military collapse)." },
      { key: "UNREST_GAIN", label: "Unrest sensitivity", def: 0.15, min: 0.02, max: 0.6, step: 0.02,
        desc: "How fast grievances (hunger, overtax, war-weariness) boil into revolt. Up = volatile, rebellion-prone realms." },
    ],
  },
  {
    category: "Shocks: famine & plague",
    blurb: "Frequency and severity of the exogenous disasters that punctuate the timeline.",
    params: [
      { key: "FAMINE_CHANCE", label: "Famine likelihood", def: 0.35, min: 0, max: 1.0, step: 0.05,
        desc: "Probability a famine-spawn roll actually strikes a region. Up = recurrent harvest crises." },
      { key: "PLAGUE_CHANCE", label: "Plague likelihood", def: 0.55, min: 0, max: 1.0, step: 0.05,
        desc: "Probability a (generational) plague-spawn roll ignites an outbreak. Up = frequent pandemics." },
      { key: "PLAGUE_MORT", label: "Plague lethality", def: 0.0016, min: 0, max: 0.01, step: 0.0002,
        desc: "Base per-tick mortality of an active outbreak. Up = Black-Death-scale population collapses." },
    ],
  },
];

// Build the live value object and the immutable defaults from the schema.
const DEFAULTS = {};
for (const cat of TUNING_SCHEMA) for (const p of cat.params) DEFAULTS[p.key] = p.def;

// Live, mutable values the sim reads. Starts at defaults (== old constants).
export const T = { ...DEFAULTS };

// Apply a partial override map (from the Tuning menu / worker message). Only
// known keys are accepted, and only finite numbers — a malformed message can
// never poison the sim.
export function applyTuning(overrides) {
  if (!overrides) return;
  for (const k in overrides) {
    if (!(k in DEFAULTS)) continue;
    const v = Number(overrides[k]);
    if (Number.isFinite(v)) T[k] = v;
  }
}

// Reset every lever to its hand-tuned default.
export function resetTuning() { Object.assign(T, DEFAULTS); }

// The defaults, for the menu's "reset" affordance / change indicators.
export function tuningDefaults() { return { ...DEFAULTS }; }
