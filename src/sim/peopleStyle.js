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
// Station (plain vs fine) is surplus, not a culture name: a court and a
// tribesman can share a climate and still read apart. Hot-humid + plain is
// bare skin; the same climate + surplus is a light robe. Silk vs wool vs
// leather decides robe vs tailored vs hide — still no place name.
// Head/foot follow load (arid wrap, cold hood/boot, heat sandal, bare none).
// Mobile open pasture without mill-timber is a felt tent; polar without
// timber is turf. Roof cover is thatch / shingle / mud / felt from the
// same load × materials, not a taste genome.
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
 * Genesis-homeland climates stamped at ancestry anchors (pipeline generateAncestry).
 * Indexed by ancestry id; null when the world predates the stamp.
 */
export function homelandsFrom(world) {
  const arr = world && world.ancHomelands;
  if (!arr || !arr.length) return null;
  return arr;
}

/**
 * Carried look. Needs `homeland`, or `ancMix` + `homelands` / `world.ancHomelands`.
 * Does not read the current tile's climate.
 */
export function lookOf(c) {
  const homelands = (c && c.homelands) || (c && c.world && homelandsFrom(c.world));
  if (c && c.ancMix && homelands) {
    const parts = [];
    for (const pair of c.ancMix) {
      const id = pair[0], share = pair[1];
      const h = homelands[id];
      if (!h || !(share > 0)) continue;
      parts.push({ look: lookFromHomeland(h), share });
    }
    return mixLook(parts);
  }
  if (c && c.homeland) return lookFromHomeland(c.homeland);
  return null;
}

/** Pure ancestry mix at a sim tile (pre-settlement probe). */
export function ancMixAtTile(world, ti) {
  const anc = world && world.ancestry;
  if (!anc || ti == null || ti < 0 || ti >= anc.length) return null;
  const id = anc[ti];
  return id < 0 ? null : [[id, 1]];
}

function wealthOf(c) {
  return c.wealth != null ? c.wealth : 0.3;
}

function stationOf(c) {
  return wealthOf(c) > 0.5 ? "fine" : "plain";
}

function bestFibre(c, coverage) {
  const fibreIds = ids(c.materials && c.materials.fibres);
  const faunaIds = ids(c.materials && c.materials.fauna);
  const wealth = wealthOf(c);
  const cold = coverage > 0.55;
  const hot = coverage < 0.35;
  if (cold && (faunaIds.includes("seal") || hasId(c.materials && c.materials.furs, "seal")
    || hasId(c.materials && c.materials.furs, "sable"))) {
    if (!fibreIds.includes("fur")) fibreIds.push("fur");
  }
  const hideFauna = ["deer", "bison", "elk", "antelope"].some(id => faunaIds.includes(id));
  if (wealth < 0.4 && (hideFauna || (c.livestock || 0) > 0.35) && !fibreIds.includes("silk")) {
    if (!fibreIds.includes("leather")) fibreIds.push("leather");
  }
  // Surplus silk is a court cloth even in the temperate band — otherwise
  // silk-country and wool-country gentry collapse to the same cut.
  const prefer = wealth > 0.5 && fibreIds.includes("silk")
    ? ["silk", "cotton", "linen", "flax", "wool", "hemp"]
    : cold
      ? ["fur", "cashmere", "wool", "alpaca", "leather", "hemp", "flax", "silk", "cotton"]
      : hot
        ? ["cotton", "linen", "flax", "leather", "silk", "hemp", "wool"]
        : ["leather", "wool", "flax", "hemp", "silk", "cotton", "linen"];
  for (const id of prefer) {
    if (id === "linen" && fibreIds.includes("flax")) return "linen";
    if (fibreIds.includes(id)) return id === "flax" ? (hot ? "linen" : "flax") : id;
  }
  if (wealth < 0.4 && hideFauna) return "leather";
  if (cold && (c.livestock || 0) > 0.35) return "wool";
  if (hot) return "linen";
  return "wool";
}

function bestDye(c) {
  const dyeIds = ids(c.materials && c.materials.dyes);
  if (!dyeIds.length) return null;
  const wealth = wealthOf(c);
  const costly = ["tyrian", "cochineal", "kermes", "indigo", "saffron"];
  if (wealth > 0.45) {
    for (const id of costly) if (dyeIds.includes(id)) return id;
  }
  return dyeIds[0];
}

function humidHeat(temp, moist) {
  return temp > 0.80 && moist > 0.50;
}

function TIMBER_IDS() {
  return ["oak", "pine", "cedar", "teak", "beech", "spruce", "larch", "birch"];
}

function hasTimber(c) {
  const trees = ids(c.materials && c.materials.trees);
  return TIMBER_IDS().some(id => trees.includes(id));
}

function aridHeat(temp, moist) {
  return temp > 0.74 && moist < 0.30;
}

function silhouetteOf(cut) {
  if (cut === "bare") return "minimal";
  if (cut === "drape" || cut === "robe") return "flowing";
  if (cut === "trousers") return "split";
  return "structured";
}

function headOf(c, coverage, weight) {
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  if (weight === "bare") return "none";
  if (aridHeat(temp, moist)) return "wrap";
  if (coverage > 0.50) return "hood";
  return "none";
}

function footOf(c, coverage, weight) {
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  if (weight === "bare") return "none";
  if (aridHeat(temp, moist) || temp > 0.80) return "sandal";
  if (coverage > 0.50) return "boot";
  return "shoe";
}

function ornamentOf(c) {
  if (stationOf(c) !== "fine") return null;
  const gems = ids(c.materials && c.materials.gems);
  const metals = ids(c.materials && c.materials.metals);
  if (metals.includes("gold")) return "gold";
  if (gems.includes("lapis")) return "lapis";
  if (gems.includes("turquoise")) return "turquoise";
  if (gems.includes("jade")) return "jade";
  return null;
}

export function dressOf(c) {
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  let coverage = coldOf(temp);
  const livestock = c.livestock != null ? c.livestock : 0;
  const horses = c.horses != null ? c.horses : (c.dep && c.dep.horses) || 0;
  const open = c.open != null ? c.open : (c.relief != null ? c.relief < 0.22 : false);
  const wealth = wealthOf(c);
  const station = stationOf(c);
  const fibre = bestFibre(c, coverage);
  const mounted = (temp < 0.70 || livestock > 0.45) && (horses > 0.08 || (livestock > 0.4 && open));
  const tropic = humidHeat(temp, moist);
  let weight = coverage > 0.55 ? "heavy" : coverage < 0.28 ? "light" : "medium";
  let cut;
  if (tropic && station === "plain" && !mounted) {
    weight = "bare";
    cut = "bare";
    coverage = Math.min(coverage, 0.08);
  } else if (mounted) cut = "trousers";
  else if (wealth > 0.5 && (fibre === "silk" || tropic)) cut = "robe";
  else if (temp > 0.78 && coverage < 0.40) cut = "drape";
  else if (temp < 0.68) cut = "tailored";
  else if (fibre === "leather") cut = "drape";
  else cut = "tailored";
  if (tropic && station === "fine" && !mounted) {
    weight = "light";
    cut = "robe";
  }
  if (fibre === "fur" || (coverage > 0.55 && ids(c.materials && c.materials.furs).length)) {
    if (weight !== "bare") weight = "heavy";
  }
  return {
    coverage,
    weight,
    cut,
    silhouette: silhouetteOf(cut),
    fibre,
    dye: bestDye(c),
    head: headOf(c, coverage, weight),
    foot: footOf(c, coverage, weight),
    ornament: ornamentOf(c),
    station,
  };
}

function snowLoad(temp, moist) {
  return temp < 0.66 && moist > 0.32;
}

function rainLoad(moist) {
  return moist > 0.50;
}

function tundraBare(c, temp, moist) {
  return temp < 0.58 && moist < 0.40 && !hasTimber(c);
}

function mobileCamp(c, temp, flood) {
  const horses = c.horses != null ? c.horses : (c.dep && c.dep.horses) || 0;
  const open = c.open != null ? c.open : (c.relief != null ? c.relief < 0.22 : false);
  const moist = c.moist != null ? c.moist : 0.40;
  return !flood && horses > 0.08 && open && !hasTimber(c) && !aridHeat(temp, moist) && temp < 0.78;
}

function scaleOf(c, plan) {
  if (plan === "camp") return "camp";
  const w = wealthOf(c);
  if (w > 0.75) return "hall";
  if (w > 0.5) return "house";
  return "hut";
}

function coverOf(c, roof, wall) {
  if (roof === "tent") return "felt";
  if (wall === "turf" || roof === "low") return "turf";
  if (roof === "flat") return "mud";
  const rain = roof === "pitched" || roof === "steep";
  if (rain && !hasTimber(c)) return "thatch";
  if (rain) return "shingle";
  return "none";
}

function openingsOf(temp, moist) {
  if (aridHeat(temp, moist) || temp > 0.80) return "small";
  // Polar dry-cold keeps heat in. Temperate cold-wet opens for light.
  if (temp < 0.58 && moist < 0.40) return "small";
  if (temp < 0.62 && moist > 0.32) return "large";
  return "medium";
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
  if (hasTimber(c)) return "timber";
  if (trees.includes("bamboo") && temp > 0.76 && moist > 0.42) return "bamboo";
  if (earths.includes("clay") && moist < 0.42) return "mudbrick";
  if (flood) return "reed";
  if (aridHeat(temp, moist)) return "mudbrick";
  // Rain without mill-timber is wattle/thatch country, not a mudbrick hut
  // and not a European hall. Palm is fibre and roof, not a framed wall.
  if (moist > 0.45) return "wattle";
  if (stone.length) return "stone";
  return "wattle";
}

export function builtOf(c) {
  const temp = c.temp != null ? c.temp : 0.70;
  const moist = c.moist != null ? c.moist : 0.40;
  const flood = !!c.flood;
  const wealth = wealthOf(c);
  let wall = bestWall(c);
  let roof, pitch, plan, eaves;

  if (flood) {
    plan = "raised";
    roof = rainLoad(moist) ? "pitched" : "flat";
    pitch = rainLoad(moist) ? 0.42 : 0.12;
    eaves = rainLoad(moist) ? "deep" : "none";
  } else if (mobileCamp(c, temp, flood)) {
    wall = "felt";
    roof = "tent";
    pitch = 0.22;
    plan = "camp";
    eaves = "none";
  } else if (tundraBare(c, temp, moist)) {
    wall = "turf";
    roof = "low";
    pitch = 0.14;
    plan = "compact";
    eaves = "none";
  } else if (snowLoad(temp, moist)) {
    roof = "steep";
    pitch = clamp(0.72 + (0.66 - temp) * 0.8);
    plan = temp < 0.62 ? "compact" : "open";
    eaves = rainLoad(moist) ? "deep" : "none";
  } else if (rainLoad(moist)) {
    roof = "pitched";
    pitch = clamp(0.40 + (moist - 0.50) * 0.5);
    eaves = "deep";
    plan = (wealth > 0.5 && temp > 0.72) ? "courtyard" : (temp < 0.62 ? "compact" : "open");
  } else if (aridHeat(temp, moist)) {
    roof = "flat";
    pitch = clamp(0.08 + moist * 0.15);
    plan = "courtyard";
    eaves = "none";
  } else {
    roof = "pitched";
    pitch = 0.38;
    eaves = "none";
    plan = (wealth > 0.5 && temp > 0.72) ? "courtyard" : (temp < 0.62 ? "compact" : "open");
  }

  return {
    wall,
    roof,
    pitch: clamp(pitch),
    eaves,
    plan,
    cover: coverOf(c, roof, wall),
    openings: openingsOf(temp, moist),
    scale: scaleOf(c, plan),
    station: stationOf(c),
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
  if (s.built) {
    bits.push(`${s.built.scale || ""} ${s.built.wall} ${s.built.roof} ${s.built.plan}`.trim());
  }
  if (s.dress) {
    bits.push(`${s.dress.station} ${s.dress.weight} ${s.dress.fibre} ${s.dress.cut} ${s.dress.head || ""}`.trim());
  }
  return bits.join(" · ");
}
