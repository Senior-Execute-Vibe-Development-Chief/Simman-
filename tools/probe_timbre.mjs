// HOW ROUGH IS A BODY ON ITS OWN? Roughness between an instrument's own
// partials, one note, nothing else playing. This is what "inharmonic" costs a
// listener before any question of scale or arrangement arises.
import { FAMILIES, makeInstrument } from "../src/sim/musicInstruments.js";

// Plomp–Levelt, the same kernel the tuning module uses, applied within one spectrum
const B1 = 3.5, B2 = 5.75, S1 = 0.0207, S2 = 18.96;
function roughPair(f1, a1, f2, a2) {
  const lo = Math.min(f1, f2), d = Math.abs(f1 - f2);
  const s = 0.24 / (S1 * lo + S2);
  return a1 * a2 * (Math.exp(-B1 * s * d) - Math.exp(-B2 * s * d));
}
function selfRough(partials, f0) {
  let sum = 0, norm = 0;
  for (let i = 0; i < partials.length; i++) {
    for (let j = i + 1; j < partials.length; j++) {
      sum += roughPair(partials[i].r * f0, partials[i].a, partials[j].r * f0, partials[j].a);
    }
    norm += partials[i].a * partials[i].a;
  }
  return norm ? sum / norm : 0;
}
const MAT = { string: "gut", air: "bamboo", membrane: "hide", tongue: "iron", bar: "wood", plate: "bronze" };
const rows = [];
for (const [fam, F] of Object.entries(FAMILIES)) {
  let inst; try { inst = makeInstrument(fam, MAT[F.vib] || "wood", "wood", 7); } catch (e) { console.log("skip", fam, e.message); continue; }
  if (!inst || !inst.partials || !inst.partials.length) continue;
  const f0 = (F.low || 200) * 1.5;
  rows.push({ fam, vib: F.vib, harmonic: !!inst.harmonic,
    r: selfRough(inst.partials, f0), np: inst.partials.length,
    dev: inst.partials.slice(0, 6).reduce((a, p, i) => a + Math.abs(p.r - (i + 1)), 0) / Math.min(6, inst.partials.length) });
}
rows.sort((a, b) => a.r - b.r);
console.log("family        vib        label        self-roughness   partials  mean |r_n − n|");
for (const r of rows) {
  console.log(r.fam.padEnd(13), String(r.vib).padEnd(10),
    (r.harmonic ? "harmonic" : "INHARMONIC").padEnd(12),
    r.r.toFixed(4).padStart(10), String(r.np).padStart(10), r.dev.toFixed(2).padStart(12));
}
const h = rows.filter(r => r.harmonic), i = rows.filter(r => !r.harmonic);
const mean = (R) => R.reduce((a, r) => a + r.r, 0) / (R.length || 1);
console.log("\nharmonic bodies  n=" + h.length, "mean self-roughness", mean(h).toFixed(4));
console.log("inharmonic       n=" + i.length, "mean self-roughness", mean(i).toFixed(4),
  " — " + (mean(i) / (mean(h) || 1)).toFixed(1) + "x");
