// GROWING-SEASON TEMPERATURE — the crop model is fed the wrong number, and the
// right one is already in the data files.
//
// The measured defect (docs/design-idea-field.md): every real wheat cradle is
// assigned MAIZE by the crop-package model, because wheat's optimum (tOpt 0.73
// = 13°C) is a GROWING-SEASON figure while the model evaluates it against the
// ANNUAL MEAN. Wheat in its heartland is a cool-SEASON crop in a warm-ANNUAL
// climate: Iraq averages ~22°C a year and grows wheat in winter.
//
// This is not a modelling gap to be invented around. The Earth (Sim) preset
// loads NCEP/NCAR 1991-2020 monthly climatology — twelve months of 2 m air
// temperature per cell (src/realClimateData.js, data/global_airtemp.json) —
// and realClimateData.js's deriveGrids() reads every month:
//
//     for (let m = 0; m < 12; m++) { const tm = airtemp.months[m][j][i]; mat += tm; … }
//     T[j * NLON + i] = mat / 12;     // ← the twelve values collapse to one
//
// The seasonal signal the crop model needs is read and discarded on that line.
//
// This probe prints, at the historical cradles, the annual mean the model
// currently uses against the COOLEST-QUARTER and WARMEST-QUARTER means the same
// loop could carry for free — so the design decision is made against Earth's
// actual observed climate rather than an argument about it.
//
//   node tools/probe_season.mjs [lat,lon,name ...]
import { readFileSync } from "fs";

// Sim temperature scale (shared across the sim): t = 0.60 + degC/100.
const tScale = (degC) => 0.60 + degC / 100;
const WHEAT_TOPT = 0.73, MAIZE_TOPT = 0.82, RICE_TOPT = 0.86;

const at = JSON.parse(readFileSync(new URL("../data/global_airtemp.json", import.meta.url), "utf8"));
const pr = JSON.parse(readFileSync(new URL("../data/global_precip.json", import.meta.url), "utf8"));
const LAT = at.lat, LON = at.lon, NLON = LON.length;

function cellOf(lat, lon) {
  let j = 0;
  while (j < LAT.length - 2 && LAT[j + 1] > lat) j++;   // LAT descends
  const l = ((lon % 360) + 360) % 360;
  return [j, Math.round(l / (360 / NLON)) % NLON];
}

/** Twelve monthly means at a lat/lon, plus the quarter aggregates AND the
 *  growing-season coupling: temperature and rainfall of the warm half vs the
 *  cool half of the year, so a crop can be read on the season it grows in. */
export function seasonAt(lat, lon) {
  const [j, i] = cellOf(lat, lon);
  const months = at.months.map((m) => m[j][i]);
  const rain = pr.months.map((m) => m[j][i] * 30.4);   // mm/day → mm/month
  const annual = months.reduce((a, b) => a + b, 0) / 12;
  const asc = [...months].sort((a, b) => a - b);
  const coolQ = (asc[0] + asc[1] + asc[2]) / 3;
  const warmQ = (asc[9] + asc[10] + asc[11]) / 3;
  // Warm half / cool half by temperature, carrying each half's rainfall — the
  // moisture-season coupling the temperature-only reading misses (measured: a
  // Mediterranean cool-wet cradle and a monsoon warm-wet cradle look identical
  // on temperature alone and opposite on which SEASON carries the water).
  const byT = months.map((t, k) => [t, k]).sort((a, b) => b[0] - a[0]);
  const warmM = byT.slice(0, 6).map((x) => x[1]), coolM = byT.slice(6).map((x) => x[1]);
  const warmT = warmM.reduce((a, k) => a + months[k], 0) / 6;
  const coolT = coolM.reduce((a, k) => a + months[k], 0) / 6;
  const warmP = warmM.reduce((a, k) => a + rain[k], 0);
  const coolP = coolM.reduce((a, k) => a + rain[k], 0);
  return { months, annual, coolQ, warmQ, warmT, coolT, warmP, coolP };
}

// Default sites: the historical cradles, plus maize's real home as a control.
const SITES = process.argv.length > 2
  ? process.argv.slice(2).map((a) => { const [la, lo, ...n] = a.split(","); return [+la, +lo, n.join(",") || `${la},${lo}`]; })
  : [
    [27, 31, "Nile"],
    [33, 44, "Mesopotamia"],
    [28, 71, "Indus"],
    [34, 114, "Yellow River"],
    [19, -99, "Mexico (maize)"],
    [16, -90, "Mesoamerica lowl"],
    [-13, -75, "Andes"],
    [-6, 144, "New Guinea"],
    [14, 0, "Sahel"],
    [38, -90, "E N America"],
  ];

const near = (t, opt) => Math.abs(t - opt);
const bestOf = (t) => {
  const c = [["wheat", WHEAT_TOPT], ["maize", MAIZE_TOPT], ["rice", RICE_TOPT]];
  c.sort((a, b) => near(t, a[1]) - near(t, b[1]));
  return c[0][0];
};

console.log("Sim temperature scale: t = 0.60 + degC/100");
console.log(`  wheat tOpt ${WHEAT_TOPT} (13C)   maize tOpt ${MAIZE_TOPT} (22C)   rice tOpt ${RICE_TOPT} (26C)`);
console.log("");
console.log("site              annual (t)      nearest | coolQ (t)       nearest | warmQ");
for (const [lat, lon, name] of SITES) {
  const s = seasonAt(lat, lon);
  const tA = tScale(s.annual), tC = tScale(s.coolQ), tW = tScale(s.warmQ);
  console.log(
    `${name.padEnd(17)} ${s.annual.toFixed(1).padStart(5)}C (${tA.toFixed(3)}) ${bestOf(tA).padEnd(6)} | ` +
    `${s.coolQ.toFixed(1).padStart(5)}C (${tC.toFixed(3)}) ${bestOf(tC).padEnd(6)} | ${s.warmQ.toFixed(1).padStart(5)}C (${tW.toFixed(3)})`);
}
console.log("");
console.log("THE GROWING-SEASON COUPLING — temperature AND rainfall of each half-year:");
console.log("site               warm season        cool season       founder-crop reading");
for (const [lat, lon, name] of SITES) {
  const s = seasonAt(lat, lon);
  // A cool-season crop (wheat) grows in the cool half; a warm-season crop
  // (millet/maize/rice) in the warm half. It thrives only if THAT season is wet.
  const coolCropOk = s.coolT >= 8 && s.coolT <= 22 && s.coolP >= 40;    // temperate + wet enough
  const warmCropOk = s.warmT >= 18 && s.warmP >= 120;                    // warm + monsoon-wet
  const reading = coolCropOk && warmCropOk ? "both seasons crop"
    : coolCropOk ? "COOL-season cereal (wheat/barley)"
    : warmCropOk ? "WARM-season cereal (millet/rice/maize)"
    : (s.warmP < 40 && s.coolP < 40) ? "arid — river-irrigated only"
    : "no storable-cereal season";
  console.log(`${name.padEnd(17)} ${s.warmT.toFixed(0).padStart(3)}C ${s.warmP.toFixed(0).padStart(5)}mm   | ` +
    `${s.coolT.toFixed(0).padStart(3)}C ${s.coolP.toFixed(0).padStart(5)}mm  | ${reading}`);
}
console.log("");
console.log("READ: the model evaluates every package at ANNUAL-MEAN temperature and");
console.log("moisture, so every Old-World cereal cradle reads as maize country (warm");
console.log("annual mean). Evaluating each crop on the SEASON IT GROWS IN — cool-optimum");
console.log("crops on the cool half, warm-optimum crops on the warm half, each with THAT");
console.log("season's rainfall — recovers the real founder crops from observation with no");
console.log("constant changed: Mesopotamia cool-wet -> wheat; the Yellow River warm-wet /");
console.log("cold-dry winter -> millet (a summer crop, its actual founder); New Guinea has");
console.log("no season -> no cereal. See docs/design-growing-season.md.");
