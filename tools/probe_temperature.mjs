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

// Targets calibrated for visualization: tropical bands should READ as
// hot (orange-red), polar bands cold enough to trigger the ICE biome
// (which fires at t<0.08). Realistic enough for crops + transport, but
// expanded at both ends so the map has range. Reference points:
//   • Equator → +32°C (Sahel/equatorial summer feel)
//   • 45°N → +10°C (Berlin/Beijing annual mean)
//   • 80°N → -20°C (Arctic Ocean)
//   • 90° polar tip → -50°C (Antarctic interior); ICE biome
// Greenland (lat 0.78, elev 0.4) and Antarctica (lat 0.87, elev 0.3)
// both hit ICE after the elev penalty (-0.4*e).
const TARGETS = [
  // lat-norm, lat-deg, real-°C, target-t
  [0.00,   0, 32, 0.92],
  [0.11,  10, 28, 0.88],
  [0.22,  20, 25, 0.85],
  [0.33,  30, 20, 0.80],
  [0.44,  40, 14, 0.74],
  [0.56,  50,  9, 0.69],
  [0.67,  60, -2, 0.58],
  [0.78,  70,-15, 0.45],
  [0.89,  80,-30, 0.30],
  [1.00,  90,-50, 0.10],
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

// ── Proposed unified curve (v3) ──
// Two-term smooth: lat^1.5 governs the mid-lat shape (matches Berlin
// /Beijing at +10°C), lat^6 stays ~0 below lat 0.7 then accelerates
// hard so the polar tip plunges to ICE biome territory (t<0.08).
//   t = 0.92 - 0.50*lat^1.5 - 0.80*lat^6
// At lat 0.85+, baseT alone drops below 0.25 — combined with elev
// penalty, Greenland interior (lat 0.78 elev 0.4) lands at tundra, and
// Antarctica (lat 0.87 elev 0.3) crosses the ICE threshold.
function proposed(lat) {
  const l6 = lat*lat*lat * lat*lat*lat;
  return Math.max(0, Math.min(1,
    0.92 - 0.50 * Math.pow(lat, 1.5) - 0.80 * l6
  ));
}

function fmt(t) {
  // Map t back to celsius: t = 0.60 + c/100 → c = (t - 0.60) * 100
  const c = ((t - 0.60) * 100).toFixed(1);
  return `${t.toFixed(3)} (${c >= 0 ? '+' : ''}${c}°C)`;
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
