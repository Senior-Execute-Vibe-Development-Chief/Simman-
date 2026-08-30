// ── People style — look, dress, built as derived forms ─────────────────────
//
// Companion to tileMaterials.js. That module names what grows or sits on a
// tile. This one decides how people LOOK and what they WEAR and BUILD.
//
// Split:
//   look  — carried. Genesis-homeland climate, mixed by ancMix. Never the
//           tile you stand on (adaptation is too slow for historical time).
//   dress — local. Climate is insulation and motion; fibre/dye from materials.
//   built — local. Climate is the load (snow, rain, heat, flood); wall from
//           timber / mudbrick / stone / reed on the tile.
//
// Classification, not a fitted culture. No time gates, no place names.
// Pure + deterministic. No save fields, no UI wiring.

function clamp(x, a = 0, b = 1) {
  return x < a ? a : x > b ? b : x;
}

function ids(list) {
  if (!list) return [];
  return list.map(x => (typeof x === "string" ? x : x && x.id)).filter(Boolean);
}

function hasId(list, id) {
  return ids(list).includes(id);
}

function absLatOf(c) {
  if (c.absLat != null) return clamp(c.absLat);
  if (c.lat != null) return clamp(Math.abs(c.lat) / 90);
  return 0.5;
}

function warmOf(temp) {
  return clamp((temp - 0.52) / 0.36);
}

function coldOf(temp) {
  return clamp((0.82 - temp) / 0.34);
}

function wetOf(moist) {
  return clamp((moist - 0.18) / 0.55);
}

/** Continuous facial / body clines from a lineage's genesis climate. */
export function lookFromHomeland(h) {
  const temp = h.temp != null ? h.temp : 0.70;
  const moist = h.moist != null ? h.moist : 0.40;
  const elev = h.elev != null ? h.elev : 0;
  const absLat = absLatOf(h);
  const warm = warmOf(temp);
  const cold = coldOf(temp);
  const wet = wetOf(moist);
  // UV: equator + altitude. Cloud (moist) only weakly shades it.
  const uv = clamp((1 - absLat) * (1 - 0.15 * wet) + 0.22 * elev * (1 - absLat));
  const skin = clamp(0.12 + 0.78 * uv * (0.45 + 0.55 * warm));
  return {
    skin,
    stature: clamp(0.38 + 0.28 * cold + 0.12 * (1 - absLat)),
    build: clamp(0.22 + 0.62 * cold),
    limbs: clamp(0.22 + 0.64 * warm),
    hairCurl: clamp(0.08 + 0.82 * warm * wet),
    hairDark: clamp(0.22 + 0.72 * skin),
    noseWidth: clamp(0.16 + 0.70 * warm * Math.max(wet, 0.25)),
  };
}

export function mixLook(parts) {
  const keys = ["skin", "stature", "build", "limbs", "hairCurl", "hairDark", "noseWidth"];
  const acc = Object.fromEntries(keys.map(k => [k, 0]));
  let w = 0;
  for (const p of parts || []) {
    const look = p.look || p;
    const share = p.share != null ? p.share : 1;
    if (!look || share <= 0) continue;
    w += share;
    for (const k of keys) acc[k] += (look[k] || 0) * share;
  }
  if (w <= 0) return null;
  for (const k of keys) acc[k] /= w;
  return acc;
}

/**
 * Carried look. Needs `homeland` or `ancMix` + `homelands`.
 * Does not read the current tile's climate.
 */
export function lookOf(c) {
  if (c && c.ancMix && c.homelands) {
    const parts = [];
    for (const pair of c.ancMix) {
      const id = pair[0], share = pair[1];
      const h = c.homelands[id];
      if (!h || !(share > 0)) continue;
      parts.push({ look: lookFromHomeland(h), share });
    }
    return mixLook(parts);
  }
  if (c && c.homeland) return lookFromHomeland(c.homeland);
  return null;
}

function bestFibre(c, coverage) {
  const fibreIds = ids(c.materials && c.materials.fibres);
  const faunaIds = ids(c.materials && c.materials.fauna);
  const cold = coverage > 0.55;
  const hot = coverage < 0.35;
  const prefer = cold
    ? ["fur", "cashmere", "wool", "alpaca", "hemp", "flax", "silk", "cotton"]
    : hot
      ? ["cotton", "linen", "flax", "silk", "hemp", "wool"]
      : ["wool", "flax", "hemp", "silk", "cotton", "linen"];
  if (cold && (faunaIds.includes("seal") || hasId(c.materials && c.materials.furs, "seal")
    || hasId(c.materials && c.materials.furs, "sable"))) {
    if (!fibreIds.includes("fur")) fibreIds.push("fur");
  }
  for (const id of prefer) {
    if (id === "linen" && fibreIds.includes("flax")) return "linen";
    if (fibreIds.includes(id)) return id === "flax" ? (hot ? "linen" : "flax") : id;
  }
  if (cold && (c.livestock || 0) > 0.35) return "wool";
  if (hot) return "linen";
  return "wool";
}

function bestDye(c) {
  const dyeIds = ids(c.materials && c.materials.dyes);
  if (!dyeIds.length) return null;
  const wealth = c.wealth != null ? c.wealth : 0.3;
  const costly = ["tyrian", "cochineal", "kermes", "indigo", "saffron"];
  if (wealth > 0.45) {
    for (const id of costly) if (dyeIds.includes(id)) return id;
  }
  return dyeIds[0];
}

export function dressOf(c) {
  const temp = c.temp != null ? c.temp : 0.70;
  const coverage = coldOf(temp);
  const weight = coverage > 0.55 ? "heavy" : coverage < 0.28 ? "light" : "medium";
  const livestock = c.livestock != null ? c.livestock : 0;
  const horses = c.horses != null ? c.horses : (c.dep && c.dep.horses) || 0;
  const open = c.open != null ? c.open : (c.relief != null ? c.relief < 0.22 : false);
  let cut;
  if (temp > 0.80 && coverage < 0.35) cut = "drape";
  else if ((temp < 0.70 || livestock > 0.45) && (horses > 0.08 || (livestock > 0.4 && open))) cut = "trousers";
  else if (temp < 0.68) cut = "tailored";
  else if (temp > 0.78) cut = "drape";
  else cut = "tailored";
  return {
    coverage,
    weight,
    cut,
    fibre: bestFibre(c, coverage),
    dye: bestDye(c),
  };
}

function snowLoad(temp, moist) {
  return temp < 0.66 && moist > 0.32;
}

function rainLoad(moist) {
  return moist > 0.50;
}

function aridHeat(temp, moist) {
  return temp > 0.74 && moist < 0.30;
}

function bestWall(c) {
  const trees = ids(c.materials && c.materials.trees);
  const stone = ids(c.materials && c.materials.stone);
  const earths = ids(c.materials && c.materials.earths);
  const flood = !!c.flood;
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  const elev = c.elev != null ? c.elev : 0;
  if (flood && (trees.includes("reed") || trees.includes("papyrus"))) return "reed";
  if (aridHeat(temp, moist) && (earths.includes("clay") || earths.includes("sand"))) return "mudbrick";
  if ((elev > 0.18 || (c.relief || 0) > 0.35) && stone.length) return "stone";
  if (trees.includes("oak") || trees.includes("pine") || trees.includes("cedar")
    || trees.includes("teak") || trees.includes("beech") || trees.includes("spruce")) return "timber";
  if (earths.includes("clay") && moist < 0.42) return "mudbrick";
  if (flood) return "reed";
  if (aridHeat(temp, moist)) return "mudbrick";
  if (moist > 0.45) return "timber";
  if (stone.length) return "stone";
  return "wattle";
}

export function builtOf(c) {
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  const flood = !!c.flood;
  let roof, pitch;
  if (snowLoad(temp, moist)) { roof = "steep"; pitch = clamp(0.72 + (0.66 - temp) * 0.8); }
  else if (rainLoad(moist)) { roof = "pitched"; pitch = clamp(0.40 + (moist - 0.50) * 0.5); }
  else if (aridHeat(temp, moist)) { roof = "flat"; pitch = clamp(0.08 + moist * 0.15); }
  else { roof = "pitched"; pitch = 0.38; }
  let plan;
  if (flood) plan = "raised";
  else if (aridHeat(temp, moist)) plan = "courtyard";
  else if (temp < 0.62) plan = "compact";
  else plan = "open";
  return {
    wall: bestWall(c),
    roof,
    pitch: clamp(pitch),
    plan,
  };
}

/** Combined style. `look` is null unless a homeland / ancMix is supplied. */
export function styleOf(c) {
  return {
    look: lookOf(c),
    dress: dressOf(c),
    built: builtOf(c),
  };
}

export function formatStyleLine(s) {
  if (!s) return "";
  const bits = [];
  if (s.built) bits.push(`${s.built.wall} ${s.built.roof} ${s.built.plan}`);
  if (s.dress) bits.push(`${s.dress.weight} ${s.dress.fibre} ${s.dress.cut}`);
  return bits.join(" · ");
}
