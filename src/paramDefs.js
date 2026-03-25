// ── Shared tectonic parameter definitions + preset management ──

const STORAGE_KEY = "simman_tec_presets";

export function loadPresets() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
}
export function savePreset(name, params) {
  const p = loadPresets(); p[name] = params;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}
export function deletePreset(name) {
  const p = loadPresets(); delete p[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export const PARAMS = {
  plates: {
    label: "Plate Layout", color: "180,120,100",
    params: [
      { key: "numMajorBase", def: 5, min: 3, max: 9, step: 1, label: "Major plates (base)",
        desc: "Base number of large tectonic plates. More = smaller continents, more boundaries." },
      { key: "numMajorRange", def: 3, min: 0, max: 5, step: 1, label: "Major plates (variance)",
        desc: "Random variation added to the base count. 0 = always exact base count." },
      { key: "numMinorBase", def: 6, min: 2, max: 14, step: 1, label: "Minor plates (base)",
        desc: "Base number of small plates. These create island arcs and micro-continents." },
      { key: "numMinorRange", def: 6, min: 0, max: 10, step: 1, label: "Minor plates (variance)",
        desc: "Random variation for minor plate count." },
      { key: "majorContProb", def: 0.70, min: 0.3, max: 1.0, label: "Major continent %",
        desc: "Chance each major plate carries continental crust. Higher = more landmass." },
      { key: "minorContProb", def: 0.20, min: 0.0, max: 0.6, label: "Minor continent %",
        desc: "Chance each minor plate has land. Creates scattered islands when higher." },
      { key: "plateStretchX", def: 1.3, min: 0.6, max: 2.0, label: "Plate X stretch",
        desc: "Horizontal stretch factor for plate boundaries. Higher = wider, flatter plates." },
      { key: "plateStretchY", def: 0.8, min: 0.4, max: 1.4, label: "Plate Y stretch",
        desc: "Vertical stretch factor. Lower = plates become wider than tall." },
    ]
  },
  continents: {
    label: "Continent Shape", color: "120,180,100",
    params: [
      { key: "majorContRadMin", def: 0.14, min: 0.06, max: 0.28, label: "Major continent min radius",
        desc: "Minimum radius of the continent stamp on major plates. Bigger = larger landmasses." },
      { key: "majorContRadRange", def: 0.18, min: 0.04, max: 0.30, label: "Major continent radius range",
        desc: "Random range added to min. High range = big variety between continents." },
      { key: "minorContRadMin", def: 0.06, min: 0.02, max: 0.14, label: "Minor continent min radius",
        desc: "Minimum island/micro-continent size." },
      { key: "minorContRadRange", def: 0.07, min: 0.02, max: 0.14, label: "Minor continent radius range",
        desc: "Size variation for minor landmasses." },
      { key: "majorSubsBase", def: 5, min: 2, max: 10, step: 1, label: "Major sub-stamps (base)",
        desc: "Number of overlapping ellipses composing each major continent. More = complex shape." },
      { key: "majorSubsRange", def: 5, min: 0, max: 8, step: 1, label: "Major sub-stamps (variance)",
        desc: "Variation in sub-stamp count between continents." },
      { key: "majorCoreRadMin", def: 0.12, min: 0.04, max: 0.22, label: "Major core radius min",
        desc: "Size of the central landmass blob. The 'bulk' of each continent." },
      { key: "majorCoreRadRange", def: 0.10, min: 0.02, max: 0.18, label: "Major core radius range",
        desc: "Variation in core blob size." },
      { key: "majorSubRadMin", def: 0.05, min: 0.02, max: 0.12, label: "Major sub radius min",
        desc: "Size of satellite blobs that create peninsulas and extensions." },
      { key: "majorSubRadRange", def: 0.08, min: 0.02, max: 0.14, label: "Major sub radius range",
        desc: "Variation in satellite blob size." },
      { key: "majorNegsMax", def: 2.5, min: 0, max: 5, label: "Major neg stamps (max)",
        desc: "Maximum negative stamps per continent. These carve bays and inland seas." },
      { key: "warpStr1", def: 0.14, min: 0.02, max: 0.30, label: "Coastline warp (large)",
        desc: "Large-scale organic warping of plate boundaries and coastlines." },
      { key: "warpStr2", def: 0.05, min: 0.0, max: 0.15, label: "Coastline warp (detail)",
        desc: "Fine detail warping. Adds smaller bends and irregularities." },
      { key: "jagStr", def: 0.025, min: 0.0, max: 0.06, label: "Coastline jaggedness",
        desc: "Sharp, fractal edge detail on coastlines. Higher = more ragged edges." },
      { key: "penStrength", def: 0.2, min: 0.0, max: 0.5, label: "Peninsula strength",
        desc: "How strongly peninsula features protrude from coastlines." },
      { key: "bayStrength", def: 0.18, min: 0.0, max: 0.5, label: "Bay strength",
        desc: "How deeply bay features cut into coastlines." },
    ]
  },
  mountains: {
    label: "Mountains", color: "160,140,180",
    params: [
      { key: "contContUplift", def: 0.18, min: 0.05, max: 0.35, label: "Cont-cont uplift",
        desc: "Uplift strength where two continental plates collide. Creates Himalaya-type ranges." },
      { key: "contOceanUplift", def: 0.13, min: 0.03, max: 0.25, label: "Cont-ocean uplift",
        desc: "Uplift where ocean plate subducts under continent. Creates Andes-type ranges." },
      { key: "contContMaxDist", def: 60, min: 20, max: 100, step: 1, label: "Cont-cont range",
        desc: "How far the plateau extends from a cont-cont boundary (in coarse cells). 60 ≈ 1300km." },
      { key: "contOceanMaxDist", def: 25, min: 8, max: 50, step: 1, label: "Cont-ocean range",
        desc: "How far coastal mountains extend inland. 25 ≈ 550km." },
      { key: "contContFlatCore", def: 10, min: 0, max: 25, step: 1, label: "Plateau flat core",
        desc: "Radius of the flat top of the plateau before falloff begins. Like the Tibetan Plateau." },
      { key: "contContSigma", def: 10, min: 3, max: 25, step: 1, label: "Plateau falloff sigma",
        desc: "How gradually the plateau fades to lowland. Higher = gentler slopes." },
      { key: "contOceanFlatCore", def: 4, min: 0, max: 12, step: 1, label: "Coastal mtn flat core",
        desc: "Flat core of coastal mountain ranges before falloff." },
      { key: "contOceanSigma", def: 8, min: 2, max: 16, step: 1, label: "Coastal mtn falloff",
        desc: "How gradually coastal mountains fade inland." },
      { key: "blurSigma", def: 14, min: 4, max: 30, step: 1, label: "Plateau blur sigma",
        desc: "Gaussian blur applied to the mountain field. Higher = smoother, wider plateaus." },
      { key: "plateauMult", def: 1.5, min: 0.5, max: 4.0, label: "Plateau height mult",
        desc: "Height multiplier for the broad plateau. Directly scales plateau elevation." },
      { key: "peaksMult", def: 2.0, min: 0.5, max: 5.0, label: "Peak height mult",
        desc: "Height multiplier for ridgeline peaks at plate boundaries." },
      { key: "mtnBumpStr", def: 0.10, min: 0.0, max: 0.25, label: "Mountain bumpiness",
        desc: "Noisy texture within mountain zones. Higher = more variation between peaks and valleys." },
    ]
  },
  wind: {
    label: "Wind & Pressure", color: "130,190,210",
    params: [
      { key: "pressureScale", def: 4.0, min: 1.0, max: 10.0, label: "Pressure scale",
        desc: "How strongly temperature differences create pressure gradients. Directly controls overall wind speed. Higher = faster winds everywhere." },
      { key: "coriolisStrength", def: 0.25, min: 0.05, max: 0.50, label: "Coriolis strength",
        desc: "Planetary rotation effect (2Ω at poles). Uses real sin(φ) profile. Controls how much wind spirals vs flows straight toward low pressure." },
      { key: "buoyancy", def: 0.8, min: 0.1, max: 2.0, label: "Buoyancy",
        desc: "How strongly temperature differences drive vertical convection. Higher = stronger Hadley cells, more vigorous tropical circulation." },
      { key: "vertCoupling", def: 0.22, min: 0.05, max: 0.5, label: "Vertical coupling",
        desc: "How much rising/sinking air transfers momentum between layers. Higher = stronger trade winds and jet streams." },
      { key: "oceanDrag", def: 0.04, min: 0.01, max: 0.15, label: "Ocean friction",
        desc: "Rayleigh drag over ocean. Sets cross-isobar angle (~15° at default). Higher = wind crosses isobars more, weaker flow." },
      { key: "landDrag", def: 0.35, min: 0.05, max: 1.2, label: "Land friction",
        desc: "Rayleigh drag over lowland terrain. Sets cross-isobar angle (~35° at default). Decreases with elevation (exposed peaks). Crank high to kill land wind." },
      { key: "terrainDeflect", def: 3.0, min: 0.5, max: 8.0, label: "Terrain deflection",
        desc: "How strongly mountains redirect wind along contour lines. Only removes the upslope component — doesn't add energy." },
      { key: "landPressureBias", def: 1.2, min: 0.0, max: 4.0, label: "Land pressure barrier",
        desc: "Pressure added over all land, counteracting the implicit thermal low. Makes wind flow AROUND continents instead of through them. Represents annual-mean cancellation of seasonal thermal effects." },
      { key: "orographicPressure", def: 2.5, min: 0.0, max: 8.0, label: "Orographic pressure",
        desc: "Extra pressure from mountains on top of land barrier. Creates windward highs and lee troughs around mountain ranges." },
      { key: "oceanPressureBias", def: 0.15, min: 0.0, max: 0.5, label: "Ocean pressure bias",
        desc: "Extra surface pressure over open ocean (denser marine air). Helps differentiate ocean vs land wind speeds." },
      { key: "eddyStrength", def: 0.015, min: 0.0, max: 0.06, label: "Eddy strength",
        desc: "Sub-grid curl noise eddies (mesoscale turbulence). Ocean gets full value, land gets 40%. Adds local variation." },
      { key: "windScale", def: 1.0, min: 0.3, max: 4.0, label: "Wind speed scale",
        desc: "Linear multiplier on final wind output. Scales all speeds equally without changing patterns." },
      { key: "windContrast", def: 1.0, min: 0.5, max: 3.0, label: "Wind speed contrast",
        desc: "Power curve exponent on wind magnitude. >1 = fast winds get faster, slow winds stay slow (amplifies peaks). <1 = more uniform speeds." },
      { key: "windSolverIter", def: 25, min: 8, max: 60, step: 1, label: "Solver iterations",
        desc: "Relaxation iterations. More = closer to steady-state equilibrium but slower generation." },
    ]
  },
  ocean: {
    label: "Land / Ocean", color: "100,160,220",
    params: [
      { key: "seaLevel", def: 0.72, min: 0.55, max: 0.88, label: "Sea level percentile",
        desc: "The big lever. Fraction of the map that is ocean. 0.72 = 72% ocean. Lower = more land." },
      { key: "majorWeightMin", def: 0.012, min: 0.004, max: 0.030, label: "Major plate weight min",
        desc: "Minimum Voronoi weight for major plates. Affects how big they claim in the power diagram." },
      { key: "majorWeightRange", def: 0.025, min: 0.005, max: 0.050, label: "Major plate weight range",
        desc: "Random range added to major plate weight. More = bigger variation between plate sizes." },
    ]
  },
};

export const ALL_PARAM_KEYS = Object.values(PARAMS).flatMap(g => g.params);

export function generateCandidates(baseParams, groupKey, spread, count, rngSeed) {
  let s = ((rngSeed % 2147483647) + 2147483647) % 2147483647 || 1;
  const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const paramList = groupKey === "all" ? ALL_PARAM_KEYS : PARAMS[groupKey].params;
  const candidates = [{ ...baseParams }];
  for (let i = 1; i < count; i++) {
    const shifted = { ...baseParams };
    for (const pd of paramList) {
      const base = baseParams[pd.key] !== undefined ? baseParams[pd.key] : pd.def;
      const range = pd.max - pd.min;
      const sens = pd.sens || 1.0;
      const shift = (rng() * 2 - 1) * spread * range * sens;
      let val = base + shift;
      if (pd.step && pd.step >= 1) val = Math.round(val);
      shifted[pd.key] = Math.max(pd.min, Math.min(pd.max, val));
    }
    candidates.push(shifted);
  }
  return candidates;
}
