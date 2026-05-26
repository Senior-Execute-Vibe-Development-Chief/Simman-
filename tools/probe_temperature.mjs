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

// Real-world zonal annual-mean surface air temperatures (NASA GISS-ish):
const TARGETS = [
  // lat-norm, lat-deg, real-°C, target-t
  [0.00,   0, 26, 0.86],
  [0.11,  10, 25, 0.85],
  [0.22,  20, 22, 0.82],
  [0.33,  30, 17, 0.77],
  [0.44,  40, 11, 0.71],
  [0.56,  50,  4, 0.64],
  [0.67,  60, -3, 0.57],
  [0.78,  70,-11, 0.49],
  [0.89,  80,-19, 0.41],
  [1.00,  90,-25, 0.35],
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

// ── Proposed unified curve ──
// Goal: equator at +26°C, mid-latitudes scale realistically (45°N ~10°C),
// poles around -25°C. Two-term fit; lat^1.5 governs the broad shape,
// lat^3 supplies the polar acceleration.
//   t = 0.87 - 0.42*lat^1.5 - 0.10*lat^3
function proposed(lat) {
  return Math.max(0, Math.min(1,
    0.87 - 0.42 * Math.pow(lat, 1.5) - 0.10 * lat*lat*lat
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
