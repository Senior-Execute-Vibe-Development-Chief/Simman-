// Probe temperature formulas vs real-world annual mean surface temps.
//
// Real-world reference (lat in degrees, annual mean air temp, our t-scale):
//   The renderer maps t: 0.50=-10°C, 0.60=0°C, 0.70=10°C, 0.80=20°C, 0.90=30°C
//   So  t = 0.60 + (celsius / 100)
//
// The internal "lat" variable is abs(ny-0.5)*2, so lat 0..1 ↔ 0°..90°.
//
// Both presets currently fall off too quickly past the mid-latitudes —
// poles end up near zero (≡ -60°C), which is colder than the real
// world average at 80°N (~-17°C).
//
// Run: node tools/probe_temperature.mjs

// Targets = REAL annual-mean surface air temperature by latitude (zonal means,
// NCEP/ERA climatology), not the old visualization-inflated values. The map is
// hemisphere-symmetric (lat = abs(ny-.5)*2), so these track the better-sampled
// northern profile; Antarctica's extra cold comes from its ice-sheet ELEVATION,
// not the base latitude curve. Reference points:
//   • Equator → +26°C   • 20° → +25°C (subtropical shoulder)   • 30° → +20°C
//   • 50° → +7°C   • 60° → 0°C   • 70° → -10°C   • 80° → -18°C   • 90° → -23°C
const TARGETS = [
  // lat-norm, lat-deg, real-°C, target-t (t = 0.60 + °C/100)
  [0.00,   0, 26, 0.86],
  [0.11,  10, 27, 0.87],
  [0.22,  20, 25, 0.85],
  [0.33,  30, 20, 0.80],
  [0.44,  40, 14, 0.74],
  [0.56,  50,  7, 0.67],
  [0.67,  60,  0, 0.60],
  [0.78,  70,-10, 0.50],
  [0.89,  80,-18, 0.42],
  [1.00,  90,-23, 0.37],
];

// ── Current Earth preset (WorldSim.jsx:94) ──
function earthCurrent(lat) {
  return Math.max(0, Math.min(1,
    1 - Math.pow(lat, 2.0) * 1.15 - lat*lat*lat*0.1
  ));
}

// ── Current Tectonic preset base (tectonicGen.js:1611) ──
function tectonicCurrent(lat) {
  const subtropHeat = Math.exp(-((lat-0.20)*(lat-0.20))/(2*0.08*0.08)) * 0.06;
  return Math.max(0, Math.min(1,
    1 - Math.pow(lat, 1.35) * 1.15 + subtropHeat
  ));
}

// ── Proposed accurate curve (v6) ──
// Real annual-mean temperature is nearly flat near the equator, drops fastest
// through the mid-latitudes, then FLATTENS toward the pole (poleward heat
// transport — the old lat^6 term plunged the poles to -60°C, far colder than the
// real ~-23°C Arctic mean). A quadratic with a quartic flattening term fits the
// real zonal curve to within ~2°C everywhere; a small subtropical shoulder lifts
// the 10-20° band (clear-sky deserts run hotter than the cloudy equator). The
// Greenland/Antarctica ice still comes from the lat-amplified elevation penalty.
//   t = 0.85 - 0.66*lat^2 + 0.18*lat^4 + shoulder - elev*(0.40 + 0.80*lat)
function proposed(lat, elev = 0) {
  const l2 = lat*lat;
  const shoulder = 0.035 * Math.exp(-((lat - 0.15) * (lat - 0.15)) / (2 * 0.10 * 0.10));
  const elevPen = Math.max(0, elev) * (0.40 + 0.80 * lat);
  return Math.max(0, Math.min(1,
    0.85 - 0.66 * l2 + 0.18 * l2 * l2 + shoulder - elevPen
  ));
}

function fmt(t) {
  // Map t back to celsius: t = 0.60 + c/100 → c = (t - 0.60) * 100
  const c = ((t - 0.60) * 100).toFixed(1);
  return `${t.toFixed(3)} (${c >= 0 ? '+' : ''}${c}°C)`;
}

// Biome thresholds from getBiomeD in WorldSim.jsx
function biome(t) {
  if (t < 0.08) return 'ICE';
  if (t < 0.15) return 'tundra';
  if (t < 0.25) return 'tundra*';
  if (t < 0.38) return 'taiga';
  if (t < 0.55) return 'temperate';
  if (t < 0.72) return 'subtrop';
  return 'tropical';
}

// Probe particular features: Greenland interior, Antarctica edge, Siberia
const FEATURES = [
  ['Equatorial Africa',   0.00, 0.05],
  ['Sahara',              0.27, 0.05],
  ['Berlin (~52°N)',      0.58, 0.05],
  ['Yakutsk (~62°N inl)', 0.69, 0.10],
  ['Iceland coast',       0.71, 0.05],
  ['Alaska N coast',      0.78, 0.05],
  ['Greenland coast',     0.74, 0.10],
  ['Greenland interior',  0.78, 0.40],   // high ice sheet
  ['Antarctica edge',     0.85, 0.05],
  ['Antarctica interior', 0.92, 0.30],
];

console.log('\nFEATURE PROBE (proposed handles elev internally):');
console.log('feature                lat   elev  t       biome     proposed');
console.log('─'.repeat(75));
for (const [name, lat, elev] of FEATURES) {
  const tProp = proposed(lat, elev);
  console.log(`${name.padEnd(22)} ${lat.toFixed(2)}  ${elev.toFixed(2)}  ${tProp.toFixed(3)}   ${biome(tProp).padEnd(9)} ${fmt(tProp)}`);
}

function tdiff(actual, target) {
  const d = actual - target;
  const c = (d * 100).toFixed(1);
  return `${d >= 0 ? '+' : ''}${c}°C`;
}

console.log(
  'lat°  target            earth-now         Δ        tectonic-now      Δ        proposed         Δ');
console.log(
  '─'.repeat(110));
for (const [latN, latDeg, realC, target] of TARGETS) {
  const e = earthCurrent(latN);
  const t = tectonicCurrent(latN);
  const p = proposed(latN);
  console.log(
    `${latDeg.toString().padStart(3)}°  ${fmt(target).padEnd(18)} ${fmt(e).padEnd(18)} ${tdiff(e, target).padStart(7)}  ${fmt(t).padEnd(18)} ${tdiff(t, target).padStart(7)}  ${fmt(p).padEnd(18)} ${tdiff(p, target).padStart(7)}`);
}
